#!/usr/bin/env python3
"""Level 3: snapshot tests for special-case verses (ADR-004).

Verifies hard-coded known values for cross-chapter insertions and
verse reordering cases described in ADR-003.
No source text or fixture generation required.
"""

import json
from pathlib import Path

import pytest

BIBLE_DIR = Path(__file__).parent.parent / "data" / "bible"


def load(book_chapter: str) -> list:
    with open(BIBLE_DIR / f"{book_chapter}.json", encoding="utf-8") as f:
        return json.load(f)["verses"]


# ── Cross-chapter insertions ─────────────────────────────────────────────────


class TestCrossChapterInsertions:
    """ADR-003: 다른 장의 절이 삽입된 6곳 검증."""

    def test_isa40_contains_isa41_verses(self):
        """이사야 40장에 41:6·7절이 삽입되어 있어야 한다."""
        verses = load("isa-40")
        cross = [(v["number"], v["chapter_ref"]) for v in verses if v.get("chapter_ref")]
        assert cross == [(6, 41), (7, 41)]

    def test_isa41_missing_verses_6_7(self):
        """이사야 41장에는 6·7절이 없어야 한다 (40장으로 이동됨)."""
        nums = [v["number"] for v in load("isa-41")]
        assert 6 not in nums
        assert 7 not in nums

    def test_prov5_contains_prov6_verse(self):
        """잠언 5장에 6:22절이 삽입되어 있어야 한다."""
        verses = load("prov-5")
        cross = [(v["number"], v["chapter_ref"]) for v in verses if v.get("chapter_ref")]
        assert cross == [(22, 6)]

    def test_hos14_verse_order_includes_displaced_verse(self):
        """호세아 14장에 13장에서 온 14절이 5절 직후에 위치해야 한다."""
        nums = [v["number"] for v in load("hos-14")]
        # verse 14 must appear between verse 5 and verse 6
        assert nums.index(14) == nums.index(5) + 1

    def test_hos13_missing_verse_14(self):
        """호세아 13장에 14절이 없어야 한다 (14장으로 이동됨)."""
        nums = [v["number"] for v in load("hos-13")]
        assert 14 not in nums

    def test_job27_contains_job24_verses(self):
        """욥기 27장에 24:18-24절이 삽입되어 있어야 한다."""
        verses = load("job-27")
        cross = [(v["number"], v["chapter_ref"]) for v in verses if v.get("chapter_ref")]
        assert cross == [
            (18, 24), (19, 24), (20, 24),
            (21, 24), (22, 24), (23, 24), (24, 24),
        ]


# ── Same-chapter reordering ──────────────────────────────────────────────────


class TestChapterReordering:
    """ADR-003: 같은 장 안에서 절이 재배치된 케이스 검증."""

    def test_amos5_reordered_sequence(self):
        """아모스 5장 절 순서가 원본 물리적 순서와 일치해야 한다."""
        nums = [v["number"] for v in load("amos-5")]
        assert nums == [
            1, 2, 3, 4, 5, 6,
            9, 8, 7,
            10, 11, 12, 13, 14, 15, 16,
            18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
        ]

    def test_amos6_reordered_sequence(self):
        """아모스 6장 절 순서가 원본 물리적 순서와 일치해야 한다."""
        nums = [v["number"] for v in load("amos-6")]
        assert nums == [1, 13, 2, 3, 4, 5, 6, 7, 8, 14, 11, 9, 10, 12]

    def test_isa40_verse_order_with_cross_chapter(self):
        """이사야 40장 절 순서 (19절 뒤에 41:6·7 삽입, 그 뒤 20절로 복귀)."""
        nums = [v["number"] for v in load("isa-40")]
        pos19 = nums.index(19)
        # After verse 19, the next two entries are the cross-chapter 6, 7
        assert nums[pos19 + 1] == 6
        assert nums[pos19 + 2] == 7
        assert nums[pos19 + 3] == 20
