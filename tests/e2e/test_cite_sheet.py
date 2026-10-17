"""E2E: 인용(cite) 바텀 시트 — 열기/닫기·Escape·포커스 복귀.

ADR-022 인용 시트의 생명주기가 ADR-032 공용 오버레이 컨트롤러로 이행된 뒤에도
칩 클릭 → 시트 열림, 닫기 버튼/Escape → 닫힘 + 포커스 복귀가 유지되는지 검증한다.
마태 16장에 실제 cite 칩(시편 62:12 · 잠언 24:12)이 있어 그 장으로 진입한다.
"""
from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"

# 첫 인용 상호작용 시 뜨는 코치마크 배너가 클릭을 가리지 않도록 미리 본 것으로 표시.
_COACHMARK_SEEN = "try { localStorage.setItem('bible-cite-coachmark-seen','1'); } catch(_) {}"


def _open_chapter(browser, path="matt/16"):
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_COACHMARK_SEEN)
    page = ctx.new_page()
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(".cite-chip", timeout=10_000)
    return ctx, page


def _sheet_open(page) -> bool:
    return page.evaluate(
        "() => { const s = document.getElementById('cite-sheet');"
        " return !!s && !s.hidden && document.documentElement.classList.contains('cite-sheet-open'); }"
    )


def test_cite_chip_opens_sheet(browser):
    """cite 칩을 누르면 인용 시트가 열리고 <html>에 cite-sheet-open 클래스가 붙는다."""
    ctx, page = _open_chapter(browser)
    try:
        page.click(".cite-chip")
        page.wait_for_selector("#cite-sheet:not([hidden])", timeout=8_000)
        assert _sheet_open(page)
    finally:
        ctx.close()


def test_cite_sheet_close_button_restores_focus(browser):
    """닫기 버튼 → 시트가 닫히고 클래스가 제거되며 포커스가 원래 칩으로 복귀한다."""
    ctx, page = _open_chapter(browser)
    try:
        page.click(".cite-chip")
        page.wait_for_selector("#cite-sheet:not([hidden])", timeout=8_000)
        page.click("#cite-sheet-close")
        page.wait_for_function(
            "() => { const s = document.getElementById('cite-sheet'); return !!s && s.hidden; }",
            timeout=8_000,
        )
        assert not _sheet_open(page)
        # 포커스가 시트를 연 칩으로 돌아왔는지 (controller returnFocus).
        focused_is_chip = page.evaluate(
            "() => !!document.activeElement && document.activeElement.classList.contains('cite-chip')"
        )
        assert focused_is_chip
    finally:
        ctx.close()


def test_cite_sheet_escape_closes(browser):
    """compact 뷰에서 Escape → 시트가 닫힌다 (커스텀 2단계 Escape의 닫기 단계)."""
    ctx, page = _open_chapter(browser)
    try:
        page.click(".cite-chip")
        page.wait_for_selector("#cite-sheet:not([hidden])", timeout=8_000)
        page.keyboard.press("Escape")
        page.wait_for_function(
            "() => { const s = document.getElementById('cite-sheet'); return !!s && s.hidden; }",
            timeout=8_000,
        )
        assert not _sheet_open(page)
    finally:
        ctx.close()


def test_cite_sheet_dismissed_instantly_on_navigation(browser):
    """내비게이션(route) 시 인용 시트는 슬라이드 잔류 없이 즉시 사라진다.

    closeTransition 의 지연 hide(애니메이션 끝까지 panel.hidden 보류)가 다음
    화면 위에 남지 않도록, route() 가 동기적으로 hidden 을 강제하는지 검증한다
    (ADR-032; Cursor Bugbot "Cite sheet survives route mid-close").
    """
    ctx, page = _open_chapter(browser)
    try:
        page.click(".cite-chip")
        page.wait_for_selector("#cite-sheet:not([hidden])", timeout=8_000)
        # navigate() 는 route() 를 동기 호출하고, route() 의 동기 구간이 시트를
        # 강제로 hidden 처리한다 — 같은 JS 프레임에서 hidden 을 읽어 잔류 여부 확인.
        hidden_now = page.evaluate(
            "() => { window.navigate('/matt/17');"
            " return document.getElementById('cite-sheet').hidden; }"
        )
        assert hidden_now is True
    finally:
        ctx.close()


def test_cite_sheet_back_button_draws_the_shared_chevron(browser):
    """「› 더 보기」로 인용 하나를 펼치면 머리의 뒤로 단추가 보이고, 그 꺾쇠는 머리 아이콘 규격 하나(helpers.js headerIcon ·
    HEADER_ICON_PATHS.back)에서 온다 — index.html 의 정적 사본을 지웠다(known-issues §10). 단추를 누르면 목록으로 돌아가 숨는다."""
    ctx, page = _open_chapter(browser)
    try:
        page.click(".cite-chip")
        page.wait_for_selector("#cite-sheet:not([hidden])", timeout=8_000)
        assert page.locator("#cite-sheet-back").is_hidden()
        page.click(".cite-sheet-ref-expand >> nth=0")
        page.wait_for_selector("#cite-sheet-back:not([hidden])", timeout=8_000)
        icon = page.evaluate("""() => {
            const svgs = document.querySelectorAll('#cite-sheet-back svg');
            const path = svgs[0]?.querySelector('path');
            return { count: svgs.length, cls: svgs[0]?.getAttribute('class'), d: path?.getAttribute('d'),
                     width: path?.getAttribute('stroke-width'), same: path?.getAttribute('d') === window.appHelpers.HEADER_ICON_PATHS.back };
        }""")
        assert icon == {"count": 1, "cls": "title-back-icon", "d": "M15.5 5 8.5 12l7 7", "width": "2", "same": True}, icon
        page.click("#cite-sheet-back")
        page.wait_for_selector("#cite-sheet-back[hidden]", state="attached", timeout=8_000)
        # 다시 목록 — 본문은 비동기로 다시 그린다(_renderSheetBody), 단추는 그 전에 숨는다
        page.wait_for_selector(".cite-sheet-ref-expand", timeout=8_000)
    finally:
        ctx.close()
