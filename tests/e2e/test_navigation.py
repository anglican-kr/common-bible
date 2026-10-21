"""E2E: verse-level deep-link URL routing tests.

Covers:
  - single verse path          /#/john/3/16
  - verse range path           /#/john/3/16-20
  - over-range clamped         /#/john/3/16-200  → 16-36 + URL rewritten
  - reversed range normalized  /#/john/3/20-16
  - reversed and over-range    /#/john/3/40-10   → 10-36 + URL rewritten ascending (was 40-36)
  - legacy query form ignored  /#/gen/1?v=3&ve=5
  - combined path + hl param   /#/john/3/16?hl=사랑
  - invalid verse ignored      /#/john/3/abc
  - same-value range           /#/john/3/16-16
  - multi-segment              /#/john/3/16-18,20 → highlighted; trailing comma /#/john/3/16-18, → highlighted;
                               out of order /#/john/3/20,16-18 → chapter only
  - multi-segment the app does not write → chapter only, no page error
      cold link: huge range · ascending huge range · 100M range · repeated segments (launch screen cleared)
      in-app navigation: huge range
"""

import re

import pytest

BASE = "http://localhost:8080"


def highlighted_verse_ids(page) -> list[str]:
    return page.evaluate(
        "() => Array.from(document.querySelectorAll('.verse.verse-highlight')).map(el => el.id)"
    )


def navigate_and_wait(page, hash_: str):
    page.goto(f"{BASE}/{hash_}")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(200)


@pytest.mark.parametrize(
    "label,hash_,expected_ids,hash_re,expected_mark",
    [
        (
            "single verse",
            "#/john/3/16",
            ["v16"],
            None,
            None,
        ),
        (
            "verse range",
            "#/john/3/16-20",
            ["v16", "v17", "v18", "v19", "v20"],
            None,
            None,
        ),
        (
            "over-range clamped to 16-36",
            "#/john/3/16-200",
            [f"v{n}" for n in range(16, 37)],
            r"/john/3/16-36$",
            None,
        ),
        (
            "reversed range normalized",
            "#/john/3/20-16",
            ["v16", "v17", "v18", "v19", "v20"],
            None,
            None,
        ),
        (
            "legacy query form ignored",
            "#/gen/1?v=3&ve=5",
            [],
            None,
            None,
        ),
        (
            "combined path verse + hl text",
            "#/john/3/16?hl=%EC%82%AC%EB%9E%91",
            ["v16"],
            None,
            "사랑",
        ),
        (
            "invalid verse ignored",
            "#/john/3/abc",
            [],
            None,
            None,
        ),
        (
            "same-value range as single verse",
            "#/john/3/16-16",
            ["v16"],
            None,
            None,
        ),
        (
            # 거꾸로 되고 장을 넘는 범위 — 다시 쓴 주소가 「40-36」이 되어 다시 열면 36절만 강조됐다(PR #362 리뷰).
            "reversed and over-range rewritten ascending",
            "#/john/3/40-10",
            [f"v{n}" for n in range(10, 37)],
            r"/john/3/10-36$",
            None,
        ),
        (
            "multi-segment as the app writes it",
            "#/john/3/16-18,20",
            ["v16", "v17", "v18", "v20"],
            None,
            None,
        ),
        (
            # 링크 바로 뒤에 친 쉼표 — 주소에서만 앞뒤 쉼표를 걷는다(사용자 결정 2026-10-21).
            "multi-segment with a trailing comma",
            "#/john/3/16-18,",
            ["v16", "v17", "v18"],
            None,
            None,
        ),
        (
            # 여러 구간은 앱이 쓰는 표기만 강조한다 — 가져오기 검사와 같은 기준(known-issues §15, ADR-040).
            "multi-segment out of order opens the chapter only",
            "#/john/3/20,16-18",
            [],
            None,
            None,
        ),
    ],
)
def test_verse_url(page, label, hash_, expected_ids, hash_re, expected_mark):
    navigate_and_wait(page, hash_)

    ids = highlighted_verse_ids(page)
    assert ids == expected_ids, f"[{label}] highlighted={ids}, expected={expected_ids}"

    if hash_re is not None:
        current = page.evaluate("() => location.pathname")
        assert re.search(hash_re, current), (
            f"[{label}] URL after replaceState: {current!r} — expected match /{hash_re}/"
        )

    if expected_mark is not None:
        marks = page.evaluate(
            "() => Array.from(document.querySelectorAll('mark.search-highlight'))"
            ".map(m => m.textContent)"
        )
        assert expected_mark in marks, f"[{label}] mark {expected_mark!r} not found in {marks}"


# ── 여러 구간 주소의 절 범위 — 앱이 쓰지 않는 표기는 장만 연다(known-issues §15) ─────────────

@pytest.mark.parametrize(
    "spec",
    ["1-4294967296,5", "5,7-4294967296", "1-100000000,5", ",".join(["1-36"] * 1600)],
    ids=["huge-range", "ascending-huge-range", "hundred-million-range", "repeated-segments"],
)
def test_multi_segment_spec_the_app_does_not_write_opens_chapter(browser, spec):
    """처음 여는 링크의 여러 구간에 앱이 쓰지 않는 절 범위가 있으면 강조 없이 장만 연다.

    그전엔 parsePath가 구간을 절 하나하나로 펼쳐, 큰 범위는 「Invalid array length」로 시작 화면에서 멈췄고
    오름차순 큰 범위(5,7-4294967296)는 배열 길이 한도 안이라 42억 칸을 채우다 탭이 죽었다. 1억 절 범위는 30초
    넘게 멈췄다. 같은 구간을 되풀이한 주소는 장이 열렸지만, 탭 바가 스크롤 프레임마다 주소를 다시 읽어 그만큼
    펼쳤다(여기서는 1,600번 — nginx가 기본으로 받는 요청 줄 8KB 안의 길이)."""
    ctx = browser.new_context(service_workers="block")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{BASE}/john/3/{spec}")
        page.wait_for_selector("article.chapter-text .verse", timeout=5_000)
        # The launch screen fades out after fonts are ready (settings-ui.js dismissLaunchScreen) — wait for it.
        page.wait_for_function("() => document.documentElement.classList.contains('launch-done')", timeout=5_000)
        assert page.locator("article.chapter-text .verse").count() == 36
        assert highlighted_verse_ids(page) == []
        assert errors == [], errors
    finally:
        ctx.close()


def test_in_app_navigation_to_huge_range_draws_chapter(browser):
    """앱 안에서 그런 주소로 가도 장을 그린다 — 검사 없는 1.6.4 이하에서 들인 북마크(그 기기에 남은 것 · 동기화로
    온 것)도 이 길로 연다. 그전엔 route()가 예외로 끝나 앞 화면(창세기 1장)에 머물렀다."""
    ctx = browser.new_context(service_workers="block")
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    try:
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse")
        page.evaluate("() => window.navigate('/john/3/1-4294967296,5')")
        page.wait_for_function(
            "() => document.getElementById('page-title')?.textContent.includes('요한의 복음서 3장')"
            " && document.querySelectorAll('article.chapter-text .verse').length === 36",
            timeout=5_000,
        )
        assert highlighted_verse_ids(page) == []
        assert errors == [], errors
    finally:
        ctx.close()


# ── 보강: 책 목록 / 장 이동 / 장 선택 팝오버 ─────────────────────────────────

def test_book_list_click_then_chapter_loads(browser):
    """홈 → 책 목록 창세기 클릭 → /gen(장 목록) → 1장 클릭 → 본문 로드."""
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        page.goto(BASE)
        page.wait_for_selector(".book-list")

        # Click Genesis → chapters list page
        page.locator(".book-list a[href='/gen']").first.click()
        page.wait_for_function("() => location.pathname === '/gen'", timeout=3_000)

        # Chapters page has a link to gen/1
        page.locator("a[href='/gen/1']").first.click()
        page.wait_for_selector("article.chapter-text .verse", timeout=5_000)

        current = page.evaluate("() => location.pathname")
        assert current == "/gen/1", f"Expected /gen/1, got {current!r}"
    finally:
        ctx.close()


def test_home_btn_focuses_book_just_read(browser):
    """장(gen/1)에서 헤더 홈 버튼 클릭 → 책 목록의 창세기 항목에 포커스."""
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse")

        # Header home button → back up to the book list (구약 division tab)
        page.locator(".title-home-btn").click()
        page.wait_for_selector(".book-list", timeout=5_000)

        # The Genesis list item should now hold focus, in context.
        focused = page.evaluate(
            "() => document.activeElement && document.activeElement.getAttribute('data-book-id')"
        )
        assert focused == "gen", f"Expected focus on gen, got {focused!r}"
    finally:
        ctx.close()


@pytest.mark.parametrize("path", ["lps/23", "cant"])
def test_home_btn_on_book_in_no_tab_lands_on_book_list(browser, path):
    """구분 탭이 없는 책(전례시편 장 · 송가 장 목록)에서 헤더 홈 버튼 → 성서 목록 첫 화면(/).

    그전엔 `/liturgical` 로 가서 「해당 성서를 찾을 수 없습니다.」가 떴다(PR #353 리뷰, 2026-10-17 —
    views.js bookListPath)."""
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/{path}")
        page.wait_for_selector("#page-title .title-home-btn")
        page.locator("#page-title .title-home-btn").click()
        page.wait_for_selector(".book-list", timeout=5_000)
        assert page.evaluate("() => location.pathname") == "/"
        assert "찾을 수 없습니다" not in page.locator("#app").inner_text()
    finally:
        ctx.close()


@pytest.mark.parametrize("path", ["john/", "john/abc"])
def test_non_numeric_chapter_says_not_found(browser, path):
    """장 자리가 숫자가 아니면 「해당 장을 찾을 수 없습니다.」 — 범위 밖 장(`/john/0` · `/john/99`)과 같은 안내.

    그전엔 parseInt 의 NaN 이 범위 검사를 지나 `john-NaN.json` 을 요청하고 「데이터를 불러올 수 없습니다.」가
    떴다(PR #353 리뷰, 2026-10-17 — routing.js route() 의 정수 검사)."""
    ctx = browser.new_context()
    page = ctx.new_page()
    nan_requests = []
    page.on("request", lambda r: "NaN" in r.url and nan_requests.append(r.url))
    try:
        page.goto(f"{BASE}/{path}")
        page.wait_for_function(
            "() => /찾을 수 없습니다|불러올 수 없습니다/.test(document.getElementById('app')?.innerText || '')",
            timeout=5_000,
        )
        assert "해당 장을 찾을 수 없습니다." in page.locator("#app").inner_text()
        assert nan_requests == [], nan_requests
    finally:
        ctx.close()


def test_chapter_nav_next_btn_navigates(browser):
    """현재 장(gen/1)에서 다음 장 버튼 클릭 → gen/2 로드."""
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse")

        next_link = page.locator(".chapter-nav a").last
        next_link.click()
        page.wait_for_selector("article.chapter-text .verse", timeout=5_000)

        current = page.evaluate("() => location.pathname")
        assert current == "/gen/2", f"Expected /gen/2, got {current!r}"
    finally:
        ctx.close()


def test_chapter_picker_opens_and_navigates(browser):
    """장 선택 버튼 클릭 → 팝오버 열림 → 5장 선택 → gen/5 로드."""
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse")

        page.locator(".title-picker-btn[aria-label='장 선택']").click()
        page.wait_for_selector(".chapter-popover:not([hidden])", timeout=2_000)

        page.locator(".chapter-popover .popover-item[href='/gen/5']").click()
        page.wait_for_selector("article.chapter-text .verse", timeout=5_000)

        current = page.evaluate("() => location.pathname")
        assert current == "/gen/5", f"Expected /gen/5, got {current!r}"
    finally:
        ctx.close()
