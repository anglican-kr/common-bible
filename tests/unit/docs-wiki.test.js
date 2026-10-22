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
//   5. 영역 문서(docs/areas/, 규칙은 그 README) — 옛 파일의 대장 줄과 영역 문서의 정의가 하나씩 맞고, `## ` 제목이
//      정한 순서를 지키고, 「소유 코드:」의 glob 이 파일을 고르되 두 영역이 같은 파일을 소유하지 않는다.
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

// ── 영역 문서와 대장 — 아래 1 · 5 가 함께 쓴다 ──

const CP_TEXT = fs.readFileSync(rel("docs/coding-pitfalls.md"), "utf8");
const KI_TEXT = fs.readFileSync(rel("docs/known-issues.md"), "utf8");
const AREAS = fs.readdirSync(rel("docs/areas")).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
const AREA_TEXT = Object.fromEntries(AREAS.map((f) => [`areas/${f}`, fs.readFileSync(rel(`docs/areas/${f}`), "utf8")]));

// 정의 — 영역 문서의 `### pitfalls §N — 제목` · `- **known-issues §N.m** …`, 그리고 known-issues.md 에 남은 번호 붙은 항목.
const DEFS = [];
for (const [file, t] of Object.entries(AREA_TEXT)) {
  for (const m of t.matchAll(/^### pitfalls §(\d+) — /gm)) DEFS.push({ kind: "pitfalls", id: m[1], file });
  for (const m of t.matchAll(/^- \*\*known-issues §(\d+\.\d+)\*\* /gm)) DEFS.push({ kind: "known-issues", id: m[1], file });
}
for (const m of KI_TEXT.matchAll(/^- \*\*known-issues §(\d+\.\d+)\*\* /gm))
  DEFS.push({ kind: "known-issues", id: m[1], file: "known-issues.md" });

// 대장 — coding-pitfalls.md 는 절 제목 아래 「→ [areas/x.md](areas/x.md)」 한 줄, known-issues.md 는 「- §15.1 · §15.3 → [areas/x.md](…)」.
const REGISTRY = { pitfalls: new Map(), "known-issues": new Map() };
const cpHeads = [...CP_TEXT.matchAll(/^## (\d+)\. /gm)];
cpHeads.forEach((h, i) => {
  const body = CP_TEXT.slice(h.index, cpHeads[i + 1]?.index ?? CP_TEXT.length);
  const ptr = /^→ \[(areas\/[\w-]+\.md)\]/m.exec(body);
  if (ptr) REGISTRY.pitfalls.set(h[1], ptr[1]);
});
for (const m of KI_TEXT.matchAll(/^- (§\d+\.\d+(?:\s*·\s*§\d+\.\d+)*)\s*→\s*\[(areas\/[\w-]+\.md)\]/gm))
  for (const id of m[1].match(/\d+\.\d+/g)) REGISTRY["known-issues"].set(id, m[2]);

// ── 1. 옛 번호 참조 ──

const PITFALLS = new Set(cpHeads.map((m) => m[1]));
const KNOWN_ISSUES = new Set([
  ...[...KI_TEXT.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.? /gm)].map((m) => m[1]),
  ...DEFS.filter((d) => d.kind === "known-issues").map((d) => d.id),
]);
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
const DOCS_PATH = /(?<![\w/.:-])(docs\/[A-Za-z0-9_./-]*[A-Za-z0-9_/-])(\*(?:[\w.*-]|\{[^}\s]*\})*)?/g;

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

// ── 5. 영역 문서 ──

test("대장 줄과 영역 문서의 정의가 하나씩 맞는다", () => {
  const bad = [];
  const seen = new Map();
  for (const d of DEFS) {
    const key = `${d.kind} §${d.id}`;
    if (seen.has(key)) bad.push(`${key}: ${seen.get(key)} 와 ${d.file} 에 두 번 정의`);
    seen.set(key, d.file);
    if (d.file === "known-issues.md") continue;
    const reg = REGISTRY[d.kind].get(d.id);
    if (reg !== d.file) bad.push(`${key}: ${d.file} 에 정의됐지만 대장은 ${reg ?? "없음"}`);
  }
  for (const [kind, map] of Object.entries(REGISTRY))
    for (const [id, file] of map)
      if (seen.get(`${kind} §${id}`) !== file) bad.push(`${kind} §${id}: 대장은 ${file} 를 가리키지만 거기에 정의가 없다`);
  assert.deepEqual(bad, [], `대장과 정의가 어긋난다(규칙: docs/areas/README.md 「번호와 대장」):\n${bad.join("\n")}`);
});

const AREA_HEADINGS = ["지금 동작", "결정", "확정 사실", "함정", "남은 일"];
const REQUIRED_HEADINGS = ["지금 동작", "남은 일"];

test("영역 문서는 정한 틀을 지킨다 — 제목, 「소유 코드:」 줄, `## ` 제목의 종류와 순서", () => {
  const bad = [];
  for (const [file, t] of Object.entries(AREA_TEXT)) {
    if (!/^# \S/.test(t)) bad.push(`${file}: 첫 줄이 \`# 제목\`이 아니다`);
    if (!/^소유 코드: `/m.test(t)) bad.push(`${file}: 「소유 코드:」 줄이 없다`);
    const hs = [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    for (const h of hs) if (!AREA_HEADINGS.includes(h)) bad.push(`${file}: 정하지 않은 제목 「${h}」`);
    for (const h of REQUIRED_HEADINGS) if (!hs.includes(h)) bad.push(`${file}: 「${h}」이 없다`);
    const order = hs.filter((h) => AREA_HEADINGS.includes(h)).map((h) => AREA_HEADINGS.indexOf(h));
    if (order.some((v, i) => i > 0 && v <= order[i - 1])) bad.push(`${file}: 제목 순서가 ${AREA_HEADINGS.join(" → ")} 가 아니다`);
  }
  assert.ok(AREAS.length > 0, "docs/areas/ 에 영역 문서가 없다");
  assert.deepEqual(bad, [], bad.join("\n"));
});

/** 「소유 코드:」의 glob — `*` 는 한 경로 조각 안, `**` 는 여러 조각. */
const globRe = (g) =>
  new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*")}$`);
const JS_FILES = FILES.filter((f) => f.startsWith("js/"));

test("영역 문서의 「소유 코드:」 glob 이 파일을 고르고, 두 영역이 같은 파일을 소유하지 않는다", () => {
  const bad = [];
  const owners = new Map();
  for (const [file, t] of Object.entries(AREA_TEXT)) {
    const line = /^소유 코드: (.+)$/m.exec(t)?.[1] ?? "";
    for (const [, g] of line.matchAll(/`([^`]+)`/g)) {
      const hit = JS_FILES.filter((f) => globRe(g).test(f));
      if (!hit.length) bad.push(`${file}: \`${g}\` 가 고르는 파일이 없다 — 파일을 옮겼으면 이 줄을 고친다`);
      for (const f of hit) owners.set(f, [...(owners.get(f) ?? []), file]);
    }
  }
  for (const [f, areas] of owners) if (areas.length > 1) bad.push(`${f}: ${areas.join(" · ")} 가 함께 소유한다`);
  assert.ok(JS_FILES.length > 30, "js/ 파일 목록을 읽지 못했다");
  assert.deepEqual(bad, [], bad.join("\n"));
});
