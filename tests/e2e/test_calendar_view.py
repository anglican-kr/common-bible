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
        assert page.locator("#page-title .title-view-btn").count() == 0   # 월간의 오른쪽 칸은 목록 보기를 만들 때 채운다
        page.goto(f"{BASE}/lectionary/2026-12-30")
        page.wait_for_selector(".lect-day", timeout=20_000)
        day = _bar(page)
        for key in ("today", "prev", "next"):
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
