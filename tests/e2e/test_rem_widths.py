"""E2E: 글자를 담는 칸의 폭은 rem이라 글자 크기 설정을 따른다(ADR-055).

본문 칸(`--max-width`)은 40rem이고 화면보다 넓어지지 않는다. 옆 패널과 대화상자는 rem 폭에 화면 폭의 상한을 함께 둔다.
기본 글자 크기(18px)에서는 전의 px 폭과 1px 안에서 같다.
"""
from urllib.parse import quote

import pytest

from .conftest import BASE_URL, CLEAR_APP_STORAGE, IPHONE_UA

COACHMARK_SEEN = "try { localStorage.setItem('bible-cite-coachmark-seen','1'); } catch(_) {}"


def _font(size: int) -> str:
    return CLEAR_APP_STORAGE + COACHMARK_SEEN + f"try {{ localStorage.setItem('bible-font-size', '{size}'); }} catch(_) {{}}"


def _ctx(browser, viewport, font, phone=False):
    options = {"viewport": viewport}
    if phone:
        options.update(is_mobile=True, has_touch=True, user_agent=IPHONE_UA)
    ctx = browser.new_context(**options)
    ctx.add_init_script(_font(font))
    return ctx


def _width(page, sel: str) -> float:
    return page.evaluate(f"() => document.querySelector({sel!r}).getBoundingClientRect().width")


def _box(page, sel: str) -> dict:
    return page.evaluate(f"""() => {{
      const r = document.querySelector({sel!r}).getBoundingClientRect();
      return {{ left: r.left, right: r.right, width: r.width }};
    }}""")


# (id, 앱 화면의 크기, 휴대폰인가). 가로로 든 휴대폰은 작은 화면이지만 40rem 칸보다 넓다(ADR-050 §2).
SCREENS = [
    ("desktop", {"width": 1280, "height": 800}, False),
    ("phone-landscape", {"width": 874, "height": 402}, True),
    ("phone-portrait", {"width": 390, "height": 844}, True),
]


@pytest.mark.parametrize("viewport, phone", [s[1:] for s in SCREENS], ids=[s[0] for s in SCREENS])
@pytest.mark.parametrize("font", [16, 18, 24])
def test_reading_column_is_40rem_up_to_the_screen_width(browser, viewport, phone, font):
    """본문 칸은 40rem이고 화면보다 넓지 않다. 16px에서 640px, 18px에서 전과 같은 720px, 24px에서 960px이다.
    작은 화면에서는 헤더도 같은 값이라 본문 칸과 양 끝이 같다."""
    ctx = _ctx(browser, viewport, font, phone)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/gen/1")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        assert page.evaluate("() => document.documentElement.style.fontSize") == f"{font}px"
        app = _box(page, "#app")
        assert abs(app["width"] - min(40 * font, viewport["width"])) < 1, (font, app)
        if not page.evaluate("() => window.appHelpers.isLargeLayout()"):
            header = _box(page, "#app-header")
            assert abs(header["left"] - app["left"]) < 1 and abs(header["right"] - app["right"]) < 1, (header, app)
    finally:
        ctx.close()


def _open_bookmark_drawer(page):
    page.goto(f"{BASE_URL}/gen/1")
    page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    return "#bookmark-drawer"


def _open_cite_sheet(page):
    page.goto(f"{BASE_URL}/matt/16")
    page.wait_for_selector(".cite-chip", timeout=20_000)
    page.click(".cite-chip")
    page.wait_for_selector("#cite-sheet:not([hidden])", timeout=8_000)
    return "#cite-sheet"


def _open_book_filter(page):
    page.goto(f"{BASE_URL}/search?q={quote('사랑')}")
    funnel = page.locator(".token-funnel:visible").first
    funnel.wait_for(timeout=20_000)
    funnel.click()
    page.wait_for_selector("#book-filter-sheet:not([hidden])")
    return "#book-filter-sheet"


# (패널, 여는 함수, rem 폭, 전의 px 폭)
PANELS = [
    ("bookmark", _open_bookmark_drawer, 20, 360),
    ("cite", _open_cite_sheet, 24.4, 440),
    ("book-filter", _open_book_filter, 23.3, 420),
]


@pytest.mark.parametrize("opener, rem, old_px", [p[1:] for p in PANELS], ids=[p[0] for p in PANELS])
@pytest.mark.parametrize("font", [16, 18, 24])
def test_side_panel_width_follows_the_font_size(browser, opener, rem, old_px, font):
    """큰 화면의 옆 패널은 rem 폭이라 글자 크기를 따라 커지고 작아진다. 18px에서는 전의 px 폭과 1px 안에서 같다."""
    ctx = _ctx(browser, {"width": 1280, "height": 800}, font)
    try:
        page = ctx.new_page()
        sel = opener(page)
        page.wait_for_timeout(400)  # slide-in transition
        width = _width(page, sel)
        assert abs(width - rem * font) < 1, (font, width)
        if font == 18:
            assert abs(width - old_px) < 1, width
    finally:
        ctx.close()


# (id, 앱 화면의 크기, 글자 크기, 휴대폰인가). 휴대폰은 화면 폭의 92%가 정하고(320px에 24px), 큰 화면은 rem 폭이 정한다.
DIALOG_CASES = [
    ("phone-320-24px", {"width": 320, "height": 640}, 24, True),
    ("phone-390-18px", {"width": 390, "height": 844}, 18, True),
    ("desktop-16px", {"width": 1280, "height": 800}, 16, False),
    ("desktop-24px", {"width": 1280, "height": 800}, 24, False),
]


@pytest.mark.parametrize("viewport, font, phone", [c[1:] for c in DIALOG_CASES], ids=[c[0] for c in DIALOG_CASES])
def test_dialog_width_follows_the_font_size_inside_the_screen(browser, viewport, font, phone):
    """대화상자(북마크 저장)는 23.3rem과 화면 폭의 92% 가운데 좁은 쪽이다. 폭 320px에 글자 24px에서도 화면을 넘지 않는다."""
    ctx = _ctx(browser, viewport, font, phone)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/gen/1")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        page.locator(".title-bookmark-btn").click()
        if not phone:  # the large layout's button opens the drawer; its "save this chapter" opens the dialog
            page.wait_for_selector("#bookmark-drawer:not([hidden])")
            page.locator("#bm-save-chapter-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])", timeout=2_000)
        page.wait_for_timeout(300)
        box = _box(page, "#bm-save-modal")
        assert abs(box["width"] - min(0.92 * viewport["width"], 23.3 * font)) < 1, (font, box)
        assert box["left"] >= 0 and box["right"] <= viewport["width"], box
    finally:
        ctx.close()
