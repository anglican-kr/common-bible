"""E2E: Phase 2a — 북마크 내보내기/가져오기."""

import json
from datetime import date

import pytest

BASE = "http://localhost:8080"

# ── 내보내기 인터셉트 헬퍼 ────────────────────────────────────────────────────
#
# exportBookmarks()는 Blob → blob URL → <a download> → a.click() 흐름으로
# 다운로드를 트리거한다.  headless Chromium에서는 blob URL 다운로드 이벤트가
# 신뢰할 수 없으므로, Blob 생성자와 anchor 클릭을 동기로 가로채
# JSON 문자열을 직접 캡처한다.
_INTERCEPT_EXPORT_JS = """() => {
    const OrigBlob = window.Blob;
    const origAppend = document.body.appendChild.bind(document.body);
    const origRevoke = URL.revokeObjectURL.bind(URL);

    let capturedJson = null;
    let capturedFilename = null;

    // Blob 생성자 가로채기 — application/json 페이로드만 캡처
    window.Blob = function(parts, options) {
        if (options && options.type === 'application/json' && parts.length === 1) {
            capturedJson = parts[0];
        }
        return new OrigBlob(parts, options);
    };

    // <a download> 클릭 억제 및 파일명 캡처
    document.body.appendChild = (node) => {
        if (node && node.tagName === 'A' && node.download) {
            capturedFilename = node.download;
            node.click = () => {};
        }
        return origAppend(node);
    };

    // blob URL 조기 해제 방지
    URL.revokeObjectURL = () => {};

    exportBookmarks();

    window.Blob = OrigBlob;
    document.body.appendChild = origAppend;
    URL.revokeObjectURL = origRevoke;

    return {
        filename: capturedFilename,
        data: capturedJson ? JSON.parse(capturedJson) : null
    };
}"""


def _intercept_export(page) -> dict:
    """exportBookmarks() 를 호출하고 파일명·JSON 페이로드를 가로채 반환한다."""
    return page.evaluate(_INTERCEPT_EXPORT_JS)


# ── 테스트용 픽스처 데이터 ──────────────────────────────────────────────────

_BM_A = {"type": "bookmark", "id": "bm-a", "bookId": "gen", "chapter": 1, "label": "창세기 1장"}
_BM_B = {"type": "bookmark", "id": "bm-b", "bookId": "john", "chapter": 3, "label": "요한 3장"}
_BM_C = {"type": "bookmark", "id": "bm-c", "bookId": "ps", "chapter": 23, "label": "시편 23편"}

_FOLDER_WITH_CHILD = {
    "type": "folder",
    "id": "folder-1",
    "name": "대림시기",
    "children": [_BM_C],
    "expanded": False,
}

_VALID_EXPORT = {
    "_version": 1,
    "exportedAt": 1_700_000_000_000,
    "bookmarks": [_BM_A, _BM_B],
}


def _set_bookmarks(page, store: list) -> None:
    page.evaluate(
        f"() => localStorage.setItem('bible-bookmarks', JSON.stringify({json.dumps(store)}))"
    )


def _get_bookmarks(page) -> list:
    raw = page.evaluate("() => localStorage.getItem('bible-bookmarks')")
    return json.loads(raw) if raw else []


def _open_bookmark_drawer(page) -> None:
    page.goto(f"{BASE}/gen/1")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(200)
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")


# ── 내보내기 ─────────────────────────────────────────────────────────────────


def test_export_button_visible_in_toolbar(browser):
    """내보내기 버튼이 툴바에 렌더링돼 있어야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    btn = page.locator("#bm-export-btn")
    assert btn.count() == 1
    assert btn.get_attribute("aria-label") == "내보내기"

    ctx.close()


def test_export_triggers_download_with_correct_filename(browser):
    """내보내기 시 오늘 날짜 파일명이 지정돼야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A])

    result = _intercept_export(page)

    today = date.today().isoformat()
    assert result["filename"] == f"bible-bookmarks-{today}.json"

    ctx.close()


def test_export_json_contains_version_and_bookmarks(browser):
    """내보낸 JSON 페이로드에 _version=1 과 bookmarks 배열이 포함돼야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A, _BM_B])

    result = _intercept_export(page)
    data = result["data"]

    assert data["_version"] == 1
    assert isinstance(data["exportedAt"], int)
    assert isinstance(data["bookmarks"], list)
    ids = {bm["id"] for bm in data["bookmarks"]}
    assert "bm-a" in ids
    assert "bm-b" in ids

    ctx.close()


def test_export_empty_store_produces_empty_array(browser):
    """북마크가 없을 때 내보내면 bookmarks가 빈 배열이어야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)

    result = _intercept_export(page)

    assert result["data"]["bookmarks"] == []

    ctx.close()


def test_export_announces_success(browser):
    """내보내기 후 접근성 알림(announce)이 표시돼야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A])

    _intercept_export(page)

    page.wait_for_function(
        "() => document.getElementById('a11y-announce')?.textContent.includes('내보냈습니다')"
    )

    ctx.close()


# ── 가져오기 버튼 / 파일 선택 ────────────────────────────────────────────────


def test_import_button_visible_in_toolbar(browser):
    """가져오기 버튼이 툴바에 렌더링돼 있어야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    btn = page.locator("#bm-import-btn")
    assert btn.count() == 1
    assert btn.get_attribute("aria-label") == "가져오기"

    ctx.close()


def test_import_invalid_json_shows_error(browser, tmp_path):
    """잘못된 JSON 파일을 업로드하면 오류 메시지가 표시돼야 한다."""
    bad_file = tmp_path / "bad.json"
    bad_file.write_text("NOT JSON", encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(bad_file))

    page.wait_for_function(
        "() => document.getElementById('a11y-announce')?.textContent.includes('읽을 수 없습니다')"
    )
    assert page.locator("#bm-import-modal").get_attribute("hidden") is not None

    ctx.close()


def test_import_missing_bookmarks_field_shows_error(browser, tmp_path):
    """bookmarks 필드가 없는 JSON은 형식 오류를 표시해야 한다."""
    bad_data = tmp_path / "no_bm.json"
    bad_data.write_text(json.dumps({"_version": 1, "exportedAt": 0}), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(bad_data))

    page.wait_for_function(
        "() => document.getElementById('a11y-announce')?.textContent.includes('형식이 올바르지 않습니다')"
    )
    assert page.locator("#bm-import-modal").get_attribute("hidden") is not None

    ctx.close()


def test_import_valid_file_opens_modal(browser, tmp_path):
    """유효한 파일 업로드 시 가져오기 확인 모달이 열려야 한다."""
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(_VALID_EXPORT), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")

    assert "2개" in page.inner_text("#bm-import-body")

    ctx.close()


# ── 가져오기 확인 모달 ────────────────────────────────────────────────────────


def test_import_modal_cancel_closes_without_changes(browser, tmp_path):
    """취소 버튼 클릭 시 모달이 닫히고 기존 북마크가 유지돼야 한다."""
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(_VALID_EXPORT), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_C])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-cancel").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")

    store = _get_bookmarks(page)
    assert len(store) == 1
    assert store[0]["id"] == "bm-c"

    ctx.close()


def test_import_overwrite_replaces_existing_bookmarks(browser, tmp_path):
    """덮어쓰기 선택 시 기존 북마크가 가져온 데이터로 교체돼야 한다."""
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(_VALID_EXPORT), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_C])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")

    store = _get_bookmarks(page)
    ids = {bm["id"] for bm in store}
    assert ids == {"bm-a", "bm-b"}
    assert "bm-c" not in ids

    ctx.close()


def test_import_overwrite_announces_success(browser, tmp_path):
    """덮어쓰기 후 접근성 알림이 표시돼야 한다."""
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(_VALID_EXPORT), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-overwrite").click()

    page.wait_for_function(
        "() => document.getElementById('a11y-announce')?.textContent.includes('덮어썼습니다')"
    )

    ctx.close()


def test_import_merge_adds_new_keeps_existing(browser, tmp_path):
    """병합 시 기존 북마크는 유지되고 새 항목만 추가돼야 한다."""
    incoming = {
        "_version": 1,
        "exportedAt": 0,
        "bookmarks": [_BM_A, _BM_C],  # bm-a: 새 항목, bm-c: 기존과 동일 ID
    }
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    existing_bm_c = {**_BM_C, "label": "기존 시편 23편"}

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [existing_bm_c])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-merge").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")

    store = _get_bookmarks(page)
    ids = {bm["id"] for bm in store}
    assert "bm-a" in ids
    assert "bm-c" in ids

    # 기존 항목의 label이 유지돼야 한다
    bm_c = next(bm for bm in store if bm["id"] == "bm-c")
    assert bm_c["label"] == "기존 시편 23편"

    ctx.close()


def test_import_merge_announces_success(browser, tmp_path):
    """병합 후 접근성 알림이 표시돼야 한다."""
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(_VALID_EXPORT), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-merge").click()

    page.wait_for_function(
        "() => document.getElementById('a11y-announce')?.textContent.includes('병합했습니다')"
    )

    ctx.close()


def test_import_modal_renders_bookmark_count(browser, tmp_path):
    """모달 본문에 가져올 북마크 개수가 표시돼야 한다."""
    incoming = {**_VALID_EXPORT, "bookmarks": [_BM_A, _BM_B, _BM_C]}
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")

    body_text = page.inner_text("#bm-import-body")
    assert "3개" in body_text

    ctx.close()


def test_import_scrim_click_closes_modal(browser, tmp_path):
    """스크림 클릭 시 모달이 닫혀야 한다."""
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(_VALID_EXPORT), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    # 스크림 요소의 모달 밖 영역(좌상단 모서리)을 직접 클릭
    page.locator("#bm-import-scrim").click(position={"x": 5, "y": 5})
    page.wait_for_selector("#bm-import-modal", state="hidden")
    assert page.locator("#bm-import-scrim").get_attribute("hidden") is not None

    ctx.close()


# ── 폴더 포함 병합 ────────────────────────────────────────────────────────────


def test_import_merge_does_not_duplicate_folder_by_id(browser, tmp_path):
    """이미 존재하는 폴더 ID는 병합 시 중복 추가되지 않아야 한다."""
    existing_folder = {**_FOLDER_WITH_CHILD, "name": "기존 폴더명"}
    incoming = {
        "_version": 1,
        "exportedAt": 0,
        "bookmarks": [{**_FOLDER_WITH_CHILD, "name": "새 폴더명"}],
    }
    import_file = tmp_path / "folder.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [existing_folder])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-merge").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")

    store = _get_bookmarks(page)
    folders = [item for item in store if item["type"] == "folder" and item["id"] == "folder-1"]
    assert len(folders) == 1
    assert folders[0]["name"] == "기존 폴더명"

    ctx.close()


def test_import_merge_adds_new_folder(browser, tmp_path):
    """기존에 없는 폴더는 병합 시 추가돼야 한다."""
    new_folder = {
        "type": "folder",
        "id": "folder-new",
        "name": "새 폴더",
        "children": [_BM_B],
        "expanded": False,
    }
    incoming = {"_version": 1, "exportedAt": 0, "bookmarks": [new_folder]}
    import_file = tmp_path / "new_folder.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-merge").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")

    store = _get_bookmarks(page)
    ids = {item["id"] for item in store}
    assert "folder-new" in ids
    assert "bm-a" in ids

    ctx.close()


# ── 내보내기 후 가져오기 (왕복) ───────────────────────────────────────────────


# ── 오버플로 패널 토글 ────────────────────────────────────────────────────────


def test_overflow_panel_hidden_by_default(browser):
    """드로어를 열면 내보내기/가져오기 버튼이 포함된 패널이 기본적으로 숨겨져야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    assert page.locator("#bm-overflow-panel").get_attribute("hidden") is not None
    ctx.close()


def test_overflow_button_shows_panel(browser):
    """⋯ 버튼 클릭 시 오버플로 패널이 노출돼야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    page.locator("#bm-overflow-btn").click()
    page.wait_for_selector("#bm-overflow-panel:not([hidden])")

    assert page.locator("#bm-export-btn").is_visible()
    assert page.locator("#bm-import-btn").is_visible()
    assert page.locator("#bm-overflow-btn").get_attribute("aria-expanded") == "true"
    ctx.close()


def test_overflow_button_toggles_panel_closed(browser):
    """⋯ 버튼을 두 번 클릭하면 패널이 다시 닫혀야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    page.locator("#bm-overflow-btn").click()
    page.wait_for_selector("#bm-overflow-panel:not([hidden])")
    page.locator("#bm-overflow-btn").click()
    page.wait_for_selector("#bm-overflow-panel", state="hidden")

    assert page.locator("#bm-overflow-btn").get_attribute("aria-expanded") == "false"
    ctx.close()


def test_overflow_panel_closes_when_drawer_closes(browser):
    """드로어를 닫으면 오버플로 패널도 닫혀야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    page.locator("#bm-overflow-btn").click()
    page.wait_for_selector("#bm-overflow-panel:not([hidden])")

    page.locator("#bookmark-drawer-close").click()
    page.wait_for_selector("#bookmark-drawer", state="hidden")

    # 드로어가 다시 열릴 때 패널이 닫혀 있어야 한다
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    assert page.locator("#bm-overflow-panel").get_attribute("hidden") is not None
    ctx.close()


# ── Escape 키 ─────────────────────────────────────────────────────────────────


def test_escape_closes_import_modal(browser, tmp_path):
    """가져오기 모달이 열린 상태에서 Escape 키를 누르면 모달이 닫혀야 한다."""
    import_file = tmp_path / "export.json"
    import_file.write_text(json.dumps(_VALID_EXPORT), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.keyboard.press("Escape")
    page.wait_for_selector("#bm-import-modal", state="hidden")

    # 취소만 했으므로 기존 북마크 변경 없어야 한다
    assert _get_bookmarks(page) == []
    ctx.close()


# ── 내보내기 후 가져오기 (왕복) ───────────────────────────────────────────────


def test_export_then_import_roundtrip(browser, tmp_path):
    """내보낸 파일을 덮어쓰기로 가져오면 동일한 북마크가 복원돼야 한다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A, _BM_B])

    result = _intercept_export(page)
    export_path = tmp_path / "roundtrip.json"
    export_path.write_text(json.dumps(result["data"]), encoding="utf-8")

    page.evaluate("localStorage.removeItem('bible-bookmarks')")
    page.reload()
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(200)
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    page.locator("#bm-import-input").set_input_files(str(export_path))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")

    store = _get_bookmarks(page)
    ids = {bm["id"] for bm in store}
    assert ids == {"bm-a", "bm-b"}

    ctx.close()
