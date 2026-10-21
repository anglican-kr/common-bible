"""E2E: clipboard copy — partial selection expands to full verse boundaries,
verse-select 복사 button, and pure-poetry whole-verse selection."""

import re

BASE = "http://localhost:8080"

_COPY_TEMPLATE = """
async () => {
  const article = document.querySelector('article.chapter-text');
  %SELECT%
  const dt = new DataTransfer();
  const ev = new ClipboardEvent('copy', {
    bubbles: true, cancelable: true, clipboardData: dt
  });
  article.dispatchEvent(ev);
  return dt.getData('text/plain');
}
"""

_SELECT_MIDDLE_V16 = """
  const v16 = document.getElementById('v16');
  const w = document.createTreeWalker(v16, NodeFilter.SHOW_TEXT);
  let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent));
  const r = document.createRange();
  const mid = Math.floor(t.length / 2);
  r.setStart(t, mid);
  r.setEnd(t, Math.min(mid + 3, t.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
"""

_SELECT_CROSS_V16_V17 = """
  const v16 = document.getElementById('v16');
  const v17 = document.getElementById('v17');
  const w1 = document.createTreeWalker(v16, NodeFilter.SHOW_TEXT);
  let t16; while ((t16 = w1.nextNode()) && !/[^\\s\\u2060]/.test(t16.textContent));
  const w2 = document.createTreeWalker(v17, NodeFilter.SHOW_TEXT);
  let t17; while ((t17 = w2.nextNode()) && !/[^\\s\\u2060]/.test(t17.textContent));
  const r = document.createRange();
  r.setStart(t16, Math.floor(t16.length / 2));
  r.setEnd(t17, Math.min(5, t17.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
"""


def _copy_text(page, select_js: str) -> str:
    script = _COPY_TEMPLATE.replace("%SELECT%", select_js)
    return page.evaluate(script)


def test_partial_selection_expands_to_full_verse(page):
    """Selecting part of v16 copies the entire verse."""
    context = page.context
    context.grant_permissions(["clipboard-read", "clipboard-write"])

    page.goto(f"{BASE}/#/john/3")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)

    text = _copy_text(page, _SELECT_MIDDLE_V16)
    assert "하느님" in text
    assert "사랑" in text


def test_cross_verse_selection_expands_to_full_verses(page):
    """Selecting across v16-v17 boundary copies both full verses without pilcrow."""
    context = page.context
    context.grant_permissions(["clipboard-read", "clipboard-write"])

    page.goto(f"{BASE}/#/john/3")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)

    text = _copy_text(page, _SELECT_CROSS_V16_V17)
    assert "하느님" in text
    assert "사랑" in text
    assert "¶" not in text


# ── Citation chips / note markers excluded from copy (ADR-022) ───────────────

# Synthetic markers injected into v16/v17 so the assertion does not depend on
# which chapters happen to ship hand-authored citations/notes yet. Mirrors the
# real DOM: `.cite-chip` sits between verse spans, `.note-anchor--variant` (※)
# is appended inside a verse span, and a text-anchored `.note-anchor` wraps a
# real word that must survive the copy.
_INJECT_MARKERS = """
  const v16 = document.getElementById('v16');
  const v17 = document.getElementById('v17');
  // Wrap a real substring of v16 in a text-anchored note (word must stay).
  const tw = document.createTreeWalker(v16, NodeFilter.SHOW_TEXT);
  const tn = tw.nextNode();
  const wordLen = Math.min(2, tn.length);
  const noteWord = tn.nodeValue.slice(0, wordLen);
  const wrap = document.createElement('span');
  wrap.className = 'note-anchor';
  wrap.setAttribute('role', 'button');
  wrap.textContent = noteWord;
  const rest = document.createTextNode(tn.nodeValue.slice(wordLen));
  tn.parentNode.insertBefore(wrap, tn);
  tn.parentNode.insertBefore(rest, tn);
  tn.parentNode.removeChild(tn);
  // Append a ※ variant marker inside v16.
  const variant = document.createElement('button');
  variant.type = 'button';
  variant.className = 'note-anchor note-anchor--variant';
  variant.textContent = '\\u203b';
  v16.appendChild(variant);
  // Insert a citation chip between v16 and v17.
  const chip = document.createElement('span');
  chip.className = 'cite-chip';
  chip.setAttribute('role', 'button');
  chip.textContent = '(\\uc778\\uc6a9 \\ucd9c\\ucc98 1:1)';
  v16.parentNode.insertBefore(chip, v17);
  // Select across v16-v17 so both verses (and the chip between them) are in range.
  const w1 = document.createTreeWalker(v16, NodeFilter.SHOW_TEXT);
  let t16; while ((t16 = w1.nextNode()) && !/[^\\s\\u2060]/.test(t16.textContent));
  const w2 = document.createTreeWalker(v17, NodeFilter.SHOW_TEXT);
  let t17; while ((t17 = w2.nextNode()) && !/[^\\s\\u2060]/.test(t17.textContent));
  const r = document.createRange();
  r.setStart(t16, 0);
  r.setEnd(t17, Math.min(5, t17.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
"""


def test_copy_excludes_citation_chip_and_note_marker(page):
    """Copying verses must not leak the citation chip text or the ※ variant
    note marker, while text-anchored note words stay part of the verse."""
    context = page.context
    context.grant_permissions(["clipboard-read", "clipboard-write"])

    page.goto(f"{BASE}/#/john/3")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)

    text = _copy_text(page, _INJECT_MARKERS)
    # Verse text survives.
    assert "하느님" in text and "사랑" in text, f"verse text missing: {text!r}"
    # Citation chip text is gone.
    assert "인용 출처" not in text, f"citation chip leaked into copy: {text!r}"
    assert "(" not in text.split("—")[0], f"chip parens leaked into body: {text!r}"
    # ※ variant note marker is gone.
    assert "※" not in text, f"note marker leaked into copy: {text!r}"


# ── Verse-select bar 복사 button ─────────────────────────────────────────────

def test_verse_select_copy_button_emits_text_with_citation(page):
    """Selecting verses via verse-select mode + tapping 복사 writes the verse
    text and a `— 책 장:절 (공동번역성서)` citation to the clipboard."""
    context = page.context
    context.grant_permissions(["clipboard-read", "clipboard-write"])

    page.goto(f"{BASE}/#/john/3")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)

    # Enter verse-select mode and pick verses 16 and 17 directly (bypass long-press).
    page.evaluate("() => enterVerseSelectMode('john', 3)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.click("#v16")
    page.click("#v17")

    assert not page.locator("#verse-select-copy-btn").is_disabled()
    page.click("#verse-select-copy-btn")

    # 복사 success exits verse-select mode.
    page.wait_for_selector("#verse-select-bar", state="hidden", timeout=2_000)

    text = page.evaluate("async () => await navigator.clipboard.readText()")
    assert "하느님" in text, f"missing verse text in clipboard: {text!r}"
    assert "요한" in text and "3:16-17" in text, f"citation malformed: {text!r}"
    assert "(공동번역성서)" in text


def test_verse_select_copy_button_disabled_when_nothing_selected(page):
    """The 복사 button mirrors the 북마크 button's disabled state — both
    require at least one selected verse."""
    page.goto(f"{BASE}/#/john/3")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)

    page.evaluate("() => enterVerseSelectMode('john', 3)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")

    assert page.locator("#verse-select-copy-btn").is_disabled()
    assert page.locator("#verse-select-bookmark-btn").is_disabled()


# ── Pure-poetry whole-verse selection (시편 등 운문 책) ──────────────────────

def test_psalm_pure_poetry_verse_tap_selects_all_parts(page):
    """Tapping any line of a pure-poetry multi-part verse (e.g. Psalm 1:1)
    selects every part of that verse together."""
    page.goto(f"{BASE}/#/ps/1")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)

    # Psalm 1:1 renders as multiple .verse-poetry spans (1a, 1b, 1c, 1d).
    parts_count = page.evaluate(
        "() => [...document.querySelectorAll('article.chapter-text .verse[data-vref]')]"
        ".filter(v => /^1[a-z]$/.test(v.getAttribute('data-vref'))).length"
    )
    assert parts_count >= 2, f"expected ≥2 parts for Psalm 1:1, got {parts_count}"

    page.evaluate("() => enterVerseSelectMode('ps', 1)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")

    # Tap one part (1a).
    page.click('.verse[data-vref="1a"]')

    selected = page.evaluate(
        "() => [...document.querySelectorAll('article.chapter-text .verse[data-vref]')]"
        ".filter(v => /^1[a-z]$/.test(v.getAttribute('data-vref')) && v.classList.contains('verse-selected'))"
        ".map(v => v.getAttribute('data-vref'))"
    )
    assert len(selected) == parts_count, (
        f"tapping one part should select all {parts_count} parts of Psalm 1:1, "
        f"got {len(selected)}: {selected}"
    )


def test_psalm_pure_poetry_verse_tap_again_deselects_all_parts(page):
    """Tapping a part of a fully-selected pure-poetry verse deselects every
    part together — confirms the toggle direction sticks."""
    page.goto(f"{BASE}/#/ps/1")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)

    page.evaluate("() => enterVerseSelectMode('ps', 1)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")

    page.click('.verse[data-vref="1a"]')
    selected_before = page.evaluate(
        "() => document.querySelectorAll('article.chapter-text .verse-selected').length"
    )
    assert selected_before >= 2, f"expected ≥2 parts selected first, got {selected_before}"

    # Tap a different part of the same verse — should deselect all.
    page.click('.verse[data-vref="1b"]')
    selected_after = page.evaluate(
        "() => [...document.querySelectorAll('article.chapter-text .verse[data-vref]')]"
        ".filter(v => /^1[a-z]$/.test(v.getAttribute('data-vref')) && v.classList.contains('verse-selected'))"
        ".length"
    )
    assert selected_after == 0, (
        f"tapping a part of a fully-selected pure-poetry verse should deselect "
        f"all parts, got {selected_after} still selected"
    )


# ── Reference numbers (self-review 2026-10-13) ───────────────────────────────

_SELECT_LINES = """
  const vs = [...document.querySelectorAll('article.chapter-text .verse[data-vref]')];
  const a = vs.find(v => v.getAttribute('data-vref') === '%A%');
  const b = vs.find(v => v.getAttribute('data-vref') === '%B%');
  const ta = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(a);
  const tb = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(b);
  const r = document.createRange();
  r.setStart(ta, Math.floor(ta.length / 2));
  r.setEnd(tb, Math.min(3, tb.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
"""


def _open_chapter(page, path):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)


def test_partial_poetry_lines_cite_plain_verse_numbers(page):
    """시편 23 의 1절 둘째 줄 ~ 3절 첫 줄 — 출처는 줄 글자 없는 「23:1-3」(장 본문의 원래 계약 — 9회차에서 「1b,1c,2,3a」로
    바뀌었던 것을 되돌렸다)."""
    _open_chapter(page, "ps/23")
    text = _copy_text(page, _SELECT_LINES.replace("%A%", "1b").replace("%B%", "3a"))
    assert text.endswith("— 시편 23:1-3 (공동번역성서)"), text[-80:]


def test_boundary_touch_does_not_drag_in_next_verse(page):
    """요한 3:16 전체를 고르되 범위 끝이 17절의 첫 글자 앞(offset 0)이면 17절은 들어가지 않는다 — 세 번 클릭하면 생기는 범위."""
    _open_chapter(page, "john/3")
    text = page.evaluate("""() => {
      const article = document.querySelector('article.chapter-text');
      const v16 = article.querySelector('.verse[data-vref="16"]');
      const v17 = article.querySelector('.verse[data-vref="17"]');
      const r = document.createRange();
      r.setStartBefore(v16);
      r.setStart(document.createTreeWalker(v16, NodeFilter.SHOW_TEXT).nextNode(), 0);
      r.setEnd(document.createTreeWalker(v17, NodeFilter.SHOW_TEXT).nextNode(), 0);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const dt = new DataTransfer();
      v16.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
      return dt.getData('text/plain');
    }""")
    assert text.endswith("— 요한의 복음서 3:16 (공동번역성서)"), text[-80:]


def test_data_half_verses_collapse_to_whole_verse_numbers(page):
    """이사 7:8-9 — 데이터가 반쪽 절(8a · 8b)이고 그 반쪽이 다시 두 줄이어도 출처는 「7:8-9」(9회차의 「8a,9a」 회귀)."""
    _open_chapter(page, "isa/7")
    vrefs = page.eval_on_selector_all("article.chapter-text .verse[data-vref]", "els => els.map(e => e.getAttribute('data-vref'))")
    first8 = next(v for v in vrefs if v.startswith("8"))
    last9 = [v for v in vrefs if v.startswith("9")][-1]
    text = _copy_text(page, _SELECT_LINES.replace("%A%", first8).replace("%B%", last9))
    assert text.endswith("— 이사야 7:8-9 (공동번역성서)"), text[-80:]


def test_liturgical_psalter_copy_credits_prayer_book(page):
    """전례시편은 기도서 번역이라 출처가 「(대한성공회 기도서)」다 — 「(공동번역성서)」가 아니다(ADR-037 §3 · 사용자 결정 2026-10-13)."""
    _open_chapter(page, "lps/23")
    vrefs = page.eval_on_selector_all("article.chapter-text .verse[data-vref]", "els => els.map(e => e.getAttribute('data-vref'))")
    first2 = next(v for v in vrefs if v.startswith("2"))
    text = _copy_text(page, _SELECT_LINES.replace("%A%", vrefs[0]).replace("%B%", first2))
    assert "(공동번역성서)" not in text
    assert text.endswith("\n\n— 전례시편 23:1-2 (대한성공회 기도서)"), text[-80:]


def test_psalter_copy_from_section_start_carries_heading_and_marks(page):
    """전례시편 89편 19~20절 — 부 「(2)」의 첫 절부터 고르면 「(2)」가 제 줄로 실리고, ◯ 는 선창 끝에 남고, 무번호 구절은 「¶ 」로
    시작한다(사용자 결정 2026-10-13 — 전례 표기는 복사에 남긴다, known-issues §4)."""
    _open_chapter(page, "lps/89")
    text = _copy_text(page, _SELECT_LINES.replace("%A%", "19a").replace("%B%", "20a"))
    assert text.startswith("(2)\n그 옛날, 당신께서 스스로 나타나시어, ◯\n당신의 성도들에게 말씀하셨습니다.\n¶ “나는 용사들 위에"), text[:160]
    assert "나는 나의 종 다윗을 찾아내어 ◯\n" in text, text
    assert text.endswith("\n\n— 전례시편 89:19-20 (대한성공회 기도서)"), text[-80:]


def test_psalter_copy_mid_section_has_no_heading(page):
    """부의 가운데(89:20)부터 고르면 그 부의 「(2)」는 싣지 않는다 — 소제목은 그 부의 첫 절과 함께만."""
    _open_chapter(page, "lps/89")
    text = _copy_text(page, _SELECT_LINES.replace("%A%", "20a").replace("%B%", "20b"))
    assert text.startswith("나는 나의 종 다윗을 찾아내어 ◯\n"), text[:80]
    assert "(2)" not in text
    assert text.endswith("\n\n— 전례시편 89:20 (대한성공회 기도서)"), text[-80:]


def test_verse_select_copy_on_psalter_credits_prayer_book(page):
    """절 선택 막대의 복사 버튼 — 전례시편이면 「(대한성공회 기도서)」, 부의 첫 절을 고르면 그 「(2)」도 싣는다(사용자 결정
    2026-10-13; 종전엔 어느 책이든 「(공동번역성서)」였다)."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    _open_chapter(page, "lps/89")
    page.evaluate("() => enterVerseSelectMode('lps', 89)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.click("#v19")
    page.click("#verse-select-copy-btn")
    page.wait_for_selector("#verse-select-bar", state="hidden", timeout=2_000)
    text = page.evaluate("async () => await navigator.clipboard.readText()")
    assert text.startswith("(2)\n그 옛날"), text[:80]
    assert text.endswith("— 전례시편 89:19 (대한성공회 기도서)"), text[-80:]


_SELECT_WHOLE_ARTICLE = """
  const vs = [...document.querySelectorAll('article.chapter-text .verse[data-vref]')];
  const vis = (n, last) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t, keep = null;
    while ((t = w.nextNode())) if (/[^\\s\\u2060]/.test(t.textContent)) { if (!last) return t; keep = t; } return keep; };
  const a = vis(vs[0], false), b = vis(vs[vs.length - 1], true);
  const r = document.createRange(); r.setStart(a, 0); r.setEnd(b, b.length);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
"""


def test_copy_reference_leaves_out_moved_and_greek_only_verse_numbers(page):
    """다른 장에서 옮겨 실린 절(이사 40 의 41:6-7)과 그리스어 추가 본문(다니 3 의 (24)~(90))의 번호는 출처에 넣지 않는다 —
    종전엔 「이사야 40:6-7, 19-20」 · 「다니엘 3:1-90」(머지 전 검토 2026-10-14 — main 의 출처로 돌아간다)."""
    _open_chapter(page, "isa/40")
    vrefs = page.eval_on_selector_all("article.chapter-text .verse[data-vref]", "els => els.map(e => e.getAttribute('data-vref'))")
    first19 = next(v for v in vrefs if re.match(r"19[a-z]?$", v))
    first20 = next(v for v in vrefs if re.match(r"20[a-z]?$", v))
    text = _copy_text(page, _SELECT_LINES.replace("%A%", first19).replace("%B%", first20))
    assert text.endswith("\n\n— 이사야 40:19-20 (공동번역성서)"), text[-80:]
    _open_chapter(page, "dan/3")
    text = _copy_text(page, _SELECT_WHOLE_ARTICLE)
    assert "아자리야" in text   # 그리스어 추가 본문의 글자는 그대로 실린다 — 번호만 출처에서 뺀다
    assert text.endswith("\n\n— 다니엘 3:1-33 (공동번역성서)"), text[-80:]


def test_copy_reference_bridges_verse_numbers_absent_in_translation(page):
    """공동번역에 없는 절 번호(마르 9:44 · 46)는 건너뛴 절이 아니다 — 출처는 한 구간 「9:43-48」 · 「9:1-50」(사용자 결정 2026-10-14,
    main 과 같다; 이 PR 의 한때 출력은 「9:43, 45, 47-48」)."""
    _open_chapter(page, "mark/9")
    vrefs = page.eval_on_selector_all("article.chapter-text .verse[data-vref]", "els => els.map(e => e.getAttribute('data-vref'))")
    first43 = next(v for v in vrefs if re.match(r"43[a-z]?$", v))
    last48 = [v for v in vrefs if re.match(r"48[a-z]?$", v)][-1]
    text = _copy_text(page, _SELECT_LINES.replace("%A%", first43).replace("%B%", last48))
    assert text.endswith("\n\n— 마르코의 복음서 9:43-48 (공동번역성서)"), text[-80:]
    text = _copy_text(page, _SELECT_WHOLE_ARTICLE)
    assert text.endswith("\n\n— 마르코의 복음서 9:1-50 (공동번역성서)"), text[-80:]


# ── 절 선택 막대 — 번호가 같은 다른 절 (known-issues §5) ──────────────────────
# 선택이 `data-vref`(번호)로 묶여, 번호가 같은 다른 절까지 함께 칠해지고 출처가 그 번호를 섞었다(main 부터). 이제 줄마다
# 다른 `data-vkey` 로 고르고, 출처 번호는 장 본문 복사와 같은 규칙(옮겨 실린 절 · 그리스어 절은 그것만 골랐을 때만)이다.

_SELECTED_IDS = ("() => [...document.querySelectorAll('article.chapter-text .verse.verse-selected')]"
                 ".filter(v => v.id).map(v => v.id)")


def _verse_select(page, path, first, last=None):
    """`path` 를 열어 절 선택 모드에서 `first`(id)를 누르고, `last` 가 있으면 Shift+클릭으로 범위를 넓힌다.
    고른 절의 id(절마다 첫 줄) · 막대 글자를 돌려준다."""
    book, chapter = path.split("/")
    _open_chapter(page, path)
    page.evaluate(f"() => enterVerseSelectMode('{book}', {chapter})")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.click(f"#{first}")
    if last:
        page.click(f"#{last}", modifiers=["Shift"])
    return page.evaluate(_SELECTED_IDS), page.inner_text("#verse-select-count")


def _copy_selection(page):
    page.click("#verse-select-copy-btn")
    page.wait_for_selector("#verse-select-bar", state="hidden", timeout=2_000)
    return page.evaluate("async () => await navigator.clipboard.readText()")


def test_verse_select_moved_verses_keep_their_place(page):
    """이사 40:19 → 20 — 사이에 옮겨 실린 41:6-7 은 함께 골라 본문에 싣고 출처 번호에서는 뺀다. 이 장의 40:6-7 은 칠하지
    않는다(종전 「40:6a,6b,7,19-20」). 41:6 만 누르면 41:6 만이고, 출처는 제 장 「41:6」이다(종전엔 40:6 도 칠하고
    「40:6」 — 사용자 결정 2026-10-21)."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    ids, label = _verse_select(page, "isa/40", "v19", "v20")
    assert ids == ["v19", "v6_c41", "v7_c41", "v20"], ids
    assert label == "19-20절 선택됨", label
    text = _copy_selection(page)
    assert "끼리끼리 손발이 맞아" in text   # 41:6 의 글자
    assert text.endswith("\n\n— 이사야 40:19-20 (공동번역성서)"), text[-80:]
    ids, label = _verse_select(page, "isa/40", "v6_c41", "v7_c41")
    assert ids == ["v6_c41", "v7_c41"], ids
    assert label == "41:6-7절 선택됨", label
    text = _copy_selection(page)
    assert text.endswith("\n\n— 이사야 41:6-7 (공동번역성서)"), text[-80:]


def test_copy_reference_of_moved_verses_alone_names_their_chapter(page):
    """장 본문을 끌어 옮겨 실린 절만 고르면 출처는 제 장이다 — 이사 40 의 41:6-7 은 「이사야 41:6-7」(종전 「40:6-7」 —
    40장 자신의 6-7절을 가리켰다, 사용자 결정 2026-10-21). 욥 27 에 옮겨 실린 24:18-24 도 같다."""
    _open_chapter(page, "isa/40")
    text = _copy_text(page, _SELECT_LINES.replace("%A%", "6a").replace("%B%", "7a")
                      .replace("vs.find(v => v.getAttribute('data-vref') === '6a')", "document.querySelector('#v6_c41')")
                      .replace("vs.find(v => v.getAttribute('data-vref') === '7a')", "document.querySelector('#v7_c41')"))
    assert "끼리끼리 손발이 맞아" in text
    assert text.endswith("\n\n— 이사야 41:6-7 (공동번역성서)"), text[-80:]
    _open_chapter(page, "job/27")
    text = _copy_text(page, _SELECT_LINES
                      .replace("vs.find(v => v.getAttribute('data-vref') === '%A%')", "document.querySelector('#v18_c24')")
                      .replace("vs.find(v => v.getAttribute('data-vref') === '%B%')", "document.querySelector('#v24_c24')"))
    assert text.endswith("\n\n— 욥기 24:18-24 (공동번역성서)"), text[-80:]


def test_verse_select_greek_additions_stand_apart(page):
    """다니 3 의 그리스어 (24)-(25) 를 고르면 같은 번호의 히브리 24(91)-25(92) 는 칠하지 않는다 — 본문도 그리스어만."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    ids, label = _verse_select(page, "dan/3", "v24_lxx", "v25_lxx")
    assert ids == ["v24_lxx", "v25_lxx"], ids
    assert label == "24-25절 선택됨", label
    text = _copy_selection(page)
    assert "아자리야" in text and "깜짝 놀랄" not in text, text[:120]
    assert text.endswith("\n\n— 다니엘 3:24-25 (공동번역성서)"), text[-80:]


def test_verse_select_one_esther_addition_is_one_verse(page):
    """에스 4:17 의 추가 본문 하나를 누르면 그 절만 칠한다 — 종전엔 첫 줄이 같은 「17a」인 25 절이 한꺼번에 칠해지고 출처가
    「4:17a」였다. 한 번호 아래 여러 절이라 출처는 줄 글자 없이 「4:17」."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    ids, label = _verse_select(page, "esth/4", "v17_5")
    assert ids == ["v17_5"], ids
    assert label == "17절 선택됨", label
    text = _copy_selection(page)
    assert text.endswith("\n\n— 에스델 4:17 (공동번역성서)"), text[-80:]


def test_verse_select_bookmark_still_saves_by_number(page):
    """북마크 저장은 번호 단위 그대로다(ADR-010) — 선택이 줄 키로 바뀌어도 그리스어 (24)-(25) 는 「24-25」로 저장된다."""
    ids, _ = _verse_select(page, "dan/3", "v24_lxx", "v25_lxx")
    assert ids == ["v24_lxx", "v25_lxx"], ids
    page.click("#verse-select-bookmark-btn")
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.click("#bm-save-modal .bm-btn-primary")
    page.wait_for_selector("#bm-save-modal", state="hidden")
    specs = page.evaluate("""() => {
      const out = [];
      const walk = (items) => { for (const it of items) { if (it.type === 'bookmark') out.push([it.bookId, it.chapter, it.verseSpec]); if (it.children) walk(it.children); } };
      walk(window.appStorage.loadBookmarks());
      return out;
    }""")
    assert ["dan", 3, "24-25"] in specs, specs


def test_verse_select_duplicated_marker_cites_the_number(page):
    """토비 11:15 — 원본에 절 표시가 중복된 곳이다(운문 두 줄인 15절과 한 줄인 둘째 15절). 15절을 고르면 출처는 줄 글자 없이
    「11:15」다(리뷰 2026-10-21 — 한때 「11:15a,15b」)."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    ids, label = _verse_select(page, "tob/11", "v15")
    assert ids == ["v15"], ids
    assert label == "15절 선택됨", label
    text = _copy_selection(page)
    assert text.endswith("\n\n— 토비트 11:15 (공동번역성서)"), text[-80:]


# ── 절 선택 — 여러 줄 절은 절 전체, 반쪽 절은 「ㄱ · ㄴ」 (사용자 결정 2026-10-22) ──────────────────────
# 산문 절과 섞인 절도 한 줄을 누르면 절 전체를 고르고, 출처에 줄 글자(「35b」)를 쓰지 않는다. 절보다 작은 단위는 데이터의
# 반쪽 절뿐이고 따로 고른다. 화면의 절 번호와 출처는 인쇄본대로 「8ㄱ」 「8ㄴ」이다. 종전 막대는 이사 7 「7-8, 9aa, 9ab」,
# 욥 31 「40aa」, 나훔 1 의 1 → 2ㄱ 은 「1-6, 7-8, 9」였다.

_SELECTED_KEYS = ("() => [...document.querySelectorAll('article.chapter-text .verse.verse-selected')]"
                  ".map(v => v.getAttribute('data-vkey'))")


def test_verse_select_prose_and_mixed_verses_are_one_unit(page):
    """마태 10:35 는 인용 칩 자리에서 두 줄로 나뉜 산문 절이다. 둘째 줄을 눌러도 절 전체를 고르고 출처는 「10:35」다.
    1고린 15:54 는 산문 줄과 인용 구절(운문)이 섞인 절이다. 인용 구절을 눌러도 절 전체를 고른다."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    _open_chapter(page, "matt/10")
    page.evaluate("() => enterVerseSelectMode('matt', 10)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.click('.verse[data-vkey="35/35b"]')
    assert page.evaluate(_SELECTED_KEYS) == ["35/35a", "35/35b"]
    assert page.inner_text("#verse-select-count") == "35절 선택됨"
    text = _copy_selection(page)
    assert text.startswith("나는") and "서로 맞서게" in text, text
    assert text.endswith("\n\n— 마태오의 복음서 10:35 (공동번역성서)"), text[-80:]

    _open_chapter(page, "1cor/15")
    page.evaluate("() => enterVerseSelectMode('1cor', 15)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.click('.verse[data-vkey="54/54b"]')
    assert page.evaluate(_SELECTED_KEYS) == ["54/54a", "54/54b"]
    assert page.inner_text("#verse-select-count") == "54절 선택됨"


def test_half_verse_numbers_show_printed_letters(page):
    """이사 7 은 8ㄱ · 9ㄱ · 8ㄴ · 9ㄴ 순서로 싣는다. 화면의 절 번호도 인쇄본대로 「8ㄱ」이다(종전 「8a」). 주소와 줄 표지는
    「8a」 그대로다."""
    _open_chapter(page, "isa/7")
    nums = page.eval_on_selector_all("article.chapter-text .verse-num", "els => els.map(e => e.getAttribute('data-v'))")
    assert nums[6:11] == ["7", "8ㄱ", "9ㄱ", "8ㄴ", "9ㄴ"], nums[:12]
    shown = page.evaluate("() => getComputedStyle(document.querySelector('#v8a .verse-num'), '::before').content")
    assert shown == '"8ㄱ"', shown
    assert page.get_attribute("#v8a", "data-vref") == "8aa"
    # 절을 누르면 읽어 주는 안내도 화면의 번호와 같다(종전 「8aa절」 「7b절」).
    page.click('.verse[data-vkey="8a/8ab"]')
    page.wait_for_function("() => document.querySelector('#a11y-announce').textContent === '8ㄱ절'")
    page.click('.verse[data-vkey="7/7b"]')
    page.wait_for_function("() => document.querySelector('#a11y-announce').textContent === '7절'")


def test_verse_select_half_verses_cite_printed_letters(page):
    """재현 표(2026-10-21)의 네 장과 나훔 1. 범위 끝이 반쪽 절에 닿으면 그 반쪽 절에서 멈추고, 출처는 「ㄱ · ㄴ」으로 적는다."""
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    cases = [
        ("isa/7", "v7", "v8a", ["v7", "v8a"], "7, 8ㄱ", "이사야 7:7,8ㄱ"),
        ("isa/7", "v7", "v9a", ["v7", "v8a", "v9a"], "7, 8ㄱ, 9ㄱ", "이사야 7:7,8ㄱ,9ㄱ"),
        ("isa/7", "v7", "v9b", ["v7", "v8a", "v9a", "v8b", "v9b"], "7-9", "이사야 7:7-9"),
        ("isa/10", "v15", "v16a", ["v15", "v16a"], "15, 16ㄱ", "이사야 10:15,16ㄱ"),
        ("isa/33", "v22", "v23a", ["v23a", "v22"], "22, 23ㄱ", "이사야 33:22,23ㄱ"),
        ("job/31", "v40a", None, ["v40a"], "40ㄱ", "욥기 31:40ㄱ"),
        ("nah/1", "v1", "v2a", ["v1", "v2a"], "1, 2ㄱ", "나훔 1:1,2ㄱ"),
        ("nah/1", "v1", "v9", ["v1", "v2a", "v3", "v4", "v5", "v6", "v7", "v9"], "1, 2ㄱ, 3-9", "나훔 1:1,2ㄱ,3-9"),
        ("nah/1", "v1", "v2b", ["v1", "v2a", "v3", "v4", "v5", "v6", "v7", "v9", "v2b"], "1-9", "나훔 1:1-9"),
    ]
    for path, first, last, want_ids, want_label, want_cite in cases:
        ids, label = _verse_select(page, path, first, last)
        assert ids == want_ids, (path, first, last, ids)
        assert label == f"{want_label}절 선택됨", (path, first, last, label)
        text = _copy_selection(page)
        assert text.endswith(f"\n\n— {want_cite} (공동번역성서)"), (path, first, last, text[-80:])


def test_verse_select_one_half_verse_is_its_own_unit(page):
    """욥 31:40ㄱ 은 8절 뒤에, 40ㄴ 은 장 끝에 실린다. 40ㄱ 을 눌러도 장 끝의 40ㄴ 은 칠하지 않는다. 두 반쪽을 다 고르면
    출처는 「31:40」이다. 북마크 저장은 번호 단위 그대로다(ADR-010)."""
    ids, label = _verse_select(page, "job/31", "v40a")
    page.click("#v40b")
    assert page.evaluate(_SELECTED_IDS) == ["v40a", "v40b"]
    assert page.inner_text("#verse-select-count") == "40절 선택됨"
    page.click("#v40b")
    assert page.inner_text("#verse-select-count") == "40ㄱ절 선택됨"
    page.click("#verse-select-bookmark-btn")
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.click("#bm-save-modal .bm-btn-primary")
    page.wait_for_selector("#bm-save-modal", state="hidden")
    specs = page.evaluate("""() => {
      const out = [];
      const walk = (items) => { for (const it of items) { if (it.type === 'bookmark') out.push([it.bookId, it.chapter, it.verseSpec]); if (it.children) walk(it.children); } };
      walk(window.appStorage.loadBookmarks());
      return out;
    }""")
    assert ["job", 31, "40"] in specs, specs
