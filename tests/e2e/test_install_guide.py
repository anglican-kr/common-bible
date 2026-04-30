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


# ── 자동 넛지 (maybeShowInstallNudge) ────────────────────────────────────────

_NUDGE_KEY = "bible-install-nudge"


def _goto_and_wait(page, ua: str, nudge_state: dict | None = None) -> None:
    """주어진 UA·넛지 상태로 홈 화면을 로드하고 앱이 준비될 때까지 대기한다."""
    script = f"localStorage.setItem('{_NUDGE_KEY}', JSON.stringify({nudge_state!r}));" if nudge_state else f"localStorage.removeItem('{_NUDGE_KEY}');"
    page.add_init_script(script)
    page.goto(BASE)
    page.wait_for_selector(".settings-btn")


def test_nudge_shows_on_first_visit_ios_safari(browser):
    """iOS Safari 첫 방문 시 설치 안내 모달이 자동으로 노출돼야 한다."""
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _IOS_SAFARI_UA)

    page.wait_for_selector("#install-modal:not([hidden])", timeout=4000)
    assert "홈 화면에 추가" in page.inner_text("#install-modal-body")
    ctx.close()


def test_nudge_shows_on_first_visit_android(browser):
    """Android 첫 방문 시 설치 안내 모달이 자동으로 노출돼야 한다."""
    ctx = browser.new_context(user_agent=_ANDROID_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _ANDROID_UA)

    page.wait_for_selector("#install-modal:not([hidden])", timeout=4000)
    assert "홈 화면에 추가" in page.inner_text("#install-modal-body")
    ctx.close()


def test_nudge_not_shown_on_second_visit(browser):
    """첫 방문 후 모달을 닫으면 2번째 방문에서는 노출되지 않아야 한다."""
    # visits=1, nextShow=4 → 2번째 방문(visits=2)에서는 미노출
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _IOS_SAFARI_UA, {"visits": 1, "nextShow": 4})

    page.wait_for_timeout(2500)
    assert page.locator("#install-modal").get_attribute("hidden") is not None
    ctx.close()


def test_nudge_not_shown_on_third_visit(browser):
    """3번째 방문에서도 넛지가 다시 노출되지 않아야 한다."""
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _IOS_SAFARI_UA, {"visits": 2, "nextShow": 4})

    page.wait_for_timeout(2500)
    assert page.locator("#install-modal").get_attribute("hidden") is not None
    ctx.close()


def test_nudge_shows_again_after_three_visits(browser):
    """첫 노출 후 3회 이상 방문하면 넛지가 다시 표시돼야 한다."""
    # visits=3, nextShow=4 → 4번째 방문(visits=4 >= nextShow=4)에서 노출
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _IOS_SAFARI_UA, {"visits": 3, "nextShow": 4})

    page.wait_for_selector("#install-modal:not([hidden])", timeout=4000)
    ctx.close()


def test_nudge_not_shown_when_installed(browser):
    """standalone 모드(이미 설치됨)에서는 자동 넛지가 표시되지 않아야 한다."""
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
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
        localStorage.removeItem('bible-install-nudge');
    """)
    page.goto(BASE)
    page.wait_for_selector(".settings-btn")

    page.wait_for_timeout(2500)
    assert page.locator("#install-modal").get_attribute("hidden") is not None
    ctx.close()


def test_nudge_not_shown_for_desktop(browser):
    """데스크톱 환경에서는 자동 넛지가 표시되지 않아야 한다."""
    ctx = browser.new_context(user_agent=_DESKTOP_UA)
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-install-nudge');")
    page.goto(BASE)
    page.wait_for_selector(".settings-btn")

    page.wait_for_timeout(2500)
    assert page.locator("#install-modal").get_attribute("hidden") is not None
    ctx.close()


def test_nudge_updates_next_show_after_display(browser):
    """넛지 표시 후 localStorage의 nextShow가 visits+3으로 갱신돼야 한다."""
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _IOS_SAFARI_UA)

    page.wait_for_selector("#install-modal:not([hidden])", timeout=4000)

    state = page.evaluate(f"() => JSON.parse(localStorage.getItem('{_NUDGE_KEY}') || 'null')")
    assert state is not None
    assert state["nextShow"] == state["visits"] + 3
    ctx.close()


# ── "다시 열지 않음" 체크박스 ───────────────────────────────────────────────────


def test_never_show_checkbox_renders_in_ios_safari_modal(browser):
    """iOS Safari 모달에 '다시 열지 않음' 체크박스가 렌더링돼야 한다."""
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _IOS_SAFARI_UA)

    page.wait_for_selector("#install-modal:not([hidden])", timeout=4000)
    checkbox = page.locator("#install-never-show")
    assert checkbox.count() == 1
    assert not checkbox.is_checked()
    ctx.close()


def test_never_show_checkbox_renders_in_android_modal(browser):
    """Android 모달에 '다시 열지 않음' 체크박스가 렌더링돼야 한다."""
    ctx = browser.new_context(user_agent=_ANDROID_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _ANDROID_UA)

    page.wait_for_selector("#install-modal:not([hidden])", timeout=4000)
    assert page.locator("#install-never-show").count() == 1
    ctx.close()


def test_never_show_checked_sets_flag_on_close(browser):
    """체크박스 체크 후 닫기 버튼 클릭 시 localStorage에 neverShow=true가 저장돼야 한다."""
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _IOS_SAFARI_UA)

    page.wait_for_selector("#install-modal:not([hidden])", timeout=4000)
    page.locator("#install-never-show").check()
    page.locator("#install-modal-close").click()
    page.wait_for_selector("#install-modal", state="hidden")

    state = page.evaluate(f"() => JSON.parse(localStorage.getItem('{_NUDGE_KEY}') || 'null')")
    assert state is not None
    assert state["neverShow"] is True
    ctx.close()


def test_never_show_unchecked_does_not_set_flag(browser):
    """체크박스 미체크 상태에서 닫으면 neverShow 플래그가 설정되지 않아야 한다."""
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    _goto_and_wait(page, _IOS_SAFARI_UA)

    page.wait_for_selector("#install-modal:not([hidden])", timeout=4000)
    page.locator("#install-modal-close").click()
    page.wait_for_selector("#install-modal", state="hidden")

    state = page.evaluate(f"() => JSON.parse(localStorage.getItem('{_NUDGE_KEY}') || 'null')")
    assert state is None or not state.get("neverShow")
    ctx.close()


def test_never_show_flag_prevents_future_nudge(browser):
    """neverShow=true가 저장된 상태에서는 첫 방문이라도 넛지가 표시되지 않아야 한다."""
    ctx = browser.new_context(user_agent=_IOS_SAFARI_UA)
    page = ctx.new_page()
    page.add_init_script(
        f"localStorage.setItem('{_NUDGE_KEY}', JSON.stringify({{visits:1,nextShow:2,neverShow:true}}));"
    )
    page.goto(BASE)
    page.wait_for_selector(".settings-btn")

    page.wait_for_timeout(2500)
    assert page.locator("#install-modal").get_attribute("hidden") is not None
    ctx.close()


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
