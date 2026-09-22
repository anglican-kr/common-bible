// ── 픽스처 관측일 id ↔ data/lectionary 실재 — data/ 서브모듈이 있어야 돈다 ────────
// Run with: node --test tests/unit/liturgical-fixtures.data.test.js
//
// tests/fixtures/liturgical/*.cases.json 의 `expect.id` · `displacedBy` · `official` · `neverDeparts` ·
// `activated`(+ `ifIssueFlips.expect`)가 sanctoral.json · temporal-feasts.json 의 id 로 실재하는지 본다 —
// 전사 오류(`d0325-성모수태고지` 를 `d0325-성모-수태고지` 로 적는 류)를 잡는 **유일한 기계 검사**다.
// 형식 검사(liturgical-fixtures.test.js)는 `d\d{4}-…` 모양만 보므로 오타를 통과시킨다.
//
// **공개 저장소의 필수 `Unit tests` 잡에서는 돌지 않는다.** 그 잡은 actions/checkout 을 서브모듈 없이
// 돌려 `data/` 가 없다(설계서 §7 · CLAUDE.md 「테스트」 예외 ①). 서브모듈을 받는 자리는 둘이다 —
// 엔진 전용 engine-data.yml(머지 직후 main push · workflow_dispatch — `tests/fixtures/liturgical/**` 도
// 트리거 경로다)과 데이터 동기화 sync-data.yml — 이 파일은 **양쪽에** 등록돼 돈다.
// 픽스처 로더는 liturgical-fixtures.test.js 와 같은 열 줄을 갖는다(각 테스트 파일이 자기 안에
// extractBlock 을 갖는 ADR-013 관례 — liturgical-engine.data.test.js 도 그렇다).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FIX = path.join(ROOT, "tests", "fixtures", "liturgical");
const LECTIONARY = path.join(ROOT, "data", "lectionary");
// 체크아웃 여부만 본다 — 개별 파일의 존재로 판별하면 그 파일이 지워진 데이터 커밋에서
// 검증이 조용히 skip 된다(docs-data-consistency.test.js 와 같은 이유).
const haveData = fs.existsSync(LECTIONARY);
const SKIP = haveData ? false : "data/ 서브모듈 미체크아웃 — 로컬과 engine-data.yml·sync-data.yml 에서 돈다";

const FILES = ["transfers.cases.json", "optionals.cases.json", "winners.cases.json"];
const cases = FILES.flatMap((f) => {
  const data = JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
  return Array.isArray(data?.cases) ? data.cases.map((c) => ({ ...c, _file: f })) : [];
});

/** 그 `expect` 가 가리키는 실데이터 관측일 id 전부(`grid:*` 와 합성 id 는 호출자가 거른다). */
const observanceIds = (e) => [e?.id, e?.neverDeparts, e?.displacedBy, e?.official !== "grid:*" ? e?.official : null];

test("픽스처가 케이스를 하나 이상 싣는다(로더 자체 검사)", () => {
  assert.ok(cases.length > 0, "픽스처 케이스가 없다 — 파일이 옮겨졌으면 FILES 를 고칠 것");
});

test("expect 의 관측일 id 가 data/lectionary 에 실재한다 (grid:/guard: 합성 id 제외)", { skip: SKIP }, () => {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(LECTIONARY, f), "utf8")).entries;
  const known = new Set([...read("sanctoral.json"), ...read("temporal-feasts.json")].map((e) => e.id));
  assert.ok(known.size > 100, `실데이터 관측일이 너무 적다: ${known.size}`);
  const missing = new Set();
  const check = (id) => { if (id && !/^(grid|guard):/.test(id) && !known.has(id)) missing.add(id); };
  for (const c of cases) {
    for (const id of c.activated ?? []) check(id);
    for (const a of c.assertions ?? []) for (const id of observanceIds(a.expect)) check(id);
    if (c.ifIssueFlips) for (const id of observanceIds(c.ifIssueFlips.expect)) check(id);
  }
  assert.deepEqual([...missing].sort(), [], `실데이터에 없는 관측일 id:\n  ${[...missing].join("\n  ")}`);
});
