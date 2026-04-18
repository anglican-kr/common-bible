"""Verify that partial verse selection expands to full verse boundaries on copy."""

import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"


async def run_case(page, label, script, expected_substrings, unexpected_substrings=()):
    await page.goto(f"{BASE}/#/john/3")
    await page.wait_for_selector("article.chapter-text .verse")
    await page.wait_for_timeout(150)

    text = await page.evaluate(script)
    ok = all(s in text for s in expected_substrings) and all(
        s not in text for s in unexpected_substrings
    )
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {label}")
    print(f"       copied={text!r}")
    if not ok:
        print(f"       expected all of={expected_substrings}")
        if unexpected_substrings:
            print(f"       expected none of={unexpected_substrings}")
    return ok


COPY_SCRIPT_TEMPLATE = """
async () => {
  const article = document.querySelector('article.chapter-text');
  %SELECT%

  const dt = new DataTransfer();
  const ev = new ClipboardEvent('copy', {
    bubbles: true, cancelable: true, clipboardData: dt
  });
  article.dispatchEvent(ev);
  return dt.getData('text/plain');
}
"""


def script_for(select_js):
    return COPY_SCRIPT_TEMPLATE.replace("%SELECT%", select_js)


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        await context.grant_permissions(["clipboard-read", "clipboard-write"])
        page = await context.new_page()

        results = []

        # Helper: use a TreeWalker to find the first text node inside a verse.
        select_middle_of_v16 = """
          const v16 = document.getElementById('v16');
          const w = document.createTreeWalker(v16, NodeFilter.SHOW_TEXT);
          const t = w.nextNode();
          const r = document.createRange();
          const mid = Math.floor(t.length / 2);
          r.setStart(t, mid);
          r.setEnd(t, Math.min(mid + 3, t.length));
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        """

        results.append(await run_case(
            page,
            "partial selection within v16 expands to full verse",
            script_for(select_middle_of_v16),
            expected_substrings=["하느님", "사랑"],  # John 3:16 key words
        ))

        select_cross_v16_v17 = """
          const v16 = document.getElementById('v16');
          const v17 = document.getElementById('v17');
          const w1 = document.createTreeWalker(v16, NodeFilter.SHOW_TEXT);
          const t16 = w1.nextNode();
          const w2 = document.createTreeWalker(v17, NodeFilter.SHOW_TEXT);
          const t17 = w2.nextNode();
          const r = document.createRange();
          r.setStart(t16, Math.floor(t16.length / 2));
          r.setEnd(t17, Math.min(5, t17.length));
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
        """

        results.append(await run_case(
            page,
            "cross-verse partial selection expands to full v16+v17",
            script_for(select_cross_v16_v17),
            expected_substrings=["하느님", "사랑"],
            unexpected_substrings=["¶"],
        ))

        await browser.close()
        passed = sum(1 for r in results if r)
        print(f"\n=== {passed}/{len(results)} passed ===")
        return 0 if passed == len(results) else 1


if __name__ == "__main__":
    import sys
    sys.exit(asyncio.run(main()))
