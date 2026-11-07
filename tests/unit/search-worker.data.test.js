// ── 검색 워커의 구절 표기 ↔ 전례독서 실데이터 대조 — data/ 서브모듈이 있어야 돈다 ─────
// Run with: node --test tests/unit/search-worker.data.test.js
//
// 전례독서는 독서마다 사람이 읽는 표기(`label`)와 그 뜻(`refs`, 장과 절)을 함께 저장한다. 그래서 표기를 검색창에
// 그대로 쳤을 때 tryVerseRef가 읽어 낸 장과 절이 `refs`와 같은지 전부 대조한다(ADR-005 「구절 표기와 구절 바로가기」).
// 절은 번호로 비교한다. 검색은 절의 반쪽 표시를 지우고 절 전체를 열기 때문이다.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "data");
const LECTIONARY = path.join(DATA, "lectionary");
const haveData = fs.existsSync(LECTIONARY);

function extractBlock(name, source) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) throw new Error(`marker block ${name} not found`);
  return source.slice(startIdx, endIdx + end.length);
}

function loadReadings() {
  /** @type {Map<string, { label: string, bookId: string, refs: Array<{ chapter: number, verseSpec: string }> }>} */
  const byLabel = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    if (typeof node.label === "string" && Array.isArray(node.refs)) byLabel.set(node.label, node);
    Object.values(node).forEach(walk);
  };
  for (const file of fs.readdirSync(LECTIONARY)) {
    if (file.endsWith(".json")) walk(JSON.parse(fs.readFileSync(path.join(LECTIONARY, file), "utf8")));
  }
  return [...byLabel.values()];
}

/** 장의 절 번호를 펼친다. 끝이 장의 마지막 절을 넘으면 장 화면처럼 자른다. */
function verseNumbers(spec, last, parseVerseSpec) {
  const numbers = new Set();
  const segments = spec === "all" ? [{ start: 1, end: last }] : parseVerseSpec(spec);
  for (const { start, end } of segments) {
    for (let n = start; n <= Math.min(end, last); n++) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b).join(",");
}

test("전례독서 표기를 검색창에 치면 저장된 장과 절로 읽는다", { skip: !haveData }, () => {
  const ctx = {};
  vm.createContext(ctx);
  const worker = fs.readFileSync(path.join(ROOT, "js/search-worker.js"), "utf8");
  vm.runInContext(
    `let meta = null; let loadedChunks = {}; function _setMeta(m) { meta = m; }\n${extractBlock("SEARCH_PURE", worker)}`,
    ctx,
  );
  const verseSpec = fs.readFileSync(path.join(ROOT, "js/app/verse-spec.js"), "utf8");
  vm.runInContext(extractBlock("VERSE_SPEC", verseSpec), ctx);
  ctx._setMeta(JSON.parse(fs.readFileSync(path.join(DATA, "search-meta.json"), "utf8")));

  const lastVerse = (bookId, chapter) =>
    ctx.chapterMaxVerse(JSON.parse(fs.readFileSync(path.join(DATA, "bible", `${bookId}-${chapter}.json`), "utf8")));

  const readings = loadReadings();
  assert.ok(readings.length > 1500, `전례독서 표기가 너무 적다: ${readings.length}`);
  const unread = [];
  const different = [];
  for (const { label, bookId, refs } of readings) {
    if (bookId === "cant") continue; // 송가의 표기는 성서의 장과 절이 아니다(「창조송가 1-3」)
    if (label === "에스 4:17(12-16), 17(23-25)") continue; // 괄호는 에스델 추가 본문의 번호다. 주소로 가리킬 수 없다
    const ref = ctx.tryVerseRef(label);
    if (!ref) {
      unread.push(label);
      continue;
    }
    const expected = new Map();
    for (const r of refs) {
      const last = lastVerse(bookId, r.chapter);
      const earlier = expected.get(r.chapter);
      const numbers = verseNumbers(r.verseSpec, last, ctx.parseVerseSpec);
      expected.set(r.chapter, earlier ? `${earlier},${numbers}` : numbers);
    }
    const actual = new Map(ref.parts.map((p) => [p.chapter, verseNumbers(p.verses, lastVerse(bookId, p.chapter), ctx.parseVerseSpec)]));
    const flat = (m) => JSON.stringify([...m].sort((a, b) => a[0] - b[0]).map(([c, v]) => [c, [...new Set(v.split(","))].sort((a, b) => a - b).join(",")]));
    if (flat(expected) !== flat(actual)) different.push(`${label}: 저장 ${flat(expected)} / 읽음 ${flat(actual)}`);
  }
  assert.deepStrictEqual(unread, [], "구절로 읽지 못한 표기");
  assert.deepStrictEqual(different, [], "저장된 장과 절과 다른 표기");
});
