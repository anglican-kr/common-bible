"""E2E: 접근성 — 키보드 인터랙션.

Tab 포커스 순서, Enter/Escape 동작, 포커스 트랩, 포커스 복귀를 검증한다.
"""
from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"


def _open(browser, path=""):
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    url = f"{BASE}/{path}".rstrip("/") or BASE
    page.goto(url)
    page.wait_for_selector("#search-input")
    return ctx, page


def _focused(page) -> str:
    """현재 포커스된 요소의 aria-label, id, 또는 tag를 반환한다."""
    return page.evaluate("""() => {
        const el = document.activeElement;
        if (!el) return 'none';
        return el.getAttribute('aria-label') || el.id || el.tagName.toLowerCase();
    }""")


# ── Enter / Escape ────────────────────────────────────────────────────────────

def test_search_enter_shows_results(browser):
    """검색 입력 후 Enter → 결과가 표시된다."""
    ctx, page = _open(browser)
    try:
        page.fill("#search-input", "사랑")
        page.keyboard.press("Enter")
        page.wait_for_selector(".search-result-item", timeout=8_000)
    finally:
        ctx.close()


def test_escape_closes_bookmark_drawer(browser):
    """북마크 드로어가 열린 상태에서 Escape → 드로어가 닫힌다."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")

        page.keyboard.press("Escape")
        page.wait_for_selector("#bookmark-drawer", state="hidden", timeout=2_000)
    finally:
        ctx.close()


def test_escape_closes_bm_save_modal(browser):
    """북마크 저장 모달에서 Escape → 모달이 닫힌다."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        page.locator("#bm-save-chapter-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])")

        page.keyboard.press("Escape")
        page.wait_for_selector("#bm-save-modal", state="hidden", timeout=2_000)
    finally:
        ctx.close()


def test_escape_closes_settings_popover(browser):
    """설정 팝오버에서 Escape → 팝오버가 닫힌다."""
    ctx, page = _open(browser)
    try:
        page.locator("#settings-anchor .settings-btn").click()
        page.wait_for_selector(".settings-popover", state="visible")

        page.keyboard.press("Escape")
        page.wait_for_selector(".settings-popover", state="hidden", timeout=2_000)
    finally:
        ctx.close()


# ── 포커스 트랩 ───────────────────────────────────────────────────────────────

def test_focus_trap_in_bm_save_modal(browser):
    """북마크 저장 모달에서 Tab이 모달 밖으로 나가지 않는다."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        page.locator("#bm-save-chapter-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])")

        # Tab through all focusable elements inside modal
        for _ in range(10):
            page.keyboard.press("Tab")
            focused_el = page.evaluate("""() => {
                const el = document.activeElement;
                return el ? el.closest('#bm-save-modal') !== null : false;
            }""")
            assert focused_el, "Focus escaped the modal after Tab"
    finally:
        ctx.close()


def test_focus_returns_after_drawer_close(browser):
    """북마크 드로어를 닫으면 포커스가 트리거 버튼으로 복귀한다."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        trigger = page.locator(".title-bookmark-btn")
        trigger.click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")

        page.keyboard.press("Escape")
        page.wait_for_selector("#bookmark-drawer", state="hidden", timeout=2_000)
        page.wait_for_timeout(200)

        focused_el = page.evaluate("""() => {
            const el = document.activeElement;
            return el ? (el.className || '').includes('title-bookmark-btn') : false;
        }""")
        assert focused_el, "Focus should return to .title-bookmark-btn after drawer close"
    finally:
        ctx.close()


# ── verse select Escape ───────────────────────────────────────────────────────

def test_verse_select_cancel_btn_exits_mode(browser):
    """절 선택 모드 진입(enterVerseSelectMode) → 취소 버튼 클릭 → bar 숨김."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse")

        page.evaluate("() => enterVerseSelectMode('gen', 1)")
        page.wait_for_selector("#verse-select-bar:not([hidden])", timeout=2_000)

        page.locator("#verse-select-cancel-btn").click()
        page.wait_for_selector("#verse-select-bar", state="hidden", timeout=2_000)
    finally:
        ctx.close()
