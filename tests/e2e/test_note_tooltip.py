"""E2E: 주석 툴팁의 자리 — 상단 바에 가리지 않는다(ADR-022 §6).

주석이 붙은 어절을 누르면 뜨는 툴팁(`#note-tooltip`)은 표지 위에 놓이고, 위에 자리가 모자라면 아래로 뒤집힌다
(`js/app/citations.js`의 `_positionNoteTooltip`). 화면 위쪽에는 상단 바(`#sticky-group`)가 고정돼 툴팁보다
앞에 그려지므로, 위의 자리는 화면 맨 위가 아니라 상단 바 아래쪽에서 끝난다. 열왕기상 5:6의 주석 「사천」을 쓴다.
"""
import pytest

from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT, emulate_status_bar

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

# 창의 스크롤과 창 크기 이벤트를 기록한다. 크기 감시만으로 자리를 다시 잡는지 보는 시험이, 그사이 이 이벤트가 없었는지 확인한다.
_RECORD_EVENTS = """() => {
  window.__tooltipEvents = [];
  const note = (e) => window.__tooltipEvents.push(e.type);
  window.addEventListener('scroll', note, true);
  window.addEventListener('resize', note);
}"""


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
    """데스크톱 상단 바는 스크롤하면 접히고, 맨 위에서 10px 안으로 돌아오면 0.25초 동안 다시 펴지며 본문을 아래로 민다
    (`views.js`의 `initCompactHeader`). 그때도 툴팁과 표지의 간격은 8px로 남고, 펴진 상단 바에 툴팁이 가리지 않는다."""
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


@pytest.mark.only_browser("chromium")
def test_note_tooltip_follows_status_bar_height_change(browser):
    """Chromium에서 툴팁을 연 채 상태 표시줄 높이만 바꾸면(창 크기와 스크롤은 그대로) 상단 바 묶음의 위 여백이 늘어 본문이
    내려간다. 툴팁은 상단 바의 크기 변화를 받아 표지를 따라가 간격 8px을 지키고 상단 바에 가리지 않는다. 아이폰에서 이 값이
    바뀔 때 창 크기 이벤트도 오는지는 확인하지 못했다(원장 `docs/changes/2026-11-07-note-tooltip-inset.md`)."""
    ctx, page = _open_chapter(browser, {"width": 1280, "height": 800})
    try:
        _tap_anchor(page)
        before = page.evaluate(_MEASURE)
        page.evaluate(_RECORD_EVENTS)
        emulate_status_bar(page, 62)
        page.evaluate(_SETTLE)
        # 스크롤이나 창 크기 이벤트가 오면 고치기 전 코드도 자리를 다시 잡아, 이 시험이 크기 감시를 시험하지 못한다
        assert page.evaluate("() => window.__tooltipEvents") == [], "시뮬레이션이 스크롤이나 창 크기 이벤트를 보냈다"
        m = page.evaluate(_MEASURE)
        assert m["anchorTop"] > before["anchorTop"] + 50, (before, m)   # 본문이 내려갔다
        gap = m["anchorTop"] - m["bottom"] if m["placement"] == "above" else m["top"] - m["anchorBottom"]
        assert abs(gap - 8) < 1, m
        assert m["top"] >= m["bar"], m
        assert m["visible"], m
    finally:
        ctx.close()


def test_note_tooltip_follows_its_own_height_change(browser):
    """툴팁을 연 뒤 툴팁 자신의 높이가 바뀌어도(웹 글꼴이 늦게 도착해 줄이 다시 나뉠 때) 표지 위의 툴팁이 자리를 다시 잡아,
    표지를 덮지 않고 간격 8px을 지킨다. 글꼴 대신 툴팁에 한 줄을 더해 높이를 바꾼다. 스크롤과 창 크기 이벤트는 없다."""
    ctx, page = _open_chapter(browser, {"width": 1280, "height": 800})
    try:
        _tap_anchor(page)
        before = page.evaluate(_MEASURE)
        assert before["placement"] == "above", before
        page.evaluate(_RECORD_EVENTS)
        page.evaluate("""() => {
          const line = document.createElement('p');
          line.textContent = '늦게 도착한 글꼴로 줄이 다시 나뉜 경우';
          document.getElementById('note-tooltip').appendChild(line);
        }""")
        page.evaluate(_SETTLE)
        assert page.evaluate("() => window.__tooltipEvents") == [], "스크롤이나 창 크기 이벤트가 있었다"
        m = page.evaluate(_MEASURE)
        assert m["bottom"] - m["top"] > before["bottom"] - before["top"] + 5, (before, m)   # 툴팁이 높아졌다
        assert m["placement"] == "above", m
        assert abs(m["anchorTop"] - m["bottom"] - 8) < 1, m   # 표지를 덮지 않는다
        assert m["top"] >= m["bar"], m
    finally:
        ctx.close()
