#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Level 1 completeness tests (ADR-004).
Verifies that the data pipeline output is structurally complete and consistent.
No source text required — runs against data/ directory only.
"""

import json
import os
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.absolute()
sys.path.insert(0, str(PROJECT_ROOT))

DATA_DIR = PROJECT_ROOT / "data"
BIBLE_DIR = DATA_DIR / "bible"
BOOKS_JSON = DATA_DIR / "books.json"


class TestCompleteness(unittest.TestCase):
    """Level 1: structural completeness of data/ directory."""

    @classmethod
    def setUpClass(cls):
        with open(BOOKS_JSON, encoding="utf-8") as f:
            cls.books = json.load(f)
        cls.bible_files = set(os.listdir(BIBLE_DIR))

    # ── books.json ──────────────────────────────────────────────

    def test_book_count(self):
        """73권이 존재해야 한다."""
        self.assertEqual(len(self.books), 73)

    def test_has_prologue_flag_only_sir(self):
        """has_prologue 플래그는 집회서(sir)만 true여야 한다."""
        for book in self.books:
            if book["id"] == "sir":
                self.assertTrue(book.get("has_prologue"), "sir must have has_prologue=true")
            else:
                self.assertFalse(book.get("has_prologue", False),
                                 f"{book['id']} must not have has_prologue")

    def test_chapter_count_matches_files(self):
        """books.json의 chapter_count가 실제 파일 수와 일치해야 한다."""
        for book in self.books:
            bid = book["id"]
            expected = book["chapter_count"]
            actual = sum(
                1 for f in self.bible_files
                if f.startswith(f"{bid}-") and f.endswith(".json")
                and f != "sir-prologue.json"
            )
            self.assertEqual(actual, expected,
                             f"{bid}: expected {expected} files, found {actual}")

    # ── data/bible/ ─────────────────────────────────────────────

    def test_total_chapter_file_count(self):
        """장 파일이 1328개여야 한다."""
        chapter_files = [f for f in self.bible_files
                         if f.endswith(".json") and f != "sir-prologue.json"]
        self.assertEqual(len(chapter_files), 1328)

    def test_sir_prologue_exists(self):
        """sir-prologue.json이 존재해야 한다."""
        self.assertIn("sir-prologue.json", self.bible_files)

    def test_sir_prologue_structure(self):
        """sir-prologue.json은 paragraphs 2개, type == 'prologue'여야 한다."""
        path = BIBLE_DIR / "sir-prologue.json"
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data.get("type"), "prologue")
        self.assertEqual(len(data.get("paragraphs", [])), 2)

    # ── chapter JSON schema ──────────────────────────────────────

    def test_chapter_json_has_required_fields(self):
        """장 JSON에 book_id, chapter, verses 필드가 있어야 한다. (창세기 1장으로 대표 검증)"""
        path = BIBLE_DIR / "gen-1.json"
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        self.assertIn("book_id", data)
        self.assertIn("chapter", data)
        self.assertIn("verses", data)
        self.assertIsInstance(data["verses"], list)
        self.assertGreater(len(data["verses"]), 0)

    def test_verse_has_segments(self):
        """절에 segments 배열이 있어야 한다. (창세기 1장으로 대표 검증)"""
        path = BIBLE_DIR / "gen-1.json"
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for verse in data["verses"]:
            self.assertIn("segments", verse, f"verse {verse.get('number')} missing segments")
            for seg in verse["segments"]:
                self.assertIn("type", seg)
                self.assertIn(seg["type"], ("prose", "poetry"))
                self.assertIn("text", seg)


if __name__ == "__main__":
    unittest.main()
