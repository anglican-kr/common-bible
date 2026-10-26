#!/usr/bin/env python3
"""Prose tools for the sentence-cleanup loop (tools/prose/README.md).

  lint       Count rule violations a machine can find in Korean prose:
             Markdown text and the comments of code files.
  same-code  Check that nothing but comments and docs changed between two
             revisions, so a cleanup PR cannot slip in a code change.

Run: python3 tools/prose/prose.py lint [--detail] [--changed BASE] [PATH ...]
     python3 tools/prose/prose.py same-code BASE [HEAD]
Tests: python3 -m unittest tools/prose/test_prose.py
"""

import argparse
import ast
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Merged ledgers are immutable, the archive is a historical record, and the
# reference/ files are transcriptions of the prayer book. data/ is another repo.
SKIP_PREFIXES = ("docs/changes/", "docs/archive/", "docs/reference/", "data/", "node_modules/")
KEEP_FILES = {"docs/changes/README.md"}
PROSE_EXT = {".md", ".js", ".mjs", ".cjs", ".css", ".html", ".py", ".sh", ".yml", ".yaml"}

HANGUL = re.compile(r"[가-힣]")

# ── Comment extraction ───────────────────────────────────────────────────────


def js_scan(src, css=False):
    """Yield ("code"|"comment", start, end) spans of JS (or CSS) source.

    Strings, template literals and regex literals are code; only // and /* */
    outside them are comments. Regex detection is the usual heuristic: a slash
    after an operator, an opening bracket, a keyword, or at the start.
    """
    i, n, start = 0, len(src), 0
    prev = ""  # last significant code character
    prev_word = ""
    tmpl_depth = []  # brace depth stack for `${ ... }` inside template literals

    def flush(kind, a, b):
        if b > a:
            yield (kind, a, b)

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/" and not css:
            yield from flush("code", start, i)
            j = src.find("\n", i)
            j = n if j < 0 else j
            yield ("comment", i, j)
            i = start = j
            continue
        if c == "/" and nxt == "*":
            yield from flush("code", start, i)
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            yield ("comment", i, j)
            i = start = j
            continue
        if c in "'\"":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            i = j + 1
            prev = c
            continue
        if c == "`" and not css:
            i = skip_template(src, i + 1)
            prev = "`"
            continue
        if c == "/" and not css and (prev == "" or prev in "(,=:[!&|?{};+-*%<>~^" or prev_word in ("return", "typeof", "case", "in", "of")):
            j, in_class = i + 1, False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "[":
                    in_class = True
                elif src[j] == "]":
                    in_class = False
                elif src[j] == "/" and not in_class:
                    break
                j += 1
            i = j + 1
            prev = "/"
            continue
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            prev_word = src[i:j]
            prev = src[j - 1]
            i = j
            continue
        if not c.isspace():
            prev, prev_word = c, ""
        i += 1
    yield from flush("code", start, n)


def skip_template(src, i):
    """Return the index just past the template literal whose body starts at i."""
    n = len(src)
    while i < n:
        c = src[i]
        if c == "\\":
            i += 2
            continue
        if c == "`":
            return i + 1
        if c == "$" and i + 1 < n and src[i + 1] == "{":
            depth, i = 1, i + 2
            while i < n and depth:
                if src[i] == "`":
                    i = skip_template(src, i + 1)
                    continue
                if src[i] in "'\"":
                    q, i = src[i], i + 1
                    while i < n and src[i] != q:
                        i += 2 if src[i] == "\\" else 1
                elif src[i] == "{":
                    depth += 1
                elif src[i] == "}":
                    depth -= 1
                i += 1
            continue
        i += 1
    return n


def hash_scan(src):
    """Yield spans for # comments (shell, YAML): a # at line start or after a space, outside quotes."""
    pos = 0
    for line in src.splitlines(keepends=True):
        q = None
        for k, c in enumerate(line):
            if q:
                if c == q:
                    q = None
            elif c in "'\"":
                q = c
            elif c == "#" and (k == 0 or line[k - 1] in " \t"):
                yield ("comment", pos + k, pos + len(line.rstrip("\n")))
                break
        pos += len(line)


def html_scan(src):
    for m in re.finditer(r"<!--.*?-->", src, re.S):
        yield ("comment", m.start(), m.end())


def py_comment_spans(src):
    """Comments and docstrings of Python source as (start, end) offsets."""
    import io
    import tokenize

    lines = src.splitlines(keepends=True)
    offs = [0]
    for line in lines:
        offs.append(offs[-1] + len(line))
    spans = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type == tokenize.COMMENT:
                (r, c), (r2, c2) = tok.start, tok.end
                spans.append((offs[r - 1] + c, offs[r2 - 1] + c2))
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
                d = node.body[0]
                if isinstance(d, ast.Expr) and isinstance(d.value, ast.Constant) and isinstance(d.value.value, str):
                    spans.append((offs[d.lineno - 1] + chars(lines[d.lineno - 1], d.col_offset),
                                  offs[d.end_lineno - 1] + chars(lines[d.end_lineno - 1], d.end_col_offset)))
    except (SyntaxError, tokenize.TokenError):
        return []
    return spans


def chars(line, byte_col):
    """ast reports columns in UTF-8 bytes; convert to a character offset."""
    return len(line.encode("utf-8")[:byte_col].decode("utf-8", errors="ignore"))


def comment_spans(path, src):
    ext = Path(path).suffix
    if ext in (".js", ".mjs", ".cjs"):
        return [(a, b) for k, a, b in js_scan(src) if k == "comment"]
    if ext == ".css":
        return [(a, b) for k, a, b in js_scan(src, css=True) if k == "comment"]
    if ext in (".sh", ".yml", ".yaml"):
        return [(a, b) for _, a, b in hash_scan(src)]
    if ext == ".html":
        return [(a, b) for _, a, b in html_scan(src)]
    if ext == ".py":
        return py_comment_spans(src)
    return []


def segments(path, src):
    """(line number, text, kind) for each line of prose in a file."""
    if path.endswith(".md"):
        return md_segments(src)
    out = []
    for a, b in comment_spans(path, src):
        line_no = src.count("\n", 0, a) + 1
        for k, part in enumerate(src[a:b].split("\n")):
            out.append((line_no + k, part, "comment"))
    return out


FENCE = re.compile(r"^\s*(```|~~~)")


def md_segments(src):
    out, fence, lines = [], False, src.splitlines()
    front = len(lines) > 0 and lines[0].strip() == "---"
    for i, line in enumerate(lines, 1):
        if front:
            if i > 1 and line.strip() == "---":
                front = False
            continue
        if FENCE.match(line):
            fence = not fence
            continue
        if not fence:
            out.append((i, line, "md"))
    return out


# ── Checks ───────────────────────────────────────────────────────────────────


def mask(s):
    """Hide what the rules do not govern: code spans, quotations, link targets, URLs, tags."""
    s = re.sub(r"`[^`]*`", "`C`", s)
    s = re.sub(r"「[^」]*」", "「Q」", s)
    s = re.sub(r"『[^』]*』", "『Q』", s)
    s = re.sub(r"\]\([^)]*\)", "]", s)
    s = re.sub(r"https?://\S+", "URL", s)
    s = re.sub(r"</?[A-Za-z][^<>]*>", " ", s)
    return s


def alt(words):
    return "|".join(sorted(set(words), key=len, reverse=True))


# Particles and verb endings that belong to the word before them
# (docs/writing.md pitfalls §31). Followed by a non-Hangul character, so
# 「HTTP 실패」 or 「`x` 함수」 never match.
CERTAIN = alt("""
을 를 은 는 의 에 에서 에게 에는 에도 에서는 에서도 에서의 으로 로 으로는 로는 으로도 로도 으로서 로서 으로부터 로부터
와 과 와는 과는 와의 과의 까지 부터 처럼 보다 보다는 마다 대로 만큼 뿐 마저 조차 이나마
가 라 라는 라서 란 이라 이라는 이라서 이란 이다 이며 이고 이면 이나 인 인데 인지 이므로 이지만 이었다 였다
하는 하고 하면 하지 하여 해서 했다 한다 할 해야 하려면 하므로 했고 된다 되는 되면 되어 되고 되지 됐다 돼 된 될 됨 함
""".split())
AMBIGUOUS = alt("이 나 도 만 면 일 한 해".split())
PRE = r"[A-Za-z0-9_`)\]%」』'\"]"
NOT_HANGUL_NEXT = r"(?![가-힣])"
RE_PARTICLE = re.compile(PRE + r" (?:" + CERTAIN + r")" + NOT_HANGUL_NEXT)
RE_PARTICLE_AMBIG = re.compile(PRE + r" (?:" + AMBIGUOUS + r")" + NOT_HANGUL_NEXT)
RE_TILDE = re.compile(r"\d\s*~\s*\d")

# docs/writing.md 「용어」 — words that are wrong wherever they appear in prose.
TERMS = """
살아있는 문서|발화|저본|모서리 사례|막힌 축일|스트랭글러|미스노머|머리명사|한정어|영역 문서|꾸러미|판 번호|정본|코퍼스|단언|정합|경합|병기|관측일
|이동 패스|near-leaf|leaf 모듈|승자|패자|품계|동률|동점|성인력|좌석|가상 점유자|점유자|센티널|사다리|결손|상태 꼬리|꼬리말|이름표|스팬|드리프트|가드
|골든 덤프|만성|선재|고아|기각|줄임 명칭|전사|확증|명문화|승계|잔존|수렴|일원화|도출|부합|함의|소급|발현|동형|소관|준용|착수|명기|환원|이관|편승|상이
|귀속|귀결|자명|판본|재진술|반증|기제
""".replace("\n", "")
# Words that are wrong only in one sense (the table says which); a person or agent decides.
TERMS_CONTEXT = "도착|출발|떠난|켜다|켜진|꺼진|이동|좌표|temporal|sanctoral|무음|풀린다|풀었다|채운다|걷는다|걷기|듣지 않는다|소비자|지정 독서|부른다|불린다|불리는|불렸다|불려"
RE_TERM = re.compile(r"(?<![가-힣])(?:" + TERMS + r")")
RE_TERM_CONTEXT = re.compile(r"(?<![가-힣A-Za-z])(?:" + TERMS_CONTEXT + r")")
RE_KKOL = re.compile(r"(?<![가-힣])꼴(?:[을이은로의에도만]|(?![가-힣]))")

# Verbs that borrow a body movement or a place for what a program does
# (docs/writing.md 「시스템이 하는 일은 실제 동작의 동사로 쓴다」).
VERB_STEMS = "흡수|견디|견딘|얹|앉|닿|갇|가둠|가둔|가두|삼키|삼킨|삼켜|먹히|먹힌|먹혀|뚫|밟"
VERB_FORMS = "걸면|걸어 둔|걸어둔|걸린다|걸려|걸리면|걸리는|건다|걸고|탄다|타고|타는|타면|태운다|태워|먹는다|먹어|먹는|샌다|새는|새어|피해 둔|피해서|피한다|피하려"
RE_VERB = re.compile(r"(?<![가-힣])(?:(?:" + VERB_STEMS + r")|(?:" + VERB_FORMS + r")" + NOT_HANGUL_NEXT + ")")

# English that may stand in a Korean sentence without backticks: established
# acronyms (all caps pass automatically), products, services and formats.
ALLOW = set("""
iOS macOS iPadOS Android Safari Chrome Chromium Firefox WebKit Edge GitHub Google Drive Apple HIG MDN TTA RFC nginx njs Node npm git
Playwright pytest unittest Copilot Bugbot Claude Opus Sonnet Haiku Python JavaScript TypeScript JSDoc tsc Vanilla IndexedDB Cache
Markdown PDF KASI RCL romcal Lighthouse OAuth Ed25519 mp3 Phase Actions Pages Web Worker Service PWA PKCE JSON
known-issues pitfalls push main
""".split())


def english_words(s):
    s = re.sub(r"\([^()]*\)", " ", s)  # an English gloss in parentheses is allowed
    # ASCII boundaries: \w would count Hangul, so 「flag를」 (particle attached) would slip through.
    for m in re.finditer(r"(?<![A-Za-z0-9_./#:@$\\-])([A-Za-z][A-Za-z'-]*)(?![A-Za-z0-9_/(:@$-]|\.[A-Za-z0-9])", s):
        w = m.group(1)
        if len(w) < 2 or w.isupper() or w in ALLOW:
            continue
        if re.search(r"[a-z][A-Z]|[A-Z]{2}", w):  # camelCase or an acronym inside → a code name
            continue
        yield w


def check_line(text, kind, path):
    """Findings for one line: (check id, matched text). An id ending in ? needs judgement."""
    if not HANGUL.search(text):
        return []
    m = mask(text)
    found = []
    found += [("particle", x.group(0)) for x in RE_PARTICLE.finditer(m)]
    found += [("particle?", x.group(0)) for x in RE_PARTICLE_AMBIG.finditer(m)]
    found += [("tilde", x.group(0)) for x in RE_TILDE.finditer(m)]
    if path != "docs/writing.md":  # the rule book quotes the words it bans
        found += [("term", x.group(0)) for x in RE_TERM.finditer(m)]
        found += [("term", "꼴") for _ in RE_KKOL.finditer(m)]
        found += [("term?", x.group(0)) for x in RE_TERM_CONTEXT.finditer(m)]
        found += [("verb?", x.group(0)) for x in RE_VERB.finditer(m)]
    # Code comments may be written in English (CLAUDE.md); the rules below are
    # for Korean sentences, so a line with more Latin letters than Hangul is skipped.
    latin = sum(len(w) for w in re.findall(r"[A-Za-z]+", m))
    if len(HANGUL.findall(m)) < latin:
        return found
    found += [("english?", w) for w in english_words(m)]
    is_table = kind == "md" and text.lstrip().startswith("|")
    is_heading = kind == "md" and text.lstrip().startswith("#")
    if "→" in m and not is_table:
        found.append(("arrow?", "→"))
    found += [("dot?", "·")] * m.count("·")
    if "—" in m and not is_heading:
        found.append(("dash?", "—"))
    return found


CHECKS = {
    "particle": "영어 단어 뒤에 띄어 쓴 조사(pitfalls §31)",
    "particle?": "띄어 쓴 조사일 수 있는 말(이, 나, 도, 만, 면, 일, 한, 해)",
    "tilde": "숫자 구간의 물결표(pitfalls §32)",
    "term": "「용어」 표에서 쓰지 않기로 한 말",
    "term?": "한 가지 뜻으로만 쓰지 않기로 한 말",
    "verb?": "몸의 움직임이나 공간을 빌린 동사",
    "english?": "코드 이름이 아닌 영어 낱말(역따옴표 밖)",
    "arrow?": "문장 속 화살표",
    "dot?": "가운뎃점",
    "dash?": "줄표",
}

# ── Files ────────────────────────────────────────────────────────────────────


def tracked_files():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [f for f in out.split("\n") if f and in_scope(f)]


def rel(p):
    """A path argument as a repo-relative path, whether given from the root, a subdirectory or absolute."""
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return p


def in_scope(f):
    if f in KEEP_FILES:
        return True
    return Path(f).suffix in PROSE_EXT and not f.startswith(SKIP_PREFIXES)


def lint_file(path, src):
    return [(ln, cid, hit, text) for ln, text, kind in segments(path, src) for cid, hit in check_line(text, kind, path)]


def added_lines(base):
    """{path: set(line numbers)} of lines added since the merge base with base."""
    out = subprocess.run(["git", "diff", "-U0", "--no-color", f"{base}...HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    lines, path = defaultdict(set), None
    for row in out.split("\n"):
        if row.startswith("+++ "):
            path = row[6:] if row.startswith("+++ b/") else None
        m = re.match(r"@@ -\S+ \+(\d+)(?:,(\d+))? @@", row)
        if m and path:
            start, count = int(m.group(1)), int(m.group(2) or "1")
            lines[path].update(range(start, start + count))
    return lines


def cmd_lint(args):
    files = [rel(p) for p in args.paths] or tracked_files()
    files = [f for f in files if in_scope(f) and (ROOT / f).is_file()]
    only = added_lines(args.changed) if args.changed else None
    findings = []
    for f in files:
        if only is not None and f not in only:
            continue
        src = (ROOT / f).read_text(encoding="utf-8", errors="replace")
        for ln, cid, hit, text in lint_file(f, src):
            if only is None or ln in only[f]:
                findings.append((f, ln, cid, hit, text.strip()))
    if args.json:
        json.dump([dict(file=f, line=ln, check=c, hit=h) for f, ln, c, h, _ in findings], sys.stdout, ensure_ascii=False, indent=1)
        return 0
    if args.github:
        return github_report(findings)
    if args.detail:
        for f, ln, cid, hit, text in findings:
            print(f"{f}:{ln}: [{cid}] {hit} | {text[:160]}")
        return 0
    per_file = defaultdict(Counter)
    for f, _, cid, _, _ in findings:
        per_file[f][cid] += 1
    total = Counter()
    for c in per_file.values():
        total.update(c)
    print("검사 | 건수 | 뜻")
    for cid, desc in CHECKS.items():
        print(f"{cid} | {total[cid]} | {desc}")
    print(f"\n파일 {len(per_file)}개. 앞의 수는 전체, 뒤의 수는 판단이 필요 없는 것(particle, tilde, term)이다.")
    for f, c in sorted(per_file.items(), key=lambda kv: -sum(kv[1].values()))[: args.top]:
        sure = c["particle"] + c["tilde"] + c["term"]
        print(f"{sum(c.values()):5} {sure:5}  {f}")
    return 0


def gh_data(s):
    """Escape a workflow command message: a file in the PR must not be able to start another command."""
    return s.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def gh_prop(s):
    return gh_data(s).replace(":", "%3A").replace(",", "%2C")


def github_report(findings, limit=10):
    """Annotate the first findings and write the full list to the job summary. Never fails."""
    order = {k: i for i, k in enumerate(CHECKS)}
    findings.sort(key=lambda x: (order[x[2]], x[0], x[1]))
    for f, ln, cid, hit, _ in findings[:limit]:
        print(f"::warning file={gh_prop(f)},line={ln},title={gh_prop('문장 검사 ' + cid)}::{gh_data(CHECKS[cid] + ': ' + hit)}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    lines = [f"## 문장 검사 — 고친 줄에서 {len(findings)}건", ""]
    if findings:
        lines += ["| 파일:줄 | 검사 | 찾은 말 |", "| --- | --- | --- |"]
        lines += [f"| `{f}:{ln}` | {cid} | {hit.replace('|', '¦')} |" for f, ln, cid, hit, _ in findings[:500]]
    text = "\n".join(lines) + "\n"
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(text)
    print(f"문장 검사: 고친 줄에서 {len(findings)}건(경고만, 첫 {min(limit, len(findings))}건을 표시)")
    return 0


# ── same-code ────────────────────────────────────────────────────────────────


def strip_comments(path, src):
    """The code of a file with comments (and docstrings) removed, whitespace collapsed.

    None means the file is prose (Markdown) and may change freely.
    """
    ext = Path(path).suffix
    if ext == ".md":
        return None
    if ext == ".py":
        try:
            tree = ast.parse(src)
        except SyntaxError:
            return src
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
                d = node.body[0]
                if isinstance(d, ast.Expr) and isinstance(d.value, ast.Constant) and isinstance(d.value.value, str):
                    d.value.value = ""
        return ast.dump(tree)
    spans = comment_spans(path, src)
    if ext in (".sh", ".yml", ".yaml"):
        # Line-oriented: drop the comment part of each line, then blank lines.
        keep, last = [], 0
        for a, b in spans:
            keep.append(src[last:a])
            last = b
        keep.append(src[last:])
        return "\n".join(l.rstrip() for l in "".join(keep).split("\n") if l.strip())
    if not spans and ext not in (".js", ".mjs", ".cjs", ".css", ".html"):
        return src
    keep, last = [], 0
    for a, b in spans:
        keep.append(src[last:a])
        keep.append(" ")
        last = b
    keep.append(src[last:])
    return re.sub(r"\s+", " ", "".join(keep)).strip()


def git_show(rev, path):
    r = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=ROOT, capture_output=True)
    return r.stdout.decode("utf-8", errors="replace") if r.returncode == 0 else None


def read_rev(rev, path):
    """File text at a revision; WORKTREE reads the disk. None if the file does not exist there."""
    if rev != "WORKTREE":
        return git_show(rev, path)
    p = ROOT / path
    return p.read_bytes().decode("utf-8", errors="replace") if p.is_file() else None


def cmd_same_code(args):
    head = args.head
    diff_args = ["git", "diff", "--name-only", args.base] + ([head] if head != "WORKTREE" else [])
    changed = subprocess.run(diff_args, cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    bad = []
    for f in changed:
        if f.endswith(".md"):
            continue
        old, new = read_rev(args.base, f), read_rev(head, f)
        if old is None or new is None:
            bad.append(f"{f}: 파일이 생기거나 지워졌다")
            continue
        if strip_comments(f, old) != strip_comments(f, new):
            bad.append(f"{f}: 주석 말고도 바뀌었다")
    for b in bad:
        print(b)
    print(f"바뀐 파일 {len(changed)}개, 주석과 문서 말고 바뀐 파일 {len(bad)}개")
    return 1 if bad else 0


def main(argv=None):
    p = argparse.ArgumentParser(description="문장 검사와 주석 외 코드 비교")
    sub = p.add_subparsers(dest="cmd", required=True)
    lint = sub.add_parser("lint", help="문장 검사")
    lint.add_argument("paths", nargs="*", help="검사할 파일(기본: 저장소 전체)")
    lint.add_argument("--changed", metavar="BASE", help="BASE 이후 더하거나 고친 줄만 본다")
    lint.add_argument("--detail", action="store_true", help="찾은 곳을 하나씩 적는다")
    lint.add_argument("--json", action="store_true")
    lint.add_argument("--github", action="store_true", help="GitHub Actions 경고와 작업 요약")
    lint.add_argument("--top", type=int, default=40, help="요약에 보일 파일 수")
    same = sub.add_parser("same-code", help="주석과 문서 말고 바뀐 것이 없는지 본다")
    same.add_argument("base")
    same.add_argument("head", nargs="?", default="WORKTREE")
    args = p.parse_args(argv)
    return cmd_lint(args) if args.cmd == "lint" else cmd_same_code(args)


if __name__ == "__main__":
    sys.exit(main())
