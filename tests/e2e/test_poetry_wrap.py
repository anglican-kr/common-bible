"""E2E: 운문의 행은 첫 줄을 반 글자 들여 쓰고 띄어쓰기 자리에서 줄을 바꾸며, 화면 끝에서 넘어간 줄은 들여 쓰지 않는다(ADR-053, ADR-054).

줄마다 첫 글자의 자리를 글자 하나씩 재어(`Range.getClientRects`) 같은 높이의 글자를 한 줄로 묶는다.
자리는 운문 행 상자의 왼쪽 끝에서 잰 값이다. 절 번호 자리는 2rem, 반 글자는 본문 글자 크기의 절반(0.5em)이다.
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


def _assert_breaks_at_spaces(span, where):
    """Every line break falls on a space. The space is counted on the line it was measured on: after a `.quote-run`
    box it may sit at the start of the next line, where it takes no width."""
    for prev, line in zip(span["lines"], span["lines"][1:]):
        assert prev["text"].endswith(" ") or line["text"].startswith(" "), ("a line broke inside a word", where, span)


def _assert_first_line_indented(span, where):
    """The line's first line starts half a letter in from the text edge (2rem + 0.5em) — ADR-054."""
    assert span["lines"][0]["x"] == pytest.approx(2 * span["rem"] + 0.5 * span["em"], abs=0.6), (where, span)


def _assert_wrapped_lines_at_text_edge(span, where):
    """Every line wrapped by the screen starts at the text edge, right after the verse-number gutter (2rem)."""
    want = 2 * span["rem"]
    for line in span["lines"][1:]:
        assert line["x"] == pytest.approx(want, abs=0.6), (where, span)
    assert not span["overflow"], (where, span)


def test_wrapped_psalm_line_keeps_the_word(browser):
    """시편 23:4의 첫 행은 휴대폰에서 "지날지라도"가 통째로 다음 줄로 간다. 행의 첫 줄은 반 글자 들여 쓰고, 넘어간 줄은
    들여 쓰지 않아 새 행과 구별된다(ADR-054). 절 번호는 왼쪽 끝 그대로다.

    글자 단위로 줄을 바꿀 때는 "도" 한 글자만 넘어가 따로 된 행처럼 보였다.
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
    _assert_first_line_indented(span, "first line")
    _assert_wrapped_lines_at_text_edge(span, "ps 23:4a")


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
        _assert_wrapped_lines_at_text_edge(span, "lps 20")
        _assert_breaks_at_spaces(span, "lps 20")


@pytest.mark.parametrize("path, vref, width, font, word", [
    ("/isa/1", "26c", 390, 18, "마을’이라"),        # 그제야 너는 ‘정의의 도시, 성실한 마을’이라 불릴 것이다.
    ("/isa/61", "3e", 390, 18, "숲’이라"),
    ("/wis/18", "24c", 390, 18, "하느님’이라는"),
    ("/isa/61", "6b", 320, 24, "봉사자’라"),
])
def test_quote_stays_with_its_particle(browser, path, vref, width, font, word):
    """따옴표가 두 글자 사이에 있으면 그 두 글자와 같은 줄에 있다(ADR-053 §2). 브라우저는 한국어 사이의 따옴표 앞뒤에서 줄을
    바꿀 수 있어, 띄어쓰기 자리에서만 줄을 바꿔도 "‘구원’" / "이라"처럼 낱말이 나뉘었다. 따옴표와 양옆 글자를 줄바꿈하지 않는
    상자(`.quote-run`)로 묶는다(helpers.js wrapQuoteRuns). 고른 행과 폭은 묶기 전에 이 기기의 글꼴로 따옴표 옆에서 줄이 바뀌던 곳이다."""
    ctx = _phone(browser, width=width, font=font)
    sel = f".chapter-text .verse-poetry[data-vref='{vref}']"
    try:
        page = _open(ctx, path, sel)
        [span] = page.evaluate(LINES, sel)
    finally:
        ctx.close()
    assert len(span["lines"]) >= 2, span   # the line still wraps here
    assert any(word in line["text"] for line in span["lines"]), (word, span)
    _assert_breaks_at_spaces(span, f"{path} {vref}")
    _assert_wrapped_lines_at_text_edge(span, f"{path} {vref}")


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


@pytest.mark.parametrize("path,width,font", [("/lps/20", 390, 18), ("/lps/104", 390, 18), ("/lps/99", 320, 24)])
def test_responsory_mark_stays_with_the_last_word(browser, path, width, font):
    """선창 끝의 ◯는 마지막 낱말과 같은 줄에 있다(ADR-053 §2). 띄어쓰기 자리에서만 줄을 바꾸면 ◯ 앞의 공백에서
    줄이 바뀌어 ◯만 다음 줄로 넘어갈 수 있다(기본 글자 크기의 휴대폰에서 20:5와 104:24). 그 공백은 줄바꿈 없는 공백으로
    그리고, 복사하면 보통 공백이다(`test_copy.py`의 「… ◯」). 99:8의 "대답해주셨습니다. ◯"는 폭 320px에 글자 24px에서 한 줄보다
    길어, ◯ 혼자가 아니라 마지막 글자와 함께 넘어간다(◯ 상자, 2026-11-24)."""
    ctx = _phone(browser, width=width, font=font)
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


# 운문의 행이 어느 글자 옆에서나 줄을 바꿀 수 있게 한다(`line-break: anywhere`). 줄바꿈 없는 공백(U+00A0)과 낱말 잇기
# 문자(U+2060)도 막지 못하는 줄바꿈이다. 앱의 CSP는 끼워 넣은 스타일을 막으므로 컨텍스트가 CSP를 건너뛴다.
_BREAK_ANYWHERE = ".verse-poetry, .lect-gloria-line { line-break: anywhere; }"
_MARK_HELD = r"""() => [...document.querySelectorAll('.responsory-mark')].map(m => {
  const hold = m.parentElement;
  return hold.classList.contains('responsory-hold') && getComputedStyle(hold).whiteSpace === 'nowrap'
    ? hold.textContent.replace(/⁠/g, '') : null;
})"""


@pytest.mark.parametrize("width", [310, 358, 406])
def test_responsory_mark_is_held_even_where_the_browser_breaks_anywhere(browser, width):
    """◯와 그 앞의 마지막 글자는 줄바꿈하지 않는 상자(`.responsory-hold`)에 함께 들어 있어(helpers.js holdResponsoryMarks),
    브라우저가 어느 자리에서 줄을 바꾸든 ◯가 혼자 다음 줄로 가지 않는다(ADR-053 §2). 아이폰의 Safari는 "경배하여라."와 그 뒤의
    줄바꿈 없는 공백 사이에서 줄을 바꿔 ◯만 넘겼다(2026-11-24, 전례시편 96:9와 11). Chromium에서는 그 공백이 막아 재현되지
    않으므로, 어느 글자 옆에서나 줄을 바꾸게 해서 시험한다. 상자가 없으면 고른 폭마다 ◯가 혼자 넘어간다(310px에서 영광송 포함
    다섯 곳). 2026-11-24 전례독서는 시편 96편과 영광송이다."""
    ctx = browser.new_context(viewport={"width": width, "height": 844}, is_mobile=True, has_touch=True,
                              user_agent=IPHONE_UA, bypass_csp=True)
    ctx.add_init_script(CLEAR_APP_STORAGE + "localStorage.setItem('bible-font-size', '18');")
    try:
        page = _open(ctx, "/lectionary/2026-11-24", ".lect-gloria .responsory-mark")
        page.add_style_tag(content=_BREAK_ANYWHERE)
        held = page.evaluate(_MARK_HELD)
        marks = page.evaluate(MARK_ON_WORD_LINE, ".chapter-text .responsory-mark, .lect-gloria .responsory-mark")
    finally:
        ctx.close()
    assert len(held) == 14 and None not in held, held   # 시편 96편 13곳과 영광송
    assert "라.\u00a0◯" in held and "께◯" in held, held   # 96:9 "경배하여라.", 영광송 "성령께"
    assert len(marks) == 14 and all(m["same"] for m in marks), marks


# 전례독서 시편 슬롯의 104:35 줄들 — [보이는 글자, ◯나 ◯ 상자가 있는가].
_PSALM_104_35 = """() => [...document.querySelectorAll(".lect-reading[data-slot='psalm'] .verse[data-vkey^='35/']")]
  .map((s) => [s.textContent, !!s.querySelector('.responsory-mark, .responsory-hold')])"""


def test_half_verse_cut_gives_back_the_space_before_a_dropped_mark(browser):
    """반절의 뒷줄을 버려 선창 줄이 마지막 줄로 남으면 ◯는 지워지고(lectionary.js trimHalfVerses), ◯를 붙잡던 줄바꿈 없는 공백도
    보통 공백으로 돌아간다. 줄 끝의 줄바꿈 없는 공백은 보통 공백과 달리 폭을 차지해 마지막 낱말을 다음 줄로 밀 수 있다.
    ◯를 마지막 글자에 붙잡던 상자(`.responsory-hold`)도 풀려 글자만 남는다.
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


def test_half_verse_cut_inside_a_note_anchor_split_by_a_quote_run(browser):
    """따옴표 묶음 상자(`.quote-run`)가 어절 주석의 글자를 여러 조각으로 나눠도, 반절 경계가 주석 안의 조각 첫머리에 떨어지면
    주석을 풀고 경계에서 자른다(lectionary.js cutLineText). 조각 첫머리를 주석의 시작으로 보면 버릴 쪽 글자가 주석째 남았다.
    실데이터에는 없는 경우라 104:35의 첫 줄에 따옴표와 주석을 넣고, 경계 문구를 그 묶음 첫 글자부터로 바꿔 그린다(2025-06-08)."""
    root = Path(__file__).resolve().parents[2] / "data"
    halves = json.loads((root / "lectionary" / "half-verses.json").read_text(encoding="utf-8"))
    [entry] = [e for e in halves["entries"] if (e["bookId"], e["chapter"], e["verse"]) == ("lps", 104, 35)]
    entry.update(half="b", line=1, text="원’히 사라져 버려라.")   # 하: 첫 줄의 이 문구부터
    chapter = json.loads((root / "bible" / "lps-104.json").read_text(encoding="utf-8"))
    [v35] = [v for v in chapter["verses"] if v["number"] == 35]
    v35["segments"][0]["text"] = "악인들아, 이 세상에서 ‘영원’히 사라져 버려라."
    v35["notes"] = [{"anchor": "‘영원’히 사라져", "body": "꾸민 주석"}]
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        ctx.route("**/data/lectionary/half-verses.json", lambda route: route.fulfill(json=halves))
        ctx.route("**/data/bible/lps-104.json", lambda route: route.fulfill(json=chapter))
        page = _open(ctx, "/lectionary/2025-06-08", ".lect-reading[data-slot='psalm'] .chapter-text .verse")
        lines = page.evaluate(_PSALM_104_35)
        notes = page.evaluate("""() => [...document.querySelectorAll(
          ".lect-reading[data-slot='psalm'] .verse[data-vkey^='35/'] .note-anchor")].length""")
    finally:
        ctx.close()
    assert [text.replace("⁠", "").replace(" ", " ").strip() for text, _ in lines] == [
        "원’히 사라져 버려라. ◯", "내 영혼아, 주님을 찬미하여라. 알렐루야!"], lines
    assert notes == 0, lines   # 반쪽 어절에 온전한 어절의 주석 단추가 남지 않는다


# 전례독서 운문의 〔(`.lect-bracket--hang`)마다 [절 번호 글자의 오른쪽 끝, 〔 글자 칸의 왼쪽 끝]. 절 번호는 가장 긴 「150」으로
# 바꿔 잰다(시편의 가장 큰 절 번호). 절 번호는 생성 글자(::before)라 같은 글꼴로 캔버스에서 폭을 잰다.
_BRACKET_CLEARS_NUMBER = r"""() => [...document.querySelectorAll('.verse-poetry .lect-bracket--hang')].map(b => {
  const num = b.closest('.verse-poetry').querySelector('.verse-num');
  num.setAttribute('data-v', '150');
  const cs = getComputedStyle(num);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const r = document.createRange(); r.selectNodeContents(b);
  return { numRight: num.getBoundingClientRect().left + ctx.measureText('150').width, bracketLeft: r.getClientRects()[0].left };
})"""


@pytest.mark.parametrize("width, font", [(390, 18), (320, 24)])
def test_optional_bracket_clears_the_verse_number(browser, width, font):
    """전례독서의 〔는 첫 글자 바로 앞에 내어 쓰고(ADR-054), 반 글자 들여쓰기에서는 그 칸이 절 번호 자리에 걸친다. 세 자리 절
    번호와도 겹치지 않는다(2026-05-06의 운문 〔 두 곳)."""
    ctx = _phone(browser, width=width, font=font)
    try:
        page = _open(ctx, "/lectionary/2026-05-06", ".verse-poetry .lect-bracket--hang")
        spots = page.evaluate(_BRACKET_CLEARS_NUMBER)
    finally:
        ctx.close()
    assert len(spots) == 2, spots   # 2026-05-06의 운문 〔 두 곳
    assert all(s["bracketLeft"] >= s["numRight"] for s in spots), spots


def test_versicle_mark_stays_in_the_gutter(browser):
    """전례시편의 ¶ 표시(무번호 후속 구절)는 상자와 글자 모두 절 번호 자리의 왼쪽 끝에 있다.

    운문 행에 첫 줄 들여쓰기(`text-indent`)를 주면 안쪽 상자가 물려받아 ¶ 글자가 절 번호 자리의 왼쪽 끝에서 밀린다(ADR-053을 구현하며 겪었다).
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
        _assert_first_line_indented(span, "first line")
        _assert_wrapped_lines_at_text_edge(span, "lps 10 ¶")


def test_gloria_lines_wrap_like_the_psalm(browser):
    """전례독서의 영광송 두 줄도 시편의 행처럼 첫 줄을 반 글자 들여 쓰고 띄어쓰기 자리에서 줄을 바꾸며, 넘어간 줄은 들여 쓰지 않는다."""
    ctx = _phone(browser, width=320, font=24)
    try:
        page = _open(ctx, "/lectionary/2026-06-14", ".lect-gloria-line")
        lines = page.evaluate(LINES, ".lect-gloria-line")
    finally:
        ctx.close()
    assert len(lines) == 2
    for span in lines:
        assert len(span["lines"]) >= 2, span
        _assert_first_line_indented(span, "first line")
        _assert_wrapped_lines_at_text_edge(span, "gloria")
        _assert_breaks_at_spaces(span, "gloria")


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
