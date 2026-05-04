"""E2E: 북마크 항목 편집 — 레이블 변경, 메모, 빈 레이블 거부."""
import json
from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"

_BM_A = {"type": "bookmark", "id": "bm-a", "bookId": "gen", "chapter": 1,
          "label": "창세기 1장", "verseSpec": "all"}


def _open_drawer(page):
    page.goto(f"{BASE}/gen/1")
    page.wait_for_selector("article.chapter-text .verse")
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps([_BM_A])})")
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    page.wait_for_selector("li.bm-bookmark")


def _open_edit_modal(page, bm_id="bm-a"):
    """수정 모달을 열고 모달이 보일 때까지 대기한다."""
    page.locator(f"li.bm-bookmark[data-id='{bm_id}'] .bm-edit-btn").click()
    page.wait_for_selector("#bm-save-modal:not([hidden])")


def _get_store(page):
    return page.evaluate("() => window.syncStoreV2.loadBookmarks()")


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_edit_bookmark_label(browser):
    """수정 버튼 → 레이블 변경 → 저장 → syncStoreV2에 반영된다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _open_edit_modal(page)

        page.fill("#bm-label-input", "수정된 제목")
        page.locator("#bm-save-modal .bm-btn-primary").click()
        page.wait_for_selector("#bm-save-modal", state="hidden")
        page.wait_for_timeout(200)

        store = _get_store(page)
        bm = next((b for b in store if b["id"] == "bm-a"), None)
        assert bm is not None
        assert bm["label"] == "수정된 제목", f"Label not updated: {bm['label']}"
    finally:
        ctx.close()


def test_edit_bookmark_empty_label_rejected(browser):
    """레이블을 비우고 저장하면 모달이 닫히지 않고 aria-invalid 피드백이 설정된다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _open_edit_modal(page)

        page.fill("#bm-label-input", "")
        page.locator("#bm-save-modal .bm-btn-primary").click()
        page.wait_for_timeout(200)

        # Modal stays open
        assert not page.locator("#bm-save-modal").is_hidden(), \
            "Modal should stay open when label is empty"
        # Input marked invalid
        assert page.get_attribute("#bm-label-input", "aria-invalid") == "true", \
            "aria-invalid should be set on empty label input"
        # Original bookmark unchanged
        store = _get_store(page)
        bm = next((b for b in store if b["id"] == "bm-a"), None)
        assert bm["label"] == "창세기 1장"
    finally:
        ctx.close()


def test_edit_bookmark_add_note(browser):
    """메모 필드에 내용을 입력하고 저장하면 note가 저장된다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _open_edit_modal(page)

        page.fill("#bm-note-input", "이것은 테스트 메모입니다.")
        page.locator("#bm-save-modal .bm-btn-primary").click()
        page.wait_for_selector("#bm-save-modal", state="hidden")
        page.wait_for_timeout(200)

        store = _get_store(page)
        bm = next((b for b in store if b["id"] == "bm-a"), None)
        assert bm is not None
        assert bm.get("note") == "이것은 테스트 메모입니다.", \
            f"Note not saved: {bm.get('note')}"
    finally:
        ctx.close()


def test_edit_bookmark_cancel_discards_changes(browser):
    """취소 버튼을 누르면 변경 내용이 저장되지 않는다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_drawer(page)
        _open_edit_modal(page)

        page.fill("#bm-label-input", "취소될 제목")
        page.locator("#bm-save-modal .bm-btn-cancel, #bm-save-modal button:not(.bm-btn-primary)").first.click()
        page.wait_for_timeout(200)

        store = _get_store(page)
        bm = next((b for b in store if b["id"] == "bm-a"), None)
        assert bm is not None
        assert bm["label"] == "창세기 1장", \
            f"Label should be unchanged, got: {bm['label']}"
    finally:
        ctx.close()
