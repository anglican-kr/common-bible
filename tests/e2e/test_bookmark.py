"""E2E: bookmark drawer — open from chapter header, save whole chapter, list updates."""

import json

from .conftest import CLEAR_APP_STORAGE

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

    # 2) Open drawer at gen/1, then close it. This used to leave
    #    _bookmarkDrawerBook='gen', _bookmarkDrawerChapter=1 hanging.
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
