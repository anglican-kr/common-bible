// ── lectionary 뷰 모델 ↔ 실데이터 대조 — data/ 서브모듈이 있어야 돈다 ───────────
// Run with: node --test tests/unit/lectionary.data.test.js
//
// **공개 저장소의 필수 `Unit tests` 잡에서는 돌지 않는다**(설계서 §7 — 서브모듈이 없다).
// liturgical-engine.data.test.js 와 같은 자리 — engine-data.yml · sync-data.yml 양쪽에 등록돼
// 돈다. 합성 표로 잡을 수 있는 것은 lectionary.test.js 에 둔다. 여기서는 실제 표 위에서
// 엔진이 낸 `ResolvedDate` · 독서 · 본기도를 뷰 모델(`buildLectionaryModel`)에 넣어 ADR-038 §3
// 의 규칙이 실제 날짜에서 성립하는지, 그리고 뷰 상수가 데이터의 `_meta` · `_vocab` 과
// 어긋나지 않는지 본다.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadAppHelpers } from "./harness.js";
// 화면 모델이 쓰는 공용 도우미. 손으로 옮긴 사본 대신 진짜 helpers.js의 것을 한 번만 받는다.
const { isFormerNorthChurch } = loadAppHelpers();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LECTIONARY_SOURCE = fs.readFileSync(path.join(ROOT, "js/app/lectionary.js"), "utf8");
const ENGINE_SOURCE = fs.readFileSync(path.join(ROOT, "js/app/liturgical-engine.js"), "utf8");
const VERSE_SPEC_SOURCE = fs.readFileSync(path.join(ROOT, "js/app/verse-spec.js"), "utf8");

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
  parseInt, isNaN, Date, NaN, URLSearchParams,
  isFormerNorthChurch,
};
vm.createContext(ctx);
vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map(); const activatedOptionals = new Set();",
  ctx, { filename: "prelude" });
vm.runInContext(extractBlock("LITURGICAL_CORE", ENGINE_SOURCE), ctx, { filename: "liturgical-engine.js" });
vm.runInContext(extractBlock("LITURGICAL_LOOKUP", ENGINE_SOURCE), ctx, { filename: "liturgical-engine.js#lookup" });
vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
vm.runInContext(extractBlock("LECTIONARY_MODEL", LECTIONARY_SOURCE), ctx, { filename: "lectionary.js" });

const LECTIONARY = path.join(ROOT, "data", "lectionary");
// 체크아웃 여부만 본다(liturgical-engine.data.test.js 와 같은 이유).
const haveData = fs.existsSync(LECTIONARY);
const SKIP = haveData ? false : "data/ 서브모듈 미체크아웃 — 로컬과 engine-data.yml·sync-data.yml 에서 돈다";
const read = (p) => JSON.parse(fs.readFileSync(path.join(LECTIONARY, p), "utf8"));
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// vm 이 만든 배열 · 객체는 realm 이 달라 deepStrictEqual 이 프로토타입에서 틀린다 — 양쪽을 정규화한다.
const same = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);
// `const` 상수는 스크립트 스코프라 ctx 프로퍼티가 아니다 — 이름으로 평가해 꺼낸다.
const K = (name) => vm.runInContext(name, ctx);

let built = null;
function ix() {
  if (built) return built;
  const cal = ctx.buildCalendarIndex({
    sanctoral: read("sanctoral.json"), temporal: read("temporal-feasts.json"), periods: read("periods.json"),
    ordinalWeeks: read("ordinal-weeks.json"), kasi: read("kasi-lunar.json"),
  });
  const lec = ctx.buildLectionaryIndex({
    readings: read("eucharist-readings.json"), collects: read("eucharist-collects.json"),
    commons: read("commons.json"), localObservances: read("local-observances.json"),
  });
  return (built = { cal, lec });
}
const resolve = (d) => ctx.resolveDateIn(ix().cal, d, ctx.transfersOf(ix().cal, Number(d.slice(0, 4))));
const NONE = { obs: null, track: null, set: null, collect: null };
/** 실제 표 위의 뷰 모델. 공개 래퍼(`lectionaryModelOf`)가 하는 것과 같은 조합이다. `parish`는 설정 「소속교회」의 교회 식별자, `saint`는 설정 「세례명」의 성인 식별자다. */
function model(d, query = NONE, stored = null, showAlternates = true, parish = "", saint = "") {
  const r = resolve(d);
  assert.ok(r, `${d} 를 풀 수 없다`);
  const cache = new Map();
  const groupsOf = (c) => {
    if (!cache.has(c.observance.id)) cache.set(c.observance.id, ctx.findReadingsIn(ix().lec, ix().cal, r, c));
    return cache.get(c.observance.id);
  };
  // 공개 래퍼의 findDedications(PRELOAD 블록 — 여기서는 싣지 않는다)와 같은 조회
  const dedications = ix().lec.dedications.get(`${d.slice(5, 7)}.${d.slice(8, 10)}`) || [];
  const foundings = ctx.findFoundingsIn(ix().lec, `${d.slice(5, 7)}.${d.slice(8, 10)}`, parish);
  const mine = ctx.myDedicationOf(dedications, parish);
  const collects = ctx.findCollectsIn(ix().lec, ix().cal, mine ? { ...r, candidates: [mine.candidate, ...r.candidates] } : r);
  // 공개 래퍼의 findSaintFeasts(PRELOAD 블록)와 같은 조회
  const saintFeasts = new Set((saint && ix().cal.saintFeasts.get(saint)) || []);
  const m = ctx.buildLectionaryModel(r, { ...NONE, ...query }, groupsOf, collects, stored, dedications, showAlternates, foundings, mine, saintFeasts);
  assert.ok(m, `${d} 모델이 null`);
  return m;
}
const id = (c) => c.observance.id;
/** 전례독서 목록에 보이는 글 — 이름과 상태 표시. */
const labels = (m) => m.choices.map((c) => c.name + c.suffix);

// ── 상수 ↔ 데이터 ──

test("A3 송영 상수 셋이 eucharist-collects.json _meta.endings 와 글자까지 같다", { skip: SKIP }, () => {
  const endings = read("eucharist-collects.json")._meta.endings;
  same(plain(K("ENDINGS")), endings);
});

test("A3 축성일 줄의 꼬리가 본당 표 _vocab 에 「일」을 붙인 것과 같고, 표의 종류는 모두 꼬리가 있다", { skip: SKIP }, () => {
  const table = read("local-observances.json");
  const label = K("DEDICATION_LABEL");
  same(Object.keys(label), Object.keys(table._vocab.dedication_kind));
  for (const [k, v] of Object.entries(table._vocab.dedication_kind)) assert.strictEqual(label[k], `${v}일`, k);
  for (const p of table.parishes) {
    assert.ok(p.dedication && /^\d{2}\.\d{2}$/.test(p.dedication.date), `${p.name} 축성일`);
    assert.ok(p.dedication.kind in label, `${p.name} 종류 ${p.dedication.kind}`);
  }
});

// ── 소속교회의 축성일(ADR-041 §6, §8) ──

/** 본당 표에서 교회 이름으로 찾은 교회 식별자. */
const churchIdOf = (name) => {
  const p = read("local-observances.json").parishes.find((x) => x.name === name);
  assert.ok(p && p.church_id, `${name} 식별자`);
  return p.church_id;
};
/** 전례독서 목록에서 고른 줄(제목)을 뺀 줄의 이름과 주소. */
const otherRows = (m) => m.choices.filter((c) => !c.active).map((c) => [c.name, c.href]);

test("본당 표의 축성일 분류가 소속교회 축성일 후보에 그대로 실리고, 공통 「성당 축성일」에 독서 2세트와 본기도가 있으며 색이 같다", { skip: SKIP }, () => {
  const dedication = read("commons.json").classes.dedication;
  same([dedication.label, dedication.readings.length, typeof dedication.collect.text], ["성당 축성일", 2, "string"]);
  for (const p of read("local-observances.json").parishes.filter((x) => x.dedication.kind === "consecration" && x.church_id)) {
    const d = p.dedication;
    const entries = ix().lec.dedications.get(d.date) || [];
    const o = ctx.myDedicationOf(entries, p.church_id).candidate.observance;
    same([o.rank, o.precedence, o.priority_group, o.color, o.sanctoral_class, o.transferable], [d.rank, d.precedence, d.priority_group, d.color, d.common, d.transferable], p.name);
    same([d.common, d.color], ["dedication", dedication.color], p.name);
  }
});

test("소속교회 축성일 — 평일이면 축성일이 먼저(공통 독서 2세트와 본기도), 평일은 목록의 줄, 기리는 성인의 본기도는 평일 줄에서만(ADR-041 §6)", { skip: SKIP }, () => {
  const yongin = churchIdOf("용인성당");
  const m = model("2025-01-31", NONE, null, false, yongin);   // 연중 3주 금요일
  same([m.dayName, m.groups.map((g) => g.id), m.collects.map((c) => c.id)],
    ["용인성당 축성일", ["common:dedication-s1", "common:dedication-s2"], ["common:dedication-c1"]]);
  same(otherRows(m), [["연중 3주 금요일", "/lectionary/2025-01-31?obs=grid%3Aordinary-3-weekday-fri"]]);
  assert.ok(!m.dedicationLines.some((l) => l.includes("용인성당")), "제목의 교회는 축성일 줄에서 빠진다");
  assert.ok(m.privateSelection, "축성일 화면은 문서 제목에서 교회 이름을 감춘다");
  // 소속교회가 없으면 그날은 평일이고, 축성일 줄에 교회가 보인다
  const none = model("2025-01-31", NONE, null, false);
  same([none.dayName, none.dedicationLines.some((l) => l.includes("용인성당")), none.privateSelection], ["연중 3주 금요일", true, false]);

  // 안셀름 축일(공통 독서뿐이라 기본 독서는 부활 1주 월요일)과 겹친 강릉성당 축성일. 성인의 이름 줄은 남고 본기도는 평일 줄을 고를 때만 잇는다
  const gangneung = churchIdOf("강릉성당");
  const a = model("2025-04-21", NONE, null, false, gangneung);
  same([a.dayName, a.memorialCollects, a.memorialSaints.map(id)], ["강릉성당 축성일", [], ["d0421-안셀름"]]);
  const weekday = a.choices.find((c) => !c.active && c.candidate.observance.id.startsWith("grid:"));
  const w = model("2025-04-21", { obs: weekday.candidate.observance.id }, null, false, gangneung);
  assert.ok(w.memorialCollects.length > 0, "평일 줄에는 성인 본기도를 잇는다");
});

test("소속교회 축성일 — 주일, 대축일, 평일의 명절이면 그날의 전례일이 먼저이고 축성일은 맨 앞 줄(ADR-041 §6, 사용자 결정 2026-11-09)", { skip: SKIP }, () => {
  for (const [d, church, title] of [
    ["2025-05-11", "강동성당", "부활 4주일"],
    ["2026-05-14", "서창성당", "승천대축일"],
    ["2027-09-15", "서대구성당", "추석 명절"],
  ]) {
    const m = model(d, NONE, null, false, churchIdOf(church));
    assert.strictEqual(ctx.shortName(m.dayName), title, d);
    same(otherRows(m)[0], [`${church} 축성일`, `/lectionary/${d}?obs=my-dedication`], d);
    // 그 줄을 고르면 축성일 화면이고, 제목의 교회는 축성일 줄에서 빠진다
    const picked = model(d, { obs: "my-dedication" }, null, false, churchIdOf(church));
    assert.strictEqual(picked.dayName, `${church} 축성일`, d);
    assert.ok(!picked.dedicationLines.some((l) => l.includes(church)), d);
  }
});

test("소속교회 축성일 — 2025-2050 모든 축성일에 축성일이 처음 여는 화면이거나 전례독서 목록의 줄이다(ADR-041 §6)", { skip: SKIP }, () => {
  const churches = read("local-observances.json").parishes
    .filter((p) => p.dedication.kind === "consecration" && p.church_id && !isFormerNorthChurch(p.name));
  const bad = [];
  let first = 0;
  let rows = 0;
  for (let y = 2025; y <= 2050; y++) {
    for (const p of churches) {
      const d = `${y}-${p.dedication.date.replace(".", "-")}`;
      const m = model(d, NONE, null, false, p.church_id);
      if (m.selected.observance.id === "my-dedication") {
        first++;
        if (m.dayName !== `${p.name} 축성일` || m.memorialCollects.some((c) => c.common !== "anniversary")) bad.push(`${d} ${p.name} 처음 화면`);
        // 머리 색은 축성일의 백색 하나이고, 그날의 기본 독서는 목록의 줄로 남는다(PR #542 리뷰)
        if (m.colors.join() !== "white" || m.colorAlt.length) bad.push(`${d} ${p.name} 색 ${m.colors} ${m.colorAlt}`);
        if (!m.choices.some((c) => c.candidate === m.publicInitial && !c.active)) bad.push(`${d} ${p.name} 기본 독서 줄이 없다`);
      } else if (m.choices.some((c) => c.candidate.observance.id === "my-dedication" && c.href === `/lectionary/${d}?obs=my-dedication`)) {
        rows++;
      } else {
        bad.push(`${d} ${p.name} 축성일이 없다`);
      }
    }
  }
  same(bad, []);
  assert.ok(first > 0 && rows > 0, `처음 화면 ${first}, 줄 ${rows}`);
});

// ── 세례명(ADR-041 §5, §8) ──

/** 성인 목록에서 호칭으로 찾은 성인 식별자. */
const saintIdOf = (title) => {
  const s = read("sanctoral.json").saints.find((x) => x.title === title);
  assert.ok(s && s.id, `${title} 식별자`);
  return s.id;
};

test("세례명 — 공통 독서만 있는 성인(2026-11-06 레오나드)과 주일에 기념만 하는 성인(2026-07-26 안나, 요아킴)의 이름 줄이 그 사람에게만 목록의 줄로 옮겨 간다(ADR-041 §5)", { skip: SKIP }, () => {
  const leonard = saintIdOf("레오나드(은수자, 6세기)");
  const none = model("2026-11-06");
  assert.ok(none.memorialSaints.some((c) => id(c) === "d1106-레오나드") && !none.choices.some((c) => id(c.candidate) === "d1106-레오나드"));
  const m = model("2026-11-06", NONE, null, false, "", leonard);
  assert.strictEqual(ctx.shortName(m.dayName), "연중 31주 금요일");
  same(otherRows(m).find(([name]) => name === "레오나드(은수자, 6세기)"), ["레오나드(은수자, 6세기)", "/lectionary/2026-11-06?obs=my-saint"]);
  assert.ok(ctx.headLinesOf(m).others.includes("레오나드(은수자, 6세기) 축일"));
  assert.ok(!m.memorialSaints.some((c) => id(c) === "d1106-레오나드"), "이름 줄에서 빠진다");
  assert.ok(m.memorialCollects.some((c) => c.common), "평일 본기도 뒤에 잇는 성인 본기도는 그대로다");
  const picked = model("2026-11-06", { obs: "my-saint" }, null, false, "", leonard);
  same([picked.dayName, picked.groups.every((g) => g.common === "monastic"), picked.memorialCollects], ["레오나드(은수자, 6세기)", true, []]);

  for (const title of ["안나(성모 마리아의 어머니)", "요아킴(성모 마리아의 아버지)"]) {
    const s = model("2026-07-26", NONE, null, false, "", saintIdOf(title));
    assert.strictEqual(ctx.shortName(s.dayName), "연중 17주일", title);
    same(otherRows(s).find(([name]) => name === "안나와 요아킴(성모 마리아의 양친)"), ["안나와 요아킴(성모 마리아의 양친)", "/lectionary/2026-07-26?obs=my-saint"], title);
    same(s.memorialSaints, [], title);
  }
});

test("세례명 — 2025-2050 모든 날, 세례명 성인의 축일은 제목이거나 전례독서 목록의 줄이고, 생략되거나 옮겨 간 날만 없다. 세례명 줄의 글은 다른 사람이 보는 이름 줄의 글이다(ADR-041 §5)", { skip: SKIP }, () => {
  /** @type {Map<string, any[]>} */
  const byFeast = new Map();
  for (const s of read("sanctoral.json").saints) for (const f of s.feasts) byFeast.set(f, [...(byFeast.get(f) || []), s]);
  const bad = [];
  const count = { title: 0, mine: 0, public: 0, absent: 0, noLine: 0 };
  /** @type {Map<string, any>} 세례명이 없는 사람이 보는 그날의 모델 */
  const publicModels = new Map();
  const publicModel = (d) => publicModels.get(d) || publicModels.set(d, model(d, NONE, null, false)).get(d);
  for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2050, 11, 31); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    for (const c of resolve(d).candidates) {
      const owners = c.evening ? null : byFeast.get(id(c));
      if (!owners) continue;
      for (const s of owners) {
        const m = model(d, NONE, null, false, "", s.id);
        const row = m.choices.find((x) => id(x.candidate) === id(c));
        const named = [...m.memorialSaints, ...m.passiveDays].some((x) => id(x) === id(c));
        if (id(m.selected) === id(c)) {
          count.title++;
        } else if (row && m.mySaint && id(m.mySaint) === id(c)) {
          count.mine++;
          if (row.href !== `/lectionary/${d}?obs=my-saint` || named) bad.push(`${d} ${s.title} 세례명 줄 ${row.href} ${named}`);
          // 다른 사람에게 그 성인의 이름 줄이 있으면 같은 글이다. 없으면(평일의 3.1 데이빗 — 기본 독서가 삼일절이라 기리는 성인이 아니다) 기리는 성인의 형식이다
          const pub = publicModel(d);
          const text = row.name + row.suffix;
          const expected = pub.passiveDays.some((x) => id(x) === id(c)) ? ctx.shortName(c.observance.name) : `${c.observance.name} 축일`;
          const hasLine = [...pub.memorialSaints, ...pub.passiveDays].some((x) => id(x) === id(c));
          if (!hasLine) count.noLine++;
          if (text !== expected || (hasLine && !ctx.headLinesOf(pub).names.includes(text))) bad.push(`${d} ${s.title} 줄의 글 「${text}」`);
          if (id(model(d, { obs: "my-saint" }, null, false, "", s.id).selected) !== id(c)) bad.push(`${d} ${s.title} my-saint로 열리지 않는다`);
        } else if (row) {
          count.public++;
          if (row.href.includes("my-saint")) bad.push(`${d} ${s.title} 누구에게나 보이는 줄인데 ${row.href}`);
        } else if (c.status === "omitted" || c.status === "transferred_out") {
          count.absent++;
        } else {
          bad.push(`${d} ${s.title} ${c.status} 줄이 없다`);
        }
      }
    }
  }
  same(bad, []);
  // 공통 독서만 있는 성인이 많아 세례명 줄이 가장 많고(2,204번), 고유 독서가 있어 제목인 날(704번)과 생략되는 날(94번)이 있다.
  // 제목이 아닌데 누구에게나 보이는 줄은 2025-2050에 없다(2026-11-10 데이터). 다른 사람에게 이름 줄이 없는 세례명 줄은 평일의 3.1 데이빗뿐이다
  assert.ok(count.mine > count.title && count.title > 0 && count.absent > 0, JSON.stringify(count));
  assert.ok(count.noLine > 0 && count.noLine < 30, JSON.stringify(count));
});

test("본당 표의 교회 교구가 모두 교구 설립일 행과 짝이 맞고, 교구 이름은 「교구」를 뗀 이름이다(설립일 찾기가 이름으로 잇는다)", { skip: SKIP }, () => {
  const table = read("local-observances.json");
  const names = new Set(table.dioceses.map((d) => d.name));
  for (const n of names) assert.ok(!n.endsWith("교구"), n);   // 「서울교구교구설립일」이 되지 않게
  const missing = [...new Set(table.parishes.map((p) => p.diocese).filter((d) => d !== null && !names.has(d)))];
  same(missing, []);
});

test("소속교회의 교구 설립일 — 서울과 대전 5.27, 부산 6.1에 그 교구의 이름 줄과 본기도(「서울교구를 세우심을… 이 교구를」)를 잇고, 다른 교구와 소속교회가 없으면 없다(ADR-041 §6)", { skip: SKIP }, () => {
  const lineOf = (m) => m.foundingLines.filter((l) => l.includes("교구설립일"));
  const textOf = (m) => m.memorialCollects.filter((c) => c.common === "anniversary").map((c) => c.text);
  for (const [church, diocese, d, year] of [["용인성당", "서울", "2026-05-27", 1965], ["대전주교좌성당", "대전", "2026-05-27", 1965], ["부산주교좌성당", "부산", "2026-06-01", 1974]]) {
    const m = model(d, NONE, null, false, churchIdOf(church));
    const [mm, dd] = [Number(d.slice(5, 7)), Number(d.slice(8, 10))];
    same(lineOf(m), [`${year}년 ${mm}월 ${dd}일 ${diocese}교구설립일`], church);
    const [text] = textOf(m);
    assert.ok(text && text.includes(`이곳에 ${diocese}교구를 세우심을`) && text.includes("이 교구를 기억하시고") && !text.includes("(관구)"), `${church} ${text}`);
  }
  // 다른 교구의 설립일, 소속교회를 고르지 않은 사람에게는 없다
  same([lineOf(model("2026-06-01", NONE, null, false, churchIdOf("용인성당"))), lineOf(model("2026-05-27", NONE, null, false))], [[], []]);
  same(textOf(model("2026-05-27", NONE, null, false)), []);
});

test("A3 주기 · 색 라벨이 데이터 _vocab 과 같다(ADR-036 §4 단일 출처)", { skip: SKIP }, () => {
  const vocab = read("eucharist-collects.json")._vocab;
  same(plain(K("CYCLE_LABEL")), vocab.year);
  const colorLabel = K("COLOR_LABEL");
  for (const [k, v] of Object.entries(vocab.color)) assert.strictEqual(colorLabel[k], v, `color ${k}`);
  // 선택 대체색 둘(장미색 · 청색)은 본기도 표의 _vocab 에 없을 수 있어 독서 표 쪽도 본다.
  const vocab2 = read("eucharist-readings.json")._vocab;
  for (const [k, v] of Object.entries(vocab2.color || {})) assert.strictEqual(colorLabel[k], v, `readings color ${k}`);
});

// ── 실제 날짜 — ADR-038 §3 규칙 ──

test("A3 2026-04-05 부활대축일 — 본기도 대체안 셋이 세그먼트, 세트 둘(원본 세트 표지는 숨김), 슬롯 넷, 기념일은 전례독서 목록이 아니라 이름 줄", { skip: SKIP }, () => {
  const m = model("2026-04-05");
  assert.strictEqual(id(m.selected), "t-부활대축일");
  assert.strictEqual(m.collects.length, 3);   // 부활대축일의 자유선택 대체안 셋 — 고른 전례일의 것만
  assert.strictEqual(m.collectIndex, 0);
  same(m.options.map((o) => [o.label, o.short]), [["독서 1", null], ["독서 2", null]]);   // 원본 세트 둘 = 「또는」 대안
  same(m.slots.map((s) => s.slot), ["first", "psalm", "second", "gospel"]);
  same(labels(m), ["부활대축일"]);   // 부활 1주일 격자는 본문이 없어 전례독서 목록에 없다(사용자 결정 2026-11-04)
  same(m.commemorations.map((c) => id(c)), ["d0405-마틴-루터-킹"]);   // 「… 기념일」 줄(사용자 결정 2026-11-03)
  same(plain(m.colors), ["white"]);
  const third = model("2026-04-05", { collect: 3 });
  assert.strictEqual(third.collectIndex, 2);
});

test("A3 2026-09-16 니니안 ∧ 추계재 — 초기 독서는 격자(미결25), 색 [자, 백], 추계재를 고르면 [자]와 세트 둘", { skip: SKIP }, () => {
  const m = model("2026-09-16");
  assert.strictEqual(id(m.resolved.official), "d0916-니니안");
  assert.strictEqual(id(m.selected), "grid:ordinary-24-weekday-wed");
  same(plain(m.colors), ["violet", "white"]);
  assert.strictEqual(m.group.common, null);
  assert.strictEqual(m.collects.length, 1);   // 격자(연중 24주간) 본기도
  same(m.memorialCollects.map((c) => c.common), ["missionary"]);   // 그 뒤에 니니안(선교사 공통) 본기도(2026-11-03)
  same(labels(m), ["성직자의 성소를 위한 추계재", "연중 24주 수요일"]);
  const ember = model("2026-09-16", { obs: "t-추계재" });
  assert.strictEqual(ember.dayName, "성직자의 성소를 위한 추계재");
  same(plain(ember.colors), ["violet"]);
  assert.strictEqual(ember.ownColor, true);
  same(ember.options.map((o) => o.label), ["독서 1", "독서 2"]);
  assert.strictEqual(ember.fast, "minor");
  // 니니안은 공통 독서만 있어 당분간 전례독서 목록에 없고, 주소로 가리켜도 기본 독서(격자)다(HIDE_COMMON_READINGS, 사용자 결정 2026-11-03)
  assert.ok(!m.choices.some((c) => id(c.candidate) === "d0916-니니안"));
  const saint = model("2026-09-16", { obs: "d0916-니니안" });
  assert.strictEqual(id(saint.selected), "grid:ordinary-24-weekday-wed");
  same(plain(saint.colors), ["violet", "white"]);
});

test("A3 2026-08-09 연중 19주일 — 트랙 토글, 평화통일주일은 전례독서 목록이 아니라 이름 줄(사용자 결정 2026-11-04)", { skip: SKIP }, () => {
  const m = model("2026-08-09");
  same(plain(m.tracks), [1, 2]);
  assert.strictEqual(m.track, 1);
  assert.strictEqual(m.choices.find((c) => id(c.candidate) === "grid:ordinary-19-sunday").name, "연중 19주일");
  assert.ok(!m.choices.some((c) => id(c.candidate) === "t-평화통일주일"));
  same(m.textlessDays.map((c) => id(c)), ["t-평화통일주일"]);
  const peace = model("2026-08-09", { obs: "t-평화통일주일" });
  assert.strictEqual(id(peace.selected), "grid:ordinary-19-sunday");   // 주소로 가리켜도 기본 독서
  assert.strictEqual(peace.empty, false);
  const moved = model("2026-08-09", { obs: "d0806-주의-변모" });
  assert.strictEqual(moved.empty, false);
  assert.strictEqual(moved.slots.length, 4);
  same(plain(moved.colors), ["white"]);   // 변모를 고르면 그 축일의 백
});

test("A3 5.1 · 사계재 금요일 — 독서 세트와 본기도가 같은 제목으로 짝지어져 전례독서 목록의 줄(?set=)로 함께 바뀌고, 고른 전례일의 것이 먼저이며, 제목이 따라간다(사용자 결정 2026-10-13, 2026-11-05)", { skip: SKIP }, () => {
  const rows = (m) => m.choices.map((c) => [c.name, c.active]);
  const m = model("2026-05-01");
  assert.strictEqual(m.collectsLinked, true);
  assert.strictEqual(m.dayName, "사도 성 필립보와 성 야고보");
  same(rows(m), [["사도 성 필립보와 성 야고보", true], ["노동자의 날", false], ["부활 4주 금요일", false]]);
  assert.strictEqual(m.collects[m.collectIndex].title, "사도 성 필립보와 성 야고보");
  same(m.choices.slice(0, 2).map((c) => c.href), ["/lectionary/2026-05-01", "/lectionary/2026-05-01?set=2"]);
  const labour = model("2026-05-01", { set: 2 });
  assert.strictEqual(labour.dayName, "노동자의 날");
  same(rows(labour), [["사도 성 필립보와 성 야고보", false], ["노동자의 날", true], ["부활 4주 금요일", false]]);
  assert.strictEqual(labour.group.title, "노동자의 날");
  assert.strictEqual(labour.collects[labour.collectIndex].title, "노동자의 날");
  const crossed = model("2026-05-01", { collect: 2 });   // 교차 조합은 없다 — ?collect= 는 읽지 않는다
  assert.strictEqual(crossed.collects[crossed.collectIndex].title, "사도 성 필립보와 성 야고보");
  same(rows(model("2026-09-18")), [["성직후보자의 성소를 위한 추계재", false], ["수도자의 성소를 위한 추계재", false], ["연중 24주 금요일", true]]);
  const ember = model("2026-09-18", { obs: "t-추계재" });
  assert.strictEqual(ember.collectsLinked, true);
  assert.strictEqual(ember.dayName, "성직후보자의 성소를 위한 추계재");
  const second = model("2026-09-18", { obs: "t-추계재", set: 2 });
  assert.strictEqual(second.dayName, "수도자의 성소를 위한 추계재");
  assert.strictEqual(second.collects[second.collectIndex].id, 237);
});

test("A3 사계재 — 2025-2050 모든 날, 수 · 금 · 토의 줄이 정해진 제목이고(금요일은 둘), 줄을 누르면 제목과 독서와 본기도가 그 제목이다(사용자 결정 2026-11-05)", { skip: SKIP }, () => {
  const INTENTIONS = { 3: ["성직자"], 5: ["성직후보자", "수도자"], 6: ["모든 신자"] };
  const isEmberCandidate = (c) => !!(c.observance.rule && c.observance.rule.kind === "ember_wfs");
  const bad = [];
  let days = 0;
  for (let d = "2025-01-01"; d <= "2050-12-31"; d = ctx.addDays(d, 1)) {
    const base = model(d);
    const ember = base.resolved.candidates.find(isEmberCandidate);
    if (!ember) continue;
    days++;
    const want = INTENTIONS[new Date(`${d}T00:00:00Z`).getUTCDay()].map((n) => `${n}의 성소를 위한 ${ember.observance.name}`);
    const rows = base.choices.filter((c) => isEmberCandidate(c.candidate));
    if (rows.map((c) => c.name).join() !== want.join()) bad.push(`${d} 줄: ${rows.map((c) => c.name)}`);
    rows.forEach((row, i) => {
      const q = new URL(row.href, "http://x").searchParams;
      const m = model(d, { obs: q.get("obs"), set: Number(q.get("set")) || null });
      const active = m.choices.filter((c) => c.active).map((c) => c.name).join();
      if (m.dayName !== want[i] || active !== want[i]) bad.push(`${d} 제목 ${m.dayName}, 활성 줄 ${active}`);
      if (m.group.title !== want[i]) bad.push(`${d} 독서 ${m.group.title}`);
      if (m.collects[m.collectIndex].title !== want[i]) bad.push(`${d} 본기도 ${m.collects[m.collectIndex].title}`);
    });
  }
  same(bad, []);
  assert.strictEqual(days, 312);
});

test("A3 데이터 전수 — 독서 세트가 제목으로 갈리는 날은 본기도도 같은 제목으로 짝지어진다(5.1 · 사계재 금요일 넷뿐 — 사용자 결정 2026-10-13의 지킴이)", { skip: SKIP }, () => {
  const bad = [];
  const seen = new Set();
  for (const y of [2025, 2026, 2027]) {
    let d = ctx.toKey(y, 1, 1);
    while (d.slice(0, 4) === String(y)) {
      for (const choice of model(d).choices) {
        const m = model(d, { obs: choice.candidate.observance.id });
        if (new Set(m.options.map((o) => o.group.title)).size > 1 && !m.collectsLinked) bad.push(`${d} ${id(choice.candidate)}`);
        if (m.collectsLinked) seen.add(id(choice.candidate));
      }
      d = ctx.addDays(d, 1);
    }
  }
  same(bad, []);
  same([...seen].sort(), ["d0501-사도-성-필립보와-성-야고보", "t-동계재", "t-추계재", "t-춘계재", "t-하계재"].sort());
});

test("A3 절 발췌 — 옮겨 실린 절(이사 40 의 41:6-7)과 다니 3 의 이중 번호를 번호만으로 고르지 않는다(자체 리뷰 2026-10-13)", { skip: SKIP }, () => {
  const bible = (b, c) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", `${b}-${c}.json`), "utf8"));
  const keysOf = (b, c, spec) => plain(ctx.selectVerses(bible(b, c), spec).keys);
  const isa = keysOf("isa", 40, "1-11");
  assert.ok(!isa.some((k) => k.includes("_c41")), `이사 40:1-11 에 41:6-7 이 끼었다: ${isa}`);
  assert.strictEqual(isa.length, 11);
  same(keysOf("dan", 3, "25,34-43"), ["25_lxx", "34_lxx", "35_lxx", "36_lxx", "37_lxx", "38_lxx", "39_lxx", "40_lxx", "41_lxx", "42_lxx", "43_lxx"]);
  same(keysOf("dan", 3, "14-20,24-25,28"), ["14", "15", "16", "17", "18", "19", "20", "24_91", "25_92", "28_95"]);
});

test("A3 데이터의 다니 3 참조는 RCL(NRSV) 계열 독서표와 같은 본문을 고르고, 새 참조가 생기면 멈춘다(사용자 결정 2026-10-13 — 「RCL 과 일치하면 완결」)", { skip: SKIP }, () => {
  // RCL 은 NRSV 번호를 쓴다(CCT RCL 서문 §10) — 다니 3 은 히브리 번호, 그리스어 추가 본문은 따로 「Song of the Three」(1~68,
  // 그리스어 3:24~51 = NRSV 1~28). 잉글랜드 CW 평일 성찬 독서표가 같은 두 날을 이렇게 적는다:
  //   사순 3주 화 「다니 3:25, 34-43」 = Song of the Three 2, 11-20 — 그리스어 (25) · (34)~(43)
  //   사순 5주 수 「다니 3:14-20, 24-25, 28」 = Dan 3.14-20, 24-25, 28 — 히브리 번호(불가타 91 · 92 · 95)
  const RCL_EQUIVALENT = {
    "25,34-43": ["25_lxx", "34_lxx", "35_lxx", "36_lxx", "37_lxx", "38_lxx", "39_lxx", "40_lxx", "41_lxx", "42_lxx", "43_lxx"],
    "14-20,24-25,28": ["14", "15", "16", "17", "18", "19", "20", "24_91", "25_92", "28_95"],
  };
  const found = new Set();
  const walk = (/** @type {any} */ x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    if (x.bookId === "dan" && Array.isArray(x.refs)) for (const ref of x.refs) if (ref.chapter === 3) found.add(ref.verseSpec);
    Object.values(x).forEach(walk);
  };
  for (const f of ["eucharist-readings.json", "commons.json"]) walk(read(f));
  same([...found].sort(), Object.keys(RCL_EQUIVALENT).sort(), "새 다니 3 참조 — RCL(NRSV) 기준과 대조해 RCL_EQUIVALENT 에 더할 것");
  const dan3 = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", "dan-3.json"), "utf8"));
  for (const [spec, keys] of Object.entries(RCL_EQUIVALENT)) same(plain(ctx.selectVerses(dan3, spec).keys), keys, spec);
});

test("A3 2026-12-07 옮겨 온 성 니콜라 — 기본 독서는 옮겨 온 축일, 옮겨 온 것은 제목 아래 문장, 본기도는 니콜라 다음에 기념만 하는 암브로스", { skip: SKIP }, () => {
  const m = model("2026-12-07");
  assert.strictEqual(id(m.selected), "d1206-성-니콜라");   // 기본 독서는 옮겨 온 주요축일(사용자 확인 2026-11-03)
  assert.ok(m.choices.some((c) => c.name === "성 니콜라" && c.active));
  assert.strictEqual(m.selectedNote, "12월 6일에서 옮겨 옴");   // 고른 쪽의 상태는 제목 아래 안내(2026-11-03, 2026-11-06)
  assert.ok(m.choices.find((c) => c.active).title.includes("12월 6일에서 옮겨 옴"));   // 전체 상태는 title에
  assert.strictEqual(m.collects.length, 1);   // 니콜라 본기도(기원 날짜에 색인된 것 — §5.6)
  same(m.memorialSaints.map((c) => id(c)), ["d1207-암브로스"]);   // 밀려서 기념만 — 이름 줄과 본기도(2026-11-03)
  assert.strictEqual(m.slots.length, 4);   // 기원 날짜에 색인된 독서가 옮겨 온 날에서 나온다(§5.6)
});

test("A3 2026-01-01 세계평화 기도일 — 본문 없는 축일은 전례독서 목록이 아니라 이름 줄(사용자 결정 2026-11-04), 거룩한 이름 예수는 세트 둘", { skip: SKIP }, () => {
  const m = model("2026-01-01", { obs: "d0101-세계평화를-위한-기도일" });
  assert.strictEqual(m.empty, false);   // 기도서에 본기도와 독서가 없어(미결51) 가리켜도 기본 독서
  assert.strictEqual(id(m.selected), "d0101-거룩한-이름-예수");
  assert.ok(!m.choices.some((c) => id(c.candidate) === "d0101-세계평화를-위한-기도일"));
  same(m.textlessDays.map((c) => id(c)), ["d0101-세계평화를-위한-기도일"]);
  const feast = model("2026-01-01");
  assert.strictEqual(id(feast.selected), "d0101-거룩한-이름-예수");
  assert.strictEqual(feast.options.length, 2);
});

test("A3 본문 없는 후보와 겹치는 후보는 목록에 없음 — 2025~2050 모든 날, 목록의 후보는 독서나 본기도가 있고 본문 없는 날은 이름 줄, 본문이 같아 감춘 격자는 대림 1주일뿐(사용자 결정 2026-11-04)", { skip: SKIP }, () => {
  const bad = [];
  /** @type {Map<string, number>} */
  const textless = new Map();
  /** @type {Set<string>} */
  const sameAsNamed = new Set();
  for (let y = 2025; y <= 2050; y++) {
    let d = ctx.toKey(y, 1, 1);
    while (d.slice(0, 4) === String(y)) {
      const m = model(d);
      const r = m.resolved;
      const cols = ctx.findCollectsIn(ix().lec, ix().cal, r);
      for (const choice of m.choices) {
        const c = choice.candidate;
        const reads = ctx.findReadingsIn(ix().lec, ix().cal, r, c).length;
        const prays = cols.find((e) => e.candidate === c).collects.length;
        if (!reads && !prays) bad.push(`${d} ${choice.name}`);
      }
      for (const c of r.candidates) {   // 본문이 있는데 전례독서 목록에 없는 격자 — 이름 있는 후보와 본문이 같아 감춘 것
        if (!id(c).startsWith("grid:") || c === m.initial || m.choices.some((x) => x.candidate === c)) continue;
        if (ctx.findReadingsIn(ix().lec, ix().cal, r, c).length) sameAsNamed.add(id(c));
      }
      for (const c of m.textlessDays) textless.set(c.observance.name, (textless.get(c.observance.name) || 0) + 1);
      d = ctx.addDays(d, 1);
    }
  }
  same(bad, []);
  // 본문 없는 날은 이 넷뿐이다 — 하나가 늘면 데이터가 본문 없는 전례일을 더한 것이니 이름 줄로 괜찮은지 본다. 대한성공회 선교 기념일은
  // 자기 본기도가 없고 성 미가엘의 독서를 받아 본문 없는 날로 본다(사용자 결정 2026-11-07)
  same([...textless.keys()].sort(), ["가정주일", "대한성공회 선교 기념일", "세계평화를 위한 기도일", "평화통일주일"]);
  // 그날 기본 독서가 그해의 대림 1주일 독서라 격자 전례독서 목록이 같은 본문이다 — 다른 격자가 늘면 정말 같은 화면인지 본다
  same([...sameAsNamed], ["grid:advent-1-sunday"]);
  for (const d of ["2026-11-29", "2027-11-28", "2028-12-03"]) same(labels(model(d)), ["대림1주일"], d);   // 전례독서 목록이 없다
  same(labels(model("2025-11-30")), ["대림1주일"]);   // 옮겨 간 안드레아는 전례독서 목록이 아니라 문장이다(2026-11-04)
  // 왕이신 그리스도 주일은 가해 · 나해 · 다해 모두 전례독서 목록에 연중 34주일이 없다
  for (const d of ["2025-11-23", "2026-11-22", "2027-11-21"]) {
    assert.ok(!model(d).choices.some((c) => id(c.candidate) === "grid:ordinary-34-sunday"), d);
    assert.strictEqual(id(model(d).initial), "t-왕이신-그리스도-주일", d);
  }
});

test("A3 옮겨 간 축일 — 2025~2050 모든 날, 목록에 없고 문장 하나씩, 옮겨 간 날에 그 후보나 독서가 있다(사용자 결정 2026-11-04)", { skip: SKIP }, () => {
  const m = model("2026-12-06");
  same(labels(m), ["대림 2주일"]);   // 전례독서 목록이 없다
  same(plain(m.transferNotes), ["성 니콜라 축일을 12월 7일로 옮김"]);
  assert.strictEqual(id(model("2026-12-06", { obs: "d1206-성-니콜라" }).selected), id(m.initial));
  same(plain(model("2025-11-02").transferNotes), ["모든 별세자의 날을 11월 3일로 옮김"]);

  const bad = [];
  let total = 0;
  for (let y = 2025; y <= 2050; y++) {
    let d = ctx.toKey(y, 1, 1);
    while (d.slice(0, 4) === String(y)) {
      const day = model(d);
      const out = day.resolved.candidates.filter((c) => c.status === "transferred_out");
      total += out.length;
      if (day.choices.some((x) => x.candidate.status === "transferred_out")) bad.push(`${d} 전례독서 목록이 남음`);
      if (day.transferNotes.length !== out.length) bad.push(`${d} 문장 ${day.transferNotes.length}개, 옮겨 간 축일 ${out.length}개`);
      // 「날 축일을」 · 「축일 축일을」 — 이름이 새로 늘면 문장이 자연스러운지 본다
      for (const note of day.transferNotes) if (/(날|축일) 축일을/.test(note)) bad.push(`${d} ${note}`);
      for (const c of out) {
        // 전례독서 목록을 뺀 만큼 그 독서가 옮겨 간 날에서 보여야 한다
        const there = model(c.to);
        const arrived = there.resolved.candidates.find((x) => id(x) === id(c) && x.status === "transferred_in");
        if (!arrived) bad.push(`${d} ${id(c)}: ${c.to}에 옮겨 온 후보가 없음`);
        else if (ctx.hasProperReadings(ctx.findReadingsIn(ix().lec, ix().cal, there.resolved, arrived))
          && !there.choices.some((x) => x.candidate === arrived)) bad.push(`${d} ${id(c)}: ${c.to}에 고유 독서가 있는데 전례독서 목록에 없음`);
      }
      d = ctx.addDays(d, 1);
    }
  }
  same(bad, []);
  assert.ok(total > 100, `옮겨 간 축일 ${total}건`);
});

test("A3 2026-04-04 성 토요일 — 그날의 대표 · 초기 선택은 성 토요일(홍), 부활밤은 「· 저녁」 전례독서 목록으로 고르면 백(R-6.1-evening)", { skip: SKIP }, () => {
  const m = model("2026-04-04");
  assert.strictEqual(id(m.selected), "t-성-토요일");
  same(plain(m.colors), ["red"]);
  assert.strictEqual(m.ownColor, false);
  assert.strictEqual(m.resolved.color, "red");
  // 전례독서 목록 셋 — 그날 낮(성 토요일 · 격자) 다음 저녁 전례(부활밤)
  same(labels(m), ["성 토요일", "부활밤 · 저녁"]);   // 성주간 토요일 격자는 본문이 없어 전례독서 목록에 없다(2026-11-04)
  same(m.options.map((o) => o.label), ["독서 1", "독서 2"]);   // 성 토요일 원본 세트 둘(욥기/마태 · 애가/요한)
  const vigil = model("2026-04-04", { obs: "t-부활밤" });
  same(plain(vigil.colors), ["white"]);   // 고른 본문의 색(사용자 결정 2026-10-12)
  assert.strictEqual(vigil.ownColor, true);
  same(plain(model("2026-04-04", { obs: "grid:lent-x-weekday-sat" }).colors), ["red"]);
});

test("A3 2026-12-25 · 12-24 — 12.25 는 성탄 낮(초기 · 미결12) · 새벽 전례독서 목록, 성탄 밤은 12.24 의 「· 저녁」 전례독서 목록(R-6.1-evening)", { skip: SKIP }, () => {
  const m = model("2026-12-25");
  assert.strictEqual(id(m.selected), "d1225-성탄-낮");
  same(labels(m), ["성탄 낮", "성탄 새벽"]);   // 성탄 금요일 격자는 본문이 없어 전례독서 목록에 없다(2026-11-04)
  assert.strictEqual(m.collects.length, 1);   // 성탄 낮 본기도만 — 새벽은 그 전례독서 목록에서
  const eve = model("2026-12-24");
  assert.strictEqual(id(eve.selected), "grid:advent-4-weekday-thu");   // 그날의 대표 · 초기 선택은 대림 평일(자)
  same(plain(eve.colors), ["violet"]);
  same(labels(eve), ["성탄 1일 전", "성탄 밤 · 저녁"]);   // 날짜 전용 본문의 이름(사용자 결정 2026-11-03)
  const night = model("2026-12-24", { obs: "d1225-성탄-밤" });
  same(plain(night.colors), ["white"]);
  // 성탄 밤의 본문 · 본기도 — 12.24 에서 12.25 키로 좁힌다. 새벽(이사 62 · 루가 2:1-7, 8-20 · 본기도 280)과 가르는 값으로 고정한다
  // (「루가 2:1」 로 시작하는지만 보면 새벽 본문도 통과했다 — PR #349 리뷰)
  assert.strictEqual(night.group.title, "성탄 밤");
  same(night.slots.map((sl) => sl.label), ["이사 9:1-6", "시편 96", "디도 2:11-14", "루가 2:1-14, 15-20"]);
  same(night.collects.map((c) => c.id), [279]);
});

test("A3 2026-06-14 연중 11주일 — 트랙 기억이 기본, URL 이 앞서고, 괄호 선택 구절 세트는 바탕에 합쳐져 긴 본문 + 선택 구절", { skip: SKIP }, () => {
  const remembered = model("2026-06-14", NONE, 2);
  assert.strictEqual(remembered.track, 2);
  assert.strictEqual(remembered.group.reading_track, 2);
  const url = model("2026-06-14", { track: 1, set: 2 }, 2);
  assert.strictEqual(url.track, 1);
  assert.strictEqual(url.options.length, 1);   // 괄호 세트가 합쳐져 선택지 하나 — ?set=2 는 범위 밖
  assert.strictEqual(url.group.set_no, 2);      // 긴 본문
  assert.strictEqual(url.shortGroup.set_no, 1); // 짧은 바탕
  // 바탕과 다른 슬롯 하나에서만 선택 구절이 나온다.
  const diff = url.slots.filter((s) => { const t = url.shortGroup.readings.find((r) => r.slot === s.slot); return t && t.label !== s.label; });
  assert.strictEqual(diff.length, 1);
  const isOpt = ctx.optionalVerseTest(diff[0], url.shortGroup.readings.find((r) => r.slot === diff[0].slot));
  const marked = [];
  for (const ref of diff[0].refs) for (let n = 1; n <= 60; n++) if (isOpt(ref.chapter, n)) marked.push(`${ref.chapter}:${n}`);
  assert.ok(marked.length > 0 && marked.length < 60, marked.join(","));
});

test("A3 2024-03-24 성지주일 나해 — 긴 수난 · 짧은 수난 「독서 1 · 2」, 짧은 쪽에 괄호 세트(40-47)가 합쳐진다", { skip: SKIP }, () => {
  const m = model("2024-03-24");
  same(m.options.map((o) => [o.label, o.group.set_no, o.short && o.short.set_no]), [["독서 1", 1, null], ["독서 2", 3, 2]]);
  const second = model("2024-03-24", { set: 2 });
  const gospel = second.slots.find((s) => s.slot === "gospel");
  const shortGospel = second.shortGroup.readings.find((r) => r.slot === "gospel");
  const isOpt = ctx.optionalVerseTest(gospel, shortGospel);
  assert.strictEqual(isOpt(15, 39), false);
  assert.strictEqual(isOpt(15, 40), true);
  assert.strictEqual(isOpt(15, 47), true);
});

test("A3 왕이신 그리스도 주일 — 시편만 「또는」인 가해와 다해도 나해처럼 트랙 둘이다(사용자 결정 2026-11-05)", { skip: SKIP }, () => {
  const psalmOf = (c) => c.refs[1].label;
  const yearA = model("2026-11-22");
  same(plain(yearA.tracks), [1, 2]);
  same(yearA.cards.map((c) => c.name), ["연속 독서", "복음 주제"]);
  same(yearA.cards.map(psalmOf), ["시편 100", "시편 95:1-7"]);
  same(yearA.cards[0].refs.map((r) => r.differs), [false, true, false, false]);
  const yearC = model("2025-11-23");
  same(plain(yearC.tracks), [1, 2]);
  assert.ok(psalmOf(yearC.cards[0]).startsWith("루가 1:68-79"), psalmOf(yearC.cards[0]));
  assert.strictEqual(psalmOf(yearC.cards[1]), "시편 46");
  same(plain(model("2027-11-21").tracks), [1, 2]);
  // 기억된 트랙을 따른다 — 복음 주제로 읽던 사람은 이 주일에도 복음 주제 쪽 시편을 먼저 본다
  assert.strictEqual(model("2026-11-22", NONE, 2).slots[1].label, "시편 95:1-7");
});

test("A3 독서 카드 — 2025-2050 모든 날: 「또는」이나 트랙이 있는 날에만 있고, 고른 카드의 성구가 화면의 독서와 같으며 다른 항목을 표시한다", { skip: SKIP }, () => {
  const tally = { track: 0, set: 0 };
  for (let d = "2025-01-01"; d <= "2050-12-31"; d = ctx.addDays(d, 1)) {
    const m = model(d);
    // 트랙마다 선택지는 하나다 — 카드는 트랙의 첫 선택지만 싣는다(readingCards). 또는 대안이 트랙 안에 생기면 여기서 멈춘다.
    if (m.tracks.length > 1) assert.strictEqual(m.options.length, 1, d);
    assert.strictEqual(!!m.cards, m.tracks.length > 1 || (m.options.length > 1 && !m.collectsLinked), d);
    if (!m.cards) continue;
    tally[m.tracks.length > 1 ? "track" : "set"] += 1;
    assert.strictEqual(new Set(m.cards.map((c) => c.name)).size, m.cards.length, `${d} 이름이 겹친다`);
    assert.strictEqual(m.cards.filter((c) => c.active).length, 1, d);
    const active = m.cards.find((c) => c.active);
    same(active.refs.map((r) => r.label), m.slots.map((s) => s.label), d);
    // 같은 자리끼리 표시가 같고, 다른 항목이 하나는 있다
    for (const c of m.cards) {
      same(c.refs.map((r) => r.differs), active.refs.map((r) => r.differs), d);
      assert.ok(c.refs.some((r) => r.differs), `${d} ${c.name}에 다른 항목이 없다`);
    }
  }
  assert.ok(tally.track > 500 && tally.set > 500, JSON.stringify(tally));
});

test("A3 부활대축일 — 앞쪽끼리, 뒤쪽끼리 묶인 카드이고 트랙이 아니라 기억하지 않는다(사용자 확정 2026-11-05)", { skip: SKIP }, () => {
  const m = model("2027-03-28", NONE, 2);
  assert.strictEqual(m.track, null);
  same(m.cards.map((c) => [c.name, c.track, c.active]), [["독서 1", null, true], ["독서 2", null, false]]);
  same(m.cards.map((c) => c.refs.map((r) => r.label)), [
    ["사도 10:34-43", "시편 118:1-2, 14-24", "1고린 15:1-11", "요한 20:1-18"],
    ["이사 25:6-9", "시편 118:1-2, 14-24", "사도 10:34-43", "마르 16:1-8"],
  ]);
  same(m.cards[0].refs.map((r) => r.differs), [true, false, true, true]);
});

test("A3 사순 2주일 — 조건이 카드 이름이고, 고르면 제목만 「주의 변모 주일」이다. 색과 본기도는 그대로(사용자 결정 2026-11-05)", { skip: SKIP }, () => {
  const base = model("2027-02-21");
  same(base.cards.map((c) => c.name), ["사순 2주일", "주의 변모 주일로 지킬 때"]);
  assert.strictEqual(base.dayName, "사순 2주일");
  const m = model("2027-02-21", { set: 2 });
  assert.strictEqual(m.dayName, "주의 변모 주일");
  same(plain(m.colors), plain(base.colors));
  assert.strictEqual(m.collects[0].id, base.collects[0].id);
  assert.strictEqual(m.slots[3].label, "마르 9:2-9");
});

test("A3 5.1 과 사계재 금요일 — 카드가 아니라 전례독서 목록의 줄이다(사용자 결정 2026-11-05)", { skip: SKIP }, () => {
  const may1 = model("2026-05-01");
  assert.strictEqual(may1.collectsLinked, true);
  assert.strictEqual(may1.cards, null);
});

test("A3 2024-12-24 성탄 1일 전 — 날짜 전용 본문, 본기도 대체안 둘, 대체 청색", { skip: SKIP }, () => {
  const m = model("2024-12-24");
  assert.strictEqual(m.group.title, "성탄 1일 전");
  assert.strictEqual(m.collects.length, 2);   // 대체안 둘(1/2 · 2/2)
  same(plain(m.colorAlt), ["blue"]);
});

test("A3 2026-03-01 사순 2주일 — 조건부 세트는 조건이 라벨 「주의 변모 주일로 지킬 때」, 바탕은 전례일 이름(미결38)", { skip: SKIP }, () => {
  const m = model("2026-03-01", { set: 2 });
  same(m.options.map((o) => o.label), ["사순 2주일", "주의 변모 주일로 지킬 때"]);   // 「…로 지키는 경우」 → 「…로 지킬 때」
  assert.strictEqual(m.group.set_no, 2);
  // 삼일절 · 데이빗은 주일에 밀려 기념만 한다(사용자 결정 2026-10-24). 삼일절은 지역 축일이라 전례독서 목록의 링크다(2026-11-04).
  // 데이빗은 공통 독서만 있어 당분간 목록에 없고(2026-11-03), 이름 줄에만 보인다 — 주일에는 성인 본기도를 잇지 않는다(사용자 확인 2026-11-04)
  same(m.choices.map((c) => c.name), ["삼일절", "사순 2주일"]);
  assert.ok(!m.choices.some((c) => id(c.candidate) === "d0301-데이빗"));
  same(m.memorialSaints.map(id), ["d0301-데이빗"]);
  same(m.memorialCollects, []);
});

test("A3 전례독서 목록 — 2025-2050 모든 날, 어느 후보를 눌러도 후보 목록은 같고 고른 후보만 active이며, 상태 문장이 그 후보의 것이다(사용자 결정 2026-11-04)", { skip: SKIP }, () => {
  const bad = [];
  let days = 0;
  let longest = "";
  for (let d = "2025-01-01"; d <= "2050-12-31"; d = ctx.addDays(d, 1)) {
    const base = model(d);
    if (base.choices.length < 2) continue;
    days++;
    const names = base.choices.map((c) => id(c.candidate)).join();
    for (const choice of base.choices) {
      const label = choice.name + choice.suffix;
      if (label.length > longest.length) longest = label;
      if (choice.name.includes("(")) bad.push(`${d} 괄호 ${choice.name}`);
      const m = model(d, { obs: id(choice.candidate) });
      if (id(m.selected) !== id(choice.candidate)) bad.push(`${d} ${choice.name}: 고른 후보가 다름`);
      if (m.choices.map((c) => id(c.candidate)).join() !== names) bad.push(`${d} ${choice.name}: 후보 목록이 바뀜`);
      if (m.choices.filter((c) => c.active).map((c) => id(c.candidate)).join() !== id(m.selected)) bad.push(`${d} ${choice.name}: active`);
      if ((m.selectedNote !== null) !== (choice.suffix !== "")) bad.push(`${d} ${choice.name}: 상태 문장과 상태 표시가 맞지 않음(${m.selectedNote}, ${choice.suffix})`);
    }
  }
  same(bad, []);
  assert.strictEqual(days, 1654);   // 2.11의 대체 독서 줄로 25일이 늘었다(2032-02-11은 설날의 평일 줄이 있어 전에도 목록이 있었다)
  assert.ok(longest.length <= 30, `${longest.length} ${longest}`);   // 320px에서 두 줄 안에 든다(e2e가 그 줄을 본다)
});

test("A3 기념만 하는 후보 — 2025-2050 모든 날, 누를 수 없는 글이다. 전례독서 목록에 없고, 기리는 성인이 아니면 이름 줄에 이름만 보인다. 지역 축일(삼일절, 광복절)만 링크다(사용자 결정 2026-11-04)", { skip: SKIP }, () => {
  const bad = [];
  const others = new Set();
  const local = new Map();
  let days = 0;
  for (let d = "2025-01-01"; d <= "2050-12-31"; d = ctx.addDays(d, 1)) {
    const m = model(d);
    for (const c of m.choices) {
      if (!["commemorated", "omitted"].includes(c.candidate.status)) continue;
      const o = c.candidate.observance;
      if (o.sanctoral_class === "national" || o.alternate_readings) local.set(c.name, (local.get(c.name) || 0) + 1);
      else bad.push(`${d} ${c.name}${c.suffix}`);
    }
    for (const c of m.passiveDays) {
      others.add(ctx.shortName(c.observance.name) + ctx.statusSuffix(c));
      // 주소로 가리켜도 기본 독서다
      if (id(model(d, { obs: id(c) }).selected) !== id(m.initial)) bad.push(`${d} ${id(c)}: 주소로 고를 수 있음`);
    }
    if (m.passiveDays.length) days++;
    for (const s of m.memorialSaints) {
      if (m.passiveDays.includes(s)) bad.push(`${d} ${id(s)}: 이름 줄에 두 번`);
    }
  }
  same(bad, []);
  // 늘면 정말 그날 고를 수 없어도 되는지 본다
  same([...others].sort(), ["라틴 문 앞의 사도 성 요한", "사도 성 베드로의 탈옥", "성 십자가 발견"]);
  assert.strictEqual(days, 17);
  // 2.11의 대체 독서도 기념만 하는 해(주일 2029, 2035, 2046, 설날 2032, 재의 수요일 2043)에 줄이 있다(사용자 결정 2026-11-07)
  same([...local].sort(), [["광복절", 4], ["병자를 위한 기도일", 5], ["삼일절", 5]]);
});

test("2.11 병자를 위한 기도일 — 2025-2050 모든 해, 기본 독서는 그날의 것이고 이 독서는 설정과 상관없이 「대체 독서」 줄로 고른다(사용자 결정 2026-11-07, ADR-038 §3)", { skip: SKIP }, () => {
  const OBS = "d0211-병자를-위한-기도일";
  let official = 0;
  for (let y = 2025; y <= 2050; y++) {
    const d = `${y}-02-11`;
    const m = model(d);
    assert.notStrictEqual(id(m.selected), OBS, d);   // 처음에는 그날의 기본 독서다
    same(m.colors, resolve(d).colors, d);
    same(m.textlessDays.map(id), [], d);
    for (const on of [true, false]) {
      const rows = model(d, NONE, null, on).choices.filter((c) => id(c.candidate) === OBS);
      same(rows.map((c) => c.name + c.suffix), ["병자를 위한 기도일 · 대체 독서"], `${d} ${on}`);
    }
    assert.ok(!m.passiveDays.some((c) => id(c) === OBS), d);   // 줄이 있으니 이름 줄에 두 번 보이지 않는다
    if (id(resolve(d).official) === OBS) official++;

    const p = model(d, { ...NONE, obs: OBS });
    assert.strictEqual(id(p.selected), OBS, d);
    assert.strictEqual(p.dayName, "병자를 위한 기도일", d);
    assert.strictEqual(p.selectedNote, "대체 독서", d);
    same(p.colors, ["violet"], d);   // 고르면 기도서의 자색이다(사용자 결정 2026-11-07)
    // 독서는 시편만 다른 두 세트이고, 본기도의 이름 자리는 줄바꿈 없는 공백이다
    same(p.options.map((o) => o.group.readings.map((r) => r.label).join(" / ")), [
      "열왕하 20:1-5 / 시편 13 / 야고 5:13-16 / 마르 2:1-12",
      "열왕하 20:1-5 / 시편 86:1-7 / 야고 5:13-16 / 마르 2:1-12",
    ], d);
    same(p.collects.length, 1, d);
    assert.match(p.collects[0].text, /구하오니, \(\u00a0+\)을\/를 돌아보시어/, d);
    assert.strictEqual(p.ending, "A", d);
    // 그날의 기본 독서로 돌아갈 줄이 늘 있다
    assert.ok(p.choices.some((c) => id(c.candidate) === id(m.selected)), d);
  }
  assert.strictEqual(official, 21);   // 등급은 축일 그대로다 — 기념만 하는 5해(위 시험)를 뺀 해에 그날의 대표다
  // 그날의 색은 자색으로 덮이지 않는다 — 처음 화면과 캘린더 칸은 그날의 전례일 색이다
  same(resolve("2028-02-11").colors, ["green"]);
  same(model("2028-02-11").colors, ["green"]);
});

test("주일에는 성인 본기도를 잇지 않는다 — 2025-2050 모든 주일, 평일에 밀려 기념만 하는 성인은 잇는다(사용자 확인 2026-11-04)", { skip: SKIP }, () => {
  let weekdays = 0;
  for (let d = "2025-01-01"; d <= "2050-12-31"; d = ctx.addDays(d, 1)) {
    const m = model(d);
    if (ctx.dayOfWeek(d) === 0) {
      // 관구 설립 본기도(9.29)는 성인의 본기도가 아니라 주일에도 잇는다(ADR-041 §6)
      same(m.memorialCollects.filter((c) => c.common !== "anniversary"), [], d);
    } else if (m.memorialSaints.some((c) => c.status === "commemorated")) {
      assert.ok(m.memorialCollects.length > 0, `${d} 평일 기념 성인의 본기도`);
      weekdays++;
    }
  }
  assert.ok(weekdays > 0, "평일에 밀려 기념만 하는 성인이 있는 날");
  // 7.26 주일의 안나와 요아킴은 이름 줄에만
  const anna = model("2026-07-26");
  same(anna.memorialSaints.map(id), ["d0726-안나와-요아킴"]);
  same(anna.memorialCollects, []);
});

test("A3 성지주일의 토마스 크랜머 — 이름 줄에만 보이고 본기도는 잇지 않는다, 성주간 평일에는 어느 줄에도 없다(사용자 결정 2026-11-07)", { skip: SKIP }, () => {
  for (const d of ["2027-03-21", "2032-03-21"]) {
    const m = model(d);
    same(id(m.selected), "t-성지주일", d);
    same(m.memorialSaints.map(id), ["d0321-토마스-크랜머"], d);
    same(m.memorialCollects, [], d);
    assert.ok(!m.choices.some((c) => id(c.candidate) === "d0321-토마스-크랜머"), `${d} 전례독서 목록에 없다`);
  }
  const weekday = model("2035-03-21");
  same(weekday.memorialSaints, []);
  assert.ok(!weekday.choices.some((c) => id(c.candidate) === "d0321-토마스-크랜머"));
  assert.ok(!weekday.passiveDays.some((c) => id(c) === "d0321-토마스-크랜머"));
});

test("A3 송가 — 즈가리야 송가는 영광송을 붙이고 창조송가(gloria:false)는 붙이지 않는다(실제 cant 장 JSON)", { skip: SKIP }, () => {
  const cant = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", `cant-${n}.json`), "utf8"));
  const slot = (n) => ({ slot: "psalm", bookId: "cant", refs: [{ chapter: n, verseSpec: "all" }], label: "" });
  assert.strictEqual(ctx.wantsGloria(slot(11), cant(11)), true);
  assert.strictEqual(ctx.wantsGloria(slot(12), cant(12)), true);
  assert.strictEqual(ctx.wantsGloria(slot(3), cant(3)), false);
  assert.strictEqual(ctx.canticleTitleOf(cant(11)), "즈가리야 송가");
});

test("A3 송가 라벨 — 어느 날이나 한 가지이고, 장 제목의 이름이 라벨 안에 있어 옆에 이름을 다시 붙이지 않는다(사용자 결정 2026-11-05)", { skip: SKIP }, () => {
  const rows = read("eucharist-readings.json").entries.flatMap((e) => e.readings);
  for (const [id, chapter, name, label, count] of [
    ["magnificat", 12, "성모송가", "루가 1:46하-55 (성모송가)", 10],
    ["benedictus", 11, "즈가리야 송가", "루가 1:68-79 (즈가리야 송가)", 2],
    ["ecce-deus", 4, "이사야 첫째 송가", "이사 12:2-6 (이사야 첫째 송가)", 2],
    ["te-deum", 2, "하느님 찬미송가", "하느님 찬미송가", 1],
  ]) {
    const mine = rows.filter((r) => r.canticle === id);
    assert.strictEqual(mine.length, count, id);
    assert.deepStrictEqual([...new Set(mine.map((r) => r.label))], [label], id);
    const title = ctx.canticleTitleOf(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", `cant-${chapter}.json`), "utf8")));
    assert.strictEqual(title, name, id);
    assert.ok(label.includes(title), id);
  }
});

// ── 전수 — 2025~2027 모든 날 ──

// 2026-10-12 처음 돌렸을 때 격자 평일 세 칸(사순 2주 화 · 수 · 부활 4주 토)에 독서 레코드가 없었다 —
// 원료 기사의 수집 태그 누락(pitfalls §18 의 재의 수요일 후 금요일과 같은 종류). data#30 이 채웠고 이 전수
// 검사가 그것을 지킨다 — 다시 빈 칸이 생기면 「독서 없음」으로 멈춘다.
// 격자(그날의 주일 · 평일) 후보의 독서 누락 — 초기 선택만 보면 공통 독서가 초기인 날(2026-06-27 키릴)의 빈 격자를 놓친다
// (자체 리뷰 2026-10-13 — 그렇게 찾은 연중 12주 토요일 짝수해는 사용자가 기사를 찾아 주어 data#31 이 채웠다). 성탄절기 평일은
// 날짜 본문(12.29~1.5)이 따로이고, 이동 축일(재의 수요일 · 성주간 · 부활 · 성령강림 · 왕이신 그리스도 …)이 있는 날은 그 이동 축일(temporal)
// 후보가 독서를 들고 있어 격자가 비는 것이 정상이다. 알려진 누락 표는 두지 않는다 — 빈 칸이 생기면 곧바로 멈춘다.
test("A3 2025~2027 모든 날 — 모델이 서고, 초기 선택에 복음까지 있는 독서가 있고, 전례독서 목록 href 가 그 전례독서 목록의 상태로 돌아오며, 격자 독서가 비지 않는다", { skip: SKIP }, () => {
  const bad = [];
  for (const y of [2025, 2026, 2027]) {
    let d = ctx.toKey(y, 1, 1);
    while (d.slice(0, 4) === String(y)) {
      const m = model(d);
      if (!m.group) bad.push(`${d} 독서 없음`);
      else if (!m.slots.some((s) => s.slot === "gospel")) bad.push(`${d} 복음 없음`);
      for (const c of m.choices) {   // 전례독서 목록 href → 그 날짜 · 그 후보(초기 선택이면 obs 없음)
        const u = new URL(c.href, "http://x");
        const obsParam = u.searchParams.get("obs");
        if (u.pathname !== `/lectionary/${d}` || (obsParam ? obsParam !== c.candidate.observance.id : c.candidate !== m.initial)) bad.push(`${d} 전례독서 목록 href ${c.href}`);
      }
      if (!m.choices.length) bad.push(`${d} 전례독서 목록 없음`);
      const grid = m.resolved.candidates.find((c) => c.observance.id.startsWith("grid:"));
      const co = m.resolved.coord;
      if (grid && co && co.season !== "christmas") {
        const key = `${co.season}-${co.week}-${co.weekday || co.type}-${co.year}`;
        const readsOf = (/** @type {any} */ c) => ctx.findReadingsIn(ix().lec, ix().cal, m.resolved, c).length > 0;
        const temporalOwns = m.resolved.candidates.some((c) => c !== grid && c.observance.kind === "temporal" && readsOf(c));
        if (!temporalOwns && !readsOf(grid)) bad.push(`${d} 격자 독서 없음(${key})`);
      }
      if (!m.choices.some((c) => c.active)) bad.push(`${d} 활성 전례독서 목록 없음`);
      if (!m.colors.length) bad.push(`${d} 색 없음`);
      if (m.empty) bad.push(`${d} empty`);   // 본기도까지 없는 날은 없다
      d = ctx.addDays(d, 1);
    }
  }
  same(bad, []);
});

test("A3 데이터 전수 — 괄호 선택 구절 세트는 모두 바탕에 합쳐지고, 「또는」 대안과 트랙이 한 전례일 키에 겹치지 않는다(pitfalls §21 실측의 지킴이 — 자체 리뷰 2026-10-13)", { skip: SKIP }, () => {
  const COORD = ["kind", "season", "week", "type", "weekday", "year", "date", "lunar", "name", "title"];
  /** @type {Map<string, any[]>} */
  const byCoord = new Map();
  for (const e of read("eucharist-readings.json").entries) {
    const k = JSON.stringify(COORD.map((f) => e[f] ?? null));
    if (!byCoord.has(k)) byCoord.set(k, []);
    byCoord.get(k).push(e);
  }
  const bad = [];
  let merged = 0;
  for (const [k, es] of byCoord) {
    const tracks = [...new Set(es.map((e) => e.reading_track ?? null))];
    for (const t of tracks) {
      const sets = es.filter((e) => (e.reading_track ?? null) === t).sort((a, b) => a.set_no - b.set_no);
      const opts = ctx.readingOptions(sets, "x");
      merged += opts.filter((o) => o.short).length;
      if (opts.some((o) => o.group.set_note === K("BRACKET_NOTE") && !o.short)) bad.push(`${k} 괄호 세트가 바탕을 못 찾음`);
      if (tracks.length > 1 && opts.length > 1) bad.push(`${k} 트랙 ${t} 에 「또는」 대안 ${opts.length}`);
    }
  }
  same(bad, []);
  assert.strictEqual(merged, 38);   // pitfalls §21 실측(2026-10-12), 기도서 표 대조로 넷 더함(2026-11-05) — 데이터가 바뀌면 여기서 다시 센다
});

// ── 반절 경계 표 ↔ 앱이 그리는 줄(사용자 결정 2026-10-22, 데이터 liturgical/half-verses.md) ──

test("반절 경계 표 — 전례독서 · 성인 공통의 반절 참조마다 행이 있고, 앱이 그리는 줄에서 그 절을 나눈다", { skip: SKIP }, () => {
  const table = read("half-verses.json").entries;
  const byKey = new Map(table.map((e) => [`${e.bookId}:${e.chapter}:${e.verse}${e.half}`, e]));
  /** @type {Set<string>} */
  const refs = new Set();
  const walk = (/** @type {any} */ x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    if (typeof x.bookId === "string" && Array.isArray(x.refs)) {
      for (const ref of x.refs) for (const tok of String(ref.verseSpec).split(",")) {
        const m = /^(\d+)([ab])$/.exec(tok.trim());
        if (m) refs.add(`${x.bookId}:${ref.chapter}:${m[1]}${m[2]}`);
      }
    }
    Object.values(x).forEach(walk);
  };
  for (const f of ["eucharist-readings.json", "commons.json"]) walk(read(f));
  same([...refs].filter((k) => !byKey.has(k)), [], "표에 없는 반절 참조 — 데이터 저장소 liturgical/half-verses.md 에 더한다");
  assert.strictEqual(refs.size, table.length, "쓰이지 않는 행");
  for (const e of table) {
    const k = `${e.bookId} ${e.chapter}:${e.verse}${e.half === "a" ? "상" : "하"}`;
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", `${e.bookId}-${e.chapter}.json`), "utf8"));
    const v = data.verses.find((x) => x.number === e.verse && !x.part && !x.lxx_only && x.chapter_ref == null && x.alt_ref == null && !x.versicle);
    assert.ok(v, k);
    // 인용 칩은 절의 마지막 줄 뒤에 붙는데, `trimHalfVerses`는 그 칩을 지우지 않는다(ADR-038 §3 「독서 렌더」, 2026-11-08).
    // 인용이 든 절을 반절로 자르게 되면 그 칩 처리를 먼저 더한다. 주석은 아래에서 따로 본다.
    assert.ok(!(v.segments || []).some((/** @type {any} */ s) => s.cite), `${k} — 인용이 든 절을 반절로 자르면 칩이 남는다`);
    // appendVerses 의 줄 — segments 를 줄바꿈으로 나누고 빈 줄(연 구분)은 빼며, 줄 머리의 ¶ 는 표지로 떼어 그린다
    const lines = (v.segments || [{ text: v.text || "" }]).flatMap((/** @type {any} */ s) => s.text.split("\n"))
      .filter((/** @type {string} */ l) => l !== "").map((/** @type {string} */ l) => l.replace(/^¶\s*/, ""));
    const keep = ctx.halfVerseLines(lines.length, e);
    if (e.whole) { assert.strictEqual(keep, null, k); continue; }
    assert.ok(keep, `${k} — 경계가 절을 나누지 않는다`);
    if (keep.text) assert.strictEqual(lines[keep.cut].split(keep.text).length, 2, `${k} — 「${keep.text}」가 ${keep.cut + 1}줄에 한 번 나와야 한다`);
    // 주석은 반절 자르기 앞에 감싼다(lectionary.js buildReading, 2026-11-08). 어절 없는 주석의 ※는 절 마지막 줄 끝에 붙어 상으로
    // 자르면 소리 없이 사라지고, 어절이 경계에 걸친 주석은 앱이 풀어 보통 글자로 둔다(cutLineText). 지금 데이터(창세 28:19상의
    // 「베델」은 남는 쪽)에는 둘 다 없다.
    for (const note of v.notes || []) {
      assert.ok((note.anchor || "").trim(), `${k} — 반절로 자르는 절에 어절 없는 주석(※)이 있다. 자른 절에서 ※를 어디에 둘지 먼저 정해 lectionary.js trimHalfVerses에 더한다`);
      // 그 어절의 n번째(anchor_occurrence, 기본 1) — citations.js _wrapAnchor 처럼 줄마다 앞에서부터 겹치지 않게 센다
      /** @type {{ line: number, start: number, end: number } | null} */
      let at = null;
      let seen = 0;
      lines.forEach((/** @type {string} */ l, /** @type {number} */ li) => {
        for (let i = l.indexOf(note.anchor); i >= 0 && !at; i = l.indexOf(note.anchor, i + note.anchor.length)) {
          if (++seen === (note.anchor_occurrence || 1)) at = { line: li, start: i, end: i + note.anchor.length };
        }
      });
      // 줄 경계로 자르면 어절은 남는 줄이나 버리는 줄에 통째로 있다. 줄 안의 경계만 어절을 나눌 수 있다.
      if (!at || keep.text === null || at.line !== keep.cut) continue;
      const p = lines[keep.cut].indexOf(keep.text);
      const b = e.half === "a" ? p + keep.text.length : p;
      assert.ok(at.end <= b || at.start >= b, `${k} — 주석 어절 「${note.anchor}」이 반절 경계에 걸친다. 앱은 그 주석을 풀어 보통 글자로 그린다. `
        + "데이터 저장소의 경계 문구(liturgical/half-verses.md)나 주석의 어절을 먼저 고친다");
    }
  }
});

// ── 아가의 화자 줄 ↔ 주석(코드 리뷰 2026-11-09, 구현하며 정함) ──
// 전례독서는 아가의 화자 줄(「(신부)」 「(신랑)」 「(합창단)」 「(신부와 신랑)」)을 지운다(lectionary.js dropReadingMarks, 사용자 결정 2026-11-08).
// 주석은 그보다 먼저 감싸므로, 화자 줄에 붙는 주석은 그 줄과 함께 사라진다. 어절 없는 주석의 ※는 절 마지막 줄 끝에 붙고, 어절 주석은
// 그 어절이 있는 줄에 붙는다. 그런 주석이 생기면 이 시험이 실패해 어디에 둘지 먼저 정하게 한다. 지금 아가에는 주석이 없다.

test("아가의 화자 줄 — 화자 줄에 붙는 주석(절 마지막 줄이 화자 줄인 절의 어절 없는 주석, 화자 줄 낱말의 어절 주석)이 없다", { skip: SKIP }, () => {
  const SPEAKER_LINE = /^\([^()]+\)$/;   // lectionary.js의 `SPEAKER_LINE`과 같다
  const dir = path.join(ROOT, "data", "bible");
  /** @type {string[]} */
  const bad = [];
  let speakerVerses = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^song-\d+\.json$/.test(x))) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const v of data.verses) {
      // `appendVerses`가 그리는 줄이다. `segments`를 줄바꿈으로 나누고 빈 줄(연 구분)은 빼며, 줄 머리의 ¶는 표지로 떼어 그린다
      const lines = (v.segments || [{ text: v.text || "" }]).flatMap((/** @type {any} */ s) => s.text.split("\n"))
        .filter((/** @type {string} */ l) => l !== "").map((/** @type {string} */ l) => l.replace(/^¶\s*/, "").trim());
      const speaker = lines.map((/** @type {string} */ l) => SPEAKER_LINE.test(l));
      if (!speaker.some(Boolean)) continue;
      speakerVerses++;
      for (const note of v.notes || []) {
        const k = `${f.replace(".json", "")}:${v.number}`;
        const anchor = (note.anchor || "").trim();
        if (!anchor) {
          if (speaker[speaker.length - 1]) bad.push(`${k} 어절 없는 주석의 ※가 화자 줄에 붙는다`);
          continue;
        }
        let seen = 0;
        lines.forEach((/** @type {string} */ l, /** @type {number} */ li) => {
          for (let i = l.indexOf(anchor); i >= 0; i = l.indexOf(anchor, i + anchor.length)) {
            if (++seen === (note.anchor_occurrence || 1) && speaker[li]) bad.push(`${k} 주석 어절 「${anchor}」이 화자 줄에 있다`);
          }
        });
      }
    }
  }
  assert.ok(speakerVerses > 0, "화자 줄이 있는 절을 찾지 못했다 — 데이터 형식이 바뀌었으면 이 시험의 줄 계산을 고친다");
  assert.deepStrictEqual(bad, [], "화자 줄과 함께 지워질 주석이다. lectionary.js dropReadingMarks에서 그 주석을 어디에 둘지 먼저 정한다");
});

test("기리는 성인의 본기도를 잇는 차례(MEMORIAL_CLASS_ORDER)는 commons.json 의 유형 정의 차례와 같다(사용자 결정 2026-11-03)", { skip: SKIP }, () => {
  const order = vm.runInContext("MEMORIAL_CLASS_ORDER", ctx);
  assert.deepStrictEqual([...order], Object.keys(read("commons.json").classes));
});

test("9.29 — 제목은 성 미가엘, 이름 줄은 「1992년 9월 29일 관구설립일」과 「대한성공회 선교 기념일」, 본기도는 미가엘 뒤에 관구 설립 본기도, 전례독서 목록에 설립 기념일 줄이 없다(사용자 결정 2026-11-05, 2026-11-07)", { skip: SKIP }, () => {
  for (const d of ["2027-09-29", "2030-09-29"]) {   // 수요일, 주일
    const m = model(d, NONE, null, false);
    assert.strictEqual(m.dayName, "성 미가엘과 모든 천사들", d);
    same(labels(m), ["성 미가엘과 모든 천사들"], d);   // 하나뿐이라 화면에 목록이 없다
    same([...m.foundingLines, ...m.textlessDays.map((c) => c.observance.name)],
      ["1992년 9월 29일 관구설립일", "대한성공회 선교 기념일"], d);
    same(m.textlessDays.map((c) => c.observance.rank), ["major_feast"], d);   // 등급은 주요축일C — 「기념일」은 이름이다
    assert.ok(m.collects[m.collectIndex].text.startsWith("영원히 살아계신 하느님, 천사와 인간들에게"), d);
    same(m.memorialCollects.map((c) => c.text), ["전능하신 하느님, 땅끝까지 이르러 복음을 전하라 명령하시고 이곳에 대한성공회 관구를 세우심을 감사하나이다. "
      + "구하오니, 주님께서 세우신 이 관구를 기억하시고 성령의 은총을 내리시어 모든 성직자와 신자들이 주님의 거룩하신 뜻을 받들어 살게 하시고, "
      + "마음과 힘을 다해 주님의 지상명령을 이루게 하소서."], d);
    same(plain(m.colors), ["white"], d);
  }
  same(model("2027-09-28").foundingLines, []);
});

test("축성일 줄 — 실제 본당 표에서 축성과 축복이 섞인 날은 두 줄, 같은 종류는 한 줄에 모으고, 북한 성당뿐인 날은 줄이 없다(사용자 결정 2026-11-04)", { skip: SKIP }, () => {
  same(model("2026-04-21").dedicationLines, ["강릉성당 축성일", "세종성당 축복일"]);
  same(model("2026-09-02").dedicationLines, ["일산성당, 초지성당, 행신성당 축성일"]);
  same(model("2026-10-13").dedicationLines, ["송강성당, 유성성당 축복일"]);
  same(model("2026-05-16").dedicationLines, []);   // 북.버드내성당 · 북.장림성당
  same(model("2026-01-31").dedicationLines, ["용인성당 축성일"]);
  // 어느 날이든 「북.」 성당은 줄에 없다
  for (let d = "2026-01-01"; d <= "2026-12-31"; d = ctx.addDays(d, 1)) {
    for (const line of model(d).dedicationLines) assert.ok(!line.includes("북."), `${d} ${line}`);
  }
});

// 도구는 이 파일과 같은 조합으로 뷰 모델을 읽는 별도 스크립트라, 모델의 값을 지워도 다른 시험이 알아채지 못한다. #473 에서
// `chips` 를 뺀 뒤 도구가 오류로 멈추고 있었다(2026-11-05 발견). 저녁 전례가 있는 12.24와 세트가 셋인 12.25를 실제로 실행해 본다.
test("책자 대조의 엔진 덤프(tools/booklet/engine-dump.mjs) — 지금 뷰 모델로 끝까지 돌고, compare.py 가 읽는 값을 낸다", { skip: SKIP }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-dump-"));
  try {
    const out = path.join(dir, "engine.json");
    execFileSync(process.execPath, [path.join(ROOT, "tools/booklet/engine-dump.mjs"), "2026-12-24", "2026-12-25", out], { cwd: ROOT, stdio: "pipe" });
    const days = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.deepStrictEqual(days.map((d) => d.date), ["2026-12-24", "2026-12-25"]);
    for (const d of days) {
      assert.ok(!d.error, d.date);
      assert.ok(d.view && typeof d.view.initial === "string", `${d.date} view.initial`);
      assert.ok(Array.isArray(d.view.choices), `${d.date} view.choices`);
      assert.ok(d.official && d.color && d.candidates.length, `${d.date} official · color · candidates`);
      for (const c of d.candidates) assert.ok(Array.isArray(d.groups[c.id]), `${d.date} groups[${c.id}]`);
    }
    assert.ok(days[0].candidates.some((c) => c.evening), "12.24의 성탄 밤은 저녁 후보다 — compare.py 가 12.25 세트를 찾을 때 쓴다");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("2032-02-11 재의 수요일이 설과 겹치면 다음날로 옮긴다 — 11일은 설날, 12일은 재의 수요일이고 평일을 고를 수 있다(사용자 결정 2026-11-05)", { skip: SKIP }, () => {
  const seollal = model("2032-02-11");
  assert.strictEqual(id(seollal.selected), "lunar11-설날");
  same(plain(seollal.transferNotes), ["재의 수요일을 2월 12일로 옮김"]);
  same(seollal.collects.map((c) => c.title), ["설날"]);
  assert.strictEqual(seollal.fast, "minor");
  const ash = model("2032-02-12");
  assert.strictEqual(id(ash.selected), "t-재의-수요일");
  assert.strictEqual(ash.selectedNote, "2월 11일에서 옮겨 옴");
  same(plain(ash.colors), ["violet"]);
  assert.strictEqual(ash.fast, "major");
  assert.strictEqual(ash.slots[0].label, "요엘 2:1-2, 12-17");
  assert.ok(labels(ash).includes("재의 수요일 후 목요일"), labels(ash).join());
});

test("1.2와 12.29 — 기도서 486쪽이 날짜로 고정한 평일 독서라 제목은 성탄 평일의 이름, 성인은 이름 줄, 본기도는 성탄 주간 뒤에 성인(사용자 결정 2026-11-05)", { skip: SKIP }, () => {
  for (const [d, saint, name, first, title] of [
    ["2027-01-02", "d0102-바실과-나지안조의-그레고리", "바실과 그레고리", "1요한 2:22-28", "성탄 1주 토요일"],
    ["2028-12-29", "d1229-토마스-베켓", "토마스 베켓", "1요한 2:3-11", "성탄 후 금요일"],
  ]) {
    const m = model(d);
    assert.ok(id(m.selected).startsWith("grid:christmas-x-weekday-"), d);
    assert.strictEqual(m.selected.observance.name, title, d);
    assert.strictEqual(m.slots[0].label, first, d);
    same(m.collects.map((c) => c.title), ["성탄주간", "성탄주간"], d);
    same(m.memorialSaints.map(id), [saint], d);
    same(m.memorialCollects.map((c) => plain(c.names).join("과 ")), [name], d);
    same(labels(m), [title], d);   // 후보가 하나뿐이라 화면에 전례독서 목록을 그리지 않는다
  }
  // 죄 없는 어린이들이 옮겨 오는 해에는 제목이 어린이들이고, 그날의 평일 독서를 목록에서 고른다
  const moved = model("2026-12-29");
  assert.strictEqual(id(moved.selected), "d1228-죄-없는-어린이들의-순교");
  assert.ok(labels(moved).includes("성탄 1주 화요일"), labels(moved).join());
  same(moved.memorialSaints.map(id), ["d1229-토마스-베켓"]);
});

test("A3 대체 독서 표시를 끄면 2025-2050년에 평일, 주일 줄 908개만 사라진다(사용자 결정 2026-11-06, ADR-041 §4)", { skip: SKIP }, () => {
  let majorRows = 0;
  let feastRows = 0;
  for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2050, 11, 31); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const on = model(d);
    const off = model(d, NONE, null, false);
    const shown = new Set(off.choices.map((c) => c.href));
    for (const row of on.choices) {
      if (shown.has(row.href)) continue;
      assert.ok(id(row.candidate).startsWith("grid:"), `${d} ${row.name} 격자가 아닌 줄이 사라졌다`);
      const { rank, sanctoral_class: cls } = on.initial.observance;
      if (rank === "principal" || rank === "major_feast") majorRows++;
      else {
        assert.strictEqual(rank, "minor_feast", `${d} ${on.dayName}`);
        assert.notStrictEqual(cls, "national", `${d} ${on.dayName}`);
        feastRows++;
      }
    }
    assert.strictEqual(off.dayName, on.dayName, d);   // 제목과 기본 독서는 그대로다
    assert.strictEqual(id(off.selected), id(on.selected), d);
  }
  assert.strictEqual(majorRows, 707);
  assert.strictEqual(feastRows, 201);
});

test("A3 옮겨 지킬 수 있는 축일이 평일에 온 날은 대체 독서 표시를 꺼도 평일 줄이 보이고 「축일 대체 독서」가 붙는다(사용자 결정 2026-11-06, ADR-041 §4)", { skip: SKIP }, () => {
  /** @type {Record<string, number>} */
  const perFeast = {};
  for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2050, 11, 31); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const off = model(d, NONE, null, false);
    const rows = off.choices.filter((c) => c.suffix.endsWith(" 대체 독서") && id(c.candidate).startsWith("grid:"));   // 2.11의 대체 독서 줄은 아래 시험이 본다
    if (!rows.length) continue;
    const on = model(d);
    same(labels(off), labels(on), d);   // 설정을 켜도 같은 줄, 같은 이름이다
    assert.strictEqual(rows.length, 1, d);
    const [row] = rows;
    assert.ok(id(row.candidate).startsWith("grid:"), `${d} ${row.name}`);
    assert.notStrictEqual(new Date(t).getUTCDay(), 0, `${d} 주일에 온 축일은 옮길 주일이 없다`);
    const feast = off.initial;
    perFeast[id(feast)] = (perFeast[id(feast)] || 0) + 1;
    // 줄을 누르면 같은 말이 제목 아래에 보이고, 목록의 축일 줄이 가리키는 주일에는 엔진이 같은 축일을 「옮겨 지킬 수 있음」 후보로 넣었다
    const pressed = model(d, { ...NONE, obs: id(row.candidate) }, null, false);
    assert.strictEqual(pressed.selectedNote, row.suffix.slice(" · ".length), d);
    const feastRow = pressed.choices.find((c) => id(c.candidate) === id(feast));
    const m = /(\d+)월 (\d+)일로 옮겨 지킬 수 있음$/.exec(feastRow ? feastRow.suffix : "");
    assert.ok(m || id(feast) === "d0202-주의-봉헌" && d === "2049-02-03", `${d} ${feastRow && feastRow.suffix}`);   // 2049-02-03 줄은 「옮겨 옴」만
    if (!m) continue;
    const sunday = `${d.slice(0, 4)}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    assert.ok(resolve(sunday).candidates.some((c) => c.status === "optional" && id(c) === id(feast)), `${d} → ${sunday}`);
  }
  same(perFeast, { "t-승천대축일": 26, "d0202-주의-봉헌": 22, "d0806-주의-변모": 23, "d1101-모든-성인의-날": 22 });
  // 줄과 문장의 실제 글 — 축일 줄(고른 줄이라 화면에서는 제목이다)에도 옮겨 지킬 수 있는 주일이 붙는다
  const presentation = model("2027-02-02", NONE, null, false);
  same(labels(presentation), ["주의 봉헌 · 1월 31일로 옮겨 지킬 수 있음", "연중 4주 화요일 · 주의 봉헌 축일 대체 독서"]);
  assert.strictEqual(presentation.selectedNote, "1월 31일로 옮겨 지킬 수 있음");
  assert.strictEqual(model("2027-02-02", { ...NONE, obs: "grid:ordinary-4-weekday-tue" }).selectedNote, "주의 봉헌 축일 대체 독서");
  same(labels(model("2026-05-14", NONE, null, false)), ["승천대축일 · 5월 17일로 옮겨 지킬 수 있음", "부활 6주 목요일 · 승천대축일 대체 독서"]);
  same(labels(model("2027-11-01", NONE, null, false)), ["모든 성인의 날 · 10월 31일로 옮겨 지킬 수 있음", "연중 31주 월요일 · 모든 성인의 날 대체 독서"]);
  // 설과 겹쳐 옮겨 온 해는 원래 날짜(2.2)로 주일을 구한다
  const moved = model("2049-02-03", NONE, null, false);
  same(labels(moved), ["주의 봉헌 · 2월 2일에서 옮겨 옴", "연중 4주 수요일 · 주의 봉헌 축일 대체 독서"]);   // 줄에는 하나만 — 둘을 이으면 폭 320px에서 두 줄을 넘는다
  assert.strictEqual(moved.selectedNote, "2월 2일에서 옮겨 옴 · 1월 31일로 옮겨 지킬 수 있음");
  // 주일에 온 해는 옮길 주일이 없어 그대로 숨기고 문장도 없다
  const sunday = model("2025-02-02", NONE, null, false);
  same(labels(sunday), ["주의 봉헌"]);
  assert.strictEqual(sunday.selectedNote, null);
  // 공현대축일(1.6)은 평일 독서가 없어 줄이 없지만, 옮겨 지킬 수 있는 주일은 알린다
  const epiphany = model("2026-01-06", NONE, null, false);
  same(labels(epiphany), ["공현대축일 · 1월 4일로 옮겨 지킬 수 있음"]);
  assert.strictEqual(epiphany.selectedNote, "1월 4일로 옮겨 지킬 수 있음");
});

test("A3 옮겨 지킬 수 있는 축일의 원래 날짜는 모두 옮겨 지킬 수 있는 주일을 알리고, 그 주일에는 엔진의 「옮겨 지킬 수 있음」 줄이 있다(사용자 결정 2026-11-06)", { skip: SKIP }, () => {
  /** @type {Record<string, number>} */
  const perFeast = {};
  // 양쪽 방향을 함께 본다 — 화면이 알린 (축일, 원래 날짜) → 주일과, 엔진이 주일에 넣은 `optional` 후보의 (축일, from) → 주일이 같다
  const announced = new Map();
  const engine = new Map();
  for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2050, 11, 31); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    for (const c of resolve(d).candidates) if (c.status === "optional") engine.set(`${id(c)}@${c.from}`, d);
    const m = model(d, NONE, null, false);
    const note = /(\d+)월 (\d+)일로 옮겨 지킬 수 있음$/.exec(m.selectedNote || "");
    if (!note) continue;
    const sunday = `${d.slice(0, 4)}-${note[1].padStart(2, "0")}-${note[2].padStart(2, "0")}`;
    assert.strictEqual(new Date(`${sunday}T00:00:00Z`).getUTCDay(), 0, `${d} → ${sunday}`);
    const opt = resolve(sunday).candidates.find((c) => c.status === "optional" && id(c) === id(m.initial));
    assert.ok(opt, `${d} → ${sunday}`);
    assert.strictEqual(opt.from, m.initial.status === "transferred_in" ? m.initial.from : d, d);
    announced.set(`${id(m.initial)}@${opt.from}`, sunday);
    perFeast[id(m.initial)] = (perFeast[id(m.initial)] || 0) + 1;
  }
  same(Object.fromEntries([...announced].sort()), Object.fromEntries([...engine].sort()));
  // 26년 × 다섯 축일에서 주일에 온 날을 뺀 것이다. 2049년 주의 봉헌은 설과 겹쳐 2.3에서 알린다.
  same(perFeast, { "d0106-공현대축일": 22, "t-승천대축일": 26, "d0202-주의-봉헌": 22, "d0806-주의-변모": 23, "d1101-모든-성인의-날": 22 });
});

test("A3 대체 독서 표시를 꺼도 사계재, 옮겨 지킬 수 있는 축일, 삼일절과 명절의 줄은 남는다(ADR-041 §4)", { skip: SKIP }, () => {
  const off = (d) => model(d, NONE, null, false).choices.filter((c) => !c.active).map((c) => c.name + c.suffix);
  same(off("2025-06-30"), []);                    // 옮겨 온 사도 성 베드로와 바울로
  same(off("2026-06-29"), []);                    // 제 날짜
  same(off("2026-12-08"), []);                    // 성모시태
  same(off("2025-09-08"), []);                    // 성모 탄신
  same(off("2026-11-02"), []);                    // 모든 별세자의 날
  same(off("2025-07-29"), []);                    // 성 마리아와 마르타
  same(off("2025-08-29"), []);                    // 성 세례 요한의 참수
  same(off("2040-09-22"), ["모든 신자의 성소를 위한 추계재"]);   // 옮겨 온 날의 사계재
  same(off("2025-06-11"), ["성직자의 성소를 위한 하계재"]);      // 제 날짜 주요축일의 사계재
  same(off("2026-01-04"), ["공현대축일 · 1월 6일에서 옮겨 지킬 수 있음"]);
  same(off("2026-08-06"), ["연중 18주 목요일 · 주의 변모 축일 대체 독서"]);   // 옮겨 지킬 수 있는 축일이 평일에 온 날
  same(off("2025-12-24"), ["성탄 밤 · 저녁"]);
  same(off("2025-11-16"), ["추수감사주일"]);
  same(off("2025-03-01"), ["연중 7주 토요일"]);    // 삼일절
  same(off("2025-01-29"), ["연중 3주 수요일"]);    // 명절(설날)
  same(off("2026-05-01"), ["노동자의 날"]);
});
