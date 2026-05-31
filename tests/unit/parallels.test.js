// ── Unit tests for js/app/parallels.js ─────────────────────────────────────
// Run with: node --test tests/unit/parallels.test.js
//
// Loads parallels.js in a vm context with stubbed window.appHelpers (`el`) and
// a minimal `document`. Click delegation + cite-sheet handoff are exercised
// via a stub `appCitations.openCiteSheet` (assert it gets called with the
// right (src, parallels, tradition, returnFocusEl) tuple).
//
// Sections (one per `// ── <area> ──`):
//   - parseRange
//   - bannerText
//   - buildParallelBanner
//   - findParallelStartingAt
//   - initParallels (click delegation → openCiteSheet handoff)

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// vm contexts have separate Object prototypes, so plain `deepStrictEqual` on
// objects produced inside the loaded module fails even when shapes match.
// JSON round-trip flattens the prototype mismatch — fine here since all values
// under test are JSON-serializable.
function jsonEqual(actual, expected, message) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PATH = path.resolve(__dirname, "../../js/app/parallels.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8")
  .replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");

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
        // For tests we just check className membership against ".cls" selector.
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

function loadParallels({ openCiteSheet } = {}) {
  // Capture event listeners so tests can fire them.
  const bodyClickListeners = [];
  const keydownListeners = [];
  const ctx = {
    console, JSON, Date, Math, Object, Array, Set, Map, Promise, Error,
    String, Number, Boolean, parseInt, parseFloat, RegExp,
    HTMLElement: function HTMLElement() {},  // instanceof check support
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  ctx.appHelpers = { el: makeStubEl() };
  ctx.appCitations = openCiteSheet ? { openCiteSheet } : null;
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

// ── bannerText ──────────────────────────────────────────────────────────────

test("bannerText: single src no tradition", () => {
  const { api } = loadParallels();
  assert.equal(
    api.bannerText({ src: [{ ref: "2사무 5:1-10" }], range: "11:1-9" }),
    "병행: 2사무 5:1-10",
  );
});

test("bannerText: multi src joined with ·", () => {
  const { api } = loadParallels();
  assert.equal(
    api.bannerText({
      src: [{ ref: "2사무 5:1-10" }, { ref: "2사무 23:8-39" }],
      range: "11:1-9",
    }),
    "병행: 2사무 5:1-10 · 2사무 23:8-39",
  );
});

test("bannerText: per-source tradition prefixes that ref", () => {
  const { api } = loadParallels();
  assert.equal(
    api.bannerText({
      src: [{ ref: "시편 16:8", tradition: "칠십인역" }, { ref: "사도 2:25" }],
      range: "1:1",
    }),
    "병행: 칠십인역 시편 16:8 · 사도 2:25",
  );
});

test("bannerText: empty src → label only", () => {
  const { api } = loadParallels();
  assert.equal(api.bannerText({ src: [], range: "11" }), "병행");
});

// ── buildParallelBanner ─────────────────────────────────────────────────────

test("buildParallelBanner: aside + role=button + data-* attrs", () => {
  const { api } = loadParallels();
  const node = api.buildParallelBanner({
    src: [{ ref: "2사무 5:1-10" }],
    range: "11:1-9",
  });
  assert.equal(node.tag, "aside");
  assert.equal(node.attrs.role, "button");
  assert.equal(node.attrs.tabindex, "0");
  assert.equal(node.attrs.className, "parallel-banner");
  assert.equal(node.attrs["data-parallel-range"], "11:1-9");
  assert.equal(node.attrs["data-parallel-src"], "2사무 5:1-10");
  assert.equal(node.textContent, "병행: 2사무 5:1-10");
  assert.match(node.attrs["aria-label"], /병행: 2사무 5:1-10.*본문 보기/);
});

test("buildParallelBanner: per-source tradition serialized as `[전통]` (round-trips source)", () => {
  // Data attr re-uses the same `[전통]` inline notation as source markdown
  // and cite-chip data attrs, so the click handler can rehydrate without
  // a parallel encoding scheme.
  const { api } = loadParallels();
  const node = api.buildParallelBanner({
    src: [{ ref: "시편 16:8", tradition: "칠십인역" }, { ref: "사도 2:25" }],
    range: "11:1-9",
  });
  assert.equal(
    node.attrs["data-parallel-src"],
    "시편 16:8 [칠십인역];사도 2:25",
  );
});

// ── findParallelStartingAt ──────────────────────────────────────────────────

test("findParallelStartingAt: matches verse number == range start", () => {
  const { api } = loadParallels();
  const parallels = [
    { src: [{ ref: "2사무 5:1-10" }], range: "11:1-9" },
    { src: [{ ref: "2사무 23:8-39" }], range: "11:10-47" },
  ];
  jsonEqual(api.findParallelStartingAt(parallels, 1), parallels[0]);
  jsonEqual(api.findParallelStartingAt(parallels, 10), parallels[1]);
});

test("findParallelStartingAt: no match → null", () => {
  const { api } = loadParallels();
  const parallels = [{ src: [{ ref: "2사무 5:1-10" }], range: "11:1-9" }];
  assert.equal(api.findParallelStartingAt(parallels, 5), null);
});

test("findParallelStartingAt: null/empty parallels → null", () => {
  const { api } = loadParallels();
  assert.equal(api.findParallelStartingAt(null, 1), null);
  assert.equal(api.findParallelStartingAt(undefined, 1), null);
  assert.equal(api.findParallelStartingAt([], 1), null);
});

test("findParallelStartingAt: whole-chapter shorthand range='13' matches verse 1", () => {
  const { api } = loadParallels();
  const parallels = [{ src: [{ ref: "2사무 6" }], range: "13" }];
  jsonEqual(api.findParallelStartingAt(parallels, 1), parallels[0]);
  assert.equal(api.findParallelStartingAt(parallels, 2), null);
});

// ── initParallels (click → cite-sheet handoff) ──────────────────────────────

test("initParallels: click on banner calls openCiteSheet with first src as primary", () => {
  const calls = [];
  const { api, HTMLElement, fireBodyClick } = loadParallels({
    openCiteSheet: (src, parallels, tradition, returnFocusEl) => {
      calls.push({ src, parallels, tradition, returnFocusEl });
    },
  });
  api.initParallels();
  // Build a banner node and dress it up to satisfy the HTMLElement instanceof check.
  const banner = api.buildParallelBanner({
    src: [{ ref: "2사무 5:1-10" }],
    range: "11:1-9",
  });
  Object.setPrototypeOf(banner, HTMLElement.prototype);
  fireBodyClick(banner);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].src, "2사무 5:1-10");
  assert.equal(calls[0].parallels, null);
  assert.equal(calls[0].tradition, null);
  assert.equal(calls[0].returnFocusEl, banner);
});

test("initParallels: multi-src → first becomes primary, rest become sheet parallels", () => {
  const calls = [];
  const { api, HTMLElement, fireBodyClick } = loadParallels({
    openCiteSheet: (src, parallels, tradition) => calls.push({ src, parallels, tradition }),
  });
  api.initParallels();
  const banner = api.buildParallelBanner({
    src: [
      { ref: "2사무 5:1-10" },
      { ref: "시편 16:8", tradition: "칠십인역" },
    ],
    range: "11:1-9",
  });
  Object.setPrototypeOf(banner, HTMLElement.prototype);
  fireBodyClick(banner);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].src, "2사무 5:1-10");
  // JSON round-trip — vm contexts have separate Object prototypes so
  // deepStrictEqual fails on otherwise-equivalent objects.
  assert.equal(
    JSON.stringify(calls[0].parallels),
    JSON.stringify([{ ref: "시편 16:8", tradition: "칠십인역" }]),
  );
  assert.equal(calls[0].tradition, null);  // primary has no tradition
});

test("initParallels: primary tradition is forwarded as the sheet's tradition arg", () => {
  const calls = [];
  const { api, HTMLElement, fireBodyClick } = loadParallels({
    openCiteSheet: (src, parallels, tradition) => calls.push({ src, parallels, tradition }),
  });
  api.initParallels();
  const banner = api.buildParallelBanner({
    src: [{ ref: "이사 40:3", tradition: "칠십인역" }],
    range: "11:1-9",
  });
  Object.setPrototypeOf(banner, HTMLElement.prototype);
  fireBodyClick(banner);
  assert.equal(calls[0].src, "이사 40:3");
  assert.equal(calls[0].tradition, "칠십인역");
});

test("initParallels: keydown Enter on banner also triggers openCiteSheet", () => {
  const calls = [];
  const { api, HTMLElement, fireKeydown } = loadParallels({
    openCiteSheet: (src) => calls.push(src),
  });
  api.initParallels();
  const banner = api.buildParallelBanner({
    src: [{ ref: "2사무 5:1-10" }],
    range: "11:1-9",
  });
  Object.setPrototypeOf(banner, HTMLElement.prototype);
  let prevented = false;
  fireKeydown({ key: "Enter", target: banner, preventDefault: () => { prevented = true; } });
  assert.equal(calls.length, 1);
  assert.equal(prevented, true);
});

test("initParallels: non-banner click does NOT call openCiteSheet", () => {
  const calls = [];
  const { api, HTMLElement, fireBodyClick } = loadParallels({
    openCiteSheet: () => calls.push("called"),
  });
  api.initParallels();
  // Plain element that isn't a banner
  const other = { tag: "div", attrs: { className: "verse" }, classList: { contains: () => false }, closest: () => null };
  Object.setPrototypeOf(other, HTMLElement.prototype);
  fireBodyClick(other);
  assert.equal(calls.length, 0);
});
