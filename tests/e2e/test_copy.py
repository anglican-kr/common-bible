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
    """요한 3:16 전체를 고르되 범위 끝이 17절의 첫 글자 앞(offset 0)이면 17절은 들어가지 않는다 — 세 번 클릭의 꼴."""
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
