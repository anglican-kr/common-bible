"""E2E: 전례독서의 인용 칩, 주석, 병행 본문 ※. 설정 「인용·주석 표시」를 따른다(ADR-038 §3).

장 화면처럼 설정과 상관없이 늘 그리고, 설정(`body.cites-shown`)이 보이고 감춘다. 켜져 있으면(기본값) 장 화면과 같은
표시가 보인다. 꺼져 있으면 칩과 ※는 화면 구조(DOM)에 있되 보이지 않고, 어절 주석은 보통 글자다(단추 역할, 키보드
정지점, 이름이 없고 눌러도 툴팁이 열리지 않는다). 설정을 켜고 끌 때 다시 그리지 않는다(settings-ui.js applyCiteShow,
구현하며 정함 2026-11-08). 날짜마다 실데이터의 어느 표시가 있는지는 다음과 같다(2026-11-08 확인).

  2026-11-29 대림1주 나해: 복음 마르 13:26에 칩 「(다니 7:13-14)」
  2026-12-20 대림4주 나해: 제1독서 사무하 7:1에 어절 없는 주석(※)
  2026-07-19 연중16주 가해: 제1독서 창세 28:10-19상. 19절 주석 「베델」과 반절 자르기가 한 절에서 만난다
  2027-07-04 연중14주 나해: 제1독서 사무하 5:1-5, 9-10의 병행 본문 ※
  2027-01-10 주님의 세례: 제1독서 창세 1:1-5의 1절 ※와 2절 주석 「기운」, 복음 마르 1:11 뒤에 칩

실데이터(data/ 서브모듈)가 필요하다. 로컬 전용이다(CLAUDE.md 「테스트」).
"""
import pytest

from .conftest import RECORD_ANNOUNCEMENTS, open_settings

BASE = "http://localhost:8080"

CITE_OFF = "try { localStorage.setItem('bible-cite-show', '0'); } catch (_) {}"
WORD = ".note-anchor:not(.note-anchor--variant)"

# 날짜마다 시험할 슬롯과 그 슬롯의 표시. 세는 범위를 그 슬롯으로 좁혀, 같은 날 다른 독서에 표시가 더해져도 깨지지 않는다.
OFF_CASES = {
    "2026-11-29": ("gospel", ".cite-chip"),
    "2026-12-20": ("first", ".note-anchor--variant"),
    "2026-07-19": ("first", WORD),
    "2027-07-04": ("first", ".parallel-anchor"),
}

# 2027-01-10 주님의 세례 — 어절 주석, 변형 ※, 칩이 한 화면에 있다. 설정을 켜고 끄는 시험이 쓴다.
BAPTISM = "lectionary/2027-01-10"
B_WORD = f".lect-reading[data-slot='first'] {WORD}"
B_VARIANT = ".lect-reading[data-slot='first'] .note-anchor--variant"
B_CHIP = ".lect-reading[data-slot='gospel'] .cite-chip"

# 지금 화면의 세 표시를 window.__drawn에 잡아 둔다. 설정을 바꾼 뒤 같은 노드가 문서에 남아 있으면 다시 그리지 않은 것이다.
_KEEP_DRAWN = f"""() => {{
  window.__drawn = [{B_WORD!r}, {B_VARIANT!r}, {B_CHIP!r}].map((sel) => document.querySelector(sel));
  return window.__drawn.every(Boolean);
}}"""
_SAME_DRAWN = f"""() => [{B_WORD!r}, {B_VARIANT!r}, {B_CHIP!r}]
  .every((sel, i) => window.__drawn[i].isConnected && document.querySelector(sel) === window.__drawn[i])"""

# 어절 주석의 단추 속성과, 칩과 변형 ※가 보이는지(계산된 display가 none이 아닌지)
_STATE = f"""() => {{
  const w = document.querySelector({B_WORD!r});
  const shown = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none';
  return {{
    role: w.getAttribute('role'), tabindex: w.getAttribute('tabindex'), label: w.getAttribute('aria-label'),
    chip: shown({B_CHIP!r}), variant: shown({B_VARIANT!r}),
  }};
}}"""
ON_STATE = {"role": "button", "tabindex": "0", "label": "기운 주석 보기", "chip": True, "variant": True}
OFF_STATE = {"role": None, "tabindex": None, "label": None, "chip": False, "variant": False}

_TOOLTIP_OPEN = "() => { const t = document.getElementById('note-tooltip'); return !!t && !t.hidden; }"

_COPY_SLOT = """
(slot) => {
  const articles = document.querySelectorAll(`.lect-reading[data-slot='${slot}'] article.chapter-text`);
  const verses = [...articles].flatMap((a) => [...a.querySelectorAll('.verse')]);
  const r = document.createRange();
  r.setStartBefore(verses[0]);
  r.setEndAfter(verses[verses.length - 1]);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const dt = new DataTransfer();
  articles[0].dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
  return dt.getData('text/plain');
}
"""


def _open(page, path):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(".lect-reading .verse", timeout=20_000)
    page.wait_for_timeout(100)


def _press(page, loc):
    """높이 0인 ※ 상자를 실제 마우스로 누른다. Playwright의 `click()`은 이런 상자를 화면 안으로 스크롤하지 못한다."""
    loc.evaluate("e => window.scrollBy({ top: e.getBoundingClientRect().top - window.innerHeight / 2, behavior: 'instant' })")
    box = loc.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"])


def test_cite_chip_shows_in_lectionary_and_opens_sheet(desktop_context):
    """기본값(켬)에서 복음 마르 13:26 뒤에 인용 칩이 보이고, 누르면 인용 시트가 열린다. 시트는 장 화면과 같은 코드다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-11-29")
    chip = page.locator(".lect-reading[data-slot='gospel'] .cite-chip")
    assert chip.count() == 1
    chip.wait_for(state="visible")
    assert chip.inner_text() == "(다니 7:13-14)"
    chip.click()
    page.wait_for_selector("#cite-sheet:not([hidden])", timeout=8_000)
    page.keyboard.press("Escape")
    page.wait_for_function("() => document.getElementById('cite-sheet').hidden")
    # 칩은 인용한 26절의 줄 바로 뒤에 있다(한 절이 인용으로 나뉘면 줄 번호가 「26a」처럼 붙는다)
    assert page.evaluate("""() => {
      const chip = document.querySelector(".lect-reading[data-slot='gospel'] .cite-chip");
      return /^26/.test(chip.previousElementSibling.getAttribute('data-vref'));
    }""")


def test_note_anchor_survives_half_verse_cut_and_opens_tooltip(desktop_context):
    """창세 28:10-19상: 19절을 「그 곳을 베델이라 불렀다.」까지 자르고도 어절 「베델」의 주석 자리가 남아, 누르면 툴팁이 열린다.
    주석은 반절 자르기 앞에 감싼다(lectionary.js buildReading)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-07-19")
    first = ".lect-reading[data-slot='first'] article.chapter-text"
    anchor = page.locator(f"{first} .note-anchor")
    assert anchor.count() == 1
    assert anchor.inner_text() == "베델"
    assert anchor.get_attribute("role") == "button"
    assert "루즈" not in page.inner_text(first)
    assert "그 곳을 베델이라 불렀다." in page.inner_text(first)
    anchor.click()
    tip = page.locator("#note-tooltip")
    tip.wait_for(state="visible")
    assert "하느님의 집" in tip.inner_text()


def test_anchorless_note_marker_and_parallel_marker(desktop_context):
    """어절 없는 주석은 절 끝의 ※(변형 표시)로, 병행 본문은 단락 첫 절 앞의 ※로 보이고 둘 다 누르면 툴팁이 열린다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-20")
    mark = page.locator(".lect-reading[data-slot='first'] .note-anchor--variant")
    assert mark.count() == 1
    # ※ 상자는 높이가 0이라(장 화면도 같다) Playwright의 「보임」 판정과 클릭 준비 검사를 통과하지 못한다.
    # 그래서 계산된 display로 보고 마우스로 누른다.
    assert mark.evaluate("e => getComputedStyle(e).display") != "none"
    _press(page, mark)
    page.locator("#note-tooltip").wait_for(state="visible")

    _open(page, "lectionary/2027-07-04")
    par = page.locator(".lect-reading[data-slot='first'] .parallel-anchor")
    assert par.count() == 1
    assert par.evaluate("e => getComputedStyle(e).display") != "none"
    _press(page, par)
    tip = page.locator("#note-tooltip")
    tip.wait_for(state="visible")
    assert "1역대" in tip.inner_text()


@pytest.mark.parametrize("date", list(OFF_CASES))
def test_setting_off_hides_aids_and_leaves_plain_words(desktop_context, date):
    """설정이 꺼져 있어도 칩, 변형 ※, 병행 ※는 화면 구조에 있되 보이지 않는다(계산된 display가 none이라 키보드도 닿지
    않는다). 어절 주석은 단추 역할, 키보드 정지점, 이름이 없는 보통 글자이고 눌러도 툴팁이 열리지 않는다."""
    desktop_context.add_init_script(CITE_OFF)
    page = desktop_context.new_page()
    _open(page, f"lectionary/{date}")
    assert page.evaluate("() => document.body.classList.contains('cites-shown')") is False
    slot, aid = OFF_CASES[date]
    loc = page.locator(f".lect-reading[data-slot='{slot}'] {aid}")
    assert loc.count() == 1
    if aid == WORD:
        assert loc.evaluate("e => [e.getAttribute('role'), e.getAttribute('tabindex'), e.getAttribute('aria-label')]") == [None, None, None]
        assert loc.evaluate("e => e.tabIndex") < 0
        assert loc.inner_text() == "베델"   # 글자는 그대로 보인다
        loc.click()
        page.wait_for_timeout(200)
        assert page.evaluate(_TOOLTIP_OPEN) is False
    else:
        assert loc.evaluate("e => getComputedStyle(e).display") == "none"


def test_toggle_in_settings_follows_without_redraw(desktop_context):
    """전례독서를 보는 채로 설정 「인용·주석 표시」를 끄면 칩과 ※가 사라지고 어절 주석이 보통 글자가 되며, 켜면 돌아온다.
    다시 그리지 않으므로 그린 노드가 그대로이고 데스크톱 설정 팝오버도 열린 채 남는다. 결과를 알린다."""
    page = desktop_context.new_page()
    _open(page, BAPTISM)
    page.evaluate(RECORD_ANNOUNCEMENTS)
    assert page.evaluate(_KEEP_DRAWN)
    assert page.evaluate(_STATE) == ON_STATE

    popover = open_settings(page)
    sw = popover.get_by_role("switch", name="인용·주석 표시")
    assert sw.is_checked() is True
    sw.click()
    page.wait_for_function("() => window.__said.includes('인용 본문·주석 숨김')")
    assert page.evaluate(_STATE) == OFF_STATE
    assert page.evaluate(_SAME_DRAWN)
    assert popover.is_visible()
    assert sw.is_checked() is False
    assert page.evaluate("() => localStorage.getItem('bible-cite-show')") == "0"

    sw.click()
    page.wait_for_function("() => window.__said.at(-1) === '인용 본문·주석 표시'")
    assert page.evaluate(_STATE) == ON_STATE
    assert page.evaluate(_SAME_DRAWN)
    assert popover.is_visible()
    assert page.evaluate("() => localStorage.getItem('bible-cite-show')") == "1"


def test_synced_value_follows_without_redraw(desktop_context):
    """다른 기기에서 동기화된 값은 `window.applyCiteShow`로 들어온다(sync/state-machine.js). 끈 값이 오면 열린 주석 툴팁이
    닫히고 어절 주석이 보통 글자가 되며, 켠 값이 오면 다시 단추가 된다. 화면은 다시 그리지 않는다."""
    page = desktop_context.new_page()
    _open(page, BAPTISM)
    assert page.evaluate(_KEEP_DRAWN)
    word = page.locator(B_WORD)
    word.click()
    page.wait_for_function(_TOOLTIP_OPEN)

    page.evaluate("() => window.applyCiteShow(false)")
    assert page.evaluate(_TOOLTIP_OPEN) is False
    assert page.evaluate(_STATE) == OFF_STATE
    assert page.evaluate(_SAME_DRAWN)
    word.click()
    page.wait_for_timeout(200)
    assert page.evaluate(_TOOLTIP_OPEN) is False

    page.evaluate("() => window.applyCiteShow(true)")
    assert page.evaluate(_STATE) == ON_STATE
    assert page.evaluate(_SAME_DRAWN)
    word.click()
    page.wait_for_function(_TOOLTIP_OPEN)
    assert "옮길 수도 있다" in page.locator("#note-tooltip").inner_text()


def test_copy_leaves_out_chip_and_markers(desktop_context):
    """복사한 글에는 칩 「(다니 7:13-14)」와 ※가 들어가지 않는다(장 화면의 복사와 같다)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-11-29")
    assert page.locator(".lect-reading[data-slot='gospel'] .cite-chip").count() == 1   # 화면에 있는 칩이 복사에서 빠지는지 본다
    text = page.evaluate(_COPY_SLOT, "gospel")
    assert "(다니 7:13" not in text
    assert "사람의 아들이 구름을 타고" in text
    assert text.rstrip().endswith("(공동번역성서)")

    _open(page, "lectionary/2026-12-20")
    assert page.locator(".lect-reading[data-slot='first'] .note-anchor--variant").count() == 1
    first = page.evaluate(_COPY_SLOT, "first")
    assert "※" not in first
