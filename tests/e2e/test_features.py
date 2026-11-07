"""E2E: core app features — resume banner, bookmarks."""

import pytest

from .conftest import IPHONE_UA, emulate_status_bar

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
    ctx = browser.new_context(viewport={"width": width, "height": 800}, user_agent=IPHONE_UA if width < 769 else None)
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
    """그 절의 첫 줄을 상단 바 아래쪽에서 5px 아래에 두고 저장을 기다린다. 데스크톱은 스크롤하면 상단 바의 윗줄이 접혀, 접힌 뒤에 둔다."""
    page.goto(f"{BASE}/john/3")
    page.wait_for_selector(f".verse[data-vref='{verse}']")
    if width >= 769:
        page.wait_for_timeout(1000)   # 윗줄을 접는 스크롤 감지가 시작하기를 기다린다
        page.mouse.move(640, 400)
        page.mouse.wheel(0, 300)
        page.wait_for_function("() => document.getElementById('app-header').classList.contains('compact')")
        page.wait_for_timeout(500)
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
        page.wait_for_timeout(1500)   # 데스크톱은 윗줄이 접힌 뒤에 다시 맞추고, 저장은 스크롤이 멈추고 0.5초 뒤다
        assert abs(_gap_under_bar(page, 12)) <= 2
        assert _saved_verse(page) == 12
    finally:
        ctx.close()


def test_resume_banner_on_desktop_puts_the_verse_under_the_collapsed_bar(browser):
    """데스크톱에서 이어 읽기 배너를 누르면 그 절로 스크롤하면서 상단 바의 윗줄이 접힌다. 접힌 뒤에 한 번 더 맞춰 절이 접힌 상단 바 바로 아래에 오고,
    가만히 두어도 저장된 절이 그대로다."""
    ctx, page = _reader(browser, 1280, 0, startup="home")
    try:
        _read_up_to(page, 12, 1280)
        page.goto(f"{BASE}/")
        page.wait_for_selector(".resume-banner-link")
        page.wait_for_timeout(1000)   # 윗줄을 접는 스크롤 감지가 시작하기를 기다린다
        page.click(".resume-banner-link")
        page.wait_for_url(f"{BASE}/john/3?resume=1")
        page.wait_for_function("() => document.getElementById('app-header').classList.contains('compact')")
        page.wait_for_timeout(1500)
        assert abs(_gap_under_bar(page, 12)) <= 2
        assert _saved_verse(page) == 12
    finally:
        ctx.close()


def test_resume_on_desktop_leaves_the_scroll_alone_once_the_reader_scrolls(browser):
    """윗줄이 접히는 동안 독자가 스크롤을 시작하면 절을 다시 맞추지 않는다."""
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
