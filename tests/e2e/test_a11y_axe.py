"""E2E: 접근성 — axe-core 자동 스캔 (WCAG 2.1 AA).

핵심 화면별로 axe-core를 실행해 critical·serious 위반 0건을 기대한다.
위반이 있으면 rule id·영향도·요소 셀렉터를 출력해 진단을 쉽게 한다.
"""
import json

import pytest

# 선택적 의존성 — 없으면 이 파일만 skip 한다. 그냥 import 하면 ImportError 가
# 수집 오류가 되어 스위트 전체가 중단된다(다른 26파일까지 안 돈다).
Axe = pytest.importorskip(
    "axe_playwright_python.sync_playwright",
    reason="pip install axe-playwright-python",
).Axe
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


def test_a11y_lectionary_view(browser):
    """전례독서 뷰(부활대축일 — 본기도 번호 · 독서 넷) — critical/serious 위반 0건."""
    ctx, page = _open(browser, "lectionary/2026-04-05")
    try:
        page.wait_for_selector(".lectionary .lect-reading[data-slot='gospel'] .verse", timeout=20_000)
        v = _violations(page)
        assert not v, f"Lectionary: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_lectionary_alternate_colours(browser):
    """전례독서 뷰(대림 3주일 — 대체 장미색 · 청색 라벨) — critical/serious 위반 0건(대비 — 자체 리뷰 2026-10-13)."""
    ctx, page = _open(browser, "lectionary/2026-12-13")
    try:
        page.wait_for_selector(".lectionary .lect-color-item--alt", timeout=20_000)
        v = _violations(page)
        assert not v, f"Lectionary alt colours: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_lectionary_switcher(browser):
    """전례독서 뷰(8.9 주일 — 옮겨 지킬 수 있는 주의 변모의 전례독서 목록) — critical/serious 위반 0건."""
    ctx, page = _open(browser, "lectionary/2026-08-09")
    try:
        page.wait_for_selector(".lectionary .lect-choice", timeout=20_000)
        v = _violations(page)
        assert not v, f"Lectionary pair: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_calendar_list(browser):
    """캘린더 목록(2026년 12월 — 줄 · 상단 바의 전환 단추) — critical/serious 위반 0."""
    ctx, page = _open(browser, "calendar/list/2026-12-07")
    try:
        page.wait_for_selector(".cal-rows", timeout=20_000)
        v = _violations(page)
        assert not v, f"Calendar list: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_calendar_month(browser):
    """캘린더 월간 표(2026년 11월 — 「나해」 표지 · 앞뒤 달 칸 · 데스크톱 헤더 입구) — critical/serious 위반 0건."""
    ctx, page = _open(browser, "calendar/2026-11")
    try:
        page.wait_for_selector(".calendar .cal-grid .cal-mark", timeout=20_000)
        v = _violations(page)
        assert not v, f"Calendar: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_calendar_mobile(browser):
    """캘린더 모바일(월간 주소가 여는 목록, 달력 아이콘, 탭 바 넷째 탭. ADR-058 §1) — critical/serious 위반 0건."""
    from .conftest import IPHONE_UA, MOBILE_VIEWPORT
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA, is_mobile=True, has_touch=True)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/calendar/2026-09")
        page.wait_for_selector(".calendar .cal-rows", timeout=20_000)
        page.wait_for_selector("#tab-bar [data-tab='calendar'][aria-current='page']")
        v = _violations(page)
        assert not v, f"Calendar mobile: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_calendar_month_touch(browser):
    """캘린더 월간 표, 큰 화면의 터치 기기(2026년 9월 — 사계재 자 · 백 점) — critical/serious 위반 0건."""
    from .conftest import IPHONE_UA
    ctx = browser.new_context(viewport={"width": 1024, "height": 768}, user_agent=IPHONE_UA, is_mobile=True, has_touch=True)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/calendar/2026-09")
        page.wait_for_selector(".calendar .cal-grid", timeout=20_000)
        v = _violations(page)
        assert not v, f"Calendar month (touch): {len(v)} violation(s):\n{_fmt(v)}"
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


@pytest.mark.parametrize("viewport", [{"width": 1280, "height": 800}, {"width": 390, "height": 844}], ids=["desktop", "mobile"])
def test_a11y_search_failure(browser, viewport):
    """검색이 결과를 받지 못한 화면(ADR-048 §6) — 결과 자리의 실패 화면과, 휴대폰이면 위쪽 입력창과 책 알약. critical/serious 위반 0건."""
    ctx = browser.new_context(service_workers="block", viewport=viewport)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.route("**/data/search-meta.json", lambda route: route.fulfill(status=500, body="boom"))
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/search?q=%EC%82%AC%EB%9E%91&in=john")  # 사랑, 요한
        page.wait_for_selector("#app .empty-state-title", timeout=20_000)
        v = _violations(page)
        assert not v, f"Search failure: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_search_local_days(browser):
    """지역 축일 안내 카드(고르는 단추, 교회 목록)와 지역 축일 줄(ADR-044 §3) — critical/serious 위반 0건. 관구설립일 줄은 소속교회 없이도 나온다."""
    ctx, page = _open(browser, "search?q=%EC%9A%A9%EC%9D%B8%EC%84%B1%EB%8B%B9")  # 용인성당, 소속교회 없음
    try:
        page.wait_for_selector(".search-local-note button", timeout=10_000)
        v = _violations(page)
        assert not v, f"Local notice: {len(v)} violation(s):\n{_fmt(v)}"
        page.goto(page.url.split("/search")[0] + "/search?q=%EC%B6%95%EC%84%B1%EC%9D%BC")  # 축성일: 카드 안의 교회 목록
        page.wait_for_function("() => { const s = document.querySelector('#search-local-church'); return s && !s.disabled; }", timeout=10_000)
        v = _violations(page)
        assert not v, f"Local notice list: {len(v)} violation(s):\n{_fmt(v)}"
        page.goto(page.url.split("/search")[0] + "/search?q=%EC%84%A4%EB%A6%BD%EC%9D%BC")  # 설립일
        page.wait_for_selector(".lect-rows a.cal-row", timeout=10_000)
        v = _violations(page)
        assert not v, f"Local rows: {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()


def test_a11y_calendar_date_picker(browser):
    """캘린더 날짜 고르기(ADR-038 §2, ADR-058 §3): 작은 화면 목록의 날 판(내려오는 달력, 전례색 점)과 해 판, 월간의 달 판(팝오버) — critical/serious 위반 0건.
    판은 요소의 click()으로 연다. Playwright의 click은 누르기 전에 상단 바 안의 단추를 화면 안으로 스크롤한다(test_calendar_view.py `_press`)."""
    from .conftest import IPHONE_UA, MOBILE_VIEWPORT
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        page.goto(f"{BASE}/calendar/list/2027-02-01")
        page.wait_for_selector(".cal-rows", timeout=20_000)
        page.evaluate("() => document.querySelector('.cal-picker-trigger').click()")
        page.wait_for_selector(".cal-picker:not([hidden]) .cal-picker-bar")
        page.wait_for_timeout(400)
        v = _violations(page, context=".cal-picker")
        assert not v, f"Date picker (days): {len(v)} violation(s):\n{_fmt(v)}"
        page.evaluate("() => { const t = document.querySelector('.cal-picker button.cal-picker-title'); t.click(); t.click(); }")
        page.wait_for_selector(".cal-picker button[data-year]")
        v = _violations(page, context=".cal-picker")
        assert not v, f"Date picker (years): {len(v)} violation(s):\n{_fmt(v)}"
    finally:
        ctx.close()
    ctx, page = _open(browser, "calendar/2026-11")
    try:
        page.wait_for_selector(".calendar .cal-grid", timeout=20_000)
        page.evaluate("() => document.querySelector('.cal-title-btn').click()")
        page.wait_for_selector(".cal-picker:not([hidden]) .cal-picker-cell")
        v = _violations(page, context=".cal-picker")
        assert not v, f"Date picker (months, popover): {len(v)} violation(s):\n{_fmt(v)}"
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
