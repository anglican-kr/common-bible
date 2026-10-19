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
#
# ADR-018 모듈 분할 이후 exportBookmarks 는 전역 함수가 아니라
# #bm-export-btn 클릭 핸들러로만 노출된다. 인터셉트 훅은 그대로 두고
# 트리거만 버튼 클릭으로 바꿔 동일한 효과를 얻는다.
_INSTALL_EXPORT_INTERCEPT_JS = """() => {
    window.__bmExportCaptured = { filename: null, data: null };
    const OrigBlob = window.Blob;
    const origAppend = document.body.appendChild.bind(document.body);
    const origRevoke = URL.revokeObjectURL.bind(URL);

    window.Blob = function(parts, options) {
        if (options && options.type === 'application/json' && parts.length === 1) {
            window.__bmExportCaptured.data = JSON.parse(parts[0]);
        }
        return new OrigBlob(parts, options);
    };

    document.body.appendChild = (node) => {
        if (node && node.tagName === 'A' && node.download) {
            window.__bmExportCaptured.filename = node.download;
            node.click = () => {};
        }
        return origAppend(node);
    };

    URL.revokeObjectURL = () => {};
}"""


def _intercept_export(page) -> dict:
    """#bm-export-btn 을 클릭해 exportBookmarks 핸들러를 트리거하고,
    Blob 생성자와 anchor.appendChild 를 가로채 JSON 페이로드/파일명을 반환한다.
    내보내기 버튼은 오버플로 패널 안에 숨겨져 있으므로 먼저 ⋯ 버튼을 연다."""
    page.evaluate(_INSTALL_EXPORT_INTERCEPT_JS)
    page.locator("#bm-overflow-btn").click()
    page.wait_for_selector("#bm-overflow-panel:not([hidden])")
    page.locator("#bm-export-btn").click()
    return page.evaluate("() => window.__bmExportCaptured")


# ── 테스트용 픽스처 데이터 ──────────────────────────────────────────────────

# 앱이 내보내는 모양 그대로 — `verseSpec`이 없는 북마크는 가져오기가 뺀다(트리 링크가 `/gen/1/undefined`가
# 되던 경우 — 2026-10-18, known-issues §14).
_BM_A = {"type": "bookmark", "id": "bm-a", "bookId": "gen", "chapter": 1, "verseSpec": "all", "label": "창세기 1장"}
_BM_B = {"type": "bookmark", "id": "bm-b", "bookId": "john", "chapter": 3, "verseSpec": "all", "label": "요한 3장"}
_BM_C = {"type": "bookmark", "id": "bm-c", "bookId": "ps", "chapter": 23, "verseSpec": "all", "label": "시편 23편"}

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
        f"() => window.syncStoreV2.saveBookmarks({json.dumps(store)})"
    )


def _get_bookmarks(page) -> list:
    return page.evaluate("() => window.syncStoreV2.loadBookmarks()")


def _wait_visible_notice(page, text: str) -> None:
    """Wait for the on-screen snackbar with exactly `text` — the live region (#a11y-announce, sr-only)
    carries the same words, so it is left out."""
    page.wait_for_function(
        """(t) => [...document.querySelectorAll('body > div')].some(
            (d) => d.id !== 'a11y-announce' && d.textContent === t && d.checkVisibility())""",
        arg=text,
    )


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
    # 눈에도 보인다 — 예전엔 화면 읽기 영역에만 들어가 아무 일도 없는 것처럼 보였다(2026-10-18).
    _wait_visible_notice(page, "파일을 읽을 수 없습니다. 올바른 JSON 파일인지 확인해 주세요.")
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
    _wait_visible_notice(page, "북마크 파일 형식이 올바르지 않습니다.")
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
    assert "올바르지 않은" not in page.inner_text("#bm-import-body")

    ctx.close()


def test_import_partial_file_skips_bad_items_and_says_so(browser, tmp_path):
    """어긋난 항목만 빼고 들인다 — 확인 대화상자가 뺄 개수를 먼저 알리고, 덮어쓰면 올바른 항목만 남는다
    (사용자 결정 2026-10-18, known-issues §14)."""
    incoming = {
        "_version": 1,
        "exportedAt": 0,
        "bookmarks": [
            _BM_A,
            None,                                                        # 객체가 아님
            {**_BM_B, "id": "bm-bad-book", "bookId": "xyz"},             # 없는 책
            {"type": "folder", "id": "folder-bad", "name": "x", "children": "not an array"},
            _FOLDER_WITH_CHILD,                                          # 폴더 안의 bm-c는 들어온다
        ],
    }
    import_file = tmp_path / "partial.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [{**_BM_B, "id": "bm-existing"}])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    body = page.inner_text("#bm-import-body")
    assert "북마크 2개를" in body
    assert "올바르지 않은 항목 3개는 빼고 가져옵니다." in body

    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")
    store = _get_bookmarks(page)
    assert {n["id"] for n in store} == {"bm-a", "folder-1"}
    folder = next(n for n in store if n["id"] == "folder-1")
    assert [n["id"] for n in folder["children"]] == ["bm-c"]

    ctx.close()


def test_import_all_bad_items_stops_with_visible_notice(browser, tmp_path):
    """들일 항목이 하나도 없으면 대화상자를 열지 않고 스낵바로 알린다 — 목록은 그대로."""
    incoming = {"_version": 1, "exportedAt": 0, "bookmarks": [None, {"type": "bookmark", "id": "zz1"}]}
    import_file = tmp_path / "all_bad.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    _wait_visible_notice(page, "가져올 수 있는 항목이 없습니다. 파일에는 올바르지 않은 항목 2개만 들어 있습니다.")
    assert page.locator("#bm-import-modal").get_attribute("hidden") is not None
    assert [n["id"] for n in _get_bookmarks(page)] == ["bm-a"]

    ctx.close()


def test_import_skips_items_that_would_break_the_store(browser, tmp_path):
    """객체 기본 속성 이름인 id(`toString`) · 자식을 단 북마크는 빼고 들인다 — 동기화 저장소가 id를 객체 키로
    쓰고 북마크의 자식도 훑으므로, 들이면 목록 읽기가 깨지거나 「덮어썼습니다」 뒤에도 목록이 그대로였다.
    덮어쓴 뒤 새로 고쳐도 목록이 그려져야 한다(PR #359 리뷰)."""
    incoming = {
        "_version": 1,
        "exportedAt": 0,
        "bookmarks": [_BM_A, {**_BM_B, "id": "toString"}, {**_BM_C, "id": "bm-kids", "children": [None]}],
    }
    import_file = tmp_path / "store_breakers.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    ctx = browser.new_context(service_workers="block")   # 새로 고침 — SW가 처음 페이지를 차지할 때의 새로 고침과 겹치지 않게
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    body = page.inner_text("#bm-import-body")
    assert "북마크 1개를" in body
    assert "올바르지 않은 항목 3개는 빼고 가져옵니다." in body   # toString 1 + bm-kids와 그 자식 2

    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")
    assert [n["id"] for n in _get_bookmarks(page)] == ["bm-a"]

    page.reload()
    page.wait_for_selector("article.chapter-text .verse")
    assert [n["id"] for n in _get_bookmarks(page)] == ["bm-a"]
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer-body [data-id='bm-a']")
    assert errors == []

    ctx.close()


def _folder_chain(depth: int, bottom: dict) -> dict:
    """`depth`단으로 겹친 폴더, 맨 아래에 `bottom`."""
    node = bottom
    for d in range(depth, 0, -1):
        node = {"type": "folder", "id": f"deep-{d}", "name": f"{d}단", "children": [node]}
    return node


def _stored_folder_depth(page) -> int:
    """저장된 목록의 폴더 단수 — 페이지 안에서 센다. Playwright의 evaluate는 이만큼 겹친 객체를 돌려주지
    못하고 「Execution context was destroyed」로 실패한다(64단에서 실측)."""
    return page.evaluate(
        """() => {
            const foldersIn = (list) => list.filter((n) => n.type === "folder");
            let depth = 0;
            for (let level = foldersIn(window.syncStoreV2.loadBookmarks()); level.length;
                 level = level.flatMap((f) => foldersIn(f.children))) depth += 1;
            return depth;
        }"""
    )


def test_import_keeps_64_levels_of_folders(browser, tmp_path):
    """폴더는 64단까지만 들인다 — 그보다 깊은 폴더는 안의 것까지 뺀다. 수백 단이면 목록이 몇 초씩 멈췄고,
    수천 단이면 동기화 저장소 읽기가 깨졌다(PR #359 리뷰 2회차). 덮어쓴 뒤 새로 고쳐도 목록이 그려져야 한다."""
    chain = _folder_chain(300, {**_BM_C, "id": "bm-bottom"})
    chain["children"].append(_BM_A)                          # 1단에도 북마크 하나
    import_file = tmp_path / "deep.json"
    import_file.write_text(json.dumps({"_version": 1, "exportedAt": 0, "bookmarks": [chain]}), encoding="utf-8")

    ctx = browser.new_context(service_workers="block")   # 새로 고침 — SW가 처음 페이지를 차지할 때의 새로 고침과 겹치지 않게
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    body = page.inner_text("#bm-import-body")
    assert "북마크 1개를" in body
    assert "올바르지 않은 항목 237개는 빼고 가져옵니다." in body   # 65-300단 폴더 236 + 맨 아래 북마크

    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")
    page.reload()
    page.wait_for_selector("article.chapter-text .verse")
    assert _stored_folder_depth(page) == 64
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer-body [data-id='deep-1']")
    assert errors == []

    ctx.close()


def test_import_skips_an_id_the_list_uses_for_the_other_kind(browser, tmp_path):
    """지금 목록에 북마크로 있는 id가 파일에서 폴더로 오면 그 폴더를 안의 것까지 뺀다 — 동기화가 항목마다
    나중 것을 따르므로, 다른 기기가 옛 북마크를 고치면 폴더의 자식이 북마크 밑에 숨었다(PR #359 리뷰 2회차).
    덮어쓰기로 본다 — 병합은 이미 있는 id를 원래 버려, 저장 결과로는 이 규칙이 드러나지 않는다(자체 리뷰)."""
    incoming = {
        "_version": 1,
        "exportedAt": 0,
        "bookmarks": [{"type": "folder", "id": "bm-a", "name": "x", "children": [_BM_B]}, _BM_C],
    }
    import_file = tmp_path / "kind.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    body = page.inner_text("#bm-import-body")
    assert "북마크 1개를" in body
    assert "올바르지 않은 항목 2개는 빼고 가져옵니다." in body

    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")
    store = _get_bookmarks(page)
    assert [(n["id"], n["type"]) for n in store] == [("bm-c", "bookmark")]

    ctx.close()


def test_import_overwrite_mends_a_list_the_store_cannot_read(browser, tmp_path):
    """목록을 읽을 수 없게 된 뒤에도(검사 없이 들어간 `toString` id) 가져오기는 대화상자까지 가고, 덮어쓰면
    목록이 되살아난다 — 종류 검사가 지금 목록을 읽다 멈추지 않는다."""
    import_file = tmp_path / "mend.json"
    import_file.write_text(json.dumps(_VALID_EXPORT), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    _open_bookmark_drawer(page)
    page.evaluate(
        """() => window.syncStoreV2.saveBookmarks([
            { type: "bookmark", id: "toString", bookId: "gen", chapter: 1, verseSpec: "all", label: "x" }])"""
    )
    with pytest.raises(Exception, match="is not a function"):
        _get_bookmarks(page)

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")
    assert [n["id"] for n in _get_bookmarks(page)] == ["bm-a", "bm-b"]

    ctx.close()


# 크기 검사는 들인 뒤 저장될 크기(옛 키 + 동기화 저장소 + 다른 키)를 한 글자 2바이트로 세어, Safari 한도 5 MiB에서
# 64 KiB를 남기는지 본다 — 약 2,588,672자(bookmark-modals.js `_fitsStorage`). 아래 크기는 그 값에 맞춘 것이다.


def _bookmarks(n: int, **over) -> list:
    return [{**_BM_B, "id": f"bm-n{i}", **over} for i in range(n)]


def test_import_file_too_big_stops_before_the_dialog(browser, tmp_path):
    """들인 뒤의 저장량이 한도를 넘으면 대화상자를 열지 않고 스낵바로 알린다 — 저장이 조용히 실패해
    「덮어썼습니다」 뒤에도 옛 목록이 남던 결함(PR #359 리뷰 2회차)."""
    incoming = {"_version": 1, "exportedAt": 0, "bookmarks": [{**_BM_B, "note": "x" * 1_400_000}]}
    import_file = tmp_path / "huge.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    _wait_visible_notice(page, "북마크를 가져오지 않았습니다. 목록이 너무 커서 저장할 수 없습니다.")
    assert page.locator("#bm-import-modal").get_attribute("hidden") is not None
    assert [n["id"] for n in _get_bookmarks(page)] == ["bm-a"]

    ctx.close()


def test_import_measures_what_will_be_stored(browser, tmp_path):
    """동기화 저장소는 자식마다 부모 id를 되풀이한다 — 1,000자 id 폴더에 북마크 3,000개면 목록 JSON은
    작아도(약 33만 자) 저장량은 한도를 넘는다. 목록 JSON에 둔 고정 예산은 이것을 들여 「덮어썼습니다」 뒤에
    저장되지 않았다(자체 리뷰)."""
    folder = {"type": "folder", "id": "f" * 1000, "name": "긴 id", "children": _bookmarks(3000)}
    import_file = tmp_path / "long_id.json"
    import_file.write_text(json.dumps({"_version": 1, "exportedAt": 0, "bookmarks": [folder]}), encoding="utf-8")

    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_bookmark_drawer(page)
    _set_bookmarks(page, [_BM_A])

    page.locator("#bm-import-input").set_input_files(str(import_file))
    _wait_visible_notice(page, "북마크를 가져오지 않았습니다. 목록이 너무 커서 저장할 수 없습니다.")
    assert page.locator("#bm-import-modal").get_attribute("hidden") is not None
    assert [n["id"] for n in _get_bookmarks(page)] == ["bm-a"]

    ctx.close()


def test_import_restores_a_backup_of_long_notes_and_merges_onto_it(browser, tmp_path):
    """메모가 긴 목록은 저장량이 목록 JSON의 두 배쯤이라, JSON이 60만 자를 넘어도 기기에 들어간다 — 고정 예산은
    그 백업을 되살리는 것도, 그 위에 북마크 하나를 병합하는 것도 막았다(자체 리뷰)."""
    backup = {"_version": 1, "exportedAt": 0, "bookmarks": _bookmarks(300, note="메" * 2000)}
    backup_file = tmp_path / "notes.json"
    backup_file.write_text(json.dumps(backup, ensure_ascii=False), encoding="utf-8")
    one_more = tmp_path / "one.json"
    one_more.write_text(json.dumps({"_version": 1, "exportedAt": 0, "bookmarks": [_BM_C]}), encoding="utf-8")

    ctx = browser.new_context(service_workers="block")   # 새로 고침 — SW가 처음 페이지를 차지할 때의 새로 고침과 겹치지 않게
    page = ctx.new_page()
    _open_bookmark_drawer(page)

    page.locator("#bm-import-input").set_input_files(str(backup_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")
    page.reload()
    page.wait_for_selector("article.chapter-text .verse")
    assert page.evaluate("() => window.syncStoreV2.loadBookmarks().length") == 300

    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    page.locator("#bm-import-input").set_input_files(str(one_more))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-merge").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")
    assert page.evaluate("() => window.syncStoreV2.loadBookmarks().length") == 301

    ctx.close()


def test_import_merge_too_big_says_so_in_the_dialog(browser, tmp_path):
    """합친 목록이 너무 크면 병합하지 않고 대화상자 안에 까닭을 적은 채 열어 둔다 — 파일만으로는 들어가므로
    덮어쓰기는 된다. 스낵바로 알리던 때는 가로로 든 휴대폰에서 그것이 대화상자의 단추를 3.5초 덮었다(자체 리뷰).
    덮어쓴 목록은 새로 고친 뒤에도 남아야 한다."""
    incoming = {"_version": 1, "exportedAt": 0, "bookmarks": [{**_BM_B, "note": "x" * 700_000}]}
    import_file = tmp_path / "big.json"
    import_file.write_text(json.dumps(incoming), encoding="utf-8")
    refusal = "합친 목록이 너무 커서 병합할 수 없습니다. 「덮어쓰기」나 「취소」를 눌러 주세요."

    ctx = browser.new_context(service_workers="block", viewport={"width": 844, "height": 390})   # 새로 고침 · 가로 화면
    page = ctx.new_page()
    _open_bookmark_drawer(page)
    page.evaluate(
        f"() => window.appStorage.saveBookmarks([{json.dumps({**_BM_A, 'note': 'y' * 700_000})}])"
    )

    page.locator("#bm-import-input").set_input_files(str(import_file))
    page.wait_for_selector("#bm-import-modal:not([hidden])")
    page.locator("#bm-import-merge").click()
    page.wait_for_selector("#bm-import-body .bm-import-refusal")
    assert page.inner_text("#bm-import-body .bm-import-refusal") == refusal
    assert page.locator("#bm-import-modal").get_attribute("hidden") is None
    assert [n["id"] for n in _get_bookmarks(page)] == ["bm-a"]
    for button in ("#bm-import-merge", "#bm-import-overwrite", "#bm-import-cancel"):   # 아무것도 단추를 덮지 않는다
        assert page.evaluate(
            """(sel) => {
                const b = document.querySelector(sel);
                const r = b.getBoundingClientRect();
                return r.bottom <= window.innerHeight && document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b;
            }""",
            button,
        ), button

    page.locator("#bm-import-overwrite").click()
    page.wait_for_selector("#bm-import-modal", state="hidden")
    page.reload()
    page.wait_for_selector("article.chapter-text .verse")
    store = _get_bookmarks(page)
    assert [n["id"] for n in store] == ["bm-b"]
    assert len(store[0]["note"]) == 700_000

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
