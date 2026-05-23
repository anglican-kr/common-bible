#!/usr/bin/env python3
"""Build sitemap.xml from books.json.

All URLs share one lastmod: the latest commit timestamp of the
common-bible-data submodule. Run after `git submodule update --remote data`.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "https://bible.anglican.kr"
DATA_DIR = REPO_ROOT / "data"
BOOKS_JSON = DATA_DIR / "books.json"
OUTPUT = REPO_ROOT / "sitemap.xml"


def data_lastmod() -> str:
    result = subprocess.run(
        ["git", "-C", str(DATA_DIR), "log", "-1", "--format=%cI"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def iter_urls(books):
    yield f"{BASE_URL}/"
    yield f"{BASE_URL}/privacy.html"
    for book in books:
        bid = book["id"]
        yield f"{BASE_URL}/{bid}"
        if book.get("has_prologue"):
            yield f"{BASE_URL}/{bid}/prologue"
        for chapter in range(1, book["chapter_count"] + 1):
            yield f"{BASE_URL}/{bid}/{chapter}"


def main() -> int:
    books = json.loads(BOOKS_JSON.read_text("utf-8"))
    lastmod = data_lastmod()

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    count = 0
    for url in iter_urls(books):
        lines.extend([
            "  <url>",
            f"    <loc>{url}</loc>",
            f"    <lastmod>{lastmod}</lastmod>",
            "  </url>",
        ])
        count += 1
    lines.append("</urlset>")
    lines.append("")

    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUTPUT.relative_to(REPO_ROOT)}: {count} URLs, lastmod={lastmod}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
