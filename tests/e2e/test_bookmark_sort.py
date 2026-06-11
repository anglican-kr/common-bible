"""E2E: 북마크 전체뷰 ⋯ 메뉴의 정렬 — 기준(제목/날짜) + 순서(오름/내림).

전체뷰(buildBmViewActions)는 모바일 전용이므로 mobile_context 픽스처를 쓴다.
정렬 기준/순서를 고르면 bookmark-menu.js 가 bookmark-core 의 setBookmarkSort /
setBookmarkSortDir 를 호출하고 주입된 재렌더 훅으로 트리를 다시 그린다 — 이 UI→코어→
재렌더 배선을 검증한다(유닛은 정렬 *로직*만 다루고 메뉴 배선은 안 다룬다).
"""
import json

BASE = "http://localhost:8080"

_MORE_BTN = ".title-action-btn[aria-label='더 보기']"

# On the iPhone UA the install nudge auto-opens after ~1.5s; pin neverShow.
_PIN_NUDGE = (
    "localStorage.setItem('bible-install-nudge',"
    " JSON.stringify({visits: 0, nextShow: 9999, neverShow: true}));"
)

# Two root bookmarks whose insertion ("manual") order is the REVERSE of their
# title (가나다) order, so a sort change visibly flips the first row.
#   manual order : 하늘, 가나   →   title asc : 가나, 하늘
_STORE = [
    {"type": "bookmark", "id": "b-ha", "bookId": "gen", "chapter": 1,
     "label": "하늘", "verseSpec": "all", "createdAt": 1000},
    {"type": "bookmark", "id": "b-ga", "bookId": "gen", "chapter": 2,
     "label": "가나", "verseSpec": "all", "createdAt": 2000},
]


def _seed(mobile_context):
    mobile_context.add_init_script(_PIN_NUDGE)
    page = mobile_context.new_page()
    page.goto(f"{BASE}/bookmarks")
    page.wait_for_selector("#bookmarks-view-tree", timeout=5_000)
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(_STORE)})")
    page.evaluate("() => window.rerenderActiveBookmarkTree()")
    return page


def _first_label(page):
    return page.locator("#bookmarks-view-tree .bm-bookmark-link").first.inner_text()


def _open_menu(page):
    page.locator(_MORE_BTN).click()
    page.wait_for_selector(".title-action-menu:not([hidden])")


def test_sort_by_title_reorders_tree(mobile_context):
    """⋯ → 정렬 '제목' 을 고르면 트리가 가나다순으로 다시 그려진다."""
    page = _seed(mobile_context)
    # Default "manual" = insertion order, so 하늘 (inserted first) leads.
    assert "하늘" in _first_label(page)

    _open_menu(page)
    page.get_by_role("menuitemradio", name="제목", exact=True).click()
    page.wait_for_selector(".title-action-menu", state="hidden")

    # Title ascending (가나다) → 가나 now leads.
    assert "가나" in _first_label(page)
    # Preference persisted per device.
    assert page.evaluate("() => localStorage.getItem('bible-bookmark-sort')") == "title"


def test_sort_direction_descending_reverses(mobile_context):
    """제목 정렬 상태에서 '내림차순' 을 고르면 ㅎ→ㄱ 으로 뒤집힌다."""
    page = _seed(mobile_context)
    _open_menu(page)
    page.get_by_role("menuitemradio", name="제목", exact=True).click()
    page.wait_for_selector(".title-action-menu", state="hidden")
    assert "가나" in _first_label(page)  # asc

    _open_menu(page)
    # The 오름/내림 rows gain a field-specific clarifier note once a key-sort is
    # active (제목 → "ㅎ→ㄱ"), so the accessible name is no longer exactly "내림차순".
    page.get_by_role("menuitemradio", name="내림차순").click()
    page.wait_for_selector(".title-action-menu", state="hidden")

    # Title descending → 하늘 leads again.
    assert "하늘" in _first_label(page)
