"""E2E: 전례독서 뷰 /lectionary[/YYYY-MM-DD] (ADR-038 §3 A3).

엔진(resolveDate · findReadings · findCollects)이 낸 하루를 뷰(js/app/lectionary.js)가
어떻게 그리는지 — 라우팅 → 엔진 프리로드 → 장 JSON 선로드 → DOM 커밋의 모듈 간 배선과,
유닛이 못 보는 화면 동작(링크 클릭 · URL 상태 · localStorage 트랙 기억 · 탭 바)을 검증한다.

  ① 본문 순서 — 본기도 → 제1독서 → 성시(영광송 1회) → 제2독서 → 복음, 송영 1회
  ② 전례일 스위처 — 고를 본문이 있는 후보는 제목 아래 전례독서 목록, 고르면 ?obs= 와 제목 · 본문 · 색이 바뀐다
  ③ 옮겨 지키는 축일 · 선택 봉헌 — 전례독서 목록으로 고른다(두 독서 카드는 없다)
  ④ 독서 카드 — 「또는」 대안과 트랙을 카드로 고르고 접으면 알약이나 번호, 트랙은 마지막 선택을 날짜 · 해와 무관하게 기억
  ⑤ 기념일 — 전례독서 목록이 아니라 제목 아래 「… 기념일」 줄, 본문 없는 날도 그 아래 이름 줄
  ⑥ 날짜 — 오늘 · 전날/다음날 · 잘못된 날짜
  ⑦ 탭 바 — 캘린더 탭 소속이라 독서 화면에서 캘린더 탭이 활성(ADR-038 A2)
  ⑧ 머리의 날짜 이동 줄(날짜 글자만 가운데) · 본문 제목과 공통 라벨 없음 · 응답 반행과 송영의 색

실데이터(data/ 서브모듈)가 필요하다 — 로컬 전용(CLAUDE.md 「테스트」).
"""
import re
import datetime
import json
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

from .conftest import CLEAR_APP_STORAGE, MOBILE_VIEWPORT, IPHONE_UA, SHOW_ALT_READINGS, emulate_status_bar, open_settings

BASE = "http://localhost:8080"

SLOT_ORDER = ["first", "psalm", "second", "gospel"]


def _open(page, path):
    page.goto(f"{BASE}/{path}")
    page.wait_for_selector(".lectionary", timeout=20_000)
    page.wait_for_timeout(100)


def _slots(page):
    return page.eval_on_selector_all(".lect-reading", "els => els.map(e => e.dataset.slot)")


def _choices(page):
    """제목 아래 전례독서 목록의 글 — 고른 후보는 제목이라 줄이 없다."""
    return page.eval_on_selector_all(".lect-choice", "els => els.map(e => e.textContent)")


def _colors(page):
    return page.eval_on_selector_all(".lect-color-item", "els => els.map(e => e.textContent)")


# ── ① 본문 순서 ──

def test_easter_day_renders_collect_then_four_readings_in_order(desktop_context):
    """부활대축일 — 본기도(대체안 셋) → 제1독서 → 성시(영광송) → 제2독서 → 복음, 송영 1회."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    assert page.inner_text(".lect-day") == "부활대축일"
    assert _colors(page) == ["백색"]
    # 본기도가 독서보다 앞에 온다.
    sections = page.eval_on_selector_all(".lect-section[data-slot]", "els => els.map(e => e.dataset.slot)")
    assert sections == ["collect"] + SLOT_ORDER, sections
    assert page.eval_on_selector_all(".lect-collects .lect-collect-num", "els => els.map(e => [e.textContent, e.getAttribute('aria-label')])") == [["1", "본기도 1"], ["2", "본기도 2"], ["3", "본기도 3"]]
    assert page.locator(".lect-collect-text").count() == 1
    # 원본 세트 둘 = 「또는」 대안 — 독서 카드로 통째로 고른다(사용자 결정 2026-11-05).
    assert page.eval_on_selector_all(".lect-card-name", "els => els.map(e => e.textContent)") == ["독서 1", "독서 2"]
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


def test_collect_alternative_number_switches_text_and_url(desktop_context):
    """본기도 대체안 번호를 누르면 주소에 ?collect=2가 적히고, 본문이 바뀌며 고른 번호가 옮겨 간다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    first = page.inner_text(".lect-collect-text")
    assert page.get_attribute(".lect-collects .lect-collect-num.active", "aria-label") == "본기도 1"
    page.locator(".lect-collects .lect-collect-num").nth(1).click()
    page.wait_for_url("**/lectionary/2026-04-05?collect=2")
    page.wait_for_selector(".lect-collects .lect-collect-num.active[aria-label='본기도 2'][aria-current='page']")
    assert page.locator(".lect-collects .lect-collect-num.active").count() == 1
    assert page.inner_text(".lect-collect-text") != first


_COLLECT_ROW_METRICS = """() => {
  const rect = (el) => el.getBoundingClientRect();
  const slot = rect(document.querySelector('.lect-collects .lect-slot'));
  const text = rect(document.querySelector('.lect-collect-text'));
  const nums = [...document.querySelectorAll('.lect-collects .lect-collect-num')].map(rect);
  const mark = getComputedStyle(document.querySelector('.lect-collects .lect-collect-num.active .lect-collect-num-mark'));
  const root = getComputedStyle(document.documentElement);
  const probe = document.createElement('i');
  probe.style.cssText = 'color: var(--accent); background-color: var(--bg)';
  document.body.appendChild(probe);
  const tokens = getComputedStyle(probe);
  const out = {
    slotGap: text.top - slot.bottom,
    sameRow: nums.every((n) => n.top < slot.bottom && n.bottom > slot.top),
    sizes: nums.map((n) => [Math.round(n.width), Math.round(n.height)]),
    markBg: mark.backgroundColor, markColor: mark.color,
    accent: tokens.color, bg: tokens.backgroundColor,
    tabs: document.querySelectorAll('.lect-collects .division-tabs').length,
    overflow: document.documentElement.scrollWidth - innerWidth,
    root: parseFloat(root.fontSize),
  };
  probe.remove();
  return out;
}"""


def test_collect_numbers_share_the_heading_row(desktop_context):
    """번호는 제목 옆 같은 줄이고 탭 영역은 44px이다. 고른 번호는 --accent로 채운 원에 --bg 글자다(사용자 결정 2026-11-05).
    제목과 기도문의 간격은 독서 제목과 같은 8px이고, 번호가 있어도 줄이 늘지 않는다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    m = page.evaluate(_COLLECT_ROW_METRICS)
    assert m["tabs"] == 0
    assert m["sameRow"], m
    assert m["sizes"] == [[44, 44]] * 3, m
    assert m["markBg"] == m["accent"] and m["markColor"] == m["bg"], m
    assert 7 <= m["slotGap"] <= 9, m
    # 번호가 없는 날(본기도 하나)도 제목과 기도문의 간격이 같다
    _open(page, "lectionary/2026-07-26")
    assert page.locator(".lect-collects .lect-collect-num").count() == 0
    gap = page.evaluate("""() => document.querySelector('.lect-collect-text').getBoundingClientRect().top
      - document.querySelector('.lect-collects .lect-slot').getBoundingClientRect().bottom""")
    assert abs(gap - m["slotGap"]) < 0.5, (gap, m)


def test_collect_numbers_fit_narrow_screen_with_largest_text(mobile_context):
    """320px 폭에 가장 큰 글자에서도 번호가 제목 옆 한 줄에 있고 가로로 넘치지 않는다. 세그먼트는 여기서 「본기도 / 1」로 꺾였다."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 320, "height": 640})
    _open(page, "lectionary/2026-04-05")
    page.evaluate("() => { document.documentElement.style.fontSize = '24px'; }")
    m = page.evaluate(_COLLECT_ROW_METRICS)
    assert m["root"] == 24
    assert m["sameRow"], m
    assert m["sizes"] == [[44, 44]] * 3, m
    assert m["overflow"] == 0, m


# ── ② 전례일 스위처 ──

def test_switcher_shows_every_candidate_and_changes_body_and_color(desktop_context):
    """9.16 니니안 ∧ 추계재 — 초기 독서는 격자(미결25), 색 [자, 백]; 사계재 줄을 고르면 ?obs=, 제목은 본문의 제목(사용자 결정 2026-11-05), 색 [자], 그 독서."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-09-16")
    assert page.inner_text(".lect-day") == "연중 24주 수요일"   # 기본 독서(격자)의 이름 — 지정 전례일은 니니안(2026-11-03)
    # 니니안은 전례독서 목록이 아니라 제목 아래 이름 줄(2026-11-03)
    assert page.inner_text(".lect-day-saints").startswith("니니안")
    assert _choices(page) == ["성직자의 성소를 위한 추계재"]
    assert _colors(page) == ["자색", "백색"]

    page.locator(".lect-choice", has_text="추계재").click()
    page.wait_for_url("**obs=t-*")
    page.wait_for_selector(".lect-day:has-text('추계재')")
    assert page.inner_text(".lect-day") == "성직자의 성소를 위한 추계재"
    assert _choices(page) == ["연중 24주 수요일"]
    assert _colors(page) == ["자색"]
    assert page.locator(".lect-card").count() == 2

    # 다른 전례일을 골라도 이름 줄은 그대로다. 본문 제목(「○○ 독서」)과 공통 분류 라벨은 없다(사용자 결정 2026-11-03).
    assert page.inner_text(".lect-day-saints").startswith("니니안")
    assert page.locator(".lect-reading-of").count() == 0
    assert page.locator(".lect-caption").count() == 0


def test_title_follows_the_choice_and_stays_in_place(desktop_context):
    """제목은 고른 전례일의 이름이다(사용자 결정 2026-11-04 — 그전엔 다른 후보를 골라도 기본 독서의 이름에 머물러 제목과 본문이 어긋났다).
    저녁 전례(설계서 R-6.1-evening — 사용자 결정 2026-10-15)의 대표는 그대로다: 성 토요일의 대표는 성 토요일(적색)이고, 부활밤을
    누르면 제목 부활밤, 「저녁 전례」, 백색, 부활밤 복음, ?obs=, 문서 제목도 부활밤이다. 그 문장이 줄 위에 생겨도 맨 위에서 눌렀으면
    화면을 스크롤하지 않아 제목과 머리 사이의 여백이 그대로다(사용자 결정 2026-11-03, 11-04). 줄을 누르면 돌아온다.
    성탄 밤은 12.24에 있고 12.25에는 없다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-04")
    assert page.inner_text(".lect-day") == "성 토요일"
    assert page.locator(".lect-day-note").count() == 0
    assert _colors(page) == ["적색"]
    assert page.title().startswith("성 토요일")
    assert _choices(page) == ["부활밤 · 저녁"]   # 성주간 토요일 격자는 본문이 없어 줄이 없다(2026-11-04)
    title_top = page.locator(".lect-day").bounding_box()["y"]
    page.locator(".lect-choice", has_text="부활밤").click()
    page.wait_for_selector(".lect-day:has-text('부활밤')")
    assert "obs=t-%EB%B6%80%ED%99%9C%EB%B0%A4" in page.url or "obs=t-부활밤" in urllib.parse.unquote(page.url)
    assert page.inner_text(".lect-day-note") == "저녁 전례"
    assert _choices(page) == ["성 토요일"]
    assert _colors(page) == ["백색"]
    assert "마태 28:1-10" in page.inner_text(".lect-reading[data-slot='gospel']")
    page.wait_for_function("() => document.title.startsWith('부활밤')")
    assert page.evaluate("() => window.scrollY") == 0
    assert page.locator(".lect-day").bounding_box()["y"] == title_top
    page.locator(".lect-choice", has_text="성 토요일").click()
    page.wait_for_selector(".lect-day:has-text('성 토요일')")
    assert page.locator(".lect-day").bounding_box()["y"] == title_top
    assert _colors(page) == ["적색"]

    _open(page, "lectionary/2026-12-24")
    assert page.inner_text(".lect-day") == "성탄 1일 전"
    assert _choices(page) == ["성탄 밤 · 저녁"]
    assert _colors(page) == ["자색", "대체 청색"]   # 그날 낮(대림 평일)의 색 · 대체색
    assert page.locator(".lect-chip, .lect-chips").count() == 0
    _open(page, "lectionary/2026-12-25")
    assert page.inner_text(".lect-day") == "성탄 낮"
    assert _choices(page) == ["성탄 새벽"]


def test_choice_rows_fit_on_phones_and_large_type(browser):
    """휴대폰 폭과 가장 큰 글자에서도 줄이 말줄임 없이 화면 안에 다 보인다 — 긴 줄은 줄을 바꾼다. 줄마다 탭 영역이 44px 이상이고
    (DESIGN.md §8) 이름은 색이 아니라 밑줄로도 구별한다(WCAG 1.4.1). 2025-06-11은 줄이 둘이고, 2100-10-31이 가장 긴 글이다."""
    measure = """() => ({
      rows: [...document.querySelectorAll('.lect-choice')].map((a) => {
        const r = a.getBoundingClientRect();
        const t = a.querySelector('.lect-choice-text');
        return { text: a.textContent, left: r.left, right: r.right, height: r.height,
                 clipped: t.scrollWidth - t.clientWidth,
                 underline: getComputedStyle(a.querySelector('.lect-choice-name')).textDecorationLine };
      }),
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })"""
    expected = {
        "2025-06-11": ["성직자의 성소를 위한 하계재", "연중 10주 수요일"],
        "2026-12-18": ["성직후보자의 성소를 위한 동계재", "수도자의 성소를 위한 동계재"],
        "2026-05-01": ["노동자의 날", "부활 4주 금요일"],
        "2028-01-02": ["공현대축일 · 1월 6일에서 옮겨 지킬 수 있음"],
        "2100-10-31": ["모든 성인의 날 · 11월 1일에서 옮겨 지킬 수 있음"],
        # 옮겨 지킬 수 있는 축일의 원래 날짜 — 평일 줄과, 평일을 고른 뒤의 축일 줄(사용자 결정 2026-11-06)
        "2027-11-01": ["연중 31주 월요일 · 모든 성인의 날 대체 독서"],
        "2027-11-01?obs=grid%3Aordinary-31-weekday-mon": ["모든 성인의 날 · 10월 31일로 옮겨 지킬 수 있음"],
    }
    for width, font in ((320, None), (375, None), (320, "24px")):
        ctx = browser.new_context(viewport={"width": width, "height": 740}, user_agent=IPHONE_UA)
        ctx.add_init_script(CLEAR_APP_STORAGE + SHOW_ALT_READINGS)
        try:
            page = ctx.new_page()
            for date, rows in expected.items():
                _open(page, f"lectionary/{date}")
                if font:
                    page.evaluate("(f) => { document.documentElement.style.fontSize = f; }", font)
                m = page.evaluate(measure)
                assert [r["text"] for r in m["rows"]] == rows, (width, font, date, m)
                assert m["over"] == 0, (width, font, date, m)
                for r in m["rows"]:
                    assert r["left"] >= 0 and r["right"] <= width, (width, font, date, r)
                    assert r["height"] >= 44, (width, font, date, r)
                    assert r["clipped"] <= 0, (width, font, date, r)
                    assert r["underline"] == "underline", (width, font, date, r)
        finally:
            ctx.close()


# ── ③ 옮겨 지키는 축일 · 선택 봉헌 — 전례독서 목록으로 고른다(두 독서 카드는 없다, 사용자 결정 2026-11-03) ──

def test_transferred_and_optional_days_choose_by_rows_without_cards(desktop_context):
    """8.6 주의 변모(목) · 8.9 목적지 주일(optional) · 12.7 니콜라 도착일 — 「두 독서 가운데 고르기」 카드 없이 전례독서 목록으로 고른다.
    12.7의 기본 독서는 옮겨 온 주요축일(성 니콜라)이다."""
    desktop_context.add_init_script(SHOW_ALT_READINGS)
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-08-06")
    assert page.locator(".lect-pair, .lect-pair-card").count() == 0
    page.locator(".lect-choice", has_text="연중 18주 목요일").click()
    page.wait_for_url("**obs=grid%3A*")
    page.wait_for_selector(".lect-day:has-text('연중 18주 목요일')")
    _open(page, "lectionary/2026-08-09")
    assert page.locator(".lect-pair-card").count() == 0
    assert any("8월 6일에서 옮겨 지킬 수 있음" in t for t in _choices(page)), _choices(page)
    _open(page, "lectionary/2026-12-07")
    assert page.locator(".lect-pair-card").count() == 0
    # 옮겨 온 것은 제목 아래 문장이고, 문장은 기리는 성인 줄(암브로스)보다 먼저다(2026-11-03). 전례독서 목록은 맨 아래다(2026-11-04).
    # 전례색과 해의 줄은 제목 바로 다음, 회색 설명 줄들보다 먼저다(사용자 결정 2026-11-03)
    assert page.inner_text(".lect-day").startswith("성 니콜라")
    assert "12월 6일에서 옮겨 옴" in page.inner_text(".lect-day-note")
    order = page.evaluate("""() => [...document.querySelectorAll('.lect-head > *')].map(e => e.className.split(' ')[0])""")
    assert order == ["lect-day", "lect-meta", "lect-day-note", "lect-day-saints", "lect-choices"], order


# ── ④ 대안 세트 · 트랙 ──

def test_track_toggle_persists_across_days_and_years(desktop_context):
    """연중 11주일 — 복음 주제를 고르면 ?track=2와 localStorage 기억, 다음 주일도 이듬해 주일도 기억대로 복음 주제(사용자 결정
    2026-10-13 — 「한번 선택하면 계속 일관성 있게 같은 트랙이 기본값」; 종전엔 전례년마다 따로 기억해 해가 바뀌면 연속 독서)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    assert page.locator("nav[aria-label='독서 선택'] .lect-card").count() == 2
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "연속 독서"
    page.locator(".lect-card", has_text="복음 주제").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.wait_for_selector(".lect-card.active:has-text('복음 주제')")
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") == "2"   # 전례년 키 없이 값 하나
    # 다음 주일로는 앱 안에서 이동한다 — desktop_context 의 init script 가 page.goto 마다
    # 앱 저장소(이 키 포함)를 지우므로, 전체 로드로 가면 기억이 아니라 초기화를 보게 된다.
    page.evaluate("() => window.navigate('/lectionary/2026-06-21')")
    page.wait_for_url("**/lectionary/2026-06-21")
    page.wait_for_selector(".lect-date time[datetime='2026-06-21']")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "복음 주제"
    assert page.locator(".lect-choices").count() == 0   # 후보가 하나뿐인 주일 — 전례독서 목록이 없고 트랙은 카드가 보인다(2026-11-05)
    # 기억에서 온 트랙도 주소에 적힌다 — 같은 주소가 기억과 무관하게 같은 화면(자체 리뷰 2026-10-13).
    assert page.evaluate("() => location.search") == "?track=2"
    # 이듬해(전례년 2027 — 대림 2026 뒤)의 연중 주일도 복음 주제.
    page.evaluate("() => window.navigate('/lectionary/2027-06-20')")
    page.wait_for_selector(".lect-date time[datetime='2027-06-20']")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "복음 주제"
    assert page.evaluate("() => location.search") == "?track=2"
    # 다시 연속 독서를 고르면 그것이 새 기본값 — 앞 해의 주일로 돌아가도 연속 독서.
    page.locator(".lect-card", has_text="연속 독서").click()
    page.wait_for_url("**/lectionary/2027-06-20?track=1")
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") == "1"
    page.evaluate("() => window.navigate('/lectionary/2026-06-21')")
    page.wait_for_selector(".lect-date time[datetime='2026-06-21']")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "연속 독서"


def test_reading_cards_sit_above_first_reading_and_list_every_item(desktop_context):
    """연중 11주일 — 독서 카드는 본기도 아래, 제1독서 바로 위에 있다. 네 항목을 모두 적고 두 카드에서 다른 성구를 표시하며, 같은 항목끼리
    줄이 맞는다. 고른 카드의 성구가 아래 독서 제목과 같다(사용자 결정 2026-11-05)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    order = page.eval_on_selector_all(".lectionary > *", "els => els.map(e => e.dataset.slot || e.className)")
    at = order.index("lect-section lect-cards")
    assert (order[at - 1], order[at + 1]) == ("collect", "first"), order
    assert page.locator(".lectionary .division-tab").count() == 0
    assert page.inner_text(".lect-cards .lect-slot") == "독서"
    cards = page.eval_on_selector_all(".lect-card", """els => els.map((c) => ({
        name: c.querySelector('.lect-card-name').textContent,
        refs: [...c.querySelectorAll('.lect-card-ref')].map((r) => r.textContent),
        differs: [...c.querySelectorAll('.lect-card-ref')].map((r) => r.classList.contains('lect-card-ref--differs')),
    }))""")
    assert [c["name"] for c in cards] == ["연속 독서", "복음 주제"]
    assert [c["differs"] for c in cards] == [[True, True, False, False]] * 2
    assert cards[0]["refs"] == page.eval_on_selector_all(".lect-reading .lect-ref", "els => els.map(e => e.textContent)")
    assert page.get_attribute(".lect-card.active", "aria-current") == "page"
    tops = page.evaluate("""() => [...document.querySelectorAll('.lect-card')].map((c) =>
        [...c.querySelectorAll('.lect-card-ref')].map((r) => Math.round(r.getBoundingClientRect().top)))""")
    assert tops[0] == tops[1], tops


def test_reading_card_marks_differing_refs_and_selected_border(desktop_context):
    """다른 성구는 굵기 500이고 같은 성구는 400이다. 고른 카드의 테두리는 고르지 않은 카드와 같은 1px이고 --accent의 60%이며, 이름 아래에 가로선이 있다.
    웹 글꼴을 쓰는 기기에서도 500으로 보이도록 글꼴 목록에 500이 있다(사용자 결정 2026-11-05)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    s = page.evaluate("""() => {
        const cs = (sel) => getComputedStyle(document.querySelector(sel));
        const active = cs('.lect-card.active'), other = cs('.lect-card:not(.active)');
        return {
            differs: cs('.lect-card-ref--differs').fontWeight,
            same: cs('.lect-card-ref:not(.lect-card-ref--differs)').fontWeight,
            widths: [active.borderTopWidth, other.borderTopWidth],
            activeColor: active.borderTopColor,
            shadow: active.boxShadow,
            line: cs('.lect-card-name').borderBottomWidth,
            fonts: document.querySelector('link[rel=stylesheet][href*="fonts.googleapis"]').href,
        };
    }""")
    assert (s["differs"], s["same"]) == ("500", "400"), s
    assert s["widths"] == ["1px", "1px"], s
    assert s["activeColor"].endswith("/ 0.6)"), s
    assert "inset" not in s["shadow"], s
    assert s["line"] == "1px", s
    assert "Noto+Sans+KR:wght@400;500;700" in s["fonts"], s


def test_reading_cards_fold_into_pills_and_stay_folded_on_every_day(mobile_context):
    """접으면 카드가 사라지고 제목 옆에 이름 알약이 남아 그 자리에서 바꾼다. 한 번 접으면 다른 날도 접혀 있고, 이름이 「독서 N」인 날은 본기도와
    같은 번호다. 포커스는 접기 단추에 남는다(사용자 결정 2026-11-05)."""
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-06-14")
    fold = page.locator(".lect-cards-fold")
    assert (fold.inner_text(), fold.get_attribute("aria-expanded"), fold.get_attribute("aria-label")) == ("접기", "true", "독서 목록 접기")
    assert page.locator(".lect-cards-list").is_visible()
    assert not page.locator(".lect-cards-pills").is_visible()

    fold.focus()
    page.keyboard.press("Enter")
    assert (fold.inner_text(), fold.get_attribute("aria-expanded"), fold.get_attribute("aria-label")) == ("", "false", "독서 목록 펼치기")
    assert page.evaluate("() => document.activeElement.classList.contains('lect-cards-fold')")
    assert not page.locator(".lect-cards-list").is_visible()
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-cards-folded')") == "1"
    pills = page.locator(".lect-cards-pills .lect-collect-num")
    assert [pills.nth(i).inner_text() for i in range(pills.count())] == ["연속 독서", "복음 주제"]
    assert page.locator(".lect-cards-pills .lect-collect-num.active").inner_text() == "연속 독서"

    # 접은 채로 바꾼다 — 트랙을 기억하고, 포커스는 누른 알약으로 돌아오며, 접힌 그대로다
    page.locator(".lect-cards-pills .lect-collect-num", has_text="복음 주제").focus()
    page.keyboard.press("Enter")
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.wait_for_selector(".lect-cards-pills .lect-collect-num.active:has-text('복음 주제')")
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") == "2"
    assert page.evaluate("() => document.activeElement.dataset.focusKey") == "folded:track:2"
    assert not page.locator(".lect-cards-list").is_visible()

    # 다른 날도 접혀 있다. 이름이 「독서 N」이면 번호이고 스크린 리더는 「독서 1」로 읽는다
    page.evaluate("() => window.navigate('/lectionary/2026-04-05')")
    page.wait_for_selector(".lect-date time[datetime='2026-04-05']")
    assert not page.locator(".lect-cards-list").is_visible()
    assert page.locator(".lect-cards-pills").count() == 0
    nums = page.eval_on_selector_all(".lect-cards .lect-collect-num", "els => els.map(e => [e.textContent, e.getAttribute('aria-label')])")
    assert nums == [["1", "독서 1"], ["2", "독서 2"]]

    # 펼치면 기억을 지운다
    page.locator(".lect-cards-fold").click()
    assert page.locator(".lect-cards-list").is_visible()
    assert not page.locator(".lect-cards .lect-collect-nums").is_visible()
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-cards-folded')") is None


def test_reading_cards_without_a_track_are_not_remembered(desktop_context):
    """대림 3주일 나해 — 시편 하나만 달라도 카드다. 부활대축일의 둘째 독서를 골라도 연중 주일의 트랙 기억은 그대로다(뜻이 달라 기억하지 않는다 —
    사용자 결정 2026-11-05)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-13")
    assert page.eval_on_selector_all(".lect-card-name", "els => els.map(e => e.textContent)") == ["독서 1", "독서 2"]
    flags = page.eval_on_selector_all(".lect-card:first-child .lect-card-ref", "els => els.map(e => e.classList.contains('lect-card-ref--differs'))")
    assert flags == [False, True, False, False]
    page.locator(".lect-card", has_text="독서 2").click()
    page.wait_for_url("**/lectionary/2026-12-13?set=2")
    page.wait_for_selector(".lect-card.active:has-text('독서 2')")
    assert page.inner_text(".lect-reading[data-slot='psalm'] .lect-ref") == "루가 1:46하-55 (성모송가)"
    page.evaluate("() => window.navigate('/lectionary/2026-04-05')")
    page.wait_for_selector(".lect-date time[datetime='2026-04-05']")
    page.locator(".lect-card", has_text="독서 2").click()
    page.wait_for_url("**/lectionary/2026-04-05?set=2")
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") is None
    page.evaluate("() => window.navigate('/lectionary/2026-06-14')")
    page.wait_for_selector(".lect-date time[datetime='2026-06-14']")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "연속 독서"


def test_reading_cards_fit_narrow_screen_with_largest_text(mobile_context):
    """320px 기본 글자에서는 두 장이 나란하고, 가장 큰 글자에서는 한 장씩 쌓이며 가로로 넘치지 않는다. 접은 알약과 접기 단추의 탭 영역은 44px이다
    (WCAG 1.4.10, 사용자 결정 2026-11-05). 긴 이름이 있는 사순 2주일로 본다."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 320, "height": 640})
    _open(page, "lectionary/2026-03-01")
    lefts = page.eval_on_selector_all(".lect-card", "els => els.map(e => Math.round(e.getBoundingClientRect().left))")
    assert lefts[0] < lefts[1], lefts
    # 한쪽 이름이 두 줄이어도 이름 아래 가로선의 높이가 같다
    lines = page.eval_on_selector_all(".lect-card-name", "els => els.map(e => Math.round(e.getBoundingClientRect().bottom))")
    assert lines[0] == lines[1], lines
    page.evaluate("() => { document.documentElement.style.fontSize = '24px'; }")
    lefts = page.eval_on_selector_all(".lect-card", "els => els.map(e => Math.round(e.getBoundingClientRect().left))")
    assert lefts[0] == lefts[1], lefts
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 320
    page.locator(".lect-cards-fold").click()
    assert page.evaluate("() => document.documentElement.scrollWidth") <= 320
    sizes = page.eval_on_selector_all(".lect-cards .lect-collect-num, .lect-cards-fold", """els => els.map((e) => {
        const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })""")
    assert all(w >= 44 and h >= 44 for w, h in sizes), sizes


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
    """트랙 없는 URL에서 복음 주제를 고른 뒤 뒤로 가기 — 기억이 2로 바뀌었어도 이전 화면(연속 독서)으로 돌아온다(Copilot 1회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "연속 독서"
    page.locator(".lect-card", has_text="복음 주제").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.wait_for_selector(".lect-card.active:has-text('복음 주제')")
    page.go_back()
    page.wait_for_url("**/lectionary/2026-06-14?track=1")   # 저장 전에 지금 항목에 트랙을 명시해 둔 것
    page.wait_for_selector(".lect-card.active:has-text('연속 독서')")
    # 기억은 2 그대로 — 다음에 트랙 없이 열면 복음 주제.
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") == "2"


def test_back_after_track_change_from_malformed_track_url(desktop_context):
    """`?track=3`처럼 깨진 값으로 연 화면(연속 독서로 떨어짐)에서 복음 주제를 고른 뒤 뒤로 가기 — 깨진 URL이 바뀐 기억(2)으로
    읽히지 않게 저장 전에 지금 항목에 track=1 을 명시한다(Copilot 5회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14?track=3")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "연속 독서"
    page.locator(".lect-card", has_text="복음 주제").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.wait_for_selector(".lect-card.active:has-text('복음 주제')")
    page.go_back()
    page.wait_for_url("**/lectionary/2026-06-14?track=1")
    page.wait_for_selector(".lect-card.active:has-text('연속 독서')")


def test_stale_lectionary_preload_failure_does_not_overwrite_new_route(browser):
    """전례독서 데이터 프리로드가 끝나기 전에 다른 화면으로 가고, 그 뒤 프리로드가 실패해도 새 화면이 남는다 —
    낡은 실패가 실패 화면으로 화면을 덮지 않는다(Copilot 5회차). 탭 제목도 새 화면의 것이다 — 라우터가 낡은 뷰의
    제목으로 페이지 메타를 고치지 않는다(routing.js openLazyView의 그린 뒤 검사 — PR #355 2회차 리뷰). 서비스 워커는 막아
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
        assert page.locator("#app .empty-state, #app .error").count() == 0
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


def test_ember_friday_two_rows_pick_title_readings_and_collect_without_common_caption(desktop_context):
    """추계재 금요일 — 성직후보자와 수도자는 전례독서 목록의 두 줄이고, 누르면 제목과 독서와 본기도가 함께 바뀐다(교차 조합이 없다 — 사용자 결정
    2026-10-13, 2026-11-05). 탭 단추와 「독서 · 본기도」 글자는 없고, 본기도 칸에도 번호가 없다.
    니니안(공통뿐인 성인)은 전례독서 목록에 없어 주소로 가리켜도 기본 독서(격자)이고, 공통 분류 라벨은 어디에도 없다(사용자 결정
    2026-11-03 — 그전엔 「선교사 공통 독서」 캡션)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-09-18")
    assert page.inner_text(".lect-day") == "연중 24주 금요일"
    assert _choices(page) == ["성직후보자의 성소를 위한 추계재", "수도자의 성소를 위한 추계재"]
    page.locator(".lect-choice", has_text="수도자의 성소").click()
    page.wait_for_url("**set=2")
    assert "collect=" not in page.url
    page.wait_for_selector(".lect-day:has-text('수도자의 성소를 위한 추계재')")
    assert _choices(page) == ["성직후보자의 성소를 위한 추계재", "연중 24주 금요일"]
    assert page.inner_text(".lect-collect-text").startswith("주 예수 그리스도여")
    assert "사무상 3:1-10" in page.inner_text(".lect-reading[data-slot='first'] .lect-ref")
    assert page.locator(".lect-collects .lect-collect-num").count() == 0
    assert page.locator(".lectionary .division-tab").count() == 0
    assert "독서 · 본기도" not in page.inner_text(".lectionary")
    page.wait_for_function("() => document.title.includes('수도자의 성소를 위한 추계재')")
    _open(page, "lectionary/2026-09-16?obs=d0916-%EB%8B%88%EB%8B%88%EC%95%88")
    assert page.inner_text(".lect-day").startswith("연중 24주 수요일")
    assert page.locator(".lect-caption").count() == 0


def test_may1_row_switches_to_labour_day_title_readings_and_collect(desktop_context):
    """5.1 — 사도 성 필립보와 성 야고보가 먼저이고, 지역 축일인 노동자의 날은 전례독서 목록의 한 줄로 제목과 독서와 본기도를 함께
    고른다(사용자 결정 2026-10-13, 2026-11-05 — 「대안 독서는 사도 축일, 본기도는 노동자의 날」 같은 교차 조합은 없다)."""
    desktop_context.add_init_script(SHOW_ALT_READINGS)
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-05-01")
    assert page.inner_text(".lect-day") == "사도 성 필립보와 성 야고보"
    assert _choices(page) == ["노동자의 날", "부활 4주 금요일"]
    assert page.locator(".lectionary .division-tab").count() == 0
    assert page.locator(".lect-collects .lect-collect-num").count() == 0
    collect0 = page.inner_text(".lect-collect-text")
    first0 = page.inner_text(".lect-reading[data-slot='first'] .lect-ref")
    page.locator(".lect-choice", has_text="노동자의 날").click()
    page.wait_for_url("**/lectionary/2026-05-01?set=2")
    page.wait_for_selector(".lect-day:has-text('노동자의 날')")
    assert _choices(page) == ["사도 성 필립보와 성 야고보", "부활 4주 금요일"]
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
    # 자른 절의 번호는 「35하」, 복사 출처도 「35하」다(사용자 결정 2026-10-22 — 종전 출처는 「104:24-35」로 35절 전체를 가리켰다)
    assert v35.locator(".verse-num").get_attribute("data-v") == "35하"
    assert page.evaluate(_LECT_COPY_SLOT, "psalm").endswith("\n\n— 전례시편 104:24-34, 35하 (대한성공회 기도서)")


_LECT_COPY_SLOT = """
(slot) => {
  const articles = document.querySelectorAll(`.lect-reading[data-slot='${slot}'] article.chapter-text`);
  const verses = [...articles].flatMap((a) => [...a.querySelectorAll('.verse')]);
  const r = document.createRange();
  r.setStartBefore(verses[0]);
  r.setEndAfter(verses[verses.length - 1]);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  const dt = new DataTransfer();
  articles[0].dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: dt }));
  return dt.getData('text/plain');
}
"""

_VERSE_NUMS = "els => els.map(e => e.getAttribute('data-v'))"


def test_half_verses_follow_the_boundary_table(desktop_context):
    """반절은 데이터의 경계 표대로 그린다(사용자 결정 2026-10-22). 한 줄 절도 줄 안에서 나누고, 여러 줄 절은 표의 줄까지
    그린다. 자른 절의 번호는 「4상」 「20하」로 보이고, 복사 출처에도 상 · 하를 붙인다."""
    page = desktop_context.new_page()
    # 줄 안의 상 — 사순 2주일 가해 「창세 12:1-4상」: 「…길을 떠났다.」까지(게시글 16312), 「롯도 함께 떠났다.」는 뺀다
    _open(page, "lectionary/2026-03-01")
    first = page.locator(".lect-reading[data-slot='first'] article.chapter-text")
    text = first.inner_text().replace("\u2060", "")   # 절 번호 뒤의 U+2060
    assert text.rstrip().endswith("길을 떠났다.") and "롯도 함께 떠났다" not in text, text[-120:]
    assert first.locator(".verse-num").evaluate_all(_VERSE_NUMS)[-1] == "4상"
    assert page.evaluate(_LECT_COPY_SLOT, "first").endswith("\n\n— 창세기 12:1-4상 (공동번역성서)")
    # 줄 안의 하 — 재의 수요일 「2고린 5:20하-6:10」: 「하느님과 화해하십시오.」부터(게시글 19870). 장을 넘는 출처도 「5:20하-6:10」
    _open(page, "lectionary/2026-02-18")
    second = page.locator(".lect-reading[data-slot='second'] article.chapter-text").first
    text = second.inner_text().replace("\u2060", "")
    assert text.lstrip().startswith("하느님과 화해하십시오.") and "그리스도의 사절로서" not in text, text[:120]
    assert second.locator(".verse-num").evaluate_all(_VERSE_NUMS)[0] == "20하"
    assert page.evaluate(_LECT_COPY_SLOT, "second").endswith("\n\n— 고린토인들에게 보낸 둘째 편지 5:20하-6:10 (공동번역성서)")
    # 줄 경계 — 「집회 51:12하-20상」: 12절은 둘째 줄부터, 20절은 앞의 두 줄까지(게시글 20007). 종전에는 20절 네 줄을 다 그렸다
    _open(page, "lectionary/2027-05-29")
    first = page.locator(".lect-reading[data-slot='first'] article.chapter-text")
    text = first.inner_text().replace("\u2060", "")   # 절 번호 뒤의 U+2060
    assert text.lstrip().startswith("주님의 이름을 찬미하옵니다.") and "이에 당신께 감사드리고" not in text, text[:120]
    assert text.rstrip().endswith("마침내 순결 속에서 지혜를 찾아내었다.") and "버림을 당하지 않을 것이다" not in text, text[-120:]
    nums = first.locator(".verse-num").evaluate_all(_VERSE_NUMS)
    assert (nums[0], nums[-1]) == ("12하", "20상"), nums
    assert page.evaluate(_LECT_COPY_SLOT, "first").endswith("\n\n— 집회서 51:12하-20상 (공동번역성서)")
    # 구간 사이의 상 — 「사도 2:14상, 22-32」: 출처는 「2:14상, 22-32」
    _open(page, "lectionary/2026-04-12")
    assert page.evaluate(_LECT_COPY_SLOT, "first").endswith("\n\n— 사도행전 2:14상, 22-32 (공동번역성서)")
    # 줄 안에서 자른 상 뒤에 다음 절이 같은 문단으로 이어지면 한 칸을 둔다 — 「사무하 7:18-20상, 24-29」(리뷰 2026-10-22)
    _open(page, "lectionary/2026-01-29")
    text = page.locator(".lect-reading[data-slot='first'] article.chapter-text").inner_text().replace("\u2060", "")
    assert "헤아릴 수 없습니다. 하느님께서는" in text and "종 다윗의 심정을" not in text, text[:200]


# 창세 28:10-19상(연중 16주일 가해, 2026-07-19)의 19절은 「그 곳을 베델이라 불렀다.」까지다(경계 문구 「베델이라 불렀다.」). 그 절의
# 남은 본문과 주석 단추마다 [어절(data-note-anchor), 보이는 글자]를 낸다.
_GEN28_19_NOTES = """
() => {
  const a = document.querySelector(".lect-reading[data-slot='first'] article.chapter-text");
  const v = [...a.querySelectorAll('.verse[data-vkey^="19/"]')];
  return {
    text: v.map((s) => s.textContent).join('').replace(/\\u2060/g, '').trim(),
    notes: v.flatMap((s) => [...s.querySelectorAll('.note-anchor')]).map((n) => [n.getAttribute('data-note-anchor'), n.textContent]),
  };
}
"""


@pytest.mark.parametrize("extra, why", [
    ({"anchor": "불렀다. 그", "body": "경계에 걸친 주석"}, "경계 문구가 어절 안에서 끝난다"),
    ({"anchor": " 그 마을의", "body": "경계에서 시작하는 주석"}, "버리는 쪽 어절이 경계에서 바로 시작한다"),
    ({"anchor": "", "body": "어절 없는 주석"}, "어절 없는 주석의 ※가 버리는 쪽 끝에 붙는다"),
])
def test_half_verse_cut_leaves_no_broken_note_button(desktop_context, extra, why):
    """반절 자르기는 주석을 감싼 뒤에 돈다(lectionary.js buildReading). 경계가 어절 주석 안에 떨어지면 그 주석을 풀어 보통 글자로
    두고, 버리는 쪽의 주석은 통째로 지운다. 반쪽 어절이나 빈 글자에 온전한 어절의 주석 단추가 남지 않는다(리뷰 2026-11-08, 구현하며
    정함). 실데이터에는 이런 절이 없고 lectionary.data.test.js 「반절 경계 표」가 막으므로, 장 JSON에 주석을 넣어 그린다."""
    data = json.loads((Path(__file__).resolve().parents[2] / "data" / "bible" / "gen-28.json").read_text(encoding="utf-8"))
    v19 = next(v for v in data["verses"] if v["number"] == 19)
    v19["notes"] = v19.get("notes", []) + [extra]
    page = desktop_context.new_page()
    page.route("**/data/bible/gen-28.json", lambda route: route.fulfill(json=data))
    _open(page, "lectionary/2026-07-19")
    got = page.evaluate(_GEN28_19_NOTES)
    assert got["text"].replace("※", "") == "그 곳을 베델이라 불렀다.", (why, got)
    assert ["베델", "베델"] in got["notes"], (why, got)
    assert all(anchor == shown for anchor, shown in got["notes"]), (why, got)   # 반쪽 어절이나 빈 단추가 없다


_WATCH_LOADING_FRAMES = """() => {
  window.__loadingFrames = 0;
  const tick = () => {
    if (document.querySelector('#app .loading')) window.__loadingFrames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""
_TWO_FRAMES = "() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))"


def test_missing_half_verse_table_draws_whole_verses(browser):
    """반절 경계 표를 받지 못해도 화면은 열리고, 반절 대신 절 전체를 그린다(업데이트 뒤 처음 오프라인으로 열면 데이터 캐시에
    이 표만 없을 수 있다). 다시 그릴 때는 큰 표 넷을 다시 받지 않고 「불러오는 중…」도 그리지 않는다 — 반절 표만 뒤에서 다시
    받는다. 이 PR의 첫 엔진은 표 하나 때문에 화면 전체를 실패 화면으로 그렸고(리뷰 1회차), 고친 엔진은 다시 그릴 때마다 묶음
    다섯을 다시 받았다(리뷰 2회차)."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    try:
        page = ctx.new_page()
        page.route("**/data/lectionary/half-verses.json", lambda route: route.abort())
        _open(page, "lectionary/2026-03-01")
        first = page.locator(".lect-reading[data-slot='first'] article.chapter-text")
        text = first.inner_text().replace("\u2060", "")
        assert "롯도 함께 떠났다" in text and text.rstrip().endswith("칠십오 세였다."), text[-120:]
        assert first.locator(".verse-num").evaluate_all(_VERSE_NUMS)[-1] == "4"
        # 다음날(새 장을 받는다)에 갔다가 장을 이미 받은 그날로 돌아온다
        page.locator(".lect-datenav-btn[data-focus-key='next']").click()
        page.wait_for_function(
            "() => location.pathname === '/lectionary/2026-03-02' && !!document.querySelector('.lect-reading')", timeout=20_000)
        requests = []
        page.on("request", lambda req: requests.append(req.url) if "/data/lectionary/" in req.url else None)
        page.evaluate(_WATCH_LOADING_FRAMES)
        page.locator(".lect-datenav-btn[data-focus-key='prev']").click()
        page.wait_for_function(
            "() => location.pathname === '/lectionary/2026-03-01' && !!document.querySelector('.lect-reading')")
        page.evaluate(_TWO_FRAMES)
        assert page.evaluate("() => window.__loadingFrames") == 0
        assert [u for u in requests if not u.endswith("/half-verses.json")] == [], requests
    finally:
        ctx.close()


# 반절 60곳 전부 — 엔진으로 찾은 화면(날짜, 후보 · 세트 · 트랙을 바꾼 쿼리, 슬롯)에서 확인한다. 데이터의 독서가 바뀌면
# 이 목록도 다시 만든다(그 화면에 반절이 없으면 「verse not drawn」으로 실패한다).
_HALF_VERSE_VIEWS = [  # (표 키 「책:장:절+a|b」, 날짜, 쿼리, 슬롯)
    ("1cor:12:31a", "2025-01-26", "", "second"),
    ("1cor:2:10b", "2026-09-01", "", "first"),
    ("1kgs:21:21a", "2025-06-15", "obs=grid%3Aordinary-11-sunday", "first"),
    ("1sam:24:23a", "2026-01-23", "", "first"),
    ("1tim:6:2b", "2027-09-17", "", "first"),
    ("2cor:11:21b", "2025-06-20", "", "first"),
    ("2cor:5:20b", "2025-03-05", "", "second"),
    ("2kgs:19:21a", "2026-06-23", "", "first"),
    ("2pet:3:15a", "2026-06-02", "", "first"),
    ("2sam:7:14a", "2027-07-18", "", "first"),
    ("2sam:7:20a", "2026-01-29", "", "first"),
    ("2thess:2:3a", "2026-08-25", "", "first"),
    ("acts:13:14b", "2025-06-24", "", "second"),
    ("acts:15:22a", "2025-10-23", "", "first"),
    ("acts:2:14a", "2026-04-12", "", "first"),
    ("acts:2:47a", "2025-01-17", "obs=d0117-%EC%95%88%ED%86%A0%EB%8B%88%EC%98%A4&set=3", "first"),
    ("acts:8:1a", "2025-05-06", "obs=grid%3Aeaster-3-weekday-tue", "first"),
    ("acts:8:1b", "2025-05-07", "", "first"),
    ("amos:6:1a", "2025-09-28", "track=2", "first"),
    ("exod:19:8a", "2026-06-14", "track=2", "first"),
    ("gen:12:4a", "2026-03-01", "", "first"),
    ("gen:28:19a", "2026-07-19", "", "first"),
    ("gen:2:4a", "2025-02-11", "", "first"),
    ("gen:2:4b", "2025-02-12", "", "first"),
    ("hag:1:15b", "2025-11-09", "", "first"),
    ("isa:25:10a", "2025-12-03", "", "first"),
    ("isa:45:21b", "2026-12-16", "", "first"),
    ("isa:45:6b", "2026-12-16", "", "first"),
    ("isa:50:9a", "2025-04-13", "", "first"),
    ("isa:56:3a", "2033-12-16", "", "first"),
    ("isa:58:9a", "2025-03-07", "", "first"),
    ("isa:58:9b", "2025-03-08", "", "first"),
    ("isa:63:19b", "2026-11-29", "", "first"),
    ("jas:4:8a", "2027-09-19", "", "second"),
    ("jer:32:3a", "2025-09-28", "", "first"),
    ("job:19:27a", "2025-11-09", "track=2", "first"),
    ("john:13:31b", "2025-04-17", "", "gospel"),
    ("john:16:4b", "2027-05-16", "", "gospel"),
    ("john:19:16b", "2025-04-18", "set=2", "gospel"),
    ("john:21:19b", "2025-12-27", "", "gospel"),
    ("josh:24:2a", "2027-08-22", "track=2", "first"),
    ("josh:24:3a", "2026-11-08", "", "first"),
    ("lps:104:35b", "2025-06-08", "", "psalm"),
    ("luke:15:11b", "2025-03-22", "", "gospel"),
    ("mal:3:20a", "2025-10-09", "", "first"),
    ("mark:6:6a", "2025-02-05", "", "gospel"),
    ("mic:5:4a", "2027-12-19", "", "first"),
    ("num:14:1a", "2025-08-06", "obs=grid%3Aordinary-18-weekday-wed", "first"),
    ("num:21:4b", "2025-09-15", "obs=d0914-%EC%84%B1-%EC%8B%AD%EC%9E%90%EA%B0%80%EC%9D%98-%EB%82%A0", "first"),   # 9.14 주일에서 옮겨 온 날 — 옮겨 간 날(9.14)에는 전례독서 목록에 없다(2026-11-04)
    ("phil:3:4b", "2025-04-06", "", "second"),
    ("rev:1:4b", "2027-11-21", "", "second"),
    ("rev:21:6a", "2027-10-31", "obs=d1101-%EB%AA%A8%EB%93%A0-%EC%84%B1%EC%9D%B8%EC%9D%98-%EB%82%A0", "second"),
    ("rom:11:2a", "2026-08-16", "", "second"),
    ("rom:3:22b", "2026-05-31", "obs=grid%3Aordinary-9-sunday", "second"),
    ("rom:7:25a", "2026-07-05", "", "second"),
    ("sir:51:12b", "2027-05-29", "", "first"),
    ("sir:51:20a", "2027-05-29", "", "first"),
    ("tob:13:3b", "2025-09-24", "", "psalm"),
    ("tob:13:6b", "2025-09-24", "", "psalm"),
]

_HALF_CHECK = """
async ([key, slot]) => {
  const [, book, ch, v, half] = /^(\\w+):(\\d+):(\\d+)([ab])$/.exec(key);
  const table = await (await fetch('/data/lectionary/half-verses.json')).json();
  const e = table.entries.find((x) => x.bookId === book && x.chapter === +ch && x.verse === +v && x.half === half);
  const data = await (await fetch(`/data/bible/${book}-${ch}.json`)).json();
  const verse = data.verses.find((x) => x.number === +v && !x.part && !x.lxx_only && x.chapter_ref == null && x.alt_ref == null && !x.versicle);
  const lines = (verse.segments || [{ text: verse.text || '' }]).flatMap((s) => s.text.split('\\n')).filter((l) => l !== '');
  let want = lines.join('');
  if (!e.whole) {
    const i = e.line - 1;
    if (!e.text) want = (half === 'a' ? lines.slice(0, e.line) : lines.slice(i)).join('');
    else {
      const p = lines[i].indexOf(e.text);
      want = half === 'a' ? lines.slice(0, i).join('') + lines[i].slice(0, p + e.text.length) : lines[i].slice(p) + lines.slice(i + 1).join('');
    }
  }
  const norm = (s) => s.replace(/[\\s\\u2060¶◯]/g, '');
  for (const a of document.querySelectorAll(`.lect-reading[data-slot='${slot}'] article.chapter-text[data-chapter='${ch}']`)) {
    const spans = [...a.querySelectorAll(`.verse[data-vkey^="${v}/"]`)];
    if (!spans.length) continue;
    const num = spans[0].querySelector('.verse-num')?.getAttribute('data-v') || '';
    const label = e.whole ? '' : (half === 'a' ? '상' : '하');
    return { ok: norm(spans.map((s) => s.textContent).join('')) === norm(want) && num === `${v}${label}`, num };
  }
  return { ok: false, num: 'verse not drawn' };
}
"""


# 성인 공통 독서에 든 반절(사도 2:47상 — 2025-01-17 안토니오 공통 독서 3). 공통 독서를 감추는 동안은 화면에 없다.
_HIDDEN_COMMON_HALF_VERSES = {"acts:2:47a"}


def test_every_half_verse_follows_the_table(desktop_context):
    """반절 참조 60곳(전례독서 59 · 성인 공통 1)을 모두 화면에서 그려, 그린 글자가 데이터의 경계 표대로인지와 절 번호의
    「상」 · 「하」를 본다(사용자 결정 2026-10-22). 로마 3:22하는 「전체」라 번호가 「22」다."""
    table = json.loads((Path(__file__).resolve().parents[2] / "data" / "lectionary" / "half-verses.json").read_text(encoding="utf-8"))
    keys = {f"{e['bookId']}:{e['chapter']}:{e['verse']}{e['half']}" for e in table["entries"]}
    assert [k for k, *_ in _HALF_VERSE_VIEWS] == sorted(keys)   # 표의 행마다 화면이 하나씩(60곳)
    page = desktop_context.new_page()
    bad = []
    for key, date, query, slot in _HALF_VERSE_VIEWS:
        _open(page, f"lectionary/{date}" + (f"?{query}" if query else ""))
        if key in _HIDDEN_COMMON_HALF_VERSES:
            # 성인 공통 독서는 당분간 보이지 않는다(lectionary.js HIDE_COMMON_READINGS, 사용자 결정 2026-11-03) — 그 성인의 전례독서 목록이
            # 없고 주소로 가리켜도 기본 독서다. 감추기를 끄면 이 확인이 실패한다 — 그때 목록을 비워 다시 검사한다.
            assert page.locator(".lect-choice", has_text="안토니오").count() == 0, "공통 독서 감추기가 꺼졌다 — 목록을 비울 것"
            continue
        page.wait_for_selector(f".lect-reading[data-slot='{slot}'] article.chapter-text .verse", timeout=20_000)
        r = page.evaluate(_HALF_CHECK, [key, slot])
        if not r["ok"]:
            bad.append((key, date, query, r))
    assert not bad, bad


def test_data_half_verse_numbers_show_printed_letters(desktop_context):
    """연중 15주 화 짝수해(2026-07-14)의 제1독서 이사 7:1-9 — 데이터의 반쪽 절 번호는 장 화면과 같이 「8ㄱ」 「9ㄴ」이다
    (사용자 결정 2026-10-22, 종전 「8a」). 독서 참조의 「상 · 하」와는 다른 표기이고, 한 절에서 겹치지 않는다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-07-14")
    first = page.locator(".lect-reading[data-slot='first']")
    assert "7:1-9" in first.locator(".lect-ref").inner_text()
    nums = first.locator(".verse-num").evaluate_all("els => els.map(e => e.getAttribute('data-v'))")
    assert nums[6:11] == ["7", "8ㄱ", "9ㄱ", "8ㄴ", "9ㄴ"], nums


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


def test_copy_cites_data_half_verse_with_printed_letter(desktop_context):
    """연중 15주 화 짝수해(2026-07-14)의 제1독서 이사 7:1-9 — 끌어 고른 복사도 장 본문 복사, 절 선택 복사와 같이 데이터의
    반쪽 절 하나는 「8ㄱ」으로 적는다(사용자 결정 2026-11-07, known-issues §16.1 — 종전 「7:7-8」). 두 반쪽을 다 고른 독서
    전체는 「7:1-9」 그대로다. 독서표의 반절 「상 · 하」와는 다른 표기다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-07-14")
    first = ".lect-reading[data-slot='first'] article.chapter-text"
    text = page.evaluate(_LECT_COPY_ACROSS, [f"{first} .verse[data-vkey='7/7a']", f"{first} .verse[data-vkey='8a/8aa']"])
    assert text.endswith("\n\n— 이사야 7:7, 8ㄱ (공동번역성서)"), text[-80:]
    assert page.evaluate(_LECT_COPY_SLOT, "first").endswith("\n\n— 이사야 7:1-9 (공동번역성서)")


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
        # 다음 행동은 「다시 불러오기」 — 그날을 다시 연다(그전엔 단추가 없었다 — PR #355 리뷰). 머리에는 컨트롤이 없다 — 캘린더로는
        # 탭 바로 간다(사용자 결정 2026-11-03 — 그전엔 「캘린더로」 꺾쇠).
        assert page.inner_text(".empty-state-subtitle") == "네트워크 연결을 확인한 뒤 「다시 불러오기」를 눌러 주세요."
        assert page.locator(".state-action button").inner_text() == "다시 불러오기"
        assert page.locator("#page-title a").count() == 0
    finally:
        ctx.close()


def test_year_outside_gregorian_range_is_rejected_not_hung(desktop_context):
    """0100년 — 엔진이 날짜를 넘기지 못해 멈추던 범위는 뷰가 먼저 거른다(자체 리뷰 2026-10-13)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/0100-06-01")
    assert page.inner_text(".empty-state-title") == "교회력을 계산할 수 없는 날짜입니다"
    assert page.inner_text(".empty-state-subtitle") == "「이번 달 캘린더」를 눌러 다른 날짜를 골라 주세요."
    assert page.locator(".state-action a").get_attribute("href") == "/calendar"


def test_long_ember_title_wraps_at_320px(browser):
    """320px — 「성직후보자의 성소를 위한 동계재」 제목이 잘리거나 가로 스크롤을 만들지 않고, 낱말 사이에서 꺾인다(WCAG 1.4.10). 줄은 전례독서 목록 시험이 본다."""
    ctx = browser.new_context(viewport={"width": 320, "height": 640})
    page = ctx.new_page()
    try:
        _open(page, "lectionary/2026-12-18?obs=t-%EB%8F%99%EA%B3%84%EC%9E%AC")
        assert page.inner_text(".lect-day") == "성직후보자의 성소를 위한 동계재"
        assert page.evaluate("() => document.documentElement.scrollWidth") <= 320
        over = page.evaluate("""() => { const t = document.querySelector('.lect-day'); return t.scrollWidth > t.clientWidth + 1; }""")
        assert not over
        assert page.evaluate("() => getComputedStyle(document.querySelector('.lect-day')).wordBreak") == "keep-all"
    finally:
        ctx.close()


def test_day_change_announces_date_and_observance(desktop_context):
    """화면 안에서 다음날로 가면 라이브 영역이 「전례독서」가 아니라 그날(날짜 — 전례일)을 읽는다(자체 리뷰 2026-10-13)."""
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


def test_magnificat_is_named_one_way(desktop_context):
    """성모송가는 어느 날이나 라벨이 「루가 1:46하-55 (성모송가)」이고 옆에 이름을 다시 붙이지 않으며, 복사 출처도 「성모송가」다
    (사용자 결정 2026-11-05). 원본 표기가 서로 달랐던 네 날을 본다."""
    page = desktop_context.new_page()
    psalm = ".lect-reading[data-slot='psalm']"
    for path in ("lectionary/2026-12-20", "lectionary/2026-01-13", "lectionary/2026-08-15", "lectionary/2026-12-08?set=2"):
        _open(page, path)
        assert page.inner_text(f"{psalm} .lect-ref") == "루가 1:46하-55 (성모송가)", path
        assert page.locator(f"{psalm} .lect-canticle").count() == 0, path
    sel = f"{psalm} article.chapter-text .verse[data-vref]"
    text = page.evaluate(_LECT_COPY_ACROSS, [sel, sel])
    assert re.search(r"\n\n— 성모송가 1 \(대한성공회 기도서\)$", text), text[-80:]


def test_other_canticles_are_named_one_way(desktop_context):
    """즈가리야 송가와 이사야 첫째 송가도 어느 날이나 「성구 (이름)」 한 표기이고 옆에 이름을 다시 붙이지 않는다. 원본 표기가
    서로 달랐던 두 날씩을 본다. 기도서가 성구를 적지 않는 하느님 찬미송가는 이름만 적고, 복사 출처도 그 이름이다(사용자 결정 2026-11-05)."""
    page = desktop_context.new_page()
    psalm = ".lect-reading[data-slot='psalm']"
    for path, label in (
        ("lectionary/2027-12-05", "루가 1:68-79 (즈가리야 송가)"),
        ("lectionary/2028-11-26", "루가 1:68-79 (즈가리야 송가)"),
        ("lectionary/2027-12-12", "이사 12:2-6 (이사야 첫째 송가)"),
        ("lectionary/2028-11-19", "이사 12:2-6 (이사야 첫째 송가)"),
        ("lectionary/2027-11-22?set=2", "하느님 찬미송가"),
    ):
        _open(page, path)
        assert page.inner_text(f"{psalm} .lect-ref") == label, path
        assert page.locator(f"{psalm} .lect-canticle").count() == 0, path
    sel = f"{psalm} article.chapter-text .verse[data-vref]"
    text = page.evaluate(_LECT_COPY_ACROSS, [sel, sel])
    assert re.search(r"\n\n— 하느님 찬미송가 1 \(대한성공회 기도서\)$", text), text[-80:]


def test_psalm_copy_keeps_liturgical_marks(desktop_context):
    """대림 4주일(2026-12-20) 시편 89:1-4, 19-27 을 통째로 복사하면 ◯ · ¶ 가 실린다 — ¶ 뒤 한 칸, 출처는 「(대한성공회 기도서)」
    (사용자 결정 2026-10-13 — known-issues §4). 부 소제목 「(1)」 · 「(2)」는 봉독면에 그리지 않아 복사에도 없다(사용자 결정
    2026-11-08). 시편 89는 둘째 세트다(data#42가 성모송가를 첫 세트로 두었다)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-20?set=2")
    verses = ".lect-reading[data-slot='psalm'] article.chapter-text .verse[data-vref]"
    text = page.evaluate(_LECT_COPY_ACROSS, [verses, f"{verses}:last-of-type"])
    assert text.startswith("주여, 내가 당신의 사랑을 영원히 노래하리이다. ◯\n"), text[:120]
    assert "왕노릇하게 하리라.”\n\n그 옛날, 당신께서 스스로 나타나시어, ◯\n" in text, text
    assert "\n¶ “나는 용사들 위에" in text, text
    assert text.endswith("\n\n— 전례시편 89:1-4, 19-27 (대한성공회 기도서)"), text[-80:]


def test_reading_hides_psalm_section_headings(desktop_context):
    """긴 시편의 부 소제목 「(1)」 「(2)」는 봉독면에 그리지 않는다(사용자 결정 2026-11-08). 장 본문 /lps/89 에는 남는다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-20?set=2")
    psalm = ".lect-reading[data-slot='psalm'] article.chapter-text"
    assert page.locator(f"{psalm} .verse").count() > 0
    assert page.locator(".lectionary .psalm-section").count() == 0
    assert not re.search(r"^\(\d+\)$", page.inner_text(psalm), re.M)
    page.goto(f"{BASE}/lps/89")
    page.wait_for_selector("article.chapter-text .verse")
    assert page.locator(".psalm-section").count() == 2


def test_song_reading_hides_speaker_lines(desktop_context):
    """성 막달라 마리아(07-22) 제1독서 아가 3:1-4 — 4절 끝의 화자 줄 「(신랑)」을 그리지 않고, 그 앞의 연 구분도 남기지 않는다
    (사용자 결정 2026-11-08). 장 본문 /song/3 에는 남는다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-07-22")
    first = ".lect-reading[data-slot='first'] article.chapter-text"
    assert page.inner_text(".lectionary .lect-reading[data-slot='first'] .lect-ref") == "아가 3:1-4"
    text = page.inner_text(first)
    assert "바로 이 방으로 들어왔다네" in text, text
    assert "(신랑)" not in text, text
    assert page.eval_on_selector(first, "a => a.lastElementChild.classList.contains('verse')")
    page.goto(f"{BASE}/song/3")
    page.wait_for_selector("article.chapter-text .verse")
    assert "(신랑)" in page.inner_text("article.chapter-text")


def test_verse_ids_are_unique_across_slots_and_chapters(desktop_context):
    """한 화면에 슬롯 넷 · 장 여럿이 있어도 절 id 가 겹치지 않는다 — 슬롯 · 책 · 장 접두(Copilot 7회차)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2025-06-22")
    dup = page.evaluate("() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.length - new Set(ids).size; }")
    assert dup == 0
    assert page.locator("[id^='psalm-lps-43-v']").count() > 0


def test_back_to_earlier_day_keeps_its_track_after_memory_changes(desktop_context):
    """06-07(연속 독서)에서 06-14로 가서 복음 주제를 고른 뒤 06-07로 돌아와도 연속 독서 — 렌더 때 그 항목에 트랙을 적어 두므로
    바뀐 기억으로 다시 읽히지 않는다(자체 리뷰 2026-10-13)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-07")
    page.wait_for_url("**/lectionary/2026-06-07?track=1")
    page.evaluate("() => window.navigate('/lectionary/2026-06-14')")
    page.wait_for_url("**/lectionary/2026-06-14?track=1")
    page.locator(".lect-card", has_text="복음 주제").click()
    page.wait_for_url("**/lectionary/2026-06-14?track=2")
    page.go_back()
    page.wait_for_url("**/lectionary/2026-06-14?track=1")
    page.go_back()
    page.wait_for_url("**/lectionary/2026-06-07?track=1")
    page.wait_for_selector(".lect-card.active:has-text('연속 독서')")


def test_conditional_set_condition_is_the_label(desktop_context):
    """사순 2주일 가해 — 조건이 카드 이름이다: 「사순 2주일」 / 「주의 변모 주일로 지킬 때」(미결38). 고르면 제목만 「주의 변모 주일」로 바뀌고
    색과 본기도는 그대로다(사용자 결정 2026-11-05)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-03-01")
    assert page.eval_on_selector_all(".lect-card-name", "els => els.map(e => e.textContent)") == ["사순 2주일", "주의 변모 주일로 지킬 때"]
    assert page.inner_text(".lect-day") == "사순 2주일"
    colors = _colors(page)
    collect = page.inner_text(".lect-collect-text")
    page.locator(".lect-card", has_text="주의 변모 주일로 지킬 때").click()
    page.wait_for_url("**/lectionary/2026-03-01?set=2")
    page.wait_for_selector(".lect-day:has-text('주의 변모 주일')")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "주의 변모 주일로 지킬 때"
    assert page.inner_text(".lect-reading[data-slot='gospel'] .lect-ref") == "마태 17:1-9"
    assert _colors(page) == colors
    assert page.inner_text(".lect-collect-text") == collect
    page.wait_for_function("() => document.title.includes('주의 변모 주일')")


def test_bracket_set_merges_into_long_text_with_markers(desktop_context):
    """연중 11주일 가해 — 괄호 선택 구절 세트는 카드가 아니라 긴 본문 + 〔 〕 표시 + 「짧게 읽으면 …」 주석."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-14")
    assert page.locator(".lect-card").count() == 2          # 트랙마다 한 장 — 괄호 세트는 합쳐져 카드가 늘지 않는다
    note = page.locator(".lect-optional-note")
    assert note.count() == 1 and "짧게 읽으면" in note.inner_text()
    brackets = page.locator(".lect-bracket")
    assert brackets.count() >= 2 and brackets.count() % 2 == 0
    assert page.locator(".verse.lect-optional").count() > 0
    # 선택 구절은 그 슬롯 하나에만.
    assert page.eval_on_selector_all(".lect-reading:has(.lect-bracket)", "els => els.length") == 1


# 성탄 낮 제2독서 「히브 1:1-4, 5-12」의 선택 구절 5-12절. 12절 끝의 운문 칩 「(시편 102:25-27)」(10-12절이 같은 인용이라 12절에만)과 괄호.
_HEB1_CLOSE = """
() => {
  const sec = document.querySelector(".lect-reading[data-slot='second']");
  const chip = sec.querySelector(".cite-chip[data-cite-src='시편 102:25-27']");
  const brackets = [...sec.querySelectorAll('.lect-bracket')];
  return {
    elements: brackets.map((b) => b.textContent).join(''),
    shown: brackets.filter((b) => b.getClientRects().length > 0).map((b) => b.textContent).join(''),
    chipShown: getComputedStyle(chip).display !== 'none',
    chipCloses: chip.classList.contains('lect-chip-closes') && getComputedStyle(chip, '::after').content === '"〕"',
    lastLine: chip.previousElementSibling.getAttribute('data-vkey'),
    text: sec.querySelector('article.chapter-text').innerText,
  };
}
"""


def _copy_with_and_without_brackets(page, slot):
    """독서 하나를 복사한 글을, 괄호를 그대로 두고 한 번, 괄호를 모두 지우고 한 번 낸다. 괄호는 복사에 들지 않으므로 둘이 같아야 한다."""
    kept = page.evaluate(_LECT_COPY_SLOT, slot)
    page.evaluate("document.querySelectorAll('.lect-bracket').forEach((b) => b.remove())")
    return kept, page.evaluate(_LECT_COPY_SLOT, slot)


def test_bracket_closes_after_the_last_optional_verse_cite_chip(desktop_context):
    """괄호 선택 구절 묶음의 마지막 절에 인용 칩이 있으면 칩까지 〔 〕 안에 든다(코드 리뷰 2026-11-08, 구현하며 정함). 성탄 낮
    (2026-12-25) 제2독서 「히브 1:1-4, 5-12」의 12절은 운문이라 칩이 제 줄에 서고, 〕는 그 칩 줄 끝에 CSS 생성 글자로 온다. 〕 요소는
    묶음마다 하나이고(절 끝), 칩이 보이는 동안 감춰진다. 칩을 감추면(설정 끔) 절 끝의 〕가 보여 칩이 없는 묶음과 같은 글이 된다.
    괄호와 칩은 복사에 들지 않는다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-25")
    second = page.locator(".lect-reading[data-slot='second']")
    assert "히브 1:1-4, 5-12" in second.locator(".lect-ref").inner_text()
    on = page.evaluate(_HEB1_CLOSE)
    assert on["lastLine"] == "12/12d", on                      # 칩은 선택 구절 묶음의 마지막 줄 바로 뒤에 있다
    assert on["elements"] == "〔〕" and on["shown"] == "〔" and on["chipShown"] and on["chipCloses"], on
    assert "늙지 않으십니다.” 〕" not in on["text"], on["text"][-120:]   # 절 끝의 〕는 칩이 보이는 동안 감춰진다
    # 끔 흉내 — 설정을 끄면 CSS(body.cites-shown 없음)가 칩을 감춘다. 〕는 12절 끝에 보이고, 칩이 없는 묶음과 같은 글이다.
    page.evaluate("document.body.classList.remove('cites-shown')")
    off = page.evaluate(_HEB1_CLOSE)
    assert off["shown"] == "〔〕" and not off["chipShown"], off
    assert "늙지 않으십니다.” 〕" in off["text"], off["text"][-120:]
    page.evaluate("document.body.classList.add('cites-shown')")
    kept, plain = _copy_with_and_without_brackets(page, "second")
    assert kept == plain, (kept[-200:], plain[-200:])
    assert "〔" not in kept and "〕" not in kept and "(시편 102" not in kept, kept[-200:]
    assert kept.endswith("늙지 않으십니다.”\n\n— 히브리인들에게 보낸 편지 1:1-12 (공동번역성서)"), kept[-120:]


def test_brackets_hold_a_prose_chip_and_a_parallel_marker(desktop_context):
    """줄글 칩과 병행 본문 ※도 괄호 안에 든다(리뷰 2026-11-08, 구현하며 정함). 실데이터에는 줄글 칩이 묶음 끝에 오거나 ※가 묶음 첫 절
    앞에 오는 곳이 없어(2026-11-08 셈), 연중 23주일 나해(2027-09-05) 제2독서 「야고 2:1-10, 11-13, 14-17」의 장 JSON에 13절 인용과
    11-13절 병행 본문을 넣어 그린다. 〔는 ※ 앞에, 〕는 칩 뒤의 공백 다음에 선다. 칩과 ※를 감추면 칩이 없는 묶음과 같은 글이다.
    복사한 글은 그대로다."""
    data = json.loads((Path(__file__).resolve().parents[2] / "data" / "bible" / "jas-2.json").read_text(encoding="utf-8"))
    for v in data["verses"]:
        if v["number"] == 13:
            v["segments"][-1]["cite"] = "마태 5:7"
    data["parallels"] = [{"src": [{"ref": "로마 13:9"}], "range": "2:11-13"}]
    page = desktop_context.new_page()
    page.route("**/data/bible/jas-2.json", lambda route: route.fulfill(json=data))
    _open(page, "lectionary/2027-09-05")
    assert "야고 2:1-10, 11-13, 14-17" in page.locator(".lect-reading[data-slot='second'] .lect-ref").inner_text()
    order = page.evaluate("""() => {
      const sec = document.querySelector(".lect-reading[data-slot='second']");
      const par = sec.querySelector('.parallel-anchor');
      const chip = sec.querySelector(".cite-chip[data-cite-src='마태 5:7']");
      const name = (e) => e ? (e.classList.contains('lect-bracket') ? e.textContent : e.getAttribute('data-vkey') || e.className) : null;
      return [name(par.previousElementSibling), name(par.nextElementSibling), name(chip.previousElementSibling), name(chip.nextElementSibling)];
    }""")
    assert order == ["〔", "11/11a", "13/13", "〕"], order
    shown = lambda: page.inner_text(".lect-reading[data-slot='second'] article.chapter-text")
    # 〕는 칩 뒤의 절 사이 공백 다음에 온다(views.js citePieceSpace) — 칩이 없는 묶음의 「…. 〕」와 같은 간격이다
    assert "심판을 이깁니다.(마태 5:7) 〕" in shown(), shown()
    page.evaluate("document.body.classList.remove('cites-shown')")
    assert "심판을 이깁니다. 〕" in shown(), shown()   # 칩을 감추면 칩이 없는 묶음과 같다(main의 글)
    page.reload()
    page.wait_for_selector(".lect-reading .verse", timeout=20_000)
    kept, plain = _copy_with_and_without_brackets(page, "second")
    assert kept == plain, (kept[:300], plain[:300])
    assert "〔" not in kept and "〕" not in kept and "(마태 5:7)" not in kept and "※" not in kept
    assert "그러나 자비는 심판을 이깁니다.\n\n나의 형제 여러분" in kept, kept


# ── ⑤ 기념일 ──

def test_sick_day_is_an_alternate_reading(mobile_context):
    """2.11 병자를 위한 기도일 — 처음 화면은 그날의 평일이고, 「대체 독서」 줄을 누르면 그 본기도와 독서를 보인다. 본기도의 이름 자리는
    줄바꿈 없는 공백이라 줄어들거나 줄이 나뉘지 않는다(사용자 결정 2026-11-07, ADR-038 §3)."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 320, "height": 720})
    _open(page, "lectionary/2028-02-11")
    assert page.inner_text(".lect-day") == "연중 5주 금요일"
    assert _choices(page) == ["병자를 위한 기도일 · 대체 독서"], _choices(page)
    assert _colors(page) == ["녹색"]
    assert page.locator(".lect-day-note").count() == 0
    assert page.locator(".lect-day-saint", has_text="병자").count() == 0

    page.locator(".lect-choice", has_text="병자를 위한 기도일").click()
    page.locator(".lect-day", has_text="병자를 위한 기도일").wait_for()
    assert "obs=" in page.url
    assert page.inner_text(".lect-day-note") == "대체 독서"
    assert _choices(page) == ["연중 5주 금요일"], _choices(page)
    assert _colors(page) == ["자색"]   # 고를 때만 기도서의 자색이다
    labels = page.eval_on_selector_all(".lect-card-name", "els => els.map(e => e.textContent)")
    assert labels == ["독서 1", "독서 2"], labels
    blank = page.evaluate("""() => {
      const node = document.querySelector('.lect-collect-text').firstChild;
      const text = node.textContent;
      const range = document.createRange();
      range.setStart(node, text.indexOf('(') + 1);
      range.setEnd(node, text.indexOf(')'));
      return { text: range.toString(), rects: range.getClientRects().length, width: range.getBoundingClientRect().width,
               after: text.slice(text.indexOf(')') + 1, text.indexOf(')') + 4) };
    }""")
    assert set(blank["text"]) == {"\u00a0"}, blank
    assert blank["rects"] == 1, blank     # 줄이 나뉘지 않는다
    assert blank["width"] > 48, blank     # 공백이 하나로 줄어들지 않았다(세 글자 이름이 들어간다)
    assert blank["after"] == "을/를", blank
    # 캘린더 칸은 그날의 전례일 색이다
    page.goto(f"{BASE}/calendar/2028-02")
    cell = page.locator('a[href="/lectionary/2028-02-11"]').first
    cell.wait_for()
    assert cell.get_attribute("aria-label") == "2월 11일 금요일, 병자를 위한 기도일, 녹색"


def test_commemoration_is_a_line_not_a_chip(desktop_context):
    """4.5 마틴 루터 킹(기념일)은 전례독서 목록이 아니라 제목 아래 「… 기념일」 줄이다 — 고유 본기도와 독서가 없어 전례독서 목록을 고르면 본문 없는
    화면뿐이었다(사용자 결정 2026-11-03). 주소로 가리켜도 기본 독서다. 본문 없는 날(1.1 세계평화를 위한 기도일, 8.9 평화통일주일)도
    전례독서 목록이 아니라 기념일 줄 아래에 이름만 한 줄이다(사용자 결정 2026-11-04)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-05")
    assert page.locator(".lect-choice", has_text="마틴 루터 킹").count() == 0
    lines = page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)")
    assert len(lines) == 1 and lines[0].startswith("마틴 루터 킹") and lines[0].endswith(" 기념일"), lines
    _open(page, "lectionary/2026-04-05?obs=d0405-%EB%A7%88%ED%8B%B4-%EB%A3%A8%ED%84%B0-%ED%82%B9")
    assert page.locator(".empty-state").count() == 0
    assert page.locator(".lect-reading").count() > 0
    # 세계평화를 위한 기도일은 기도서에 본기도와 독서가 없다(설계서 미결51) — 전례독서 목록에 없고 이름 줄에 「… 기도일」 그대로
    _open(page, "lectionary/2026-01-01")
    assert page.locator(".lect-choice", has_text="세계평화").count() == 0
    lines = page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)")
    assert lines[-1] == "세계평화를 위한 기도일", lines
    _open(page, "lectionary/2026-01-01?obs=" + urllib.parse.quote("d0101-세계평화를-위한-기도일"))
    assert page.locator(".empty-state").count() == 0
    assert page.locator(".lect-reading").count() > 0
    # 평화통일주일은 성인이 없는 주일이라 이름 줄이 그 한 줄뿐이다
    _open(page, "lectionary/2026-08-09")
    assert page.locator(".lect-choice", has_text="평화통일").count() == 0
    assert page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)") == ["평화통일주일"]


def test_parish_dedications_are_lines_below_the_day_names(desktop_context):
    """그날 축성되거나 축복된 교회는 이름 줄 맨 아래에 종류마다 한 줄이다. 교회 이름을 쉼표로 잇고 「축성일」 · 「축복일」은
    한 번만 붙이며, 「북.」으로 시작하는 성당(북한에 있던 성당)은 보이지 않는다(사용자 결정 2026-11-04). 데이터 본당 표
    (local-observances.json) 2026-04-21은 축성 하나(강릉), 축복 하나(세종), 05-16은 북한 성당 둘뿐이다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-04-21")
    lines = page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)")
    assert lines[-2:] == ["강릉성당 축성일", "세종성당 축복일"], lines
    # 다른 전례일(안셀름, 부활 4주 화요일 격자)을 골라도 제목 아래 줄은 그대로다
    for obs in ["d0421-안셀름", "grid:easter-4-weekday-tue"]:
        _open(page, "lectionary/2026-04-21?obs=" + urllib.parse.quote(obs))
        assert page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)")[-2:] == lines[-2:], obs
    _open(page, "lectionary/2026-05-16")
    assert "북." not in page.inner_text(".lect-head")
    assert "축성일" not in page.inner_text(".lect-head")


def test_grid_without_own_text_or_with_same_text_has_no_chip(desktop_context):
    """왕이신 그리스도 주일의 연중 34주일 격자는 본문이 없고, 대림1주일의 대림 1주일 격자는 본문이 같다 — 둘 다 전례독서 목록에 없어 그날
    전례독서 목록이 없다(사용자 결정 2026-11-04). 격자를 주소로 가리켜도 기본 독서다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-11-22")
    assert page.inner_text(".lect-day") == "왕이신 그리스도 주일"
    assert page.locator(".lect-choices").count() == 0
    assert page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)") == ["세실리아(로마의 순교자, 230년경) 축일"]
    _open(page, "lectionary/2026-11-22?obs=grid:ordinary-34-sunday")
    assert page.locator(".empty-state").count() == 0
    assert "에제 34:11-16, 20-24" in page.inner_text(".lect-reading[data-slot='first']")
    _open(page, "lectionary/2026-11-29")
    assert page.inner_text(".lect-day") == "대림1주일"
    assert page.locator(".lect-choices").count() == 0
    assert page.locator(".lect-reading").count() == 4


def test_transferred_out_feast_is_a_sentence_not_a_chip(desktop_context):
    """옮겨 간 축일은 원래 날짜에서 전례독서 목록이 아니라 제목 아래 문장이다(사용자 결정 2026-11-04). 주소로 가리켜도 그날 독서이고,
    옮겨 간 날(12.7)에는 그 전례독서 목록과 독서가 그대로 있다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-06")
    assert page.inner_text(".lect-day") == "대림 2주일"
    assert page.locator(".lect-choices").count() == 0
    assert page.inner_text(".lect-day-note") == "성 니콜라 축일을 12월 7일로 옮김"
    order = page.evaluate("""() => [...document.querySelectorAll('.lect-head > *')].map(e => e.className.split(' ')[0])""")
    assert order == ["lect-day", "lect-meta", "lect-day-note"], order
    first = page.inner_text(".lect-reading[data-slot='first']")
    _open(page, "lectionary/2026-12-06?obs=d1206-성-니콜라")
    assert page.inner_text(".lect-reading[data-slot='first']") == first
    _open(page, "lectionary/2026-12-07")
    assert page.inner_text(".lect-day").startswith("성 니콜라")
    # 「날」로 끝나는 이름은 「축일」을 붙이지 않는다
    _open(page, "lectionary/2025-11-02")
    assert page.inner_text(".lect-day-note") == "모든 별세자의 날을 11월 3일로 옮김"


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
    """지금 포커스 — 그 컨트롤의 자리(data-focus-key) · 화면 안인지(브라우저가 화면 끝에 맞출 때 소수점 차이가 남아 1px 여유를 둔다) · :focus-visible."""
    return page.evaluate("""() => {
        const a = document.activeElement;
        const r = a ? a.getBoundingClientRect() : null;
        return { key: a?.dataset?.focusKey || null, inView: !!r && r.top >= 0 && r.bottom <= innerHeight + 1,
                 visible: !!a?.matches(':focus-visible') };
    }""")


def _enter_on(page, selector):
    """사람이 Tab으로 갈 때처럼 브라우저의 부드러운 스크롤이 끝난 뒤 누른다 — 독서 카드는 높아서 화면 아래쪽에 걸치기 쉽다."""
    page.locator(selector).focus()
    page.wait_for_function("""() => { const r = document.activeElement.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight + 1; }""")
    page.keyboard.press("Enter")


def test_redraws_keep_keyboard_focus_on_the_pressed_control(desktop_context):
    """키보드로 날짜 이동(다음날 · 전날 · 오늘) · 전례독서 목록 · 세그먼트(트랙 · 세트) · 본기도 번호를 눌러 #app을 다시
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
    # 전례독서 목록 — 누른 줄은 제목으로 올라가 사라지므로 같은 자리의 줄로 돌아온다. Enter를 거듭 누르면 오간다(사용자 결정 2026-11-04)
    _enter_on(page, ".lect-choice:has-text('추계재')")
    page.wait_for_selector(".lect-day:has-text('추계재')")
    assert _focused(page) == {"key": "choice:0", **ok}
    page.keyboard.press("Enter")
    page.wait_for_url("**/lectionary/2026-09-16")
    page.wait_for_selector(".lect-day:has-text('연중 24주 수요일')")
    assert _focused(page) == {"key": "choice:0", **ok}
    # 세트 카드(추계재 — 독서 1 · 2)
    _enter_on(page, ".lect-choice:has-text('추계재')")
    page.wait_for_selector(".lect-day:has-text('추계재')")
    _enter_on(page, ".lect-card >> nth=1")
    page.wait_for_url("**set=2")
    page.wait_for_function("() => document.querySelectorAll('.lect-card')[1]?.classList.contains('active')")
    assert _focused(page) == {"key": "set:2", **ok}
    # 트랙 카드 · 본기도 번호
    _open(page, "lectionary/2026-06-14")
    _enter_on(page, ".lect-card:has-text('복음 주제')")
    page.wait_for_selector(".lect-card.active:has-text('복음 주제')")
    assert _focused(page) == {"key": "track:2", **ok}
    _open(page, "lectionary/2026-04-05")
    _enter_on(page, ".lect-collects .lect-collect-num >> nth=1")
    page.wait_for_selector(".lect-collects .lect-collect-num.active[aria-label='본기도 2']")
    assert _focused(page) == {"key": "collect:2", **ok}
    # 오늘 — 브라우저의 날짜로
    today = datetime.date(*page.evaluate("() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()]; }"))
    _enter_on(page, "#page-title .lect-today")
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
    seg = page.locator(".lect-card >> nth=1")
    # 카드를 화면 위에서 100px 자리로 — 2026-11-04부터 이날은 전례독서 목록이 없어(부활 1주일 격자는 본문이 없다) 컨트롤이 위로
    # 올라왔다. 200px 자리로는 스크롤이 83px뿐이라 「맨 위가 아닌 자리」가 되지 않았다.
    page.evaluate("""(el) => { const r = el.getBoundingClientRect();
        window.scrollTo({ top: window.scrollY + r.top - 100, behavior: 'instant' }); }""", seg.element_handle())
    page.evaluate("() => document.fonts.ready.then(() => 0)")   # 글꼴이 바뀌면 전례독서 목록이 다시 감겨 카드가 움직인다
    before = page.evaluate("(el) => ({ y: scrollY, top: el.getBoundingClientRect().top })", seg.element_handle())
    assert before["y"] > 100, before   # 맨 위가 아닌 자리에서 누른다
    seg.focus()
    page.keyboard.press("Enter")
    page.wait_for_url("**/lectionary/2026-04-05?set=2")
    page.wait_for_selector(".lect-card.active:has-text('독서 2')")   # 복원은 이 커밋 안에서 끝난다
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
        seg = page.locator(".lect-card >> nth=1")
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
        page.wait_for_selector(".lect-card.active:has-text('독서 2')", timeout=20_000)
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
    page.locator(".lect-card >> nth=1").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector(".loading")
    page.locator("#search-input").focus()
    page.keyboard.type("love")
    page.wait_for_selector(".lect-card.active:has-text('독서 2')", timeout=20_000)
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
    """Ctrl/Cmd+클릭(새 탭)은 지금 탭의 주소 · 트랙 기억을 건드리지 않는다 — 라우터와 같은 기본 클릭 검사(Copilot 3회차).
    앱 저장소를 지우는 init script가 없는 컨텍스트에서 본다 — 새 탭이 열리며 기억을 지우면 검사 없이도 통과하므로."""
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        _open(page, "lectionary/2026-06-14")
        page.wait_for_url("**/lectionary/2026-06-14?track=1")
        assert page.locator(".lect-card.active .lect-card-name").inner_text() == "연속 독서"
        assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") is None
        with ctx.expect_page() as opened:
            page.locator(".lect-card", has_text="복음 주제").click(modifiers=["ControlOrMeta"])
        new_page = opened.value
        new_page.wait_for_url("**/lectionary/2026-06-14?track=2")   # 새 탭이 링크 href 로 간다
        assert page.url.endswith("/lectionary/2026-06-14?track=1")   # 지금 탭은 그대로
        assert page.locator(".lect-card.active .lect-card-name").inner_text() == "연속 독서"
        # 검사가 없으면 클릭 리스너가 기억을 2로 바꾼다
        assert page.evaluate("() => localStorage.getItem('bible-lectionary-track')") is None
        new_page.close()
    finally:
        ctx.close()


def test_shared_link_with_state_lands_on_same_screen(desktop_context):
    """?obs= · ?track= · ?set= 가 든 링크는 그 화면 그대로(ADR-031 복원 · 공유 일관) — 셋 다 그날의 기본이 아닌 값으로."""
    page = desktop_context.new_page()
    obs = urllib.parse.quote("d0806-주의-변모")   # 8.9 의 초기 선택은 연중 19주일 — 주의 변모는 고른 것이다
    _open(page, f"lectionary/2026-08-09?obs={obs}")
    assert "주의 변모" in page.inner_text(".lect-day")
    _open(page, "lectionary/2026-06-14?track=2")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "복음 주제"
    _open(page, "lectionary/2026-04-05?set=2")
    assert page.locator(".lect-card.active .lect-card-name").inner_text() == "독서 2"


# ── ⑦ 탭 바 ──

def test_mobile_tab_bar_marks_calendar_tab_on_lectionary(mobile_context):
    """캘린더 탭 소속(ADR-038 §1 · §3) — 독서 화면에서 캘린더 탭이 활성이고 인디케이터가 그 탭에 선다."""
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-04-05")
    page.wait_for_selector("#tab-bar [data-tab='calendar'][aria-current='page']")
    assert page.eval_on_selector_all("#tab-bar .tab-item.active", "els => els.map(e => e.dataset.tab)") == ["calendar"]
    assert page.locator("#tab-bar .tab-indicator.is-shown").count() == 1
    # 부활대축일은 전례독서 목록이 없다 — 부활 1주일 격자는 본문이 없고(2026-11-04) 마틴 루터 킹 기념일은 이름 줄이다(2026-11-03).
    assert page.locator(".lect-choices").count() == 0
    # 홈 탭을 누르면 홈 스택으로 돌아간다(읽은 장이 없으니 가로채지 않고 기본 href).
    page.locator('#tab-bar [data-tab="home"]').click()
    page.wait_for_selector(".book-list")


def test_psalm_copy_carries_gloria_when_selected(desktop_context):
    """대림 4주일(2026-12-20) — 시편 끝 절에서 영광송까지 고르면 영광송이 시편 블록에 실리고(◯ 포함) 출처는 그 뒤 — 종전엔 빠졌다
    (머지 전 검토 2026-10-14). 시편 89는 둘째 세트다(data#42가 성모송가를 첫 세트로 두었다)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-12-20?set=2")
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


# ── ⑧ 머리의 날짜 이동 줄 · 본문 색(사용자 결정 2026-11-03) ──

def _title_date(page):
    """머리에 보이는 날짜 글자와 「오늘」, 앞뒤 단추의 자리."""
    return page.evaluate("""() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const shown = document.querySelector('#page-title .lect-date-label [aria-hidden]');
      const d = shown.getBoundingClientRect(), t = r('#page-title .lect-today');
      return { text: shown.textContent, left: d.left, right: d.right, mid: (d.left + d.right) / 2, top: d.top, bottom: d.bottom,
               todayLeft: t.left, todayRight: t.right, todayMid: (t.top + t.bottom) / 2,
               prev: r("#page-title a.lect-datenav-btn[aria-label='전날']").left,
               next: r("#page-title a.lect-datenav-btn[aria-label='다음날']").right,
               view: r('#page-title .title-view-btn').left,
               height: r('#page-title').height, scrollWidth: document.documentElement.scrollWidth };
    }""")


def test_title_row_is_the_date_nav_and_only_the_date_text_is_centered(mobile_context):
    """머리의 제목 자리가 날짜 이동 줄(오늘, ‹ 날짜 ›, 보기 전환 단추)이고 본문 맨 위의 날짜 줄은 없다. 보이는 날짜는 YY.MM.DD이고
    요일이 없으며, 스크린 리더는 전체 날짜를 읽는다. 날짜 글자는 화면 가운데에 있다(사용자 결정 2026-11-05, 배치는 2026-11-07)."""
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-12-30")
    title = page.locator("#page-title")
    assert title.locator("a.lect-datenav-btn[aria-label='전날']").count() == 1
    assert title.locator("a.lect-datenav-btn[aria-label='다음날']").count() == 1
    assert title.locator("a.lect-today").inner_text() == "오늘"
    assert title.locator(".lect-date time").get_attribute("datetime") == "2026-12-30"
    assert title.locator(".lect-date time .sr-only").inner_text() == "2026년 12월 30일 (수)"
    assert title.locator(".title-view-btn").get_attribute("href") == "/calendar/2026-12"
    assert not title.locator(".title-home-btn").is_visible()   # 집 단추는 탭 바가 없는 데스크톱에만 보인다
    assert "전례독서" in page.evaluate("() => document.title")   # 「전례독서」는 문서 제목에 남는다
    # 탭 영역 44px — 줄 높이는 제목 한 줄 그대로(음수 여백)
    box = title.locator("a.lect-datenav-btn[aria-label='다음날']").bounding_box()
    assert box and box["width"] >= 44 and box["height"] >= 44, box
    assert title.bounding_box()["height"] < 40

    assert _title_date(page)["text"] == "26.12.30"
    for width in (320, 375, 390, 430):
        page.set_viewport_size({"width": width, "height": 844})
        state = _title_date(page)
        assert abs(state["mid"] - width / 2) <= 1, (width, state)
        assert state["todayRight"] <= state["prev"] and state["next"] <= state["view"], (width, state)
    _open(page, "lectionary/2027-01-02")   # 월과 일은 두 자리다
    assert _title_date(page)["text"] == "27.01.02"


def test_title_date_steps_start_the_new_day_at_the_top(mobile_context):
    """날짜 이동은 스크롤해도 보이는 머리에 있다 — 읽던 자리에서 다음날을 누르면 새 날은 맨 위부터이고, 포커스는 누른 단추에
    남는다. 같은 날의 전례독서 목록은 누른 자리를 지킨다(위 「다시 그린 뒤 포커스」 테스트)."""
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-11-02")
    page.evaluate("() => window.scrollTo({ top: 1500, behavior: 'instant' })")
    page.wait_for_function("() => window.scrollY > 1000")
    page.locator("#page-title a.lect-datenav-btn[aria-label='다음날']").click()
    page.wait_for_selector("#page-title .lect-date time[datetime='2026-11-03']")
    page.wait_for_selector(".lect-reading")
    page.wait_for_timeout(200)
    assert page.evaluate("() => window.scrollY") == 0
    assert page.evaluate("() => document.activeElement.dataset.focusKey") == "next"


def test_reading_title_and_common_labels_are_gone(desktop_context):
    """「모든 별세자의 날 독서」 같은 본문 제목 줄이 없다 — 머리의 제목이 같은 이름이다. 공통 독서 · 공통 본기도의 분류 라벨도
    없다(9.16 니니안 — 공통뿐인 성인)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-11-02")
    assert page.locator(".lect-reading-of").count() == 0
    assert page.inner_text(".lect-day").startswith("모든 별세자의 날")
    _open(page, "lectionary/2026-09-16")
    assert page.locator(".lect-reading").count() > 0
    assert page.locator(".lect-caption").count() == 0
    assert "공통" not in page.inner_text(".lect-collects")


def test_psalm_response_and_collect_ending_keep_the_text_colour(desktop_context):
    """시편의 응답 반행 · 영광송의 응답은 선창과 같은 색이고(◯ 가 경계를 보인다), 본기도 뒤 송영은 본기도 본문과 같은 색이다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-11-02")
    colours = page.evaluate("""() => {
      const c = (s) => getComputedStyle(document.querySelector(s)).color;
      return { verse: c(".lect-reading[data-slot='psalm'] .verse:not(.verse-response)"),
               response: c(".lect-reading[data-slot='psalm'] .verse.verse-response"),
               gloria: c(".lect-gloria-line.verse-response"),
               collect: c(".lect-collect-text"), ending: c(".lect-ending") };
    }""")
    assert colours["response"] == colours["verse"], colours
    assert colours["gloria"] == colours["verse"], colours
    assert colours["ending"] == colours["collect"], colours


def test_single_candidate_day_has_no_choice_rows(mobile_context):
    """후보 전례일이 하나뿐인 날(2026-11-07 연중 31주 토요일)은 전례독서 목록을 그리지 않는다 — 고를 것이 없고 머리의 전례일 이름이
    같다(사용자 결정 2026-11-03, ADR-038 §3 「후보 전례일이 여럿이면」). 여럿인 날(11-02)은 그대로다."""
    mobile_context.add_init_script(SHOW_ALT_READINGS)
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-11-07")
    assert page.locator(".lect-choices").count() == 0
    assert page.inner_text(".lect-day") == "연중 31주 토요일"
    assert page.locator(".lect-reading").count() > 0
    _open(page, "lectionary/2026-11-02")
    assert page.locator(".lect-choice").count() == 1


def test_title_date_stays_on_one_line_with_the_largest_font_on_320px(mobile_context):
    """글자 크기 24px(설정의 가장 큰 값)로 320px에서도 날짜와 「오늘」이 한 줄에 다 보인다. 자리가 모자라면 왼쪽 빈칸이 줄어
    날짜가 가운데에서 조금 왼쪽으로 옮겨 가고, 앞뒤 단추와 겹치거나 가로로 넘치지 않는다."""
    page = mobile_context.new_page()
    page.set_viewport_size({"width": 320, "height": 700})
    _open(page, "lectionary/2026-12-30")
    page.evaluate("() => { document.documentElement.style.fontSize = '24px'; }")
    state = _title_date(page)
    assert state["todayRight"] <= state["prev"] and state["next"] <= state["view"], state   # 세 칸이 겹치지 않는다
    assert state["top"] <= state["todayMid"] <= state["bottom"], state   # 「오늘」은 날짜와 같은 줄
    assert state["scrollWidth"] == 320, state
    assert state["height"] < 44, state   # 「오늘」이 두 줄로 꺾이면 머리가 높아진다


def _head_geometry(page):
    return page.evaluate("""() => {
      const bar = document.getElementById('sticky-group').getBoundingClientRect();
      return { scrollY: window.scrollY, barTop: bar.top, barBottom: bar.bottom,
               dateRow: document.getElementById('page-title').getBoundingClientRect().top,
               heading: document.querySelector('.lect-day').getBoundingClientRect().top };
    }""")


@pytest.mark.only_browser("chromium")
def test_heading_clears_the_header_when_the_page_runs_under_the_status_bar(mobile_context):
    """상태 표시줄 높이(`env(safe-area-inset-top)`)가 62px이어도 맨 위에서 제목이 상단 바에 가려지지 않는다. 상단 바 묶음은 맨 위에
    고정되고 그 높이를 안쪽 위 여백으로 둔다(2026-11-07, 아이폰 홈 화면 앱에서 제목이 상단 바 밑에 가려졌다). 날짜를 옮겨도 같고,
    스크롤해도 본문이 시계 자리에 비치지 않는다."""
    inset = 62
    page = mobile_context.new_page()
    emulate_status_bar(page, inset)
    _open(page, "lectionary/2026-10-23")
    g = _head_geometry(page)
    assert g["scrollY"] == 0, g
    assert g["heading"] >= g["barBottom"], g   # 제목이 상단 바 밑에 있지 않다
    assert g["barTop"] == 0, g   # 상태 표시줄 자리도 상단 바 배경이다
    assert g["dateRow"] >= inset, g   # 「오늘 ‹ 날짜 ›」 줄은 시계 아래

    page.click('a[data-focus-key="next"]')
    page.wait_for_selector('time.lect-date-label[datetime="2026-10-24"]')
    g = _head_geometry(page)
    assert g["scrollY"] == 0 and g["heading"] >= g["barBottom"], g

    page.evaluate("() => window.scrollTo({ top: 300, behavior: 'instant' })")
    page.wait_for_function("() => window.scrollY === 300")
    behind_clock = page.evaluate("""y => document.getElementById('sticky-group')
      .contains(document.elementFromPoint(window.innerWidth / 2, y))""", inset / 2)   # 상태 표시줄 자리의 가운데
    assert behind_clock, "스크롤한 본문이 상태 표시줄 자리에 보인다"


def test_saint_day_heading_and_collects_follow_the_default_reading(mobile_context):
    """11.6 레오나드(고유 독서가 없는 축일) — 처음에는 평일 전례독서 목록이 선택되어 평일 독서이고, 머리 제목은 그날의 기본 독서인
    「연중 31주 금요일」이다. 레오나드는 전례독서 목록 대신 제목 아래 이름 줄에 보이고, 공통 독서는 당분간 보이지 않는다. 색은 그날의 색(백색) 그대로다
    (사용자 결정 2026-11-03 — 그전엔 머리가 지정 전례일 이름이라 성인 이름 아래 평일 독서가 보였다)."""
    page = mobile_context.new_page()
    _open(page, "lectionary/2026-11-06")
    assert page.inner_text(".lect-day") == "연중 31주 금요일"
    # 제목 위에는 헤더와 사이에 제목 한 줄 높이만큼의 여백이 있고, 글자 크기 설정(24px)을 따라 늘어난다 — 16px이면 헤더에
    # 붙어 보였다(사용자 결정 2026-11-03, 11-04)
    measure = """() => {
      const t = document.querySelector('.lect-day');
      return { gap: t.getBoundingClientRect().top - document.querySelector('#app-header').getBoundingClientRect().bottom,
               line: parseFloat(getComputedStyle(t).lineHeight) };
    }"""
    small = page.evaluate(measure)
    assert small["gap"] >= small["line"] - 0.5, small
    page.evaluate("() => { document.documentElement.style.fontSize = '24px'; }")
    large = page.evaluate(measure)
    assert large["gap"] >= large["line"] - 0.5 and large["gap"] > small["gap"], (small, large)
    page.evaluate("() => { document.documentElement.style.fontSize = ''; }")
    # 레오나드는 전례독서 목록이 아니라 제목 아래 회색 이름 줄 — 후보가 평일 하나뿐이라 목록도 없다(2026-11-03). 그 아래 줄은 그날의
    # 축성일(삼흥리성당, 2026-11-04)이다
    assert page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)") == ["레오나드(은수자, 6세기) 축일", "삼흥리성당 축성일"]
    assert page.locator(".lect-choices").count() == 0
    first = page.inner_text(".lect-reading[data-slot='first'] .lect-ref")
    assert "필립 3:17-4:1" in first
    assert _colors(page) == ["백색"]
    assert page.evaluate("() => document.title").startswith("연중 31주 금요일")
    # 본기도는 평일 본기도 다음에 레오나드의 본기도, 그 뒤에 송영 한 번. 이름 뒤 조사는 받침에 맞춘다(「레오나드를」)
    texts = page.eval_on_selector_all(".lect-collect-text", "els => els.map(e => e.textContent)")
    assert len(texts) == 2 and "레오나드를" in texts[1] and "레오나드" not in texts[0], texts
    assert page.locator(".lect-ending").count() == 1
    # 레오나드를 주소로 가리켜도 기본 독서다(공통 독서는 당분간 보이지 않는다)
    _open(page, "lectionary/2026-11-06?obs=d1106-%EB%A0%88%EC%98%A4%EB%82%98%EB%93%9C")
    assert page.inner_text(".lect-reading[data-slot='first'] .lect-ref") == first


def test_two_saints_on_a_weekday_follow_the_class_order(desktop_context):
    """성인 축일이 둘인 날의 기본 독서(평일) — 유형이 다르면 본기도를 유형 차례(commons.json — 순교자, 성직자, 선교사,
    신학자 …)로 잇고 송영은 한 번이다. 이름 줄도 같은 차례로 한 줄씩이고, 색이 다르면 「적색 또는 백색」이다(사용자 결정
    2026-11-03). 12.31 실베스터(성직자) ∧ 위클리프(신학자)는 실베스터가 먼저, 2.14 발렌틴(순교자, 적색) ∧ 키릴과
    메토디우스(선교사, 백색)는 발렌틴이 먼저다. 조사는 받침에 맞춘다(「키릴과 메토디우스를」)."""
    page = desktop_context.new_page()
    collects = lambda: page.eval_on_selector_all(".lect-collect-text", "els => els.map(e => e.textContent)")
    _open(page, "lectionary/2026-12-31")
    texts = collects()
    assert len(texts) == 3 and "실베스터" in texts[1] and "위클리프" in texts[2], texts
    assert page.locator(".lect-ending").count() == 1
    saints = page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)")
    assert len(saints) == 2 and saints[0].startswith("실베스터") and saints[1].startswith("위클리프"), saints
    assert _colors(page) == ["백색"]
    _open(page, "lectionary/2026-02-14")
    texts = collects()
    assert len(texts) == 3 and "발렌틴" in texts[1] and "키릴과 메토디우스" in texts[2], texts
    assert "을(를)" not in "".join(texts), texts
    assert page.inner_text(".lect-colors").split() == ["적색", "또는", "백색"]
    assert page.locator(".lect-choices").count() == 0


def test_days_only_commemorated_are_plain_text_without_links(desktop_context):
    """기념만 하는 후보는 누를 수 없는 글이다 — 고유 독서가 있어도 화면을 옮기지 않는다(사용자 결정 2026-11-04). 7.26(2026, 주일)
    안나와 요아킴은 이름 줄의 「… 축일」이고 전례독서 목록에 없으며, 주소로 가리켜도 주일 독서다. 주일에는 성인 본기도를 잇지 않는다(사용자 확인
    2026-11-04). 기리는 성인이 아닌 5.3 성 십자가 발견은 이름 줄에 이름만 보인다. 「기념만」 문구는 어디에도 없다. 지역 축일(3.1 삼일절, 8.15 광복절)만
    예외로 링크이고, 누르면 그 독서다. 평일에 밀려 기념만 하는 성인(12.29 토마스 베켓)은 기본 독서의
    본기도 뒤에 성인 본기도를 잇는다. 옮겨 간 축일의 원래 날짜(12.6)도 문장뿐이고 제목 영역에 링크가 없다."""
    desktop_context.add_init_script(SHOW_ALT_READINGS)
    page = desktop_context.new_page()
    collects = lambda: page.eval_on_selector_all(".lect-collect-text", "els => els.map(e => e.textContent)")
    name_lines = lambda: page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)")
    _open(page, "lectionary/2026-07-26")
    assert page.inner_text(".lect-day") == "연중 17주일"
    assert page.locator(".lect-head a").count() == 0
    assert any(line.startswith("안나와 요아킴") and line.endswith(" 축일") for line in name_lines()), name_lines()
    texts = collects()
    assert len(texts) == 1 and "안나와 요아킴" not in texts[0], texts
    assert _colors(page) == ["녹색"]
    sunday_first = page.inner_text(".lect-reading[data-slot='first'] .lect-ref")
    _open(page, "lectionary/2026-07-26?obs=" + urllib.parse.quote("d0726-안나와-요아킴"))
    assert page.inner_text(".lect-day") == "연중 17주일"
    assert page.inner_text(".lect-reading[data-slot='first'] .lect-ref") == sunday_first
    _open(page, "lectionary/2026-05-03")
    assert page.inner_text(".lect-day") == "부활 5주일"
    assert page.locator(".lect-head a").count() == 0
    assert "성 십자가 발견" in name_lines(), name_lines()
    assert "기념만" not in page.inner_text(".lect-head")
    _open(page, "lectionary/2026-03-01")
    assert page.inner_text(".lect-day") == "사순 2주일"
    assert _choices(page) == ["삼일절"]
    assert "삼일절" not in name_lines(), name_lines()
    assert "기념만" not in page.inner_text(".lect-head")
    sunday_ref = page.inner_text(".lect-reading[data-slot='first'] .lect-ref")
    page.locator(".lect-choice", has_text="삼일절").click()
    page.wait_for_selector(".lect-day:has-text('삼일절')")
    assert page.inner_text(".lect-reading[data-slot='first'] .lect-ref") != sunday_ref
    assert _choices(page) == ["사순 2주일"]
    assert page.locator(".lect-day-note").count() == 0
    _open(page, "lectionary/2027-08-15")
    assert "광복절" in _choices(page), _choices(page)
    _open(page, "lectionary/2026-12-29")
    assert _choices(page) == ["성탄 1주 화요일"]   # 그날의 평일 독서는 고를 수 있고, 토마스 베켓은 링크가 아니다(2026-11-05)
    assert any(line.startswith("토마스 베켓") and line.endswith(" 축일") for line in name_lines()), name_lines()
    texts = collects()
    assert len(texts) == 2 and "토마스 베켓" in texts[1], texts
    _open(page, "lectionary/2026-12-06")
    assert page.inner_text(".lect-day-note") == "성 니콜라 축일을 12월 7일로 옮김"
    assert page.locator(".lect-head a").count() == 0


def test_ash_wednesday_moves_off_seollal(desktop_context):
    """재의 수요일이 설과 겹치면 다음날로 옮겨 지킨다(2032, 사용자 결정 2026-11-05). 재의 수요일은 축일이 아니라 「축일」을 붙이지 않고,
    옮겨 온 날에는 그날 평일 독서를 목록에서 고를 수 있다."""
    desktop_context.add_init_script(SHOW_ALT_READINGS)
    page = desktop_context.new_page()
    _open(page, "lectionary/2032-02-11")
    assert page.inner_text(".lect-day") == "설날"
    assert page.inner_text(".lect-day-note") == "재의 수요일을 2월 12일로 옮김"
    _open(page, "lectionary/2032-02-12")
    assert page.inner_text(".lect-day") == "재의 수요일"
    assert page.inner_text(".lect-day-note") == "2월 11일에서 옮겨 옴"
    assert _choices(page) == ["재의 수요일 후 목요일"]


def test_jan_2_is_a_christmas_weekday_with_the_saint_on_the_name_line(desktop_context):
    """1.2와 12.29는 기도서 486쪽이 날짜로 고정한 평일 독서다(사용자 결정 2026-11-05). 제목은 성탄 평일의 이름,
    성인은 이름 줄이고, 본기도는 성탄 주간 본기도 뒤에 성인 공통 본기도를 잇는다. 1.8 루시안과 같다."""
    page = desktop_context.new_page()
    collects = lambda: page.eval_on_selector_all(".lect-collect-text", "els => els.map(e => e.textContent)")
    name_lines = lambda: page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)")
    _open(page, "lectionary/2027-01-02")
    assert page.inner_text(".lect-day") == "성탄 1주 토요일"
    assert any(line.startswith("바실") and "그레고리" in line and line.endswith(" 축일") for line in name_lines()), name_lines()
    assert page.inner_text(".lect-reading[data-slot='first'] .lect-ref") == "1요한 2:22-28"
    assert page.locator(".lect-choices").count() == 0
    assert page.locator(".lect-collects .lect-collect-num").count() == 2   # 성탄 주간 본기도 1 · 2
    texts = collects()
    assert len(texts) == 2 and "바실" not in texts[0] and "바실" in texts[1], texts
    _open(page, "lectionary/2028-12-29")
    assert page.inner_text(".lect-day") == "성탄 후 금요일"
    assert any(line.startswith("토마스 베켓") and line.endswith(" 축일") for line in name_lines()), name_lines()
    texts = collects()
    assert len(texts) == 2 and "토마스 베켓" in texts[1], texts


def test_feast_lines_come_before_commemoration_lines(desktop_context):
    """제목 아래 줄은 성인 축일(「… 축일」)이 먼저이고 기념일(「… 기념일」)이 그 아래다(사용자 결정 2026-11-03). 9.4 대 그레고리
    (축일, 기본 독서는 평일) ∧ 여성선교센터 개관(기념일)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-09-04")
    lines = page.eval_on_selector_all(".lect-day-saint", "els => els.map(e => e.textContent)")
    assert len(lines) == 2, lines
    assert lines[0].startswith("대 그레고리") and lines[0].endswith(" 축일"), lines
    assert lines[1].startswith("여성선교센터 개관") and lines[1].endswith(" 기념일"), lines


def test_turning_off_common_reading_hiding_brings_saint_rows_back(desktop_context):
    """공통 독서 감추기(lectionary.js HIDE_COMMON_READINGS)는 상수 하나로 끄고 켠다 — 끄면 공통 독서만 있는 기리는 성인(11.6
    레오나드)도 전례독서 목록으로 돌아오고, 고르면 그 공통 독서다(PR #463 리뷰). 모듈 원문을 받아 상수만 바꿔 내준다."""
    original = urllib.request.urlopen(f"{BASE}/js/app/lectionary.js").read().decode("utf-8")
    target = "const HIDE_COMMON_READINGS = true;"
    assert target in original, "lectionary.js에서 HIDE_COMMON_READINGS 를 찾지 못했다 — 테스트를 고칠 것"
    off = original.replace(target, "const HIDE_COMMON_READINGS = false;", 1)
    page = desktop_context.new_page()
    page.route("**/js/app/lectionary.js*",
               lambda route: route.fulfill(status=200, content_type="text/javascript; charset=utf-8", body=off))
    _open(page, "lectionary/2026-11-06")
    assert page.locator(".lect-choice", has_text="레오나드").count() == 1
    weekday_first = page.inner_text(".lect-reading[data-slot='first'] .lect-ref")
    page.locator(".lect-choice", has_text="레오나드").click()
    page.wait_for_selector(".lect-day:has-text('레오나드')")
    assert page.inner_text(".lect-reading[data-slot='first'] .lect-ref") != weekday_first


# ── 대체 독서 표시 — 설정으로 그날의 평일, 주일 줄을 숨긴다(ADR-041 §4) ──

def test_alternate_rows_are_hidden_by_default(desktop_context):
    """처음에는 대축일, 주요축일, 고유 독서가 있는 축일의 평일 줄이 없다. 옮겨 왔다는 문장, 사계재, 옮겨 지킬 수 있는 축일, 명절의 평일 줄은 그대로다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2025-06-30")
    assert page.inner_text(".lect-day") == "사도 성 베드로와 바울로"
    assert page.inner_text(".lect-day-note") == "6월 29일에서 옮겨 옴"
    assert page.locator(".lect-choices").count() == 0
    _open(page, "lectionary/2026-06-29")
    assert page.locator(".lect-choices").count() == 0
    _open(page, "lectionary/2040-09-22")
    assert _choices(page) == ["모든 신자의 성소를 위한 추계재"]
    _open(page, "lectionary/2026-01-04")
    assert _choices(page) == ["공현대축일 · 1월 6일에서 옮겨 지킬 수 있음"]
    _open(page, "lectionary/2026-12-08")
    assert page.inner_text(".lect-day") == "성모시태"
    assert page.locator(".lect-choices").count() == 0
    _open(page, "lectionary/2025-01-29")
    assert _choices(page) == ["연중 3주 수요일"]


def test_optional_feast_weekday_row_shows_by_default_with_feast_name(desktop_context):
    """옮겨 지킬 수 있는 축일이 평일에 온 날은 기본값(숨김)에서도 평일 줄이 보이고, 이름 뒤에 그 축일의 대체 독서임을 적는다. 축일의 제목 아래에는
    옮겨 지킬 수 있는 주일을, 평일 줄을 누르면 그 주일로 옮겨 지킬 때 읽는 독서임을 알린다(사용자 결정 2026-11-06, ADR-041 §4)."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2027-02-02")
    assert page.inner_text(".lect-day") == "주의 봉헌"
    assert page.inner_text(".lect-day-note") == "1월 31일로 옮겨 지킬 수 있음"
    assert _choices(page) == ["연중 4주 화요일 · 주의 봉헌 축일 대체 독서"]
    row = page.locator(".lect-choice", has_text="연중 4주 화요일")
    assert row.locator(".lect-choice-name").inner_text() == "연중 4주 화요일"   # 밑줄 링크는 이름뿐이다
    row.click()
    page.wait_for_selector(".lect-day:has-text('연중 4주 화요일')")
    assert page.inner_text(".lect-day-note") == "주의 봉헌 축일 대체 독서"
    assert _choices(page) == ["주의 봉헌 · 1월 31일로 옮겨 지킬 수 있음"]
    # 목적지 주일의 안내도 같은 형식이다
    _open(page, "lectionary/2027-01-31")
    page.locator(".lect-choice", has_text="주의 봉헌").click()
    page.wait_for_selector(".lect-day:has-text('주의 봉헌')")
    assert page.inner_text(".lect-day-note") == "2월 2일에서 옮겨 지킬 수 있음"
    _open(page, "lectionary/2026-05-14")
    assert _choices(page) == ["부활 6주 목요일 · 승천대축일 대체 독서"]
    # 공현대축일(1.6)은 평일 독서가 없어 줄이 없지만, 옮겨 지킬 수 있는 주일은 알린다
    _open(page, "lectionary/2026-01-06")
    assert page.inner_text(".lect-day-note") == "1월 4일로 옮겨 지킬 수 있음"
    assert page.locator(".lect-choices").count() == 0
    # 축일이 주일에 온 해는 옮길 주일이 없어 그날의 주일 줄을 숨기고 문장도 없다
    _open(page, "lectionary/2025-02-02")
    assert page.locator(".lect-choices").count() == 0
    assert page.locator(".lect-day-note").count() == 0


def test_alternate_setting_shows_rows_in_place_and_a_link_still_opens_when_off(desktop_context):
    """켜면 그 화면에 줄이 생기고 값이 저장된다. 꺼도 주소로 가리키면 그 독서를 보인다 — 공유한 링크가 받는 사람의 설정에 따라 다른 본문이 되지 않는다."""
    page = desktop_context.new_page()
    _open(page, "lectionary/2026-06-29")
    pop = open_settings(page)
    sw = pop.get_by_role("switch", name="대체 독서 표시")
    assert sw.is_checked() is False
    sw.click()
    page.wait_for_selector(".lect-choice:has-text('연중 13주 월요일')")
    assert page.evaluate("() => localStorage.getItem('bible-lectionary-alt-show')") == "1"
    assert open_settings(page).get_by_role("switch", name="대체 독서 표시").is_checked() is True
    page.keyboard.press("Escape")
    href = page.get_attribute(".lect-choice:has-text('연중 13주 월요일')", "href")
    # 저장소를 비우는 스크립트(CLEAR_APP_STORAGE)가 주소를 열 때마다 실행되므로, 그 뒤에 값을 넣어 끈 상태를 만든다
    desktop_context.add_init_script("localStorage.setItem('bible-lectionary-alt-show', '0')")
    page.goto(f"{BASE}{href}")
    page.wait_for_selector(".lect-day:has-text('연중 13주 월요일')", timeout=20_000)
    assert _choices(page) == ["사도 성 베드로와 바울로"]
