"""E2E: 캘린더 · 전례독서 모듈의 지연 로드 (ADR-038 §2 「구현」 · known-issues §6 — 2026-10-17).

교회력 엔진 · 전례독서 뷰 · 캘린더(js/app/liturgical-engine.js · lectionary.js · calendar.js)는 index.html에
태그가 없고, routing.js가 /calendar · /lectionary에 처음 갈 때 import()로 불러온다(그 주소로 바로 들어와도 같다 —
미리 받기는 WebKit에서 실패한 미리 받기가 그 탭을 막아 되돌렸다, ADR-038 「검토한 대안 — 모듈 로드」 E). 유닛
(tests/unit/sw.test.js)은 부팅 그래프 · 오프라인 목록 · 한꺼번에 묶음의 글자만 본다 — 요청이 실제로 언제 나가는지,
받지 못했을 때 어떤 화면이 되는지는 여기서 본다.

  ① 성서 화면(성서 목록 · 장 · 장 사이 이동)에서는 셋을 요청하지 않는다
  ② 캘린더 탭은 셋을, 전례독서는 엔진과 뷰 둘을(캘린더 없이) 받는다 — 화면을 옮겨도 다시 받지 않고, 다시 그릴 때
     「불러오는 중…」을 한 프레임도 그리지 않는다
  ③ 모듈을 받지 못하거나 그리다 던지면 그 뷰의 제목 · 머리와 「다시 불러오기」(DESIGN.md §6 「전체 화면 실패」) —
     누르면 새로 고쳐 열린다
  ④ 늦게 끝난 실패 · 늦게 도착한 모듈 · 늦게 던진 오류는 그사이 연 화면을 덮지 않는다(route()의 isStale 가드 —
     openLazyView의 받은 뒤 · catch, 공용 catch까지)

서비스 워커는 막는다 — 설치가 SHELL_FILES(셋 포함)를 미리 받아 요청 기록을 흐리고, page.route는 서비스 워커가
처리한 요청을 가로채지 못한다(conftest의 공용 컨텍스트는 막지 않아 따로 둔다). 실데이터(data/ 서브모듈)가 필요하다 —
로컬 전용(CLAUDE.md 「E2E 테스트」).
"""
import urllib.parse
import urllib.request

from .conftest import CLEAR_APP_STORAGE, IPHONE_UA, MOBILE_VIEWPORT

BASE = "http://localhost:8080"
ENGINE = "/js/app/liturgical-engine.js"
LECTIONARY = "/js/app/lectionary.js"
CALENDAR = "/js/app/calendar.js"
LAZY = (ENGINE, LECTIONARY, CALENDAR)

# 프레임마다(rAF — 그리기 직전) #app에 「불러오는 중…」(.loading)이 있는지 센다. 있었으면 그 프레임에 그려졌다.
WATCH_LOADING_FRAMES = """() => {
  window.__loadingFrames = 0;
  const tick = () => {
    if (document.querySelector('#app .loading')) window.__loadingFrames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""
TWO_FRAMES = "() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))"


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


def _wait_held(page, held, what):
    """page.route로 붙잡은 요청이 나올 때까지 기다린다."""
    for _ in range(100):
        if held:
            return
        page.wait_for_timeout(50)
    raise AssertionError(f"{what} 요청이 나가지 않았다")


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
        # 새 달 이름이 그려질 때까지 — 누르자마자 「불러오는 중…」이 .cal-month를 지워 「다르다」만으로는 바로 참이다
        page.wait_for_function(
            "m => { const t = document.querySelector('.cal-month')?.textContent; return !!t && t !== m; }", arg=month)
        page.evaluate("() => window.navigate('/lectionary/2026-10-18')")
        page.wait_for_selector(".lect-reading", timeout=20_000)
        page.wait_for_load_state("networkidle")
        assert sorted(seen) == sorted(LAZY), seen
    finally:
        ctx.close()


def test_redraw_does_not_paint_loading_frame(browser):
    """모듈을 받은 뒤의 다시 그리기(캘린더의 달 이동 · 장을 이미 받은 전례독서의 날짜 이동)는 「불러오는 중…」을 한 프레임도
    그리지 않는다. 이미 받은 모듈도 import()는 한 태스크 뒤에 풀려, 그 사이 라우터의 「불러오는 중…」이 매번 한 프레임
    그려졌다(PR #355 리뷰 — 달 이동 40번 중 40번, main 0번). 라우터가 받은 모듈을 기억해 바로 그린다(routing.js loadedViews)."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/calendar/2026-01")
        page.wait_for_selector(".cal-grid", timeout=20_000)
        page.evaluate(WATCH_LOADING_FRAMES)
        for _ in range(5):
            month = page.inner_text(".cal-month")
            page.locator(".cal-head a.lect-datenav-btn[data-focus-key='next']").click()
            page.wait_for_function(
                "m => { const t = document.querySelector('.cal-month')?.textContent; return !!t && t !== m; }", arg=month)
        page.evaluate(TWO_FRAMES)
        assert page.evaluate("() => window.__loadingFrames") == 0

        # 전례독서 — 다음날(새 장을 받는다 — main도 「불러오는 중…」이 보인다)에 갔다가 장을 이미 받은 그날로 돌아온다
        page.goto(f"{BASE}/lectionary/2026-10-18")
        page.wait_for_selector(".lect-reading", timeout=20_000)
        page.locator(".lect-datenav-btn[data-focus-key='next']").click()
        page.wait_for_function(
            "() => location.pathname === '/lectionary/2026-10-19' && !!document.querySelector('.lect-reading')",
            timeout=20_000)
        page.evaluate(WATCH_LOADING_FRAMES)
        page.locator(".lect-datenav-btn[data-focus-key='prev']").click()
        page.wait_for_function(
            "() => location.pathname === '/lectionary/2026-10-18' && !!document.querySelector('.lect-reading')")
        page.evaluate(TWO_FRAMES)
        assert page.evaluate("() => window.__loadingFrames") == 0
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


# ── ③ 받지 못했을 때 · 그리다 던질 때 ──

def test_calendar_module_failure_shows_reload_that_recovers(browser):
    """calendar.js를 받지 못하면(오프라인 · 캐시 없음) 캘린더의 실패 화면 — 앞 화면(요한 3장)의 제목 · 오디오 바가 남지 않고,
    라이브 영역은 제목과 안 된 것을 함께 읽는다(제목만이면 성공한 화면과 귀로 구별되지 않는다 — PR #355 리뷰). 「다시 불러오기」를
    누르면 페이지를 새로 고쳐 캘린더가 열린다(사용자 결정 2026-10-17 — 브라우저는 실패한 모듈을 새로 고칠 때까지 기억하므로
    화면을 다시 여는 것만으로는 풀리지 않을 수 있다)."""
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
        page.wait_for_function(
            "() => document.getElementById('a11y-announce').textContent === '캘린더 — 교회력 자료를 불러오지 못했습니다'")
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


def test_lectionary_module_failure_shows_its_own_title_and_up_link(browser):
    """엔진(liturgical-engine.js)을 받지 못하면 그것을 import하는 전례독서 모듈도 이어지지 못한다 — 전례독서의 제목 · 실패
    화면이고(앞 화면을 남기는 공용 오류 .error가 아니다), 머리에는 휴대폰에서도 보이는 「캘린더로」 꺾쇠가 있다 — 전례독서의
    다른 실패 화면과 같다(ADR-038 §2 「구현」; 그전엔 휴대폰에서 숨는 집 단추라 머리에 누를 것이 없었다 — PR #355 리뷰)."""
    ctx = _context(browser, mobile=True)
    page = ctx.new_page()
    try:
        page.route(f"**{ENGINE}", lambda route: route.abort())
        page.goto(f"{BASE}/lectionary/2026-10-18")
        page.wait_for_selector(".lectionary .empty-state-title", timeout=20_000)
        assert page.inner_text(".empty-state-title") == "전례독서 자료를 불러오지 못했습니다"
        assert page.evaluate("() => document.title").startswith("전례독서")
        assert page.locator(".state-action button").inner_text() == "다시 불러오기"
        assert page.locator(".error").count() == 0
        up = page.locator("#page-title .title-back-btn")
        assert up.get_attribute("aria-label") == "캘린더로"
        assert up.get_attribute("href") == "/calendar"
        box = up.bounding_box()
        assert box and box["width"] >= 44 and box["height"] >= 44, box
        assert page.locator("#page-title .title-home-btn").count() == 0
    finally:
        ctx.close()


def test_view_that_throws_while_rendering_shows_its_failure_screen(browser):
    """모듈은 받았는데 그리다 던지면(버그, 또는 배포 사이의 어긋남 — 새 모듈이 이미 실린 옛 도우미와 이어진다) 공용 오류 한
    줄이 아니라 그 뷰의 실패 화면이다 — 앞 화면(창세기 1장)의 머리 · 오디오 바가 남지 않고 「다시 불러오기」가 있다. 새로 고치면
    어긋남이 풀린다(PR #355 리뷰 — 그전엔 「데이터를 불러올 수 없습니다.」 한 줄 위에 「창세기 1장」 머리가 남았다)."""
    original = urllib.request.urlopen(f"{BASE}{LECTIONARY}").read().decode("utf-8")
    target = "async function renderLectionaryView(parsed) {"
    assert target in original, "lectionary.js에서 renderLectionaryView 머리를 찾지 못했다 — 테스트를 고칠 것"
    broken = original.replace(target, target + ' throw new TypeError("다음 판의 모듈과 이어지지 않는다");', 1)
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        page.route(f"**{LECTIONARY}",
                   lambda route: route.fulfill(status=200, content_type="text/javascript; charset=utf-8", body=broken))
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        page.evaluate("() => window.navigate('/lectionary/2026-10-18')")
        page.wait_for_selector(".lectionary .empty-state-title", timeout=20_000)
        assert page.inner_text(".empty-state-title") == "전례독서 자료를 불러오지 못했습니다"
        assert page.evaluate("() => document.getElementById('page-title').textContent") == "전례독서"
        assert page.locator("#page-title .title-back-btn").count() == 1
        assert page.locator(".state-action button").inner_text() == "다시 불러오기"
        assert page.locator(".error").count() == 0
        page.wait_for_function("() => document.getElementById('audio-bar').hidden === true")
    finally:
        ctx.close()


# ── ④ 늦게 끝난 실패 · 늦게 도착한 모듈 ──

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
        _wait_held(page, held, "calendar.js")
        page.evaluate("() => window.navigate('/john/3')")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        # 라우터가 실패를 받았다는 신호(loadViewModule의 console.error)를 기다린 뒤 본다 — 고정 시간이 아니라
        with page.expect_console_message(lambda m: m.type == "error" and "dynamically imported module" in m.text):
            held[0].abort()
        page.evaluate(TWO_FRAMES)
        assert page.locator(".empty-state").count() == 0
        assert urllib.parse.urlparse(page.url).path == "/john/3"
        assert "요한" in page.evaluate("() => document.title")
    finally:
        ctx.close()


def test_late_module_arrival_does_not_paint_over_newer_screen(browser):
    """lectionary.js 요청이 걸려 있는 사이 다른 화면(요한 4장)으로 가면, 늦게 도착한 모듈은 그 화면을 덮지 않는다 — 받은 뒤의
    isStale 가드(routing.js openLazyView). 전례독서 분기의 이 가드를 덮는 테스트가 없었다(PR #355 리뷰)."""
    ctx = _context(browser)
    page = ctx.new_page()
    held = []
    data_requests = []
    try:
        page.goto(f"{BASE}/john/3")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        page.route(f"**{LECTIONARY}", lambda route: held.append(route))
        page.evaluate("() => window.navigate('/lectionary/2026-10-18')")
        _wait_held(page, held, "lectionary.js")
        page.evaluate("() => window.navigate('/john/4')")
        page.wait_for_function(
            "() => location.pathname === '/john/4' && !!document.querySelector('article.chapter-text .verse')")
        # 낡은 route가 뷰를 그리기 시작하면 곧바로 교회력 자료를 요청한다 — 그 화면은 자료(1.6MB)를 받은 뒤에야 그려져
        # 화면만 보면 가드가 없어도 늦게 드러난다. 요청이 하나도 나가지 않았는지를 본다.
        page.on("request", lambda r: "/data/lectionary/" in r.url and data_requests.append(r.url))
        held[0].continue_()
        # 같은 모듈 맵 항목을 기다린다 — 모듈이 받아져 평가되면 라우터의 import()도 함께 풀린다
        page.evaluate(f"async () => {{ await import('{LECTIONARY}'); }}")
        page.evaluate(TWO_FRAMES)
        assert data_requests == [], data_requests
        assert urllib.parse.urlparse(page.url).path == "/john/4"
        assert page.locator(".lectionary").count() == 0
        assert page.locator("article.chapter-text .verse").count() > 0
        assert "요한" in page.evaluate("() => document.title")
    finally:
        ctx.close()


def test_late_render_error_does_not_paint_over_newer_screen(browser):
    """전례독서 뷰가 그리는 사이 다른 화면(요한 4장)으로 가고 그 뒤 뷰가 던져도, 늦은 오류는 그 화면을 덮지 않는다 —
    routing.js openLazyView의 catch 가드(PR #355 2회차 리뷰 — 덮는 테스트가 없었다). 그린 뒤의 가드는
    test_lectionary_view.py의 낡은 프리로드 실패 테스트가 본다(탭 제목이 바뀌지 않는다)."""
    original = urllib.request.urlopen(f"{BASE}{LECTIONARY}").read().decode("utf-8")
    target = "async function renderLectionaryView(parsed) {"
    assert target in original, "lectionary.js에서 renderLectionaryView 머리를 찾지 못했다 — 테스트를 고칠 것"
    # 그리기를 문 앞에 세워 두었다가, 테스트가 문을 열면 던진다 — 시간이 아니라 신호로 순서를 정한다
    gated = original.replace(target, target + ' window.__renderStarted = true; await window.__renderGate;'
                             ' throw new TypeError("늦게 던진다");', 1)
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        page.route(f"**{LECTIONARY}",
                   lambda route: route.fulfill(status=200, content_type="text/javascript; charset=utf-8", body=gated))
        page.goto(f"{BASE}/john/3")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        page.evaluate("() => { window.__renderGate = new Promise((r) => { window.__openRenderGate = r; }); }")
        page.evaluate("() => window.navigate('/lectionary/2026-10-18')")
        page.wait_for_function("() => window.__renderStarted === true", timeout=20_000)
        page.evaluate("() => window.navigate('/john/4')")
        page.wait_for_function(
            "() => location.pathname === '/john/4' && !!document.querySelector('article.chapter-text .verse')")
        with page.expect_console_message(lambda m: m.type == "error" and "늦게 던진다" in m.text):
            page.evaluate("() => window.__openRenderGate()")
        page.evaluate(TWO_FRAMES)
        assert page.locator(".lectionary").count() == 0
        assert page.locator(".empty-state").count() == 0
        assert "요한" in page.evaluate("() => document.title")
    finally:
        ctx.close()


def test_late_chapter_failure_does_not_paint_over_calendar(browser):
    """요한 4장을 받는 사이 캘린더로 가고 그 뒤 장 받기가 실패해도 캘린더는 그대로다 — route()의 공용 catch도 낡은 실패를
    버린다(PR #355 리뷰 — main부터: 주소 · 머리는 「캘린더」인데 표가 「데이터를 불러올 수 없습니다.」로 바뀌었다)."""
    ctx = _context(browser, mobile=True)
    page = ctx.new_page()
    held = []
    try:
        page.goto(f"{BASE}/john/3")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        page.route("**/data/bible/john-4.json", lambda route: held.append(route))
        page.evaluate("() => window.navigate('/john/4')")
        _wait_held(page, held, "john-4.json")
        _calendar_tab(page).click()
        page.wait_for_selector(".cal-grid", timeout=20_000)
        # 낡은 route()가 실패를 받았다는 신호(공용 catch의 console.error — fetch의 TypeError)
        with page.expect_console_message(lambda m: m.type == "error" and "Failed to fetch" in m.text):
            held[0].abort()
        page.evaluate(TWO_FRAMES)
        assert page.locator(".cal-grid").count() == 1
        assert page.locator(".error").count() == 0
        assert urllib.parse.urlparse(page.url).path == "/calendar"
    finally:
        ctx.close()
