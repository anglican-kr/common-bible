#!/usr/bin/env python3
"""교회력 설계 문서의 「사실 토큰」 스냅샷 · 비교 — 리팩터링이 사실을 지우지 않았음을 증명한다.

대상: 설계서 · 검토 문서 · ADR-036/037/038 + docs/archive/design/liturgical-engine-*.md(점-시점 보관 문서 —
설계서에서 옮겨 간 관찰 서술) + tests/fixtures/liturgical/*.json (JSON 문자열 값).
문서에서 날짜 · 월일 · 건수 · 관측일 id · precedence · transfer_to 값 · 전례색 · 미결 번호 · §번호 ·
C-/X-/I-/Q/R id · 픽스처 id · PR 번호를 뽑아 문서별·합집합으로 센다. 보관 문서와 픽스처는 리비전마다 목록을
구해(`git ls-tree`) 아직 없는 리비전에서는 비어 있는 것으로 본다 — 사실을 그리로 **옮기는** 변경이 사라짐으로
잡히지 않게.

    python3 scripts/docs_facts_snapshot.py --rev main            # 스냅샷 JSON 을 stdout 으로
    python3 scripts/docs_facts_snapshot.py --rev main -o base.json
    python3 scripts/docs_facts_snapshot.py --diff main HEAD      # 합집합 비교 — 사라진 토큰 0 이어야 통과
    python3 scripts/docs_facts_snapshot.py --diff main WORKTREE  # 커밋 전 작업 트리와 비교
    python3 scripts/docs_facts_snapshot.py --diff main HEAD --moved 04.28=2025-04-28 --allow-new '^§1\\.4$'

`--diff A B` 의 판정(종료 코드 1 = 실패):
  - A 에 있고 B 에 없는 토큰(**사라짐**)은 0 이어야 한다. 예외는 `--ignore <token>` 로 열거하고
    PR 본문 「의도적 삭제」에 적는다(책자 쪽수 같은 서술 전용 토큰).
  - B 에만 있는 토큰(**새로 생김**)은 R- 정본 마커와 픽스처 id(T-/O-/A-/W-) 만 허용한다. 그 밖은
    `--allow-new <regex>` 로 열거한다.
  - 카운트 감소는 정상이다(중복 제거가 목적) — 보고만 한다.

리비전은 git rev(`main`, `HEAD`, 해시) 또는 `WORKTREE`(작업 트리 파일 그대로). stdlib 만 쓴다.

교회력 밖의 문서(정리 층 · 영역 문서 · ADR · CLAUDE.md)를 옮기거나 고쳐 쓸 때는 옵션을 더한다
(2026-10-22 docs 재구성). 옵션이 없으면 위의 동작 그대로다.

    python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/*.md' --docs CLAUDE.md --kinds general
    python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/*.md' --kinds general --strict-counts \\
        --from docs/status.md --from docs/known-issues.md --into 'docs/*.md'

  - `--docs GLOB`(여러 번): 대상 문서를 리비전마다 glob 으로 펼친다(fnmatch — `*` 는 `/` 도 넘는다). 양쪽을
    같은 glob 으로 보므로 파일 사이로 옮긴 토큰은 사라짐이 아니다. glob 이 양쪽 모두에서 아무것도 못 고르면 멈춘다.
  - `--kinds general`: 날짜 · PR 번호 · 건수 + ADR 번호 · 옛 번호 참조(「pitfalls §N」 「known-issues §N」) ·
    파일 경로 · 인라인 코드 · 「」 인용 · 사용자 확정 날짜를 센다. 문장을 고쳐 써도 이것들은 그대로여야 한다.
    새 토큰은 판정하지 않는다(고쳐 쓰면 생기는 게 정상이다).
  - `--strict-counts`: 토큰 수가 줄어도 실패로 본다 — 여러 파일로 나눠 옮길 때 흔한 토큰(`ADR-010`)이 한 군데라도
    남으면 사라짐이 0 이 되는 맹점을 막는다.
  - `--from GLOB --into GLOB`(여러 번): 줄 비교. A 의 `--from` 파일의 줄이 B 의 `--into` 파일에 모두(개수까지)
    있어야 한다 — 글자 그대로 옮기는 커밋의 검증. 빈 줄 · `---` 는 건너뛰고, 제목은 `#` 과 앞 번호를, 목록 줄은
    앞에 붙인 옛 번호 표지(`**known-issues §N.m**`)를 떼고 견준다. 일부러 뺀 줄은 `--drop-file` 에 적고
    원장 「의도적 삭제」에도 적는다.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DOCS = [
    "docs/design/liturgical-engine.md",
    "docs/design/liturgical-engine-review.md",
    "docs/decisions/036-liturgical-calendar-data-model.md",
    "docs/decisions/037-eucharist-lectionary-data-and-engine.md",
    "docs/decisions/038-calendar-lectionary-ui.md",
]
FIXTURE_DIR = "tests/fixtures/liturgical"
# 설계서 §9 에서 옮겨 간 책자·달력 대조 서술의 보관처(점-시점 기록). 사실 토큰은 여기서도 센다 — 문서로 취급(픽스처 아님).
ARCHIVE_DIR, ARCHIVE_PREFIX = "docs/archive/design", "liturgical-engine-"

# 토큰 종류 → 정규식. 그룹이 있으면 그룹 1 이 토큰, 없으면 전체 매치.
# 순서는 보고 순서일 뿐이다 — 종류끼리 겹쳐도 각각 따로 센다.
PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("date", re.compile(r"(?<![\d-])((?:19|20)\d{2}-\d{2}-\d{2})(?![\d-])")),
    # 월.일 — §6.2 같은 절 번호와 소수는 뺀다(§ · 숫자 · 점 뒤에 오는 것 제외)
    ("monthday", re.compile(r"(?<![§\d.\w])(\d{1,2}\.\d{1,2})(?![\d.])")),
    ("count", re.compile(r"(\d+)\s*(건|쌍|행|회|일)(?![가-힣])")),
    ("id", re.compile(r"(?<![A-Za-z0-9가-힣-])(d\d{4}-[가-힣0-9A-Za-z-]+)")),
    ("id", re.compile(r"(?<![A-Za-z0-9가-힣-])(t-[가-힣][가-힣0-9A-Za-z-]*)")),
    ("id", re.compile(r"(?<![A-Za-z0-9가-힣-])(lunar\d+-[가-힣0-9A-Za-z-]+)")),
    ("id", re.compile(r"((?:grid|guard|common):[a-z0-9-]+)")),
    ("prec", re.compile(r"prec(?:edence)?\s*:?\s*(\d(?:\.\d)?|null)")),   # `**` 는 tokenize 가 먼저 지운다
    ("transfer_to", re.compile(
        r"\b(next_day|nearby_sunday|next_sunday|sunday_0102_0108|sunday_1030_1105|easter7_sunday|commemorate_only)\b")),
    ("color", re.compile(r"\b(white|red|green|violet|rose|blue)\b")),
    ("color", re.compile(r"(\[(?:백|홍|녹|자)(?:/(?:백|홍|녹|자))?\])")),
    ("issue", re.compile(r"(미결\d+)")),
    ("section", re.compile(r"(§\d+(?:\.\d+)?)")),
    ("check", re.compile(r"\b(C-(?:P|\d+(?:\.\d+)?)-\d+[a-z]?)\b")),
    ("check", re.compile(r"\b(X-\d+)\b")),
    ("check", re.compile(r"\b(I-\d+[ab]?)\b")),
    ("check", re.compile(r"\b(Q-?\d+)\b")),
    ("canon", re.compile(r"\b(R-\d+(?:\.\d+)?-[a-z0-9-]+)")),
    ("fixture", re.compile(r"\b([TOAW]-\d{4}-\d{2}-\d{2}-[a-z0-9-]+)")),
    # 「PR #333」 · 「#333」 · 「#9」 · 「data PR #26」 · 「data#26」 · 「데이터 저장소 PR #26」 — 접두는 정규화용
    ("pr", re.compile(r"((?:(?:data|데이터(?:\s*저장소)?)\s*(?:PR\s*)?|PR\s*)?#\d+)")),
]

ALLOWED_NEW_DEFAULT = [r"^R-\d+(?:\.\d+)?-[a-z0-9-]+$", r"^[TOAW]-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$"]

# --kinds general — 교회력 밖의 문서에서 사실의 표지가 되는 토큰. 날짜 · 건수 · PR 번호는 위와 같은 정규식을 쓴다.
GENERAL_PATTERNS: list[tuple[str, re.Pattern[str]]] = [p for p in PATTERNS if p[0] in ("date", "count", "pr")] + [
    ("adr", re.compile(r"\bADR[- ]?0*(\d{1,3})\b")),
    ("legacy", re.compile(r"\b((?:coding-)?pitfalls|known-issues)(?:\.md)?`?\s*§\s*(\d+(?:\.\d+)?)")),
    ("path", re.compile(r"(?<![\w/.:-])((?:js|css|docs|scripts|tests|tools|assets|\.github|\.claude)/[\w./-]*[\w/-])")),
    ("code", re.compile(r"`([^`\n]+)`")),
    ("quote", re.compile(r"「([^「」\n]+)」")),
    ("provenance", re.compile(r"사용자\s*(확인|결정|교정|확정|허용)[^\n]{0,24}?((?:19|20)\d{2}-\d{2}-\d{2})")),
]
KINDS = {"liturgical": PATTERNS, "general": GENERAL_PATTERNS}


def read_at(rev: str, path: str) -> str:
    """rev 의 path 내용. WORKTREE 면 파일 시스템. **없으면 멈춘다** — 조용히 빠뜨리면 그 문서의
    토큰 전부가 「사라진 토큰 0」의 시야에서 사라진다(문서를 옮겼으면 DOCS 목록을 함께 고칠 것)."""
    if rev == "WORKTREE":
        p = ROOT / path
        if not p.exists():
            sys.exit(f"WORKTREE:{path} 없음 — 옮겼으면 DOCS 목록을 함께 고칠 것")
        return p.read_text(encoding="utf-8")
    r = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"{rev}:{path} 를 읽을 수 없다 — {r.stderr.strip()} (옮겼으면 DOCS 목록을 함께 고칠 것)")
    return r.stdout


def list_dir(rev: str, directory: str, keep) -> list[str]:
    """rev 의 directory 안 파일 중 keep(이름) 이 참인 것. 디렉터리가 아직 없는 리비전(① 이전 main 의 픽스처,
    ② 이전 main 의 보관 문서)은 빈 목록이 맞다 — 그러나 리비전 자체가 틀리면 멈춘다(빈 목록으로 넘기면
    그쪽 합집합이 통째로 빠진다)."""
    if rev == "WORKTREE":
        d = ROOT / directory
        return sorted(str(p.relative_to(ROOT)) for p in d.iterdir() if keep(p.name)) if d.exists() else []
    r = subprocess.run(["git", "ls-tree", "--name-only", rev, f"{directory}/"],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"{rev}: git ls-tree 실패 — {r.stderr.strip()}")
    return sorted(p for p in r.stdout.split() if keep(Path(p).name))


def list_globs(rev: str, globs: list[str]) -> list[str]:
    """--docs · --from · --into 의 glob 을 리비전마다 펼친다(fnmatch — `*` 는 `/` 도 넘는다).
    WORKTREE 는 git 이 아는 파일(추적 중 + 무시되지 않은 새 파일) 가운데 디스크에 있는 것이다."""
    if rev == "WORKTREE":
        r = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                           cwd=ROOT, capture_output=True, text=True)
        names = [p for p in r.stdout.split("\0") if p and (ROOT / p).is_file()]
    else:
        r = subprocess.run(["git", "ls-tree", "-r", "-z", "--name-only", rev], cwd=ROOT, capture_output=True, text=True)
        names = [p for p in r.stdout.split("\0") if p]
    if r.returncode != 0:
        sys.exit(f"{rev}: 파일 목록을 구하지 못했다 — {r.stderr.strip()}")
    return sorted({p for p in names if any(fnmatch.fnmatchcase(p, g) for g in globs)})


def list_fixtures(rev: str) -> list[str]:
    return list_dir(rev, FIXTURE_DIR, lambda n: n.endswith(".json"))


def list_archives(rev: str) -> list[str]:
    return list_dir(rev, ARCHIVE_DIR, lambda n: n.startswith(ARCHIVE_PREFIX) and n.endswith(".md"))


def json_strings(node) -> list[str]:
    """JSON 트리의 문자열 값 전부(키 제외)."""
    out: list[str] = []
    if isinstance(node, str):
        out.append(node)
    elif isinstance(node, dict):
        for v in node.values():
            out.extend(json_strings(v))
    elif isinstance(node, list):
        for v in node:
            out.extend(json_strings(v))
    return out


def tokenize(text: str, patterns: list[tuple[str, re.Pattern[str]]] = PATTERNS) -> dict[str, Counter]:
    # 굵게 표시는 표현이지 사실이 아니다 — 지우지 않으면 `grid:christmas-**1**-sunday` 가
    # `grid:christmas-` 로 잘리고, `**96**건` 처럼 건수도 통째로 놓친다.
    text = text.replace("**", "")
    out: dict[str, Counter] = defaultdict(Counter)
    for kind, pat in patterns:
        for m in pat.finditer(text):
            tok = m.group(1) if m.groups() else m.group(0)
            if kind == "adr":
                tok = f"ADR-{int(tok):03d}"   # `ADR 010` · `ADR-10` · `ADR-010` 을 같은 토큰으로
            elif kind == "legacy":
                tok = f"{'pitfalls' if 'pitfalls' in m.group(1) else 'known-issues'} §{m.group(2)}"
            elif kind == "path":
                tok = tok.rstrip(".")
            elif kind in ("code", "quote"):
                tok = tok.strip()
            elif kind == "provenance":
                tok = f"사용자 {m.group(1)} {m.group(2)}"
            elif kind == "prec":
                tok = f"prec {tok}"
            elif kind == "count":
                tok = f"{m.group(1)}{m.group(2)}"
            elif kind == "pr":
                # 「PR #333」 · 「#333」 · 「data PR #26」 · 「데이터 저장소 PR #26」 → `#333` · `data#26`
                # (데이터 저장소 PR 을 어떻게 적든 같은 토큰 — 표기만 바꿔도 게이트가 죽지 않게)
                num = re.search(r"#\d+", tok).group(0)
                tok = f"data{num}" if re.match(r"(data|데이터)", tok) else num
            elif kind == "check" and tok.startswith("Q-"):
                tok = "Q" + tok[2:]
            out[kind][tok] += 1
    return out


def snapshot(rev: str, globs: list[str] | None = None,
             patterns: list[tuple[str, re.Pattern[str]]] = PATTERNS) -> dict:
    """globs 가 없으면 교회력 문서 다섯 + 보관 문서 + 픽스처(기본). 있으면 그 glob 이 고른 파일 —
    `.json` 은 픽스처처럼 문자열 값만 센다."""
    if globs:
        picked = list_globs(rev, globs)
        doc_paths = [p for p in picked if not p.endswith(".json")]
        json_paths = [p for p in picked if p.endswith(".json")]
    else:
        doc_paths, json_paths = DOCS + list_archives(rev), list_fixtures(rev)
    files: dict[str, dict[str, dict[str, int]]] = {}
    union: dict[str, Counter] = defaultdict(Counter)
    for path in doc_paths:
        toks = tokenize(read_at(rev, path), patterns)
        files[path] = {k: dict(sorted(v.items())) for k, v in toks.items()}
        for k, v in toks.items():
            union[k].update(v)
    for path in json_paths:
        text = read_at(rev, path)
        try:
            strings = json_strings(json.loads(text))
        except json.JSONDecodeError as e:
            sys.exit(f"{rev}:{path} JSON 파싱 실패 — {e}")
        toks = tokenize("\n".join(strings), patterns)
        files[path] = {k: dict(sorted(v.items())) for k, v in toks.items()}
        for k, v in toks.items():
            union[k].update(v)
    return {
        "rev": rev,
        "files": files,
        "union": {k: dict(sorted(v.items())) for k, v in sorted(union.items())},
    }


def is_fixture(path: str) -> bool:
    return path.startswith(FIXTURE_DIR + "/")


def diff(a: dict, b: dict, ignore: set[str], allow_new: list[re.Pattern[str]],
         moved: dict[str, str], verbose: bool, strict_counts: bool = False, judge_new: bool = True) -> int:
    """합집합 비교. 판정 규칙:
    - 사라진 토큰 = 실패. 단 `월.일` 토큰을 `--moved 04.28=2025-04-28` 로 **명시해 픽스처 ISO 날짜에 묶으면**
      「형태 변환」으로 보고 통과한다(§7 의 「→ 04.28」이 픽스처 「2025-04-28」로 옮겨 가는 경우). 조건은
      같은 월·일이고 **그 ISO 날짜의 픽스처 출현 수가 A 보다 늘었을 것** — 이번 변경이 실제로 그 날짜를
      픽스처에 적었다는 뜻이다. 자동 추정은 하지 않는다: 같은 월·일로 끝나는 무관한 케이스가 하나만 있어도
      그 사실의 삭제가 조용히(그리고 그 뒤 모든 PR 에서 영구히) 용서되기 때문이다.
    - 새 토큰 중 **문서**에 나타난 것은 허용 목록(R- · 픽스처 id · --allow-new)에 들어야 한다.
      픽스처 파일에만 나타난 새 토큰은 전사(문서의 부분 날짜 · 이름 → ISO 날짜 · 정확한 id)이므로 통과시키되 따로 센다
      — 전사 오류는 liturgical-fixtures.data.test.js(id 실재) 와 PR 본문의 대응표로 잡는다.
    """
    ua, ub = a["union"], b["union"]
    kinds = sorted(set(ua) | set(ub))
    # 「형태 변환」의 근거는 「--moved 로 지목한 ISO 날짜의 **픽스처** 출현 수가 A 보다 늘었다」 — 이번 변경이
    # 그 날짜를 픽스처에 적었다는 뜻. 합집합(=문서 포함)이나 A 때부터 있던 픽스처 날짜로 추정하면
    # 무관한 케이스 하나가 그 월·일의 삭제를 조용히, 그 뒤 모든 PR 에서 영구히 덮는다.
    def fixture_date_counts(snap: dict) -> Counter:
        c: Counter = Counter()
        for path, per_kind in snap["files"].items():
            if is_fixture(path):
                c.update(per_kind.get("date", {}))
        return c
    a_fixture_dates, b_fixture_dates = fixture_date_counts(a), fixture_date_counts(b)
    b_doc_tokens: dict[str, set[str]] = defaultdict(set)
    for path, per_kind in b["files"].items():
        if not is_fixture(path):
            for k, toks in per_kind.items():
                b_doc_tokens[k].update(toks)

    vanished: list[tuple[str, str, int, list[str]]] = []
    converted: list[tuple[str, str]] = []
    new_docs: list[tuple[str, str, int, bool]] = []
    new_fixture_only: list[tuple[str, str, int]] = []
    decreased = 0
    decreased_list: list[tuple[str, str, int, int]] = []
    for k in kinds:
        ta, tb = ua.get(k, {}), ub.get(k, {})
        for tok, n in ta.items():
            if tok not in tb:
                if tok in ignore:
                    continue
                if k == "monthday" and tok in moved:
                    mm, dd = tok.split(".")
                    iso = moved[tok]
                    if not iso.endswith(f"-{int(mm):02d}-{int(dd):02d}"):
                        sys.exit(f"--moved {tok}={iso}: 월·일이 다르다")
                    if b_fixture_dates.get(iso, 0) > a_fixture_dates.get(iso, 0):
                        converted.append((tok, iso))
                        continue
                    sys.exit(f"--moved {tok}={iso}: 그 날짜의 픽스처 출현 수가 늘지 않았다"
                             f"({a_fixture_dates.get(iso, 0)} → {b_fixture_dates.get(iso, 0)}) — 이번 변경이 옮긴 것이 아니다")
                where = [p for p, f in a["files"].items() if tok in f.get(k, {})]
                vanished.append((k, tok, n, where))
            elif tb[tok] < n:
                decreased += 1
                if tok not in ignore:
                    decreased_list.append((k, tok, n, tb[tok]))
        for tok, n in tb.items():
            if tok not in ta:
                if tok in b_doc_tokens.get(k, set()):
                    new_docs.append((k, tok, n, any(p.search(tok) for p in allow_new)))
                else:
                    new_fixture_only.append((k, tok, n))

    unused_moved = sorted(set(moved) - {tok for tok, _ in converted})
    total_a = sum(sum(v.values()) for v in ua.values())
    total_b = sum(sum(v.values()) for v in ub.values())
    print(f"# 스냅샷 비교 {a['rev']} → {b['rev']}")
    if unused_moved:
        print(f"⚠ 쓰이지 않은 --moved(사라진 토큰이 아니다 — 옛 명령을 복사했는지 확인): {' '.join(unused_moved)}")
    print(f"파일 {len(a['files'])} → {len(b['files'])} · 토큰 총수 {total_a} → {total_b} · 종류별 유일 토큰 "
          f"{sum(len(v) for v in ua.values())} → {sum(len(v) for v in ub.values())} · 카운트 감소 {decreased}종")
    print()
    print(f"## 사라진 토큰 — {len(vanished)}")
    for k, tok, n, where in vanished:
        print(f"- [{k}] {tok} ×{n} — {', '.join(where)}")
    if converted:
        print()
        print(f"## 형태 변환(--moved 로 명시 · 월.일 → 이번에 픽스처에 적힌 ISO 날짜) — {len(converted)}")
        for tok, iso in converted:
            print(f"- {tok} → {iso}")
    if strict_counts:
        print()
        print(f"## 줄어든 토큰(--strict-counts) — {len(decreased_list)}")
        for k, tok, n_a, n_b in decreased_list:
            print(f"- [{k}] {tok} ×{n_a} → ×{n_b}")
    bad_new = [x for x in new_docs if not x[3]] if judge_new else []
    print()
    if judge_new:
        print(f"## 문서에 생긴 새 토큰 — {len(new_docs)} (허용 밖 {len(bad_new)})")
        for k, tok, n, ok in new_docs:
            print(f"- [{k}] {tok} ×{n}{'' if ok else '  ← 허용 밖'}")
    else:
        print(f"## 문서에 생긴 새 토큰 — {len(new_docs)} (--kinds general 은 판정하지 않는다)")
        if verbose:
            for k, tok, n, _ in new_docs:
                print(f"- [{k}] {tok} ×{n}")
    by_kind = Counter(k for k, _, _ in new_fixture_only)
    print()
    print(f"## 픽스처에만 생긴 새 토큰(전사) — {len(new_fixture_only)}: "
          + " · ".join(f"{k} {n}" for k, n in sorted(by_kind.items())))
    if verbose:
        for k, tok, n in new_fixture_only:
            print(f"- [{k}] {tok} ×{n}")
    return 1 if vanished or bad_new or (strict_counts and decreased_list) else 0


# 옛 번호 표지 — 영역 문서로 옮긴 항목의 제목(`### pitfalls §38 — 제목`)과 목록 줄(`- **known-issues §N.m** …`) 앞에 붙는다.
ID_PREFIX = r"(?:(?:coding-)?pitfalls|known-issues)\s*§[\d.]+"


def norm_line(line: str) -> str | None:
    """줄 비교용 정규화 — 글자 그대로 옮긴 줄이 옮긴 곳의 형식 차이 때문에 「빠짐」이 되지 않게 한다.
    빈 줄과 `---` 는 None. 제목은 `#` 과 앞 번호(`38.` · `4.10` · `pitfalls §38 —`)를 뗀다.
    목록 줄은 앞에 붙인 옛 번호 표지(`**known-issues §N.m**`)를 뗀다."""
    s = line.strip()
    if not s or re.fullmatch(r"-{3,}", s):
        return None
    if s.startswith("#"):
        s = re.sub(r"^#+\s*", "", s)
        s = re.sub(rf"^(?:{ID_PREFIX}|\d+(?:\.\d+)*\.?)\s*(?:—\s*)?", "", s)
    else:
        s = re.sub(rf"^([-*]|\d+\.)\s+\*\*{ID_PREFIX}\*\*\s*", r"\1 ", s)
    return s or None


def check_lines(a_rev: str, b_rev: str, from_globs: list[str], into_globs: list[str],
                drop_file: str | None) -> int:
    """A 의 --from 파일 줄이 B 의 --into 파일에 개수까지 모두 있는가. 빠진 줄은 `파일:줄` 로 낸다."""
    src, dst = list_globs(a_rev, from_globs), list_globs(b_rev, into_globs)
    if not src:
        sys.exit(f"--from 이 {a_rev} 에서 아무 파일도 고르지 않았다: {' '.join(from_globs)}")
    if not dst:
        sys.exit(f"--into 가 {b_rev} 에서 아무 파일도 고르지 않았다: {' '.join(into_globs)}")
    pool: Counter = Counter()
    for p in dst:
        for line in read_at(b_rev, p).split("\n"):
            n = norm_line(line)
            if n:
                pool[n] += 1
    drops: set[str] = set()
    if drop_file:
        drops = {n for line in Path(drop_file).read_text(encoding="utf-8").split("\n") if (n := norm_line(line))}
    missing: list[str] = []
    total = dropped = 0
    for p in src:
        for i, line in enumerate(read_at(a_rev, p).split("\n"), 1):
            n = norm_line(line)
            if not n:
                continue
            total += 1
            if pool[n] > 0:
                pool[n] -= 1
            elif n in drops:
                dropped += 1
            else:
                missing.append(f"{p}:{i}: {line.strip()}")
    print()
    print(f"# 줄 비교 {a_rev} {' '.join(src)} → {b_rev} 파일 {len(dst)}개")
    print(f"옛 줄 {total} · 옮겨진 줄 {total - dropped - len(missing)} · 일부러 뺀 줄(--drop-file) {dropped}")
    print(f"## 빠진 줄 — {len(missing)}")
    for m in missing:
        print(f"- {m}")
    return 1 if missing else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--rev", help="스냅샷을 찍을 리비전(git rev 또는 WORKTREE)")
    g.add_argument("--diff", nargs=2, metavar=("A", "B"), help="두 리비전의 합집합 비교")
    ap.add_argument("-o", "--out", help="--rev 결과를 저장할 파일(기본 stdout)")
    ap.add_argument("--ignore", action="append", default=[], metavar="TOKEN",
                    help="사라져도 되는 토큰(의도적 삭제 — PR 본문에 열거)")
    ap.add_argument("--allow-new", action="append", default=[], metavar="REGEX",
                    help="R-/픽스처 id 외에 문서에 새로 생겨도 되는 토큰 패턴")
    ap.add_argument("--moved", action="append", default=[], metavar="MM.DD=YYYY-MM-DD",
                    help="문서의 월.일 토큰이 픽스처의 이 ISO 날짜로 옮겨 갔다(형태 변환) — 원장에 열거")
    ap.add_argument("-v", "--verbose", action="store_true", help="픽스처 전용 새 토큰도 전부 나열")
    ap.add_argument("--docs", action="append", default=[], metavar="GLOB",
                    help="대상 문서 glob(여러 번) — 없으면 교회력 문서 다섯 · 보관 문서 · 픽스처")
    ap.add_argument("--kinds", choices=sorted(KINDS), default="liturgical",
                    help="셀 토큰 종류(기본 liturgical). general 은 새 토큰을 판정하지 않는다")
    ap.add_argument("--strict-counts", action="store_true", help="토큰 수가 줄어도 실패로 본다")
    ap.add_argument("--from", dest="from_globs", action="append", default=[], metavar="GLOB",
                    help="줄 비교 — A 쪽 옛 파일 glob(여러 번, --into 와 함께)")
    ap.add_argument("--into", dest="into_globs", action="append", default=[], metavar="GLOB",
                    help="줄 비교 — B 쪽에서 옛 줄을 찾을 파일 glob(여러 번)")
    ap.add_argument("--drop-file", metavar="PATH", help="줄 비교 — 일부러 뺀 줄 목록(한 줄에 하나)")
    args = ap.parse_args()
    if bool(args.from_globs) != bool(args.into_globs):
        ap.error("--from 과 --into 는 함께 쓴다")
    if args.from_globs and not args.diff:
        ap.error("--from/--into 는 --diff A B 와 함께 쓴다")
    patterns = KINDS[args.kinds]
    globs = args.docs or None
    moved: dict[str, str] = {}
    for m in args.moved:
        if not re.fullmatch(r"\d{1,2}\.\d{1,2}=\d{4}-\d{2}-\d{2}", m):
            ap.error(f"--moved 형식: MM.DD=YYYY-MM-DD ({m})")
        tok, iso = m.split("=")
        moved[tok] = iso

    if args.rev:
        snap = snapshot(args.rev, globs, patterns)
        text = json.dumps(snap, ensure_ascii=False, indent=1)
        if args.out:
            Path(args.out).write_text(text + "\n", encoding="utf-8")
            print(f"{args.rev}: 파일 {len(snap['files'])} · 종류 {len(snap['union'])} → {args.out}")
        else:
            print(text)
        return 0

    if globs:
        # glob 하나가 양쪽 모두에서 아무것도 못 고르면 오타다 — 조용히 넘기면 그 문서들의 토큰이 시야에서 빠진다.
        for g in globs:
            if not any(list_globs(r, [g]) for r in args.diff):
                sys.exit(f"--docs {g}: 양쪽 리비전 모두에서 고른 파일이 없다")
    a, b = (snapshot(r, globs, patterns) for r in args.diff)
    allow = [re.compile(p) for p in ALLOWED_NEW_DEFAULT + args.allow_new]
    code = diff(a, b, set(args.ignore), allow, moved, args.verbose,
                strict_counts=args.strict_counts, judge_new=args.kinds == "liturgical")
    if args.from_globs:
        code |= check_lines(args.diff[0], args.diff[1], args.from_globs, args.into_globs, args.drop_file)
    return code


if __name__ == "__main__":
    sys.exit(main())
