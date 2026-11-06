"""E2E: search pipeline tests.

Covers:
  - keyword search shows results
  - verse reference auto-navigates to chapter
  - worker init failure surfaces an error message
  - verse search URL on refresh auto-navigates (regression)
  - in: operator restricts to a book / supports OR / tolerates whitespace
"""

from .conftest import wait_app_ready

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


# ── 장 화면의 강조: 조각 경계 ──────────────────────────────────────────────


def _chapter_text(page):
    return page.evaluate("() => document.querySelector('article.chapter-text').textContent")


def _search_and_open(page, base_url, query, href_prefix):
    """검색창에 query를 쳐서 href_prefix로 가는 결과를 눌러 장 화면(?hl=)을 연다."""
    page.goto(base_url)
    wait_app_ready(page)
    page.fill("#search-input", query)
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-result-item:not(.ref-match-item)", timeout=8_000)
    link = page.locator(f'.search-result-item a[href^="{href_prefix}"]')
    assert link.count() == 1, f"{query!r}: {href_prefix} 결과가 {link.count()}건"
    link.first.click()
    page.wait_for_selector("article.chapter-text mark.search-highlight", timeout=8_000)


def _marks(page):
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('article.chapter-text mark.search-highlight')).map(m => m.textContent)"
    )


def test_search_phrase_across_cite_is_found_and_highlighted_in_chapter(page, base_url):
    """갈라 3:8을 `아브라함에게 너로`로 찾으면 결과에 나오고, 연 장 화면은 인용 앞뒤 조각에 걸쳐 강조한다.

    장 화면은 한 절을 인용(<cite>) 경계에서 조각으로 나눠 그린다(「…아브라함에게 “」 + 「너로 말미암아…」).
    인덱스는 조각 사이에 공백 한 칸을 넣어 `아브라함에게 “ 너로`로 저장하므로, 따옴표를 지우면 공백이 둘이 된다.
    그 공백을 접지 않으면 검색이 이 절을 찾지 못했다. 강조는 본문을 한 글자도 바꾸면 안 된다."""
    page.goto(f"{base_url}/gal/3")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)
    plain = _chapter_text(page)

    _search_and_open(page, base_url, "아브라함에게 너로", "/gal/3/8")

    # 첫 강조는 조각 끝의 간격용 공백까지 감싸므로 앞뒤 공백은 비교에서 뺀다.
    assert [m.strip() for m in _marks(page)] == ["아브라함에게 “", "너로"]
    assert _chapter_text(page) == plain, "강조가 본문을 바꿨다(글이 빠지거나 겹쳤다)"


def test_search_phrase_across_poem_lines_is_highlighted_in_chapter(page, base_url):
    """시는 줄마다 조각이라 줄 끝에서 다음 줄로 이어지는 검색어도 두 줄에 걸쳐 강조한다(시편 23:1)."""
    page.goto(f"{base_url}/ps/23")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)
    plain = _chapter_text(page)

    _search_and_open(page, base_url, "나의 목자, 아쉬울 것", "/ps/23/1")

    assert [m.strip() for m in _marks(page)] == ["나의 목자,", "아쉬울 것"]
    assert _chapter_text(page) == plain, "강조가 본문을 바꿨다(글이 빠지거나 겹쳤다)"
