
import asyncio
import time
from playwright.async_api import async_playwright

async def verify():
    async with async_playwright() as p:
        # 가상의 느린 네트워크 환경(3G 수준)과 메인 스레드 부하 시뮬레이션
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()

        print("--- Detailed Performance Check ---")
        
        # Performance entries 기록용
        performance_data = []
        
        # 페이지 로딩 및 시점 측정
        start_time = time.time()
        
        await page.goto("http://localhost:8080")
        
        # 1. LCP (SVG 로고 노출 시점)
        lcp_time = await page.evaluate("""() => {
            return new Promise(resolve => {
                new PerformanceObserver((entryList) => {
                    const entries = entryList.getEntries();
                    resolve(entries[entries.length - 1].startTime);
                }).observe({type: 'largest-contentful-paint', buffered: true});
            });
        }""")
        
        # 2. fade-out 클래스 감지
        await page.wait_for_function("document.getElementById('launch-screen').classList.contains('fade-out')")
        fade_out_time = await page.evaluate("performance.now()")
        
        # 3. 렌더링 완료 시점
        await page.wait_for_selector(".book-list")
        render_done_time = await page.evaluate("performance.now()")

        print(f"\n[Timeline]")
        print(f"- Logo Painted (LCP): {lcp_time:.2f}ms")
        print(f"- Fade-out Started  : {fade_out_time:.2f}ms")
        print(f"- Rendering Done    : {render_done_time:.2f}ms")
        print(f"==> Gap (Pause)     : {fade_out_time - lcp_time:.2f}ms")

        # 4. Long Tasks 확인 (애니메이션을 방해하는 50ms 이상의 작업)
        long_tasks = await page.evaluate("""() => {
            return performance.getEntriesByType('longtask').map(t => ({
                name: t.name,
                duration: t.duration,
                startTime: t.startTime
            }));
        }""")
        
        if long_tasks:
            print("\n[Long Tasks Detected during loading]")
            for task in long_tasks:
                print(f"- Duration: {task['duration']:.2f}ms (Started at {task['startTime']:.2f}ms)")
        else:
            print("\n- No long tasks detected.")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
