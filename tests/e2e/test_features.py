"""E2E: core app features — resume banner, bookmarks."""

import json

import pytest

from .conftest import CLEAR_APP_STORAGE, IPHONE_UA, emulate_side_safe_areas, emulate_status_bar

BASE = "http://localhost:8080"


def test_resume_banner_appears_after_last_read_set(browser):
    """Storing a last-read position in localStorage shows the resume banner on reload."""
    ctx = browser.new_context()
    page = ctx.new_page()

    page.goto(BASE)
    page.wait_for_selector("#app")

    page.evaluate("""() => {
        localStorage.setItem('bible-last-read', JSON.stringify({bookId: 'gen', chapter: 1}));
        localStorage.setItem('bible-startup', 'home');
    }""")
    page.reload()

    page.wait_for_selector(".resume-banner")
    text = page.inner_text(".resume-banner-link")
    assert text.strip(), "resume banner link text must not be empty"

    ctx.close()


# ── 읽던 절: 저장과 되돌아가기 ──────────────────────────────────────────────
# 저장은 상단 바 아래쪽에서 20px 아래의 선보다 위에서 시작한 마지막 절이다(routing.js). 되돌아가면 그 절의 위쪽을 상단 바 바로 아래에 둔다
# (helpers.js `scrollUnderBar`). 상단 바 높이는 그때 잰다(`barBottom`). 요한 3장은 절마다 새 줄에서 시작한다.

# 저장소를 비우지 않는다(CLEAR_APP_STORAGE는 문서를 열 때마다 읽던 위치를 지운다). 설치 안내만 막는다.
NO_INSTALL_NUDGE = "try { localStorage.setItem('bible-install-nudge', JSON.stringify({ visits: 0, nextShow: 9999, neverShow: true })); } catch (_) {}"

# 휴대폰, 상태 표시줄 높이 62px의 휴대폰(Chromium에서 아이폰 홈 화면 앱이 상태 표시줄 밑까지 그리는 상태를 시뮬레이션한다), 데스크톱
READERS = pytest.mark.parametrize("width, inset", [(390, 0), (390, 62), (1280, 0)], ids=["phone", "phone-status-bar", "desktop"])


def _reader(browser, width, inset, startup=None):
    ctx = browser.new_context(viewport={"width": width, "height": 800}, user_agent=IPHONE_UA if width < 700 else None)
    ctx.add_init_script(NO_INSTALL_NUDGE)
    if startup:
        ctx.add_init_script(f"localStorage.setItem('bible-startup', '{startup}');")
    page = ctx.new_page()
    if inset:
        emulate_status_bar(page, inset)
    return ctx, page


def _gap_under_bar(page, verse):
    """그 절의 첫 줄 위쪽과 상단 바 아래쪽의 거리."""
    return page.evaluate("""n => document.querySelector(`.verse[data-vref="${n}"]`).getBoundingClientRect().top
        - document.getElementById('sticky-group').getBoundingClientRect().bottom""", verse)


def _saved_verse(page):
    return page.evaluate("() => JSON.parse(localStorage.getItem('bible-last-read')).verse")


def _read_up_to(page, verse, width):
    """그 절의 첫 줄을 상단 바 아래쪽에서 5px 아래에 두고 저장을 기다린다. 데스크톱의 상단 바도 스크롤해도 높이가 같다(ADR-043 §1)."""
    page.goto(f"{BASE}/john/3")
    page.wait_for_selector(f".verse[data-vref='{verse}']")
    page.evaluate("""n => {
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        window.scrollBy({ top: document.querySelector(`.verse[data-vref="${n}"]`).getBoundingClientRect().top - bar - 5, behavior: 'instant' });
    }""", verse)
    page.wait_for_timeout(900)   # 스크롤이 멈추고 0.5초 뒤에 저장한다


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("inset", [0, 62])
def test_reading_position_is_the_verse_starting_just_under_the_top_bar(mobile_context, inset):
    """스크롤을 멈추면 상단 바 바로 아래에서 시작하는 절을 읽던 절로 저장한다. 상태 표시줄 높이가 62px이면 상단 바 아래쪽이 약 122px이다.
    화면 위에서 80px로 적었을 때는 이 절이 아니라 상단 바 밑에서 시작한 앞 절을 저장했다. 높이가 0이면 전과 같다."""
    page = mobile_context.new_page()
    emulate_status_bar(page, inset)
    for verse in (5, 12):
        _read_up_to(page, verse, 390)
        assert page.evaluate("() => document.getElementById('sticky-group').getBoundingClientRect().bottom") > inset + 50
        assert _saved_verse(page) == verse, (inset, _gap_under_bar(page, verse))


@pytest.mark.only_browser("chromium")
@READERS
def test_reopening_puts_the_saved_verse_right_under_the_top_bar(browser, width, inset):
    """읽던 절을 저장한 뒤 앱을 다시 열면(시작 화면 기본값 「읽던 페이지에서 시작」) 그 절의 위쪽이 상단 바 바로 아래에 오고, 가만히 두어도 저장된
    절이 그대로다. 화면 맨 위에 두던 때는 그 절이 상단 바 밑에 가려지고 가려진 만큼 뒤의 절이 저장되었다(12절을 저장하고 다시 열면 휴대폰은 13절,
    데스크톱은 14절)."""
    ctx, page = _reader(browser, width, inset)
    try:
        _read_up_to(page, 12, width)
        assert _saved_verse(page) == 12
        page.goto(f"{BASE}/")   # 다시 연다 — 읽던 장으로 간다
        page.wait_for_url(f"{BASE}/john/3?resume=1")
        page.wait_for_timeout(1500)   # 저장은 스크롤이 멈추고 0.5초 뒤다
        assert abs(_gap_under_bar(page, 12)) <= 2
        assert _saved_verse(page) == 12
    finally:
        ctx.close()


def test_resume_banner_on_desktop_puts_the_verse_under_the_bar(browser):
    """데스크톱에서 이어 읽기 배너를 누르면 그 절이 상단 바 바로 아래에 오고, 가만히 두어도 저장된 절이 그대로다. 성서 목록의 상단 바는 배너와
    구분 탭만큼 높고 장 화면의 상단 바는 한 줄이라, 새 화면의 높이로 맞춘다."""
    ctx, page = _reader(browser, 1280, 0, startup="home")
    try:
        _read_up_to(page, 12, 1280)
        page.goto(f"{BASE}/")
        page.wait_for_selector(".resume-banner-link")
        page.click(".resume-banner-link")
        page.wait_for_url(f"{BASE}/john/3?resume=1")
        page.wait_for_timeout(1500)
        assert abs(_gap_under_bar(page, 12)) <= 2
        assert _saved_verse(page) == 12
    finally:
        ctx.close()


def test_resume_on_desktop_leaves_the_scroll_alone_once_the_reader_scrolls(browser):
    """돌아온 뒤 독자가 스크롤하면 그 자리에 둔다 — 절을 다시 맞추지 않는다."""
    ctx, page = _reader(browser, 1280, 0, startup="home")
    try:
        _read_up_to(page, 12, 1280)
        page.goto(f"{BASE}/")
        page.wait_for_selector(".resume-banner-link")
        page.wait_for_timeout(1000)
        page.mouse.move(640, 400)
        page.click(".resume-banner-link")
        page.wait_for_url(f"{BASE}/john/3?resume=1")
        page.mouse.wheel(0, 400)
        page.wait_for_timeout(1200)
        assert _gap_under_bar(page, 12) < -200
    finally:
        ctx.close()


# ── 작은 화면의 이어 읽기 알약(ADR-030 「적용 확장」) ──────────────────────────────────────────────
# 작은 화면에서 이어 읽기 배너는 화면 아래의 알약이다. 세로에서는 탭 바와 검색 원형의 줄(독 줄) 바로 위의 따로 된 줄에 있고 양 끝이 독 줄과
# 같다(2026-11-28). 세로의 탭 넷과 검색 원형 사이는 390px에서 40px, 320px에서 8px뿐이다. 가로에서는 독 줄의 탭 바와 검색 원형 사이에 있다.
# 큰 화면은 헤더 아래의 띠 그대로다.

PHONE_SE = {"width": 320, "height": 568}
PHONE = {"width": 390, "height": 844}
PHONE_LANDSCAPE = {"width": 844, "height": 390}


def _pill_page(browser, viewport, font=18, book="gen", chapter=3, touch=True, home_bar=0):
    """읽던 자리를 넣고 시작 화면을 성서 목록으로 둔 화면. `home_bar`는 아래 안전 영역(홈 표시줄)의 높이다."""
    opts = {"is_mobile": True, "has_touch": True, "user_agent": IPHONE_UA} if touch else {}
    ctx = browser.new_context(viewport=viewport, **opts)
    last = json.dumps({"bookId": book, "chapter": chapter})
    # One script: the wipe must run before the values are set (conftest CLEAR_APP_STORAGE).
    ctx.add_init_script(CLEAR_APP_STORAGE + f"""try {{
        localStorage.setItem('bible-font-size', '{font}');
        localStorage.setItem('bible-startup', 'home');
        localStorage.setItem('bible-last-read', {json.dumps(last)});
    }} catch (_) {{}}""")
    page = ctx.new_page()
    if home_bar:
        emulate_side_safe_areas(page, 0, 0, bottom=home_bar)
    return ctx, page


def _open_list(page, path="/"):
    page.goto(f"{BASE}{path}")
    page.wait_for_selector(".resume-banner")
    page.wait_for_selector("#launch-screen", state="detached", timeout=5_000)


def _rect(page, sel):
    return page.evaluate("""s => { const r = document.querySelector(s).getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }""", sel)


def _receives_taps(page, sel):
    """그 요소의 가운데를 누르면 그 요소가 받는가(위에 다른 요소가 덮고 있지 않은가)."""
    return page.evaluate("""s => [...document.querySelectorAll(s)].every((e) => {
        const r = e.getBoundingClientRect(), t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!t && (t === e || e.contains(t));
    })""", sel)


def _label_lines(page):
    """알약 글이 차지한 줄 수(보이는 쪽 이름)."""
    return page.evaluate("""() => {
        const link = document.querySelector('.resume-banner-link');
        const shown = [...link.querySelectorAll('span')].find((s) => getComputedStyle(s).display !== 'none') || link;
        const range = document.createRange();
        range.selectNodeContents(shown);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    }""")


DOCK_CONTROLS = "#tab-bar .tab-item:not([hidden]), #tab-search"


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("viewport, font, home_bar, book, chapter", [
    (PHONE_SE, 18, 0, "gen", 3),
    (PHONE, 18, 34, "gen", 3),
    (PHONE, 24, 34, "1john", 3),
    (PHONE_SE, 24, 0, "cant", 4),   # 「이어읽기: 이사야 첫째 송가」가 들어가지 않아 한 줄에서 말줄임표로 끊는다
], ids=["320px", "390px-home-bar", "390px-24px", "320px-24px-long"])
def test_portrait_resume_pill_floats_above_the_dock_row(browser, viewport, font, home_bar, book, chapter):
    """세로의 이어 읽기 알약은 탭 바와 검색 원형의 줄 바로 위, 8px(`--space-2`) 위에 있고, 양 끝이 첫 탭의 왼쪽 끝과 검색 원형의 오른쪽 끝이다.
    높이는 독의 단추와 같은 60px이고 글은 한 줄이다. 상단 바 묶음에는 띠가 남지 않는다. 아래 안전 영역이 있어도 독과 함께 비킨다.
    그전에는 세로에서 상단 바 아래의 띠였다."""
    ctx, page = _pill_page(browser, viewport, font=font, book=book, chapter=chapter, home_bar=home_bar)
    try:
        _open_list(page)
        pill, tab, search = _rect(page, ".resume-banner"), _rect(page, "#tab-bar"), _rect(page, "#tab-search")
        assert abs(pill["height"] - 60) < 1, pill
        assert abs(pill["left"] - tab["left"]) < 1 and abs(pill["right"] - search["right"]) < 1, (pill, tab, search)
        assert abs(tab["top"] - pill["bottom"] - 8) < 1 and abs(search["top"] - pill["bottom"] - 8) < 1, (pill, tab, search)
        assert abs(viewport["height"] - tab["bottom"] - (4 + home_bar * 0.75)) < 1, tab   # 독은 그대로다
        assert _rect(page, "#resume-banner-slot")["height"] == 0
        assert pill["top"] > _rect(page, "#sticky-group")["bottom"]
        assert _label_lines(page) == 1
    finally:
        ctx.close()


@pytest.mark.parametrize("viewport", [PHONE_SE, PHONE], ids=["320px", "390px"])
def test_portrait_resume_pill_and_dock_take_their_own_taps(browser, viewport):
    """세로의 알약(링크와 ×)과 탭 바의 탭, 검색 원형은 서로 덮지 않아 저마다 누름을 받는다. ×를 누르면 알약이 사라지고 읽던 자리를 지우며,
    알약을 누르면 읽던 장으로 간다. 가로에서는 배치만 맡는 `#tab-dock` 요소가 알약을 덮어 누름을 지나가게 해야 했다."""
    ctx, page = _pill_page(browser, viewport)
    try:
        _open_list(page)
        assert _receives_taps(page, ".resume-banner-link")
        assert _receives_taps(page, ".resume-banner-close")
        assert _receives_taps(page, DOCK_CONTROLS)
        page.click(".resume-banner-close")
        page.wait_for_selector(".resume-banner", state="detached")
        assert page.evaluate("() => localStorage.getItem('bible-last-read')") is None
    finally:
        ctx.close()
    ctx, page = _pill_page(browser, viewport)
    try:
        _open_list(page)
        page.click(".resume-banner-link")
        page.wait_for_url(f"{BASE}/gen/3?resume=1")
    finally:
        ctx.close()


@pytest.mark.parametrize("viewport, font, path, last", [
    (PHONE_SE, 18, "/", ".book-list li:last-child a"),
    (PHONE, 24, "/", ".book-list li:last-child a"),
    (PHONE_SE, 18, "/ps", ".chapter-grid a:last-child"),
], ids=["books-320px", "books-390px-24px", "chapters-320px"])
def test_portrait_list_bottom_scrolls_clear_of_the_resume_pill(browser, viewport, font, path, last):
    """성서 목록과 장 목록을 끝까지 내리면 마지막 줄이 알약 위에 온다. 알약은 독 줄 위에 한 줄을 더 차지하므로 목록 아래의 여백도 그만큼
    늘린다(알약 60px과 간격 8px). 늘리지 않으면 320px에서 마지막 책이 알약 밑에 가려진다."""
    ctx, page = _pill_page(browser, viewport, font=font)
    try:
        _open_list(page, path)
        page.evaluate("() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })")
        page.wait_for_timeout(200)
        cell, pill = _rect(page, last), _rect(page, ".resume-banner")
        assert cell["bottom"] <= pill["top"], (cell, pill)
    finally:
        ctx.close()


def test_portrait_notices_stand_above_the_resume_pill(browser):
    """알림(스낵바)은 화면 아래 막대 가운데 가장 위의 것보다 8px 위에 뜬다. 세로에서는 그것이 알약이라 알약을 가리지 않는다."""
    ctx, page = _pill_page(browser, PHONE)
    try:
        _open_list(page)
        page.evaluate("() => window._showSyncSnackbar('알림')")
        page.wait_for_selector("#notice-stack > .snackbar")
        page.wait_for_timeout(500)
        notice, pill = _rect(page, "#notice-stack > .snackbar"), _rect(page, ".resume-banner")
        assert abs(pill["top"] - notice["bottom"] - 8) < 1.5, (notice, pill)
    finally:
        ctx.close()


def test_landscape_resume_pill_stays_between_the_tab_bar_and_search(browser):
    """가로의 알약은 그대로 독 줄의 탭 바와 검색 원형 사이에 있고, 링크와 ×, 탭, 검색 원형이 저마다 누름을 받는다(`#tab-dock` 요소가
    누름을 지나가게 한다). 목록 아래의 여백은 늘리지 않는다."""
    ctx, page = _pill_page(browser, PHONE_LANDSCAPE)
    try:
        _open_list(page)
        pill, tab, search = _rect(page, ".resume-banner"), _rect(page, "#tab-bar"), _rect(page, "#tab-search")
        assert abs(pill["top"] - tab["top"]) < 1 and abs(pill["height"] - 60) < 1, (pill, tab)
        assert tab["right"] < pill["left"] and pill["right"] < search["left"], (tab, pill, search)
        assert _receives_taps(page, ".resume-banner-link")
        assert _receives_taps(page, ".resume-banner-close")
        assert _receives_taps(page, DOCK_CONTROLS)
        reserve = page.evaluate("() => getComputedStyle(document.documentElement).fontSize")
        assert page.evaluate("() => getComputedStyle(document.getElementById('app')).paddingBottom") == \
            f"{4.5 * float(reserve[:-2]):g}px"   # --tabbar-reserve 그대로(아래 안전 영역 0)
        page.click(".resume-banner-link")
        page.wait_for_url(f"{BASE}/gen/3?resume=1")
    finally:
        ctx.close()


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("viewport, font", [({"width": 568, "height": 320}, 18), ({"width": 667, "height": 375}, 24)],
                         ids=["568px", "667px-24px"])
def test_landscape_resume_pill_keeps_a_long_name_on_one_line(browser, viewport, font):
    """좁은 가로 화면에서도 알약의 글은 한 줄이고 넘치면 말줄임표로 끊는다. 그전에는 두 줄이 되어 60px 알약의 위아래가 잘렸다
    (568px은 모든 글자 크기, 667px은 22-24px)."""
    ctx, page = _pill_page(browser, viewport, font=font, book="cant", chapter=4)
    try:
        _open_list(page)
        assert abs(_rect(page, ".resume-banner")["height"] - 60) < 1
        assert _label_lines(page) == 1
        assert page.evaluate("() => getComputedStyle(document.querySelector('.resume-banner-link')).textOverflow") == "ellipsis"
    finally:
        ctx.close()


def test_large_layout_resume_banner_stays_under_the_header(browser):
    """큰 화면은 탭 바가 없어 이어 읽기 배너가 전처럼 헤더 아래, 구분 탭 위의 띠다."""
    ctx, page = _pill_page(browser, {"width": 1280, "height": 800}, touch=False)
    try:
        _open_list(page)
        assert page.evaluate("() => getComputedStyle(document.querySelector('.resume-banner')).position") == "static"
        banner, tabs = _rect(page, ".resume-banner"), _rect(page, ".division-tabs")
        assert _rect(page, "#app-header")["bottom"] <= banner["top"] and banner["bottom"] <= tabs["top"], (banner, tabs)
    finally:
        ctx.close()


def test_long_press_save_updates_header_bookmark_icon(browser):
    """Saving from long-press flow updates the chapter header bookmark state."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script("localStorage.removeItem('bible-bookmarks');")
    page = ctx.new_page()
    page.route(
        "**/data/bible/john-3.json",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json; charset=utf-8",
            body=(
                '{"book_id":"john","chapter":3,"verses":['
                '{"number":16,"text":"하느님께서는 세상을 극진히 사랑하셔서 외아들을 보내 주시어."},'
                '{"number":17,"text":"세상을 단죄하시려는 것이 아니라 구원하시려는 것이다."}'
                "]}"),
        ),
    )

    page.goto(f"{BASE}/john/3")
    page.wait_for_selector("article.chapter-text .verse")

    verse = page.locator("#v16")
    box = verse.bounding_box()
    assert box is not None, "target verse must be measurable for long-press"

    page.mouse.move(box["x"] + 10, box["y"] + 10)
    page.mouse.down()
    # Long-press threshold is 500ms (views.js ENTER_SELECT_MS); hold past it.
    page.wait_for_timeout(650)
    page.mouse.up()

    page.wait_for_selector("#verse-select-bar:not([hidden])")
    if page.locator("#verse-select-bookmark-btn").is_disabled():
        page.click("#v16")
    assert not page.locator("#verse-select-bookmark-btn").is_disabled()

    page.click("#verse-select-bookmark-btn")
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.click("#bm-save-modal .bm-btn-primary")
    page.wait_for_selector("#bm-save-modal", state="hidden")

    raw = page.evaluate("() => localStorage.getItem('bible-bookmarks')")
    assert raw, "bookmark should be saved to localStorage after long-press save"

    ctx.close()


def test_mobile_reading_header_bookmark_opens_save_modal(browser):
    """모바일 읽기 헤더 북마크 버튼 = '이 장 저장' 모달(드로어 아님) — ADR-030 후속."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True)
    ctx.add_init_script("localStorage.removeItem('bible-bookmarks');")
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])")
        assert page.locator("#bookmark-drawer").get_attribute("hidden") is not None, \
            "drawer must stay closed on mobile reading header (modal instead)"
    finally:
        ctx.close()
