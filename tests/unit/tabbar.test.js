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

// ── 키보드가 뜨기 전에 미리 올리기 (ADR-030 §6, 2026-11-19) ─────────────────────

test("keyboardMemoryKey: 기기 화면의 크기(짧은 변 x 긴 변)와 방향. 화면을 돌려도 크기는 같고 방향만 바뀐다", () => {
  const { ctx } = makeCtx();
  assert.equal(ctx.keyboardMemoryKey(390, 844, 390, 760), "390x844:portrait");
  assert.equal(ctx.keyboardMemoryKey(844, 390, 844, 340), "390x844:landscape");
  assert.equal(ctx.keyboardMemoryKey(390, 844, 844, 340), "390x844:landscape", "iOS는 화면을 돌려도 screen.width가 그대로다");
});

test("rememberedLift: 기억한 키보드 위의 높이로 올릴 px. 도구 막대로 innerHeight가 바뀌어도 맞추고, 하드웨어 키보드 표시와 60%를 넘는 값은 쓰지 않는다", () => {
  const { ctx } = makeCtx();
  assert.equal(ctx.rememberedLift({ vv: 508 }, 844), 336);
  assert.equal(ctx.rememberedLift({ vv: 508 }, 900), 392, "Safari 도구 막대가 접혀 innerHeight가 늘면 그만큼 더 올린다");
  assert.equal(ctx.rememberedLift({ vv: 508, hw: true }, 844), 0, "키보드가 뜨지 않은 기기");
  assert.equal(ctx.rememberedLift({ vv: 40 }, 844), 0, "화면 높이의 60%를 넘는다(잘못 잰 값)");
  for (const bad of [null, undefined, "x", {}, { vv: "508" }, { vv: 0 }, { vv: 900 }]) {
    assert.equal(ctx.rememberedLift(bad, 844), 0, JSON.stringify(bad));
  }
});

test("updatedKeyboardEntry: 더 큰 키보드를 잴 때만 고치고, 미리 올렸는데 키보드가 뜨지 않으면 표시하며, 키보드가 다시 뜨면 표시를 지운다", () => {
  const { ctx } = makeCtx();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  // 처음 잰 것
  assert.deepEqual(plain(ctx.updatedKeyboardEntry(null, 336, 508, 844, false)), { vv: 508 });
  // 더 큰 키보드(남은 높이가 작다)면 고친다
  assert.deepEqual(plain(ctx.updatedKeyboardEntry({ vv: 508 }, 380, 464, 844, true)), { vv: 464 });
  // 덜 올라온 키보드나 같은 키보드면 고치지 않는다(다시 쓰지도 않는다)
  assert.equal(ctx.updatedKeyboardEntry({ vv: 508 }, 200, 644, 844, true), null);
  assert.equal(ctx.updatedKeyboardEntry({ vv: 508 }, 336, 508, 844, true), null);
  // 화면 높이의 60%를 넘는 높이는 적지 않는다
  assert.equal(ctx.updatedKeyboardEntry(null, 600, 244, 844, false), null);
  // 미리 올렸는데 키보드가 뜨지 않았다(하드웨어 키보드)
  assert.deepEqual(plain(ctx.updatedKeyboardEntry({ vv: 508 }, 0, 0, 844, true)), { vv: 508, hw: true });
  assert.equal(ctx.updatedKeyboardEntry({ vv: 508, hw: true }, 0, 0, 844, false), null, "이미 표시했다");
  assert.equal(ctx.updatedKeyboardEntry(null, 0, 0, 844, false), null, "기억도 키보드도 없다");
  // 키보드가 다시 뜨면 표시를 지운다. 더 작은 키보드였어도 기억은 큰 쪽이다
  assert.deepEqual(plain(ctx.updatedKeyboardEntry({ vv: 508, hw: true }, 300, 544, 844, false)), { vv: 508 });
});

test("keyboardLift: 잰 높이와 미리 올린 높이 가운데 큰 쪽, 1px 이하는 0", () => {
  const { ctx } = makeCtx();
  assert.equal(ctx.keyboardLift(120, 336), 336, "키보드가 올라오는 중에는 미리 올린 높이를 지킨다");
  assert.equal(ctx.keyboardLift(340, 336), 340, "잰 높이가 더 크면 그 높이");
  assert.equal(ctx.keyboardLift(0, 0), 0);
  assert.equal(ctx.keyboardLift(0.5, 1), 0);
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
