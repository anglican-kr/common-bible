"""E2E: 저장 공간이 차서 북마크 저장이 거절될 때 (known-issues §15.4).

저장이 거절되면 스낵바로 알리고, 글을 적은 대화상자와 입력 칸은 닫지 않는다(사용자 결정 2026-10-26).
북마크 목록은 동기화 저장소에 먼저 쓴다. 브라우저가 그 쓰기를 거절하면 옛 키에는 쓰지 않아,
두 사본 모두 거절 전 그대로 남는다(ADR-015 D7).

저장 공간이 찬 상태는 `conftest.py`의 `FULL_STORAGE`로 흉내 낸다.
"""
import json

from playwright.sync_api import expect

from .conftest import FULL_STORAGE, MOBILE_VIEWPORT, IPHONE_UA, fill_storage

BASE = "http://localhost:8080"

FULL_MSG = "저장 공간이 가득 차 바꾼 내용을 저장하지 못했습니다. 쓰지 않는 북마크를 지운 뒤 다시 시도해 주세요."
LEGACY_KEY = "bible-bookmarks"
SYNC_KEY = "bible-bookmarks-v2"

# Clears the app's keys once per tab (sessionStorage guard), so a reload keeps what was saved.
_CLEAR_ONCE = """
(() => {
  if (sessionStorage.getItem('__e2eCleared')) return;
  sessionStorage.setItem('__e2eCleared', '1');
  for (const k of ['bible-bookmarks', 'bible-bookmarks-v2', 'bible-sync-meta', 'bible-bookmark-viewed']) localStorage.removeItem(k);
  localStorage.setItem('bible-install-nudge', JSON.stringify({ visits: 0, nextShow: 9999, neverShow: true }));
})();
"""

_BM_A = {"type": "bookmark", "id": "bm-a", "bookId": "gen", "chapter": 1,
         "label": "창세기 1장", "verseSpec": "all"}
_BM_B = {"type": "bookmark", "id": "bm-b", "bookId": "john", "chapter": 3,
         "label": "요한 3장", "verseSpec": "all"}
_FOLDER = {"type": "folder", "id": "folder-1", "name": "대림시기",
           "children": [_BM_A], "expanded": True}
_EMPTY_FOLDER = {"type": "folder", "id": "folder-2", "name": "성탄시기",
                 "children": [], "expanded": False}


def _context(browser, **opts):
    ctx = browser.new_context(**opts)
    ctx.add_init_script(_CLEAR_ONCE)
    ctx.add_init_script(FULL_STORAGE)
    return ctx


def _mobile(browser):
    return _context(browser, viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)


def _open_drawer(page, path="gen/1"):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector("article.chapter-text .verse")
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")


def _open_bookmarks_view(page):
    page.goto(f"{BASE}/bookmarks")
    page.wait_for_selector("#bookmarks-view-tree", timeout=5_000)


def _set_store(page, store):
    """Both copies, as the app keeps them."""
    page.evaluate(f"() => window.appStorage.saveBookmarks({json.dumps(store)})")
    page.evaluate("() => window.rerenderActiveBookmarkTree()")


def _stored_ids(page):
    return [n["id"] for n in page.evaluate("window.syncStoreV2.loadBookmarks()")]


def _count_announcements(page):
    """From now on, keep every message sent to the live region (bookmark modules call the global `announce`)."""
    page.evaluate("""() => {
      window.__announced = [];
      const announce = window.announce;
      window.announce = (msg) => { window.__announced.push(msg); announce(msg); };
    }""")


def _announced(page):
    return page.evaluate("window.__announced")


def _snackbar(page, msg=FULL_MSG):
    return page.locator("body > div:not(#a11y-announce)", has_text=msg)


def _ids(nodes):
    return [n["id"] for n in nodes]


def _open_save_modal(page, label, note):
    page.locator("#bm-save-chapter-btn").click()
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.locator("#bm-label-input").fill(label)
    page.locator("#bm-note-input").fill(note)


def _enter_select_mode(page, bookmark_id):
    page.locator(".title-action-btn[aria-label='더 보기']").click()
    page.wait_for_selector(".title-action-menu:not([hidden])")
    page.get_by_role("menuitem", name="선택", exact=True).click()
    page.wait_for_selector("#bm-select-bar:not([hidden])")
    page.locator(f"li.bm-bookmark[data-id='{bookmark_id}'] .bm-bookmark-row").click()


# ── 저장 대화상자 ──────────────────────────────────────────────────────────────

def test_refused_save_says_so_and_keeps_the_dialog_with_what_was_typed(browser):
    """저장 공간이 차 새 북마크가 저장되지 않으면 스낵바가 뜨고, 대화상자는 적은 글과 함께 남는다."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        fill_storage(page, [LEGACY_KEY, SYNC_KEY], grow_only=True)
        _open_save_modal(page, "저장 공간 찬 뒤", "길게 적은 메모")
        _count_announcements(page)
        page.locator("#bm-save-modal .bm-btn-primary").click()

        _snackbar(page).wait_for(state="visible")
        expect(page.locator("#a11y-announce")).to_have_text(FULL_MSG)
        assert _announced(page) == [FULL_MSG], "the failure is read once, and no success line"
        assert page.locator("#bm-save-modal").is_visible()
        assert page.locator("#bm-label-input").input_value() == "저장 공간 찬 뒤"
        assert page.locator("#bm-note-input").input_value() == "길게 적은 메모"
        assert page.evaluate(f"localStorage.getItem('{LEGACY_KEY}')") is None
        assert _stored_ids(page) == []

        page.locator("#bm-save-modal .bm-btn-secondary").click()
        page.locator("#bm-save-modal").wait_for(state="hidden")
        assert page.locator(".bm-bookmark-link").count() == 0
    finally:
        ctx.close()


def test_refused_sync_store_write_leaves_the_legacy_copy_as_it_was(browser):
    """브라우저가 동기화 저장소 쓰기만 거절해도 옛 키에는 쓰지 않는다. 다시 열어도 두 사본이 같다."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _set_store(page, [_BM_B])
        fill_storage(page, [SYNC_KEY])
        _open_save_modal(page, "새 북마크", "")
        page.locator("#bm-save-modal .bm-btn-primary").click()
        _snackbar(page).wait_for(state="visible")

        legacy = json.loads(page.evaluate(f"localStorage.getItem('{LEGACY_KEY}')"))
        assert _ids(legacy) == ["bm-b"]
        page.reload()
        page.wait_for_selector("article.chapter-text .verse")
        assert _ids(page.evaluate("window.appStorage.loadBookmarks()")) == ["bm-b"]
    finally:
        ctx.close()


def test_refused_legacy_key_write_alone_still_saves(browser):
    """브라우저가 옛 키 쓰기만 거절하면 저장된 것이다. 목록은 동기화 저장소를 읽으므로 안내도 없다."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        fill_storage(page, [LEGACY_KEY])
        _open_save_modal(page, "옛 키만 거절", "")
        page.locator("#bm-save-modal .bm-btn-primary").click()
        page.locator("#bm-save-modal").wait_for(state="hidden")

        assert page.locator(".bm-bookmark-link", has_text="옛 키만 거절").count() == 1
        assert _snackbar(page).count() == 0
        expect(page.locator("#a11y-announce")).to_have_text("북마크를 저장했습니다.")
    finally:
        ctx.close()


# ── 새 폴더 (대화상자와 드로어의 입력 칸) ─────────────────────────────────────

def test_refused_new_folder_keeps_the_dialog_with_the_name(browser):
    """새 폴더 대화상자는 저장이 거절되면 적은 이름과 함께 남는다."""
    ctx = _mobile(browser)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_B])
        fill_storage(page, [LEGACY_KEY, SYNC_KEY], grow_only=True)
        page.locator(".title-action-btn[aria-label='더 보기']").click()
        page.get_by_role("menuitem", name="새 폴더", exact=True).click()
        page.wait_for_selector("#bm-new-folder-modal:not([hidden])")
        page.locator("#bm-new-folder-input").fill("대림시기")
        page.locator("#bm-new-folder-confirm").click()

        _snackbar(page).wait_for(state="visible")
        assert page.locator("#bm-new-folder-modal").is_visible()
        assert page.locator("#bm-new-folder-input").input_value() == "대림시기"
        assert _stored_ids(page) == ["bm-b"]
    finally:
        ctx.close()


def test_refused_inline_new_folder_keeps_the_form_with_the_name(browser):
    """드로어의 새 폴더 입력 칸도 저장이 거절되면 적은 이름과 함께 남는다."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        fill_storage(page, [LEGACY_KEY, SYNC_KEY], grow_only=True)
        page.locator("#bm-add-folder-btn").click()
        page.locator(".bm-new-folder-form input").fill("대림시기")
        page.locator(".bm-new-folder-form input").press("Enter")

        _snackbar(page).wait_for(state="visible")
        assert page.locator(".bm-new-folder-form input").input_value() == "대림시기"
        assert _stored_ids(page) == []
    finally:
        ctx.close()


# ── 끌어서 옮기기, 폴더 접기 ──────────────────────────────────────────────────

def test_refused_move_says_so_and_redraws_the_stored_order(browser):
    """끌어서 옮기기가 거절되면 스낵바가 뜨고, 목록은 저장된 순서로 다시 그려진다."""
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _set_store(page, [_BM_A, _BM_B])
        fill_storage(page, [LEGACY_KEY, SYNC_KEY])
        page.evaluate("document.querySelector(\"#bookmark-drawer-body li.bm-bookmark[data-id='bm-a']\").dataset.e2eBefore = '1'")
        page.evaluate("() => moveBookmarkItem('bm-b', 'bm-a', 'before')")

        _snackbar(page).wait_for(state="visible")
        assert _stored_ids(page) == ["bm-a", "bm-b"]
        rows = page.locator("#bookmark-drawer-body li.bm-bookmark")
        assert [rows.nth(i).get_attribute("data-id") for i in range(rows.count())] == ["bm-a", "bm-b"]
        assert page.locator("#bookmark-drawer-body li[data-e2e-before]").count() == 0, "the list was drawn again"
    finally:
        ctx.close()


def test_refused_fold_keeps_the_folder_as_clicked_and_says_so(browser):
    """저장 공간이 차면 폴더 접기가 거절된다(접힘 값이 한 글자 길다). 화면은 누른 대로 두고 알린다.

    다시 열면 저장된 대로 펼쳐져 있다.
    """
    ctx = _context(browser)
    page = ctx.new_page()
    try:
        _open_drawer(page, "gen/2")   # gen/1 is not the open chapter, so only the stored state opens the folder
        _set_store(page, [_FOLDER])
        folder = page.locator("li.bm-folder[data-id='folder-1']")
        assert folder.get_attribute("aria-expanded") == "true"
        fill_storage(page, [LEGACY_KEY, SYNC_KEY], grow_only=True)
        page.locator("li.bm-folder[data-id='folder-1'] .bm-folder-name").click()

        _snackbar(page).wait_for(state="visible")
        assert folder.get_attribute("aria-expanded") == "false"

        page.reload()
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        assert page.locator("li.bm-folder[data-id='folder-1']").get_attribute("aria-expanded") == "true"
    finally:
        ctx.close()


# ── 골라서 지우기와 옮기기 (선택 모드, 휴대폰 화면) ──────────────────────────────

def _delete_selected(page):
    page.locator("#bm-select-delete-btn").click()
    page.wait_for_selector("#bm-confirm-modal:not([hidden])")
    page.locator("#bm-confirm-ok").click()


def test_delete_still_saves_when_storage_is_full(browser):
    """안내의 「쓰지 않는 북마크를 지운 뒤」: 저장 공간이 차도 지우기는 목록을 줄이므로 저장된다."""
    ctx = _mobile(browser)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_A, _BM_B])
        fill_storage(page, [LEGACY_KEY, SYNC_KEY], grow_only=True)
        _enter_select_mode(page, "bm-a")
        _delete_selected(page)
        page.wait_for_selector("#bm-select-bar", state="hidden")

        assert _stored_ids(page) == ["bm-b"]
        assert _ids(json.loads(page.evaluate(f"localStorage.getItem('{LEGACY_KEY}')"))) == ["bm-b"]
        assert _snackbar(page).count() == 0
    finally:
        ctx.close()


def test_refused_delete_says_so_and_keeps_the_selection(browser):
    """지우기마저 거절되면 알리고, 선택 모드와 고른 항목을 그대로 두어 다시 해 볼 수 있다."""
    ctx = _mobile(browser)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_BM_A, _BM_B])
        fill_storage(page, [LEGACY_KEY, SYNC_KEY])
        _enter_select_mode(page, "bm-a")
        _delete_selected(page)

        _snackbar(page).wait_for(state="visible")
        assert page.locator("#bm-select-bar").is_visible()
        assert page.locator("li.bm-bookmark[data-id='bm-a'] .bm-select-circle.is-selected").count() == 1
        assert _stored_ids(page) == ["bm-a", "bm-b"]
    finally:
        ctx.close()


def test_refused_move_to_folder_says_so_and_keeps_the_selection(browser):
    """골라서 옮기기가 거절되면 알리고, 선택 모드와 고른 항목을 그대로 둔다."""
    ctx = _mobile(browser)
    page = ctx.new_page()
    try:
        _open_bookmarks_view(page)
        _set_store(page, [_EMPTY_FOLDER, _BM_B])
        fill_storage(page, [LEGACY_KEY, SYNC_KEY])
        _enter_select_mode(page, "bm-b")
        page.locator("#bm-select-move-btn").click()
        page.wait_for_selector("#bm-move-modal:not([hidden])")
        page.locator("#bm-move-list .bm-move-item", has_text="성탄시기").click()

        _snackbar(page).wait_for(state="visible")
        assert page.locator("#bm-select-bar").is_visible()
        assert page.locator("li.bm-bookmark[data-id='bm-b'] .bm-select-circle.is-selected").count() == 1
        assert _stored_ids(page) == ["folder-2", "bm-b"]
        assert page.evaluate("window.syncStoreV2.loadBookmarks()")[0]["children"] == []
    finally:
        ctx.close()
