// ── sw.js 정적 검증 — SHELL_FILES 패리티 + 캐시 라우팅 ───────────────────────
// Run with: node --test tests/unit/sw.test.js
//
// sw.js precaches every SHELL_FILES entry atomically at install time (see the
// install handler). If one entry 404s the whole install fails and the app
// won't boot offline. sw.js can't be imported as a whole — it calls
// importScripts at top level — so this suite reaches into the source two ways:
//
//   • Text parsing, for the `const SHELL_FILES = [...]` array (invariants 1-2).
//   • vm evaluation of the `// ── BEGIN/END CACHE_ROUTING ──` marker block,
//     which brackets `cacheNameFor()` in sw.js so it can run in isolation with
//     the three cache-name constants stubbed (invariant 3). **Those markers are
//     load-bearing — do not delete them as unused comments**; extractBlock()
//     throws when either one is missing.
//
// The invariants:
//
//   1. Existence — every app-repo SHELL_FILES entry resolves to a real file.
//   2. Parity   — every local <script src> / <link href> that index.html
//                 loads is in SHELL_FILES, so the app's runtime dependencies
//                 are all available offline. (This is the guard that would
//                 have caught js/sync/refresh-store.js being loaded by the
//                 page but absent from the precache list.)
//   3. Routing  — every path prefix that bible-manifest.json tracks routes to
//                 DATA_CACHE. A data path missing from cacheNameFor falls into
//                 SHELL_CACHE, where manifest-sync never invalidates it (it
//                 clears DATA_CACHE only), so a content-hash change leaves the
//                 stale bytes sitting there until the next shell bump — which
//                 is exactly what happened to lectionary/*.json (ADR-037 §7).
//                 Skipped with a stated reason when the private data/ submodule
//                 isn't checked out: it runs locally and in sync-data.yml, not
//                 in test.yml.
//
// /data/* entries are intentionally excluded from the existence check: those
// live in the common-bible-data submodule, which CI does not check out, and
// build-deploy.sh already aborts on missing deploy-manifest entries at deploy
// time. The "/" entry is the index.html route alias, not a file.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
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

// ── cacheNameFor ↔ bible-manifest 라우팅 ─────────────────────────────────────
// `cacheNameFor` 에서 빠진 데이터 경로는 SHELL_CACHE 로 떨어지고, 거기 앉은
// 바이트는 콘텐츠 해시 무효화를 못 받는다 — manifest-sync 가 낡은 항목을
// DATA_CACHE 에서만 지우기 때문이다. 실제로 `lectionary/*.json` 11건이
// bible-manifest 에 편입된 뒤에도 SHELL_CACHE 로 가고 있었다(ADR-037 §7 미이행).
//
// 그래서 개별 경로를 나열해 확인하는 대신, **매니페스트가 추적하는 접두사 전부**가
// DATA_CACHE 로 가는지 대조한다. 새 데이터 디렉터리가 매니페스트에 들어왔는데
// 라우팅을 안 고치면 그때 실패한다.

function loadCacheNameFor(src) {
  const block = extractBlock("CACHE_ROUTING", src, "sw.js");
  const ctx = vm.createContext({ AUDIO_CACHE: "audio", DATA_CACHE: "data", SHELL_CACHE: "shell-x" });
  vm.runInContext(block + "\nglobalThis.__fn = cacheNameFor;", ctx);
  return ctx.__fn;
}

function extractBlock(name, source, file) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in ${file}`);
  }
  return source.slice(startIdx, endIdx + end.length);
}

const cacheNameFor = loadCacheNameFor(SW_SOURCE);

test("cacheNameFor: 오디오·성서·전례 데이터가 각 캐시로 간다", () => {
  assert.equal(cacheNameFor("/data/audio/gen-1.mp3"), "audio");
  assert.equal(cacheNameFor("/data/bible/gen-1.json"), "data");
  assert.equal(cacheNameFor("/data/lectionary/eucharist-readings.json"), "data");
  assert.equal(cacheNameFor("/data/search-ot.json"), "data");
  // 셸과 함께 실리는 데이터 파일은 SHELL_CACHE 가 맞다.
  assert.equal(cacheNameFor("/data/books.json"), "shell-x");
  assert.equal(cacheNameFor("/index.html"), "shell-x");
});

test("bible-manifest 가 추적하는 모든 접두사가 DATA_CACHE 로 라우팅된다", (t) => {
  // data/ 는 비공개 서브모듈이라 CI 에 체크아웃되지 않는다. 없으면 이유를 남기고
  // 건너뛴다 — 로컬과 sync-data.yml 에서는 실제로 돈다.
  const manifestPath = path.join(REPO_ROOT, "data", "bible-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    t.skip("data/ 서브모듈이 체크아웃되지 않았다 (비공개)");
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const keys = Object.keys(manifest.entries);
  assert.ok(keys.length > 0, "bible-manifest.json 에 entries 가 없다");

  // 매니페스트 키는 /data/ 아래의 상대 경로다(manifest-sync._urlToManifestKey).
  const misrouted = [...new Set(
    keys.filter((k) => cacheNameFor(`/data/${k}`) !== "data")
        .map((k) => (k.includes("/") ? k.slice(0, k.indexOf("/") + 1) : k)),
  )];
  assert.deepEqual(misrouted, [],
    "매니페스트가 추적하는데 DATA_CACHE 로 안 가는 경로 — "
    + `해시가 바뀌어도 무효화되지 않는다: ${misrouted}`);
});
