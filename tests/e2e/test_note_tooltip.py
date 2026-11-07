"""E2E: 주석 툴팁의 자리 — 상단 바에 가리지 않는다(ADR-022 §6).

주석이 붙은 어절을 누르면 뜨는 툴팁(`#note-tooltip`)은 표지 위에 놓이고, 위에 자리가 모자라면 아래로 뒤집힌다
(`js/app/citations.js`의 `_positionNoteTooltip`). 화면 위쪽에는 상단 바(`#sticky-group`)가 고정돼 툴팁보다
앞에 그려지므로, 위의 자리는 화면 맨 위가 아니라 상단 바 아래쪽에서 끝난다. 열왕기상 5:6의 주석 「사천」을 쓴다.
"""
from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT

BASE = "http://localhost:8080"
ANCHOR = ".note-anchor:not(.note-anchor--variant)"

# 첫 인용 상호작용 시 뜨는 코치마크 배너가 누르기를 가리지 않도록 미리 본 것으로 표시.
_COACHMARK_SEEN = "try { localStorage.setItem('bible-cite-coachmark-seen','1'); } catch(_) {}"

# 표지를 상단 바 아래쪽에서 dy만큼 떨어진 곳에 둔다. 스크롤은 바로 옮긴다(`html`이 부드러운 스크롤이다).
_PLACE_ANCHOR = f"""(dy) => {{
  const a = document.querySelector('{ANCHOR}').getBoundingClientRect();
  const bar = document.getElementById('sticky-group').getBoundingClientRect().bottom;
  window.scrollTo({{ top: window.scrollY + a.top - bar - dy, behavior: 'instant' }});
}}"""

# 스크롤 이벤트와 툴팁의 나타나기 애니메이션(2px 이동), 상단 바의 접고 펴기가 끝날 때까지 기다린다.
_SETTLE = """async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const els = [document.getElementById('note-tooltip'), document.getElementById('breadcrumb-row')].filter(Boolean);
  await Promise.all(els.flatMap((el) => el.getAnimations()).map((a) => a.finished));
}"""

# 툴팁, 표지, 상단 바의 화면 위치. `visible`은 툴팁 윗줄 가운데를 눌렀을 때 툴팁이 받는지다(상단 바가 덮으면 거짓).
_MEASURE = f"""() => {{
  const tt = document.getElementById('note-tooltip');
  const t = tt.getBoundingClientRect();
  const a = document.querySelector('{ANCHOR}').getBoundingClientRect();
  const hit = document.elementFromPoint(t.left + t.width / 2, t.top + 2);
  return {{
    hidden: tt.hidden, placement: tt.dataset.placement, top: t.top, bottom: t.bottom,
    anchorTop: a.top, anchorBottom: a.bottom,
    bar: document.getElementById('sticky-group').getBoundingClientRect().bottom,
    visible: !!hit && tt.contains(hit),
  }};
}}"""


def _open_chapter(browser, viewport):
    ctx = browser.new_context(viewport=viewport)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_COACHMARK_SEEN)
    page = ctx.new_page()
    page.goto(f"{BASE}/1kgs/5")
    page.wait_for_selector(ANCHOR, timeout=10_000)
    return ctx, page


def _tap_anchor(page):
    page.locator(ANCHOR).first.click()
    page.wait_for_selector("#note-tooltip:not([hidden])", timeout=8_000)
    page.evaluate(_SETTLE)


def test_note_tooltip_below_header_flips_under_anchor(browser):
    """휴대폰 폭에서 상단 바 바로 아래의 표지를 누르면, 툴팁은 상단 바에 가리는 위가 아니라 표지 아래에 놓인다."""
    ctx, page = _open_chapter(browser, MOBILE_VIEWPORT)
    try:
        page.evaluate(_PLACE_ANCHOR, 30)
        page.evaluate(_SETTLE)
        _tap_anchor(page)
        m = page.evaluate(_MEASURE)
        assert m["placement"] == "below", m
        assert m["top"] >= m["bar"], m
        assert m["top"] >= m["anchorBottom"], m
        assert m["visible"], m
    finally:
        ctx.close()


def test_note_tooltip_follows_scroll_and_flips_before_header(browser):
    """툴팁을 연 채 스크롤해 표지가 상단 바 바로 아래로 올라오면, 툴팁은 상단 바 밑으로 들어가지 않고 표지 아래로 뒤집힌다."""
    ctx, page = _open_chapter(browser, MOBILE_VIEWPORT)
    try:
        page.evaluate(_PLACE_ANCHOR, 200)
        page.evaluate(_SETTLE)
        _tap_anchor(page)
        opened = page.evaluate(_MEASURE)
        assert opened["placement"] == "above" and opened["visible"], opened
        page.evaluate(_PLACE_ANCHOR, 30)
        page.evaluate(_SETTLE)
        m = page.evaluate(_MEASURE)
        assert m["placement"] == "below", m
        assert m["top"] >= m["bar"], m
        assert m["visible"], m
    finally:
        ctx.close()


def test_note_tooltip_follows_header_reexpanding_at_top(browser):
    """데스크톱 상단 바는 스크롤하면 접히고, 맨 위로 돌아오면 스크롤이 끝난 뒤 다시 펴지며 본문을 아래로 민다. 그때도
    툴팁과 표지의 간격은 8px로 남고, 펴진 상단 바에 툴팁이 가리지 않는다."""
    ctx, page = _open_chapter(browser, {"width": 1280, "height": 800})
    try:
        page.evaluate("() => window.scrollTo({ top: 200, behavior: 'instant' })")
        page.evaluate(_SETTLE)
        _tap_anchor(page)
        page.evaluate("() => window.scrollTo({ top: 0, behavior: 'instant' })")
        page.evaluate(_SETTLE)
        m = page.evaluate(_MEASURE)
        assert m["placement"] == "above", m
        assert abs(m["anchorTop"] - m["bottom"] - 8) < 1, m
        assert m["top"] >= m["bar"], m
        assert m["visible"], m
    finally:
        ctx.close()
