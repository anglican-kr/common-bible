"""E2E: audio player — visibility, chapter teardown, error handling.

Tests cover the _teardownAudio / AbortController refactor:
  - audio bar appears on chapter load
  - audio bar is hidden when leaving a chapter page
  - navigating chapter-to-chapter replaces the player without JS errors
  - rapid chapter changes don't cause errors (teardown resilience)
  - error state (404 audio) shows the 「준비 중」 notice

and the notice when the mp3 cannot load (ADR-016 D4, known-issues §26):
  - offline, a chapter with audio that this device has not saved: 「인터넷에 연결하면 들을 수 있습니다.」
  - offline, a chapter with no audio (Tobit 1): 「오디오 파일을 준비 중입니다.」
  - a Wi-Fi with no internet (navigator.onLine stays true): the offline notice
  - a check still waiting when the user moves on does not cover the next chapter's bar
"""

import json
from pathlib import Path

from playwright.sync_api import expect

from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"
DATA = Path(__file__).resolve().parents[2] / "data"

OFFLINE_NOTICE = "인터넷에 연결하면 들을 수 있습니다."
UNAVAILABLE_NOTICE = "오디오 파일을 준비 중입니다."


def _open_chapter(browser, path: str, *, audio_404: bool = True, init_script: str = ""):
    """Open a chapter page. Routes audio to 404 by default to avoid network dependency."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script("localStorage.clear();")
    if init_script:
        ctx.add_init_script(init_script)
    page = ctx.new_page()
    if audio_404:
        page.route("**/data/audio/**", lambda route: route.fulfill(status=404))
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(200)
    return ctx, page


def _is_visible(page, selector: str) -> bool:
    return page.get_attribute(selector, "hidden") is None


def test_audio_bar_visible_on_chapter_load(browser):
    """#audio-bar is shown whenever a chapter page loads."""
    ctx, page = _open_chapter(browser, "gen/1")
    assert _is_visible(page, "#audio-bar"), "#audio-bar must be visible after chapter load"
    ctx.close()


def test_audio_bar_hidden_after_navigating_to_home(browser):
    """#audio-bar is hidden when SPA-navigating away from a chapter to the home page."""
    ctx, page = _open_chapter(browser, "gen/1")
    assert _is_visible(page, "#audio-bar"), "precondition: audio bar visible on gen/1"

    page.evaluate("() => navigate('/')")
    page.wait_for_function(
        "() => document.getElementById('audio-bar')?.hidden === true"
    )

    assert not _is_visible(page, "#audio-bar"), "#audio-bar must be hidden on home page"
    ctx.close()


def test_audio_bar_replaced_on_chapter_nav_link(browser):
    """Clicking the chapter-nav 'next' link replaces the audio player without JS errors."""
    ctx, page = _open_chapter(browser, "gen/1")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    next_link = page.locator(".chapter-nav a").last
    assert next_link.count() == 1, "next chapter link must exist for gen/1"
    next_link.click()
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(300)

    assert _is_visible(page, "#audio-bar"), "#audio-bar must be visible after chapter change"
    assert not errors, f"JS errors after chapter change: {errors}"
    ctx.close()


def test_rapid_chapter_changes_no_errors(browser):
    """Rapidly switching chapters doesn't throw JS errors (teardown + init cycle)."""
    ctx, page = _open_chapter(browser, "gen/1")
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    for ch in range(2, 7):
        page.evaluate(f"() => navigate('/gen/{ch}')")
        page.wait_for_selector("article.chapter-text .verse")
        page.wait_for_timeout(80)

    page.wait_for_timeout(300)
    assert not errors, f"JS errors during rapid chapter changes: {errors}"
    ctx.close()


def test_audio_error_shows_unavailable_message(browser):
    """When the server answers 404 for the mp3, the 「준비 중」 notice replaces the player.

    The chapter has audio in the manifest and the device is online, so the check asks the server (HEAD): an answer,
    even 404, means the network works and the offline notice would be wrong. preload="metadata" requests the mp3
    as soon as the chapter opens.
    """
    ctx, page = _open_chapter(browser, "gen/1")

    expect(page.locator(".audio-unavailable")).to_have_text(UNAVAILABLE_NOTICE)
    ctx.close()


def test_error_state_then_chapter_change_no_errors(browser):
    """After unavailable state, navigating to another chapter shows a fresh player."""
    init = (
        "localStorage.setItem('bible-audio-pos', "
        "JSON.stringify({bookId:'gen', chapter:1, time:10}));"
    )
    ctx, page = _open_chapter(browser, "gen/1", init_script=init)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.wait_for_timeout(800)

    page.locator(".audio-unavailable").wait_for(state="visible")

    # Navigate to another chapter — teardown must work even from error state
    page.evaluate("() => navigate('/gen/2')")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(300)

    assert _is_visible(page, "#audio-bar"), "#audio-bar must be visible after recovery nav"
    assert not errors, f"JS errors after navigating from error state: {errors}"
    ctx.close()


# ── The notice when the mp3 cannot load (ADR-016 D4, known-issues §26) ──
#
# Offline, the service worker does two jobs these tests need: it answers chapter JSON from its data cache, and it keeps
# a copy of audio-manifest.json in its shell cache, which the check reads first. Chromium never finishes installing
# sw.js against the local dev server (2026-11-07: 3 of the 58 shell requests reach the server, then the install waits;
# dev and production answer over HTTP/2), so service workers stay blocked as in the other tests and the test does both
# jobs itself: chapter JSON from disk through page.route, and the manifest saved into Cache Storage while online.


def _serve_chapter_json(route):
    name = route.request.url.split("?", 1)[0].rsplit("/", 1)[-1]
    route.fulfill(path=str(DATA / "bible" / name), content_type="application/json")


def _open_home_with_saved_manifest(browser):
    """Open the home screen online, with the audio manifest in Cache Storage as the service worker leaves it."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    page.route("**/data/bible/**", _serve_chapter_json)
    page.goto(f"{BASE}/")
    page.wait_for_selector("#search-input", state="attached")
    # Any cache name works: the check looks the manifest up across all caches (caches.match), since the copy sw.js
    # keeps sits in a cache named after the app version.
    page.evaluate("async () => { const c = await caches.open('shell-e2e'); await c.add('/data/audio-manifest.json'); }")
    return ctx, page


def _go_to_chapter(page, path: str):
    page.evaluate(f"() => navigate('/{path}')")
    page.wait_for_function(f"() => location.pathname === '/{path}'")
    page.wait_for_selector("article.chapter-text .verse")


def test_offline_chapter_with_audio_says_connect(browser):
    """오프라인에서 오디오가 있는 장의 mp3가 이 기기에 없으면 「인터넷에 연결하면 들을 수 있습니다.」"""
    ctx, page = _open_home_with_saved_manifest(browser)
    ctx.set_offline(True)
    _go_to_chapter(page, "gen/1")

    expect(page.locator(".audio-unavailable")).to_have_text(OFFLINE_NOTICE)
    ctx.close()


def test_offline_chapter_without_audio_says_preparing(browser):
    """오프라인이어도 오디오가 없는 장(토비트 1장)은 「오디오 파일을 준비 중입니다.」"""
    ctx, page = _open_home_with_saved_manifest(browser)
    ctx.set_offline(True)
    _go_to_chapter(page, "tob/1")

    expect(page.locator(".audio-unavailable")).to_have_text(UNAVAILABLE_NOTICE)
    ctx.close()


def test_no_internet_wifi_says_connect(browser):
    """와이파이에 연결돼 있어 navigator.onLine이 참이어도, 서버가 응답하지 않으면 오프라인 안내를 보인다.

    No manifest copy in Cache Storage here, so the check also downloads the manifest (the path without a service worker).
    """
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    page.route("**/data/audio/**", lambda route: route.abort("internetdisconnected"))
    page.goto(f"{BASE}/gen/1")
    page.wait_for_selector("article.chapter-text .verse")

    assert page.evaluate("() => navigator.onLine") is True
    expect(page.locator(".audio-unavailable")).to_have_text(OFFLINE_NOTICE)
    ctx.close()


def test_late_notice_does_not_cover_next_chapter(browser):
    """앞 장의 확인을 기다리는 동안 다른 장으로 옮기면, 앞 장의 안내가 새 장의 오디오 바를 덮지 않는다.

    Genesis 1's check waits on the server probe (HEAD, held unanswered) when the user opens Tobit 1. Leaving cancels
    the probe, so Genesis 1's check ends right after the move; unless it sees its player's signal aborted, it puts the
    offline notice over Tobit 1's bar.
    """
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    held = []

    def audio(route):
        if route.request.method == "HEAD":
            held.append(route)  # no answer: Genesis 1's check waits here
        else:
            route.abort("internetdisconnected")

    page.route("**/data/audio/**", audio)
    page.goto(f"{BASE}/gen/1")
    page.wait_for_selector("article.chapter-text .verse")
    for _ in range(100):
        if held:
            break
        page.wait_for_timeout(50)
    assert held, "Genesis 1's check must be waiting on the server"

    page.evaluate("() => navigate('/tob/1')")
    page.wait_for_function("() => location.pathname === '/tob/1'")
    expect(page.locator(".audio-unavailable")).to_have_text(UNAVAILABLE_NOTICE)
    page.wait_for_timeout(500)
    expect(page.locator(".audio-unavailable")).to_have_text(UNAVAILABLE_NOTICE)
    assert page.locator(".audio-unavailable").count() == 1
    ctx.close()
