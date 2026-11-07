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


def _highlighted_verses(page):
    """강조된 절 번호. 시의 절은 줄마다 나뉘어 `data-vref`가 「10a」 「10b」라 번호만 본다."""
    return page.locator("article.chapter-text .verse-highlight").evaluate_all(
        "els => [...new Set(els.map(e => String(parseInt(e.dataset.vref, 10))))]"
    )


def test_verse_list_opens_chapter_and_highlights_only_those_verses(page, base_url):
    """쉼표로 이은 구절은 그 장을 열고 적은 절만 강조한다."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "요한 3:16, 18-19")
    page.press("#search-input", "Enter")

    page.wait_for_function("() => location.pathname === '/john/3/16,18-19'", timeout=5000)
    page.wait_for_selector("article.chapter-text .verse-highlight", timeout=5000)
    assert _highlighted_verses(page) == ["16", "18", "19"]


def test_verse_list_typed_out_of_order_still_highlights(page, base_url):
    """순서를 뒤바꿔 쳐도 주소 검사를 통과하는 표기로 바꿔 강조한다(ADR-040)."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "요한 3:18-19, 16")
    page.press("#search-input", "Enter")

    page.wait_for_function("() => location.pathname === '/john/3/16,18-19'", timeout=5000)
    page.wait_for_selector("article.chapter-text .verse-highlight", timeout=5000)
    assert _highlighted_verses(page) == ["16", "18", "19"]


def test_verse_list_url_shows_ref_card(page, base_url):
    """검색 주소로 바로 들어오면 구절 바로가기 카드를 보인다."""
    page.goto(f"{base_url}/search?q=%EC%9A%94%ED%95%9C%203%3A16%2C%2018-19")

    card = page.locator(".search-result-ref-card")
    card.wait_for(timeout=8000)
    assert card.get_attribute("href") == "/john/3/16,18-19"
    assert page.inner_text(".search-result-ref-title").endswith("3장 16, 18-19절")


def _commit_search(page, base_url, query):
    page.goto(base_url)
    wait_app_ready(page)
    page.fill("#search-input", query)
    page.press("#search-input", "Enter")


def _ref_cards(page):
    page.wait_for_selector(".search-result-ref-card", timeout=8000)
    return page.locator(".search-result-ref-card").evaluate_all(
        "els => els.map(e => [e.getAttribute('href'), e.querySelector('.search-result-ref-title').textContent])"
    )


def test_verses_in_two_chapters_show_a_card_per_chapter(page, base_url):
    """뒤에 장을 다시 적으면 Enter를 쳐도 이동하지 않고 장마다 카드를 보이며, 카드를 눌렀다 돌아올 수 있다."""
    _commit_search(page, base_url, "사무상 18:6-9, 19:1-7")

    cards = _ref_cards(page)
    assert [c[0] for c in cards] == ["/1sam/18/6-9", "/1sam/19/1-7"]
    assert cards[0][1].endswith("18장 6-9절") and cards[1][1].endswith("19장 1-7절")
    assert page.evaluate("location.pathname") == "/search"

    page.locator(".search-result-ref-card").nth(1).click()
    page.wait_for_selector("article.chapter-text .verse-highlight", timeout=5000)
    assert page.evaluate("location.pathname") == "/1sam/19/1-7"
    assert _highlighted_verses(page) == ["1", "2", "3", "4", "5", "6", "7"]

    page.go_back()
    assert len(_ref_cards(page)) == 2


def test_range_across_chapters_clips_to_the_last_verse(page, base_url):
    """장을 넘는 범위의 앞 장은 그 절부터 끝까지 강조하고, 주소는 실제 마지막 절로 바뀐다."""
    _commit_search(page, base_url, "이사 61:10-62:3")

    cards = _ref_cards(page)
    assert [c[0] for c in cards] == ["/isa/61/10-999", "/isa/62/1-3"]
    assert cards[0][1].endswith("61장 10절부터") and cards[1][1].endswith("62장 1-3절")

    page.locator(".search-result-ref-card").first.click()
    page.wait_for_selector("article.chapter-text .verse-highlight", timeout=5000)
    assert _highlighted_verses(page) == ["10", "11"]
    page.wait_for_function("() => location.pathname === '/isa/61/10-11'", timeout=3000)


def test_verses_after_a_range_across_chapters_belong_to_its_last_chapter(page, base_url):
    """여러 구간에 장 끝까지 가는 구간이 끼어도 강조되고, 뒤의 구간은 끝 장의 절이다."""
    _commit_search(page, base_url, "민수 13:1-2, 25-14:1상, 26-35")

    cards = _ref_cards(page)
    assert [c[0] for c in cards] == ["/num/13/1-2,25-999", "/num/14/1,26-35"]
    assert cards[0][1].endswith("13장 1-2, 25절부터") and cards[1][1].endswith("14장 1, 26-35절")

    page.locator(".search-result-ref-card").first.click()
    page.wait_for_selector("article.chapter-text .verse-highlight", timeout=5000)
    highlighted = _highlighted_verses(page)
    assert highlighted[:3] == ["1", "2", "25"] and "3" not in highlighted
    page.wait_for_function("() => /^\\/num\\/13\\/1-2,25-\\d\\d$/.test(location.pathname)", timeout=3000)


def test_chapter_only_opens_the_chapter(page, base_url):
    """장만 적으면 그 장을 강조 없이 연다."""
    _commit_search(page, base_url, "시편 116")

    page.wait_for_function("() => location.pathname === '/ps/116'", timeout=5000)
    page.wait_for_selector("article.chapter-text .verse", timeout=5000)
    assert _highlighted_verses(page) == []


def test_two_chapters_show_two_cards(page, base_url):
    _commit_search(page, base_url, "시편 42, 43")

    assert _ref_cards(page) == [["/ps/42", "시편 42편"], ["/ps/43", "시편 43편"]]


def test_half_verse_mark_opens_the_whole_verse(page, base_url):
    """상, 하 표시는 지우고 절 전체를 강조한다."""
    _commit_search(page, base_url, "사도 2:42-47상")

    page.wait_for_function("() => location.pathname === '/acts/2/42-47'", timeout=5000)
    page.wait_for_selector("article.chapter-text .verse-highlight", timeout=5000)
    assert _highlighted_verses(page) == ["42", "43", "44", "45", "46", "47"]


def test_keyword_with_comma_still_searches_text(page, base_url):
    """쉼표가 든 낱말 검색어는 구절로 읽지 않고 본문에서 찾는다."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "나의 목자, 아쉬울 것")
    page.press("#search-input", "Enter")

    # 시편은 마지막에 읽는 구약 묶음에 있어, 결과 수가 먼저 보여도 아직 없을 수 있다.
    page.wait_for_selector('.search-result-item a[href^="/ps/23/1"]', timeout=8000)
    assert page.locator(".ref-match-item").count() == 0


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


def test_search_phrase_across_cite_and_closing_quote_is_highlighted_in_chapter(page, base_url):
    """인용 조각 바로 뒤의 닫는 따옴표(`받으리라.”는 복음`)를 넘는 문구도 장 화면에서 두 조각에 걸쳐 강조한다.

    검색 색인은 인용 조각 뒤에 공백을 넣었다가 넣지 않도록 바뀐다(데이터 저장소 인덱서). 그래서 찾아지는 문구가
    색인에 따라 다르다: 옛 색인은 `받으리라. 는 복음`, 새 색인은 화면에 보이는 대로 `받으리라.”는 복음`. 어느 색인이
    쓰이든 둘 중 하나는 찾아져야 하고, 찾아진 문구는 강조가 두 조각에 걸쳐야 한다."""
    page.goto(f"{base_url}/gal/3")
    page.wait_for_selector("article.chapter-text .verse", timeout=8_000)
    plain = _chapter_text(page)

    found = None
    for query in ("받으리라.”는 복음", "받으리라. 는 복음"):
        page.goto(base_url)
        wait_app_ready(page)
        page.fill("#search-input", query)
        page.press("#search-input", "Enter")
        page.wait_for_selector(".search-count, .empty-state", timeout=8_000)
        link = page.locator('.search-result-item a[href^="/gal/3/8"]')
        if link.count() == 1:
            link.first.click()
            page.wait_for_selector("article.chapter-text mark.search-highlight", timeout=8_000)
            found = query
            break
    assert found, "두 문구 가운데 어느 것도 갈라 3:8을 찾지 못했다"

    assert [m.strip() for m in _marks(page)] == ["받으리라.", "”는 복음"], found
    assert _chapter_text(page) == plain, "강조가 본문을 바꿨다(글이 빠지거나 겹쳤다)"
