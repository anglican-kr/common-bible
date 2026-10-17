"""E2E: 캘린더 · 전례독서 모듈의 지연 로드 (ADR-038 §2 「구현」 · known-issues §6 — 2026-10-17).

교회력 엔진 · 전례독서 뷰 · 캘린더(js/app/liturgical-engine.js · lectionary.js · calendar.js)는 index.html에
태그가 없고, routing.js가 /calendar · /lectionary에 처음 갈 때 import()로 불러온다. 유닛(tests/unit/sw.test.js)은
부팅 그래프에 셋이 없다는 것과 오프라인용 목록에 있다는 것만 본다 — 요청이 실제로 언제 나가는지, 받지 못했을 때
어떤 화면이 되는지는 여기서 본다.

  ① 성서 화면(성서 목록 · 장 · 장 사이 이동)에서는 셋을 요청하지 않는다
  ② 캘린더 탭은 셋을, 전례독서는 엔진과 뷰 둘을(캘린더 없이) 받는다 — 화면을 옮겨도 다시 받지 않는다
  ③ 모듈을 받지 못하면 그 뷰의 제목과 「다시 불러오기」(DESIGN.md §6 「전체 화면 실패」) — 누르면 새로 고쳐 열린다
  ④ 늦게 끝난 실패는 그사이 연 화면을 덮지 않는다(route()의 isStale 가드)

서비스 워커는 막는다 — 설치가 SHELL_FILES(셋 포함)를 미리 받아 요청 기록을 흐리고, page.route는 서비스 워커가
처리한 요청을 가로채지 못한다. 실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「E2E 테스트」).
"""
import urllib.parse

from .conftest import CLEAR_APP_STORAGE, IPHONE_UA, MOBILE_VIEWPORT

BASE = "http://localhost:8080"
ENGINE = "/js/app/liturgical-engine.js"
LECTIONARY = "/js/app/lectionary.js"
CALENDAR = "/js/app/calendar.js"
LAZY = (ENGINE, LECTIONARY, CALENDAR)


def _context(browser, mobile=False):
    opts = {"service_workers": "block"}
    if mobile:
        opts.update(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx = browser.new_context(**opts)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    return ctx


def _record_lazy_requests(page):
    """지연 모듈 셋 가운데 페이지가 요청한 것의 경로를 차례로 모은다."""
    seen = []

    def on_request(request):
        path = urllib.parse.urlparse(request.url).path
        if path in LAZY:
            seen.append(path)

    page.on("request", on_request)
    return seen


def _calendar_tab(page):
    return page.locator("#tab-bar [data-tab='calendar']")


# ── ① 성서 화면 ──

def test_bible_screens_do_not_request_liturgical_modules(browser):
    """성서 목록 · 장 · 장 사이 이동에서는 엔진 · 전례독서 · 캘린더를 요청하지 않는다(main은 어느 화면에서나 셋을 받았다)."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        seen = _record_lazy_requests(page)
        page.goto(BASE)
        page.wait_for_selector(".book-list", timeout=20_000)
        page.goto(f"{BASE}/john/3")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        page.evaluate("() => window.navigate('/john/4')")
        page.wait_for_function(
            "() => location.pathname === '/john/4' && !!document.querySelector('article.chapter-text .verse')")
        page.wait_for_load_state("networkidle")
        assert seen == [], seen
    finally:
        ctx.close()


# ── ② 캘린더 · 전례독서 ──

def test_calendar_tab_loads_the_three_modules_once(browser):
    """캘린더 탭을 처음 누르면 셋을 한 번씩 받는다 — 달을 넘기거나 전례독서로 가도 다시 받지 않는다."""
    ctx = _context(browser, mobile=True)
    page = ctx.new_page()
    try:
        seen = _record_lazy_requests(page)
        page.goto(BASE)
        page.wait_for_selector(".book-list", timeout=20_000)
        assert seen == []
        _calendar_tab(page).click()
        page.wait_for_selector(".cal-grid", timeout=20_000)
        assert sorted(seen) == sorted(LAZY), seen
        month = page.inner_text(".cal-month")
        page.locator(".cal-head a.lect-datenav-btn[data-focus-key='next']").click()
        page.wait_for_function("m => document.querySelector('.cal-month')?.textContent !== m", arg=month)
        page.evaluate("() => window.navigate('/lectionary/2026-10-18')")
        page.wait_for_selector(".lect-reading", timeout=20_000)
        page.wait_for_load_state("networkidle")
        assert sorted(seen) == sorted(LAZY), seen
    finally:
        ctx.close()


def test_lectionary_loads_engine_and_view_without_calendar(browser):
    """전례독서로 바로 열면 엔진과 뷰 둘만 받는다 — 캘린더 모듈은 그 화면에 필요 없다."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        seen = _record_lazy_requests(page)
        page.goto(f"{BASE}/lectionary/2026-10-18")
        page.wait_for_selector(".lect-reading", timeout=20_000)
        page.wait_for_load_state("networkidle")
        assert sorted(seen) == sorted([ENGINE, LECTIONARY]), seen
    finally:
        ctx.close()


# ── ③ 받지 못했을 때 ──

def test_calendar_module_failure_shows_reload_that_recovers(browser):
    """calendar.js를 받지 못하면(오프라인 · 캐시 없음) 캘린더의 실패 화면 — 앞 화면(요한 3장)의 제목 · 오디오 바가 남지 않고,
    「다시 불러오기」를 누르면 페이지를 새로 고쳐 캘린더가 열린다(사용자 결정 2026-10-17 — 브라우저는 실패한 모듈을 새로 고칠
    때까지 기억하므로 화면을 다시 여는 것만으로는 풀리지 않을 수 있다)."""
    ctx = _context(browser, mobile=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{BASE}/john/3")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        page.route(f"**{CALENDAR}", lambda route: route.abort())
        _calendar_tab(page).click()
        page.wait_for_selector(".calendar .empty-state-title", timeout=20_000)
        assert page.inner_text(".empty-state-title") == "교회력 자료를 불러오지 못했습니다"
        assert page.inner_text(".empty-state-subtitle") == "네트워크 연결을 확인한 뒤 「다시 불러오기」를 눌러 주세요."
        assert page.evaluate("() => document.getElementById('page-title').textContent") == "캘린더"
        assert page.evaluate("() => document.title").startswith("캘린더")
        page.wait_for_function("() => document.getElementById('audio-bar').hidden === true")
        assert page.locator(".error").count() == 0
        button = page.locator(".state-action button")
        assert button.inner_text() == "다시 불러오기"
        assert button.bounding_box()["height"] >= 44
        page.unroute(f"**{CALENDAR}")
        button.click()
        page.wait_for_selector(".cal-grid", timeout=20_000)
        assert page.url == f"{BASE}/calendar"
        assert page.evaluate("() => performance.getEntriesByType('navigation')[0].type") == "reload"
        assert errors == [], errors
    finally:
        ctx.close()


def test_lectionary_module_failure_shows_its_own_title(browser):
    """엔진(liturgical-engine.js)을 받지 못하면 그것을 import하는 전례독서 모듈도 이어지지 못한다 — 전례독서의 제목 ·
    실패 화면이고, 앞 화면을 남기는 공용 오류(.error)가 아니다."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        page.route(f"**{ENGINE}", lambda route: route.abort())
        page.goto(f"{BASE}/lectionary/2026-10-18")
        page.wait_for_selector(".lectionary .empty-state-title", timeout=20_000)
        assert page.inner_text(".empty-state-title") == "전례독서 자료를 불러오지 못했습니다"
        assert page.evaluate("() => document.title").startswith("전례독서")
        assert page.locator(".state-action button").inner_text() == "다시 불러오기"
        assert page.locator(".error").count() == 0
    finally:
        ctx.close()


# ── ④ 늦게 끝난 실패 ──

def test_late_module_failure_does_not_paint_over_newer_screen(browser):
    """calendar.js 요청이 걸려 있는 사이 다른 화면(요한 3장)으로 가면, 늦게 끝난 실패는 그 화면을 덮지 않는다."""
    ctx = _context(browser, mobile=True)
    page = ctx.new_page()
    held = []
    try:
        page.goto(BASE)
        page.wait_for_selector(".book-list", timeout=20_000)
        page.route(f"**{CALENDAR}", lambda route: held.append(route))
        _calendar_tab(page).click()
        for _ in range(100):
            if held:
                break
            page.wait_for_timeout(50)
        assert held, "calendar.js 요청이 나가지 않았다"
        page.evaluate("() => window.navigate('/john/3')")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        held[0].abort()
        page.wait_for_timeout(500)
        assert page.locator(".empty-state").count() == 0
        assert urllib.parse.urlparse(page.url).path == "/john/3"
        assert "요한" in page.evaluate("() => document.title")
    finally:
        ctx.close()
