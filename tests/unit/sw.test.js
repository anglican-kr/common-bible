// ── sw.js SHELL_FILES 정적 검증 ──────────────────────────────────────────────
// Run with: node --test tests/unit/sw.test.js
//
// sw.js precaches every SHELL_FILES entry atomically at install time (see the
// install handler). If one entry 404s the whole install fails and the app
// won't boot offline. These tests don't evaluate sw.js (it calls
// importScripts at top level, which the vm harness can't run) — they parse the
// SHELL_FILES array out of the source as text and assert two invariants:
//
//   1. Existence — every app-repo SHELL_FILES entry resolves to a real file.
//   2. Parity   — every local <script src> / <link href> that index.html
//                 loads is in SHELL_FILES, so the app's runtime dependencies
//                 are all available offline. (This is the guard that would
//                 have caught js/sync/refresh-store.js being loaded by the
//                 page but absent from the precache list.)
//
// /data/* entries are intentionally excluded from the existence check: those
// live in the common-bible-data submodule, which CI does not check out, and
// build-deploy.sh already aborts on missing deploy-manifest entries at deploy
// time. The "/" entry is the index.html route alias, not a file.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const SW_SOURCE = fs.readFileSync(path.join(REPO_ROOT, "sw.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, "index.html"), "utf8");

// ── Parse helpers ────────────────────────────────────────────────────────────

// Pull the string literals out of the `const SHELL_FILES = [ ... ];` block.
function parseShellFiles(src) {
  const block = src.match(/const\s+SHELL_FILES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, "could not locate SHELL_FILES array in sw.js");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// All local resource references the page loads at runtime: <script src="/...">
// and <link rel="stylesheet" href="/...">. External (https://) refs are ignored.
function parseHtmlLocalRefs(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(\/[^"]+)"/g)].map((m) => m[1]);
  const styles = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(\/[^"]+)"/g)]
    .map((m) => m[1]);
  return [...scripts, ...styles];
}

const SHELL_FILES = parseShellFiles(SW_SOURCE);
const SHELL_SET = new Set(SHELL_FILES);

// ── 파싱 sanity ──────────────────────────────────────────────────────────────

test("SHELL_FILES가 파싱되며 핵심 셸 엔트리를 포함한다", () => {
  assert.ok(SHELL_FILES.length > 10, `expected a populated list, got ${SHELL_FILES.length}`);
  for (const required of ["/", "/index.html", "/sw-version.js", "/css/style.css"]) {
    assert.ok(SHELL_SET.has(required), `SHELL_FILES is missing ${required}`);
  }
});

test("SHELL_FILES에 중복 엔트리가 없다", () => {
  assert.equal(SHELL_SET.size, SHELL_FILES.length,
    `duplicate entries: ${SHELL_FILES.filter((p, i) => SHELL_FILES.indexOf(p) !== i)}`);
});

// ── 디스크 존재 (앱 저장소 파일) ──────────────────────────────────────────────

test("data/ 외 모든 SHELL_FILES 엔트리는 실제 파일로 존재한다", () => {
  // "/" is the route alias for index.html; /data/* is the submodule (not in CI).
  const checkable = SHELL_FILES.filter((p) => p !== "/" && !p.startsWith("/data/"));
  const missing = checkable.filter((p) => !fs.existsSync(path.join(REPO_ROOT, p.slice(1))));
  assert.deepEqual(missing, [], `SHELL_FILES entries with no file on disk: ${missing}`);
});

// ── index.html ↔ SHELL_FILES 패리티 ──────────────────────────────────────────

test("index.html이 로드하는 모든 로컬 script/style이 SHELL_FILES에 있다", () => {
  // One direction only: a worker (search-worker.js) or SW importScripts target
  // (audio-cache.js) may legitimately be in SHELL_FILES without a <script> tag,
  // so we don't assert the reverse.
  const refs = parseHtmlLocalRefs(INDEX_HTML);
  assert.ok(refs.length > 0, "parsed no local refs from index.html — selector likely broke");
  const notPrecached = refs.filter((p) => !SHELL_SET.has(p));
  assert.deepEqual(notPrecached, [],
    `index.html loads these but sw.js won't precache them (offline gap): ${notPrecached}`);
});
