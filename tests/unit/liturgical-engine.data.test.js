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
vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map();", ctx, { filename: "prelude" });
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
    // 중복·결측만 보던 종전 단언은 그 둘을 놓쳤다(3차 리뷰). 묶음 사이의 빈 번호는 정상이다
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
// 레코드 id 는 표의 잠정 순번일 수 있어(ADR-036 §10) 단언은 id 대신 레코드의 필드로 한다.

// vm 이 만든 값은 realm 이 달라 구조가 같아도 deepStrictEqual 이 틀린다 — 양쪽을 정규화한다.
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

let built = null;
/** 실제 표 아홉으로 두 인덱스를 한 번 만든다 — data/ 가 없으면 부르지 않는다(skip). */
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
const resolve = (d) => ctx.resolveDateIn(ix().cal, d, ctx.transfersOf(Number(d.slice(0, 4))));
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
const colOf = (c) => ix().col.get(c.id);
const WD = [null, "mon", "tue", "wed", "thu", "fri", "sat"];

test("C-4.3-3 성 토요일 · 부활밤이 같은 날 후보 둘 — 각자 자기 본문 (2026-04-04)", { skip: SKIP }, () => {
  const r = resolve("2026-04-04");
  same(r.candidates.map((c) => c.observance.id), ["t-부활밤", "t-성-토요일", "grid:lent-x-weekday-sat"]);
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

test("§5.5 규칙 파생 관측일은 자기 달력년 안에 떨어진다 — 해를 넘기면 그 해의 조회가 닿지 않는다 (1900~2100)", { skip: SKIP }, () => {
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

test("C-5.6-4 성인 공통 독서 폴백 — 양성 · 음성 · 불변식 82 / 13 / 16", { skip: SKIP }, () => {
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
  // 음성 — 06.24 는 띄어쓰기로 이름 조인이 빠져도 고유, 스테파노는 고유, 기념일은 빈 배열
  for (const [d, p] of [["2026-06-24", "d0624"], ["2026-12-26", "d1226"]]) {
    const got = groupsAt(d, p);
    assert.ok(got.length > 0 && got.every((g) => g.common === null), p);
  }
  same(ids("2026-01-01", "d0101-세계평화"), []);
  // 불변식 — 성인력 전 행
  const commons = read("commons.json").classes;
  const kasi = read("kasi-lunar.json");
  let fallback = 0, properWithCommon = 0, memorialEmpty = 0;
  for (const row of read("sanctoral.json").entries) {
    const d = row.date ? `2028-${row.date.replace(".", "-")}` : ctx.lunarDatesOf(kasi, 2028)[row.lunar];
    const gs = groupsAt(d, row.id);
    if (row.rank === "commemoration") { if (gs.length === 0) memorialEmpty++; continue; }
    if (gs.length > 0 && gs.every((g) => g.common !== null)) fallback++;
    else if (row.sanctoral_class in commons && gs.length > 0 && gs.every((g) => g.common === null)) properWithCommon++;
  }
  same([fallback, properWithCommon, memorialEmpty], [82, 13, 16]);
});

test("§5.6 본기도 폴백은 빈틈 없이 닫힌다 — has_proper 참은 고유, 거짓은 공통 하나({name} 치환), 기념일은 없음", { skip: SKIP }, () => {
  const kasi = read("kasi-lunar.json");
  const bad = [];
  for (const row of read("sanctoral.json").entries) {
    const d = row.date ? `2028-${row.date.replace(".", "-")}` : ctx.lunarDatesOf(kasi, 2028)[row.lunar];
    const cs = collectsAt(d, row.id);
    const ok = row.rank === "commemoration" ? cs.length === 0
      : row.has_proper ? cs.length > 0 && cs.every((c) => c.common === null)
        : cs.length === 1 && cs[0].common === row.sanctoral_class && !cs[0].text.includes("{name}");
    if (!ok) bad.push(`${row.id} ${cs.map((c) => c.id)}`);
  }
  same(bad, []);
  assert.ok(collectsAt("2026-01-08", "d0108")[0].text.includes("루시안"));
});

test("C-5.6-6 날짜 선택 순서 — 격자는 resolved.date(12.19 · 12.17), 옮겨 온 안드레아는 기원 11.30", { skip: SKIP }, () => {
  for (const d of ["2026-12-19", "2025-12-17"]) {
    const gs = groupsAt(d, "grid:advent-3-weekday");   // 대림 3주 평일인데 좌표 레코드가 아니라 날짜 전용 본문
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

test("C-5.5-3 ◐ 격자 ∧ temporal 공존 — 2026-03-29 성지주일 · 2026-11-29 대림1주일 (승자는 PR 3)", { skip: SKIP }, () => {
  same(resolve("2026-03-29").candidates.map((c) => c.observance.id), ["t-성지주일", "grid:lent-x-sunday"]);
  same(resolve("2026-11-29").candidates.map((c) => c.observance.id), ["t-대림1주일", "grid:advent-1-sunday"]);
  // 대림1주일 행은 조인 이름이 없어 자기 좌표로 격자 레코드에 닿는다(§5.4) — 나해
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
    const gs = groupsAt("2026-12-25", id);
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

test("고유명 평일 여섯 — 성주간 월~수 · 재의 수요일 후 목~토가 지정 독서 · 본기도를 낸다 (2026, data#27)", { skip: SKIP }, () => {
  // 특별한 일이 없으면 이 날들은 지정 독서를 쓴다(사용자 확정 2026-10-10). 재의 수요일 후 금요일은
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
  same([c.observance.rank, c.observance.precedence, c.status], ["commemoration", 7, "proper"]);
  same(groupsAt(d, "t-여성선교주일"), []);
  same(collectsAt(d, "t-여성선교주일"), []);
  assert.ok(groupsAt(d, "grid:ordinary").length > 0 && collectsAt(d, "grid:ordinary").length > 0);
  assert.ok(![...ix().rec.values(), ...ix().col.values()].some((e) => e.name === "여성선교주일"));
});

test("§5.4 · §5.6 도달 범위 — 2025~2050 모든 날의 모든 후보를 조회하면 독서 · 본기도 레코드가 하나도 빠지지 않는다", { skip: SKIP }, () => {
  // 조인 경로(격자 날짜 · 고유명 평일 · 좌표 · 이름 · 사계재 · 날짜 · 음력) 중 하나가 끊기면 그 경로의 레코드가
  // 어디에서도 안 나온다 — 개별 사례로는 놓치는 것을 전수로 잡는다(성주간 월~수 · 재의 수요일 후 목 · 토가 그 예다).
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
