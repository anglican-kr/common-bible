"""E2E: 북마크 선택-삭제 모드 — ⋯ 메뉴 → 삭제 → 행을 골라 하단 dock 삭제.

ADR-029 개정: 별도 체크박스 모달 대신 in-place 선택 모드로 삭제한다.
- ⋯ 메뉴의 "삭제" 가 선택 모드를 연다(탭 dock 숨김 + #bm-select-bar 노출 +
  제목줄이 "전체 선택" 토글로 교체).
- 행을 누르면 선행 선택 원(.bm-select-circle.is-selected)이 켜지고 카운트 칩이 갱신된다.
- 폴더를 누르면 안의 항목이 cascade 로 covered(is-covered) 표시된다.
- 하단 삭제(🗑)가 공유 확인 알림(bm-confirm)을 거쳐 실제로 지운다.
- 취소(✕)·Escape 는 모드를 빠져나오며 아무것도 지우지 않는다.
- 목록이 비어 있으면 메뉴의 삭제 항목은 비활성된다.
"""
import json
from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT, IPHONE_UA

BASE = "http://localhost:8080"

# The full /bookmarks view (renderBookmarksView → #bookmarks-view-tree) and select
# mode are mobile only, so these tests need a mobile viewport.

_BM_ROOT = {"type": "bookmark", "id": "bm-root", "bookId": "gen", "chapter": 1,
            "label": "창세기 1장", "verseSpec": "all"}
_BM_NESTED = {"type": "bookmark", "id": "bm-nested", "bookId": "exo", "chapter": 3,
              "label": "출애굽기 3장", "verseSpec": "1-5"}
_FOLDER = {"type": "folder", "id": "folder-1", "name": "대림시기",
           "children": [_BM_NESTED], "expanded": True}


def _open_bookmarks_view(page):
    page.goto(f"{BASE}/bookmarks")
    page.wait_for_selector("#bookmarks-view-tree", timeout=5_000)


def _set_store(page, store):
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(store)})")
    page.evaluate("() => window.rerenderActiveBookmarkTree()")


def _get_store(page):
    return page.evaluate("() => window.syncStoreV2.loadBookmarks()")


def _enter_select_mode(page):
    # Title row carries 🛈 (안내) + ⋯ (더 보기); target ⋯ by aria-label, then the
    # neutral "선택" menu item (was "삭제"; the dock now offers 공유·이동·삭제).
    page.locator(".title-action-btn[aria-label='더 보기']").click()
    page.wait_for_selector(".title-action-menu:not([hidden])")
    page.get_by_role("menuitem", name="선택", exact=True).click()
    page.wait_for_selector("#bm-select-bar:not([hidden])")


def _in_select_mode(page):
    return page.evaluate("() => document.body.classList.contains('bm-select-active')")


def test_enter_select_mode_swaps_chrome(browser):
    """삭제 진입 → body.bm-select-active, 하단 바 노출, 제목줄이 전체 선택 토글로 교체."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_BM_NESTED)])
        _enter_select_mode(page)

        assert _in_select_mode(page)
        # The ⋯/🛈 cluster yields to the 전체 선택 toggle.
        assert page.locator(".bm-select-allbtn").is_visible()
        assert page.locator(".title-actions").is_hidden()
        # Nothing selected yet: guidance prompt + all three pill actions disabled.
        assert page.locator("#bm-select-count").inner_text() == "항목을 선택하세요"
        assert page.locator("#bm-select-share-btn").is_disabled()
        assert page.locator("#bm-select-move-btn").is_disabled()
        assert page.locator("#bm-select-delete-btn").is_disabled()
    finally:
        ctx.close()


def test_select_one_bookmark_and_delete(browser):
    """행을 눌러 선택 → 하단 삭제 → 확인 → 그 북마크만 사라지고 모드 종료."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_BM_NESTED)])
        _enter_select_mode(page)

        page.locator("li.bm-bookmark[data-id='bm-root'] .bm-bookmark-row").click()
        page.wait_for_selector(
            "li.bm-bookmark[data-id='bm-root'] .bm-select-circle.is-selected")
        assert page.locator("#bm-select-count").inner_text() == "1개 선택됨"
        assert not page.locator("#bm-select-delete-btn").is_disabled()

        page.locator("#bm-select-delete-btn").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])")
        page.locator("#bm-confirm-ok").click()
        page.wait_for_selector("#bm-select-bar", state="hidden")

        ids = [i["id"] for i in _get_store(page)]
        assert "bm-root" not in ids
        assert "bm-nested" in ids
        assert not _in_select_mode(page)
    finally:
        ctx.close()


def test_folder_tick_cascades_and_deletes_subtree(browser):
    """폴더를 누르면 안의 북마크가 covered 로 표시되고, 삭제 시 함께 사라진다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_FOLDER)])
        _enter_select_mode(page)

        page.locator("li.bm-folder[data-id='folder-1'] .bm-folder-row").click()
        page.wait_for_selector(
            "li.bm-folder[data-id='folder-1'] .bm-select-circle.is-selected")
        # Nested child is covered (owned by the ticked folder).
        assert page.locator(
            "li.bm-bookmark[data-id='bm-nested'] .bm-select-circle.is-covered").count() == 1
        # Count reflects every node removed (folder + 1 child = 2).
        assert page.locator("#bm-select-count").inner_text() == "2개 선택됨"

        page.locator("#bm-select-delete-btn").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])")
        page.locator("#bm-confirm-ok").click()
        page.wait_for_selector("#bm-select-bar", state="hidden")

        ids = [i["id"] for i in _get_store(page)]
        assert ids == ["bm-root"]
    finally:
        ctx.close()


def test_select_all_then_delete_empties(browser):
    """전체 선택 토글 → 모든 행 표시 → 삭제하면 목록이 빈다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_FOLDER)])
        _enter_select_mode(page)

        page.locator(".bm-select-allbtn").click()
        # bm-root + folder-1 + bm-nested = 3 nodes.
        assert page.locator("#bm-select-count").inner_text() == "3개 선택됨"
        # Toggle now reads "선택 해제".
        assert page.locator(".bm-select-allbtn").inner_text() == "선택 해제"

        page.locator("#bm-select-delete-btn").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])")
        page.locator("#bm-confirm-ok").click()
        page.wait_for_selector("#bm-select-bar", state="hidden")

        assert _get_store(page) == []
    finally:
        ctx.close()


def test_cancel_exits_without_deleting(browser):
    """취소(✕) 는 선택을 버리고 모드를 빠져나오며 아무것도 지우지 않는다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_BM_NESTED)])
        _enter_select_mode(page)

        page.locator("li.bm-bookmark[data-id='bm-root'] .bm-bookmark-row").click()
        page.wait_for_selector(".bm-select-circle.is-selected")
        page.locator("#bm-select-cancel-btn").click()
        page.wait_for_selector("#bm-select-bar", state="hidden")

        assert len(_get_store(page)) == 2
        assert not _in_select_mode(page)
        # The ⋯/🛈 cluster is back.
        assert page.locator(".title-actions").is_visible()
    finally:
        ctx.close()


def test_confirm_cancel_keeps_store_and_stays_in_mode(browser):
    """확인 알림에서 취소하면 삭제되지 않고 선택 모드는 유지된다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_BM_NESTED)])
        _enter_select_mode(page)

        page.locator("li.bm-bookmark[data-id='bm-root'] .bm-bookmark-row").click()
        page.locator("#bm-select-delete-btn").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])")
        page.locator("#bm-confirm-cancel").click()
        page.wait_for_selector("#bm-confirm-modal", state="hidden")

        assert len(_get_store(page)) == 2
        # Still selecting (bar visible), so the user can adjust the picks.
        assert page.locator("#bm-select-bar:not([hidden])").count() == 1
        assert _in_select_mode(page)
    finally:
        ctx.close()


def test_select_item_disabled_when_empty(browser):
    """목록이 비어 있으면 ⋯ 메뉴의 선택 항목이 비활성된다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [])
        page.locator(".title-action-btn[aria-label='더 보기']").click()
        page.wait_for_selector(".title-action-menu:not([hidden])")
        assert page.get_by_role("menuitem", name="선택", exact=True).is_disabled()
    finally:
        ctx.close()


def test_share_invokes_native_share_with_links(browser):
    """공유 → navigator.share 가 bible.anglican.kr 링크 payload 로 호출된다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    # Stub navigator.share to capture the payload (headless has no share sheet).
    ctx.add_init_script(
        "navigator.share = (data) => { window.__shared = data; return Promise.resolve(); };"
    )
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_BM_NESTED)])
        _enter_select_mode(page)
        page.locator("li.bm-bookmark[data-id='bm-root'] .bm-bookmark-row").click()
        page.wait_for_selector(".bm-select-circle.is-selected")
        page.locator("#bm-select-share-btn").click()
        page.wait_for_function("() => !!window.__shared")
        shared = page.evaluate("() => window.__shared")
        assert shared.get("url") == "https://bible.anglican.kr/gen/1"
        # Successful share leaves select mode.
        page.wait_for_selector("#bm-select-bar", state="hidden")
        assert not _in_select_mode(page)
    finally:
        ctx.close()


def test_move_into_folder(browser):
    """이동 → 폴더 목록 모달에서 폴더를 탭하면 선택 항목이 그 폴더로 이동한다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        # bm-root at root + an empty target folder.
        _set_store(page, [dict(_BM_ROOT), {"type": "folder", "id": "folder-1",
                                            "name": "대림시기", "children": [], "expanded": True}])
        _enter_select_mode(page)
        page.locator("li.bm-bookmark[data-id='bm-root'] .bm-bookmark-row").click()
        page.wait_for_selector(".bm-select-circle.is-selected")
        page.locator("#bm-select-move-btn").click()
        page.wait_for_selector("#bm-move-modal:not([hidden])")
        # Tap the "대림시기" destination row.
        page.get_by_role("button", name="대림시기").click()
        page.wait_for_selector("#bm-move-modal", state="hidden")
        page.wait_for_selector("#bm-select-bar", state="hidden")

        store = _get_store(page)
        # bm-root is now inside folder-1, not at root.
        assert all(n["id"] != "bm-root" for n in store)
        folder = next(n for n in store if n["id"] == "folder-1")
        assert any(c["id"] == "bm-root" for c in folder["children"])
    finally:
        ctx.close()


def test_move_folder_into_folder(browser):
    """이동 → 선택한 폴더를 다른 폴더로 옮긴다 (자기/하위 드롭 방지에 _isDescendant 사용).

    회귀 가드: 선택 항목이 폴더일 때만 _moveSelectedToFolder 가 _isDescendant 를 호출한다.
    제스처 모듈 분리(ADR-034 후속) 때 _isDescendant 가 bookmark-gestures.js 로 옮겨졌는데
    export 누락으로 이 경로가 ReferenceError 로 깨졌었다(북마크만 옮기던 기존 테스트는 폴더
    분기를 안 밟아 못 잡음). pageerror 가 0 이어야 하고 이동이 실제로 일어나야 한다.
    """
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        _open_bookmarks_view(page)
        # folder-a(이동 대상, 안에 북마크 1개) + folder-b(목적지, 비어 있음).
        _set_store(page, [
            {"type": "folder", "id": "folder-a", "name": "이동대상",
             "children": [dict(_BM_NESTED)], "expanded": True},
            {"type": "folder", "id": "folder-b", "name": "목적지",
             "children": [], "expanded": True},
        ])
        _enter_select_mode(page)
        # Tick folder-a (direct child row — a nested row would also match in strict mode).
        page.locator("li.bm-folder[data-id='folder-a'] > .bm-folder-row").click()
        page.wait_for_selector(".bm-select-circle.is-selected")
        page.locator("#bm-select-move-btn").click()
        page.wait_for_selector("#bm-move-modal:not([hidden])")
        # folder-a is excluded (it's the moving item); 목적지(folder-b) is the destination.
        page.get_by_role("button", name="목적지").click()
        page.wait_for_selector("#bm-move-modal", state="hidden")
        page.wait_for_selector("#bm-select-bar", state="hidden")

        store = _get_store(page)
        # folder-a is now inside folder-b (with its bm-nested child intact), not at root.
        assert all(n["id"] != "folder-a" for n in store), store
        folder_b = next(n for n in store if n["id"] == "folder-b")
        moved = next(c for c in folder_b["children"] if c["id"] == "folder-a")
        assert any(c["id"] == "bm-nested" for c in moved["children"])
        # No ReferenceError (the regression) reached the page.
        assert errors == [], errors
    finally:
        ctx.close()


def test_move_new_folder_with_parent(browser):
    """이동 → 새 폴더: 상위 폴더(대림시기)를 지정해 만든 폴더로 선택 항목이 이동한다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [dict(_BM_ROOT), {"type": "folder", "id": "folder-1",
                                            "name": "대림시기", "children": [], "expanded": True}])
        _enter_select_mode(page)
        page.locator("li.bm-bookmark[data-id='bm-root'] .bm-bookmark-row").click()
        page.wait_for_selector(".bm-select-circle.is-selected")
        page.locator("#bm-select-move-btn").click()
        page.wait_for_selector("#bm-move-modal:not([hidden])")
        # "새 폴더" (below the list) → new-folder modal with a parent picker.
        page.locator("#bm-move-new-folder").click()
        page.wait_for_selector("#bm-new-folder-modal:not([hidden])")
        page.fill("#bm-new-folder-input", "성탄절")
        # Choose 대림시기 as the parent via the combobox.
        page.locator("#bm-newfolder-parent-btn").click()
        page.locator("#bm-newfolder-parent-listbox .bm-folder-combobox-option[data-id='folder-1']").click()
        page.locator("#bm-new-folder-confirm").click()
        page.wait_for_selector("#bm-new-folder-modal", state="hidden")
        page.wait_for_selector("#bm-select-bar", state="hidden")

        store = _get_store(page)
        # New folder "성탄절" created under 대림시기, and bm-root moved into it.
        assert all(n["id"] != "bm-root" for n in store)
        folder1 = next(n for n in store if n["id"] == "folder-1")
        newf = next(c for c in folder1["children"]
                    if c.get("type") == "folder" and c["name"] == "성탄절")
        assert any(c["id"] == "bm-root" for c in newf["children"])
    finally:
        ctx.close()


def test_move_new_folder_excludes_selected_parent(browser):
    """이동 → 새 폴더: 상위 폴더 후보에서 이동 중인 폴더(와 그 하위)는 제외된다.

    빠지지 않으면 선택 폴더 안에 새 폴더가 생겨 이동이 no-op 가 되고 빈 폴더만 남는다.
    """
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        # outer 폴더 안에 inner 폴더 — outer 를 선택해 이동한다.
        _set_store(page, [{
            "type": "folder", "id": "outer", "name": "바깥", "expanded": True,
            "children": [{"type": "folder", "id": "inner", "name": "안쪽",
                          "children": [], "expanded": True}],
        }])
        _enter_select_mode(page)
        # Direct child only — a nested folder also has a .bm-folder-row (strict mode).
        page.locator("li.bm-folder[data-id='outer'] > .bm-folder-row").click()
        page.wait_for_selector(".bm-select-circle.is-selected")
        page.locator("#bm-select-move-btn").click()
        page.wait_for_selector("#bm-move-modal:not([hidden])")
        page.locator("#bm-move-new-folder").click()
        page.wait_for_selector("#bm-new-folder-modal:not([hidden])")
        # The selected folder and its descendant must NOT be offered as a parent.
        assert page.locator(
            "#bm-newfolder-parent-listbox .bm-folder-combobox-option[data-id='outer']").count() == 0
        assert page.locator(
            "#bm-newfolder-parent-listbox .bm-folder-combobox-option[data-id='inner']").count() == 0
        # 최상위 is always available.
        assert page.locator(
            "#bm-newfolder-parent-listbox .bm-folder-combobox-option[data-id='']").count() == 1
    finally:
        ctx.close()
