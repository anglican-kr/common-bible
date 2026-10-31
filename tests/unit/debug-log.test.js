// ── debug-log.js unit tests ─────────────────────────────────────────────────
// Run with: node --test tests/unit/debug-log.test.js
//
// The copied 「동기화 진단 정보」 is dump()'s text. Fields the sync machine logs to explain a stopped cycle
// or a failed 「파일도 삭제」 must show up there — `at`, `ok`, and a status of 0 (network error) were
// dropped by _format, so the copy said where nothing stopped and why nothing failed (code review 15).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { stripEsmMarker } from "./harness.js";

const SOURCE = stripEsmMarker(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../js/sync/debug-log.js"), "utf8"));

function loadDebugLog() {
  const ctx = { console, Date, Math, JSON, String, Number, Object, Array, location: { hostname: "bible.anglican.kr" } };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(SOURCE, ctx, { filename: "debug-log.js" });
  return ctx.syncDebugLog;
}

test("1. dump는 멈춘 자리(at) · 결과(ok) · status 0을 보여 준다", () => {
  const L = loadDebugLog();
  L.log({ kind: "ACTION", event: "SYNC_ABORTED", at: "find_file", state: "DISABLED" });
  L.log({ kind: "NETWORK", event: "DELETE_FIND_FILE", status: 0 });
  L.log({ kind: "NETWORK", event: "DELETE_FILE", ok: false, status: 503 });
  const out = L.dump();
  assert.match(out, /SYNC_ABORTED state:DISABLED at:find_file/);
  assert.match(out, /DELETE_FIND_FILE http:0/, "status 0도 찍는다");
  assert.match(out, /DELETE_FILE http:503 ok:false/);
});

test("2. 확인하지 못한 「파일도 삭제」는 오류 칸에 남는다", () => {
  const L = loadDebugLog();
  L.log({ kind: "ERROR", event: "DELETE_UNCONFIRMED", reason: "lookup_http_503" });
  const errors = L.dump().split("--- Errors ---")[1];
  assert.match(errors, /DELETE_UNCONFIRMED reason:lookup_http_503/);
});

test("3. 병합 기록의 baseWouldDrop(기준 목록 2단계 규칙이 지웠을 북마크 수)은 0이 아닐 때 찍는다", () => {
  const L = loadDebugLog();
  L.log({ kind: "ACTION", event: "MERGE", hadRemoteChanges: false, baseWouldDrop: 0 });
  L.log({ kind: "ACTION", event: "MERGE", hadRemoteChanges: true, baseWouldDrop: 3 });
  const lines = L.dump().split("\n").filter((l) => l.includes("MERGE"));
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines[0], /baseWouldDrop/);
  assert.match(lines[1], /MERGE baseWouldDrop:3/);
});
