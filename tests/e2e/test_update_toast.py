"""E2E: SW 업데이트 토스트 — v1.3.0 신규 기능.

navigator.serviceWorker.register를 mock으로 교체해 waiting SW가 있는
registration을 즉시 반환한다. 앱이 reg.waiting을 감지하면 showUpdateToast()를
호출해 #sw-update-toast가 삽입된다.
"""

import json

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


# ── GET_VERSION roundtrip ─────────────────────────────────────────────────────
# waiting SW가 GET_VERSION에 MessageChannel 포트로 응답하면 토스트는 active SW의
# version.json이 아니라 응답된 새 버전을 표시해야 한다.

_SW_WAITING_STUB_RESPONDING = """
window.__swMessages = [];
navigator.serviceWorker.register = async function() {
    const fakeSW = {
        postMessage: function(msg, transfer) {
            window.__swMessages.push({ type: msg && msg.type });
            if (msg && msg.type === 'GET_VERSION' && transfer && transfer[0]) {
                transfer[0].postMessage({ version: window.__stubVersion });
                return;
            }
            if (msg && msg.type === 'SKIP_WAITING') {
                window.__swSkipMsg = msg;
            }
        }
    };
    return {
        waiting: fakeSW,
        installing: null,
        active: null,
        addEventListener: function() {},
    };
};
"""


def _make_page_with_responding_sw(browser, version):
    """GET_VERSION에 `version`으로 응답하는 waiting SW stub을 주입한다."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(f"window.__stubVersion = {json.dumps(version)};")
    ctx.add_init_script(_SW_WAITING_STUB_RESPONDING)
    page = ctx.new_page()
    page.goto(BASE)
    return ctx, page


def test_update_toast_shows_waiting_sw_version(browser):
    """토스트 버전 라벨은 active SW의 version.json이 아니라 waiting SW가 응답한 값이다."""
    ctx, page = _make_page_with_responding_sw(browser, "9.9.9-test")
    try:
        page.wait_for_selector("#sw-update-release-link", timeout=5_000)
        text = page.text_content("#sw-update-release-link")
        assert text == "9.9.9-test", (
            f"Expected toast to display waiting SW version '9.9.9-test', got {text!r}"
        )
    finally:
        ctx.close()


def test_get_version_message_sent_to_waiting_sw(browser):
    """앱은 waiting SW에 GET_VERSION 메시지를 전송해 버전을 조회한다."""
    ctx, page = _make_page_with_responding_sw(browser, "9.9.9-test")
    try:
        page.wait_for_selector("#sw-update-toast", timeout=5_000)
        page.wait_for_function(
            "() => (window.__swMessages || []).some(m => m.type === 'GET_VERSION')",
            timeout=2_000,
        )
    finally:
        ctx.close()


def test_update_toast_falls_back_when_sw_does_not_respond(browser):
    """waiting SW가 GET_VERSION에 응답하지 않으면 1.5s 타임아웃 후 '최신 버전' 폴백."""
    no_reply_stub = """
    navigator.serviceWorker.register = async function() {
        const fakeSW = {
            postMessage: function() { /* no reply */ }
        };
        return {
            waiting: fakeSW,
            installing: null,
            active: null,
            addEventListener: function() {},
        };
    };
    """
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(no_reply_stub)
    page = ctx.new_page()
    page.goto(BASE)
    try:
        # fetchWaitingVersion 1.5s 타임아웃 → 토스트 삽입까지 대기
        page.wait_for_selector("#sw-update-release-link", timeout=5_000)
        text = page.text_content("#sw-update-release-link")
        assert text == "최신 버전", (
            f"Expected fallback label '최신 버전' on no-response, got {text!r}"
        )
    finally:
        ctx.close()
