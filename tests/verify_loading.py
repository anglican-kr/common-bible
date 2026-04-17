
import asyncio
from playwright.async_api import async_playwright

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        requests = []
        page.on("request", lambda request: requests.append((request.url, request.resource_type)))
        
        print("--- Navigating to http://localhost:8080 ---")
        await page.goto("http://localhost:8080")
        
        # Wait for app to be ready
        await page.wait_for_selector("#app")
        
        print("\n[Network Requests Order]")
        for url, res_type in requests:
            if "books.json" in url or "app.js" in url:
                print(f"- {res_type}: {url.split('/')[-1]}")
        
        # Check window.booksPromise
        books_promise_exists = await page.evaluate("() => typeof window.booksPromise !== 'undefined'")
        print(f"\n- window.booksPromise exists: {books_promise_exists}")
        
        if books_promise_exists:
            is_promise = await page.evaluate("() => window.booksPromise instanceof Promise")
            print(f"- window.booksPromise is an instance of Promise: {is_promise}")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
