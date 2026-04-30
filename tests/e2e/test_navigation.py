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
