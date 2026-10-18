// ── sw.js 정적 검증 — SHELL_FILES 패리티 + 캐시 라우팅 ───────────────────────
// Run with: node --test tests/unit/sw.test.js
//
// sw.js precaches every SHELL_FILES entry atomically at install time (see the
// install handler). If one entry 404s the whole install fails and the app
// won't boot offline. sw.js can't be imported as a whole — it calls
// importScripts at top level — so this suite reaches into the source two ways:
//
//   • Text parsing, for the `const SHELL_FILES = [...]` array and the ESM
//     import specifiers — static, and dynamic import() with a literal
//     specifier — of every module the page reaches (invariants 1-3, 5 and 6).
//     Imports are read off a code view of each file (codeView — comments and
//     the text inside string / template / regex literals blanked), so an
//     import named in a comment, a JSDoc type or a string is not an edge.
//   • vm evaluation of the `// ── BEGIN/END CACHE_ROUTING ──` marker block,
//     which brackets `cacheNameFor()` in sw.js so it can run in isolation with
//     the three cache-name constants stubbed (invariant 4). **Those markers are
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
//   3. Closure  — every module reachable from those <script> tags through
//                 ESM import (static, or a literal dynamic import() — how
//                 routing.js loads the calendar · lectionary views on first
//                 visit) is in SHELL_FILES too. (2) only sees
//                 tags, which is how bookmark.js's five import-only modules
//                 (bookmark-{tree,gestures,select,menu,verse-select}.js) sat
//                 outside the precache list unnoticed. On a first visit those
//                 imports load before the SW exists, so nothing caches them;
//                 the next launch offline serves bookmark.js from cache and
//                 then fails resolving its imports, taking the whole module
//                 graph down. Only a second online visit (fetches now routed
//                 through the SW) heals it (PR #319).
//   4. Routing  — every path prefix that bible-manifest.json tracks routes to
//                 DATA_CACHE. A data path missing from cacheNameFor falls into
//                 SHELL_CACHE, where manifest-sync never invalidates it (it
//                 clears DATA_CACHE only), so a content-hash change leaves the
//                 stale bytes sitting there until the next shell bump — which
//                 is exactly what happened to lectionary/*.json (ADR-037 §7).
//                 Skipped with a stated reason when the private data/ submodule
//                 isn't checked out: it runs locally and in sync-data.yml, not
//                 in test.yml.
//   5. Lazy     — whatever a literal import() loads stays out of the boot graph
//                 (tags + static imports): today the calendar, the lectionary
//                 view and the liturgical engine (ADR-038 §2). A tag or static
//                 import coming back keeps the app working, so nothing else
//                 would notice — the cold first visit's boot would carry them
//                 again (Slow 4G DOMContentLoaded +390 ms, measured 2026-10-17).
//                 Every import() in js/ must name its module literally, or this
//                 and invariant 3 can't follow it.
//   6. At once  — each `Promise.all([import(a), import(b), …])` group in
//                 routing.js names exactly a's static imports minus the boot
//                 graph, so a view's modules are requested together instead of
//                 one round trip after another (ADR-038 「검토한 대안 — 모듈
//                 로드」 D).
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

// ── ESM import 닫힘 ↔ SHELL_FILES 패리티 ─────────────────────────────────────
// 위 패리티는 index.html 의 태그만 본다. ESM `import` 로만 끌려오는 모듈은 태그가
// 없어 거기 안 걸린다 — bookmark.js 가 import 하는 5모듈이 실제로 SHELL_FILES 에
// 없었다. 첫 방문에서는 그 import 가 SW 등록보다 먼저 로드돼 아무도 캐시하지
// 않으므로, 설치 직후 오프라인으로 열면 bookmark.js 는 캐시에서 오고 그 import 는
// 실패해 모듈 그래프째 깨진다. 두 번째 온라인 방문(이제 fetch 가 SW 를 거친다)
// 에서야 채워지니 증상이 잘 안 보였을 뿐이다. 그래서 <script> 태그에서 출발해
// import를 끝까지 따라간 닫힘 전체가 SHELL_FILES에 있는지 대조한다. 정적 import만이
// 아니라 지정자가 글자 그대로인 동적 import()도 따라간다 — routing.js가 캘린더 · 전례독서
// 모듈을 그 화면에 처음 갈 때 그렇게 불러온다(ADR-038 §2 「구현」). 그 모듈이나 그것이
// import하는 모듈이 빠지면 오프라인에서 그 화면만 「다시 불러오기」 실패 화면이 된다.

// Source with everything but code blanked to spaces — comments, and the text inside string / template / regex
// literals (their delimiters stay) — at the same offsets and line breaks. The import patterns below run on this
// view, so an import in a comment, a JSDoc type (`@type {typeof import("./calendar.js")}`) or a string's text is
// not an edge; reading the raw text counted those, which could hide a computed specifier from invariant 5 (PR #355
// review, 2026-10-18). A `/` starts a regex literal where an expression can start (after an operator, an opening
// bracket or a keyword like `return`), else it divides — the usual heuristic; the "codeView" cases below pin it.
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

function codeView(src) {
  const out = src.split("");
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " "; };
  const subs = [];   // brace depth at which each open template substitution `${` began
  let depth = 0;     // depth of { } in code
  let prev = "";     // the last code character that isn't white space
  let word = "";     // the identifier or keyword `prev` ends, if it ends one
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const stop = nl < 0 ? src.length : nl;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const stop = close < 0 ? src.length : close + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
      prev = c;
      word = "";
      continue;
    }
    if (c === "`" || (c === "}" && subs.length && subs[subs.length - 1] === depth)) {
      // Template text runs from here to the closing backtick or the next `${` (whose code is scanned as code).
      if (c === "}") subs.pop();
      let j = i + 1;
      while (j < src.length && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, j);
      if (src[j] === "$") {
        subs.push(depth);
        i = j + 2;
        prev = "{";
      } else {
        i = j + 1;
        prev = "`";
      }
      word = "";
      continue;
    }
    if (c === "/" && (prev === "" || "([{,;:=!&|?+-*%<>~^".includes(prev) || REGEX_AFTER_WORD.has(word))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n" && (inClass || src[j] !== "/")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j++;
      }
      if (src[j] === "/") {   // a regex literal — a line break first means it was a division after all
        blank(i + 1, j);
        i = j + 1;
        prev = "/";
        word = "";
        continue;
      }
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (/[\w$]/.test(c)) {
      word = /[\w$]/.test(src[i - 1] ?? "") ? word + c : c;
      prev = c;
    } else if (!/\s/.test(c)) {
      prev = c;
      word = "";
    }
    i++;
  }
  return out.join("");
}

// The literal at `q` (a quote's offset — code view and source agree on offsets): its text, and the offset just past
// its closing delimiter. The code view keeps the delimiters but blanks the text, so the first matching delimiter after
// `q` closes it. A template with a substitution keeps its `${` in the code view — the caller treats that as computed.
function literalAt(src, code, q) {
  const close = code.indexOf(code[q], q + 1);
  return { text: src.slice(q + 1, close), inner: code.slice(q + 1, close), end: close + 1 };
}

const RELATIVE_JS = /^\.{1,2}\/.+\.js$/;

// Static ESM specifiers — `from "./x.js"` (import … from, export … from) and bare `import "./x.js"`.
function parseStaticImports(src) {
  const code = codeView(src);
  const specs = [];
  for (const m of code.matchAll(/(?<![\w$.])(?:import|from)\s*(["'])/g)) {
    const { text } = literalAt(src, code, m.index + m[0].length - 1);
    if (RELATIVE_JS.test(text)) specs.push(text);
  }
  return specs;
}

// Dynamic imports. `specs` are the literal relative `.js` specifiers with their offsets; `computed` lists every
// import() whose module this can't name — a computed or concatenated specifier, a template with a substitution, or
// a literal that isn't a relative `.js` path. Invariants 3 and 5 can only follow the first kind.
function parseDynamicImports(src) {
  const code = codeView(src);
  const specs = [];
  const computed = [];
  for (const m of code.matchAll(/(?<![\w$.])import\s*\(\s*/g)) {
    const q = m.index + m[0].length;
    const line = src.slice(0, m.index).split("\n").length;
    if (!`"'\``.includes(code[q])) {
      computed.push(`line ${line}`);
      continue;
    }
    const lit = literalAt(src, code, q);
    const after = code.slice(lit.end).match(/^\s*([),])/);
    if (lit.inner.includes("${") || !after || !RELATIVE_JS.test(lit.text)) computed.push(`line ${line}`);
    else specs.push({ spec: lit.text, at: m.index });
  }
  return { specs, computed };
}

const resolveSpec = (from, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
const readSite = (p) => fs.readFileSync(path.join(REPO_ROOT, p.slice(1)), "utf8");

// Transitive closure of the imports reachable from `entries` (site-absolute paths) — static ones only (what the page
// loads at boot), or static + dynamic (everything it can load). Also counts the static import edges it followed: a
// parser sanity check, kept apart from the dynamic ones so routing.js's import() calls can't make a broken static
// parser look alive (PR #355 review).
function importClosure(entries, { dynamic }) {
  const reachable = new Set();
  const queue = [...entries];
  let staticEdges = 0;
  while (queue.length) {
    const p = queue.shift();
    if (reachable.has(p)) continue;
    reachable.add(p);
    if (!fs.existsSync(path.join(REPO_ROOT, p.slice(1)))) continue; // existence is invariant 1's job
    const src = readSite(p);
    const statics = parseStaticImports(src);
    staticEdges += statics.length;
    const specs = dynamic ? [...statics, ...parseDynamicImports(src).specs.map((d) => d.spec)] : statics;
    for (const spec of specs) queue.push(resolveSpec(p, spec));
  }
  return { reachable, staticEdges };
}

const BOOT_ENTRIES = parseHtmlLocalRefs(INDEX_HTML).filter((p) => p.endsWith(".js"));
const BOOT_GRAPH = importClosure(BOOT_ENTRIES, { dynamic: false });
const FULL_GRAPH = importClosure(BOOT_ENTRIES, { dynamic: true });

// Precached scripts that no import reaches, each for a reason: a Worker's entry and a service worker importScripts
// target are loaded by URL, not imported.
const SHELL_SCRIPTS_NOT_IMPORTED = ["/js/search-worker.js", "/sw-version.js"];

test("index.html에서 import(정적 · 동적)로 닿는 모든 모듈이 SHELL_FILES에 있다", () => {
  assert.ok(FULL_GRAPH.staticEdges > 0, "정적 import 간선을 하나도 못 찾았다 — 파서가 깨졌을 가능성");
  const notPrecached = [...FULL_GRAPH.reachable].filter((p) => !SHELL_SET.has(p));
  assert.deepEqual(notPrecached, [],
    `import로 로드되지만 sw.js가 프리캐시하지 않는다 (오프라인 구멍): ${notPrecached}`);
});

test("SHELL_FILES의 스크립트는 (Worker · importScripts 대상을 빼면) 모두 import로 닿는다 — 파서가 간선을 놓치지 않았다", () => {
  // 위 검사의 거꾸로다. 파서가 간선을 놓치면 닫힘이 작아져 위 검사는 조용히 통과한다 — bookmark.js가 import하는
  // 다섯 모듈(#319)이 그 예다. 프리캐시 목록에 있는데 닫힘에 없는 스크립트가 생기면 여기서 드러난다.
  const unreached = SHELL_FILES.filter((p) => p.endsWith(".js") && !FULL_GRAPH.reachable.has(p));
  assert.deepEqual(unreached, SHELL_SCRIPTS_NOT_IMPORTED,
    "SHELL_FILES에 있는데 index.html에서 import로 닿지 않는다 — 파서가 간선을 놓쳤거나 쓰지 않는 파일이다");
});

// ── 지연 로드 — 부팅 그래프 밖 · 한꺼번에 ───────────────────────────────────
// 캘린더 · 전례독서 · 교회력 엔진(원본 약 210KB)은 index.html의 태그나 정적 import로 싣지 않고, routing.js가
// /calendar · /lectionary에 처음 갈 때 import()로 불러온다(ADR-038 §2 「구현」, known-issues §6 — 2026-10-17).
// 태그나 정적 import가 하나라도 다시 생기면 앱은 그대로 돌아 다른 검사로는 드러나지 않고, 첫 방문의 부팅이 셋을
// 다시 받는다(느린 4G DOMContentLoaded +390ms). 그래서 이름을 적어 두는 대신 규칙으로 본다 — import()로 부르는
// 모듈은 무엇이든 부팅 그래프 밖에 있어야 하고, 지정자는 글자 그대로여야 한다.

const ROUTING = "/js/app/routing.js";

function dynamicTargets() {
  const targets = new Set();
  for (const p of FULL_GRAPH.reachable) {
    if (!fs.existsSync(path.join(REPO_ROOT, p.slice(1)))) continue;
    for (const { spec } of parseDynamicImports(readSite(p)).specs) targets.add(resolveSpec(p, spec));
  }
  return targets;
}

function listJsFiles(dir) {
  return fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listJsFiles(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []);
}

test("js/의 import()는 모두 지정자가 글자 그대로다 — 오프라인 목록 · 부팅 그래프 검사가 따라갈 수 있다", () => {
  const computed = listJsFiles("js").flatMap((f) =>
    parseDynamicImports(fs.readFileSync(path.join(REPO_ROOT, f), "utf8")).computed.map((at) => `${f} ${at}`));
  assert.deepEqual(computed, [],
    "import()의 지정자가 계산식이거나 상대 .js 경로가 아니다 — 닫힘 · 지연 검사가 그 모듈을 볼 수 없다");
});

test("import()로 부르는 모듈은 부팅 그래프(태그 + 정적 import) 밖에 있다", () => {
  assert.ok(BOOT_GRAPH.staticEdges > 0, "정적 import 간선을 하나도 못 찾았다 — 파서가 깨졌을 가능성");
  const targets = dynamicTargets();
  // 닻 — routing.js의 import()를 파서가 읽었는지. 이것이 없으면 아래 규칙은 아무것도 보지 않고 통과한다.
  for (const view of ["/js/app/calendar.js", "/js/app/lectionary.js"]) {
    assert.ok(targets.has(view), `${view}가 import() 대상에 없다 — routing.js의 import()를 파서가 못 읽었다`);
  }
  assert.deepEqual([...targets].filter((t) => BOOT_GRAPH.reachable.has(t)), [],
    "import()로 부르는 모듈이 부팅 때 싣는 그래프에 들어왔다 — 첫 방문의 부팅이 그것을 다시 받는다");
});

// routing.js의 `Promise.all([import(a), import(b), …])` 묶음 — 묶음마다 해석한 경로 목록(첫 원소가 그 화면의 모듈).
function atOnceGroups() {
  const src = readSite(ROUTING);
  const code = codeView(src);
  const dynamics = parseDynamicImports(src).specs;
  const groups = [];
  for (const m of code.matchAll(/Promise\.all\(\s*\[/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < code.length; close++) {
      if (code[close] === "[") depth++;
      else if (code[close] === "]" && --depth === 0) break;
    }
    const group = dynamics.filter((d) => d.at > open && d.at < close).map((d) => resolveSpec(ROUTING, d.spec));
    if (group.length) groups.push(group);
  }
  return groups;
}

const sorted = (xs) => [...new Set(xs)].sort();

test("routing.js의 한꺼번에 묶음은 그 화면 모듈이 끌어오는 것 전부(부팅 그래프 밖)와 같다", () => {
  // 묶음에서 의존 모듈이 빠지면 브라우저가 화면 모듈을 받은 뒤에야 그것을 찾아 왕복이 하나 더 든다(차례로 받기 — 2026-10-17
  // 실측: 첫 방문의 캘린더 탭 → 표가 느린 4G에서 main보다 +676ms, 한꺼번에는 +527ms · ADR-038 「검토한 대안 — 모듈 로드」 D).
  // 남는 것이 있으면 쓰지 않는 모듈을 받는다.
  const groups = atOnceGroups();
  assert.ok(groups.length >= 2, `한꺼번에 묶음을 ${groups.length}개 찾았다 — 캘린더 · 전례독서 둘이 있어야 한다`);
  for (const group of groups) {
    const want = sorted([...importClosure([group[0]], { dynamic: false }).reachable].filter((p) => !BOOT_GRAPH.reachable.has(p)));
    assert.deepEqual(sorted(group), want, `${group[0]}의 묶음이 그 모듈의 import와 다르다`);
  }
});

test("codeView: 주석 · 문자열 · 정규식 속의 import는 간선이 아니다 — 따옴표 셋 · 띄어 쓴 import(는 읽는다", () => {
  const dyn = (src) => parseDynamicImports(src);
  assert.deepEqual(dyn('// import("./a.js")\n/* import("./b.js") */ /** @type {typeof import("./c.js")} */').specs, []);
  assert.deepEqual(dyn('const u = "https://x/import(\\"./d.js\\")"; const t = `import("./e.js")`;').specs, []);
  assert.deepEqual(dyn('const re = /["\'`]\\/\\//g; import(\'./f.js\'); import ("./g.js"); import(`./h.js`);').specs
    .map((d) => d.spec), ["./f.js", "./g.js", "./h.js"]);
  assert.deepEqual(dyn('const x = `${a ? `${b}` : "}"}`; import("./i.js");').specs.map((d) => d.spec), ["./i.js"]);
  assert.deepEqual(dyn('const n = a / b; const m = c / d; import("./j.js");').specs.map((d) => d.spec), ["./j.js"]);
  assert.equal(dyn('import("./" + name); import(`./${name}.js`); import(spec); import("https://x/y.js");').computed.length, 4);
  assert.deepEqual(parseStaticImports('import a from "./k.js";\n// import b from "./l.js";\nexport { c } from \'./m.js\';\nimport "./n.js";'),
    ["./k.js", "./m.js", "./n.js"]);
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
