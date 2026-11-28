"""E2E: 캘린더 탭 /calendar[/YYYY-MM] (ADR-038 §1 · §2 A2).

엔진(resolveDate)이 낸 날들을 월간 표(js/app/calendar.js)가 어떻게 그리는지 — 탭 바 →
라우팅 → 캘린더 묶음 프리로드 → DOM 커밋의 배선과, 유닛이 못 보는 화면 동작(링크 이동 ·
탭 복원 · 좁은 화면 넘침 · 데스크톱 입구)을 검증한다.

  ① 탭 — 홈 다음 두 번째, 누르면 작은 화면은 오늘 줄의 목록, 큰 화면은 이번 달(ADR-058 §1)
  ② 달 이동 — 이전/다음/오늘이 링크(뒤로 가기 · 주소 그대로)
  ③ 큰 화면의 칸 → 목록의 그날 줄 → 전례독서, 탭 → 그 줄(ADR-058 §1)
  ④ 칸의 이름 · 색 점 · 링크 이름(사용자 결정 2026-10-15 의 날짜 예 — 링크 이름은 칸에 보이는 이름 그대로)
  ⑤ 탭 복원 — 다른 탭에 다녀오면 마지막 캘린더 화면, 탭을 다시 누르면 이번 달 · 수정 키 클릭은 새 탭 몫
  ⑥ 320px 폭에서 가로 넘침 없음(1.6.0 달력의 넘침 재발 방지)
  ⑦ 잘못된 달 · 자료 실패 · 데스크톱 상단 바의 입구(탭과 같은 곳으로)
  ⑧ 달 이동 뒤 키보드 포커스가 누른 컨트롤에 남는다
  ⑨ 세 화면의 같은 상단 바  ⑩ 목록 보기
  ⑪ 날짜 고르기 — 작은 화면은 오른쪽 아이콘이 내리는 월간 달력(ADR-058 §3)이고 열린 동안 그 머리가 상단 바에 있다(ADR-061 §3), 큰 화면은 달 제목의
     팝오버. 단계, 고른 곳, 포커스, 닫기, 폭이 바뀔 때

실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「테스트」).
"""
import base64
import datetime
import re

import pytest

from .conftest import (
    CLEAR_APP_STORAGE,
    IPHONE_UA,
    emulate_side_safe_areas,
    emulate_status_bar,
    press_center,
    RECORD_ANNOUNCEMENTS,
    RECORD_FRAMES,
    SCREEN_UNDER_DIVIDER,
    assert_calendar_folds_over_the_new_screen,
)

BASE = "http://localhost:8080"


_press = press_center   # 좌표로 누른다(conftest.py)


def _open(page, path):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(".calendar", timeout=20_000)
    page.wait_for_timeout(100)


def _cell(page, date):
    return page.locator(f".cal-grid a.cal-cell[href='/calendar/list/{date}']")


def _this_month():
    t = datetime.date.today()
    return t, f"{t.year}년 {t.month}월"


def _shown_month(page):
    """상단 바에 보이는 달 — 표기 셋(「2027년 1월」, 「27년 1월」, 「1월」, ADR-061 §4) 가운데 보이는 것. 작은 화면은 스크린 리더가 읽는 전체
    이름을 숨긴 글로 따로 두어, `.cal-month`의 글을 그대로 읽으면 둘이 함께 나온다."""
    return page.evaluate("""() => { const e = [...document.querySelectorAll('#page-title .cal-month .fit-len')].find((x) => x.getClientRects().length);
        return e ? e.textContent : null; }""")


def _wait_month(page, name):
    """상단 바의 달이 `name`이 될 때까지 기다린다. 표기 셋과 작은 화면의 숨긴 글이 함께 바뀌므로 첫 표기(전체 이름)로 본다. 작은 화면에서 달력이
    열려 상단 바의 달이 숨은 동안에도 쓸 수 있다."""
    page.wait_for_selector(f"#page-title .cal-month .fit-len-0:text-is('{name}')", state="attached")


# ── ① 탭 ──

def test_calendar_tab_is_second_and_opens_todays_row(mobile_context):
    """탭 순서 홈 · 캘린더 · 북마크 · (노트 숨김) · 설정. 작은 화면에서 캘린더를 누르면 오늘 줄의 목록이다(ADR-058 §1). 탭 활성 · 인디케이터."""
    page = mobile_context.new_page()
    page.goto(BASE)
    page.wait_for_selector(".book-list", timeout=20_000)
    tabs = page.eval_on_selector_all("#tab-bar .tab-item", "els => els.map(e => e.dataset.tab + (e.hidden ? ':hidden' : ''))")
    assert tabs == ["home", "calendar", "bookmarks", "notes:hidden", "settings"], tabs
    assert page.get_attribute("#tab-bar [data-tab='calendar']", "aria-label") == "캘린더"
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(".cal-rows", timeout=20_000)
    today, title = _this_month()
    assert _shown_month(page) == title
    page.wait_for_selector("#tab-bar [data-tab='calendar'][aria-current='page']")
    assert page.locator("#tab-bar .tab-indicator.is-shown").count() == 1
    current = page.locator(".cal-rows a.cal-row[aria-current='date']")
    assert current.count() == 1
    assert current.get_attribute("href") == f"/lectionary/{today.isoformat()}"
    assert current.get_attribute("aria-label").startswith("오늘, ")
    assert page.title() == f"{title} 캘린더 목록 — 공동번역성서"


def test_desktop_calendar_opens_this_month_with_today_marked(desktop_context):
    """큰 화면의 /calendar는 이번 달의 월간이고, 오늘 칸은 목록의 오늘 줄로 간다(주소에 날짜가 없다)."""
    page = desktop_context.new_page()
    _open(page, "calendar")
    assert page.url == f"{BASE}/calendar"
    current = page.locator(".cal-grid a.cal-cell[aria-current='date']")
    assert current.count() == 1
    assert current.get_attribute("href") == "/calendar/list"
    assert current.get_attribute("aria-label").startswith("오늘, ")
    assert page.title() == f"{_this_month()[1]} 캘린더 — 공동번역성서"


# ── ② 달 이동 ──

def test_month_nav_links_step_months_and_back_returns(desktop_context):
    """다음 달은 해를 넘고(2026-12 → 2027-01), 이전 · 오늘도 링크 — 뒤로 가기가 앞 달로 돌아온다. 이번 달로 가는 ‹ ›는 날짜 없이 /calendar다
    (ADR-038 §2 「이번 달의 주소」). 오늘을 2026-11-17로 고정한다."""
    page = desktop_context.new_page()
    page.clock.set_fixed_time(datetime.datetime(2026, 11, 17, 12))
    _open(page, "calendar/2026-12")
    assert page.inner_text(".cal-month") == "2026년 12월"
    page.locator(".lect-datenav-btn[aria-label='다음 달']").click()
    page.wait_for_url("**/calendar/2027-01")
    page.wait_for_selector(".cal-month:has-text('2027년 1월')")
    page.locator(".lect-datenav-btn[aria-label='이전 달']").click()
    page.wait_for_url("**/calendar/2026-12")
    page.locator(".lect-datenav-btn[aria-label='이전 달']").click()
    page.wait_for_url(f"{BASE}/calendar")   # 이번 달
    page.wait_for_selector(".cal-month:has-text('2026년 11월')")
    assert page.get_attribute(".lect-datenav-btn[aria-label='다음 달']", "href") == "/calendar/2026-12"
    page.go_back()
    page.wait_for_url("**/calendar/2026-12")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")
    assert page.get_attribute(".lect-datenav-btn[aria-label='이전 달']", "href") == "/calendar"
    page.locator("#page-title .lect-today").click()   # 「오늘」은 오늘의 전례독서로 간다(사용자 결정 2026-11-27)
    page.wait_for_url(f"{BASE}/lectionary")
    page.wait_for_selector(".lect-day", timeout=20_000)


def test_grid_is_six_weeks_from_sunday(desktop_context):
    """2026년 10월 — 9.27(일)부터 11.7(토)까지 42칸, 앞뒤 달 칸은 흐리게 · 이름 없이 · 링크는 그대로."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-10")
    hrefs = page.eval_on_selector_all(".cal-grid tbody td > .cal-cell", "els => els.map(e => e.getAttribute('href'))")
    assert len(hrefs) == 42
    assert hrefs[0] == "/calendar/list/2026-09-27" and hrefs[-1] == "/calendar/list/2026-11-07"
    first = page.locator(".cal-grid tbody td > .cal-cell").first
    assert "cal-cell--out" in first.get_attribute("class")
    assert first.locator(".cal-name").count() == 0
    assert page.eval_on_selector_all(".cal-grid thead th", "els => els.map(e => e.textContent)") == ["일", "월", "화", "수", "목", "금", "토"]


# ── ③ 칸 → 전례독서 → 위 단계 ──

def test_cell_opens_the_row_of_the_day_and_the_tab_returns_there(desktop_context):
    """큰 화면의 12월 25일 칸을 누르면 목록의 그날 줄이다(ADR-058 §1). 줄을 누르면 전례독서이고, 캘린더 탭은 오늘 줄의 목록으로 간다
    (사용자 결정 2026-11-27). 뒤로 가기는 월간이다."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-12")
    _cell(page, "2026-12-25").click()
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-25")
    page.wait_for_selector(".cal-rows", timeout=20_000)
    page.wait_for_timeout(300)
    assert abs(_row_top_under_head(page, "2026-12-25")) <= 2
    page.go_back()
    page.wait_for_url(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-grid")
    page.go_forward()
    page.wait_for_selector(".cal-rows")
    _press(page, 'li[data-date="2026-12-25"] a.cal-row')
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    assert page.inner_text(".lect-day") == "성탄 낮"
    assert page.locator("#page-title .title-home-btn").count() == 0   # 성서 목록의 입구는 상단 바의 「성서」 탭이다(ADR-043 §3)
    assert page.get_attribute("#page-title .lect-date time", "datetime") == "2026-12-25"
    page.locator("#header-calendar").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")


def test_reading_belongs_to_the_calendar_tab(mobile_context):
    """작은 화면에서 줄을 눌러 들어간 전례독서는 캘린더 탭 소속이고, 탭은 오늘 줄의 목록으로 간다(사용자 결정 2026-11-27)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-25")
    _press(page, 'li[data-date="2026-12-25"] a.cal-row')
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    assert page.locator("#page-title a.lect-datenav-btn[aria-label='전날']").is_visible()
    assert page.get_attribute("#tab-bar [data-tab='calendar']", "aria-current") == "page"
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")


# ── ④ 칸의 이름 · 색 점 · 링크 이름 ──

def test_cells_show_one_name_colour_dots_and_full_label(desktop_context):
    """2026년 9월 — 9.29 미카엘(설립 기념일은 칸에 없다) · 9.18 추계재 자색 · 9.16 니니안 자 · 백 · 9.13 주일 「연중24주」 · 9.2 이름 없는 평일."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-09")

    def name(date):
        loc = _cell(page, date).locator(".cal-name")
        return loc.inner_text() if loc.count() else ""

    def dots(date):
        return page.eval_on_selector_all(
            f".cal-grid a.cal-cell[href='/calendar/list/{date}'] .cal-dot",
            "els => els.map(e => [...e.classList].find(c => c.startsWith('lit-swatch--')).slice(12))")

    assert name("2026-09-29") == "성 미카엘과 모든 천사들"
    assert dots("2026-09-29") == ["white"]
    assert _cell(page, "2026-09-29").get_attribute("aria-label") == "9월 29일 화요일, 성 미카엘과 모든 천사들, 백색"
    assert name("2026-09-18") == "추계재" and dots("2026-09-18") == ["violet"]
    # 링크 이름은 칸에 보이는 이름 그대로 — 대표(연중 24주 금요일)가 아니라(WCAG 2.5.3, PR #348 리뷰)
    assert _cell(page, "2026-09-18").get_attribute("aria-label") == "9월 18일 금요일, 추계재, 자색"
    assert name("2026-09-16") == "니니안" and dots("2026-09-16") == ["violet", "white"]
    assert _cell(page, "2026-09-16").get_attribute("aria-label").endswith(", 자색 · 백색")
    assert name("2026-09-13") == "연중24주"
    assert _cell(page, "2026-09-13").get_attribute("aria-label") == "9월 13일 일요일, 연중24주, 녹색"
    assert name("2026-09-02") == ""
    assert _cell(page, "2026-09-02").get_attribute("aria-label") == "9월 2일 수요일, 연중 22주 수요일, 녹색"
    # 칸 이름에 괄호 설명은 없고, 전체 이름은 title 로
    assert _cell(page, "2026-09-19").locator(".cal-name").get_attribute("title").startswith("탈수스의 데오도르(")


def test_advent_sunday_marks_the_new_liturgical_year(desktop_context):
    """2026-11-29 대림 1주일 — 「나해」 표지(title 「나해 시작」) + 「대림1주」, 링크 이름에 「나해 시작」."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-11")
    cell = _cell(page, "2026-11-29")
    mark = cell.locator(".cal-mark")
    assert mark.inner_text() == "나해"
    assert mark.get_attribute("title") == "나해 시작"
    assert cell.locator(".cal-name").inner_text() == "대림1주"
    assert cell.get_attribute("aria-label") == "11월 29일 일요일, 대림1주, 나해 시작, 자색"
    assert page.locator(".cal-mark").count() == 1


# ── ⑤ 탭 복원 ──

def test_calendar_tab_always_goes_to_the_list_at_today(mobile_context):
    """캘린더 탭은 어디서 누르든 오늘 줄이 맨 위인 목록이다(사용자 결정 2026-11-27). 줄을 눌러 연 전례독서, 다른 탭, 스크롤한 목록, 날짜를 넘긴
    전례독서, 저장해 둔 보기가 있어도 같다. 전에는 마지막으로 본 화면이나 보기로 돌아갔다(ADR-038 §1 「검토한 대안」 A)."""
    mobile_context.add_init_script("localStorage.setItem('bible-calendar-last-view', '/calendar/list/2027-03-15');")
    page = mobile_context.new_page()
    today = datetime.date.today().isoformat()
    tab = lambda: page.locator("#tab-bar [data-tab='calendar']").click()

    def at_today():
        page.wait_for_url(f"{BASE}/calendar/list")
        page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")
        page.wait_for_timeout(300)
        assert abs(_row_top_under_head(page, today)) <= 2   # 오늘 줄이 맨 위다
        assert _row(page, today).get_attribute("aria-current") == "date"

    _open_list(page, "calendar/list/2026-12-25")
    _press(page, 'li[data-date="2026-12-25"] a.cal-row')
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#page-title a.lect-datenav-btn[aria-label='다음날']").click()   # 날짜를 넘긴 전례독서
    page.wait_for_url("**/lectionary/2026-12-26*")
    page.wait_for_selector(".lect-day", timeout=20_000)
    tab()
    at_today()
    _scroll_down_until(page, (datetime.date.today() + datetime.timedelta(days=40)).isoformat())   # 스크롤한 목록
    tab()
    at_today()
    page.locator("#tab-bar [data-tab='bookmarks']").click()   # 다른 탭
    page.wait_for_url("**/bookmarks")
    tab()
    at_today()


def test_calendar_tab_on_the_desktop_month_also_goes_to_the_list(desktop_context):
    """큰 화면의 월간에서 헤더의 캘린더 단추를 눌러도 오늘 줄의 목록이다(사용자 결정 2026-11-27)."""
    page = desktop_context.new_page()
    _open(page, "calendar/2027-03")
    page.locator("#header-calendar").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")


def test_last_calendar_view_survives_reopening_the_app(desktop_context):
    """마지막 캘린더 보기는 앱을 다시 열어도 남는다(전례독서 머리의 오른쪽 단추가 쓴다). 전례독서 화면과 잘못된 주소는 기억하지 않는다(ADR-038 §1)."""
    page = desktop_context.new_page()
    _open(page, "calendar/2027-03")
    page.evaluate("navigate('/lectionary/2027-03-21')")
    page.wait_for_selector(".lect-day", timeout=20_000)
    _open(page, "calendar/2026-13")   # 실패 화면 — 기억하지 않는다
    assert page.locator(".calendar .empty-state-title").count() == 1
    page.goto(BASE)
    page.wait_for_selector(".book-list")
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/2027-03"


def test_modifier_click_on_calendar_tab_leaves_this_page_alone(mobile_context):
    """⌘ · Ctrl-클릭은 새 탭 몫 — 지금 화면(북마크)은 캘린더 목록으로 옮겨 가지 않는다(PR #348 리뷰: 그전엔
    preventDefault 뒤 같은 탭에서 독서 화면으로 이동해 새 탭 열기를 무시했다)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-25")
    _press(page, 'li[data-date="2026-12-25"] a.cal-row')
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#tab-bar [data-tab='bookmarks']").click()
    page.wait_for_url("**/bookmarks")
    with mobile_context.expect_page(timeout=5_000) as opened:
        page.locator("#tab-bar [data-tab='calendar']").click(modifiers=["ControlOrMeta"])
    opened.value.close()
    page.wait_for_timeout(300)
    assert page.url == f"{BASE}/bookmarks"


# ── ⑥ 좁은 화면 ──

def test_month_fits_the_narrowest_large_layout_without_horizontal_scroll(browser):
    """큰 화면 가운데 가장 좁은 폭(700px, ADR-050 §2)에서 월간 표가 화면 안에 있고 가로 스크롤이 없다."""
    ctx = browser.new_context(viewport={"width": 700, "height": 600})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        for month in ("2026-09", "2026-11", "2027-03"):
            _open(page, f"calendar/{month}")
            over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            assert over == 0, (month, over)
            right = page.evaluate("() => document.querySelector('.cal-grid').getBoundingClientRect().right")
            assert right <= 700, (month, right)
    finally:
        ctx.close()


def test_calendar_tab_dock_fits_320px(browser):
    """320px 폭(가장 좁은 폰)에서 달력의 주소를 열어도 가로 스크롤이 없고 탭 dock이 화면 안이다(캘린더 탭이 더해져도)."""
    ctx = browser.new_context(viewport={"width": 320, "height": 640}, user_agent=IPHONE_UA, is_mobile=True, has_touch=True)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        _open(page, "calendar/2026-11")
        assert page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth") == 0
        dock = page.evaluate("() => Math.max(...[...document.querySelectorAll('#tab-bar, #tab-search')].map(e => e.getBoundingClientRect().right))")
        assert dock <= 320, dock
    finally:
        ctx.close()


# ── ⑦ 잘못된 달 · 자료 실패 · 데스크톱 입구 ──

def test_invalid_month_shows_notice_with_link_to_this_month(desktop_context):
    """/calendar/2026-13 · 계산 범위 밖 1500-01 — 「잘못된 날짜입니다」 + 이번 달 링크.
    링크는 전체 화면 실패의 다음 행동 — 높이가 터치 타깃(44px) 이상이다(DESIGN.md §6 · §8 — 그전엔 26px 칩). 부제는 그
    단추 이름으로 할 일을 말한다(coding-pitfalls §29 — PR #355 리뷰)."""
    page = desktop_context.new_page()
    for bad in ("calendar/2026-13", "calendar/1500-01", "calendar/abc"):
        _open(page, bad)
        assert "잘못된 날짜입니다" in page.inner_text(".calendar")
        assert page.inner_text(".empty-state-subtitle").endswith("「이번 달 캘린더」를 눌러 주세요.")
    link = page.locator(".state-action a")
    assert link.inner_text() == "이번 달 캘린더"
    assert link.bounding_box()["height"] >= 44
    link.click()
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(".cal-grid")


def test_preload_failure_shows_calendar_error(browser):
    """교회력 자료(정의 표)를 받지 못하면 이 뷰의 실패 화면 — 앞 화면이 남지 않는다. 다음 행동은 「다시 불러오기」(화면 모듈을
    받지 못했을 때와 같은 화면)이고, 누르면 실패한 그 달이 다시 열린다 — 그전의 「이번 달 캘린더」는 /calendar/2027-03에서
    실패한 3월이 아니라 이번 달로 갔다(PR #355 리뷰)."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        ctx.route("**/data/lectionary/sanctoral.json", lambda route: route.abort())
        page = ctx.new_page()
        _open(page, "calendar/2027-03")
        assert "교회력 자료를 불러오지 못했습니다" in page.inner_text(".calendar")
        assert page.inner_text(".empty-state-subtitle") == "네트워크 연결을 확인한 뒤 「다시 불러오기」를 눌러 주세요."
        assert page.locator(".cal-grid").count() == 0
        ctx.unroute("**/data/lectionary/sanctoral.json")
        page.locator(".state-action button").click()
        page.wait_for_selector(".cal-grid", timeout=20_000)
        assert page.url == f"{BASE}/calendar/2027-03"
        assert page.inner_text(".cal-month") == "2027년 3월"
    finally:
        ctx.close()


def test_desktop_top_bar_has_calendar_and_bible_tabs(desktop_context):
    """데스크톱 — 탭 바가 없어 상단 바의 「캘린더」 탭이 입구, 「성서」 탭은 성서 목록으로(ADR-043 §3)."""
    page = desktop_context.new_page()
    page.goto(BASE)
    page.wait_for_selector(".book-list", timeout=20_000)
    assert not page.locator("#tab-dock").is_visible()
    btn = page.locator("#header-calendar")
    assert btn.is_visible()
    assert btn.inner_text().strip() == "캘린더"
    btn.click()   # 탭과 같이 오늘 줄의 목록으로 간다(사용자 결정 2026-11-27)
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(".cal-rows")
    assert btn.get_attribute("aria-current") == "page"
    home = page.locator("#header-home")
    assert home.is_visible() and home.inner_text().strip() == "성서"
    home.click()
    page.wait_for_url(f"{BASE}/")
    page.wait_for_selector(".book-list")


def test_desktop_header_calendar_entry_goes_where_the_tab_goes(desktop_context):
    """헤더의 캘린더 단추는 탭과 같은 곳, 곧 어디서 누르든 오늘 줄의 목록으로 간다(사용자 결정 2026-10-15, 2026-11-27)."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-12")
    page.evaluate("navigate('/lectionary/2026-12-25')")
    page.wait_for_selector(".lect-day", timeout=20_000)
    for start in ("/", "/lectionary/2026-12-25"):
        page.evaluate(f"navigate('{start}')")
        page.wait_for_selector(".book-list" if start == "/" else ".lect-day", timeout=20_000)
        page.locator("#header-calendar").click()
        page.wait_for_url(f"{BASE}/calendar/list")
        page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")


def test_header_calendar_entry_hidden_on_mobile(mobile_context):
    """모바일 — 상단 바의 탭이 숨어 캘린더 입구는 탭 바뿐이다."""
    page = mobile_context.new_page()
    page.goto(BASE)
    page.wait_for_selector(".book-list", timeout=20_000)
    assert not page.locator("#header-calendar").is_visible()
    assert page.locator("#tab-bar [data-tab='calendar']").is_visible()


# ── ⑧ 달 이동 뒤 포커스 ──

def _focused(page):
    return page.evaluate("""() => {
        const a = document.activeElement;
        return { key: a?.dataset?.focusKey || null, inHead: !!a?.closest('#page-title'), visible: !!a?.matches(':focus-visible') };
    }""")


def test_month_nav_keeps_keyboard_focus_on_the_pressed_control(desktop_context):
    """키보드로 「다음 달」 · 「이전 달」 · 「오늘」을 눌러 표를 다시 그려도 포커스가 새 머리 줄의 같은 컨트롤에 있다 —
    Enter 만 거듭 눌러 달을 넘긴다(WCAG 2.4.3 · PR #348 리뷰: 그전엔 누른 링크가 사라져 포커스가 body 로 빠졌다).
    계산 범위 끝(9999년 12월)에서 「다음 달」이 사라지면 「오늘」로."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-12")
    page.locator(".lect-datenav-btn[aria-label='다음 달']").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".cal-month:has-text('2027년 1월')")
    assert _focused(page) == {"key": "next", "inHead": True, "visible": True}
    page.keyboard.press("Enter")
    page.wait_for_selector(".cal-month:has-text('2027년 2월')")
    assert _focused(page)["key"] == "next"
    page.locator(".lect-datenav-btn[aria-label='이전 달']").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".cal-month:has-text('2027년 1월')")
    assert _focused(page)["key"] == "prev"
    page.locator("#page-title .lect-today").focus()
    page.keyboard.press("Enter")   # 「오늘」은 오늘의 전례독서로 간다(사용자 결정 2026-11-27). 포커스는 그 화면의 「오늘」에 있다
    page.wait_for_url(f"{BASE}/lectionary")
    page.wait_for_selector(".lect-day", timeout=20_000)
    assert _focused(page)["key"] == "today"
    _open(page, "calendar/9999-11")
    page.locator(".lect-datenav-btn[aria-label='다음 달']").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".cal-month:has-text('9999년 12월')")
    assert page.locator(".lect-datenav-btn[aria-label='다음 달']").count() == 0
    assert _focused(page)["key"] == "today"


def _month_nav(page):
    """달 이동 줄에 보이는 달 글자와 ‹ ›, 「오늘」, 달력을 내리는 단추의 자리. `start`는 상단 바의 글이 시작하는 자리다."""
    return page.evaluate("""() => {
      const t = document.getElementById('page-title');
      const shown = [...t.querySelectorAll('.cal-month .fit-len')].find((e) => e.getClientRects().length);
      const box = (s) => t.querySelector(s).getBoundingClientRect();
      const m = shown.getBoundingClientRect(), today = box('.lect-today');
      return { text: shown.textContent, left: m.left, right: m.right, top: m.top, bottom: m.bottom, lines: shown.getClientRects().length,
               start: t.getBoundingClientRect().left + parseFloat(getComputedStyle(t).paddingLeft),
               prev: box("a.lect-datenav-btn[data-focus-key='prev']").left, next: box("a.lect-datenav-btn[data-focus-key='next']").right,
               todayLeft: today.left, todayRight: today.right, todayMid: (today.top + today.bottom) / 2, drop: box('.cal-picker-trigger').left,
               scrollWidth: document.documentElement.scrollWidth };
    }""")


def test_month_nav_starts_the_month_at_the_left_and_shortens_when_narrow(mobile_context):
    """달의 글자는 상단 바의 왼쪽에서 시작하고, ‹ › 「오늘」 달력 단추는 그 오른쪽에 차례로 있다(ADR-061 §2). 가장 긴 달(「2027년 12월」)이
    들어가지 않으면 모든 달을 두 자리 연도(「27년 12월」)로 줄이고, 달 앞에 0을 붙이지 않는다. 스크린 리더는 전체 이름을 읽는다(ADR-061 §4)."""
    page = mobile_context.new_page()
    _open(page, "calendar/2027-12")
    for width in (320, 360, 390, 430):
        page.set_viewport_size({"width": width, "height": 844})
        page.wait_for_timeout(100)
        state = _month_nav(page)
        assert state["text"] == "2027년 12월", (width, state)
        assert abs(state["left"] - state["start"]) <= 1, (width, state)
        assert state["right"] <= state["prev"] + 0.5 and state["next"] <= state["todayLeft"] + 0.5, (width, state)
        assert state["todayRight"] <= state["drop"] + 0.5, (width, state)
        assert state["scrollWidth"] == width, (width, state)
    page.set_viewport_size({"width": 320, "height": 844})
    page.evaluate("() => { document.documentElement.style.fontSize = '20px'; }")
    page.wait_for_timeout(300)   # 제목 줄의 크기 감시가 다시 잰다
    state = _month_nav(page)
    assert state["text"] == "27년 12월", state
    assert abs(state["left"] - state["start"]) <= 1 and state["right"] <= state["prev"] + 0.5, state
    assert page.locator("#page-title .cal-month .sr-only").text_content() == "2027년 12월"   # 줄였어도 전체 이름을 읽는다
    assert page.evaluate("() => [...document.querySelectorAll('#page-title .cal-month .fit-len')].every((e) => e.getAttribute('aria-hidden') === 'true')")
    page.evaluate("() => { document.documentElement.style.fontSize = ''; }")
    _open(page, "calendar/2027-05")   # 짧은 달도 같은 조건에서 같이 줄고, 달 앞에 0을 붙이지 않는다
    page.evaluate("() => { document.documentElement.style.fontSize = '20px'; }")
    page.wait_for_timeout(300)
    assert _month_nav(page)["text"] == "27년 5월"


def test_month_nav_stays_on_one_line_with_the_largest_font_on_320px(mobile_context):
    """글자 크기 24px로 320px에서도 달과 단추가 한 줄에 다 보인다. 달은 「27년 12월」이고 ‹ 와 겹치거나 가로로 넘치지 않는다."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 320, "height": 700})
    _open(page, "calendar/2027-12")
    page.evaluate("() => { document.documentElement.style.fontSize = '24px'; }")
    page.wait_for_timeout(300)   # 제목 줄의 크기 감시가 다시 잰다
    state = _month_nav(page)
    assert state["text"] == "27년 12월", state
    assert state["lines"] == 1 and state["right"] <= state["prev"] + 0.5, state
    assert state["top"] <= state["todayMid"] <= state["bottom"], state
    assert state["scrollWidth"] == 320, state


# ── ⑨ 세 화면의 같은 상단 바(사용자 결정 2026-11-07) ──

def _bar(page):
    """상단 바 단추의 자리. 화면에 보이지 않는 단추는 None 이다."""
    return page.evaluate("""() => {
      const box = (s) => { const e = document.querySelector('#page-title ' + s); if (!e) return null;
                           const r = e.getBoundingClientRect(); return r.width ? { left: r.left, right: r.right } : null; };
      return { home: box('.title-home-btn'), today: box('.lect-today'), prev: box("a.lect-datenav-btn[data-focus-key='prev']"),
               next: box("a.lect-datenav-btn[data-focus-key='next']"), view: box('.title-view-btn') };
    }""")


def test_list_and_lectionary_share_the_head_row(mobile_context):
    """작은 화면의 목록과 전례독서의 상단 바는 같은 줄(왼쪽에 글자, 오른쪽에 ‹ › 「오늘」 달력 단추, ADR-061 §2)이고 단추가 같은 자리에 있다.
    달력에서 날짜를 눌러도 단추가 움직이지 않는다. 「캘린더」 글자와 표 위의 달 이동 줄은 없고, 「캘린더」는 문서 제목에 남는다."""
    page = mobile_context.new_page()
    for width in (320, 390, 430):
        page.set_viewport_size({"width": width, "height": 844})
        _open(page, "calendar/2027-12")
        month = _bar(page)
        assert "캘린더" in page.evaluate("() => document.title")
        assert "캘린더" not in page.inner_text("#page-title")
        assert page.locator(".calendar .lect-today").count() == 0
        assert page.get_attribute("#page-title button.title-view-btn", "aria-label") == "2027년 12월, 날짜 고르기"   # 달력을 내리는 단추(ADR-058 §3)
        page.goto(f"{BASE}/lectionary/2026-12-30")
        page.wait_for_selector(".lect-day", timeout=20_000)
        day = _bar(page)
        for key in ("today", "prev", "next", "view"):
            assert abs(month[key]["left"] - day[key]["left"]) <= 1, (width, key, month, day)
        assert day["prev"]["right"] <= day["next"]["left"] + 0.5 and day["next"]["right"] <= day["today"]["left"] + 0.5, (width, day)
        assert day["today"]["right"] <= day["view"]["left"] + 0.5, (width, day)
        assert day["view"]["right"] - day["view"]["left"] >= 44, (width, day)
        assert day["home"] is None and month["home"] is None   # 모바일은 탭 바가 집 단추를 대신한다


def test_lectionary_view_button_goes_to_the_month_of_the_date_shown(desktop_context):
    """전례독서 상단 바의 오른쪽 단추는 지금 보는 날짜가 있는 달로 간다. ‹ ›로 달을 넘겼으면 넘긴 날짜의 달이다. 탭 바의 캘린더 탭은 마지막으로
    본 보기로 가므로 다르다(ADR-038 §1). 큰 화면의 단추다. 작은 화면의 같은 자리는 달력을 내리는 단추다(ADR-058 §3)."""
    page = desktop_context.new_page()
    page.goto(f"{BASE}/lectionary/2027-01-01")
    page.wait_for_selector(".lect-day", timeout=20_000)
    button = page.locator("#page-title .title-view-btn")
    assert button.get_attribute("aria-label") == "월간으로 보기"
    assert button.get_attribute("title") == "월간으로 보기"
    assert button.get_attribute("href") == "/calendar/2027-01"
    page.locator("#page-title a.lect-datenav-btn[aria-label='전날']").click()
    page.wait_for_selector("#page-title .lect-date time[datetime='2026-12-31']")
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_url(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")


def test_desktop_head_has_no_book_list_button_on_both_views(desktop_context):
    """데스크톱의 성서 목록 입구는 상단 바의 「성서」 탭이다. 월간과 전례독서의 제목 줄에 집 단추가 없고, 「오늘」은 › 오른쪽에 있다
    (ADR-043 §1, §3 — 그전엔 「오늘」 앞에 집 단추가 있었다)."""
    page = desktop_context.new_page()
    for path in ("calendar/2026-12", "lectionary/2026-12-30"):
        page.goto(f"{BASE}/{path}")
        page.wait_for_selector("#page-title .lect-date", timeout=20_000)
        state = _bar(page)
        assert state["home"] is None and state["next"]["right"] <= state["today"]["left"] + 8, (path, state)
    page.locator("#header-home").click()
    page.wait_for_selector(".book-list", timeout=20_000)


def test_month_steps_start_the_new_month_at_the_top(desktop_context):
    """달 이동은 스크롤해도 보이는 머리에 있다. 스크롤한 자리에서 다음 달을 누르면 새 달은 맨 위부터이고 포커스는 누른 단추에 남는다
    (전례독서의 날짜 이동과 같다)."""
    page = desktop_context.new_page()
    page.set_viewport_size({"width": 900, "height": 600})
    _open(page, "calendar/2026-12")
    page.evaluate("document.querySelector('.calendar').style.minHeight = '1200px'")   # 스크롤할 만큼 길게 한다
    page.evaluate("() => window.scrollTo({ top: 300, behavior: 'instant' })")
    page.wait_for_function("() => window.scrollY > 100")
    page.locator("#page-title a.lect-datenav-btn[data-focus-key='next']").click()
    page.wait_for_selector(".cal-month:has-text('2027년 1월')")
    page.wait_for_timeout(200)
    assert page.evaluate("() => window.scrollY") == 0
    assert page.evaluate("() => document.activeElement.dataset.focusKey") == "next"


# ── ⑩ 목록 보기(사용자 결정 2026-11-07, ADR-038 §2 「목록 보기」) ──

# Safari 27 전을 흉내 낸다. 코드의 판별 값을 거짓으로 하고 브라우저의 스크롤 고정도 끈다.
NO_SCROLL_ANCHORING = """
const supports = CSS.supports.bind(CSS);
CSS.supports = (...args) => args[0] === 'overflow-anchor' ? false : supports(...args);
document.addEventListener('DOMContentLoaded', () => {
    document.documentElement.style.overflowAnchor = 'none';
    document.body.style.overflowAnchor = 'none';
});
"""
both_anchorings = pytest.mark.parametrize("anchoring", [True, False], ids=["anchoring", "no-anchoring"])


def _list_page(context, anchoring):
    """스크롤 고정이 없는 경우에는 웹 글꼴을 막는다. Safari 27 전의 기기는 모두 애플 기기라 줄에 시스템 글꼴을 쓰고 웹 글꼴을 받지 않는다."""
    if not anchoring:
        context.add_init_script(NO_SCROLL_ANCHORING)
        context.route(re.compile(r"fonts\.(googleapis|gstatic)\.com"), lambda route: route.abort())
    return context.new_page()


def _open_list(page, path):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(".cal-rows", timeout=20_000)
    page.wait_for_timeout(100)


def _row(page, date):
    return page.locator(f"li[data-date='{date}'] a.cal-row")


def _month_top_under_head(page, month):
    """그 달 묶음의 위쪽과 상단 바 아래쪽의 거리."""
    return page.evaluate("""m => document.querySelector(`section[data-month="${m}"]`).getBoundingClientRect().top
        - document.getElementById('sticky-group').getBoundingClientRect().bottom""", month)


def _scroll_down_until(page, date):
    """그 날짜의 줄이 그려질 때까지 맨 아래로 스크롤하고, 그 줄을 상단 바 바로 아래에 둔다."""
    page.evaluate("""async d => {
        const frame = () => new Promise(requestAnimationFrame);
        const find = () => document.querySelector(`li[data-date="${d}"]`);
        for (let i = 0; i < 600 && !find(); i++) {
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
            await frame();
        }
        // 그린 줄의 끝에 가까우면 문서 끝에 막혀 올라오지 못하므로, 아래쪽 줄이 더해지는 동안 거듭 스크롤한다
        const gap = () => find().getBoundingClientRect().top - (document.getElementById('sticky-group').getBoundingClientRect().bottom + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0));
        for (let i = 0; i < 120 && Math.abs(gap()) > 1; i++) {
            window.scrollBy({ top: gap(), behavior: 'instant' });
            await frame();
        }
        await frame();
    }""", date)


def _row_tops_from_the_top(page, date, frames=60):
    """맨 위로 보낸 뒤 프레임마다 그 줄의 화면 위치를 잰다. 줄을 더하는 순간을 놓치지 않게 페이지 안에서 잰다."""
    return page.evaluate("""async ({ date, frames }) => {
        const row = document.querySelector(`li[data-date="${date}"]`);
        window.scrollTo({ top: 0, behavior: 'instant' });
        const tops = [];
        for (let i = 0; i < frames; i++) {
            await new Promise(requestAnimationFrame);
            tops.push(row.getBoundingClientRect().top);
        }
        return tops;
    }""", {"date": date, "frames": frames})


def _largest_jump(tops):
    return max(abs(b - a) for a, b in zip(tops, tops[1:]))


def _scroll_up_by_frames(page, step, frames):
    """프레임마다 위로 스크롤하며 맨 위 줄의 날짜와 스크롤 값, 보던 줄이 프레임마다 움직인 거리를 잰다."""
    return page.evaluate("""async ({ step, frames }) => {
        const seen = () => [...document.querySelectorAll('li[data-date]')].find((li) => li.getBoundingClientRect().top > 100);
        const firsts = [], ys = [], moved = [];
        let row = seen(), top = row.getBoundingClientRect().top;
        for (let i = 0; i < frames; i++) {
            window.scrollBy({ top: -step, behavior: 'instant' });
            await new Promise(requestAnimationFrame);
            moved.push(row.getBoundingClientRect().top - top);
            firsts.push(document.querySelector('li[data-date]').dataset.date);
            ys.push(window.scrollY);
            row = seen();
            top = row.getBoundingClientRect().top;
        }
        return { firsts, ys, moved };
    }""", {"step": step, "frames": frames})


def _touch(page, kind, fingers_left):
    """터치 사건을 낸다. 코드는 화면에 남은 손가락 수(`touches`)를 본다."""
    page.evaluate("""([kind, left]) => window.dispatchEvent(Object.assign(new Event(kind), { touches: Array(left) }))""", [kind, fingers_left])


def _viewport_top(page, date):
    """그 날짜의 줄 위쪽이 화면 위에서 떨어진 거리."""
    return page.evaluate("""d => document.querySelector(`li[data-date="${d}"]`).getBoundingClientRect().top""", date)


def _dates(page):
    return page.evaluate("() => [...document.querySelectorAll('li[data-date]')].map((li) => li.dataset.date)")


def _assert_consecutive(dates):
    days = [datetime.date.fromisoformat(d) for d in dates]
    assert all(b - a == datetime.timedelta(days=1) for a, b in zip(days, days[1:])), dates


def _row_top_under_head(page, date):
    """그 날짜의 줄 위쪽과 맨 위 줄의 선(상단 바 아래쪽에 고정된 주간 라벨의 높이를 더한 자리, ADR-060 §2)의 거리."""
    return page.evaluate("""d => document.querySelector(`li[data-date="${d}"]`).getBoundingClientRect().top
        - (document.getElementById('sticky-group').getBoundingClientRect().bottom + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0))""", date)


def test_view_button_switches_between_month_and_list_keeping_the_month(desktop_context):
    """월간의 오른쪽 단추는 목록으로, 목록의 단추는 월간으로 간다. 보던 달을 유지하고, 아이콘은 누르면 갈 보기를 보인다."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-12")
    button = page.locator("#page-title .title-view-btn")
    assert button.get_attribute("aria-label") == "목록으로 보기"
    box = button.bounding_box()
    assert box and box["width"] >= 44 and box["height"] >= 44, box
    button.click()
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-01")
    page.wait_for_selector(".cal-rows")
    assert page.inner_text(".cal-month") == "2026년 12월"
    assert page.locator(".cal-grid").count() == 0
    assert page.locator("section[data-month='2026-12'] .cal-list-month").inner_text() == "2026년 12월"
    assert page.evaluate("() => document.title").startswith("2026년 12월 캘린더 목록")
    assert page.evaluate("() => document.activeElement.dataset.focusKey") == "view"
    button = page.locator("#page-title .title-view-btn")
    assert button.get_attribute("aria-label") == "월간으로 보기"
    assert button.get_attribute("href") == "/calendar/2026-12"
    button.click()
    page.wait_for_url(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-grid")


def test_this_month_switches_to_todays_row(desktop_context):
    """이번 달에서 목록으로 가면 주소는 /calendar/list이고 오늘 줄에 표시가 있다. 월간으로 돌아가면 /calendar다."""
    page = desktop_context.new_page()
    _open(page, "calendar")
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(".cal-rows")
    today = datetime.date.today().isoformat()
    row = _row(page, today)
    assert row.get_attribute("aria-current") == "date"
    assert row.get_attribute("aria-label").startswith("오늘, ")
    assert row.is_visible()
    assert page.locator(".cal-row--today").count() == 1
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_url(f"{BASE}/calendar")


def test_list_opens_at_the_row_of_the_address(mobile_context):
    """주소의 날짜 줄이 상단 바 바로 아래에 온다. 달의 첫날이면 달 이름부터 보인다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    assert abs(_row_top_under_head(page, "2026-12-15")) <= 2
    _open_list(page, "calendar/list/2026-12-01")
    assert abs(_month_top_under_head(page, "2026-12")) <= 2
    assert _row(page, "2026-12-01").is_visible()


@pytest.mark.only_browser("chromium")
def test_list_row_and_scroll_padding_follow_the_status_bar_height(mobile_context):
    """상태 표시줄 높이(`env(safe-area-inset-top)`)가 62px이어도 주소의 줄이 상단 바 바로 아래에 온다. 스크롤 여백(`scroll-padding-top`)은
    잰 상단 바 높이에 고정된 주간 라벨의 높이와 맨 위 줄로 치지 않는 8px을 더한 값이고, 기본 글자 크기의 휴대폰에서 상단 바는 60px에 상태 표시줄 높이를 더한 값이다(2026-11-07,
    상단 바 묶음이 그 높이를 안쪽 위 여백으로 둔다)."""
    inset = 62
    page = mobile_context.new_page()
    emulate_status_bar(page, inset)
    _open_list(page, "calendar/list/2026-12-15")
    assert abs(_row_top_under_head(page, "2026-12-15")) <= 2
    bar, head, padding = page.evaluate("""() => [document.getElementById('sticky-group').getBoundingClientRect().bottom,
        document.querySelector('.cal-week').getBoundingClientRect().height,
        parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)]""")
    assert abs(padding - bar - head - 8) <= 0.5, (bar, head, padding)   # 고정된 주간 라벨에 가려진 줄도 기준이 아니다(ADR-060 §2)
    assert abs(bar - (60 + inset)) <= 1, bar


def test_list_rows_are_announced_as_a_list(mobile_context):
    """글머리표를 없앤 목록은 Safari가 목록으로 알리지 않을 수 있어 role="list"를 둔다(성서 목록, 검색 목록과 같다)."""
    page = mobile_context.new_page()
    _open(page, "calendar/list/2026-12-25")
    page.wait_for_selector(".cal-rows")
    roles = page.eval_on_selector_all("ul.cal-rows", "uls => uls.map((ul) => ul.getAttribute('role'))")
    assert roles and set(roles) == {"list"}


def test_list_shows_every_day_with_the_lectionary_head_text(mobile_context):
    """평범한 평일도 줄이 있다. 평일 이름은 주간 라벨에만 있고, 그 밖의 줄의 글은 눌러서 간 전례독서의 제목 영역과 같다. 줄 끝에 ›를 두지
    않는다(ADR-060 §2)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-11-12")
    assert page.locator("section[data-month='2026-11'] .cal-row").count() == 30
    plain = _row(page, "2026-11-12")
    assert plain.locator(".cal-row-title").count() == 0   # 「연중 32주」는 주간 라벨에 있다
    assert plain.locator(".cal-row-day").inner_text() == "12"
    assert plain.locator(".cal-row-weekday").inner_text() == "목"
    assert plain.locator(".cal-row-line").count() == 0
    assert plain.locator(".cal-row-meta").count() == 0   # 색 이름과 해는 적지 않는다
    assert plain.locator(".cal-row-bar.lit-swatch--green").count() == 1
    assert "녹색" in plain.get_attribute("aria-label")
    assert plain.locator(".cal-row-office").inner_text() == "감사성찬례"
    assert "›" not in plain.inner_text()
    # 주간 라벨은 주일 줄과 달 묶음의 첫 줄 위에만 있다
    heads = page.evaluate("""() => [...document.querySelectorAll("section[data-month='2026-11'] .cal-week-group")]
        .map((g) => [g.querySelector("li[data-date]").dataset.date, g.querySelector(".cal-week").textContent])""")
    assert heads == [["2026-11-01", "연중 31주"], ["2026-11-08", "연중 32주"], ["2026-11-15", "연중 33주"],
                     ["2026-11-22", "연중 34주"], ["2026-11-29", "대림 1주"]], heads
    # 달 묶음의 첫 줄이 주일이 아니면 그 줄에도 주간 라벨을 다시 적는다. 위쪽에 한 주를 더하면 새 첫 줄로 옮겨 간다(처음 그린 첫날은 2주 앞의
    # 목요일이고, 화면이 위쪽 끝에 가까우면 한 주 앞의 목요일까지 더한다)
    first = page.evaluate("""() => { const groups = [...document.querySelectorAll("section[data-month='2026-10'] .cal-week-group")];
        const lead = (g) => g.querySelector("li[data-date]");
        return [lead(groups[0]).dataset.date, groups[0].querySelector(".cal-week").textContent, lead(groups[0]).dataset.week,
                groups.slice(1).filter((g) => !("sunday" in lead(g).dataset)).length]; }""")
    assert first[0] in ("2026-10-29", "2026-10-22") and first[1] == first[2] and first[3] == 0, first
    # 평일 이름 대신 그날 기리는 성인이 제목이고, 괄호 설명은 그 아래 줄이다
    leonard = _row(page, "2026-11-06")
    assert leonard.locator(".cal-row-title").inner_text() == "레오나드"   # 성인 이름 뒤의 「축일」은 뗀다(사용자 결정 2026-11-27)
    assert leonard.locator(".cal-row-subtitle").inner_text() == "은수자, 6세기"
    assert leonard.locator(".cal-row-line:not(.cal-row-subtitle)").count() == 0
    # 성인의 설명은 제목 바로 아래, 소재일과 축성일 줄보다 먼저다(사용자 결정 2026-11-27)
    assert leonard.locator(".cal-row-body > *").evaluate_all("els => els.map((e) => e.className.split(' ').pop())")[:3] == \
        ["cal-row-title", "cal-row-subtitle", "cal-row-meta"]
    # 소재일과 교회 축성일은 한 줄에 가운뎃점으로 잇는다(사용자 결정 2026-11-27). 가운뎃점은 앞 항목에 붙어 줄 머리에 오지 않는다
    assert leonard.locator(".cal-row-meta > span").all_inner_texts() == ["소재일", "삼흥리성당 축성"]   # 「축성일」은 「축성」으로 줄인다
    assert leonard.locator(".cal-row-meta").evaluate("m => getComputedStyle(m.children[0], '::after').content") == '"·"'
    for date in ("2026-12-07", "2026-12-24"):
        _open_list(page, f"calendar/list/{date}")
        row = _row(page, date)
        title = row.locator(".cal-row-title").inner_text()
        if row.locator(".cal-row-subtitle").count():   # 제목의 괄호 설명은 제목 아래 줄이다(성 니콜라)
            title = f"{title}({row.locator('.cal-row-subtitle').inner_text()})"
        lines = row.locator(".cal-row-line:not(.cal-row-subtitle)").all_inner_texts()
        meta = row.locator(".cal-row-meta > span").all_inner_texts()
        week = row.evaluate("a => a.closest('li').dataset.week")
        row.click()
        page.wait_for_url(f"**/lectionary/{date}")
        page.wait_for_selector(".lect-day", timeout=20_000)
        drop = lambda t: re.sub(r"^(.+ \d+주) [월화수목금토]요일(?=$| ·)", r"\1", t)   # 줄은 절기와 주 번호로 만든 이름의 요일을 뺀다
        assert drop(page.inner_text(".lect-day")) == title, date
        # 옮김 안내(.lect-day-note)는 목록에 적지 않고, 축성일은 소재일과 같은 줄(meta)이다(사용자 결정 2026-11-27)
        notes = page.locator(".lect-day-note").all_inner_texts()
        assert not any(n in lines or n in meta for n in notes), date
        short = lambda t: re.sub(r" (축성|축복)일$", r" \1", t)   # 목록은 「축성일」, 「축복일」을 줄인다(사용자 결정 2026-11-27)
        shown = ([t for t in page.locator(".lect-day-saint").all_inner_texts() if short(t) not in meta]
                 + [drop(t.replace(chr(10), "")) for t in page.locator(".lect-choice-text").all_inner_texts()])
        bare = lambda t: re.sub(r" (?:축일|기념일)$", "", t)   # 목록은 이름 뒤의 「축일」, 「기념일」을 뗀다(사용자 결정 2026-11-27)
        shown = [t for t in shown if t != week]
        feast = lambda t: t.endswith(" 축일")   # 다른 성인의 축일은 축성일, 기념일 줄보다 위다(사용자 결정 2026-11-27)
        assert [bare(t) for t in shown if feast(t)] + [bare(t) for t in shown if not feast(t)] == lines, date
        if date == "2026-12-07":
            assert notes == ["12월 6일에서 옮겨 옴"], notes   # 전례독서 화면에는 그대로 있다


def test_week_head_stays_under_the_bar_until_the_next_week_pushes_it_away(mobile_context):
    """주간 라벨은 상단 바에 닿으면 그 아래에 고정되고, 그 주의 마지막 줄이 지나가면 다음 주간 라벨에 밀려 사라진다. 그동안 주소의 날짜는 고정된
    라벨 바로 아래의 줄이다(ADR-060 §2, 사용자 결정 2026-11-27)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-02")
    stuck = """() => { const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        return [...document.querySelectorAll('.cal-week')].filter((h) => Math.abs(h.getBoundingClientRect().top - bar) <= 1).map((h) => h.textContent); }"""
    assert abs(_row_top_under_head(page, "2026-12-02")) <= 2   # 주 중간의 줄로 열면 그 줄이 라벨 바로 아래다
    assert page.evaluate(stuck) == ["대림 1주"]
    page.evaluate("""() => { const head = document.querySelector('.cal-week').getBoundingClientRect().height;
        const r = document.querySelector('li[data-date="2026-12-05"]').getBoundingClientRect();
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        window.scrollBy({ top: r.bottom - bar - head - 10, behavior: 'instant' }); }""")   # 토요일 줄의 끝 10px만 라벨 아래에 남긴다
    page.wait_for_timeout(400)
    assert page.evaluate(stuck) == ["대림 1주"]
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-05")
    page.evaluate("() => window.scrollBy({ top: 20, behavior: 'instant' })")   # 다음 주의 라벨이 앞 라벨을 밀어 올리는 동안에도 그림자가 있다
    page.wait_for_function("() => document.querySelectorAll('.cal-week.is-stuck').length === 1 && document.querySelector('.cal-week.is-stuck').textContent === '대림 1주'")
    page.evaluate("() => window.scrollBy({ top: 80, behavior: 'instant' })")   # 다음 주간 라벨이 앞 라벨을 밀어낸다
    page.wait_for_timeout(400)
    assert page.evaluate(stuck) == ["대림 2주"]
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-06")
    # 상단 바의 그림자 대신 고정된 라벨에만 그림자를 둔다(사용자 결정 2026-11-27)
    page.wait_for_function("() => document.querySelectorAll('.cal-week.is-stuck').length === 1")
    assert page.locator(".cal-week.is-stuck").inner_text() == "대림 2주"
    assert page.evaluate("() => getComputedStyle(document.getElementById('sticky-group')).boxShadow") == "none"
    page.wait_for_timeout(400)
    assert page.evaluate("() => getComputedStyle(document.querySelector('.cal-week.is-stuck')).boxShadow") != "none"
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")   # 맨 위에서는 라벨이 고정되지 않아 그림자가 없다
    page.wait_for_function("() => document.querySelectorAll('.cal-week.is-stuck').length === 0")


def test_date_cell_and_first_line_start_at_the_same_height(mobile_context):
    """날짜 칸의 날짜와 오른쪽 칸의 첫 줄(제목, 또는 제목이 없는 날의 소재일, 축성 줄)은 같은 높이에 놓인다. 글자 크기가 다른 첫 줄은
    가운데를 맞춘다(사용자 결정 2026-11-27). 상자가 아니라 글자 줄의 위치를 잰다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-06")
    # 2026-12-12는 장절만 있는 날이다. 장절 줄은 「감사성찬례」보다 큰 장절 글자를 잰다
    gaps = page.evaluate("""() => ['2026-12-06', '2026-12-07', '2026-12-09', '2026-12-11', '2026-12-12'].map((d) => {
        const li = document.querySelector(`li[data-date="${d}"]`);
        const mid = (el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getClientRects()[0]; return b.top + b.height / 2; };
        const first = li.querySelector('.cal-row-body').firstElementChild;
        const text = first.matches('.cal-row-readings') ? first.querySelector('.cal-row-ref') : (first.firstElementChild ?? first);
        return mid(text) - mid(li.querySelector('.cal-row-day')); })""")
    assert all(abs(g) <= 1 for g in gaps), gaps


def test_two_colours_of_the_saints_are_two_circles_in_one_row(mobile_context):
    """성인에 따라 「적색 또는 백색」인 날은 막대 대신 작은 원 둘을 한 줄에 나란히 둔다. 색 이름은 링크 이름에 있다
    (ADR-060 §2, 사용자 결정 2026-11-28. 그전에는 막대 둘을 위아래로 두었다)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-02-14")
    row = _row(page, "2026-02-14")
    assert "적색 또는 백색" in row.get_attribute("aria-label")
    marks = page.evaluate("""() => [...document.querySelectorAll('li[data-date="2026-02-14"] .cal-row-bar')].map((b) => {
        const r = b.getBoundingClientRect(); return [b.className.split(' ').pop(), r.top, r.left, r.right, r.width, r.height]; })""")
    assert [m[0] for m in marks] == ["lit-swatch--red", "lit-swatch--white"], marks
    assert abs(marks[1][1] - marks[0][1]) <= 0.5 and marks[1][2] >= marks[0][3], marks   # 같은 줄에 왼쪽부터 나란히
    assert all(abs(m[4] - m[5]) <= 0.5 for m in marks), marks   # 너비와 높이가 같은 원


def test_row_marks_sunday_weight_year_start_and_keeps_alternate_colours_out(mobile_context):
    """주일과 주요축일, 제목으로 올린 축일은 제목이 한 단계 굵고(500) 평일은 보통이다. 해(전례년 첫날의 「나해 시작」 포함)는 적지 않고,
    대체색은 줄에 없다(ADR-060 §2)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-11-12")
    weight = lambda date: page.evaluate("""d => getComputedStyle(document.querySelector(`li[data-date="${d}"] .cal-row-title`)).fontWeight""", date)
    assert weight("2026-11-08") == "500"
    assert weight("2026-11-06") == "500"
    _open_list(page, "calendar/list/2026-11-29")
    assert "나해" not in _row(page, "2026-11-29").inner_text()
    _open_list(page, "calendar/list/2026-12-13")
    assert weight("2026-12-21") == "400"   # 「성탄 4일 전」은 주간 라벨(대림 4주)과 달라 제목에 남는 평일 이름이다
    assert _row(page, "2026-12-13").locator(".cal-row-bar").count() == 1


def test_lectionary_button_returns_to_the_list_at_the_date_shown(desktop_context):
    """목록에서 들어간 전례독서의 오른쪽 단추는 목록 모양이고, 지금 보는 날짜의 줄로 돌아간다."""
    page = desktop_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    _press(page, 'li[data-date="2026-12-15"] a.cal-row')
    page.wait_for_url("**/lectionary/2026-12-15")
    page.wait_for_selector(".lect-day", timeout=20_000)
    button = page.locator("#page-title .title-view-btn")
    assert button.get_attribute("aria-label") == "목록으로 보기"
    assert button.get_attribute("href") == "/calendar/list/2026-12-15"
    page.locator("#page-title a.lect-datenav-btn[aria-label='다음날']").click()
    page.wait_for_selector("#page-title .lect-date time[datetime='2026-12-16']")
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-16")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(100)
    assert abs(_row_top_under_head(page, "2026-12-16")) <= 2


def test_list_month_steps_and_today(mobile_context):
    """목록의 ‹ ›는 앞뒤 달 1일의 줄로, 「오늘」은 오늘의 전례독서로 간다(사용자 결정 2026-11-27). 포커스는 누른 단추에 남는다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.locator("#page-title a.lect-datenav-btn[data-focus-key='next']").click()
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-01")
    page.wait_for_selector(".cal-month:has-text('2027년 1월')")
    page.wait_for_timeout(100)
    assert abs(_month_top_under_head(page, "2027-01")) <= 2
    assert page.evaluate("() => document.activeElement.dataset.focusKey") == "next"
    page.locator("#page-title a.lect-datenav-btn[data-focus-key='prev']").click()
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-01")
    page.locator("#page-title .lect-today").click()
    page.wait_for_url(f"{BASE}/lectionary")
    page.wait_for_selector(".lect-day", timeout=20_000)


def test_list_step_to_the_first_that_is_today_has_no_date(mobile_context):
    """매달 1일에 ‹ ›로 이번 달에 오면 그 1일이 오늘 줄이라 주소에 날짜가 없다(ADR-038 §2 「오늘 줄의 주소」)."""
    page = mobile_context.new_page()
    page.clock.set_fixed_time(datetime.datetime(2026, 12, 1, 12))
    _open_list(page, "calendar/list/2026-11-15")
    assert page.get_attribute("#page-title a.lect-datenav-btn[data-focus-key='next']", "href") == "/calendar/list"
    page.locator("#page-title a.lect-datenav-btn[data-focus-key='next']").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")
    assert _row(page, "2026-12-01").get_attribute("aria-current") == "date"


def test_tab_in_list_does_not_add_history_entries_at_the_same_address(mobile_context):
    """이미 /calendar/list이면 캘린더 탭을 거듭 눌러도 방문 기록이 늘지 않아, 뒤로 가기가 앞 화면으로 간다. 다시 그려서 오늘 줄로 돌아온다.
    작은 화면에서 월간 주소로 들어와도 방문 기록은 하나다(주소만 목록으로 바꾼다)."""
    page = mobile_context.new_page()
    page.goto(f"{BASE}/bookmarks")
    page.wait_for_selector("#tab-bar [data-tab='calendar']")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(".cal-rows")
    length = page.evaluate("() => history.length")
    for _ in range(3):
        page.locator("#tab-bar [data-tab='calendar']").click()
        page.wait_for_timeout(150)
    assert page.evaluate("() => history.length") == length
    assert page.locator(".cal-list").count() == 1
    assert _row(page, datetime.date.today().isoformat()).is_visible()
    page.go_back()
    page.wait_for_url(f"{BASE}/bookmarks")


def test_list_continues_below_and_the_bar_follows_the_top_row(mobile_context):
    """아래로 넘기면 줄이 이어지고, 달마다 달 이름이 하나씩 있으며, 상단 바의 달과 단추들이 맨 위 줄의 달을 따라간다(ADR-038 §2)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    prev_btn = page.locator("#page-title a[data-focus-key='prev']")
    prev_btn.focus()
    _scroll_down_until(page, "2027-01-15")
    _wait_month(page, "2027년 1월")
    assert page.locator("section[data-month='2027-01'] .cal-list-month").count() == 1
    _assert_consecutive(_dates(page))
    assert prev_btn.get_attribute("href") == "/calendar/list/2026-12-01"
    assert page.locator("#page-title a[data-focus-key='next']").get_attribute("href") == "/calendar/list/2027-02-01"
    # 표기 셋과 스크린 리더가 읽는 숨긴 글이 함께 바뀐다(ADR-061 §4)
    assert page.evaluate("""() => [...document.querySelectorAll('#page-title .cal-month .fit-len, #page-title .cal-month .sr-only')]
        .map((e) => e.textContent)""") == ["2027년 1월", "27년 1월", "1월", "2027년 1월"]
    # 다시 그리지 않고 고치므로 단추와 포커스가 그대로다
    assert page.evaluate("() => document.activeElement.dataset.focusKey") == "prev"
    # 달력을 내리는 단추의 달도 따라간다
    assert page.get_attribute("#page-title .cal-picker-trigger", "data-ym") == "2027-01"
    assert page.get_attribute("#page-title .cal-picker-trigger", "aria-label") == "2027년 1월, 날짜 고르기"


@both_anchorings
def test_list_continues_above_holding_the_row_in_place(mobile_context, anchoring):
    """맨 위로 올리면 위쪽 줄이 이어지고, 보던 줄은 그 자리에 있다. 스크롤 값이 0이면 브라우저가 고치지 않아 코드가 고친다(ADR-038 §2)."""
    page = _list_page(mobile_context, anchoring)
    _open_list(page, "calendar/list/2026-12-15")
    page.wait_for_timeout(1000)   # 처음의 위쪽 채우기를 기다린다
    first = _dates(page)[0]
    tops = _row_tops_from_the_top(page, first)
    assert _largest_jump(tops) <= 2
    assert _dates(page)[0] < first
    assert page.evaluate("() => window.scrollY") > 0
    _assert_consecutive(_dates(page))


def test_list_adds_rows_above_while_scrolling_when_the_browser_holds_the_row(mobile_context):
    """스크롤 고정이 있으면 스크롤 중에도 위쪽 줄을 더해, 빠르게 위로 넘겨도 맨 위에서 멈추지 않고 보던 줄이 튀지 않는다(사용자 결정 2026-11-07)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.wait_for_timeout(800)
    seen = _scroll_up_by_frames(page, 150, 60)
    assert seen["firsts"][-1] < seen["firsts"][0]
    assert min(seen["ys"]) > 0
    assert all(abs(d - 150) <= 2 for d in seen["moved"]), seen["moved"]
    _assert_consecutive(_dates(page))


def test_list_without_scroll_anchoring_adds_rows_above_after_scrolling_stops(mobile_context):
    """스크롤 고정이 없으면(Safari 27 전) 스크롤 중에도, 손가락이 닿아 있는 동안에도 위쪽 줄을 더하지 않는다. 관성이 끊기기 때문이다(WebKit 버그 187449)."""
    page = _list_page(mobile_context, False)
    _open_list(page, "calendar/list/2026-12-15")
    page.wait_for_timeout(1000)   # 처음의 위쪽 채우기를 기다린다
    first = _dates(page)[0]
    _touch(page, "touchstart", 2)
    seen = _scroll_up_by_frames(page, 40, 20)
    assert set(seen["firsts"]) == {first}
    page.wait_for_timeout(500)
    assert _dates(page)[0] == first
    _touch(page, "touchend", 1)   # 두 손가락 가운데 하나만 뗀다
    page.wait_for_timeout(500)
    assert _dates(page)[0] == first
    row = _dates(page)[40]
    before = _viewport_top(page, row)
    _touch(page, "touchend", 0)
    page.wait_for_function("d => document.querySelector('li[data-date]').dataset.date < d", arg=first)
    page.wait_for_timeout(100)
    assert abs(_viewport_top(page, row) - before) <= 2
    _assert_consecutive(_dates(page))


def test_list_at_the_very_top_adds_rows_above_only_after_scrolling_stops(mobile_context):
    """스크롤 고정이 있어도 스크롤 값이 0 이하(맨 위, iOS에서 튕기는 중)면 브라우저가 줄을 지키지 않아 코드가 스크롤 값을 고친다. 움직이는 중에
    고치면 iOS가 상단 바와 탭 바를 내용과 함께 움직이므로(iOS 27.2, 2026-11-26), 손을 떼고 멈춘 뒤에 더한다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.wait_for_timeout(1000)   # 처음의 위쪽 채우기를 기다린다
    first = _dates(page)[0]
    _touch(page, "touchstart", 1)
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
    page.wait_for_timeout(500)
    assert _dates(page)[0] == first
    row = _dates(page)[0]
    before = _viewport_top(page, row)
    _touch(page, "touchend", 0)
    page.wait_for_function("d => document.querySelector('li[data-date]').dataset.date < d", arg=first)
    page.wait_for_timeout(100)
    assert abs(_viewport_top(page, row) - before) <= 2
    assert page.evaluate("() => window.scrollY") > 0
    _assert_consecutive(_dates(page))


@both_anchorings
def test_desktop_list_holds_the_row_when_the_header_collapses(desktop_context, anchoring):
    """데스크톱은 맨 위에서 위쪽 줄을 더하면 상단 바의 윗줄이 접힌다. 줄은 그 높이(약 46px)보다 많이 움직이지 않고 화면에 남는다."""
    page = _list_page(desktop_context, anchoring)
    _open_list(page, "calendar/list/2026-12-15")
    page.wait_for_timeout(1000)
    first = _dates(page)[0]
    tops = _row_tops_from_the_top(page, first)
    assert _largest_jump(tops) <= 50
    assert page.evaluate("() => window.scrollY") > 0
    bar = page.evaluate("() => document.getElementById('sticky-group').getBoundingClientRect().bottom")
    assert bar < tops[-1] < page.viewport_size["height"]
    _scroll_down_until(page, "2027-02-10")
    _wait_month(page, "2027년 2월")


@both_anchorings
def test_desktop_list_puts_the_row_under_the_bar(desktop_context, anchoring):
    """데스크톱 — 월간에서 목록으로 가면 그 달의 줄이 상단 바 바로 아래에 있다. 상단 바는 스크롤해도 높이가 같다(ADR-043 §1)."""
    page = _list_page(desktop_context, anchoring)
    _open(page, "calendar/2026-12")
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(500)
    assert abs(_month_top_under_head(page, "2026-12")) <= 2


def test_desktop_list_leaves_the_scroll_alone_once_the_reader_scrolls(desktop_context):
    """목록이 열린 뒤 독자가 스크롤하면 그 자리에 둔다 — 줄을 다시 맞추지 않는다."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-12")
    page.wait_for_timeout(1000)
    page.mouse.move(640, 400)
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_selector(".cal-rows")
    page.mouse.move(640, 400)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(700)
    assert _month_top_under_head(page, "2026-12") < -200


@pytest.mark.parametrize("width, font", [(390, 16), (390, 24), (1280, 24)], ids=["phone-16", "phone-24", "desktop-24"])
def test_list_scroll_padding_is_the_measured_bar_height(browser, width, font):
    """목록의 스크롤 여백(`scroll-padding-top`)은 잰 상단 바의 높이(`--top-bar-h`, helpers.js `publishBarHeight`)에 고정된 주간 라벨의 높이(`--cal-week-h`, ADR-060 §2)와 맨 위 줄로 치지 않는 8px을 더한 값이다. 상단 바는 글자 크기를
    따라 높아지고 낮아진다(글자 크기 16px에서 약 57px, 24px에서 약 70px). 60px로 적었을 때는 그 차이만큼 스크롤 고정이 상단 바에 가려진
    줄을 기준으로 삼거나 보이는 줄을 건너뛰었다."""
    ctx = browser.new_context(viewport={"width": width, "height": 800}, user_agent=IPHONE_UA if width < 700 else None)
    ctx.add_init_script(CLEAR_APP_STORAGE + f"localStorage.setItem('bible-font-size', '{font}');")
    measure = """() => ({
        padding: parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop),
        bar: document.getElementById('sticky-group').getBoundingClientRect().bottom,
        head: document.querySelector('.cal-week').getBoundingClientRect().height,
    })"""
    try:
        page = ctx.new_page()
        _open_list(page, "calendar/list/2026-12-15")
        page.wait_for_timeout(1000)
        state = page.evaluate(measure)
        assert abs(state["padding"] - state["bar"] - state["head"] - 8) <= 0.5, state
    finally:
        ctx.close()


def test_a_sliver_of_the_previous_row_does_not_move_the_row_when_it_grows(mobile_context):
    """상단 바 밑으로 앞줄이 1px 보이는 채 그 앞줄이 길어져도(늦게 온 글꼴로 한 줄 늘어난 때) 보던 달의 자리는 그대로다. 앞줄이 스크롤 고정의
    기준이면 그만큼 아래로 밀리고 주소가 하루 앞날로 바뀌었다(2026-11-26)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-11-01")
    page.wait_for_timeout(800)
    page.evaluate("""() => { const s = document.querySelector("section[data-month='2026-11']").getBoundingClientRect().top;
        const b = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        window.scrollBy({ top: s - b - 1, behavior: 'instant' }); }""")   # 앞줄(10월 31일)의 끝 1px이 보인다
    page.wait_for_timeout(400)
    before = _month_top_under_head(page, "2026-11")
    assert 0 < before <= 2, before
    page.evaluate("""() => { const line = document.createElement('span'); line.className = 'cal-row-line'; line.textContent = '늘어난 줄';
        document.querySelector('li[data-date="2026-10-31"] .cal-row-body').append(line); }""")
    page.wait_for_timeout(400)
    assert abs(_month_top_under_head(page, "2026-11") - before) <= 2
    assert page.url == f"{BASE}/calendar/list/2026-11-01"


def test_list_month_end_row_reaches_under_the_bar(mobile_context):
    """달의 끝날도 상단 바 바로 아래에 온다. 다음 달이 이어지기 때문이다. 웹 글꼴을 늦게 받아 위쪽 줄의 줄바꿈이 바뀌어도 그 자리에 있다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-31")
    page.wait_for_function("() => document.fonts.status === 'loaded'", timeout=15_000)
    page.wait_for_timeout(1000)
    assert abs(_row_top_under_head(page, "2026-12-31")) <= 2
    assert _shown_month(page) == "2026년 12월"


@both_anchorings
def test_list_takes_down_far_rows_holding_the_row_in_place(mobile_context, anchoring):
    """멀리 넘기면 스크롤이 멈춘 뒤 먼 줄을 내려 약 200일만 둔다. 보던 줄은 그 자리에 있고, 다시 올리면 위쪽 줄이 이어진다."""
    page = _list_page(mobile_context, anchoring)
    _open_list(page, "calendar/list/2026-12-15")
    _scroll_down_until(page, "2027-12-15")
    before = _viewport_top(page, "2027-12-15")
    page.wait_for_function("() => document.querySelectorAll('li[data-date]').length <= 196")
    page.wait_for_timeout(100)
    assert abs(_viewport_top(page, "2027-12-15") - before) <= 2
    assert page.locator("li[data-date='2026-12-15']").count() == 0
    assert page.locator("section[data-month='2026-12']").count() == 0
    _assert_consecutive(_dates(page))
    first = _dates(page)[0]
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
    page.wait_for_function("d => document.querySelector('li[data-date]').dataset.date < d", arg=first)
    _assert_consecutive(_dates(page))


def test_list_keeps_the_focused_row_when_taking_down_far_rows(mobile_context):
    """포커스가 있는 줄은 멀어져도 내리지 않는다. 키보드와 스크린 리더 사용자가 자리를 잃지 않는다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.evaluate("""() => document.querySelector('li[data-date="2026-12-20"] a').focus({ preventScroll: true })""")
    _scroll_down_until(page, "2027-12-15")
    page.wait_for_timeout(600)
    assert page.evaluate("() => document.activeElement.closest('li')?.dataset.date") == "2026-12-20"
    _assert_consecutive(_dates(page))


def test_list_scrolling_fetches_nothing(mobile_context):
    """스크롤 중에는 자료를 받지 않는다. 받아 둔 표로 그날을 계산한다(ADR-038 §2)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.wait_for_timeout(500)
    requests = []
    page.on("request", lambda r: requests.append(r.url) if r.resource_type in ("fetch", "xhr") and r.url.startswith(BASE) else None)
    _scroll_down_until(page, "2027-06-15")
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
    page.wait_for_timeout(600)
    assert requests == []


@both_anchorings
def test_list_address_follows_the_top_row_when_scrolling_stops(mobile_context, anchoring):
    """스크롤이 멈추면 맨 위 줄의 날짜를 주소와 마지막 보기에 남긴다. 방문 기록 항목은 늘지 않고, 문서 제목은 그 달로 바뀐다(ADR-038 §2)."""
    page = _list_page(mobile_context, anchoring)
    _open_list(page, "calendar/list/2026-12-15")
    length = page.evaluate("() => history.length")
    _scroll_down_until(page, "2027-01-15")
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/list/2027-01-15"
    assert page.evaluate("() => history.length") == length
    assert page.title() == "2027년 1월 캘린더 목록 — 공동번역성서"


def test_list_waits_for_scrollend_before_treating_the_scroll_as_stopped(mobile_context):
    """관성 스크롤의 끝자락은 스크롤 이벤트가 띄엄띄엄 와서, 이벤트가 잠시 없어도 아직 움직이는 중일 수 있다. `scrollend`가 있는 브라우저에서는
    그것을 기다려 주소를 적고 줄을 고친다. 오지 않으면 스크롤 이벤트가 1초 동안 없을 때 멈춘 것으로 본다."""
    # 브라우저가 내는 scrollend를 앱보다 먼저 받아 막는다. 테스트가 직접 낼 때만 앱에 간다.
    mobile_context.add_init_script("""
        window.addEventListener('scrollend', (e) => { if (!window.__passScrollend) e.stopImmediatePropagation(); }, true);
    """)
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.wait_for_timeout(1000)
    page.evaluate("() => window.scrollBy({ top: 1200, behavior: 'instant' })")
    page.wait_for_timeout(500)
    assert page.url.endswith("/calendar/list/2026-12-15")
    page.wait_for_function("() => !/2026-12-15$/.test(location.pathname)", timeout=3000)   # 1초가 지나면 적는다
    page.evaluate("() => window.scrollBy({ top: 1200, behavior: 'instant' })")
    page.wait_for_timeout(300)
    moved = page.evaluate("() => location.pathname")
    page.evaluate("() => { window.__passScrollend = true; window.dispatchEvent(new Event('scrollend')); }")
    page.wait_for_function("p => location.pathname !== p", arg=moved, timeout=600)   # scrollend 뒤에는 바로(200ms) 적는다


# 앱이 방문 기록으로 보낸 것(`trackPageView` — gtag-init.js가 dataLayer에 쌓는다)
APP_PAGE_VIEWS = "() => (window.dataLayer || []).filter((a) => a[0] === 'event' && a[1] === 'page_view').map((a) => a[2].page_location)"


def test_list_saves_the_address_after_stopping_without_sending_a_page_view(mobile_context):
    """스크롤이 멈추면 주소를 바꾸되 방문은 보내지 않는다. 앱은 화면을 그릴 때만 방문을 보내고, 주소가 바뀌면 저절로 보내는 애널리틱스
    설정은 꺼 두었다. 그래서 목록은 평범한 `history.replaceState`를 쓴다. 스크롤 중에는 주소를 적지 않는다(ADR-038 §2, pitfalls §43)."""
    mobile_context.add_init_script("""
        window.__saved = 0;
        const original = History.prototype.replaceState;
        History.prototype.replaceState = function (...args) { window.__saved++; return original.apply(this, args); };
    """)
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.wait_for_function(f"() => ({APP_PAGE_VIEWS})().length === 1")   # 목록을 연 방문 1건
    page.evaluate("""async () => {
        for (let i = 0; i < 60; i++) {
            window.scrollBy({ top: 40, behavior: 'instant' });
            await new Promise(requestAnimationFrame);
        }
    }""")
    page.wait_for_function("() => location.pathname !== '/calendar/list/2026-12-15'")
    page.wait_for_timeout(500)   # 앱은 방문을 브라우저가 한가할 때 보낸다
    assert page.evaluate(APP_PAGE_VIEWS) == [f"{BASE}/calendar/list/2026-12-15"]
    assert page.evaluate("() => window.__saved") < 5   # 프레임마다 적지 않는다. 느린 컴퓨터에서 프레임이 끊기면 두어 번은 적을 수 있다


@pytest.mark.parametrize("path", ["calendar/list", "calendar/list/2026-12-15", "calendar/list/2027-03-01"])
def test_list_leaves_the_address_alone_until_the_reader_scrolls(mobile_context, path):
    """스크롤하지 않았으면 주소를 바꾸지 않는다. 처음에 그 줄로 옮기는 스크롤은 독자가 옮긴 것이 아니다."""
    page = mobile_context.new_page()
    _open_list(page, path)
    page.wait_for_timeout(1000)   # 멈춤 판단(0.2초)과 늦게 받는 웹 글꼴을 넘긴다
    assert page.url == f"{BASE}/{path}"


@both_anchorings
@pytest.mark.parametrize(("date", "month"), [("2026-12-15", "2026년 12월"), ("2027-03-01", "2027년 3월")])
def test_desktop_list_keeps_the_address_and_month_until_the_reader_scrolls(desktop_context, anchoring, date, month):
    """웹 글꼴을 늦게 받으면 줄이 약 2px 밀려 앞줄이 상단 바 밑으로 조금 보인다. 그 줄을 맨 위 줄로 치면 주소가 앞날로, 달 이름이 앞달로 바뀐다(2026-11-07 재현)."""
    page = _list_page(desktop_context, anchoring)
    _open_list(page, f"calendar/list/{date}")
    page.wait_for_timeout(1400)
    assert page.url == f"{BASE}/calendar/list/{date}"
    assert page.inner_text(".cal-month") == month


@both_anchorings
def test_desktop_list_from_the_month_keeps_the_address(desktop_context, anchoring):
    """데스크톱 — 월간에서 목록으로 간 뒤 가만히 두면 주소가 그 달 1일 그대로다."""
    page = _list_page(desktop_context, anchoring)
    _open(page, "calendar/2026-12")
    page.wait_for_timeout(1000)   # 앱이 스크롤 감지를 시작하기를 기다린다
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-01")
    page.wait_for_timeout(1400)
    assert page.url == f"{BASE}/calendar/list/2026-12-01"


def test_todays_date_uses_the_address_without_a_date(desktop_context):
    """오늘 날짜의 줄을 날짜 있는 주소로 열어도, 전례독서의 오른쪽 단추로 돌아와도 주소에는 날짜가 없어 다음 날 그날의 오늘 줄이 열린다(사용자 결정 2026-11-07)."""
    today = datetime.date.today().isoformat()
    page = desktop_context.new_page()
    page.goto(f"{BASE}/calendar/list/{today}")
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(".cal-rows", timeout=20_000)
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/list"
    _row(page, today).click()
    page.wait_for_url(f"**/lectionary/{today}")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(".cal-rows")
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/list"


def test_scrolling_back_to_today_drops_the_date_from_the_address(mobile_context):
    """맨 위 줄이 오늘로 돌아오면 날짜 없는 주소다."""
    today = datetime.date.today()
    later = (today + datetime.timedelta(days=40)).isoformat()
    page = mobile_context.new_page()
    _open_list(page, "calendar/list")
    _scroll_down_until(page, later)
    page.wait_for_url(f"{BASE}/calendar/list/{later}")
    page.evaluate("""d => {
        const bar = (document.getElementById('sticky-group').getBoundingClientRect().bottom + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0));
        window.scrollBy({ top: document.querySelector(`li[data-date="${d}"]`).getBoundingClientRect().top - bar, behavior: 'instant' });
    }""", today.isoformat())
    page.wait_for_url(f"{BASE}/calendar/list")
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/list"


def test_list_left_open_overnight_uses_the_new_today_for_the_address(mobile_context):
    """목록을 켜 둔 채 날이 바뀌면 주소를 남기는 때의 오늘을 쓴다. 새 오늘 줄은 날짜가 없고, 어제가 된 줄은 날짜가 있다(PR #513 리뷰)."""
    page = mobile_context.new_page()
    page.clock.set_fixed_time(datetime.datetime(2026, 12, 15, 12))
    _open_list(page, "calendar/list")
    assert page.locator("li[data-date='2026-12-15'] a[aria-current='date']").count() == 1
    page.clock.set_fixed_time(datetime.datetime(2026, 12, 16, 12))
    put_under_bar = """d => {
        const bar = (document.getElementById('sticky-group').getBoundingClientRect().bottom + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0));
        window.scrollBy({ top: document.querySelector(`li[data-date="${d}"]`).getBoundingClientRect().top - bar, behavior: 'instant' });
    }"""
    page.evaluate(put_under_bar, "2026-12-16")
    page.wait_for_timeout(400)   # 멈춤 판단(0.2초)을 넘긴다
    assert page.url == f"{BASE}/calendar/list"
    page.evaluate(put_under_bar, "2026-12-15")
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-15")


@both_anchorings
def test_back_to_the_list_returns_to_the_top_row_and_leaving_stops_the_list(mobile_context, anchoring):
    """뒤로 가기는 누른 줄이 아니라 맨 위 줄로 돌아온다. 떠난 뒤에는 목록이 상단 바를 건드리지 않는다."""
    page = _list_page(mobile_context, anchoring)
    _open_list(page, "calendar/list/2026-12-15")
    _scroll_down_until(page, "2027-01-15")
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    _row(page, "2027-01-17").click()
    page.wait_for_url("**/lectionary/2027-01-17")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.wait_for_timeout(400)
    assert page.locator(".cal-month").count() == 0
    assert page.locator("#page-title .lect-date time").get_attribute("datetime") == "2027-01-17"
    assert page.url.endswith("/lectionary/2027-01-17")   # 낡은 목록이 주소를 덮어쓰지 않는다
    page.go_back()
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(100)
    assert abs(_row_top_under_head(page, "2027-01-15")) <= 2
    assert _shown_month(page) == "2027년 1월"


def test_row_click_before_scrolling_stops_saves_the_top_row(mobile_context):
    """스크롤이 멈추기 전에 줄을 눌러도 맨 위 줄을 남겨, 뒤로 가기가 그 줄로 돌아온다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.evaluate("""() => {
        const bar = (document.getElementById('sticky-group').getBoundingClientRect().bottom + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0));
        window.scrollBy({ top: document.querySelector('li[data-date="2026-12-30"]').getBoundingClientRect().top - bar, behavior: 'instant' });
        document.querySelector('li[data-date="2027-01-02"] a').click();
    }""")
    page.wait_for_url("**/lectionary/2027-01-02")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.go_back()
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-30")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(100)
    assert abs(_row_top_under_head(page, "2026-12-30")) <= 2


@pytest.mark.parametrize("event", ["window.dispatchEvent(new Event('pagehide'))", "document.dispatchEvent(new Event('visibilitychange'))"])
def test_leaving_before_scrolling_stops_saves_the_top_row(mobile_context, event):
    """스크롤이 멈추기 전에 앱을 떠나도 맨 위 줄을 남긴다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    path = page.evaluate("""event => {
        const bar = (document.getElementById('sticky-group').getBoundingClientRect().bottom + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0));
        window.scrollBy({ top: document.querySelector('li[data-date="2026-12-30"]').getBoundingClientRect().top - bar, behavior: 'instant' });
        (0, eval)(event);
        return location.pathname;
    }""", event)
    assert path == "/calendar/list/2026-12-30"
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/list/2026-12-30"


def test_tab_does_not_reuse_the_scroll_value_of_the_list(mobile_context):
    """위쪽 줄이 늘어나면 같은 줄의 스크롤 값이 커진다. 그 값을 새로 그린 목록에 쓰면 엉뚱한 줄이 나오므로, 목록은 스크롤 값을 저장하지 않는다(ADR-038 §1)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.evaluate("""async () => {
        for (let i = 0; i < 40; i++) {
            window.scrollTo({ top: 0, behavior: 'instant' });
            await new Promise(requestAnimationFrame);
        }
        const bar = (document.getElementById('sticky-group').getBoundingClientRect().bottom + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0));
        window.scrollBy({ top: document.querySelector('li[data-date="2026-12-15"]').getBoundingClientRect().top - bar, behavior: 'instant' });
    }""")
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-15")
    page.wait_for_timeout(300)
    assert page.url == f"{BASE}/calendar/list/2026-12-15"
    assert len(_dates(page)) > 43   # 위쪽 줄이 늘었다
    page.locator("#tab-bar [data-tab='bookmarks']").click()
    page.wait_for_url(f"{BASE}/bookmarks")
    page.go_back()   # 캘린더 탭은 오늘 줄로 가므로(사용자 결정 2026-11-27) 뒤로 가기로 돌아온다
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-15")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(100)
    assert abs(_row_top_under_head(page, "2026-12-15")) <= 2


def test_redraw_after_a_synced_setting_keeps_the_top_row(mobile_context):
    """동기화로 받은 설정이 목록의 글을 바꾸어 다시 그려도 보던 줄이 그대로다(ADR-041 §8)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    _scroll_down_until(page, "2027-01-15")
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    page.evaluate("""() => {
        document.querySelector('.cal-list').dataset.drawnBefore = '1';
        localStorage.setItem('bible-lectionary-alt-show', '1');
        return window.redrawIfSyncedSettingsChanged();
    }""")
    page.wait_for_timeout(100)
    assert page.locator(".cal-list[data-drawn-before]").count() == 0   # 다시 그렸다
    assert abs(_row_top_under_head(page, "2027-01-15")) <= 2
    assert page.url == f"{BASE}/calendar/list/2027-01-15"


def test_redraw_before_scrolling_stops_keeps_the_top_row(mobile_context):
    """스크롤이 멈추기 전에 동기화로 받은 설정이 목록을 다시 그려도 보던 줄이 그대로다. 라우터가 순번을 올리기 전에 맨 위 줄을 남긴다(PR #513 리뷰)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.evaluate("""() => {
        const bar = (document.getElementById('sticky-group').getBoundingClientRect().bottom + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0));
        window.scrollBy({ top: document.querySelector('li[data-date="2026-12-30"]').getBoundingClientRect().top - bar, behavior: 'instant' });
        localStorage.setItem('bible-lectionary-alt-show', '1');
        return window.redrawIfSyncedSettingsChanged();
    }""")
    page.wait_for_timeout(100)
    assert page.url == f"{BASE}/calendar/list/2026-12-30"
    assert abs(_row_top_under_head(page, "2026-12-30")) <= 2


def test_setting_toggle_in_the_settings_tab_keeps_the_top_row(mobile_context):
    """설정 탭에서 대체 독서 토글을 바꾸고 돌아와도 보던 줄이 그대로다(ADR-041 §4)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    _scroll_down_until(page, "2027-01-15")
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    page.locator("#tab-bar [data-tab='settings']").click()
    page.wait_for_url(f"{BASE}/settings")
    page.get_by_role("switch", name="대체 독서 표시").click()
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-alt-show')") == "1"
    page.go_back()   # 캘린더 탭은 오늘 줄로 가므로(사용자 결정 2026-11-27) 뒤로 가기로 돌아온다
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(100)
    assert abs(_row_top_under_head(page, "2027-01-15")) <= 2


@both_anchorings
def test_closing_the_install_guide_keeps_the_top_row(mobile_context, anchoring):
    """설치 안내는 본문을 잠가 스크롤 값이 0이 된다. 닫을 때 바로 되돌려, 페이지가 맨 위를 지나며 위쪽 줄이 늘고 보던 줄을 잃는 일이 없다."""
    page = _list_page(mobile_context, anchoring)
    _open_list(page, "calendar/list/2026-12-15")
    _scroll_down_until(page, "2026-12-29")
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-29")
    drawn = len(_dates(page))
    page.evaluate("() => window.openInstallModal()")
    page.wait_for_timeout(400)
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    assert abs(_row_top_under_head(page, "2026-12-29")) <= 2
    assert len(_dates(page)) == drawn
    assert page.url == f"{BASE}/calendar/list/2026-12-29"


def test_leaving_for_a_slow_screen_does_not_overwrite_its_address(mobile_context):
    """다른 화면이 자료를 받는 동안에는 목록이 문서에 남아 있다. 그 사이 스크롤이 멈춰도 새 주소를 덮어쓰지 않는다."""
    held = []
    mobile_context.route("**/data/books.json", lambda route: held.append(route))
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.evaluate("""() => {
        window.scrollBy({ top: 800, behavior: 'instant' });
        window.navigate('/old_testament');
    }""")
    page.wait_for_timeout(500)
    assert page.locator(".cal-list").count() == 1   # 아직 목록이 남아 있다
    assert page.url == f"{BASE}/old_testament"
    for route in held:
        route.continue_()


@pytest.mark.parametrize(("width", "saved", "destination"), [
    (320, None, "/calendar/list"),
    (390, None, "/calendar/list"),
    (320, "/calendar/2027-03", "/calendar/list"),   # 저장한 보기가 있어도 오늘 줄이다(사용자 결정 2026-11-27)
    (390, "/calendar/list/2027-03-15", "/calendar/list"),
])
def test_calendar_tab_always_opens_the_list_on_small_screens(browser, width, saved, destination):
    """작은 화면의 캘린더는 목록 하나다(ADR-058 §1). 탭은 저장한 보기와 상관없이 오늘 줄의 목록으로 간다(사용자 결정 2026-11-27)."""
    ctx = browser.new_context(viewport={"width": width, "height": 640}, user_agent=IPHONE_UA, is_mobile=True, has_touch=True)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    if saved:
        ctx.add_init_script(f"localStorage.setItem('bible-calendar-last-view', '{saved}');")
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/bookmarks")
        page.locator("#tab-bar [data-tab='calendar']").click()
        page.wait_for_url(f"{BASE}{destination}")
        page.wait_for_selector(".cal-rows", timeout=20_000)
    finally:
        ctx.close()


@pytest.mark.parametrize(("width", "height", "path", "destination", "selector"), [
    (390, 844, "calendar", "/calendar/list", ".cal-rows"),
    (390, 844, "calendar/2027-03", "/calendar/list/2027-03-01", ".cal-rows"),
    (844, 390, "calendar/2027-03", "/calendar/list/2027-03-01", ".cal-rows"),   # 가로로 든 휴대폰도 작은 화면이다
    (700, 600, "calendar/2027-03", "/calendar/2027-03", ".cal-grid"),
])
def test_month_address_opens_the_list_on_small_screens_and_the_month_on_large_ones(browser, width, height, path, destination, selector):
    """월간 주소는 작은 화면에서 목록으로, 큰 화면에서 월간으로 연다(ADR-058 §1). 공유한 월간 주소가 끊기지 않는다."""
    ctx = browser.new_context(viewport={"width": width, "height": height})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/{path}")
        page.wait_for_selector(selector, timeout=20_000)
        page.wait_for_url(f"{BASE}{destination}")
        assert page.locator(".cal-grid, .cal-rows").count() >= 1
    finally:
        ctx.close()


def test_calendar_redraws_when_the_window_crosses_the_layout_boundary(desktop_context):
    """창이 레이아웃의 경계를 넘으면 그 레이아웃의 캘린더로 다시 그린다(ADR-058 §1). 월간은 목록이 되고, 목록의 단추는 레이아웃에 맞게 바뀐다."""
    page = desktop_context.new_page()
    _open(page, "calendar/2027-03")
    page.set_viewport_size({"width": 500, "height": 800})
    page.wait_for_url(f"{BASE}/calendar/list/2027-03-01")
    page.wait_for_selector(".cal-rows")
    assert page.locator("#page-title button.title-view-btn").count() == 1
    assert page.locator("#page-title .cal-title-btn").count() == 0
    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_selector("#page-title a.title-view-btn")
    assert page.locator("#page-title .cal-title-btn").count() == 1
    assert page.locator(".cal-rows").count() >= 1   # 목록은 두 레이아웃에 있어 그대로다


def test_layout_redraw_sends_no_page_view(desktop_context):
    """경계를 넘어 월간을 목록으로 다시 그려도 방문은 보내지 않는다. 읽는 분이 화면을 연 것이 아니다(ADR-038 §2, 코드 리뷰 2026-11-26).
    그 뒤 줄을 눌러 전례독서로 가면 전처럼 방문 1건이다."""
    page = desktop_context.new_page()
    _open(page, "calendar/2027-03")
    page.wait_for_function(f"() => ({APP_PAGE_VIEWS})().length === 1")   # 월간을 연 방문
    page.set_viewport_size({"width": 500, "height": 800})
    page.wait_for_url(f"{BASE}/calendar/list/2027-03-01")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(500)   # 앱은 방문을 브라우저가 한가할 때 보낸다
    assert page.evaluate(APP_PAGE_VIEWS) == [f"{BASE}/calendar/2027-03"]
    _press(page, "li[data-date='2027-03-01'] a.cal-row")
    page.wait_for_url(f"{BASE}/lectionary/2027-03-01")
    page.wait_for_function(f"() => ({APP_PAGE_VIEWS})().length === 2")
    assert page.evaluate(APP_PAGE_VIEWS)[1] == f"{BASE}/lectionary/2027-03-01"


def test_layout_redraw_waits_for_an_open_overlay(desktop_context):
    """월간 위에 설정이 열린 채 경계를 넘으면 설정을 닫지 않고, 닫은 뒤에 목록으로 다시 그린다."""
    page = desktop_context.new_page()
    _open(page, "calendar/2027-03")
    page.locator(".settings-btn:visible").first.click()
    page.wait_for_timeout(300)
    assert page.evaluate("window.appOverlay.anyOverlayOpen()")
    page.set_viewport_size({"width": 500, "height": 800})
    page.wait_for_timeout(500)
    assert page.evaluate("window.appOverlay.anyOverlayOpen()")
    page.keyboard.press("Escape")
    page.wait_for_url(f"{BASE}/calendar/list/2027-03-01")
    page.wait_for_selector(".cal-rows")


def test_month_cell_focus_moves_to_the_drop_button_across_the_boundary(desktop_context):
    """월간 칸에 포커스가 있는 채 작은 화면이 되면, 목록으로 다시 그린 뒤 포커스는 달력을 내리는 단추로 간다(WCAG 2.4.3, 코드 리뷰 2026-11-26)."""
    page = desktop_context.new_page()
    _open(page, "calendar/2027-03")
    _cell(page, "2027-03-10").focus()
    page.set_viewport_size({"width": 500, "height": 800})
    page.wait_for_url(f"{BASE}/calendar/list/2027-03-01")
    page.wait_for_selector("#page-title button.cal-picker-trigger:focus", timeout=3000)


def test_view_button_focus_moves_to_the_drop_button_across_the_boundary(desktop_context):
    """작은 화면에는 보기 전환 단추가 없으므로 그 포커스는 달력을 내리는 단추로 간다(WCAG 2.4.3)."""
    page = desktop_context.new_page()
    _open_list(page, "calendar/list/2027-03-10")
    page.evaluate("document.querySelector('#page-title a.title-view-btn').focus({ preventScroll: true })")
    page.set_viewport_size({"width": 500, "height": 800})
    page.wait_for_selector("#page-title button.cal-picker-trigger:focus", timeout=3000)


def test_tab_in_scrolled_list_goes_back_to_today(mobile_context):
    """멀리 넘겨 둔 목록에서 탭을 누르면 오늘 줄로 간다. 방문 기록이 한 항목 늘어 뒤로 가기가 보던 줄로 돌아간다(ADR-038 §2)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list")
    today = datetime.date.today()
    later = (today + datetime.timedelta(days=70)).isoformat()
    _scroll_down_until(page, later)
    page.wait_for_url(f"{BASE}/calendar/list/{later}")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")
    page.wait_for_timeout(100)
    assert page.url == f"{BASE}/calendar/list"
    assert _row(page, today.isoformat()).is_visible()
    page.go_back()
    page.wait_for_url(f"{BASE}/calendar/list/{later}")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(100)
    assert abs(_row_top_under_head(page, later)) <= 2


def test_list_stops_at_the_ends_of_the_computable_range(mobile_context):
    """계산 범위의 끝에서 줄이 멈추고, 상단 바의 단추는 그 끝에서 자리만 남는다."""
    page = mobile_context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    _open_list(page, "calendar/list/1583-01-20")
    prev_btn = page.locator("#page-title a[data-focus-key='prev']")
    assert prev_btn.count() == 0
    page.wait_for_selector("li[data-date='1583-01-01']", state="attached", timeout=20_000)
    page.wait_for_timeout(500)
    assert _dates(page)[0] == "1583-01-01"
    _scroll_down_until(page, "1583-02-15")
    _wait_month(page, "1583년 2월")
    assert prev_btn.count() == 1
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
    _wait_month(page, "1583년 1월")
    assert prev_btn.count() == 0
    _open_list(page, "calendar/list/9999-12-30")
    assert page.locator("#page-title a[data-focus-key='next']").count() == 0
    page.wait_for_timeout(300)
    assert _dates(page)[-1] == "9999-12-31"
    assert errors == []


def test_list_keeps_focus_when_the_bar_redraws_at_the_range_end(mobile_context):
    """스크롤로 계산 범위 끝의 달에 가면 상단 바를 다시 그린다. 포커스는 같은 단추에 남고, 사라진 단추에 있었으면 「오늘」로 간다(WCAG 2.4.3)."""
    page = mobile_context.new_page()
    focused = "() => document.activeElement.dataset.focusKey"
    for key, expected in (("date-picker-title", "date-picker-title"), ("prev", "today")):
        _open_list(page, "calendar/list/1583-02-15")
        page.locator(f"#page-title [data-focus-key='{key}']").focus()
        page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
        _wait_month(page, "1583년 1월")
        assert page.locator("#page-title a[data-focus-key='prev']").count() == 0
        assert page.evaluate(focused) == expected


def test_desktop_list_keeps_focus_on_today_when_the_bar_redraws(desktop_context):
    """데스크톱의 「오늘」(› 오른쪽 — ADR-043 §1)도 상단 바를 다시 그린 뒤 포커스를 잃지 않는다(WCAG 2.4.3)."""
    page = desktop_context.new_page()
    _open_list(page, "calendar/list/1583-02-15")
    page.locator("#page-title .lect-today").focus()
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
    _wait_month(page, "1583년 1월")
    assert page.locator("#page-title a[data-focus-key='prev']").count() == 0
    assert page.evaluate("() => document.activeElement.classList.contains('lect-today')")


def test_only_the_list_loads_the_lectionary_tables(desktop_context):
    """줄의 글을 정하려고 목록은 독서 묶음을 받는다. 월간은 받지 않는다(ADR-038 §2)."""
    page = desktop_context.new_page()
    urls = []
    page.on("request", lambda r: urls.append(r.url))
    _open(page, "calendar/2026-12")
    assert not any("eucharist-readings" in u for u in urls)
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_selector(".cal-rows", timeout=20_000)
    assert any("eucharist-readings" in u for u in urls)


def test_list_failure_screens(mobile_context):
    """잘못된 주소와 받지 못한 독서 묶음은 캘린더의 실패 화면이고 마지막 보기로 저장하지 않는다."""
    page = mobile_context.new_page()
    page.goto(f"{BASE}/calendar/list/2026-13-99")
    page.wait_for_selector(".empty-state", timeout=20_000)
    assert page.inner_text(".empty-state-title") == "잘못된 날짜입니다"
    assert page.inner_text("#page-title") == "캘린더"
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") is None
    page.route("**/lectionary/eucharist-readings.json", lambda r: r.abort())
    page.goto(f"{BASE}/calendar/list/2026-12-01")
    page.wait_for_selector(".empty-state", timeout=20_000)
    assert page.inner_text(".empty-state-title") == "교회력 자료를 불러오지 못했습니다"
    assert page.locator(".state-action button").inner_text() == "다시 불러오기"
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") is None


def test_list_fits_narrow_screens_with_large_text(mobile_context):
    """폭 320px에 글자 24px에서도 가로로 넘치지 않고, 긴 이름은 줄을 바꾼다."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 320, "height": 700})
    _open_list(page, "calendar/list/2026-10-10")
    page.evaluate("() => { document.documentElement.style.fontSize = '24px'; }")
    page.wait_for_timeout(50)
    state = page.evaluate("""() => ({ width: document.documentElement.scrollWidth,
        over: [...document.querySelectorAll('.cal-row-line, .cal-row-title')].filter((e) => e.getBoundingClientRect().right > innerWidth).length })""")
    assert state == {"width": 320, "over": 0}


# ── ⑪ 날짜 고르기(ADR-038 §2 「날짜 고르기」) ──

def _picker(page):
    """열린 판의 머리 글, 지금 보는 칸, 포커스, 칸 수, ‹ ›를 누를 수 있는지. 닫혔으면 None. 작은 화면에서 달력이 열린 동안 머리(제목과 ‹ ›)는
    상단 바에 있다(ADR-061 §3). 날 판의 제목은 표기 셋(ADR-061 §4) 가운데 보이는 것을 읽는다."""
    return page.evaluate("""() => {
      const p = document.querySelector('.cal-picker');
      if (!p || p.hidden || p.classList.contains('cal-picker-closing')) return null;
      const name = (n) => n && (n.getAttribute('href') || n.textContent);
      const steps = document.querySelectorAll('.cal-picker-step');
      const head = document.querySelector('.cal-picker-title:not([hidden])');
      const len = [...head.querySelectorAll('.fit-len')].find((e) => e.getClientRects().length);
      return { title: (len ?? head).textContent,
               current: name(p.querySelector('.cal-picker-body [aria-current="true"]')),
               focus: p.contains(document.activeElement) ? name(document.activeElement) : null,
               cells: p.querySelectorAll('.cal-picker-day, .cal-picker-cell').length,
               prev: !steps[0].disabled, next: !steps[1].disabled,
               expanded: document.querySelector('.cal-picker-trigger').getAttribute('aria-expanded') };
    }""")


def test_picker_marks_whole_day_squares_and_one_fading_line_under_the_weekdays(mobile_context):
    """월간 달력은 날을 원이 아니라 칸 전체의 사각형으로 표시한다. 지금 보는 날은 채우고 오늘은 테두리다. 선은 요일 머리와 날짜 사이에 하나만
    있고 양 끝이 투명해진다. 주와 주 사이에는 선이 없다. 전례색은 끝이 둥근 짧은 막대이고 날짜와 함께 칸의 가운데에 있다(사용자 결정 2026-11-28). 판의 위 끝은 상단 바의 아래 끝보다 아래로 떨어지지 않는다(틈이 선처럼 보였다, 사용자 결정 2026-11-27). 뒤를 어둡게 가리지 않는다
    (사용자 결정 2026-11-28)."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2026-11-05")
    # 아이폰처럼 상단 바의 아래 끝을 소수 자리(…0.6px)로 만든다. 정수면 반올림과 내림이 같아 틈을 재현하지 못한다
    page.evaluate("() => { document.getElementById('sticky-group').style.paddingBottom = '0.6px'; }")
    page.wait_for_timeout(100)
    assert page.evaluate("() => document.getElementById('sticky-group').getBoundingClientRect().bottom % 1") > 0.1
    _open_picker(page)
    state = page.evaluate("""() => {
        const day = (sel) => document.querySelector(`.cal-picker-day${sel}`);
        const cs = (el) => getComputedStyle(el);
        const sel = day('.is-selected'), today = day('.is-today:not(.is-selected)');
        const head = document.querySelector('.cal-picker-days thead th');
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        return {
            selected: cs(sel).backgroundColor, selectedNum: cs(sel.querySelector('.cal-picker-num')).backgroundColor,
            today: cs(today).boxShadow, line: cs(head).backgroundImage, linePlace: cs(head).backgroundPositionY,
            weeks: [...document.querySelectorAll('.cal-picker-days tbody td')].map((td) => cs(td).backgroundImage).filter((b) => b !== 'none').length,
            ...(() => { const r = sel.getBoundingClientRect(), n = sel.querySelector('.cal-picker-num').getBoundingClientRect();
                const b = sel.querySelector('.cal-picker-bar'); const br = b.getBoundingClientRect();
                return { above: n.top - r.top, below: r.bottom - br.bottom, barW: br.width, barH: br.height, barRound: cs(b).borderRadius }; })(),
            gap: document.querySelector('.cal-picker').getBoundingClientRect().top - bar,
            scrim: document.querySelectorAll('.cal-picker-scrim').length,
        }; }""")
    assert state["selected"] not in ("rgba(0, 0, 0, 0)", "transparent"), state   # 칸 전체를 채운다
    assert state["selectedNum"] in ("rgba(0, 0, 0, 0)", "transparent"), state    # 숫자의 원은 없다
    assert "inset" in state["today"], state
    assert state["line"].startswith("linear-gradient") and "rgba(0, 0, 0, 0)" in state["line"], state   # 양 끝이 투명하다
    assert state["linePlace"] == "100%", state   # 요일 머리의 아래 끝
    assert state["weeks"] == 0, state   # 주와 주 사이에는 선이 없다
    # 전례색은 목록의 날짜 칸처럼 끝이 둥근 짧은 막대이고, 날짜와 막대는 한 덩어리로 칸의 가운데에 있어 채운 사각형 안의 위아래에 여유가 있다
    # (사용자 결정 2026-11-28)
    assert state["barW"] > state["barH"] * 2 and state["barRound"] != "0px", state
    assert state["above"] >= 6 and state["below"] >= 6 and abs(state["above"] - state["below"]) <= 1, state
    assert state["gap"] <= 0, state
    assert state["scrim"] == 0, state


_INK_ROWS = """async ([b64, w]) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height); const s = c.width / w;
    const x0 = Math.floor(c.width * 0.2), x1 = Math.ceil(c.width * 0.8), at = 4 * (Math.ceil(3 * s) * c.width + x0);
    const bg = [data[at], data[at + 1], data[at + 2]];   // 줄 사이 선(칸의 맨 위 1px) 아래의 바탕
    const runs = []; let start = -1;
    for (let y = 0; y < c.height; y++) {
        let ink = false;
        for (let x = x0; x < x1 && !ink; x++) { const i = 4 * (y * c.width + x); ink = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 60; }
        if (ink && start < 0) start = y;
        if (!ink && start >= 0) { runs.push([start / s, y / s]); start = -1; }
    }
    if (start >= 0) runs.push([start / s, c.height / s]);
    return { h: c.height / s, runs: runs.filter(([a, b]) => b > 2) }; }"""


def _date_cell_ink(page, date):
    """목록 날짜 칸의 잉크 줄(CSS px): 날짜, 전례색, 요일. 줄 상자는 줄 높이와 글꼴의 여유를 품어 숫자와 한글의 잉크 자리를 알려 주지 않으므로, 칸을
    찍은 그림에서 바탕과 다른 줄을 찾는다. 요일 글자는 획이 떨어져 여러 줄로 잡히므로 셋째부터는 하나로 묶는다."""
    cell = page.locator(f"li[data-date='{date}'] .cal-row-date")
    page.wait_for_selector("#launch-screen", state="detached", timeout=5_000)   # 런치 화면이 다 걷힌 뒤에 찍는다(2초 동안 옅어진다)
    cell.evaluate("e => e.scrollIntoView({ block: 'center', behavior: 'instant' })")   # 고정된 주간 라벨과 상단 바에 가리지 않게
    page.wait_for_timeout(100)
    png = cell.screenshot()
    ink = page.evaluate(_INK_ROWS, [base64.b64encode(png).decode(), cell.bounding_box()["width"]])
    runs = ink["runs"]
    day, mark, week = runs[0], runs[1], (runs[2][0], runs[-1][1])
    return {"top": day[0], "above": mark[0] - day[1], "below": week[0] - mark[1], "bottom": ink["h"] - week[1]}


def test_list_date_cell_keeps_date_bar_and_weekday_together_with_even_spacing(mobile_context):
    """목록의 날짜 칸에서 날짜, 전례색 막대, 요일은 한 덩어리다. 보이는 글자 사이의 간격이 같고, 위아래에 같은 최소 여백이 있어 제목이 없는 날
    (11월 28일)도 요일이 칸의 아래 끝에 붙지 않는다. 색이 둘 이상인 날(9월 16일)은 막대 대신 원을 한 줄에 나란히 둔다. 월간 달력의 날 판도 같고,
    원이 있는 날도 한 주의 숫자 높이가 같다(사용자 결정 2026-11-28, ADR-060 §2). 전에는 날짜 아래가 12.75px, 요일 위가 4.5px였고 제목이 없는
    날은 요일 아래가 0이었다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    marks = """d => [...document.querySelectorAll(`li[data-date="${d}"] .cal-row-bar`)].map((b) => { const x = b.getBoundingClientRect();
        return { top: Math.round(x.top), w: x.width, h: x.height, round: getComputedStyle(b).borderRadius }; })"""
    _open_list(page, "calendar/list/2026-11-25")
    for date in ("2026-11-28", "2026-11-26", "2026-11-25"):
        m = _date_cell_ink(page, date)
        assert abs(m["above"] - m["below"]) <= 2, (date, m)   # 날짜와 막대, 막대와 요일 사이가 같다
        assert m["bottom"] >= 12, (date, m)   # 요일이 아래 끝에 붙지 않는다
        if date == "2026-11-28":
            assert abs(m["top"] - m["bottom"]) <= 3, m   # 제목이 없는 날은 덩어리의 위아래 여백이 같다
        bars = page.evaluate(marks, date)
        assert len(bars) == 1 and bars[0]["w"] > bars[0]["h"] * 2, (date, bars)
    _open_list(page, "calendar/list/2026-09-16")
    m = _date_cell_ink(page, "2026-09-16")
    assert abs(m["above"] - m["below"]) <= 2, m
    circles = page.evaluate(marks, "2026-09-16")
    assert len(circles) == 2 and len({x["top"] for x in circles}) == 1, circles   # 한 줄에
    assert all(abs(x["w"] - x["h"]) < 0.5 and x["round"] == "50%" for x in circles), circles   # 원
    _open_picker(page)
    picker = page.evaluate("""() => { const cell = (d) => document.querySelector(`.cal-picker-day[data-date="${d}"]`);
        const num = (d) => Math.round(cell(d).querySelector('.cal-picker-num').getBoundingClientRect().top * 10) / 10;
        const marks = [...cell('2026-09-16').querySelectorAll('.cal-picker-bar')].map((b) => { const x = b.getBoundingClientRect();
            return [Math.round(x.top), x.width, x.height, getComputedStyle(b).borderRadius]; });
        return { nums: [num('2026-09-15'), num('2026-09-16'), num('2026-09-17')], marks }; }""")
    assert len(set(picker["nums"])) == 1, picker   # 원이 있는 날도 숫자가 같은 높이다
    assert len(picker["marks"]) == 2 and picker["marks"][0][0] == picker["marks"][1][0], picker
    assert all(abs(w - h) < 0.5 and r == "50%" for _, w, h, r in picker["marks"]), picker


def test_selected_white_day_keeps_its_ring_in_dark_mode(mobile_context):
    """다크 모드에서 고른 날이 백색인 날이어도 그 막대에 바탕색 테두리가 있다. 채운 사각형(옅은 차콜)과 흰 막대는 비슷해, 테두리가 없으면 막대가
    거의 보이지 않는다. 다크 모드의 흰 막대 규칙과 명시도가 같아, 고른 날의 규칙이 뒤에 와야 한다(코드 리뷰 2026-11-28)."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2026-12-25")   # 성탄일, 백색
    page.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
    _open_picker(page)
    shadow = page.evaluate("""() => { const bar = document.querySelector('.cal-picker-day.is-selected .cal-picker-bar');
        return [bar.classList.contains('lit-swatch--white'), getComputedStyle(bar).boxShadow, getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()]; }""")
    assert shadow[0] and "0px 0px 0px 1px" in shadow[1] and "inset" not in shadow[1], shadow


def _open_picker(page):
    _press(page, ".cal-picker-trigger")
    page.wait_for_selector(".cal-picker:not([hidden])")
    page.wait_for_timeout(400)   # 달력이 내려오고 포커스가 옮겨 간다


def _freeze_today(page):
    """오늘을 2026-11-17로 고정한다. 판의 오늘과 이번 달 링크는 주소에 날짜가 없어, 시험을 돌리는 날에 따라 링크가 바뀌지 않게 한다."""
    page.clock.set_fixed_time(datetime.datetime(2026, 11, 17, 12))


def _under_calendar(page, date):
    """그 날짜의 줄 위쪽과, 내려온 달력 맨 아래 구분선의 위 끝에 고정된 주간 라벨의 높이를 더한 자리의 거리. 달력이 목록을 밀어 내면 맨 위 줄은 달력
    바로 아래다. 목록의 위 끝은 구분선 밑에 들어간다(calendar.js `dropLength`)."""
    return page.evaluate("""d => { const p = document.querySelector('.cal-picker');
        return document.querySelector(`li[data-date="${d}"]`).getBoundingClientRect().top
            - (p.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(p, '::after').height) || 0)
               + (document.querySelector('.cal-week')?.getBoundingClientRect().height ?? 0)); }""", date)


def test_list_icon_drops_the_month_calendar_and_pushes_the_list_below_it(mobile_context):
    """작은 화면 목록의 오른쪽 아이콘을 누르면 그달의 날 판이 상단 바 아래로 내려오고 지금 보는 날(맨 위 줄)이 골라져 있다(ADR-058 §3). 달 제목은
    누르는 단추가 아니다. 날마다 월간 칸과 같은 색 점이 있다. 뒤를 어둡게 가리지 않고, 목록은 달력의 높이만큼 밀려나 맨 위 줄이 달력 바로 아래에
    보인다(사용자 결정 2026-11-28). 스크롤 값과 주소는 그대로다. 밀려난 목록은 막지 않는다. 달력의 아래 모서리는 둥글리지 않고 그림자도 없으며,
    양 끝으로 갈수록 투명해지는 구분선이 있다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-02-01")
    assert page.locator("#page-title .cal-title-btn").count() == 0
    y = page.evaluate("scrollY")
    under_bar = _row_top_under_head(page, "2027-02-01")   # 달의 첫 줄이라 달 이름 아래다
    _open_picker(page)
    state = _picker(page)
    # 28일과 첫 주, 마지막 주를 채운 앞뒤 달의 날(1월 31일, 3월 1-6일)
    assert state == {"title": "2027년 2월", "current": "/calendar/list/2027-02-01", "focus": "/calendar/list/2027-02-01",
                     "cells": 35, "prev": True, "next": True, "expanded": "true"}, state
    assert page.evaluate("scrollY") == y   # 여는 동안 스크롤하지 않는다
    assert page.url == f"{BASE}/calendar/list/2027-02-01"
    place = page.evaluate("""() => { const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        const p = document.querySelector('.cal-picker').getBoundingClientRect();
        return { panel: p.top - bar, left: p.left, right: innerWidth - p.right, scrim: document.querySelectorAll('.cal-picker-scrim').length,
                 inert: document.getElementById('app').inert || document.getElementById('sticky-group').inert,
                 modal: document.querySelector('.cal-picker').getAttribute('aria-modal'),
                 radius: getComputedStyle(document.querySelector('.cal-picker')).borderBottomLeftRadius,
                 shadow: getComputedStyle(document.querySelector('.cal-picker')).boxShadow,
                 line: getComputedStyle(document.querySelector('.cal-picker'), '::after').height,
                 lineImage: getComputedStyle(document.querySelector('.cal-picker'), '::after').backgroundImage }; }""")
    assert abs(place["panel"]) <= 1 and abs(place["left"]) <= 1 and abs(place["right"]) <= 1, place   # 상단 바를 덮지 않는다
    assert place["scrim"] == 0, place
    assert abs(page.evaluate(SCREEN_UNDER_DIVIDER)) < 0.01   # 목록의 위 끝이 달력 맨 아래 구분선 밑에 들어간다
    assert place["inert"] is False and place["modal"] == "false", place
    assert place["radius"] == "0px" and place["shadow"] == "none", place   # 상단 바와 한 층이라 둥글리지 않고 그림자도 없다(사용자 결정 2026-11-28)
    # 그림자가 아니라 양 끝으로 갈수록 투명해지는 구분선이다(사용자 결정 2026-11-28)
    assert place["line"] == "1px" and place["lineImage"].startswith("linear-gradient(to right, rgba(0, 0, 0, 0)"), place
    assert abs(_under_calendar(page, "2027-02-01") - under_bar) <= 1
    ash = page.locator(".cal-picker a[href='/calendar/list/2027-02-10']")
    assert ash.locator(".cal-picker-bar.lit-swatch--violet").count() == 1
    assert ash.get_attribute("aria-label") == "2월 10일 수요일, 자색"
    assert page.get_attribute(".cal-picker", "role") == "dialog"
    assert page.get_attribute(".cal-picker", "aria-label") == "날짜 고르기"
    assert page.locator(".cal-picker table caption").inner_text() == "2027년 2월"
    # 문서의 차례가 상단 바, 달력, 화면이라 Tab이 그 차례로 간다
    assert page.evaluate("""() => { const p = document.querySelector('.cal-picker');
        return p.previousElementSibling.matches('.cal-picker-backing') && p.nextElementSibling.matches('main#app')
            && document.getElementById('sticky-group').nextElementSibling.matches('.cal-picker-backing'); }""")


def test_the_stuck_week_label_tucks_under_the_divider_without_a_gap(mobile_context):
    """상단 바의 아래 끝이 소수 자리여도, 밀려난 목록의 고정된 주간 라벨은 달력 맨 아래의 구분선 밑에 틈 없이 들어간다(ADR-058 §3). 전에는 달력의
    높이를 반올림한 만큼 밀어 라벨과 달력 사이에 1px이 안 되는 틈이 생기고, 그 틈으로 상단 바에 가려져 있던 줄의 글자가 비쳤다(사용자 보고
    2026-11-28). 달력이 열린 채 상단 바의 아래 끝이 바뀌어도(다시 그리거나 창 크기가 바뀔 때) 다시 재어 틈이 생기지 않는다(코드 리뷰 2026-11-28). 달력이
    줄어 목록이 따라 올라가는 동안에도 화면 위를 덮는 바탕의 아래 끝이 목록의 위 끝에 있다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-03-08")
    # 아이폰의 상단 바는 글꼴과 상태 표시줄 때문에 아래 끝이 소수 자리다
    bar_pad = "px => document.getElementById('sticky-group').style.setProperty('padding-bottom', px, 'important')"
    page.evaluate(bar_pad, "0.3px")
    page.wait_for_timeout(100)
    _open_picker(page)
    measure = """() => { const p = document.querySelector('.cal-picker'); const line = parseFloat(getComputedStyle(p, '::after').height);
        const head = document.querySelector('li[data-date="2027-03-08"]').closest('.cal-week-group').querySelector('.cal-week').getBoundingClientRect();
        return { frac: document.getElementById('sticky-group').getBoundingClientRect().bottom % 1,
                 head: head.top - (p.getBoundingClientRect().bottom - line),
                 backing: document.querySelector('.cal-picker-backing').getBoundingClientRect().bottom - head.top }; }"""
    state = page.evaluate(measure)
    assert 0.1 < state["frac"] < 0.9, state
    assert abs(state["head"]) < 0.01 and abs(state["backing"]) < 0.01, state
    # 달력이 열린 채 상단 바의 아래 끝만 바뀐다. 판의 크기는 그대로라 판의 ResizeObserver는 부르지 않고, 창 크기 처리가 자리를 다시 잡는다
    page.evaluate(bar_pad, "0.66px")
    page.evaluate("() => window.dispatchEvent(new Event('resize'))")
    page.wait_for_timeout(400)
    moved = page.evaluate(measure)
    assert moved["frac"] != state["frac"], (state, moved)
    assert abs(moved["head"]) < 0.01 and abs(moved["backing"]) < 0.01, moved
    _press(page, "#page-title button.cal-picker-title")   # 날 판(다섯 주)에서 달 판(세 줄)으로 줄어든다. 머리는 상단 바에 있다
    page.wait_for_timeout(60)
    gap = page.evaluate("""() => { const app = document.getElementById('app'); const back = document.querySelector('.cal-picker-backing');
        const push = [...app.getAnimations(), ...back.getAnimations()]; push.forEach(a => a.pause());
        const out = { pushes: push.length, gap: back.getBoundingClientRect().bottom - (document.getElementById('sticky-group').getBoundingClientRect().bottom
            + new DOMMatrixReadOnly(getComputedStyle(app).transform).m42) };
        push.forEach(a => a.play()); return out; }""")
    assert gap["pushes"] == 2 and abs(gap["gap"]) < 0.01, gap
    page.wait_for_timeout(400)
    assert abs(page.evaluate(SCREEN_UNDER_DIVIDER)) < 0.01


def test_a_day_in_the_dropped_calendar_moves_the_list_below_and_keeps_it_open(mobile_context):
    """달력에서 날을 누르면 달력은 열린 채로 있고, 그 아래의 목록이 그날의 줄을 달력 바로 아래에 둔다(ADR-058 §3, 사용자 결정 2026-11-28). 지금 보는
    날도 그날로 바뀌고, 상단 바의 달과 주소가 맨 위 줄을 따른다. 방문 기록은 늘지 않는다. 그려 두지 않은 먼 날이면 목록을 다시 그린다. 아이콘을
    다시 누르면 달력이 올라가고 목록은 그 줄이 상단 바 바로 아래에 오게 제자리로 올라온다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-02-01")
    length = page.evaluate("() => history.length")
    _open_picker(page)
    page.evaluate(RECORD_ANNOUNCEMENTS)
    _press(page, ".cal-picker a[href='/calendar/list/2027-02-10']")   # 그려 둔 줄
    page.wait_for_url(f"{BASE}/calendar/list/2027-02-10")
    page.wait_for_timeout(300)
    state = _picker(page)
    assert state is not None and state["current"] == "/calendar/list/2027-02-10" and state["title"] == "2027년 2월", state
    assert page.locator(".cal-picker [aria-current='true']").count() == 1
    assert abs(_under_calendar(page, "2027-02-10")) <= 2
    assert page.evaluate("window.__said") == ["2월 10일 수요일 목록"]
    _press(page, "#page-title .cal-picker-step >> nth=1")   # 달력이 열린 동안 상단 바의 ‹ ›는 달력의 것이다(ADR-061 §3)
    page.wait_for_timeout(150)
    assert _picker(page)["title"] == "2027년 3월"
    # ‹ ›로 바뀌는 것은 달력뿐이다. 상단 바의 달은 달력이 열린 동안 숨어 있으므로 스크린 리더가 읽는 이름으로 본다
    assert page.locator("#page-title .cal-month .sr-only").text_content() == "2027년 2월"
    _press(page, ".cal-picker a[href='/calendar/list/2027-03-20']")   # 그려 두지 않은 날
    page.wait_for_url(f"{BASE}/calendar/list/2027-03-20")
    page.wait_for_timeout(300)
    assert _picker(page)["current"] == "/calendar/list/2027-03-20"
    assert abs(_under_calendar(page, "2027-03-20")) <= 2
    assert page.locator("#page-title .cal-month .sr-only").text_content() == "2027년 3월"
    assert page.get_attribute(".cal-picker-trigger", "aria-label") == "2027년 3월, 날짜 고르기"
    assert page.evaluate("() => history.length") == length
    assert page.evaluate("document.querySelector('.cal-picker').contains(document.activeElement)")
    _press(page, ".cal-picker-trigger")
    page.wait_for_timeout(500)
    assert _picker(page) is None
    assert abs(_row_top_under_head(page, "2027-03-20")) <= 2
    assert page.evaluate("getComputedStyle(document.getElementById('app')).transform") == "none"
    assert page.evaluate("document.activeElement.classList.contains('cal-picker-trigger')")
    assert page.get_attribute(".cal-picker-trigger", "aria-expanded") == "false"
    assert page.url == f"{BASE}/calendar/list/2027-03-20"


def test_a_day_tapped_while_the_calendar_still_unfolds_comes_to_the_top(mobile_context):
    """달력이 펼쳐지는 동안(화면이 아직 밀려나는 중에) 날을 누르면, 움직이는 중의 밀린 길이로 재지 않고 움직임을 끝낸 뒤 잰다. 움직임이 끝난 뒤에도
    고른 줄이 달력 바로 아래이고 주소가 그날이다(코드 리뷰 2026-11-28)."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-02-01")
    page.evaluate("() => document.querySelector('.cal-picker-trigger').click()")
    page.wait_for_selector(".cal-picker:not([hidden])")
    page.wait_for_timeout(60)   # 펼치는 움직임(250ms)의 앞부분
    moving = page.evaluate("""() => new DOMMatrixReadOnly(getComputedStyle(document.getElementById('app')).transform).m42
        < parseFloat(document.documentElement.style.getPropertyValue('--cal-drop-h')) - 1""")
    page.evaluate("() => document.querySelector(\".cal-picker a[href='/calendar/list/2027-02-17']\").click()")
    page.wait_for_timeout(700)
    assert moving   # 누른 때 화면은 아직 밀려나는 중이었다
    assert page.url == f"{BASE}/calendar/list/2027-02-17"
    assert _picker(page)["current"] == "/calendar/list/2027-02-17"
    assert abs(_under_calendar(page, "2027-02-17")) <= 2


def test_settings_from_another_device_redraw_the_list_under_the_open_calendar(mobile_context):
    """작은 화면에서 달력을 연 채 다른 기기에서 받은 설정이 목록의 내용을 바꾸면, 목록은 다시 그리고 달력은 열린 채로 둔다. 맨 위 줄은 그대로
    달력 바로 아래다(ADR-058 §3, 코드 리뷰 2026-11-28. 전에는 같은 주소를 다시 그리는 라우터가 달력을 접었다)."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-02-10")
    _open_picker(page)
    page.evaluate("() => { window.__mark = document.querySelector('.cal-list'); window.__day = document.querySelector('.cal-picker a[data-date=\"2027-02-10\"]'); }")
    assert page.evaluate("() => document.activeElement === window.__day")
    # 동기화가 대체 독서 표시를 바꿔 저장한 뒤 부르는 것과 같다(sync/state-machine.js)
    page.evaluate("() => { localStorage.setItem('bible-lectionary-alt-show', '1'); window.redrawIfSyncedSettingsChanged(); }")
    page.wait_for_function("() => !window.__mark.isConnected && document.querySelector('li[data-date=\"2027-02-10\"]')")
    page.wait_for_timeout(400)
    state = _picker(page)
    assert state is not None and state["current"] == "/calendar/list/2027-02-10" and state["expanded"] == "true", state
    assert page.evaluate("document.documentElement.classList.contains('cal-drop')")
    assert abs(_under_calendar(page, "2027-02-10")) <= 2
    assert page.url == f"{BASE}/calendar/list/2027-02-10"
    # 받은 설정이 그날의 색을 바꿨을 수 있어 열린 달력도 다시 그리고, 포커스는 같은 날에 둔다(코드 리뷰 2026-11-28)
    assert page.evaluate("() => !window.__day.isConnected && document.activeElement.dataset.date === '2027-02-10'")
    _press(page, ".cal-picker-trigger")   # 새로 그린 아이콘으로 닫는다
    page.wait_for_timeout(500)
    assert _picker(page) is None
    assert page.evaluate("getComputedStyle(document.getElementById('app')).transform") == "none"
    assert page.evaluate("document.activeElement.classList.contains('cal-picker-trigger')")


def test_a_day_near_the_end_of_the_drawn_list_still_comes_to_the_top(mobile_context):
    """달력에서 고른 날이 그려 둔 목록의 아래 끝 가까이에 있으면 스크롤이 끝에 막혀 그 줄이 맨 위에 오지 못한다. 그때는 목록을 그날부터 다시 그려,
    맨 위 줄과 주소와 달력의 지금 보는 날이 모두 고른 날이다(코드 리뷰 2026-11-28. 전에는 몇 줄 위의 날이 맨 위에 남아 주소가 그날로 바뀌었다)."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-03-01")
    last = page.evaluate("() => [...document.querySelectorAll('li[data-date]')].pop().dataset.date")   # 그려 둔 마지막 줄
    assert last.startswith("2027-03"), last
    _open_picker(page)
    _press(page, f".cal-picker a[href='/calendar/list/{last}']")
    page.wait_for_timeout(600)   # 스크롤로 맨 위 줄을 적는 처리까지 기다린다
    assert page.url == f"{BASE}/calendar/list/{last}"
    assert _picker(page)["current"] == f"/calendar/list/{last}"
    assert abs(_under_calendar(page, last)) <= 2


def test_the_dropped_calendar_follows_the_list_scrolled_below_it(mobile_context):
    """달력이 열린 동안에도 밀려난 목록을 스크롤할 수 있고, 맨 위 줄이 바뀌면 달력의 지금 보는 날이 그 줄의 날로, 다른 달이면 그 달로 바뀐다
    (ADR-058 §3). 목록을 누른다고 달력이 닫히지는 않는다. 줄을 누르면 그날의 전례독서로 간다. 새 화면은 처음부터 상단 바 아래 제자리에 그리고,
    달력만 그 위에서 접혀 올라간다(사용자 결정 2026-11-28)."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-02-24")
    _open_picker(page)
    page.mouse.move(195, 760)
    page.mouse.wheel(0, 1500)
    page.wait_for_function("() => location.pathname.startsWith('/calendar/list/2027-03')", timeout=5000)
    page.wait_for_timeout(300)
    top = page.evaluate("location.pathname")
    state = _picker(page)
    assert state is not None and state["current"] == top and state["title"] == "2027년 3월", (top, state)
    assert page.locator(".cal-picker [aria-current='true']").count() == 1
    assert page.evaluate("""d => { const li = document.querySelector(`li[data-date="${d}"]`).getBoundingClientRect();
        const line = document.querySelector('.cal-picker').getBoundingClientRect().bottom + document.querySelector('.cal-week').getBoundingClientRect().height;
        return li.top <= line + 8 && li.bottom > line + 8; }""", top.rsplit("/", 1)[1])   # 맨 위 줄은 달력 바로 아래에 보이는 줄이다
    head = page.evaluate("""() => { const p = document.querySelector('.cal-picker').getBoundingClientRect().bottom;
        const h = [...document.querySelectorAll('.cal-week')].find((w) => Math.abs(w.getBoundingClientRect().top - p) < 2).getBoundingClientRect();
        return { x: h.left + h.width / 2, y: h.top + h.height / 2 }; }""")
    page.mouse.click(head["x"], head["y"])   # 달력 바로 아래에 고정된 주간 라벨
    page.wait_for_timeout(300)
    assert _picker(page) is not None
    row = page.evaluate("""() => { const p = document.querySelector('.cal-picker').getBoundingClientRect().bottom + 120;
        const a = [...document.querySelectorAll('.cal-list a.cal-row')].find((r) => r.getBoundingClientRect().top > p);
        const r = a.getBoundingClientRect(); return { href: a.getAttribute('href'), x: r.left + r.width / 2, y: r.top + 10 }; }""")
    page.evaluate(RECORD_FRAMES)
    page.mouse.click(row["x"], row["y"])
    page.wait_for_url(f"{BASE}{row['href']}")
    page.wait_for_selector(".lect-head")
    assert_calendar_folds_over_the_new_screen(page, row["href"])
    assert _picker(page) is None
    assert page.evaluate("[getComputedStyle(document.getElementById('app')).transform, document.documentElement.classList.contains('cal-drop')]") == ["none", False]


def test_leaving_while_the_calendar_folds_up_draws_the_new_screen_in_place(mobile_context):
    """달력을 닫아 접히는 동안(목록이 올라오는 중) 줄을 눌러 다른 화면으로 가도, 새 화면은 처음부터 제자리이고 달력만 마저 접힌다(ADR-058 §3,
    코드 리뷰 2026-11-28). 라우터가 접히는 중인 판을 만나도 밀어 낸 화면을 제자리에 둔다(overlay.js `onNavigateAway`)."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2026-12-15")
    _open_picker(page)
    href = page.evaluate("""() => { const p = document.querySelector('.cal-picker').getBoundingClientRect().bottom + 120;
        return [...document.querySelectorAll('.cal-list a.cal-row')].find((r) => r.getBoundingClientRect().top > p).getAttribute('href'); }""")
    page.evaluate(RECORD_FRAMES)
    page.evaluate("""h => { document.querySelector('.cal-picker-trigger').click();
        requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`.cal-list a.cal-row[href="${h}"]`).click())); }""", href)
    page.wait_for_url(f"{BASE}{href}")
    page.wait_for_selector(".lect-head")
    assert_calendar_folds_over_the_new_screen(page, href)


def test_the_popover_does_not_follow_the_list_scrolled_behind_it(desktop_context):
    """큰 화면의 팝오버는 뒤를 막으므로, 그 뒤에서 목록이 스크롤돼도 보던 판을 바꾸지 않는다(코드 리뷰 2026-11-28). 달력이 맨 위 줄을 따라가는 것은
    작은 화면의 내려오는 달력뿐이다(ADR-058 §3)."""
    page = desktop_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2026-12-15")
    _open_picker(page)
    _press(page, ".cal-picker .cal-picker-step >> nth=1")
    page.wait_for_timeout(150)
    assert _picker(page)["title"] == "2027년 1월"
    page.evaluate("() => window.scrollBy(0, 900)")
    page.wait_for_timeout(700)   # 스크롤이 멈추면 맨 위 줄을 주소에 남긴다
    assert page.evaluate("location.pathname") != "/calendar/list/2026-12-15"
    assert _picker(page)["title"] == "2027년 1월"   # 보던 달이 그대로다
    _press(page, ".cal-picker .cal-picker-step >> nth=0")
    page.wait_for_timeout(150)
    assert _picker(page)["current"] == "/calendar/list/2026-12-15"   # 지금 보는 날도 연 때의 날이다


def test_dropped_calendar_starts_under_the_status_bar_and_fits_320px(browser):
    """상태 표시줄 높이가 있어도 달력은 상단 바의 아래 끝에서 시작하고, 320px에서 큰 글자로도 가로로 넘치지 않으며 날마다 누를 자리가 있다."""
    ctx = browser.new_context(viewport={"width": 320, "height": 640}, user_agent=IPHONE_UA, is_mobile=True, has_touch=True)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        _freeze_today(page)
        _open_list(page, "calendar/list/2027-02-01")
        emulate_status_bar(page, 47)
        page.evaluate("() => { document.documentElement.style.fontSize = '20px'; }")
        page.wait_for_timeout(200)
        _open_picker(page)
        state = page.evaluate("""() => { const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
            const p = document.querySelector('.cal-picker').getBoundingClientRect();
            const day = document.querySelector('.cal-picker-day').getBoundingClientRect();
            return { gap: p.top - bar, over: document.documentElement.scrollWidth - 320, bottom: p.bottom, h: innerHeight, dayW: day.width, dayH: day.height }; }""")
        assert abs(state["gap"]) <= 1 and state["over"] == 0 and state["bottom"] <= state["h"], state
        assert state["dayW"] >= 36 and state["dayH"] >= 36, state
    finally:
        ctx.close()


def test_picker_title_steps_up_to_months_and_years_and_back_down(mobile_context):
    """판은 한 번에 한 단계만 보인다. 날 판의 머리를 누르면 달 판, 달 판의 머리를 누르면 해 판(열두 해)이다. 해를 고르면 그해의 달 판,
    목록에서 달을 고르면 그달의 날 판으로 내려간다. 내려간 판은 처음 칸에 포커스를 둔다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-02-01")
    _open_picker(page)
    _press(page, "#page-title button.cal-picker-title")   # 작은 화면에서 달력의 머리는 상단 바에 있다(ADR-061 §3)
    page.wait_for_timeout(150)
    state = _picker(page)
    assert (state["title"], state["cells"], state["current"]) == ("2027년", 12, "2월"), state
    assert page.get_attribute("#page-title button.cal-picker-title", "aria-label") == "2027년, 해 고르기"
    assert page.locator(".cal-picker-body a").count() == 0   # 목록의 달은 판 안에서 내려가는 단추다
    _press(page, "#page-title button.cal-picker-title")
    page.wait_for_timeout(150)
    state = _picker(page)
    assert (state["title"], state["cells"], state["current"]) == ("2023-2034년", 12, "2027"), state
    assert page.locator("button.cal-picker-title").is_hidden()   # 해 판의 머리는 글자만
    assert page.locator("#page-title span.cal-picker-title").is_visible()
    _press(page, ".cal-picker button[data-year='2030']")
    page.wait_for_timeout(150)
    state = _picker(page)
    assert (state["title"], state["focus"]) == ("2030년", "1월"), state
    _press(page, ".cal-picker button[data-month='12']")
    page.wait_for_timeout(150)
    state = _picker(page)
    # 31일과 마지막 주를 채운 다음 달의 날 넷(1-4일). 작은 화면의 달력은 앞뒤 달의 날을 흐리게 둔다(ADR-058 §3)
    assert (state["title"], state["cells"], state["focus"]) == ("2030년 12월", 35, "/calendar/list/2030-12-01"), state


def test_month_title_opens_the_month_picker_as_a_popover_and_goes_to_the_month(desktop_context):
    """월간의 달 제목은 달 판을 연다. 마우스를 쓰는 넓은 화면에서는 제목 아래 팝오버이고 뒤를 가리지 않는다. 달은 그 달로 가는 링크다."""
    page = desktop_context.new_page()
    _freeze_today(page)
    _open(page, "calendar/2027-02")
    _open_picker(page)
    state = _picker(page)
    assert (state["title"], state["current"], state["focus"]) == ("2027년", "/calendar/2027-02", "/calendar/2027-02"), state
    assert page.get_attribute(".cal-title-btn", "aria-label") == "2027년 2월, 해와 달 고르기"
    assert page.get_attribute(".cal-picker", "aria-label") == "해와 달 고르기"   # 판의 이름도 제목 단추가 알리는 일과 같다
    box = page.evaluate("""() => { const p = document.querySelector('.cal-picker').getBoundingClientRect();
        const t = document.querySelector('.cal-title-btn').getBoundingClientRect();
        return { gap: p.top - t.bottom, mid: (p.left + p.right) / 2 - (t.left + t.right) / 2 }; }""")
    assert 0 < box["gap"] <= 12 and abs(box["mid"]) <= 1, box
    # 팝오버는 뒤를 막고 화면을 밀어 내지 않는다
    assert page.evaluate("""() => [getComputedStyle(document.getElementById('app')).transform, getComputedStyle(document.querySelector('.cal-picker-backing')).display,
        document.getElementById('app').inert, document.querySelector('.cal-picker').getAttribute('aria-modal')]""") == ["none", "none", True, "true"]
    # 팝오버는 테두리가 있어 작은 화면 달력의 구분선을 긋지 않는다
    assert page.evaluate("getComputedStyle(document.querySelector('.cal-picker'), '::after').content") == "none"
    assert page.locator(".cal-picker-close").count() == 0   # 「닫기」 단추는 없다(사용자 결정 2026-11-28)
    _press(page, ".cal-picker .cal-picker-step >> nth=1")
    page.wait_for_timeout(150)
    assert _picker(page)["title"] == "2028년"
    _press(page, ".cal-picker a[href='/calendar/2028-03']")
    page.wait_for_url(f"{BASE}/calendar/2028-03")
    page.wait_for_timeout(300)
    assert _picker(page) is None
    assert _shown_month(page) == "2028년 3월"
    assert page.evaluate("document.activeElement.classList.contains('cal-title-btn')")


def test_picker_closes_without_moving_the_list_and_returns_focus(mobile_context):
    """아이콘을 다시 누르거나 Esc를 누르면 닫히고 포커스는 아이콘으로 돌아간다(ADR-058 §3). 「닫기」 단추는 없다(사용자 결정 2026-11-28). 목록은 제자리로
    올라오고 스크롤 값과 주소는 그대로다. 포커스 테두리는 닫은 입력으로 정해, 탭으로 열었어도 키보드로 닫으면 그리고 눌러 닫으면 그리지 않는다.
    포커스가 밀려난 목록에 있으면 Esc로 닫아도 그 자리에 둔다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2026-12-15")
    y = page.evaluate("scrollY")
    icon = page.locator(".cal-picker-trigger").bounding_box()
    for close in ("icon", "escape", "enter"):
        _open_picker(page)
        assert page.locator(".cal-picker-close").count() == 0, close
        if close == "icon":
            page.mouse.click(icon["x"] + icon["width"] / 2, icon["y"] + icon["height"] / 2)
        elif close == "escape":
            page.keyboard.press("Escape")
        else:   # 키보드로 아이콘에 가서 다시 누른다. 상단 바는 막히지 않는다
            page.evaluate("document.querySelector('.cal-picker-trigger').focus({ preventScroll: true })")
            page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        assert _picker(page) is None, close
        assert page.evaluate("document.activeElement.classList.contains('cal-picker-trigger')"), close
        if close != "enter":
            assert page.evaluate("document.activeElement.matches(':focus-visible')") is (close == "escape"), close
        assert page.get_attribute(".cal-picker-trigger", "aria-expanded") == "false", close
        assert page.evaluate("scrollY") == y, close
        assert page.url == f"{BASE}/calendar/list/2026-12-15", close
        assert abs(_row_top_under_head(page, "2026-12-15")) <= 2, close
    _open_picker(page)
    page.evaluate("document.querySelector('li[data-date=\"2026-12-16\"] a').focus({ preventScroll: true })")
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    assert _picker(page) is None
    assert page.evaluate("document.activeElement.closest('li')?.dataset.date") == "2026-12-16"


def test_dropped_calendar_slides_down_and_up_unless_motion_is_reduced(mobile_context):
    """달력은 상단 바 아래에서 펼쳐져 내려오고 위로 접혀 올라간다. 판은 옮기지 않고 아래 끝만 잘라 펼치며, 안의 칸이 미끄러진다. 머리는 상단 바에
    있어(ADR-061 §3) 판 안의 머리 줄은 비어 숨는다. 움직임을 줄인 설정에서는 바로 나타나고 사라진다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2026-12-15")
    _press(page, ".cal-picker-trigger")
    page.wait_for_selector(".cal-picker:not([hidden])")
    # 판과 그 안의 보이는 줄의 움직임. 판 안의 머리 줄(`.cal-picker-head`)은 머리가 상단 바로 옮겨 가 비어 숨는다
    names = lambda: page.evaluate("""() => { const p = document.querySelector('.cal-picker');
        return [p.getAnimations().map(a => a.animationName),
                [...p.children].filter(c => c.getClientRects().length).map(c => c.getAnimations().map(a => a.animationName).join())]; }""")
    assert names() == [["cal-picker-in-down"], ["cal-picker-slide-in"]]
    assert page.evaluate("getComputedStyle(document.querySelector('.cal-picker-head')).display") == "none"
    # 움직이는 동안 보이는 위 끝이 상단 바의 아래 끝에 있다. 바를 덮지 않고(코드 리뷰 2026-11-26), 바와 판 사이에 틈도 없다.
    # 판은 옮기지 않아(transform 없음) 위 끝이 판의 움직임에 기대지 않는다. 아이폰 Safari는 옮기기를 자르기보다 앞서 움직여, 판째로 옮기던 때는
    # 그 틈이 어두운 선으로 보였다(사용자 보고 2026-11-28). 그래서 안의 내용이 판보다 앞서 움직여도 위 끝이 같은지 본다
    visible_top = """(t) => { const p = document.querySelector('.cal-picker'); const own = p.getAnimations();
        const kids = p.getAnimations({ subtree: true }).filter(a => !own.includes(a)); const all = [...own, ...kids];
        all.forEach(a => a.pause()); const d = own[0].effect.getTiming().duration;
        own[0].currentTime = d * t; kids.forEach(a => { a.currentTime = d * Math.min(t + 0.1, 1); });
        const s = getComputedStyle(p); const m = s.clipPath.match(/^inset\\((-?[\\d.]+)px/);
        const top = p.getBoundingClientRect().top + (m ? Number(m[1]) : 0);
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom; all.forEach(a => a.play());
        return { gap: top - bar, moved: s.transform !== 'none' }; }"""
    # 판의 위 끝은 상단 바 아래 끝을 내림한 자리라(`placePicker`) 1px 안에서 바와 겹칠 수 있다
    for t in (0, 0.25, 0.5, 0.75):
        r = page.evaluate(visible_top, t)
        assert -1 < r["gap"] <= 0.5 and not r["moved"], (t, r)
    page.wait_for_timeout(500)
    page.keyboard.press("Escape")
    assert names() == [["cal-picker-out-up"], ["cal-picker-slide-out"]]
    for t in (0.25, 0.5, 0.75, 1):
        r = page.evaluate(visible_top, t)
        assert -1 < r["gap"] <= 0.5 and not r["moved"], (t, r)
    page.wait_for_selector(".cal-picker", state="hidden")
    # 안의 칸이 먼저 다 올라가도(그 animationend도 판으로 올라온다) 판 자신의 움직임이 끝날 때까지 숨기지 않는다
    _open_picker(page)
    page.keyboard.press("Escape")
    page.evaluate("""() => { const p = document.querySelector('.cal-picker'); const own = p.getAnimations(); own.forEach(a => a.pause());
        p.getAnimations({ subtree: true }).filter(a => !own.includes(a)).forEach(a => a.finish()); }""")
    page.wait_for_timeout(100)
    assert page.evaluate("document.querySelector('.cal-picker').hidden") is False
    page.evaluate("document.querySelector('.cal-picker').getAnimations().forEach(a => a.finish())")
    page.wait_for_selector(".cal-picker", state="hidden")
    page.emulate_media(reduced_motion="reduce")
    _press(page, ".cal-picker-trigger")
    page.wait_for_selector(".cal-picker:not([hidden])")
    assert names() == [[], [""]]
    page.keyboard.press("Escape")
    assert page.evaluate("document.querySelector('.cal-picker').hidden") is True


def test_the_list_moves_with_the_unfolding_calendar_and_never_shows_what_was_under_the_bar(mobile_context):
    """목록은 달력이 펼쳐지고 접히는 것과 같은 시간에 밀려나고 올라온다(ADR-058 §3). 밀려나는 동안 상단 바 아래로 나온 자리(상단 바에 가려져 있던 줄)는
    펼쳐지는 달력과 그 뒤의 바탕이 덮는다. 아이폰 Safari는 옮기기(목록)를 자르기(달력)보다 앞서 움직이므로(design-system.md pitfalls §44), 목록이 앞서도
    바탕의 아래 끝은 목록의 위 끝에 있다. 움직임을 줄인 설정에서는 목록이 바로 밀려나고 바로 올라온다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2026-12-15")
    _press(page, ".cal-picker-trigger")
    page.wait_for_selector(".cal-picker:not([hidden])")
    at = """([t, lead]) => { const p = document.querySelector('.cal-picker'); const app = document.getElementById('app');
        const back = document.querySelector('.cal-picker-backing'); const own = p.getAnimations({ subtree: true });
        const push = [...app.getAnimations(), ...back.getAnimations()]; [...own, ...push].forEach(a => a.pause());
        const d = own[0].effect.getTiming().duration; own.forEach(a => { a.currentTime = d * t; });
        push.forEach(a => { a.currentTime = Math.min(d * (t + lead), d); });
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        const moved = new DOMMatrixReadOnly(getComputedStyle(app).transform).m42;
        const toks = (getComputedStyle(p).clipPath.match(/^inset\\((.*)\\)$/)?.[1] ?? '0px').split(' ');
        const r = p.getBoundingClientRect(); const bottom = toks[2] ?? toks[0];
        const cut = bottom.endsWith('%') ? r.height * parseFloat(bottom) / 100 : parseFloat(bottom) || 0;
        const out = { pushes: push.length, moved, panelBottom: r.bottom - cut - (bar + moved), backing: back.getBoundingClientRect().bottom - (bar + moved) };
        [...own, ...push].forEach(a => a.play()); return out; }"""
    for t in (0.25, 0.5, 0.75):
        r = page.evaluate(at, [t, 0])
        assert r["pushes"] == 2 and 0 < r["moved"], (t, r)
        assert r["panelBottom"] >= -1 and abs(r["backing"]) < 0.01, (t, r)   # 달력이 목록의 위 끝까지 덮는다
        r = page.evaluate(at, [t, 0.15])   # 목록이 달력보다 앞서도 바탕이 덮는다
        assert abs(r["backing"]) < 0.01, (t, r)
    page.wait_for_timeout(500)
    page.keyboard.press("Escape")
    assert page.evaluate("document.getElementById('app').getAnimations().length") == 1   # 목록도 함께 올라온다
    page.wait_for_selector(".cal-picker", state="hidden")
    page.wait_for_timeout(100)
    assert page.evaluate("""[getComputedStyle(document.getElementById('app')).transform,
        document.querySelector('.cal-picker-backing').getBoundingClientRect().height]""") == ["none", 0]
    page.emulate_media(reduced_motion="reduce")
    _press(page, ".cal-picker-trigger")
    page.wait_for_selector(".cal-picker:not([hidden])")
    state = page.evaluate("""() => ({ anims: document.getElementById('app').getAnimations().length,
        moved: new DOMMatrixReadOnly(getComputedStyle(document.getElementById('app')).transform).m42 })""")
    assert state["anims"] == 0 and state["moved"] > 0, state
    assert abs(page.evaluate(SCREEN_UNDER_DIVIDER)) < 0.01
    page.keyboard.press("Escape")
    assert page.evaluate("getComputedStyle(document.getElementById('app')).transform") == "none"


def test_the_list_follows_the_calendar_height_with_the_same_motion(mobile_context):
    """판을 바꾸거나 달을 옮겨 달력의 높이가 바뀌면 목록도 달력이 펼쳐질 때와 같은 움직임으로 그만큼 따라가, 움직임이 끝나면 맨 위 줄이 달력
    바로 아래에 있다(ADR-058 §3, 사용자 결정 2026-11-28. 그전에는 움직임 없이 튀었다)."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2026-12-15")
    _open_picker(page)
    gap = lambda: _under_calendar(page, "2026-12-15")
    first = gap()
    moving = "() => document.getElementById('app').getAnimations().some((a) => a.playState === 'running')"
    _press(page, "#page-title button.cal-picker-title")   # 날 판(다섯 주)에서 달 판(세 줄)으로. 머리는 상단 바에 있다
    page.wait_for_timeout(40)
    assert page.evaluate(moving)
    page.wait_for_timeout(400)
    assert abs(gap() - first) <= 1
    _press(page, ".cal-picker button[data-month='1']")   # 2026년 1월은 다섯 주, 2월은 네 주다
    page.wait_for_timeout(400)
    _press(page, "#page-title .cal-picker-step >> nth=1")
    page.wait_for_timeout(40)
    assert page.evaluate(moving)
    page.wait_for_timeout(400)
    assert abs(gap() - first) <= 1


def test_the_dropped_calendar_fills_the_first_and_last_weeks_with_faded_neighbouring_days(mobile_context, desktop_context):
    """작은 화면의 달력은 첫 주와 마지막 주의 빈 칸을 앞뒤 달의 날로 흐리게 채우고, 누르면 그날로 간다(ADR-058 §3, 사용자 결정 2026-11-28).
    이름은 그날의 달로 읽는다. 누르면 목록이 그날의 줄을 달력 바로 아래에 두고 달력은 그 달로 넘어간다. 큰 화면의 팝오버는 그 칸을 비운다."""
    page = mobile_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-02-10")
    length = page.evaluate("() => history.length")
    _open_picker(page)
    outside = page.evaluate("""() => [...document.querySelectorAll('.cal-picker .cal-picker-day.is-outside')].map((a) => [a.dataset.date, a.getAttribute('aria-label')])""")
    assert outside[0] == ["2027-01-31", "1월 31일 일요일, 녹색"], outside
    assert [o[0] for o in outside[1:]] == [f"2027-03-0{d}" for d in range(1, 7)], outside
    look = page.evaluate("""() => { const a = document.querySelector('.cal-picker a[data-date="2027-03-01"]'), b = document.querySelector('.cal-picker a[data-date="2027-02-27"]');
        const tertiary = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim();
        const probe = document.createElement('span'); probe.style.color = tertiary; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove();
        return { num: getComputedStyle(a.querySelector('.cal-picker-num')).color, want, inMonth: getComputedStyle(b.querySelector('.cal-picker-num')).color,
                 bars: getComputedStyle(a.querySelector('.cal-picker-bars')).opacity }; }""")
    assert look["num"] == look["want"] and look["inMonth"] != look["want"] and float(look["bars"]) < 1, look
    _press(page, ".cal-picker a[data-date='2027-01-31']")   # 앞 달의 날(1월의 첫 줄이 아니라 달 이름 아래가 아니다)
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-31")
    page.wait_for_timeout(500)
    state = _picker(page)
    assert state["title"] == "2027년 1월" and state["current"] == "/calendar/list/2027-01-31", state
    assert abs(_under_calendar(page, "2027-01-31")) <= 2
    assert page.evaluate("() => history.length") == length

    big = desktop_context.new_page()
    _freeze_today(big)
    _open_list(big, "calendar/list/2027-02-10")
    _press(big, ".cal-picker-trigger")
    big.wait_for_selector(".cal-picker:not([hidden])")
    assert big.evaluate("() => document.querySelectorAll('.cal-picker .cal-picker-day.is-outside').length") == 0
    assert big.evaluate("() => document.querySelectorAll('.cal-picker .cal-picker-day').length") == 28


@pytest.mark.only_browser("chromium")
def test_dropped_calendar_stays_above_the_home_indicator(mobile_context):
    """가로로 든 휴대폰에서 내려온 달력은 홈 표시줄의 자리(아래 안전 영역) 위에서 끝난다(코드 리뷰 2026-11-26)."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 667, "height": 375})
    _freeze_today(page)
    emulate_side_safe_areas(page, 0, 0, bottom=21)
    _open_list(page, "calendar/list/2027-01-30")   # 여섯 주인 달은 판이 최대 높이가 된다
    _open_picker(page)
    state = page.evaluate("""() => ({ bottom: document.querySelector('.cal-picker').getBoundingClientRect().bottom, h: innerHeight,
        scrolls: (b => b.scrollHeight > b.clientHeight)(document.querySelector('.cal-picker-body')) })""")
    assert state["scrolls"] and state["bottom"] <= state["h"] - 21, state


def test_dropped_calendar_fits_a_short_screen_and_scrolls_only_its_cells(mobile_context):
    """화면이 낮으면(휴대폰을 가로로 든 때) 내려온 달력은 화면 안에 있고 칸만 스크롤한다. 머리는 상단 바에 있어(ADR-061 §3) 칸을 스크롤해도 보인다.
    지금 보는 날과 마지막 주의 날을 고를 수 있다."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 667, "height": 375})
    _freeze_today(page)
    _open_list(page, "calendar/list/2027-01-30")   # 2027년 1월은 여섯 주이고, 30일은 마지막 주다
    _open_picker(page)
    state = page.evaluate("""() => { const p = document.querySelector('.cal-picker').getBoundingClientRect();
        const b = document.querySelector('.cal-picker-body'); const br = b.getBoundingClientRect();
        const cur = document.querySelector('.cal-picker-body [aria-current="true"]').getBoundingClientRect();
        const head = document.querySelector('#page-title button.cal-picker-title').getBoundingClientRect();
        return { top: p.top, bottom: p.bottom, h: innerHeight, scrolls: b.scrollHeight > b.clientHeight,
                 headIn: head.top >= 0 && head.bottom <= p.top + 1, curIn: cur.top >= br.top - 1 && cur.bottom <= br.bottom + 1 }; }""")
    assert state["top"] >= 0 and state["bottom"] <= state["h"] + 1, state
    assert state["scrolls"] and state["headIn"] and state["curIn"], state
    y = page.evaluate("scrollY")
    box = page.locator(".cal-picker-body").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.wheel(0, 400)   # 마지막 주(31일)는 칸을 스크롤해야 보인다
    page.wait_for_timeout(300)
    assert page.evaluate("scrollY") == y   # 목록은 움직이지 않는다
    last = page.evaluate("""() => { const b = document.querySelector('.cal-picker-body').getBoundingClientRect();
        const r = document.querySelector(".cal-picker a[href='/calendar/list/2027-01-31']").getBoundingClientRect();
        return r.top >= b.top - 1 && r.bottom <= b.bottom + 1; }""")
    assert last
    _press(page, ".cal-picker a[href='/calendar/list/2027-01-31']")
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-31")


@pytest.mark.parametrize("touch", [True, False])
def test_month_title_keeps_its_text_color_after_a_tap(browser, touch):
    """큰 화면의 달 제목을 눌러 판을 열고 닫은 뒤에도 제목은 글자색이다. iOS는 누른 자리에 :hover를 남기므로 장 고르기 단추(.title-picker-btn)의
    호버 색은 호버할 수 있는 기기에서만 쓴다(DESIGN.md 「포인터 분기」, 코드 검토 2026-11-18). 마우스는 올려 둔 동안 강조색이다."""
    opts = dict(viewport={"width": 1024, "height": 768}, user_agent=IPHONE_UA, has_touch=True, is_mobile=True) if touch else {}
    ctx = browser.new_context(**opts)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _freeze_today(page)
        _open_list(page, "calendar/list/2027-05-01")
        box = page.locator(".cal-title-btn").bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        if touch:
            page.touchscreen.tap(x, y)
        else:
            page.mouse.click(x, y)
        page.wait_for_selector(".cal-picker:not([hidden])")
        page.wait_for_timeout(400)
        page.keyboard.press("Escape")
        page.wait_for_selector(".cal-picker", state="hidden")
        # iOS가 남기는 상태: 누른 자리에 :hover가 남아 있다. 터치 환경의 Chromium은 탭 뒤에 :hover를 남기지 않으므로 포인터를 그 자리에 둔다
        page.mouse.move(x, y)
        page.wait_for_timeout(200)
        state = page.evaluate("""() => {
            const b = document.querySelector('.cal-title-btn');
            const colorOf = (v) => { const s = document.createElement('span'); s.style.color = v; document.body.append(s);
                const c = getComputedStyle(s).color; s.remove(); return c; };
            return { hover: b.matches(':hover'), color: getComputedStyle(b).color, text: colorOf('var(--text)'), accent: colorOf('var(--accent)') };
        }""")
        assert state["hover"] is True and state["text"] != state["accent"], state
        assert state["color"] == (state["text"] if touch else state["accent"]), state
    finally:
        ctx.close()


def test_picker_popover_closes_in_place_when_the_window_narrows(desktop_context):
    """팝오버를 연 채 창이 휴대폰 폭으로 좁아지면 미끄러지는 움직임 없이 바로 닫고 팝오버의 자리를 지운다. 다시 열면 상단 바 아래로 내려오는 달력이다(ADR-058 §3)."""
    page = desktop_context.new_page()
    _freeze_today(page)
    _open(page, "calendar/2027-02")
    _open_picker(page)
    page.set_viewport_size({"width": 600, "height": 800})
    page.wait_for_timeout(50)
    state = page.evaluate("""() => { const p = document.querySelector('.cal-picker');
        return { hidden: p.hidden, closing: p.classList.contains('cal-picker-closing'), top: p.style.top, left: p.style.left }; }""")
    assert state == {"hidden": True, "closing": False, "top": "", "left": ""}, state
    page.wait_for_selector(".cal-rows", timeout=20_000)   # 월간은 작은 화면에서 목록으로 다시 그려진다
    _open_picker(page)
    gap = page.evaluate("document.querySelector('.cal-picker').getBoundingClientRect().top - document.getElementById('sticky-group').getBoundingClientRect().bottom")
    assert abs(gap) <= 1


def test_picker_stays_open_on_a_modified_click_and_follows_a_rebuilt_bar(desktop_context):
    """수정 키를 누른 클릭은 새 탭에서 열리므로 판을 닫지 않는다. 팝오버 아래로 목록을 스크롤해 계산 범위 끝에서 상단 바를 다시 그려도, 판은 새 제목
    단추 아래에 자리를 잡고 닫으면 포커스가 새 제목 단추로 돌아간다."""
    page = desktop_context.new_page()
    _freeze_today(page)
    _open_list(page, "calendar/list/9999-11-20")
    _open_picker(page)
    box = page.locator(".cal-picker a[href='/calendar/list/9999-11-10']").bounding_box()
    page.keyboard.down("Control")
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.keyboard.up("Control")
    page.wait_for_timeout(200)
    assert _picker(page) is not None
    assert page.url == f"{BASE}/calendar/list/9999-11-20"
    page.mouse.move(200, 500)   # 팝오버 밖의 목록 위
    for _ in range(25):
        page.mouse.wheel(0, 400)
        page.wait_for_timeout(80)
    page.wait_for_timeout(600)
    assert page.locator("#page-title a[data-focus-key='next']").count() == 0   # 9999년 12월이라 바를 다시 그렸다
    assert _picker(page)["expanded"] == "true"
    page.set_viewport_size({"width": 1100, "height": 800})
    page.wait_for_timeout(100)
    box = page.evaluate("""() => { const p = document.querySelector('.cal-picker').getBoundingClientRect();
        const t = document.querySelector('.cal-title-btn').getBoundingClientRect();
        return { gap: p.top - t.bottom, mid: (p.left + p.right) / 2 - (t.left + t.right) / 2 }; }""")
    assert 0 < box["gap"] <= 12 and abs(box["mid"]) <= 1, box
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    assert page.evaluate("document.activeElement.classList.contains('cal-title-btn')")


def test_picker_steps_stop_at_the_ends_of_the_calendar(desktop_context):
    """캘린더의 계산 범위(1583-9999년) 밖으로는 옮기지 않는다. 범위 끝이라 더 누를 수 없게 된 단추의 포커스는 맞은편 단추로 옮긴다."""
    page = desktop_context.new_page()
    _freeze_today(page)
    _open(page, "calendar/1584-01")
    _open_picker(page)
    assert _picker(page)["prev"] is True
    page.locator(".cal-picker .cal-picker-step").first.focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    state = _picker(page)
    assert (state["title"], state["prev"], state["next"]) == ("1583년", False, True), state
    assert page.evaluate("document.activeElement === document.querySelectorAll('.cal-picker-step')[1]")
    page.keyboard.press("Escape")
    _open(page, "calendar/9999-12")
    _open_picker(page)
    _press(page, ".cal-picker button.cal-picker-title")
    page.wait_for_timeout(150)
    state = _picker(page)
    assert (state["title"], state["next"]) == ("9988-9999년", False), state


def test_picker_works_with_the_keyboard(desktop_context):
    """키보드로 제목 단추를 열면 지금 보는 칸에 포커스가 가고, Tab과 Shift+Tab은 판 안에서만 돈다. 끝에서 처음으로 돌아온다. 이번 달은 날짜 없이 `/calendar`다. Enter로 고르면 그 달로 가고 제목 단추에 포커스가 돌아온다."""
    page = desktop_context.new_page()
    _freeze_today(page)
    _open(page, "calendar/2026-11")
    page.evaluate("() => document.querySelector('.cal-title-btn').focus({ preventScroll: true })")
    page.keyboard.press("Enter")
    page.wait_for_selector(".cal-picker:not([hidden])")
    page.wait_for_timeout(200)
    assert _picker(page)["focus"] == "/calendar"   # 이번 달(2026년 11월)
    inside = "document.querySelector('.cal-picker').contains(document.activeElement)"
    seen = set()
    for _ in range(20):
        page.keyboard.press("Tab")
        assert page.evaluate(inside)
        seen.add(page.evaluate("document.activeElement.className"))
    assert "cal-picker-title" in seen   # 마지막 칸에서 Tab을 누르면 머리의 단추로 돌아온다
    for _ in range(20):
        page.keyboard.press("Shift+Tab")
        assert page.evaluate(inside)
    page.locator(".cal-picker a[href='/calendar/2026-05']").focus()
    page.keyboard.press("Enter")
    page.wait_for_url(f"{BASE}/calendar/2026-05")
    page.wait_for_timeout(300)
    assert page.evaluate("document.activeElement.classList.contains('cal-title-btn')")
