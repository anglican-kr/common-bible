"""Verify install guide modal renders per-platform content and entry point behaves."""

import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:8080"

IOS_SAFARI_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
)
IOS_CHROME_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.0.0 Mobile/15E148 Safari/604.1"
)
ANDROID_UA = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
)
DESKTOP_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


async def open_modal(page):
    await page.goto(BASE)
    await page.wait_for_selector(".settings-btn")
    await page.click(".settings-btn")
    await page.wait_for_selector(".settings-popover:not([hidden])")
    install_btn = await page.query_selector('button[aria-label="앱으로 설치 안내 열기"]')
    if install_btn is None:
        return None
    await install_btn.click()
    await page.wait_for_selector("#install-modal:not([hidden])")
    return await page.inner_text("#install-modal-body")


async def case(p, label, ua, expected_substrings=(), unexpected_substrings=()):
    browser = await p.chromium.launch()
    ctx = await browser.new_context(user_agent=ua)
    page = await ctx.new_page()
    text = await open_modal(page)
    await browser.close()
    if text is None:
        print(f"[FAIL] {label}: install entry point missing")
        return False
    ok = all(s in text for s in expected_substrings) and all(
        s not in text for s in unexpected_substrings
    )
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {label}")
    if not ok:
        print(f"       body={text!r}")
        print(f"       expected all of={expected_substrings}")
        if unexpected_substrings:
            print(f"       expected none of={unexpected_substrings}")
    return ok


async def case_standalone(p):
    browser = await p.chromium.launch()
    ctx = await browser.new_context(user_agent=DESKTOP_UA)
    page = await ctx.new_page()
    await page.add_init_script(
        """
        const origMatch = window.matchMedia.bind(window);
        window.matchMedia = (q) => {
          if (q && q.includes('display-mode: standalone')) {
            return { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } };
          }
          return origMatch(q);
        };
        """
    )
    await page.goto(BASE)
    await page.wait_for_selector(".settings-btn")
    await page.click(".settings-btn")
    await page.wait_for_selector(".settings-popover:not([hidden])")
    install_btn = await page.query_selector('button[aria-label="앱으로 설치 안내 열기"]')
    ok = install_btn is None
    await browser.close()
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] standalone mode hides install entry")
    return ok


async def main():
    async with async_playwright() as p:
        results = []
        results.append(await case(
            p, "iOS Safari shows Add-to-Home-Screen guide", IOS_SAFARI_UA,
            expected_substrings=["공유 버튼", "홈 화면에 추가"],
        ))
        results.append(await case(
            p, "iOS Chrome prompts to open in Safari", IOS_CHROME_UA,
            expected_substrings=["Safari", "주소 복사"],
            unexpected_substrings=["홈 화면에 추가"],
        ))
        results.append(await case(
            p, "Android shows install CTA", ANDROID_UA,
            expected_substrings=["홈 화면에 추가"],
        ))
        results.append(await case(
            p, "Desktop Chromium shows install CTA", DESKTOP_UA,
            expected_substrings=["앱 설치"],
        ))
        results.append(await case_standalone(p))

        passed = sum(1 for r in results if r)
        print(f"\n=== {passed}/{len(results)} passed ===")
        return 0 if passed == len(results) else 1


if __name__ == "__main__":
    import sys
    sys.exit(asyncio.run(main()))
