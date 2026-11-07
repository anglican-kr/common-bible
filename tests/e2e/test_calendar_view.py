"""E2E: 캘린더 탭 /calendar[/YYYY-MM] (ADR-038 §1 · §2 A2).

엔진(resolveDate)이 낸 날들을 월간 표(js/app/calendar.js)가 어떻게 그리는지 — 탭 바 →
라우팅 → 캘린더 묶음 프리로드 → DOM 커밋의 배선과, 유닛이 못 보는 화면 동작(링크 이동 ·
탭 복원 · 좁은 화면 넘침 · 데스크톱 입구)을 검증한다.

  ① 탭 — 홈 다음 두 번째, 누르면 이번 달 · 활성 표시 · 오늘 칸
  ② 달 이동 — 이전/다음/오늘이 링크(뒤로 가기 · 주소 그대로)
  ③ 칸 → 전례독서, 독서 화면의 위 단계 → 그 날짜의 달
  ④ 칸의 이름 · 색 점 · 링크 이름(사용자 결정 2026-10-15 의 날짜 예 — 링크 이름은 칸에 보이는 이름 그대로)
  ⑤ 탭 복원 — 다른 탭에 다녀오면 마지막 캘린더 화면, 탭을 다시 누르면 이번 달 · 수정 키 클릭은 새 탭 몫
  ⑥ 320px 폭에서 가로 넘침 없음(1.6.0 달력의 넘침 재발 방지)
  ⑦ 잘못된 달 · 자료 실패 · 데스크톱 헤더 입구(탭과 같은 곳으로)
  ⑧ 달 이동 뒤 키보드 포커스가 누른 컨트롤에 남는다

실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「테스트」).
"""
import datetime
import re

import pytest

from .conftest import CLEAR_APP_STORAGE, IPHONE_UA

BASE = "http://localhost:8080"


def _open(page, path):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(".calendar", timeout=20_000)
    page.wait_for_timeout(100)


def _cell(page, date):
    return page.locator(f".cal-grid a.cal-cell[href='/lectionary/{date}']")


def _this_month():
    t = datetime.date.today()
    return t, f"{t.year}년 {t.month}월"


# ── ① 탭 ──

def test_calendar_tab_is_second_and_opens_this_month(mobile_context):
    """탭 순서 홈 · 캘린더 · 북마크 · (노트 숨김) · 설정 — 캘린더를 누르면 /calendar 이번 달, 탭 활성 · 인디케이터 · 오늘 칸."""
    page = mobile_context.new_page()
    page.goto(BASE)
    page.wait_for_selector(".book-list", timeout=20_000)
    tabs = page.eval_on_selector_all("#tab-bar .tab-item", "els => els.map(e => e.dataset.tab + (e.hidden ? ':hidden' : ''))")
    assert tabs == ["home", "calendar", "bookmarks", "notes:hidden", "settings"], tabs
    assert page.get_attribute("#tab-bar [data-tab='calendar']", "aria-label") == "캘린더"
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_selector(".calendar", timeout=20_000)
    assert page.url == f"{BASE}/calendar"
    today, title = _this_month()
    assert page.inner_text(".cal-month") == title
    page.wait_for_selector("#tab-bar [data-tab='calendar'][aria-current='page']")
    assert page.locator("#tab-bar .tab-indicator.is-shown").count() == 1
    current = page.locator(".cal-grid a.cal-cell[aria-current='date']")
    assert current.count() == 1
    assert current.get_attribute("href") == f"/lectionary/{today.isoformat()}"
    assert current.get_attribute("aria-label").startswith("오늘, ")
    assert page.title() == f"{title} 캘린더 — 공동번역성서"


# ── ② 달 이동 ──

def test_month_nav_links_step_months_and_back_returns(desktop_context):
    """다음 달은 해를 넘고(2026-12 → 2027-01), 이전 · 오늘도 링크 — 뒤로 가기가 앞 달로 돌아온다."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-12")
    assert page.inner_text(".cal-month") == "2026년 12월"
    page.locator(".lect-datenav-btn[aria-label='다음 달']").click()
    page.wait_for_url("**/calendar/2027-01")
    page.wait_for_selector(".cal-month:has-text('2027년 1월')")
    page.locator(".lect-datenav-btn[aria-label='이전 달']").click()
    page.wait_for_url("**/calendar/2026-12")
    page.locator(".lect-datenav-btn[aria-label='이전 달']").click()
    page.wait_for_url("**/calendar/2026-11")
    page.wait_for_selector(".cal-month:has-text('2026년 11월')")
    page.go_back()
    page.wait_for_url("**/calendar/2026-12")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")
    page.locator("#page-title .lect-today").click()
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")


def test_grid_is_six_weeks_from_sunday(desktop_context):
    """2026년 10월 — 9.27(일)부터 11.7(토)까지 42칸, 앞뒤 달 칸은 흐리게 · 이름 없이 · 링크는 그대로."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-10")
    hrefs = page.eval_on_selector_all(".cal-grid tbody td > .cal-cell", "els => els.map(e => e.getAttribute('href'))")
    assert len(hrefs) == 42
    assert hrefs[0] == "/lectionary/2026-09-27" and hrefs[-1] == "/lectionary/2026-11-07"
    first = page.locator(".cal-grid tbody td > .cal-cell").first
    assert "cal-cell--out" in first.get_attribute("class")
    assert first.locator(".cal-name").count() == 0
    assert page.eval_on_selector_all(".cal-grid thead th", "els => els.map(e => e.textContent)") == ["일", "월", "화", "수", "목", "금", "토"]


# ── ③ 칸 → 전례독서 → 위 단계 ──

def test_cell_opens_lectionary_and_the_tab_returns_to_the_last_month(mobile_context):
    """12월 25일 칸을 누르면 /lectionary/2026-12-25(성탄 낮)다. 머리의 제목 자리는 그날의 날짜 이동 줄이다. 탭은 마지막으로 본 달로
    돌아간다(사용자 결정 2026-11-07)."""
    page = mobile_context.new_page()
    _open(page, "calendar/2026-12")
    _cell(page, "2026-12-25").click()
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    assert page.inner_text(".lect-day") == "성탄 낮"
    assert not page.locator("#page-title .title-home-btn").is_visible()   # 집 단추는 탭 바가 없는 데스크톱에만 보인다
    assert page.get_attribute("#page-title .lect-date time", "datetime") == "2026-12-25"
    assert page.locator("#page-title a.lect-datenav-btn[aria-label='전날']").is_visible()
    # 캘린더 탭 소속 — 독서 화면에서도 캘린더 탭이 활성
    assert page.get_attribute("#tab-bar [data-tab='calendar']", "aria-current") == "page"
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")


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
            f".cal-grid a.cal-cell[href='/lectionary/{date}'] .cal-dot",
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

def test_calendar_tab_steps_back_from_reading_to_month_to_this_month(mobile_context):
    """캘린더 → 12.25 독서 → 북마크 탭 → 캘린더 탭이면 그 독서 화면으로 돌아온다. 다시 누르면 마지막 달, 한 번 더 누르면 이번 달(ADR-038 §1)."""
    page = mobile_context.new_page()
    _open(page, "calendar/2026-12")
    _cell(page, "2026-12-25").click()
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#tab-bar [data-tab='bookmarks']").click()
    page.wait_for_url("**/bookmarks")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day:has-text('성탄 낮')", timeout=20_000)
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")


def test_calendar_tab_returns_to_the_month_from_another_tab(mobile_context):
    """달력을 보다 다른 탭에 다녀오면 그 달이다(이번 달이 아니다)."""
    page = mobile_context.new_page()
    _open(page, "calendar/2027-03")
    page.locator("#tab-bar [data-tab='bookmarks']").click()
    page.wait_for_url("**/bookmarks")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/2027-03")
    page.wait_for_selector(".cal-month:has-text('2027년 3월')")


def test_calendar_tab_keeps_the_last_month_while_reading_steps_into_another_month(mobile_context):
    """독서에서 날짜를 넘겨 다음 달로 가도, 탭은 그 날짜의 달이 아니라 마지막으로 본 달로 돌아간다(사용자 결정 2026-11-07)."""
    page = mobile_context.new_page()
    _open(page, "calendar/2026-12")
    _cell(page, "2026-12-31").click()
    page.wait_for_url("**/lectionary/2026-12-31")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#page-title a.lect-datenav-btn[aria-label='다음날']").click()
    page.wait_for_url("**/lectionary/2027-01-01*")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/2026-12")


def test_calendar_tab_restores_the_month_scroll_from_reading(mobile_context):
    """독서에서 탭으로 돌아오면 달력의 스크롤도 떠날 때 자리다."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 390, "height": 420})
    _open(page, "calendar/2026-12")
    page.evaluate("window.scrollTo(0, 120)")
    page.wait_for_function("() => Math.abs(window.scrollY - 120) < 2")
    page.evaluate("document.querySelector(\".cal-grid a.cal-cell[href='/lectionary/2026-12-25']\").click()")
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-grid")
    page.wait_for_function("() => Math.abs(window.scrollY - 120) < 2")


def test_calendar_position_survives_reopening_the_app(mobile_context):
    """앱을 다시 열어도 마지막 달로 돌아간다. 전례독서 화면과 잘못된 주소는 기억하지 않는다(ADR-038 §1)."""
    page = mobile_context.new_page()
    _open(page, "calendar/2027-03")
    _cell(page, "2027-03-21").click()
    page.wait_for_url("**/lectionary/2027-03-21")
    page.wait_for_selector(".lect-day", timeout=20_000)
    _open(page, "calendar/2026-13")   # 실패 화면 — 기억하지 않는다
    assert page.locator(".calendar .empty-state-title").count() == 1
    page.goto(f"{BASE}/bookmarks")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/2027-03")
    page.wait_for_selector(".cal-month:has-text('2027년 3월')")
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/2027-03"
    # 「오늘」로 이번 달에 가면 그것이 새 위치다
    page.locator(".lect-today").click()
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")
    page.goto(f"{BASE}/bookmarks")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar")


def test_calendar_tab_from_lectionary_start_page_goes_to_the_saved_month(mobile_context):
    """시작 화면으로 전례독서를 연 뒤 탭을 누르면 저장해 둔 달이다(앱을 새로 열어 그 세션에 달력을 본 적이 없어도)."""
    mobile_context.add_init_script("""
      localStorage.setItem('bible-start-page', 'lectionary');
      localStorage.setItem('bible-calendar-last-view', '/calendar/2027-03');
    """)
    page = mobile_context.new_page()
    page.goto(f"{BASE}/")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/2027-03")
    page.wait_for_selector(".cal-month:has-text('2027년 3월')")


def test_modifier_click_on_calendar_tab_leaves_this_page_alone(mobile_context):
    """⌘ · Ctrl-클릭은 새 탭 몫 — 지금 화면(북마크)은 마지막 캘린더 화면으로 옮겨 가지 않는다(PR #348 리뷰: 그전엔
    preventDefault 뒤 같은 탭에서 독서 화면으로 이동해 새 탭 열기를 무시했다)."""
    page = mobile_context.new_page()
    _open(page, "calendar/2026-12")
    _cell(page, "2026-12-25").click()
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

def test_month_fits_320px_without_horizontal_scroll(browser):
    """320px 폭(가장 좁은 폰) — 가로 스크롤 0, 표는 화면 안, 탭 dock 도 화면 안(캘린더 탭이 더해져도)."""
    ctx = browser.new_context(viewport={"width": 320, "height": 640}, user_agent=IPHONE_UA, is_mobile=True, has_touch=True)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        for month in ("2026-09", "2026-11", "2027-03"):
            _open(page, f"calendar/{month}")
            over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            assert over == 0, (month, over)
            right = page.evaluate("() => document.querySelector('.cal-grid').getBoundingClientRect().right")
            assert right <= 320, (month, right)
            dock = page.evaluate("() => Math.max(...[...document.querySelectorAll('#tab-bar, #tab-search')].map(e => e.getBoundingClientRect().right))")
            assert dock <= 320, (month, dock)
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


def test_desktop_header_has_calendar_entry_and_home_button(desktop_context):
    """데스크톱 — 탭 바가 없어 헤더 윗줄의 캘린더 단추가 입구, 캘린더 화면의 집 단추는 성서 목록으로."""
    page = desktop_context.new_page()
    page.goto(BASE)
    page.wait_for_selector(".book-list", timeout=20_000)
    assert not page.locator("#tab-dock").is_visible()
    btn = page.locator("#header-calendar")
    assert btn.is_visible()
    assert btn.get_attribute("aria-label") == "캘린더"
    btn.click()
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(".cal-grid")
    home = page.locator("#page-title .title-home-btn")
    assert home.is_visible()
    home.click()
    page.wait_for_url(f"{BASE}/")
    page.wait_for_selector(".book-list")


def test_desktop_header_calendar_entry_goes_where_the_tab_goes(desktop_context):
    """헤더의 캘린더 단추는 탭과 같은 곳으로 — 다른 화면에서는 마지막 캘린더 화면(독서 포함), 독서에서는 마지막 달, 달력에서는 이번 달
    (사용자 결정 2026-10-15, 2026-11-07 · PR #348 리뷰 — 그전엔 정적 href 라 늘 이번 달이었다)."""
    page = desktop_context.new_page()
    _open(page, "calendar/2026-12")
    _cell(page, "2026-12-25").click()
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.evaluate("navigate('/')")   # 다른 화면으로(링크 이동과 같은 PUSH)
    page.wait_for_selector(".book-list")
    page.locator("#header-calendar").click()
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day:has-text('성탄 낮')", timeout=20_000)
    # 독서 화면에서 누르면 마지막으로 본 달(머리의 위 단계 꺾쇠는 없다 — 사용자 결정 2026-11-03, 2026-11-07)
    page.locator("#header-calendar").click()
    page.wait_for_url(f"{BASE}/calendar/2026-12")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")
    # 집 단추로 성서 목록에 가고, 헤더 단추를 누르면 그 달로 돌아온다
    page.locator("#page-title .title-home-btn").click()
    page.wait_for_url(f"{BASE}/")
    page.wait_for_selector(".book-list")
    page.locator("#header-calendar").click()
    page.wait_for_url("**/calendar/2026-12")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")
    # 캘린더 화면에서 다시 누르면 이번 달(탭의 pop-to-root)
    page.locator("#header-calendar").click()
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")


def test_header_calendar_entry_hidden_on_mobile(mobile_context):
    """모바일 — 헤더 윗줄이 통째로 숨어 캘린더 입구는 탭 바뿐이다."""
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
    page.keyboard.press("Enter")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")
    assert _focused(page)["key"] == "today"
    _open(page, "calendar/9999-11")
    page.locator(".lect-datenav-btn[aria-label='다음 달']").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".cal-month:has-text('9999년 12월')")
    assert page.locator(".lect-datenav-btn[aria-label='다음 달']").count() == 0
    assert _focused(page)["key"] == "today"


def _month_nav(page):
    """달 이동 줄에 보이는 달 글자와 「오늘」, 다음 달 단추의 자리."""
    return page.evaluate("""() => {
      const short = document.querySelector('.cal-month-short');
      const shown = getComputedStyle(short).display === 'none' ? document.querySelector('.cal-month-full') : short;
      const m = shown.getBoundingClientRect(), t = document.querySelector('#page-title .lect-today').getBoundingClientRect();
      const prev = document.querySelector("#page-title a.lect-datenav-btn[data-focus-key='prev']").getBoundingClientRect();
      const next = document.querySelector("#page-title a.lect-datenav-btn[data-focus-key='next']").getBoundingClientRect();
      return { text: shown.textContent, mid: (m.left + m.right) / 2, right: m.right, top: m.top, bottom: m.bottom,
               todayLeft: t.left, todayRight: t.right, todayMid: (t.top + t.bottom) / 2, prev: prev.left, next: next.right,
               scrollWidth: document.documentElement.scrollWidth };
    }""")


def test_month_nav_centers_only_the_month_text_and_shortens_when_narrow(mobile_context):
    """달의 글자는 화면 가운데에 있고 「오늘」은 왼쪽 칸이다. 「오늘」의 폭이 글자를 밀지 않는다. 가장 긴 달이 들어가지 않으면 모든 달을
    YYYY.MM으로 줄이고, 스크린 리더는 전체 이름을 읽는다(사용자 결정 2026-11-05, 배치는 2026-11-07)."""
    page = mobile_context.new_page()
    _open(page, "calendar/2027-12")
    for width in (320, 360, 390, 430):
        page.set_viewport_size({"width": width, "height": 844})
        state = _month_nav(page)
        assert state["text"] == "2027년 12월", (width, state)
        assert abs(state["mid"] - width / 2) <= 1, (width, state)
        assert state["todayRight"] <= state["prev"], (width, state)
        assert state["scrollWidth"] == width, (width, state)
    page.set_viewport_size({"width": 320, "height": 844})
    page.evaluate("() => { document.documentElement.style.fontSize = '20px'; }")
    state = _month_nav(page)
    assert state["text"] == "2027.12", state
    assert abs(state["mid"] - 160) <= 1, state
    assert page.locator(".cal-month-full").inner_text() == "2027년 12월"   # 숨겼어도 읽는다
    assert page.get_attribute(".cal-month-short", "aria-hidden") == "true"
    page.evaluate("() => { document.documentElement.style.fontSize = ''; }")
    _open(page, "calendar/2027-05")   # 짧은 달도 같은 조건에서 같이 줄고, 월은 두 자리다
    page.evaluate("() => { document.documentElement.style.fontSize = '20px'; }")
    assert _month_nav(page)["text"] == "2027.05"


def test_month_nav_stays_on_one_line_with_the_largest_font_on_320px(mobile_context):
    """글자 크기 24px로 320px에서도 달과 「오늘」이 한 줄에 다 보인다. 「오늘」이 ‹ 와 겹치거나 가로로 넘치지 않는다."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 320, "height": 700})
    _open(page, "calendar/2027-12")
    page.evaluate("() => { document.documentElement.style.fontSize = '24px'; }")
    state = _month_nav(page)
    assert state["text"] == "2027.12", state
    assert state["todayRight"] <= state["prev"], state
    assert state["top"] <= state["todayMid"] <= state["bottom"], state
    assert state["scrollWidth"] == 320, state


# ── ⑨ 세 화면의 같은 상단 바(사용자 결정 2026-11-07) ──

def _bar(page):
    """상단 바 세 칸의 자리. 화면에 보이지 않는 칸은 None 이다."""
    return page.evaluate("""() => {
      const box = (s) => { const e = document.querySelector('#page-title ' + s); if (!e) return null;
                           const r = e.getBoundingClientRect(); return r.width ? { left: r.left, right: r.right } : null; };
      return { home: box('.title-home-btn'), today: box('.lect-today'), prev: box("a.lect-datenav-btn[data-focus-key='prev']"),
               next: box("a.lect-datenav-btn[data-focus-key='next']"), view: box('.title-view-btn') };
    }""")


def test_month_and_lectionary_share_the_head_row(mobile_context):
    """월간과 전례독서의 상단 바는 같은 세 칸이고 「오늘」과 ‹ ›가 같은 자리에 있다. 달력에서 날짜를 눌러도 단추가 움직이지 않는다.
    「캘린더」 글자와 표 위의 달 이동 줄은 없고, 「캘린더」는 문서 제목에 남는다."""
    page = mobile_context.new_page()
    for width in (320, 390, 430):
        page.set_viewport_size({"width": width, "height": 844})
        _open(page, "calendar/2027-12")
        month = _bar(page)
        assert "캘린더" in page.evaluate("() => document.title")
        assert "캘린더" not in page.inner_text("#page-title")
        assert page.locator(".calendar .lect-today").count() == 0
        assert page.get_attribute("#page-title .title-view-btn", "aria-label") == "목록으로 보기"
        page.goto(f"{BASE}/lectionary/2026-12-30")
        page.wait_for_selector(".lect-day", timeout=20_000)
        day = _bar(page)
        for key in ("today", "prev", "next", "view"):
            assert abs(month[key]["left"] - day[key]["left"]) <= 1, (width, key, month, day)
        assert day["today"]["right"] <= day["prev"]["left"] and day["next"]["right"] <= day["view"]["left"], (width, day)
        assert day["view"]["right"] - day["view"]["left"] >= 44, (width, day)
        assert day["home"] is None and month["home"] is None   # 모바일은 탭 바가 집 단추를 대신한다


def test_lectionary_view_button_goes_to_the_month_of_the_date_shown(mobile_context):
    """전례독서 상단 바의 오른쪽 단추는 지금 보는 날짜가 든 달로 간다. ‹ ›로 달을 넘겼으면 넘긴 날짜의 달이다. 탭 바의 캘린더 탭은 마지막으로
    본 보기로 가므로 다르다(ADR-038 §1)."""
    page = mobile_context.new_page()
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


def test_desktop_head_keeps_the_book_list_button_on_both_views(desktop_context):
    """탭 바가 없는 데스크톱은 「오늘」 앞의 집 단추가 성서 목록의 입구다. 월간과 전례독서에 모두 있고 두 칸이 겹치지 않는다."""
    page = desktop_context.new_page()
    for path in ("calendar/2026-12", "lectionary/2026-12-30"):
        page.goto(f"{BASE}/{path}")
        page.wait_for_selector("#page-title .lect-date", timeout=20_000)
        state = _bar(page)
        assert state["home"] and state["home"]["right"] <= state["today"]["left"], (path, state)
    page.locator("#page-title .title-home-btn").click()
    page.wait_for_selector(".book-list", timeout=20_000)


def test_month_steps_start_the_new_month_at_the_top(mobile_context):
    """달 이동은 스크롤해도 보이는 머리에 있다. 스크롤한 자리에서 다음 달을 누르면 새 달은 맨 위부터이고 포커스는 누른 단추에 남는다
    (전례독서의 날짜 이동과 같다)."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 390, "height": 400})
    _open(page, "calendar/2026-12")
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
        const gap = () => find().getBoundingClientRect().top - document.getElementById('sticky-group').getBoundingClientRect().bottom;
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
    """그 날짜의 줄 위쪽과 상단 바 아래쪽의 거리."""
    return page.evaluate("""d => document.querySelector(`li[data-date="${d}"]`).getBoundingClientRect().top
        - document.getElementById('sticky-group').getBoundingClientRect().bottom""", date)


def test_view_button_switches_between_month_and_list_keeping_the_month(mobile_context):
    """월간의 오른쪽 단추는 목록으로, 목록의 단추는 월간으로 간다. 보던 달을 유지하고, 아이콘은 누르면 갈 보기를 보인다."""
    page = mobile_context.new_page()
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


def test_this_month_switches_to_todays_row(mobile_context):
    """이번 달에서 목록으로 가면 주소는 /calendar/list이고 오늘 줄에 표시가 있다. 월간으로 돌아가면 /calendar다."""
    page = mobile_context.new_page()
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


def test_list_rows_are_announced_as_a_list(mobile_context):
    """글머리표를 없앤 목록은 Safari가 목록으로 알리지 않을 수 있어 role="list"를 둔다(성서 목록, 검색 목록과 같다)."""
    page = mobile_context.new_page()
    _open(page, "calendar/list/2026-12-25")
    page.wait_for_selector(".cal-rows")
    roles = page.eval_on_selector_all("ul.cal-rows", "uls => uls.map((ul) => ul.getAttribute('role'))")
    assert roles and set(roles) == {"list"}


def test_list_shows_every_day_with_the_lectionary_head_text(mobile_context):
    """평범한 평일도 줄이 있고, 줄의 글은 눌러서 간 전례독서의 제목 영역과 같다. 줄 끝에 ›를 두지 않는다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-11-12")
    assert page.locator("section[data-month='2026-11'] .cal-row").count() == 30
    plain = _row(page, "2026-11-12")
    assert plain.locator(".cal-row-title").inner_text() == "연중 32주 목요일"
    assert plain.locator(".cal-row-day").inner_text() == "12"
    assert plain.locator(".cal-row-weekday").inner_text() == "목"
    assert plain.locator(".cal-row-line").count() == 0
    assert "녹색" in plain.locator(".cal-row-meta").inner_text() and "짝수해" in plain.locator(".cal-row-meta").inner_text()
    assert "›" not in plain.inner_text()
    for date in ("2026-11-06", "2026-12-07", "2026-12-24"):
        _open_list(page, f"calendar/list/{date}")
        row = _row(page, date)
        title = row.locator(".cal-row-title").inner_text()
        lines = row.locator(".cal-row-line").all_inner_texts()
        row.click()
        page.wait_for_url(f"**/lectionary/{date}")
        page.wait_for_selector(".lect-day", timeout=20_000)
        assert page.inner_text(".lect-day") == title, date
        shown = (page.locator(".lect-day-note").all_inner_texts()
                 + page.locator(".lect-day-saint").all_inner_texts()
                 + [t.replace(chr(10), "") for t in page.locator(".lect-choice-text").all_inner_texts()])
        assert shown == lines, date


def test_row_marks_sunday_weight_year_start_and_keeps_alternate_colours_out(mobile_context):
    """주일과 주요축일은 제목이 굵고 평일은 보통이다. 전례년 첫날은 「나해 시작」이고, 대체색은 줄에 없다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-11-29")
    weight = lambda date: page.evaluate("""d => getComputedStyle(document.querySelector(`li[data-date="${d}"] .cal-row-title`)).fontWeight""", date)
    assert weight("2026-11-08") == "700"
    assert weight("2026-11-12") == "400"
    assert _row(page, "2026-11-29").locator(".cal-mark").inner_text() == "나해 시작"
    _open_list(page, "calendar/list/2026-12-13")
    assert _row(page, "2026-12-13").locator(".cal-row-dot").count() == 1


def test_lectionary_button_returns_to_the_list_at_the_date_shown(mobile_context):
    """목록에서 들어간 전례독서의 오른쪽 단추는 목록 모양이고, 지금 보는 날짜의 줄로 돌아간다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    _row(page, "2026-12-15").click()
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
    """목록의 ‹ ›는 앞뒤 달 1일의 줄로, 「오늘」은 오늘 줄로 간다. 포커스는 누른 단추에 남는다."""
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
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")
    assert _row(page, datetime.date.today().isoformat()).get_attribute("aria-current") == "date"


def test_tab_in_list_keeps_the_list_and_goes_to_today(mobile_context):
    """목록에서 캘린더 탭을 다시 누르면 목록을 유지하고 오늘 줄로 간다(사용자 결정 2026-11-07). 전례독서와 다른 탭에서는 마지막 보기인 목록으로 돌아온다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2027-03-15")
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/list/2027-03-15"
    _row(page, "2027-03-15").click()
    page.wait_for_url("**/lectionary/2027-03-15")
    page.wait_for_selector(".lect-day", timeout=20_000)
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/list/2027-03-15")
    page.wait_for_selector(".cal-rows")
    page.locator("#tab-bar [data-tab='bookmarks']").click()
    page.wait_for_url(f"{BASE}/bookmarks")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/list/2027-03-15")
    page.wait_for_selector(".cal-rows")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/list")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")
    assert page.locator(".cal-grid").count() == 0
    assert _row(page, datetime.date.today().isoformat()).is_visible()


def test_tab_in_list_does_not_add_history_entries_at_the_same_address(mobile_context):
    """이미 /calendar/list이면 캘린더 탭을 거듭 눌러도 방문 기록이 늘지 않아, 뒤로 가기가 앞 화면으로 간다. 다시 그려서 오늘 줄로 돌아온다."""
    page = mobile_context.new_page()
    _open(page, "calendar/2026-12")
    page.locator("#tab-bar [data-tab='calendar']").click()   # 월간에서 다시 누르면 이번 달
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(".cal-grid")
    page.locator("#page-title .title-view-btn").click()
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
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(".cal-grid")


def test_list_continues_below_and_the_bar_follows_the_top_row(mobile_context):
    """아래로 넘기면 줄이 이어지고, 달마다 달 이름이 하나씩 있으며, 상단 바의 달과 단추들이 맨 위 줄의 달을 따라간다(ADR-038 §2)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    prev_btn = page.locator("#page-title a[data-focus-key='prev']")
    prev_btn.focus()
    _scroll_down_until(page, "2027-01-15")
    page.wait_for_selector(".cal-month-full:has-text('2027년 1월')")
    assert page.locator("section[data-month='2027-01'] .cal-list-month").count() == 1
    _assert_consecutive(_dates(page))
    assert prev_btn.get_attribute("href") == "/calendar/list/2026-12-01"
    assert page.locator("#page-title a[data-focus-key='next']").get_attribute("href") == "/calendar/list/2027-02-01"
    assert page.locator(".cal-month-short").text_content() == "2027.01"
    # 다시 그리지 않고 고치므로 단추와 포커스가 그대로다
    assert page.evaluate("() => document.activeElement.dataset.focusKey") == "prev"
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_url(f"{BASE}/calendar/2027-01")
    page.wait_for_selector(".cal-grid")


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
    page.wait_for_selector(".cal-month-full:has-text('2027년 2월')")


@both_anchorings
def test_desktop_list_puts_the_row_under_the_collapsed_bar(desktop_context, anchoring):
    """월간에서 목록으로 가면 상단 바가 접히는데, 접힌 뒤에도 줄이 상단 바 바로 아래에 있다."""
    page = _list_page(desktop_context, anchoring)
    _open(page, "calendar/2026-12")
    page.wait_for_timeout(1000)   # 상단 바가 스크롤을 감지하기 시작하기를 기다린다
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_selector(".cal-rows")
    page.wait_for_function("() => document.getElementById('app-header').classList.contains('compact')")
    page.wait_for_timeout(500)
    assert abs(_month_top_under_head(page, "2026-12")) <= 2


def test_desktop_list_leaves_the_scroll_alone_once_the_reader_scrolls(desktop_context):
    """상단 바가 접히는 동안 독자가 스크롤을 시작하면 줄을 다시 맞추지 않는다."""
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


def test_list_month_end_row_reaches_under_the_bar(mobile_context):
    """달의 끝날도 상단 바 바로 아래에 온다. 다음 달이 이어지기 때문이다. 웹 글꼴을 늦게 받아 위쪽 줄의 줄바꿈이 바뀌어도 그 자리에 있다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-31")
    page.wait_for_function("() => document.fonts.status === 'loaded'", timeout=15_000)
    page.wait_for_timeout(1000)
    assert abs(_row_top_under_head(page, "2026-12-31")) <= 2
    assert page.inner_text(".cal-month") == "2026년 12월"


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


def test_list_saves_the_address_after_stopping_without_reporting_a_page_view(mobile_context):
    """`gtag`는 `history`의 `replaceState`를 덮어써 방문 통계를 보낸다. 목록은 원본을 호출해 통계를 늘리지 않고, 스크롤 중에는 적지 않는다(ADR-038 §2)."""
    mobile_context.add_init_script("""
        window.__reported = 0;
        window.__saved = 0;
        const original = History.prototype.replaceState;
        History.prototype.replaceState = function (...args) { window.__saved++; return original.apply(this, args); };
        history.replaceState = function (...args) { window.__reported++; return original.apply(this, args); };
    """)
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.evaluate("""async () => {
        for (let i = 0; i < 60; i++) {
            window.scrollBy({ top: 40, behavior: 'instant' });
            await new Promise(requestAnimationFrame);
        }
    }""")
    page.wait_for_function("() => location.pathname !== '/calendar/list/2026-12-15'")
    assert page.evaluate("() => window.__reported") == 0
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
def test_desktop_list_from_the_month_keeps_the_address_after_the_header_collapses(desktop_context, anchoring):
    """월간에서 목록으로 가면 앱이 이미 스크롤 감지를 시작한 뒤라 상단 바가 곧바로 접힌다. 접히는 동안 맨 위 줄이 달라 보여도 주소는 그대로다."""
    page = _list_page(desktop_context, anchoring)
    _open(page, "calendar/2026-12")
    page.wait_for_timeout(1000)   # 앱이 스크롤 감지를 시작하기를 기다린다
    page.locator("#page-title .title-view-btn").click()
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-01")
    page.wait_for_selector("#app-header.compact")
    page.wait_for_timeout(1400)
    assert page.url == f"{BASE}/calendar/list/2026-12-01"


def test_todays_date_uses_the_address_without_a_date(mobile_context):
    """오늘 날짜의 줄을 날짜 있는 주소로 열어도, 전례독서의 오른쪽 단추로 돌아와도 주소에는 날짜가 없어 다음 날 그날의 오늘 줄이 열린다(사용자 결정 2026-11-07)."""
    today = datetime.date.today().isoformat()
    page = mobile_context.new_page()
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
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
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
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
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
    assert page.inner_text(".cal-month") == "2027년 1월"


def test_row_click_before_scrolling_stops_saves_the_top_row(mobile_context):
    """스크롤이 멈추기 전에 줄을 눌러도 맨 위 줄을 남겨, 뒤로 가기가 그 줄로 돌아온다."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.evaluate("""() => {
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
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
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        window.scrollBy({ top: document.querySelector('li[data-date="2026-12-30"]').getBoundingClientRect().top - bar, behavior: 'instant' });
        (0, eval)(event);
        return location.pathname;
    }""", event)
    assert path == "/calendar/list/2026-12-30"
    assert page.evaluate("() => localStorage.getItem('bible-calendar-last-view')") == "/calendar/list/2026-12-30"


def test_tab_and_reopening_return_to_the_top_row(mobile_context):
    """다른 탭에 다녀와도, 앱을 다시 열어도 탭이 맨 위 줄로 돌아온다(ADR-038 §1)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    _scroll_down_until(page, "2027-01-15")
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    page.locator("#tab-bar [data-tab='bookmarks']").click()
    page.wait_for_url(f"{BASE}/bookmarks")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(100)
    assert abs(_row_top_under_head(page, "2027-01-15")) <= 2
    page.goto(f"{BASE}/bookmarks")
    page.locator("#tab-bar [data-tab='calendar']").click()
    page.wait_for_url(f"{BASE}/calendar/list/2027-01-15")
    page.wait_for_selector(".cal-rows")
    page.wait_for_timeout(100)
    assert abs(_row_top_under_head(page, "2027-01-15")) <= 2


def test_tab_does_not_reuse_the_scroll_value_of_the_list(mobile_context):
    """위쪽 줄이 늘어나면 같은 줄의 스크롤 값이 커진다. 그 값을 새로 그린 목록에 쓰면 엉뚱한 줄이 나오므로, 목록은 스크롤 값을 저장하지 않는다(ADR-038 §1)."""
    page = mobile_context.new_page()
    _open_list(page, "calendar/list/2026-12-15")
    page.evaluate("""async () => {
        for (let i = 0; i < 40; i++) {
            window.scrollTo({ top: 0, behavior: 'instant' });
            await new Promise(requestAnimationFrame);
        }
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
        window.scrollBy({ top: document.querySelector('li[data-date="2026-12-15"]').getBoundingClientRect().top - bar, behavior: 'instant' });
    }""")
    page.wait_for_url(f"{BASE}/calendar/list/2026-12-15")
    page.wait_for_timeout(300)
    assert page.url == f"{BASE}/calendar/list/2026-12-15"
    assert len(_dates(page)) > 43   # 위쪽 줄이 늘었다
    page.locator("#tab-bar [data-tab='bookmarks']").click()
    page.wait_for_url(f"{BASE}/bookmarks")
    page.locator("#tab-bar [data-tab='calendar']").click()
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
        const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
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
    page.locator("#tab-bar [data-tab='calendar']").click()
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
    (339, None, "/calendar/list"),
    (340, None, "/calendar"),
    (320, "/calendar/2027-03", "/calendar/2027-03"),
])
def test_calendar_tab_without_a_saved_view_goes_to_the_list_on_narrow_screens(browser, width, saved, destination):
    """폭 340px 미만에서 저장한 보기가 없으면 탭이 목록으로 간다. 저장한 보기가 있으면 그 보기다(ADR-038 §2)."""
    ctx = browser.new_context(viewport={"width": width, "height": 640}, user_agent=IPHONE_UA, is_mobile=True, has_touch=True)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    if saved:
        ctx.add_init_script(f"localStorage.setItem('bible-calendar-last-view', '{saved}');")
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/bookmarks")
        page.locator("#tab-bar [data-tab='calendar']").click()
        page.wait_for_url(f"{BASE}{destination}")
        page.wait_for_selector(".cal-rows" if destination == "/calendar/list" else ".cal-grid", timeout=20_000)
    finally:
        ctx.close()


def test_calendar_address_is_the_month_on_narrow_screens_too(browser):
    """주소 /calendar는 폭과 무관하게 월간이다. 공유한 주소가 기기마다 다른 화면이 되지 않게 한다(ADR-038 §2)."""
    ctx = browser.new_context(viewport={"width": 320, "height": 640}, user_agent=IPHONE_UA, is_mobile=True, has_touch=True)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        _open(page, "calendar")
        assert page.url == f"{BASE}/calendar"
        assert page.locator(".cal-rows").count() == 0
    finally:
        ctx.close()


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
    page.wait_for_selector(".cal-month-full:has-text('1583년 2월')")
    assert prev_btn.count() == 1
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
    page.wait_for_selector(".cal-month-full:has-text('1583년 1월')")
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
    for key, expected in (("view", "view"), ("prev", "today")):
        _open_list(page, "calendar/list/1583-02-15")
        page.locator(f"#page-title a[data-focus-key='{key}']").focus()
        page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
        page.wait_for_selector(".cal-month-full:has-text('1583년 1월')")
        assert page.locator("#page-title a[data-focus-key='prev']").count() == 0
        assert page.evaluate(focused) == expected


def test_desktop_list_keeps_focus_on_the_home_button_when_the_bar_redraws(desktop_context):
    """데스크톱의 집 단추도 상단 바를 다시 그린 뒤 포커스를 잃지 않는다(WCAG 2.4.3)."""
    page = desktop_context.new_page()
    _open_list(page, "calendar/list/1583-02-15")
    page.locator("#page-title .title-home-btn").focus()
    page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
    page.wait_for_selector(".cal-month-full:has-text('1583년 1월')")
    assert page.locator("#page-title a[data-focus-key='prev']").count() == 0
    assert page.evaluate("() => document.activeElement.classList.contains('title-home-btn')")


def test_only_the_list_loads_the_lectionary_tables(mobile_context):
    """줄의 글을 정하려고 목록은 독서 묶음을 받는다. 월간은 받지 않는다(ADR-038 §2)."""
    page = mobile_context.new_page()
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
