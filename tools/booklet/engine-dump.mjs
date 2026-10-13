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
// 전례독서 뷰(ADR-038 A3)가 있으면 뷰 모델(초기 선택 · 세트 라벨)도 덤프한다 — 없으면 view: null
const LECT = fs.existsSync(path.join(ROOT, "js/app/lectionary.js")) ? src("js/app/lectionary.js") : null;
const ctx = { Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error, parseInt, isNaN, Date, NaN, URLSearchParams };
vm.createContext(ctx);
vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map(); const activatedOptionals = new Set();", ctx);
vm.runInContext(extractBlock("LITURGICAL_CORE", ENGINE), ctx, { filename: "engine-core" });
vm.runInContext(extractBlock("LITURGICAL_LOOKUP", ENGINE), ctx, { filename: "engine-lookup" });
vm.runInContext(extractBlock("VERSE_SPEC", VS), ctx, { filename: "verse-spec" });
if (LECT) vm.runInContext(extractBlock("LECTIONARY_MODEL", LECT), ctx, { filename: "lectionary-model" });
const read = (p) => JSON.parse(src(path.join("data/lectionary", p)));
const cal = ctx.buildCalendarIndex({ sanctoral: read("sanctoral.json"), temporal: read("temporal-feasts.json"), periods: read("periods.json"), ordinalWeeks: read("ordinal-weeks.json"), kasi: read("kasi-lunar.json") });
const lec = ctx.buildLectionaryIndex({ readings: read("eucharist-readings.json"), collects: read("eucharist-collects.json"), commons: read("commons.json"), canticles: read("canticles.json") });
const plain = (v) => JSON.parse(JSON.stringify(v));
const NONE = { obs: null, track: null, set: null, collect: null };
const slotsOf = (g) => { const o = {}; for (const s of (g && g.readings) || []) if (s) o[s.slot] = s.label; return o; };
const cand = (c) => ({ id: c.observance.id, name: c.observance.name, status: c.status, from: c.from || null, to: c.to || null,
  displacedBy: c.displacedBy || null, color: c.observance.color || null, colorAlt: c.observance.color_alt || null,
  precedence: c.observance.precedence ?? null, rank: c.observance.rank || null, kind: c.observance.kind || null, date: c.observance.date || null });
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
