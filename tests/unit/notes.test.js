// ── Unit tests for js/app/notes.js (calendar grid helpers) ──────────────────
// Run with: node --test tests/unit/notes.test.js
//
// Only the pure CAL_GRID block is unit-tested (month/week date math + day
// bucketing). The DOM render, view toggle, day sheet, and backup file I/O are
// e2e/manual territory (ADR-013).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(__dirname, "../../js/app/notes.js"), "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const s = SRC.indexOf(begin);
  const e = SRC.indexOf(end);
  if (s < 0 || e < 0) throw new Error(`marker block ${name} not found`);
  return SRC.slice(s, e + end.length);
}

function load() {
  const ctx = { Date, Map, Array, Number };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("CAL_GRID"), ctx, { filename: "notes-cal-grid.js" });
  return ctx;
}

test("dayKey — strips time to local midnight", () => {
  const { dayKey } = load();
  const a = dayKey(new Date(2026, 4, 31, 9, 30).getTime());
  const b = dayKey(new Date(2026, 4, 31, 23, 59).getTime());
  assert.equal(a, b);
  assert.equal(a, new Date(2026, 4, 31).getTime());
});

test("bucketByDay — counts notes per day", () => {
  const { bucketByDay, dayKey } = load();
  const d1 = new Date(2026, 4, 10, 8).getTime();
  const d1b = new Date(2026, 4, 10, 20).getTime();
  const d2 = new Date(2026, 4, 12).getTime();
  const m = bucketByDay([{ date: d1 }, { date: d1b }, { date: d2 }]);
  assert.equal(m.get(dayKey(d1)), 2);
  assert.equal(m.get(dayKey(d2)), 1);
});

test("monthGrid — 6×7, starts Sunday, spans the month", () => {
  const { monthGrid } = load();
  const g = monthGrid(new Date(2026, 4, 15).getTime()); // May 2026
  assert.equal(g.year, 2026);
  assert.equal(g.month, 4);
  assert.equal(g.weeks.length, 6);
  for (const w of g.weeks) assert.equal(w.length, 7);
  // every first cell is a Sunday
  for (const w of g.weeks) assert.equal(new Date(w[0]).getDay(), 0);
  // May 1 2026 is a Friday → appears in the first week at index 5
  const may1 = new Date(2026, 4, 1).getTime();
  assert.equal(g.weeks[0][5], may1);
});

test("weekGrid — 7 days, Sunday-start, contains the anchor", () => {
  const { weekGrid } = load();
  const anchor = new Date(2026, 4, 28).getTime(); // Thu
  const w = weekGrid(anchor);
  assert.equal(w.length, 7);
  assert.equal(new Date(w[0]).getDay(), 0);
  assert.equal(new Date(w[6]).getDay(), 6);
  assert.ok(w.some((k) => k === new Date(2026, 4, 28).getTime()));
});

test("addMonths / addDays — calendar arithmetic", () => {
  const { addMonths, addDays } = load();
  // addMonths normalizes to the 1st
  const jan31 = new Date(2026, 0, 31).getTime();
  assert.equal(addMonths(jan31, 1), new Date(2026, 1, 1).getTime());
  assert.equal(addMonths(new Date(2026, 11, 15).getTime(), 1), new Date(2027, 0, 1).getTime());
  // addDays crosses month boundaries
  assert.equal(addDays(new Date(2026, 4, 30).getTime(), 7), new Date(2026, 5, 6).getTime());
});

// ── EXTRACT_VERSES (bookmark insert passage text) ──

function loadExtract(parseVerseSpec) {
  const ctx = { Array, window: { parseVerseSpec } };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("EXTRACT_VERSES"), ctx, { filename: "notes-extract.js" });
  return ctx.extractVersesText;
}

const CHAPTER = {
  verses: [
    { number: 1, text: "한 처음에" },
    { number: 2, text: "땅은 아직" },
    { number: 3, segments: [{ text: "빛이" }, { text: "있어라" }] },
    { number: 3, part: "b", text: "셋째 부분" },
    { number: 10, text: "열번째" },
  ],
};

test("extractVersesText — 'all' joins every verse, segments concatenated", () => {
  const extract = loadExtract(() => []);
  const out = extract(CHAPTER, "all");
  assert.ok(out.includes("한 처음에"));
  assert.ok(out.includes("빛이 있어라")); // segments joined by space
  assert.ok(out.includes("열번째"));
});

test("extractVersesText — range + single spec filters verses", () => {
  // stub parseVerseSpec to mirror the real shape
  const extract = loadExtract((spec) =>
    spec === "1-2,10" ? [{ start: 1, end: 2 }, { start: 10, end: 10 }] : []);
  const out = extract(CHAPTER, "1-2,10");
  assert.ok(out.includes("한 처음에"));
  assert.ok(out.includes("땅은 아직"));
  assert.ok(out.includes("열번째"));
  assert.ok(!out.includes("빛이"));
});

test("extractVersesText — part-letter spec matches the lettered verse", () => {
  const extract = loadExtract(() => [{ start: 3, end: 3, part: "b" }]);
  const out = extract(CHAPTER, "3b");
  assert.equal(out, "셋째 부분");
});
