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
// The worker's state outside its code blocks: the meta file, the loaded chunks, and the 송가 names, which come from
// books.json as the worker reads them (ADR-047 §5).
const PRELUDE = "let meta = null; let loadedChunks = {}; let chapterTitles = {};"
  + " function _setMeta(m) { meta = m; } function _setTitles(t) { chapterTitles = t; }";
/** books.json `titles` per book id — what the worker builds from the book list. */
function realTitles() {
  const books = JSON.parse(fs.readFileSync(path.join(DATA, "books.json"), "utf8"));
  return Object.fromEntries(books.filter((b) => b.titles).map((b) => [b.id, b.titles]));
}
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
    `${PRELUDE}\n${extractBlock("SEARCH_PURE", worker)}`,
    ctx,
  );
  const verseSpec = fs.readFileSync(path.join(ROOT, "js/app/verse-spec.js"), "utf8");
  vm.runInContext(extractBlock("VERSE_SPEC", verseSpec), ctx);
  ctx._setMeta(JSON.parse(fs.readFileSync(path.join(DATA, "search-meta.json"), "utf8")));
  ctx._setTitles(realTitles());

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
    `${PRELUDE}\n${extractBlock("SEARCH_PURE", worker)}\n${extractBlock("LECTIONARY_PURE", worker)}`,
    ctx,
  );
  ctx._setMeta(readJson(path.join(DATA, "search-meta.json")));
  ctx._setTitles(realTitles());
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

test("지역 축일: 소속교회의 축성일은 본당 이름으로, 다른 본당은 안내로 찾아지고, 교구 설립일은 그 교구의 본당에서 찾는다(ADR-044 §3)", { skip: !haveData }, () => {
  const { ctx, index } = loadLectionarySearch();
  const table = readJson(path.join(LECTIONARY, "local-observances.json"));
  index.local = ctx.buildLocalIndex(table);
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const parishes = plain(index.local.parishes);
  assert.ok(parishes.length > 100, `본당이 너무 적다: ${parishes.length}`);
  const problems = [];
  for (const p of parishes) {
    const base = p.name.replace(/(성당|교회)$/, "");
    if (p.kind === "consecration") {
      // 소속교회면 이름, 「성당」을 뗀 이름, 「교회」를 붙인 이름 모두 맨 앞 단계의 축성일 줄이다
      for (const q of [p.name, base, `${base}교회`]) {
        const r = plain(ctx.searchLocal(index, q, p.churchId));
        const row = r.items.find((it) => it.local.level === "dedication");
        if (!row || row.tier !== 1 || row.obs.name !== `${p.name} 축성일`) problems.push(`${q}: 축성일 줄 ${JSON.stringify(row && [row.obs.name, row.tier])}`);
      }
    }
    // 소속교회가 아니면 「성당」을 붙인 이름이 그 본당을 알린다(같은 이름이 먼저다)
    const notice = plain(ctx.searchLocal(index, `${base}성당`, "")).notice;
    if (!notice || notice.name !== p.name || notice.kind !== p.kind) problems.push(`${base}성당: 안내 ${JSON.stringify(notice)}`);
  }
  assert.deepStrictEqual(problems, []);
  // 교구 설립일은 그 교구에 속한 본당을 소속교회로 고르면 찾아진다
  for (const d of plain(index.local.dioceses)) {
    const p = parishes.find((x) => x.diocese === d.name);
    assert.ok(p, d.name);
    const rows = plain(ctx.searchLocal(index, `${d.name}교구설립일`, p.churchId)).items;
    assert.deepStrictEqual(rows.map((it) => [it.obs.name, it.tier, it.local.year]), [[`${d.name}교구설립일`, 1, d.year]]);
  }
  // 북한에 있던 성당은 찾지 않는다
  const north = table.parishes.find((x) => x.name.startsWith("북."));
  assert.ok(north);
  assert.strictEqual(plain(ctx.searchLocal(index, north.name, north.church_id)).items.length, 0);
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


/** 2026-11-16 기준 지키는 날의 표(2050년까지). 시험 여럿이 함께 쓴다. */
let keptTableCache = null;
function keptTable() {
  if (keptTableCache) return keptTableCache;
  const { e, cal, lec } = realEngine();
  // 실데이터를 확인하는 범위(2025-2050년)까지 센 표다. 앱의 표는 시작하는 해부터 30년 뒤까지 센다(엔진 `keptLastFrom`)
  const table = { from: e.liturgicalYearSpan(TODAY).from, to: "", last: "2050-12-31", byId: new Map(), byName: new Map() };
  e.extendKeptDaysIn(lec, cal, table, "2050-12-31");
  return (keptTableCache = table);
}
const TODAY = "2026-11-16";

test("yearDaysIn: 그해에 지키는 날, 옮겨 지키는 날, 겹쳐 기념만 하는 날, 지키지 않는 해(ADR-044 §4)", { skip: !haveData }, () => {
  const { e, cal, lec } = realEngine();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const y26 = e.yearDaysIn(lec, cal, 2026);
  const y27 = e.yearDaysIn(lec, cal, 2027);
  // 2026-12-06은 대림 2주일이라 성 니콜라를 12월 7일에 지킨다(2027 전례독서 책자와 같다)
  const nicola = plain(e.yearDayIn(y26, ["d1206-성-니콜라-t1-s1"], "d1206-성-니콜라"));
  assert.deepStrictEqual([nicola.kind, nicola.date, nicola.from, nicola.setId], ["moved", "2026-12-07", "2026-12-06", "d1206-성-니콜라-t1-s1"]);
  // 2027-03-21은 성지주일이라 토마스 크랜머는 기념만 한다. 색은 그날 기본 화면의 색이다
  const cranmer = plain(e.yearDayIn(y27, ["d0321-토마스-크랜머"], "d0321-토마스-크랜머"));
  assert.deepStrictEqual([cranmer.kind, cranmer.date, cranmer.by, cranmer.colors], ["overlap", "2027-03-21", "성지주일", ["red"]]);
  assert.strictEqual(plain(e.yearDayIn(y26, ["d0321-토마스-크랜머"], "d0321-토마스-크랜머")).kind, "kept", "2026-03-21은 토요일");
  assert.strictEqual(cranmer.bySaint, false, "주일은 성인 축일이 아니다");
  // 독서 세트가 있어도 겹치면 전례일로 찾는다
  assert.strictEqual(plain(e.yearDayIn(y27, ["d0815-광복절-t1-s1"], "d0815-광복절")).by, "연중 20주일");
  // 겹친 전례일이 성인 축일인지 넘긴다. 국가 명절(추석)은 성인 축일이 아니다
  const ambrose = plain(e.yearDayIn(y26, [], "d1207-암브로스"));
  assert.deepStrictEqual([ambrose.date, ambrose.bySaint], ["2026-12-07", true]);
  assert.match(ambrose.by, /^성 니콜라/);
  const cyprian = plain(e.yearDayIn(y27, [], "d0915-키프리안"));
  assert.deepStrictEqual([cyprian.by, cyprian.bySaint], ["추석 명절", false]);
  // 2027년에는 연중6주일이 없다(재의 수요일이 2월 10일)
  assert.strictEqual(e.yearDayIn(y27, ["ordinary-6-sun-A-t1-s1", "ordinary-6-sun-B-t1-s1", "ordinary-6-sun-C-t1-s1"], "ordinary-6-sun"), null);
  // 해에 따라 다른 독서는 그해에 읽는 세트다. 양력 2027년의 대림1주일은 11월 28일, 다해다
  const advent = plain(e.yearDayIn(y27, ["advent-1-sun-A-t1-s1", "advent-1-sun-B-t1-s1", "advent-1-sun-C-t1-s1"], "t-대림1주일"));
  assert.deepStrictEqual([advent.kind, advent.date, advent.setId], ["kept", "2027-11-28", "advent-1-sun-C-t1-s1"]);
  // 성탄 평일은 그날의 이름을 담는다(앱이 그해의 이름으로 거른다)
  assert.strictEqual(plain(e.yearDayIn(y27, ["d0102-성탄주간-t1-s1"], "d0102-성탄주간")).name, "성탄 1주 토요일");
  assert.strictEqual(e.yearDayIn(y27, ["d0103-성탄주간-t1-s1"], "d0103-성탄주간"), null, "1월 3일은 성탄 2주일");
  // 사계재의 날은 그 요일의 날만 본다(ADR-044 §3). 2027년 춘계재는 2월 17, 19, 20일이다
  assert.deepStrictEqual([3, 5, 6, 1].map((w) => e.yearDayIn(y27, ["t-춘계재"], "t-춘계재", w)?.date ?? null),
    ["2027-02-17", "2027-02-19", "2027-02-20", null]);
});

test("사계재의 계절 이름으로 찾으면 계절 줄이 수, 금, 토요일 세 줄로 나뉘고, 지향별 줄 넷은 나누지 않는다. `사계재`로는 네 계절을 모두 찾는다(ADR-044 §3)", { skip: !haveData }, () => {
  const { ctx, index } = loadLectionarySearch();
  for (const season of ["춘계재", "하계재", "추계재", "동계재"]) {
    const items = JSON.parse(JSON.stringify(ctx.searchLectionaryNames(index, season).items));
    assert.deepStrictEqual(items.slice(0, 3).map((it) => [it.obs.key, it.ember, it.tier]),
      [[`t-${season}`, "wed", 1], [`t-${season}`, "fri", 1], [`t-${season}`, "sat", 1]], season);
    assert.deepStrictEqual(items.slice(3).map((it) => [it.obs.name.endsWith(season), it.ember ?? null]), Array(4).fill([true, null]), season);
  }
  // `사계재`는 네 계절을 함께 부르는 별칭이다. 계절마다 세 줄이라 열두 줄이다(ADR-037 §5)
  const all = JSON.parse(JSON.stringify(ctx.searchLectionaryNames(index, "사계재").items));
  assert.deepStrictEqual(all.map((it) => `${it.obs.key} ${it.ember}`),
    ["춘계재", "하계재", "추계재", "동계재"].flatMap((season) => ["wed", "fri", "sat"].map((d) => `t-${season} ${d}`)));
});

test("yearDaysIn: 지키는 날은 지키는 날의 표와 같고, 전례일 자신의 날이다(색인의 모든 전례일, 2026-2028)", { skip: !haveData }, () => {
  const { e, cal, lec, index } = realEngine();
  const table = keptTable();
  const setsOf = index.obs.map(() => []);
  for (const [o, id] of index.sets) setsOf[o].push(id);
  for (let y = 2026; y <= 2028; y++) {
    const year = e.yearDaysIn(lec, cal, y);
    const wrong = [];
    index.obs.forEach((o, i) => {
      const ids = setsOf[i].length ? setsOf[i] : [o.key];
      const want = ids.map((id) => e.firstDayOf(table.byId.get(id), `${y}-01-01`, `${y}-12-31`)).filter(Boolean)
        .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      const got = e.yearDayIn(year, ids, o.key);
      const gotKept = got && got.kind !== "overlap" ? got.date : null;
      if ((want ? want.date : null) !== gotKept) wrong.push([o.key, y, want && want.date, gotKept]);
      // 독서 세트를 다른 전례일과 함께 쓰더라도, 그 전례일 자신을 지키는 날이 있으면 그날이 골라진다(코드 리뷰 2026-11-17).
      // 세트로 고른 날이 다른 전례일의 날이면 줄이 엉뚱한 날을 연다. 지금 데이터에서 함께 쓰는 것은 사계재의 지향별 날뿐이다
      const own = (year.kept.get(o.key) || [])[0];
      if (own && gotKept && own.date !== gotKept) wrong.push([o.key, y, "own", own.date, gotKept]);
    });
    assert.deepStrictEqual(wrong, [], String(y));
  }
});

test("지키는 날의 표: 격자 전례일은 전례일로 넣지 않는다(코드 리뷰 2026-11-17)", { skip: !haveData }, () => {
  const table = keptTable();
  // 격자 전례일은 보조 주소와 검색이 전례일로 묻지 않는다. 그날의 독서 세트로만 있다
  assert.deepStrictEqual([...table.byId.keys()].filter((id) => id.startsWith("grid:")), []);
  assert.ok(table.byId.get("ordinary-24-wed-II-t1-s1").some((d) => d.obs.startsWith("grid:")));
});

test("지키는 날의 표: 한 전례년에 여러 번 지키는 전례일은 사계재의 줄 넷과 몇 해의 성 안드레아 축일뿐이다(ADR-044 「한 전례년에 여러 번 오는 날」)", { skip: !haveData }, () => {
  const { e, index } = realEngine();
  const table = keptTable();
  /** 전례일마다 그 세트(세트가 없으면 전례일 키)를 한 전례년 안의 다른 날 둘 이상에 지키는 전례년 */
  const many = new Set();
  const byObs = new Map(index.obs.map((o) => [o.key, []]));
  for (const s of index.sets) byObs.get(index.obs[s[0]].key).push(s[1]);
  for (let y = 2026; y <= 2049; y++) {
    const ly = e.liturgicalYearSpan(`${y}-06-01`);
    for (const [key, sets] of byObs) {
      const ids = sets.length ? sets : [key];
      const dates = new Set(ids.flatMap((id) => (table.byId.get(id) || []).filter((d) => d.date >= ly.from && d.date <= ly.to).map((d) => d.date)));
      if (dates.size > 1) many.add(key.startsWith("t-") && key.endsWith("계재") ? key : `${key} ${y}`);
    }
  }
  assert.deepStrictEqual([...many].sort(), [
    "d1130-사도-성-안드레아 2028", "d1130-사도-성-안드레아 2034", "d1130-사도-성-안드레아 2040", "d1130-사도-성-안드레아 2045",
    "t-동계재", "t-추계재", "t-춘계재", "t-하계재",
  ]);
  // 성 안드레아는 다가오는 11월 30일을 연다. 지난해의 11월 30일도 같은 전례년이다
  assert.strictEqual(e.openDayIn(table, ["d1130-사도-성-안드레아-t1-s1"], "2028-06-01").date, "2028-11-30");
  // 사계재는 오늘이나 그 뒤의 첫날, 모두 지났으면 수요일이다
  assert.strictEqual(e.openDayIn(table, ["t-춘계재"], "2026-02-26").date, "2026-02-27");
  assert.strictEqual(e.openDayIn(table, ["t-춘계재"], TODAY).date, "2026-02-25");
});

test("지키는 날의 표: 줄이 여는 날은 이번 전례년의 날이고, 지났으면 다음에 읽는 날을 따로 찾는다(ADR-044 §1)", { skip: !haveData }, () => {
  const { e } = realEngine();
  const table = keptTable();
  const open = (ids) => e.openDayIn(table, ids, TODAY);
  const next = (ids) => e.nextDayIn(table, ids, TODAY);
  // 사순2주일 가해의 복음(요한 3:1-17): 이번 전례년(가해)에 읽었고, 다음은 2029년
  assert.deepStrictEqual([open(["lent-2-sun-A-t1-s1"]).date, next(["lent-2-sun-A-t1-s1"]).date], ["2026-03-01", "2029-02-25"]);
  assert.deepStrictEqual(Array.from(open(["lent-2-sun-A-t1-s1"]).colors), ["violet"]);
  // 사순4주일 나해는 이번 전례년에 읽지 않아 다음 날을 연다
  assert.strictEqual(open(["lent-4-sun-B-t1-s1"]).date, "2027-03-07");
  // 고유 독서가 없는 월별 축일은 전례일 키로 찾는다. 오늘이다
  assert.strictEqual(open(["d1116-마가렛"]).date, TODAY);
  // 성탄 평일은 열리는 날의 이름이 해마다 다르다
  const xmas = open(["d1230-성탄주간-t1-s1"]);
  assert.deepStrictEqual([xmas.date, xmas.obs, xmas.name], ["2025-12-30", "grid:christmas-x-weekday-tue", "성탄 1주 화요일"]);
  assert.strictEqual(next(["d1230-성탄주간-t1-s1"]).name, "성탄 1주 수요일");
  // 연중7주일은 2026, 2027 전례년에 오지 않는다(사순절이 일찍 시작한다)
  assert.strictEqual(open(["ordinary-7-sun-A-t1-s1"]).date, "2035-05-20");
});

test("지키는 날의 표: 성탄 평일의 화면 이름은 이번 전례년의 평일이고, 그 이름은 이번 전례년의 그날을 연다(ADR-044 §3)", { skip: !haveData }, () => {
  const { e } = realEngine();
  const table = keptTable();
  // 2026 전례년의 성탄(2025-12-25)은 목요일이다. 12.26-28은 축일과 성탄 1주일, 1.1은 주님의 이름, 1.4는 성탄 2주일, 1.6은 주님 공현이다
  const names = [...e.christmasNamesIn(table, TODAY)].map(([id, name]) => `${id.slice(0, 5)} ${name}`).sort();
  assert.deepStrictEqual(names, [
    "d0102 성탄 1주 금요일", "d0103 성탄 1주 토요일", "d0105 성탄 2주 월요일", "d0107 성탄 2주 수요일", "d0108 성탄 2주 목요일",
    "d0109 성탄 2주 금요일", "d0110 성탄 2주 토요일", "d1229 성탄 1주 월요일", "d1230 성탄 1주 화요일", "d1231 성탄 1주 수요일",
  ]);
  // 그 이름으로 찾은 줄은 줄의 세트로 찾는다. 이번 전례년의 날이 그 이름의 날이다
  const open = e.openDayIn(table, ["d1230-성탄주간-t1-s1"], TODAY);
  assert.deepStrictEqual([open.date, open.name], ["2025-12-30", "성탄 1주 화요일"]);
  // 성탄 시기 안의 오늘도 한 전례년에는 같은 이름이 한 번이다. 오늘부터 한 해의 이름을 쓸 때는 2027-01-05에 「성탄 2주 화요일」이
  // 2027-01-05와 2028-01-04에 두 번 있었다(코드 리뷰 2026-11-17)
  const jan5 = "2027-01-05";
  const tue = [...e.christmasNamesIn(table, jan5)].filter(([, name]) => name === "성탄 2주 화요일").map(([id]) => id.slice(0, 5));
  assert.deepStrictEqual(tue, ["d0105"]);
  assert.deepStrictEqual(["d0104-성탄주간-t1-s1", "d0105-성탄주간-t1-s1"].map((id) => e.openDayIn(table, [id], jan5)).map((d) => [d.date, d.name]),
    [["2027-01-04", "성탄 2주 월요일"], ["2027-01-05", "성탄 2주 화요일"]]);
});

test("지키는 날의 표: 색은 그 전례일을 고른 전례독서 화면 머리의 색이다. 사계재의 평일은 절기 바탕색이 아니라 그날의 색(코드 리뷰 2026-11-16)", { skip: !haveData }, () => {
  const table = keptTable();
  const on = (id, date) => Array.from(table.byId.get(id).find((d) => d.date === date).colors);
  // 2026-09-16은 추계재 수요일이고 니니안의 날이다. 연중24주 수요일(격자)을 고른 머리는 그날의 색(자색, 백색)이다
  assert.deepStrictEqual(on("ordinary-24-wed-II-t1-s1", "2026-09-16"), ["violet", "white"]);
  // 추계재 금요일(2026-09-18)은 자색 하나다. 고치기 전에는 둘 다 녹색이었다
  assert.deepStrictEqual(on("ordinary-24-fri-II-t1-s1", "2026-09-18"), ["violet"]);
});

test("지키는 날의 표: 색인의 모든 독서 세트와 고유 독서가 없는 전례일은 2050년까지 여는 날이 있다", { skip: !haveData }, () => {
  const { e, index } = realEngine();
  const table = keptTable();
  const withSets = new Set(index.sets.map((s) => s[0]));
  const ids = [...index.sets.map((s) => s[1]), ...index.obs.filter((_, i) => !withSets.has(i)).map((o) => o.key)];
  assert.deepStrictEqual(ids.filter((id) => !e.openDayIn(table, [id], TODAY)), []);
});

test("독서 표기: 색인이 찾는 독서 세트의 독서 자리는 모두 엔진의 독서 표에 표기가 있다(ADR-044 §1)", { skip: !haveData }, () => {
  // 검색 결과의 줄은 찾은 독서의 표기를 엔진의 독서 표에서 꺼낸다(엔진 `readingLabel`). 없으면 색인의 숫자 표기로 그린다.
  const { e, lec, index } = realEngine();
  const labels = e.readingLabelsIn(lec);
  const SLOT_KEY = ["first", "psalm", "second", "gospel"];
  const missing = new Set();
  for (const row of index.cov) {
    const setId = index.sets[row[0]][1];
    if (!labels.has(`${setId}|${SLOT_KEY[row[5]]}`)) missing.add(`${setId}|${SLOT_KEY[row[5]]}`);
  }
  assert.deepStrictEqual([...missing], []);
});

test("지키는 날의 표: 표로 찾은 다음 날은 날마다 찾는 firstKeptDayIn과 같다", { skip: !haveData }, () => {
  const { e, cal, lec, index } = realEngine();
  const table = keptTable();
  // 모두 견주면 오래 걸려 스물다섯째마다 하나와 3년보다 먼 세트를 견준다
  const far = ["ordinary-7-sun-A-t1-s1", "ordinary-9-sun-C-t2-s1", "advent-3-fri-t1-s1", "d0111-성탄주간-t1-s1"];
  const ids = [...index.sets.map((s) => s[1]).filter((_, i) => i % 25 === 0), ...far, "d0523-성-베드로-학교-개교"];
  for (const id of ids) {
    const want = e.firstKeptDayIn(lec, cal, new Set([id]), TODAY, "2050-12-31");
    const got = e.nextDayIn(table, [id], TODAY);
    assert.deepStrictEqual(got && [got.date, got.obs, got.setId], want && [want.date, want.obs, want.setId], id);
  }
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

// ── 성시(전례시편과 송가) 검색(ADR-046) ──

test("성시: 실제 성시 색인으로 성서 본문과 따로 찾고, 송가는 이름을 붙이며, 전례시편의 구절로 그 시편을 읽는 날을 찾는다", { skip: !haveData }, () => {
  const { ctx, index } = loadLectionarySearch();
  const chunk = (name) => {
    const raw = readJson(path.join(DATA, `search-${name}.json`));
    const bArr = raw.b.flatMap(([idx, n]) => Array(n).fill(idx));
    return { books: raw.books, bArr, cArr: raw.c, vArr: raw.v, tArr: raw.t };
  };
  vm.runInContext("function _setChunks(c) { loadedChunks = c; }", ctx);
  ctx._setChunks({ ot: chunk("ot"), lit: chunk("lit") });
  const plain = (x) => JSON.parse(JSON.stringify(x));

  // 시편 23편 1절: 공동번역은 「야훼는 나의 목자」, 전례시편은 「주님은 나의 목자시니」
  const found = plain(ctx.groupedResults("나의 목자", ["ot", "lit"], new Set(), 1, 50));
  assert.ok(found.results.some((r) => r.b === "ps" && r.c === 23 && r.v === 1), "공동번역 시편 23:1");
  assert.ok(found.psalter.results.some((r) => r.b === "lps" && r.c === 23 && r.v === 1), "전례시편 23:1");
  assert.ok(found.results.every((r) => r.b !== "lps" && r.b !== "cant"), "성서 본문에 성시가 섞이지 않는다");

  // 송가의 결과는 송가 이름을 함께 넘긴다
  const zechariah = plain(ctx.groupedResults("이스라엘의 주 하느님", ["lit"], new Set(["cant"]), 1, 50)).psalter.results;
  assert.ok(zechariah.length > 0);
  assert.deepStrictEqual(zechariah.map((r) => [r.c, r.v, r.title]), [[11, 1, "즈가리야 송가"]]);

  // 책 이름: 전례시편과 송가를 구절과 책 이름으로 읽고, 시편은 공동번역 시편이다
  assert.deepStrictEqual(plain(ctx.tryVerseRef("전례시편 23:1")).bookId, "lps");
  assert.deepStrictEqual(plain(ctx.tryVerseRef("송가 11")).parts, [{ chapter: 11, verses: "1-999", title: "즈가리야 송가" }]);
  assert.deepStrictEqual(plain(ctx.tryVerseRef("시편 23")).bookId, "ps");
  assert.deepStrictEqual(plain(ctx.tryBookOnly("송가")), { bookId: "cant", bookNameKo: "성무일과 송가", title: "모세송가" });
  assert.deepStrictEqual([...ctx.parseQuery("목자 in:전례시편 in:송가").restrictBooks], ["lps", "cant"]);

  // 전례시편 23편을 읽는 날은 시편 23편을 읽는 날과 같다(전례독서의 시편은 전례시편이다)
  const days = (q) => plain(ctx.searchLectionaryPassage(index, ctx.tryVerseRef(q))).items.map((it) => it.obs.key).sort();
  assert.ok(days("시편 23").length > 0);
  assert.deepStrictEqual(days("전례시편 23"), days("시편 23"));
});
