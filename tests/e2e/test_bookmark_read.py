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
    page.wait_for_selector("#launch-screen", state="detached", timeout=5_000)
    assert not [e for e in errors if "URI" in e], errors
