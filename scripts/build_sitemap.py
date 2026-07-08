#!/usr/bin/env python3
"""Build sitemap.xml from books.json with per-chapter lastmod.

lastmod sources (most specific wins):
  - /{book}/{chapter}     last commit touching data/bible/{book}-{chapter}.json
  - /{book}/prologue      last commit touching data/bible/{book}-prologue.json
  - /{book}               max chapter lastmod within that book
  - /privacy.html         last commit touching privacy.html in this repo
  - /                     max lastmod across the whole sitemap

Build pipeline is deterministic (verified: source-only edits produce sparse
bible/*.json diffs), so each chapter's git log faithfully tracks real content
changes. One submodule git log call walks the entire history.
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

COMMIT_PREFIX = "COMMIT "


def chapter_lastmod_map() -> dict[str, str]:
    """Walk data submodule history once: {bible/<file>.json: ISO8601 lastmod}."""
    out = subprocess.run(
        ["git", "-C", str(DATA_DIR), "log",
         "--name-only", "--diff-filter=ACMR",
         f"--format={COMMIT_PREFIX}%cI", "--", "bible/"],
        check=True, capture_output=True, text=True,
    ).stdout

    mapping: dict[str, str] = {}
    current: str | None = None
    for line in out.splitlines():
        if line.startswith(COMMIT_PREFIX):
            current = line[len(COMMIT_PREFIX):]
        elif line and current and line not in mapping:
            mapping[line] = current
    return mapping


def file_lastmod(repo: Path, path: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), "log", "-1", "--format=%cI", "--", path],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def data_repo_lastmod() -> str:
    return subprocess.run(
        ["git", "-C", str(DATA_DIR), "log", "-1", "--format=%cI"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def build_entries(books, chapters):
    fallback = data_repo_lastmod()

    def lookup(file_path: str) -> str:
        return chapters.get(file_path) or fallback

    book_lastmods: dict[str, str] = {}
    chapter_entries: list[tuple[str, str]] = []
    prologue_entries: list[tuple[str, str]] = []

    for book in books:
        bid = book["id"]
        per_book: list[str] = []

        if book.get("has_prologue"):
            ts = lookup(f"bible/{bid}-prologue.json")
            prologue_entries.append((f"{BASE_URL}/{bid}/prologue", ts))
            per_book.append(ts)

        for chapter in range(1, book["chapter_count"] + 1):
            ts = lookup(f"bible/{bid}-{chapter}.json")
            chapter_entries.append((f"{BASE_URL}/{bid}/{chapter}", ts))
            per_book.append(ts)

        book_lastmods[bid] = max(per_book) if per_book else fallback

    entries: list[tuple[str, str]] = []
    overall_max = fallback

    # Root carries the freshest lastmod overall.
    root_lastmod = max([fallback, *book_lastmods.values()])
    entries.append((f"{BASE_URL}/", root_lastmod))

    privacy_lastmod = file_lastmod(REPO_ROOT, "privacy.html")
    entries.append((f"{BASE_URL}/privacy.html", privacy_lastmod))
    overall_max = max(overall_max, root_lastmod, privacy_lastmod)

    for book in books:
        bid = book["id"]
        entries.append((f"{BASE_URL}/{bid}", book_lastmods[bid]))

    # Interleave prologue ahead of chapters per book? Match prior ordering:
    # book-index first, then prologue if any, then chapters 1..N. Rebuild
    # ordering by walking books again, drawing from prepared lists.
    prologue_by_book = {url.rsplit("/", 2)[1]: (url, ts)
                        for url, ts in prologue_entries}
    chapter_by_book: dict[str, list[tuple[str, str]]] = {}
    for url, ts in chapter_entries:
        bid = url.rsplit("/", 2)[1]
        chapter_by_book.setdefault(bid, []).append((url, ts))

    # Rebuild entries in canonical order: root, privacy, then per-book block.
    ordered: list[tuple[str, str]] = [
        (f"{BASE_URL}/", root_lastmod),
        (f"{BASE_URL}/privacy.html", privacy_lastmod),
    ]
    for book in books:
        bid = book["id"]
        ordered.append((f"{BASE_URL}/{bid}", book_lastmods[bid]))
        if bid in prologue_by_book:
            ordered.append(prologue_by_book[bid])
        ordered.extend(chapter_by_book.get(bid, []))

    return ordered


def main() -> int:
    books = json.loads(BOOKS_JSON.read_text("utf-8"))
    chapters = chapter_lastmod_map()
    entries = build_entries(books, chapters)

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for url, lastmod in entries:
        lines.extend([
            "  <url>",
            f"    <loc>{url}</loc>",
            f"    <lastmod>{lastmod}</lastmod>",
            "  </url>",
        ])
    lines.append("</urlset>")
    lines.append("")

    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    distinct = len({ts for _, ts in entries})
    print(f"Wrote {OUTPUT.relative_to(REPO_ROOT)}: "
          f"{len(entries)} URLs, {distinct} distinct lastmod values")
    return 0


if __name__ == "__main__":
    sys.exit(main())
