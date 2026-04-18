#!/usr/bin/env python3
"""Level 2: verse ordering tests (ADR-004).

Verifies that data/bible/ verse sequences match the committed fixture.
Run after any parser.py or split_bible.py change.
"""

import json
import os
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).parent.parent
BIBLE_DIR = PROJECT_ROOT / "data" / "bible"
FIXTURE_PATH = PROJECT_ROOT / "tests" / "fixtures" / "verse_sequence.json"

with open(FIXTURE_PATH, encoding="utf-8") as _f:
    _FIXTURE: dict = json.load(_f)


def _actual_sequence(chapter_key: str) -> list:
    """Return the verse sequence from data/bible/ for the given chapter key."""
    fpath = BIBLE_DIR / f"{chapter_key}.json"
    with open(fpath, encoding="utf-8") as f:
        data = json.load(f)
    result = []
    for verse in data["verses"]:
        n = verse["number"]
        chapter_ref = verse.get("chapter_ref")
        if chapter_ref is not None:
            result.append({"n": n, "chapter_ref": chapter_ref})
        else:
            result.append(n)
    return result


def test_fixture_covers_all_chapters():
    """픽스처가 data/bible/ 의 모든 장을 포함해야 한다."""
    bible_keys = {
        f[:-5]
        for f in os.listdir(BIBLE_DIR)
        if f.endswith(".json") and f != "sir-prologue.json"
    }
    fixture_keys = set(_FIXTURE.keys())
    missing = bible_keys - fixture_keys
    assert not missing, f"픽스처에 없는 장: {sorted(missing)}"


def test_no_extra_chapters_in_fixture():
    """픽스처에 data/bible/ 에 없는 장이 없어야 한다."""
    bible_keys = {
        f[:-5]
        for f in os.listdir(BIBLE_DIR)
        if f.endswith(".json") and f != "sir-prologue.json"
    }
    extra = set(_FIXTURE.keys()) - bible_keys
    assert not extra, f"픽스처에만 있는 장: {sorted(extra)}"


@pytest.mark.parametrize("chapter_key", sorted(_FIXTURE.keys()))
def test_verse_sequence(chapter_key: str):
    """각 장의 절 순서·번호·chapter_ref가 픽스처와 일치해야 한다."""
    expected = _FIXTURE[chapter_key]
    actual = _actual_sequence(chapter_key)
    assert actual == expected, (
        f"{chapter_key}: 절 순서 불일치\n"
        f"  expected: {expected}\n"
        f"  actual  : {actual}"
    )
