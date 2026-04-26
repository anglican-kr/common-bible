"""
Split parsed_bible.json into per-chapter JSON files.

Outputs:
  data/bible/{book_id}-{chapter}.json  — one file per chapter (1382 total)
  data/bible/sir-prologue.json         — Sirach prologue (ADR-002)
  data/books.json                      — book metadata with chapter counts
"""

import json
import os
import sys

PARSED_BIBLE = "output/parsed_bible.json"
SOURCE_TEXT = "data/common-bible-kr.txt"
BOOK_MAPPINGS = "data/book_mappings.json"
BIBLE_OUTPUT_DIR = "data/bible"
BOOKS_JSON = "data/books.json"

SIRACH_ID = "sir"


def load_parsed_bible(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_book_mappings(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def extract_sirach_prologue(source_path):
    """Extract Sirach prologue from source text.

    The prologue appears as a single line starting with '집회 머리말',
    with two paragraphs separated by '◎'.
    """
    with open(source_path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("집회 머리말"):
                text = line[len("집회 머리말"):].strip()
                paragraphs = [p.strip() for p in text.split("◎") if p.strip()]
                return paragraphs
    return []


def split_chapters(chapters, output_dir):
    """Write each chapter to its own JSON file."""
    os.makedirs(output_dir, exist_ok=True)
    count = 0
    for ch in chapters:
        bid = ch["book_id"]
        num = ch["chapter_number"]
        # Omit null chapter_ref to keep verse objects lean
        verses = []
        for v in ch["verses"]:
            # Support both old 'text' format and new 'segments' format
            if "segments" in v:
                segments = [
                    {k: seg[k] for k in ("type", "text") if k in seg}
                    | ({"paragraph_break": True} if seg.get("paragraph_break") else {})
                    for seg in v["segments"]
                ]
            else:
                text = v["text"]
                seg_type = "poetry" if '\n' in text and not text.split('\n')[1].startswith('¶') else "prose"
                segments = [{"type": seg_type, "text": text}]
            verse = {"number": v["number"], "segments": segments}
            if v.get("stanza_break"):
                verse["stanza_break"] = True
            for field in ("chapter_ref", "range_end", "part", "alt_ref"):
                if v.get(field) is not None:
                    verse[field] = v[field]
            verses.append(verse)

        has_dual = any(v.get("alt_ref") is not None for v in ch["verses"])
        data = {
            "book_id": bid,
            "book_name_ko": ch["book_name_ko"],
            "book_name_en": ch["book_name_en"],
            "chapter": num,
            "verses": verses,
        }
        if has_dual:
            data["has_dual_numbering"] = True
        path = os.path.join(output_dir, f"{bid}-{num}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        count += 1
    return count


def write_sirach_prologue(paragraphs, output_dir):
    """Write Sirach prologue to sir-prologue.json."""
    data = {
        "book_id": SIRACH_ID,
        "book_name_ko": "집회서",
        "book_name_en": "Sirach",
        "type": "prologue",
        "paragraphs": paragraphs,
    }
    path = os.path.join(output_dir, f"{SIRACH_ID}-prologue.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return path


def build_books_json(chapters, mappings):
    """Build books.json ordered list with chapter counts and prologue flags."""
    # Count chapters per book (chapter_number may not be contiguous, so take max)
    chapter_counts = {}
    for ch in chapters:
        bid = ch["book_id"]
        chapter_counts[bid] = max(chapter_counts.get(bid, 0), ch["chapter_number"])

    books = []
    for item in mappings:
        bid = item.get("id")
        if not bid:
            continue
        books.append({
            "id": bid,
            "name_ko": item.get("korean_name", ""),
            "short_name_ko": item.get("short_name_ko", item.get("korean_name", "")),
            "name_en": item.get("english_name", ""),
            "division": item.get("testament", ""),
            "chapter_count": chapter_counts.get(bid, 0),
            "has_prologue": bid == SIRACH_ID,
        })

    return books


def write_books_json(books, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(books, f, ensure_ascii=False, indent=2)


def main():
    # Resolve paths relative to project root (one level up from src/)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(script_dir)

    parsed_path = os.path.join(root, PARSED_BIBLE)
    source_path = os.path.join(root, SOURCE_TEXT)
    mappings_path = os.path.join(root, BOOK_MAPPINGS)
    bible_dir = os.path.join(root, BIBLE_OUTPUT_DIR)
    books_path = os.path.join(root, BOOKS_JSON)

    # Validate inputs
    for p in [parsed_path, source_path, mappings_path]:
        if not os.path.exists(p):
            print(f"오류: 파일을 찾을 수 없음 — {p}", file=sys.stderr)
            sys.exit(1)

    # Load data
    print("parsed_bible.json 로드 중...")
    chapters = load_parsed_bible(parsed_path)
    print(f"  {len(chapters)}개 장 로드됨")

    mappings = load_book_mappings(mappings_path)

    # Split chapters
    print(f"\n장별 JSON 분리 중 → {BIBLE_OUTPUT_DIR}/")
    count = split_chapters(chapters, bible_dir)
    print(f"  {count}개 파일 생성 완료")

    # Sirach prologue
    print("\n집회서 머리말 추출 중...")
    paragraphs = extract_sirach_prologue(source_path)
    if paragraphs:
        prologue_path = write_sirach_prologue(paragraphs, bible_dir)
        print(f"  {len(paragraphs)}개 단락 → {os.path.relpath(prologue_path, root)}")
    else:
        print("  경고: 머리말을 찾지 못했습니다", file=sys.stderr)

    # books.json
    print(f"\nbooks.json 생성 중...")
    books = build_books_json(chapters, mappings)
    write_books_json(books, books_path)
    print(f"  {len(books)}권 → {BOOKS_JSON}")

    print("\n완료.")


if __name__ == "__main__":
    main()
