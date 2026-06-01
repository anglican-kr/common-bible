// ── Unit tests for js/sync/notes-store.js ───────────────────────────────────
// Run with: node --test tests/unit/notes-store.test.js
//
// Marker-slice + vm approach (as views-routing/bottom-nav tests). Covers the
// pure logic — content hashing, title derivation, and the per-note sync plan
// (the conflict-resolution heart, ADR-026). IDB cache, durability draft, and
// the Drive executor are DOM/IDB-heavy and deferred to e2e + manual (ADR-013).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(__dirname, "../../js/sync/notes-store.js"), "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const s = SRC.indexOf(begin);
  const e = SRC.indexOf(end);
  if (s < 0 || e < 0) throw new Error(`marker block ${name} not found`);
  return SRC.slice(s, e + end.length);
}

function load(...blocks) {
  const ctx = { Math, String, Object, Set, isFinite, Infinity, Number };
  vm.createContext(ctx);
  for (const b of blocks) vm.runInContext(extractBlock(b), ctx, { filename: `notes-${b}.js` });
  return ctx;
}

// ── NOTE_HASH ──

test("noteContentHash — stable for identical content, differs otherwise", () => {
  const { noteContentHash } = load("NOTE_HASH");
  const a = { title: "묵상", body: "오늘의 말씀", date: 100, refs: [] };
  assert.equal(noteContentHash(a), noteContentHash({ ...a }));
  assert.notEqual(noteContentHash(a), noteContentHash({ ...a, body: "다른 말씀" }));
  assert.notEqual(noteContentHash(a), noteContentHash({ ...a, title: "기도" }));
  assert.notEqual(noteContentHash(a), noteContentHash({ ...a, date: 200 }));
});

test("noteContentHash — reflects refs, ignores absent vs empty consistently", () => {
  const { noteContentHash } = load("NOTE_HASH");
  const base = { title: "t", body: "b", date: 1 };
  assert.equal(noteContentHash(base), noteContentHash({ ...base, refs: [] }));
  assert.notEqual(
    noteContentHash(base),
    noteContentHash({ ...base, refs: [{ bookId: "genesis", chapter: 1, verseSpec: "1-3" }] }),
  );
});

// ── NOTE_TITLE ──

test("deriveTitle — first non-empty line, markers stripped", () => {
  const { deriveTitle } = load("NOTE_TITLE");
  assert.equal(deriveTitle("## 제목\n본문"), "제목");
  assert.equal(deriveTitle("\n\n> 인용 구절\n"), "인용 구절");
  assert.equal(deriveTitle("- 항목 하나"), "항목 하나");
  assert.equal(deriveTitle("- [ ] 할 일"), "할 일");
  assert.equal(deriveTitle("그냥 본문 첫 줄"), "그냥 본문 첫 줄");
});

test("deriveTitle — empty body and length cap", () => {
  const { deriveTitle } = load("NOTE_TITLE");
  assert.equal(deriveTitle(""), "제목 없음");
  assert.equal(deriveTitle("   \n  "), "제목 없음");
  assert.equal(deriveTitle("x".repeat(200)).length, 80);
});

// ── SYNC_PLAN ──

function mk(notes = {}, tombstones = {}, synced = {}) { return { notes, tombstones, synced }; }

test("planSync — brand new local note uploads; new remote downloads", () => {
  const { planSync } = load("NOTE_HASH", "SYNC_PLAN");
  const local = mk({ a: { updatedAt: 5, hash: "h1" } }, {}, {});
  const remote = mk({ b: { updatedAt: 5, hash: "h2" } });
  const p = planSync(local, remote);
  assert.deepEqual(p.uploads, ["a"]);
  assert.deepEqual(p.downloads, ["b"]);
});

test("planSync — one-sided changes", () => {
  const { planSync } = load("SYNC_PLAN");
  // local changed (hash != synced), remote unchanged (== synced)
  let p = planSync(
    mk({ a: { updatedAt: 9, hash: "new" } }, {}, { a: { hash: "old", updatedAt: 5 } }),
    mk({ a: { updatedAt: 5, hash: "old" } }),
  );
  assert.deepEqual(p.uploads, ["a"]);
  assert.deepEqual(p.downloads, []);
  // remote changed, local unchanged
  p = planSync(
    mk({ a: { updatedAt: 5, hash: "old" } }, {}, { a: { hash: "old", updatedAt: 5 } }),
    mk({ a: { updatedAt: 9, hash: "new" } }),
  );
  assert.deepEqual(p.downloads, ["a"]);
  assert.deepEqual(p.uploads, []);
});

test("planSync — converged (both unchanged) and identical edits are no-ops", () => {
  const { planSync } = load("SYNC_PLAN");
  // both equal to synced
  let p = planSync(
    mk({ a: { updatedAt: 5, hash: "h" } }, {}, { a: { hash: "h", updatedAt: 5 } }),
    mk({ a: { updatedAt: 5, hash: "h" } }),
  );
  assert.deepEqual([p.uploads, p.downloads, p.conflicts], [[], [], []]);
  // both changed but to the same content → converge, no transfer, no conflict
  p = planSync(
    mk({ a: { updatedAt: 9, hash: "same" } }, {}, { a: { hash: "old", updatedAt: 1 } }),
    mk({ a: { updatedAt: 8, hash: "same" } }),
  );
  assert.deepEqual([p.uploads, p.downloads, p.conflicts], [[], [], []]);
});

test("planSync — real conflict when both diverge to different content", () => {
  const { planSync } = load("SYNC_PLAN");
  const p = planSync(
    mk({ a: { updatedAt: 9, hash: "L" } }, {}, { a: { hash: "old", updatedAt: 1 } }),
    mk({ a: { updatedAt: 8, hash: "R" } }),
  );
  assert.deepEqual(p.conflicts, ["a"]);
  assert.deepEqual([p.uploads, p.downloads], [[], []]);
});

test("planSync — delete vs unchanged honors deletion; delete vs edit resurrects", () => {
  const { planSync } = load("SYNC_PLAN");
  // remote deleted, local unchanged since sync → deleteLocal
  let p = planSync(
    mk({ a: { updatedAt: 5, hash: "h" } }, {}, { a: { hash: "h", updatedAt: 5 } }),
    mk({}, { a: 7 }),
  );
  assert.deepEqual(p.deleteLocal, ["a"]);
  assert.equal(p.tombstones.a, 7);
  // remote deleted but local edited → edit wins (upload)
  p = planSync(
    mk({ a: { updatedAt: 9, hash: "edited" } }, {}, { a: { hash: "h", updatedAt: 5 } }),
    mk({}, { a: 7 }),
  );
  assert.deepEqual(p.uploads, ["a"]);
  assert.deepEqual(p.deleteLocal, []);
});

test("planSync — local delete propagates; remote edit after delete resurrects", () => {
  const { planSync } = load("SYNC_PLAN");
  // local deleted (tomb 8), remote still at synced → deleteRemote
  let p = planSync(
    mk({}, { a: 8 }, { a: { hash: "h", updatedAt: 5 } }),
    mk({ a: { updatedAt: 5, hash: "h" } }),
  );
  assert.deepEqual(p.deleteRemote, ["a"]);
  assert.equal(p.tombstones.a, 8);
  // remote edited (updatedAt 10 > tomb 8) to new content → resurrect (download)
  p = planSync(
    mk({}, { a: 8 }, { a: { hash: "h", updatedAt: 5 } }),
    mk({ a: { updatedAt: 10, hash: "new" } }),
  );
  assert.deepEqual(p.downloads, ["a"]);
  assert.deepEqual(p.deleteRemote, []);
});

test("pickConflictWinner — LWW on updatedAt, deviceId breaks ties", () => {
  const { pickConflictWinner } = load("SYNC_PLAN");
  assert.equal(pickConflictWinner(10, 5, "devA", "devB"), "local");
  assert.equal(pickConflictWinner(5, 10, "devA", "devB"), "remote");
  assert.equal(pickConflictWinner(7, 7, "devA", "devB"), "local");  // devA <= devB
  assert.equal(pickConflictWinner(7, 7, "devZ", "devB"), "remote"); // devZ > devB
});

// ── NOTIFY (listener dispatch must snapshot — regression for the freeze) ──

test("_notify — re-subscribing listener does not loop (snapshot dispatch)", () => {
  const listeners = new Set();
  const ctx = { _listeners: listeners, Array };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("NOTIFY"), ctx, { filename: "notes-notify.js" });

  // Mirror renderNotesList exactly: each listener, when called, unsubscribes
  // itself and subscribes a *fresh* listener that does the same. A live-Set
  // iterator would keep visiting each newly added listener → unbounded chain
  // (the UI freeze). A snapshot dispatch calls only the one present at start.
  // The throw guard means the buggy (live-iteration) code FAILS this test.
  let calls = 0;
  const make = () => {
    const fn = () => {
      calls++;
      if (calls > 1000) throw new Error("infinite notify loop (live Set iteration)");
      listeners.delete(fn);
      listeners.add(make());
    };
    return fn;
  };
  listeners.add(make());
  ctx._notify();
  assert.equal(calls, 1);
});
