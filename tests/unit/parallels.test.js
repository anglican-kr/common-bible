// ── Unit tests for js/app/parallels.js ─────────────────────────────────────
// Run with: node --test tests/unit/parallels.test.js
//
// Loads parallels.js in a vm context with stubbed window.appHelpers (`el`),
// document, and appCitations (openNoteTooltip / openCiteSheet / closeNoteTooltip).
// The full tooltip rendering (positioning, scroll-follow) lives in citations.js
// and is covered by its own tests + e2e; here we focus on parallels.js's own
// surface: range parsing, anchor/tooltip-body builders, lookup, and the
// click-delegation handoff to citations.
//
// Sections (one per `// ── <area> ──`):
//   - parseRange
//   - buildTooltipBody
//   - buildParallelAnchor
//   - findParallelStartingAt
//   - initParallels (anchor click → tooltip, link click → cite-sheet, key handlers)

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PATH = path.resolve(__dirname, "../../js/app/parallels.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8")
  .replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");

// vm contexts have separate Object prototypes — strict deepEqual fails on
// otherwise-equivalent objects. JSON round-trip flattens that mismatch.
function jsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

// ── Minimal DOM element stub ────────────────────────────────────────────────

function makeStubEl() {
  return function el(tag, attrs, ...children) {
    const node = {
      tag,
      attrs: { ...(attrs || {}) },
      className: (attrs && attrs.className) || "",
      children: [],
      classList: {
        _set: new Set(((attrs && attrs.className) || "").split(/\s+/).filter(Boolean)),
        contains(c) { return this._set.has(c); },
      },
      getAttribute(name) { return this.attrs[name] ?? null; },
      appendChild(c) { this.children.push(c); return c; },
      closest(sel) {
        if (sel.startsWith(".") && this.classList.contains(sel.slice(1))) return this;
        return null;
      },
      get textContent() {
        return this.children.map(c => c?.text ?? c?.textContent ?? "").join("");
      },
    };
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === "string") node.children.push({ text: c });
      else node.children.push(c);
    }
    return node;
  };
}

function loadParallels({ openCiteSheet, openNoteTooltip, closeNoteTooltip } = {}) {
  const bodyClickListeners = [];
  const keydownListeners = [];
  const ctx = {
    console, JSON, Date, Math, Object, Array, Set, Map, Promise, Error,
    String, Number, Boolean, parseInt, parseFloat, RegExp,
    HTMLElement: function HTMLElement() {},
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  ctx.appHelpers = { el: makeStubEl() };
  ctx.appCitations = (openCiteSheet || openNoteTooltip || closeNoteTooltip)
    ? {
        openCiteSheet: openCiteSheet || (() => {}),
        openNoteTooltip: openNoteTooltip || (() => {}),
        closeNoteTooltip: closeNoteTooltip || (() => {}),
      }
    : null;
  ctx.document = {
    addEventListener: (type, fn) => {
      if (type === "keydown") keydownListeners.push(fn);
    },
    body: {
      addEventListener: (type, fn) => {
        if (type === "click") bodyClickListeners.push(fn);
      },
    },
  };
  vm.runInContext(APP_SOURCE, ctx, { filename: "parallels.js" });
  return {
    api: ctx.appParallels,
    HTMLElement: ctx.HTMLElement,
    fireBodyClick: (target) => bodyClickListeners.forEach(fn => fn({ target })),
    fireKeydown: (event) => keydownListeners.forEach(fn => fn(event)),
  };
}

// ── parseRange ──────────────────────────────────────────────────────────────

test("parseRange: whole-chapter shorthand '11'", () => {
  const { api } = loadParallels();
  jsonEqual(api.parseRange("11"), { startCh: 11, startV: 1, endCh: 11, endV: null });
});

test("parseRange: single verse '11:5'", () => {
  const { api } = loadParallels();
  jsonEqual(api.parseRange("11:5"), { startCh: 11, startV: 5, endCh: 11, endV: 5 });
});

test("parseRange: same-chapter range '11:1-9'", () => {
  const { api } = loadParallels();
  jsonEqual(api.parseRange("11:1-9"), { startCh: 11, startV: 1, endCh: 11, endV: 9 });
});

test("parseRange: cross-chapter range '11:1-12:5'", () => {
  const { api } = loadParallels();
  jsonEqual(api.parseRange("11:1-12:5"), { startCh: 11, startV: 1, endCh: 12, endV: 5 });
});

test("parseRange: malformed → null", () => {
  const { api } = loadParallels();
  assert.equal(api.parseRange(""), null);
  assert.equal(api.parseRange("garbage"), null);
  assert.equal(api.parseRange("11:1-"), null);
});

// ── buildTooltipBody ────────────────────────────────────────────────────────

test("buildTooltipBody: single src → [linkButton, ' 참조']", () => {
  const { api } = loadParallels();
  const body = api.buildTooltipBody({
    src: [{ ref: "1역대 11:1-9" }],
    range: "5:1-10",
  });
  assert.equal(body.length, 2);
  assert.equal(body[0].tag, "button");
  assert.equal(body[0].attrs.className, "parallel-tooltip-ref");
  assert.equal(body[0].attrs["data-parallel-ref"], "1역대 11:1-9");
  assert.equal(body[0].textContent, "1역대 11:1-9");
  assert.equal(body[1], " 참조");
});

test("buildTooltipBody: multi src → links joined with ' · ' then ' 참조'", () => {
  const { api } = loadParallels();
  const body = api.buildTooltipBody({
    src: [{ ref: "1역대 11:1-9" }, { ref: "1역대 14:1-16" }],
    range: "5:1-25",
  });
  // [link1, " · ", link2, " 참조"]
  assert.equal(body.length, 4);
  assert.equal(body[0].textContent, "1역대 11:1-9");
  assert.equal(body[1], " · ");
  assert.equal(body[2].textContent, "1역대 14:1-16");
  assert.equal(body[3], " 참조");
});

test("buildTooltipBody: per-source tradition prefixes the link label", () => {
  const { api } = loadParallels();
  const body = api.buildTooltipBody({
    src: [{ ref: "시편 16:8", tradition: "칠십인역" }],
    range: "2:25",
  });
  assert.equal(body[0].textContent, "칠십인역 시편 16:8");
  assert.equal(body[0].attrs["data-parallel-ref"], "시편 16:8");
  assert.equal(body[0].attrs["data-parallel-ref-tradition"], "칠십인역");
});

test("buildTooltipBody: empty src → empty array (no ' 참조' suffix)", () => {
  const { api } = loadParallels();
  jsonEqual(api.buildTooltipBody({ src: [], range: "11" }), []);
});

// ── buildParallelAnchor ─────────────────────────────────────────────────────

test("buildParallelAnchor: button with ※ glyph + data attrs", () => {
  const { api } = loadParallels();
  const node = api.buildParallelAnchor({
    src: [{ ref: "1역대 11:1-9" }],
    range: "5:1-10",
  });
  assert.equal(node.tag, "button");
  assert.equal(node.attrs.type, "button");
  assert.equal(node.attrs.className, "parallel-anchor");
  assert.equal(node.attrs["data-parallel-range"], "5:1-10");
  assert.equal(node.attrs["data-parallel-src"], "1역대 11:1-9");
  assert.equal(node.textContent, "※");
  assert.match(node.attrs["aria-label"], /5:1-10.*병행 본문 안내/);
});

test("buildParallelAnchor: per-source tradition round-trips via `[전통]` notation", () => {
  // Data attr re-uses the source markdown notation so the click handler can
  // rehydrate without a parallel encoding scheme.
  const { api } = loadParallels();
  const node = api.buildParallelAnchor({
    src: [{ ref: "시편 16:8", tradition: "칠십인역" }, { ref: "사도 2:25" }],
    range: "2:25",
  });
  assert.equal(
    node.attrs["data-parallel-src"],
    "시편 16:8 [칠십인역];사도 2:25",
  );
});

// ── findParallelsStartingAt ─────────────────────────────────────────────────

test("findParallelsStartingAt: matches verse number == range start", () => {
  const { api } = loadParallels();
  const parallels = [
    { src: [{ ref: "2사무 5:1-10" }], range: "11:1-9" },
    { src: [{ ref: "2사무 23:8-39" }], range: "11:10-47" },
  ];
  jsonEqual(api.findParallelsStartingAt(parallels, 1), [parallels[0]]);
  jsonEqual(api.findParallelsStartingAt(parallels, 10), [parallels[1]]);
});

test("findParallelsStartingAt: no match → empty array", () => {
  const { api } = loadParallels();
  const parallels = [{ src: [{ ref: "2사무 5:1-10" }], range: "11:1-9" }];
  jsonEqual(api.findParallelsStartingAt(parallels, 5), []);
});

test("findParallelsStartingAt: null/empty parallels → empty array", () => {
  const { api } = loadParallels();
  jsonEqual(api.findParallelsStartingAt(null, 1), []);
  jsonEqual(api.findParallelsStartingAt(undefined, 1), []);
  jsonEqual(api.findParallelsStartingAt([], 1), []);
});

test("findParallelsStartingAt: whole-chapter shorthand range='13' matches verse 1", () => {
  const { api } = loadParallels();
  const parallels = [{ src: [{ ref: "2사무 6" }], range: "13" }];
  jsonEqual(api.findParallelsStartingAt(parallels, 1), [parallels[0]]);
  jsonEqual(api.findParallelsStartingAt(parallels, 2), []);
});

test("findParallelsStartingAt: multiple parallels sharing a start verse (range 중첩 허용)", () => {
  // ADR-027 §2 검증 규칙 개정 2026-05-31: 큰 단락 + sub-단락이 같은 절에서
  // 시작할 수 있고, 각 marker 가 자기 anchor 를 갖는다.
  const { api } = loadParallels();
  const parallels = [
    { src: [{ ref: "1역대 14:1-16" }], range: "5:11-25" },
    { src: [{ ref: "1역대 3:5-8, 14:4-7" }], range: "5:11-13" },
  ];
  const matches = api.findParallelsStartingAt(parallels, 11);
  assert.equal(matches.length, 2);
});

// ── initParallels: anchor click → tooltip ──────────────────────────────────

test("initParallels: click on ※ anchor opens tooltip with range + body parts", () => {
  const ttCalls = [];
  const { api, HTMLElement, fireBodyClick } = loadParallels({
    openNoteTooltip: (anchorEl, anchor, body) => ttCalls.push({ anchorEl, anchor, body }),
  });
  api.initParallels();
  const anchor = api.buildParallelAnchor({
    src: [{ ref: "1역대 11:1-9" }],
    range: "5:1-10",
  });
  Object.setPrototypeOf(anchor, HTMLElement.prototype);
  fireBodyClick(anchor);
  assert.equal(ttCalls.length, 1);
  assert.equal(ttCalls[0].anchorEl, anchor);
  assert.equal(ttCalls[0].anchor, "5:1-10");
  // Body should contain a button (the ref link) and the " 참조" suffix.
  assert.equal(ttCalls[0].body.length, 2);
  assert.equal(ttCalls[0].body[0].tag, "button");
  assert.equal(ttCalls[0].body[0].attrs["data-parallel-ref"], "1역대 11:1-9");
  assert.equal(ttCalls[0].body[1], " 참조");
});

test("initParallels: keydown Enter on anchor also opens tooltip", () => {
  const ttCalls = [];
  const { api, HTMLElement, fireKeydown } = loadParallels({
    openNoteTooltip: (anchorEl) => ttCalls.push(anchorEl),
  });
  api.initParallels();
  const anchor = api.buildParallelAnchor({
    src: [{ ref: "1역대 11:1-9" }],
    range: "5:1-10",
  });
  Object.setPrototypeOf(anchor, HTMLElement.prototype);
  let prevented = false;
  fireKeydown({ key: "Enter", target: anchor, preventDefault: () => { prevented = true; } });
  assert.equal(ttCalls.length, 1);
  assert.equal(prevented, true);
});

// ── initParallels: tooltip link click → cite-sheet ─────────────────────────

test("initParallels: clicking ref link inside tooltip opens cite-sheet for that ref", () => {
  const sheetCalls = [];
  const ttCloses = [];
  const { api, HTMLElement, fireBodyClick } = loadParallels({
    openCiteSheet: (src, parallels, tradition, returnFocusEl) =>
      sheetCalls.push({ src, parallels, tradition, returnFocusEl }),
    closeNoteTooltip: () => ttCloses.push(true),
  });
  api.initParallels();
  // The tooltip body returns the ref link node; stand-alone fire its click.
  const body = api.buildTooltipBody({
    src: [{ ref: "1역대 11:1-9" }],
    range: "5:1-10",
  });
  const link = body[0];
  Object.setPrototypeOf(link, HTMLElement.prototype);
  fireBodyClick(link);
  assert.equal(sheetCalls.length, 1);
  assert.equal(sheetCalls[0].src, "1역대 11:1-9");
  assert.equal(sheetCalls[0].parallels, null);
  assert.equal(sheetCalls[0].tradition, null);
  assert.equal(sheetCalls[0].returnFocusEl, link);
  // Tooltip closes after the sheet opens (no double-floating UI).
  assert.equal(ttCloses.length, 1);
});

test("initParallels: ref link with tradition forwards tradition to openCiteSheet", () => {
  const sheetCalls = [];
  const { api, HTMLElement, fireBodyClick } = loadParallels({
    openCiteSheet: (src, parallels, tradition) =>
      sheetCalls.push({ src, parallels, tradition }),
    closeNoteTooltip: () => {},
  });
  api.initParallels();
  const body = api.buildTooltipBody({
    src: [{ ref: "시편 16:8", tradition: "칠십인역" }],
    range: "2:25",
  });
  const link = body[0];
  Object.setPrototypeOf(link, HTMLElement.prototype);
  fireBodyClick(link);
  assert.equal(sheetCalls[0].src, "시편 16:8");
  assert.equal(sheetCalls[0].tradition, "칠십인역");
});

test("initParallels: keydown Enter on ref link opens cite-sheet", () => {
  const sheetCalls = [];
  const { api, HTMLElement, fireKeydown } = loadParallels({
    openCiteSheet: (src) => sheetCalls.push(src),
    closeNoteTooltip: () => {},
  });
  api.initParallels();
  const body = api.buildTooltipBody({
    src: [{ ref: "1역대 11:1-9" }],
    range: "5:1-10",
  });
  const link = body[0];
  Object.setPrototypeOf(link, HTMLElement.prototype);
  fireKeydown({ key: "Enter", target: link, preventDefault: () => {} });
  assert.equal(sheetCalls.length, 1);
});

test("initParallels: click on unrelated element triggers neither tooltip nor sheet", () => {
  const ttCalls = [];
  const sheetCalls = [];
  const { api, HTMLElement, fireBodyClick } = loadParallels({
    openCiteSheet: () => sheetCalls.push("sheet"),
    openNoteTooltip: () => ttCalls.push("tt"),
    closeNoteTooltip: () => {},
  });
  api.initParallels();
  const other = {
    tag: "div", attrs: { className: "verse" },
    classList: { contains: () => false }, closest: () => null,
  };
  Object.setPrototypeOf(other, HTMLElement.prototype);
  fireBodyClick(other);
  assert.equal(ttCalls.length, 0);
  assert.equal(sheetCalls.length, 0);
});
