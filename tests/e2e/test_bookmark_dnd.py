"""E2E: 북마크 드래그&드롭 재정렬.

실제 drag 이벤트 시뮬레이션은 타이밍이 불안정하므로 moveBookmarkItem()을
JS에서 직접 호출해 순서 변경 결과를 검증한다.
"""
import json
from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"

_BM_A = {"type": "bookmark", "id": "bm-a", "bookId": "gen", "chapter": 1,
          "label": "창세기", "verseSpec": "all"}
_BM_B = {"type": "bookmark", "id": "bm-b", "bookId": "john", "chapter": 3,
          "label": "요한", "verseSpec": "all"}
_BM_C = {"type": "bookmark", "id": "bm-c", "bookId": "ps", "chapter": 23,
          "label": "시편", "verseSpec": "all"}
_FOLDER_F = {"type": "folder", "id": "folder-f", "name": "폴더",
             "children": [], "expanded": True}


def _open_drawer(page):
    page.goto(f"{BASE}/gen/1")
    page.wait_for_selector("article.chapter-text .verse")
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")


def _set_store(page, store):
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(store)})")
    page.evaluate("() => renderBookmarkTree()")


def _get_store(page):
    return page.evaluate("() => window.syncStoreV2.loadBookmarks()")


def _move(page, dragged_id, target_id, position):
    """moveBookmarkItem JS 함수를 직접 호출한다."""
    page.evaluate(
        f"() => moveBookmarkItem({json.dumps(dragged_id)}, {json.dumps(target_id)}, {json.dumps(position)})"
    )
    page.wait_for_timeout(200)


def _ids(store):
    """최상위 항목 id 순서 반환."""
    return [item["id"] for item in store]


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_move_bookmark_before(browser):
    """B를 A 앞으로 이동하면 순서가 [B, A]가 된다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _set_store(page, [_BM_A, _BM_B])

        _move(page, "bm-b", "bm-a", "before")

        store = _get_store(page)
        ids = _ids(store)
        assert ids.index("bm-b") < ids.index("bm-a"), \
            f"Expected bm-b before bm-a, got: {ids}"
    finally:
        ctx.close()


def test_move_bookmark_after(browser):
    """A를 B 뒤로 이동하면 순서가 [B, A]가 된다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _set_store(page, [_BM_A, _BM_B])

        _move(page, "bm-a", "bm-b", "after")

        store = _get_store(page)
        ids = _ids(store)
        assert ids.index("bm-b") < ids.index("bm-a"), \
            f"Expected bm-b before bm-a, got: {ids}"
    finally:
        ctx.close()


def test_move_bookmark_into_folder(browser):
    """북마크를 폴더 안으로 이동하면 자식으로 들어간다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _set_store(page, [_BM_A, _FOLDER_F])

        _move(page, "bm-a", "folder-f", "into")

        store = _get_store(page)
        folder = next((item for item in store if item["id"] == "folder-f"), None)
        assert folder is not None, "folder not found"
        child_ids = [c["id"] for c in folder.get("children", [])]
        assert "bm-a" in child_ids, f"bm-a not in folder children: {child_ids}"
        top_ids = _ids(store)
        assert "bm-a" not in top_ids, "bm-a should not be at top level"
    finally:
        ctx.close()


def test_move_three_items_reorder(browser):
    """[A, B, C]에서 C를 A 앞으로 이동하면 [C, A, B]가 된다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _set_store(page, [_BM_A, _BM_B, _BM_C])

        _move(page, "bm-c", "bm-a", "before")

        store = _get_store(page)
        ids = _ids(store)
        assert ids == ["bm-c", "bm-a", "bm-b"], f"Unexpected order: {ids}"
    finally:
        ctx.close()


def test_move_into_own_descendant_ignored(browser):
    """폴더를 자신의 자식 북마크 안으로 이동하는 것은 무시된다 (순환 방지)."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        folder_with_child = {**_FOLDER_F, "children": [_BM_A], "expanded": True}
        _set_store(page, [folder_with_child])

        _move(page, "folder-f", "bm-a", "into")

        store = _get_store(page)
        # folder-f should still be at top level (not inside bm-a)
        top_ids = _ids(store)
        assert "folder-f" in top_ids, "folder should remain at top level"
    finally:
        ctx.close()


def test_drop_indicator_renders_on_content(browser):
    """드롭 위치 삽입선이 콘텐츠 위에 그려진다 — 모바일에서 불투명 콘텐츠(z-index 1)가
    행을 덮어 행에 그린 지시자가 안 보이던 회귀 방지. drag-over-* 클래스를 직접 적용해
    .bm-row-content::after 삽입선(accent 3px)과 폴더 into 하이라이트를 검증한다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _set_store(page, [_BM_A, _BM_B, _FOLDER_F])

        # before: 3px accent insertion line via ::after on the (visible) content.
        page.evaluate(
            "() => document.querySelector(\"li.bm-bookmark[data-id='bm-b']\")"
            ".classList.add('drag-over-before')")
        line = page.evaluate(
            "() => { const s = getComputedStyle("
            "document.querySelector(\"li.bm-bookmark[data-id='bm-b'] .bm-row-content\"), '::after');"
            " return {content: s.content, height: s.height}; }")
        assert line["content"] not in ("none", "normal", ""), f"no ::after line: {line}"
        assert line["height"] == "3px", f"unexpected line height: {line}"

        # into: the folder content row gets an outline highlight.
        page.evaluate(
            "() => document.querySelector(\"li.bm-folder[data-id='folder-f']\")"
            ".classList.add('drag-over-into')")
        outline = page.evaluate(
            "() => getComputedStyle("
            "document.querySelector(\"li.bm-folder[data-id='folder-f'] .bm-row-content\"))"
            ".outlineStyle")
        assert outline == "solid", f"expected solid outline for into, got: {outline}"
    finally:
        ctx.close()
