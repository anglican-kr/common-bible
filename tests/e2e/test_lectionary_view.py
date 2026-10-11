"""E2E: 전례독서 뷰 /lectionary[/YYYY-MM-DD] (ADR-038 §3 A3).

엔진(resolveDate · findReadings · findCollects)이 낸 하루를 뷰(js/app/lectionary.js)가
어떻게 그리는지 — 라우팅 → 엔진 프리로드 → 장 JSON 선로드 → DOM 커밋의 모듈 간 배선과,
유닛이 못 보는 화면 동작(링크 클릭 · URL 상태 · localStorage 트랙 기억 · 탭 바)을 검증한다.

  ① 본문 순서 — 본기도 → 제1독서 → 시편(영광송 1회) → 제2독서 → 복음, 송영 1회
  ② 관측일 스위처 — 칩 전부 노출, 고르면 ?obs= 와 본문 · 색이 바뀐다
  ③ 두 독서 나란히 — 선택 봉헌 당일 · 목적지 주일 · 도착일 카드 둘
  ④ 대안 세트 · 트랙 — 세그먼트, 트랙은 전례년 단위로 기억
  ⑤ 기념일 칩 — 「기념일 — 본문 없음」
  ⑥ 날짜 — 오늘 · 전날/다음날 · 잘못된 날짜
  ⑦ 탭 바 — 캘린더 탭 소속이라(A2 전) 어느 탭도 활성이 아니다

실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「E2E 테스트」).
"""
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
    assert page.locator(".lect-collects .division-tab").count() == 3
    assert page.locator(".lect-collect-text").count() == 1
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
    page.wait_for_selector(".lect-collects .division-tab.active:has-text('2안')")
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

def test_track_toggle_persists_per_liturgical_year(desktop_context):
    """연중 11주일 — 독서 2 를 고르면 ?track=2 와 localStorage 기억, 다음 주일은 기억대로 독서 2."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    assert page.locator(".lect-track .division-tab").count() == 2
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 1"
    page.locator(".lect-track .division-tab", has_text="독서 2").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.wait_for_selector(".lect-track .division-tab.active:has-text('독서 2')")
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('bible-lectionary-track') || 'null')")
    assert stored == {"2026": 2}, stored   # 2026-06-14 는 전례년 2026(대림 2025 ~ 대림 2026 전)
    # 다음 주일로는 앱 안에서 이동한다 — desktop_context 의 init script 가 page.goto 마다
    # 앱 저장소(이 키 포함)를 지우므로, 전체 로드로 가면 기억이 아니라 초기화를 보게 된다.
    page.evaluate("() => window.navigate('/lectionary/2026-06-21')")
    page.wait_for_url("**/lectionary/2026-06-21")
    page.wait_for_selector(".lect-date time[datetime='2026-06-21']")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 2"
    assert "독서 2" in page.inner_text(".lect-chip[aria-current]")
    # 기억된 트랙이 기본값이 됐으므로 URL 에는 track 이 붙지 않는다.
    assert page.evaluate("() => location.search") == ""


def test_set_segment_shows_conditional_caption(desktop_context):
    """사순 2주일 가해 — 2안을 고르면 캡션 「주의 변모 주일로 지키는 경우」(미결38)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-03-01?set=2")
    assert page.locator(".lect-sets .division-tab.active").inner_text() == "2안"
    assert "주의 변모 주일로 지키는 경우" in page.inner_text(".lect-sets .lect-caption")


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
    today = datetime.date.today()
    assert page.get_attribute(".lect-date time", "datetime") == today.isoformat()
    page.locator(".lect-datenav-btn[aria-label='다음날']").click()
    page.wait_for_url(f"**/lectionary/{(today + datetime.timedelta(days=1)).isoformat()}")
    page.wait_for_selector(".lectionary")
    page.locator(".lect-datenav-btn[aria-label='전날']").click()
    page.wait_for_url(f"**/lectionary/{today.isoformat()}")


def test_invalid_date_shows_notice_not_crash(desktop_context):
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-13-99")
    assert page.inner_text(".empty-state-title") == "잘못된 날짜입니다"
    assert page.locator(".lect-reading").count() == 0


def test_shared_link_with_state_lands_on_same_screen(desktop_context):
    """?obs=&track=&set= 가 든 링크는 그 화면 그대로(ADR-031 복원 · 공유 일관)."""
    page = desktop_context.new_page()
    obs = urllib.parse.quote("grid:ordinary-19-sunday")
    _open(page, f"lectionary/2026-08-09?obs={obs}&track=2")
    assert "독서 2" in page.inner_text(".lect-chip[aria-current]")
    assert page.locator(".lect-track .division-tab.active").inner_text() == "독서 2"


# ── ⑦ 탭 바 ──

def test_mobile_tab_bar_has_no_active_tab_on_lectionary(mobile_context):
    """캘린더 탭 소속(A2 전) — 홈 탭이 활성으로 보이지 않고 인디케이터도 숨는다."""
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-04-05")
    assert page.locator("#tab-bar .tab-item.active").count() == 0
    assert page.locator("#tab-bar .tab-indicator.is-shown").count() == 0
    # 칩은 가로 스크롤 줄 하나 — 모바일 폭에서도 전부 DOM 에 있다.
    assert len(_chips(page)) == 3
    # 홈 탭을 누르면 홈 스택으로 돌아간다(캘린더 탭이 아니므로 가로채지 않고 기본 href).
    page.locator('#tab-bar [data-tab="home"]').click()
    page.wait_for_selector(".book-list")
