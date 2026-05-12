"""E2E: 접근성 — axe-core 자동 스캔 (WCAG 2.1 AA).

핵심 화면별로 axe-core를 실행해 critical·serious 위반 0건을 기대한다.
위반이 있으면 rule id·영향도·요소 셀렉터를 출력해 진단을 쉽게 한다.
"""
import json
from axe_playwright_python.sync_playwright import Axe
from .conftest import CLEAR_APP_STORAGE, open_settings

BASE = "http://localhost:8080"
AXE = Axe()

# Run only rules at these impact levels (critical/serious).
# moderate/minor는 별도 백로그로 관리한다.
_CRITICAL_IMPACTS = {"critical", "serious"}


def _violations(page, *, context=None) -> list[dict]:
    """axe-core를 실행하고 critical/serious 위반만 반환한다."""
    results = AXE.run(page, context=context)
    # axe-playwright-python 0.1.7+ returns response as dict directly
    data = results.response if isinstance(results.response, dict) else json.loads(results.response)
    return [
        v for v in data.get("violations", [])
        if v.get("impact") in _CRITICAL_IMPACTS
    ]


def _fmt(violations: list[dict]) -> str:
    lines = []
    for v in violations:
        nodes = "; ".join(
            n["target"][0] if n.get("target") else "?"
            for n in v.get("nodes", [])[:3]
        )
        lines.append(f"  [{v['impact']}] {v['id']}: {nodes}")
    return "\n".join(lines)


def _open(browser, path="", *, block_sw=False):
    ctx = browser.new_context(service_workers="block" if block_sw else None)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    url = f"{BASE}/{path}".rstrip("/") or BASE
    page.goto(url)
    page.wait_for_selector("#search-input")
    return ctx, page


# ── 화면별 스캔 ───────────────────────────────────────────────────────────────

def test_a11y_home_books_list(browser):
    """홈 화면(책 목록) — critical/serious 위반 0건."""
    ctx, page = _open(browser)
    try:
        page.wait_for_selector(".book-list")
        v = _violations(page)
        assert not v, f"Home: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_chapter_text(browser):
    """본문 화면(요한복음 3장) — critical/serious 위반 0건."""
    ctx, page = _open(browser, "john/3")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        v = _violations(page)
        assert not v, f"Chapter: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_search_results(browser):
    """검색 결과 화면 — critical/serious 위반 0건."""
    ctx, page = _open(browser)
    try:
        page.fill("#search-input", "사랑")
        page.press("#search-input", "Enter")
        page.wait_for_selector(".search-result-item", timeout=8_000)
        v = _violations(page)
        assert not v, f"Search: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_bookmark_drawer(browser):
    """북마크 드로어 (북마크 있는 상태) — critical/serious 위반 0건."""
    import json as _json
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        bm = {"type": "bookmark", "id": "bm-axe", "bookId": "gen",
              "chapter": 1, "label": "창세기 1장", "verseSpec": "all"}
        page.evaluate(f"() => window.syncStoreV2.saveBookmarks({_json.dumps([bm])})")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        page.wait_for_selector("li.bm-bookmark")
        v = _violations(page, context="#bookmark-drawer")
        assert not v, f"Bookmark drawer: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_settings_popover(browser):
    """설정 팝오버 — critical/serious 위반 0건."""
    ctx, page = _open(browser)
    try:
        open_settings(page)
        v = _violations(page, context=".settings-popover")
        assert not v, f"Settings: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_bm_save_modal(browser):
    """북마크 저장 모달 — critical/serious 위반 0건."""
    ctx, page = _open(browser, "gen/1")
    try:
        page.wait_for_selector("article.chapter-text .verse")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bookmark-drawer:not([hidden])")
        page.locator("#bm-save-chapter-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])")
        v = _violations(page, context="#bm-save-modal")
        assert not v, f"Save modal: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_drive_disconnect_modal(browser):
    """Drive 연결 해제 모달 — critical/serious 위반 0건."""
    ctx, page = _open(browser)
    try:
        page.evaluate("openDriveDisconnectModal()")
        page.wait_for_selector("#drive-disconnect-modal:not([hidden])")
        v = _violations(page, context="#drive-disconnect-modal")
        assert not v, f"Disconnect modal: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()
