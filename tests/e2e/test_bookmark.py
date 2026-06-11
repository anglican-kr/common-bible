"""E2E: bookmark drawer — open from chapter header, save whole chapter, list updates."""

import json

from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT, IPHONE_UA

BASE = "http://localhost:8080"

# On the iPhone UA the install nudge auto-opens after ~1.5s; its scrim then
# intercepts header taps and races these tests. Pin neverShow so the nudge
# stays down. CLEAR_APP_STORAGE removes the key, so this must run after it.
SUPPRESS_INSTALL_NUDGE = (
    "localStorage.setItem('bible-install-nudge',"
    " JSON.stringify({visits: 0, nextShow: 9999, neverShow: true}));"
)


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

    role='presentation'을 단 공용 빈 상태(li.empty-state, ADR-032)가
    시각적·기능적으로 올바르게 동작하는지 확인한다.
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
    assert page.locator("li.empty-state").count() == 1
    assert page.locator("li.bm-bookmark").count() == 0

    # Save a bookmark
    page.locator("#bm-save-chapter-btn").click()
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.locator("#bm-save-modal .bm-btn-primary").click()
    page.wait_for_selector("#bm-save-modal", state="hidden")
    page.wait_for_selector("li.bm-bookmark")

    # Empty state gone, bookmark item visible
    assert page.locator("li.empty-state").count() == 0
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


def test_mobile_header_bookmark_when_absent_opens_save_modal(browser):
    """모바일: 북마크가 없는 장에서는 헤더 아이콘이 저장 모달을 연다(토글 add)."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(SUPPRESS_INSTALL_NUDGE)
    page = ctx.new_page()
    try:
        _open_chapter_and_wait(page, "gen/1")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])", timeout=2_000)
        assert page.locator("#bm-confirm-modal").is_hidden()
    finally:
        ctx.close()


def test_drawer_bookmark_link_navigates_and_closes_drawer(browser):
    """드로어에서 북마크 행을 누르면 그 장으로 이동하고 드로어가 닫힌다.

    회귀 가드: tree.js 의 링크 클릭 핸들러가 주입된 closeBookmarkDrawer() + navigate()
    + markBookmarkViewed/_bookmarkHref(core) 를 부르는 모듈 간 경로. 다른 e2e 는 링크의
    *존재*만 확인하고 클릭→내비를 구동하지 않는다.
    """
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_chapter_and_wait(page, "gen/2")
    # Seed a gen/1 whole-chapter bookmark (so the drawer lists it).
    page.evaluate(
        "() => window.syncStoreV2.saveBookmarks(["
        "{type:'bookmark', id:'b1', bookId:'gen', chapter:1, label:'창세기 1장', verseSpec:'all'}"
        "])"
    )
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    page.locator(".bm-bookmark-link", has_text="창세기 1장").click()

    # Navigated to gen/1 and the drawer dismissed (the injected closeBookmarkDrawer).
    page.wait_for_url("**/gen/1")
    assert page.url.rstrip("/").endswith("/gen/1")
    page.wait_for_selector("#bookmark-drawer[hidden]")
    ctx.close()


def test_drawer_tree_keyboard_navigation(browser):
    """드로어 트리: ArrowRight 로 폴더 펼침, ArrowDown 으로 다음 treeitem 포커스 이동.

    tree.js 의 드로어 body keydown 핸들러(roving tabindex)를 검증한다 — 어떤 e2e 도
    트리 키보드 내비를 다루지 않았다. (펼침은 클릭이 아닌 _toggleFolder 직접 호출이라
    headless 포인터 이슈와 무관하다.)
    """
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_chapter_and_wait(page, "gen/1")
    # A collapsed folder (folders sort first) holding one child + a root bookmark.
    page.evaluate(
        "() => window.syncStoreV2.saveBookmarks(["
        "{type:'folder', id:'f1', name:'폴더', expanded:false, children:["
        "  {type:'bookmark', id:'c1', bookId:'exo', chapter:3, label:'자식', verseSpec:'all'}]},"
        "{type:'bookmark', id:'b1', bookId:'gen', chapter:1, label:'뿌리', verseSpec:'all'}"
        "])"
    )
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    folder = page.locator("li.bm-folder[data-id='f1']")
    assert folder.get_attribute("aria-expanded") == "false"

    # Focus the folder treeitem, then ArrowRight expands it.
    folder.evaluate("el => el.focus()")
    page.keyboard.press("ArrowRight")
    assert folder.get_attribute("aria-expanded") == "true"

    # ArrowDown moves the roving focus to the next visible treeitem (the child).
    page.keyboard.press("ArrowDown")
    focused_id = page.evaluate(
        "() => document.activeElement?.closest('[role=treeitem]')?.dataset.id"
    )
    assert focused_id == "c1"
    ctx.close()
