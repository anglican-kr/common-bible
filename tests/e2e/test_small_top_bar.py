"""E2E: 작은 화면의 상단 바 — 제목은 왼쪽, 단추는 오른쪽 (ADR-061).

  ① 모든 화면에서 제목은 왼쪽에서 시작하고 단추는 오른쪽 끝이다. 맨 오른쪽 그림은 제목과 같은 여백에서 끝난다(§1)
  ② 캘린더와 전례독서: 왼쪽에 달이나 날짜, 오른쪽에 ‹ › 「오늘」 월간 달력 단추. 두 화면에서 단추의 자리가 같다(§2)
  ③ 달과 날짜의 표기 — 폭에 따라 「2027년 1월 2일」, 「27년 1월 2일」, 「1월 2일」. 가장 긴 날짜로 정해 날을 옮겨도 같다. 가장 큰 글자에서는
     제목 글씨를 줄인다(§4)
  ④ 달력을 내리면 달력의 머리가 상단 바의 글자와 ‹ › 자리에 들어가고, ‹ ›는 달력만 옮기며, 닫으면 돌아온다(§3)
  ⑤ 「오늘」은 오늘의 날을 적은 캘린더 아이콘이고 월간 달력 단추와 크기가 같다(§5). 큰 화면의 ‹ ›는 캘린더와 전례독서에서 같은 자리다

실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「테스트」).
"""
import pytest

from .conftest import CLEAR_APP_STORAGE, IPHONE_UA

BASE = "http://localhost:8080"

# 상단 바 안의 보이는 글의 왼쪽 끝 — 위치가 정해진 단추(position: absolute)와 숨긴 글(sr-only, 접근성 이름만)은 뺀다.
TITLE_TEXT_LEFT = """() => {
  const title = document.getElementById('page-title');
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const parent = n.parentElement;
    if (parent.closest('.sr-only, .fit-probe, .title-actions, .title-bookmark-btn, .title-back-btn')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width > 0) return r.left;
  }
  return null;
}"""

# 단추 안에서 보이는 마지막 그림의 오른쪽 끝 — 도형의 끝에 선 굵기의 절반을 더한다(채운 그림은 선이 없다).
GLYPH_RIGHT = """(sel) => {
  const svgs = [...document.querySelector(sel).querySelectorAll('svg')].filter((g) => g.getClientRects().length);
  const g = svgs[svgs.length - 1];
  const box = g.getBBox();
  const m = g.getScreenCTM();
  const shape = g.querySelector('[stroke-width]') ?? g;
  const stroke = parseFloat(shape.getAttribute('stroke-width') || '0') || (g.querySelector('[stroke]') ? 2 : 0);
  return m.a * (box.x + box.width + stroke / 2) + m.e;
}"""

# 날짜 이동 줄의 보이는 달이나 날짜 — 표기 셋 가운데 보이는 것
SHOWN_DATE = """() => {
  const len = [...document.querySelectorAll('#page-title .fit-len')].find((e) => e.getClientRects().length);
  return len ? len.textContent : null;
}"""


def _context(browser, width=390, height=844, font=None):
    ctx = browser.new_context(viewport={"width": width, "height": height}, user_agent=IPHONE_UA)
    script = CLEAR_APP_STORAGE
    if font:
        script += f"try {{ localStorage.setItem('bible-font-size', '{font}'); }} catch (_) {{}}"
    ctx.add_init_script(script)
    return ctx


def _box(page, selector):
    return page.evaluate(
        """(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; }""",
        selector,
    )


def _content_edges(page):
    """상단 바의 글이 들어가는 왼쪽 끝과 오른쪽 끝(#page-title의 테두리 상자)."""
    return page.evaluate(
        """() => { const r = document.getElementById('page-title').getBoundingClientRect(); return [r.left, r.right]; }"""
    )


def _open(page, path, ready):
    page.goto(f"{BASE}{path}")
    page.wait_for_selector(ready, timeout=20_000)
    page.wait_for_timeout(150)


@pytest.mark.parametrize("path, ready, button", [
    ("/", ".book-list", None),
    ("/gen/1", ".chapter-text .verse", ".title-bookmark-btn"),
    ("/search?q=%EC%82%AC%EB%9E%91", "#search-inpage-bar", None),
    ("/bookmarks", "#app .title-actions, .title-actions", ".title-actions"),
])
def test_title_starts_at_the_left_and_buttons_stand_at_the_right(browser, path, ready, button):
    """① 제목의 첫 글자가 상단 바의 왼쪽 끝에 있고, 단추는 오른쪽 끝에 있다(ADR-061 §1)."""
    ctx = _context(browser)
    page = ctx.new_page()
    _open(page, path, ready)
    left, right = _content_edges(page)
    assert abs(page.evaluate(TITLE_TEXT_LEFT) - left) <= 1
    if button:
        # 그림의 오른쪽 끝(선 굵기의 절반까지)이 상단 바의 글이 끝나는 자리에 있다. 왼쪽의 제목과 같은 여백이다
        assert abs(page.evaluate(GLYPH_RIGHT, f"#page-title > {button}") - right) <= 1.5
    ctx.close()


def test_bookmark_list_title_does_not_run_under_its_buttons(browser):
    """① 오른쪽 단추가 있는 줄은 그만큼 안쪽 여백을 두어 긴 제목이 단추 밑으로 들어가지 않는다."""
    ctx = _context(browser, width=320, height=568)
    page = ctx.new_page()
    _open(page, "/bookmarks", ".title-actions")
    actions = _box(page, "#page-title > .title-actions")
    content_right = page.evaluate(
        """() => { const t = document.getElementById('page-title'); const r = t.getBoundingClientRect();
            return r.right - parseFloat(getComputedStyle(t).paddingRight); }"""
    )
    assert content_right <= actions["left"] + 0.5
    ctx.close()


BARS = [("/calendar/list/2027-01-15", ".cal-list .cal-row"), ("/lectionary/2027-01-02", ".lect-day")]


def _bar_controls(page):
    return page.evaluate(
        """() => [...document.querySelectorAll('#page-title > .lect-bar-end > *')]
            .filter((e) => e.getClientRects().length)
            .map((e) => { const r = e.getBoundingClientRect();
              return { kind: e.matches('.lect-today') ? 'today' : e.matches('.cal-picker-trigger') ? 'calendar' : e.dataset.focusKey,
                       left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10 }; })"""
    )


def test_date_bar_has_the_text_at_the_left_and_the_buttons_at_the_right(browser):
    """② 왼쪽에 달이나 날짜, 오른쪽에 ‹ › 「오늘」 월간 달력 단추가 화면의 차례와 문서의 차례로 같다. 두 화면에서 단추의 자리가 같다."""
    ctx = _context(browser)
    page = ctx.new_page()
    seen = []
    for path, ready in BARS:
        _open(page, path, ready)
        left, right = _content_edges(page)
        assert abs(page.evaluate(TITLE_TEXT_LEFT) - left) <= 1, path
        controls = _bar_controls(page)
        assert [c["kind"] for c in controls] == ["prev", "next", "today", "calendar"], path
        assert all(a["right"] <= b["left"] + 0.5 for a, b in zip(controls, controls[1:])), path
        assert abs(page.evaluate(GLYPH_RIGHT, "#page-title .cal-picker-trigger") - right) <= 1.5, path
        # 글자 칸은 단추 앞에서 끝난다
        assert _box(page, "#page-title > .lect-bar-title")["right"] <= controls[0]["left"] + 0.5, path
        seen.append(controls)
    assert seen[0] == seen[1]
    ctx.close()


@pytest.mark.parametrize("width, path, ready, shown", [
    (390, "/lectionary/2027-01-02", ".lect-day", "2027년 1월 2일"),
    (320, "/lectionary/2027-01-02", ".lect-day", "1월 2일"),
    (390, "/calendar/list/2027-01-15", ".cal-list .cal-row", "2027년 1월"),
    (320, "/calendar/list/2027-01-15", ".cal-list .cal-row", "2027년 1월"),
])
def test_date_length_follows_the_width(browser, width, path, ready, shown):
    """③ 들어가는 가장 긴 표기를 보인다. 스크린 리더는 전체를 읽는다(ADR-061 §4)."""
    ctx = _context(browser, width=width)
    page = ctx.new_page()
    _open(page, path, ready)
    assert page.evaluate(SHOWN_DATE) == shown
    full = "2027년 1월 2일 (토)" if "lectionary" in path else "2027년 1월"
    assert page.locator("#page-title .lect-date .sr-only").text_content() == full
    assert page.locator("#page-title .cal-picker-trigger").get_attribute("aria-label").startswith(full)
    # 한 줄이고 단추 앞에서 끝난다
    text = page.evaluate(
        """() => { const e = [...document.querySelectorAll('#page-title .fit-len')].find((x) => x.getClientRects().length);
            return { rects: e.getClientRects().length, right: e.getBoundingClientRect().right }; }"""
    )
    assert text["rects"] == 1
    assert text["right"] <= _box(page, "#page-title > .lect-bar-end")["left"] + 0.5
    ctx.close()


def test_date_length_is_chosen_by_the_longest_date(browser):
    """③ 폭 350px은 「2027년 1월 2일」은 들어가지만 「2027년 12월 28일」은 들어가지 않는다. 날을 옮겨도 표기가 바뀌지 않게 둘 다 「27년」이다."""
    ctx = _context(browser, width=350)
    page = ctx.new_page()
    for path, shown in (("/lectionary/2027-01-02", "27년 1월 2일"), ("/lectionary/2027-12-28", "27년 12월 28일")):
        _open(page, path, ".lect-day")
        assert page.evaluate(SHOWN_DATE) == shown, path
    ctx.close()


def test_date_shrinks_its_font_when_even_the_shortest_length_does_not_fit(browser):
    """③ 폭 320px, 글자 24px에서는 「12월 28일」도 들어가지 않아 장 제목처럼 제목 글씨를 줄인다. 잘리지 않는다."""
    ctx = _context(browser, width=320, height=568, font=24)
    page = ctx.new_page()
    _open(page, "/lectionary/2027-12-28", ".lect-day")
    assert page.evaluate(SHOWN_DATE) == "12월 28일"
    classes = page.evaluate("() => [...document.getElementById('page-title').classList]")
    assert "title-shrink-1" in classes or "title-shrink-2" in classes
    date = page.evaluate(
        """() => { const e = [...document.querySelectorAll('#page-title .fit-len')].find((x) => x.getClientRects().length);
            const cell = e.closest('.lect-date'); return { right: e.getBoundingClientRect().right, cell: cell.getBoundingClientRect().right,
              overflow: cell.scrollWidth - cell.clientWidth }; }"""
    )
    assert date["overflow"] <= 0
    assert date["right"] <= date["cell"] + 0.5
    ctx.close()


@pytest.mark.parametrize("path, ready, title", [
    ("/lectionary/2027-01-02", ".lect-day", "2027년 1월 2일"),
    ("/calendar/list/2027-01-15", ".cal-list .cal-row", "2027년 1월"),
])
def test_open_calendar_puts_its_head_in_the_bar(browser, path, ready, title):
    """④ 달력을 내리면 머리가 상단 바로 올라오고, ‹ ›는 달력만 옮기며, 닫으면 상단 바가 돌아온다(ADR-061 §3)."""
    ctx = _context(browser)
    page = ctx.new_page()
    _open(page, path, ready)
    before = _bar_controls(page)
    page.locator("#page-title .cal-picker-trigger").click()
    page.wait_for_selector(".cal-picker:not([hidden]) .cal-picker-day")
    page.wait_for_timeout(400)
    head = page.locator("#page-title > .lect-bar-title > button.cal-picker-title")
    assert head.is_visible()
    assert page.evaluate(SHOWN_DATE) == "2027년 1월"
    assert head.get_attribute("aria-label") == "2027년 1월, 달 고르기"
    # 상단 바의 글자와 ‹ ›는 숨고, 달력의 ‹ ›가 그 자리에 있다. 판 안의 머리 줄은 보이지 않는다
    assert not page.locator("#page-title .lect-date").is_visible()
    assert page.locator("#page-title a.lect-datenav-btn").count() == 2
    assert all(not a.is_visible() for a in page.locator("#page-title a.lect-datenav-btn").all())
    steps = page.locator("#page-title > .lect-bar-end > .cal-picker-step")
    assert steps.count() == 2
    opened = page.evaluate(
        """() => [...document.querySelectorAll('#page-title > .lect-bar-end > *')].filter((e) => e.getClientRects().length)
            .map((e) => Math.round(e.getBoundingClientRect().left * 10) / 10)"""
    )
    assert opened == [c["left"] for c in before]
    assert not page.locator(".cal-picker .cal-picker-head").is_visible()
    # 달력의 머리 줄이 없어 요일 머리가 달력의 맨 위다
    assert _box(page, ".cal-picker-days thead")["top"] - _box(page, ".cal-picker")["top"] < 16

    # ‹ ›는 달력만 옮긴다 — 아래 화면과 주소는 그대로다
    url = page.url
    steps.nth(1).click()
    page.wait_for_timeout(200)
    assert page.evaluate(SHOWN_DATE) == "2027년 2월"
    assert page.url == url
    # 제목을 누르면 달 판
    head.click()
    page.wait_for_selector(".cal-picker .cal-picker-grid")
    assert head.inner_text().strip().startswith("2027년")
    assert head.get_attribute("aria-label") == "2027년, 해 고르기"

    # 닫으면 상단 바가 돌아오고 머리는 판으로 돌아간다
    page.locator("#page-title .cal-picker-trigger").click()
    page.wait_for_timeout(500)
    assert page.evaluate(SHOWN_DATE) == title
    assert page.locator("#page-title .lect-date").is_visible()
    assert page.locator("#page-title .cal-picker-title").count() == 0
    assert page.locator(".cal-picker-head > button.cal-picker-title").count() == 1
    assert _bar_controls(page) == before
    ctx.close()


def test_closing_the_calendar_from_its_head_gives_focus_to_the_button(browser):
    """④ 상단 바에 올라온 머리에 포커스가 있을 때 Esc로 닫으면 포커스는 달력을 연 단추로 간다."""
    ctx = _context(browser)
    page = ctx.new_page()
    _open(page, "/lectionary/2027-01-02", ".lect-day")
    page.locator("#page-title .cal-picker-trigger").click()
    page.wait_for_selector(".cal-picker:not([hidden]) .cal-picker-day")
    page.locator("#page-title > .lect-bar-end > .cal-picker-step").first.focus()
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    assert page.evaluate("() => document.activeElement.matches('#page-title .cal-picker-trigger')")
    ctx.close()


def test_today_icon_shows_the_day(browser):
    """⑤ 「오늘」은 캘린더 아이콘 안에 오늘의 날을 적고, 이름에 그 숫자가 있다(WCAG 2.5.3). 오늘의 전례독서로 간다."""
    ctx = _context(browser)
    page = ctx.new_page()
    for path, ready in BARS:
        _open(page, path, ready)
        m, d = page.evaluate("() => { const n = new Date(); return [n.getMonth() + 1, n.getDate()]; }")
        today = page.locator("#page-title .lect-today")
        assert today.get_attribute("aria-label") == f"오늘, {m}월 {d}일"
        assert today.locator(".lect-today-num").text_content() == str(d)
        assert today.get_attribute("href") == "/lectionary"
        assert today.locator("use").get_attribute("href") == "#tab-glyph-calendar"
        box = _box(page, "#page-title .lect-today")
        assert box["width"] >= 44
        # 그림의 크기와 선 굵기가 옆의 월간 달력 단추와 같다(사용자 결정 2026-11-28)
        sizes = page.evaluate(
            """() => ['.lect-today', '.cal-picker-trigger'].map((sel) => {
                const g = document.querySelector('#page-title ' + sel + ' svg'); const r = g.getBoundingClientRect();
                const m = g.getScreenCTM(); const shape = g.querySelector('[stroke-width]');
                return { svg: [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
                         rect: Math.round(m.a * g.getBBox().width * 10) / 10, stroke: m.a * parseFloat(shape.getAttribute('stroke-width')) }; })"""
        )
        assert sizes[0]["svg"] == sizes[1]["svg"]
        assert abs(sizes[0]["rect"] - sizes[1]["rect"]) <= 0.5
        assert abs(sizes[0]["stroke"] - sizes[1]["stroke"]) <= 0.01
    ctx.close()


def test_large_layout_keeps_the_steps_in_place_between_calendar_and_lectionary(desktop_context):
    """⑤ 큰 화면은 가운데 줄 그대로이고, 글자 칸이 가장 긴 날짜의 폭이라 캘린더와 전례독서에서 ‹ ›의 자리가 같다."""
    page = desktop_context.new_page()
    seen = []
    for path, ready, shown in (("/calendar/2027-01", ".cal-grid", "2027년 1월"), ("/lectionary/2027-01-02", ".lect-day", "2027년 1월 2일")):
        _open(page, path, ready)
        assert page.evaluate(SHOWN_DATE) == shown
        seen.append([_box(page, f'#page-title a[data-focus-key="{k}"]')["left"] for k in ("prev", "next")])
        assert page.locator("#page-title .lect-today .lect-today-num").count() == 1
    assert abs(seen[0][0] - seen[1][0]) <= 1 and abs(seen[0][1] - seen[1][1]) <= 1
