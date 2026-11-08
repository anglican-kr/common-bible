// ── 페이지의 모듈 그래프 읽기 — 유닛 테스트가 함께 쓰는 공용 모듈 ──────────────
// sw.test.js(오프라인 목록과 부팅 그래프)와 tsconfig.test.js(TypeScript의 모듈 판정)가 함께 쓴다. 사본을 두면 곧
// 어긋나므로 한 벌만 둔다. 이름이 `*.test.js`가 아니라 테스트 러너는 이 파일을 직접 실행하지 않는다(harness.js,
// docs-anchors.js와 같다). 경로는 사이트 기준 절대 경로(`/js/app.js`)로 다룬다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Source with everything but code blanked to spaces — comments, and the text inside string / template / regex
// literals (their delimiters stay) — at the same offsets and line breaks. The import patterns below run on this
// view, so an import in a comment, a JSDoc type (`@type {typeof import("./calendar.js")}`) or a string's text is
// not an edge; reading the raw text counted those, which could hide a computed specifier from invariant 5 (PR #355
// review, 2026-10-18). A `/` starts a regex literal where an expression can start (after an operator, an opening
// bracket or a keyword like `return`), else it divides — the usual heuristic; the "codeView" cases below pin it.
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

export function codeView(src) {
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
export function literalAt(src, code, q) {
  const close = code.indexOf(code[q], q + 1);
  return { text: src.slice(q + 1, close), inner: code.slice(q + 1, close), end: close + 1 };
}

const RELATIVE_JS = /^\.{1,2}\/.+\.js$/;

// Static ESM specifiers — `from "./x.js"` (import … from, export … from) and bare `import "./x.js"`.
export function parseStaticImports(src) {
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
export function parseDynamicImports(src) {
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

export const resolveSpec = (from, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
export const readSite = (p) => fs.readFileSync(path.join(REPO_ROOT, p.slice(1)), "utf8");

// Transitive closure of the imports reachable from `entries` (site-absolute paths) — static ones only (what the page
// loads at boot), or static + dynamic (everything it can load). Also counts the static import edges it followed: a
// parser sanity check, kept apart from the dynamic ones so routing.js's import() calls can't make a broken static
// parser look alive (PR #355 review).
export function importClosure(entries, { dynamic }) {
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

export function listJsFiles(dir) {
  return fs.readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listJsFiles(`${dir}/${e.name}`) : e.name.endsWith(".js") ? [`${dir}/${e.name}`] : []);
}
