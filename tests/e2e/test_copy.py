"""E2E: clipboard copy — partial selection expands to full verse boundaries,
verse-select 복사 button, and pure-poetry whole-verse selection."""

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
  const t = w.nextNode();
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
  const t16 = w1.nextNode();
  const w2 = document.createTreeWalker(v17, NodeFilter.SHOW_TEXT);
  const t17 = w2.nextNode();
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
  const t16 = w1.nextNode();
  const w2 = document.createTreeWalker(v17, NodeFilter.SHOW_TEXT);
  const t17 = w2.nextNode();
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
