"""CSP 점검 — 앱의 주요 화면 · 기능을 실제 브라우저로 돌며 콘텐츠 보안 정책(CSP) 위반을 모은다.

CSP는 index.html의 <meta>로만 준다(서버 헤더 없음 — docs/architecture.md 「보안 모델」). meta로 준 CSP는 위반을
서버에 보고하는 지시어(report-uri · report-to)를 쓸 수 없어, 사용자 브라우저에서 생긴 위반은 알 길이 없다. 그래서
릴리스 전에 이 도구로 한 번 돈다(tools/csp/README.md). 외부 요청(구글 폰트 · 구글 태그)은 막지 않는다 — 구글이
보내는 주소를 바꾸면 connect-src 위반으로 드러난다(2026-10-18 — 애널리틱스가 페이지를 떠날 때 www.google.com/g/collect
로 보내는 요청이 막혀 있던 것을 이 점검으로 찾았다).

신호는 콘솔의 CSP 메시지다 — 페이지를 떠나는 순간의 위반(애널리틱스의 이탈 요청)은 securitypolicyviolation 이벤트를
그 문서에서 읽기 전에 문서가 사라지지만, 콘솔 메시지는 남는다. 이벤트도 함께 모은다(덤).

usage: python3 -I tools/csp/csp_sweep.py [base] [--browser chromium|webkit] [--sw]
  base       기본 http://localhost:8080 (python3 scripts/serve.py 8080 — 저장소 루트에서)
  --browser  기본 chromium. webkit은 Playwright WebKit이 뜨는 환경에서만(coding-pitfalls §34)
  --sw       서비스 워커를 켠다(기본은 막는다 — 헤드리스 Chromium은 설치가 멈춘다, known-issues §6)
종료 코드: 0 위반 없음 · 1 위반 있음 · 2 위반은 없지만 돌지 못한 단계가 있음(점검 범위가 덜 찼다)
"""
import argparse
import json
import re
import sys
import urllib.parse
from collections import defaultdict

from playwright.sync_api import sync_playwright

IPHONE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 "
             "(KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1")

INIT = """(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push({ directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI });
  });
  // 설치 안내 넛지가 화면을 덮지 않게(e2e conftest와 같은 값)
  try { localStorage.setItem('bible-install-nudge', JSON.stringify({ visits: 0, nextShow: 9999, neverShow: true })); } catch (_) {}
})();"""

DIRECTIVE = re.compile(r"\b(default-src|script-src(?:-elem|-attr)?|style-src(?:-elem|-attr)?|img-src|font-src|connect-src|"
                       r"media-src|worker-src|child-src|frame-src|manifest-src|object-src|base-uri|form-action)\b")
URL = re.compile(r"https?://[^\s'\"]+|blob:[^\s'\"]+|data:[^\s'\"]{0,30}")


def violation_key(text):
    """콘솔 메시지 → (지시어, 막힌 곳). 같은 위반이 메시지 둘(「Connecting to …」 · 「Fetch API cannot load …」)로 나와도 하나로."""
    d = DIRECTIVE.search(text)
    directive = d.group(1) if d else ("connect-src" if text.startswith("Fetch API cannot load") else "?")
    u = URL.search(text)
    if u:
        p = urllib.parse.urlparse(u.group(0))
        where = f"{p.scheme}://{p.netloc}{p.path}" if p.netloc else u.group(0)
    else:
        where = text[:80]   # 인라인 스타일 · 스크립트 — 주소가 없다
    return directive, where


def settle(page, ms):
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception:  # noqa: BLE001 — 오래 도는 요청이 있으면 그냥 넘어간다
        pass
    page.wait_for_timeout(ms)


def goto(base, path, ready=None, ms=1500):
    def step(page):
        page.goto(base + path, wait_until="domcontentloaded")
        if ready:
            page.wait_for_selector(ready, timeout=20_000)
        settle(page, ms)
    return step


def click(selector, ready=None, ms=800, optional=False):
    def step(page):
        target = page.locator(selector).first
        if optional and not target.is_visible():
            return "skipped"   # 그 환경에 없는 컨트롤(예: mp3를 못 트는 브라우저의 오디오 바)
        target.click(timeout=10_000)
        if ready:
            page.wait_for_selector(ready, timeout=20_000)
        settle(page, ms)
    return step


def leave(page):
    """페이지를 떠난다 — 애널리틱스가 떠날 때 보내는 요청까지 겪게."""
    page.goto("about:blank")
    page.wait_for_timeout(3000)


def scenarios(base):
    desktop = [
        ("성서 목록 · 구글 태그", goto(base, "/", ".book-list", 6000)),
        ("장", goto(base, "/john/3", "article.chapter-text .verse")),
        ("오디오 재생", click(".audio-play-btn", None, 2500, optional=True)),
        ("인용이 있는 장", goto(base, "/heb/1", "article.chapter-text .verse")),
        ("인용 시트", click(".cite-chip", "#cite-sheet:not([hidden])", 1500)),
        ("검색(워커)", goto(base, "/search?q=%EC%82%AC%EB%9E%91", ".search-results, .search-count", 2500)),
        ("캘린더", goto(base, "/calendar", ".cal-grid")),
        ("캘린더 다음 달", click(".cal-head a.lect-datenav-btn[data-focus-key='next']", ".cal-grid")),
        ("전례독서", goto(base, "/lectionary/2026-10-18", ".lect-reading", 2500)),
        ("전례독서 칩", click(".lect-chip:not(.lect-chip--active)", ".lect-reading", 1500)),
        ("머리말", goto(base, "/sir/prologue", "article", 1000)),
        ("북마크 단추", goto(base, "/john/3", "article.chapter-text .verse")),
        ("북마크 열기", click(".title-bookmark-btn", None, 1200)),
        ("모아 읽기", goto(base, "/read", ".bookmark-read", 1200)),
        ("실패 화면", goto(base, "/calendar/2026-13", ".empty-state-title")),
        ("떠나기", leave),
    ]
    mobile = [
        ("홈", goto(base, "/", ".book-list", 2000)),
        ("설정", goto(base, "/settings", "main", 2000)),
        ("북마크", goto(base, "/bookmarks", "main", 1500)),
        ("검색 탭", goto(base, "/search", "main", 1500)),
        ("캘린더 탭", click("#tab-bar [data-tab='calendar']", ".cal-grid", 1500)),
        ("떠나기", leave),
    ]
    return [("데스크톱", {"viewport": {"width": 1280, "height": 900}}, desktop),
            ("휴대폰", {"viewport": {"width": 390, "height": 844}, "user_agent": IPHONE_UA}, mobile)]


def main():
    ap = argparse.ArgumentParser(description="CSP 위반 점검")
    ap.add_argument("base", nargs="?", default="http://localhost:8080")
    ap.add_argument("--browser", choices=["chromium", "webkit"], default="chromium")
    ap.add_argument("--sw", action="store_true", help="서비스 워커를 켠다")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    violations = defaultdict(list)   # (지시어, 막힌 곳) → [단계 …]
    step_errors, skipped = [], []
    with sync_playwright() as p:
        browser = getattr(p, args.browser).launch()
        for label, opts, steps in scenarios(base):
            ctx = browser.new_context(**opts, **({} if args.sw else {"service_workers": "block"}))
            ctx.add_init_script(INIT)
            page = ctx.new_page()
            current = {"step": "?"}
            page.on("console", lambda m: "Content Security Policy" in m.text
                    and violations[violation_key(m.text)].append(f"{label}:{current['step']}"))
            for name, fn in steps:
                current["step"] = name
                try:
                    if fn(page) == "skipped":
                        skipped.append(f"{label}:{name}")
                except Exception as e:  # noqa: BLE001 — 셀렉터 · 시간 문제는 위반이 아니다, 따로 센다
                    step_errors.append(f"{label}:{name} — {str(e).splitlines()[0][:120]}")
                try:   # 이벤트 쪽(덤) — 콘솔에 안 찍힌 것이 있으면 더한다
                    for ev in page.evaluate("() => (window.__csp || []).splice(0)"):
                        key = (ev.get("directive") or "?", ev.get("blocked") or "?")
                        if key not in violations:
                            violations[key].append(f"{label}:{name} (event)")
                except Exception:  # noqa: BLE001 — about:blank 등
                    pass
            ctx.close()
        browser.close()

    print(f"== CSP 점검 · {args.browser} · 서비스 워커 {'켬' if args.sw else '막음'} · {base}")
    print(f"위반: {len(violations)}종")
    for (directive, where), steps in sorted(violations.items()):
        print(f"  {directive} ✕ {where} — {len(steps)}번 ({', '.join(sorted(set(steps)))[:160]})")
    if skipped:
        print(f"건너뛴 단계(그 환경에 없는 컨트롤): {', '.join(skipped)}")
    if step_errors:
        print(f"돌지 못한 단계 {len(step_errors)} — 위반은 아니지만 점검 범위가 덜 찼다:")
        for e in step_errors:
            print("  ", e)
    sys.exit(1 if violations else 2 if step_errors else 0)


if __name__ == "__main__":
    main()
