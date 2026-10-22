// ── 문서 참조 검사 — 옛 번호 참조 · docs/ 경로 · 마크다운 상대 링크 · index.md ─────────────
// Run with: node --test tests/unit/docs-wiki.test.js
//
// docs 재구성(2026-10-22)의 lint. 교회력 설계 문서 다섯의 참조는 docs-crossref.test.js 가 맡고,
// 이 파일은 저장소의 나머지를 본다.
//   1. 「pitfalls §N」 「known-issues §N」 참조가 지금 문서의 절로 풀린다. 코드 주석 · 테스트 · 도구 · 문서가
//      이 번호로 가리키므로, 절을 지우거나 번호를 당기면 여기서 걸린다(절을 비울 때는 노트를 남긴다 — pitfalls §26).
//   2. 본문에 적은 `docs/…` 경로가 실재한다. glob(`liturgical-engine-*.md`)은 무엇이든 하나 고르면 된다.
//   3. 마크다운 상대 링크가 실재하는 파일을 가리킨다.
//   4. docs/index.md 가 인용한 파일과 ADR 이 실재한다.
// 범위: git 이 아는 텍스트 파일(추적 중 + 무시되지 않은 새 파일) 가운데 아래 SKIP 을 뺀 것.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { stripInlineCode } from "./docs-anchors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const rel = (p) => path.join(ROOT, p);
const exists = (p) => fs.existsSync(rel(p));

// 머지된 원장은 고칠 수 없고(docs/changes/README.md), 보관 문서는 그때의 기록이다. data/ 는 비공개 서브모듈이라
// CI 의 Unit tests 잡에 없다. 픽스처는 docs-crossref · liturgical-fixtures 가 본다.
const SKIP = /^(docs\/changes\/|docs\/archive\/|data\/|node_modules\/|tests\/fixtures\/)/;
const TEXT = /\.(js|mjs|ts|css|html|md|py|sh|ya?ml)$/;
const FILES = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter((f) => f && TEXT.test(f) && !SKIP.test(f) && fs.existsSync(rel(f)))
  .sort();
const LINES = Object.fromEntries(FILES.map((f) => [f, fs.readFileSync(rel(f), "utf8").split("\n")]));

/** 파일:줄 단위로 정규식 매치를 모은다. */
function* matches(files, re) {
  for (const f of files)
    for (const [i, line] of LINES[f].entries())
      for (const m of line.matchAll(re)) yield { at: `${f}:${i + 1}`, m };
}

// ── 1. 옛 번호 참조 ──

const PITFALLS = new Set([...fs.readFileSync(rel("docs/coding-pitfalls.md"), "utf8").matchAll(/^## (\d+)\. /gm)].map((m) => m[1]));
const KNOWN_ISSUES = new Set(
  [...fs.readFileSync(rel("docs/known-issues.md"), "utf8").matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? /gm)].map((m) => m[1]),
);
const LEGACY_REF = /(?:coding-)?(pitfalls|known-issues)(?:\.md)?`?\s*§\s*(\d+(?:\.\d+)?)/g;

test("「pitfalls §N」 「known-issues §N」 참조가 지금 문서의 절로 풀린다", () => {
  const bad = [];
  for (const { at, m } of matches(FILES, LEGACY_REF)) {
    const [, doc, n] = m;
    const ok = doc === "pitfalls" ? PITFALLS.has(n) : KNOWN_ISSUES.has(n);
    if (!ok) bad.push(`${at}: ${m[0]}`);
  }
  assert.ok(PITFALLS.size > 30 && KNOWN_ISSUES.size > 20, "절 목록을 읽지 못했다 — 제목 형식이 바뀌었는지 본다");
  assert.deepEqual(bad, [], `없는 절을 가리킨다 — 절을 지웠으면 노트를 남긴다(pitfalls §26):\n${bad.join("\n")}`);
});

// ── 2. docs/ 경로 ──

// 지운 파일을 일부러 언급한 자리(이력 서술) — 경로 대신 이 목록으로 허용한다.
const RETIRED = new Map([
  ["docs/worklog.md", "2026-09-20 은퇴(#331) — pitfalls §17 · §7 이 이력으로 언급"],
  ["docs/prd.md", "2026-10-22 삭제(#368) — architecture.md §1 이 출처로 언급"],
]);
// 날짜 · 번호 자리표시(`docs/archive/audit/YYYY-MM-DD-hhmmss.md`)는 실제 경로가 아니다.
const PLACEHOLDER = /YYYY|hhmmss|NNN/;
// `rev:path`(git show 243bf83^:docs/worklog.md)는 리비전 안의 경로라 앞에 `:` 이 오면 뺀다.
const DOCS_PATH = /(?<![\w/.:-])(docs\/[A-Za-z0-9_./-]*[A-Za-z0-9_/-])(\*[\w.*{},-]*)?/g;

/** 마지막 경로 조각의 `*` · `{a,b}` 를 풀어 그 디렉터리에 맞는 파일이 하나라도 있는지. */
function globExists(pattern) {
  const dir = path.posix.dirname(pattern);
  const body = path.posix
    .basename(pattern)
    .replace(/[.+?^$()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\{([^}]*)\}/g, (_, alts) => `(${alts.split(",").join("|")})`);
  const re = new RegExp(`^${body}$`);
  return exists(dir) && fs.readdirSync(rel(dir)).some((n) => re.test(n));
}

test("본문에 적은 docs/ 경로가 실재한다", () => {
  const bad = [];
  for (const { at, m } of matches(FILES, DOCS_PATH)) {
    const p = m[1] + (m[2] ?? "");
    if (PLACEHOLDER.test(p) || RETIRED.has(p)) continue;
    if (!(m[2] ? globExists(p) : exists(p))) bad.push(`${at}: ${p}`);
  }
  assert.deepEqual(bad, [], `없는 경로 — 옮겼으면 고치고, 일부러 지운 파일의 이력 언급이면 RETIRED 에 더한다:\n${bad.join("\n")}`);
});

// ── 3. 마크다운 상대 링크 ──

test("마크다운 상대 링크가 실재하는 파일을 가리킨다", () => {
  const bad = [];
  for (const f of FILES.filter((f) => f.endsWith(".md"))) {
    let fence = false;
    for (const [i, raw] of LINES[f].entries()) {
      if (/^\s*```/.test(raw)) fence = !fence;
      if (fence) continue;
      for (const m of stripInlineCode(raw).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1].split("#")[0];
        if (!target || /^(https?:|mailto:)/.test(m[1])) continue;
        if (!exists(path.posix.join(path.posix.dirname(f), target))) bad.push(`${f}:${i + 1}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(bad, [], `깨진 상대 링크:\n${bad.join("\n")}`);
});

// ── 4. docs/index.md ──

test("docs/index.md 가 인용한 파일과 ADR 이 실재한다", () => {
  const index = fs.readFileSync(rel("docs/index.md"), "utf8");
  const bad = [];
  for (const [, code] of index.matchAll(/`([^`\s]+)`/g)) {
    const p = code.split("#")[0];
    if (!/^[\w.][\w./*-]*(\.(md|js|py|sh|json)|\/)$/.test(p) || PLACEHOLDER.test(p)) continue;
    const found = [path.posix.join("docs", p), p].some((c) => (c.includes("*") ? globExists(c) : exists(c)));
    if (!found) bad.push(code);
  }
  const adrs = fs.readdirSync(rel("docs/decisions")).map((n) => n.slice(0, 3));
  for (const [, n] of index.matchAll(/ADR-(\d{3})/g)) if (!adrs.includes(n)) bad.push(`ADR-${n}`);
  assert.deepEqual(bad, [], `index.md 가 없는 파일을 가리킨다:\n${bad.join("\n")}`);
});
