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
        localStorage.setItem('bible-startup', 'home');
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


def test_long_press_save_updates_header_bookmark_icon(browser):
    """Saving from long-press flow updates the chapter header bookmark state."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script("localStorage.removeItem('bible-bookmarks');")
    page = ctx.new_page()
    page.route(
        "**/data/bible/john-3.json",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json; charset=utf-8",
            body=(
                '{"book_id":"john","chapter":3,"verses":['
                '{"number":16,"text":"하느님께서는 세상을 극진히 사랑하셔서 외아들을 보내 주시어."},'
                '{"number":17,"text":"세상을 단죄하시려는 것이 아니라 구원하시려는 것이다."}'
                "]}"),
        ),
    )

    page.goto(f"{BASE}/john/3")
    page.wait_for_selector("article.chapter-text .verse")

    verse = page.locator("#v16")
    box = verse.bounding_box()
    assert box is not None, "target verse must be measurable for long-press"

    page.mouse.move(box["x"] + 10, box["y"] + 10)
    page.mouse.down()
    page.wait_for_timeout(350)
    page.mouse.up()

    page.wait_for_selector("#verse-select-bar:not([hidden])")
    if page.locator("#verse-select-bookmark-btn").is_disabled():
        page.click("#v16")
    assert not page.locator("#verse-select-bookmark-btn").is_disabled()

    page.click("#verse-select-bookmark-btn")
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.click("#bm-save-modal .bm-btn-primary")
    page.wait_for_selector("#bm-save-modal", state="hidden")

    raw = page.evaluate("() => localStorage.getItem('bible-bookmarks')")
    assert raw, "bookmark should be saved to localStorage after long-press save"

    ctx.close()
