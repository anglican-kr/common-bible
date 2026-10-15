"""E2E: 모바일 모핑 탭 바 (ADR-029 + ADR-030).

Covers:
  - 탭 바 존재 + 탭 5개(홈·캘린더·북마크·노트(숨김)·설정, 아이콘 전용) + 분리된 검색 원형
  - 탭 네비게이션 + active 상태(aria-current="page" / .active)
  - /bookmarks · /settings 전체 화면 뷰 렌더
  - 검색 원형 버튼 → /search 모핑(#tab-dock.searching, 하단 입력 표시)
  - 스크롤 축소(#tab-dock.collapsed) + 축소 시 홈 탭 = 펼치기(홈 이동 아님)
  - 읽기 라우트에서 홈 탭 active 유지
  - 슬라이딩 인디케이터 크기 — 축소에서 펼칠 때 그대로 · 320px 에서 줄어든 슬롯에 맞춤(PR #348 리뷰)
  - 수정 키(⌘ · Ctrl) 탭 클릭은 새 탭 몫 — 이 화면에 스크롤 복원 요청을 남기지 않는다(PR #348 리뷰)

데스크탑(≥769px)에서는 탭 dock 이 숨겨지고 기존 헤더/오버레이를 유지한다.
"""

from .conftest import BASE_URL, CLEAR_APP_STORAGE, IPHONE_UA, wait_app_ready


def test_tab_bar_present_and_search_separated(mobile_context):
    """모바일: #tab-bar 5탭(보이는 것 넷 — 아이콘 전용) + 분리된 #tab-search 원형, FAB 0개."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)

    page.wait_for_selector("#tab-bar", timeout=5_000)
    assert page.locator("#tab-bar").is_visible(), "tab bar must be visible on mobile"
    # ADR-030 · ADR-038 A2: 홈·캘린더·북마크·노트(숨김)·설정 = 5개 .tab-item. 검색은 탭에서 분리됨.
    assert page.locator("#tab-bar .tab-item").count() == 5, "expected 5 tab items"
    assert page.locator("#tab-bar .tab-item:not([hidden])").count() == 4, "expected 4 visible tab items"
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
    # In searching mode the search circle morphs into the input pill, so
    # #tab-search is hidden — assert the state is set (attached), not visible.
    page.wait_for_selector(
        "#tab-search[aria-current='page']", state="attached", timeout=5_000
    )


def test_scroll_collapse_and_home_expands_without_nav(mobile_context):
    """아래로 스크롤 → #tab-dock.collapsed. 축소 상태 홈 탭 = 펼치기(홈 이동 아님)."""
    page = mobile_context.new_page()
    page.goto(f"{BASE_URL}/gen/1")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)

    # 아래로 스크롤 → 축소. html 의 scroll-behavior:smooth 라 scrollTo(0, 600) 은 애니메이트된다 — 64px 를 넘는 순간
    # 접히고, 스크롤이 끝나기 전에 홈을 누르면 남은 아래쪽 스크롤이 펼친 바를 다시 접는다(누르는 시점에 따라 갈리던
    # 실패 — 2026-10-15 확인). 즉시 스크롤로 그 경합을 없앤다.
    page.evaluate("window.scrollTo({ top: 600, behavior: 'instant' })")
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


def test_home_tab_from_reading_focuses_book_card(mobile_context):
    """ADR-031 개정: 신약(matt/1) 읽는 중 하단 home 탭 = pop-to-root 시 그 책의 구분
    탭(신약)으로 가서 마태오 카드에 포커스. 기본 href='/'(구약만 렌더)였다면 신약 책이
    목록에 없어 포커스가 안 잡혔을 케이스를 책 자신의 구분으로 라우팅해 해소."""
    page = mobile_context.new_page()
    page.goto(f"{BASE_URL}/matt/1")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)

    page.locator("#tab-bar .tab-item[data-tab='home']").click()
    page.wait_for_selector(".book-list a[data-book-id='matt']", timeout=5_000)

    focused = page.evaluate(
        "() => document.activeElement && document.activeElement.getAttribute('data-book-id')"
    )
    assert focused == "matt", f"Expected focus on matt, got {focused!r}"

    # 프로그래밍 focus() 는 :focus-visible 을 트리거하지 않으므로, 명시적 .is-last-read
    # 마커 클래스로 마태오 카드가 시각적으로 강조되는지 확인(색상 하이라이트의 근거).
    card = page.locator(".book-list a[data-book-id='matt']")
    assert "is-last-read" in (card.get_attribute("class") or ""), \
        "read book card must carry the .is-last-read highlight marker"


def test_book_list_does_not_collapse_on_scroll(mobile_context):
    """책 목록(books)에선 아래로 스크롤해도 탭바 유지(읽기 화면 전용 게이트)."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)
    page.evaluate("window.scrollTo(0, 800)")
    page.wait_for_timeout(400)
    assert "collapsed" not in (
        page.locator("#tab-dock").get_attribute("class") or ""
    ), "book list must not collapse the tab bar on scroll"


def test_no_collapse_when_audio_book_off(mobile_context):
    """오디오 북 설정 OFF 면 읽기 화면에서도 스크롤 축소 안 함."""
    page = mobile_context.new_page()
    page.add_init_script("localStorage.setItem('bible-audio-show', '0')")
    page.goto(f"{BASE_URL}/gen/1")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)
    page.evaluate("window.scrollTo(0, 600)")
    page.wait_for_timeout(400)
    assert "collapsed" not in (
        page.locator("#tab-dock").get_attribute("class") or ""
    ), "audio-book OFF must disable scroll collapse"


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


# ── 슬라이딩 인디케이터 크기 (PR #348 리뷰) ──

_IND_WIDTH = "() => document.querySelector('#tab-bar .tab-indicator').offsetWidth"


def test_indicator_keeps_its_size_while_the_collapsed_bar_expands(mobile_context):
    """스크롤 축소(탭 바 60px)에서 펼치는 동안 인디케이터는 56px 그대로 — 작은 원이 커지며 나타나지 않는다.
    크기는 탭 바가 쉬고 있을 때만 잰다(그전엔 「탭 바 폭 / 탭 수」를 따라가 축소 중 15px 이었다)."""
    page = mobile_context.new_page()
    page.goto(f"{BASE_URL}/gen/1")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)
    page.wait_for_selector("#tab-bar .tab-indicator.is-shown", timeout=5_000)
    assert page.evaluate(_IND_WIDTH) == 56
    page.evaluate("window.scrollTo({ top: 600, behavior: 'instant' })")
    page.wait_for_selector("#tab-dock.collapsed", timeout=5_000)
    page.wait_for_timeout(400)
    assert page.evaluate(_IND_WIDTH) == 56
    # 맨 위로 — 펼쳐지는 동안 매 프레임 폭을 잰다
    widths = page.evaluate("""() => new Promise((resolve) => {
        const ind = document.querySelector('#tab-bar .tab-indicator');
        const seen = [];
        window.scrollTo(0, 0);
        const t0 = performance.now();
        const tick = () => {
            seen.push(ind.offsetWidth);
            if (performance.now() - t0 < 500) requestAnimationFrame(tick); else resolve(seen);
        };
        requestAnimationFrame(tick);
    })""")
    page.wait_for_selector("#tab-dock:not(.collapsed)", timeout=5_000)
    assert min(widths) == 56, widths


def test_indicator_fits_the_shrunk_slot_at_320px(browser):
    """320px — 탭 넷 + 검색이 dock 을 넘어 슬롯이 60px 아래로 준다. 인디케이터는 슬롯의 활성 원과 같은 크기(DESIGN.md §7),
    축소했다 펼친 뒤에도."""
    ctx = browser.new_context(viewport={"width": 320, "height": 640}, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/gen/1")
        page.wait_for_selector("article.chapter-text .verse", timeout=8_000)
        page.wait_for_selector("#tab-bar .tab-indicator.is-shown", timeout=5_000)
        sizes = "() => [document.querySelector('#tab-bar .tab-indicator').offsetWidth, document.querySelector(\"#tab-bar [data-tab='home'] .tab-icon-wrap\").offsetWidth, document.querySelector(\"#tab-bar [data-tab='home']\").offsetWidth]"
        ind, wrap, slot = page.evaluate(sizes)
        assert slot < 60 and ind == wrap <= slot, (ind, wrap, slot)
        page.evaluate("window.scrollTo({ top: 600, behavior: 'instant' })")
        page.wait_for_selector("#tab-dock.collapsed", timeout=5_000)
        page.wait_for_timeout(400)
        page.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })")
        page.wait_for_selector("#tab-dock:not(.collapsed)", timeout=5_000)
        page.wait_for_timeout(600)
        assert page.evaluate(sizes)[0] == wrap
    finally:
        ctx.close()


# ── 수정 키 클릭 (PR #348 리뷰) ──

def test_modifier_click_on_tab_leaves_no_scroll_restore_behind(mobile_context):
    """⌘ · Ctrl-클릭으로 북마크 탭을 새 탭에 열어도 이 화면은 그대로이고, 다음 링크 이동(PUSH)은 뷰가 정한 스크롤(장 최상단)을
    지킨다 — 그전엔 탭 처리기가 복원 요청을 먼저 세워 두어 그것이 남아, 다음 이동이 옛 스크롤 위치로 튀었다."""
    page = mobile_context.new_page()
    page.goto(f"{BASE_URL}/gen/1")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)
    page.evaluate("window.scrollTo({ top: 600, behavior: 'instant' })")   # /gen/1 을 떠날 때 600 이 기억된다
    page.wait_for_timeout(200)
    page.evaluate("navigate('/settings')")
    page.wait_for_url("**/settings")
    page.wait_for_selector("#tab-dock:not(.collapsed)", timeout=5_000)
    with mobile_context.expect_page(timeout=5_000) as opened:
        page.locator("#tab-bar [data-tab='bookmarks']").click(modifiers=["ControlOrMeta"])
    opened.value.close()
    assert page.url.endswith("/settings")
    page.evaluate("navigate('/gen/1')")           # 링크 이동과 같은 PUSH — 복원 요청 없음
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)
    page.wait_for_timeout(400)
    assert page.evaluate("window.scrollY") == 0
