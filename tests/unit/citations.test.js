// ── Unit tests for js/app/citations.js ─────────────────────────────────────
// Run with: node --test tests/unit/citations.test.js
//
// Loads citations.js in a vm context with stubbed window.appHelpers (`el`,
// `clearNode`, `trapFocus`) and tests the pure helpers exposed on
// window.appCitations. Sheet logic (DOM mounting, fetch) is out of scope for
// unit tests — covered by e2e.
//
// Sections (one per `// ── <area> ──`):
//   - _computeCiteShowPositions (dedup)
//   - chipText
//   - buildCiteChip
//   - buildNoteElement

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PATH = path.resolve(__dirname, "../../js/app/citations.js");
// Strip trailing `export {};` ESM marker so vm.runInContext can evaluate.
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8")
  .replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");

// ── Minimal DOM element stub ─────────────────────────────────────────────────
// `el(tag, attrs, ...children)` returns a plain object. Mirrors the
// signature of window.appHelpers.el so citations.js code that builds DOM via
// `el(...)` produces inspectable tree without a real document.

function makeStubEl() {
  return function el(tag, attrs, ...children) {
    const node = {
      tag,
      attrs: { ...(attrs || {}) },
      className: (attrs && attrs.className) || "",
      children: [],
      appendChild(c) { this.children.push(c); return c; },
      get textContent() { return this.children.map(c => c?.text ?? c?.textContent ?? "").join(""); },
    };
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === "string") node.children.push({ text: c });
      else node.children.push(c);
    }
    return node;
  };
}

function loadCitations() {
  const ctx = {
    console, JSON, Date, Math, Object, Array, Set, Map, Promise, Error,
    String, Number, Boolean, parseInt, parseFloat,
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  ctx.appHelpers = {
    el: makeStubEl(),
    clearNode: (n) => { n.children = []; },
    trapFocus: () => () => {},
  };
  // Minimal document stub — citations.js uses document.createTextNode in
  // buildNoteElement and the sheet body renderer.
  ctx.document = {
    createTextNode: (s) => ({ text: String(s), textContent: String(s) }),
    addEventListener: () => {},
    body: { addEventListener: () => {} },
    documentElement: { classList: { add: () => {}, remove: () => {} } },
    getElementById: () => null,
  };
  // citations.js reads from `window.appHelpers` first, but our ctx aliases
  // window to itself — both are satisfied.
  vm.runInContext(APP_SOURCE, ctx, { filename: "citations.js" });
  return ctx.appCitations;
}

// ── _computeCiteShowPositions (dedup) ────────────────────────────────────────

test("_computeCiteShowPositions: empty input → empty set", () => {
  const c = loadCitations();
  const r = c._computeCiteShowPositions([]);
  assert.equal(r.size, 0);
});

test("_computeCiteShowPositions: single cite segment → marked", () => {
  const c = loadCitations();
  const r = c._computeCiteShowPositions([
    { number: 1, segments: [{ type: "prose", text: "abc", cite: "이사 53:5" }] },
  ]);
  assert.deepEqual([...r], ["0:0"]);
});

test("_computeCiteShowPositions: two consecutive same-cite verses → only the second", () => {
  const c = loadCitations();
  const r = c._computeCiteShowPositions([
    { number: 1, segments: [{ type: "prose", text: "a", cite: "이사 8:23-9:1" }] },
    { number: 2, segments: [{ type: "prose", text: "b", cite: "이사 8:23-9:1" }] },
  ]);
  assert.deepEqual([...r], ["1:0"]);
});

test("_computeCiteShowPositions: gap verse breaks the group → both render", () => {
  const c = loadCitations();
  const r = c._computeCiteShowPositions([
    { number: 1, segments: [{ type: "prose", text: "a", cite: "이사 53:5" }] },
    { number: 2, segments: [{ type: "prose", text: "no cite" }] },
    { number: 3, segments: [{ type: "prose", text: "b", cite: "이사 53:5" }] },
  ]);
  assert.deepEqual([...r].sort(), ["0:0", "2:0"]);
});

test("_computeCiteShowPositions: different tradition breaks group", () => {
  const c = loadCitations();
  const r = c._computeCiteShowPositions([
    { number: 1, segments: [{ type: "prose", text: "a", cite: "이사 40:3" }] },
    { number: 2, segments: [{ type: "prose", text: "b", cite: "이사 40:3", tradition: "칠십인역" }] },
  ]);
  assert.deepEqual([...r].sort(), ["0:0", "1:0"]);
});

test("_computeCiteShowPositions: different parallels breaks group", () => {
  const c = loadCitations();
  const r = c._computeCiteShowPositions([
    { number: 1, segments: [{ type: "prose", text: "a", cite: "출애 20:13", parallels: ["신명 5:17"] }] },
    { number: 2, segments: [{ type: "prose", text: "b", cite: "출애 20:13" }] },
  ]);
  assert.deepEqual([...r].sort(), ["0:0", "1:0"]);
});

test("_computeCiteShowPositions: two cite segments in same verse → only later", () => {
  const c = loadCitations();
  const r = c._computeCiteShowPositions([
    {
      number: 5,
      segments: [
        { type: "prose", text: "a", cite: "이사 53:5" },
        { type: "prose", text: "b", cite: "이사 53:5" },
      ],
    },
  ]);
  assert.deepEqual([...r], ["0:1"]);
});

test("_computeCiteShowPositions: ignores segments without cite", () => {
  const c = loadCitations();
  const r = c._computeCiteShowPositions([
    {
      number: 1,
      segments: [
        { type: "prose", text: "no cite" },
        { type: "prose", text: "cited", cite: "이사 53:5" },
        { type: "prose", text: "no cite again" },
      ],
    },
  ]);
  assert.deepEqual([...r], ["0:1"]);
});

// ── chipText ─────────────────────────────────────────────────────────────────

test("chipText: src only", () => {
  const c = loadCitations();
  assert.equal(c.chipText("이사 53:5", null, null), "(이사 53:5)");
});

test("chipText: src + tradition — tradition prefixed without separator", () => {
  const c = loadCitations();
  assert.equal(c.chipText("이사 40:3", null, "칠십인역"), "(칠십인역 이사 40:3)");
});

test("chipText: src + parallels", () => {
  const c = loadCitations();
  assert.equal(
    c.chipText("출애 20:13", ["신명 5:17"], null),
    "(출애 20:13 · 신명 5:17)",
  );
});

test("chipText: src + tradition + parallels — tradition fused to primary, separator only between refs", () => {
  const c = loadCitations();
  assert.equal(
    c.chipText("이사 40:3", ["마르 1:3"], "칠십인역"),
    "(칠십인역 이사 40:3 · 마르 1:3)",
  );
});

test("chipText: multi-parallel", () => {
  const c = loadCitations();
  assert.equal(
    c.chipText("출애 20:13", ["신명 5:17", "마르 12:29"], null),
    "(출애 20:13 · 신명 5:17 · 마르 12:29)",
  );
});

test("chipText: empty parallels array treated as no parallels", () => {
  const c = loadCitations();
  assert.equal(c.chipText("이사 53:5", [], null), "(이사 53:5)");
});

// ── buildCiteChip ────────────────────────────────────────────────────────────

test("buildCiteChip: prose → inline class only", () => {
  const c = loadCitations();
  const node = c.buildCiteChip("이사 53:5", null, null, "prose");
  assert.equal(node.tag, "button");
  assert.equal(node.attrs.type, "button");
  assert.equal(node.attrs.className, "cite-chip");
  assert.equal(node.attrs["data-cite-src"], "이사 53:5");
  assert.equal(node.attrs["data-cite-tradition"], undefined);
  assert.equal(node.attrs["data-cite-parallels"], undefined);
  assert.equal(node.textContent, "(이사 53:5)");
});

test("buildCiteChip: poetry → cite-chip--poetry block class", () => {
  const c = loadCitations();
  const node = c.buildCiteChip("이사 7:14", null, "칠십인역", "poetry");
  assert.equal(node.attrs.className, "cite-chip cite-chip--poetry");
  assert.equal(node.attrs["data-cite-tradition"], "칠십인역");
  assert.equal(node.textContent, "(칠십인역 이사 7:14)");
});

test("buildCiteChip: parallels stored as semicolon-joined data attr", () => {
  const c = loadCitations();
  const node = c.buildCiteChip(
    "출애 20:13", ["신명 5:17", "마르 12:29"], null, "prose",
  );
  assert.equal(node.attrs["data-cite-parallels"], "신명 5:17;마르 12:29");
});

test("buildCiteChip: aria-label includes display text", () => {
  const c = loadCitations();
  const node = c.buildCiteChip("이사 53:5", null, null, "prose");
  assert.match(node.attrs["aria-label"], /\(이사 53:5\).*본문 보기/);
});

// ── Notes: anchor wrapping + tooltip ─────────────────────────────────────────
// wrapNoteAnchorsInArticle and tooltip open/close are DOM-positioning logic
// (TreeWalker, getBoundingClientRect, viewport math) — covered by e2e rather
// than the vm stub harness here.
