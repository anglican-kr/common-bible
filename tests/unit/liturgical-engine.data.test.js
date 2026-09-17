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
vm.runInContext("const anchorCache = new Map();", ctx, { filename: "prelude" });
vm.runInContext(extractBlock("LITURGICAL_CORE", SOURCE), ctx, { filename: "liturgical-engine.js" });

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
