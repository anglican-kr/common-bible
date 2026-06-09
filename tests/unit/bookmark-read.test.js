// ── Unit tests for js/app/bookmark-read.js ──────────────────────────────────
// Run with: node --test tests/unit/bookmark-read.test.js
//
// Same vm + BEGIN/END marker slice approach as bookmark.test.js / views.test.js.
// Only the pure BOOKMARK_READ block is covered (range resolution, continuity,
// combined-reference formatting, spec membership, tree→sequence flatten). The
// async DOM renderer (renderBookmarkReadView) needs loadChapter + appendVerses +
// a real DOM and is deferred to e2e (ADR-035 / ADR-013 dual-track).
//
// `parseVerseSpec` is supplied by slicing the REAL VERSE_SPEC block from
// verse-spec.js; `sortBookmarkNodes` is stubbed as identity so display order is
// exactly the input order.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const READ_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../js/app/bookmark-read.js"), "utf8");
const VERSE_SPEC_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../js/app/verse-spec.js"), "utf8");

function extractBlock(name, source) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) throw new Error(`marker block ${name} not found`);
  return source.slice(startIdx, endIdx + end.length);
}

function load() {
  const ctx = {
    Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error,
    parseInt, isNaN,
  };
  vm.createContext(ctx);
  // sortBookmarkNodes stub: identity (display order == input order).
  const prelude = `function sortBookmarkNodes(x) { return x || []; }\n`;
  // The real verse-spec utilities (parseVerseSpec et al.) hoist into the context.
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  vm.runInContext(prelude + extractBlock("BOOKMARK_READ", READ_SOURCE), ctx, { filename: "bookmark-read.js" });
  return ctx;
}

const ctx = load();

// vm objects carry the sandbox realm's prototypes, so deepStrictEqual would trip
// on the cross-realm [[Prototype]] mismatch. Normalize both sides to plain data.
const plain = (v) => JSON.parse(JSON.stringify(v));

// ── _bmRange ─────────────────────────────────────────────────────────────────

test("_bmRange: whole-chapter (all) spans verse 1 → max, covers chapter end", () => {
  const r = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "all" }, 31);
  assert.deepStrictEqual(plain(r), {
    bookId: "gen", startCh: 1, startV: 1, endCh: 1, endV: 31,
    endDisplay: "31", coversChapterEnd: true, wholeChapter: true,
  });
});

test("_bmRange: verse spec keeps hemistich part in endDisplay, integer in endV", () => {
  const r = ctx._bmRange({ bookId: "gen", chapter: 2, verseSpec: "1-3,4a" }, 25);
  assert.strictEqual(r.startV, 1);
  assert.strictEqual(r.endV, 4);
  assert.strictEqual(r.endDisplay, "4a");
  assert.strictEqual(r.coversChapterEnd, false);
  assert.strictEqual(r.wholeChapter, false);
});

test("_bmRange: a tail range reaching the chapter max covers chapter end", () => {
  const r = ctx._bmRange({ bookId: "gen", chapter: 3, verseSpec: "20-24" }, 24);
  assert.strictEqual(r.coversChapterEnd, true);
  assert.strictEqual(r.endDisplay, "24");
});

// ── _isContinuous ──────────────────────────────────────────────────────────────

test("_isContinuous: next verse in the same chapter joins", () => {
  const prev = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "1-3" }, 31);
  const cur = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "4-5" }, 31);
  assert.strictEqual(ctx._isContinuous(prev, cur), true);
});

test("_isContinuous: whole chapter → verse 1 of next chapter joins (창세 1장 + 2:1-4a)", () => {
  const prev = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "all" }, 31);
  const cur = ctx._bmRange({ bookId: "gen", chapter: 2, verseSpec: "1-3,4a" }, 25);
  assert.strictEqual(ctx._isContinuous(prev, cur), true);
});

test("_isContinuous: gap in the same chapter does not join", () => {
  const prev = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "1-3" }, 31);
  const cur = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "6-7" }, 31);
  assert.strictEqual(ctx._isContinuous(prev, cur), false);
});

test("_isContinuous: next chapter v1 but prev did not reach chapter end → no join", () => {
  const prev = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "1-3" }, 31);
  const cur = ctx._bmRange({ bookId: "gen", chapter: 2, verseSpec: "1-2" }, 25);
  assert.strictEqual(ctx._isContinuous(prev, cur), false);
});

test("_isContinuous: different book never joins", () => {
  const prev = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "all" }, 31);
  const cur = ctx._bmRange({ bookId: "exod", chapter: 1, verseSpec: "1-2" }, 22);
  assert.strictEqual(ctx._isContinuous(prev, cur), false);
});

// ── _combinedRef ───────────────────────────────────────────────────────────────

test("_combinedRef: a lone whole chapter reads as 창세 1장", () => {
  const r = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "all" }, 31);
  assert.strictEqual(ctx._combinedRef("창세", "장", r, r, true), "창세 1장");
});

test("_combinedRef: cross-chapter group → 창세 1:1–2:4a", () => {
  const first = ctx._bmRange({ bookId: "gen", chapter: 1, verseSpec: "all" }, 31);
  const last = ctx._bmRange({ bookId: "gen", chapter: 2, verseSpec: "1-3,4a" }, 25);
  assert.strictEqual(ctx._combinedRef("창세", "장", first, last, false), "창세 1:1–2:4a");
});

test("_combinedRef: same-chapter range → 창세 12:1–9", () => {
  const first = ctx._bmRange({ bookId: "gen", chapter: 12, verseSpec: "1-9" }, 20);
  assert.strictEqual(ctx._combinedRef("창세", "장", first, first, false), "창세 12:1–9");
});

test("_combinedRef: single verse collapses to one ref", () => {
  const r = ctx._bmRange({ bookId: "gen", chapter: 3, verseSpec: "5" }, 24);
  assert.strictEqual(ctx._combinedRef("창세", "장", r, r, false), "창세 3:5");
});

// ── _specCoversVerse ───────────────────────────────────────────────────────────

test("_specCoversVerse: all covers everything", () => {
  assert.strictEqual(ctx._specCoversVerse("all", 99), true);
});

test("_specCoversVerse: range + hemistich membership", () => {
  assert.strictEqual(ctx._specCoversVerse("1-3,4a", 2), true);
  assert.strictEqual(ctx._specCoversVerse("1-3,4a", 4), true); // 4a promotes to verse 4
  assert.strictEqual(ctx._specCoversVerse("1-3,4a", 5), false);
});

// ── buildReadingSequence ───────────────────────────────────────────────────────

test("buildReadingSequence: folders emit depth-tagged headings, bookmarks leaves, nested recursed", () => {
  const bm1 = { type: "bookmark", id: "b1", bookId: "gen", chapter: 1, verseSpec: "all", label: "제1독서" };
  const bm2 = { type: "bookmark", id: "b2", bookId: "ps", chapter: 1, verseSpec: "all", label: "시편" };
  const bm3 = { type: "bookmark", id: "b3", bookId: "mat", chapter: 5, verseSpec: "1-12", label: "복음서" };
  const tree = [
    { type: "folder", id: "f1", name: "가해", children: [
      bm1,
      { type: "folder", id: "f2", name: "성령강림", children: [bm2] },
    ] },
    bm3,
  ];
  const seq = ctx.buildReadingSequence(tree);
  assert.deepStrictEqual(plain(seq), plain([
    { type: "folder", name: "가해", depth: 0 },
    { type: "bookmark", bm: bm1, depth: 1 },
    { type: "folder", name: "성령강림", depth: 1 },
    { type: "bookmark", bm: bm2, depth: 2 },
    { type: "bookmark", bm: bm3, depth: 0 },
  ]));
});
