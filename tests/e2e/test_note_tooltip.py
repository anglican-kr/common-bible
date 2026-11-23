"""E2E: 주석 툴팁의 자리 — 상단 바에 가리지 않는다(ADR-022 §6). 설정을 끄면 어절 주석은 툴팁을 열지 않는다.

주석이 붙은 어절을 누르면 뜨는 툴팁(`#note-tooltip`)은 표지 위에 놓이고, 위에 자리가 모자라면 아래로 뒤집힌다
(`js/app/citations.js`의 `_positionNoteTooltip`). 화면 위쪽에는 상단 바(`#sticky-group`)가 고정돼 툴팁보다
앞에 그려지므로, 위의 자리는 화면 맨 위가 아니라 상단 바 아래쪽에서 끝난다. 열왕기상 5:6의 주석 「사천」을 쓴다.

설정 「인용·주석 표시」를 끄면 어절 주석은 보통 글자다. 단추 역할, 키보드 정지점, 이름이 없고 눌러도 툴팁이 열리지
않는다(`citations.js`의 `setNoteAnchorsActive`, 구현하며 정함 2026-11-08). 창세 28:19의 주석 「베델」을 쓴다.

화면이 바뀌면 툴팁이 닫히고, 표지를 따라가던 스크롤과 창 크기 감시, 크기 감시도 함께 풀린다(`routing.js`의 `route()`가
`citations.js`의 `hideNoteTooltip`을 부른다, known-issues §50).
"""
import pytest

from .conftest import CITE_SHOW_OFF, CLEAR_APP_STORAGE, MOBILE_VIEWPORT, NOTE_TOOLTIP_OPEN, emulate_status_bar

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

# 스크롤 이벤트와 툴팁의 나타나기 애니메이션(2px 이동)이 끝날 때까지 기다린다.
_SETTLE = """async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const els = [document.getElementById('note-tooltip')].filter(Boolean);
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


def test_note_tooltip_follows_the_anchor_back_to_the_top(browser):
    """데스크톱 — 스크롤한 자리에서 툴팁을 열고 맨 위로 돌아와도 툴팁과 표지의 간격은 8px로 남고, 상단 바에 툴팁이 가리지 않는다.
    상단 바가 접혔다 펴지던 때(2026-11-14 전)에는 펴지며 본문을 아래로 미는 동안에도 따라가는지 보던 시험이다."""
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


# 어절 주석의 단추 속성. 설정을 끄면 셋 다 없다.
_CONTROL_ATTRS = "e => [e.getAttribute('role'), e.getAttribute('tabindex'), e.getAttribute('aria-label')]"


def test_note_anchor_is_plain_text_while_setting_off(browser):
    """설정을 끈 채 창세 28장을 열면 「베델」은 단추 역할, 키보드 정지점, 이름이 없는 보통 글자이고 눌러도 툴팁이 열리지
    않는다. 동기화처럼 `window.applyCiteShow(true)`로 켜면 같은 노드가 다시 단추가 되어 툴팁이 열리고, 툴팁이 열린 채
    끄면 툴팁이 닫히고 다시 보통 글자가 된다. 화면은 다시 그리지 않는다."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_COACHMARK_SEEN)
    ctx.add_init_script(CITE_SHOW_OFF)
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/gen/28")
        page.wait_for_selector(ANCHOR, timeout=10_000)
        word = page.locator(ANCHOR)
        assert word.count() == 1
        assert word.inner_text() == "베델"
        assert word.evaluate(_CONTROL_ATTRS) == [None, None, None]
        assert word.evaluate("e => e.tabIndex") < 0
        page.evaluate("() => { window.__word = document.querySelector('.note-anchor:not(.note-anchor--variant)'); }")
        word.click()
        page.wait_for_timeout(200)
        assert page.evaluate(NOTE_TOOLTIP_OPEN) is False

        page.evaluate("() => window.applyCiteShow(true)")
        assert word.evaluate(_CONTROL_ATTRS) == ["button", "0", "베델 주석 보기"]
        word.click()
        page.wait_for_function(NOTE_TOOLTIP_OPEN)

        page.evaluate("() => window.applyCiteShow(false)")
        assert page.evaluate(NOTE_TOOLTIP_OPEN) is False
        assert word.evaluate(_CONTROL_ATTRS) == [None, None, None]
        assert page.evaluate("() => window.__word.isConnected && document.querySelector('.note-anchor:not(.note-anchor--variant)') === window.__word")
    finally:
        ctx.close()


# 지금 포커스가 놓인 요소 — 절이면 그 절의 줄 번호(`data-vref`)와 임시 `tabindex`, 아니면 태그 이름
_FOCUS = """() => {
  const a = document.activeElement;
  return a && a.classList.contains('verse')
    ? { verse: a.getAttribute('data-vref'), tabindex: a.getAttribute('tabindex') }
    : { tag: a ? a.tagName : null };
}"""


@pytest.mark.parametrize("path, aid, verse", [
    ("gen/28", ANCHOR, "19"),                 # 어절 주석 「베델」 — 끄면 키보드 정지점이 사라진다
    ("mark/13", ".cite-chip[data-cite-src='다니 7:13-14']", "26"),   # 26절 뒤의 칩 — 끄면 CSS가 감춘다
])
def test_turning_setting_off_keeps_keyboard_place(browser, path, aid, verse):
    """키보드 포커스가 어절 주석이나 칩에 있을 때 다른 기기에서 「끔」이 동기화되어 오면(`window.applyCiteShow(false)`), 포커스는
    본문(body)으로 떨어지지 않고 그 절로 간다. 절은 스크립트로만 포커스를 받고(`tabindex="-1"`), 포커스가 떠나면 그 속성도
    없어진다(코드 리뷰 2026-11-09, 구현하며 정함)."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_COACHMARK_SEEN)
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/{path}")
        page.wait_for_selector(aid, timeout=10_000)
        page.locator(aid).first.focus()
        assert page.evaluate("(sel) => document.activeElement === document.querySelector(sel)", aid)
        page.evaluate("() => window.applyCiteShow(false)")
        got = page.evaluate(_FOCUS)
        assert got.get("verse", "").startswith(verse) and got["tabindex"] == "-1", got
        page.keyboard.press("Tab")
        assert page.evaluate("(v) => [...document.querySelectorAll('.verse[tabindex]')].length", verse) == 0
    finally:
        ctx.close()


# 툴팁이 열릴 때 만든 감시를 기록한다. 기록하는 동안(`window.__ttRecording`) 창에 단 스크롤과 창 크기 처리기, 새로 만든
# 크기 감시(`ResizeObserver`)를 적고, 처리기를 떼거나 감시를 끊으면 표시한다. 페이지를 열기 전에 넣는다.
_RECORD_FOLLOWERS = """(() => {
  const made = { listeners: [], observers: [] };
  window.__ttMade = made;
  window.__ttRecording = false;
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  const capture = (o) => (typeof o === 'boolean' ? o : !!(o && o.capture));
  window.addEventListener = (type, fn, opts) => {
    if (window.__ttRecording && (type === 'scroll' || type === 'resize')) {
      made.listeners.push({ type, fn, capture: capture(opts), live: true });
    }
    return add(type, fn, opts);
  };
  window.removeEventListener = (type, fn, opts) => {
    for (const l of made.listeners) if (l.type === type && l.fn === fn && l.capture === capture(opts)) l.live = false;
    return remove(type, fn, opts);
  };
  const Observer = window.ResizeObserver;
  window.ResizeObserver = class extends Observer {
    constructor(cb) {
      super(cb);
      this.__made = window.__ttRecording ? { live: false } : null;
      if (this.__made) made.observers.push(this.__made);
    }
    observe(t, o) { if (this.__made) this.__made.live = true; return super.observe(t, o); }
    disconnect() { if (this.__made) this.__made.live = false; return super.disconnect(); }
  };
})();"""

# 툴팁이 열려 있는지와, 툴팁이 열 때 만든 감시 가운데 아직 살아 있는 것의 수
_FOLLOWERS = """() => {
  const tt = document.getElementById('note-tooltip');
  return {
    open: !!tt && !tt.hidden,
    listeners: window.__ttMade.listeners.filter((l) => l.live).length,
    observers: window.__ttMade.observers.filter((o) => o.live).length,
  };
}"""

LECTIONARY = "/lectionary/2027-01-10"   # 주님의 세례 — 제1독서 창세 1:2의 주석 「기운」
LECTIONARY_WORD = f".lect-reading[data-slot='first'] {ANCHOR}"


def _open_recording(browser, viewport, path, anchor=ANCHOR):
    ctx = browser.new_context(viewport=viewport)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_COACHMARK_SEEN)
    ctx.add_init_script(_RECORD_FOLLOWERS)
    page = ctx.new_page()
    page.goto(f"{BASE}{path}")
    page.wait_for_selector(anchor, timeout=20_000)
    return ctx, page


def _navigate(page, path, anchor=".verse"):
    """앱 안의 이동(`window.navigate`)으로 간다. 방문 기록이 쌓여 뒤로 가기와 앞으로 가기를 시험할 수 있다."""
    page.evaluate("(p) => window.navigate(p)", path)
    page.wait_for_function("(p) => location.pathname === p", arg=path)
    page.wait_for_selector(anchor, timeout=20_000)


def _open_recorded_tooltip(page, anchor=ANCHOR):
    """툴팁을 열고, 열면서 만든 감시가 기록되었는지 확인한다. 기록이 없으면 닫힌 뒤의 0이 아무것도 보여 주지 않는다."""
    page.evaluate("() => { window.__ttRecording = true; }")
    page.locator(anchor).first.click()
    page.wait_for_function(NOTE_TOOLTIP_OPEN)
    page.evaluate("() => { window.__ttRecording = false; }")
    opened = page.evaluate(_FOLLOWERS)
    assert opened["listeners"] >= 1 and opened["observers"] >= 1, opened


def _wait_route_end(page, title_before):
    """화면을 다 그렸는지는 문서 제목으로 본다. `route()`가 끝에 새 화면의 제목을 넣는다."""
    page.wait_for_function("(t) => document.title !== t", arg=title_before, timeout=20_000)
    page.evaluate(_SETTLE)


def test_note_tooltip_closes_on_back(browser):
    """휴대폰 폭에서 열왕기상 4장에서 5장으로 간 뒤 「사천」의 툴팁을 연 채 뒤로 가면, 툴팁이 닫히고 표지를 따라가던 감시가
    모두 풀린다. 그전에는 4장 화면에 툴팁이 열린 채 상단 바 밑에 숨고, 감시는 다음 누름이나 Esc까지 남았다."""
    ctx, page = _open_recording(browser, MOBILE_VIEWPORT, "/1kgs/4", ".verse")
    try:
        _navigate(page, "/1kgs/5", ANCHOR)
        _open_recorded_tooltip(page)
        title = page.title()
        page.go_back()
        _wait_route_end(page, title)
        assert page.evaluate("() => location.pathname") == "/1kgs/4"
        assert page.evaluate(_FOLLOWERS) == {"open": False, "listeners": 0, "observers": 0}
    finally:
        ctx.close()


def test_note_tooltip_closes_on_forward(browser):
    """데스크톱에서 열왕기상 5장에서 6장으로 갔다가 뒤로 돌아와 툴팁을 연 채 앞으로 가도 툴팁이 닫히고 감시가 풀린다."""
    ctx, page = _open_recording(browser, {"width": 1280, "height": 800}, "/1kgs/5")
    try:
        _navigate(page, "/1kgs/6")
        title = page.title()
        page.go_back()
        _wait_route_end(page, title)
        page.wait_for_selector(ANCHOR)
        _open_recorded_tooltip(page)
        title = page.title()
        page.go_forward()
        _wait_route_end(page, title)
        assert page.evaluate("() => location.pathname") == "/1kgs/6"
        assert page.evaluate(_FOLLOWERS) == {"open": False, "listeners": 0, "observers": 0}
    finally:
        ctx.close()


def test_note_tooltip_closes_on_redraw_of_the_same_address(browser):
    """데스크톱 전례독서(2027-01-10)에서 「기운」의 툴팁을 연 채 같은 주소를 다시 그리면(동기화로 받은 설정이 화면을 바꿀 때
    `redrawIfSyncedSettingsChanged`가 부르는 `route()`) 툴팁이 닫히고 감시가 풀린다. 다시 그린 화면에는 옛 표지가 없다."""
    ctx, page = _open_recording(browser, {"width": 1280, "height": 800}, LECTIONARY, LECTIONARY_WORD)
    try:
        _open_recorded_tooltip(page, LECTIONARY_WORD)
        page.evaluate("(sel) => { window.__oldWord = document.querySelector(sel); }", LECTIONARY_WORD)
        page.evaluate("() => window.route()")
        page.evaluate(_SETTLE)
        assert page.evaluate("() => !window.__oldWord.isConnected")   # 다시 그렸다
        assert page.evaluate(_FOLLOWERS) == {"open": False, "listeners": 0, "observers": 0}
    finally:
        ctx.close()


def test_note_tooltip_closes_on_tab_bar_icon_and_tab_keeps_focus(browser):
    """휴대폰 폭에서 툴팁을 연 채 탭 바의 캘린더 아이콘을 누르면 툴팁이 닫히고 감시가 풀린다. 누른 곳이 아이콘(SVG)이라
    툴팁 바깥을 누르면 닫는 처리가 받지 않아, 그전에는 캘린더 화면에 툴팁이 남았다. 화면을 옮기며 닫을 때는 포커스를 옛 화면의
    표지로 돌리지 않으므로, 누른 탭이 포커스를 지닌다."""
    ctx, page = _open_recording(browser, MOBILE_VIEWPORT, "/1kgs/5")
    try:
        _open_recorded_tooltip(page)
        title = page.title()
        tab = page.locator('#tab-bar [data-tab="calendar"]')
        box = tab.bounding_box()
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        assert page.evaluate("([x, y]) => document.elementFromPoint(x, y) instanceof SVGElement", [x, y])
        page.mouse.click(x, y)
        _wait_route_end(page, title)
        assert page.evaluate("() => location.pathname") == "/calendar"
        assert page.evaluate(_FOLLOWERS) == {"open": False, "listeners": 0, "observers": 0}
        assert page.evaluate("() => document.activeElement === document.querySelector('#tab-bar [data-tab=\"calendar\"]')")
    finally:
        ctx.close()
