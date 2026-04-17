
import asyncio
from playwright.async_api import async_playwright

async def verify():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        print("--- Detailed Timeline Capture ---")
        
        # 브라우저 내부에서 타임라인 기록 시작
        await page.add_init_script("""
            window.timeline = {
                fcp: 0,
                ls_appear: 0,
                fade_start: 0,
                ls_removed: 0,
                long_tasks: []
            };
            
            // FCP 측정
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.name === 'first-contentful-paint') {
                        window.timeline.fcp = entry.startTime;
                    }
                }
            }).observe({type: 'paint', buffered: true});

            // Long Tasks 측정
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    window.timeline.long_tasks.push({
                        start: entry.startTime,
                        duration: entry.duration
                    });
                }
            }).observe({type: 'longtask', buffered: true});

            // Launch Screen 클래스 변화 감지
            const observer = new MutationObserver((mutations) => {
                const ls = document.getElementById('launch-screen');
                if (ls) {
                    if (ls.classList.contains('fade-out') && !window.timeline.fade_start) {
                        window.timeline.fade_start = performance.now();
                    }
                } else if (!window.timeline.ls_removed) {
                    window.timeline.ls_removed = performance.now();
                }
            });
            observer.observe(document.documentElement, {childList: true, subtree: true, attributes: true});
        """)

        await page.goto("http://localhost:8080")
        await page.wait_for_selector(".book-list", timeout=5000)
        
        # 결과 추출
        timeline = await page.evaluate("window.timeline")
        
        print(f"\n[Timeline Results]")
        print(f"- First Contentful Paint: {timeline['fcp']:.2f}ms")
        print(f"- Fade-out Animation Started: {timeline['fade_start']:.2f}ms")
        print(f"- Launch Screen Removed: {timeline['ls_removed']:.2f}ms")
        
        gap = timeline['fade_start'] - timeline['fcp']
        print(f"==> Gap (SVG visible to Fade start): {gap:.2f}ms")

        if timeline['long_tasks']:
            print("\n[Long Tasks during this gap]")
            for task in timeline['long_tasks']:
                # 애니메이션 시작 전후의 롱태스크만 필터링
                if task['start'] < timeline['fade_start'] + 500:
                    print(f"- {task['duration']:.2f}ms (Started at {task['start']:.2f}ms)")
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify())
