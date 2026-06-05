// ── Unit tests for js/app/tabbar.js ──────────────────────────────────────────
// Run with: node --test tests/unit/tabbar.test.js
//
// tabbar.js is nav- and DOM-bound at module top level (getElementById +
// click/visualViewport listeners), so the full morph/routing behavior is e2e's
// responsibility (ADR-013). What IS unit-testable is the keyboard-up gating —
// the crux of the bottom-dock keyboard handling: the overlap math plus the two
// effects it drives. We slice the KEYBOARD block (mirrors search.test.js's
// BEGIN/END approach) and run it in a vm with minimal window/element stubs.
//
// Coverage:
//   - keyboardOverlap: 키보드 높이 = max(0, innerHeight − visualViewport.height)
//   - setKeyboardState: body.tabbar-keyboard 토글 + 닫기(X) aria 게이팅
//     (실제 호출은 입력 focus/blur — DOM 이벤트 와이어링이라 e2e 책임)
//   - liftForKeyboard: 키보드 up 일 때만 --kb-overlap 설정(위치 보정), 1px 임계.
//     X 노출/홈 숨김은 분리(setKeyboardState) — 높이 감지 실패와 무관하게.

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

const KEYBOARD_BLOCK = extractBlock("KEYBOARD");

// ── Minimal stubs ────────────────────────────────────────────────────────────
// classList tracking just `tabbar-keyboard`; element tracking only the attrs
// and the --kb-overlap custom property the block touches.

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, force) => {
      const want = typeof force === "boolean" ? force : !set.has(c);
      if (want) set.add(c); else set.delete(c);
      return want;
    },
    contains: (c) => set.has(c),
  };
}

function makeEl() {
  const attrs = new Map();
  const props = new Map();
  return {
    attrs,
    props,
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    style: {
      setProperty: (k, v) => props.set(k, v),
      getPropertyValue: (k) => props.get(k) ?? "",
    },
  };
}

// Build a vm context exposing the free variables the block references:
// document.body, $searchClose, $dock, window. Returns the context plus handles.
function makeCtx({ innerHeight = 800, vvHeight = 800, hasVV = true } = {}) {
  const body = { classList: makeClassList() };
  // --kb-overlap 은 :root(documentElement)에 설정 → dock·#tabbar-scrim 이 함께 상속.
  const documentElement = makeEl();
  const $searchClose = makeEl();
  const $dock = makeEl();
  const window = {
    innerHeight,
    visualViewport: hasVV ? { height: vvHeight } : null,
  };
  const ctx = { document: { body, documentElement }, $searchClose, $dock, window };
  vm.createContext(ctx);
  vm.runInContext(KEYBOARD_BLOCK, ctx);
  return { ctx, body, documentElement, $searchClose, $dock, window };
}

// ── keyboardOverlap ──────────────────────────────────────────────────────────

test("keyboardOverlap: 키보드가 가린 높이 = innerHeight − vvHeight", () => {
  const { ctx } = makeCtx();
  assert.equal(ctx.keyboardOverlap(800, 500), 300);
});

test("keyboardOverlap: 음수는 0 으로 클램프(키보드 없음)", () => {
  const { ctx } = makeCtx();
  assert.equal(ctx.keyboardOverlap(800, 800), 0);
  assert.equal(ctx.keyboardOverlap(800, 820), 0);
});

// ── setKeyboardState ─────────────────────────────────────────────────────────

test("setKeyboardState(true): body 클래스 + X 버튼 a11y 노출", () => {
  const { ctx, body, $searchClose } = makeCtx();
  // 초기엔 X 가 a11y 트리에서 제외돼 있다고 가정.
  $searchClose.setAttribute("aria-hidden", "true");
  $searchClose.setAttribute("tabindex", "-1");

  ctx.setKeyboardState(true);

  assert.equal(body.classList.contains("tabbar-keyboard"), true);
  assert.equal($searchClose.getAttribute("aria-hidden"), null);
  assert.equal($searchClose.getAttribute("tabindex"), null);
});

test("setKeyboardState(false): 클래스 제거 + X 버튼 a11y 제외", () => {
  const { ctx, body, $searchClose } = makeCtx();
  ctx.setKeyboardState(true);

  ctx.setKeyboardState(false);

  assert.equal(body.classList.contains("tabbar-keyboard"), false);
  assert.equal($searchClose.getAttribute("aria-hidden"), "true");
  assert.equal($searchClose.getAttribute("tabindex"), "-1");
});

// ── liftForKeyboard ──────────────────────────────────────────────────────────

test("liftForKeyboard: 키보드 up → --kb-overlap = 키보드 높이(위치 보정)", () => {
  const { ctx, body, documentElement } = makeCtx({ innerHeight: 800, vvHeight: 500 });
  ctx.liftForKeyboard();

  // 실제 레이아웃 bottom 으로 올리는 값(transform 아님 → iOS 팬 방지). :root 에 설정.
  assert.equal(documentElement.style.getPropertyValue("--kb-overlap"), "300px");
  // X 노출(body.tabbar-keyboard)은 liftForKeyboard 가 건드리지 않는다 — focus/blur 책임.
  assert.equal(body.classList.contains("tabbar-keyboard"), false);
});

test("liftForKeyboard: 키보드 down → --kb-overlap 0", () => {
  const { ctx, documentElement } = makeCtx({ innerHeight: 800, vvHeight: 800 });
  ctx.liftForKeyboard();

  assert.equal(documentElement.style.getPropertyValue("--kb-overlap"), "0px");
});

test("liftForKeyboard: 1px 이하 차이는 키보드 없음으로 처리(반올림 오차)", () => {
  const { ctx, documentElement } = makeCtx({ innerHeight: 800, vvHeight: 799 });
  ctx.liftForKeyboard();

  // overlap === 1 은 up 아님(> 1 임계).
  assert.equal(documentElement.style.getPropertyValue("--kb-overlap"), "0px");
});

test("liftForKeyboard: visualViewport 없으면 no-op(데스크탑/구형)", () => {
  const { ctx, documentElement } = makeCtx({ hasVV: false });
  ctx.liftForKeyboard();
  // 아무 속성도 설정하지 않음.
  assert.equal(documentElement.style.getPropertyValue("--kb-overlap"), "");
});

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
