"""E2E: 가로로 든 iPhone의 좌우 안전 영역에 화면 아래의 막대, 알림, 북마크 시트가 놓이지 않는다(known-issues §60).

하단 탭 바, 오디오 바, 가로의 이어 읽기 알약은 양 끝을 본문 글자가 시작하고 끝나는 선에 맞춘다(`--dock-left`, `--dock-right`,
ADR-030 §1). 본문 칸이 안전 영역 밖에 있으므로 막대도 그 밖에 있다. 알림 묶음과 북마크 시트는 가운데에 있어, 넓은 쪽 안전
영역의 두 배를 뺀 폭 안에 있다. 가로의 오디오 바가 좁아 컨트롤이 다 들어가지 않으면 시간 표시를 숨긴다(ADR-030 §5 「가로
모드」). 안전 영역은 Chromium의 개발자 프로토콜로 흉내 낸다(`conftest.emulate_side_safe_areas`). 실제 iPhone이 아니다.
"""
import pytest

from .conftest import BASE_URL, CLEAR_APP_STORAGE, IPHONE_UA, emulate_side_safe_areas

LANDSCAPE_IPHONE = {"width": 874, "height": 402}  # iPhone 17의 앱 화면
EDGE = 16  # --space-4

# An empty mp3 body fires 'error', which tears the audio bar down; drop that listener so the bar stays
# (the same mock as test_audio_controls.py).
_KEEP_AUDIO_BAR = """
(() => {
  const add = HTMLAudioElement.prototype.addEventListener;
  HTMLAudioElement.prototype.addEventListener = function (type, listener, opts) {
    if (type === 'error') return;
    return add.call(this, type, listener, opts);
  };
})();
"""

LONG_NOTICE = ("연결은 해제했지만 Drive의 동기화 파일은 삭제하지 못했습니다. 다시 연결한 뒤 「파일도 삭제」를 눌러 주세요. "
               "연결은 해제했지만 Drive의 동기화 파일은 삭제하지 못했습니다.")


def _ctx(browser, viewport, font=18, storage=""):
    ctx = browser.new_context(viewport=viewport, is_mobile=True, has_touch=True, user_agent=IPHONE_UA)
    # One script: Playwright does not order separate init scripts, and this one must run after the wipe.
    ctx.add_init_script(CLEAR_APP_STORAGE + f"try {{ localStorage.setItem('bible-font-size', '{font}'); {storage} }} catch(_) {{}}")
    return ctx


def _with_audio(ctx):
    ctx.add_init_script(_KEEP_AUDIO_BAR)
    page = ctx.new_page()
    page.route("**/data/audio/**", lambda r: r.fulfill(status=200, body=b"", content_type="audio/mpeg"))
    return page


def _box(page, sel: str) -> dict:
    return page.evaluate(f"""() => {{
      const e = document.querySelector({sel!r});
      const r = e.getBoundingClientRect();
      return {{ left: r.left, right: r.right, width: r.width, display: getComputedStyle(e).display }};
    }}""")


def _text_edges(page) -> tuple:
    """본문 칸(`#app`)에서 안쪽 여백을 뺀 자리, 곧 본문 글자가 시작하고 끝나는 선."""
    return tuple(page.evaluate("""() => {
      const app = document.querySelector('#app'), cs = getComputedStyle(app), r = app.getBoundingClientRect();
      return [r.left + parseFloat(cs.paddingLeft), r.right - parseFloat(cs.paddingRight)];
    }"""))


def _column_text_left(width, font, inset) -> float:
    """본문 글자가 시작하는 자리. 본문 칸은 40rem이고, 화면 폭에서 넓은 쪽 안전 영역의 두 배를 뺀 폭보다 넓지 않으며(ADR-055 §4),
    가운데에 있고 안쪽 여백이 16px이다."""
    return (width - min(40 * font, width - 2 * inset)) / 2 + EDGE


RESUME = "localStorage.setItem('bible-last-read', JSON.stringify({bookId: 'gen', chapter: 1})); localStorage.setItem('bible-startup', 'home');"

# (id, 주소, 미리 넣을 저장값, 오디오를 띄우는가, 탭 바와 검색 원형 사이의 막대, 기다릴 요소)
DOCK_VIEWS = [
    ("chapter", "/ps/23", "", False, None, "article.chapter-text .verse"),
    ("audio", "/gen/1", "", True, "#audio-bar", "#audio-bar:not([hidden]) .audio-progress"),
    ("resume-pill", "/", RESUME, False, ".resume-banner", ".resume-banner"),
]


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("font", [16, 18, 24])
@pytest.mark.parametrize("left, right", [(62, 62), (62, 0)], ids=["both-sides", "one-side"])
@pytest.mark.parametrize("path, storage, audio, middle, ready", [v[1:] for v in DOCK_VIEWS], ids=[v[0] for v in DOCK_VIEWS])
def test_dock_row_lines_up_with_the_body_text(browser, path, storage, audio, middle, ready, left, right, font):
    """첫 탭은 본문 글자가 시작하는 선에서 시작하고, 검색 원형은 본문 글자가 끝나는 선에서 끝난다(ADR-030 §1). 그 사이의 오디오
    바와 이어 읽기 알약도 둘 사이에 있다. 본문 칸이 좌우 안전 영역 밖에 있으므로 막대도 그 밖에 있고, 본문 칸처럼 한쪽에만 안전
    영역이 있어도 양쪽이 같다. 가로로 든 iPhone 17에서 16px은 133px, 18px은 93px, 24px은 78px이다. 그전에는 글자 크기와 상관없이
    그쪽 안전 영역 안쪽 16px(78px)이라 16px에서 본문보다 55px, 18px에서 15px 바깥에 있었다. 그보다 전에는 첫 탭이 17px이었다."""
    ctx = _ctx(browser, LANDSCAPE_IPHONE, font=font, storage=storage)
    try:
        page = _with_audio(ctx) if audio else ctx.new_page()
        emulate_side_safe_areas(page, left, right)
        page.goto(f"{BASE_URL}{path}")
        page.wait_for_selector(ready, timeout=20_000)
        page.wait_for_timeout(300)
        assert page.evaluate("() => document.documentElement.style.fontSize") == f"{font}px"
        width = LANDSCAPE_IPHONE["width"]
        start = _column_text_left(width, font, max(left, right))
        text_left, text_right = _text_edges(page)
        tab, search = _box(page, "#tab-bar"), _box(page, "#tab-search")
        assert abs(text_left - start) < 1 and abs(text_right - (width - start)) < 1, (text_left, text_right, start)
        assert abs(tab["left"] - start) < 1, (tab, start)
        assert abs(search["right"] - (width - start)) < 1, (search, start)
        assert tab["left"] >= left + EDGE - 0.5 and search["right"] <= width - right - EDGE + 0.5, (tab, search)
        if middle:
            box = _box(page, middle)
            assert tab["right"] < box["left"] and box["right"] < search["left"], (tab, box, search)
    finally:
        ctx.close()


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("viewport, font, start", [
    ({"width": 390, "height": 844}, 18, 16),    # 세로로 든 휴대폰은 본문 칸이 화면 폭이라 전처럼 화면 끝에서 16px이다
    ({"width": 1280, "height": 500}, 18, 296),  # 높이가 600px보다 낮은 넓은 창도 탭 바를 쓴다. 화면 끝이 아니라 본문 칸 아래다
], ids=["portrait-phone", "short-wide-window"])
def test_dock_row_without_side_safe_areas(browser, viewport, font, start):
    """좌우 안전 영역이 없어도 첫 탭과 검색 원형은 본문 글자의 양 끝에 있다. 세로로 든 휴대폰에서는 그 선이 화면 끝에서 16px이다."""
    ctx = _ctx(browser, viewport, font)
    try:
        page = ctx.new_page()
        emulate_side_safe_areas(page, 0, 0, bottom=34)
        page.goto(f"{BASE_URL}/ps/23")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        assert abs(_text_edges(page)[0] - start) < 1
        assert abs(_box(page, "#tab-bar")["left"] - start) < 1
        assert abs(_box(page, "#tab-search")["right"] - (viewport["width"] - start)) < 1
    finally:
        ctx.close()


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("font", [18, 24])
def test_long_notice_stays_inside_the_side_safe_areas(browser, font):
    """긴 알림은 화면 폭에서 2rem과 좌우 안전 영역(넓은 쪽의 두 배)을 뺀 폭까지 넓어지고, 가운데에 있어 안전 영역에 들어가지 않는다.
    그전에는 화면 끝에서 18px(글자 18px)까지 넓어졌다."""
    ctx = _ctx(browser, LANDSCAPE_IPHONE, font)
    try:
        page = ctx.new_page()
        emulate_side_safe_areas(page, 62, 62)
        page.goto(f"{BASE_URL}/ps/23")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        page.evaluate("(msg) => window._showSyncSnackbar(msg)", LONG_NOTICE)
        page.wait_for_selector("#notice-stack > .snackbar")
        box = _box(page, "#notice-stack > .snackbar")
        # The text is long enough to reach the cap; otherwise a short notice would pass whatever the cap is.
        assert abs(box["width"] - (LANDSCAPE_IPHONE["width"] - 2 * font - 2 * 62)) < 1, box
        assert box["left"] >= 62 and box["right"] <= LANDSCAPE_IPHONE["width"] - 62, box
    finally:
        ctx.close()


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("viewport, inset, font, width", [
    (LANDSCAPE_IPHONE, 62, 24, 750),        # 40rem(960px)이 화면에서 안전 영역을 뺀 750px로 줄어든다
    (LANDSCAPE_IPHONE, 62, 18, 720),        # 40rem(720px)이 가운데에 있다
    ({"width": 390, "height": 844}, 0, 18, 390),  # 세로로 든 휴대폰에서는 전처럼 화면 전체 폭이다
], ids=["landscape-24px", "landscape-18px", "portrait"])
def test_phone_bookmark_sheet_is_the_reading_column_width(browser, viewport, inset, font, width):
    """작은 화면의 북마크 시트는 인용 시트처럼 본문 칸(`--max-width`)의 폭으로 가운데에 있어, 머리 줄의 제목이 좌우 안전 영역에
    들어가지 않는다. 그전에는 화면 전체 폭이라 제목이 왼쪽 16px에서 시작했다."""
    ctx = _ctx(browser, viewport, font)
    try:
        page = ctx.new_page()
        emulate_side_safe_areas(page, inset, inset)
        page.goto(f"{BASE_URL}/gen/1")
        page.wait_for_selector("article.chapter-text .verse", timeout=20_000)
        # A small screen opens the sheet only where there is no chapter to save (the header button saves the chapter).
        page.evaluate("() => window.openBookmarkDrawer(null, null)")
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        page.wait_for_timeout(400)
        sheet, title = _box(page, "#bookmark-drawer"), _box(page, "#bookmark-drawer-title")
        assert abs(sheet["width"] - width) < 1, sheet
        assert abs(sheet["left"] - (viewport["width"] - width) / 2) < 1, sheet
        assert title["left"] >= inset + EDGE - 0.5, title
    finally:
        ctx.close()


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("viewport, inset, font, time_shown", [
    ({"width": 812, "height": 375}, 50, 24, False),  # 안전 영역 때문에 좁아져 속도 단추가 검색 원형에 겹치던 경우
    ({"width": 667, "height": 375}, 0, 18, False),   # 탭 넷이라 전부터 속도 단추가 검색 원형에 겹치던 경우
    ({"width": 690, "height": 375}, 0, 18, True),    # 진행 막대가 바닥 가까이 준다. 바닥이 6rem이다(브라우저의 기본 폭 129px이면 넘친다)
    (LANDSCAPE_IPHONE, 62, 22, True),                # iPhone 17은 22px까지 시간도 보인다
    (LANDSCAPE_IPHONE, 62, 16, False),               # 16px에서는 본문 칸이 640px이라 막대가 292px로 좁아진다
], ids=["812px-50-24px", "667px-18px", "690px-18px", "874px-62-22px", "874px-62-16px"])
def test_landscape_dock_audio_keeps_every_control(browser, viewport, inset, font, time_shown):
    """가로의 오디오 바는 늘 독 줄에 있어, 컨트롤이 다 들어가지 않으면 시간 표시를 숨기고 재생, 진행 막대, 속도를 모두 남긴다.
    컨트롤은 막대를 넘지 않고, 속도 단추는 검색 원형과 겹치지 않는다. 막대의 폭은 본문 글자의 폭에서 탭 바와 검색 원형을 뺀 나머지다
    (ADR-030 §1)."""
    ctx = _ctx(browser, viewport, font)
    try:
        page = _with_audio(ctx)
        emulate_side_safe_areas(page, inset, inset)
        page.goto(f"{BASE_URL}/gen/1")
        page.wait_for_selector("#audio-bar:not([hidden]) .audio-progress", timeout=20_000)
        assert page.evaluate("() => document.documentElement.style.fontSize") == f"{font}px"
        # The longest time a chapter shows (two-digit minutes) is wider than the readout's 5.5em minimum.
        page.evaluate("() => { document.querySelector('#audio-bar .audio-time').textContent = '23:45 / 25:10'; }")
        page.wait_for_timeout(300)
        fits = page.evaluate("""() => [...document.querySelectorAll('#audio-bar .audio-player, #audio-bar .audio-time')]
          .every((e) => e.scrollWidth <= e.clientWidth + 1)""")
        bar, speed, search = _box(page, "#audio-bar"), _box(page, "#audio-bar .audio-speed-btn"), _box(page, "#tab-search")
        assert fits, (bar, speed)
        assert speed["display"] != "none" and speed["right"] <= bar["right"] and bar["right"] < search["left"], (bar, speed, search)
        assert (_box(page, "#audio-bar .audio-time")["display"] != "none") == time_shown
        assert _box(page, "#audio-bar .audio-progress")["width"] >= 6 * font - 0.5
    finally:
        ctx.close()
