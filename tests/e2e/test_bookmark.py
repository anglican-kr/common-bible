"""E2E: bookmark drawer — open from chapter header, save whole chapter, list updates."""

import json

from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT, IPHONE_UA

BASE = "http://localhost:8080"


def _open_chapter_and_wait(page, path: str) -> None:
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(200)


def test_bookmark_drawer_opens_shows_empty_state(browser):
    """Header bookmark button opens drawer; empty list message is shown."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script(
        "localStorage.removeItem('bible-bookmarks');"
    )
    _open_chapter_and_wait(page, "gen/1")

    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    expect_title = page.locator("#bookmark-drawer-title")
    assert expect_title.inner_text() == "북마크"
    assert "저장된 북마크가 없습니다" in page.inner_text("#bookmark-drawer-body")

    ctx.close()


def test_save_chapter_bookmark_appears(browser):
    """Save current chapter; bookmark row appears in the drawer."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script(
        "localStorage.removeItem('bible-bookmarks');"
    )
    _open_chapter_and_wait(page, "gen/1")

    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    page.locator("#bm-save-chapter-btn").click()
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.locator("#bm-label-input").fill("E2E 창세기 1장")
    page.locator("#bm-save-modal .bm-btn-primary").click()
    page.locator("#bm-save-modal").wait_for(state="hidden")

    row = page.locator(".bm-bookmark-link", has_text="E2E 창세기 1장")
    assert row.count() == 1

    # Verify via syncStoreV2 (v2 store)
    store = page.evaluate("() => window.syncStoreV2.loadBookmarks()")
    assert any(
        it.get("type") == "bookmark"
        and it.get("bookId") == "gen"
        and it.get("chapter") == 1
        and it.get("label") == "E2E 창세기 1장"
        for it in store
    )

    ctx.close()


def test_bm_empty_msg_disappears_after_save(browser):
    """빈 드로어의 '저장된 북마크가 없습니다' 메시지는 북마크 추가 후 사라진다.

    role='presentation'을 단 공용 빈 상태(li.empty-state, ADR-032)가
    시각적·기능적으로 올바르게 동작하는지 확인한다.
    """
    from .conftest import CLEAR_APP_STORAGE
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    _open_chapter_and_wait(page, "gen/1")

    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    # Empty state visible
    assert "저장된 북마크가 없습니다" in page.inner_text("#bookmark-drawer-body")
    assert page.locator("li.empty-state").count() == 1
    assert page.locator("li.bm-bookmark").count() == 0

    # Save a bookmark
    page.locator("#bm-save-chapter-btn").click()
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    page.locator("#bm-save-modal .bm-btn-primary").click()
    page.wait_for_selector("#bm-save-modal", state="hidden")
    page.wait_for_selector("li.bm-bookmark")

    # Empty state gone, bookmark item visible
    assert page.locator("li.empty-state").count() == 0
    assert page.locator("li.bm-bookmark").count() == 1

    ctx.close()


def test_save_after_drawer_close_uses_current_chapter_not_stale(browser):
    """Regression: opening the drawer at gen/1 then closing it must not poison
    a later save flow for a different chapter (john/3) into asking to merge
    with the gen/1 bookmark."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()

    # 1) Seed an existing Genesis 1 bookmark in the v2 store.
    _open_chapter_and_wait(page, "gen/1")
    seed = [{
        "type": "bookmark", "id": "bm-seed-gen1",
        "bookId": "gen", "chapter": 1,
        "label": "창세 1장 (시드)", "verseSpec": "all",
    }]
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(seed)})")

    # 2) Open drawer at gen/1, then close it.
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")
    page.locator("#bookmark-drawer-close").click()
    page.wait_for_selector("#bookmark-drawer", state="hidden")

    # 3) Navigate to a different chapter where no bookmark exists yet.
    _open_chapter_and_wait(page, "john/3")

    # 4) Enter verse-select for john/3 and pick verse 1, then tap save.
    page.evaluate("() => enterVerseSelectMode('john', 3)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.click("#v1")
    assert not page.locator("#verse-select-bookmark-btn").is_disabled()
    page.click("#verse-select-bookmark-btn")

    # 5) The save modal must open directly. The merge dialog must NOT appear,
    #    because there is no existing john/3 bookmark.
    page.wait_for_selector("#bm-save-modal:not([hidden])", timeout=2_000)
    assert page.locator("#bm-merge-modal").is_hidden(), \
        "merge dialog should not appear for a chapter with no existing bookmark"

    # The pre-filled label should reference John 3:1, not Genesis 1.
    label = page.locator("#bm-label-input").input_value()
    assert "3:1" in label or "3장" in label, \
        f"label should reference john 3, got: {label!r}"

    ctx.close()


def test_select_verses_button_preserves_chapter_after_drawer_close(browser):
    """Regression: drawer's '절 선택' button closes the drawer and enters
    verse-select mode. The drawer-close path now nulls _bookmarkDrawer{Book,Chapter},
    so the click handler must capture coords *before* closing."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()

    _open_chapter_and_wait(page, "gen/1")
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    page.locator("#bm-select-verses-btn").click()

    # Drawer closes, verse-select bar appears, and the bar must reflect gen/1
    # — i.e. readingContext.{bookId,chapter} are not clobbered to null.
    page.wait_for_selector("#bookmark-drawer", state="hidden")
    page.wait_for_selector("#verse-select-bar:not([hidden])")

    state = page.evaluate(
        "() => ({ book: window.readingContext.bookId,"
        "         chapter: window.readingContext.chapter,"
        "         mode: window.readingContext.verseSelectMode })"
    )
    assert state["mode"] is True, "verse-select mode should be active"
    assert state["book"] == "gen" and state["chapter"] == 1, \
        f"current chapter must remain gen/1, got: {state!r}"

    ctx.close()


def test_mobile_header_bookmark_when_absent_opens_save_modal(browser):
    """모바일: 북마크가 없는 장에서는 헤더 아이콘이 저장 모달을 연다(토글 add)."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        _open_chapter_and_wait(page, "gen/1")
        page.locator(".title-bookmark-btn").click()
        page.wait_for_selector("#bm-save-modal:not([hidden])", timeout=2_000)
        assert page.locator("#bm-confirm-modal").is_hidden()
    finally:
        ctx.close()


def test_drawer_bookmark_link_navigates_and_closes_drawer(browser):
    """드로어에서 북마크 행을 누르면 그 장으로 이동하고 드로어가 닫힌다.

    회귀 검사: tree.js의 링크 클릭 핸들러가 주입된 closeBookmarkDrawer() + navigate()
    + markBookmarkViewed/_bookmarkHref(core) 를 호출하는 모듈 간 경로. 다른 e2e 는 링크의
    *존재*만 확인하고 클릭→내비를 구동하지 않는다.
    """
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_chapter_and_wait(page, "gen/2")
    # Seed a gen/1 whole-chapter bookmark (so the drawer lists it).
    page.evaluate(
        "() => window.syncStoreV2.saveBookmarks(["
        "{type:'bookmark', id:'b1', bookId:'gen', chapter:1, label:'창세기 1장', verseSpec:'all'}"
        "])"
    )
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    page.locator(".bm-bookmark-link", has_text="창세기 1장").click()

    # Navigated to gen/1 and the drawer dismissed (the injected closeBookmarkDrawer).
    page.wait_for_url("**/gen/1")
    assert page.url.rstrip("/").endswith("/gen/1")
    page.wait_for_selector("#bookmark-drawer[hidden]")
    ctx.close()


def test_drawer_tree_keyboard_navigation(browser):
    """드로어 트리: ArrowRight 로 폴더 펼침, ArrowDown 으로 다음 treeitem 포커스 이동.

    tree.js 의 드로어 body keydown 핸들러(roving tabindex)를 검증한다 — 어떤 e2e 도
    트리 키보드 내비를 다루지 않았다. (펼침은 클릭이 아닌 _toggleFolder 직접 호출이라
    headless 포인터 이슈와 무관하다.)
    """
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open_chapter_and_wait(page, "gen/1")
    # A collapsed folder (folders sort first) holding one child + a root bookmark.
    page.evaluate(
        "() => window.syncStoreV2.saveBookmarks(["
        "{type:'folder', id:'f1', name:'폴더', expanded:false, children:["
        "  {type:'bookmark', id:'c1', bookId:'exo', chapter:3, label:'자식', verseSpec:'all'}]},"
        "{type:'bookmark', id:'b1', bookId:'gen', chapter:1, label:'뿌리', verseSpec:'all'}"
        "])"
    )
    page.locator(".title-bookmark-btn").click()
    page.wait_for_selector("#bookmark-drawer:not([hidden])")

    folder = page.locator("li.bm-folder[data-id='f1']")
    assert folder.get_attribute("aria-expanded") == "false"

    # Focus the folder treeitem, then ArrowRight expands it.
    folder.evaluate("el => el.focus()")
    page.keyboard.press("ArrowRight")
    assert folder.get_attribute("aria-expanded") == "true"

    # ArrowDown moves the roving focus to the next visible treeitem (the child).
    page.keyboard.press("ArrowDown")
    focused_id = page.evaluate(
        "() => document.activeElement?.closest('[role=treeitem]')?.dataset.id"
    )
    assert focused_id == "c1"
    ctx.close()


def test_merged_verse_drawn_in_lines_saves_its_range(browser):
    """여러 줄인 병합 절(나훔 1:7-8, 일곱 줄)은 「7-8」로 저장되고 이름도 「나훔 1:7-8」이다 — main은 첫 번호 「7」로
    저장했다(known-issues §17)."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    _open_chapter_and_wait(page, "nah/1")
    page.evaluate("() => enterVerseSelectMode('nah', 1)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.locator('.verse[data-vkey="7/7-8c"]').click()
    page.click("#verse-select-bookmark-btn")
    page.wait_for_selector("#bm-save-modal:not([hidden])")
    assert page.locator("#bm-label-input").input_value() == "나훔 1:7-8"
    page.locator("#bm-save-modal .bm-btn-primary").click()
    page.wait_for_selector("#bm-save-modal", state="hidden")
    store = page.evaluate("() => window.syncStoreV2.loadBookmarks()")
    assert [(b["verseSpec"], b["label"]) for b in store] == [("7-8", "나훔 1:7-8")]
    ctx.close()


def test_merge_into_pre205_bookmark_keeps_its_verses(browser):
    """옛 표기 「16aa」 북마크(옮기기 전 — 이 페이지를 연 뒤 들어온 경우)에 1절을 합치면 「1,16」 — main은 「1」이 되어
    16절이 빠졌다(2026-10-22 재현)."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    _open_chapter_and_wait(page, "isa/10")
    seed = [{"type": "bookmark", "id": "bm-old", "bookId": "isa", "chapter": 10, "verseSpec": "16aa", "label": "이사 10:16aa"}]
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(seed)})")
    page.evaluate("() => enterVerseSelectMode('isa', 10)")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    page.click("#v1")
    page.click("#verse-select-bookmark-btn")
    page.wait_for_selector("#bm-merge-modal:not([hidden])")
    page.click("#bm-merge-yes")
    page.wait_for_selector("#bm-merge-modal", state="hidden")
    store = page.evaluate("() => window.syncStoreV2.loadBookmarks()")
    assert [(b["verseSpec"], b["label"]) for b in store] == [("1,16", "이사 10:1,16")]
    ctx.close()


# 인용 칩은 절 요소의 자식이 아니라 형제다. 그래서 절의 배경을 물려받지 못한다(ADR-022 §6).
def _enter_select(browser, path: str):
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script("try { localStorage.setItem('bible-cite-coachmark-seen','1'); } catch(_) {}")
    page = ctx.new_page()
    _open_chapter_and_wait(page, path)
    book, chapter, *_ = path.split("/")
    page.evaluate(f"() => enterVerseSelectMode('{book}', {chapter})")
    page.wait_for_selector("#verse-select-bar:not([hidden])")
    return ctx, page


def _enter_select_with_chip(browser, path: str):
    ctx, page = _enter_select(browser, path)
    page.wait_for_selector(".cite-chip")
    return ctx, page


# 칩과 그 앞 절 조각의 배경, 위아래, 안쪽 모서리를 잰다. `chip` 은 `.cite-chip` 을 찾는 선택자다.
_CHIP_AND_SPAN = """async (chip) => {
  // 선택 모드의 절 배경에는 전환 효과가 있다. 끝난 뒤의 값을 잰다.
  await Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished));
  const c = document.querySelector(chip);
  const s = c.previousElementSibling;
  const box = (e) => [...e.getClientRects()].at(-1);
  const cs = getComputedStyle(c), ss = getComputedStyle(s);
  return {
    chipBg: cs.backgroundColor, spanBg: ss.backgroundColor,
    chipTop: c.getClientRects()[0].top, chipBottom: c.getClientRects()[0].bottom,
    spanTop: box(s).top, spanBottom: box(s).bottom,
    chipEndRadius: cs.borderTopRightRadius, spanEndRadius: ss.borderTopRightRadius,
    chipBottomRadius: cs.borderBottomRightRadius, spanBottomRadius: ss.borderBottomRightRadius,
  };
}"""


def test_selected_verse_background_runs_through_its_cite_chip(browser):
    """갈라 3:8은 인용 칩이 절 가운데에 있다. 고르면 칩도 절과 같은 색과 높이로 칠해지고, 선택을 해제하면 배경이 없어진다."""
    ctx, page = _enter_select_with_chip(browser, "gal/3")
    chip = '.cite-chip[data-cite-src="창세 12:3"]'

    before = page.evaluate(_CHIP_AND_SPAN, chip)
    assert before["chipBg"] == "rgba(0, 0, 0, 0)"

    page.click("#v8")
    m = page.evaluate(_CHIP_AND_SPAN, chip)
    assert m["chipBg"] == m["spanBg"]
    assert m["chipBg"] != "rgba(0, 0, 0, 0)"
    # 글자가 작아도 배경은 턱 없이 이어진다.
    assert m["chipTop"] == m["spanTop"]
    assert m["chipBottom"] == m["spanBottom"]
    # 칩 뒤에도 고른 조각이 이어지므로 안쪽 모서리는 둥글지 않다.
    assert m["chipEndRadius"] == "0px"
    assert m["spanEndRadius"] == "0px"

    page.click("#v8")
    assert page.evaluate(_CHIP_AND_SPAN, chip)["chipBg"] == "rgba(0, 0, 0, 0)"
    ctx.close()


def test_cite_chip_closes_a_selected_run_with_round_corners(browser):
    """갈라 3:6은 칩으로 끝난다. 절의 끝 모서리는 평평해지고 칩의 바깥 모서리가 둥글다."""
    ctx, page = _enter_select_with_chip(browser, "gal/3")
    page.click("#v6")

    m = page.evaluate(_CHIP_AND_SPAN, ".verse-selected + .cite-chip")
    assert m["chipBg"] == m["spanBg"]
    assert m["spanEndRadius"] == "0px"
    assert m["chipEndRadius"] != "0px"
    ctx.close()


def test_selected_poetry_verse_background_reaches_its_cite_chip(browser):
    """로마 11:8의 운문 칩은 절 아래 따로 한 줄이다. 칩과 절 사이에 빈틈이 없고 절의 아래 모서리는 평평하다."""
    ctx, page = _enter_select_with_chip(browser, "rom/11")
    page.click("#v8")

    m = page.evaluate(_CHIP_AND_SPAN, ".verse-poetry.verse-selected + .cite-chip--poetry")
    assert m["chipBg"] == m["spanBg"]
    assert m["chipTop"] == m["spanBottom"]
    assert m["spanBottomRadius"] == "0px"
    ctx.close()


def test_selected_cite_chip_label_keeps_contrast_in_dark_theme(browser):
    """어두운 테마의 선택 배경에서 회색 글자는 3.98:1로 WCAG AA에 못 미쳐 본문 글자색을 쓴다."""
    ctx, page = _enter_select_with_chip(browser, "gal/3")
    page.evaluate("() => document.documentElement.setAttribute('data-theme', 'dark')")
    page.click("#v8")

    colors = page.evaluate("""() => {
      const c = document.querySelector('.verse-selected + .cite-chip');
      return [getComputedStyle(c.querySelector('.cite-chip-label')).color, getComputedStyle(c.previousElementSibling).color];
    }""")
    assert colors[0] == colors[1]
    ctx.close()


def test_highlighted_range_covers_its_cite_chip(browser):
    """주소의 절 구간 강조(`/gal/3/8-10`)도 칩까지 칠한다."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    _open_chapter_and_wait(page, "gal/3/8-10")
    page.wait_for_selector(".verse-highlight + .cite-chip")

    m = page.evaluate(_CHIP_AND_SPAN, ".verse-highlight + .cite-chip")
    assert m["chipBg"] == m["spanBg"]
    assert m["chipBg"] != "rgba(0, 0, 0, 0)"
    assert m["chipTop"] == m["spanTop"]
    assert m["chipEndRadius"] == "0px"
    ctx.close()


def test_selected_chip_in_highlighted_range_rounds_where_selection_ends(browser):
    """`/gal/3/6-10` 에서 6절만 고르면 선택은 칩에서 끝난다. 주소 강조가 뒤로 이어져도 칩의 끝 모서리는 둥글다."""
    ctx, page = _enter_select_with_chip(browser, "gal/3/6-10")
    page.click("#v6")

    m = page.evaluate(_CHIP_AND_SPAN, ".verse-selected + .cite-chip")
    assert m["chipBg"] == m["spanBg"]
    assert m["chipEndRadius"] != "0px"
    ctx.close()


def test_selected_poetry_in_highlighted_range_rounds_where_selection_ends(browser):
    """`/ps/23/1-6` 에서 3절만 고르면 주소 강조가 앞뒤로 이어져도 선택의 위아래 끝 모서리는 둥글다."""
    ctx, page = _enter_select(browser, "ps/23/1-6")
    page.click("#v3")

    corners = page.evaluate("""async () => {
      await Promise.all(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished));
      const spans = [...document.querySelectorAll('.verse-selected')];
      return [getComputedStyle(spans[0]).borderTopLeftRadius, getComputedStyle(spans.at(-1)).borderBottomRightRadius];
    }""")
    assert corners[0] != "0px"
    assert corners[1] != "0px"
    ctx.close()
