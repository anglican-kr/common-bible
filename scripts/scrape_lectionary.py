#!/usr/bin/env python3
"""
Lectionary scraper for seoul.anglican.kr tag archives.

Collects every post under a tag (default: 감사성찬례) and extracts the
reading summary line shown beneath each title in the archive listing,
e.g. "이사 35:1-10 / 루가 1:46하-55, 성모송가 / 야고 5:7-10 / 마태 11:2-11".

Two strategies, tried in order:

  1. WordPress REST API (`/wp-json/wp/v2/...`) — resolves the tag id, then
     pages through all posts. The reading summary is the post excerpt.
  2. HTML archive pages (`/archives/tag/<tag>/page/<n>/`) — fallback when
     the REST API is disabled. Parses <article> blocks with regexes.

Output JSON shape:

    {
      "source": "https://seoul.anglican.kr/archives/tag/감사성찬례",
      "tag": "감사성찬례",
      "scraped_at": "2026-06-11T00:00:00+00:00",
      "post_count": 123,
      "posts": [
        {
          "title": "대림3주 (가해) 2",
          "date": "2025-12-14",
          "url": "https://seoul.anglican.kr/archives/12345",
          "readings_raw": "이사 35:1-10 / 루가 1:46하-55, 성모송가 / ...",
          "readings": ["이사 35:1-10", "루가 1:46하-55, 성모송가", ...]
        },
        ...
      ]
    }

Requires direct network access to seoul.anglican.kr (stdlib only, no
third-party packages).

Usage:
    python scripts/scrape_lectionary.py                       # default tag
    python scripts/scrape_lectionary.py --tag 감사성찬례 -o out.json
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape

DEFAULT_BASE_URL = "https://seoul.anglican.kr"
DEFAULT_TAG = "감사성찬례"
REQUEST_DELAY_SECONDS = 0.5

# Some WAFs reject the default urllib user agent outright.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def fetch(url, accept="*/*"):
    """GET a URL and return the decoded body plus response headers."""
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": accept}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace"), resp.headers


def strip_tags(html):
    """Drop markup, decode entities, collapse whitespace."""
    text = re.sub(r"<[^>]+>", " ", html)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def clean_excerpt(text):
    """Remove WordPress auto-excerpt trailers like '[…]' or '…'."""
    text = re.sub(r"\[\s*(…|&hellip;|\.{3})\s*\]\s*$", "", text)
    return text.rstrip("… .").strip()


def split_readings(raw):
    """Split the summary line on '/' — individual references never contain it."""
    return [part.strip() for part in raw.split("/") if part.strip()]


def looks_like_readings(text):
    """A readings line has Korean book abbreviations with numbers and '/'
    separators, e.g. '이사 35:1-10 / 시편 131 / ...'."""
    return bool(re.search(r"[가-힣]{2,6}\s?\d", text)) and (
        "/" in text or re.search(r"\d+:\d+", text)
    )


# ── strategy 1: WordPress REST API ──


def rest_resolve_tag(base_url, tag_name):
    """Return the numeric tag id for an exact tag-name match, or None."""
    url = (
        f"{base_url}/wp-json/wp/v2/tags?per_page=100&search="
        + urllib.parse.quote(tag_name)
    )
    body, _ = fetch(url, accept="application/json")
    for tag in json.loads(body):
        if tag.get("name") == tag_name:
            return tag["id"]
    return None


def rest_fetch_posts(base_url, tag_id):
    """Page through all posts carrying the tag via the REST API."""
    posts = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        url = (
            f"{base_url}/wp-json/wp/v2/posts?tags={tag_id}&per_page=100"
            f"&page={page}&_fields=date,link,title,excerpt"
        )
        body, headers = fetch(url, accept="application/json")
        total_pages = int(headers.get("X-WP-TotalPages", "1"))
        for post in json.loads(body):
            raw = clean_excerpt(strip_tags(post["excerpt"]["rendered"]))
            posts.append(
                {
                    "title": strip_tags(post["title"]["rendered"]),
                    "date": post["date"][:10],
                    "url": post["link"],
                    "readings_raw": raw,
                    "readings": split_readings(raw),
                }
            )
        page += 1
        time.sleep(REQUEST_DELAY_SECONDS)
    return posts


# ── strategy 2: HTML archive pages ──


def parse_archive_page(html):
    """Extract (title, date, url, summary) from each <article> block."""
    posts = []
    for block in re.findall(r"<article\b.*?</article>", html, re.S):
        title_match = re.search(
            r"<h\d[^>]*entry-title[^>]*>\s*<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>",
            block,
            re.S,
        ) or re.search(
            r"<h\d[^>]*>\s*<a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a>", block, re.S
        )
        if not title_match:
            continue
        url, title_html = title_match.groups()
        date_match = re.search(r"<time[^>]+datetime=\"([^\"]+)\"", block)

        summary = ""
        body = block[title_match.end():]
        for para in re.findall(r"<p[^>]*>(.*?)</p>", body, re.S):
            text = clean_excerpt(strip_tags(para))
            if looks_like_readings(text):
                summary = text
                break

        posts.append(
            {
                "title": strip_tags(title_html),
                "date": date_match.group(1)[:10] if date_match else None,
                "url": url,
                "readings_raw": summary,
                "readings": split_readings(summary),
            }
        )
    return posts


def html_fetch_posts(base_url, tag_name):
    """Walk /archives/tag/<tag>/page/<n>/ until a 404 or an empty page."""
    posts = []
    quoted = urllib.parse.quote(tag_name)
    page = 1
    while True:
        suffix = "" if page == 1 else f"/page/{page}"
        url = f"{base_url}/archives/tag/{quoted}{suffix}"
        try:
            body, _ = fetch(url, accept="text/html")
        except urllib.error.HTTPError as err:
            if err.code == 404:
                break
            raise
        page_posts = parse_archive_page(body)
        if not page_posts:
            break
        posts.extend(page_posts)
        page += 1
        time.sleep(REQUEST_DELAY_SECONDS)
    return posts


# ── entry point ──


def scrape(base_url, tag_name):
    try:
        tag_id = rest_resolve_tag(base_url, tag_name)
        if tag_id is not None:
            posts = rest_fetch_posts(base_url, tag_id)
            if posts:
                return posts, "rest-api"
        print("REST API returned no matching tag; falling back to HTML.",
              file=sys.stderr)
    except (urllib.error.URLError, json.JSONDecodeError, KeyError) as err:
        print(f"REST API unavailable ({err}); falling back to HTML.",
              file=sys.stderr)
    return html_fetch_posts(base_url, tag_name), "html-archive"


def main():
    parser = argparse.ArgumentParser(
        description="Scrape lectionary reading summaries from a tag archive."
    )
    parser.add_argument("--tag", default=DEFAULT_TAG, help="tag name to scrape")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument(
        "-o", "--output", default=None,
        help="output JSON path (default: lectionary-<tag>.json)",
    )
    args = parser.parse_args()
    output_path = args.output or f"lectionary-{args.tag}.json"

    posts, strategy = scrape(args.base_url, args.tag)
    if not posts:
        print("No posts found — the site may be blocking this client.",
              file=sys.stderr)
        return 1

    result = {
        "source": f"{args.base_url}/archives/tag/{args.tag}",
        "tag": args.tag,
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "strategy": strategy,
        "post_count": len(posts),
        "posts": posts,
    }
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"{len(posts)} posts → {output_path} (via {strategy})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
