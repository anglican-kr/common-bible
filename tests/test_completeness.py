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


class TestSearchIndex(unittest.TestCase):
    """Level 1: structural and content integrity of the chunked search index."""

    CHUNK_NAMES = ["nt", "dc", "ot"]
    CHUNK_FILES = {
        "nt": DATA_DIR / "search-nt.json",
        "dc": DATA_DIR / "search-dc.json",
        "ot": DATA_DIR / "search-ot.json",
    }
    META_FILE = DATA_DIR / "search-meta.json"

    DIVISION_MAP = {
        "nt": "new_testament",
        "dc": "deuterocanon",
        "ot": "old_testament",
    }

    @classmethod
    def setUpClass(cls):
        with open(cls.META_FILE, encoding="utf-8") as f:
            cls.meta = json.load(f)

        cls.chunks = {}
        for name, path in cls.CHUNK_FILES.items():
            with open(path, encoding="utf-8") as f:
                cls.chunks[name] = json.load(f)

        with open(BOOKS_JSON, encoding="utf-8") as f:
            books_list = json.load(f)
        cls.books_list = books_list
        cls.division_books = {}
        for b in books_list:
            cls.division_books.setdefault(b["division"], []).append(b["id"])

    # ── meta ────────────────────────────────────────────────────

    def test_meta_files_exist(self):
        """search-meta.json 및 3개 청크 파일이 존재해야 한다."""
        self.assertTrue(self.META_FILE.exists(), "search-meta.json 없음")
        for name, path in self.CHUNK_FILES.items():
            self.assertTrue(path.exists(), f"search-{name}.json 없음")

    def test_meta_has_all_books(self):
        """meta.books에 73권이 모두 있어야 한다."""
        self.assertEqual(len(self.meta["books"]), 73)

    def test_meta_aliases_not_empty(self):
        """meta.aliases가 비어있지 않아야 한다."""
        self.assertGreater(len(self.meta["aliases"]), 0)

    def test_meta_aliases_resolve_to_known_books(self):
        """모든 alias가 meta.books의 id를 가리켜야 한다."""
        known_ids = set(self.meta["books"].keys())
        for alias, bid in self.meta["aliases"].items():
            self.assertIn(bid, known_ids, f"alias '{alias}' → '{bid}' 는 알 수 없는 책 ID")

    # ── chunk structure ──────────────────────────────────────────

    def test_chunk_required_fields(self):
        """각 청크에 books, b, c, v, t 필드가 있어야 한다."""
        for name, chunk in self.chunks.items():
            for field in ("books", "b", "c", "v", "t"):
                self.assertIn(field, chunk, f"search-{name}.json에 '{field}' 필드 없음")

    def test_chunk_column_lengths_equal(self):
        """c, v, t 배열 길이가 모두 동일해야 한다."""
        for name, chunk in self.chunks.items():
            n = len(chunk["t"])
            self.assertEqual(len(chunk["c"]), n,
                             f"search-{name}.json: c 길이 {len(chunk['c'])} ≠ t 길이 {n}")
            self.assertEqual(len(chunk["v"]), n,
                             f"search-{name}.json: v 길이 {len(chunk['v'])} ≠ t 길이 {n}")

    def test_chunk_rle_integrity(self):
        """RLE b 배열의 count 합이 t 배열 길이와 일치해야 한다."""
        for name, chunk in self.chunks.items():
            rle_total = sum(cnt for _, cnt in chunk["b"])
            t_total = len(chunk["t"])
            self.assertEqual(rle_total, t_total,
                             f"search-{name}.json: RLE 합계 {rle_total} ≠ 절 수 {t_total}")

    def test_chunk_rle_indices_in_range(self):
        """RLE의 bookIndex가 books 배열 범위 안에 있어야 한다."""
        for name, chunk in self.chunks.items():
            n_books = len(chunk["books"])
            for idx, cnt in chunk["b"]:
                self.assertGreaterEqual(idx, 0,
                    f"search-{name}.json: 음수 bookIndex {idx}")
                self.assertLess(idx, n_books,
                    f"search-{name}.json: bookIndex {idx} ≥ books 크기 {n_books}")

    # ── division correctness ─────────────────────────────────────

    def test_chunk_contains_correct_division(self):
        """각 청크의 books 목록이 해당 division의 책만 포함해야 한다."""
        for name, chunk in self.chunks.items():
            expected_division = self.DIVISION_MAP[name]
            expected_ids = set(self.division_books.get(expected_division, []))
            for bid in chunk["books"]:
                self.assertIn(bid, expected_ids,
                    f"search-{name}.json에 {expected_division} 아닌 책 '{bid}' 포함됨")

    def test_all_books_covered(self):
        """73권 모두 어느 한 청크에 속해야 한다."""
        covered = set()
        for chunk in self.chunks.values():
            covered.update(chunk["books"])
        all_ids = {b["id"] for b in self.books_list}
        missing = all_ids - covered
        self.assertEqual(len(missing), 0, f"인덱스에 없는 책: {missing}")

    # ── verse count consistency ──────────────────────────────────

    def test_total_verse_count_matches_bible_dir(self):
        """청크 절 수 합계가 data/bible/ 파일에서 집계한 절 수와 일치해야 한다."""
        import glob

        actual_total = 0
        for fpath in glob.glob(str(BIBLE_DIR / "*.json")):
            if "prologue" in os.path.basename(fpath):
                continue
            with open(fpath, encoding="utf-8") as f:
                data = json.load(f)
            actual_total += len([
                v for v in data["verses"]
                if any(s["text"].strip() for s in v.get("segments", [{"text": v.get("text", "")}]))
            ])

        indexed_total = sum(len(chunk["t"]) for chunk in self.chunks.values())
        self.assertEqual(indexed_total, actual_total,
            f"인덱스 절 수 {indexed_total} ≠ bible/ 절 수 {actual_total}")

    # ── text quality ─────────────────────────────────────────────

    def test_no_empty_verse_text(self):
        """빈 텍스트 절이 없어야 한다."""
        for name, chunk in self.chunks.items():
            for i, text in enumerate(chunk["t"]):
                self.assertTrue(text.strip(),
                    f"search-{name}.json: 인덱스 {i}번 절 텍스트가 비어있음")

    def test_no_pilcrow_in_text(self):
        """텍스트에 ¶ 문자가 남아있지 않아야 한다 (clean_text 누락 검출)."""
        for name, chunk in self.chunks.items():
            for i, text in enumerate(chunk["t"]):
                self.assertNotIn("¶", text,
                    f"search-{name}.json: 인덱스 {i}번 절에 ¶ 남아있음")

    def test_no_raw_newlines_in_text(self):
        """텍스트에 줄바꿈 문자가 없어야 한다."""
        for name, chunk in self.chunks.items():
            for i, text in enumerate(chunk["t"]):
                self.assertNotIn("\n", text,
                    f"search-{name}.json: 인덱스 {i}번 절에 줄바꿈 남아있음")


if __name__ == "__main__":
    unittest.main()
