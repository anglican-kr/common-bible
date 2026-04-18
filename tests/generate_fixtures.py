#!/usr/bin/env python3
"""Generate tests/fixtures/verse_sequence.json from data/bible/*.json.

Run locally after any parser.py or split_bible.py change, then commit the result.
Requires data/bible/ (not available in CI without data submodule).

Usage:
    python tests/generate_fixtures.py
"""

import glob
import json
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
BIBLE_DIR = PROJECT_ROOT / "data" / "bible"
OUTPUT = PROJECT_ROOT / "tests" / "fixtures" / "verse_sequence.json"


def main():
    sequence = {}

    for fpath in sorted(glob.glob(str(BIBLE_DIR / "*.json"))):
        fname = os.path.basename(fpath)
        if fname == "sir-prologue.json":
            continue

        key = fname[:-5]  # strip .json

        with open(fpath, encoding="utf-8") as f:
            data = json.load(f)

        verse_list = []
        for verse in data["verses"]:
            n = verse["number"]
            chapter_ref = verse.get("chapter_ref")
            if chapter_ref is not None:
                verse_list.append({"n": n, "chapter_ref": chapter_ref})
            else:
                verse_list.append(n)

        sequence[key] = verse_list

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(sequence, f, ensure_ascii=False, separators=(",", ":"))

    total_verses = sum(len(v) for v in sequence.values())
    print(f"Written {len(sequence)} chapters, {total_verses} verses → {OUTPUT}")


if __name__ == "__main__":
    main()
