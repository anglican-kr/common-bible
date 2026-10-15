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

실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「E2E 테스트」).
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
    page.locator(".cal-head .lect-today").click()
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

def test_cell_opens_lectionary_and_up_link_returns_to_its_month(mobile_context):
    """12월 25일 칸 → /lectionary/2026-12-25(성탄 낮) → 머리의 꺾쇠(위 단계)가 2026년 12월로 — 모바일에서도 보인다."""
    page = mobile_context.new_page()
    _open(page, "calendar/2026-12")
    _cell(page, "2026-12-25").click()
    page.wait_for_url("**/lectionary/2026-12-25")
    page.wait_for_selector(".lect-day", timeout=20_000)
    assert page.inner_text(".lect-day") == "성탄 낮"
    up = page.locator("#page-title a.title-back-btn")
    assert up.is_visible()
    assert up.get_attribute("aria-label") == "2026년 12월 캘린더로"
    assert page.locator("#page-title .title-home-btn").count() == 0   # 성서 목록 집 단추는 더 이상 없다
    # 캘린더 탭 소속 — 독서 화면에서도 캘린더 탭이 활성
    assert page.get_attribute("#tab-bar [data-tab='calendar']", "aria-current") == "page"
    up.click()
    page.wait_for_url("**/calendar/2026-12")
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

def test_calendar_tab_restores_last_screen_and_retap_pops_to_this_month(mobile_context):
    """캘린더 → 12.25 독서 → 북마크 탭 → 캘린더 탭이면 그 독서 화면으로 돌아오고, 캘린더 탭을 다시 누르면 이번 달."""
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
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")


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
    """/calendar/2026-13 · 계산 범위 밖 1500-01 — 「잘못된 날짜입니다」 + 이번 달 링크."""
    page = desktop_context.new_page()
    for bad in ("calendar/2026-13", "calendar/1500-01", "calendar/abc"):
        _open(page, bad)
        assert "잘못된 날짜입니다" in page.inner_text(".calendar")
    page.locator(".cal-error-link a").click()
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(".cal-grid")


def test_preload_failure_shows_calendar_error(browser):
    """교회력 자료(정의 표)를 받지 못하면 이 뷰의 실패 화면 — 앞 화면이 남지 않는다."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        ctx.route("**/data/lectionary/sanctoral.json", lambda route: route.abort())
        page = ctx.new_page()
        _open(page, "calendar/2026-10")
        assert "교회력 자료를 불러오지 못했습니다" in page.inner_text(".calendar")
        assert page.locator(".cal-grid").count() == 0
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
    """헤더의 캘린더 단추는 탭과 같은 곳으로 — 다른 화면에서는 마지막 캘린더 화면(독서 포함), 캘린더 화면에서는 이번 달
    (사용자 결정 2026-10-15 · PR #348 리뷰 — 그전엔 정적 href 라 늘 이번 달이었다)."""
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
    # 위 단계 → 그 달 → 집 단추로 성서 목록 → 헤더 단추면 그 달로
    page.locator("#page-title a.title-back-btn").click()
    page.wait_for_url("**/calendar/2026-12")
    page.wait_for_selector(".cal-month:has-text('2026년 12월')")
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
        return { key: a?.dataset?.focusKey || null, inHead: !!a?.closest('.cal-head'), visible: !!a?.matches(':focus-visible') };
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
    page.locator(".cal-head .lect-today").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(f".cal-month:has-text('{_this_month()[1]}')")
    assert _focused(page)["key"] == "today"
    _open(page, "calendar/9999-11")
    page.locator(".lect-datenav-btn[aria-label='다음 달']").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".cal-month:has-text('9999년 12월')")
    assert page.locator(".lect-datenav-btn[aria-label='다음 달']").count() == 0
    assert _focused(page)["key"] == "today"
