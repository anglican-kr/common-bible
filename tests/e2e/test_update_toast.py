"""E2E: SW 업데이트 토스트 — v1.3.0 신규 기능.

navigator.serviceWorker.register를 mock으로 교체해 waiting SW가 있는
registration을 즉시 반환한다. 앱이 reg.waiting을 감지하면 showUpdateToast()를
호출해 #sw-update-toast가 삽입된다.
"""

BASE = "http://localhost:8080"

# navigator.serviceWorker.register를 완전히 교체: waiting SW가 있는 reg를 즉시 반환.
# app.js 로드 전에 init_script로 주입되어야 하므로 context.add_init_script에 사용한다.
_SW_WAITING_STUB = """
navigator.serviceWorker.register = async function() {
    const fakeSW = {
        postMessage: function(msg) { window.__swSkipMsg = msg; }
    };
    return {
        waiting: fakeSW,
        installing: null,
        active: null,
        addEventListener: function() {},
    };
};
"""


def _make_page_with_waiting_sw(browser):
    """waiting SW stub이 주입된 페이지를 반환한다."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(_SW_WAITING_STUB)
    page = ctx.new_page()
    page.goto(BASE)
    return ctx, page


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_update_toast_appears_when_waiting_sw(browser):
    """waiting SW가 감지되면 #sw-update-toast가 페이지에 삽입된다."""
    ctx, page = _make_page_with_waiting_sw(browser)
    try:
        page.wait_for_selector("#sw-update-toast", timeout=5_000)
    finally:
        ctx.close()


def test_update_release_link_points_to_github(browser):
    """토스트 안의 릴리스 링크가 GitHub releases 페이지를 가리킨다."""
    ctx, page = _make_page_with_waiting_sw(browser)
    try:
        page.wait_for_selector("#sw-update-release-link", timeout=5_000)
        href = page.get_attribute("#sw-update-release-link", "href")
        assert href and "github.com" in href and "releases" in href, \
            f"Unexpected release link href: {href!r}"
    finally:
        ctx.close()


def test_update_btn_sends_skip_waiting(browser):
    """업데이트 버튼 클릭 시 waiting SW에 SKIP_WAITING 메시지가 전송된다."""
    ctx, page = _make_page_with_waiting_sw(browser)
    try:
        page.wait_for_selector("#sw-update-btn", timeout=5_000)
        page.click("#sw-update-btn")
        page.wait_for_timeout(300)
        msg = page.evaluate("() => window.__swSkipMsg")
        assert msg is not None, "No postMessage sent to waiting SW"
        assert msg.get("type") == "SKIP_WAITING", f"Unexpected message type: {msg}"
    finally:
        ctx.close()
