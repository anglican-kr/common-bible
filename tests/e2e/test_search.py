"""E2E: search pipeline tests.

Covers:
  - keyword search shows results
  - verse reference auto-navigates to chapter
  - worker init failure surfaces an error message
  - verse search URL on refresh auto-navigates (regression)
"""

from .conftest import wait_app_ready

SEARCH_URL = "http://localhost:8080/#/search?q=%EC%B0%BD%EC%84%B8%201%3A1"


def test_keyword_search_shows_results(page, base_url):
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑")
    page.press("#search-input", "Enter")

    page.wait_for_selector(".search-count, .search-empty", timeout=8000)
    assert page.locator(".search-result-item").count() > 0


def test_verse_reference_navigates_to_chapter(page, base_url):
    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "요한 3:16")
    page.press("#search-input", "Enter")

    page.wait_for_function("() => location.hash.startsWith('#/john/3')", timeout=5000)
    assert page.evaluate("location.hash").startswith("#/john/3")


def test_worker_error_surfaces_to_ui(page, base_url):
    """Worker meta-load failure must show an error in the UI, not hang."""
    page.route("**/data/search-meta.json", lambda route: route.fulfill(status=500, body="boom"))

    page.goto(base_url)
    wait_app_ready(page)

    page.fill("#search-input", "사랑")
    page.press("#search-input", "Enter")

    page.wait_for_selector(".error", timeout=8000)
    assert page.inner_text(".error").strip()

    page.unroute("**/data/search-meta.json")


def test_search_url_refresh_navigates_and_dismisses_launch_screen(page):
    """Navigating directly to a verse search URL must dismiss the launch screen."""
    page.goto(SEARCH_URL)

    page.wait_for_selector("#launch-screen", state="detached", timeout=5000)

    current_hash = page.evaluate("window.location.hash")
    assert current_hash.startswith("#/gen/1"), f"unexpected destination: {current_hash}"
