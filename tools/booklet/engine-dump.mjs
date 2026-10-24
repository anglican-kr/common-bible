// 엔진 + 뷰 모델을 실데이터(data/ 서브모듈) 위에서 돌려 날짜별로 덤프한다 — lectionary.data.test.js 의 로더와 같은 조합.
// 사용: node tools/booklet/engine-dump.mjs <from YYYY-MM-DD> <to YYYY-MM-DD> <out.json>   (저장소 루트에서)
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [from, to, out] = process.argv.slice(2);
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
function extractBlock(name, source) {
  const begin = `// ── BEGIN ${name} ──`, end = `// ── END ${name} ──`;
  const s = source.indexOf(begin), e = source.indexOf(end);
  if (s < 0 || e < 0) throw new Error(`marker block ${name} not found`);
  return source.slice(s, e + end.length);
}
const ENGINE = src("js/app/liturgical-engine.js"), VS = src("js/app/verse-spec.js");
const ctx = { Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error, parseInt, isNaN, Date, NaN, URLSearchParams };
vm.createContext(ctx);
vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map(); const activatedOptionals = new Set();", ctx);
vm.runInContext(extractBlock("LITURGICAL_CORE", ENGINE), ctx, { filename: "engine-core" });
// 인자를 엔진의 parseDate(YYYY-MM-DD 엄격 · 없는 날짜 거부)로 검사한다 — 아래 루프는 날짜를 문자열로 비교하므로 「2027-1-31」 은
// 9월 30일까지 돌고 뒤바뀐 범위는 0일을 낸다(둘 다 오류 없이).
if (!ctx.parseDate(from) || !ctx.parseDate(to) || from > to || !out) {
  console.error("사용: node tools/booklet/engine-dump.mjs <from YYYY-MM-DD> <to YYYY-MM-DD> <out.json>   (from ≤ to, 저장소 루트에서)");
  process.exit(1);
}
// 전례독서 뷰(ADR-038 A3)가 있으면 뷰 모델(초기 선택 · 세트 라벨)도 덤프한다 — 없으면(#346 이전 체크아웃) view: null 이고
// compare.py 는 지정 전례일(official)로 비교한다. 뷰의 초기 선택과 달라 집계가 크게 바뀌므로 소리 내어 알린다.
const LECT = fs.existsSync(path.join(ROOT, "js/app/lectionary.js")) ? src("js/app/lectionary.js") : null;
if (!LECT) console.warn("경고: js/app/lectionary.js 가 없다 — view: null 로 덤프한다. compare.py 는 지정 전례일(official)로 비교하므로 뷰의 초기 선택 대조가 아니다(tools/booklet/README.md).");
vm.runInContext(extractBlock("LITURGICAL_LOOKUP", ENGINE), ctx, { filename: "engine-lookup" });
vm.runInContext(extractBlock("VERSE_SPEC", VS), ctx, { filename: "verse-spec" });
if (LECT) vm.runInContext(extractBlock("LECTIONARY_MODEL", LECT), ctx, { filename: "lectionary-model" });
const read = (p) => JSON.parse(src(path.join("data/lectionary", p)));
const cal = ctx.buildCalendarIndex({ sanctoral: read("sanctoral.json"), temporal: read("temporal-feasts.json"), periods: read("periods.json"), ordinalWeeks: read("ordinal-weeks.json"), kasi: read("kasi-lunar.json") });
const lec = ctx.buildLectionaryIndex({ readings: read("eucharist-readings.json"), collects: read("eucharist-collects.json"), commons: read("commons.json"), canticles: read("canticles.json") });
const plain = (v) => JSON.parse(JSON.stringify(v));
const NONE = { obs: null, track: null, set: null, collect: null };
const slotsOf = (g) => { const o = {}; for (const s of (g && g.readings) || []) if (s) o[s.slot] = s.label; return o; };
// 이름은 name + aliases(엔진 namesOfRow) — compare.py 가 책자의 「고난주일」 · 「승천일」 을 별칭으로 맞춘다
const cand = (c) => ({ id: c.observance.id, name: c.observance.name, aliases: c.observance.aliases || null, status: c.status, from: c.from || null, to: c.to || null,
  displacedBy: c.displacedBy || null, color: c.observance.color || null, colorAlt: c.observance.color_alt || null,
  precedence: c.observance.precedence ?? null, rank: c.observance.rank || null, kind: c.observance.kind || null, date: c.observance.date || null,
  // 저녁 전례(앱 설계서 R-6.1-evening — 12.24 의 성탄 밤 · 성 토요일의 부활밤)는 그날 낮의 후보가 아니다 — compare.py 가 가른다
  evening: c.evening === true });
const result = [];
for (let d = from; d <= to; d = ctx.addDays(d, 1)) {
  const r = ctx.resolveDateIn(cal, d, ctx.transfersOf(cal, Number(d.slice(0, 4))));
  if (!r) { result.push({ date: d, error: "unresolved" }); continue; }
  const cache = new Map();
  const groupsOf = (c) => { if (!cache.has(c.observance.id)) cache.set(c.observance.id, ctx.findReadingsIn(lec, cal, r, c)); return cache.get(c.observance.id); };
  const m = LECT ? ctx.buildLectionaryModel(r, NONE, groupsOf, ctx.findCollectsIn(lec, cal, r), null) : null;
  const groups = {};
  for (const c of r.candidates) groups[c.observance.id] = (groupsOf(c) || []).map((g) => ({ id: g.id || null, track: g.reading_track ?? null, set: g.set_no ?? null, total: g.set_total ?? null, note: g.set_note || null, common: g.common || null, title: g.title || null, slots: slotsOf(g) }));
  result.push(plain({
    date: d, weekday: ctx.dayOfWeek ? ctx.dayOfWeek(d) : null, coord: r.coord || null,
    official: r.official ? cand(r.official) : null, color: r.color, colors: r.colors, colorAlt: r.colorAlt, fast: m ? m.fast : null,
    candidates: r.candidates.map(cand), groups,
    view: m ? { initial: m.initial.observance.id, selected: m.selected.observance.id, track: m.track, tracks: m.tracks, cycle: m.cycle,
      colors: m.colors, colorAlt: m.colorAlt, ownColor: m.ownColor, empty: m.empty,
      options: m.options.map((o) => ({ label: o.label, slots: slotsOf(o.group), short: o.short ? slotsOf(o.short) : null })),
      chips: m.chips.map((c) => ({ id: c.candidate.observance.id, label: c.label, muted: c.muted })),
      pair: m.pair ? { a: m.pair.a.observance.id, aText: m.pair.aText, b: m.pair.b.observance.id, bText: m.pair.bText } : null } : null,
  }));
}
fs.writeFileSync(out, JSON.stringify(result, null, 0));
console.log("dumped", result.length, "dates", result.filter((x) => x.error).length, "errors");
