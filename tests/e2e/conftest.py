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
    'bible-bookmarks-v2', 'bible-sync-meta',
  ];
  for (const k of keys) try { localStorage.removeItem(k); } catch(_) {}
  // Suppress the install-promo nudge so the #install-scrim overlay never covers
  // the tab bar / intercepts clicks during tests. The default ({visits:0,
  // nextShow:2}) already skips the first visit, but a test that boots the app
  // more than once would still trip it — so persist a neverShow state (the real
  // "다시 보지 않기" path) to make maybeShowInstallNudge return early regardless.
  try { localStorage.setItem('bible-install-nudge', JSON.stringify({ visits: 0, nextShow: 9999, neverShow: true })); } catch(_) {}
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
    """Block until the SPA shell has rendered at least one child element.

    Wait for ``#search-input`` *attached* (in DOM), not *visible*: on mobile the
    header ``#breadcrumb-row`` (which contains the search bar) is ``display:none``
    by design — search lives in the bottom tab dock instead — so the default
    ``visible`` state never resolves and every mobile test would time out.
    """
    page.wait_for_selector("#search-input", state="attached")
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
