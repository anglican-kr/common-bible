"""E2E: 모바일 하단 탭 바 (ADR-029).

Covers:
  - 탭 바 존재 + 정확히 4개 탭, 검색 FAB 제거 확인
  - 탭 네비게이션 + active 상태(aria-current="page" / .active)
  - /bookmarks · /settings · /search 전체 화면 뷰 렌더
  - 읽기 라우트에서 홈 탭 active 유지

데스크탑(≥769px)에서는 탭 바가 숨겨지고 기존 헤더/오버레이를 유지한다.
"""

from .conftest import BASE_URL, wait_app_ready


def test_tab_bar_present_and_fab_removed(mobile_context):
    """모바일에서 #tab-bar 가 보이고 .tab-item 4개, #search-fab 는 0개."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)

    page.wait_for_selector("#tab-bar", timeout=5_000)
    assert page.locator("#tab-bar").is_visible(), "tab bar must be visible on mobile"
    assert page.locator("#tab-bar .tab-item").count() == 4, "expected exactly 4 tab items"
    # Search FAB removed (ADR-029): mobile search is now a full-screen /search tab.
    assert page.locator("#search-fab").count() == 0, "search FAB must be removed"


def test_home_tab_active_on_root(mobile_context):
    """`/` 에서 home 탭이 aria-current='page'."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)

    home = page.locator("#tab-bar .tab-item[data-tab='home']")
    page.wait_for_selector("#tab-bar .tab-item[data-tab='home'][aria-current='page']", timeout=5_000)
    assert "active" in (home.get_attribute("class") or "")


def test_bookmarks_tab_navigates_and_renders_view(mobile_context):
    """북마크 탭 클릭 → /bookmarks 로 이동, 탭 active, 전체 뷰 렌더."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)

    page.locator("#tab-bar .tab-item[data-tab='bookmarks']").click()
    page.wait_for_url("**/bookmarks", timeout=5_000)
    assert page.evaluate("() => location.pathname") == "/bookmarks"

    page.wait_for_selector(
        "#bookmarks-view-tree, #bookmarks-view, .bookmarks-view", timeout=5_000
    )
    page.wait_for_selector(
        "#tab-bar .tab-item[data-tab='bookmarks'][aria-current='page']", timeout=5_000
    )
    bookmarks = page.locator("#tab-bar .tab-item[data-tab='bookmarks']")
    assert "active" in (bookmarks.get_attribute("class") or "")


def test_settings_tab_navigates_and_renders_view(mobile_context):
    """설정 탭 클릭 → /settings 로 이동, 탭 active, 전체 뷰 렌더."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)

    page.locator("#tab-bar .tab-item[data-tab='settings']").click()
    page.wait_for_url("**/settings", timeout=5_000)
    assert page.evaluate("() => location.pathname") == "/settings"

    page.wait_for_selector(
        "#settings-view, .settings-view, #settings-view-content", timeout=5_000
    )
    page.wait_for_selector(
        "#tab-bar .tab-item[data-tab='settings'][aria-current='page']", timeout=5_000
    )
    settings = page.locator("#tab-bar .tab-item[data-tab='settings']")
    assert "active" in (settings.get_attribute("class") or "")


def test_search_tab_navigates_and_shows_input(mobile_context):
    """검색 탭 클릭 → /search 로 이동, in-page 검색 입력창 표시."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)

    page.locator("#tab-bar .tab-item[data-tab='search']").click()
    page.wait_for_url("**/search", timeout=5_000)
    assert page.evaluate("() => location.pathname") == "/search"

    # Full-screen search view exposes an in-page text/search input.
    page.wait_for_selector(
        "#app input[type='search'], #app input[type='text']", timeout=5_000
    )
    page.wait_for_selector(
        "#tab-bar .tab-item[data-tab='search'][aria-current='page']", timeout=5_000
    )


def test_home_tab_returns_to_root(mobile_context):
    """다른 탭에서 home 탭 클릭 → `/` 복귀 + home 탭 active."""
    page = mobile_context.new_page()
    page.goto(f"{BASE_URL}/bookmarks")
    wait_app_ready(page)

    page.locator("#tab-bar .tab-item[data-tab='home']").click()
    page.wait_for_url(f"{BASE_URL}/", timeout=5_000)
    assert page.evaluate("() => location.pathname") == "/"

    page.wait_for_selector(
        "#tab-bar .tab-item[data-tab='home'][aria-current='page']", timeout=5_000
    )


def test_reading_route_keeps_home_tab_active(mobile_context):
    """읽기 라우트(/gen/1)에서도 home 탭이 active 상태."""
    page = mobile_context.new_page()
    page.goto(f"{BASE_URL}/gen/1")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)

    page.wait_for_selector(
        "#tab-bar .tab-item[data-tab='home'][aria-current='page']", timeout=5_000
    )
    home = page.locator("#tab-bar .tab-item[data-tab='home']")
    assert "active" in (home.get_attribute("class") or "")
