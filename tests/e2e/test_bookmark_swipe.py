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

# iPhone UA auto-opens the install nudge ~1.5s in; its scrim then intercepts taps
# in the longer (click-through) tests. Pin neverShow so it never fires.
_PIN_NUDGE = (
    "localStorage.setItem('bible-install-nudge',"
    " JSON.stringify({visits: 0, nextShow: 9999, neverShow: true}));"
)

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
    """Gen 1 로드 → syncStoreV2로 북마크 주입 → 드로어 열기.

    드로어는 직접 연다(window.openBookmarkDrawer). 모바일에서 헤더 북마크
    버튼은 '이 장 저장/삭제' 토글로 동작하므로(#190 이후) 더 이상 드로어를
    열지 않는다 — 스와이프 동작 자체를 검증하기 위해 드로어를 프로그램적으로 연다."""
    page.goto(f"{BASE}/gen/1")
    page.wait_for_selector("article.chapter-text .verse")
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(bookmarks)})")
    page.evaluate("() => window.openBookmarkDrawer('gen', 1)")
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    page.wait_for_selector("li.bm-bookmark")


def _swipe(page, idx=0, dx=-160):
    """idx번째 북마크 행을 좌로(dx<0) 스와이프한다."""
    page.evaluate(_SWIPE_JS, {"idx": idx, "dx": dx})


def _longpress(page, idx=0, ms=600):
    """idx번째 북마크 행을 ms ms 롱프레스한다."""
    page.evaluate(_LONGPRESS_DOWN_JS, idx)
    page.wait_for_timeout(ms + 100)  # 100ms buffer for system load variance
    page.evaluate(_LONGPRESS_UP_JS)


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_swipe_left_reveals_delete(browser):
    """모바일에서 행을 왼쪽으로 스와이프하면 삭제 액션이 노출된다 (iOS 관례).

    양방향 스와이프(ADR-010 개정): 왼쪽(trailing) = 삭제(우측 가장자리·빨강),
    오른쪽(leading) = 수정(좌측 가장자리)."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_PIN_NUDGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        _swipe(page, idx=0, dx=-160)
        page.wait_for_selector(".bm-bookmark-row.bm-swiped-delete", timeout=2_000)
        assert page.locator(".bm-swipe-delete").count() > 0
    finally:
        ctx.close()


def test_swipe_right_reveals_edit(browser):
    """오른쪽으로 스와이프하면 수정 액션이 노출된다 (leading edge)."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_PIN_NUDGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        _swipe(page, idx=0, dx=160)
        page.wait_for_selector(".bm-bookmark-row.bm-swiped-edit", timeout=2_000)
        assert page.locator(".bm-swipe-edit").count() > 0
    finally:
        ctx.close()


def test_swipe_other_row_closes_previous(browser):
    """두 번째 행을 스와이프하면 첫 번째 행의 액션이 자동으로 닫힌다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_PIN_NUDGE)
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


def test_longpress_starts_drag(browser):
    """500ms 이상 롱프레스하면 드래그-재정렬 모드가 시작된다 (액션 패널이 아님)."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_PIN_NUDGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        page.evaluate(_LONGPRESS_DOWN_JS, 0)
        page.wait_for_timeout(600)
        # bm-dragging class on the li indicates drag mode entered.
        page.wait_for_selector("li.bm-bookmark.bm-dragging", timeout=2_000)
        # Drag ghost element should exist on body.
        assert page.locator(".bm-drag-ghost").count() > 0
        # Action panel must NOT be revealed by long-press anymore.
        assert page.locator(_SWIPED_SEL).count() == 0
        page.evaluate(_LONGPRESS_UP_JS)
    finally:
        ctx.close()


def test_short_press_does_not_start_drag(browser):
    """짧은 press(<500ms)는 드래그를 시작하지 않고 액션 패널도 열리지 않는다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_PIN_NUDGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        _longpress(page, idx=0, ms=200)
        page.wait_for_timeout(200)
        assert page.locator(_SWIPED_SEL).count() == 0
        assert page.locator("li.bm-bookmark.bm-dragging").count() == 0
    finally:
        ctx.close()


def test_swipe_no_effect_on_desktop(browser):
    """데스크톱 viewport(>768px)에서는 canSwipe=false이므로 스와이프가 동작하지 않는다."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_PIN_NUDGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        _swipe(page, idx=0, dx=-160)
        page.wait_for_timeout(200)
        assert page.locator(_SWIPED_SEL).count() == 0
    finally:
        ctx.close()


def test_delete_via_swipe(browser):
    """왼쪽으로 스와이프 → 삭제 버튼 클릭 → 확인 모달 승인 → 북마크 제거.

    삭제는 왼쪽 스와이프로 노출(우측 가장자리, iOS 관례). 노출된 삭제 라벨을
    클릭하면 (겹친 수정 버튼이 가로채지 않고) 삭제가 실행돼야 한다 — pointer-events
    수정 회귀."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_PIN_NUDGE)
    page = ctx.new_page()
    try:
        _open_drawer(page, [_BM_A])
        page.wait_for_timeout(300)  # let the drawer settle before measuring/swiping
        _swipe(page, idx=0, dx=-160)
        page.wait_for_selector(".bm-bookmark-row.bm-swiped-delete", timeout=2_000)
        page.wait_for_timeout(350)  # let the snap-open transition finish sliding
        # Click the exposed 삭제 strip by coordinate (right edge), exercising real
        # hit-testing: with the old bug the overlapping 수정 button would catch it.
        box = page.evaluate(
            "() => { const r = document.querySelector('.bm-bookmark-row.bm-swiped-delete')"
            ".getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; }"
        )
        page.mouse.click(box["x"] + box["w"] - 26, box["y"] + box["h"] / 2)
        page.wait_for_selector("#bm-confirm-modal:not([hidden])", timeout=2_000)
        page.locator("#bm-confirm-ok").click()
        page.wait_for_timeout(400)
        store = page.evaluate("() => window.syncStoreV2.loadBookmarks()")
        ids = [bm["id"] for bm in store]
        assert "bm-a" not in ids, f"Deleted bookmark still in store: {ids}"
    finally:
        ctx.close()
