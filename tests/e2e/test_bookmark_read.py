"""E2E: 폴더 "모아 읽기" 버튼 → /read/<folderId> 읽기 화면 (ADR-035).

폴더 행의 모아 읽기 버튼(.bm-folder-read-btn)을 누르면 그 폴더의 북마크 성경
본문을 한 화면에 모은 읽기 뷰(bookmark-read.js)로 이동한다. 트리(bookmark-tree)→
navigate→라우팅→bookmark-read 렌더까지의 모듈 간 경로를 검증한다 — 이 버튼 클릭과
읽기 뷰 렌더는 다른 어떤 e2e 도 다루지 않던 경로다.
"""
import json

BASE = "http://localhost:8080"

_FOLDER = {
    "type": "folder", "id": "folder-1", "name": "묶음", "expanded": True,
    "children": [
        {"type": "bookmark", "id": "bm-gen1", "bookId": "gen", "chapter": 1,
         "label": "창세기 1장", "verseSpec": "all"},
    ],
}


def _open_chapter(page, path="gen/2"):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(200)


def test_folder_read_button_opens_reading_view(browser):
    """폴더 모아 읽기 버튼 → /read/folder-1 로 이동, 읽기 뷰에 본문이 모인다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_chapter(page, "gen/2")
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps([_FOLDER])})")

    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    page.locator("li.bm-folder[data-id='folder-1'] .bm-folder-read-btn").click()

    # Navigated to the collected-read route and rendered the read panel.
    page.wait_for_url("**/read/folder-1")
    page.wait_for_selector(".bookmark-read", timeout=5_000)
    # The folder's bookmark (창세기 1장) scripture is gathered into the view.
    assert page.locator(".bookmark-read .verse").count() > 0
    # The drawer closed on navigation.
    assert page.locator("#bookmark-drawer[hidden]").count() == 1
    ctx.close()


def test_broken_escape_in_read_path_shows_empty_view(desktop_context):
    """/read/<깨진 퍼센트 이스케이프> — 경로 해석이 throw 하지 않고 없는 폴더로 읽혀 「읽을 북마크가 없습니다」.
    그전엔 parsePath 가 route() 의 try 밖에서 URIError 를 던져 화면이 그려지지 않고 런치 화면이 남았다(PR #348 리뷰 —
    known-issues §6 이던 것)."""
    page = desktop_context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/read/%E0%A4%A")
    page.wait_for_selector(".bookmark-read .empty-state-title", timeout=10_000)
    assert page.inner_text(".bookmark-read .empty-state-title") == "읽을 북마크가 없습니다"
    # 빈 상태는 UI 글자라 산세리프 — .empty-state가 글꼴을 스스로 정한다(2026-10-17 · DESIGN.md §6; 그전엔 body의 serif)
    fonts = page.eval_on_selector_all(".bookmark-read .empty-state-title, .bookmark-read .empty-state-subtitle",
                                      "els => els.map(e => getComputedStyle(e).fontFamily)")
    assert fonts and all("Noto Sans KR" in f and "Serif" not in f for f in fonts), fonts
    page.wait_for_selector("#launch-screen", state="detached", timeout=5_000)
    assert not [e for e in errors if "URI" in e], errors


# 옛 판(2026-04-25부터 06-06 #205까지)이 저장한 줄 글자 — 앱을 시작할 때 지금 표기로 옮긴다(사용자 결정 2026-10-22,
# coding-pitfalls §38). main에서는 글자가 둘인 「16aa」 · 「7-8a」 북마크가 모아 읽기에서 사라졌다.
_PRE205_FOLDER = {
    "type": "folder", "id": "f-old", "name": "옛 북마크", "expanded": True,
    "children": [
        {"type": "bookmark", "id": "bm-isa", "bookId": "isa", "chapter": 10, "verseSpec": "16aa", "label": "이사 10:16aa"},
        {"type": "bookmark", "id": "bm-nah", "bookId": "nah", "chapter": 1, "verseSpec": "7-8a", "label": "내 묵상"},
        {"type": "bookmark", "id": "bm-matt", "bookId": "matt", "chapter": 10, "verseSpec": "35a", "label": "마태 10:35a"},
    ],
}


def _v2_items(page) -> dict:
    return page.evaluate("() => JSON.parse(localStorage.getItem('bible-bookmarks-v2')).bookmarks.items")


def test_pre205_bookmarks_move_at_startup_and_read_in_full(browser):
    """옛 표기 북마크는 다음 시작 때 지금 표기로 옮겨지고(두 사본 · 수정 시각 그대로), 모아 읽기가 모두 그린다."""
    ctx = browser.new_context()   # no storage-clearing init script — the reload must keep what was stored
    page = ctx.new_page()
    _open_chapter(page, "gen/1")
    page.evaluate(f"() => window.appStorage.saveBookmarks({json.dumps([_PRE205_FOLDER])})")
    before = _v2_items(page)

    page.reload()
    page.wait_for_selector("article.chapter-text .verse")
    after = _v2_items(page)
    assert {i: after[i].get("verseSpec") for i in ("bm-isa", "bm-nah", "bm-matt")} == {"bm-isa": "16", "bm-nah": "7-8", "bm-matt": "35"}
    assert {i: after[i]["label"] for i in ("bm-isa", "bm-nah", "bm-matt")} == {"bm-isa": "이사 10:16", "bm-nah": "내 묵상", "bm-matt": "마태 10:35"}
    assert {i: n["_u"] for i, n in after.items()} == {i: n["_u"] for i, n in before.items()}, "수정 시각은 그대로"
    legacy = page.evaluate("() => JSON.parse(localStorage.getItem('bible-bookmarks'))")
    assert [c["verseSpec"] for c in legacy[0]["children"]] == ["16", "7-8", "35"]

    page.goto(f"{BASE}/read/f-old")
    page.wait_for_selector(".bookmark-read .reading-passage")
    page.wait_for_function("() => document.querySelectorAll('.bookmark-read .reading-passage').length === 3")
    sections = page.evaluate("""() => [...document.querySelectorAll('.bookmark-read .reading-passage')].map((s) => ({
        ref: s.querySelector('.reading-ref').textContent,
        vrefs: [...s.querySelectorAll('.verse')].map((v) => v.dataset.vref)}))""")
    assert [s["ref"] for s in sections] == ["이사 10:16", "나훔 1:7–8", "마태 10:35"]
    assert sections[0]["vrefs"] == ["16aa", "16ab", "16ba", "16bb"]   # 16ㄱ과 16ㄴ
    assert sections[1]["vrefs"][0] == "7-8a" and len(sections[1]["vrefs"]) == 7
    ctx.close()
