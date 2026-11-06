"""E2E: 설정 팝오버 — 섹션, 시작 페이지, 시작 화면, 책 순서, 글자 크기, 테마, 색상, 캐시, 영속성."""
from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT, IPHONE_UA, RECORD_ANNOUNCEMENTS, open_settings

BASE = "http://localhost:8080"


def _open(page):
    page.goto(BASE)
    page.wait_for_selector("#search-input")


def _ls(page, key):
    return page.evaluate(f"() => localStorage.getItem({repr(key)})")


def _html_attr(page, attr):
    return page.evaluate(f"() => document.documentElement.getAttribute({repr(attr)})")


# ── 섹션 (ADR-041 §1) ────────────────────────────────────────────────────────

SECTIONS = ["시작", "성서", "전례독서", "모양", "시스템"]
SECTION_FACTS = """(root) => [...document.querySelector(root).querySelectorAll('.settings-section')].map((s) => ({
  tag: s.firstElementChild.tagName,
  title: s.firstElementChild.textContent,
  rule: getComputedStyle(s).borderTopWidth,
}))"""


def _assert_sections(facts):
    assert [f["title"] for f in facts] == SECTIONS
    assert all(f["tag"] == "H2" for f in facts)
    assert facts[0]["rule"] == "0px"          # 첫 섹션 위에는 선이 없고, 그 뒤 섹션마다 가로선이 있다
    assert all(f["rule"] == "1px" for f in facts[1:])


def test_popover_has_labeled_sections_in_order(browser):
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        _assert_sections(page.evaluate(SECTION_FACTS, ".settings-popover"))
        # 항목이 제 섹션에 있다
        bible = pop.locator(".settings-section", has=page.locator("h2", has_text="성서"))
        assert bible.get_by_role("switch").count() == 4
        lectionary = pop.locator(".settings-section", has=page.locator("h2", has_text="전례독서"))
        assert lectionary.get_by_role("switch", name="대체 독서 표시").is_checked() is False
        appearance = pop.locator(".settings-section", has=page.locator("h2", has_text="모양"))
        assert appearance.get_by_role("button", name="글자 크게").count() == 1
        system = pop.locator(".settings-section", has=page.locator("h2", has_text="시스템"))
        assert system.get_by_role("button", name="업데이트 지금 확인").count() == 1
    finally:
        ctx.close()


def test_mobile_settings_view_has_the_same_sections(browser):
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/settings")
        page.wait_for_selector(".settings-view .settings-select")
        _assert_sections(page.evaluate(SECTION_FACTS, ".settings-view"))
    finally:
        ctx.close()


# ── 시작 페이지 (ADR-041 §2, §3) ──────────────────────────────────────────────

def test_start_page_select_saves_and_hides_resume_row_keeping_its_value(browser):
    """전례독서를 고르면 값이 저장되고 「읽던 페이지에서 시작」이 숨는다. 포커스는 선택 상자에 남고, 성서로 되돌리면 전의 값으로 돌아온다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        select = pop.get_by_label("시작 페이지")
        assert select.input_value() == "bible"
        resume = pop.get_by_role("switch", name="읽던 페이지에서 시작")
        resume.click()   # home — 숨기는 동안 값을 지키는지 본다
        select.focus()   # 사용자는 선택 상자를 눌러 고른다. select_option은 포커스를 옮기지 않는다
        select.select_option("lectionary")
        assert _ls(page, "bible-start-page") == "lectionary"
        assert resume.is_visible() is False
        assert page.evaluate("() => document.activeElement.tagName") == "SELECT"
        select.select_option("bible")
        assert _ls(page, "bible-start-page") == "bible"
        assert resume.is_visible() is True
        assert resume.is_checked() is False
        assert _ls(page, "bible-startup") == "home"
    finally:
        ctx.close()


def test_resume_row_stays_hidden_when_reopened_with_lectionary_start(browser):
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script("localStorage.setItem('bible-start-page', 'lectionary')")
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/john/3")
        page.wait_for_selector("#settings-anchor .settings-btn")
        pop = open_settings(page)
        assert pop.get_by_label("시작 페이지").input_value() == "lectionary"
        assert pop.get_by_role("switch", name="읽던 페이지에서 시작").is_visible() is False
    finally:
        ctx.close()


def test_lectionary_start_page_opens_lectionary_only_on_launch(browser):
    """「/」로 열면 읽던 위치가 있어도 오늘의 전례독서다. 뒤로 가기로 온 「/」는 성서 목록이고, 다른 주소로 열면 그 주소다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script("""
      localStorage.setItem('bible-start-page', 'lectionary');
      localStorage.setItem('bible-last-read', JSON.stringify({ bookId: 'john', chapter: 3, verse: null }));
    """)
    page = ctx.new_page()
    try:
        page.goto(BASE)
        page.wait_for_selector(".lectionary", timeout=20_000)
        assert page.evaluate("() => location.pathname") == "/lectionary"
        page.go_back()
        page.wait_for_selector(".book-list")
        assert page.evaluate("() => location.pathname") == "/"
        page.goto(f"{BASE}/john/3")
        page.wait_for_selector(".chapter-text")
        assert page.evaluate("() => location.pathname") == "/john/3"
    finally:
        ctx.close()


def test_reload_stays_on_book_list_with_lectionary_start(browser):
    """새로고침은 앱을 새로 여는 것이 아니다 — 성서 목록에 머문다(ADR-041 §2)."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script("localStorage.setItem('bible-start-page', 'lectionary')")
    page = ctx.new_page()
    try:
        page.goto(BASE)
        page.wait_for_selector(".lectionary", timeout=20_000)
        page.go_back()
        page.wait_for_selector(".book-list")
        page.reload()
        page.wait_for_selector(".book-list")
        page.wait_for_timeout(300)
        assert page.evaluate("() => location.pathname") == "/"
        assert page.locator(".lectionary").count() == 0
    finally:
        ctx.close()


def test_reload_stays_on_book_list_with_resume(browser):
    """「읽던 페이지에서 시작」의 이동도 같다. 장을 새로고침할 때의 절 복원은 이동이 아니라 그대로다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script("localStorage.setItem('bible-last-read', JSON.stringify({ bookId: 'john', chapter: 3, verse: 20 }))")
    page = ctx.new_page()
    try:
        page.goto(BASE)
        page.wait_for_selector(".chapter-text")
        assert page.evaluate("() => location.pathname") == "/john/3"
        page.go_back()
        page.wait_for_selector(".book-list")
        page.reload()
        page.wait_for_selector(".book-list")
        page.wait_for_timeout(300)
        assert page.evaluate("() => location.pathname") == "/"
        page.goto(f"{BASE}/john/3")
        page.wait_for_selector(".chapter-text")
        page.wait_for_function("() => window.scrollY > 0")
        page.reload()
        page.wait_for_selector(".chapter-text")
        page.wait_for_function("() => window.scrollY > 0")
        assert page.evaluate("() => location.pathname") == "/john/3"
    finally:
        ctx.close()


def test_start_page_shows_failure_screen_when_lectionary_cannot_load(browser):
    """자료나 화면 모듈을 받지 못하면 전례독서 주소를 직접 열었을 때와 같은 실패 화면이다. 성서 목록으로 옮기지 않고, 홈 탭으로 갈 수 있다(ADR-041 §2)."""
    for blocked in ("**/data/lectionary/**", "**/js/app/lectionary.js*"):
        ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
        ctx.add_init_script(CLEAR_APP_STORAGE)
        ctx.add_init_script("localStorage.setItem('bible-start-page', 'lectionary')")
        ctx.route(blocked, lambda route: route.abort())
        page = ctx.new_page()
        try:
            page.goto(BASE)
            page.wait_for_selector(".state-action button", timeout=20_000)
            assert page.inner_text(".state-action button") == "다시 불러오기", blocked
            assert page.evaluate("() => location.pathname") == "/lectionary", blocked
            assert page.locator(".book-list").count() == 0, blocked
            page.locator("#tab-bar [data-tab='home']").click()
            page.wait_for_selector(".book-list")
            assert page.evaluate("() => location.pathname") == "/", blocked
        finally:
            ctx.close()


def test_popover_shows_a_thin_scrollbar_on_a_short_window(browser):
    """창 높이 768px에서 팝오버가 스크롤되고 스크롤 막대가 보이며, 맨 아래 줄까지 갈 수 있다(ADR-041 §1)."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 768})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        facts = page.evaluate("""() => {
          const p = document.querySelector('.settings-popover');
          return { over: p.scrollHeight - p.clientHeight, bar: getComputedStyle(p).scrollbarWidth };
        }""")
        assert facts["over"] > 0, facts
        assert facts["bar"] == "thin", facts
        about = pop.locator(".settings-about")
        about.scroll_into_view_if_needed()
        assert about.is_visible()
    finally:
        ctx.close()


def test_home_tab_shows_book_list_after_lectionary_start(browser):
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script("localStorage.setItem('bible-start-page', 'lectionary')")
    page = ctx.new_page()
    try:
        page.goto(BASE)
        page.wait_for_selector(".lectionary", timeout=20_000)
        page.locator("#tab-bar [data-tab='home']").click()
        page.wait_for_selector(".book-list")
        assert page.evaluate("() => location.pathname") == "/"
    finally:
        ctx.close()


def test_default_start_page_keeps_book_list(browser):
    """기본값은 전과 같다 — 읽던 위치가 없으면 「/」는 성서 목록이다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        page.goto(BASE)
        page.wait_for_selector(".book-list")
        assert page.evaluate("() => location.pathname") == "/"
    finally:
        ctx.close()


def test_keyboard_opens_on_select_and_focus_stays_trapped(browser):
    """키보드로 열면 첫 컨트롤인 선택 상자에 포커스가 가고, 포커스 가두기가 선택 상자를 센다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        page.locator("#settings-anchor .settings-btn").focus()
        page.keyboard.press("Enter")
        page.wait_for_selector(".settings-popover:not([hidden])")
        assert page.evaluate("() => document.activeElement.tagName") == "SELECT"
        page.keyboard.press("Shift+Tab")   # 첫 컨트롤에서 뒤로 — 팝오버의 마지막 링크로 돈다
        assert page.evaluate("() => !!document.activeElement.closest('.settings-popover')")
        assert page.evaluate("() => document.activeElement.tagName") == "A"
        page.keyboard.press("Tab")         # 마지막에서 앞으로 — 선택 상자로 돌아온다
        assert page.evaluate("() => document.activeElement.tagName") == "SELECT"
    finally:
        ctx.close()


LIST_IS_OPEN = "() => document.querySelector('.settings-popover .settings-select').matches(':open')"
# Chromium은 목록을 연 채 누른 Esc를 페이지로 보내지 않는다. 보내는 브라우저에서 일어날 일을 키 입력 사건을 직접 내어 본다.
ESC_REACHES_PAGE = """() => document.querySelector('.settings-popover .settings-select')
  .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"""


def test_escape_on_open_select_list_keeps_popover(browser):
    """목록을 연 채 Esc가 페이지까지 와도 팝오버를 닫지 않는다. 목록이 닫혀 있으면 포커스가 선택 상자에 있어도 닫는다(ADR-041 §9)."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        pop.get_by_label("시작 페이지").click()
        page.wait_for_function(LIST_IS_OPEN)
        page.evaluate(ESC_REACHES_PAGE)
        assert pop.is_visible()
        page.keyboard.press("Escape")      # 목록이 받아 목록만 닫는다
        page.wait_for_function(f"() => !({LIST_IS_OPEN})()")
        assert pop.is_visible()
        page.evaluate(ESC_REACHES_PAGE)    # 이제 닫힌 선택 상자다
        pop.wait_for(state="hidden")
    finally:
        ctx.close()


# ── 토글 결과 알림 ─────────────────────────────────────────────────────────────

def test_toggle_result_is_announced_after_the_view_redraws(browser):
    """토글이 화면을 다시 그리면 화면 제목을 알린 뒤에 결과를 알린다. 스크린 리더가 듣는 마지막 말이 토글 결과다."""
    for path, ready, switch, said in (
        ("", ".book-list", "외경", "구약에 외경 포함"),
        ("/deuterocanon", ".book-list", "외경", "구약에 외경 포함"),   # 외경 탭이 없어져 구약으로 옮긴 뒤에 알린다
        ("/lectionary/2026-06-29", ".lectionary", "대체 독서 표시", "대체 독서 표시"),
    ):
        ctx = browser.new_context()
        ctx.add_init_script(CLEAR_APP_STORAGE)
        page = ctx.new_page()
        try:
            page.goto(f"{BASE}{path}")
            page.wait_for_selector(ready, timeout=20_000)
            pop = open_settings(page)
            page.evaluate(RECORD_ANNOUNCEMENTS)
            pop.get_by_role("switch", name=switch).click()
            page.wait_for_function("(said) => window.__said.at(-1) === said", arg=said)
            page.wait_for_timeout(300)   # 다시 그리는 일이 다 끝난 뒤에도 그 말이 남아 있다
            assert page.evaluate("() => window.__said.at(-1)") == said, path
            assert page.inner_text("#a11y-announce") == said, path
        finally:
            ctx.close()


def test_toggle_result_keeps_the_title_of_a_view_opened_meanwhile(browser):
    """자료를 받는 동안 토글을 누르고 다른 화면으로 옮기면, 다시 그리기가 끝나도 새 화면의 제목 알림이 남는다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    held = []
    try:
        _open(page)
        page.route("**/data/lectionary/**", lambda route: held.append(route))   # 전례독서 자료를 받지 못한 채 머문다
        page.evaluate("() => window.navigate('/lectionary/2026-06-29')")
        page.wait_for_selector(".loading")
        for _ in range(100):             # 자료 요청이 나갈 때까지 기다린다
            if held:
                break
            page.wait_for_timeout(50)
        assert held
        pop = open_settings(page)
        page.evaluate(RECORD_ANNOUNCEMENTS)
        pop.get_by_role("switch", name="대체 독서 표시").click()
        page.evaluate("() => window.navigate('/john/3')")
        page.wait_for_selector(".chapter-text")
        page.wait_for_function("() => window.__said.length > 0")
        title = page.evaluate("() => window.__said.at(-1)")
        assert "3" in title, title
        for route in held:
            route.continue_()
        page.wait_for_timeout(500)       # 옛 다시 그리기가 끝난 뒤에도 새 화면의 제목이 남아 있다
        assert page.evaluate("() => window.__said.at(-1)") == title
    finally:
        ctx.close()


# ── 시작 화면 ─────────────────────────────────────────────────────────────────

def test_startup_home(browser):
    """토글 OFF → bible-startup = 'home', 스위치 미체크."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        sw = pop.get_by_role("switch", name="읽던 페이지에서 시작")
        # 기본값은 resume(ON); 끄면 home.
        assert sw.is_checked() is True
        sw.click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-startup") == "home"
        assert sw.is_checked() is False
    finally:
        ctx.close()


def test_startup_resume(browser):
    """토글 OFF 후 다시 ON → bible-startup = 'resume'."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        sw = pop.get_by_role("switch", name="읽던 페이지에서 시작")
        sw.click()  # → home
        sw.click()  # → resume
        page.wait_for_timeout(100)
        assert _ls(page, "bible-startup") == "resume"
        assert sw.is_checked() is True
    finally:
        ctx.close()


# ── 책 순서 ──────────────────────────────────────────────────────────────────

def test_book_order_vulgate(browser):
    """외경 토글 ON → bible-book-order = 'vulgate', 캡션 '구약에 포함'."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        sw = pop.get_by_role("switch", name="외경")
        # 기본값은 canonical(OFF); 켜면 vulgate.
        assert sw.is_checked() is False
        sw.click()
        # 책 순서 변경은 목록 뷰를 다시 그린다(route()) → 설정 팝오버가 닫힌다.
        # 따라서 토글 직후 같은 스위치를 다시 보지 말고, 영속값을 확인한 뒤
        # 설정을 다시 열어 반영 상태(체크 + 캡션)를 검증한다.
        page.wait_for_function(
            "() => localStorage.getItem('bible-book-order') === 'vulgate'"
        )
        pop = open_settings(page)
        sw = pop.get_by_role("switch", name="외경")
        assert sw.is_checked() is True
        assert pop.locator(".settings-toggle-caption").first.inner_text() == "구약에 포함"
    finally:
        ctx.close()


def test_book_order_canonical(browser):
    """외경 토글 ON 후 OFF → bible-book-order = 'canonical', 캡션 '별도 섹션에 표시'."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        pop.get_by_role("switch", name="외경").click()  # → vulgate (route() 로 팝오버 닫힘)
        page.wait_for_function(
            "() => localStorage.getItem('bible-book-order') === 'vulgate'"
        )
        pop = open_settings(page)
        pop.get_by_role("switch", name="외경").click()  # → canonical (다시 팝오버 닫힘)
        page.wait_for_function(
            "() => localStorage.getItem('bible-book-order') === 'canonical'"
        )
        pop = open_settings(page)
        sw = pop.get_by_role("switch", name="외경")
        assert sw.is_checked() is False
        assert pop.locator(".settings-toggle-caption").first.inner_text() == "별도 섹션에 표시"
    finally:
        ctx.close()


# ── 글자 크기 ─────────────────────────────────────────────────────────────────

def test_font_size_increase(browser):
    """A+ 클릭 → fontSize 20px (기본 18px → +1단계)."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        open_settings(page).get_by_role("button", name="글자 크게").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-font-size") == "20"
        fs = page.evaluate("() => document.documentElement.style.fontSize")
        assert fs == "20px"
    finally:
        ctx.close()


def test_font_size_decrease(browser):
    """A- 클릭 → fontSize 16px (기본 18px → -1단계)."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        open_settings(page).get_by_role("button", name="글자 작게").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-font-size") == "16"
    finally:
        ctx.close()


def test_font_size_reset(browser):
    """A+ 후 A 클릭 → 기본값(18px) 복원, 초기화 버튼 비활성화."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        pop.get_by_role("button", name="글자 크게").click()
        pop.get_by_role("button", name="글자 크기 초기화").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-font-size") == "18"
        assert pop.get_by_role("button", name="글자 크기 초기화").is_disabled()
    finally:
        ctx.close()


# ── 테마 ─────────────────────────────────────────────────────────────────────

def test_theme_dark(browser):
    """'다크' 클릭 → html[data-theme='dark'], bible-theme='dark'."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        open_settings(page).get_by_role("button", name="다크").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-theme") == "dark"
        assert _html_attr(page, "data-theme") == "dark"
    finally:
        ctx.close()


def test_theme_light(browser):
    """'라이트' 클릭 → html[data-theme='light'], bible-theme='light'."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        open_settings(page).get_by_role("button", name="라이트").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-theme") == "light"
        assert _html_attr(page, "data-theme") == "light"
    finally:
        ctx.close()


# ── 색상 스킴 ─────────────────────────────────────────────────────────────────

def test_color_scheme_green(browser):
    """'초록' swatch 클릭 → bible-color-scheme='green', html[data-color-scheme='green']."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        open_settings(page).get_by_role("button", name="초록").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-color-scheme") == "green"
        assert _html_attr(page, "data-color-scheme") == "green"
    finally:
        ctx.close()


def test_color_scheme_navy_removes_attribute(browser):
    """'네이비' 선택 시 data-color-scheme 속성 자체가 제거된다 (기본값)."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        pop.get_by_role("button", name="초록").click()
        pop.get_by_role("button", name="네이비").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-color-scheme") == "navy"
        assert _html_attr(page, "data-color-scheme") is None
    finally:
        ctx.close()


# ── 캐시 초기화 ───────────────────────────────────────────────────────────────

def test_cache_clear_removes_caches(browser):
    """캐시 비우기 버튼 클릭 → clearAllCaches()가 실행되어 심어둔 캐시를 삭제한다.

    service_workers="block"으로 SW 간섭을 차단해 캐시 상태를 안정적으로 검증한다.
    (블록하지 않으면 clearAllCaches 내부의 reg.unregister()가 headless chromium
    에서 resolve 되지 않아 location.reload()까지 못 가고 테스트가 멈춘다.)
    """
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script("window.confirm = () => true;")  # bypass clearAllCaches confirm
    page = ctx.new_page()
    try:
        _open(page)
        page.evaluate("""async () => {
            const c = await caches.open('e2e-test');
            await c.put('/e2e-marker', new Response('ok'));
        }""")
        has_before = page.evaluate("async () => await caches.has('e2e-test')")
        assert has_before, "e2e-test cache should exist before clear"

        # clearAllCaches: confirm → delete all → location.reload().
        # expect_navigation() is racy for in-page reloads; instead drop a window
        # sentinel and wait for the reload to wipe it (fresh document), then for
        # the shell to re-render. wait_for_function survives the navigation.
        page.evaluate("() => { window.__preReload = true; }")
        open_settings(page).get_by_role("button", name="캐시 비우기").click()
        page.wait_for_function("() => window.__preReload === undefined")
        page.wait_for_selector("#search-input", state="attached")

        has_after = page.evaluate("async () => await caches.has('e2e-test')")
        assert not has_after, "e2e-test cache should be deleted after reload"
    finally:
        ctx.close()


# ── 영속성 ───────────────────────────────────────────────────────────────────

def test_settings_persist_after_reload(browser):
    """다크 테마 + 글자 크기 증가 저장 후 reload → 동일 설정이 적용된다.

    add_init_script는 reload 시에도 재실행되므로, 최초 로드 후 evaluate()로
    스토리지를 수동 초기화해 reload 시 클리어되지 않도록 한다.
    """
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        _open(page)
        # Init_script 없이 수동 초기화 → reload 시 재실행 안 됨
        page.evaluate(CLEAR_APP_STORAGE)

        pop = open_settings(page)
        pop.get_by_role("button", name="다크").click()
        pop.get_by_role("button", name="글자 크게").click()
        page.wait_for_timeout(100)

        page.reload()
        page.wait_for_selector("#search-input")

        assert _html_attr(page, "data-theme") == "dark", \
            "Dark theme should persist after reload"
        assert page.evaluate("() => document.documentElement.style.fontSize") == "20px", \
            "Font size should persist after reload"
    finally:
        ctx.close()
