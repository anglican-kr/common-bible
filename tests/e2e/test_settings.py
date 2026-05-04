"""E2E: 설정 팝오버 — 시작 화면, 책 순서, 글자 크기, 테마, 색상, 캐시, 영속성."""
from .conftest import CLEAR_APP_STORAGE, open_settings

BASE = "http://localhost:8080"


def _open(page):
    page.goto(BASE)
    page.wait_for_selector("#search-input")


def _ls(page, key):
    return page.evaluate(f"() => localStorage.getItem({repr(key)})")


def _html_attr(page, attr):
    return page.evaluate(f"() => document.documentElement.getAttribute({repr(attr)})")


# ── 시작 화면 ─────────────────────────────────────────────────────────────────

def test_startup_home(browser):
    """'첫 페이지' 클릭 → bible-startup = 'home', aria-pressed 업데이트."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        pop.get_by_role("button", name="첫 페이지").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-startup") == "home"
        assert pop.get_by_role("button", name="첫 페이지").get_attribute("aria-pressed") == "true"
        assert pop.get_by_role("button", name="읽던 곳").get_attribute("aria-pressed") == "false"
    finally:
        ctx.close()


def test_startup_resume(browser):
    """'읽던 곳' 클릭 → bible-startup = 'resume'."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        pop.get_by_role("button", name="읽던 곳").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-startup") == "resume"
    finally:
        ctx.close()


# ── 책 순서 ──────────────────────────────────────────────────────────────────

def test_book_order_vulgate(browser):
    """'구약에 포함' 클릭 → bible-book-order = 'vulgate'."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        pop.get_by_role("button", name="구약에 포함").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-book-order") == "vulgate"
        assert pop.get_by_role("button", name="구약에 포함").get_attribute("aria-pressed") == "true"
    finally:
        ctx.close()


def test_book_order_canonical(browser):
    """'분리' 클릭 → bible-book-order = 'canonical'."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open(page)
        pop = open_settings(page)
        # Set vulgate first, then switch back
        pop.get_by_role("button", name="구약에 포함").click()
        pop.get_by_role("button", name="분리").click()
        page.wait_for_timeout(100)
        assert _ls(page, "bible-book-order") == "canonical"
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
    """
    ctx = browser.new_context()
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

        # clearAllCaches: confirm → delete all → location.reload()
        with page.expect_navigation():
            open_settings(page).get_by_role("button", name="캐시 비우기").click()
        page.wait_for_selector("#search-input")

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
