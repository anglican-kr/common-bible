// ── 설계서의 실측 수치가 data/ 서브모듈과 맞는지 검증 ──────────────────────────
// docs/design/liturgical-engine.md §5.2 의 ```facts 블록이 문서 쪽 「현재 실측」의
// 단일 정본이다. 같은 수치가 ADR·설계서·status 에 흩어져 서로 어긋나던 것이
// 2026-08-29 정합성 점검의 주된 원인이었다 — 정본을 한 곳에 두고 여기서 데이터와
// 기계적으로 견준다.
//
// data/ 는 비공개 서브모듈이라 공개 저장소의 Unit tests 잡에는 체크아웃되지 않는다.
// 없으면 **건너뛴다**(조용히 통과시키지 않고 이유를 남긴다). 서브모듈이 실제로 있는
// 자리는 로컬 개발과 sync-data.yml — 데이터 포인터가 올라가 문서가 낡는 바로 그
// 순간에 이 테스트가 돈다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LECTIONARY = path.join(ROOT, "data", "lectionary");
const DESIGN = path.join(ROOT, "docs", "design", "liturgical-engine.md");

const haveData = fs.existsSync(path.join(LECTIONARY, "eucharist-collects.json"));
const load = (f) => JSON.parse(fs.readFileSync(path.join(LECTIONARY, f), "utf8"));
const count = (arr, pred) => arr.reduce((n, e) => n + (pred(e) ? 1 : 0), 0);

/** 설계서 §5.2 의 ```facts 블록 → {키: 수} */
function parseClaims() {
  const md = fs.readFileSync(DESIGN, "utf8");
  const m = md.match(/```facts\n([\s\S]*?)```/);
  assert.ok(m, "설계서에 ```facts 블록이 없다 — 옮겼거나 지웠으면 이 테스트도 함께 고칠 것");
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^\s*([\w.]+)\s*=\s*(\d+)\s*$/);
    if (kv) out[kv[1]] = Number(kv[2]);
    else assert.equal(line.trim(), "", `facts 블록에 읽을 수 없는 줄: ${line}`);
  }
  return out;
}

/** data/lectionary/ → 같은 키의 실제 값 */
function measure() {
  const c = load("eucharist-collects.json").entries;
  const r = load("eucharist-readings.json").entries;
  const s = load("sanctoral.json").entries;
  const t = load("temporal-feasts.json");
  const cm = load("commons.json");
  const ow = load("ordinal-weeks.json");
  const slot = (name) =>
    r.reduce((n, e) => n + count(e.readings, (d) => d.slot === name), 0);
  const ruleKind = (k) => count(t.entries, (e) => e.rule && e.rule.kind === k);

  return {
    "collects.total": c.length,
    "collects.id.max": Math.max(...c.map((e) => e.id)),
    "collects.ending.A": count(c, (e) => e.ending === "A"),
    "collects.ending.B": count(c, (e) => e.ending === "B"),
    "collects.ending.C": count(c, (e) => e.ending === "C"),
    "collects.review": count(c, (e) => e._review),
    "collects.note": count(c, (e) => e._note),
    "collects.rank_null": count(c, (e) => e.rank === null),
    "collects.color_null": count(c, (e) => e.color === null),
    "collects.collect_total_gt1": count(c, (e) => e.collect_total > 1),
    "readings.total": r.length,
    "readings.set_no.1": count(r, (e) => e.set_no === 1),
    "readings.set_no.2": count(r, (e) => e.set_no === 2),
    "readings.set_no.3": count(r, (e) => e.set_no === 3),
    "readings.set_total_gt1": count(r, (e) => (e.set_total ?? 1) > 1),
    "readings.slot.first": slot("first"),
    "readings.slot.psalm": slot("psalm"),
    "readings.slot.second": slot("second"),
    "readings.slot.gospel": slot("gospel"),
    "readings.reading_track_nonnull": count(r, (e) => e.reading_track != null),
    "readings.weekday_null": count(r, (e) => e.weekday == null),
    "sanctoral.total": s.length,
    "sanctoral.has_proper": count(s, (e) => e.has_proper),
    "sanctoral.commemoration": count(s, (e) => e.rank === "commemoration"),
    "sanctoral.minor_feast": count(s, (e) => e.rank === "minor_feast"),
    "temporal.total": t.entries.length,
    "temporal.rule_kinds": t._meta.rule_kinds.length,
    "temporal.easter_offset": ruleKind("easter_offset"),
    "temporal.ember_wfs": ruleKind("ember_wfs"),
    "temporal.rule_null": count(t.entries, (e) => !e.rule),
    "commons.classes": Object.keys(cm.classes).length,
    "commons.reading_sets": cm._meta.reading_sets,
    "ordinal_weeks.weeks": ow.weeks.length,
    "ordinal_weeks.windows": ow.weeks.reduce((n, w) => n + w.windows.length, 0),
  };
}

test("설계서 facts 블록이 형식을 지킨다", () => {
  const claims = parseClaims();
  assert.ok(Object.keys(claims).length >= 30, "facts 블록이 너무 적다 — 지워졌는지 확인");
});

test("설계서 facts 블록이 data/lectionary 와 일치한다", { skip: haveData ? false :
  "data/ 서브모듈 미체크아웃 — 로컬과 sync-data.yml 에서 돈다" }, () => {
  const claims = parseClaims();
  const actual = measure();

  // 문서가 데이터에 없는 키를 주장하면 그것도 결함이다 — 조용히 넘기지 않는다.
  const unknown = Object.keys(claims).filter((k) => !(k in actual));
  assert.deepEqual(unknown, [], `facts 블록에 측정 방법이 없는 키: ${unknown}`);

  const wrong = Object.entries(claims)
    .filter(([k, v]) => actual[k] !== v)
    .map(([k, v]) => `${k}: 문서 ${v} ≠ 실제 ${actual[k]}`);
  assert.deepEqual(
    wrong, [],
    `설계서 §5.2 facts 블록이 데이터와 어긋난다 — 데이터가 바뀌었으면 블록을 갱신하고,\n` +
      `같은 수치를 되풀이하는 산문(§5.2·§5.6·§2 결손 표)도 함께 보라:\n  ${wrong.join("\n  ")}`,
  );
});
