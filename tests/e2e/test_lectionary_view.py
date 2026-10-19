"""E2E: 전례독서 뷰 /lectionary[/YYYY-MM-DD] (ADR-038 §3 A3).

엔진(resolveDate · findReadings · findCollects)이 낸 하루를 뷰(js/app/lectionary.js)가
어떻게 그리는지 — 라우팅 → 엔진 프리로드 → 장 JSON 선로드 → DOM 커밋의 모듈 간 배선과,
유닛이 못 보는 화면 동작(링크 클릭 · URL 상태 · localStorage 트랙 기억 · 탭 바)을 검증한다.

  ① 본문 순서 — 본기도 → 제1독서 → 시편(영광송 1회) → 제2독서 → 복음, 송영 1회
  ② 관측일 스위처 — 칩 전부 노출, 고르면 ?obs= 와 본문 · 색이 바뀐다
  ③ 두 독서 나란히 — 선택 봉헌 당일 · 목적지 주일 · 도착일 카드 둘
  ④ 대안 세트 · 트랙 — 세그먼트, 트랙은 마지막 선택을 날짜 · 해와 무관하게 기억
  ⑤ 기념일 칩 — 「기념일 — 본문 없음」
  ⑥ 날짜 — 오늘 · 전날/다음날 · 잘못된 날짜
  ⑦ 탭 바 — 캘린더 탭 소속이라 독서 화면에서 캘린더 탭이 활성(ADR-038 A2)

실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「E2E 테스트」).
"""
import re
import datetime
import json
import urllib.parse

from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT, IPHONE_UA

BASE = "http://localhost:8080"

SLOT_ORDER = ["first", "psalm", "second", "gospel"]


def _open(page, path):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(".lectionary", timeout=20_000)
    page.wait_for_timeout(100)


def _slots(page):
    return page.eval_on_selector_all(".lect-reading", "els => els.map(e => e.dataset.slot)")


def _chips(page):
    return page.eval_on_selector_all(
        ".lect-chip", "els => els.map(e => (e.hasAttribute('aria-current') ? '*' : '') + e.textContent)")


def _colors(page):
    return page.eval_on_selector_all(".lect-color-item", "els => els.map(e => e.textContent)")


# ── ① 본문 순서 ──

def test_easter_day_renders_collect_then_four_readings_in_order(desktop_context):
    """부활대축일 — 본기도(대체안 셋) → 제1독서 → 시편(영광송) → 제2독서 → 복음, 송영 1회."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    assert page.inner_text(".lect-day") == "부활대축일"
    assert _colors(page) == ["백색"]
    # 본기도가 독서보다 앞에 온다.
    sections = page.eval_on_selector_all(".lect-section", "els => els.map(e => e.dataset.slot)")
    assert sections == ["collect"] + SLOT_ORDER, sections
    assert page.eval_on_selector_all(".lect-collects .division-tab", "els => els.map(e => e.textContent)") == ["본기도 1", "본기도 2", "본기도 3"]
    assert page.locator(".lect-collect-text").count() == 1
    # 원본 세트 둘 = 「또는」 대안 — 완전한 세트를 통째로 고른다.
    assert page.eval_on_selector_all(".lect-sets .division-tab", "els => els.map(e => e.textContent)") == ["독서 1", "독서 2"]
    assert page.locator(".lect-ending").count() == 1
    # 독서 본문이 실제로 그려졌다(절 span) — 복음까지.
    for slot in SLOT_ORDER:
        assert page.locator(f".lect-reading[data-slot='{slot}'] .verse").count() > 0, slot
    # 영광송은 시편 끝에 1회.
    assert page.locator(".lect-gloria").count() == 1
    assert page.locator(".lect-reading[data-slot='psalm'] .lect-gloria").count() == 1
    assert "영광이 성부와 성자와 성령께" in page.inner_text(".lect-gloria")
    # 시편은 계응 조판 — 발췌 렌더에서도 ◯ 가 살아 있다.
    assert page.locator(".lect-reading[data-slot='psalm'] .responsory-mark").count() > 0
    assert page.title() == "부활대축일 전례독서 — 공동번역성서"


def test_collect_alternative_segment_switches_text_and_url(desktop_context):
    """본기도 대체안 세그먼트 → ?collect=2, 본문이 바뀐다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    first = page.inner_text(".lect-collect-text")
    page.locator(".lect-collects .division-tab").nth(1).click()
    page.wait_for_url("**/lectionary/2026-04-05?collect=2")
    page.wait_for_selector(".lect-collects .division-tab.active:has-text('본기도 2')")
    assert page.inner_text(".lect-collect-text") != first


# ── ② 관측일 스위처 ──

def test_switcher_shows_every_candidate_and_changes_body_and_color(desktop_context):
    """9.16 니니안 ∧ 추계재 — 초기 독서는 격자(미결25), 색 [자, 백]; 추계재 칩 → ?obs=, 색 [자], 그 독서."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-09-16")
    assert page.inner_text(".lect-day").startswith("니니안")
    assert _chips(page) == ["니니안", "추계재", "*연중 24주 수요일 (짝수해)"]
    assert _colors(page) == ["자색", "백색"]
    assert "연중 24주 수요일 독서" in page.inner_text(".lect-reading-of")

    page.locator(".lect-chip", has_text="추계재").click()
    page.wait_for_url("**obs=t-*")
    page.wait_for_selector(".lect-chip[aria-current]:has-text('추계재')")
    assert _colors(page) == ["자색"]
    assert "추계재 독서" in page.inner_text(".lect-reading-of")
    assert page.locator(".lect-sets .division-tab").count() == 2

    # 성인 칩 → 공통 독서 캡션(분류 라벨).
    page.locator(".lect-chip", has_text="니니안").click()
    page.wait_for_selector(".lect-chip[aria-current]:has-text('니니안')")
    assert "선교사 공통 독서" in page.inner_text(".lect-reading-of")


def test_evening_liturgies_are_chips_not_the_day(desktop_context):
    """저녁 전례(설계서 R-6.1-evening — 사용자 결정 2026-10-15): 성 토요일의 대표는 성 토요일(적색)이고 부활밤은 「· 저녁」 칩,
    고르면 백색 · 부활밤 복음 · ?obs=. 성탄 밤은 12.24 의 「· 저녁」 칩이고 12.25 에는 없다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-04")
    assert page.inner_text(".lect-day") == "성 토요일"
    assert _colors(page) == ["적색"]
    assert _chips(page) == ["*성 토요일", "성주간 토요일 (가해)", "부활밤 · 저녁"]
    page.locator(".lect-chip", has_text="부활밤").click()
    page.wait_for_selector(".lect-chip[aria-current]:has-text('부활밤')")
    assert "obs=t-%EB%B6%80%ED%99%9C%EB%B0%A4" in page.url or "obs=t-부활밤" in urllib.parse.unquote(page.url)
    assert _colors(page) == ["백색"]
    assert "마태 28:1-10" in page.inner_text(".lect-reading[data-slot='gospel']")
    assert page.inner_text(".lect-day") == "성 토요일"   # 제목은 그날의 대표 그대로
    _open(page, "lectionary/2026-12-24")
    assert _chips(page)[-1] == "성탄 밤 · 저녁"
    assert _colors(page) == ["자색", "대체 청색"]   # 그날 낮(대림 평일)의 색 · 대체색
    _open(page, "lectionary/2026-12-25")
    assert not any("성탄 밤" in c for c in _chips(page))


def test_chips_wrap_so_every_chip_shows_on_phones(browser):
    """휴대폰 폭에서도 칩이 모두 화면 안에 보인다 — 칩 줄은 낱말처럼 이어 놓고 줄이 차면 다음 줄로(사용자 결정 2026-10-15 — PR #349
    리뷰: 가로 스크롤 줄 끝의 「부활밤 · 저녁」이 320px 에서 12px, 생략 성인이 있는 2042 년에는 0px 만 보였다). 성 토요일이 맨 앞
    (그날의 대표 — prec 1, 생략된 마틴 루터 킹보다 앞)."""
    for width in (320, 375):
        ctx = browser.new_context(viewport={"width": width, "height": 740}, user_agent=IPHONE_UA)
        ctx.add_init_script(CLEAR_APP_STORAGE)
        try:
            page = ctx.new_page()
            for date in ("2026-04-04", "2042-04-05"):
                _open(page, f"lectionary/{date}")
                boxes = page.eval_on_selector_all(
                    ".lect-chip", "els => els.map(e => { const r = e.getBoundingClientRect(); return [e.textContent, r.left, r.right]; })")
                assert boxes[0][0] == "성 토요일", (width, date, boxes)
                assert "부활밤 · 저녁" in [t for t, _, _ in boxes], (width, date, boxes)
                for text, left, right in boxes:
                    assert left >= 0 and right <= width, (width, date, text, left, right)
                row = page.evaluate("() => { const r = document.querySelector('.lect-chips'); return r.scrollWidth - r.clientWidth; }")
                assert row == 0, (width, date, row)   # 줄 안에 숨은 가로 스크롤이 없다
                over = page.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
                assert over == 0, (width, date, over)
        finally:
            ctx.close()


# ── ③ 두 독서 나란히 ──

def test_transfiguration_day_offers_two_readings_side_by_side(desktop_context):
    """8.6 주의 변모(목) — 카드 둘, 둘째 카드(격자)를 고르면 ?obs=grid:… 와 평일 독서."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-08-06")
    cards = page.locator(".lect-pair-card")
    assert cards.count() == 2
    assert cards.nth(0).get_attribute("aria-current") == "true"
    assert "공식" in cards.nth(0).inner_text()
    assert "오는 주일(8월 9일)" in cards.nth(1).inner_text()
    cards.nth(1).click()
    page.wait_for_url("**obs=grid%3A*")
    page.wait_for_selector(".lect-pair-card[aria-current]:has-text('연중 18주 목요일')")
    assert "연중 18주 목요일 독서" in page.inner_text(".lect-reading-of")


def test_destination_sunday_and_arrival_day_offer_pairs(desktop_context):
    """8.9 목적지 주일(optional) · 12.7 니콜라 도착일 — 카드 둘."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-08-09")
    texts = page.eval_on_selector_all(".lect-pair-card", "els => els.map(e => e.textContent)")
    assert len(texts) == 2 and "8월 6일에서 옮겨 지키는 경우" in texts[1], texts
    _open(page, "lectionary/2026-12-07")
    texts = page.eval_on_selector_all(".lect-pair-card", "els => els.map(e => e.textContent)")
    assert len(texts) == 2 and "12월 6일에서 옮겨 옴" in texts[0], texts
    assert "12월 6일에서 옮겨 지킵니다" in page.inner_text(".lect-day-note")


# ── ④ 대안 세트 · 트랙 ──

def test_track_toggle_persists_across_days_and_years(desktop_context):
    """연중 11주일 — 독서 2 를 고르면 ?track=2 와 localStorage 기억, 다음 주일도 이듬해 주일도 기억대로 독서 2(사용자 결정
    2026-10-13 — 「한번 선택하면 계속 일관성 있게 같은 트랙이 기본값」; 종전엔 전례년마다 따로 기억해 해가 바뀌면 독서 1)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    assert page.locator(".lect-track .division-tab").count() == 2
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 1"
    page.locator(".lect-track .division-tab", has_text="독서 2").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.wait_for_selector(".lect-track .division-tab.active:has-text('독서 2')")
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") == "2"   # 전례년 키 없이 값 하나
    # 다음 주일로는 앱 안에서 이동한다 — desktop_context 의 init script 가 page.goto 마다
    # 앱 저장소(이 키 포함)를 지우므로, 전체 로드로 가면 기억이 아니라 초기화를 보게 된다.
    page.evaluate("() => window.navigate('/lectionary/2026-06-21')")
    page.wait_for_url("**/lectionary/2026-06-21")
    page.wait_for_selector(".lect-date time[datetime='2026-06-21']")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 2"
    assert "독서 2" in page.inner_text(".lect-chip[aria-current]")
    # 기억에서 온 트랙도 주소에 적힌다 — 같은 주소가 기억과 무관하게 같은 화면(자체 리뷰 2026-10-13).
    assert page.evaluate("() => location.search") == "?track=2"
    # 이듬해(전례년 2027 — 대림 2026 뒤)의 연중 주일도 독서 2.
    page.evaluate("() => window.navigate('/lectionary/2027-06-20')")
    page.wait_for_selector(".lect-date time[datetime='2027-06-20']")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 2"
    assert page.evaluate("() => location.search") == "?track=2"
    # 다시 독서 1 을 고르면 그것이 새 기본값 — 앞 해의 주일로 돌아가도 독서 1.
    page.locator(".lect-track .division-tab", has_text="독서 1").click()
    page.wait_for_url("**/lectionary/2027-06-20?track=1")
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") == "1"
    page.evaluate("() => window.navigate('/lectionary/2026-06-21')")
    page.wait_for_selector(".lect-date time[datetime='2026-06-21']")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 1"


def test_cross_chapter_reading_keeps_every_chapter(desktop_context):
    """연중 12주일 다해 — 시편 42, 43: 장을 넘는 독서에서 둘째 장이 빠지지 않는다(Copilot 1회차 — 절 키가 장 안에서만 유일)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2025-06-22")
    psalm = page.locator(".lect-reading[data-slot='psalm']")
    assert "시편 42, 43" in psalm.locator(".lect-ref").inner_text()
    articles = psalm.locator("article.chapter-text")
    assert articles.count() == 2
    assert articles.nth(0).locator(".verse").count() > 0
    assert articles.nth(1).locator(".verse").count() > 0   # 43편 — 종전엔 42편과 키가 겹쳐 전부 빠졌다


def test_back_after_track_change_returns_to_previous_track(desktop_context):
    """트랙 없는 URL 에서 독서 2 를 고른 뒤 뒤로 가기 — 기억이 2 로 바뀌었어도 이전 화면(독서 1)으로 돌아온다(Copilot 1회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 1"
    page.locator(".lect-track .division-tab", has_text="독서 2").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.wait_for_selector(".lect-track .division-tab.active:has-text('독서 2')")
    page.go_back()
    page.wait_for_url("**/lectionary/2026-06-14?track=1")   # 저장 전에 지금 항목에 트랙을 명시해 둔 것
    page.wait_for_selector(".lect-track .division-tab.active:has-text('독서 1')")
    # 기억은 2 그대로 — 다음에 트랙 없이 열면 독서 2.
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") == "2"


def test_back_after_track_change_from_malformed_track_url(desktop_context):
    """`?track=3` 처럼 깨진 값으로 연 화면(독서 1 로 떨어짐)에서 독서 2 를 고른 뒤 뒤로 가기 — 깨진 URL 이 바뀐 기억(2)으로
    읽히지 않게 저장 전에 지금 항목에 track=1 을 명시한다(Copilot 5회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14?track=3")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 1"
    page.locator(".lect-track .division-tab", has_text="독서 2").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.wait_for_selector(".lect-track .division-tab.active:has-text('독서 2')")
    page.go_back()
    page.wait_for_url("**/lectionary/2026-06-14?track=1")
    page.wait_for_selector(".lect-track .division-tab.active:has-text('독서 1')")


def test_stale_lectionary_preload_failure_does_not_overwrite_new_route(browser):
    """전례독서 데이터 프리로드가 끝나기 전에 다른 화면으로 가고, 그 뒤 프리로드가 실패해도 새 화면이 남는다 —
    낡은 실패가 공용 renderError로 화면을 덮지 않는다(Copilot 5회차). 탭 제목도 새 화면의 것이다 — 라우터가 낡은 뷰의
    제목으로 페이지 메타를 고치지 않는다(routing.js openLazyView의 그린 뒤 가드 — PR #355 2회차 리뷰). 서비스 워커는 막아
    fetch가 page.route에 잡히게."""
    ctx = browser.new_context(service_workers="block")
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/")
        page.wait_for_selector(".book-list")
        held = []
        page.route("**/data/lectionary/**", lambda route: held.append(route))   # 응답을 붙잡아 둔다
        page.evaluate("() => window.navigate('/lectionary/2026-06-14')")
        for _ in range(50):
            if held:
                break
            page.wait_for_timeout(100)
        assert held, "전례독서 데이터 요청이 잡히지 않았다"
        page.evaluate("() => window.navigate('/')")   # 프리로드가 끝나기 전에 떠난다
        page.wait_for_selector(".book-list")
        failed = []
        page.on("requestfailed", lambda req: failed.append(req))
        for route in held:
            route.abort()   # 이제야 실패한다 — 낡은 요청
        for _ in range(100):   # 실패가 페이지에 닿을 때까지 — 고정 대기 대신 신호
            if len(failed) >= len(held):
                break
            page.wait_for_timeout(20)
        assert len(failed) >= len(held)
        page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")   # 거부 사슬이 다 돌 때까지
        assert page.locator(".book-list").count() == 1
        assert page.locator(".error").count() == 0
        assert page.evaluate("() => document.title") == "공동번역성서"
    finally:
        ctx.close()


_LECT_COPY = """
async () => {
  const article = document.querySelector(".lect-reading[data-slot='first'] article.chapter-text");
  const verses = article.querySelectorAll('.verse');
  const t1 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(verses[0]);
  const t2 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(verses[1]);
  const r = document.createRange();
  r.setStart(t1, Math.floor(t1.length / 2));
  r.setEnd(t2, Math.min(5, t2.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const dt = new DataTransfer();
  const ev = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt });
  article.dispatchEvent(ev);
  return [dt.getData('text/plain'), verses[0].getAttribute('data-vref'), verses[1].getAttribute('data-vref')];
}
"""


def test_copy_from_reading_appends_attribution(desktop_context):
    """독서 본문을 복사하면 장 본문처럼 절 경계로 넓힌 본문 + 「— 책 장:절 (공동번역성서)」 출처가 붙는다(Copilot 6회차)."""
    import re
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")   # 부활대축일 — 제1독서 사도행전 10:34-43
    text, a, b = page.evaluate(_LECT_COPY)
    assert re.search(rf"\n\n— 사도행전 10:{a}-{b} \(공동번역성서\)$", text), text
    assert "인용 출처" not in text


_LECT_COPY_CROSS = """
async () => {
  const section = document.querySelector(".lect-reading[data-slot='psalm']");
  const articles = section.querySelectorAll('article.chapter-text');
  const v1s = articles[0].querySelectorAll('.verse[data-vref]');
  const v2s = articles[1].querySelectorAll('.verse[data-vref]');
  const a = v1s[v1s.length - 1], b = v2s[0];
  const t1 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(a);
  const t2 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(b);
  const r = document.createRange();
  r.setStart(t1, Math.floor(t1.length / 2));
  r.setEnd(t2, Math.min(5, t2.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const dt = new DataTransfer();
  const ev = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt });
  a.dispatchEvent(ev);   // 실제 브라우저처럼 선택 안쪽에서 올라온다
  return [dt.getData('text/plain'), a.getAttribute('data-vref'), b.getAttribute('data-vref'), a.textContent.trim().slice(0, 6), b.textContent.trim().slice(-6)];
}
"""


def test_copy_across_chapters_is_one_passage(desktop_context):
    """장을 넘는 독서(연중 12주일 다해 시편 42, 43)에서 42편 끝과 43편 첫 절을 걸쳐 복사하면 한 본문 + 「— 전례시편 42:a-43:b」(Copilot 7회차)."""
    import re
    page = desktop_context.new_page()
    _open(page, "lectionary/2025-06-22")
    text, a, b, head, tail = page.evaluate(_LECT_COPY_CROSS)
    # 42편의 실제 마지막 절(11)에서 끝나 43편 1절로 이어지므로 합쳐 적는다 — 번호는 줄 글자 없이, 전례시편은 「(대한성공회 기도서)」
    na, nb = re.match(r"\d+", a).group(), re.match(r"\d+", b).group()
    assert text.endswith(f"\n\n— 전례시편 42:{na}-43:{nb} (대한성공회 기도서)"), text[-120:]
    assert "\n\n" in text.split("\n\n— ")[0]   # 두 편의 본문 사이는 빈 줄(자체 리뷰 2026-10-13)
    assert head.lstrip("0123456789 ") [:3] in text and tail in text   # 두 장의 본문이 다 들어 있다


_LECT_COPY_GAP = """
async () => {
  const section = document.querySelector(".lect-reading[data-slot='psalm']");
  const verses = [...section.querySelectorAll('.verse[data-vref]')];
  const i = verses.findLastIndex(v => parseInt(v.getAttribute('data-vref'), 10) === 2);   // 2b — 2절의 마지막 반행
  const a = verses[i], b = verses[i + 1];
  const t1 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(a);
  const t2 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(b);
  const r = document.createRange();
  r.setStart(t1, Math.floor(t1.length / 2));
  r.setEnd(t2, Math.min(5, t2.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const dt = new DataTransfer();
  const ev = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt });
  a.dispatchEvent(ev);
  return [dt.getData('text/plain'), a.getAttribute('data-vref'), b.getAttribute('data-vref')];
}
"""


def test_copy_cites_only_selected_verses_across_a_gap(desktop_context):
    """발췌가 건너뛴 절은 참조에서도 건너뛴다 — 부활대축일 시편 118:1-2, 14-24 에서 2절과 (바로 다음에 그려진) 14절을 걸쳐 복사하면
    「118:2, 14」이지 「118:2-14」가 아니다(Copilot 8회차)."""
    import re
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    text, a, b = page.evaluate(_LECT_COPY_GAP)
    assert re.match(r"14", b), b   # 2절 다음에 그려진 절이 14절이어야 검사가 뜻이 있다
    assert text.endswith(f"— 전례시편 118:{re.match(r'\d+', a).group()}, {re.match(r'\d+', b).group()} (대한성공회 기도서)"), text   # 건너뛴 절은 쉼표, 줄 글자 없이


_LECT_COPY_EDGE = """
async (slot) => {
  const section = document.querySelector(`.lect-reading[data-slot='${slot}']`);
  const articles = section.querySelectorAll('article.chapter-text');
  const v1s = articles[0].querySelectorAll('.verse[data-vref]');
  const v2s = articles[1].querySelectorAll('.verse[data-vref]');
  const a = v1s[v1s.length - 1], b = v2s[0];
  const t1 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(a);
  const t2 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(b);
  const r = document.createRange();
  r.setStart(t1, Math.floor(t1.length / 2));
  r.setEnd(t2, Math.min(5, t2.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const dt = new DataTransfer();
  a.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
  return [dt.getData('text/plain'), a.getAttribute('data-vref'), b.getAttribute('data-vref'), articles[0].getAttribute('data-chapter-last')];
}
"""


def test_copy_does_not_merge_chapters_when_excerpt_stops_short(desktop_context):
    """연중 32주 토 홀수해(2027-11-13) 지혜 18:14-16, 19:1-6 — 18장은 25절까지 있어 16절에서 끝난 발췌는 19:1 과 이어지지 않는다:
    「18:16, 19:1」이지 「18:16-19:1」이 아니다(Copilot 9회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2027-11-13")
    text, a, b, last = page.evaluate(_LECT_COPY_EDGE, "first")
    assert int(last) > int(a.rstrip("ab")), (a, last)   # 발췌가 장 끝보다 먼저 끝난다
    assert text.endswith(f"— 지혜서 18:{int(a.rstrip('ab'))}, 19:{int(b.rstrip('ab'))} (공동번역성서)"), text


_LECT_COPY_MERGED = """
async () => {
  const section = document.querySelector(".lect-reading[data-slot='psalm']");
  const verses = [...section.querySelectorAll('.verse[data-vref]')];
  const i = verses.findIndex(v => v.getAttribute('data-vref').includes('-'));
  const n = parseInt(verses[i].getAttribute('data-vref'), 10);
  const j = verses.findIndex((v, k) => k > i && parseInt(v.getAttribute('data-vref'), 10) !== n);   // 병합 절의 반행(7-8a · 7-8b) 다음 절
  const a = verses[i], b = verses[j];
  const t1 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(a);
  const t2 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(b);
  const r = document.createRange();
  r.setStart(t1, Math.floor(t1.length / 2));
  r.setEnd(t2, Math.min(5, t2.length));
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const dt = new DataTransfer();
  a.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
  return [dt.getData('text/plain'), a.getAttribute('data-vref'), b.getAttribute('data-vref')];
}
"""


def test_copy_keeps_both_endpoints_of_a_merged_verse(desktop_context):
    """주님의 세례 주일(2026-01-11) 시편 29 — 병합 절 「7-8」과 9절을 걸쳐 복사하면 「29:7-9」 — 병합 절의 두 끝을 다 센다(7만 남기지
    않는다 — Copilot 9회차; 그때의 「29:7-8,9」 표기는 자체 리뷰가 장 본문과 같은 줄 글자 없는 정수 구간으로 바꿨다)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-01-11")
    text, a, b = page.evaluate(_LECT_COPY_MERGED)
    assert a.startswith("7-8"), a   # 병합 절의 첫 반행(「7-8a」)
    assert text.endswith(f"— 전례시편 29:7-{int(re.match(r'\d+', b).group())} (대한성공회 기도서)"), text   # 병합 절의 두 끝(7 · 8)을 다 세어 「7-9」 — 「7」 만이 아니다


_LECT_COPY_OPTIONAL = """
async () => {
  const section = document.querySelector(".lect-reading:has(.lect-bracket)");
  const verses = [...section.querySelectorAll('.verse[data-vref]')];
  const i = verses.findIndex(v => v.classList.contains('lect-optional'));
  const a = verses[Math.max(0, i - 1)], b = verses[i];   // 선택 구절 바로 앞 절부터 선택 구절까지
  const t1 = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(a);
  const r = document.createRange();
  r.setStart(t1, Math.floor(t1.length / 2));
  r.setEndAfter(b);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const dt = new DataTransfer();
  a.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
  return [dt.getData('text/plain'), b.querySelector('.lect-bracket') ? 1 : 0];
}
"""


def test_copy_excludes_optional_verse_brackets(desktop_context):
    """괄호 선택 구절의 〔 〕는 표시 전용(aria-hidden · 선택 불가)이라 복사 본문에도 들어가지 않는다(Copilot 10회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    text, has_bracket = page.evaluate(_LECT_COPY_OPTIONAL)
    assert has_bracket == 1   # 고른 선택 구절에 표지가 붙어 있어야 검사가 뜻이 있다
    assert "〔" not in text and "〕" not in text, text
    assert "(공동번역성서)" in text


def test_ember_friday_one_button_picks_readings_and_collect_and_common_caption(desktop_context):
    """추계재 금요일 — 성직후보자 · 수도자는 「독서 · 본기도」 단추 하나로 독서와 본기도를 함께 바꾼다(교차 조합이 없다 — 사용자 결정
    2026-10-13; 둘째에도 닿는다 — collect_no 가 둘 다 1, 자체 리뷰 2026-10-13). 본기도 칸에는 따로 세그먼트가 없다.
    니니안(공통뿐인 성인)은 대안 독서 세그먼트에 「선교사 공통 독서」 캡션."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-09-18?obs=t-%EC%B6%94%EA%B3%84%EC%9E%AC")
    assert page.inner_text(".lect-sets .lect-control-label") == "독서 · 본기도"
    tabs = page.locator(".lect-sets .division-tab")
    assert [tabs.nth(i).inner_text() for i in range(tabs.count())] == ["성직후보자", "수도자"]
    assert page.locator(".lect-collects .division-tab").count() == 0
    first = page.inner_text(".lect-collect-text")
    tabs.nth(1).click()
    page.wait_for_url("**set=2")
    assert "collect=" not in page.url
    page.wait_for_selector(".lect-sets .division-tab.active:has-text('수도자')")
    assert page.inner_text(".lect-collect-text") != first
    _open(page, "lectionary/2026-09-16?obs=d0916-%EB%8B%88%EB%8B%88%EC%95%88")
    assert page.inner_text(".lect-sets .lect-control-label") == "대안 독서"   # 짝이 아닌 날은 그대로
    assert "공통 독서" in page.inner_text(".lect-sets .lect-caption")


def test_may1_one_button_switches_to_labour_day_readings_and_collect(desktop_context):
    """5.1 — 사도 성 필립보와 성 야고보가 먼저이고, 지역 축일인 노동자의 날은 「독서 · 본기도」 단추 하나로 독서와 본기도를 함께
    고른다(사용자 결정 2026-10-13 — 「대안 독서는 사도 축일, 본기도는 노동자의 날」 같은 교차 조합은 없다)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-05-01")
    tabs = page.locator(".lect-sets .division-tab")
    assert [tabs.nth(i).inner_text() for i in range(tabs.count())] == ["사도 성 필립보와 성 야고보", "노동자의 날"]
    assert page.locator(".lect-sets .division-tab.active").inner_text() == "사도 성 필립보와 성 야고보"
    assert page.locator(".lect-collects .division-tab").count() == 0
    collect0 = page.inner_text(".lect-collect-text")
    first0 = page.inner_text(".lect-reading[data-slot='first'] .lect-ref")
    tabs.nth(1).click()
    page.wait_for_url("**/lectionary/2026-05-01?set=2")
    page.wait_for_selector(".lect-sets .division-tab.active:has-text('노동자의 날')")
    assert page.inner_text(".lect-collect-text") != collect0
    assert page.inner_text(".lect-reading[data-slot='first'] .lect-ref") != first0


def test_half_verse_on_two_line_verse_shows_only_that_line(desktop_context):
    """성령강림대축일(2026-05-24) 「시편 104:24-34, 35하」 — 35절은 두 줄(선창 · 응답)이라 「하」 줄만, 절 번호는 남는다(자체 리뷰 2026-10-13)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-05-24")
    psalm = page.locator(".lect-reading[data-slot='psalm']")
    assert "35하" in psalm.locator(".lect-ref").inner_text()
    text = psalm.locator("article.chapter-text").last.inner_text()
    assert "악인들아" not in text, text[-200:]
    assert "내 영혼아, 주님을 찬미하여라" in text
    v35 = psalm.locator(".verse[data-vref='35b']")
    assert v35.count() == 1 and v35.locator(".verse-num").count() == 1   # 번호가 남은 줄로 옮겨 왔다
    assert psalm.locator(".verse[data-vref='35a']").count() == 0


_LECT_COPY_ACROSS = """
async (sel) => {
  const [startSel, endSel] = sel;
  const a = document.querySelector(startSel), b = document.querySelector(endSel);
  const ta = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(a);
  const tb = ((n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; })(b);
  const r = document.createRange();
  if (a === b) { r.setStart(ta, 0); r.setEnd(ta, ta.length); }   // 한 절 — 그 절의 글자 전부
  else { r.setStart(ta, Math.floor(ta.length / 2)); r.setEnd(tb, Math.min(3, tb.length)); }
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  const dt = new DataTransfer();
  a.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
  return dt.getData('text/plain');
}
"""


def test_copy_across_readings_keeps_every_section(desktop_context):
    """부활대축일 — 제1독서 마지막 절부터 복음 첫 절까지 고르면 네 독서가 다 실리고 섹션마다 출처가 붙는다. 종전엔 시작한
    섹션의 처리기가 제 절만 싣고 나머지를 버렸다(자체 리뷰 2026-10-13)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    text = page.evaluate(_LECT_COPY_ACROSS, [
        ".lect-reading[data-slot='first'] article.chapter-text .verse[data-vref]:last-of-type",
        ".lect-reading[data-slot='gospel'] article.chapter-text .verse[data-vref]",
    ])
    assert "— 사도행전 10:43 (공동번역성서)" in text, text[:200]
    assert re.search(r"\n\n— 전례시편 118:[0-9, -]+ \(대한성공회 기도서\)\n\n", text), text   # 시편은 기도서 번역(사용자 결정 2026-10-13)
    assert text.count("(공동번역성서)") == 3          # 제1독서 · 제2독서 · 복음
    assert text.count("(대한성공회 기도서)") == 1     # 시편
    assert text.rstrip().endswith("(공동번역성서)") and "요한의 복음서 20:1" in text


def test_preload_failure_shows_lectionary_error_not_previous_header(browser):
    """교회력 자료를 받지 못하면(오프라인 · 캐시 없음) 전례독서 실패 화면 — 앞 화면(창세기 1장)의 제목 · 헤더가 남지 않는다(자체 리뷰 2026-10-13)."""
    ctx = browser.new_context(service_workers="block")
    page = ctx.new_page()
    try:
        page.goto(f"{BASE}/gen/1")
        page.wait_for_selector("article.chapter-text .verse")
        page.route("**/data/lectionary/**", lambda route: route.abort())
        page.evaluate("() => window.navigate('/lectionary/2026-04-05')")
        page.wait_for_selector(".empty-state-title", timeout=10_000)
        assert page.inner_text(".empty-state-title") == "전례독서 자료를 불러오지 못했습니다"
        assert page.evaluate("() => document.title").startswith("전례독서")
        assert page.locator(".error").count() == 0
        # 다음 행동은 「다시 불러오기」 — 그날을 다시 연다(그전엔 단추가 없었다 — PR #355 리뷰). 머리는 「캘린더로」 꺾쇠.
        assert page.inner_text(".empty-state-subtitle") == "네트워크 연결을 확인한 뒤 「다시 불러오기」를 눌러 주세요."
        assert page.locator(".state-action button").inner_text() == "다시 불러오기"
        assert page.locator("#page-title .title-back-btn").get_attribute("href") == "/calendar"
    finally:
        ctx.close()


def test_year_outside_gregorian_range_is_rejected_not_hung(desktop_context):
    """0100년 — 엔진이 날짜를 넘기지 못해 멈추던 범위는 뷰가 먼저 거른다(자체 리뷰 2026-10-13)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/0100-06-01")
    assert page.inner_text(".empty-state-title") == "교회력을 계산할 수 없는 날짜입니다"
    assert page.inner_text(".empty-state-subtitle") == "「이번 달 캘린더」를 눌러 다른 날짜를 골라 주세요."
    assert page.locator(".state-action a").get_attribute("href") == "/calendar"


def test_long_segment_labels_wrap_at_320px(browser):
    """320px — 「사도 성 필립보와 성 야고보」 · 「주의 변모 주일로 지킬 때」 세그먼트가 가로 스크롤을 만들지 않는다(WCAG 1.4.10)."""
    ctx = browser.new_context(viewport={"width": 320, "height": 640})
    page = ctx.new_page()
    try:
        for day in ("2026-05-01", "2026-03-01"):
            _open(page, f"lectionary/{day}")
            assert page.locator(".lect-sets .division-tab").count() >= 2
            assert page.evaluate("() => document.documentElement.scrollWidth") <= 320, day
            over = page.evaluate("""() => [...document.querySelectorAll('.lect-sets .division-tab')]
                .some(t => t.scrollWidth > t.clientWidth + 1)""")
            assert not over, day
    finally:
        ctx.close()


def test_day_change_announces_date_and_observance(desktop_context):
    """화면 안에서 다음날로 가면 라이브 영역이 「전례독서」가 아니라 그날(날짜 — 관측일)을 읽는다(자체 리뷰 2026-10-13)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-09-15")
    page.locator(".lect-datenav-btn[aria-label='다음날']").click()
    page.wait_for_url("**/lectionary/2026-09-16")
    page.wait_for_function("() => document.getElementById('a11y-announce').textContent.includes('2026년 9월 16일')")
    assert "전례독서" in page.inner_text("#a11y-announce")


def test_chapter_load_failure_names_the_reading(desktop_context):
    """장 하나를 받지 못하면 그 독서 라벨로 알린다 — 안쪽 책 id(「acts 10」)가 아니다(자체 리뷰 2026-10-13)."""
    page = desktop_context.new_page()
    page.route("**/data/bible/acts-10.json", lambda route: route.abort())
    _open(page, "lectionary/2026-04-05")
    msg = page.inner_text(".lect-reading[data-slot='first'] .lect-missing")
    assert msg.startswith("본문을 불러오지 못했습니다 — 사도") and "acts" not in msg


def test_copy_including_collect_falls_back_to_browser_copy(desktop_context):
    """본기도 글자까지 고르면 처리기가 가로채지 않는다(브라우저 기본 복사 — 고른 것을 빠뜨리지 않게)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    text = page.evaluate(_LECT_COPY_ACROSS, [".lect-collect-text", ".lect-reading[data-slot='first'] article.chapter-text .verse[data-vref]"])
    assert text == ""   # 합성 이벤트라 기본 복사는 DataTransfer 를 채우지 않는다 — 가로채지 않았다는 뜻


def test_canticle_copy_cites_canticle_name(desktop_context):
    """대림 2주일(2027-12-05) 시편 자리의 즈가리야 송가 — 출처는 송가 이름 + 절 + 「(대한성공회 기도서)」(기도서 번역 — 사용자 결정
    2026-10-13; 「(공동번역성서)」가 아니다)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2027-12-05")
    sel = ".lect-reading[data-slot='psalm'] article.chapter-text .verse[data-vref]"
    text = page.evaluate(_LECT_COPY_ACROSS, [sel, sel])
    assert "(공동번역성서)" not in text, text[-80:]
    assert re.search(r"\n\n— \S.*송가 1 \(대한성공회 기도서\)$", text), text[-80:]


def test_psalm_copy_keeps_liturgical_marks_and_section_headings(desktop_context):
    """대림 4주일(2026-12-20) 시편 89:1-4, 19-27 을 통째로 복사하면 ◯ · ¶ · 부 소제목이 다 실린다 — 「(1)」 · 「(2)」는 제 줄,
    ¶ 뒤 한 칸, 출처는 「(대한성공회 기도서)」(사용자 결정 2026-10-13 — known-issues §4). 종전엔 「(1)」이 빠지고 「(2)그 옛날」로
    붙어 절 번호처럼 읽혔다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-20")
    verses = ".lect-reading[data-slot='psalm'] article.chapter-text .verse[data-vref]"
    text = page.evaluate(_LECT_COPY_ACROSS, [verses, f"{verses}:last-of-type"])
    assert text.startswith("(1)\n주여, 내가 당신의 사랑을 영원히 노래하리이다. ◯\n"), text[:120]
    assert "왕노릇하게 하리라.”\n\n(2)\n그 옛날, 당신께서 스스로 나타나시어, ◯\n" in text, text
    assert "\n¶ “나는 용사들 위에" in text, text
    assert text.endswith("\n\n— 전례시편 89:1-4, 19-27 (대한성공회 기도서)"), text[-80:]


def test_verse_ids_are_unique_across_slots_and_chapters(desktop_context):
    """한 화면에 슬롯 넷 · 장 여럿이 있어도 절 id 가 겹치지 않는다 — 슬롯 · 책 · 장 접두(Copilot 7회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2025-06-22")
    dup = page.evaluate("() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.length - new Set(ids).size; }")
    assert dup == 0
    assert page.locator("[id^='psalm-lps-43-v']").count() > 0


def test_back_to_earlier_day_keeps_its_track_after_memory_changes(desktop_context):
    """06-07(독서 1)에서 06-14 로 가서 독서 2 를 고른 뒤 06-07 로 돌아와도 독서 1 — 렌더 때 그 항목에 트랙을 적어 두므로
    바뀐 기억으로 다시 읽히지 않는다(자체 리뷰 2026-10-13)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-07")
    page.wait_for_url("**/lectionary/2026-06-07?track=1")
    page.evaluate("() => window.navigate('/lectionary/2026-06-14')")
    page.wait_for_url("**/lectionary/2026-06-14?track=1")
    page.locator(".lect-track .division-tab", has_text="독서 2").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.go_back()
    page.wait_for_url("**/lectionary/2026-06-14?track=1")
    page.go_back()
    page.wait_for_url("**/lectionary/2026-06-07?track=1")
    page.wait_for_selector(".lect-track .division-tab.active:has-text('독서 1')")


def test_conditional_set_condition_is_the_label(desktop_context):
    """사순 2주일 가해 — 조건이 라벨: 「사순 2주일」 / 「주의 변모 주일로 지킬 때」, 캡션 줄 없음(미결38)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-03-01?set=2")
    assert page.eval_on_selector_all(".lect-sets .division-tab", "els => els.map(e => e.textContent)") == ["사순 2주일", "주의 변모 주일로 지킬 때"]
    assert page.locator(".lect-sets .division-tab.active").inner_text() == "주의 변모 주일로 지킬 때"
    assert page.locator(".lect-sets .lect-caption").count() == 0


def test_bracket_set_merges_into_long_text_with_markers(desktop_context):
    """연중 11주일 가해 — 괄호 선택 구절 세트는 세그먼트가 아니라 긴 본문 + 〔 〕 표시 + 「짧게 읽으면 …」 주석."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    assert page.locator(".lect-sets").count() == 0          # 대안 세그먼트 없음(합쳐짐)
    assert page.locator(".lect-track").count() == 1         # 트랙 토글은 그대로
    note = page.locator(".lect-optional-note")
    assert note.count() == 1 and "짧게 읽으면" in note.inner_text()
    brackets = page.locator(".lect-bracket")
    assert brackets.count() >= 2 and brackets.count() % 2 == 0
    assert page.locator(".verse.lect-optional").count() > 0
    # 선택 구절은 그 슬롯 하나에만.
    assert page.eval_on_selector_all(".lect-reading:has(.lect-bracket)", "els => els.length") == 1


# ── ⑤ 기념일 ──

def test_commemoration_chip_renders_empty_state(desktop_context):
    """1.1 세계평화 기도일 칩 — 「기념일 — 본문 없음」, 독서 · 본기도 없음."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-01-01")
    page.locator(".lect-chip", has_text="세계평화").click()
    page.wait_for_selector(".empty-state-title")
    assert page.inner_text(".empty-state-title") == "기념일 — 본문 없음"
    assert page.locator(".lect-reading").count() == 0
    assert page.locator(".lect-collects").count() == 0


# ── ⑥ 날짜 ──

def test_bare_route_shows_today_and_day_steppers_work(desktop_context):
    """/lectionary 는 오늘, ‹ › 로 전날 · 다음날."""
    page = desktop_context.new_page()
    _open(page, "lectionary")
    # 「오늘」은 브라우저의 날짜로 — 파이썬 쪽 날짜와 자정 경계에서 어긋나지 않게
    today = datetime.date(*page.evaluate("() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; }"))
    assert page.get_attribute(".lect-date time", "datetime") == today.isoformat()
    # 경로만 본다 — 트랙이 있는 날은 그린 뒤 주소에 「?track=」이 붙는데(지금 항목에 고른 트랙을 적는다), 장을 이미 받은
    # 날로 돌아오면 그 일이 이동과 한 태스크 안에 끝나 「?track=」 없는 주소를 볼 틈이 없다(오늘이 트랙 있는 주일일 때 —
    # 2026-10-18에 드러났다)
    def path_is(date):
        return lambda url: urllib.parse.urlparse(url).path == f"/lectionary/{date.isoformat()}"
    page.locator(".lect-datenav-btn[aria-label='다음날']").click()
    page.wait_for_url(path_is(today + datetime.timedelta(days=1)))
    page.wait_for_selector(".lectionary")
    page.locator(".lect-datenav-btn[aria-label='전날']").click()
    page.wait_for_url(path_is(today))


def _focused(page):
    """지금 포커스 — 그 컨트롤의 자리(data-focus-key) · 화면 안인지 · :focus-visible."""
    return page.evaluate("""() => {
        const a = document.activeElement;
        const r = a ? a.getBoundingClientRect() : null;
        return { key: a?.dataset?.focusKey || null, inView: !!r && r.top >= 0 && r.bottom <= innerHeight,
                 visible: !!a?.matches(':focus-visible') };
    }""")


def _enter_on(page, selector):
    page.locator(selector).focus()
    page.keyboard.press("Enter")


def test_redraws_keep_keyboard_focus_on_the_pressed_control(desktop_context):
    """키보드로 날짜 이동(다음날 · 전날 · 오늘) · 관측일 칩 · 두 독서 카드 · 세그먼트(트랙 · 세트 · 본기도)를 눌러 #app 을 다시
    그려도 포커스가 새 화면의 같은 컨트롤에 있고(:focus-visible) 화면 안이다 — Enter 만 거듭 눌러 날을 넘긴다(WCAG 2.4.3 ·
    2.4.7 — PR #348 리뷰에서 넘긴 것: 그전엔 누른 링크가 사라져 포커스가 body 로 빠졌다; 캘린더의 달 이동과 같은 도우미).
    계산 범위 끝(9999-12-31)에서는 「다음날」이 자리만 남아 「오늘」로."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-09-15")
    ok = {"inView": True, "visible": True}
    _enter_on(page, ".lect-datenav-btn[aria-label='다음날']")
    page.wait_for_selector(".lect-date time[datetime='2026-09-16']")
    assert _focused(page) == {"key": "next", **ok}
    page.keyboard.press("Enter")
    page.wait_for_selector(".lect-date time[datetime='2026-09-17']")
    assert _focused(page) == {"key": "next", **ok}
    _enter_on(page, ".lect-datenav-btn[aria-label='전날']")
    page.wait_for_selector(".lect-date time[datetime='2026-09-16']")
    assert _focused(page) == {"key": "prev", **ok}
    # 칩 — 관측일 id 의 한글 · 콜론이 든 키
    _enter_on(page, ".lect-chip:has-text('추계재')")
    page.wait_for_selector(".lect-chip[aria-current]:has-text('추계재')")
    assert _focused(page) == {"key": "obs:t-추계재", **ok}
    _enter_on(page, ".lect-chip:has-text('연중 24주 수요일')")
    page.wait_for_url("**/lectionary/2026-09-16")
    page.wait_for_selector(".lect-chip[aria-current]:has-text('연중 24주 수요일')")
    assert _focused(page) == {"key": "obs:grid:ordinary-24-weekday-wed", **ok}
    # 세트 세그먼트(추계재 — 독서 1 · 2)
    _enter_on(page, ".lect-chip:has-text('추계재')")
    page.wait_for_selector(".lect-chip[aria-current]:has-text('추계재')")
    _enter_on(page, ".lect-sets .division-tab >> nth=1")
    page.wait_for_url("**set=2")
    page.wait_for_function("() => document.querySelectorAll('.lect-sets .division-tab')[1]?.classList.contains('active')")
    assert _focused(page) == {"key": "set:2", **ok}
    # 트랙 · 본기도 세그먼트 · 두 독서 카드
    _open(page, "lectionary/2026-06-14")
    _enter_on(page, ".lect-track .division-tab:has-text('독서 2')")
    page.wait_for_selector(".lect-track .division-tab.active:has-text('독서 2')")
    assert _focused(page) == {"key": "track:2", **ok}
    _open(page, "lectionary/2026-04-05")
    _enter_on(page, ".lect-collects .division-tab >> nth=1")
    page.wait_for_selector(".lect-collects .division-tab.active:has-text('본기도 2')")
    assert _focused(page) == {"key": "collect:2", **ok}
    _open(page, "lectionary/2026-08-06")
    _enter_on(page, ".lect-pair-card >> nth=1")
    page.wait_for_selector(".lect-pair-card[aria-current]:has-text('연중 18주 목요일')")
    assert _focused(page) == {"key": "pair:b", **ok}
    # 오늘 — 브라우저의 날짜로
    today = datetime.date(*page.evaluate("() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; }"))
    _enter_on(page, ".lect-head .lect-today")
    page.wait_for_selector(f".lect-date time[datetime='{today.isoformat()}']")
    assert _focused(page) == {"key": "today", **ok}
    # 계산 범위 끝 — 9999-12-31 에는 「다음날」이 없다(그 화면의 「전날」은 있다)
    _open(page, "lectionary/9999-12-30")
    _enter_on(page, ".lect-datenav-btn[aria-label='다음날']")
    page.wait_for_selector(".lect-date time[datetime='9999-12-31']")
    assert page.locator(".lect-datenav-btn[aria-label='다음날']").count() == 0
    assert page.locator(".lect-datenav-btn[aria-label='전날']").count() == 1
    assert _focused(page) == {"key": "today", **ok}
    _open(page, "lectionary/1583-01-01")
    assert page.locator(".lect-datenav-btn[aria-label='전날']").count() == 0   # 1582년은 교회력을 계산하지 않는다


def test_redraw_after_a_fetch_keeps_the_pressed_control_where_it_was(mobile_context):
    """새 장을 받아야 하는 다시 그리기(부활절 세트 2 — 다른 독서)는 스켈레톤이 먼저 그려져 스크롤이 맨 위로 눌렸다 — 누른 세그먼트가
    아래로 밀리고, 화면 아래쪽 컨트롤이면 화면 밖으로 나갔다(2.4.7). 포커스와 함께 누른 때의 화면 위치로 돌아온다."""
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-04-05")
    seg = page.locator(".lect-sets .division-tab >> nth=1")
    page.evaluate("""(el) => { const r = el.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + r.top - 200, behavior: 'instant' }); }""", seg.element_handle())
    page.evaluate("() => document.fonts.ready.then(() => 0)")   # 글꼴이 바뀌면 칩 줄이 다시 감겨 세그먼트가 움직인다
    before = page.evaluate("(el) => ({ y: scrollY, top: el.getBoundingClientRect().top })", seg.element_handle())
    assert before["y"] > 100, before   # 맨 위가 아닌 자리에서 누른다
    seg.focus()
    page.keyboard.press("Enter")
    page.wait_for_url("**/lectionary/2026-04-05?set=2")
    page.wait_for_selector(".lect-sets .division-tab.active:has-text('독서 2')")   # 복원은 이 커밋 안에서 끝난다
    assert _focused(page) == {"key": "set:2", "inView": True, "visible": True}
    after = page.evaluate("() => ({ y: scrollY, top: document.activeElement.getBoundingClientRect().top })")
    assert abs(after["top"] - before["top"]) <= 2, (before, after)


def _slow_chapters(page, ms):
    """장 JSON 받기를 ms 만큼 늦춘다(실제 네트워크 — 로컬 서버는 너무 빨라 스켈레톤 사이의 일이 드러나지 않는다). 끝나면 page.unroute."""
    def handler(route):
        page.wait_for_timeout(ms)
        route.continue_()
    page.route("**/data/bible/**", handler)


def test_slow_redraw_keeps_the_pressed_control_in_place_on_desktop(desktop_context):
    """데스크톱 — 새 장을 받는 사이 스켈레톤이 스크롤을 맨 위로 누르면 머리의 검색 줄(#breadcrumb-row)이 펼쳐지고, 돌아온 뒤 다시
    접힌다. 누른 세그먼트가 그 줄 높이(약 46px)만큼 아래로 내려앉던 것을 막는다(PR #350 리뷰 — 위의 모바일 테스트는 그 줄이 없고
    로컬 서버는 너무 빨라 보지 못했다). 머리가 접힌 채 위로 되돌아온 자리(이력 — 60px 넘어야 접히고 10px 아래라야 펼친다)도 본다."""
    page = desktop_context.new_page()
    for scroll_back in (None, 40):
        _open(page, "lectionary/2026-04-05")
        seg = page.locator(".lect-sets .division-tab >> nth=1")
        page.evaluate("""(el) => { const r = el.getBoundingClientRect();
            window.scrollTo({ top: window.scrollY + r.top - 170, behavior: 'instant' }); }""", seg.element_handle())
        page.wait_for_timeout(400)   # 머리가 접히는 전환(0.25s)
        if scroll_back is not None:
            page.evaluate("(y) => window.scrollTo({ top: y, behavior: 'instant' })", scroll_back)
            page.wait_for_timeout(400)
        assert page.evaluate("() => document.getElementById('app-header').classList.contains('compact')")
        before = page.evaluate("(el) => el.getBoundingClientRect().top", seg.element_handle())
        _slow_chapters(page, 400)
        seg.focus()
        page.keyboard.press("Enter")
        page.wait_for_selector(".lect-sets .division-tab.active:has-text('독서 2')", timeout=20_000)
        page.wait_for_timeout(600)   # 머리가 다시 접히는 전환까지
        page.unroute("**/data/bible/**")
        assert _focused(page) == {"key": "set:2", "inView": True, "visible": True}
        after = page.evaluate("() => document.activeElement.getBoundingClientRect().top")
        assert abs(after - before) <= 2, (scroll_back, before, after)


def test_slow_redraw_leaves_focus_the_reader_moved_elsewhere(desktop_context):
    """새 장을 받는 사이 독자가 머리의 검색 칸으로 옮겨 치기 시작했으면, 다 그린 뒤에도 포커스는 그 칸에 남는다 — 누른 세그먼트로
    끌고 오면 이어 친 글자가 사라지고 Enter 가 검색 대신 그 링크를 눌렀다(PR #350 리뷰). 포커스는 누른 링크와 함께 사라져 body 로
    떨어졌을 때만 돌려준다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    _slow_chapters(page, 800)
    page.locator(".lect-sets .division-tab >> nth=1").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".loading")
    page.locator("#search-input").focus()
    page.keyboard.type("love")
    page.wait_for_selector(".lect-sets .division-tab.active:has-text('독서 2')", timeout=20_000)
    page.keyboard.type("ly")
    page.unroute("**/data/bible/**")
    assert page.evaluate("() => document.activeElement.id") == "search-input"
    assert page.input_value("#search-input") == "lovely"


def test_invalid_date_shows_notice_not_crash(desktop_context):
    """실패 화면의 글자는 산세리프 — 빈 상태가 .lectionary의 성서 본문 serif를 물려받던 것(DESIGN.md §6, 2026-10-17).
    다음 행동은 「이번 달 캘린더」 하나이고 부제가 그 이름으로 할 일을 말한다 — 그전엔 단추 없이 「…골라 주세요」였다(PR #355 리뷰)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-13-99")
    assert page.inner_text(".empty-state-title") == "잘못된 날짜입니다"
    assert page.locator(".lect-reading").count() == 0
    fonts = page.eval_on_selector_all(".empty-state-title, .empty-state-subtitle", "els => els.map(e => getComputedStyle(e).fontFamily)")
    assert fonts and all("Noto Sans KR" in f and "Serif" not in f for f in fonts), fonts
    assert page.inner_text(".empty-state-subtitle") == "「이번 달 캘린더」를 눌러 다른 날짜를 골라 주세요."
    link = page.locator(".state-action a")
    assert link.inner_text() == "이번 달 캘린더"
    link.click()
    page.wait_for_url(f"{BASE}/calendar")
    page.wait_for_selector(".cal-grid", timeout=20_000)


def test_malformed_percent_escape_shows_notice(desktop_context):
    """깨진 퍼센트 이스케이프 — decodeURIComponent 가 throw 해도 라우트가 죽지 않고 「잘못된 날짜」(Copilot 3회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/%E0%A4%A")
    assert page.inner_text(".empty-state-title") == "잘못된 날짜입니다"
    assert page.locator(".lect-reading").count() == 0


def test_modified_click_on_track_opens_new_page_without_touching_current(browser):
    """Ctrl/Cmd+클릭(새 탭)은 지금 탭의 주소 · 트랙 기억을 건드리지 않는다 — 라우터와 같은 기본 클릭 가드(Copilot 3회차).
    앱 저장소를 지우는 init script 가 없는 컨텍스트에서 본다 — 새 탭이 열리며 기억을 지우면 가드 없이도 통과하므로."""
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        _open(page, "lectionary/2026-06-14")
        page.wait_for_url("**/lectionary/2026-06-14?track=1")
        assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 1"
        assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") is None
        with ctx.expect_page() as opened:
            page.locator(".lect-track .division-tab", has_text="독서 2").click(modifiers=["ControlOrMeta"])
        new_page = opened.value
        new_page.wait_for_url("**/lectionary/2026-06-14?track=2")   # 새 탭이 링크 href 로 간다
        assert page.url.endswith("/lectionary/2026-06-14?track=1")   # 지금 탭은 그대로
        assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 1"
        # 가드가 없으면 클릭 리스너가 기억을 2 로 바꾼다
        assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") is None
        new_page.close()
    finally:
        ctx.close()


def test_shared_link_with_state_lands_on_same_screen(desktop_context):
    """?obs= · ?track= · ?set= 가 든 링크는 그 화면 그대로(ADR-031 복원 · 공유 일관) — 셋 다 그날의 기본이 아닌 값으로."""
    page = desktop_context.new_page()
    obs = urllib.parse.quote("d0806-주의-변모")   # 8.9 의 초기 선택은 연중 19주일 — 주의 변모는 고른 것이다
    _open(page, f"lectionary/2026-08-09?obs={obs}")
    assert "주의 변모" in page.inner_text(".lect-chip[aria-current]")
    _open(page, "lectionary/2026-06-14?track=2")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 2"
    _open(page, "lectionary/2026-04-05?set=2")
    assert page.locator(".lect-sets .division-tab.active").inner_text() == "독서 2"


# ── ⑦ 탭 바 ──

def test_mobile_tab_bar_marks_calendar_tab_on_lectionary(mobile_context):
    """캘린더 탭 소속(ADR-038 §1 · §3) — 독서 화면에서 캘린더 탭이 활성이고 인디케이터가 그 탭에 선다."""
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-04-05")
    page.wait_for_selector("#tab-bar [data-tab='calendar'][aria-current='page']")
    assert page.eval_on_selector_all("#tab-bar .tab-item.active", "els => els.map(e => e.dataset.tab)") == ["calendar"]
    assert page.locator("#tab-bar .tab-indicator.is-shown").count() == 1
    # 칩은 가로 스크롤 줄 하나 — 모바일 폭에서도 전부 DOM 에 있다.
    assert len(_chips(page)) == 3
    # 홈 탭을 누르면 홈 스택으로 돌아간다(읽은 장이 없으니 가로채지 않고 기본 href).
    page.locator('#tab-bar [data-tab="home"]').click()
    page.wait_for_selector(".book-list")


def test_psalm_copy_carries_gloria_when_selected(desktop_context):
    """대림 4주일(2026-12-20) — 시편 끝 절에서 영광송까지 고르면 영광송이 시편 블록에 실리고(◯ 포함) 출처는 그 뒤 — 종전엔 빠졌다
    (머지 전 검토 2026-10-14)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-20")
    text = page.evaluate("""() => {
      const sec = document.querySelector(".lect-reading[data-slot='psalm']");
      const vs = sec.querySelectorAll('.verse[data-vref]');
      const last = vs[vs.length - 1];
      const vis = (n) => { const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let t; while ((t = w.nextNode()) && !/[^\\s\\u2060]/.test(t.textContent)); return t; };
      const a = vis(last);
      const resp = sec.querySelector('.lect-gloria .verse-response').firstChild;
      const r = document.createRange(); r.setStart(a, 1); r.setEnd(resp, resp.length);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      const dt = new DataTransfer();
      last.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
      return dt.getData('text/plain');
    }""")
    assert text == ("세상 임금 중에 가장 높은 임금으로 세우리라.\n\n영광이 성부와 성자와 성령께 ◯\n처음과 같이 지금도 그리고 영원히, 아멘."
                    "\n\n— 전례시편 89:27 (대한성공회 기도서)"), text


def test_gospel_copy_bridges_verse_numbers_absent_in_translation(desktop_context):
    """연중 7주 목요일(2027-05-20) 복음 「마르 9:41-50」 — 공동번역에 없는 44 · 46절을 사이에 두어도 출처는 「9:41-50」
    (사용자 결정 2026-10-14). 발췌가 건너뛴 절은 그대로 쉼표다(위 「118:2, 14」 테스트)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2027-05-20")
    assert "마르 9:41-50" in page.inner_text(".lect-reading[data-slot='gospel'] .lect-ref")
    sel = ".lect-reading[data-slot='gospel'] article.chapter-text .verse[data-vref]"
    text = page.evaluate(_LECT_COPY_ACROSS, [sel, f"{sel}:last-of-type"])
    assert text.endswith("\n\n— 마르코의 복음서 9:41-50 (공동번역성서)"), text[-80:]


def test_active_chip_and_card_keep_the_shown_track(desktop_context):
    """공유받은 「독서 2」 주소(보는 사람의 기억 없음)에서 지금 칩 · 카드를 눌러도 독서 2 — 칩 · 카드 링크가 화면의 트랙을 적는다
    (머지 전 검토 2026-10-14; 종전엔 트랙 없는 링크라 기억대로 독서 1 이 됐다)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14?track=2")
    chip = page.locator(".lect-chip[aria-current]")
    assert chip.get_attribute("href") == "/lectionary/2026-06-14?track=2"
    chip.click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 2"
    _open(page, "lectionary/2026-08-09?track=2")
    hrefs = page.eval_on_selector_all(".lect-pair-card", "els => els.map(e => e.getAttribute('href'))")
    assert any("track=2" in h for h in hrefs), hrefs   # 트랙이 있는 쪽(연중 주일) 카드는 그 트랙을 적는다
