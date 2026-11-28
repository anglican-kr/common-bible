"""E2E: book-name swap (full / mobile-shortened) across viewports.

Covers three mechanisms:
  - Book-list buttons (/, /old_testament, /new_testament, /deuterocanon):
    NT books emit `.book-name-full` + `.book-name-mobile` spans. Touch
    devices always show mobile via media query; non-touch devices add
    `.compact` to the anchor when the full name would wrap.
  - Chapter / chapter-list / prologue header titles: NT books emit two
    spans inside `#page-title`. JS adds `.compact` to `#page-title` when
    the full text would overflow the room remaining between the absolute-
    positioned back/bookmark buttons.
  - Resume-reading banner (`.resume-banner`): when the saved reading
    position is in an NT book, the banner emits `.resume-text-full` and
    `.resume-text-mobile` spans and swaps via touch media query or
    measurement (`.compact` on `.resume-banner`).

Server prerequisite: `python3 scripts/serve.py 8080`.
"""

BASE = "http://localhost:8080"
_IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
)


def _book_list_link_state(page, book_id: str) -> dict:
    """Return what's visible for a book-list anchor, plus its compact flag."""
    return page.evaluate(
        """
        (id) => {
          const a = document.querySelector(`.book-list a[href="/${id}"]`);
          if (!a) return null;
          const full = a.querySelector('.book-name-full');
          const mob  = a.querySelector('.book-name-mobile');
          const fullShown = full && getComputedStyle(full).display !== 'none';
          const mobShown  = mob  && getComputedStyle(mob ).display !== 'none';
          return {
            visible: fullShown ? full.textContent : (mobShown ? mob.textContent : a.textContent),
            compact: a.classList.contains('compact'),
            hasMobile: !!mob,
            ariaLabel: a.getAttribute('aria-label'),
          };
        }
        """,
        book_id,
    )


def _title_state(page) -> dict:
    return page.evaluate(
        """
        () => {
          const t = document.getElementById('page-title');
          const full = t.querySelector('.title-text-full');
          const mob  = t.querySelector('.title-text-mobile');
          let visible = '';
          if (full && mob) {
            const fullShown = getComputedStyle(full).display !== 'none';
            const mobShown  = getComputedStyle(mob ).display !== 'none';
            visible = fullShown ? full.textContent : (mobShown ? mob.textContent : '');
          }
          return {
            visible,
            compact: t.classList.contains('compact'),
            hasMobile: !!mob,
            ariaLabel: t.getAttribute('aria-label'),
          };
        }
        """
    )


# ── Book-list: touch device always shows mobile names ───────────────────────

def test_book_list_touch_phone_shows_mobile_names(browser):
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=_IPHONE_UA,
        is_mobile=True,
        has_touch=True,
    )
    page = ctx.new_page()
    page.goto(f"{BASE}/new_testament")
    page.wait_for_selector(".book-list a")

    # NT-shortened books show the mobile span via the touch media query.
    assert _book_list_link_state(page, "rom")["visible"] == "로마서"
    assert _book_list_link_state(page, "1cor")["visible"] == "1고린토"
    assert _book_list_link_state(page, "2thess")["visible"] == "2데살로니카"
    assert _book_list_link_state(page, "1john")["visible"] == "요한1서"
    assert _book_list_link_state(page, "rev")["visible"] == "요한묵시록"

    # Gospels now carry a mobile-shortened name too (NT_MOBILE_NAME: 마태오 등).
    matt = _book_list_link_state(page, "matt")
    assert matt["visible"] == "마태오"
    assert matt["hasMobile"] is True
    # Acts has no NT_MOBILE_NAME override, so it keeps the canonical name.
    acts = _book_list_link_state(page, "acts")
    assert acts["visible"] == "사도행전"
    assert acts["hasMobile"] is False

    # aria-label is the canonical name (screen readers hear formal title).
    assert _book_list_link_state(page, "rom")["ariaLabel"] == "로마인들에게 보낸 편지"

    ctx.close()


def test_book_list_touch_tablet_matches_desktop(browser):
    """A touch tablet in the large layout (ADR-050 §2) shows the names a desktop of the same size shows: the full name
    where it fits, the short one only where the measurement finds the full name would wrap. Forcing short names is for
    touch screens in the small layout (phones)."""
    script = """() => [...document.querySelectorAll('.book-list a')]
      .filter((a) => a.querySelector('.book-name-mobile'))
      .map((a) => (getComputedStyle(a.querySelector('.book-name-full')).display !== 'none' ? 'full:' : 'short:')
        + a.getAttribute('aria-label'))"""
    shown = {}
    for kind, options in (("tablet", {"is_mobile": True, "has_touch": True}), ("desktop", {})):
        ctx = browser.new_context(viewport={"width": 1024, "height": 768}, **options)
        page = ctx.new_page()
        page.goto(f"{BASE}/new_testament")
        page.wait_for_selector(".book-list a")
        page.wait_for_timeout(300)  # the wrap measurement runs after layout
        shown[kind] = page.evaluate(script)
        ctx.close()
    assert shown["tablet"] == shown["desktop"]
    assert any(name.startswith("full:") for name in shown["tablet"]), shown["tablet"]


# ── Book-list: non-touch falls back to wrap-detection ──────────────────────

def test_book_list_desktop_huge_text_swaps_to_mobile(browser):
    """Desktop (no touch) in a narrow window at enlarged font triggers .compact
    on NT anchors. The responsive book grid widens its columns as the font
    grows, so a narrow window is what reliably forces the full name to overflow
    the anchor's inner width (a wide 1280px window just keeps widening columns)."""
    ctx = browser.new_context(viewport={"width": 420, "height": 800})
    page = ctx.new_page()
    page.goto(f"{BASE}/new_testament")
    page.wait_for_selector(".book-list a")

    page.evaluate("document.documentElement.style.fontSize = '28px'")
    # ResizeObserver re-runs measurement; tiny wait covers the 50ms debounce.
    page.wait_for_timeout(150)

    rom = _book_list_link_state(page, "rom")
    assert rom["compact"] is True
    assert rom["visible"] == "로마서"

    ctx.close()


# ── Chapter view header: NT title swap ──────────────────────────────────────

def test_chapter_header_iphone_uses_compact_title(browser):
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=_IPHONE_UA,
        is_mobile=True,
        has_touch=True,
    )
    page = ctx.new_page()
    page.goto(f"{BASE}/1cor/5")
    page.wait_for_selector("article.chapter-text .verse")

    state = _title_state(page)
    assert state["hasMobile"] is True
    # On touch devices the swap is driven by the pointer:coarse media query,
    # which shows .title-text-mobile directly; the measurement-based .compact
    # class is only the non-touch fallback, so it stays off here.
    assert state["visible"] == "1고린토 5장"
    # aria-label preserves the canonical (formal) name for screen readers.
    assert state["ariaLabel"] == "고린토인들에게 보낸 첫째 편지 5장"

    ctx.close()


def test_chapter_header_desktop_keeps_full_title(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.goto(f"{BASE}/1cor/5")
    page.wait_for_selector("article.chapter-text .verse")

    state = _title_state(page)
    assert state["hasMobile"] is True
    assert state["compact"] is False
    assert state["visible"] == "고린토인들에게 보낸 첫째 편지 5장"

    ctx.close()


def test_chapter_header_desktop_huge_text_triggers_compact(browser):
    """Even on desktop, enlarging text past the available header room
    must swap to the mobile-shortened title."""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.goto(f"{BASE}/1cor/5")
    page.wait_for_selector("article.chapter-text .verse")

    page.evaluate("document.documentElement.style.fontSize = '32px'")
    page.wait_for_timeout(150)

    state = _title_state(page)
    assert state["compact"] is True
    assert state["visible"] == "1고린토 5장"

    ctx.close()


def test_acts_chapter_header_no_swap(browser):
    """사도행전 has no mobile override; #page-title carries no swap spans.
    (Gospels DO swap now — see test_gospel_chapter_header_swaps_on_iphone.)"""
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=_IPHONE_UA,
        is_mobile=True,
        has_touch=True,
    )
    page = ctx.new_page()
    page.goto(f"{BASE}/acts/1")
    page.wait_for_selector("article.chapter-text .verse")

    state = _title_state(page)
    assert state["hasMobile"] is False, "acts has no NT_MOBILE_NAME override"
    assert state["compact"] is False
    assert state["ariaLabel"] is None

    ctx.close()


def test_gospel_chapter_header_swaps_on_iphone(browser):
    """복음서도 이제 모바일 짧은 명칭으로 전환된다 (NT_MOBILE_NAME: 마태오)."""
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=_IPHONE_UA,
        is_mobile=True,
        has_touch=True,
    )
    page = ctx.new_page()
    page.goto(f"{BASE}/matt/1")
    page.wait_for_selector("article.chapter-text .verse")

    state = _title_state(page)
    assert state["hasMobile"] is True, "matt now has a NT_MOBILE_NAME override"
    assert state["visible"] == "마태오 1장"
    assert state["ariaLabel"] == "마태오의 복음서 1장"

    ctx.close()


# ── Resume pill (small layout): the short name where the full one does not fit ──

def _resume_pill_state(page) -> dict:
    return page.evaluate(
        """
        () => {
          const ban = document.querySelector('.resume-banner');
          const link = ban.querySelector('.resume-banner-link');
          const shown = [...link.querySelectorAll('span')].find((s) => getComputedStyle(s).display !== 'none');
          return {
            visible: shown ? shown.textContent : '',
            compact: ban.classList.contains('compact'),
            ariaLabel: link.getAttribute('aria-label'),
            position: getComputedStyle(ban).position,
          };
        }
        """
    )


def test_resume_pill_swaps_to_the_short_name_on_a_small_layout(browser):
    """The portrait resume pill on the small layout (ADR-030, ADR-050) is narrower than the strip it replaced (the ×
    takes 60px). A phone shows the short name by the touch media query; a mouse window of the same size measures the
    link and adds `.compact` when the full name does not fit. Screen readers keep the full name either way."""
    for options in ({"is_mobile": True, "has_touch": True, "user_agent": _IPHONE_UA}, {}):
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, **options)
        ctx.add_init_script(
            "localStorage.setItem('bible-last-read', JSON.stringify({bookId: '2thess', chapter: 3}));"
            "localStorage.setItem('bible-startup', 'home');"
        )
        try:
            page = ctx.new_page()
            page.goto(f"{BASE}/")
            page.wait_for_selector(".resume-banner")
            page.wait_for_timeout(150)  # the ResizeObserver re-measure is debounced 50ms
            state = _resume_pill_state(page)
            assert state["position"] == "fixed", state
            assert state["visible"] == "이어읽기: 2데살로니카 3장", (options, state)
            assert state["ariaLabel"] == "이어읽기: 데살로니카인들에게 보낸 둘째 편지 3장"
            if not options:
                assert state["compact"] is True
        finally:
            ctx.close()


def test_resume_pill_measures_the_name_again_when_the_text_size_changes(browser):
    """The pill keeps its size when the text size changes (fixed height, ends fixed to the dock), so the strip's way of
    noticing — its height followed the text — is gone. The title row's height still follows the root font size, and a
    change there measures the name again: a mouse window that showed the short name at 24px shows the full one at 14px
    and the short one again at 24px."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    ctx.add_init_script(
        "localStorage.setItem('bible-last-read', JSON.stringify({bookId: '1john', chapter: 3}));"
        "localStorage.setItem('bible-startup', 'home');"
        "localStorage.setItem('bible-font-size', '24');"
    )
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/")
        page.wait_for_selector(".resume-banner")
        page.wait_for_timeout(150)
        assert _resume_pill_state(page)["compact"] is True
        page.evaluate("() => window.applyFontSize(14)")
        page.wait_for_function("() => !document.querySelector('.resume-banner').classList.contains('compact')", timeout=2_000)
        assert _resume_pill_state(page)["visible"] == "이어읽기: 요한의 첫째 편지 3장"
        page.evaluate("() => window.applyFontSize(24)")
        page.wait_for_function("() => document.querySelector('.resume-banner').classList.contains('compact')", timeout=2_000)
    finally:
        ctx.close()
