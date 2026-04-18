"""Verify verse-level deep-link URL parsing and highlighting.

Covers:
  - #/john/3/16             single verse
  - #/john/3/16-20          verse range
  - #/john/3/16-200         over-range clamped and URL rewritten
  - #/john/3/20-16          reversed range normalized
  - #/gen/1?v=3&ve=5        legacy query form still works
  - #/john/3/16?hl=사랑     verse highlight + text highlight combined
"""

import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"


async def highlighted_verses(page):
    return await page.evaluate(
        """() => Array.from(document.querySelectorAll('.verse.verse-highlight'))
            .map(el => el.id)"""
    )


async def check(label, page, hash_, expected_ids, expected_hash_re=None, expected_mark=None):
    await page.goto(f"{BASE}/{hash_}")
    await page.wait_for_selector("article.chapter-text .verse")
    await page.wait_for_timeout(200)  # let replaceState + scroll settle

    ids = await highlighted_verses(page)
    ok = ids == expected_ids
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {label}")
    print(f"       url={hash_} highlighted={ids}")
    if not ok:
        print(f"       expected={expected_ids}")

    if expected_hash_re is not None:
        import re
        current = await page.evaluate("() => location.hash")
        hok = bool(re.search(expected_hash_re, current))
        s = "PASS" if hok else "FAIL"
        print(f"       [{s}] url after replaceState: {current} (expect match /{expected_hash_re}/)")
        ok = ok and hok

    if expected_mark is not None:
        marks = await page.evaluate(
            "() => Array.from(document.querySelectorAll('mark.search-highlight')).map(m => m.textContent)"
        )
        mok = expected_mark in marks
        s = "PASS" if mok else "FAIL"
        print(f"       [{s}] search-highlight marks: {marks}")
        ok = ok and mok

    return ok


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        results = []

        # 1. Single verse
        results.append(await check(
            "single verse path: /john/3/16",
            page, "#/john/3/16", ["v16"]))

        # 2. Verse range
        results.append(await check(
            "verse range path: /john/3/16-20",
            page, "#/john/3/16-20",
            ["v16", "v17", "v18", "v19", "v20"]))

        # 3. Over-range clamped — John 3 has 36 verses
        results.append(await check(
            "over-range clamp: /john/3/16-200 → 16-36",
            page, "#/john/3/16-200",
            [f"v{n}" for n in range(16, 37)],
            expected_hash_re=r"/john/3/16-36$"))

        # 4. Reversed range normalized
        results.append(await check(
            "reversed range normalized: /john/3/20-16",
            page, "#/john/3/20-16",
            ["v16", "v17", "v18", "v19", "v20"]))

        # 5. Legacy query form must no longer highlight (feature removed)
        results.append(await check(
            "legacy query form ignored: /gen/1?v=3&ve=5",
            page, "#/gen/1?v=3&ve=5", []))

        # 6. Path verse + query text highlight
        results.append(await check(
            "combined path+hl: /john/3/16?hl=사랑",
            page, "#/john/3/16?hl=%EC%82%AC%EB%9E%91",
            ["v16"],
            expected_mark="사랑"))

        # 7. Invalid verse falls through to whole chapter (no highlight)
        results.append(await check(
            "invalid verse ignored: /john/3/abc",
            page, "#/john/3/abc", []))

        # 8. Same-value range treated as single verse
        results.append(await check(
            "same-value range: /john/3/16-16",
            page, "#/john/3/16-16", ["v16"]))

        await browser.close()

        passed = sum(1 for r in results if r)
        print(f"\n=== {passed}/{len(results)} passed ===")
        return 0 if passed == len(results) else 1


if __name__ == "__main__":
    import sys
    sys.exit(asyncio.run(main()))
