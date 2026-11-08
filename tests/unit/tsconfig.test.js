// ── TypeScript의 모듈 판정 전제: 브라우저가 모듈로 부르는 파일만 import나 export를 가진다 ──────
// Run with: node --test tests/unit/tsconfig.test.js
//
// 두 tsconfig는 moduleDetection을 "legacy"로 둔다(ADR-012 「컴파일러 옵션」). TypeScript는 파일 안에 import나
// export가 있으면 모듈로, 없으면 일반 스크립트로 보고 검사한다. 브라우저는 파일 내용이 아니라 부르는 방식으로
// 정한다. <script type="module">이나 import로 부르면 모듈이고, type이 없는 <script>, new Worker(주소),
// importScripts로 부르면 일반 스크립트다. 둘이 어긋나면 타입 검사가 틀린 전제로 실행된다.
//
//   • 모듈인데 import도 export도 없으면, TypeScript는 그 파일의 맨 바깥 이름을 다른 파일과 함께 쓴다고 본다.
//     다른 파일이 그 이름을 import 없이 써도 검사를 통과하고, 브라우저에서는 오류가 난다. 내놓는 것이 없는
//     모듈은 `export {};`를 둔다(ADR-019).
//   • 일반 스크립트에 import나 export가 있으면 브라우저에서 문법 오류가 난다. TypeScript는 그 파일을 모듈로
//     보아, 일반 스크립트끼리 맨 바깥 이름이 겹쳐도 잡지 못한다.
//
// 브라우저가 각 파일을 부르는 방식은 index.html의 태그, new Worker, importScripts, import(정적과 동적)에서 모은다.
// import를 따라가는 코드는 sw.test.js와 함께 쓰는 module-graph.js에 있다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  codeView, literalAt, parseDynamicImports, resolveSpec, readSite, importClosure, listJsFiles,
} from "./module-graph.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const sorted = (xs) => [...new Set(xs)].sort();

// ── TypeScript가 보는 것 ─────────────────────────────────────────────────────

// What moduleDetection "legacy" looks for: an import or export declaration. Read off the code view (comments and the
// text inside literals blanked), where a top-level declaration starts its line. `import(` and `import.meta` are
// expressions, not declarations.
const hasModuleSyntax = (src) => /^(?:import(?!\s*[(.])|export)(?![\w$])/m.test(codeView(src));

// ── 브라우저가 부르는 방식 ───────────────────────────────────────────────────

// Local <script src="/js/…"> tags in index.html. HTML comments are dropped first: a tag named in a comment loads nothing.
function scriptTags(html) {
  const scan = html.replace(/<!--[\s\S]*?-->/g, "");
  return [...scan.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => ({ src: m[1].match(/\bsrc="(\/[^"]+)"/)?.[1], module: /\btype="module"/.test(m[1]) }))
    .filter((t) => t.src?.startsWith("/js/"));
}

// Calls of `callee` (a regex source) whose first argument is a string literal: its URL, and whether the options after
// it ask for a module (`{ type: "module" }`). A call this can't read — a computed URL — comes back with `url: null`.
function urlCalls(file, callee) {
  const src = read(file);
  const code = codeView(src);
  const calls = [];
  for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${callee}\\s*\\(\\s*`, "g"))) {
    const q = m.index + m[0].length;
    const line = src.slice(0, m.index).split("\n").length;
    if (!`"'`.includes(code[q])) {
      calls.push({ url: null, at: `${file}:${line}` });
      continue;
    }
    const lit = literalAt(src, code, q);
    const options = src.slice(lit.end, code.indexOf(")", lit.end));
    calls.push({ url: lit.text, module: /\btype\s*:\s*["']module["']/.test(options), at: `${file}:${line}` });
  }
  return calls;
}

const JS_FILES = listJsFiles("js").map((f) => `/${f}`);
const TAGS = scriptTags(read("index.html"));
const WORKERS = JS_FILES.flatMap((p) => urlCalls(p.slice(1), "new\\s+Worker"));
const IMPORT_SCRIPTS = ["sw.js", ...JS_FILES.map((p) => p.slice(1))].flatMap((f) => urlCalls(f, "importScripts"));

// Classic: a <script> without type="module", a classic Worker's entry, an importScripts target.
const CLASSIC = new Set([
  ...TAGS.filter((t) => !t.module).map((t) => t.src),
  ...WORKERS.filter((w) => w.url && !w.module).map((w) => w.url),
  ...IMPORT_SCRIPTS.filter((s) => s.url?.startsWith("/js/")).map((s) => s.url),
]);
// Module: a <script type="module">, a module Worker's entry, and everything import (static or dynamic) reaches from
// those or from a classic script's import().
const MODULE_ENTRIES = [
  ...TAGS.filter((t) => t.module).map((t) => t.src),
  ...WORKERS.filter((w) => w.url && w.module).map((w) => w.url),
  ...[...CLASSIC].flatMap((p) => parseDynamicImports(readSite(p)).specs.map((d) => resolveSpec(p, d.spec))),
];
const MODULES = importClosure(MODULE_ENTRIES, { dynamic: true }).reachable;

// ── 전제 ─────────────────────────────────────────────────────────────────────

test("두 tsconfig는 모듈 판정을 legacy로 둔다(아래 검사가 TypeScript의 판정을 대신 보는 전제)", () => {
  for (const file of ["tsconfig.json", "tsconfig.worker.json"]) {
    assert.equal(JSON.parse(read(file)).compilerOptions.moduleDetection, "legacy",
      `${file}의 moduleDetection이 legacy가 아니다. 기본값(auto)은 js/package.json 때문에 일반 스크립트도 모듈로 본다`);
  }
});

test("부르는 방식을 모두 읽었는지 닻으로 확인한다(태그, Worker, importScripts, 정적과 동적 import)", () => {
  // 파서가 깨져 목록이 비면 아래 검사는 아무것도 보지 않고 통과한다. 지금 있는 경우를 하나씩 닻으로 둔다.
  assert.ok(MODULES.has("/js/app.js"), "<script type=\"module\">을 읽지 못했다");
  assert.ok(MODULES.has("/js/app/bookmark-tree.js"), "정적 import를 따라가지 못했다");
  assert.ok(MODULES.has("/js/app/calendar.js"), "동적 import()를 따라가지 못했다");
  assert.ok(CLASSIC.has("/js/pre-fetch.js"), "type 없는 <script>를 읽지 못했다");
  assert.ok(CLASSIC.has("/js/search-worker.js"), "new Worker(주소)를 읽지 못했다");
  assert.ok(IMPORT_SCRIPTS.some((s) => s.url === "/js/audio-cache.js"), "sw.js의 importScripts를 읽지 못했다");
  const unread = [...WORKERS, ...IMPORT_SCRIPTS].filter((c) => c.url === null).map((c) => c.at);
  assert.deepEqual(unread, [], "주소가 글자 그대로가 아닌 Worker나 importScripts가 있다. 어느 파일을 부르는지 알 수 없다");
});

// ── 판정 대조 ────────────────────────────────────────────────────────────────

test("모듈로 부르는 js/ 파일에는 모두 import나 export가 있다", () => {
  const scripts = [...MODULES].filter((p) => p.startsWith("/js/") && !hasModuleSyntax(readSite(p)));
  assert.deepEqual(scripts, [],
    "브라우저는 모듈로 부르는데 import도 export도 없다. TypeScript가 일반 스크립트로 잘못 본다. "
    + "내놓는 것이 없으면 `export {};`를 둔다(ADR-019)");
});

test("일반 스크립트로 부르는 js/ 파일에는 import도 export도 없다", () => {
  const modules = [...CLASSIC].filter((p) => hasModuleSyntax(readSite(p)));
  assert.deepEqual(modules, [],
    "브라우저는 일반 스크립트로 부르는데 import나 export가 있다. 브라우저에서 문법 오류가 나고, "
    + "TypeScript는 모듈로 잘못 본다");
});

test("js/의 모든 .js 파일은 모듈과 일반 스크립트 가운데 꼭 한쪽으로 불린다", () => {
  assert.ok(JS_FILES.length > 30, "js/ 파일 목록을 읽지 못했다");
  const unused = JS_FILES.filter((p) => !MODULES.has(p) && !CLASSIC.has(p));
  const both = JS_FILES.filter((p) => MODULES.has(p) && CLASSIC.has(p));
  assert.deepEqual(unused, [], "어디서도 부르지 않는다. 쓰지 않는 파일이거나, 부르는 방식을 이 테스트가 읽지 못했다");
  assert.deepEqual(both, [], "모듈로도 일반 스크립트로도 부른다. TypeScript는 한쪽으로만 볼 수 있다");
});

test("hasModuleSyntax는 선언만 센다(주석과 문자열 속 글자, import(), import.meta는 세지 않는다)", () => {
  for (const src of ["export {};", 'import a from "./a.js";', 'import "./b.js";', "export const c = 1;",
    'export { d } from "./d.js";']) {
    assert.equal(hasModuleSyntax(src), true, src);
  }
  for (const src of ["// export {};", '/* import a from "./a.js"; */', "const t = `\nexport {};\n`;",
    'import("./e.js");', "import.meta.url;", "  window.x = 1;", "const exported = 1;\nexports = 2;"]) {
    assert.equal(hasModuleSyntax(src), false, src);
  }
});
