// ── tests/fixtures/liturgical/*.cases.json 의 형식·참조 검사 ──────────────────
// Run with: node --test tests/unit/liturgical-fixtures.test.js
//
// 픽스처는 실제 연도 기대값의 **정본**이다(설계서 §1.4 정본 지도 · 픽스처 README).
// 엔진이 값을 맞히는지는 PR 3 의 liturgical-engine.data.test.js 가 본다 — 여기서는
// 정본이 정본답게 생겼는지만 본다: JSON 이 읽히고, id 가 유일하고 규칙대로이며, 날짜가
// 실재하고, 관측일 id(`id`·`displacedBy`·`official`·`neverDeparts`)에 생략부호가 없고,
// status/kind 가 도메인 안이고(`ifIssueFlips.expect` 도 같은 검사를 받는다), `alsoYears` 의
// 해가 연도만 바꿔 되풀이할 수 있는 해(요일 동일)이고, `canon`·`checks`·`issue` 가 가리키는
// 문서 앵커가 실제로 있다. 전사 오류 — 가장 큰 위험 — 를 기계가 잡을 수 있는 만큼 잡는다.
//
// 관측일 id 가 실데이터에 실재하는지는 **liturgical-fixtures.data.test.js** 가 본다 — data/ 는
// 비공개 서브모듈이라 공개 CI 에 없고, 그 검사는 engine-data.yml·sync-data.yml 에서 돈다(CLAUDE.md 「테스트」).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkIds, issueNumbers, rMarkerDefs, sectionList } from "./docs-anchors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FIX = path.join(ROOT, "tests", "fixtures", "liturgical");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs/design/liturgical-engine.md"), "utf8");
const REVIEW = fs.readFileSync(path.join(ROOT, "docs/design/liturgical-engine-review.md"), "utf8");

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
// README 「단언」 표의 키 목록 그대로 — `cycle` 은 officialReadings 에만, `note` 는 어디에도 없다(단언 수준 note 로).
const READINGS_KEYS = ["origin", "record", "common", "sets", "slots", "empty"];
const OFFICIAL_READINGS_KEYS = [...READINGS_KEYS, "cycle"];
const ID_RE = /^([TOAW])-(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const OBS_ID_RE = /^(d\d{4}-[^\s]+|t-[^\s]+|lunar\d+-[^\s]+|grid:[a-z0-9-]+|guard:[a-z0-9-]+)$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const load = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const all = Object.keys(FILES).map((f) => ({ file: f, kinds: FILES[f], data: load(f) }));
// 골격이 깨진 파일은 첫 테스트가 지목해야 한다 — 모듈 로드에서 터지면 그 테스트가 돌지 못한다.
const cases = all.flatMap(({ file, data }) =>
  Array.isArray(data?.cases) ? data.cases.map((c) => ({ ...c, _file: file })) : []);

/** 실재하는 날짜인가 — new Date 는 2026-02-30 을 3.2 로 넘겨 버린다 */
function validDate(s) {
  if (!ISO_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const weekday = (y, m, d) => new Date(Date.UTC(y, m, d)).getUTCDay();

/** 자리표시자 — 홑 `…` 도 자리표시자다(`[…\.]{2,}` 만 보면 `t-…` 가 샌다). `grid:*` 는 호출 전에 거른다. */
const ELLIPSIS_RE = /…|\.{2,}|\*/;

/** `expect` 블록 하나의 키·값이 도메인 안인가. `ctx.years` 는 연도 범위 단언에서만 참.
 *  단언의 `expect` 와 `ifIssueFlips.expect` 가 **같은** 검사를 받는다 — 후자는 미결이
 *  반대로 닫히는 순간 `expect` 로 승격되는데, 그때는 아무도 다시 읽지 않는다. */
function assertExpect(e, where, ctx) {
  assert.ok(e && typeof e === "object" && !Array.isArray(e), `${where}: expect`);
  assert.ok(Object.keys(e).length > 0, `${where}: expect 가 비어 있다 — 아무것도 단언하지 않는 케이스는 정본이 아니다`);
  for (const k of Object.keys(e)) assert.ok(EXPECT_KEYS.has(k), `${where}: 모르는 expect 키 ${k}`);
  const assertId = (v, key) => {
    assert.match(v, OBS_ID_RE, `${where}: ${key} 형식 — ${v}`);
    assert.doesNotMatch(v, ELLIPSIS_RE, `${where}: ${key} 에 생략부호 — ${v}`);
  };
  if (e.id !== undefined) assertId(e.id, "id");
  if (e.status !== undefined) assert.ok(CANDIDATE_STATUS.has(e.status), `${where}: status ${e.status}`);
  for (const k of ["from", "to"]) if (e[k] !== undefined) assert.ok(validDate(e[k]), `${where}: ${k} ${e[k]}`);
  if ("displacedBy" in e && e.displacedBy !== null) assertId(e.displacedBy, "displacedBy");
  if (e.official !== undefined && e.official !== "grid:*") assertId(e.official, "official");
  if (e.color !== undefined) assert.ok(COLORS.has(e.color), `${where}: color ${e.color}`);
  if (e.colors !== undefined) assert.ok(Array.isArray(e.colors) && e.colors.every((x) => COLORS.has(x)), `${where}: colors`);
  if (e.observanceColor !== undefined) assert.ok(COLORS.has(e.observanceColor), `${where}: observanceColor`);
  if (e.neverDeparts !== undefined) {
    assert.ok(ctx.years, `${where}: neverDeparts 는 years 단언에서만`);
    assertId(e.neverDeparts, "neverDeparts");
  }
  if (e.absent || e.notInDepartures) assert.ok(e.id, `${where}: absent/notInDepartures 는 id 가 필요`);
  if (e.coord) assert.ok(Object.keys(e.coord).every((k) => ["season", "week", "type"].includes(k)), `${where}: coord 키`);
  if (e.grid) assert.ok(CANDIDATE_STATUS.has(e.grid.status), `${where}: grid.status`);
  for (const [k, ok] of [["readings", READINGS_KEYS], ["officialReadings", OFFICIAL_READINGS_KEYS]]) if (e[k]) {
    assert.ok(Object.keys(e[k]).every((x) => ok.includes(x)), `${where}: ${k} 키 — 허용 ${ok.join("·")}`);
    if (e[k].origin) assert.match(e[k].origin, /^\d{2}\.\d{2}$/, `${where}: ${k}.origin MM.DD`);
  }
  if (e.collects) assert.ok(Object.keys(e.collects).every((x) => ["origin", "count"].includes(x)), `${where}: collects 키`);
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
    const first = Array.isArray(c.assertions) ? c.assertions[0] : undefined;   // 단언 유무는 아래 「단언」 테스트가 판정한다
    if (first?.date) assert.equal(first.date, m[2], `${c.id}: id 날짜 ≠ 첫 단언 날짜 ${first.date}`);
  }
});

test("status/kind 도메인 · provisional·skip 은 issue · skip 은 skip 이유 · activation 은 activated 를 가진다", () => {
  for (const c of cases) {
    assert.ok(STATUS.has(c.status), `${c.id}: status ${c.status}`);
    assert.ok(typeof c.title === "string" && c.title.length > 0, `${c.id}: title`);
    assert.ok(Array.isArray(c.canon) && c.canon.length > 0, `${c.id}: canon 비어 있음`);
    assert.ok(Array.isArray(c.source) && c.source.length > 0, `${c.id}: source 비어 있음`);
    // README: `issue` 는 provisional·skip 이면 필수 — 무엇이 닫혀야 케이스가 확정·재개되는지 묶어 둔다.
    if (c.status !== "confirmed") assert.match(c.issue ?? "", /^미결\d+$/, `${c.id}: ${c.status} 인데 issue 없음`);
    if (c.status === "skip") assert.ok(typeof c.skip === "string" && c.skip.length > 0, `${c.id}: skip 인데 이유 없음`);
    if (c.kind === "activation") assert.ok(Array.isArray(c.activated) && c.activated.length > 0, `${c.id}: activated 없음`);
    else assert.equal(c.activated, undefined, `${c.id}: activation 이 아닌데 activated 가 있다`);
    if (c.alsoYears) assert.ok(Array.isArray(c.alsoYears) && c.alsoYears.every((y) => Number.isInteger(y) && y >= 1900 && y <= 2100), `${c.id}: alsoYears`);
    if (c.ifIssueFlips) {
      assert.match(c.ifIssueFlips.issue ?? "", /^미결\d+$/, `${c.id}: ifIssueFlips.issue`);
      assertExpect(c.ifIssueFlips.expect, `${c.id} @ ifIssueFlips`, { years: false });
    }
  }
});

// ── 단언 ──

test("단언은 date 또는 years 를 가지며 expect 의 키·값이 도메인 안이고 관측일 id 에 생략부호가 없다", () => {
  for (const c of cases) {
    assert.ok(Array.isArray(c.assertions) && c.assertions.length > 0, `${c.id}: assertions`);
    for (const a of c.assertions) {
      const where = `${c.id} @ ${a.date ?? a.years}`;
      if (a.years) {
        assert.ok(Array.isArray(a.years) && a.years.length === 2 && a.years[0] <= a.years[1], `${where}: years`);
        assert.equal(a.date, undefined, `${where}: date 와 years 를 함께 쓸 수 없다`);
      } else assert.ok(validDate(a.date), `${where}: 날짜가 실재하지 않는다`);
      // 단언의 `note` 는 **서술 전용** — 비교 대상이 아니다(픽스처 README 「단언」).
      if (a.note !== undefined) assert.ok(typeof a.note === "string" && a.note.length > 0, `${where}: note 가 비어 있다`);
      assertExpect(a.expect, where, { years: !!a.years });
    }
  }
});

test("alsoYears 의 해는 날짜 단언을 연도만 바꿔 되풀이할 수 있다 — 같은 월·일이 실재하고 요일이 같다", () => {
  // README: 「단언은 첫 연도만 — 소비자가 연도만 바꿔 되풀이해도 된다」. 주일·목요일 같은 요일 조건이
  // 케이스의 전제이므로 요일이 다르면 그 해는 같은 모양이 아니다(주님의 세례 2026-01-11 → 2027 은 1.10).
  for (const c of cases) for (const y of c.alsoYears ?? []) for (const a of c.assertions ?? []) {
    if (!a.date) continue;
    const [y0, m, d] = a.date.split("-").map(Number);
    const swapped = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    assert.ok(validDate(swapped), `${c.id}: ${a.date} 를 ${y} 로 바꾸면 실재하지 않는 날짜 ${swapped}`);
    assert.equal(weekday(y, m - 1, d), weekday(y0, m - 1, d),
      `${c.id}: ${a.date} 를 ${y} 로 바꾸면 요일이 다르다 — alsoYears 에서 빼고 그 해의 단언을 따로 적을 것`);
  }
});

// ── 문서 앵커 참조 ──

// 추출 문법은 docs-anchors.js 가 정본이다 — docs-crossref.test.js 와 사본을 두지 않는다.
// (특히 §9 는 **다음 `## ` 헤딩에서 끊는다** — 「절은 말미 추가만」이라 뒤에 §10 이 붙으면
//  경계 없는 슬라이스는 그 안의 번호 목록까지 미결로 센다.)
const R_DEFINED = new Set(rMarkerDefs({ 설계서: DESIGN }).keys());
const DESIGN_SECTIONS = new Set(sectionList(DESIGN));
const REVIEW_CHECKS = checkIds(REVIEW);
const ISSUE_LIST = issueNumbers(DESIGN, "\n## 9. ") ?? [];
const ISSUES = new Set(ISSUE_LIST.map((n) => `미결${n}`));

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
  assert.ok(ISSUE_LIST.length >= 33, `설계서 §9 항목이 너무 적다: ${ISSUE_LIST.length}`);   // 번호 유일성은 docs-crossref 가 본다
  for (const c of cases) {
    for (const ref of c.checks ?? []) assert.ok(REVIEW_CHECKS.has(ref), `${c.id}: 검토 문서에 ${ref} 없음`);
    if (c.issue) assert.ok(ISSUES.has(c.issue), `${c.id}: 설계서 §9 에 ${c.issue} 없음`);
    if (c.ifIssueFlips) assert.ok(ISSUES.has(c.ifIssueFlips.issue), `${c.id}: ifIssueFlips ${c.ifIssueFlips.issue} 없음`);
  }
});
