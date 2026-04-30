"""E2E: audio player — visibility, chapter teardown, error handling.

Tests cover the _teardownAudio / AbortController refactor:
  - audio bar appears on chapter load
  - audio bar is hidden when leaving a chapter page
  - navigating chapter-to-chapter replaces the player without JS errors
  - rapid chapter changes don't cause errors (teardown resilience)
  - error state (404 audio + eager load) shows unavailable message
"""

import json

BASE = "http://localhost:8080"


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
    """When audio 404s during eager load, the unavailable message replaces the player.

    Eager load is triggered by pre-seeding bible-audio-pos in localStorage,
    which makes showAudioPlayer() set audio.src immediately (not lazily on play click).
    """
    init = (
        "localStorage.setItem('bible-audio-pos', "
        "JSON.stringify({bookId:'gen', chapter:1, time:10}));"
    )
    ctx, page = _open_chapter(browser, "gen/1", init_script=init)
    page.wait_for_timeout(800)  # allow time for audio error event to fire

    unavailable = page.locator(".audio-unavailable")
    assert unavailable.is_visible(), (
        ".audio-unavailable must appear when audio file returns 404"
    )
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
