"""E2E: 운문의 행은 띄어쓰기 자리에서 줄을 바꾸고, 넘어간 줄은 한 글자 더 들여 쓴다(ADR-053).

줄마다 첫 글자의 자리를 글자 하나씩 재어(`Range.getClientRects`) 같은 높이의 글자를 한 줄로 묶는다.
자리는 운문 행 상자의 왼쪽 끝에서 잰 값이다. 절 번호 자리는 2rem, 한 글자는 본문 글자 크기(1em)다.
"""
import json
from pathlib import Path

import pytest

from .conftest import BASE_URL, CLEAR_APP_STORAGE, IPHONE_UA

# Rendered lines of each matched element: [{text, x}], x from the element's box left. Characters inside the verse
# number, ¶ and ◯ are text but sit in the gutter or after the line, so they do not set where a line starts.
LINES = r"""(sel) => [...document.querySelectorAll(sel)].map(span => {
  const chars = [];
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const mark = !!n.parentElement.closest('.verse-num, .versicle-mark, .responsory-mark');
    for (let i = 0; i < n.data.length; i++) {
      if (n.data[i] === '\u2060') continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
      // A space where the line breaks has no width but still sits at the end of its line.
      const rects = [...r.getClientRects()];
      const rect = rects.find(x => x.width > 0) || rects[0];
      if (rect) chars.push({ c: n.data[i], x: rect.left, y: rect.top + rect.height / 2, mark });
    }
  }
  const lines = [];
  for (const ch of chars) {
    let line = lines.find(l => Math.abs(l.y - ch.y) < 6);
    if (!line) { line = { y: ch.y, text: '', x: null }; lines.push(line); }
    line.text += ch.c;
    if (!ch.mark && ch.c.trim() && line.x === null) line.x = ch.x;
  }
  const box = span.getBoundingClientRect();
  const num = span.querySelector('.verse-num, .versicle-mark');
  // The glyph inside the gutter box: an inline box that inherits the first line's -1em draws it a letter further left.
  // The verse number is generated text (::before) a Range cannot reach, so its own first-line indent stands in for it.
  let glyphLeft = null;
  if (num && num.matches('.versicle-mark')) {
    const g = document.createRange(); g.selectNodeContents(num);
    glyphLeft = g.getClientRects()[0].left - box.left;
  }
  return {
    glyphLeft, numIndent: num ? getComputedStyle(num).textIndent : null,
    em: parseFloat(getComputedStyle(span).fontSize),
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    numLeft: num ? num.getBoundingClientRect().left - box.left : null,
    overflow: span.scrollWidth > span.clientWidth + 0.5,
    lines: lines.map(l => ({ text: l.text, x: l.x === null ? null : l.x - box.left })),
  };
})"""


def _phone(browser, width=390, font=18):
    ctx = browser.new_context(viewport={"width": width, "height": 844}, is_mobile=True, has_touch=True,
                              user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE + f"localStorage.setItem('bible-font-size', '{font}');")
    return ctx


def _open(ctx, path, ready):
    page = ctx.new_page()
    page.goto(f"{BASE_URL}{path}")
    page.wait_for_selector(ready, timeout=20_000)
    page.evaluate("document.fonts.ready")
    return page


def _assert_hangs(span, where):
    """Every line after the first starts one letter inside the first line's start (2rem + 1em)."""
    want = 2 * span["rem"] + span["em"]
    for line in span["lines"][1:]:
        assert line["x"] == pytest.approx(want, abs=0.6), (where, span)
    assert not span["overflow"], (where, span)


def test_wrapped_psalm_line_keeps_the_word_and_indents(browser):
    """시편 23:4의 첫 행은 휴대폰에서 "지날지라도"가 통째로 다음 줄로 가고, 그 줄은 한 글자 안쪽에서 시작한다.

    글자 단위로 줄을 바꿀 때는 "도" 한 글자만 넘어가 첫 줄과 같은 자리에서 시작해 따로 된 행처럼 보였다.
    절 번호와 첫 줄의 자리는 그대로다.
    """
    ctx = _phone(browser)
    try:
        page = _open(ctx, "/ps/23", ".verse-poetry[data-vref='4a']")
        [span] = page.evaluate(LINES, ".verse-poetry[data-vref='4a']")
    finally:
        ctx.close()
    texts = [line["text"].strip() for line in span["lines"]]
    assert texts == ["나 비록 음산한 죽음의 골짜기를", "지날지라도"], span
    assert span["numLeft"] == pytest.approx(0, abs=0.6), span
    assert span["numIndent"] == "0px", span
    assert span["lines"][0]["x"] == pytest.approx(2 * span["rem"], abs=0.6), span
    _assert_hangs(span, "ps 23:4a")


def test_long_liturgical_psalm_lines_wrap_at_spaces_without_overflow(browser):
    """가장 긴 전례시편의 행(20:6)도 폭 320px, 글자 24px에서 띄어쓰기 자리에서만 줄을 바꾸고 화면을 넘지 않는다."""
    ctx = _phone(browser, width=320, font=24)
    try:
        page = _open(ctx, "/lps/20", ".chapter-text .verse-poetry")
        spans = page.evaluate(LINES, ".chapter-text .verse-poetry")
        width_ok = page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
    finally:
        ctx.close()
    assert width_ok
    wrapped = [s for s in spans if len(s["lines"]) > 1]
    assert len(wrapped) >= 5, len(wrapped)
    for span in spans:
        _assert_hangs(span, "lps 20")
        for line in span["lines"][:-1]:
            assert line["text"].endswith(" "), ("a line broke inside a word", span)


# 선창 끝의 ◯ 가 마지막 낱말과 같은 줄에 있는가 — ◯ 마다 그 앞 마지막 글자와 세로 가운데를 견준다.
MARK_ON_WORD_LINE = r"""(sel) => [...document.querySelectorAll(sel)].map(m => {
  const walker = document.createTreeWalker(m.parentElement, NodeFilter.SHOW_TEXT);
  let n, last = null;
  while ((n = walker.nextNode()) && !m.contains(n)) {
    for (let i = n.data.length - 1; i >= 0; i--) if (n.data[i].trim() && n.data[i] !== '\u2060') { last = [n, i]; break; }
  }
  const r = document.createRange(); r.setStart(last[0], last[1]); r.setEnd(last[0], last[1] + 1);
  const a = r.getClientRects()[0], b = m.getBoundingClientRect();
  return { key: m.parentElement.dataset.vkey, same: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) < 6 };
})"""


@pytest.mark.parametrize("path", ["/lps/20", "/lps/104"])
def test_responsory_mark_stays_with_the_last_word(browser, path):
    """선창 끝의 ◯는 마지막 낱말과 같은 줄에 있다(ADR-053 §2). 띄어쓰기 자리에서만 줄을 바꾸면 ◯ 앞의 공백에서
    줄이 바뀌어 ◯만 다음 줄로 넘어갈 수 있다(기본 글자 크기의 휴대폰에서 20:5와 104:24). 그 공백은 줄바꿈 없는 공백으로
    그리고, 복사하면 보통 공백이다(`test_copy.py`의 「… ◯」)."""
    ctx = _phone(browser)
    try:
        page = _open(ctx, path, ".chapter-text .responsory-mark")
        marks = page.evaluate(MARK_ON_WORD_LINE, ".chapter-text .responsory-mark")
    finally:
        ctx.close()
    assert marks
    assert [m["key"] for m in marks if not m["same"]] == []


def test_gloria_mark_stays_with_the_last_word(browser):
    """영광송의 ◯도 "성령께"와 같은 줄에 있다. 영광송은 ◯ 앞에 공백이 없는데, ◯는 기호라 브라우저가 그 앞에서 줄을 바꿀 수
    있다(글자 24px의 폭 390px 휴대폰). ◯ 앞의 낱말 잇기 문자(U+2060)가 막는다."""
    ctx = _phone(browser, width=390, font=24)
    try:
        page = _open(ctx, "/lectionary/2026-06-14", ".lect-gloria .responsory-mark")
        marks = page.evaluate(MARK_ON_WORD_LINE, ".lect-gloria .responsory-mark")
    finally:
        ctx.close()
    assert len(marks) == 1 and marks[0]["same"], marks


# 전례독서 시편 슬롯의 104:35 줄들 — [보이는 글자, ◯가 있는가].
_PSALM_104_35 = """() => [...document.querySelectorAll(".lect-reading[data-slot='psalm'] .verse[data-vkey^='35/']")]
  .map((s) => [s.textContent, !!s.querySelector('.responsory-mark')])"""


def test_half_verse_cut_gives_back_the_space_before_a_dropped_mark(browser):
    """반절의 뒷줄을 버려 선창 줄이 마지막 줄로 남으면 ◯는 지워지고(lectionary.js trimHalfVerses), ◯를 붙잡던 줄바꿈 없는 공백도
    보통 공백으로 돌아간다. 줄 끝의 줄바꿈 없는 공백은 보통 공백과 달리 폭을 차지해 마지막 낱말을 다음 줄로 밀 수 있다.
    실데이터의 전례시편 반절은 앞줄을 버리는 104:35하 하나뿐이라, 반절 표와 독서 표를 104:35상으로 바꿔 그린다(2025-06-08)."""
    root = Path(__file__).resolve().parents[2] / "data" / "lectionary"
    halves = json.loads((root / "half-verses.json").read_text(encoding="utf-8"))
    [entry] = [e for e in halves["entries"] if (e["bookId"], e["chapter"], e["verse"]) == ("lps", 104, 35)]
    entry.update(half="a", line=1, text=None)   # 상: 첫 줄(선창)까지
    readings = (root / "eucharist-readings.json").read_text(encoding="utf-8")
    assert '"verseSpec": "24-34,35b"' in readings
    readings = readings.replace('"verseSpec": "24-34,35b"', '"verseSpec": "24-34,35a"').replace(
        '"verseSpec": "1-9,24,35b"', '"verseSpec": "1-9,24,35a"')
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        ctx.route("**/data/lectionary/half-verses.json", lambda route: route.fulfill(json=halves))
        ctx.route("**/data/lectionary/eucharist-readings.json",
                  lambda route: route.fulfill(body=readings, content_type="application/json"))
        page = _open(ctx, "/lectionary/2025-06-08", ".lect-reading[data-slot='psalm'] .chapter-text .verse")
        lines = page.evaluate(_PSALM_104_35)
    finally:
        ctx.close()
    assert [text.replace("\u2060", "").strip() for text, _ in lines] == ["악인들아, 이 세상에서 영원히 사라져 버려라."], lines
    [(text, has_mark)] = lines
    assert not has_mark and text.endswith(" ") and "\u00a0" not in text, lines


def test_versicle_mark_stays_in_the_gutter(browser):
    """전례시편의 ¶ 표시(무번호 후속 구절)는 상자와 글자 모두 절 번호 자리의 왼쪽 끝에 있다.

    첫 줄 들여쓰기는 안쪽 상자에 물려지므로, 되돌리지 않으면 ¶가 한 글자 왼쪽으로 밀려 화면 밖으로 나간다.
    """
    ctx = _phone(browser, width=320, font=24)
    try:
        page = _open(ctx, "/lps/10", ".chapter-text .versicle-mark")
        spans = page.evaluate(LINES, ".chapter-text .verse-poetry:has(> .versicle-mark)")
    finally:
        ctx.close()
    assert spans
    for span in spans:
        assert span["numLeft"] == pytest.approx(0, abs=0.6), span
        assert span["glyphLeft"] == pytest.approx(0, abs=0.6), span
        assert span["lines"][0]["x"] == pytest.approx(2 * span["rem"], abs=0.6), span
        _assert_hangs(span, "lps 10 ¶")


def test_gloria_lines_hang_like_the_psalm(browser):
    """전례독서의 영광송 두 줄도 시편의 행처럼 띄어쓰기 자리에서 줄을 바꾸고, 넘어간 줄은 한 글자 안쪽이다."""
    ctx = _phone(browser, width=320, font=24)
    try:
        page = _open(ctx, "/lectionary/2026-06-14", ".lect-gloria-line")
        lines = page.evaluate(LINES, ".lect-gloria-line")
    finally:
        ctx.close()
    assert len(lines) == 2
    for span in lines:
        assert len(span["lines"]) >= 2, span
        assert span["lines"][0]["x"] == pytest.approx(2 * span["rem"], abs=0.6), span
        _assert_hangs(span, "gloria")
        for line in span["lines"][:-1]:
            assert line["text"].endswith(" "), ("a line broke inside a word", span)


def test_prose_still_breaks_by_letter(browser):
    """산문은 지금처럼 글자 단위로 줄을 바꾸고 들여 쓰지 않는다(ADR-053 §2)."""
    ctx = _phone(browser)
    try:
        page = _open(ctx, "/gen/1", ".chapter-text .verse")
        style = page.evaluate("""() => {
          const v = document.querySelector('.chapter-text .verse:not(.verse-poetry)');
          const cs = getComputedStyle(v);
          return { wordBreak: cs.wordBreak, textIndent: cs.textIndent };
        }""")
    finally:
        ctx.close()
    assert style == {"wordBreak": "normal", "textIndent": "0px"}, style
