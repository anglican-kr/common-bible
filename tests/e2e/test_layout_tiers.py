"""E2E: 작은 화면과 큰 화면 레이아웃은 앱 화면의 크기로 정한다(ADR-050 §2).

앱 화면의 폭이 700px 이상이고 높이가 600px 이상이면 큰 화면(상단 바, 옆 패널), 아니면 작은 화면(하단 탭 바, 시트)이다.
기기의 종류와 마우스를 쓰는지는 보지 않는다. 터치 화면은 Chromium의 터치 흉내(`has_touch`)로 만든다. 실제 iPad가 아니다.
"""
import pytest

from .conftest import BASE_URL, IPHONE_UA

# iPadOS Safari reports itself as a Mac (ADR-008); the layout does not look at it.
IPAD_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
           "(KHTML, like Gecko) Version/18.0 Safari/605.1.15")

# (id, 앱 화면의 크기, 터치 화면인가, 큰 화면인가). 크기는 ADR-050 §1의 기기 표와 같다.
CASES = [
    ("phone-portrait", {"width": 390, "height": 844}, True, False),
    ("phone-landscape", {"width": 874, "height": 402}, True, False),
    ("ipad-mini-portrait", {"width": 744, "height": 1133}, True, True),
    ("ipad-portrait", {"width": 820, "height": 1180}, True, True),
    ("ipad-landscape", {"width": 1180, "height": 820}, True, True),
    ("desktop-699-wide", {"width": 699, "height": 800}, False, False),
    ("desktop-700-wide", {"width": 700, "height": 800}, False, True),
    ("desktop-599-high", {"width": 1280, "height": 599}, False, False),
    ("desktop-600-high", {"width": 1280, "height": 600}, False, True),
]

STATE = """() => {
  const shown = (sel) => {
    const el = document.querySelector(sel);
    return !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  };
  return {
    large: window.appHelpers.isLargeLayout(),
    small: window.appHelpers.isSmallLayout(),
    tabDock: shown('#tab-dock'),
    headerNav: shown('#header-nav'),
  };
}"""


@pytest.mark.parametrize("viewport, touch, large", [c[1:] for c in CASES], ids=[c[0] for c in CASES])
def test_layout_follows_the_app_area_size(browser, viewport, touch, large):
    """기기마다 한 레이아웃만 보인다. JS의 판정(helpers.js)과 CSS가 보이는 것이 같고, 탭 바와 상단 바가 함께 보이는 화면이 없다."""
    options = {"viewport": viewport}
    if touch:
        options.update(is_mobile=True, has_touch=True, user_agent=IPAD_UA if large else IPHONE_UA)
    ctx = browser.new_context(**options)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/gen/1")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        state = page.evaluate(STATE)
    finally:
        ctx.close()
    assert state["large"] is large and state["small"] is (not large), state
    assert state["tabDock"] is (not large), state
    assert state["headerNav"] is large, state


def test_layout_switches_when_the_window_crosses_the_boundary(browser):
    """창 크기가 경계를 넘으면 레이아웃이 바로 바뀐다. 폭과 높이 어느 쪽으로 넘어도 같다."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    try:
        page = ctx.new_page()
        page.goto(f"{BASE_URL}/gen/1")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        for size, large in (({"width": 699, "height": 800}, False), ({"width": 700, "height": 800}, True),
                            ({"width": 1280, "height": 599}, False), ({"width": 1280, "height": 600}, True)):
            page.set_viewport_size(size)
            page.wait_for_function(f"() => window.appHelpers.isLargeLayout() === {'true' if large else 'false'}")
            state = page.evaluate(STATE)
            assert state["tabDock"] is (not large) and state["headerNav"] is large, (size, state)
    finally:
        ctx.close()
