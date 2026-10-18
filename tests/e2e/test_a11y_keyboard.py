"""E2E: 접근성 — 키보드 인터랙션.

Tab 포커스 순서, Enter/Escape 동작, 포커스 트랩, 포커스 복귀를 검증한다.
"""
from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"


def _open(browser, path=""):
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    url = f"{BASE}/{path}".rstrip("/") or BASE
    page.goto(url)
    page.wait_for_selector("#search-input")
    return ctx, page


def _focused(page) -> str:
    """현재 포커스된 요소의 aria-label, id, 또는 tag를 반환한다."""
    return page.evaluate("""() => {
        const el = document.activeElement;
        if (!el) return 'none';
        return el.getAttribute('aria-label') || el.id || el.tagName.toLowerCase();
    }""")


# ── Enter / Escape ────────────────────────────────────────────────────────────

def test_search_enter_shows_results(browser):
    """검색 입력 후 Enter → 결과가 표시된다."""
    ctx, page = _open(browser)
    try:
        page.fill("#search-input", "사랑")
        page.keyboard.press("Enter")
        page.wait_for_selector(".search-result-item", timeout=8_000)
    finally:
        ctx.close()


def test_escape_closes_bookmark_drawer(browser):
    """북마크 드로어가 열린 상태에서 Escape → 드로어가 닫힌다."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")

        page.keyboard.press("Escape")
        page.wait_for_selector("#bookmark-drawer", state="hidden", timeout=2_000)
    finally:
        ctx.close()


def test_escape_closes_bm_save_modal(browser):
    """북마크 저장 모달에서 Escape → 모달이 닫힌다."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        page.locator("#bm-save-chapter-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])")

        page.keyboard.press("Escape")
        page.wait_for_selector("#bm-save-modal", state="hidden", timeout=2_000)
    finally:
        ctx.close()


def test_escape_closes_settings_popover(browser):
    """설정 팝오버에서 Escape → 팝오버가 닫힌다."""
    ctx, page = _open(browser)
    try:
        page.locator("#settings-anchor .settings-btn").click()
        page.wait_for_selector(".settings-popover", state="visible")

        page.keyboard.press("Escape")
        page.wait_for_selector(".settings-popover", state="hidden", timeout=2_000)
    finally:
        ctx.close()


# ── 포커스 트랩 ───────────────────────────────────────────────────────────────

def test_focus_trap_in_bm_save_modal(browser):
    """북마크 저장 모달에서 Tab이 모달 밖으로 나가지 않는다."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        page.locator("#bm-save-chapter-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])")

        # Tab through all focusable elements inside modal
        for _ in range(10):
            page.keyboard.press("Tab")
            focused_el = page.evaluate("""() => {
                const el = document.activeElement;
                return el ? el.closest('#bm-save-modal') !== null : false;
            }""")
            assert focused_el, "Focus escaped the modal after Tab"
    finally:
        ctx.close()


def test_focus_returns_after_drawer_close(browser):
    """북마크 드로어를 닫으면 포커스가 트리거 버튼으로 복귀한다."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        trigger = page.locator(".title-bookmark-btn")
        trigger.click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")

        page.keyboard.press("Escape")
        page.wait_for_selector("#bookmark-drawer", state="hidden", timeout=2_000)
        page.wait_for_timeout(200)

        focused_el = page.evaluate("""() => {
            const el = document.activeElement;
            return el ? (el.className || '').includes('title-bookmark-btn') : false;
        }""")
        assert focused_el, "Focus should return to .title-bookmark-btn after drawer close"
    finally:
        ctx.close()


# ── 전례독서 뷰 (ADR-038 §3) ──────────────────────────────────────────────────

def test_lectionary_chips_are_keyboard_reachable(browser):
    """관측일 칩이 Tab 순서에 있고 Enter 로 이동한다(모두 링크). 세그먼트의 키보드는 같은 링크 꼴 — 칩으로 대표한다."""
    ctx, page = _open(browser, "lectionary/2026-09-16")
    try:
        page.wait_for_selector(".lectionary .lect-chip", timeout=20_000)
        page.locator(".lect-chip").first.focus()
        assert _focused(page) == "a"
        page.keyboard.press("Tab")
        assert page.evaluate("() => document.activeElement.classList.contains('lect-chip')")
        assert page.evaluate("() => document.activeElement.textContent") == "추계재"
        page.keyboard.press("Enter")
        page.wait_for_url("**obs=t-*")
        page.wait_for_selector(".lect-chip:has-text('추계재')")
        # 고른 칩은 aria-current 로 읽힌다.
        assert page.locator(".lect-chip", has_text="추계재").get_attribute("aria-current") == "true"
    finally:
        ctx.close()


# ── 다시 그린 뒤 포커스 — 라우터가 돌려준다(ADR-031 §5) · 「본문 바로가기」 ──────────

def _focus_key(page):
    """지금 포커스의 data-focus-key 와 :focus-visible."""
    return page.evaluate("""() => { const a = document.activeElement;
        return { key: a?.dataset?.focusKey || null, visible: !!a?.matches(':focus-visible') }; }""")


def _mark_focused_for_redraw(page):
    """포커스된 컨트롤에 표지를 단다 — 같은 주소를 다시 그렸는지(옛 노드가 사라졌는지) 기다리는 데 쓴다."""
    page.evaluate("() => { document.activeElement.dataset.probe = 'old'; }")


def test_division_tab_redraw_keeps_keyboard_focus_on_the_pressed_tab(browser):
    """구분 탭(구약 · 외경 · 신약)을 Enter 로 누르면 route() 가 탭 줄과 목록을 통째로 다시 그린다 — 그전엔 누른 탭이 사라져
    포커스가 body 로 빠졌다(main 부터, known-issues §10). 탭 줄은 #app 밖(머리 · sticky)이고 목록은 await 뒤에 그려져 화면마다
    다는 방식으로는 못 덮던 곳 — 라우터가 새 탭 줄의 같은 탭으로 돌려준다. 같은 주소(지금 탭)를 다시 눌러도 같다."""
    ctx, page = _open(browser, "old_testament")
    try:
        page.wait_for_selector("#division-tabs-slot .division-tab.active", timeout=20_000)
        page.locator("#division-tabs-slot .division-tab", has_text="신약").focus()
        page.keyboard.press("Enter")
        page.wait_for_url("**/new_testament")
        page.wait_for_selector("#division-tabs-slot .division-tab.active:has-text('신약')")
        assert _focus_key(page) == {"key": "div:new_testament", "visible": True}
        _mark_focused_for_redraw(page)
        page.keyboard.press("Enter")   # 지금 탭 — 같은 주소라 route() 만 다시 돈다
        page.wait_for_function("() => !document.querySelector('[data-probe=old]')")
        page.wait_for_selector("#division-tabs-slot .division-tab.active:has-text('신약')")
        assert _focus_key(page) == {"key": "div:new_testament", "visible": True}
    finally:
        ctx.close()


def test_search_page_links_keep_keyboard_focus_on_the_pressed_link(browser):
    """검색 결과의 「다음 →」을 Enter 로 누르면 새 페이지에서도 그 링크에 포커스가 남는다(사용자 결정 2026-10-17 — 결과 목록
    맨 위로 보내는 안 대신; 전례독서의 「다음날」과 같은 규칙). 마지막 쪽에는 「다음 →」이 없어 「← 이전」이 넘겨받는다."""
    ctx, page = _open(browser, "search?q=사랑")
    try:
        page.wait_for_selector(".search-pagination", timeout=20_000)
        total = int(page.inner_text(".search-page-info").split("/")[1])
        assert total >= 3, total
        page.locator(".search-pagination a[data-focus-key='page:next']").focus()
        page.keyboard.press("Enter")
        page.wait_for_url("**page=2")
        page.wait_for_function("() => document.querySelector('.search-page-info')?.textContent.startsWith('2 /')")
        assert _focus_key(page) == {"key": "page:next", "visible": True}
        # 포커스가 「다음 →」에 남으므로 몇 쪽인지는 라이브 영역이 말로 알린다(「2/5」는 분수로 읽힐 수 있다) — 한 번, polite
        page.wait_for_function(f"() => document.getElementById('a11y-announce').textContent.endsWith('전체 {total}쪽 중 2쪽')")
        # 결과 건수 줄은 제목 — 포커스를 「다음 →」에 둔 채 제목 이동(VoiceOver 로터 · TalkBack)으로 새 결과 첫머리에 간다
        assert page.evaluate("() => document.querySelector('.search-count').tagName") == "H2"
        # 마지막 쪽으로 — 누른 「다음 →」이 새 페이지에 없다
        page.goto(f"{BASE}/search?q=사랑&page={total - 1}")
        page.wait_for_function(f"() => document.querySelector('.search-page-info')?.textContent.startsWith('{total - 1} /')")
        page.locator(".search-pagination a[data-focus-key='page:next']").focus()
        page.keyboard.press("Enter")
        page.wait_for_function(f"() => document.querySelector('.search-page-info')?.textContent.startsWith('{total} /')")
        assert page.locator(".search-pagination a[data-focus-key='page:next']").count() == 0
        assert _focus_key(page) == {"key": "page:prev", "visible": True}
    finally:
        ctx.close()


def test_skip_link_moves_focus_into_main_without_redrawing(browser):
    """「본문 바로가기」(#app)는 라우트가 아니다 — 포커스가 본문(<main id=app>)으로 가고 주소 · 화면은 그대로다(known-issues §5 —
    그전엔 전역 <a> 인터셉터가 route()를 불러 같은 화면을 다시 그리기만 하고 포커스는 본문으로 가지 않았다). 다음 Tab은 본문 안.
    본문 영역은 이름이 없다 — 하나뿐인 main 랜드마크라 역할로 충분하고, 「성경 본문」이 모든 화면에서 읽혔다(DESIGN.md §10, 2026-10-17)."""
    ctx, page = _open(browser, "john/3")
    try:
        page.wait_for_selector("#app .verse", timeout=20_000)
        assert page.evaluate("() => document.getElementById('app').getAttribute('aria-label')") is None
        assert page.evaluate("() => document.querySelectorAll('main, [role=main]').length") == 1
        url_before = page.url
        seq_before = page.evaluate("() => window.routeSeq()")
        # UI 글자라 산세리프 — body의 serif(성서 본문)를 물려받았다(PR #355 리뷰 — main부터)
        font = page.evaluate("() => getComputedStyle(document.querySelector('.skip-link')).fontFamily")
        assert "Noto Sans KR" in font and "Serif" not in font, font
        page.locator(".skip-link").focus()
        page.keyboard.press("Enter")
        assert page.evaluate("() => document.activeElement.id") == "app"
        page.wait_for_timeout(300)   # route() 가 불렸다면 그사이 다시 그렸을 것
        assert page.evaluate("() => window.routeSeq()") == seq_before, "route() 를 부르지 않는다"
        assert page.url == url_before, "주소에 #app 이 붙지 않는다"
        page.keyboard.press("Tab")
        assert page.evaluate("""() => { const a = document.activeElement;
            return a.id !== 'app' && document.getElementById('app').contains(a); }""")
    finally:
        ctx.close()


# ── verse select Escape ───────────────────────────────────────────────────────

def test_verse_select_cancel_btn_exits_mode(browser):
    """절 선택 모드 진입(enterVerseSelectMode) → 취소 버튼 클릭 → bar 숨김."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse")

        page.evaluate("() => enterVerseSelectMode('gen', 1)")
        page.wait_for_selector("#verse-select-bar:not([hidden])", timeout=2_000)

        page.locator("#verse-select-cancel-btn").click()
        page.wait_for_selector("#verse-select-bar", state="hidden", timeout=2_000)
    finally:
        ctx.close()
