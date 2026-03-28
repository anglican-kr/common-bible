"""
Build search-index.json for the global full-text search feature.

Reads all per-chapter JSON files from data/bible/ and book_mappings.json
to produce a single flat index used by the Web Worker at runtime.

Output: data/search-index.json
"""

import json
import glob
import os
import re
import sys

BIBLE_DIR = "data/bible"
BOOKS_JSON = "data/books.json"
BOOK_MAPPINGS = "data/book_mappings.json"
OUTPUT = "data/search-index.json"


def clean_text(text):
    """Remove pilcrow marks and normalize whitespace."""
    text = text.replace("¶ ", "").replace("¶", "")
    text = text.replace("\n", " ")
    return text.strip()


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(script_dir)

    books_path = os.path.join(root, BOOKS_JSON)
    mappings_path = os.path.join(root, BOOK_MAPPINGS)
    bible_dir = os.path.join(root, BIBLE_DIR)
    output_path = os.path.join(root, OUTPUT)

    for p in [books_path, mappings_path]:
        if not os.path.exists(p):
            print(f"오류: 파일을 찾을 수 없음 — {p}", file=sys.stderr)
            sys.exit(1)

    # Load books.json for canonical order
    with open(books_path, encoding="utf-8") as f:
        books_list = json.load(f)

    book_order = {}
    meta_books = {}
    for i, b in enumerate(books_list):
        book_order[b["id"]] = i
        meta_books[b["id"]] = {"ko": b["name_ko"], "bo": i}

    # Load book_mappings.json for aliases
    with open(mappings_path, encoding="utf-8") as f:
        mappings = json.load(f)

    aliases = {}
    for m in mappings:
        bid = m["id"]
        # Map korean_name to id
        aliases[m["korean_name"]] = bid
        # Map each alias
        for alias in m.get("aliases_ko", []):
            aliases[alias] = bid

    # Collect all chapter files (exclude prologues)
    pattern = os.path.join(bible_dir, "*.json")
    chapter_files = sorted(glob.glob(pattern))

    verses = []
    skipped = 0
    for fpath in chapter_files:
        fname = os.path.basename(fpath)
        if "prologue" in fname:
            skipped += 1
            continue

        with open(fpath, encoding="utf-8") as f:
            data = json.load(f)

        bid = data["book_id"]
        ch = data["chapter"]

        for v in data["verses"]:
            text = clean_text(v["text"])
            if not text:
                continue
            verses.append({
                "b": bid,
                "c": ch,
                "v": v["number"],
                "t": text,
            })

    # Sort by book order, chapter, verse
    verses.sort(key=lambda e: (book_order.get(e["b"], 999), e["c"], e["v"]))

    index = {
        "meta": {
            "aliases": aliases,
            "books": meta_books,
        },
        "verses": verses,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"검색 인덱스 생성 완료:")
    print(f"  {len(verses)}개 절 인덱싱")
    print(f"  {skipped}개 프롤로그 제외")
    print(f"  {len(aliases)}개 별칭 매핑")
    print(f"  {OUTPUT} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
