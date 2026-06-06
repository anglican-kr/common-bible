"""E2E: 북마크 일괄 삭제 — ⋯ 메뉴 → 삭제 → 체크박스 선택 → 확인 → 삭제.

검색 팝오버(북마크 뷰 ⋯ 더 보기 메뉴)의 삭제 기능을 검증한다.
- 메뉴의 "삭제" 항목이 다중 선택 모달을 연다
- 폴더를 선택하면 안의 항목이 cascade 로 함께 체크·비활성된다
- "삭제 (N)" 가 공유 확인 알림(bm-confirm)을 띄우고, 확인 시 실제로 지운다
- 목록이 비어 있으면 메뉴의 삭제 항목은 비활성된다
"""
import json
from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"

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
    page.evaluate("() => _rerenderActiveBookmarkTree()")


def _get_store(page):
    return page.evaluate("() => window.syncStoreV2.loadBookmarks()")


def _open_delete_modal(page):
    page.locator(".title-action-btn").click()
    page.wait_for_selector(".title-action-menu:not([hidden])")
    page.locator(".title-action-menu-item--danger").click()
    page.wait_for_selector("#bm-bulk-delete-modal:not([hidden])")


def test_delete_single_bookmark_via_picker(browser):
    """체크박스로 북마크 하나를 골라 삭제 → 확인 → 목록에서 사라진다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_BM_NESTED)])
        _open_delete_modal(page)

        # Tick the first row.
        page.locator("#bm-bulk-delete-list input[type=checkbox]").first.check()
        confirm = page.locator("#bm-bulk-delete-confirm")
        assert confirm.inner_text() == "삭제 (1)"
        assert not confirm.is_disabled()
        confirm.click()

        # Shared destructive confirm stacks on top.
        page.wait_for_selector("#bm-confirm-modal:not([hidden])")
        page.locator("#bm-confirm-ok").click()
        page.wait_for_selector("#bm-bulk-delete-modal", state="hidden")

        ids = [i["id"] for i in _get_store(page)]
        assert "bm-root" not in ids
        assert "bm-nested" in ids
    finally:
        ctx.close()


def test_folder_selection_cascades_and_deletes_subtree(browser):
    """폴더를 선택하면 안의 북마크도 체크·비활성되고, 삭제 시 함께 사라진다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_FOLDER)])
        _open_delete_modal(page)

        checks = page.locator("#bm-bulk-delete-list input[type=checkbox]")
        # Rows are pre-order: [bm-root, folder-1, bm-nested].
        assert checks.count() == 3
        checks.nth(1).check()  # the folder

        # Folder + its nested bookmark are both marked; nested row is disabled.
        assert checks.nth(1).is_checked()
        assert checks.nth(2).is_checked()
        assert checks.nth(2).is_disabled()
        # Count reflects every node removed (folder + 1 child = 2).
        assert page.locator("#bm-bulk-delete-confirm").inner_text() == "삭제 (2)"

        page.locator("#bm-bulk-delete-confirm").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])")
        page.locator("#bm-confirm-ok").click()
        page.wait_for_selector("#bm-bulk-delete-modal", state="hidden")

        ids = [i["id"] for i in _get_store(page)]
        assert ids == ["bm-root"]
    finally:
        ctx.close()


def test_select_all_marks_every_row(browser):
    """'전체 선택' 이 모든 행을 체크하고 삭제하면 목록이 빈다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_FOLDER)])
        _open_delete_modal(page)

        page.locator("#bm-bulk-delete-all").check()
        assert page.locator("#bm-bulk-delete-confirm").inner_text() == "삭제 (3)"
        page.locator("#bm-bulk-delete-confirm").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])")
        page.locator("#bm-confirm-ok").click()
        page.wait_for_selector("#bm-bulk-delete-modal", state="hidden")

        assert _get_store(page) == []
    finally:
        ctx.close()


def test_cancel_confirm_keeps_everything(browser):
    """확인 알림에서 취소하면 아무것도 지워지지 않는다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_ROOT, dict(_BM_NESTED)])
        _open_delete_modal(page)

        page.locator("#bm-bulk-delete-list input[type=checkbox]").first.check()
        page.locator("#bm-bulk-delete-confirm").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])")
        page.locator("#bm-confirm-cancel").click()
        page.wait_for_selector("#bm-confirm-modal", state="hidden")

        assert len(_get_store(page)) == 2
    finally:
        ctx.close()


def test_delete_item_disabled_when_empty(browser):
    """목록이 비어 있으면 ⋯ 메뉴의 삭제 항목이 비활성된다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [])
        page.locator(".title-action-btn").click()
        page.wait_for_selector(".title-action-menu:not([hidden])")
        assert page.locator(".title-action-menu-item--danger").is_disabled()
    finally:
        ctx.close()
