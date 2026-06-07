"""E2E: verse-level deep-link URL routing tests.

Covers:
  - single verse path          /#/john/3/16
  - verse range path           /#/john/3/16-20
  - over-range clamped         /#/john/3/16-200  → 16-36 + URL rewritten
  - reversed range normalized  /#/john/3/20-16
  - legacy query form ignored  /#/gen/1?v=3&ve=5
  - combined path + hl param   /#/john/3/16?hl=사랑
  - invalid verse ignored      /#/john/3/abc
  - same-value range           /#/john/3/16-16
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
