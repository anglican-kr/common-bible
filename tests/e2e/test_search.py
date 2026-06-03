"""E2E: search pipeline tests.

Covers:
  - keyword search shows results
  - verse reference auto-navigates to chapter
  - worker init failure surfaces an error message
  - verse search URL on refresh auto-navigates (regression)
  - in: operator restricts to a book / supports OR / tolerates whitespace
  - mobile compact ↔ expanded sheet transitions
  - mobile chip click inserts operator text
  - mobile focus while expanded reverts to compact
"""

import pytest

from .conftest import (
    CLEAR_APP_STORAGE, IPHONE_UA, MOBILE_VIEWPORT, wait_app_ready,
)

BASE_URL = "http://localhost:8080"
SEARCH_URL = f"{BASE_URL}/search?q=%EC%B0%BD%EC%84%B8%201%3A1"


def test_keyword_search_shows_results(page, base_url):
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑")
    page.press("#search-input", "Enter")

    page.wait_for_selector(".search-count, .search-empty", timeout=8000)
    assert page.locator(".search-result-item").count() > 0


def test_verse_reference_navigates_to_chapter(page, base_url):
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "요한 3:16")
    page.press("#search-input", "Enter")

    page.wait_for_function("() => location.pathname.startsWith('/john/3')", timeout=5000)
    assert page.evaluate("location.pathname").startswith("/john/3")


def test_worker_error_surfaces_to_ui(browser):
    """Worker meta-load failure must show an error in the UI, not hang."""
    ctx = browser.new_context(service_workers="block")
    page = ctx.new_page()
    page.route("**/data/search-meta.json", lambda route: route.fulfill(status=500, body="boom"))

    page.goto(BASE_URL)
    wait_app_ready(page)

    page.fill("#search-input", "사랑")
    page.press("#search-input", "Enter")

    page.wait_for_selector(".error", timeout=8000)
    assert page.inner_text(".error").strip()

    ctx.close()


def test_search_url_refresh_navigates_and_dismisses_launch_screen(page):
    """Navigating directly to a verse search URL must dismiss the launch screen
    and show the verse reference card (no auto-navigation on direct URL access)."""
    page.goto(SEARCH_URL)

    page.wait_for_selector("#launch-screen", state="detached", timeout=5000)
    page.wait_for_selector(".search-result-ref-card", timeout=8000)


# ── 보강: 결과 클릭 네비게이션 ───────────────────────────────────────────────

def test_search_result_click_navigates_to_chapter(page, base_url):
    """검색 결과 항목 클릭 → 해당 책/장 URL로 SPA 이동."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-result-item", timeout=8_000)

    # Click the first non-ref-card result link
    first_link = page.locator(".search-result-item:not(.ref-match-item) a").first
    href = first_link.get_attribute("href") or ""
    first_link.click()

    page.wait_for_selector("article.chapter-text .verse", timeout=5_000)
    current = page.evaluate("() => location.pathname")
    # URL should have changed to a chapter path (e.g. /john/3)
    assert current != "/" and current != "/search", \
        f"Expected chapter URL, got {current!r}"


def test_search_ref_card_click_navigates(page):
    """구절 참조 카드 클릭 → 해당 장으로 이동."""
    page.goto(SEARCH_URL)
    page.wait_for_selector(".search-result-ref-card", timeout=8_000)

    page.locator(".search-result-ref-card").first.click()
    page.wait_for_selector("article.chapter-text .verse", timeout=5_000)

    current = page.evaluate("() => location.pathname")
    assert current.startswith("/gen/1"), f"Expected /gen/1, got {current!r}"


def test_search_result_link_contains_hl_param(page, base_url):
    """검색 결과 링크 href에 ?hl= 파라미터가 포함된다."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-result-item:not(.ref-match-item)", timeout=8_000)

    href = page.locator(".search-result-item:not(.ref-match-item) a").first.get_attribute("href") or ""
    assert "hl=" in href, f"Expected ?hl= in href, got {href!r}"


# ── in: 연산자 ──────────────────────────────────────────────────────────────

def _result_book_ids(page):
    """결과 링크 href에서 book ID(/<id>/...)들을 뽑아낸다."""
    return page.locator(".search-result-item:not(.ref-match-item) a").evaluate_all(
        "links => links.map(a => (a.getAttribute('href') || '').split('/')[1])"
    )


def test_in_operator_restricts_to_single_book(page, base_url):
    """`사랑 in:요한` → 결과의 book ID가 모두 `john`이어야 한다."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑 in:요한")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-result-item:not(.ref-match-item)", timeout=8_000)

    book_ids = _result_book_ids(page)
    assert book_ids, "expected at least one match"
    assert all(b == "john" for b in book_ids), f"Expected only 'john', got: {set(book_ids)}"


def test_in_operator_whitespace_tolerated(page, base_url):
    """`사랑 in: 요한`(콜론 뒤 공백)도 동일하게 동작."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑 in: 요한")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-result-item:not(.ref-match-item)", timeout=8_000)

    book_ids = _result_book_ids(page)
    assert book_ids, "expected at least one match"
    assert all(b == "john" for b in book_ids), f"Expected only 'john', got: {set(book_ids)}"


def test_in_operator_multiple_aliases_or(page, base_url):
    """`사랑 in:요한 in:마태` → john과 matt 결과가 모두 나오고, 그 외 책은 없다."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑 in:요한 in:마태")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-result-item:not(.ref-match-item)", timeout=8_000)

    book_ids = set(_result_book_ids(page))
    assert book_ids, "expected at least one match"
    assert book_ids <= {"john", "matt"}, f"Expected subset of {{john, matt}}, got: {book_ids}"


def test_in_operator_unmatched_alias_blocks_search(page, base_url):
    """`사랑 in:없는책` → 결과 없음 + 안내 메시지 표시."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑 in:없는책")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-notice", timeout=8_000)
    assert page.locator(".search-result-item:not(.ref-match-item)").count() == 0
    notice_text = page.locator(".search-notice").inner_text()
    assert "in:없는책" in notice_text and "알 수 없는" in notice_text


def test_search_result_hl_strips_in_operator(page, base_url):
    """`사랑 in:요한` 결과 링크의 ?hl= 파라미터는 stripped 키워드("사랑")만 포함."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑 in:요한")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-result-item:not(.ref-match-item)", timeout=8_000)

    href = page.locator(".search-result-item:not(.ref-match-item) a").first.get_attribute("href") or ""
    # ?hl=사랑 (URL-encoded). Should NOT contain 'in:' or '요한'.
    assert "hl=" in href
    assert "in%3A" not in href and "%EC%9A%94%ED%95%9C" not in href, \
        f"Expected stripped keyword in hl=, got {href!r}"


# ── 모바일 컴팩트 ↔ 확장 시트 ─────────────────────────────────────────────────

def _mobile_page(browser):
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    return ctx, ctx.new_page()


@pytest.mark.skip(reason="ADR-029: search FAB removed; mobile search is now a full-screen /search tab view. Sheet-based test pending rewrite.")
def test_mobile_fab_opens_compact_sheet(browser):
    """FAB 탭 → 시트가 data-state='compact'로 열리고 결과 영역은 보이지 않는다."""
    ctx, page = _mobile_page(browser)
    try:
        page.goto(BASE_URL)
        page.wait_for_selector("#search-fab", timeout=5_000)
        page.locator("#search-fab").click()

        page.wait_for_selector("#search-sheet[data-state='compact']", timeout=3_000)
        # Chips visible, results hidden via CSS in compact.
        assert page.locator("#search-sheet-chips .search-chip").count() >= 1
        results_visible = page.locator("#search-sheet-results").is_visible()
        assert not results_visible, "results pane must be hidden in compact state"
    finally:
        ctx.close()


@pytest.mark.skip(reason="ADR-029: search FAB removed; mobile search is now a full-screen /search tab view. Sheet-based test pending rewrite.")
def test_mobile_enter_transitions_to_expanded_with_results(browser):
    """컴팩트 시트에서 Enter → 확장 상태로 전환 + 결과 표시."""
    ctx, page = _mobile_page(browser)
    try:
        page.goto(BASE_URL)
        page.wait_for_selector("#search-fab", timeout=5_000)
        page.locator("#search-fab").click()
        page.wait_for_selector("#search-sheet[data-state='compact']", timeout=3_000)

        page.locator("#search-sheet-input").fill("사랑")
        page.locator("#search-sheet-input").press("Enter")

        page.wait_for_selector("#search-sheet[data-state='expanded']", timeout=3_000)
        page.wait_for_selector(
            "#search-sheet-results .search-result-item:not(.ref-match-item)",
            timeout=8_000,
        )
        assert page.locator(
            "#search-sheet-results .search-result-item:not(.ref-match-item)"
        ).count() > 0
    finally:
        ctx.close()


@pytest.mark.skip(reason="ADR-029: search FAB removed; mobile search is now a full-screen /search tab view. Sheet-based test pending rewrite.")
def test_mobile_in_chip_appends_operator_with_cursor(browser):
    """`+ in:` 칩 탭 → 입력값 끝에 ` in:` 삽입, 커서가 끝에 위치, 입력 포커스 유지."""
    ctx, page = _mobile_page(browser)
    try:
        page.goto(BASE_URL)
        page.wait_for_selector("#search-fab", timeout=5_000)
        page.locator("#search-fab").click()
        page.wait_for_selector("#search-sheet[data-state='compact']", timeout=3_000)

        page.locator("#search-sheet-input").fill("사랑")
        page.locator(".search-chip[data-chip='in']").click()

        # Value: "사랑 in:" — note the leading space because input wasn't empty.
        value = page.locator("#search-sheet-input").input_value()
        assert value == "사랑 in:", f"Expected '사랑 in:', got {value!r}"
        # Cursor positioned at the end (after the colon).
        sel_start = page.evaluate("() => document.getElementById('search-sheet-input').selectionStart")
        assert sel_start == len(value), f"Expected cursor at {len(value)}, got {sel_start}"
        # Focus retained on input.
        active_id = page.evaluate("() => document.activeElement && document.activeElement.id")
        assert active_id == "search-sheet-input", f"Focus lost; active = {active_id!r}"
    finally:
        ctx.close()


@pytest.mark.skip(reason="ADR-029: search FAB removed; mobile search is now a full-screen /search tab view. Sheet-based test pending rewrite.")
def test_mobile_focus_in_expanded_reverts_to_compact(browser):
    """결과 표시 중 입력창에 다시 포커스 → compact 복귀 + 결과/notice 정리."""
    ctx, page = _mobile_page(browser)
    try:
        page.goto(BASE_URL)
        page.wait_for_selector("#search-fab", timeout=5_000)
        page.locator("#search-fab").click()
        page.locator("#search-sheet-input").fill("사랑")
        page.locator("#search-sheet-input").press("Enter")
        page.wait_for_selector("#search-sheet[data-state='expanded']", timeout=3_000)
        page.wait_for_selector(
            "#search-sheet-results .search-result-item:not(.ref-match-item)",
            timeout=8_000,
        )
        # runSheetSearch is async — onPartial then the post-await clearNode +
        # renderSearchResultList run after the first .search-result-item match.
        # Wait for the loading placeholder to disappear AND the a11y announce
        # to fire so the focus handler's clearNode isn't immediately
        # overwritten by a trailing render.
        page.wait_for_selector("#search-sheet-results .loading", state="detached", timeout=3_000)
        page.wait_for_function(
            "() => /검색 결과/.test(document.getElementById('a11y-announce')?.textContent || '')",
            timeout=3_000,
        )

        # Programmatically focus to bypass iOS pointer quirks; the JS focus
        # handler is what we're testing.
        page.evaluate("() => document.getElementById('search-sheet-input').focus()")
        page.wait_for_selector("#search-sheet[data-state='compact']", timeout=2_000)
        # Results cleared.
        assert page.locator("#search-sheet-results .search-result-item").count() == 0
    finally:
        ctx.close()
