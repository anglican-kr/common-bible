"""E2E: install guide modal — per-platform content and entry point behavior."""

import pytest

BASE = "http://localhost:8080"

_IOS_SAFARI_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
)
_IOS_CHROME_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.0.0 Mobile/15E148 Safari/604.1"
)
_ANDROID_UA = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
)
_DESKTOP_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def _open_modal_body(browser, ua: str) -> str | None:
    """Launch a new context with the given UA, open the install modal, return body text."""
    ctx = browser.new_context(user_agent=ua)
    page = ctx.new_page()
    page.goto(BASE)
    page.wait_for_selector(".settings-btn")
    page.click(".settings-btn")
    page.wait_for_selector(".settings-popover:not([hidden])")
    btn = page.query_selector('button[aria-label="앱으로 설치 안내 열기"]')
    if btn is None:
        ctx.close()
        return None
    btn.click()
    page.wait_for_selector("#install-modal:not([hidden])")
    text = page.inner_text("#install-modal-body")
    ctx.close()
    return text


@pytest.mark.parametrize(
    "label,ua,must_contain,must_not_contain",
    [
        (
            "iOS Safari shows Add-to-Home-Screen guide",
            _IOS_SAFARI_UA,
            ["··· 버튼", "홈 화면에 추가"],
            [],
        ),
        (
            "iOS Chrome prompts to open in Safari",
            _IOS_CHROME_UA,
            ["Safari", "주소 복사"],
            ["··· 버튼"],
        ),
        (
            "Android shows install CTA",
            _ANDROID_UA,
            ["홈 화면에 추가"],
            [],
        ),
        (
            "Desktop Chromium shows install CTA",
            _DESKTOP_UA,
            ["앱 설치"],
            [],
        ),
    ],
)
def test_install_guide_content(browser, label, ua, must_contain, must_not_contain):
    text = _open_modal_body(browser, ua)
    assert text is not None, f"[{label}] install entry point missing"
    for s in must_contain:
        assert s in text, f"[{label}] expected {s!r} in modal body"
    for s in must_not_contain:
        assert s not in text, f"[{label}] unexpected {s!r} in modal body"


def test_standalone_mode_hides_install_entry(browser):
    """In standalone (already installed) mode the install button must not appear."""
    ctx = browser.new_context(user_agent=_DESKTOP_UA)
    page = ctx.new_page()
    page.add_init_script("""
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (q) => {
            if (q && q.includes('display-mode: standalone')) {
                return {
                    matches: true, media: q,
                    addEventListener() {}, removeEventListener() {},
                    addListener() {}, removeListener() {},
                    dispatchEvent() { return false; }
                };
            }
            return orig(q);
        };
    """)
    page.goto(BASE)
    page.wait_for_selector(".settings-btn")
    page.click(".settings-btn")
    page.wait_for_selector(".settings-popover:not([hidden])")
    btn = page.query_selector('button[aria-label="앱으로 설치 안내 열기"]')
    ctx.close()
    assert btn is None, "standalone mode must hide the install entry"
