// ── liturgical-engine 실데이터 대조 — data/ 서브모듈이 있어야 돈다 ─────────────
// Run with: node --test tests/unit/liturgical-engine.data.test.js
//
// **공개 저장소의 필수 `Unit tests` 잡에서는 돌지 않는다.** 그 잡은 actions/checkout 을
// 서브모듈 없이 돌려 `data/` 가 없다(설계서 §7). 서브모듈을 받는 자리는 둘이다 — 엔진 전용
// engine-data.yml(머지 직후 main push · workflow_dispatch)과 데이터 동기화 sync-data.yml —
// 이 파일은 **양쪽에** 등록돼 돈다(docs-data-consistency.test.js · sw.test.js 는 후자에서만).
// 합성 표로 잡을 수 있는 것은 liturgical-engine.test.js 에 둔다.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SOURCE = fs.readFileSync(path.join(ROOT, "js/app/liturgical-engine.js"), "utf8");

function extractBlock(name, source) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) throw new Error(`marker block ${name} not found`);
  return source.slice(startIdx, endIdx + end.length);
}

const ctx = {
  Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error,
  parseInt, isNaN, Date, NaN,
};
vm.createContext(ctx);
vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map(); const activatedOptionals = new Set();",
  ctx, { filename: "prelude" });
vm.runInContext(extractBlock("LITURGICAL_CORE", SOURCE), ctx, { filename: "liturgical-engine.js" });
vm.runInContext(extractBlock("LITURGICAL_LOOKUP", SOURCE), ctx, { filename: "liturgical-engine.js#lookup" });

const LECTIONARY = path.join(ROOT, "data", "lectionary");
// 체크아웃 여부만 본다 — 개별 파일의 존재로 판별하면 그 파일이 지워진 데이터 커밋에서
// 검증이 조용히 skip 된다(docs-data-consistency.test.js 와 같은 이유). 파일 누락은
// read() 의 읽기 실패로 드러나게 둔다.
const haveData = fs.existsSync(LECTIONARY);
const SKIP = haveData ? false : "data/ 서브모듈 미체크아웃 — 로컬과 engine-data.yml·sync-data.yml 에서 돈다";
const read = (p) => JSON.parse(fs.readFileSync(path.join(LECTIONARY, p), "utf8"));

// ── C-4.6-2 연중 주차 — 실제 표(34주 · 구간 38개) ──

test("C-4.6-2 모든 연중 주일이 정확히 한 주차 · 공현 후 1주부터 연속 · 성령강림 후 34주로 끝 (1900~2100)", { skip: SKIP }, () => {
  const idx = ctx.buildOrdinalIndex(read("ordinal-weeks.json"));
  assert.strictEqual(idx.doy.length + idx.date.length, 38, "구간 38개");
  const consecutive = (ws) => ws.every((w, i) => i === 0 || w === ws[i - 1] + 1);
  const misses = [];
  for (let y = 1900; y <= 2100; y++) {
    const ash = ctx.yearAnchors(y).ash;
    const pre = [], post = [];   // 재의 수요일 전(공현 후) · 성령강림 후 — 연도 안 날짜 순
    let d = ctx.toKey(y, 1, 1);
    while (d.slice(0, 4) === String(y)) {
      if (ctx.seasonOf(d) === "ordinary" && ctx.dayOfWeek(d) === 0) {
        const w = ctx.ordinalWeekOf(d, idx);
        if (w === null) misses.push(`${d} 주차 없음`);
        else (d < ash ? pre : post).push(w);
      }
      d = ctx.addDays(d, 1);
    }
    // 두 묶음이 각각 **한 칸씩 오른다** — 2·3 을 바꿔 달거나 2 에서 4 로 건너뛰면 잡힌다.
    // 중복·결측만 보던 종전 확인은 그 둘을 놓쳤다(3차 리뷰). 묶음 사이의 빈 번호는 정상이다
    // (부활절이 이르면 공현 후가 짧고 성령강림 후가 앞 번호를 되쓰지 않는다).
    if (pre[0] !== 1 || !consecutive(pre)) misses.push(`${y} 공현 후 ${pre.join(",")}`);
    if (post[post.length - 1] !== 34 || !consecutive(post)) misses.push(`${y} 성령강림 후 ${post.join(",")}`);
    const all = pre.concat(post);
    if (new Set(all).size !== all.length) misses.push(`${y} 주차 중복 ${all.join(",")}`);
  }
  assert.deepStrictEqual(misses, []);
});

test("C-4.6-2 왕이신 그리스도 = 연중 34주 · 세례주일 = 연중 1주 (1900~2100)", { skip: SKIP }, () => {
  const idx = ctx.buildOrdinalIndex(read("ordinal-weeks.json"));
  const bad = [];
  for (let y = 1900; y <= 2100; y++) {
    const kingship = ctx.addDays(ctx.advent1Date(y), -7);
    if (ctx.ordinalWeekOf(kingship, idx) !== 34) bad.push(`${y} 34주 ${kingship}`);
    const baptism = ctx.baptismDate(y);
    if (ctx.ordinalWeekOf(baptism, idx) !== 1) bad.push(`${y} 1주 ${baptism}`);
  }
  assert.deepStrictEqual(bad, []);
});

test("C-4.6-1 2052-03-03 → 9주 (실제 표로 재확인)", { skip: SKIP }, () => {
  const idx = ctx.buildOrdinalIndex(read("ordinal-weeks.json"));
  assert.strictEqual(ctx.ordinalWeekOf("2052-03-03", idx), 9);
});

// ── C-4.8-1 음력 — 실제 KASI 표 ──

test("C-4.8-1 KASI 표 조회 — 설·추석", { skip: SKIP }, () => {
  const KASI = read("kasi-lunar.json");
  const g = (y, k) => ctx.lunarDatesOf(KASI, y)[k];
  assert.strictEqual(g(2026, "1-1"), "2026-02-17");
  assert.strictEqual(g(2026, "8-15"), "2026-09-25");
  assert.strictEqual(g(2049, "1-1"), "2049-02-02");
  assert.strictEqual(g(2032, "1-1"), "2032-02-11");
  assert.strictEqual(g(2040, "8-15"), "2040-09-21");
  assert.strictEqual(g(2050, "8-15"), "2050-09-30");
});

test("C-4.8-2 표 범위 밖은 빈 결과 — 2024 · 2051", { skip: SKIP }, () => {
  const KASI = read("kasi-lunar.json");
  const range = (KASI._meta && KASI._meta.range) || [2025, 2050];
  assert.deepStrictEqual(range, [2025, 2050]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.lunarDatesOf(read("kasi-lunar.json"), 2024))), {});
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.lunarDatesOf(read("kasi-lunar.json"), 2051))), {});
});

test("C-4.8-3 표 범위 26년이 빠짐없이 두 키를 갖는다", { skip: SKIP }, () => {
  const KASI = read("kasi-lunar.json");
  const bad = [];
  for (let y = 2025; y <= 2050; y++) {
    const row = ctx.lunarDatesOf(KASI, y);
    const keys = Object.keys(row).sort();
    if (keys.length !== 2 || keys[0] !== "1-1" || keys[1] !== "8-15") bad.push(`${y} ${keys.join(",")}`);
    for (const k of keys) if (ctx.parseDate(row[k]) === null) bad.push(`${y} ${k} ${row[k]}`);
  }
  assert.deepStrictEqual(bad, []);
});

// ── 규칙 평가 — 실제 temporal-feasts.json 의 rule 들이 전부 평가된다 ──

test("§4.3 temporal-feasts 의 rule 이 전부 날짜를 낸다 (rule: null 제외)", { skip: SKIP }, () => {
  const temporal = read("temporal-feasts.json");
  const unresolved = [];
  for (const e of temporal.entries) {
    if (!e.rule) continue;                       // rule: null 은 건너뛴다(§2)
    const out = ctx.evalRule(e.rule, 2026);
    const want = e.rule.kind === "ember_wfs" ? 3 : 1;
    if (out.length !== want) unresolved.push(`${e.id} ${e.rule.kind} → ${out.length}개`);
    for (const d of out) if (ctx.parseDate(d) === null) unresolved.push(`${e.id} ${d}`);
  }
  assert.deepStrictEqual(unresolved, []);
});

// ════════════════════════════════════════════════════════════════════════════
// A1-b 조회 계층 — 실데이터 (설계서 §5 · 검토 문서 §5.8 · §5.9 · PR 2)
// ════════════════════════════════════════════════════════════════════════════
// 합성 표가 규칙 하나씩을 가른다면, 여기는 실제 표가 그 규칙 위에서 **빈틈 없이** 닫히는지 본다.
// 레코드 id 는 표의 잠정 순번일 수 있어(ADR-036 §10) 확인은 id 대신 레코드의 필드로 한다.

// vm 이 만든 값은 realm 이 달라 구조가 같아도 deepStrictEqual 이 틀린다 — 양쪽을 정규화한다.
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

let built = null;
/** 실제 표 아홉으로 두 인덱스를 한 번 만든다 — data/ 가 없으면 호출하지 않는다(skip). */
function ix() {
  if (built) return built;
  const cal = ctx.buildCalendarIndex({
    sanctoral: read("sanctoral.json"), temporal: read("temporal-feasts.json"), periods: read("periods.json"),
    ordinalWeeks: read("ordinal-weeks.json"), kasi: read("kasi-lunar.json"),
  });
  const lec = ctx.buildLectionaryIndex({
    readings: read("eucharist-readings.json"), collects: read("eucharist-collects.json"),
    commons: read("commons.json"), canticles: read("canticles.json"),
  });
  const rec = new Map(read("eucharist-readings.json").entries.map((e) => [e.id, e]));
  const col = new Map(read("eucharist-collects.json").entries.map((e) => [e.id, e]));
  return (built = { cal, lec, rec, col });
}
/** 옮김 계산(연도 캐시)을 거치는 조회 — 공개 래퍼와 같은 길이다(날짜를 먼저 검사한다). */
const passOf = (y) => ctx.transfersOf(ix().cal, y);
const resolve = (d) => ctx.resolveDateIn(ix().cal, d, ctx.parseDate(d) ? passOf(Number(d.slice(0, 4))) : ctx.EMPTY_PASS());
const pick = (r, prefix) => r.candidates.find((c) => c.observance.id.startsWith(prefix));
/** 그 날 `prefix` 후보의 독서 그룹. */
function groupsAt(d, prefix) {
  const r = resolve(d);
  const c = pick(r, prefix);
  assert.ok(c, `${d} 에 ${prefix} 후보가 없다`);
  return ctx.findReadingsIn(ix().lec, ix().cal, r, c);
}
/** 그 날 `prefix` 후보의 본기도. */
function collectsAt(d, prefix) {
  const r = resolve(d);
  const e = ctx.findCollectsIn(ix().lec, ix().cal, r).find((x) => x.candidate.observance.id.startsWith(prefix));
  assert.ok(e, `${d} 에 ${prefix} 후보가 없다`);
  return e.collects;
}
const recOf = (g) => ix().rec.get(g.id);
/** 저녁 전례(→ R-6.1-evening)는 정의 날짜가 아니라 드리는 날의 후보다 — 성탄 밤(12.25 정의)은 12.24 저녁. */
const EVENING = vm.runInContext("EVENING_LITURGIES", ctx);
const heldOn = (id, d) => (Object.prototype.hasOwnProperty.call(EVENING, id) ? ctx.addDays(d, EVENING[id]) : d);
const colOf = (c) => ix().col.get(c.id);
const WD = [null, "mon", "tue", "wed", "thu", "fri", "sat"];

test("C-4.3-3 성 토요일 · 부활밤이 같은 날 후보 둘 — 각자 자기 본문, 부활밤은 저녁 전례로 맨 끝 (2026-04-04)", { skip: SKIP }, () => {
  const r = resolve("2026-04-04");
  same(r.candidates.map((c) => c.observance.id), ["t-성-토요일", "grid:lent-x-weekday-sat", "t-부활밤"]);
  same(r.candidates.map((c) => c.evening === true), [false, false, true]);
  const sat = groupsAt("2026-04-04", "t-성-토요일");
  const vigil = groupsAt("2026-04-04", "t-부활밤");
  assert.ok(sat.length > 0 && sat.every((g) => recOf(g).name === "성 토요일"));
  assert.ok(vigil.length > 0 && vigil.every((g) => recOf(g).name === "부활밤" && recOf(g).year === "A"));   // 2026 = 가해
  same(groupsAt("2026-04-04", "grid:"), []);
});

test("C-4.3-4 사순1주일은 격자에서만 나온다 — 규칙 파생 후보가 겹치지 않는다 (1900~2100)", { skip: SKIP }, () => {
  const bad = [];
  for (let y = 1900; y <= 2100; y++) {
    const d = ctx.addDays(ctx.easterDate(y), -42);
    const r = resolve(d);
    const temporal = r.candidates.filter((c) => c.observance.kind === "temporal");
    if (temporal.length !== 1 || temporal[0].observance.id !== "grid:lent-1-sunday") bad.push(`${d} ${temporal.map((c) => c.observance.id)}`);
  }
  same(bad, []);
});

test("§5.5 규칙 파생 전례일은 자기 달력년 안에 떨어진다 — 해를 넘기면 그 해의 조회가 닿지 않는다 (1900~2100)", { skip: SKIP }, () => {
  const bad = [];
  for (const row of read("temporal-feasts.json").entries) {
    for (let y = 1900; y <= 2100; y++) for (const d of ctx.evalRule(row.rule, y)) if (!d.startsWith(`${y}-`)) bad.push(`${row.id} ${y} → ${d}`);
  }
  same(bad, []);
});

test("C-5.3-3 병합 사례 — 부활6주 금 · 토는 승천 본기도 · 사순3주 [A,C] vs B", { skip: SKIP }, () => {
  const E = ctx.easterDate(2026);
  for (const [off, wd] of [[40, ["fri", "sat"]], [41, ["fri", "sat"]], [36, ["mon", "tue", "wed", "thu"]]]) {
    const cs = collectsAt(ctx.addDays(E, off), "grid:easter-6-weekday");
    assert.strictEqual(cs.length, 1, `E+${off}`);
    same(colOf(cs[0]).weekday, wd, `E+${off}`);
  }
  // 사순3주일 — 2026 가해 · 2027 나해 · 2028 다해
  for (const [y, yr] of [[2026, ["A", "C"]], [2027, "B"], [2028, ["A", "C"]]]) {
    const cs = collectsAt(ctx.addDays(ctx.easterDate(y), -28), "grid:lent-3-sunday");
    assert.strictEqual(cs.length, 1, String(y));
    same(colOf(cs[0]).year, yr, String(y));
  }
});

test("C-5.4-1 국가일 넷 — 삼일절 · 광복절 · 설 · 추석이 자기 본문에 조인", { skip: SKIP }, () => {
  for (const [d, id, name] of [
    ["2026-03-01", "d0301-삼일절", "삼일절"], ["2026-08-15", "d0815-광복절", "광복절"],
    ["2026-02-17", "lunar11-설날", "설날"], ["2026-09-25", "lunar815-추석-명절", "추석"],
  ]) {
    const gs = groupsAt(d, id);
    assert.ok(gs.length > 0 && gs.every((g) => recOf(g).name === name && g.common === null), `${d} 독서`);
    const cs = collectsAt(d, id);
    assert.ok(cs.length > 0 && cs.every((c) => colOf(c).name === name), `${d} 본기도`);
  }
});

test("C-5.4-2 성탄주간 1.3 · 1.4 · 1.5 — 날짜로만 갈리는 연속 봉독이 서로 다르다 (2028)", { skip: SKIP }, () => {
  const want = {
    "2028-01-03": ["1요한 2:29-3:6", "요한 1:29-34"],
    "2028-01-04": ["1요한 3:7-10", "요한 1:35-42"],
    "2028-01-05": ["1요한 3:11-21", "요한 1:43-51"],
  };
  for (const [d, [first, gospel]] of Object.entries(want)) {
    const gs = groupsAt(d, "grid:christmas-x-weekday");
    assert.strictEqual(gs.length, 1, d);
    const label = (s) => gs[0].readings.find((x) => x.slot === s).label;
    same([label("first"), label("gospel")], [first, gospel], d);
  }
});

test("C-5.4-3 사계재 — 네 계절 × 수 · 금 · 토가 이름 + 요일로 조인 · 금요일 본기도 두 건 (2026)", { skip: SKIP }, () => {
  const ember = read("temporal-feasts.json").entries.filter((t) => t.rule && t.rule.kind === "ember_wfs");
  assert.strictEqual(ember.length, 4);
  for (const row of ember) {
    for (const d of ctx.evalRule(row.rule, 2026)) {
      const wd = WD[ctx.dayOfWeek(d)];
      const gs = groupsAt(d, row.id);
      assert.ok(gs.length > 0, `${row.id} ${d} 독서`);
      for (const g of gs) assert.ok(recOf(g).name.includes(row.name) && recOf(g).weekday === wd, `${row.id} ${d} ${g.id}`);
      const cs = collectsAt(d, row.id);
      assert.strictEqual(cs.length, wd === "fri" ? 2 : 1, `${row.id} ${d} 본기도`);
      for (const c of cs) assert.ok(colOf(c).name.includes(row.name) && colOf(c).weekday === wd, `${row.id} ${d} ${c.id}`);
    }
  }
});

test("C-5.4-4 좁히기 규칙 ① — 세례 1/7(2024)은 공현 후 평일 0일 · 1/13(2030)은 1/7~1/12 성탄주간 · 01.13 레코드 없음", { skip: SKIP }, () => {
  for (let d = "2024-01-08"; d <= "2024-01-12"; d = ctx.addDays(d, 1)) {
    const r = resolve(d);
    same([r.coord.season, r.coord.week], ["ordinary", 1], d);
    const gs = groupsAt(d, "grid:ordinary-1-weekday");
    assert.ok(gs.length > 0 && gs.every((g) => recOf(g).date === null), d);
  }
  for (let d = "2030-01-07"; d <= "2030-01-12"; d = ctx.addDays(d, 1)) {
    assert.strictEqual(resolve(d).coord.season, "christmas", d);
    const gs = groupsAt(d, "grid:christmas-x-weekday");
    assert.ok(gs.length > 0 && gs.every((g) => recOf(g).date === d.slice(5).replace("-", ".") && recOf(g).name === "성탄주간"), d);
  }
  const at13 = [...ix().rec.values(), ...ix().col.values()].filter((e) => e.date === "01.13");
  same(at13.map((e) => e.id), []);
});

test("C-5.6-1 트랙은 연중 주일에만 — 재의 수요일 · 성 금요일 · 부활대축일의 「2」는 세트다", { skip: SKIP }, () => {
  const tracked = [...ix().rec.values()].filter((e) => e.reading_track !== null);
  assert.ok(tracked.length > 0);
  same(tracked.filter((e) => e.season !== "ordinary" || e.type !== "sunday").map((e) => e.id), []);
  const E = ctx.easterDate(2026);
  for (const [d, id] of [[ctx.addDays(E, -46), "t-재의-수요일"], [ctx.addDays(E, -2), "t-성-금요일"], [E, "t-부활대축일"]]) {
    same(groupsAt(d, id).map((g) => [g.reading_track, g.set_no]), [[null, 1], [null, 2]], id);
  }
  // 트랙이 있는 연중 주일은 트랙 순(1 → 2)으로 온다
  let seen = 0;
  for (let d = "2026-06-07"; d <= "2026-11-22"; d = ctx.addDays(d, 7)) {
    const tracks = groupsAt(d, "grid:ordinary").map((g) => g.reading_track);
    if (tracks.includes(1) && tracks.includes(2)) { seen++; same(tracks, [...tracks].sort(), d); }
  }
  assert.ok(seen > 0);
});

test("C-5.6-4 성인 공통 독서 폴백 — 양성 · 음성 · 불변식 79 / 13 / 17", { skip: SKIP }, () => {
  const ids = (d, p) => groupsAt(d, p).map((g) => g.id);
  // 양성 — 사베리오(has_proper 참 · 독서 0)는 missionary 세 세트, 그룹 형태는 고유와 같다
  const xav = groupsAt("2025-12-03", "d1203");
  same(xav.map((g) => [g.id, g.set_no, g.set_total, g.reading_track, g.common]),
    [1, 2, 3].map((n) => [`common:missionary-s${n}`, n, 3, null, "missionary"]));
  // 양성 — 자기 날짜에 남의 본문이 있는 넷
  for (const [d, p, cls] of [["2026-01-08", "d0108", "martyr"], ["2026-12-31", "d1231-실베스터", "pastor"],
    ["2026-12-31", "d1231-위클리프", "teacher"], ["2026-03-01", "d0301-데이빗", "pastor"]]) {
    const got = ids(d, p);
    assert.ok(got.length > 0 && got.every((id) => id.startsWith(`common:${cls}-s`)), `${p} ${got}`);
  }
  // 음성 — 06.24 는 띄어쓰기로 이름 조인이 빠져도 고유, 스테파노는 고유, 분류 없는 축일(세계평화 — 미결51)은 빈 배열
  for (const [d, p] of [["2026-06-24", "d0624"], ["2026-12-26", "d1226"]]) {
    const got = groupsAt(d, p);
    assert.ok(got.length > 0 && got.every((g) => g.common === null), p);
  }
  same(ids("2026-01-01", "d0101-세계평화"), []);
  // 불변식 — 월별 축일(sanctoral) 전 행
  const commons = read("commons.json").classes;
  const kasi = read("kasi-lunar.json");
  let fallback = 0, properWithCommon = 0, memorialEmpty = 0;
  for (const row of read("sanctoral.json").entries) {
    const d = heldOn(row.id, row.date ? `2028-${row.date.replace(".", "-")}` : ctx.lunarDatesOf(kasi, 2028)[row.lunar]);
    const gs = groupsAt(d, row.id);
    if (row.rank === "commemoration") { if (gs.length === 0) memorialEmpty++; continue; }
    if (gs.length > 0 && gs.every((g) => g.common !== null)) fallback++;
    else if (row.sanctoral_class in commons && gs.length > 0 && gs.every((g) => g.common === null)) properWithCommon++;
  }
  same([fallback, properWithCommon, memorialEmpty], [79, 13, 17]);
});

test("§5.6 본기도 폴백은 빈틈 없이 닫힌다 — has_proper 참은 고유, 거짓은 공통 하나({name} 치환), 기념일과 성인 분류 없는 기도일은 없음", { skip: SKIP }, () => {
  const kasi = read("kasi-lunar.json");
  const bad = [];
  for (const row of read("sanctoral.json").entries) {
    const d = heldOn(row.id, row.date ? `2028-${row.date.replace(".", "-")}` : ctx.lunarDatesOf(kasi, 2028)[row.lunar]);
    const cs = collectsAt(d, row.id);
    // 성인 분류가 없는 축일(세계평화 · 병자를 위한 기도일 — 기도서에 본기도가 없다, 미결51)은 공통도 없다
    const ok = row.rank === "commemoration" ? cs.length === 0
      : row.has_proper ? cs.length > 0 && cs.every((c) => c.common === null)
        : row.sanctoral_class === null ? cs.length === 0
        : cs.length === 1 && cs[0].common === row.sanctoral_class && !cs[0].text.includes("{name}");
    if (!ok) bad.push(`${row.id} ${cs.map((c) => c.id)}`);
  }
  same(bad, []);
  assert.ok(collectsAt("2026-01-08", "d0108")[0].text.includes("루시안"));
});

test("C-5.6-6 날짜 선택 순서 — 격자는 resolved.date(12.19 · 12.17), 옮겨 온 안드레아는 기원 11.30", { skip: SKIP }, () => {
  for (const d of ["2026-12-19", "2025-12-17"]) {
    const gs = groupsAt(d, "grid:advent-3-weekday");   // 대림 3주 평일인데 절기 위치로 찾는 레코드가 아니라 날짜 전용 본문
    assert.ok(gs.length > 0 && gs.every((g) => recOf(g).date === d.slice(5).replace("-", ".")), d);
  }
  const dest = resolve("2025-12-01");
  const andrew = ix().cal.sanctoralByDate.get("11.30").find((o) => o.id.startsWith("d1130"));
  const gs = ctx.findReadingsIn(ix().lec, ix().cal, dest, { observance: andrew, status: "transferred_in", from: "2025-11-30" });
  assert.ok(gs.length > 0 && gs.every((g) => recOf(g).date === "11.30"));
  assert.strictEqual(ix().lec.readings.byDate.get("12.01"), undefined);   // 목적지로 치면 빈 결과였다
  const cs = ctx.findCollectsIn(ix().lec, ix().cal, { ...dest, candidates: [{ observance: andrew, status: "transferred_in" }] });
  assert.ok(cs[0].collects.length > 0 && cs[0].collects.every((c) => colOf(c).date === "11.30"));
});

test("C-5.5-3 격자 ∧ 이동 축일(temporal) 공존 — 2026-03-29 성지주일 · 2026-11-29 대림1주일 (지정 전례일은 C-6.1-10 테스트)", { skip: SKIP }, () => {
  same(resolve("2026-03-29").candidates.map((c) => c.observance.id), ["t-성지주일", "grid:lent-x-sunday"]);
  same(resolve("2026-11-29").candidates.map((c) => c.observance.id), ["t-대림1주일", "grid:advent-1-sunday"]);
  // 대림1주일 행은 조인 이름이 없어 자기 절기 위치로 격자 레코드에 닿는다(§5.4) — 나해
  const t = groupsAt("2026-11-29", "t-대림1주일");
  assert.ok(t.length > 0 && t.every((g) => recOf(g).season === "advent" && recOf(g).week === 1 && recOf(g).year === "B"));
  same(t.map((g) => g.id), groupsAt("2026-11-29", "grid:").map((g) => g.id));
});

test("C-5.5-4 2026-01-20 — periods 에 그리스도인 일치 기도 주간, candidates 에는 없다", { skip: SKIP }, () => {
  const r = resolve("2026-01-20");
  same(r.periods.map((p) => p.id), ["p-그리스도인-일치를-위한-기도-주간"]);
  assert.ok(!r.candidates.some((c) => c.observance.id === "p-그리스도인-일치를-위한-기도-주간"));
  same(resolve("2026-01-26").periods, []);
});

test("미결12 잠정 — 실데이터 1:N 좁히기 (C-5.6-5 는 미결12 가 닫힐 때까지 열려 있다)", { skip: SKIP }, () => {
  for (const id of ["d1225-성탄-낮", "d1225-성탄-밤", "d1225-성탄-새벽"]) {
    const gs = groupsAt(heldOn(id, "2026-12-25"), id);   // 성탄 밤은 12.24 저녁(→ R-6.1-evening) — 본문은 여전히 12.25 키
    const name = ix().cal.sanctoralByDate.get("12.25").find((o) => o.id === id).name;
    assert.ok(gs.length > 0 && gs.every((g) => recOf(g).name === name), id);
  }
  const mich = groupsAt("2026-09-29", "d0929-성-미카엘").map((g) => g.id);
  same(groupsAt("2026-09-29", "d0929-대한성공회").map((g) => g.id), mich);   // 슬래시 합성 레코드 — 둘 다 같은 것
  assert.ok(mich.length > 0);
  for (const [p, name] of [["d0815-광복절", "광복절"], ["d0815-성모안식", "성모안식"], ["d0101-거룩한", "거룩한 이름 예수"]]) {
    const gs = groupsAt(p.startsWith("d0101") ? "2026-01-01" : "2026-08-15", p);
    assert.ok(gs.length > 0 && gs.every((g) => recOf(g).name === name), p);
  }
});

test("고유명 평일 여섯 — 성주간 월~수 · 재의 수요일 후 목~토가 그 평일에 정한 독서 · 본기도를 낸다 (2026, data#27)", { skip: SKIP }, () => {
  // 특별한 일이 없으면 이 날들은 그 평일에 정한 독서를 쓴다(사용자 확정 2026-10-10). 재의 수요일 후 금요일은
  // 교구 사이트 기사에 수집 태그가 빠져 원료에 없었다 — data#27 이 실었다.
  const E = ctx.easterDate(2026);
  for (const off of [-45, -44, -43, -6, -5, -4]) {
    const d = ctx.addDays(E, off);
    const name = pick(resolve(d), "grid:").observance.name;
    const gs = groupsAt(d, "grid:");
    assert.ok(gs.length > 0 && gs.every((g) => recOf(g).name === name), `${d} ${name} 독서`);
    const cs = collectsAt(d, "grid:");
    assert.ok(cs.length > 0 && cs.every((c) => colOf(c).name === name), `${d} ${name} 본기도`);
  }
});

test("여성선교주일은 기념일 — 이름 줄로만 오르고 본문이 없다 · 그날 주일 본문은 격자가 낸다 (2026-09-06, data#27)", { skip: SKIP }, () => {
  // 해마다 본기도 · 독서가 새로 정해져 고정 본문이 없다(사용자 확정 2026-10-10) — 데이터는 등급을
  // 기념일로 두고 그해 한정 본문을 싣지 않는다.
  const d = "2026-09-06";
  const c = pick(resolve(d), "t-여성선교주일");
  assert.ok(c, "후보로 오른다");
  same([c.observance.kind, c.observance.rank, c.observance.precedence, c.status], ["temporal", "commemoration", 7, "proper"]);
  same(groupsAt(d, "t-여성선교주일"), []);
  same(collectsAt(d, "t-여성선교주일"), []);
  assert.ok(groupsAt(d, "grid:ordinary").length > 0 && collectsAt(d, "grid:ordinary").length > 0);
  assert.ok(![...ix().rec.values(), ...ix().col.values()].some((e) => e.name === "여성선교주일"));
});

test("§5.4 · §5.6 도달 범위 — 2025~2050 모든 날의 모든 후보를 조회하면 독서 · 본기도 레코드가 하나도 빠지지 않는다", { skip: SKIP }, () => {
  // 조인 경로(격자 날짜 · 고유명 평일 · 절기 위치 · 이름 · 사계재 · 날짜 · 음력) 중 하나가 끊기면 그 경로의 레코드가
  // 어디에서도 안 나온다 — 개별 사례로는 놓치는 것을 전수로 잡는다(성주간 월~수 · 재의 수요일 후 목 · 금 · 토가 그 예다).
  const seenR = new Set();
  const seenC = new Set();
  for (let y = 2025; y <= 2050; y++) {
    for (let d = `${y}-01-01`; d.startsWith(`${y}-`); d = ctx.addDays(d, 1)) {
      const r = resolve(d);
      for (const c of r.candidates) for (const g of ctx.findReadingsIn(ix().lec, ix().cal, r, c)) seenR.add(g.id);
      for (const e of ctx.findCollectsIn(ix().lec, ix().cal, r)) for (const c of e.collects) seenC.add(c.id);
    }
  }
  same([...ix().rec.keys()].filter((id) => !seenR.has(id)), []);
  same([...ix().col.keys()].filter((id) => !seenC.has(id)), []);
});

// ════════════════════════════════════════════════════════════════════════════
// B1 우선순위 · 지정 전례일 · 전례색 · 재일 — 실데이터 (설계서 §6 · 검토 문서 §5.10 · §5.13 · PR 3)
// ════════════════════════════════════════════════════════════════════════════
// 실제 연도의 기대값은 픽스처가 기준이다(설계서 §1.4) — 아래 「픽스처 소비」가 winners.cases.json 을 그대로
// 돌린다. 여기서 확인하는 것은 픽스처에 없는 것(연도 범위 · 데이터 전체에 걸친 성질)뿐이다.

const offId = (r) => (r.official ? r.official.observance.id : null);
const gridIn = (r) => r.candidates.find((c) => c.observance.id.startsWith("grid:"));
const COLORS = ["white", "red", "green", "violet"];
const lunarDay = (y, key) => {
  const v = read("kasi-lunar.json").years[String(y)][key];
  return `${y}-${v}`;
};

test("B1 불변식 — 2025~2050 모든 날에 지정 전례일이 하나 있고(선택 봉헌 · 떠난 것은 지정 전례일이 아니다) 후보 가운데 하나이며, 색은 정식 4색 · colors 는 color 를 담는다 · 밀린 후보만 displacedBy", { skip: SKIP }, () => {
  const bad = [];
  for (let y = 2025; y <= 2050; y++) {
    for (let d = `${y}-01-01`; d.startsWith(`${y}-`); d = ctx.addDays(d, 1)) {
      const r = resolve(d);
      const o = r.official;
      if (!o || !r.candidates.includes(o)) { bad.push(`${d} 지정 전례일이 없거나 후보 밖`); continue; }
      if (!(o.status === "proper" || o.status === "transferred_in")) bad.push(`${d} 지정 전례일 status ${o.status}`);
      if (ctx.effectivePrecedence(o.observance) > 8) bad.push(`${d} 지정 자격 없음 ${o.observance.id}`);
      if (!COLORS.includes(r.color) || !r.colors.includes(r.color) || r.colors.some((c) => !COLORS.includes(c))) {
        bad.push(`${d} 색 ${r.color} / ${JSON.stringify(r.colors)}`);
      }
      for (const c of r.candidates) {
        // 밀린 것 — 재분류(omitted · commemorated)와 밀려 옮김(transferred_in · out — activated = ∅ 라 전부 충돌)만 displacedBy 를 싣는다
        const displaced = ["omitted", "commemorated", "transferred_in", "transferred_out"].includes(c.status);
        if (displaced !== ("displacedBy" in c)) bad.push(`${d} ${c.observance.id} ${c.status} displacedBy`);
        if (c.status === "omitted" && c.observance.rank !== "minor_feast") bad.push(`${d} omitted ${c.observance.rank}`);
        if (c.observance.rank === "commemoration" && c.status !== "proper") bad.push(`${d} 기념일 ${c.status}`);
      }
    }
  }
  same(bad, []);
});

test("C-6.1-2 A 특례 1.5 — 2031-02-02 주의 봉헌(주일) · 2034-01-01 거룩한 이름 예수(성탄 1주일) · 2028-08-06 주의 변모(주일)", { skip: SKIP }, () => {
  for (const [d, id] of [["2031-02-02", "d0202-주의-봉헌"], ["2034-01-01", "d0101-거룩한-이름-예수"], ["2028-08-06", "d0806-주의-변모"]]) {
    const r = resolve(d);
    same([ctx.dayOfWeek(d), offId(r), gridIn(r).status], [0, id, "proper"], d);
  }
  same(gridIn(resolve("2034-01-01")).observance.precedence, 2);   // 절기 주일보다도 선순위다
});

test("C-6.1-3 명절 > 대재일 — 2032-02-11 설이 지정 전례일, 재의 수요일은 proper 로 남고 옮기지 않는다(미결13 — 데이터 transferable: false)", { skip: SKIP }, () => {
  const r = resolve("2032-02-11");
  same(offId(r), "lunar11-설날");
  const ash = pick(r, "t-재의-수요일");
  same([ash.status, "displacedBy" in ash, ash.observance.transferable], ["proper", false, false]);
  same(ctx.fastOf(r), "major");
});

test("C-6.1-4 명절 ∧ 연중 주일 — 설 2027 · 2030 · 2034 · 2037 · 2040 · 2050, 추석 2032 · 2035 · 2039 · 2042: 명절 지정 전례일, 주일 격자 proper", { skip: SKIP }, () => {
  const days = [
    ...[2027, 2030, 2034, 2037, 2040, 2050].map((y) => [lunarDay(y, "1-1"), "lunar11-설날"]),
    ...[2032, 2035, 2039, 2042].map((y) => [lunarDay(y, "8-15"), "lunar815-추석-명절"]),
  ];
  for (const [d, id] of days) {
    const r = resolve(d);
    same([ctx.dayOfWeek(d), r.coord.season, offId(r), gridIn(r).status, gridIn(r).observance.rank], [0, "ordinary", id, "proper", "sunday"], d);
  }
  // 2025~2050 에 명절이 주일인 해는 이 열이 전부다 — 목록이 데이터와 어긋나면 잡힌다
  const all = [];
  for (let y = 2025; y <= 2050; y++) for (const k of ["1-1", "8-15"]) if (ctx.dayOfWeek(lunarDay(y, k)) === 0) all.push(lunarDay(y, k));
  same(all.sort(), days.map(([d]) => d).sort());
});

test("C-6.1-7 · C-2-1 precedence null 인 이동 축일 행은 후보로 있되 지정 전례일이 아니다 (2025~2050)", { skip: SKIP }, () => {
  const nullRows = read("temporal-feasts.json").entries.filter((e) => e.precedence === null).map((e) => e.id);
  assert.ok(nullRows.length > 0);
  const bad = [];
  for (let y = 2025; y <= 2050; y++) {
    const memo = ctx.movableOf(ix().cal, y);
    for (const [d, rows] of memo) {
      for (const row of rows) {
        if (row.precedence !== null) continue;
        const r = resolve(d);
        const c = pick(r, row.id);
        if (!c || c.status !== "proper") bad.push(`${d} ${row.id} 후보 ${c && c.status}`);
        if (offId(r) === row.id) bad.push(`${d} ${row.id} 지정 전례일`);
        // 주의 변모 주일 · 가정 · 평화통일 · 맥추감사 · 추수감사 — 그날 지정 전례일은 격자거나 그 주일보다 선순위인 축일(2.2 주의 봉헌, 왕이신 그리스도 주일 등)
        if (!offId(r).startsWith("grid:") && ctx.effectivePrecedence(r.official.observance) >= gridIn(r).observance.precedence) {
          bad.push(`${d} ${row.id} 지정 전례일 ${offId(r)}`);
        }
      }
    }
  }
  same(bad, []);
  // 2026-02-15 — 변모 주일 독서는 후보로 닿는다(선택 독서), 그날 지정 전례일은 연중 6주일 격자 · 녹(X-10)
  const feb15 = resolve("2026-02-15");
  same([offId(feb15), feb15.color], ["grid:ordinary-6-sunday", "green"]);
  assert.ok(groupsAt("2026-02-15", "t-주의-변모-주일").length > 0);
  // 2026-11-15 — 추수감사주일은 지킬 수 있는 날(data#45): 그날 지정 전례일은 연중 33주일 격자 · 녹, 추수감사주일 독서는 후보로 닿는다(X-10)
  const nov15 = resolve("2026-11-15");
  same([offId(nov15), nov15.color], ["grid:ordinary-33-sunday", "green"]);
  assert.ok(groupsAt("2026-11-15", "t-추수감사주일").length > 0);
});

test("C-6.1-9 prec 7 축일 ∧ 축일 네 쌍 — 결정적이고 둘 다 proper, 3.01 은 고유 본기도가 있는 삼일절이 지정 전례일", { skip: SKIP }, () => {
  const byDate = new Map();
  for (const e of read("sanctoral.json").entries) {
    if (e.rank === "minor_feast" && e.date) (byDate.get(e.date) || byDate.set(e.date, []).get(e.date)).push(e);
  }
  const pairs = [...byDate].filter(([, es]) => es.length === 2).map(([md]) => md).sort();
  same(pairs, ["02.14", "03.01", "06.09", "12.31"]);   // 08.05 는 도미닉이 기도서대로 08.08 로 가며 빠졌다(2026-10-24)
  for (const md of pairs) {
    // 그 날짜가 평일인 해마다 — 지정 전례일은 둘 중 하나로 늘 같고, 후순위인 쪽은 proper(고정일끼리 — 동시 봉헌)
    const winners = new Set();
    for (let y = 2025; y <= 2050; y++) {
      const d = `${y}-${md.replace(".", "-")}`;
      const r = resolve(d);
      const two = byDate.get(md).map((e) => pick(r, e.id));
      assert.ok(two.every(Boolean), d);
      if (two.some((c) => c === r.official)) {
        winners.add(offId(r));
        assert.ok(two.every((c) => c.status === "proper" && !("displacedBy" in c)), d);
      }
    }
    assert.strictEqual(winners.size, 1, `${md} ${[...winners]}`);
  }
  same(offId(resolve("2027-03-01")), "d0301-삼일절");   // 사순 평일 · 데이빗은 고유 본기도가 없다
  same(offId(resolve("2031-03-01")), "d0301-삼일절");   // 재의 수요일 후 토요일(사용자 확정 2026-10-10)
  same(offId(resolve("2047-03-01")), "d0301-삼일절");   // 재의 수요일 후 금요일
  same(pick(resolve("2031-03-01"), "grid:").observance.name, "재의 수요일 후 토요일");   // 그 평일에 정한 독서는 격자 후보로 남는다
});

test("C-6.1-10 · C-5.5-3 우선순위가 같으면 이동 축일이 격자보다 선순위다 — 2026-03-29 성지주일(홍) · 2026-11-29 대림1주일", { skip: SKIP }, () => {
  const palm = resolve("2026-03-29");
  same([offId(palm), palm.color, gridIn(palm).status], ["t-성지주일", "red", "proper"]);
  const advent1 = resolve("2026-11-29");
  same([offId(advent1), advent1.color, gridIn(advent1).status], ["t-대림1주일", "violet", "proper"]);
});

test("C-6.1-11 하계재 후보의 본문 — 2026-05-27 성직자 2세트(시편 99 / 27:1-9) · 성직자 본기도, 지정 전례일은 격자", { skip: SKIP }, () => {
  const groups = groupsAt("2026-05-27", "t-하계재");
  same(groups.map((g) => g.readings.find((s) => s.slot === "psalm").label), ["시편 99", "시편 27:1-9"]);
  const collects = collectsAt("2026-05-27", "t-하계재");
  assert.ok(collects.length > 0 && collects.every((c) => colOf(c).name.includes("성직자")));
  same(offId(resolve("2026-05-27")).startsWith("grid:"), true);
});

test("C-6.1-12 기념일은 이름 줄 — 같은 날짜에 다른 행이 없는 월별 축일 표의 기념일은 해마다 지정 전례일이 아니고(다른 후보가 없으면 격자), 이동 축일 표의 기념일이 있는 날도 지정 전례일은 격자 (2025~2050)", { skip: SKIP }, () => {
  const s = read("sanctoral.json").entries;
  const lonely = s.filter((e) => e.rank === "commemoration" && e.date && s.filter((x) => x.date === e.date).length === 1);
  same(lonely.length, 13);
  const bad = [];
  for (let y = 2025; y <= 2050; y++) {
    for (const e of lonely) {
      const r = resolve(`${y}-${e.date.replace(".", "-")}`);
      const own = r.candidates.filter((c) => c.observance.id !== e.id && !c.observance.id.startsWith("grid:"));
      if (own.length === 0 && !offId(r).startsWith("grid:")) bad.push(`${r.date} ${e.id} 지정 전례일 ${offId(r)}`);
      if (offId(r) === e.id || pick(r, e.id).status !== "proper") bad.push(`${r.date} ${e.id}`);
    }
    for (const [d, rows] of ctx.movableOf(ix().cal, y)) {
      for (const row of rows) if (row.rank === "commemoration" && !offId(resolve(d)).startsWith("grid:")) bad.push(`${d} ${row.id}`);
    }
  }
  same(bad, []);
});

test("C-6.1-13 저녁 전례(R-6.1-evening) 2025~2050 — 성 토요일은 지정 전례일이 성 토요일 · 홍 · 맨 끝 부활밤, 12.24 는 지정 전례일이 낮 · 자 · 맨 끝 성탄 밤, 12.25 엔 성탄 밤 없음, 저녁 후보는 그 두 날뿐", { skip: SKIP }, () => {
  // 상수의 id 가 실데이터에 실재한다 — 표의 이름(곧 id)이 바뀌면 여기서 멈춘다
  const ids = new Set([...read("temporal-feasts.json").entries, ...read("sanctoral.json").entries].map((e) => e.id));
  for (const id of Object.keys(EVENING)) assert.ok(ids.has(id), `${id} 가 정의 표에 없다`);
  const bad = [];
  for (let y = 2025; y <= 2050; y++) {
    const sat = resolve(ctx.addDays(ctx.easterDate(y), -1));
    const sl = sat.candidates[sat.candidates.length - 1];
    if (offId(sat) !== "t-성-토요일" || sat.color !== "red" || sl.observance.id !== "t-부활밤" || sl.evening !== true) {
      bad.push(`${sat.date} ${offId(sat)} ${sat.color} ${sl.observance.id}`);
    }
    const eve = resolve(`${y}-12-24`);
    const el = eve.candidates[eve.candidates.length - 1];
    if (el.observance.id !== "d1225-성탄-밤" || el.evening !== true || eve.official.evening || eve.color !== "violet") {
      bad.push(`${eve.date} ${offId(eve)} ${eve.color} ${el.observance.id}`);
    }
    if (resolve(`${y}-12-25`).candidates.some((c) => c.observance.id === "d1225-성탄-밤")) bad.push(`${y}-12-25 에 성탄 밤`);
  }
  same(bad, []);
  const evenings = [];
  for (let d = "2026-01-01"; d <= "2026-12-31"; d = ctx.addDays(d, 1)) {
    const ev = resolve(d).candidates.filter((c) => c.evening).map((c) => c.observance.id);
    if (ev.length) evenings.push(`${d}:${ev.join(",")}`);
  }
  same(evenings, ["2026-04-04:t-부활밤", "2026-12-24:d1225-성탄-밤"]);
});

test("C-6.4-1 절기 기본색 · 지정 전례일의 색 — 성주간 전체 홍(성 목 · 금 · 토 — 그날 지키는 월별 축일만 축일 색) · 성령강림 홍 · 삼위일체 · 왕이신 그리스도 백 · 대림 3주일 장미 · 청 · 사순 4주일 장미 (2025~2050)", { skip: SKIP }, () => {
  const bad = [];
  const feastDays = [];   // 성주간에 월별 축일이 지정 전례일인 날 — 그날은 축일 색(→ R-6.3-holy-week-guard). 성지주일의 수태고지(2029 · 2040)는 보호 기간 뒤로 가 여기 없다(→ R-6.3-guard-destination)
  for (let y = 2025; y <= 2050; y++) {
    const E = ctx.easterDate(y);
    const at = (n) => resolve(ctx.addDays(E, n));
    for (let n = -7; n <= -1; n++) {
      const r = at(n);
      const feast = r.official && r.official.observance.kind === "sanctoral" ? r.official.observance : null;
      if (feast) feastDays.push(`${y} E${n}`);
      if (r.color !== (feast ? feast.color : "red")) bad.push(`${y} E${n} ${r.color}`);
    }
    if (at(49).color !== "red") bad.push(`${y} 성령강림 ${at(49).color}`);
    if (at(56).color !== "white") bad.push(`${y} 삼위일체 ${at(56).color}`);
    const kingship = resolve(ctx.addDays(ctx.advent1Date(y), -7));
    if (kingship.color !== "white" || offId(kingship) !== "t-왕이신-그리스도-주일") bad.push(`${y} 왕이신 그리스도 ${kingship.color}`);
    const advent3 = resolve(ctx.addDays(ctx.advent1Date(y), 14));
    if (JSON.stringify(plain(advent3.colorAlt)) !== JSON.stringify(["rose", "blue"]) && offId(advent3).startsWith("grid:")) {
      bad.push(`${y} 대림 3주일 ${JSON.stringify(advent3.colorAlt)}`);
    }
    const lent4 = at(-21);
    if (lent4.colorAlt !== "rose" && offId(lent4).startsWith("grid:")) bad.push(`${y} 사순 4주일 ${lent4.colorAlt}`);
  }
  same(bad, []);
  // 축일 색 예외가 실제로 돈다 — 그날 지킨 요셉(2035 · 2046 성 월) · 수태고지(2043 성 수). 성주간에 도착이 지정 전례일인 날은 실데이터에
  // 없다(보호 기간 안의 도착 0 — 도착이 지정 전례일인 날의 축일 색은 합성 C-6.5-23)
  same(feastDays, ["2035 E-6", "2043 E-4", "2046 E-6"]);
});

test("C-6.4-2 성주간 · 부활 8일에도 그날 지키는 월별 축일은 축일 색 — 2035-03-19 요셉(성주간 월) 백 · 2025-04-25 마르코(부활 금) 홍 · 성 토요일 홍 · 순교자 평일 홍", { skip: SKIP }, () => {
  same(resolve("2035-03-19").color, "white");
  same(resolve("2025-04-25").color, "red");
  same([offId(resolve("2025-04-19")), resolve("2025-04-19").color], ["t-성-토요일", "red"]);   // E−1 — 대표는 성 토요일(부활밤은 저녁 전례 — R-6.1-evening)
  const boniface = resolve("2026-06-05");   // 순교자 축일 평일 — 지정 전례일의 색이 덮는다(픽스처 W-2026-06-05-boniface-color 와 같은 날)
  same([offId(boniface), boniface.color], ["d0605-보니파스", "red"]);
});

test("C-6.3-1 재일 — 대재일 둘 · 사순 주간 40일(성 목요일은 아님) · 성탄절기 밖 금요일 (2025~2050)", { skip: SKIP }, () => {
  const bad = [];
  for (let y = 2025; y <= 2050; y++) {
    const a = ctx.yearAnchors(y);
    const counts = { major: 0, minor: 0, none: 0 };
    for (let d = a.ash; d < a.easter; d = ctx.addDays(d, 1)) {
      if (ctx.dayOfWeek(d) === 0) continue;
      counts[ctx.fastOf(resolve(d)) || "none"]++;
    }
    if (JSON.stringify(counts) !== JSON.stringify({ major: 2, minor: 37, none: 1 })) bad.push(`${y} ${JSON.stringify(counts)}`);
    if (ctx.fastOf(resolve(ctx.addDays(a.easter, -3))) !== null) bad.push(`${y} 성 목요일`);
  }
  same(bad, []);
  same([ctx.fastOf(resolve("2026-01-09")), ctx.fastOf(resolve("2026-01-16"))], [null, "minor"]);   // 세례 주일 1.11
});

// ── 픽스처 소비 (tests/fixtures/liturgical/README.md 「소비 방법」) ──
// 케이스마다 테스트 하나 — `status: "skip"` 은 건너뛰고 `provisional` 은 「잠정」 표시로 돌린다(실패하면 실패).
// `expect` 는 부분집합 비교다: 적은 키만 본다. 모르는 키는 실패로 다룬다 — 테스트가 조용히 무시하면 그 확인 항목은
// 아무것도 지키지 못한다. activation 케이스는 그 케이스의 `activated` 로 옮김 계산 캐시를 새로 만들고 끝나면 ∅ 로
// 되돌린다(`setActivatedOptionals` — 집합이 바뀌면 캐시를 비운다). `alsoYears` 는 날짜 확인 항목의 연도만 바꿔
// 되풀이한다(README — 같은 월 · 일이 같은 요일인 해만 적는다). 연도 범위 확인 항목은 `neverDeparts` 하나다.

const FIXTURES = path.join(ROOT, "tests", "fixtures", "liturgical");
const fixtureCases = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")).cases;
const EXPECT_KEYS = new Set([
  "id", "status", "from", "to", "displacedBy", "absent", "notInDepartures", "official", "color", "colors",
  "observanceColor", "penitential", "fast", "coord", "grid", "readings", "officialReadings", "collects",
]);
const READING_KEYS = new Set(["origin", "record", "common", "sets", "slots", "empty", "cycle"]);
const COLLECT_KEYS = new Set(["origin", "count"]);
const RANGE_KEYS = new Set(["neverDeparts"]);
const show = (v) => JSON.stringify(plain(v));

/** 본문 레코드의 색인 날짜 — 표기를 `MM.DD` 로 맞춘다(§5.2). 공통 · 합성 그룹은 레코드가 없어 null. */
function originOf(record) {
  if (!record || typeof record.date !== "string") return null;
  const [m, d] = record.date.split(/[.-]/);
  return `${m.padStart(2, "0")}.${d.padStart(2, "0")}`;
}

/** 독서 확인 항목 — `readings`(그 후보) · `officialReadings`(지정 전례일) 공통. */
function checkReadings(r, c, want, label, bad) {
  for (const k of Object.keys(want)) if (!READING_KEYS.has(k)) bad.push(`${label}.${k}: 모르는 키`);
  const groups = ctx.findReadingsIn(ix().lec, ix().cal, r, c);
  if (want.empty === true && groups.length) bad.push(`${label}: 비어야 하는데 ${groups.map((g) => g.id)}`);
  if ("sets" in want && groups.length !== want.sets) bad.push(`${label}.sets: ${groups.length} ≠ ${want.sets}`);
  if ("common" in want && !(groups.length && groups.every((g) => g.common === want.common))) {
    bad.push(`${label}.common: ${show(groups.map((g) => g.common))} ≠ ${want.common}`);
  }
  if ("origin" in want) {
    const origins = [...new Set(groups.map((g) => originOf(recOf(g))))];
    if (show(origins) !== show([want.origin])) bad.push(`${label}.origin: ${show(origins)} ≠ ${want.origin}`);
  }
  if ("record" in want && !groups.some((g) => g.id === want.record)) bad.push(`${label}.record: ${show(groups.map((g) => g.id))} ∌ ${want.record}`);
  if ("cycle" in want) {
    const cycles = [...new Set(groups.map((g) => recOf(g) && recOf(g).year))];
    if (show(cycles) !== show([want.cycle])) bad.push(`${label}.cycle: ${show(cycles)} ≠ ${want.cycle}`);
  }
  if ("slots" in want) {
    const got = groups.length ? groups[0].readings.map((s) => s.label) : [];
    if (show(got) !== show(want.slots)) bad.push(`${label}.slots: ${show(got)} ≠ ${show(want.slots)}`);
  }
}

/** 날짜 확인 항목 하나 — 어긋난 것을 문자열로 모은다. */
function checkAssertion(date, exp) {
  const bad = [];
  for (const k of Object.keys(exp)) if (!EXPECT_KEYS.has(k)) bad.push(`${k}: 모르는 키`);
  const r = resolve(date);
  if ("id" in exp) {
    const hits = r.candidates.filter((c) => c.observance.id === exp.id && (!("status" in exp) || c.status === exp.status));
    if (exp.absent === true) {
      if (hits.length) bad.push(`absent: ${exp.id}${exp.status ? ":" + exp.status : ""} 가 있다`);
    } else if (!hits.length) {
      bad.push(`id: ${exp.id}${exp.status ? ":" + exp.status : ""} 없음 — ${r.candidates.map((c) => `${c.observance.id}:${c.status}`).join(" ")}`);
    } else {
      const c = hits[0];
      for (const k of ["from", "to"]) if (k in exp && c[k] !== exp[k]) bad.push(`${k}: ${c[k]} ≠ ${exp[k]}`);
      if ("displacedBy" in exp) {
        const got = "displacedBy" in c ? c.displacedBy : null;
        if (got !== exp.displacedBy) bad.push(`displacedBy: ${got} ≠ ${exp.displacedBy}`);
      }
      if ("observanceColor" in exp && c.observance.color !== exp.observanceColor) bad.push(`observanceColor: ${c.observance.color} ≠ ${exp.observanceColor}`);
      if ("penitential" in exp && (c.observance.penitential === true) !== exp.penitential) bad.push(`penitential: ${c.observance.penitential}`);
      if ("notInDepartures" in exp) {
        const deps = passOf(Number(date.slice(0, 4))).departures.get(date) || [];
        if (deps.some((x) => x.observance.id === exp.id) === exp.notInDepartures) bad.push(`notInDepartures: ${exp.id}`);
      }
      if ("readings" in exp) checkReadings(r, c, exp.readings, "readings", bad);
      if ("collects" in exp) {
        for (const k of Object.keys(exp.collects)) if (!COLLECT_KEYS.has(k)) bad.push(`collects.${k}: 모르는 키`);
        const cs = ctx.findCollectsIn(ix().lec, ix().cal, r).find((e) => e.candidate === c).collects;
        if ("count" in exp.collects && cs.length !== exp.collects.count) bad.push(`collects.count: ${cs.length} ≠ ${exp.collects.count}`);
        if ("origin" in exp.collects) {
          const origins = [...new Set(cs.map((x) => originOf(colOf(x))))];
          if (show(origins) !== show([exp.collects.origin])) bad.push(`collects.origin: ${show(origins)} ≠ ${exp.collects.origin}`);
        }
      }
    }
  }
  if ("official" in exp) {
    const got = offId(r);
    const ok = exp.official === "grid:*" ? typeof got === "string" && got.startsWith("grid:") : got === exp.official;
    if (!ok) bad.push(`official: ${got} ≠ ${exp.official}`);
  }
  if ("color" in exp && r.color !== exp.color) bad.push(`color: ${r.color} ≠ ${exp.color}`);
  if ("colors" in exp && show(r.colors) !== show(exp.colors)) bad.push(`colors: ${show(r.colors)} ≠ ${show(exp.colors)}`);
  // `fast` 는 그날의 소재일 여부다(README) — 대재일은 `fastOf` 가 "major" 로 따로 낸다
  if ("fast" in exp && (ctx.fastOf(r) === "minor") !== exp.fast) bad.push(`fast: ${ctx.fastOf(r)} ≠ ${exp.fast}`);
  if ("coord" in exp) for (const [k, v] of Object.entries(exp.coord)) if (r.coord[k] !== v) bad.push(`coord.${k}: ${r.coord[k]} ≠ ${v}`);
  if ("grid" in exp) for (const [k, v] of Object.entries(exp.grid)) if (gridIn(r)[k] !== v) bad.push(`grid.${k}: ${gridIn(r)[k]} ≠ ${v}`);
  if ("officialReadings" in exp) checkReadings(r, r.official, exp.officialReadings, "officialReadings", bad);
  return bad;
}

/** ISO 날짜 문자열의 연도를 `dy` 만큼 옮긴다 — alsoYears 되풀이. 날짜가 아닌 값은 그대로. */
const shiftYear = (v, dy) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  ? String(Number(v.slice(0, 4)) + dy).padStart(4, "0") + v.slice(4) : v);

/** 연도 범위 확인 항목 — 그 id 가 범위 안 어느 해의 출발 색인에도 없다(동시 봉헌은 옮기지 않는다). */
function checkRange(a) {
  const bad = [];
  for (const k of Object.keys(a.expect)) if (!RANGE_KEYS.has(k)) bad.push(`${k}: 연도 범위 확인 항목에서 모르는 키`);
  for (let y = a.years[0]; y <= a.years[1]; y++) {
    if ([...passOf(y).departures.values()].flat().some((c) => c.observance.id === a.expect.neverDeparts)) bad.push(`${y}: ${a.expect.neverDeparts} 가 떠났다`);
  }
  return bad;
}

for (const file of ["transfers.cases.json", "optionals.cases.json", "winners.cases.json"]) {
  for (const c of fixtureCases(file)) {
    const name = `픽스처 ${c.id}${c.status === "provisional" ? ` (잠정 — ${c.issue})` : ""}`;
    const skip = SKIP || (c.status === "skip" ? `${c.issue} — ${c.skip}` : false);
    test(name, { skip }, () => {
      ctx.setActivatedOptionals(c.activated || []);
      try {
        const bad = [];
        const first = c.assertions.find((a) => a.date);
        const base = first ? Number(first.date.slice(0, 4)) : null;
        for (const y of base === null ? [null] : [base, ...(c.alsoYears || [])]) {
          const dy = y === null ? 0 : y - base;
          for (const a of c.assertions) {
            if (!a.date) {
              if (!dy) for (const m of checkRange(a)) bad.push(`${a.years.join("~")} ${m}`);
              continue;
            }
            const date = shiftYear(a.date, dy);
            const exp = Object.fromEntries(Object.entries(a.expect).map(([k, v]) => [k, shiftYear(v, dy)]));
            for (const m of checkAssertion(date, exp)) bad.push(`${date} ${m}`);
          }
        }
        same(bad, []);
      } finally {
        ctx.setActivatedOptionals([]);
      }
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// B1 옮김 계산 — 1900~2100 불변식 · 골든 덤프 (설계서 §6.5 · §7 · 검토 문서 §5.14 · 부록 A)
// ════════════════════════════════════════════════════════════════════════════
// 실제 연도의 옮김 기대값은 위 픽스처가 기준이다. 여기는 전 연도에 걸친 성질과 결과 전체의 회귀만 본다.
// 활성화 집합은 ∅(v1 — 설계서 미결15)다. I-9(범위 · 절기 분할)는 공개 스위트의 C-4.2-2 · C-4.3-1 · C-4.5-1 이
// 같은 1900~2100 에서 본다.

const YEAR_FROM = 1900;
const YEAR_TO = 2100;
const inYear = (d, y) => typeof d === "string" && d.startsWith(`${y}-`);
const candKey = (c) => [c.observance.id, c.status, c.from, c.to, c.displacedBy].join("|");
/** 색인 하나를 비교용 배열로 — 날짜 순(Map 삽입 순서에 기대지 않는다). `from` 을 주면 그날부터. */
const mapKey = (m, from = "") => [...m].filter(([d]) => d >= from).sort(([a], [b]) => (a < b ? -1 : 1)).map(([d, cs]) => [d, cs.map(candKey)]);
const passKey = (p, from = "") => JSON.stringify([mapKey(p.arrivals, from), mapKey(p.departures, from), mapKey(p.optionals, from), p.defects]);

test("I-1~I-8 · I-11 옮김 계산 불변식 — 1900~2100 (activated = ∅)", { skip: SKIP }, () => {
  ctx.setActivatedOptionals([]);
  const bad = [];
  const forward = new Map();
  for (let y = YEAR_FROM; y <= YEAR_TO; y++) {
    const p = passOf(y);
    forward.set(y, passKey(p));
    const arrivals = [...p.arrivals.values()].flat();
    const seeded = arrivals.filter((c) => !inYear(c.from, y)).length;
    if ([...p.departures.values()].flat().length !== arrivals.length - seeded) bad.push(`I-1 ${y}`);
    if (p.defects.length) bad.push(`I-4 ${y} ${p.defects}`);
    for (const [d, cs] of p.departures) {
      for (const c of cs) {
        if (ctx.dayDiff(d, c.to) > 16) bad.push(`I-5 ${d} ${c.observance.id} → ${c.to}`);   // 부활 3.26 인 해 성지주일의 요셉 → 부활 2주 화요일(→ R-6.3-guard-order)
        if (String(c.displacedBy).startsWith("guard:")) bad.push(`I-11 ${d} ${c.observance.id} by ${c.displacedBy}`);
      }
    }
    for (const [D, cs] of p.arrivals) {
      if (!inYear(D, y)) continue;   // 다음 해로 넘긴 도착은 그해 계산의 seed 로 본다
      const deps = p.departures.get(D) || [];
      if (cs.some((c) => deps.some((x) => x.observance.id === c.observance.id))) bad.push(`I-6 ${D}`);
      // I-11 — 도착 날짜는 주일이 아니고 그날 유효 precedence ≤ 2 인 고유 후보(명절 · 대축일 · 대재일 · A 특례 · 절기
      // 주일)가 없다. I-3(도착 ∉ 보호 기간)은 폐기 — 보호 기간이 막지 않는다(→ R-6.3-holy-week-guard)
      const own = ctx.ownObservancesOn(ix().cal, D);
      if (ctx.dayOfWeek(D) === 0 || own.some((o) => ctx.effectivePrecedence(o) <= 2)) bad.push(`I-11 ${D} ${cs.map((c) => c.observance.id)}`);
      // I-2 — 도착은 떠나지 않으므로(I-6) 그날의 지정 전례일이다. 한 날에 도착은 하나다(선착순)
      const r = resolve(D);
      if (cs.length !== 1 || !r.official || r.official.status !== "transferred_in" || r.official.observance.id !== cs[0].observance.id) {
        bad.push(`I-2 ${D} ${cs.map((c) => c.observance.id)} official ${r.official && r.official.observance.id}`);
      }
    }
  }
  for (let y = YEAR_FROM + 1; y <= YEAR_TO; y++) {
    // I-7a — 깊이 1: 임시 Y−1 계산(seed 없음)의 Y 행 spill = spill(Y−2) 를 받은 완전한 Y−1 계산의 Y 행 spill
    const temp = ctx.computeTransfers(ix().cal, y - 1, new Map(), new Set());
    if (JSON.stringify(mapKey(ctx.spillOf(temp, y))) !== JSON.stringify(mapKey(ctx.spillOf(passOf(y - 1), y)))) bad.push(`I-7a ${y}`);
    // I-7b — seed 영향 범위: seed 있는 Y 계산과 없는 Y 계산이 2월 1일부터 같다
    const bare = ctx.computeTransfers(ix().cal, y, new Map(), new Set());
    if (passKey(passOf(y), `${y}-02-01`) !== passKey(bare, `${y}-02-01`)) bad.push(`I-7b ${y}`);
  }
  // I-8 — 캐시를 거꾸로(다음 해부터) 채워도 항목의 내용이 같다
  vm.runInContext("transferCache.clear()", ctx);
  for (let y = YEAR_TO; y >= YEAR_FROM; y--) if (passKey(passOf(y)) !== forward.get(y)) bad.push(`I-8 ${y}`);
  same(bad, []);
});

// 골든 덤프(검토 문서 부록 A · I-10) — 한 줄에 옮긴 축일 하나, 기원 날짜 순. 머리줄의 data sha 는 기록용이고 비교는 본문만
// 한다. 옮김 결과가 바뀌면(엔진 · 데이터) 이 테스트가 깨진다 — `UPDATE_GOLDEN=1` 로 다시 만들고 diff 를 PR 에서 읽는다.
const GOLDEN = path.join(FIXTURES, "transfers-1900-2100.golden.txt");

test("I-10 옮김 골든 덤프 — 1900~2100 본문 문자열 동등 (UPDATE_GOLDEN=1 로 다시 만든다)", { skip: SKIP }, () => {
  ctx.setActivatedOptionals([]);
  const lines = [];
  for (let y = YEAR_FROM; y <= YEAR_TO; y++) {
    for (const [d, cs] of passOf(y).departures) {
      for (const c of cs) lines.push(`${d} → ${c.to}  ${c.observance.id}  by:${c.displacedBy}  shift:${ctx.dayDiff(d, c.to)}`);
    }
  }
  lines.sort();   // 기원 → 목적지 → id 순(줄이 그 순서로 시작한다)
  if (process.env.UPDATE_GOLDEN === "1") {
    let sha = "unknown";
    try { sha = execFileSync("git", ["-C", path.join(ROOT, "data"), "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* 기록용 */ }
    const head = `# data ${sha} · activated=∅ · MAX_SHIFT=${vm.runInContext("MAX_SHIFT", ctx)}`;
    fs.writeFileSync(GOLDEN, [head, ...lines].join("\n") + "\n");
    return;
  }
  const want = fs.readFileSync(GOLDEN, "utf8").split("\n").filter((l) => l !== "" && !l.startsWith("#"));
  // 차이만 보인다 — 천 줄을 통째로 찍지 않는다
  const got = new Set(lines);
  const had = new Set(want);
  same({ missing: want.filter((l) => !got.has(l)), extra: lines.filter((l) => !had.has(l)) }, { missing: [], extra: [] });
  assert.ok(lines.every((l, i) => l === want[i]), "줄 순서");
});
