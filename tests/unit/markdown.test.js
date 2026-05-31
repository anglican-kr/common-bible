// ── Unit tests for js/app/markdown.js ───────────────────────────────────────
// Run with: node --test tests/unit/markdown.test.js
//
// Marker-slice + vm. Three blocks: MD_RENDER (escape + safeUrl + inline +
// block render — the XSS-sensitive surface), MD_PLAIN (search/title), and
// MD_TOOLBAR (pure textarea selection transforms).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(__dirname, "../../js/app/markdown.js"), "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const s = SRC.indexOf(begin);
  const e = SRC.indexOf(end);
  if (s < 0 || e < 0) throw new Error(`marker block ${name} not found`);
  return SRC.slice(s, e + end.length);
}

function load(...blocks) {
  const ctx = { String, Math, Object, Array, RegExp };
  vm.createContext(ctx);
  for (const b of blocks) vm.runInContext(extractBlock(b), ctx, { filename: `md-${b}.js` });
  return ctx;
}

// ── MD_RENDER — security ──

test("renderMarkdown — escapes raw HTML (no passthrough)", () => {
  const { renderMarkdown } = load("MD_RENDER");
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.ok(!html.includes("<script>"), "must not emit a script tag");
  assert.ok(html.includes("&lt;script&gt;"), "raw tag must be escaped");
});

test("renderMarkdown — rejects dangerous link hrefs, keeps safe ones", () => {
  const { renderMarkdown } = load("MD_RENDER");
  // javascript: / data: are not linkified — rendered inert
  const bad = renderMarkdown("[x](javascript:alert(1))");
  assert.ok(!/href="javascript:/i.test(bad));
  assert.ok(!bad.includes("<a "), "no anchor for unsafe url");
  // http(s) → external anchor with noopener
  const ext = renderMarkdown("[Bible](https://bible.anglican.kr)");
  assert.ok(ext.includes('href="https://bible.anglican.kr"'));
  assert.ok(ext.includes('rel="noopener noreferrer"'));
  assert.ok(ext.includes('target="_blank"'));
  // internal path → anchor without target
  const int = renderMarkdown("[창세 1](/genesis/1)");
  assert.ok(int.includes('href="/genesis/1"'));
  assert.ok(!int.includes("target="), "internal link has no target");
  // protocol-relative //evil.com is rejected
  assert.ok(!renderMarkdown("[x](//evil.com)").includes("<a "));
});

test("renderMarkdown — emphasis, code, headings, hr", () => {
  const { renderMarkdown } = load("MD_RENDER");
  assert.equal(renderMarkdown("# 제목"), "<h1>제목</h1>");
  assert.equal(renderMarkdown("### 셋"), "<h3>셋</h3>");
  assert.equal(renderMarkdown("**굵게**"), "<p><strong>굵게</strong></p>");
  assert.equal(renderMarkdown("*기울임*"), "<p><em>기울임</em></p>");
  assert.equal(renderMarkdown("`코드`"), "<p><code>코드</code></p>");
  assert.equal(renderMarkdown("---"), "<hr>");
});

test("renderMarkdown — blockquote and lists", () => {
  const { renderMarkdown } = load("MD_RENDER");
  assert.equal(renderMarkdown("> 인용"), "<blockquote>인용</blockquote>");
  assert.equal(renderMarkdown("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderMarkdown("1. a\n2. b"), "<ol><li>a</li><li>b</li></ol>");
  const task = renderMarkdown("- [x] 완료\n- [ ] 미완");
  assert.ok(task.includes('<input type="checkbox" disabled checked>'));
  assert.ok(task.includes('<input type="checkbox" disabled>'));
});

test("renderMarkdown — paragraph newlines become <br>", () => {
  const { renderMarkdown } = load("MD_RENDER");
  assert.equal(renderMarkdown("한 줄\n두 줄"), "<p>한 줄<br>두 줄</p>");
});

// ── MD_PLAIN ──

test("plainText — strips markdown syntax", () => {
  const { plainText } = load("MD_PLAIN");
  assert.equal(plainText("## 제목"), "제목");
  assert.equal(plainText("- **사랑**은 `오래` 참고"), "사랑은 오래 참고");
  assert.equal(plainText("> 인용 [링크](/x)"), "인용 링크");
});

// ── MD_TOOLBAR ──

test("wrapSelection — wraps selection / inserts pair on empty", () => {
  const { wrapSelection } = load("MD_TOOLBAR");
  let r = wrapSelection({ value: "abc", start: 0, end: 3 }, "**");
  assert.equal(r.value, "**abc**");
  assert.deepEqual([r.start, r.end], [2, 5]);
  r = wrapSelection({ value: "xy", start: 1, end: 1 }, "*");
  assert.equal(r.value, "x**y");
  assert.deepEqual([r.start, r.end], [2, 2]); // caret between markers
});

test("toggleLinePrefix — adds then removes a heading prefix", () => {
  const { toggleLinePrefix } = load("MD_TOOLBAR");
  const added = toggleLinePrefix({ value: "title", start: 0, end: 0 }, "## ");
  assert.equal(added.value, "## title");
  const removed = toggleLinePrefix({ value: "## title", start: 0, end: 0 }, "## ");
  assert.equal(removed.value, "title");
});

test("toggleLinePrefix — applies across every selected line", () => {
  const { toggleLinePrefix } = load("MD_TOOLBAR");
  const r = toggleLinePrefix({ value: "a\nb", start: 0, end: 3 }, "- ");
  assert.equal(r.value, "- a\n- b");
});

test("insertLink — selection becomes label, caret in url parens", () => {
  const { insertLink } = load("MD_TOOLBAR");
  const r = insertLink({ value: "사랑", start: 0, end: 2 });
  assert.equal(r.value, "[사랑]()");
  assert.equal(r.value.slice(r.start, r.start), ""); // empty caret
  assert.equal(r.start, 5); // inside ()
});
