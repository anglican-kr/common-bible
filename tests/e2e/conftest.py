"""Shared fixtures and helpers for e2e tests.

Prerequisites: a dev server must be running at BASE_URL.
    python3 scripts/serve.py 8080
"""

import pytest

BASE_URL = "http://localhost:8080"

IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
)
MOBILE_VIEWPORT = {"width": 390, "height": 844}

# Init script that wipes every app-owned localStorage key the SPA writes.
# Inject via `context.add_init_script(CLEAR_APP_STORAGE)` so each new page
# starts from a clean slate.
CLEAR_APP_STORAGE = """
(() => {
  const keys = [
    'bible-bookmarks', 'bible-last-read', 'bible-audio-pos',
    'bible-font-size', 'bible-theme', 'bible-color-scheme',
    'bible-book-order', 'bible-startup',
    'bible-install-nudge', 'bible-install-nudge-state',
    'bible-drive-sync', 'bible-drive-sync-email', 'bible-drive-sync-updated',
  ];
  for (const k of keys) try { localStorage.removeItem(k); } catch(_) {}
})();
"""


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL


@pytest.fixture
def desktop_context(browser):
    """Default-viewport context with app storage cleared."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    yield ctx
    ctx.close()


@pytest.fixture
def mobile_context(browser):
    """Mobile (iPhone 12) viewport + UA, app storage cleared."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    yield ctx
    ctx.close()


def wait_app_ready(page) -> None:
    """Block until the SPA shell has rendered at least one child element."""
    page.wait_for_selector("#search-input")
    page.wait_for_function(
        "() => !!document.getElementById('app') && "
        "document.getElementById('app').children.length > 0"
    )


def open_settings(page):
    """Click the settings trigger and return the popover locator (visible)."""
    page.locator("#settings-anchor .settings-btn").click()
    popover = page.locator(".settings-popover")
    popover.wait_for(state="visible")
    return popover


def close_popovers(page) -> None:
    """Dismiss any open popovers/modals by pressing Escape."""
    page.keyboard.press("Escape")
