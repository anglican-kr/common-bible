"""E2E: 데스크톱의 한 줄 상단 바 (ADR-043 1단계 — §1, §2, §3, §8, §4의 「북마크」 탭).

유닛이 못 보는 배치와 배선을 본다.

  ① 한 줄 — 탭은 왼쪽 끝, 검색창과 설정은 오른쪽 끝, 제목은 창의 가운데
  ② 스크롤해도 탭, 검색창, 설정이 그대로 보이고 상단 바의 높이가 같다
  ③ 지금 있는 목적지의 탭에 aria-current
  ④ 「성서」 탭 — 캘린더에서 누르면 읽던 화면, 성서 화면에서 누르면 성서 목록(제목 줄의 집 단추는 없다)
  ⑤ 「오늘」은 데스크톱에서 › 오른쪽, 모바일은 ‹ 왼쪽 — 화면의 차례와 포커스의 차례가 같다
  ⑥ 좁은 데스크톱 폭 — 긴 제목은 짧은 제목으로, 탭은 아이콘만(이름은 남는다), 가로 넘침 없음
  ⑦ 모바일 — 탭과 검색창, 설정 단추는 숨고 탭 바가 맡는다
  ⑧ 「북마크」 탭 — 어느 화면에서나 패널을 열고, 장 밖에서는 「이 장 저장」과 「절 선택」이 꺼져 있다
  ⑨ 창 폭이 바뀔 때 — 넓히면 전체 제목으로 돌아오고, 「오늘」은 배치를 따라 칸을 옮긴다. 제목 줄의 단추는 글자를 덮지 않는다
  ⑩ 가운데 칸이 들어가지 않을 때 — 탭을 아이콘으로, 달 이름을 짧게, 긴 제목은 말줄임표로. 검색창은 누르면 제목 위로 넓어진다

실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「테스트」).
"""
import pytest

from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"


def _box(page, selector):
    return page.evaluate(
        """(sel) => { const r = document.querySelector(sel).getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; }""",
        selector,
    )


def _open_chapter(page, path="gen/1"):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(".chapter-text .verse", timeout=20_000)
    page.wait_for_timeout(100)


def _current(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#header-nav [aria-current=\"page\"]')].map((a) => a.dataset.nav)"
    )


def test_top_bar_is_one_row_across_the_window(desktop_context):
    """① 탭은 왼쪽 끝, 검색창과 설정은 오른쪽 끝, 제목은 창의 가운데 — 셋이 같은 줄에 있다."""
    page = desktop_context.new_page()
    _open_chapter(page)
    width = page.evaluate("() => window.innerWidth")
    nav, title, actions = _box(page, "#header-nav"), _box(page, "#page-title"), _box(page, "#header-actions")
    assert not page.locator("#tab-dock").is_visible()
    assert nav["left"] <= 32 and actions["right"] >= width - 32
    assert abs((title["left"] + title["right"]) / 2 - width / 2) <= 1
    assert nav["right"] <= title["left"] and title["right"] <= actions["left"]
    # 같은 줄 — 세 칸의 세로 범위가 겹친다
    assert max(nav["top"], title["top"], actions["top"]) < min(nav["bottom"], title["bottom"], actions["bottom"])
    assert [t.strip() for t in page.locator("#header-nav .header-nav-link").all_inner_texts()] == ["성서", "캘린더", "북마크"]


def test_top_bar_stays_while_the_page_scrolls(desktop_context):
    """② 장을 읽는 중에도 탭, 검색창, 설정이 보인다 — 그전에는 60px 을 내리면 윗줄이 접혔다."""
    page = desktop_context.new_page()
    _open_chapter(page)
    height = _box(page, "#app-header")["bottom"]
    page.mouse.wheel(0, 900)
    page.wait_for_function("() => window.scrollY > 600")
    page.wait_for_timeout(400)   # 예전의 접힘 전환(0.25초)이 끝났을 시간
    for selector in ("#header-home", "#header-calendar", "#header-bookmarks", "#search-input", "#settings-anchor button"):
        box = _box(page, selector)
        assert box["width"] > 0 and 0 <= box["top"] < height, selector
    assert _box(page, "#app-header")["bottom"] == height


@pytest.mark.parametrize("path, ready, current", [
    ("", ".book-list", ["home"]),
    ("gen", ".chapter-list, .chapter-grid, #app a[href='/gen/1']", ["home"]),
    ("gen/1", ".chapter-text .verse", ["home"]),
    ("search?q=%EC%82%AC%EB%9E%91", ".search-results, .search-result, #app", ["home"]),
    ("calendar", ".cal-grid", ["calendar"]),
    ("lectionary", ".lect-day", ["calendar"]),
])
def test_current_destination_is_marked(desktop_context, path, ready, current):
    """③ 캘린더와 전례독서는 「캘린더」, 그 밖의 화면은 「성서」 — 표시는 늘 하나다."""
    page = desktop_context.new_page()
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(ready, timeout=20_000)
    page.wait_for_function("() => document.querySelectorAll('#header-nav [aria-current]').length === 1")
    assert _current(page) == current


def test_bible_tab_returns_to_reading_then_to_the_book_list(desktop_context):
    """④ 캘린더에서 「성서」를 누르면 읽던 장으로, 장에서 누르면 그 책이 있는 성서 목록으로 — 제목 줄에 집 단추는 없다."""
    page = desktop_context.new_page()
    _open_chapter(page, "john/3")
    assert page.locator("#page-title .title-home-btn").count() == 0
    page.locator("#header-calendar").click()
    page.wait_for_selector(".cal-grid", timeout=20_000)
    assert page.locator("#page-title .title-home-btn").count() == 0
    page.locator("#header-home").click()
    page.wait_for_url("**/john/3")
    page.wait_for_selector(".chapter-text .verse")
    page.locator("#header-home").click()
    page.wait_for_selector(".book-list", timeout=20_000)
    # 읽던 책이 있는 구분 탭(신약)의 목록이고, 포커스가 그 책에 간다
    page.wait_for_function("() => document.activeElement?.getAttribute('href') === '/john'")
    assert _current(page) == ["home"]


@pytest.mark.parametrize("path, ready", [("calendar/2026-12", ".cal-grid"), ("lectionary/2026-12-24", ".lect-day")])
def test_today_follows_the_next_step_on_desktop(desktop_context, path, ready):
    """⑤ 데스크톱 — ‹ 글자 › 오늘 의 차례다. 포커스도 그 차례로 옮겨 간다."""
    page = desktop_context.new_page()
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(ready, timeout=20_000)
    prev = _box(page, "#page-title a.lect-datenav-btn[data-focus-key='prev']")
    nxt = _box(page, "#page-title a.lect-datenav-btn[data-focus-key='next']")
    today = _box(page, "#page-title .lect-today")
    assert prev["right"] <= nxt["left"] and nxt["right"] <= today["left"] + 8   # ‹ › 는 글자 쪽으로 8px 겹친다
    order = page.evaluate(
        "() => [...document.querySelectorAll('#page-title a')].map((a) => a.dataset.focusKey)"
    )
    assert order[:3] == ["prev", "next", "today"]
    # 덩어리째 창의 가운데 — 왼쪽 칸이 비어도 한쪽으로 쏠리지 않는다
    title = _box(page, "#page-title")
    assert abs((title["left"] + title["right"]) / 2 - page.evaluate("() => window.innerWidth") / 2) <= 1


def test_today_stays_before_the_previous_step_on_mobile(mobile_context):
    """⑤ 모바일 — 「오늘」은 왼쪽 칸 그대로다(ADR-038 §1)."""
    page = mobile_context.new_page()
    page.goto(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-grid", timeout=20_000)
    today = _box(page, "#page-title .lect-today")
    prev = _box(page, "#page-title a.lect-datenav-btn[data-focus-key='prev']")
    assert today["right"] <= prev["left"] + 8


def test_narrow_desktop_keeps_one_row(browser):
    """⑥ 폭 800px — 긴 제목은 짧은 제목으로 바뀌고, 탭은 아이콘만 남되 이름은 그대로이며, 가로로 넘치지 않는다."""
    ctx = browser.new_context(viewport={"width": 800, "height": 700})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        _open_chapter(page, "1thess/5")
        page.wait_for_function("() => document.getElementById('page-title').classList.contains('compact')")
        assert page.evaluate("() => document.documentElement.scrollWidth") == 800
        nav, title, actions = _box(page, "#header-nav"), _box(page, "#page-title"), _box(page, "#header-actions")
        assert nav["right"] <= title["left"] and title["right"] <= actions["left"]
        assert abs((title["left"] + title["right"]) / 2 - 400) <= 1
        assert _box(page, "#header-home .header-nav-label")["width"] <= 1
        assert page.get_by_role("link", name="성서", exact=True).count() == 1
        assert page.locator("#header-home").get_attribute("title") == "성서"
    finally:
        ctx.close()


def test_wide_desktop_keeps_the_full_title_and_labels(desktop_context):
    """⑥ 넓은 폭에서는 전체 제목과 탭의 글자가 보인다."""
    page = desktop_context.new_page()
    _open_chapter(page, "1thess/5")
    page.wait_for_timeout(300)
    assert not page.evaluate("() => document.getElementById('page-title').classList.contains('compact')")
    assert _box(page, "#header-home .header-nav-label")["width"] > 10
    # 글자가 보이는 탭에는 같은 이름의 도움말을 한 번 더 달지 않는다
    assert page.evaluate("() => [...document.querySelectorAll('.header-nav-link')].map((a) => a.getAttribute('title'))") == [None, None, None]


def test_top_bar_controls_are_hidden_on_mobile(mobile_context):
    """⑦ 모바일 — 탭, 검색창, 설정 단추는 숨고 탭 바가 목적지를 맡는다. 헤더에는 제목만 남는다."""
    page = mobile_context.new_page()
    _open_chapter(page)
    assert not page.locator("#header-nav").is_visible()
    assert not page.locator("#header-actions").is_visible()
    assert page.locator("#tab-bar [data-tab='home']").is_visible()
    assert page.locator("#page-title").is_visible()


# ── ⑧ 「북마크」 탭 (ADR-043 §4) ──

def _panel_buttons(page):
    return page.evaluate("""() => ({
        save: document.getElementById('bm-save-chapter-btn').disabled,
        select: document.getElementById('bm-select-verses-btn').disabled,
    })""")


@pytest.mark.parametrize("path, ready", [
    ("", ".book-list"), ("calendar/2026-12", ".cal-grid"), ("lectionary/2026-12-24", ".lect-day"),
    ("search?q=%EC%82%AC%EB%9E%91", "#app"),
])
def test_bookmark_tab_opens_the_panel_on_any_screen(desktop_context, path, ready):
    """⑧ 그전에는 장 목록과 장 본문의 제목 옆 단추로만 열 수 있었다. 장 밖에서는 저장할 장이 없어 「이 장 저장」과 「절 선택」이 꺼져 있다."""
    page = desktop_context.new_page()
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(ready, timeout=20_000)
    tab = page.locator("#header-bookmarks")
    assert tab.get_attribute("aria-expanded") == "false"
    tab.click()
    page.wait_for_selector("#bookmark-drawer", state="visible")
    assert tab.get_attribute("aria-expanded") == "true"
    assert _panel_buttons(page) == {"save": True, "select": True}
    page.keyboard.press("Escape")
    page.wait_for_selector("#bookmark-drawer", state="hidden")
    assert tab.get_attribute("aria-expanded") == "false"
    assert page.evaluate("() => document.activeElement.id") == "header-bookmarks"   # 포커스는 연 단추로 돌아온다
    assert page.evaluate("() => location.pathname + location.search") == "/" + path   # 화면을 옮기지 않는다


def test_bookmark_tab_in_a_chapter_offers_to_save_it(desktop_context):
    """⑧ 장 본문에서 열면 「이 장 저장」과 「절 선택」이 켜져 있다 — 제목 옆 북마크 단추로 열 때와 같다."""
    page = desktop_context.new_page()
    _open_chapter(page, "john/3")
    page.locator("#header-bookmarks").click()
    page.wait_for_selector("#bookmark-drawer", state="visible")
    assert _panel_buttons(page) == {"save": False, "select": False}


def test_bookmark_tab_does_not_offer_the_chapter_left_behind(desktop_context):
    """⑧ 장을 읽다가 캘린더로 가서 열면 읽던 장을 저장하지 않는다 — 읽던 장의 기록은 화면을 떠나도 남아 있다."""
    page = desktop_context.new_page()
    _open_chapter(page, "john/3")
    page.locator("#header-calendar").click()
    page.wait_for_selector(".cal-grid", timeout=20_000)
    page.locator("#header-bookmarks").click()
    page.wait_for_selector("#bookmark-drawer", state="visible")
    assert _panel_buttons(page) == {"save": True, "select": True}


# ── ⑨ 창 폭이 바뀔 때, 제목 줄의 단추 (PR #564 리뷰) ──

def test_widening_the_window_brings_the_full_title_back(browser):
    """⑨ 좁은 창에서 짧은 제목으로 바뀐 뒤 창을 넓히면 전체 제목으로 돌아온다. 폭 변화를 내용 폭을 따르는 제목 칸에서 보았을 때는
    다른 화면으로 옮길 때까지 짧은 제목이 남았다."""
    ctx = browser.new_context(viewport={"width": 800, "height": 700})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        _open_chapter(page, "1thess/5")
        page.wait_for_function("() => document.getElementById('page-title').classList.contains('compact')")
        page.set_viewport_size({"width": 1700, "height": 700})
        page.wait_for_function("() => !document.getElementById('page-title').classList.contains('compact')")
        page.set_viewport_size({"width": 800, "height": 700})
        page.wait_for_function("() => document.getElementById('page-title').classList.contains('compact')")
    finally:
        ctx.close()


def test_today_moves_with_the_layout_when_the_window_crosses_the_breakpoint(desktop_context):
    """⑨ 그린 뒤 창 폭이 769px 경계를 넘으면 「오늘」이 그 배치의 칸으로 옮겨 간다 — 다시 그리지 않아도."""
    page = desktop_context.new_page()
    page.goto(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-grid", timeout=20_000)
    left = lambda sel: _box(page, "#page-title " + sel)["left"]   # noqa: E731
    assert left(".lect-today") > left("a.lect-datenav-btn[data-focus-key='next']")
    page.set_viewport_size({"width": 600, "height": 700})
    page.wait_for_function("() => document.querySelector('#page-title .lect-bar-start .lect-today')")
    assert left(".lect-today") < left("a.lect-datenav-btn[data-focus-key='prev']")
    assert page.locator("#page-title .lect-today").count() == 1
    page.set_viewport_size({"width": 1280, "height": 700})
    page.wait_for_function("() => document.querySelector('#page-title .lect-bar-end .lect-today')")
    assert left(".lect-today") > left("a.lect-datenav-btn[data-focus-key='next']")


def test_title_row_buttons_do_not_cover_the_title(desktop_context):
    """⑨ 북마크 모아 읽기의 「북마크로 돌아가기」 단추와 장의 북마크 단추는 제목 글자 옆에 선다 — 가운데 칸의 폭이 글자 폭이라
    절대 위치로 두면 글자를 덮는다."""
    page = desktop_context.new_page()
    text_box = """() => {
        const title = document.getElementById('page-title');
        const node = [...title.querySelectorAll('.title-text-full'), ...title.childNodes]
            .find((n) => n.nodeType === 3 ? n.data.trim() : n.classList.contains('title-text-full') && n.getBoundingClientRect().width > 0);
        const range = document.createRange(); range.selectNodeContents(node);
        const r = range.getBoundingClientRect(); return { left: r.left, right: r.right };
    }"""
    page.goto(f"{BASE}/read/none")
    page.wait_for_selector("#page-title .title-back-btn", timeout=20_000)
    assert _box(page, "#page-title .title-back-btn")["right"] <= page.evaluate(text_box)["left"] + 0.5
    _open_chapter(page, "john/3")
    assert page.evaluate(text_box)["right"] <= _box(page, "#page-title .title-bookmark-btn")["left"] + 0.5


def test_bookmark_tab_takes_focus_back_even_when_the_click_gave_it_none(desktop_context):
    """⑨ 마우스로 누른 단추에 포커스를 주지 않는 브라우저(macOS Safari)에서도 패널을 닫으면 포커스가 탭으로 돌아온다."""
    page = desktop_context.new_page()
    _open_chapter(page)
    page.evaluate("() => { document.activeElement?.blur(); document.getElementById('header-bookmarks').dispatchEvent(new MouseEvent('click', { bubbles: true })); }")
    page.wait_for_selector("#bookmark-drawer", state="visible")
    page.keyboard.press("Escape")
    page.wait_for_selector("#bookmark-drawer", state="hidden")
    assert page.evaluate("() => document.activeElement.id") == "header-bookmarks"


# ── ⑩ 가운데 칸이 들어가지 않을 때 (PR #564 리뷰 2회차) ──

def _sized(browser, width, font=18):
    ctx = browser.new_context(viewport={"width": width, "height": 700})
    ctx.add_init_script(CLEAR_APP_STORAGE + f"localStorage.setItem('bible-font-size', '{font}');")
    return ctx


def _cells(page):
    """세 칸의 자리와 가운데 칸 안에 그려진 것의 자리. 날짜 이동 줄은 가운데 맞춤이라 칸을 넘치면 양쪽으로 나온다."""
    return page.evaluate("""() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right }; };
        const title = document.getElementById('page-title');
        const drawn = [...title.children].filter((c) => c.getBoundingClientRect().width > 0).map(box);
        return { nav: box(document.getElementById('header-nav')), title: box(title),
                 actions: box(document.getElementById('header-actions')),
                 drawnLeft: drawn.length ? Math.min(...drawn.map((d) => d.left)) : null,
                 drawnRight: drawn.length ? Math.max(...drawn.map((d) => d.right)) : null,
                 width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth };
    }""")


@pytest.mark.parametrize("width, font, path, ready", [
    (900, 18, "calendar/2027-12", ".cal-grid"), (900, 20, "calendar/2027-12", ".cal-grid"),
    (1024, 24, "calendar/2027-12", ".cal-grid"), (900, 20, "lectionary/2026-12-24", ".lect-day"),
])
def test_date_row_stays_between_the_tabs_and_the_search_field(browser, width, font, path, ready):
    """⑩ 캘린더와 전례독서의 날짜 이동 줄이 탭과 검색창을 덮지 않고 창의 가운데에 있다. 들어가지 않으면 탭이 아이콘만 남고
    검색창이 좁아지며, 그래도 모자라면 달 이름이 「2027.12」가 된다."""
    ctx = _sized(browser, width, font)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/{path}")
        page.wait_for_selector(ready, timeout=20_000)
        page.wait_for_timeout(600)   # 웹 글꼴이 온 뒤 다시 잰다
        c = _cells(page)
        assert c["nav"]["right"] <= c["drawnLeft"] + 0.5 and c["drawnRight"] <= c["actions"]["left"] + 0.5, c
        assert abs((c["drawnLeft"] + c["drawnRight"]) / 2 - width / 2) <= 1, c
        assert c["scrollWidth"] == width, c
    finally:
        ctx.close()


def test_month_name_shortens_only_when_the_tighter_bar_is_not_enough(browser):
    """⑩ 폭 900px의 기본 글자에서는 탭을 아이콘으로 바꾸는 것으로 충분해 달 이름이 그대로다. 글자 24px에서는 「2027.12」가 된다."""
    month = "() => getComputedStyle(document.querySelector('#page-title .cal-month-short')).display"
    for font, short in ((18, "none"), (24, "inline")):
        ctx = _sized(browser, 900, font)
        try:
            page = ctx.new_page()
            page.goto(f"{BASE}/calendar/2027-12")
            page.wait_for_selector(".cal-grid", timeout=20_000)
            page.wait_for_timeout(600)
            assert page.evaluate("() => document.getElementById('app-header').classList.contains('tight')"), font
            assert page.evaluate(month) == short, font
        finally:
            ctx.close()


def test_long_title_without_a_short_form_is_cut_instead_of_covering_the_bar(browser):
    """⑩ 긴 검색어의 제목은 말줄임표로 자른다 — 그전에는 탭과 검색창 위로 넘쳤다."""
    ctx = _sized(browser, 1000)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/search?q=" + "%EA%B0%80" * 40)
        page.wait_for_function("() => document.getElementById('page-title').textContent.includes('검색')")
        page.wait_for_timeout(600)
        c = _cells(page)
        assert c["nav"]["right"] <= c["title"]["left"] and c["title"]["right"] <= c["actions"]["left"], c
        assert page.evaluate("() => { const t = document.getElementById('page-title'); return t.scrollWidth > t.clientWidth; }")
        assert page.evaluate("() => getComputedStyle(document.getElementById('page-title')).textOverflow") == "ellipsis"
        assert c["scrollWidth"] == 1000, c
        # 좁아진 검색창 안에서도 책 선택 단추(깔때기)는 잘리지 않는다
        funnel, zone = _box(page, "#search-bar .token-funnel"), _box(page, "#search-bar .token-zone")
        assert zone["left"] <= funnel["left"] and funnel["right"] <= zone["right"] + 0.5, (funnel, zone)
    finally:
        ctx.close()


def test_search_field_widens_over_the_title_without_moving_it(browser):
    """⑩ 좁은 창에서 검색창을 누르면 왼쪽으로 넓어져 「사랑 in:요한」을 칠 자리가 생긴다. 상단 바에서 차지하는 자리는 그대로라
    제목이 밀리지 않는다."""
    ctx = _sized(browser, 800)
    try:
        page = ctx.new_page()
        _open_chapter(page)
        page.wait_for_timeout(400)
        room = """() => { const i = document.getElementById('search-input'); const s = getComputedStyle(i);
            return i.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight); }"""
        before = _cells(page)
        page.locator("#search-input").click()
        page.keyboard.type("사랑 in:요한")
        page.wait_for_timeout(500)   # 넓어지는 전환
        after = _cells(page)
        assert page.evaluate(room) >= 200
        assert after["title"] == before["title"] and after["actions"] == before["actions"], (before, after)
        assert _box(page, "#search-bar")["right"] <= 800
    finally:
        ctx.close()


def test_bookmark_view_actions_stand_beside_the_title_after_widening(browser):
    """⑩ 좁은 창에서 연 북마크 전체 화면을 넓혀도 새 폴더와 더 보기 단추가 제목 글자를 덮지 않는다."""
    ctx = _sized(browser, 600)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/bookmarks")
        page.wait_for_selector("#page-title .title-actions", timeout=20_000)
        page.set_viewport_size({"width": 1100, "height": 700})
        page.wait_for_timeout(400)
        text_right = page.evaluate("""() => { const t = document.getElementById('page-title');
            const n = [...t.childNodes].find((c) => c.nodeType === 3 && c.data.trim());
            const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().right; }""")
        assert text_right <= _box(page, "#page-title .title-actions")["left"] + 0.5
    finally:
        ctx.close()


def test_today_keeps_the_focus_when_it_moves(desktop_context):
    """⑩ 「오늘」에 포커스가 있을 때 창 폭이 경계를 넘어 칸을 옮겨도 포커스가 남는다."""
    page = desktop_context.new_page()
    page.goto(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-grid", timeout=20_000)
    page.locator("#page-title .lect-today").focus()
    for width, cell in ((600, ".lect-bar-start"), (1280, ".lect-bar-end")):
        page.set_viewport_size({"width": width, "height": 700})
        page.wait_for_function(f"() => document.querySelector('#page-title {cell} .lect-today')")
        assert page.evaluate("() => document.activeElement.classList.contains('lect-today')"), width
