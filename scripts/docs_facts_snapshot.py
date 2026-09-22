#!/usr/bin/env python3
"""교회력 설계 문서의 「사실 토큰」 스냅샷 · 비교 — 리팩터링이 사실을 지우지 않았음을 증명한다.

대상: 설계서 · 검토 문서 · ADR-036/037/038 + tests/fixtures/liturgical/*.json (JSON 문자열 값).
문서에서 날짜 · 월일 · 건수 · 관측일 id · precedence · transfer_to 값 · 전례색 · 미결 번호 · §번호 ·
C-/X-/I-/Q/R id · 픽스처 id · PR 번호를 뽑아 문서별·합집합으로 센다.

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
"""

from __future__ import annotations

import argparse
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


def list_fixtures(rev: str) -> list[str]:
    """rev 의 픽스처 JSON 목록. 디렉터리가 아직 없는 리비전(① 이전 main)은 빈 목록이 맞다 —
    그러나 리비전 자체가 틀리면 멈춘다(빈 목록으로 넘기면 픽스처 쪽 합집합이 통째로 빠진다)."""
    if rev == "WORKTREE":
        d = ROOT / FIXTURE_DIR
        return sorted(str(p.relative_to(ROOT)) for p in d.glob("*.json")) if d.exists() else []
    r = subprocess.run(["git", "ls-tree", "--name-only", rev, f"{FIXTURE_DIR}/"],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"{rev}: git ls-tree 실패 — {r.stderr.strip()}")
    return sorted(p for p in r.stdout.split() if p.endswith(".json"))


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


def tokenize(text: str) -> dict[str, Counter]:
    # 굵게 표시는 표현이지 사실이 아니다 — 지우지 않으면 `grid:christmas-**1**-sunday` 가
    # `grid:christmas-` 로 잘리고, `**96**건` 처럼 건수도 통째로 놓친다.
    text = text.replace("**", "")
    out: dict[str, Counter] = defaultdict(Counter)
    for kind, pat in PATTERNS:
        for m in pat.finditer(text):
            tok = m.group(1) if m.groups() else m.group(0)
            if kind == "prec":
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


def snapshot(rev: str) -> dict:
    files: dict[str, dict[str, dict[str, int]]] = {}
    union: dict[str, Counter] = defaultdict(Counter)
    for path in DOCS:
        toks = tokenize(read_at(rev, path))
        files[path] = {k: dict(sorted(v.items())) for k, v in toks.items()}
        for k, v in toks.items():
            union[k].update(v)
    for path in list_fixtures(rev):
        text = read_at(rev, path)
        try:
            strings = json_strings(json.loads(text))
        except json.JSONDecodeError as e:
            sys.exit(f"{rev}:{path} JSON 파싱 실패 — {e}")
        toks = tokenize("\n".join(strings))
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
         moved: dict[str, str], verbose: bool) -> int:
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
    bad_new = [x for x in new_docs if not x[3]]
    print()
    print(f"## 문서에 생긴 새 토큰 — {len(new_docs)} (허용 밖 {len(bad_new)})")
    for k, tok, n, ok in new_docs:
        print(f"- [{k}] {tok} ×{n}{'' if ok else '  ← 허용 밖'}")
    by_kind = Counter(k for k, _, _ in new_fixture_only)
    print()
    print(f"## 픽스처에만 생긴 새 토큰(전사) — {len(new_fixture_only)}: "
          + " · ".join(f"{k} {n}" for k, n in sorted(by_kind.items())))
    if verbose:
        for k, tok, n in new_fixture_only:
            print(f"- [{k}] {tok} ×{n}")
    return 1 if vanished or bad_new else 0


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
    args = ap.parse_args()
    moved: dict[str, str] = {}
    for m in args.moved:
        if not re.fullmatch(r"\d{1,2}\.\d{1,2}=\d{4}-\d{2}-\d{2}", m):
            ap.error(f"--moved 형식: MM.DD=YYYY-MM-DD ({m})")
        tok, iso = m.split("=")
        moved[tok] = iso

    if args.rev:
        snap = snapshot(args.rev)
        text = json.dumps(snap, ensure_ascii=False, indent=1)
        if args.out:
            Path(args.out).write_text(text + "\n", encoding="utf-8")
            print(f"{args.rev}: 파일 {len(snap['files'])} · 종류 {len(snap['union'])} → {args.out}")
        else:
            print(text)
        return 0

    a, b = (snapshot(r) for r in args.diff)
    allow = [re.compile(p) for p in ALLOWED_NEW_DEFAULT + args.allow_new]
    return diff(a, b, set(args.ignore), allow, moved, args.verbose)


if __name__ == "__main__":
    sys.exit(main())
