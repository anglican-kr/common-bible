"""E2E: search pipeline tests.

Covers:
  - keyword search shows results
  - verse reference auto-navigates to chapter when no lectionary day reads it
  - lectionary results (ADR-044): pills, rows, Enter rules, missing chapter, book name alone, slug landing
  - worker init failure surfaces an error message
  - verse search URL on refresh auto-navigates (regression)
  - in: operator restricts to a book / supports OR / tolerates whitespace
"""

import datetime
import time
from urllib.parse import quote

import pytest

from .conftest import CLEAR_APP_STORAGE, assert_sheet_close_button, emulate_status_bar, wait_app_ready

BASE_URL = "http://localhost:8080"
SEARCH_URL = f"{BASE_URL}/search?q=%EC%B0%BD%EC%84%B8%201%3A1"


def test_keyword_search_shows_results(page, base_url):
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑")
    page.press("#search-input", "Enter")

    page.wait_for_selector(".search-count, .search-empty", timeout=8000)
    assert page.locator(".search-result-item").count() > 0


@pytest.mark.parametrize("ctx_name", ["mobile_context", "desktop_context"])
def test_book_filter_sheet_closes_with_its_close_button(ctx_name, request):
    """책 선택 시트(휴대폰은 바텀 시트, 데스크톱은 오른쪽 패널)의 머리에는 다른 시트와 같은 「닫기」 글자 단추가 있다. 누르면 닫히고 포커스는
    시트를 연 깔때기 단추로 돌아간다."""
    page = request.getfixturevalue(ctx_name).new_page()
    page.goto(f"{BASE_URL}/search?q={quote('사랑')}")
    funnel = page.locator(".token-funnel:visible").first
    funnel.wait_for(timeout=20_000)
    funnel.click()
    page.wait_for_selector("#book-filter-sheet:not([hidden])")
    page.wait_for_timeout(300)
    assert_sheet_close_button(page, ".book-filter-close")
    page.locator(".book-filter-close").click()
    page.wait_for_selector("#book-filter-sheet", state="hidden")
    assert page.evaluate("document.activeElement.classList.contains('token-funnel')")


def _apply_books_to_typed_query(page, ctx_name, typed, book_id):
    """검색 입력 칸에 `typed`를 치고 Enter는 누르지 않은 채, 깔때기로 책 선택 시트를 열어 `book_id`를 고르고 「적용」을 누른다.
    휴대폰은 탭 바의 검색 입력(`#tab-search-dock`), 데스크톱은 상단 바의 검색 입력(`#search-bar`)이다. 그 입력 칸의 선택자를 돌려준다."""
    page.goto(BASE_URL)
    wait_app_ready(page)
    if ctx_name == "mobile_context":
        page.locator("#tab-search").click()
        page.wait_for_selector("#tab-search-input:not([hidden])")
        bar, field = "#tab-search-dock", "#tab-search-input"
    else:
        bar, field = "#search-bar", "#search-input"
    page.locator(field).fill(typed)
    page.locator(f"{bar} .token-funnel").click()
    page.wait_for_selector(f'#book-filter-sheet:not([hidden]) .book-filter-option[data-book-id="{book_id}"]', timeout=20_000)
    page.locator(f'#book-filter-sheet .book-filter-option[data-book-id="{book_id}"]').click()
    page.locator("#book-filter-sheet .book-filter-apply").click()
    return field


FIVE_BOOKS = ["gen", "exod", "lev", "num", "deut"]


def test_book_filter_sheet_takes_five_books(desktop_context):
    """책 선택 시트에서는 다섯 권까지 고른다. 다섯 권을 고르면 고르지 않은 책은 흐려지고 누를 수 없으며, 「적용」 위에 「책은 5권까지 고를 수
    있습니다.」가 보인다. 한 권을 빼면 다시 고를 수 있다(ADR-033 「책은 5권까지」, 사용자 결정 2026-11-18)."""
    page = desktop_context.new_page()
    page.goto(f"{BASE_URL}/search?q={quote('사랑')}")
    page.wait_for_selector(".search-count", timeout=20_000)
    page.locator("#search-bar .token-funnel").click()
    opt = lambda book: page.locator(f'#book-filter-sheet .book-filter-option[data-book-id="{book}"]')
    opt("gen").wait_for(timeout=20_000)
    for book in FIVE_BOOKS:
        opt(book).click()
    state = page.evaluate("""() => ({
        note: document.querySelector('#book-filter-sheet .book-filter-limit').textContent,
        disabled: document.querySelectorAll('#book-filter-sheet .book-filter-option[aria-disabled="true"]').length,
        options: document.querySelectorAll('#book-filter-sheet .book-filter-option').length,
        apply: document.querySelector('#book-filter-sheet .book-filter-apply').textContent,
    })""")
    assert state["note"] == "책은 5권까지 고를 수 있습니다.", state
    assert state["disabled"] == state["options"] - 5, state
    assert state["apply"] == "적용 (5)", state

    # Playwright는 aria-disabled인 요소를 누르지 않는다. 사람은 누를 수 있으므로 force로 누른다
    opt("matt").click(force=True)
    assert opt("matt").get_attribute("aria-selected") == "false"
    assert page.locator("#book-filter-sheet .book-filter-apply").text_content() == "적용 (5)"

    opt("deut").click()
    assert page.locator("#book-filter-sheet .book-filter-limit").text_content() == ""
    assert page.locator('#book-filter-sheet .book-filter-option[aria-disabled="true"]').count() == 0
    opt("matt").click()
    assert opt("matt").get_attribute("aria-selected") == "true"


def test_typed_in_cannot_add_a_sixth_book(page, base_url):
    """칩이 다섯 권이면 입력 칸의 `in:`은 여섯째 칩이 되지 않고 입력 칸에 글로 남는다. 검색 워커는 칩과 `in:`을 합쳐 세므로 찾지 않고,
    결과 없음 화면에 「책은 5권까지 고를 수 있습니다.」를 보인다. 이런 검색은 최근 검색에 남지 않는다(ADR-033 「책은 5권까지」, ADR-014 D1,
    사용자 결정 2026-11-18). 처음에는 여섯째 칩을 만들고 결과 화면에서만 알렸다."""
    page.goto(f"{base_url}/search?" + "&".join(f"in={b}" for b in FIVE_BOOKS))
    page.wait_for_selector("#search-bar .field-token", timeout=20_000)
    page.fill("#search-input", "사랑 in:요한")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".empty-state", timeout=20_000)
    state = page.evaluate("""() => ({
        text: document.querySelector('.empty-state').innerText,
        chips: document.querySelectorAll('#search-bar .field-token').length,
        q: new URLSearchParams(location.search).get('q'),
        books: new URLSearchParams(location.search).getAll('in'),
        field: document.querySelector('#search-input').value,
        recent: JSON.parse(localStorage.getItem('bible-search-history') || '[]').map((e) => e.q),
    })""")
    assert "책은 5권까지 고를 수 있습니다." in state["text"], state
    assert state["chips"] == 5 and state["books"] == FIVE_BOOKS, state
    assert state["q"] == "사랑 in:요한" and state["field"] == "사랑 in:요한", state
    assert state["recent"] == [], state


def test_book_filter_apply_is_blocked_past_five(desktop_context):
    """주소로 다섯 권을 넘긴 채 책 선택 시트를 열면, 다섯 권 이하로 뺄 때까지 「적용」을 누를 수 없고 안내가 보인다(ADR-033 「책은 5권까지」)."""
    page = desktop_context.new_page()
    page.goto(f"{BASE_URL}/search?q={quote('사랑')}&" + "&".join(f"in={b}" for b in FIVE_BOOKS + ["matt"]))
    page.wait_for_selector(".empty-state", timeout=20_000)
    assert "책은 5권까지 고를 수 있습니다." in page.locator(".empty-state").inner_text()
    page.locator("#search-bar .token-funnel").click()
    apply = page.locator("#book-filter-sheet .book-filter-apply")
    apply.wait_for(timeout=20_000)
    assert apply.get_attribute("aria-disabled") == "true"
    assert page.locator("#book-filter-sheet .book-filter-limit").text_content() == "책은 5권까지 고를 수 있습니다."
    url = page.url
    # Playwright는 aria-disabled인 요소를 누르지 않는다. 사람은 누를 수 있으므로 force로 누른다
    apply.click(force=True)
    assert page.url == url and page.locator("#book-filter-sheet").is_visible()
    page.locator('#book-filter-sheet .book-filter-option[data-book-id="matt"]').click()
    assert apply.get_attribute("aria-disabled") is None
    apply.click()
    page.wait_for_selector(".search-count", timeout=20_000)
    assert page.evaluate("new URLSearchParams(location.search).getAll('in')") == FIVE_BOOKS


@pytest.mark.parametrize("typed", ["", "in:마르"])
def test_scope_without_a_word_asks_for_one(typed, page, base_url):
    """책 칩만 두고 빈 입력 칸에서 Enter를 누르거나 `in:마르`처럼 범위만 쳐서 찾으면, 검색 화면에 「검색어를 입력해주세요.」를 보인다
    (ADR-033 「책은 5권까지」, 사용자 결정 2026-11-18). 그전에는 아무 안내 없이 최근 검색 화면이 나왔다."""
    page.goto(f"{base_url}/search?in=matt")
    page.wait_for_selector("#search-bar .field-token", timeout=20_000)
    page.fill("#search-input", typed)
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-keyword-note", timeout=20_000)
    state = page.evaluate("""() => ({
        note: document.querySelector('.search-keyword-note').textContent,
        q: new URLSearchParams(location.search).get('q'),
        books: new URLSearchParams(location.search).getAll('in'),
        recent: JSON.parse(localStorage.getItem('bible-search-history') || '[]').length,
    })""")
    assert state["note"] == "검색어를 입력해주세요.", state
    assert state["q"] is None and state["books"] == (["matt", "mark"] if typed else ["matt"]), state
    assert state["recent"] == 0, state


@pytest.mark.parametrize("ctx_name", ["mobile_context", "desktop_context"])
def test_book_filter_apply_searches_the_typed_query(ctx_name, request):
    """책 선택 시트의 「적용」은 입력 칸에 보이는 검색어를 고른 책 안에서 찾는다(ADR-033 D3). Enter를 누르지 않고 친 검색어도
    찾고, Enter처럼 고른 책과 함께 최근 검색에 넣는다(ADR-014 D1). 포커스는 깔때기로 돌아가 휴대폰에서 키보드가 결과를 가리지 않는다.
    범위만 주소에 넣던 때는 친 검색어가 지워지고 최근 검색 화면이 나왔다(사용자 보고 2026-11-18)."""
    page = request.getfixturevalue(ctx_name).new_page()
    field = _apply_books_to_typed_query(page, ctx_name, "사랑", "mark")
    page.wait_for_selector(".search-count", timeout=20_000)
    state = page.evaluate(f"""() => ({{
        q: new URLSearchParams(location.search).getAll('q'),
        books: new URLSearchParams(location.search).getAll('in'),
        refs: [...document.querySelectorAll('.search-result-ref')].map((n) => n.textContent),
        field: document.querySelector('{field}').value,
        recent: (JSON.parse(localStorage.getItem('bible-search-history') || '[]')[0] || {{}}).q,
        funnelFocused: document.activeElement.classList.contains('token-funnel'),
    }})""")
    assert state["q"] == ["사랑"] and state["books"] == ["mark"], state
    assert state["refs"] and all(r.startswith("마르코의 복음서 ") for r in state["refs"]), state
    assert state["field"] == "사랑", state
    assert state["recent"] == "사랑 in:마르", state
    assert state["funnelFocused"], state


def _recent_queries(page):
    return page.evaluate("JSON.parse(localStorage.getItem('bible-search-history') || '[]').map((e) => e.q)")


def _search_params(page):
    return page.evaluate("({ q: new URLSearchParams(location.search).get('q'), books: new URLSearchParams(location.search).getAll('in') })")


def test_recent_search_keeps_and_replays_its_book_scope(mobile_context):
    """최근 검색은 찾은 낱말과 그때 고른 책을 `세리 in:마르`처럼 함께 저장하고, 누르면 검색창의 칩을 그 범위로 바꿔 찾는다. 범위 없이
    저장된 기록은 칩을 지우고 성경 전체에서 찾는다(ADR-014 D1, D2). 깔때기로 마르코를 고르고 찾은 「세리」가 「세리」로만 남아, 칩을
    지운 뒤 누르면 성경 전체에서 찾던 때가 있었다(사용자 보고 2026-11-18)."""
    page = mobile_context.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)
    page.evaluate("localStorage.setItem('bible-search-history', JSON.stringify([{ q: '사랑', ts: Date.now() }]))")

    # 마르코를 골라 둔 검색 화면에서 「세리」를 Enter로 찾는다
    page.goto(f"{BASE_URL}/search?in=mark")
    field = page.locator("#search-inpage-input")
    field.wait_for(timeout=20_000)
    field.fill("세리")
    field.press("Enter")
    page.wait_for_selector(".search-count", timeout=20_000)
    assert _recent_queries(page) == ["세리 in:마르", "사랑"]

    # 칩이 없는 검색 화면에서 그 기록을 누르면 마르코 안에서 찾는다
    page.goto(f"{BASE_URL}/search")
    page.locator(".search-recent-text", has_text="세리 in:마르").click()
    page.wait_for_function("new URLSearchParams(location.search).get('q') === '세리'", timeout=20_000)
    assert _search_params(page) == {"q": "세리", "books": ["mark"]}

    # 마태오를 골라 둔 채 범위 없는 기록 「사랑」을 누르면 칩을 지우고 성경 전체에서 찾는다
    page.goto(f"{BASE_URL}/search?in=matt")
    page.locator(".search-recent-text").get_by_text("사랑", exact=True).click()
    page.wait_for_function("new URLSearchParams(location.search).get('q') === '사랑'", timeout=20_000)
    assert _search_params(page) == {"q": "사랑", "books": []}
    assert _recent_queries(page) == ["사랑", "세리 in:마르"]


@pytest.mark.parametrize("ctx_name", ["mobile_context", "desktop_context"])
def test_book_filter_apply_with_only_a_typed_scope_focuses_the_field(ctx_name, request):
    """입력 칸에 `in:<별칭>`만 치고 「적용」을 누르면 별칭은 칩이 되고 찾을 낱말이 없어 최근 검색 화면에 간다. 검색어가 없을 때와
    같이 포커스를 입력 칸에 두어 바로 칠 수 있게 한다(ADR-033 D3). 칸에 글이 있었다고 검색한 것으로 보면 포커스가 깔때기에 남는다."""
    page = request.getfixturevalue(ctx_name).new_page()
    field = _apply_books_to_typed_query(page, ctx_name, "in:마르", "matt")
    page.wait_for_selector(".search-empty-dynamic", timeout=20_000)
    state = page.evaluate(f"""() => ({{
        q: new URLSearchParams(location.search).get('q'),
        books: new URLSearchParams(location.search).getAll('in').sort(),
        focused: document.activeElement === document.querySelector('{field}'),
    }})""")
    assert state["q"] is None and state["books"] == ["mark", "matt"], state
    assert state["focused"], state
    assert page.locator(".search-keyword-note").text_content() == "검색어를 입력해주세요."


@pytest.mark.parametrize("typed", ["아들", None])
def test_book_filter_apply_from_the_in_page_bar_focuses_its_new_funnel(typed, mobile_context):
    """휴대폰의 페이지 안 검색창(탭 바 검색을 열지 않고 들어온 검색 화면)에서 연 시트로 찾으면, 결과 화면이 그 검색창을 새로 그린다.
    포커스는 새 검색창의 깔때기로 간다(ADR-033 D3, WCAG 2.4.3). 옛 깔때기와 함께 사라져 문서 본문에 남던 때가 있었다(코드 리뷰
    2026-11-18). 새로 친 검색어(「아들」)와, 검색어는 그대로 두고 책만 고른 경우(None)를 본다."""
    page = mobile_context.new_page()
    page.goto(f"{BASE_URL}/search?q={quote('사랑')}")
    page.wait_for_selector(".search-count", timeout=20_000)
    bar = "#search-inpage-bar"
    if typed is not None:
        page.locator(f"{bar} #search-inpage-input").fill(typed)
    page.locator(f"{bar} .token-funnel").click()
    page.wait_for_selector('#book-filter-sheet:not([hidden]) .book-filter-option[data-book-id="mark"]', timeout=20_000)
    page.locator('#book-filter-sheet .book-filter-option[data-book-id="mark"]').click()
    page.locator("#book-filter-sheet .book-filter-apply").click()
    # 새 결과(모두 마르코의 복음서)가 그려질 때까지 기다린다. 옛 결과의 머리(.search-count)가 남아 있을 수 있다
    page.wait_for_function("""() => {
        const refs = [...document.querySelectorAll('.search-result-ref')].map((n) => n.textContent);
        return refs.length > 0 && refs.every((r) => r.startsWith('마르코의 복음서 '));
    }""", timeout=20_000)
    state = page.evaluate("""() => ({
        q: new URLSearchParams(location.search).get('q'),
        funnelFocused: document.activeElement === document.querySelector('#search-inpage-bar .token-funnel'),
        active: document.activeElement.id || document.activeElement.className || document.activeElement.tagName,
    })""")
    assert state["q"] == (typed or "사랑"), state
    assert state["funnelFocused"], state


def test_book_filter_apply_keeps_a_typed_verse_reference_on_the_results(desktop_context):
    """「적용」이 친 검색어를 함께 찾아도 구절 표기로 장을 바로 열지 않는다. 장으로 바로 가는 것은 Enter뿐이다(ADR-033 D3).
    요한 7:16은 읽는 전례일이 없어 Enter면 장을 연다(`test_verse_reference_navigates_to_chapter`)."""
    page = desktop_context.new_page()
    _apply_books_to_typed_query(page, "desktop_context", "요한 7:16", "john")
    page.wait_for_selector(".search-result-ref-card", timeout=20_000)
    assert page.evaluate("location.pathname") == "/search"


@pytest.mark.only_browser("chromium")
def test_page_size_counts_the_status_bar_in_the_top_bar(mobile_context):
    """한 쪽의 결과 수는 상단 바 아래에 남는 화면 높이로 어림한다(결과 하나에 80px). 상단 바의 아래쪽은 잰다(helpers.js `barBottom`).
    Chromium에서 상태 표시줄 높이를 62px로 정해, 아이폰 홈 화면 앱이 상태 표시줄 밑까지 그리는 상태를 시뮬레이션한다. 헤더 요소(`#app-header`)만 재던
    때는 상단 바 묶음(`#sticky-group`)의 위 여백인 상태 표시줄 높이를 빼지 않아, 한 쪽에 결과가 하나 더 들어갔다(844px 화면에서 8건이 아니라 9건)."""
    page = mobile_context.new_page()
    emulate_status_bar(page, 62)
    page.goto(f"{BASE_URL}/search?q=%EC%82%AC%EB%9E%91")   # 사랑 — 결과가 여러 쪽이다
    page.wait_for_selector(".search-pagination", timeout=20_000)
    state = page.evaluate("""() => ({
        items: document.querySelectorAll('.search-result-item').length,
        bar: document.getElementById('sticky-group').getBoundingClientRect().bottom,
        header: document.getElementById('app-header').getBoundingClientRect().height,
        height: window.innerHeight,
    })""")
    assert state["bar"] > state["header"] + 60, state   # 상태 표시줄 높이가 상단 바에 들어 있다
    assert state["items"] == max(5, (state["height"] - state["bar"] - 40) // 80), state


def test_verse_reference_navigates_to_chapter(page, base_url):
    """전례독서에서 읽지 않는 구절은 Enter로 그 장을 연다(ADR-044 §1). 요한 7:16은 읽는 전례일이 없다."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "요한 7:16")
    page.press("#search-input", "Enter")

    page.wait_for_function("() => location.pathname.startsWith('/john/7')", timeout=5000)
    assert page.evaluate("location.pathname").startswith("/john/7")


def _highlighted_verses(page):
    """강조된 절 번호. 시의 절은 줄마다 나뉘어 `data-vref`가 「10a」 「10b」라 번호만 본다."""
    return page.locator("article.chapter-text .verse-highlight").evaluate_all(
        "els => [...new Set(els.map(e => String(parseInt(e.dataset.vref, 10))))]"
    )


def test_verse_list_opens_chapter_and_highlights_only_those_verses(page, base_url):
    """쉼표로 이은 구절은 그 장을 열고 적은 절만 강조한다."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "요한 7:16, 18-19")
    page.press("#search-input", "Enter")

    page.wait_for_function("() => location.pathname === '/john/7/16,18-19'", timeout=5000)
    page.wait_for_selector("article.chapter-text .verse-highlight", timeout=5000)
    assert _highlighted_verses(page) == ["16", "18", "19"]


def test_verse_list_typed_out_of_order_still_highlights(page, base_url):
    """순서를 뒤바꿔 쳐도 주소 검사를 통과하는 표기로 바꿔 강조한다(ADR-040)."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "요한 7:18-19, 16")
    page.press("#search-input", "Enter")

    page.wait_for_function("() => location.pathname === '/john/7/16,18-19'", timeout=5000)
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
    _commit_search(page, base_url, "시편 83")

    page.wait_for_function("() => location.pathname === '/ps/83'", timeout=5000)
    page.wait_for_selector("article.chapter-text .verse", timeout=5000)
    assert _highlighted_verses(page) == []


def test_two_chapters_show_two_cards(page, base_url):
    _commit_search(page, base_url, "시편 42, 43")

    assert _ref_cards(page) == [["/ps/42", "시편 42편"], ["/ps/43", "시편 43편"]]


def test_half_verse_mark_opens_the_whole_verse(page, base_url):
    """상, 하 표시는 지우고 절 전체를 강조한다."""
    _commit_search(page, base_url, "사도 21:4-6상")

    page.wait_for_function("() => location.pathname === '/acts/21/4-6'", timeout=5000)
    page.wait_for_selector("article.chapter-text .verse-highlight", timeout=5000)
    assert _highlighted_verses(page) == ["4", "5", "6"]


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


def test_unknown_book_leaves_no_recent_before_the_alias_map_loads(page, base_url):
    """앱의 별칭 맵을 읽기 전(앱을 켠 직후)에 모르는 책 이름으로 찾아도 최근 검색에 남지 않는다. 검색을 실행할 때 넣은 줄을 검색 워커가
    모르는 책 이름이라고 답하면 다시 뺀다(ADR-014 D1). 앱이 별칭 맵으로 가려내던 때는 이때 기록에 남았다(사용자 결정 2026-11-18).
    책 목록(`books.json`)을 받지 못하게 해 별칭 맵이 없는 상태를 만든다. 검색 워커는 책 목록 없이 찾는다."""
    page.route("**/data/books.json", lambda route: route.abort())
    page.goto(base_url)
    page.wait_for_selector("#search-input", state="attached")

    page.fill("#search-input", "사랑 in:없는책")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".empty-state", timeout=20_000)
    assert "‘없는책’이라는 책을 찾지 못했어요." in page.locator(".empty-state").inner_text()
    recent = page.evaluate("JSON.parse(localStorage.getItem('bible-search-history') || '[]').map((e) => e.q)")
    assert recent == [], recent


@pytest.mark.parametrize("alias", ["마르", "막", "마가복음", "mark"])
def test_in_operator_alias_becomes_a_chip(alias, page, base_url):
    """입력 칸에 친 `in:<별칭>`은 검색이 알아보는 별칭이면 모두 책 칩이 되고, 입력 칸에는 낱말만 남는다(ADR-033). 그전에는 책의 짧은
    이름과 전체 이름만 칩이 되고, 다른 별칭(`막`, `마가복음`, 책 id)은 결과는 맞지만 입력 칸에 글로 남았다(사용자 결정 2026-11-18)."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", f"사랑 in:{alias}")
    page.press("#search-input", "Enter")
    page.wait_for_selector("#search-bar .field-token", timeout=20_000)
    state = page.evaluate("""() => ({
        q: new URLSearchParams(location.search).get('q'),
        books: new URLSearchParams(location.search).getAll('in'),
        field: document.querySelector('#search-input').value,
        chips: [...document.querySelectorAll('#search-bar .field-token')].map((n) => n.textContent),
    })""")
    assert state["q"] == "사랑" and state["books"] == ["mark"] and state["field"] == "사랑", state
    assert len(state["chips"]) == 1 and "마르" in state["chips"][0], state


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


@pytest.mark.parametrize("name, particle", [("없는책", "이라는"), ("없는송가", "라는")])
def test_in_operator_unmatched_alias_blocks_search(name, particle, page, base_url):
    """`사랑 in:없는책`은 찾지 않고, 다른 결과 없음 화면과 같은 모양으로 그 책을 찾지 못했다고 알리며 고치는 방법을 적는다. 검색 예시에는
    책 범위 예시(`사랑 in:요한`)도 있다. 최근 검색에는 넣지 않는다(ADR-005 「검색 연산자 `in:`」, ADR-014 D1). 결과 위에 「in:없는책 —
    알 수 없는 책 별칭입니다」 한 줄만 보이던 때가 있었다(사용자 결정 2026-11-18). 받침이 없는 이름은 「라는」이다. 송가는 성시 색인에
    들어가 이제 칩이 된다(ADR-046 §2, `test_psalter_book_filter_group_and_chips`)."""
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-count", timeout=20_000)
    page.fill("#search-input", f"사랑 in:{name}")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".empty-state", timeout=20_000)
    assert page.locator(".search-result-item:not(.ref-match-item)").count() == 0
    empty_text = page.locator(".empty-state").inner_text()
    assert "검색 결과가 없습니다" in empty_text, empty_text
    assert f"‘{name}’{particle} 책을 찾지 못했어요. in: 뒤에는 마르, 마르코처럼 책 이름을 적어 주세요." in empty_text, empty_text
    assert page.locator("#search-bar .field-token").count() == 0
    examples = page.locator(".search-example-q").all_inner_texts()
    assert "사랑 in:요한" in examples, examples
    recent = page.evaluate("JSON.parse(localStorage.getItem('bible-search-history') || '[]').map((e) => e.q)")
    assert recent == ["사랑"], recent


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



# ── 전례독서 검색(ADR-044) ───────────────────────────────────────────────────

def _wait_search_done(page):
    """검색이 끝날 때까지 기다린다. 신약 색인을 먼저 받으면 구약과 외경 색인을 받는 동안 「"…" 검색 중… (현재 N건)」
    제목으로 먼저 그리고, 다 받으면 화면을 다시 그린다. 그 전에 읽거나 누르면 바뀌기 전의 화면을 본다."""
    page.wait_for_function("() => !document.querySelector('h2.search-count')?.textContent.includes('검색 중')",
                           timeout=15_000)


def _goto_search(page, query, extra=""):
    page.goto(f"{BASE_URL}/search?q={quote(query)}{extra}")
    page.wait_for_selector(".search-count, .empty-state, .search-alert, .search-note", timeout=10_000)
    _wait_search_done(page)


# 줄이 여는 날은 오늘에 따라 바뀐다(ADR-044 §1). 날짜를 보는 시험은 시안과 같은 날로 시계를 고정한다. 2026 전례년(가해)의 끝이다
TODAY = datetime.datetime(2026, 11, 16, 12)


def _fix_today(page):
    page.clock.set_fixed_time(TODAY)


def _wait_days(page):
    """줄에 날짜가 들어갈 때까지 기다린다."""
    page.wait_for_function("() => [...document.querySelectorAll('.lect-rows .cal-row-meta')].some((m) => /지난|다음|오늘/.test(m.textContent))",
                           timeout=15_000)


def test_verse_read_on_lectionary_days_shows_them_on_enter(page, base_url):
    """전례일이 있는 구절은 Enter를 쳐도 장을 열지 않고 「이 구절을 읽는 날」을 보인다(ADR-044 §1)."""
    _fix_today(page)
    page.goto(base_url)
    wait_app_ready(page)
    page.fill("#search-input", "요한 3:16")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".lect-rows a", timeout=10_000)

    assert page.evaluate("location.pathname") == "/search"
    assert page.inner_text(".search-result-ref-title") == "요한의 복음서 3장 16절"
    assert page.inner_text("h2.search-count") == "이 구절을 읽는 날 5건"
    first = page.locator(".lect-rows a").first
    # 찾은 독서의 자리와 독서 데이터의 표기, 색과 주기, 그리고 여는 날(이번 전례년의 날, 지났어도 그날)
    assert first.get_attribute("aria-label") == "사순2주일, 복음 요한 3:1-17, 자색, 가해, 지난 2026년 3월 1일 일요일"
    assert first.get_attribute("href") == "/lectionary/d/lent-2-sun-A-t1-s1"
    page.wait_for_function("() => document.getElementById('a11y-announce').textContent.includes('이 구절을 읽는 날 5건')")


def test_canticle_row_shows_its_name_from_the_reading_data(page):
    """송가는 독서 데이터의 표기라 송가 이름이 보인다(ADR-044 §1)."""
    _goto_search(page, "루가 1:68")
    labels = page.locator(".lect-rows a.cal-row").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
    assert any(label.startswith("대림2주일, 성시 루가 1:68-79 (즈가리야 송가), ") for label in labels), labels


def test_pills_choose_bible_or_lectionary_and_keep_focus(page):
    """두 자료에 모두 결과가 있으면 알약으로 고르고, 고른 알약은 주소에 적고 포커스가 남는다(ADR-044 §1)."""
    _goto_search(page, "베드로")
    pills = page.locator(".search-pill")
    assert pills.count() == 2
    assert pills.nth(0).get_attribute("aria-current") == "true"
    assert page.inner_text("h2.search-count").startswith("성서 본문 198건 (1/")
    assert page.locator(".lect-rows").count() == 0

    pills.nth(1).click()
    page.wait_for_url("**group=lectionary")
    page.wait_for_selector(".lect-rows")
    assert page.inner_text("h2.search-count") == "전례일 3건"
    assert page.locator(".search-results .search-result-item").count() == 0
    page.wait_for_function("() => document.activeElement?.dataset.focusKey === 'group:lectionary'")

    # 새 검색어는 다시 성서 본문부터 보인다
    page.fill("#search-input", "바울로")
    page.press("#search-input", "Enter")
    page.wait_for_function("() => new URLSearchParams(location.search).get('q') === '바울로'")
    page.wait_for_selector(".search-pill[aria-current='true']")
    assert "group=" not in page.url
    assert page.inner_text(".search-pill[aria-current='true']").startswith("성서 본문")


def test_lectionary_only_results_have_no_pills(page):
    _goto_search(page, "성령강림")
    assert page.locator(".search-pill").count() == 0
    assert page.inner_text("h2.search-count") == "전례일 1건"


def test_word_without_lectionary_days_names_the_bible_group(page):
    """성서 본문에만 결과가 있으면 알약 없이 「성서 본문 N건」이다(ADR-044 §1). 세리는 성시에도 전례일에도 없다."""
    _goto_search(page, "세리")
    assert page.locator(".search-pill").count() == 0
    assert page.inner_text("h2.search-count").startswith("성서 본문 ")


def test_synonym_is_told_in_one_line(page):
    _goto_search(page, "주님 부활 대축일")
    assert page.inner_text(".search-note") == "‘주님 부활 대축일’을 ‘부활대축일’로 찾았습니다."


def test_book_scope_hides_lectionary_days(page):
    """책 고르기로 책을 골라 두었으면 전례일 결과를 보이지 않는다(ADR-044 §1)."""
    _goto_search(page, "베드로", "&in=matt")
    assert page.locator(".search-pill").count() == 0
    assert page.locator(".lect-rows").count() == 0


def test_christmas_weekdays_show_the_name_of_the_day_they_open(page):
    """날짜로 독서가 정해진 성탄 평일은 색인의 이름(「성탄주간」)이 아니라 열리는 날의 이름을 적는다(ADR-044 §3)."""
    _fix_today(page)
    _goto_search(page, "성탄주간")
    _wait_days(page)
    titles = page.locator(".lect-rows .cal-row-title").all_inner_texts()
    assert len(titles) == 13
    # 해마다 같은 독서라 다가오는 2026년 성탄 평일의 이름이다(ADR-044 §1, 2026-11-17)
    assert titles[:3] == ["성탄 1주 화요일", "성탄 1주 수요일", "성탄 1주 목요일"]
    assert "성탄주간" not in titles
    assert "다음 2026년 12월 29일 (화)" in page.locator(".lect-rows .cal-row-meta").first.inner_text()


def test_christmas_weekday_is_found_by_its_name_on_screen(page):
    """화면의 이름(「성탄 1주 수요일」)으로도 찾는다. 앱을 연 뒤 처음 찾아도 나오고, 이번 전례년의 그 이름의 날을 연다(ADR-044 §3)."""
    _fix_today(page)
    _goto_search(page, "성탄 1주 수요일")
    _wait_days(page)
    assert page.locator(".lect-rows .cal-row-title").all_inner_texts() == ["성탄 1주 수요일"]
    assert "다음 2026년 12월 30일 (수)" in page.inner_text(".lect-rows .cal-row-meta")
    # 성탄 평일은 해마다 같은 날짜의 같은 독서라 다음 링크가 없다(ADR-044 §1)
    assert page.locator(".lect-rows .lect-row-next").count() == 0


def test_row_shows_the_day_it_opens_and_a_link_to_the_next(page):
    """줄에는 여는 날과 그날의 색을 적고, 해에 따라 다른 독서가 지난날을 열 때만 다음에 읽는 날의 링크를 따로 둔다(ADR-044 §1)."""
    _fix_today(page)
    _goto_search(page, "요한 3:16")
    _wait_days(page)
    rows = page.locator(".lect-rows > li")
    first, second = rows.nth(0), rows.nth(1)
    assert first.locator(".cal-row-color").inner_text() == "자색"
    assert "지난 2026년 3월 1일 (일)" in first.locator(".cal-row-meta").inner_text()
    nxt = first.locator(".lect-row-next")
    assert nxt.get_attribute("href") == "/lectionary/d/lent-2-sun-A-t1-s1?from=2029-02-25"
    assert nxt.get_attribute("aria-label") == "사순2주일, 다음 2029년 2월 25일 일요일"
    # 이번 전례년에 읽지 않는 나해의 독서는 다음 날을 열고, 따로 둘 링크가 없다
    assert "다음 2027년 3월 7일 (일)" in second.locator(".cal-row-meta").inner_text()
    assert second.locator(".lect-row-next").count() == 0
    # 해마다 같은 독서는 다가오는 날을 열고, 링크도 다음 해의 날도 없다(2026-11-17)
    third, fifth = rows.nth(2), rows.nth(4)
    assert third.locator(".lect-row-next").count() == 0
    assert "다음 2027년 4월 7일 (수)" in third.locator(".cal-row-meta").inner_text()
    assert fifth.locator(".lect-row-next").count() == 0
    assert "다음 2027년 9월 14일 (화)" in fifth.locator(".cal-row-meta").inner_text()
    assert "년에는" not in page.inner_text(".lect-rows")

    nxt.click()
    page.wait_for_function("() => location.pathname === '/lectionary/2029-02-25'", timeout=15_000)
    page.wait_for_selector(".lect-day", timeout=15_000)
    assert "사순" in page.inner_text(".lect-day")


def test_bible_results_do_not_wait_for_the_engine(browser):
    """「성서 본문」 묶음만 보이면 전례일 줄의 날짜를 기다리지 않는다. 엔진의 자료가 오지 않아도 3초 전에 그린다(코드 리뷰 2026-11-16)."""
    ctx = browser.new_context(service_workers="block")
    held = []
    ctx.route("**/lectionary/eucharist-readings.json", lambda route: held.append(route))
    page = ctx.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)
    start = time.monotonic()
    page.goto(f"{BASE_URL}/search?q={quote('베드로')}")
    page.wait_for_function(
        "() => document.querySelector('h2.search-count')?.textContent.startsWith('성서 본문 198건')", timeout=10_000)
    assert time.monotonic() - start < 2.8, "날짜를 기다리느라 늦게 그렸다"
    assert page.locator(".search-pill").count() == 2
    for route in held:
        route.continue_()
    ctx.close()


def test_late_engine_puts_the_days_in_place_and_keeps_focus(browser):
    """교회력 엔진의 자료가 3초 안에 오지 않으면 날짜 없이 그리고, 나중에 줄의 글만 바꿔 넣는다. 포커스가 남는다(ADR-044 §1)."""
    ctx = browser.new_context(service_workers="block")
    held = []
    ctx.route("**/lectionary/eucharist-readings.json", lambda route: held.append(route))
    page = ctx.new_page()
    _fix_today(page)
    page.goto(f"{BASE_URL}/search?q={quote('성령강림')}")
    page.wait_for_selector(".lect-rows a.cal-row", timeout=20_000)
    assert not page.locator(".lect-rows .cal-row-meta").count() or "다음" not in page.inner_text(".lect-rows")
    page.locator(".lect-rows a.cal-row").first.focus()
    page.evaluate("document.activeElement.dataset.mark = 'focused'")
    for route in held:
        route.continue_()
    _wait_days(page)
    assert "지난 2026년 5월 24일 (일)" in page.inner_text(".lect-rows .cal-row-meta")
    # 같은 링크에 포커스가 남았다(줄을 새로 만들지 않고 글만 바꿨다)
    assert page.evaluate("document.activeElement?.dataset.mark") == "focused"
    links = page.locator(".lect-rows > li").first.locator(".lect-row-next")
    assert [links.nth(i).get_attribute("href").split("?")[1] for i in range(links.count())] == ["from=2027-05-16", "from=2028-06-04"]
    ctx.close()


def test_name_row_links_the_days_of_the_other_years(page):
    """이름으로 찾은 줄이 해에 따라 다른 독서를 읽으면 열리는 날의 해를 적고, 다른 해의 날을 해마다 하나씩 한 줄에 하나씩 링크로 둔다.
    열리는 날이 지났든 아니든 둔다(ADR-044 §1)."""
    _fix_today(page)
    _goto_search(page, "성령강림대축일")
    _wait_days(page)
    row = page.locator(".lect-rows > li").first
    assert "가해" in row.locator(".cal-row-meta").inner_text()
    links = row.locator(".lect-row-next")
    assert [links.nth(i).get_attribute("aria-label") for i in range(links.count())] == [
        "성령강림대축일, 나해 2027년 5월 16일 일요일", "성령강림대축일, 다해 2028년 6월 4일 일요일"]
    first, second = links.nth(0).bounding_box(), links.nth(1).bounding_box()
    assert second["y"] >= first["y"] + first["height"], "링크는 한 줄에 하나다"
    links.nth(1).click()
    page.wait_for_function("() => location.pathname === '/lectionary/2028-06-04'", timeout=15_000)
    page.wait_for_selector(".lect-day", timeout=15_000)
    assert "성령강림" in page.inner_text(".lect-day")

    # 두 해 주기는 링크가 하나다
    _goto_search(page, "연중1주 월요일")
    _wait_days(page)
    row = page.locator(".lect-rows > li").first
    assert "짝수해" in row.locator(".cal-row-meta").inner_text()
    links = row.locator(".lect-row-next")
    assert [links.nth(i).get_attribute("aria-label") for i in range(links.count())] == ["연중1주 월요일, 홀수해 2027년 1월 11일 월요일"]

    # 앞날을 여는 줄(왕이신 그리스도 주일은 2026년 11월 22일)도 다른 해의 날을 둔다
    _goto_search(page, "왕이신 그리스도 주일")
    _wait_days(page)
    row = page.locator(".lect-rows > li").first
    assert "다음 2026년 11월 22일 (일)" in row.locator(".cal-row-meta").inner_text()
    links = row.locator(".lect-row-next")
    assert [links.nth(i).get_attribute("href").split("?")[1] for i in range(links.count())] == ["from=2027-11-21", "from=2028-11-26"]



def _row_labels(page):
    return page.locator(".lect-rows a.cal-row").evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")


def _goto_year_search(page, query):
    """연도를 붙인 검색은 그해의 날을 계산한 뒤에 줄을 그린다. 검색이 끝난 뒤에도 줄이나 결과 없음 화면을 기다린다."""
    _goto_search(page, query)
    page.wait_for_selector(".lect-rows a.cal-row, .empty-state", timeout=15_000)


NICOLA = "성 니콜라(대한성공회 수호성인, 미라의 주교, 326년)"


def test_year_name_search_shows_a_row_for_each_year(page):
    """전례일 이름에 연도를 붙이면 그해의 날을 해마다 한 줄로 보이고, 옮겨 지키는 해는 그 사정을 적는다. 다른 해의 날 링크는 없다(ADR-044 §4)."""
    _fix_today(page)
    _goto_year_search(page, "2024-2026 성 니콜라")
    assert page.inner_text("h2.search-count") == "전례일 3건"
    assert _row_labels(page) == [
        f"{NICOLA}, 백색, 지난 2024년 12월 6일 금요일",
        f"{NICOLA}, 백색, 지난 2025년 12월 6일 토요일",
        f"{NICOLA}, 백색, 다음 2026년 12월 7일 월요일, 12월 6일에서 옮겨 옴",
    ]
    assert page.locator(".lect-row-next").count() == 0
    page.locator(".lect-rows a.cal-row").nth(2).click()
    page.wait_for_function("() => location.pathname === '/lectionary/2026-12-07'", timeout=15_000)
    page.wait_for_selector(".lect-day", timeout=15_000)
    assert "성 니콜라" in page.inner_text(".lect-head")

    # 이름 뒤의 연도와 물결표 범위도 받는다. 해에 따라 다른 독서는 그해에 읽는 해를 적는다
    _goto_year_search(page, "대림1주일 2027년")
    assert _row_labels(page)[0] == "대림1주일, 자색, 다해, 다음 2027년 11월 28일 일요일"

    # 2050년보다 늦은 해도 그해의 날을 보이고, 줄을 누르면 그날이 열린다(2050년에서 자르던 것을 2026-11-18에 풀었다)
    _goto_year_search(page, "2060 성 니콜라")
    assert _row_labels(page) == [f"{NICOLA}, 백색, 다음 2060년 12월 6일 월요일"]
    page.locator(".lect-rows a.cal-row").first.click()
    page.wait_for_function("() => location.pathname === '/lectionary/2060-12-06'", timeout=15_000)
    page.wait_for_selector(".lect-day", timeout=15_000)
    assert "성 니콜라" in page.inner_text(".lect-head")
    _goto_year_search(page, "2049-2060 성 니콜라")
    assert page.inner_text(".search-note") == "연도 범위는 10년까지 찾습니다. 2049~2058년의 날을 보입니다."
    assert len(_row_labels(page)) == 10

    # 설날과 추석은 음력 날짜 자료가 있는 해만 찾는다고 알린다(사용자 결정 2026-11-18)
    _goto_year_search(page, "2060 설날")
    assert "설날과 추석은 2025-2050년만 찾습니다." in page.inner_text(".empty-state")


def test_year_search_that_finds_no_lectionary_day_does_not_load_the_engine(page):
    """연도를 붙였어도 찾은 전례일이 없으면 교회력 자료를 받지 않고, 결과 없음 화면은 범위 안내가 아니라 「찾지 못했어요」다(코드 리뷰 2026-11-17)."""
    engine_files = []
    page.on("request", lambda req: engine_files.append(req.url) if "/data/lectionary/sanctoral.json" in req.url else None)
    _goto_year_search(page, "2000-2050 없는이름")
    text = page.inner_text(".empty-state")
    assert "찾지 못했어요" in text and "연도 범위" not in text, text
    assert engine_files == []


def test_year_name_search_keeps_overlapped_years_and_drops_unkept_ones(page):
    """다른 전례일과 겹쳐 기념만 하는 해는 줄을 두고 그날을 연다. 그해에 지키지 않는 전례일은 줄이 없고, 줄이 하나도 없는 해는 결과
    위에, 모든 해가 그렇다면 결과 없음 화면에 적는다(ADR-044 §4)."""
    _fix_today(page)
    _goto_year_search(page, "크랜머 2026~2027")
    rows = page.locator(".lect-rows a.cal-row")
    assert rows.count() == 2
    assert rows.nth(1).get_attribute("href") == "/lectionary/2027-03-21"
    assert rows.nth(1).get_attribute("aria-label").endswith("다음 2027년 3월 21일 일요일, 축일, 성지주일과 겹침")

    _goto_year_search(page, "2026-2028 연중6주일")
    # 2026년은 재의 수요일(2월 18일) 앞의 사흘, 2028년은 이레다. 2027년에는 없다
    years = [label.split(", ")[-1][3:7] for label in _row_labels(page)]
    assert years == ["2026"] * 3 + ["2028"] * 7, years
    # 줄이 하나도 없는 해는 결과 위에 적는다
    assert page.inner_text(".search-note") == "2027년에는 검색하신 전례일을 지키지 않습니다."

    _goto_year_search(page, "2027 연중6주일")
    assert "2027년에는 검색하신 전례일을 지키지 않습니다." in page.inner_text(".empty-state")
    page.wait_for_function("() => document.getElementById('a11y-announce').textContent.includes('지키지 않습니다')")


def test_year_name_search_finds_christmas_weekdays_by_that_years_names(page):
    """성탄 평일은 그해에 붙는 이름으로 찾고, 같은 해 안에서는 날짜 차례다(ADR-044 §3, §4)."""
    _fix_today(page)
    _goto_year_search(page, "2027 성탄1주")
    assert [label.split(",")[0] for label in _row_labels(page)] == [
        "성탄 1주 토요일", "성탄1주일", "성탄 1주 수요일", "성탄 1주 목요일", "성탄 1주 금요일"]


def _parish_page(browser, parish):
    """소속교회를 고른 채로 여는 화면(ADR-041 §6). 비우기와 값 넣기는 한 초기화 스크립트로 잇는다(conftest)."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(CLEAR_APP_STORAGE + f"localStorage.setItem('bible-parish', '{parish}');")
    page = ctx.new_page()
    _fix_today(page)
    return ctx, page


def _goto_local_search(page, query):
    """지역 축일은 성서 결과와 함께 나올 수 있어(`용인`) 전례일 알약을 고른 주소로 연다."""
    page.goto(f"{BASE_URL}/search?q={quote(query)}&group=lectionary")
    page.wait_for_selector(".lect-rows a.cal-row, .search-local-note, .empty-state", timeout=15_000)
    _wait_search_done(page)


def test_local_days_of_my_parish(browser):
    """소속교회의 축성일은 본당 이름이나 `축성일`로 찾고, 누르면 그날 축성일을 고른 화면이다. 교구와 관구의 설립일은 설립 연도와 함께
    그날을 연다. 연도를 붙이면 해마다 한 줄이다(ADR-044 §3)."""
    ctx, page = _parish_page(browser, "jqdnsv")  # 용인성당, 서울교구
    try:
        for query in ["용인", "용인교회", "축성일"]:
            _goto_local_search(page, query)
            row = page.locator(".lect-rows a.cal-row").first
            assert row.get_attribute("aria-label") == "용인성당 축성일, 백색, 다음 2027년 1월 31일 일요일", query
            assert row.get_attribute("href") == "/lectionary/2027-01-31?obs=my-dedication"
        page.locator(".lect-rows a.cal-row").first.click()
        page.wait_for_selector(".lect-head", timeout=15_000)
        assert page.inner_text(".lect-head").startswith("용인성당 축성일")

        _goto_local_search(page, "설립일")
        assert _row_labels(page) == ["서울교구설립일, 백색, 1965년 설립, 다음 2027년 5월 27일 목요일",
                                     "관구설립일, 백색, 1992년 설립, 다음 2027년 9월 29일 수요일"]

        _goto_local_search(page, "2027-2028 용인")
        assert [label.split(", ")[-1] for label in _row_labels(page)] == ["다음 2027년 1월 31일 일요일", "다음 2028년 1월 31일 월요일"]
    finally:
        ctx.close()


def test_local_notices_without_my_parish(page):
    """소속교회를 고르지 않았으면 결과 위의 안내 카드에서 바로 고른다. 본당 이름으로 찾았으면 그 본당의 단추, `축성일`로 찾았으면 교회
    목록이다. 축복일만 있는 교회는 고를 것이 없다(ADR-044 §3)."""
    _fix_today(page)
    _goto_local_search(page, "용인성당")
    note = page.locator(".search-local-note")
    assert note.locator(".search-alert-title").inner_text() == "용인성당의 축성일(1월 31일)은 소속교회로 등록하면 축성 독서와 함께 볼 수 있습니다."
    assert note.locator("button").inner_text() == "용인교회를 소속교회로 선택"
    page.wait_for_function("() => document.getElementById('a11y-announce').textContent.includes('용인성당의 축성일')")

    _goto_local_search(page, "오산교회")
    assert page.inner_text(".search-local-note .search-alert-title").startswith("오산세마대성당의 축성일(12월 5일)")

    _goto_local_search(page, "세종성당")
    assert page.inner_text(".search-local-note").strip() == "세종성당의 축복일(4월 21일)에는 따로 읽는 독서가 없습니다."
    assert page.locator(".search-local-note button, .search-local-note select").count() == 0

    _goto_local_search(page, "축성일")
    assert page.inner_text(".search-local-note .search-alert-title") == "소속교회의 축성일은 소속교회를 등록하면 축성 독서와 함께 볼 수 있습니다."
    page.wait_for_function("() => !document.querySelector('#search-local-church').disabled", timeout=15_000)

    # 관구설립일은 소속교회와 상관없다
    _goto_local_search(page, "설립일")
    assert _row_labels(page) == ["관구설립일, 백색, 1992년 설립, 다음 2027년 9월 29일 수요일"]


def test_local_notice_picks_my_parish(page):
    """안내 카드에서 소속교회를 등록하면 설정에 저장하고 같은 검색을 다시 그린다. 등록한 것을 알리고 새 축성일 줄에 포커스를 둔다(ADR-044 §3)."""
    _fix_today(page)
    _goto_local_search(page, "용인성당")
    page.click(".search-local-note button")
    page.wait_for_selector(".lect-rows a.cal-row", timeout=15_000)
    assert page.evaluate("localStorage.getItem('bible-parish')") == "jqdnsv"
    assert page.inner_text(".search-view-results .search-note") == "용인교회를 소속교회로 등록했습니다. 설정에서 바꿀 수 있습니다."
    assert page.evaluate("document.activeElement.getAttribute('aria-label')") == "용인성당 축성일, 백색, 다음 2027년 1월 31일 일요일"
    assert "q=%EC%9A%A9%EC%9D%B8%EC%84%B1%EB%8B%B9" in page.url, "같은 검색이다"

    # 목록에서 등록하기: 교회를 선택하지 않고 누르면 목록으로 포커스를 옮긴다
    page.evaluate("localStorage.setItem('bible-parish', '')")
    _goto_local_search(page, "축성일")
    page.wait_for_function("() => !document.querySelector('#search-local-church').disabled", timeout=15_000)
    page.click(".search-local-note button")
    assert page.evaluate("document.activeElement.id") == "search-local-church"
    page.select_option("#search-local-church", "jqdnsv")
    page.click(".search-local-note button")
    page.wait_for_selector(".lect-rows a.cal-row", timeout=15_000)
    assert _row_labels(page) == ["용인성당 축성일, 백색, 다음 2027년 1월 31일 일요일"]


def test_local_notice_pick_without_a_dedication_row_focuses_the_note(page):
    """축복일만 있는 교회를 등록하면 축성일 줄이 없으므로 맨 위의 「소속교회로 등록했습니다」 줄에 포커스를 둔다(WCAG 2.4.3, 코드 리뷰 2026-11-17)."""
    _fix_today(page)
    _goto_local_search(page, "축성일")
    page.wait_for_function("() => !document.querySelector('#search-local-church').disabled", timeout=15_000)
    page.select_option("#search-local-church", "pr7dd7")  # 세종성당
    page.click(".search-local-note button")
    page.wait_for_function(
        "() => document.activeElement && document.activeElement.classList.contains('search-note')", timeout=15_000
    )
    assert page.inner_text(".search-view-results .search-note") == "세종교회를 소속교회로 등록했습니다. 설정에서 바꿀 수 있습니다."
    assert page.inner_text(".search-local-note").strip() == "세종성당의 축복일(4월 21일)에는 따로 읽는 독서가 없습니다."


def test_local_notice_for_a_parish_holder_tells_the_date_only(browser):
    """소속교회가 있는 사람이 다른 본당을 찾으면 그 본당의 축성일 날짜만 알린다. 축성 독서는 모든 본당이 같다(ADR-044 §3)."""
    ctx, page = _parish_page(browser, "uhfhvh")  # 오산세마대성당
    try:
        _goto_local_search(page, "용인성당")
        assert page.inner_text(".search-local-note").strip() == "용인성당의 축성일은 1월 31일입니다. 축성 독서는 소속교회의 축성일과 같습니다."
        assert page.locator(".search-local-note button, .search-local-note select").count() == 0
    finally:
        ctx.close()


def test_parish_changed_elsewhere_redraws_the_results(page):
    """검색 결과가 열린 채 설정 팝오버나 다른 기기에서 소속교회가 바뀌면 결과를 다시 그린다(ADR-041 §8, 코드 리뷰 2026-11-17)."""
    _fix_today(page)
    _goto_local_search(page, "용인성당")
    assert page.locator(".search-local-note button").count() == 1
    page.evaluate("""() => {
        localStorage.setItem('bible-parish', 'jqdnsv');
        return window.redrawIfSyncedSettingsChanged();
    }""")
    page.wait_for_selector(".lect-rows a.cal-row", timeout=15_000)
    assert page.locator(".lect-rows a.cal-row").first.get_attribute("aria-label") == "용인성당 축성일, 백색, 다음 2027년 1월 31일 일요일"
    assert page.locator(".search-local-note").count() == 0


_SWATCH_CODES = "els => els.map(e => e.className.match(/lit-swatch--(\\w+)/)[1])"


def test_row_dot_is_the_color_of_the_header_it_opens(page):
    """줄의 색 점은 누르면 열리는 화면 머리의 색이다. 사계재 평일은 절기 바탕색(녹색)이 아니라 그날의 색이다(ADR-044 §1, 코드 리뷰 2026-11-16)."""
    _fix_today(page)
    _goto_search(page, "연중24주 수요일")
    _wait_days(page)
    row = page.locator(".lect-rows > li").first
    dots = row.locator(".cal-row-dot").evaluate_all(_SWATCH_CODES)
    assert dots == ["violet", "white"]
    row.locator("a.cal-row").click()
    page.wait_for_function("() => location.pathname === '/lectionary/2026-09-16'", timeout=15_000)
    page.wait_for_selector(".lect-color", timeout=15_000)
    assert page.locator(".lect-color").evaluate_all(_SWATCH_CODES) == dots


def test_christmas_names_are_sent_again_after_a_failed_engine_load(browser):
    """엔진의 자료를 받지 못해 성탄 평일의 화면 이름으로 찾지 못했어도, 받을 수 있게 되면 뒤에서 다시 받아 다음 검색부터 찾는다.
    찾기 전에 기다리지는 않는다(ADR-044 §3, 코드 리뷰 2026-11-16)."""
    ctx = browser.new_context(service_workers="block")
    ctx.route("**/lectionary/sanctoral.json", lambda route: route.abort())
    page = ctx.new_page()
    _fix_today(page)
    _goto_search(page, "성탄 1주 수요일")
    assert page.locator(".lect-rows a.cal-row").count() == 0
    ctx.unroute("**/lectionary/sanctoral.json")

    def search_in_app(query):
        page.fill("#search-input", query)
        page.press("#search-input", "Enter")
        page.wait_for_function(
            "q => location.search.includes(encodeURIComponent(q)) && document.querySelector('.search-count, .empty-state')",
            arg=query, timeout=10_000)
        page.wait_for_timeout(300)

    # 전례일 결과가 없는 검색어만 친다. 전례일 결과가 있으면 그 화면이 이름을 보내 이 시험이 보려는 길을 거치지 않는다
    for _ in range(8):
        search_in_app("성탄 1주 수요일")
        if page.locator(".lect-rows a.cal-row").count():
            break
        search_in_app("ㅋㅋㅋㅋ")
        page.wait_for_timeout(500)
    assert page.locator(".lect-rows .cal-row-title").all_inner_texts() == ["성탄 1주 수요일"]
    ctx.close()


def test_christmas_names_do_not_wait_again_after_three_seconds(browser):
    """교회력 자료를 3초 안에 다 받지 못했으면, 그 뒤 「성탄」이 든 검색은 기다리지 않는다. 받기는 이어 가, 다 받으면 그 이름으로
    찾는다(ADR-044 §3, 코드 리뷰 2026-11-17)."""
    ctx = browser.new_context(service_workers="block")
    held = []
    ctx.route("**/lectionary/sanctoral.json", lambda route: held.append(route))
    page = ctx.new_page()
    _fix_today(page)
    _goto_search(page, "성탄 1주 수요일")
    assert page.locator(".lect-rows a.cal-row").count() == 0

    def search_in_app(query):
        start = time.monotonic()
        page.fill("#search-input", query)
        page.press("#search-input", "Enter")
        page.wait_for_function(
            "q => location.search.includes(encodeURIComponent(q)) && document.querySelector('.search-count, .empty-state')",
            arg=query, timeout=10_000)
        return time.monotonic() - start

    search_in_app("ㅋㅋㅋㅋ")
    assert search_in_app("성탄 1주 수요일") < 2, "3초를 넘긴 뒤에도 다시 기다렸다"
    for route in held:
        route.continue_()
    for _ in range(8):
        page.wait_for_timeout(500)
        search_in_app("ㅋㅋㅋㅋ")
        search_in_app("성탄 1주 수요일")
        if page.locator(".lect-rows a.cal-row").count():
            break
    assert page.locator(".lect-rows .cal-row-title").all_inner_texts() == ["성탄 1주 수요일"]
    ctx.close()


def test_fixed_feast_row_opens_the_coming_day(page):
    """해마다 같은 독서를 읽는 줄은 오늘부터 처음 오는 날을 연다. 줄을 누르면 가는 보조 주소도 같은 날을 연다(ADR-044 §1, 2026-11-17).
    지난 2026년 9월 14일이 아니라 2027년 9월 14일이다."""
    _fix_today(page)
    _goto_search(page, "성 십자가의 날")
    _wait_days(page)
    row = page.locator(".lect-rows > li").first
    assert "다음 2027년 9월 14일 (화)" in row.locator(".cal-row-meta").inner_text()
    assert row.locator(".lect-row-next").count() == 0
    row.locator("a.cal-row").click()
    page.wait_for_function("() => location.pathname === '/lectionary/2027-09-14'", timeout=15_000)



def test_weekday_gospel_read_every_year_opens_the_coming_day(page):
    """구절로 찾은 독서가 그 전례일의 모든 해의 세트에 있으면 해마다 같은 독서다. 연중1주 월요일의 복음 마르 1:14-20은 홀수해와
    짝수해에 같아, 지난 2026년 1월 12일이 아니라 다가오는 2027년 1월 11일을 연다(ADR-044 §1, 2026-11-17)."""
    _fix_today(page)
    _goto_search(page, "마르 1:14", "&group=lectionary")
    _wait_days(page)
    row = page.locator(".lect-rows > li").filter(has_text="연중1주 월요일").first
    assert "다음 2027년 1월 11일 (월)" in row.locator(".cal-row-meta").inner_text()
    assert row.locator(".lect-row-next").count() == 0
    assert row.locator("a.cal-row").get_attribute("href").endswith("?from=2027-01-11")
    row.locator("a.cal-row").click()
    page.wait_for_function("() => location.pathname === '/lectionary/2027-01-11'", timeout=15_000)

def test_row_opens_the_coming_day_when_it_comes_twice_in_the_year(page):
    """한 전례년(2027-11-28부터 2028-12-02까지)의 처음과 끝에 한 번씩 있는 성 안드레아 축일도 다가오는 날을 연다. 해마다
    같은 독서라 오늘부터 처음 오는 날이다(ADR-044 §1, 2026-11-17)."""
    page.clock.set_fixed_time(datetime.datetime(2028, 6, 1, 12))
    _goto_search(page, "안드레아", "&group=lectionary")
    _wait_days(page)
    row = page.locator(".lect-rows > li").filter(has_text="사도 성 안드레아").first
    assert "다음 2028년 11월 30일 (목)" in row.locator(".cal-row-meta").inner_text()

def test_missing_chapter_is_told_and_enter_stays(page, base_url):
    """책에 없는 장은 구절 바로가기 카드 대신 알린다. Enter를 쳐도 장 화면으로 가지 않는다(ADR-044 §2)."""
    page.goto(base_url)
    wait_app_ready(page)
    page.fill("#search-input", "유다 3")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-alert", timeout=10_000)
    assert page.inner_text(".search-alert-title") == "유다의 편지에는 3장이 없습니다."
    assert page.locator(".search-result-ref-card").count() == 0
    assert page.evaluate("location.pathname") == "/search"


def test_book_name_alone_shows_the_first_chapter_card(page, base_url):
    """책 이름만 치면 첫 장 바로가기를 두고, 결과가 없을 때만 Enter로 첫 장을 연다(ADR-044 §2)."""
    _goto_search(page, "창세기")
    assert page.locator(".search-result-ref-card").get_attribute("href") == "/gen/1"
    assert page.inner_text(".search-result-ref-title") == "창세기 1장"

    page.fill("#search-input", "창세기")
    page.press("#search-input", "Enter")
    page.wait_for_function("() => location.pathname === '/gen/1'", timeout=8_000)

    # 「요한」은 본문과 전례일에 결과가 있어 Enter를 쳐도 결과 화면이다
    page.fill("#search-input", "요한")
    page.press("#search-input", "Enter")
    page.wait_for_selector(".search-pill", timeout=10_000)
    assert page.evaluate("location.pathname") == "/search"
    assert page.inner_text(".search-result-ref-title") == "요한의 복음서 1장"


def test_row_opens_the_day_of_this_liturgical_year(page):
    """전례일 줄은 보조 주소로 가서 이번 전례년의 그날 주소로 바꿔 쓴다. 지났어도 그날이다. 뒤로 가면 검색 결과다(ADR-044 §1)."""
    _fix_today(page)
    _goto_search(page, "요한 3:16")
    page.locator(".lect-rows a").first.click()
    page.wait_for_function("() => location.pathname === '/lectionary/2026-03-01'", timeout=15_000)
    page.wait_for_selector(".lect-day", timeout=15_000)
    assert "사순" in page.inner_text(".lect-day")
    # 그날의 기본 전례일이라 화면의 정식 주소는 날짜뿐이다
    assert "?" not in page.url

    page.go_back()
    page.wait_for_selector(".lect-rows", timeout=10_000)
    assert page.evaluate("location.pathname") == "/search"


def test_unknown_slug_is_told(page):
    page.goto(f"{BASE_URL}/lectionary/d/nope")
    page.wait_for_selector("text=잘못된 주소입니다", timeout=10_000)
    page.goto(f"{BASE_URL}/lectionary/d/lent-2-sun-A-t1-s1?from=2026-02-31")
    page.wait_for_selector("text=잘못된 주소입니다", timeout=10_000)


def test_slug_from_opens_the_first_day_from_that_date(page):
    """보조 주소의 `?from=`은 그날부터 처음 지키는 날을 연다(다음에 읽는 날의 링크, ADR-044 §1)."""
    _fix_today(page)
    page.goto(f"{BASE_URL}/lectionary/d/lent-2-sun-A-t1-s1?from=2026-11-16")
    page.wait_for_function("() => location.pathname === '/lectionary/2029-02-25'", timeout=15_000)
    page.goto(f"{BASE_URL}/lectionary/d/{quote('d1231-성탄주간-t1-s1')}?from=2026-12-30")
    page.wait_for_function("() => location.pathname === '/lectionary/2026-12-31'", timeout=15_000)
    page.wait_for_selector(".lect-day", timeout=15_000)
    assert page.inner_text(".lect-day") == "성탄 1주 목요일"


def _held_lectionary_index(browser):
    """전례독서 색인 요청을 붙잡아 두는 앱. 시험이 `held[0].continue_()`로 보낸다. 서비스 워커를 막아 요청이 언제나 이 경로를 지난다."""
    ctx = browser.new_context(service_workers="block")
    held = []
    ctx.route("**/lectionary/search-lectionary.json", lambda route: held.append(route))
    return ctx, held


def test_enter_waits_for_a_slow_lectionary_index(browser):
    """색인이 3초 안에 오면 기다렸다가 전례일이 있는 구절의 결과 화면을 보인다(ADR-044 §1)."""
    ctx, held = _held_lectionary_index(browser)
    page = ctx.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)
    page.fill("#search-input", "요한 3:16")
    page.press("#search-input", "Enter")
    page.wait_for_function("() => !!document.querySelector('#app .loading')")
    page.wait_for_timeout(1_000)
    assert held, "색인 요청"
    held[0].continue_()
    page.wait_for_selector(".lect-rows a", timeout=10_000)
    assert page.evaluate("location.pathname") == "/search"
    ctx.close()


def test_enter_opens_the_chapter_when_the_index_is_too_slow(browser):
    """색인이 3초 안에 오지 않으면 전례일이 없는 것으로 보고 장을 연다(ADR-044 §1)."""
    ctx, held = _held_lectionary_index(browser)
    page = ctx.new_page()
    page.goto(BASE_URL)
    wait_app_ready(page)
    page.fill("#search-input", "요한 3:16")
    page.press("#search-input", "Enter")
    page.wait_for_function("() => location.pathname === '/john/3/16'", timeout=10_000)
    for route in held:
        route.continue_()
    ctx.close()


def test_late_lectionary_days_are_added_and_told(browser):
    """3초가 지나 온 전례일은 결과에 더하고 「더 찾았습니다」를 알린다(ADR-044 §1)."""
    ctx, held = _held_lectionary_index(browser)
    page = ctx.new_page()
    page.goto(f"{BASE_URL}/search?q={quote('요한 3:16')}")
    page.wait_for_selector(".search-result-ref-card", timeout=10_000)
    assert page.locator(".lect-rows").count() == 0
    held[0].continue_()
    page.wait_for_selector(".lect-rows a", timeout=10_000)
    page.wait_for_function(
        "() => document.getElementById('a11y-announce').textContent === '\"요한 3:16\" 이 구절을 읽는 날 5건을 더 찾았습니다'",
        timeout=5_000,
    )
    ctx.close()



def test_missing_and_present_chapters_keep_the_typed_order(page):
    """있는 장과 없는 장을 함께 치면 친 차례대로 카드와 알림을 두고, 알림도 같은 차례다(ADR-044 §2)."""
    _goto_search(page, "요한 21, 22")
    classes = page.locator(".search-answer li").evaluate_all("els => els.map(e => e.className)")
    assert classes == ["search-result-item ref-match-item", "search-alert-item"]
    page.wait_for_function(
        "() => document.getElementById('a11y-announce').textContent"
        ".startsWith('\"요한 21, 22\" 요한의 복음서 21장 바로가기, 요한의 복음서에는 22장이 없습니다')"
    )


def test_page_past_the_end_still_shows_the_count(page):
    """쪽 번호가 끝을 넘은 주소(더 긴 화면에서 만든 링크)도 「결과 없음」이 아니라 결과 수와 쪽 이동을 보인다."""
    page.goto(f"{BASE_URL}/search?q={quote('사랑')}&page=999")
    page.wait_for_selector("h2.search-count", timeout=10_000)
    _wait_search_done(page)
    assert page.inner_text("h2.search-count").startswith("성서 본문 ")
    assert page.locator(".empty-state").count() == 0
    assert page.locator(".search-pagination").count() == 1


def test_book_scope_leaves_out_the_lectionary_example(page):
    """책을 골라 두면 전례일을 찾지 않으므로 결과 없음 화면의 예시에서 「성령강림」을 뺀다(ADR-044 §1)."""
    page.goto(f"{BASE_URL}/search?q={quote('부활절 달걀')}&in=john")
    page.wait_for_selector(".search-examples", timeout=10_000)
    assert "성령강림" not in page.locator(".search-example-q").all_inner_texts()
    # 전례일은 찾지 않았으므로 「구절을 찾지 못했어요」라고만 알린다
    assert page.inner_text(".empty-state-subtitle") == "‘부활절 달걀’에 해당하는 구절을 찾지 못했어요."
    page.goto(f"{BASE_URL}/search?q={quote('부활절 달걀')}")
    page.wait_for_selector(".search-examples", timeout=10_000)
    assert "성령강림" in page.locator(".search-example-q").all_inner_texts()
    assert page.inner_text(".empty-state-subtitle") == "‘부활절 달걀’에 해당하는 성서 본문, 성시, 전례일을 찾지 못했어요."


def test_saint_with_common_readings_only_shows_its_rank_and_opens_the_day(page):
    """공통 독서만 있는 성인의 줄은 등급을 적고, 누르면 그날을 기본 화면으로 연다(ADR-044 §1)."""
    _goto_search(page, "레오나드")
    row = page.locator(".lect-rows a").first
    assert row.locator(".cal-row-title").inner_text().startswith("레오나드")
    assert row.locator(".cal-row-line").all_inner_texts() == ["축일"]
    row.click()
    page.wait_for_function("() => /^\\/lectionary\\/\\d{4}-11-06$/.test(location.pathname)", timeout=15_000)
    assert "obs=" not in page.url


def test_slug_lands_on_the_address_the_view_makes(page):
    """보조 주소는 그날 화면이 만드는 정식 주소로 바뀐다. 세트의 차례는 화면의 선택지 차례다(ADR-044 §1)."""
    # 대림4주일 다해의 괄호 세트(s2)는 s1과 한 선택지라 `set=`이 없고, 기본 전례일이라 `obs=`도 없다
    page.goto(f"{BASE_URL}/lectionary/d/advent-4-sun-C-t1-s2")
    page.wait_for_function("() => /^\\/lectionary\\/\\d{4}-12-\\d{2}$/.test(location.pathname)", timeout=15_000)
    page.wait_for_selector(".lect-day", timeout=15_000)
    assert "set=" not in page.url and "obs=" not in page.url

    # 성지주일 나해의 s3은 s2의 괄호 세트라 두 번째 선택지다. 주소가 고른 독서 카드의 주소와 같다
    page.goto(f"{BASE_URL}/lectionary/d/{quote('temporal-lent-성지주일-B-t1-s3')}")
    page.wait_for_function("() => /^\\/lectionary\\/\\d{4}-\\d{2}-\\d{2}$/.test(location.pathname)", timeout=15_000)
    page.wait_for_selector(".lect-card[aria-current='page']", timeout=15_000)
    assert "set=2" in page.url
    here = page.evaluate("location.pathname + location.search")
    assert page.locator(".lect-card[aria-current='page']").get_attribute("href") == here


def test_late_days_keep_focus_and_let_the_route_finish(browser):
    """3초 뒤 전례일이 와도 결과를 다시 그리지 않아 포커스가 남고, 화면 전환의 마무리(문서 제목)는 색인을 기다리지 않는다(ADR-044 §1)."""
    ctx, held = _held_lectionary_index(browser)
    page = ctx.new_page()
    page.goto(f"{BASE_URL}/search?q={quote('베드로')}")
    page.wait_for_function(
        "() => document.querySelector('h2.search-count')?.textContent.startsWith('성서 본문')", timeout=20_000)
    page.wait_for_function("() => document.title.startsWith('\"베드로\" 검색')", timeout=5_000)
    assert page.locator(".search-pill").count() == 0
    link = page.locator(".search-results .search-result-item a").nth(2)
    link.focus()
    href = link.get_attribute("href")
    held[0].continue_()
    page.wait_for_selector(".search-pill", timeout=10_000)
    assert page.evaluate("document.activeElement.getAttribute('href')") == href
    assert page.locator(".search-pill[aria-current='true']").inner_text().startswith("성서 본문")
    ctx.close()


def test_lectionary_days_wait_while_bible_chunks_load_with_nothing_found(browser):
    """성서 본문을 받는 중이고 찾은 성서 결과가 아직 없으면 전례일 목록을 먼저 보이지 않는다(ADR-044 §1).
    먼저 보이면 뒤이어 온 성서 결과가 기본 알약인 「성서 본문」으로 화면을 바꾼다."""
    ctx = browser.new_context(service_workers="block")
    held = {}

    def hold(name):
        # Playwright는 인자가 둘인 처리기에 요청을 넘기므로, 이름은 함수로 묶는다
        return lambda route: held.__setitem__(name, route)

    for name in ("nt", "dc", "ot"):
        ctx.route(f"**/data/search-{name}.json", hold(name))
    page = ctx.new_page()
    page.goto(f"{BASE_URL}/search?q={quote('성령강림')}")
    # 색인이 먼저 오고, 그다음 신약 묶음이 와서 중간 결과에 전례일이 실린다
    for _ in range(100):
        if len(held) == 3:
            break
        page.wait_for_timeout(100)
    page.wait_for_timeout(1_000)
    held["nt"].continue_()
    page.wait_for_function(
        "() => document.querySelector('h2.search-count')?.textContent.includes('검색 중')", timeout=15_000)
    page.wait_for_timeout(500)
    assert page.locator(".lect-rows").count() == 0
    assert page.locator(".search-pill").count() == 0
    held["dc"].continue_()
    held["ot"].continue_()
    page.wait_for_selector(".lect-rows a", timeout=15_000)
    assert page.inner_text("h2.search-count") == "전례일 1건"
    ctx.close()


# ── 성시 검색(ADR-046) ───────────────────────────────────────────────────────

def test_psalter_results_are_a_pill_apart_from_the_bible(page):
    """전례시편과 송가의 결과는 「성시」 알약으로 성서 본문과 따로 보인다. 알약은 「성서 본문, 성시, 전례일」의 차례이고 처음에는 성서 본문이다.
    「성시」를 고르면 주소에 `group=psalter`를 적고 포커스가 그 알약에 남는다. 결과를 누르면 전례시편의 장을 열고 찾은 말을 강조한다(ADR-046 §3).
    「나의 목자」는 공동번역에 3절(창세 48:15, 시편 23:1, 즈가 13:7), 전례시편에 23편 1절이 있다."""
    _goto_search(page, "나의 목자")
    pills = page.locator(".search-pill")
    assert pills.all_text_contents() == ["성서 본문 3건", "성시 1건"]
    assert pills.nth(0).get_attribute("aria-current") == "true"
    refs = page.locator(".search-result-ref").all_inner_texts()
    assert "시편 23:1" in refs and not any(r.startswith("전례시편") for r in refs), refs

    pills.nth(1).click()
    page.wait_for_url("**group=psalter")
    page.wait_for_function("() => document.querySelector('h2.search-count')?.textContent === '성시 1건 (1/1쪽)'")
    page.wait_for_function("() => document.activeElement?.dataset.focusKey === 'group:psalter'")
    assert page.locator(".search-result-ref").all_inner_texts() == ["전례시편 23:1"]
    page.wait_for_function("() => document.getElementById('a11y-announce').textContent.includes('성서 본문 3건, 성시 1건')")

    page.locator(".search-result-item a").first.click()
    page.wait_for_function("() => location.pathname.startsWith('/lps/23')")
    page.wait_for_selector("mark", timeout=10_000)
    assert "나의 목자" in "".join(page.locator("mark").all_inner_texts())


def test_psalter_pages_stay_in_the_psalter(page):
    """성시의 쪽 넘기기는 성시에 머문다. 쪽 번호는 고른 묶음의 쪽이다(ADR-046 §3)."""
    _goto_search(page, "주님", "&group=psalter")
    heading = page.inner_text("h2.search-count")
    assert heading.startswith("성시 391건 (1/"), heading
    page.locator(".search-pagination a", has_text="다음").click()
    page.wait_for_url("**page=2&group=psalter")
    page.wait_for_function("() => document.querySelector('h2.search-count')?.textContent.startsWith('성시 391건 (2/')")
    assert page.locator(".search-pill[aria-current='true']").text_content().startswith("성시")
    assert ", 2쪽" in page.title()


def test_canticle_results_show_the_canticle_name(page):
    """송가의 결과는 송가 이름과 절로 적는다(「즈가리야 송가 1」, ADR-046 §4). 책을 성시의 책만 골랐으면 성서 본문이 없어 알약도 없다."""
    _goto_search(page, "이스라엘의 주 하느님", "&in=lps&in=cant")
    assert page.locator(".search-pill").count() == 0
    assert page.inner_text("h2.search-count") == "성시 2건 (1/1쪽)"
    assert page.locator(".search-result-ref").all_inner_texts() == ["전례시편 106:48", "즈가리야 송가 1"]
    assert page.locator(".search-result-item a").nth(1).get_attribute("href").startswith("/cant/11/1?hl=")


def test_psalter_verse_reference_and_book_name(page):
    """전례시편과 송가의 책 이름도 구절로 읽는다. 송가의 카드는 송가 이름이다. `전례시편 23`은 `시편 23`과 같이 그 시편을 읽는 전례일을
    찾는다. 책 이름만 치면 첫 편의 카드이고, 송가는 첫 송가의 이름이다(ADR-046 §4, §5). 「송가」라는 낱말은 공동번역(에페 5:19, 골로
    3:16)에 있어 결과도 함께 나온다. 결과가 없는 「성무일과 송가」는 Enter로 첫 송가를 연다고 알린다."""
    _goto_search(page, "송가 11:1-3")
    assert page.inner_text(".search-result-ref-title") == "즈가리야 송가 1-3절"
    assert page.locator(".search-result-ref-card").get_attribute("href") == "/cant/11/1-3"

    _goto_search(page, "전례시편 23")
    assert page.inner_text(".search-result-ref-title") == "전례시편 23편"
    page.wait_for_selector(".lect-rows a", timeout=10_000)
    lps_days = page.inner_text("h2.search-count")
    _goto_search(page, "시편 23")
    page.wait_for_selector(".lect-rows a", timeout=10_000)
    assert page.inner_text("h2.search-count") == lps_days
    assert page.inner_text(".search-result-ref-title") == "시편 23편"

    _goto_search(page, "송가")
    assert page.inner_text(".search-result-ref-title") == "모세송가"
    assert page.locator(".search-result-ref-card").get_attribute("href") == "/cant/1"
    assert page.inner_text("h2.search-count") == "성서 본문 2건 (1/1쪽)"

    _goto_search(page, "성무일과 송가")
    assert page.inner_text(".search-result-ref-title") == "모세송가"
    assert page.inner_text(".search-note") == (
        "‘성무일과 송가’가 들어간 성서 본문, 성시, 전례일은 없습니다. 검색창에서 Enter를 누르면 모세송가를 바로 엽니다."
    )


@pytest.mark.parametrize("ctx_name", ["mobile_context", "desktop_context"])
def test_psalter_book_filter_group_and_chips(ctx_name, request):
    """책 선택 시트의 마지막 묶음은 「성시」(전례시편, 송가)다. 고르면 다른 책과 같이 칩이 되고 최근 검색에 범위와 함께 남는다. 입력 칸의
    `in:송가`도 칩이 된다(ADR-046 §2)."""
    page = request.getfixturevalue(ctx_name).new_page()
    _apply_books_to_typed_query(page, ctx_name, "목자", "lps")
    page.wait_for_selector(".search-count", timeout=20_000)
    _wait_search_done(page)
    titles = page.locator("#book-filter-sheet .book-filter-section-title").all_text_contents()
    assert titles[-1] == "성시", titles
    last = page.locator("#book-filter-sheet .book-filter-section").last
    assert last.locator(".book-filter-name").all_text_contents() == ["전례시편", "송가"]
    state = page.evaluate("""() => ({
        books: new URLSearchParams(location.search).getAll('in'),
        heading: document.querySelector('h2.search-count').textContent,
        refs: [...document.querySelectorAll('.search-result-ref')].map((n) => n.textContent),
        pills: document.querySelectorAll('.search-pill').length,
        chips: [...document.querySelectorAll('.field-token')].filter((n) => n.offsetParent).map((n) => n.textContent),
        recent: (JSON.parse(localStorage.getItem('bible-search-history') || '[]')[0] || {}).q,
    })""")
    assert state["books"] == ["lps"], state
    assert state["heading"].startswith("성시 5건"), state
    assert state["refs"] and all(r.startswith("전례시편 ") for r in state["refs"]), state
    assert state["pills"] == 0, state
    assert any("전례시편" in c for c in state["chips"]), state
    assert state["recent"] == "목자 in:전례시편", state


def test_typed_in_canticles_becomes_a_chip(page, base_url):
    """입력 칸의 `in:송가`는 칩이 되고 송가에서만 찾는다(ADR-046 §2)."""
    page.goto(base_url)
    wait_app_ready(page)
    page.fill("#search-input", "구원 in:송가")
    page.press("#search-input", "Enter")
    page.wait_for_selector("#search-bar .field-token", timeout=20_000)
    page.wait_for_selector("h2.search-count", timeout=20_000)
    _wait_search_done(page)
    assert page.evaluate("new URLSearchParams(location.search).getAll('in')") == ["cant"]
    assert page.inner_text("h2.search-count").startswith("성시 12건 (1/")
    assert page.locator("#search-bar .field-token").inner_text().startswith("송가")
    refs = page.locator(".search-result-ref").all_inner_texts()
    assert refs and all(not r.startswith("전례시편") and ":" not in r for r in refs), refs


def test_three_pills_in_order(page):
    """성서 본문, 성시, 전례일에 모두 결과가 있으면 알약 셋을 그 차례로 둔다(ADR-046 §3). 「성령」은 성시에 3절, 전례일에 성령강림대축일이 있다."""
    _goto_search(page, "성령")
    names = [t.split(" ")[0] for t in page.locator(".search-pill").all_text_contents()]
    assert names == ["성서", "성시", "전례일"], names
    assert page.locator(".search-pill").nth(1).text_content() == "성시 3건"
    page.locator(".search-pill").nth(2).click()
    page.wait_for_url("**group=lectionary")
    page.wait_for_selector(".lect-rows a")
    assert page.inner_text("h2.search-count") == "전례일 1건"


def test_late_lectionary_pill_joins_the_psalter_pills_and_keeps_focus(browser):
    """성서 본문과 성시의 알약을 그린 뒤 3초가 지나 전례일이 오면 그 끝에 전례일 알약만 더하고, 알약에 있던 포커스가 남는다(ADR-046 §3)."""
    ctx, held = _held_lectionary_index(browser)
    page = ctx.new_page()
    page.goto(f"{BASE_URL}/search?q={quote('성령')}")
    page.wait_for_function("() => document.querySelectorAll('.search-pill').length === 2", timeout=20_000)
    _wait_search_done(page)
    pill = page.locator(".search-pill").nth(1)
    pill.focus()
    held[0].continue_()
    page.wait_for_function("() => document.querySelectorAll('.search-pill').length === 3", timeout=10_000)
    assert page.evaluate("document.activeElement.dataset.focusKey") == "group:psalter"
    assert [t.split(" ")[0] for t in page.locator(".search-pill").all_text_contents()] == ["성서", "성시", "전례일"]
    assert page.locator(".search-pill[aria-current='true']").text_content().startswith("성서 본문")
    ctx.close()
