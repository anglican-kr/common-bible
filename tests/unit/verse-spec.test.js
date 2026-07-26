// ── Unit tests for js/app/verse-spec.js ─────────────────────────────────────
// Run with: node --test tests/unit/verse-spec.test.js
//
// Same vm + BEGIN/END marker slice approach as bookmark-read.test.js. Covers the
// parts of the VERSE_SPEC block that are not exercised through bookmark.test.js:
// `specCoversVerse` / `chapterMaxVerse` (moved here from bookmark-read.js so the
// lectionary view can share them — ADR-038 §3) and the verse-instance identity
// helpers (ADR-039 ¶ 구절 · ADR-003 에스델 추가 본문).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(__dirname, "../../js/app/verse-spec.js"), "utf8");

function extractBlock(name, source) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) throw new Error(`marker block ${name} not found`);
  return source.slice(startIdx, endIdx + end.length);
}

const ctx = { Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error, parseInt, isNaN };
vm.createContext(ctx);
vm.runInContext(extractBlock("VERSE_SPEC", SOURCE), ctx, { filename: "verse-spec.js" });

// vm values carry the sandbox realm's prototypes, so deepStrictEqual trips on
// the cross-realm mismatch. Normalize to plain data first.
const plain = (v) => JSON.parse(JSON.stringify(v));

// ── specCoversVerse ──

test("specCoversVerse: all covers everything", () => {
  assert.strictEqual(ctx.specCoversVerse("all", 99), true);
});

test("specCoversVerse: range + hemistich membership", () => {
  assert.strictEqual(ctx.specCoversVerse("1-3,4a", 2), true);
  assert.strictEqual(ctx.specCoversVerse("1-3,4a", 4), true); // 4a promotes to verse 4
  assert.strictEqual(ctx.specCoversVerse("1-3,4a", 5), false);
});

test("specCoversVerse: an unparseable spec covers nothing", () => {
  assert.strictEqual(ctx.specCoversVerse("garbage", 1), false);
});

// ── chapterMaxVerse ──

test("chapterMaxVerse: counts a merged verse's range_end", () => {
  assert.strictEqual(ctx.chapterMaxVerse({ verses: [{ number: 1 }, { number: 4, range_end: 6 }] }), 6);
});

test("chapterMaxVerse: missing data is 0, not a throw", () => {
  assert.strictEqual(ctx.chapterMaxVerse(null), 0);
  assert.strictEqual(ctx.chapterMaxVerse({}), 0);
});

// ── verseInstanceKey ──
// 번호만으로는 절이 식별되지 않는다 — 한 장에 같은 번호의 절이 여럿 있을 수 있다.

test("verseInstanceKey: 평범한 절은 번호 그대로", () => {
  assert.strictEqual(ctx.verseInstanceKey({ number: 12 }), "12");
});

test("verseInstanceKey: 반절·추가본문·칠십인역·무번호구절·교차참조를 구분한다", () => {
  assert.strictEqual(ctx.verseInstanceKey({ number: 3, part: "a" }), "3a");
  assert.strictEqual(ctx.verseInstanceKey({ number: 17, alt_ref: 12 }), "17_12");
  assert.strictEqual(ctx.verseInstanceKey({ number: 24, lxx_only: true }), "24_lxx");
  assert.strictEqual(ctx.verseInstanceKey({ number: 4, versicle: true }), "4_v");
  assert.strictEqual(ctx.verseInstanceKey({ number: 18, chapter_ref: 24 }), "18_c24");
});

test("verseInstanceKey: 같은 번호의 무번호 구절이 번호 절과 갈린다", () => {
  // 전례시편 23편 — 4절 다음에 ¶ 구절이 같은 번호로 온다(ADR-039).
  const numbered = ctx.verseInstanceKey({ number: 4 });
  const versicle = ctx.verseInstanceKey({ number: 4, versicle: true });
  assert.notStrictEqual(numbered, versicle);
});

// ── verseInstanceKeys ──

test("verseInstanceKeys: 전례시편 23편 꼴에서 7개 절이 모두 남는다", () => {
  const verses = [
    { number: 1 }, { number: 2 }, { number: 3 }, { number: 4 },
    { number: 4, versicle: true }, { number: 5 }, { number: 6 },
  ];
  const keys = ctx.verseInstanceKeys(verses);
  assert.strictEqual(keys.length, 7);
  assert.strictEqual(new Set(keys).size, 7, `중복: ${keys}`);
});

test("verseInstanceKeys: 에스델 추가 본문처럼 한 번호 아래 여러 절도 모두 남는다", () => {
  const verses = Array.from({ length: 5 }, (_, i) => ({ number: 17, alt_ref: i + 1 }));
  assert.strictEqual(new Set(ctx.verseInstanceKeys(verses)).size, 5);
});

test("verseInstanceKeys: 원본 중복 마커는 절을 버리지 않고 순번을 붙인다", () => {
  // 원본 자체에 같은 번호가 두 번 찍힌 장(욥 32:9 등) — 어느 쪽도 버리면 안 된다.
  // vm 실현체의 배열이라 프로토타입이 달라 deepStrictEqual 을 쓰지 않는다.
  const keys = plain(ctx.verseInstanceKeys([{ number: 9 }, { number: 9 }]));
  assert.deepStrictEqual(keys, ["9", "9~2"]);
});

test("verseInstanceKeys: 빈 입력은 빈 배열", () => {
  assert.deepStrictEqual(plain(ctx.verseInstanceKeys([])), []);
  assert.deepStrictEqual(plain(ctx.verseInstanceKeys(null)), []);
});
