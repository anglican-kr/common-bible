"""E2E: 전례시편·송가 계응 조판 렌더 (ADR-039 저장 → ADR-038 A2 표시).

저장 형식에는 전례 글리프가 없다(자판 입력이 어려워서) — ◯·¶·"(N)" 은 렌더가 복원한다.
여기서 검증하는 것:

  ① 계응 — 응답 반행 구분 + 선창 끝 ◯
  ② 무번호 후속 구절(¶) — 번호를 물려받아 같은 number 가 둘이 되는 절이 **유실되지 않는가**
  ③ 부(部) — 인쇄본 그대로 "(N)" 소제목
  ④ 절 인스턴스 식별 — 같은 번호의 여러 절이 각자 유일한 DOM id 로 렌더되는가
     (에스델 추가 본문·교차참조 절 포함)
  ⑤ 발췌 렌더·일반 성서 장 무회귀

②·④ 는 종전 결함의 회귀 시험이다 — 절 식별 키가 number 뿐이어서 전례시편 ¶ 구절과
에스델 추가 본문이 화면에서 조용히 사라졌다(77개 장·130절, 2026-07-13 실측).
"""
import json

BASE = "http://localhost:8080"

_LPS23_BOOKMARK = [{
    "type": "bookmark", "id": "bm-lps23", "bookId": "lps", "chapter": 23,
    "label": "전례시편 23편", "verseSpec": "all",
}]


def _open(page, path):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(150)


# ── ① 계응 · ② 무번호 구절 ──

def test_전례시편_계응과_무번호_구절이_모두_렌더된다(desktop_context):
    page = desktop_context.new_page()
    _open(page, "lps/23")

    # 23편은 번호 절 6개 + ¶ 구절 1개. ¶ 구절은 번호가 없으므로 verse-num 이 아니다.
    assert page.locator(".verse .verse-num").count() == 6
    assert page.locator(".versicle-mark").count() == 1
    # 계응: 절마다 응답 반행 하나 + 선창 끝 ◯ 하나.
    assert page.locator(".verse-response").count() == 7
    assert page.locator(".responsory-mark").count() == 7
    # 종전엔 ¶ 구절이 4절과 같은 번호라 렌더에서 유실됐다.
    assert "걱정할 것 없어라" in page.inner_text("article.chapter-text")


def test_무번호_구절이_번호_절과_다른_id를_받는다(desktop_context):
    page = desktop_context.new_page()
    _open(page, "lps/23")
    ids = page.eval_on_selector_all(
        "article.chapter-text .verse[id]", "els => els.map(e => e.id)")
    assert len(ids) == len(set(ids)), f"DOM id 중복: {ids}"
    assert "v4" in ids and "v4_v" in ids, ids


def test_송가도_계응_표기를_받는다(desktop_context):
    page = desktop_context.new_page()
    _open(page, "cant/1")
    assert page.locator(".responsory-mark").count() > 0
    assert page.locator(".verse-response").count() > 0


# ── ③ 부(部) ──

def test_긴_시편의_부는_인쇄본_그대로_N으로_표시된다(desktop_context):
    page = desktop_context.new_page()
    _open(page, "lps/105")
    labels = page.eval_on_selector_all(
        ".psalm-section", "els => els.map(e => e.textContent.trim())")
    assert labels[:2] == ["(1)", "(2)"], labels


# ── ④ 절 인스턴스 식별 ──

def test_에스델_추가_본문이_모두_렌더된다(desktop_context):
    """그리스어 에스델 추가 본문은 전부 number=17 아래에 있다 (ADR-003 alt_ref)."""
    page = desktop_context.new_page()
    _open(page, "esth/4")
    ids = page.eval_on_selector_all(
        "article.chapter-text .verse[id]", "els => els.map(e => e.id)")
    assert len(ids) == len(set(ids)), f"DOM id 중복: {len(ids) - len(set(ids))}건"
    assert len(ids) >= 40, f"절 시작 span {len(ids)}개 — 추가 본문이 유실됐다"


def test_교차참조_절_딥링크가_하이라이트된다(desktop_context):
    """욥 27:24 는 교차참조 절(chapter_ref)로만 있어, 종전엔 v24 가 없어
    스크롤·하이라이트가 조용히 아무 일도 하지 않았다."""
    page = desktop_context.new_page()
    _open(page, "job/27/24")
    assert page.locator(".verse-highlight").count() > 0


# ── ⑤ 발췌 렌더(북마크 읽기 뷰)·일반 장 무회귀 ──

def test_발췌_렌더에서도_무번호_구절이_살아있다(browser):
    # desktop_context 의 init script 는 이동마다 bible-bookmarks-v2 를 지우므로
    # 북마크를 심는 이 시험은 자체 컨텍스트를 쓴다(test_bookmark_read.py 와 같은 방식).
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open(page, "gen/2")
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(_LPS23_BOOKMARK)})")
    _open(page, "read")
    total = page.locator(".verse .verse-num").count() + page.locator(".versicle-mark").count()
    assert total == 7, f"발췌 렌더 절 {total}개 — 종전엔 6개(¶ 구절 유실)"
    assert "걱정할 것 없어라" in page.inner_text("#app")
    ctx.close()


def test_발췌_렌더는_전체_장_기준_인스턴스_키를_따른다(desktop_context):
    """appendVerses 는 받은 배열에서 키를 재계산하지 않고 호출자가 전체 장
    기준으로 추린 instanceKeys 를 따라야 한다. 중복 마커 쌍의 두 번째 절만
    발췌되면, 재계산 시 서수 `~2` 가 사라져 id 가 v9 로 어긋난다."""
    page = desktop_context.new_page()
    _open(page, "gen/1")
    ids = page.evaluate("""async () => {
        const { appendVerses } = await import('/js/app/views.js');
        const article = document.createElement('article');
        appendVerses(article, [{ number: 9, text: 'x' }], { instanceKeys: ['9~2'] });
        return Array.from(article.querySelectorAll('.verse[id]')).map(e => e.id);
    }""")
    assert ids == ["v9-2"], ids


_JOB32_BOOKMARK = [{
    "type": "bookmark", "id": "bm-job32", "bookId": "job", "chapter": 32,
    "label": "욥기 32장 발췌", "verseSpec": "5-9",
}]


def test_중복_마커_장의_발췌_id가_전체_장_렌더와_일치한다(browser):
    """욥 32:9 는 원본 절 마커 중복으로 number=9 가 둘이다(서수 폴백 `~2`).
    발췌 렌더의 DOM id 는 전체 장 렌더와 같아야 한다 — selKeys 전달이
    어긋나면(정렬 밀림 등) 여기서 갈라진다."""
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.removeItem('bible-bookmarks');")
    _open(page, "job/32")
    full_ids = page.eval_on_selector_all(
        "article.chapter-text .verse[id]", "els => els.map(e => e.id)")
    assert "v9" in full_ids and "v9-2" in full_ids, full_ids  # 중복 쌍 전제 확인
    page.evaluate(f"() => window.syncStoreV2.saveBookmarks({json.dumps(_JOB32_BOOKMARK)})")
    _open(page, "read")
    sub_ids = page.eval_on_selector_all("#app .verse[id]", "els => els.map(e => e.id)")
    assert len(sub_ids) == len(set(sub_ids)), f"DOM id 중복: {sub_ids}"
    assert set(sub_ids) <= set(full_ids), f"전체 장에 없는 id: {set(sub_ids) - set(full_ids)}"
    assert "v9" in sub_ids and "v9-2" in sub_ids, sub_ids
    ctx.close()


def test_일반_성서_장에는_전례_표기가_없다(desktop_context):
    page = desktop_context.new_page()
    _open(page, "gen/1")
    assert page.locator(".verse .verse-num").count() == 31
    assert page.locator(".responsory-mark, .versicle-mark, .psalm-section").count() == 0
    ids = page.eval_on_selector_all(
        "article.chapter-text .verse[id]", "els => els.map(e => e.id)")
    assert "v1" in ids and "v31" in ids, ids
