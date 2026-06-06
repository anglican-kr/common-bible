"""E2E: 북마크 전체뷰의 "🛈 북마크 추가 방법" 안내 팝오버.

추가는 읽기 화면에서만 일어나므로(ADR-029), 이미 북마크가 있는 사용자가 추가
방법을 다시 떠올릴 수 있도록 제목줄 ⋯ 왼쪽에 🛈 버튼 + 안내 팝오버를 둔다.
- 🛈 가 ⋯ 왼쪽에 있고, 탭하면 안내 팝오버(role=dialog)가 열린다
- 안내 문구는 빈 상태와 같은 출처(BOOKMARK_ADD_HELP)다
- HIG "팝오버는 트리거를 덮지 말 것" — 팝오버는 버튼 *아래*에 떨어진다
- Escape / 바깥 클릭으로 닫히고, Escape 시 포커스가 🛈 로 돌아온다
- 🛈 팝오버와 ⋯ 메뉴는 상호배타로 열린다(하나를 열면 다른 하나는 닫힘)

전체뷰(buildBmViewActions)는 모바일 전용이므로 mobile_context 픽스처를 쓴다.
"""
import json

BASE = "http://localhost:8080"

# Scope to .title-action-btn: the drawer also has a "더 보기" overflow button
# (#bm-overflow-btn.bm-toolbar-btn) present in the DOM, so aria-label alone is
# ambiguous on the mobile /bookmarks view.
_INFO_BTN = ".title-action-btn[aria-label='북마크 추가 방법']"
_MORE_BTN = ".title-action-btn[aria-label='더 보기']"
_POPOVER = ".title-action-popover"
_MENU = ".title-action-menu"

_BM_ROOT = {"type": "bookmark", "id": "bm-root", "bookId": "gen", "chapter": 1,
            "label": "창세기 1장", "verseSpec": "all"}

# On the iPhone UA the install nudge auto-opens after ~1.5s; its scrim then
# intercepts taps and races these tests. Pin neverShow so the nudge never fires.
_PIN_NUDGE = (
    "localStorage.setItem('bible-install-nudge',"
    " JSON.stringify({visits: 0, nextShow: 9999, neverShow: true}));"
)


def _seed(mobile_context):
    """Open the mobile /bookmarks full view with one bookmark already saved."""
    mobile_context.add_init_script(_PIN_NUDGE)
    page = mobile_context.new_page()
    page.goto(f"{BASE}/bookmarks")
    page.wait_for_selector("#bookmarks-view-tree", timeout=5_000)
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps([_BM_ROOT])})")
    page.evaluate("() => window.rerenderActiveBookmarkTree()")
    return page


def test_info_button_left_of_more_and_opens_popover(mobile_context):
    """🛈 가 ⋯ 왼쪽에 있고, 탭하면 안내 팝오버가 열린다."""
    page = _seed(mobile_context)

    info = page.locator(_INFO_BTN)
    more = page.locator(_MORE_BTN)
    assert info.is_visible()
    assert more.is_visible()
    # 🛈 sits to the LEFT of ⋯ (smaller x).
    assert info.bounding_box()["x"] < more.bounding_box()["x"]

    # Closed by default.
    assert page.locator(_POPOVER).is_hidden()
    assert info.get_attribute("aria-expanded") == "false"

    info.click()
    page.wait_for_selector(f"{_POPOVER}:not([hidden])")
    assert info.get_attribute("aria-expanded") == "true"
    # Shares the empty-state copy (BOOKMARK_ADD_HELP).
    assert "북마크 버튼을 누르면" in page.locator(_POPOVER).inner_text()


def test_popover_drops_below_trigger(mobile_context):
    """HIG: 팝오버는 자신을 띄운 버튼을 덮지 않고 아래에 떨어진다."""
    page = _seed(mobile_context)

    info = page.locator(_INFO_BTN)
    info.click()
    page.wait_for_selector(f"{_POPOVER}:not([hidden])")

    btn_box = info.bounding_box()
    pop_box = page.locator(_POPOVER).bounding_box()
    # Popover top is at/below the button's bottom — it does not cover it.
    assert pop_box["y"] >= btn_box["y"] + btn_box["height"] - 1


def test_escape_closes_and_restores_focus(mobile_context):
    """Escape 로 닫히고 포커스가 🛈 버튼으로 돌아온다."""
    page = _seed(mobile_context)

    info = page.locator(_INFO_BTN)
    info.click()
    page.wait_for_selector(f"{_POPOVER}:not([hidden])")

    page.keyboard.press("Escape")
    page.wait_for_selector(_POPOVER, state="hidden")
    assert info.get_attribute("aria-expanded") == "false"
    assert page.evaluate(
        "() => document.activeElement?.getAttribute('aria-label')"
    ) == "북마크 추가 방법"


def test_popover_and_more_menu_are_mutually_exclusive(mobile_context):
    """🛈 팝오버와 ⋯ 메뉴는 동시에 열리지 않는다."""
    page = _seed(mobile_context)

    # Open 🛈, then open ⋯ → 🛈 closes (reachable by real pointer: the popover
    # drops below the buttons, so ⋯ stays clickable).
    page.locator(_INFO_BTN).click()
    page.wait_for_selector(f"{_POPOVER}:not([hidden])")
    page.locator(_MORE_BTN).click()
    page.wait_for_selector(f"{_MENU}:not([hidden])")
    assert page.locator(_POPOVER).is_hidden()

    # Reverse direction: the open ⋯ menu floats over the 🛈 button, so a real tap
    # can't reach it — dispatch the click to exercise the handler (closeMenu + open
    # info) directly. The menu should close as the popover opens.
    page.locator(_INFO_BTN).dispatch_event("click")
    page.wait_for_selector(f"{_POPOVER}:not([hidden])")
    assert page.locator(_MENU).is_hidden()
