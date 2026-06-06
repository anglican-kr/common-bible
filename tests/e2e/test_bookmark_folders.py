"""E2E: 북마크 폴더 CRUD — 생성, 이름 변경, 삭제, 펼침/접음."""
import json
from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"

_BM_A = {"type": "bookmark", "id": "bm-a", "bookId": "gen", "chapter": 1,
          "label": "창세기 1장", "verseSpec": "all"}

_FOLDER_1 = {"type": "folder", "id": "folder-1", "name": "대림시기",
             "children": [_BM_A], "expanded": False}


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


# ── 생성 ──────────────────────────────────────────────────────────────────────

def test_create_folder_via_button(browser):
    """폴더 추가 버튼 → 이름 입력 → 추가 클릭 → 폴더 생성."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        page.click("#bm-add-folder-btn")
        page.wait_for_selector(".bm-new-folder-input")
        page.fill(".bm-new-folder-input", "새 폴더")
        page.locator(".bm-new-folder-form .bm-toolbar-btn").first.click()
        page.wait_for_timeout(200)

        store = _get_store(page)
        names = [item["name"] for item in store if item["type"] == "folder"]
        assert "새 폴더" in names
    finally:
        ctx.close()


def test_create_folder_via_enter_key(browser):
    """폴더 이름 입력 후 Enter 키로 확정한다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        page.click("#bm-add-folder-btn")
        page.wait_for_selector(".bm-new-folder-input")
        page.fill(".bm-new-folder-input", "Enter폴더")
        page.press(".bm-new-folder-input", "Enter")
        page.wait_for_timeout(200)

        store = _get_store(page)
        names = [item["name"] for item in store if item["type"] == "folder"]
        assert "Enter폴더" in names
    finally:
        ctx.close()


def test_create_folder_empty_name_does_nothing(browser):
    """빈 이름으로 추가하면 폴더가 생성되지 않는다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        page.click("#bm-add-folder-btn")
        page.wait_for_selector(".bm-new-folder-input")
        # leave input empty, press Enter
        page.press(".bm-new-folder-input", "Enter")
        page.wait_for_timeout(200)

        store = _get_store(page)
        assert all(item["type"] != "folder" for item in store)
    finally:
        ctx.close()


# ── 펼침/접음 ──────────────────────────────────────────────────────────────────

def test_folder_toggle_expand_collapse(browser):
    """폴더 row 클릭 → aria-expanded 토글.

    expanded=false, 비활성 자식(_hasActiveDescendant=false)인 폴더는
    접힌 상태로 렌더링된다. Gen 2에서 열어 Gen 1 자식이 비활성 상태가 되도록 한다.
    """
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        # Gen 2에서 열어 _BM_A(gen/1)가 비활성 → expanded=false로 시작
        page.goto(f"{BASE}/gen/2")
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        _set_store(page, [_FOLDER_1])
        page.wait_for_selector("li.bm-folder")

        folder_li = page.locator("li.bm-folder[data-id='folder-1']")
        assert folder_li.get_attribute("aria-expanded") == "false"

        page.locator("li.bm-folder[data-id='folder-1'] .bm-folder-row").click()
        page.wait_for_timeout(100)
        assert folder_li.get_attribute("aria-expanded") == "true"

        page.locator("li.bm-folder[data-id='folder-1'] .bm-folder-row").click()
        page.wait_for_timeout(100)
        assert folder_li.get_attribute("aria-expanded") == "false"
    finally:
        ctx.close()


def test_expanded_folder_shows_children(browser):
    """expanded=true로 저장된 폴더는 자식 북마크를 펼쳐서 표시한다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        # Gen 2에서 열어 _hasActiveDescendant=false, expanded=true만으로 펼쳐짐 확인
        page.goto(f"{BASE}/gen/2")
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        expanded = {**_FOLDER_1, "expanded": True}
        _set_store(page, [expanded])
        page.wait_for_selector("li.bm-bookmark[data-id='bm-a']")
    finally:
        ctx.close()


def test_folder_expanded_state_persists(browser):
    """사용자가 수동으로 펼친 폴더는 expanded=true가 저장되어 다음 렌더링에서도 유지된다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        # Gen 2에서 열어 _hasActiveDescendant 영향 없음
        page.goto(f"{BASE}/gen/2")
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        _set_store(page, [_FOLDER_1])
        page.wait_for_selector("li.bm-folder")

        # 초기 접힘 상태 확인
        assert page.locator("li.bm-folder[data-id='folder-1']").get_attribute("aria-expanded") == "false"

        # 클릭으로 펼침
        page.locator("li.bm-folder[data-id='folder-1'] .bm-folder-row").click()
        page.wait_for_timeout(200)
        assert page.locator("li.bm-folder[data-id='folder-1']").get_attribute("aria-expanded") == "true"

        # 재렌더링 후에도 펼침 상태 유지 (expanded=true가 store에 저장되어야 함)
        page.evaluate("() => renderBookmarkTree()")
        page.wait_for_timeout(200)
        assert page.locator("li.bm-folder[data-id='folder-1']").get_attribute("aria-expanded") == "true"
    finally:
        ctx.close()


# ── 이름 변경 ─────────────────────────────────────────────────────────────────

def test_folder_rename_via_prompt(browser):
    """폴더 수정 버튼 클릭 → window.prompt에 새 이름 입력 → 이름 변경."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    page.on("dialog", lambda d: d.accept("변경된 이름"))
    try:
        _open_drawer(page)
        _set_store(page, [_FOLDER_1])
        page.wait_for_selector("li.bm-folder")

        page.locator("li.bm-folder[data-id='folder-1'] .bm-action-btn").first.click()
        page.wait_for_timeout(300)

        store = _get_store(page)
        names = [item["name"] for item in store if item["type"] == "folder"]
        assert "변경된 이름" in names
    finally:
        ctx.close()


# ── 삭제 ──────────────────────────────────────────────────────────────────────

def test_folder_delete(browser):
    """폴더 삭제 버튼 클릭 → 확인 모달 승인 → 폴더와 자식 모두 제거."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _set_store(page, [_FOLDER_1])
        page.wait_for_selector("li.bm-folder")

        page.locator("li.bm-folder[data-id='folder-1'] .bm-item-actions .bm-delete-btn").first.click()
        page.wait_for_selector("#bm-confirm-modal:not([hidden])", timeout=2_000)
        page.locator("#bm-confirm-ok").click()
        page.wait_for_timeout(300)

        store = _get_store(page)
        assert all(item["id"] != "folder-1" for item in store)
    finally:
        ctx.close()
