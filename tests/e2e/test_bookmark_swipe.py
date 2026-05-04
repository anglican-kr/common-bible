"""E2E: 모바일 북마크 행 스와이프 / 롱프레스 액션 — v1.3.0 신규 기능.

모바일 viewport(390px)에서 _isMobileViewport() = true 조건으로
canSwipe가 활성화되어야 스와이프/롱프레스 동작이 트리거된다.
데스크톱 viewport(>768px)에서는 canSwipe = false이므로 동작하지 않는다.

Playwright mouse API는 setPointerCapture와 함께 동작이 불안정하므로
PointerEvent를 JS에서 직접 dispatch하는 방식을 사용한다.
"""
import json
from .conftest import IPHONE_UA, MOBILE_VIEWPORT, CLEAR_APP_STORAGE

BASE = "http://localhost:8080"

_ROW_SEL = "li.bm-bookmark .bm-bookmark-row"
_SWIPED_SEL = ".bm-bookmark-row.bm-swiped"

_BM_A = {"type": "bookmark", "id": "bm-a", "bookId": "gen", "chapter": 1,
          "label": "창세기 1장", "verseSpec": "all"}
_BM_B = {"type": "bookmark", "id": "bm-b", "bookId": "john", "chapter": 3,
          "label": "요한 3장", "verseSpec": "all"}

_SWIPE_JS = """(args) => {
    const rows = document.querySelectorAll('li.bm-bookmark .bm-bookmark-row');
    const row = rows[args.idx] || rows[0];
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const mk = (ex, ey) => ({
        clientX: ex, clientY: ey, pointerId: 1, buttons: 1,
        bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
    });
    row.dispatchEvent(new PointerEvent('pointerdown', mk(cx, cy)));
    const dx = args.dx, steps = 12;
    for (let i = 1; i <= steps; i++) {
        row.dispatchEvent(new PointerEvent('pointermove', mk(cx + dx * i / steps, cy)));
    }
    row.dispatchEvent(new PointerEvent('pointerup', mk(cx + dx, cy)));
    return true;
}"""

_LONGPRESS_DOWN_JS = """(idx) => {
    const rows = document.querySelectorAll('li.bm-bookmark .bm-bookmark-row');
    const row = rows[idx] || rows[0];
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    window.__lpRow = row; window.__lpCx = cx; window.__lpCy = cy;
    row.dispatchEvent(new PointerEvent('pointerdown', {
        clientX: cx, clientY: cy, pointerId: 1, buttons: 1,
        bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
    }));
}"""

_LONGPRESS_UP_JS = """() => {
    const row = window.__lpRow;
    if (!row) return;
    row.dispatchEvent(new PointerEvent('pointerup', {
        clientX: window.__lpCx, clientY: window.__lpCy, pointerId: 1,
        bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true,
    }));
}"""


def _open_drawer(page, bookmarks):
    """Gen 1 로드 → syncStoreV2로 북마크 주입 → 드로어 열기."""
    page.goto(f"{BASE}/gen/1")
    page.wait_for_selector("article.chapter-text .verse")
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(bookmarks)})")
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    page.wait_for_selector("li.bm-bookmark")


def _swipe(page, idx=0, dx=-160):
    """idx번째 북마크 행을 좌로(dx<0) 스와이프한다."""
    page.evaluate(_SWIPE_JS, {"idx": idx, "dx": dx})


def _longpress(page, idx=0, ms=600):
    """idx번째 북마크 행을 ms ms 롱프레스한다."""
    page.evaluate(_LONGPRESS_DOWN_JS, idx)
    page.wait_for_timeout(ms)
    page.evaluate(_LONGPRESS_UP_JS)


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_swipe_reveals_mobile_actions(browser):
    """모바일에서 북마크 행을 왼쪽으로 스와이프하면 수정/삭제 버튼이 노출된다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        _swipe(page, idx=0, dx=-160)
        page.wait_for_selector(_SWIPED_SEL, timeout=2_000)
        assert page.locator(".bm-mobile-edit-btn").count() > 0
        assert page.locator(".bm-mobile-delete-btn").count() > 0
    finally:
        ctx.close()


def test_swipe_other_row_closes_previous(browser):
    """두 번째 행을 스와이프하면 첫 번째 행의 액션이 자동으로 닫힌다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A, _BM_B])
        _swipe(page, idx=0, dx=-160)
        page.wait_for_selector(_SWIPED_SEL, timeout=2_000)
        _swipe(page, idx=1, dx=-160)
        page.wait_for_timeout(300)
        assert page.locator(_SWIPED_SEL).count() == 1
    finally:
        ctx.close()


def test_longpress_reveals_mobile_actions(browser):
    """500ms 이상 롱프레스하면 스와이프와 동일하게 액션 패널이 열린다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        _longpress(page, idx=0, ms=600)
        page.wait_for_selector(_SWIPED_SEL, timeout=2_000)
    finally:
        ctx.close()


def test_short_press_does_not_reveal_actions(browser):
    """짧은 press(<500ms)는 롱프레스를 트리거하지 않는다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        _longpress(page, idx=0, ms=200)
        page.wait_for_timeout(200)
        assert page.locator(_SWIPED_SEL).count() == 0
    finally:
        ctx.close()


def test_swipe_no_effect_on_desktop(browser):
    """데스크톱 viewport(>768px)에서는 canSwipe=false이므로 스와이프가 동작하지 않는다."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        _swipe(page, idx=0, dx=-160)
        page.wait_for_timeout(200)
        assert page.locator(_SWIPED_SEL).count() == 0
    finally:
        ctx.close()


def test_delete_via_swipe(browser):
    """스와이프 → 삭제 버튼 클릭 → confirm 승인 → 북마크 제거."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    page.on("dialog", lambda d: d.accept())
    try:
        _open_drawer(page, [_BM_A])
        _swipe(page, idx=0, dx=-160)
        page.wait_for_selector(_SWIPED_SEL, timeout=2_000)
        page.locator(".bm-mobile-delete-btn").first.click()
        page.wait_for_timeout(400)
        store = page.evaluate("() => window.syncStoreV2.loadBookmarks()")
        ids = [bm["id"] for bm in store]
        assert "bm-a" not in ids, f"Deleted bookmark still in store: {ids}"
    finally:
        ctx.close()
