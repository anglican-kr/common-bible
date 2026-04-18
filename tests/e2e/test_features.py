"""E2E: core app features — resume banner, mobile search FAB/sheet."""

BASE = "http://localhost:8080"
_IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
)


def test_resume_banner_appears_after_last_read_set(browser):
    """Storing a last-read position in localStorage shows the resume banner on reload."""
    ctx = browser.new_context()
    page = ctx.new_page()

    page.goto(BASE)
    page.wait_for_selector("#app")

    page.evaluate("""() => {
        localStorage.setItem('bible-last-read', JSON.stringify({bookId: 'gen', chapter: 1}));
    }""")
    page.reload()

    page.wait_for_selector(".resume-banner")
    text = page.inner_text(".resume-banner-link")
    assert text.strip(), "resume banner link text must not be empty"

    ctx.close()


def test_mobile_search_fab_opens_bottom_sheet(browser):
    """On mobile, tapping the search FAB opens the search bottom sheet."""
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=_IPHONE_UA,
    )
    page = ctx.new_page()

    page.goto(BASE)
    page.wait_for_selector("#app")

    fab = page.locator("#search-fab")
    assert fab.is_visible(), "search FAB must be visible on mobile"

    fab.click()
    page.wait_for_selector("#search-sheet", state="visible")

    ctx.close()
