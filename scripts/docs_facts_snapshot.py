#!/usr/bin/env python3
"""교회력 설계 문서의 「사실 토큰」 스냅샷 · 비교 — 리팩터링이 사실을 지우지 않았음을 증명한다.

대상: 설계서 · 검토 문서 · ADR-036/037/038 + tests/fixtures/liturgical/*.json (JSON 문자열 값).
문서에서 날짜 · 월일 · 건수 · 관측일 id · precedence · transfer_to 값 · 전례색 · 미결 번호 · §번호 ·
C-/X-/I-/Q/R id · 픽스처 id · PR 번호를 뽑아 문서별·합집합으로 센다.

    python3 scripts/docs_facts_snapshot.py --rev main            # 스냅샷 JSON 을 stdout 으로
    python3 scripts/docs_facts_snapshot.py --rev main -o base.json
    python3 scripts/docs_facts_snapshot.py --diff main HEAD      # 합집합 비교 — 사라진 토큰 0 이어야 통과
    python3 scripts/docs_facts_snapshot.py --diff main WORKTREE  # 커밋 전 작업 트리와 비교

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
    ("prec", re.compile(r"prec(?:edence)?\s*:?\s*\**(\d(?:\.\d)?|null)\**")),
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
    ("pr", re.compile(r"((?:data\s*(?:PR\s*)?|PR\s*)?#\d{2,})(?!\d)")),
]

ALLOWED_NEW_DEFAULT = [r"^R-\d+(?:\.\d+)?-[a-z0-9-]+$", r"^[TOAW]-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$"]


def read_at(rev: str, path: str) -> str | None:
    """rev 의 path 내용. 없으면 None. WORKTREE 면 파일 시스템."""
    if rev == "WORKTREE":
        p = ROOT / path
        return p.read_text(encoding="utf-8") if p.exists() else None
    r = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=ROOT, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def list_fixtures(rev: str) -> list[str]:
    if rev == "WORKTREE":
        d = ROOT / FIXTURE_DIR
        return sorted(str(p.relative_to(ROOT)) for p in d.glob("*.json")) if d.exists() else []
    r = subprocess.run(["git", "ls-tree", "--name-only", rev, f"{FIXTURE_DIR}/"],
                       cwd=ROOT, capture_output=True, text=True)
    return sorted(p for p in r.stdout.split() if p.endswith(".json")) if r.returncode == 0 else []


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
                # 「PR #333」 · 「#333」 · 「data PR #26」 · 「data#26」 → `#333` · `data#26`
                num = re.search(r"#\d+", tok).group(0)
                tok = f"data{num}" if "data" in tok else num
            elif kind == "check" and tok.startswith("Q-"):
                tok = "Q" + tok[2:]
            out[kind][tok] += 1
    return out


def snapshot(rev: str) -> dict:
    files: dict[str, dict[str, dict[str, int]]] = {}
    union: dict[str, Counter] = defaultdict(Counter)
    for path in DOCS:
        text = read_at(rev, path)
        if text is None:
            continue
        toks = tokenize(text)
        files[path] = {k: dict(sorted(v.items())) for k, v in toks.items()}
        for k, v in toks.items():
            union[k].update(v)
    for path in list_fixtures(rev):
        text = read_at(rev, path)
        if text is None:
            continue
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


def diff(a: dict, b: dict, ignore: set[str], allow_new: list[re.Pattern[str]], verbose: bool) -> int:
    """합집합 비교. 판정 규칙:
    - 사라진 토큰 = 실패. 단 `월.일` 토큰이 B 의 ISO 날짜(같은 월·일)로 살아 있으면 「형태 변환」으로 보고 통과
      (§7 의 「→ 04.28」이 픽스처 「2025-04-28」로 옮겨 가는 경우).
    - 새 토큰 중 **문서**에 나타난 것은 허용 목록(R- · 픽스처 id · --allow-new)에 들어야 한다.
      픽스처 파일에만 나타난 새 토큰은 전사(문서의 부분 날짜 · 이름 → ISO 날짜 · 정확한 id)이므로 통과시키되 따로 센다
      — 전사 오류는 liturgical-fixtures.test.js(id 실재) 와 PR 본문의 대응표로 잡는다.
    """
    ua, ub = a["union"], b["union"]
    kinds = sorted(set(ua) | set(ub))
    # 「형태 변환」은 **픽스처로 옮겨 갔을 때만** 성립한다 — 합집합(=문서 포함)으로 보면
    # 아무 문서에나 같은 월·일로 끝나는 ISO 날짜가 하나 있다는 이유로 사라진 사실을 용서한다.
    b_fixture_dates: set[str] = set()
    b_doc_tokens: dict[str, set[str]] = defaultdict(set)
    for path, per_kind in b["files"].items():
        if is_fixture(path):
            b_fixture_dates.update(per_kind.get("date", {}))
        else:
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
                if k == "monthday":
                    mm, dd = tok.split(".")
                    suffix = f"-{int(mm):02d}-{int(dd):02d}"
                    iso = sorted(d for d in b_fixture_dates if d.endswith(suffix))
                    if iso:
                        converted.append((tok, "·".join(iso[:3]) + (" …" if len(iso) > 3 else "")))
                        continue
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

    total_a = sum(sum(v.values()) for v in ua.values())
    total_b = sum(sum(v.values()) for v in ub.values())
    print(f"# 스냅샷 비교 {a['rev']} → {b['rev']}")
    print(f"토큰 총수 {total_a} → {total_b} · 종류별 유일 토큰 "
          f"{sum(len(v) for v in ua.values())} → {sum(len(v) for v in ub.values())} · 카운트 감소 {decreased}종")
    print()
    print(f"## 사라진 토큰 — {len(vanished)}")
    for k, tok, n, where in vanished:
        print(f"- [{k}] {tok} ×{n} — {', '.join(where)}")
    if converted:
        print()
        print(f"## 형태 변환(월.일 → ISO 날짜, 픽스처에 살아 있음) — {len(converted)}")
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
    ap.add_argument("-v", "--verbose", action="store_true", help="픽스처 전용 새 토큰도 전부 나열")
    args = ap.parse_args()

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
    return diff(a, b, set(args.ignore), allow, args.verbose)


if __name__ == "__main__":
    sys.exit(main())
