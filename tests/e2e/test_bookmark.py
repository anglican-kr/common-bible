"""E2E: bookmark drawer — open from chapter header, save whole chapter, list updates."""

import json

from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT, IPHONE_UA

BASE = "http://localhost:8080"


def _open_chapter_and_wait(page, path: str) -> None:
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(200)


def test_bookmark_drawer_opens_shows_empty_state(browser):
    """Header bookmark button opens drawer; empty list message is shown."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script(
        "localStorage.removeItem('bible-bookmarks');"
    )
    _open_chapter_and_wait(page, "gen/1")

    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    expect_title = page.locator("#bookmark-drawer-title")
    assert expect_title.inner_text() == "북마크"
    assert "저장된 북마크가 없습니다" in page.inner_text("#bookmark-drawer-body")

    ctx.close()


def test_save_chapter_bookmark_appears(browser):
    """Save current chapter; bookmark row appears in the drawer."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script(
        "localStorage.removeItem('bible-bookmarks');"
    )
    _open_chapter_and_wait(page, "gen/1")

    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    page.locator("#bm-save-chapter-btn").click()
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.locator("#bm-label-input").fill("E2E 창세기 1장")
    page.locator("#bm-save-modal .bm-btn-primary").click()
    page.locator("#bm-save-modal").wait_for(state="hidden")

    row = page.locator(".bm-bookmark-link", has_text="E2E 창세기 1장")
    assert row.count() == 1

    # Verify via syncStoreV2 (v2 store)
    store = page.evaluate("() => window.syncStoreV2.loadBookmarks()")
    assert any(
        it.get("type") == "bookmark"
        and it.get("bookId") == "gen"
        and it.get("chapter") == 1
        and it.get("label") == "E2E 창세기 1장"
        for it in store
    )

    ctx.close()


def test_bm_empty_msg_disappears_after_save(browser):
    """빈 드로어의 '저장된 북마크가 없습니다' 메시지는 북마크 추가 후 사라진다.

    role='presentation'을 추가한 li.bm-empty가 시각적·기능적으로
    올바르게 동작하는지 확인한다.
    """
    from .conftest import CLEAR_APP_STORAGE
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    _open_chapter_and_wait(page, "gen/1")

    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    # Empty state visible
    assert "저장된 북마크가 없습니다" in page.inner_text("#bookmark-drawer-body")
    assert page.locator("li.bm-empty").count() == 1
    assert page.locator("li.bm-bookmark").count() == 0

    # Save a bookmark
    page.locator("#bm-save-chapter-btn").click()
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.locator("#bm-save-modal .bm-btn-primary").click()
    page.wait_for_selector("#bm-save-modal", state="hidden")
    page.wait_for_selector("li.bm-bookmark")

    # Empty state gone, bookmark item visible
    assert page.locator("li.bm-empty").count() == 0
    assert page.locator("li.bm-bookmark").count() == 1

    ctx.close()


def test_save_after_drawer_close_uses_current_chapter_not_stale(browser):
    """Regression: opening the drawer at gen/1 then closing it must not poison
    a later save flow for a different chapter (john/3) into asking to merge
    with the gen/1 bookmark."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()

    # 1) Seed an existing Genesis 1 bookmark in the v2 store.
    _open_chapter_and_wait(page, "gen/1")
    seed = [{
        "type": "bookmark", "id": "bm-seed-gen1",
        "bookId": "gen", "chapter": 1,
        "label": "창세 1장 (시드)", "verseSpec": "all",
    }]
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(seed)})")

    # 2) Open drawer at gen/1, then close it.
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    page.locator("#bookmark-drawer-close").click()
    page.wait_for_selector("#bookmark-drawer", state="hidden")

    # 3) Navigate to a different chapter where no bookmark exists yet.
    _open_chapter_and_wait(page, "john/3")

    # 4) Enter verse-select for john/3 and pick verse 1, then tap save.
    page.evaluate("() => enterVerseSelectMode('john', 3)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.click("#v1")
    assert not page.locator("#verse-select-bookmark-btn").is_disabled()
    page.click("#verse-select-bookmark-btn")

    # 5) The save modal must open directly. The merge dialog must NOT appear,
    #    because there is no existing john/3 bookmark.
    page.wait_for_selector("#bm-save-modal:not([hidden])", timeout=2_000)
    assert page.locator("#bm-merge-modal").is_hidden(), \
        "merge dialog should not appear for a chapter with no existing bookmark"

    # The pre-filled label should reference John 3:1, not Genesis 1.
    label = page.locator("#bm-label-input").input_value()
    assert "3:1" in label or "3장" in label, \
        f"label should reference john 3, got: {label!r}"

    ctx.close()


def test_select_verses_button_preserves_chapter_after_drawer_close(browser):
    """Regression: drawer's '절 선택' button closes the drawer and enters
    verse-select mode. The drawer-close path now nulls _bookmarkDrawer{Book,Chapter},
    so the click handler must capture coords *before* closing."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()

    _open_chapter_and_wait(page, "gen/1")
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    page.locator("#bm-select-verses-btn").click()

    # Drawer closes, verse-select bar appears, and the bar must reflect gen/1
    # — i.e. readingContext.{bookId,chapter} are not clobbered to null.
    page.wait_for_selector("#bookmark-drawer", state="hidden")
    page.wait_for_selector("#verse-select-bar:not([hidden])")

    state = page.evaluate(
        "() => ({ book: window.readingContext.bookId,"
        "         chapter: window.readingContext.chapter,"
        "         mode: window.readingContext.verseSelectMode })"
    )
    assert state["mode"] is True, "verse-select mode should be active"
    assert state["book"] == "gen" and state["chapter"] == 1, \
        f"current chapter must remain gen/1, got: {state!r}"

    ctx.close()


def test_mobile_header_bookmark_toggle_delete(browser):
    """모바일: 이미 북마크된 장에서 헤더 북마크 아이콘을 누르면 삭제 확인
    모달이 뜨고(저장 모달이 아님), 승인하면 북마크가 제거된다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_chapter_and_wait(page, "gen/1")
        seed = [{
            "type": "bookmark", "id": "bm-toggle",
            "bookId": "gen", "chapter": 1,
            "label": "창세기 1장", "verseSpec": "all",
        }]
        page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(seed)})")

        # Tap header bookmark icon → confirm-delete modal, NOT the save modal.
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])", timeout=2_000)
        assert page.locator("#bm-save-modal").is_hidden(), \
            "save modal must not appear when toggling off an existing bookmark"
        assert '"창세기 1장"' in page.inner_text("#bm-confirm-body")

        page.locator("#bm-confirm-ok").click()
        page.wait_for_selector("#bm-confirm-modal", state="hidden")

        store = page.evaluate("() => window.syncStoreV2.loadBookmarks()")
        assert all(it.get("id") != "bm-toggle" for it in store), \
            f"bookmark should be removed, store still has it: {store!r}"
    finally:
        ctx.close()


def test_mobile_header_bookmark_toggle_delete_cancel_keeps_it(browser):
    """모바일: 삭제 확인 모달에서 취소하면 북마크가 유지된다."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_chapter_and_wait(page, "gen/1")
        seed = [{
            "type": "bookmark", "id": "bm-keep",
            "bookId": "gen", "chapter": 1,
            "label": "창세기 1장", "verseSpec": "all",
        }]
        page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(seed)})")

        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])", timeout=2_000)
        page.locator("#bm-confirm-cancel").click()
        page.wait_for_selector("#bm-confirm-modal", state="hidden")

        store = page.evaluate("() => window.syncStoreV2.loadBookmarks()")
        assert any(it.get("id") == "bm-keep" for it in store), \
            "cancel must keep the bookmark"
    finally:
        ctx.close()


def test_mobile_header_bookmark_when_absent_opens_save_modal(browser):
    """모바일: 북마크가 없는 장에서는 헤더 아이콘이 저장 모달을 연다(토글 add)."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_chapter_and_wait(page, "gen/1")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])", timeout=2_000)
        assert page.locator("#bm-confirm-modal").is_hidden()
    finally:
        ctx.close()
