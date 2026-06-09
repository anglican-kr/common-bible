#!/usr/bin/env python3
"""index.html CSP 인라인 해시 검사·자동 수정.

CSP `style-src`/`script-src`의 `'sha256-…'` 토큰이 index.html의 정적 인라인
`<style>`/`<script>` 블록과 일치하는지 검사(--check, 기본)하거나 자동으로
동기화(--fix)한다. 인라인 블록을 수정하고 CSP 해시 갱신을 잊으면 브라우저가
그 블록을 차단하는데(스타일=FOUC, 스크립트=미실행), 이를 사람 기억에 의존하지
않게 한다. CI 게이트는 tests/unit/csp.test.js.

범위
  - 정적 인라인 `<style>` 블록 → style-src
  - 정적 인라인 실행 `<script>` 블록 → script-src
    (src 있는 <script>, application/ld+json 등 비실행 타입은 제외)
  - 인라인 이벤트 핸들러(onclick= 등)·style="" 속성은 다루지 않음(현재 미사용).
  - 'self'·'unsafe-hashes'·도메인 등 비-sha256 토큰은 보존하고 sha256 토큰만 관리.

사용
  python3 scripts/csp_hashes.py            # 검사 (드리프트 있으면 exit 1)
  python3 scripts/csp_hashes.py --fix      # index.html의 CSP 해시를 블록에 맞게 수정
  python3 scripts/csp_hashes.py --check FILE / --fix FILE   # 대상 파일 지정(테스트용)
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_INDEX = ROOT / "index.html"
MANAGED = ("style-src", "script-src")
EXEC_SCRIPT_TYPES = {"", "text/javascript", "module", "application/javascript"}


def sha256_b64(text: str) -> str:
    return "sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode()


def inline_block_hashes(html: str) -> dict[str, list[str]]:
    """Hashes of static inline blocks, per managed directive (document order, deduped)."""
    # Strip HTML comments first — a `<script>`/`<style>` mentioned in comment text
    # is not a real tag (e.g. ADR-019 주석의 "Kept as <script defer> …").
    src = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    styles = [sha256_b64(m.group(1)) for m in re.finditer(r"<style[^>]*>(.*?)</style>", src, re.S)]

    scripts: list[str] = []
    for m in re.finditer(r"<script([^>]*)>(.*?)</script>", src, re.S):
        attrs, body = m.group(1), m.group(2)
        if re.search(r"\bsrc\s*=", attrs):
            continue  # external script — covered by 'self'
        t = re.search(r"""type\s*=\s*["']([^"']*)["']""", attrs)
        if t and t.group(1).strip().lower() not in EXEC_SCRIPT_TYPES:
            continue  # non-executable (e.g. application/ld+json)
        scripts.append(sha256_b64(body))

    return {"style-src": _dedup(styles), "script-src": _dedup(scripts)}


def _dedup(items: list[str]) -> list[str]:
    seen, out = set(), []
    for it in items:
        if it not in seen:
            seen.add(it)
            out.append(it)
    return out


def _csp_content(html: str) -> tuple[str, int, int]:
    """Return (csp_string, start, end) of the CSP meta content attribute value."""
    m = re.search(r'(http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")', html)
    if not m:
        sys.exit("ERROR: CSP <meta http-equiv> not found in index.html")
    return m.group(2), m.start(2), m.end(2)


def _directive_hashes(csp: str, name: str) -> list[str]:
    m = re.search(re.escape(name) + r"([^;]*)", csp)
    if not m:
        return []
    return re.findall(r"sha256-[A-Za-z0-9+/=]+", m.group(1))


def _rewrite_directive(directive: str, want: list[str]) -> str:
    """Rebuild a directive so its sha256 tokens == `want` (keywords/domains kept)."""
    tokens = directive.split()
    name, rest = tokens[0], tokens[1:]
    non_hash = [t for t in rest if not t.startswith("'sha256-")]
    quoted = [f"'{h}'" for h in want]
    if "'self'" in non_hash:  # mimic existing order: self, hashes, then domains
        i = non_hash.index("'self'") + 1
        new_rest = non_hash[:i] + quoted + non_hash[i:]
    else:
        new_rest = quoted + non_hash
    return " ".join([name] + new_rest)


def check(html: str) -> int:
    csp, _, _ = _csp_content(html)
    block = inline_block_hashes(html)
    failed = False
    for name in MANAGED:
        want = block[name]
        have = _directive_hashes(csp, name)
        missing = [h for h in want if h not in have]
        stale = [h for h in have if h not in want]
        if missing:
            failed = True
            print(f"  FAIL {name}: 인라인 블록에 있으나 CSP에 없는 해시: {missing}")
        else:
            print(f"  OK   {name}: 인라인 블록 해시 {len(want)}개 모두 존재")
        if stale:
            print(f"  WARN {name}: 매칭되는 블록이 없는 잉여(stale) 해시: {stale} "
                  f"(--fix로 제거 가능)")
    if failed:
        print("\nCSP 해시가 인라인 블록과 어긋납니다. `python3 scripts/csp_hashes.py --fix`로 고치세요.")
        return 1
    print("\nCSP 인라인 해시 일관성 OK.")
    return 0


def fix(html: str, path: pathlib.Path) -> int:
    csp, start, end = _csp_content(html)
    block = inline_block_hashes(html)
    new_csp = csp
    for name in MANAGED:
        m = re.search(re.escape(name) + r"[^;]*", new_csp)
        if not m:
            continue
        rebuilt = _rewrite_directive(m.group(0), block[name])
        new_csp = new_csp[:m.start()] + rebuilt + new_csp[m.end():]
    if new_csp == csp:
        print("변경 없음 — CSP 해시가 이미 인라인 블록과 일치합니다.")
        return 0
    new_html = html[:start] + new_csp + html[end:]
    path.write_text(new_html, encoding="utf-8")
    print(f"수정 완료: {path}")
    for name in MANAGED:
        print(f"  {name}: {_directive_hashes(new_csp, name)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="index.html CSP 인라인 해시 검사·수정")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="검사만 (기본, 드리프트 시 exit 1)")
    g.add_argument("--fix", action="store_true", help="CSP 해시를 인라인 블록에 맞게 수정")
    ap.add_argument("file", nargs="?", default=str(DEFAULT_INDEX), help="대상 index.html (기본: 저장소 루트)")
    args = ap.parse_args()

    path = pathlib.Path(args.file)
    html = path.read_text(encoding="utf-8")
    print(f"대상: {path}")
    return fix(html, path) if args.fix else check(html)


if __name__ == "__main__":
    raise SystemExit(main())
