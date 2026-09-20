// ── tests/fixtures/liturgical/*.cases.json 의 형식·참조 검사 ──────────────────
// Run with: node --test tests/unit/liturgical-fixtures.test.js
//
// 픽스처는 실제 연도 기대값의 **정본**이다(설계서 §1.4 정본 지도 · 픽스처 README).
// 엔진이 값을 맞히는지는 PR 3 의 liturgical-engine.data.test.js 가 본다 — 여기서는
// 정본이 정본답게 생겼는지만 본다: JSON 이 읽히고, id 가 유일하고 규칙대로이며, 날짜가
// 실재하고, `displacedBy` 에 생략부호가 없고, status/kind 가 도메인 안이고, `canon`·
// `checks`·`issue` 가 가리키는 문서 앵커가 실제로 있고, (data/ 가 있으면) 관측일 id 가
// 실데이터에 있다. 전사 오류 — 가장 큰 위험 — 를 기계가 잡을 수 있는 만큼 잡는다.
//
// data/ 는 비공개 서브모듈이라 공개 CI 에는 없다 — id 실재 검사만 skip 가드를 단다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FIX = path.join(ROOT, "tests", "fixtures", "liturgical");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs/design/liturgical-engine.md"), "utf8");
const REVIEW = fs.readFileSync(path.join(ROOT, "docs/design/liturgical-engine-review.md"), "utf8");
const LECTIONARY = path.join(ROOT, "data", "lectionary");
const haveData = fs.existsSync(LECTIONARY);

const FILES = {
  "transfers.cases.json": ["transfer"],
  "optionals.cases.json": ["optional", "activation"],
  "winners.cases.json": ["winner"],
};
const PREFIX = { transfer: "T", optional: "O", activation: "A", winner: "W" };
const STATUS = new Set(["confirmed", "provisional", "skip"]);
const CANDIDATE_STATUS = new Set(["proper", "transferred_in", "transferred_out", "optional", "commemorated", "omitted"]);
const COLORS = new Set(["white", "red", "green", "violet", "rose", "blue"]);
const EXPECT_KEYS = new Set([
  "id", "status", "from", "to", "displacedBy", "absent", "notInDepartures", "neverDeparts",
  "official", "color", "colors", "observanceColor", "penitential", "fast", "coord", "grid",
  "readings", "officialReadings", "collects",
]);
const ID_RE = /^([TOAW])-(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const OBS_ID_RE = /^(d\d{4}-[^\s]+|t-[^\s]+|lunar\d+-[^\s]+|grid:[a-z0-9-]+|guard:[a-z0-9-]+)$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const all = Object.keys(FILES).map((f) => ({ file: f, kinds: FILES[f], data: load(f) }));
const cases = all.flatMap(({ file, data }) => data.cases.map((c) => ({ ...c, _file: file })));

/** 실재하는 날짜인가 — new Date 는 2026-02-30 을 3.2 로 넘겨 버린다 */
function validDate(s) {
  if (!ISO_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ── 파일 · 케이스 골격 ──

test("세 파일이 읽히고 _meta.kind 와 cases 배열을 가진다", () => {
  for (const { file, data } of all) {
    assert.ok(data._meta && typeof data._meta.kind === "string", `${file}: _meta.kind`);
    assert.ok(Array.isArray(data.cases) && data.cases.length > 0, `${file}: cases`);
  }
});

test("id 가 유일하고 규칙(접두-날짜-ascii-slug)대로이며 접두가 kind 와 맞고 날짜가 첫 단언의 날짜다", () => {
  const seen = new Map();
  for (const c of cases) {
    const m = ID_RE.exec(c.id);
    assert.ok(m, `${c._file}: id 형식 위반 — ${c.id}`);
    assert.ok(!seen.has(c.id), `id 중복: ${c.id} (${seen.get(c.id)} · ${c._file})`);
    seen.set(c.id, c._file);
    assert.ok(FILES[c._file].includes(c.kind), `${c.id}: kind ${c.kind} 는 ${c._file} 에 올 수 없다`);
    assert.equal(m[1], PREFIX[c.kind], `${c.id}: 접두 ${m[1]} ≠ kind ${c.kind}`);
    assert.ok(validDate(m[2]), `${c.id}: id 의 날짜가 실재하지 않는다`);
    const first = c.assertions[0];
    if (first.date) assert.equal(first.date, m[2], `${c.id}: id 날짜 ≠ 첫 단언 날짜 ${first.date}`);
  }
});

test("status/kind 도메인 · provisional 은 issue · skip 은 skip 이유 · activation 은 activated 를 가진다", () => {
  for (const c of cases) {
    assert.ok(STATUS.has(c.status), `${c.id}: status ${c.status}`);
    assert.ok(typeof c.title === "string" && c.title.length > 0, `${c.id}: title`);
    assert.ok(Array.isArray(c.canon) && c.canon.length > 0, `${c.id}: canon 비어 있음`);
    assert.ok(Array.isArray(c.source) && c.source.length > 0, `${c.id}: source 비어 있음`);
    if (c.status === "provisional") assert.match(c.issue ?? "", /^미결\d+$/, `${c.id}: provisional 인데 issue 없음`);
    if (c.status === "skip") assert.ok(typeof c.skip === "string" && c.skip.length > 0, `${c.id}: skip 인데 이유 없음`);
    if (c.kind === "activation") assert.ok(Array.isArray(c.activated) && c.activated.length > 0, `${c.id}: activated 없음`);
    else assert.equal(c.activated, undefined, `${c.id}: activation 이 아닌데 activated 가 있다`);
    if (c.alsoYears) assert.ok(c.alsoYears.every((y) => Number.isInteger(y) && y >= 1900 && y <= 2100), `${c.id}: alsoYears`);
    if (c.ifIssueFlips) {
      assert.match(c.ifIssueFlips.issue ?? "", /^미결\d+$/, `${c.id}: ifIssueFlips.issue`);
      assert.ok(c.ifIssueFlips.expect && typeof c.ifIssueFlips.expect === "object", `${c.id}: ifIssueFlips.expect`);
    }
  }
});

// ── 단언 ──

test("단언은 date 또는 years 를 가지며 expect 의 키·값이 도메인 안이고 displacedBy 에 생략부호가 없다", () => {
  for (const c of cases) {
    assert.ok(Array.isArray(c.assertions) && c.assertions.length > 0, `${c.id}: assertions`);
    for (const a of c.assertions) {
      const where = `${c.id} @ ${a.date ?? a.years}`;
      if (a.years) {
        assert.ok(Array.isArray(a.years) && a.years.length === 2 && a.years[0] <= a.years[1], `${where}: years`);
        assert.equal(a.date, undefined, `${where}: date 와 years 를 함께 쓸 수 없다`);
      } else assert.ok(validDate(a.date), `${where}: 날짜가 실재하지 않는다`);
      assert.ok(a.expect && typeof a.expect === "object", `${where}: expect`);
      const e = a.expect;
      for (const k of Object.keys(e)) assert.ok(EXPECT_KEYS.has(k), `${where}: 모르는 expect 키 ${k}`);
      if (e.id !== undefined) assert.match(e.id, OBS_ID_RE, `${where}: id 형식 — ${e.id}`);
      if (e.status !== undefined) assert.ok(CANDIDATE_STATUS.has(e.status), `${where}: status ${e.status}`);
      for (const k of ["from", "to"]) if (e[k] !== undefined) assert.ok(validDate(e[k]), `${where}: ${k} ${e[k]}`);
      if ("displacedBy" in e && e.displacedBy !== null) {
        assert.match(e.displacedBy, OBS_ID_RE, `${where}: displacedBy 형식 — ${e.displacedBy}`);
        assert.doesNotMatch(e.displacedBy, /[…\.]{2,}|\*/, `${where}: displacedBy 에 생략부호`);
      }
      if (e.official !== undefined) assert.ok(e.official === "grid:*" || OBS_ID_RE.test(e.official), `${where}: official ${e.official}`);
      if (e.color !== undefined) assert.ok(COLORS.has(e.color), `${where}: color ${e.color}`);
      if (e.colors !== undefined) assert.ok(e.colors.every((x) => COLORS.has(x)), `${where}: colors`);
      if (e.observanceColor !== undefined) assert.ok(COLORS.has(e.observanceColor), `${where}: observanceColor`);
      if (e.neverDeparts !== undefined) {
        assert.ok(a.years, `${where}: neverDeparts 는 years 단언에서만`);
        assert.match(e.neverDeparts, OBS_ID_RE, `${where}: neverDeparts id`);
      }
      if (e.absent || e.notInDepartures) assert.ok(e.id, `${where}: absent/notInDepartures 는 id 가 필요`);
      if (e.coord) assert.ok(Object.keys(e.coord).every((k) => ["season", "week", "type"].includes(k)), `${where}: coord 키`);
      if (e.grid) assert.ok(CANDIDATE_STATUS.has(e.grid.status), `${where}: grid.status`);
      for (const k of ["readings", "officialReadings"]) if (e[k]) {
        const ok = ["origin", "record", "common", "sets", "slots", "empty", "note", "cycle"];
        assert.ok(Object.keys(e[k]).every((x) => ok.includes(x)), `${where}: ${k} 키`);
        if (e[k].origin) assert.match(e[k].origin, /^\d{2}\.\d{2}$/, `${where}: ${k}.origin MM.DD`);
      }
      if (e.collects) assert.ok(Object.keys(e.collects).every((x) => ["origin", "count", "note"].includes(x)), `${where}: collects 키`);
    }
  }
});

// ── 문서 앵커 참조 ──

const R_DEFINED = new Set([...DESIGN.matchAll(/\*\*\[(R-\d+(?:\.\d+)?-[a-z0-9-]+)\]\*\*/g)].map((m) => m[1]));
const DESIGN_SECTIONS = new Set([...DESIGN.matchAll(/^#{2,4} (\d+(?:\.\d+)?)\.? /gm)].map((m) => m[1]));
const REVIEW_CHECKS = new Set([...REVIEW.matchAll(/\*\*((?:C-(?:P|\d+(?:\.\d+)?)|X|I)-\d+[a-z]?)\*\*/g)].map((m) => m[1]));
const ISSUES = new Set(
  [...DESIGN.slice(DESIGN.indexOf("\n## 9. ")).matchAll(/^(\d+)\. /gm)].map((m) => `미결${m[1]}`),
);

test("canon 은 설계서의 R- 마커 또는 실재하는 절(설계서 §x.y)을 가리킨다", () => {
  assert.ok(R_DEFINED.size >= 10, `설계서에 R- 마커가 너무 적다: ${R_DEFINED.size}`);
  for (const c of cases) for (const ref of c.canon) {
    if (ref.startsWith("R-")) assert.ok(R_DEFINED.has(ref), `${c.id}: 정본 마커 없음 — ${ref}`);
    else {
      const m = /^설계서 §(\d+(?:\.\d+)?)$/.exec(ref);
      assert.ok(m, `${c.id}: canon 형식 — ${ref} (R-… 또는 「설계서 §x.y」)`);
      assert.ok(DESIGN_SECTIONS.has(m[1]), `${c.id}: 설계서에 §${m[1]} 없음`);
    }
  }
});

test("checks 는 검토 문서의 C-/X-/I- 항목을, issue 는 설계서 §9 항목을 가리킨다", () => {
  assert.ok(REVIEW_CHECKS.size >= 100, `검토 문서 체크 항목이 너무 적다: ${REVIEW_CHECKS.size}`);
  assert.ok(ISSUES.size >= 33, `설계서 §9 항목이 너무 적다: ${ISSUES.size}`);
  for (const c of cases) {
    for (const ref of c.checks ?? []) assert.ok(REVIEW_CHECKS.has(ref), `${c.id}: 검토 문서에 ${ref} 없음`);
    if (c.issue) assert.ok(ISSUES.has(c.issue), `${c.id}: 설계서 §9 에 ${c.issue} 없음`);
    if (c.ifIssueFlips) assert.ok(ISSUES.has(c.ifIssueFlips.issue), `${c.id}: ifIssueFlips ${c.ifIssueFlips.issue} 없음`);
  }
});

// ── 실데이터 — 관측일 id 실재 ──

test("expect 의 관측일 id 가 data/lectionary 에 실재한다 (grid:/guard: 합성 id 제외)", { skip: haveData ? false :
  "data/ 서브모듈 미체크아웃 — 로컬과 engine-data.yml·sync-data.yml 에서 돈다" }, () => {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(LECTIONARY, f), "utf8")).entries;
  const known = new Set([...read("sanctoral.json"), ...read("temporal-feasts.json")].map((e) => e.id));
  const missing = new Set();
  const check = (id) => { if (id && !/^(grid|guard):/.test(id) && !known.has(id)) missing.add(id); };
  for (const c of cases) {
    for (const id of c.activated ?? []) check(id);
    for (const a of c.assertions) {
      const e = a.expect;
      check(e.id); check(e.neverDeparts);
      if (e.displacedBy) check(e.displacedBy);
      if (e.official && e.official !== "grid:*") check(e.official);
    }
  }
  assert.deepEqual([...missing].sort(), [], `실데이터에 없는 관측일 id:\n  ${[...missing].join("\n  ")}`);
});
