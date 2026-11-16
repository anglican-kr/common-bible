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
/** 기도서의 번호와 공동번역의 번호가 달라 인쇄된 표기와 저장된 장과 절이 다르다(데이터 원문의 `[번호]` 줄). */
const OFFICE_RENUMBERED = new Set(["다니 3:98-4:15", "요나 1:1-17", "말라 4:1-6"]);

/** 장 번호 없이 절만 적을 수 있는 한 장짜리 책의 `bookId`(데이터 `parse_office_readings.py`의 `ONE_CHAPTER_BOOKS`). */
const ONE_CHAPTER_BOOKS = new Set(["phlm", "2john", "3john", "jude", "obad"]);

/**
 * 성무일과 표기는 인쇄된 모양 그대로다(ADR-042 §3). 검색창이 구절로 읽지 못하는 모양만 대조에서 뺀다.
 * 나머지는 감사성찬례와 같이 대조한다. 읽게 할지는 성무일과 화면을 만들 때 정한다(ADR-042 미결 10).
 */
function searchCannotReadOffice({ label, bookId }) {
  if (/[()[\]]|중/.test(label)) return true; // 생략 표시(소괄호, 대괄호)와 「중」
  if (OFFICE_RENUMBERED.has(label)) return true;
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

// ── 전례독서 검색 색인(ADR-037 §5)으로 찾기(ADR-044, 설계 docs/design/lectionary-search.md §8) ──

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** 워커의 성서 검색 묶음과 전례독서 검색 묶음을 실제 책 이름 목록과 색인으로 실행한다. */
function loadLectionarySearch() {
  const ctx = {};
  vm.createContext(ctx);
  const worker = fs.readFileSync(path.join(ROOT, "js/search-worker.js"), "utf8");
  vm.runInContext(
    `let meta = null; let loadedChunks = {}; function _setMeta(m) { meta = m; }\n`
      + `${extractBlock("SEARCH_PURE", worker)}\n${extractBlock("LECTIONARY_PURE", worker)}`,
    ctx,
  );
  ctx._setMeta(readJson(path.join(DATA, "search-meta.json")));
  const raw = readJson(path.join(LECTIONARY, "search-lectionary.json"));
  return { ctx, raw, index: ctx.buildLectionarySearchIndex(raw) };
}

const SLOT = { first: 0, psalm: 1, second: 2, gospel: 3 };

test("감사성찬례의 독서 표기를 구절로 치면 그 독서를 읽는 전례일이 나온다", { skip: !haveData }, () => {
  const { ctx, index } = loadLectionarySearch();
  const entries = readJson(path.join(LECTIONARY, "eucharist-readings.json")).entries;
  const missing = [];
  let checked = 0;
  for (const entry of entries) {
    for (const reading of entry.readings) {
      // 송가는 성구 표기로 찾는다(`루가 1:68-79`). 성구가 없는 송가(창조송가 등)는 구절로 찾을 수 없다.
      const typed = reading.bookId === "cant" ? reading.scripture_ref : reading.label;
      if (!typed || typed === "에스 4:17(12-16), 17(23-25)") continue; // 에스델 추가 본문의 번호(위의 시험과 같다)
      const ref = ctx.tryVerseRef(typed);
      if (!ref) {
        missing.push(`${entry.id} ${typed}: 구절로 읽지 못한다`);
        continue;
      }
      checked++;
      const open = ref.parts.some((p) => p.verses.split(",").some((s) => s.endsWith("-999")));
      const hit = ctx.searchLectionaryPassage(index, ref).items
        .flatMap((item) => item.hits)
        .find((h) => h.slot === SLOT[reading.slot] && h.sets.some((s) => s.id === entry.id));
      if (!hit) missing.push(`${entry.id} ${reading.slot} ${typed}: 찾지 못한다`);
      // 자기 독서는 검색어의 절을 모두 담는다. 장 끝까지 이어지는 표기는 장의 마지막 절을 몰라 따지지 않는다.
      else if (!open && !hit.full) missing.push(`${entry.id} ${reading.slot} ${typed}: 모두 담지 않는다(${hit.overlap}절)`);
    }
  }
  assert.ok(checked > 3100, `대조한 독서가 너무 적다: ${checked}`);
  assert.deepStrictEqual(missing, []);
});

test("전례일 이름과 별칭, 성인의 이름과 칭호를 치면 그 전례일이 맨 앞 단계로 나온다", { skip: !haveData }, () => {
  const { ctx, raw, index } = loadLectionarySearch();
  const problems = [];
  /** `orders`의 전례일이 모두 결과에 이름 전체가 같은 단계(1)로 있는가. 이름이 같은 날(성탄주간)이 있어 순서 값으로 가린다. */
  const expect = (query, orders) => {
    const items = ctx.searchLectionaryNames(index, query).items;
    for (const order of orders) {
      const item = items.find((x) => x.obs.order === order);
      if (!item) problems.push(`${query}: 순서 ${order}의 전례일이 없다`);
      else if (item.tier !== 1) problems.push(`${query}: 순서 ${order}의 전례일이 ${item.tier}단계다`);
    }
  };
  for (const o of raw.obs) {
    expect(o.name, [o.order]);
    for (const alias of o.aliases) expect(alias, [o.order]);
  }
  for (const saint of raw.saints) {
    const orders = saint.obs.map((i) => raw.obs[i].order);
    expect(saint.name, orders);
    expect(saint.title, orders);
  }
  assert.ok(raw.obs.length > 500 && raw.saints.length > 100, "색인의 전례일과 성인이 너무 적다");
  assert.deepStrictEqual(problems, []);
});

test("비슷한 말 표의 이름을 치면 앱의 이름으로 바꿔 찾고, 바꾼 말을 알린다", { skip: !haveData }, () => {
  const { ctx, raw, index } = loadLectionarySearch();
  const problems = [];
  for (const [from, to] of Object.entries(raw.synonyms)) {
    const r = ctx.searchLectionaryNames(index, from);
    if (!r.items.some((item) => item.tier === 1)) problems.push(`${from}: ${to}과 이름 전체가 같은 전례일이 없다`);
    if (!r.synonyms.some((s) => s.from === from && s.to === to)) problems.push(`${from}: 바꾼 말을 알리지 않는다`);
  }
  assert.deepStrictEqual(problems, []);
});

test("전례일 이름과 성인의 이름은 구절로 읽히지 않고, 책 이름으로는 짧은 이름만 읽힌다", { skip: !haveData }, () => {
  // 구절과 책 이름을 먼저 판별하므로, 이름이 그렇게 읽히면 이름 검색이 가려진다(설계 §3).
  const { ctx, raw } = loadLectionarySearch();
  const names = [
    ...raw.obs.flatMap((o) => [o.name, ...o.aliases]),
    ...raw.saints.flatMap((s) => [s.name, s.title]),
    ...Object.keys(raw.synonyms),
  ];
  assert.deepStrictEqual(names.filter((n) => ctx.tryVerseRef(n)), [], "구절로 읽히는 이름");
  // 책 이름과 같은 성인 이름(`요한`, `유다`)은 책 이름으로도 읽힌다. 앱은 첫 장 바로가기와 함께 이름 결과도 보인다(ADR-044 §2).
  const books = names.filter((n) => ctx.tryBookOnly(n)).sort();
  assert.ok(books.every((n) => !/\s|\(/.test(n)), `책 이름으로 읽히는 긴 이름: ${books.join(", ")}`);
});

test("책 이름 목록의 이름은 책 이름만 친 검색어로 읽고, 한 글자 약칭은 읽지 않는다", { skip: !haveData }, () => {
  const { ctx } = loadLectionarySearch();
  const meta = readJson(path.join(DATA, "search-meta.json"));
  const wrong = [];
  for (const [alias, id] of Object.entries(meta.aliases)) {
    // 워커는 구절 표기를 먼저 판별하므로, 구절로도 읽히는 약칭은 책 이름만 친 검색어가 되지 않는다(아래 시험).
    if (ctx.tryVerseRef(alias)) continue;
    const got = ctx.tryBookOnly(alias);
    if (Array.from(alias).length < 2) {
      if (got) wrong.push(`${alias}: 한 글자 약칭인데 ${got.bookId}로 읽는다`);
    } else if (!got || got.bookId !== id) {
      wrong.push(`${alias}: ${id}가 아니라 ${got && got.bookId}로 읽는다`);
    }
  }
  assert.deepStrictEqual(wrong, []);
  // 천주교의 띄어 쓴 책 이름(ADR-044 §2)
  assert.strictEqual(ctx.tryBookOnly("코린토 1서").bookId, "1cor");
  assert.strictEqual(ctx.tryVerseRef("코린토 1서 13:4").bookId, "1cor");
  assert.strictEqual(ctx.tryVerseRef("요한 1서 3:16").bookId, "1john");
});

test("숫자로 끝나는 약칭(`요1`)은 혼자 치면 요한 복음의 장이고, 장절을 띄어 쓰면 요한의 편지다", { skip: !haveData }, () => {
  // 구절 표기가 책 이름만 친 검색어보다 먼저다(ADR-044 §2). `창1`처럼 책과 장을 붙여 친 것으로 읽는다.
  // 요한의 편지는 `요일`, `1요한`, `요한1서`로 찾아진다.
  const { ctx } = loadLectionarySearch();
  const meta = readJson(path.join(DATA, "search-meta.json"));
  const asRef = Object.keys(meta.aliases).filter((alias) => ctx.tryVerseRef(alias)).sort();
  const read = (q) => {
    const r = ctx.tryVerseRef(q);
    return r && `${r.bookId} ${r.parts.map((p) => `${p.chapter}:${p.verses}`).join(", ")}`;
  };
  assert.deepStrictEqual(asRef.map((alias) => [alias, read(alias)]), [
    ["요1", "john 1:1-999"], ["요2", "john 2:1-999"], ["요3", "john 3:1-999"],
  ]);
  assert.strictEqual(read("요1 3:16"), "1john 3:16");
  assert.strictEqual(read("요3:16"), "john 3:16");
  assert.strictEqual(ctx.tryBookOnly("요일").bookId, "1john");
});

/** 실데이터로 세운 교회력 엔진(브라우저의 `preloadCalendar`, `preloadLectionary`와 같은 조합). 한 번만 만든다. */
let engineCache = null;
function realEngine() {
  if (engineCache) return engineCache;
  const engine = fs.readFileSync(path.join(ROOT, "js/app/liturgical-engine.js"), "utf8");
  const e = { Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error, parseInt, isNaN, Date, NaN };
  vm.createContext(e);
  vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map(); const activatedOptionals = new Set();", e);
  vm.runInContext(extractBlock("LITURGICAL_CORE", engine), e);
  vm.runInContext(extractBlock("LITURGICAL_LOOKUP", engine), e);
  const read = (file) => readJson(path.join(LECTIONARY, file));
  const sanctoral = read("sanctoral.json");
  const temporal = read("temporal-feasts.json");
  const cal = e.buildCalendarIndex({
    sanctoral, temporal, periods: read("periods.json"), ordinalWeeks: read("ordinal-weeks.json"), kasi: read("kasi-lunar.json"),
  });
  const lec = e.buildLectionaryIndex({
    readings: read("eucharist-readings.json"), collects: read("eucharist-collects.json"), commons: read("commons.json"),
  });
  return (engineCache = { e, cal, lec, sanctoral, temporal, index: read("search-lectionary.json") });
}

test("색인이 독서 세트를 잇는 전례일은 엔진이 그 세트를 내는 전례일과 같다(2025-2050)", { skip: !haveData }, () => {
  // 앱은 결과 행을 누르면 엔진으로 그 독서를 읽는 날을 찾는다(설계 §7). 색인의 전례일과 엔진의 전례일이 다르면
  // 엉뚱한 날로 가게 된다.
  const { e, cal, lec, sanctoral, temporal, index } = realEngine();
  const obsOfSet = new Map(index.sets.map((s) => [s[1], index.obs[s[0]]]));
  const tableIds = new Set([...sanctoral.entries, ...temporal.entries].map((r) => r.id));

  const served = new Set();
  /** 엔진의 전례일과 색인의 전례일이 다른 곳 */
  const differ = new Map();
  for (let y = 2025; y <= 2050; y++) {
    const pass = e.transfersOf(cal, y);
    for (let d = e.toKey(y, 1, 1); d.slice(0, 4) === String(y); d = e.addDays(d, 1)) {
      const resolved = e.resolveDateIn(cal, d, pass);
      for (const candidate of resolved.candidates) {
        const id = candidate.observance.id;
        for (const set of e.findReadingsIn(lec, cal, resolved, candidate)) {
          if (set.common) continue; // 공통 독서는 색인에 없다(ADR-044 §2)
          served.add(set.id);
          const mine = obsOfSet.get(set.id);
          // 격자의 날(`grid:`)은 표에 없는 날이라, 색인도 표의 전례일이 아닌 곳에 이어야 한다.
          const same = id.startsWith("grid:") ? !!mine && !tableIds.has(mine.key) : !!mine && mine.key === id;
          if (!same) differ.set(`${id} → ${mine && mine.key}`, { id, mine });
        }
      }
    }
  }
  assert.deepStrictEqual(index.sets.map((s) => s[1]).filter((id) => !served.has(id)), [], "엔진이 한 번도 내지 않는 독서 세트");
  // 다른 곳은 둘뿐이다(데이터 PR anglican-kr/common-bible-data#80). 사계재는 이동 축일 표의 행 하나(`t-춘계재`)가
  // 지향별 날 넷의 독서를 내고, 색인은 그 넷을 따로 둔다. 대림1주일은 표의 행과 격자의 날이 같은 날이라 하나로 합쳤다.
  const EMBER = { "t-춘계재": "춘계재", "t-하계재": "하계재", "t-추계재": "추계재", "t-동계재": "동계재" };
  const MERGED = { "grid:advent-1-sunday": "t-대림1주일" };
  const unexpected = [...differ]
    .filter(([, { id, mine }]) => !(mine && ((EMBER[id] && mine.name.includes(EMBER[id])) || MERGED[id] === mine.key)))
    .map(([k]) => k);
  assert.deepStrictEqual(unexpected, []);
  assert.strictEqual([...differ.values()].filter(({ id }) => EMBER[id]).length, 16, "사계재의 지향별 날");
});


test("보조 주소의 식별자: 색인의 독서 세트와 고유 독서가 없는 전례일의 키를 모두 안다(ADR-044 §1)", { skip: !haveData }, () => {
  const { e, cal, lec, index } = realEngine();
  const known = e.slugTargetsIn(lec, cal);
  const withSets = new Set(index.sets.map((s) => s[0]));
  const noSet = index.obs.filter((_, i) => !withSets.has(i)).map((o) => o.key);
  assert.ok(noSet.length > 100, "고유 독서가 없는 전례일");
  assert.deepStrictEqual(index.sets.map((s) => s[1]).filter((id) => !known.has(id)), [], "모르는 독서 세트");
  assert.deepStrictEqual(noSet.filter((key) => !known.has(key)), [], "모르는 전례일 키");
  assert.strictEqual(known.has("nope"), false);
});

test("보조 주소: 고유 독서가 없는 전례일은 엔진이 같은 식별자로 지키는 날이 있다(2025-2050)", { skip: !haveData }, () => {
  // 검색 결과의 줄은 고유 독서가 없는 전례일만 전례일 키를 적는다(search.js lectSlugHref). 엔진이 그 키로 지키는 날이 없으면
  // 그 줄은 「이 독서를 읽는 날을 찾지 못했습니다」가 된다.
  const { e, cal, index } = realEngine();
  const withSets = new Set(index.sets.map((s) => s[0]));
  const noSet = new Set(index.obs.filter((_, i) => !withSets.has(i)).map((o) => o.key));
  const kept = new Set();
  for (let y = 2025; y <= 2050; y++) {
    const pass = e.transfersOf(cal, y);
    for (let d = e.toKey(y, 1, 1); d.slice(0, 4) === String(y); d = e.addDays(d, 1)) {
      for (const c of e.resolveDateIn(cal, d, pass).candidates) {
        if (c.status === "proper" || c.status === "transferred_in") kept.add(c.observance.id);
      }
    }
  }
  assert.deepStrictEqual([...noSet].filter((key) => !kept.has(key)), []);
});

test("firstKeptDayIn: 독서 세트 여럿이면 가장 가까운 날이고, 지키는 날의 전례일과 찾은 세트, 트랙을 돌려준다", { skip: !haveData }, () => {
  const { e, cal, lec } = realEngine();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  // 사순2주일 가해의 복음(요한 3:1-17)은 2029년이 가해다
  assert.deepStrictEqual(plain(e.firstKeptDayIn(lec, cal, new Set(["lent-2-sun-A-t1-s1"]), "2026-11-16", "2050-12-31")),
    { date: "2029-02-25", obs: "grid:lent-2-sunday", setId: "lent-2-sun-A-t1-s1", track: null });
  // 세트 둘을 함께 주면 둘 가운데 먼저 오는 날이다
  const b = e.firstKeptDayIn(lec, cal, new Set(["advent-1-mon-B-t1-s1"]), "2026-11-16", "2050-12-31");
  const c = e.firstKeptDayIn(lec, cal, new Set(["advent-1-mon-C-t1-s1"]), "2026-11-16", "2050-12-31");
  const both = e.firstKeptDayIn(lec, cal, new Set(["advent-1-mon-B-t1-s1", "advent-1-mon-C-t1-s1"]), "2026-11-16", "2050-12-31");
  assert.strictEqual(both.date, [b.date, c.date].sort()[0]);
  // 전례일 키(고유 독서가 없는 월별 축일)는 후보의 식별자로 찾는다. 세트와 트랙은 없다
  const school = e.firstKeptDayIn(lec, cal, new Set(["d0523-성-베드로-학교-개교"]), "2026-11-16", "2050-12-31");
  assert.ok(school, "성 베드로 학교 개교");
  assert.deepStrictEqual(plain({ ...school, date: school.date.slice(5) }), { date: "05-23", obs: "d0523-성-베드로-학교-개교", setId: null, track: null });
  // 지키는 날만 센다: 사도 성 안드레아(11.30)는 2025년에 대림1주일과 겹쳐 12월 1일로 옮겨 간다
  for (const id of ["d1130-사도-성-안드레아", "d1130-사도-성-안드레아-t1-s1"]) {
    assert.strictEqual(e.firstKeptDayIn(lec, cal, new Set([id]), "2025-11-01", "2025-12-31").date, "2025-12-01", id);
  }
  // 범위 안에 없으면 null
  assert.strictEqual(e.firstKeptDayIn(lec, cal, new Set(["lent-2-sun-A-t1-s1"]), "2026-11-16", "2028-12-31"), null);
});


test("검색 결과의 굵기: 이름이 「주일」로 끝나는 이동 축일은 엔진이 언제나 일요일에 지킨다(2025-2050)", { skip: !haveData }, () => {
  // 색인에는 주일인지 적는 칸이 없어 검색 화면은 이동 축일의 이름으로 주일을 알아본다(search.js lectRowOf). 데이터의 이름이 바뀌면 이
  // 시험이 알린다. `-sun`으로 끝나는 키도 모두 이름이 「주일」로 끝나야 한다.
  const { e, cal, lec, index } = realEngine();
  const sunday = (o) => o.kind === "temporal" && /주일$/.test(o.name);
  assert.deepStrictEqual(index.obs.filter((o) => /-sun$/.test(o.key) && !sunday(o)).map((o) => o.key), []);
  const obsOfSet = new Map(index.sets.map((s) => [s[1], index.obs[s[0]]]));
  const notSunday = new Set();
  let onSunday = 0;
  for (let y = 2025; y <= 2050; y++) {
    const pass = e.transfersOf(cal, y);
    for (let d = e.toKey(y, 1, 1); d.slice(0, 4) === String(y); d = e.addDays(d, 1)) {
      const resolved = e.resolveDateIn(cal, d, pass);
      for (const c of resolved.candidates) {
        if (c.status !== "proper" && c.status !== "transferred_in") continue;
        for (const g of e.findReadingsIn(lec, cal, resolved, c)) {
          const o = obsOfSet.get(g.id);
          if (!o || !sunday(o)) continue;
          if (e.dayOfWeek(d) === 0) onSunday++;
          else notSunday.add(`${o.name} ${d}`);
        }
      }
    }
  }
  assert.ok(onSunday > 26 * 50, `일요일에 지킨 주일 독서 ${onSunday}`);
  assert.deepStrictEqual([...notSunday], []);
});
