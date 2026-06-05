// ── Unit tests for js/app/tab-history.js ─────────────────────────────────────
// Run with: node --test tests/unit/tab-history.test.js
//
// tab-history.js is nav-bound at module top level (history.scrollRestoration,
// location/window reads, route() wiring), so scroll save/restore and the home/
// search tab restore wiring are e2e's responsibility (ADR-013). What IS
// unit-testable is tabOf() — the path→tab classification that decides which
// tab a route belongs to (drives lastPathForTab keys + the home-tab restore
// guard in tabbar.js). We slice the TABOF block (mirrors tabbar.test.js's
// BEGIN/END approach) and run it in a vm.
//
// Coverage:
//   - tabOf: 첫 세그먼트 분류 — search/bookmarks/settings 각 탭, 그 외(읽기 스택)는 home
//   - 쿼리스트링·해시·선행 슬래시 변형에도 첫 세그먼트만 본다

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.resolve(__dirname, "../../js/app/tab-history.js");
const SOURCE = fs.readFileSync(SRC_PATH, "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = SOURCE.indexOf(begin);
  const endIdx = SOURCE.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in js/app/tab-history.js`);
  }
  return SOURCE.slice(startIdx, endIdx + end.length);
}

const TABOF_BLOCK = extractBlock("TABOF");

// Evaluate the sliced block in a bare vm and pull out tabOf.
const ctx = { module: { exports: {} } };
vm.createContext(ctx);
vm.runInContext(`${TABOF_BLOCK}\nmodule.exports = tabOf;`, ctx);
/** @type {(p: string) => string} */
const tabOf = ctx.module.exports;

test("tabOf: 루트('/')는 home", () => {
  assert.equal(tabOf("/"), "home");
});

test("tabOf: 빈 문자열도 home(첫 세그먼트 없음)", () => {
  assert.equal(tabOf(""), "home");
});

test("tabOf: 구분 목록(/old_testament)은 home", () => {
  assert.equal(tabOf("/old_testament"), "home");
  assert.equal(tabOf("/new_testament"), "home");
  assert.equal(tabOf("/deuterocanon"), "home");
});

test("tabOf: 장 목록(/john)·본문(/john/3)·절 딥링크(/john/3/16)는 home", () => {
  assert.equal(tabOf("/john"), "home");
  assert.equal(tabOf("/john/3"), "home");
  assert.equal(tabOf("/john/3/16"), "home");
  assert.equal(tabOf("/john/3/16-20"), "home");
});

test("tabOf: 본문 + resume 쿼리도 home(첫 세그먼트 기준)", () => {
  assert.equal(tabOf("/john/3?resume=1"), "home");
});

test("tabOf: /search 는 search", () => {
  assert.equal(tabOf("/search"), "search");
});

test("tabOf: 검색어·페이지 쿼리가 붙어도 search", () => {
  assert.equal(tabOf("/search?q=사랑&page=2"), "search");
});

test("tabOf: /bookmarks 는 bookmarks", () => {
  assert.equal(tabOf("/bookmarks"), "bookmarks");
});

test("tabOf: /settings 는 settings", () => {
  assert.equal(tabOf("/settings"), "settings");
});

test("tabOf: 해시 변형도 첫 세그먼트만(/search#x → search)", () => {
  assert.equal(tabOf("/search#x"), "search");
});

test("tabOf: 비슷하지만 다른 경로는 home(예: /searchers)", () => {
  // 정확 일치만 해당 탭 — 첫 세그먼트가 'searchers' 면 home 으로 떨어진다.
  assert.equal(tabOf("/searchers"), "home");
});
