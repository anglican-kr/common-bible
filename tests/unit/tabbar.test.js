// ── Unit tests for js/app/tabbar.js ──────────────────────────────────────────
// Run with: node --test tests/unit/tabbar.test.js
//
// tabbar.js is nav- and DOM-bound at module top level (getElementById + click
// listeners), so the tab and search-circle behavior is e2e's responsibility
// (ADR-013). What IS unit-testable are the pure blocks we slice out (mirrors
// search.test.js's BEGIN/END approach) and run in a vm:
//
// Coverage:
//   - nextScrollCollapsed (SCROLL): 스크롤 축소의 접기와 펴기
//   - syncHeaderNav (HEADER_NAV): 데스크톱 상단 바의 목적지 탭 표시
//   - noticeBottom (NOTICE): 하단 알림 열을 화면 아래 막대 가운데 가장 위의 것보다 위에 두는 거리
// The bottom-dock keyboard handling (KEYBOARD) went with the search morph (ADR-048).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TABBAR_PATH = path.resolve(__dirname, "../../js/app/tabbar.js");
const TABBAR_SOURCE = fs.readFileSync(TABBAR_PATH, "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = TABBAR_SOURCE.indexOf(begin);
  const endIdx = TABBAR_SOURCE.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in js/app/tabbar.js`);
  }
  return TABBAR_SOURCE.slice(startIdx, endIdx + end.length);
}

// ── nextScrollCollapsed (SCROLL 블록) ─────────────────────────────────────────
// 순수 함수 — 자유 변수 없이 vm 에서 단독 실행.

const SCROLL_BLOCK = extractBlock("SCROLL");
function scrollCtx() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(SCROLL_BLOCK, ctx);
  return ctx;
}

test("nextScrollCollapsed: 최상단(y<=4)은 항상 복구(false)", () => {
  const { nextScrollCollapsed } = scrollCtx();
  assert.equal(nextScrollCollapsed(0, 500, true), false);
  assert.equal(nextScrollCollapsed(4, 500, true), false);
});

test("nextScrollCollapsed: 아래로 + 임계(64) 초과 → 접힘(true)", () => {
  const { nextScrollCollapsed } = scrollCtx();
  assert.equal(nextScrollCollapsed(200, 100, false), true);
});

test("nextScrollCollapsed: 아래로지만 임계 이하 → 유지", () => {
  const { nextScrollCollapsed } = scrollCtx();
  assert.equal(nextScrollCollapsed(50, 10, false), false); // 아직 64 이하
});

test("nextScrollCollapsed: 중간에서 위로 스크롤 → 유지(깜빡임 방지)", () => {
  const { nextScrollCollapsed } = scrollCtx();
  // 접힌 상태에서 위로(y<lastY) 올라가도 최상단 아니면 그대로 접힘 유지.
  assert.equal(nextScrollCollapsed(300, 500, true), true);
});

// ── HEADER_NAV — 데스크톱 상단 바의 목적지 탭 표시(ADR-043 §3) ─────────────────

function headerNavCtx() {
  const link = (nav) => {
    const attrs = new Map([["data-nav", nav]]);
    return {
      getAttribute: (k) => attrs.get(k) ?? null,
      setAttribute: (k, v) => attrs.set(k, v),
      removeAttribute: (k) => attrs.delete(k),
    };
  };
  const links = [link("home"), link("calendar")];
  const ctx = { document: { querySelectorAll: (sel) => (sel === "#header-nav [data-nav]" ? links : []) } };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("HEADER_NAV"), ctx, { filename: "tabbar-header-nav.js" });
  const current = () => links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.getAttribute("data-nav"));
  return { syncHeaderNav: ctx.syncHeaderNav, current };
}

test("syncHeaderNav: 캘린더와 전례독서(탭 바의 calendar)는 「캘린더」 탭에 aria-current", () => {
  const { syncHeaderNav, current } = headerNavCtx();
  syncHeaderNav("calendar");
  assert.deepEqual(current(), ["calendar"]);
});

test("syncHeaderNav: 그 밖의 화면은 「성서」 탭 — 검색 결과, 데스크톱에서 성서 목록 위에 여는 북마크와 설정도", () => {
  for (const active of ["home", "search", "bookmarks", "settings"]) {
    const { syncHeaderNav, current } = headerNavCtx();
    syncHeaderNav(active);
    assert.deepEqual(current(), ["home"], active);
  }
});

test("syncHeaderNav: 화면을 옮기면 앞의 표시를 지운다 — 표시는 늘 하나", () => {
  const { syncHeaderNav, current } = headerNavCtx();
  syncHeaderNav("calendar");
  syncHeaderNav("home");
  assert.deepEqual(current(), ["home"]);
  syncHeaderNav("calendar");
  assert.deepEqual(current(), ["calendar"]);
});

// ── NOTICE — 하단 알림 열의 자리(2026-11-21) ─────────────────────────────────────
// 순수 함수 — 자유 변수 없이 vm 에서 단독 실행.

function noticeCtx() {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(extractBlock("NOTICE"), ctx, { filename: "tabbar-notice.js" });
  return ctx;
}
const box = (top, bottom) => ({ top, bottom, height: bottom - top });

test("noticeBottom: 탭 독 위 8px — 업데이트 토스트가 탭 바를 가리지 않는다", () => {
  const { noticeBottom } = noticeCtx();
  // iPhone 13 세로(높이 664): dock 600-660.
  assert.equal(noticeBottom([box(600, 660)], 664), 72);
});

test("noticeBottom: 여러 막대 가운데 가장 위의 것 — 탭 독 위에 뜬 오디오 바와 이어 읽기 알약, 선택 바 위의 카운트 칩", () => {
  const { noticeBottom } = noticeCtx();
  assert.equal(noticeBottom([box(600, 660), box(522, 583)], 664), 150);
  assert.equal(noticeBottom([box(600, 660), box(554, 592)], 664), 118);
  // 세로의 이어 읽기 알약은 탭 독 위의 따로 된 줄이다(390×844: 독 780-840, 알약 712-772).
  assert.equal(noticeBottom([box(780, 840), box(712, 772)], 844), 140);
});

test("noticeBottom: 숨은 막대(빈 상자)와 화면 위쪽 절반의 상자는 세지 않는다", () => {
  const { noticeBottom } = noticeCtx();
  // 큰 화면의 이어 읽기 배너는 헤더 아래에 붙어 있다.
  assert.equal(noticeBottom([box(0, 0), box(56, 100), box(600, 660)], 664), 72);
});

test("noticeBottom: 화면 아래에 막대가 없으면(데스크톱) null — CSS의 기본 자리를 쓴다", () => {
  const { noticeBottom } = noticeCtx();
  assert.equal(noticeBottom([], 800), null);
  assert.equal(noticeBottom([box(0, 0)], 800), null);
});
