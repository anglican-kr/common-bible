// ── 검색 워커의 구절 표기 ↔ 전례독서 실데이터 대조 — data/ 서브모듈이 있어야 돈다 ─────
// Run with: node --test tests/unit/search-worker.data.test.js
//
// 전례독서는 독서마다 사람이 읽는 표기(`label`)와 그 뜻(`refs`, 장과 절)을 함께 저장한다. 그래서 표기를 검색창에
// 그대로 쳤을 때 tryVerseRef가 읽어 낸 장과 절이 `refs`와 같은지 전부 대조한다(ADR-005 「구절 표기와 구절 바로가기」).
// 절은 번호로 비교한다. 검색은 절의 반쪽 표시를 지우고 절 전체를 열기 때문이다.
// 성무일과(`office-readings.json`)는 표기가 인쇄된 모양 그대로라 검색창이 읽지 못하는 것이 있다. 그 종류만 뺀다(아래).

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

const OFFICE_FILE = "office-readings.json";
/**
 * 기도서의 번호와 공동번역의 번호가 달라 인쇄된 표기와 저장된 장과 절이 다르다(데이터 원문의 `[번호]` 줄).
 * 표기와 저장값의 짝으로 뺀다. 「요나 2:1-10」은 546쪽만 영어 번호이고, 519쪽은 공동번역 번호라 그대로 대조한다.
 * @type {Map<string, string>} 표기 → 저장된 `refs`의 JSON
 */
const OFFICE_RENUMBERED = new Map([
  ["다니 3:98-4:15", '[{"chapter":3,"verseSpec":"31-33"},{"chapter":4,"verseSpec":"1-15"}]'],
  ["요나 1:1-17", '[{"chapter":1,"verseSpec":"1-16"},{"chapter":2,"verseSpec":"1"}]'],
  ["요나 2:1-10", '[{"chapter":2,"verseSpec":"2-11"}]'],
  ["말라 4:1-6", '[{"chapter":3,"verseSpec":"19-24"}]'],
]);

/** 장 번호 없이 절만 적을 수 있는 한 장짜리 책의 `bookId`(데이터 `parse_office_readings.py`의 `ONE_CHAPTER_BOOKS`). */
const ONE_CHAPTER_BOOKS = new Set(["phlm", "2john", "3john", "jude", "obad"]);

/**
 * 성무일과 표기는 인쇄된 모양 그대로다(ADR-042 §3). 검색창이 구절로 읽지 못하는 모양만 대조에서 뺀다.
 * 나머지는 감사성찬례와 같이 대조한다. 읽게 할지는 성무일과 화면을 만들 때 정한다(ADR-042 미결 10).
 */
function searchCannotReadOffice({ label, bookId, refs }) {
  if (/[()[\]]|중/.test(label)) return true; // 생략 표시(소괄호, 대괄호)와 「중」
  if (OFFICE_RENUMBERED.get(label) === JSON.stringify(refs)) return true;
  if (ONE_CHAPTER_BOOKS.has(bookId)) return !label.includes(":"); // `2요한 1-8`처럼 장 번호가 없다
  if (bookId === "lps") {
    // `시편 107:31-43, 108`에서 쉼표 뒤의 숫자 하나는 시편의 장인데, 검색창은 앞 장의 절로 읽는다
    const pieces = label.replace("시편 ", "").split(", ");
    const at = pieces.findIndex((p) => p.includes(":"));
    return at >= 0 && pieces.slice(at + 1).some((p) => /^\d+$/.test(p));
  }
  return false;
}

function loadReadings() {
  /** 성무일과가 아닌 파일의 표기. 표기마다 하나다.
   * @type {Map<string, { label: string, bookId: string, refs: Array<{ chapter: number, verseSpec: string }> }>} */
  const byLabel = new Map();
  /** @type {Array<{ label: string, bookId: string, refs: Array<{ chapter: number, verseSpec: string }> }>} */
  const office = [];
  const walk = (node, file) => {
    if (Array.isArray(node)) { node.forEach((n) => walk(n, file)); return; }
    if (!node || typeof node !== "object") return;
    if (typeof node.label === "string" && Array.isArray(node.refs)) {
      if (file !== OFFICE_FILE) byLabel.set(node.label, node);
      else if (!searchCannotReadOffice(node)) office.push(node);
    }
    Object.values(node).forEach((n) => walk(n, file));
  };
  for (const file of fs.readdirSync(LECTIONARY)) {
    if (file.endsWith(".json")) walk(JSON.parse(fs.readFileSync(path.join(LECTIONARY, file), "utf8")), file);
  }
  // 다른 파일에 같은 표기가 같은 저장값으로 있으면 이미 대조되므로 건너뛴다. 저장값이 다르면 따로 대조해 어긋남을 드러낸다.
  const officeOnly = new Map();
  for (const node of office) {
    const same = byLabel.get(node.label);
    if (same && JSON.stringify(same.refs) === JSON.stringify(node.refs)) continue;
    officeOnly.set(`${node.label}\n${JSON.stringify(node.refs)}`, node);
  }
  return { readings: [...byLabel.values(), ...officeOnly.values()], officeChecked: officeOnly.size };
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

  const { readings, officeChecked } = loadReadings();
  assert.ok(readings.length > 1500, `전례독서 표기가 너무 적다: ${readings.length}`);
  // 제외 규칙이 성무일과 표기를 거의 다 빼 버리면 대조가 빈 껍데기가 된다(지금은 다른 파일에 없는 1,559개가 든다).
  // 데이터 포인터가 성무일과 파일이 생기기 전 판이면 파일이 없으므로 건너뛴다.
  if (fs.existsSync(path.join(LECTIONARY, OFFICE_FILE))) {
    assert.ok(officeChecked > 1500, `성무일과 표기 가운데 대조하는 것이 너무 적다: ${officeChecked}`);
  }
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
