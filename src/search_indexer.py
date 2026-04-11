"""
Build chunked search index for the global full-text search feature.

Reads all per-chapter JSON files from data/bible/ and book_mappings.json
to produce 4 files used by the Web Worker at runtime:

  data/search-meta.json       — aliases + book metadata (~9 KB)
  data/search-nt.json         — New Testament verses (~1.3 MB)
  data/search-dc.json         — Deuterocanon verses (~700 KB)
  data/search-ot.json         — Old Testament verses (~3.8 MB)

Each chunk uses a columnar format with RLE-encoded book indices to
eliminate repeated JSON field names and reduce memory usage.
"""

import json
import glob
import os
import sys

BIBLE_DIR = "data/bible"
BOOKS_JSON = "data/books.json"
BOOK_MAPPINGS = "data/book_mappings.json"
META_OUTPUT = "data/search-meta.json"

# Chunks in load-priority order (NT first for fastest first-search response)
CHUNKS = [
    ("nt", "new_testament",  "data/search-nt.json"),
    ("dc", "deuterocanon",   "data/search-dc.json"),
    ("ot", "old_testament",  "data/search-ot.json"),
]


def clean_text(text):
    """Remove pilcrow marks and normalize whitespace."""
    text = text.replace("¶ ", "").replace("¶", "")
    text = text.replace("\n", " ")
    return text.strip()


def build_rle(book_idx_seq):
    """Compress a sequence of book indices into [[idx, count], ...] pairs."""
    if not book_idx_seq:
        return []
    rle = []
    cur, cnt = book_idx_seq[0], 1
    for idx in book_idx_seq[1:]:
        if idx == cur:
            cnt += 1
        else:
            rle.append([cur, cnt])
            cur, cnt = idx, 1
    rle.append([cur, cnt])
    return rle


def build_chunk(ordered_book_ids, all_verses):
    """
    Filter verses by division and encode as columnar format with RLE book index.

    Returns:
      {
        "books": [...],          # ordered book IDs for this chunk
        "b": [[idx, count], ...], # RLE-encoded book index per verse
        "c": [...],              # chapter numbers
        "v": [...],              # verse numbers
        "t": [...],              # verse texts
      }
    """
    div_set = set(ordered_book_ids)
    div_verses = [v for v in all_verses if v["b"] in div_set]
    book_to_idx = {b: i for i, b in enumerate(ordered_book_ids)}
    book_idx_seq = [book_to_idx[v["b"]] for v in div_verses]
    return {
        "books": ordered_book_ids,
        "b": build_rle(book_idx_seq),
        "c": [v["c"] for v in div_verses],
        "v": [v["v"] for v in div_verses],
        "t": [v["t"] for v in div_verses],
    }


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(script_dir)

    books_path = os.path.join(root, BOOKS_JSON)
    mappings_path = os.path.join(root, BOOK_MAPPINGS)
    bible_dir = os.path.join(root, BIBLE_DIR)

    for p in [books_path, mappings_path]:
        if not os.path.exists(p):
            print(f"오류: 파일을 찾을 수 없음 — {p}", file=sys.stderr)
            sys.exit(1)

    # Load books.json for canonical order and division
    with open(books_path, encoding="utf-8") as f:
        books_list = json.load(f)

    book_order = {}
    meta_books = {}
    division_books = {}  # division -> [book_id, ...] in canonical order
    for i, b in enumerate(books_list):
        bid = b["id"]
        book_order[bid] = i
        meta_books[bid] = {"ko": b["name_ko"], "bo": i}
        div = b["division"]
        division_books.setdefault(div, []).append(bid)

    # Load book_mappings.json for aliases
    with open(mappings_path, encoding="utf-8") as f:
        mappings = json.load(f)

    aliases = {}
    for m in mappings:
        bid = m["id"]
        aliases[m["korean_name"]] = bid
        for alias in m.get("aliases_ko", []):
            aliases[alias] = bid

    # Collect all chapter files (exclude prologues)
    pattern = os.path.join(bible_dir, "*.json")
    chapter_files = sorted(glob.glob(pattern))

    all_verses = []
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
            # Support both old 'text' format and new 'segments' format
            if "segments" in v:
                text = clean_text(" ".join(s["text"] for s in v["segments"]))
            else:
                text = clean_text(v["text"])
            if not text:
                continue
            all_verses.append({
                "b": bid,
                "c": ch,
                "v": v["number"],
                "t": text,
            })

    # Sort by book order, chapter, verse
    all_verses.sort(key=lambda e: (book_order.get(e["b"], 999), e["c"], e["v"]))

    # Write meta file
    meta_path = os.path.join(root, META_OUTPUT)
    meta = {"aliases": aliases, "books": meta_books}
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    meta_kb = os.path.getsize(meta_path) / 1024
    print(f"  {META_OUTPUT} ({meta_kb:.1f} KB) — {len(aliases)}개 별칭, {len(meta_books)}권")

    # Write each chunk
    total_verses = 0
    for name, division, output_rel in CHUNKS:
        ordered_ids = division_books.get(division, [])
        chunk = build_chunk(ordered_ids, all_verses)
        verse_count = len(chunk["t"])
        total_verses += verse_count

        output_path = os.path.join(root, output_rel)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(chunk, f, ensure_ascii=False, separators=(",", ":"))
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"  {output_rel} ({size_mb:.2f} MB) — {verse_count}개 절")

    print(f"\n검색 인덱스 생성 완료: 총 {total_verses}개 절 ({skipped}개 프롤로그 제외)")


if __name__ == "__main__":
    main()
