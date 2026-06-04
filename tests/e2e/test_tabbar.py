"""E2E: 모바일 모핑 탭 바 (ADR-029 + ADR-030).

Covers:
  - 탭 바 존재 + 탭 4개(홈·북마크·노트목업·설정, 아이콘 전용) + 분리된 검색 원형
  - 탭 네비게이션 + active 상태(aria-current="page" / .active)
  - /bookmarks · /settings 전체 화면 뷰 렌더
  - 검색 원형 버튼 → /search 모핑(#tab-dock.searching, 하단 입력 표시)
  - 스크롤 축소(#tab-dock.collapsed) + 축소 시 홈 탭 = 펼치기(홈 이동 아님)
  - 읽기 라우트에서 홈 탭 active 유지

데스크탑(≥769px)에서는 탭 dock 이 숨겨지고 기존 헤더/오버레이를 유지한다.
"""

from .conftest import BASE_URL, wait_app_ready


def test_tab_bar_present_and_search_separated(mobile_context):
    """모바일: #tab-bar 4탭(아이콘 전용) + 분리된 #tab-search 원형, FAB 0개."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)

    page.wait_for_selector("#tab-bar", timeout=5_000)
    assert page.locator("#tab-bar").is_visible(), "tab bar must be visible on mobile"
    # ADR-030: 홈·북마크·노트(목업)·설정 = 4개 .tab-item. 검색은 탭에서 분리됨.
    assert page.locator("#tab-bar .tab-item").count() == 4, "expected 4 tab items"
    assert page.locator("#tab-bar .tab-item[data-tab='search']").count() == 0, \
        "search must NOT be a tab item (separated to #tab-search)"
    assert page.locator("#tab-search").is_visible(), "separated search circle present"
    # 라벨 제거(아이콘 전용).
    assert page.locator("#tab-bar .tab-label").count() == 0, "tab labels removed"
    # Search FAB removed (ADR-029).
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


def test_search_button_morphs_to_input(mobile_context):
    """검색 원형 버튼 클릭 → /search + #tab-dock.searching + 하단 입력 표시."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)

    page.locator("#tab-search").click()
    page.wait_for_url("**/search", timeout=5_000)
    assert page.evaluate("() => location.pathname") == "/search"

    # 모핑 상태 + 하단 입력(모핑 입력 pill)이 보여야 한다.
    page.wait_for_selector("#tab-dock.searching", timeout=5_000)
    page.wait_for_selector("#tab-search-input:not([hidden])", timeout=5_000)
    page.wait_for_selector("#tab-search[aria-current='page']", timeout=5_000)


def test_scroll_collapse_and_home_expands_without_nav(mobile_context):
    """아래로 스크롤 → #tab-dock.collapsed. 축소 상태 홈 탭 = 펼치기(홈 이동 아님)."""
    page = mobile_context.new_page()
    page.goto(f"{BASE_URL}/gen/1")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)

    # 아래로 스크롤 → 축소.
    page.evaluate("window.scrollTo(0, 600)")
    page.wait_for_selector("#tab-dock.collapsed", timeout=5_000)

    # 축소 상태에서 홈 탭 클릭 → 홈으로 이동하지 않고 펼쳐짐, 읽던 라우트 유지.
    page.locator("#tab-bar .tab-item[data-tab='home']").click()
    page.wait_for_selector("#tab-dock:not(.collapsed)", timeout=5_000)
    assert page.evaluate("() => location.pathname") == "/gen/1", \
        "collapsed home tap must expand in place, not navigate home"


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
