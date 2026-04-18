"""E2E: clipboard copy — partial selection expands to full verse boundaries."""

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
