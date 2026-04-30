"""E2E: bookmark drawer — open from chapter header, save whole chapter, list updates."""

import json

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
    assert expect_title.inner_text() == "책갈피"
    assert "저장된 책갈피가 없습니다" in page.inner_text("#bookmark-drawer-body")

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

    raw = page.evaluate("() => localStorage.getItem('bible-bookmarks')")
    assert raw
    data = json.loads(raw)
    assert isinstance(data, list)
    assert any(
        it.get("type") == "bookmark"
        and it.get("bookId") == "gen"
        and it.get("chapter") == 1
        and it.get("label") == "E2E 창세기 1장"
        for it in data
    )

    ctx.close()
