// ── 교회력 설계 문서의 교차 참조 검사 ────────────────────────────────────────
// Run with: node --test tests/unit/docs-crossref.test.js
//
// 대상: 설계서 · 검토 문서 · ADR-036/037/038(앵커를 내고 참조도 한다) + status.md · architecture.md
// (참조만 한다 — 읽기 전용 참조원). 번호 부여 규약은 설계서 §1.4 가 정본이다.
//
// 무엇을 잡나 —
//   1. 참조가 실재하는 앵커를 가리키는가: `§n.m`(문서 한정어 우선 → 자기 문서 → 설계서 → 검토 문서),
//      `미결n`(한정어 → 자기 문서의 미결 목록 → 설계서 §9), `C-/X-/I-/Qn` → 검토 문서,
//      `R-<§>-<slug>` → 설계서 정본 마커, `T-/O-/A-/W-<날짜>-<slug>` → 픽스처.
//   2. 번호 불변: 설계서 § 헤딩 집합과 §9 항목 1..N(연속) · ADR 「미결 사항」 항목 수가 상수와 같다 —
//      번호 재부여·재사용을 막고, 미결 번호가 설계서 §9 에서만 발급되게 한다.
//   3. 정본 마커는 문서 전체에서 정확히 1회 정의된다.
//   4. (PR ②~④ 에서 켠다 — 아래 GATES) 센티널 문자열 단일성 · 동그라미 참조 금지 · Qn/ADR 미결 참조 금지 ·
//      편집 원칙(개정 블록 · 취소선 · 해소/재개/정정 꼬리표 0).
// 한정어 없는 참조가 자기 문서와 설계서 양쪽에서 풀리면 **경고**로만 낸다(t.diagnostic) — ②~④ 에서 한정어를 보강한다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const rel = (p) => path.join(ROOT, p);

// PR 단계별 게이트 — 켤 때 주석의 PR 번호를 지운다.
const GATES = {
  sentinels: false,        // PR ②: 센티널 문자열은 정본 파일 한 곳에만
  circledRefs: false,      // PR ②: `§6.2 ④` · `X-10 ②` · `§7 ⑩` 형식 참조 0
  qRefs: false,            // PR ③: `Qn` 참조는 검토 문서 §6 대응표 줄을 빼고 0
  adrIssueRefs: false,     // PR ④: `ADR-03[678] 미결n` 참조는 ADR 미결 절 대응표 줄을 빼고 0
  editingPrinciple: false, // PR ④: 5문서에 `> **개정 (` · `~~` · 「해소/재개/정정」 꼬리표 0
};

const DOCS = {
  설계서: "docs/design/liturgical-engine.md",
  "검토 문서": "docs/design/liturgical-engine-review.md",
  "ADR-036": "docs/decisions/036-liturgical-calendar-data-model.md",
  "ADR-037": "docs/decisions/037-eucharist-lectionary-data-and-engine.md",
  "ADR-038": "docs/decisions/038-calendar-lectionary-ui.md",
};
const SOURCES = { "status.md": "docs/status.md", "architecture.md": "docs/architecture.md" };
const FIXTURE_DIR = "tests/fixtures/liturgical";

// 번호 불변 상수 — 절을 말미에 더하거나 미결을 발급하면 여기도 함께 고친다(그게 규약이다).
const DESIGN_SECTIONS = [
  "1", "1.1", "1.2", "1.3", "1.4", "2", "3", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6",
  "4", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10",
  "5", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "6", "6.1", "6.2", "6.3", "6.4", "6.5", "7", "8", "9",
];
const DESIGN_ISSUE_MAX = 33;
const ADR_ISSUE_COUNT = { "ADR-036": 13, "ADR-037": 8, "ADR-038": 3 };

const text = Object.fromEntries(
  Object.entries({ ...DOCS, ...SOURCES }).map(([k, p]) => [k, fs.readFileSync(rel(p), "utf8")]),
);
const lines = Object.fromEntries(Object.entries(text).map(([k, t]) => [k, t.split("\n")]));

// ── 앵커 수집 ──

function sectionsOf(doc) {
  const out = new Set();
  for (const m of text[doc].matchAll(/^#{2,4} (\d+(?:\.\d+|-\d+)?)\.?\s/gm)) out.add(m[1]);
  return out;
}
function issuesOf(doc) {
  const t = text[doc];
  const start = doc === "설계서" ? t.indexOf("\n## 9. ") : t.indexOf("\n## 미결 사항");
  if (start < 0) return null;
  const body = t.slice(start + 1);
  const end = body.indexOf("\n## ", 1);
  const sec = end < 0 ? body : body.slice(0, end);
  return new Set([...sec.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])));
}
const SECTIONS = Object.fromEntries(Object.keys(DOCS).map((d) => [d, sectionsOf(d)]));
const ISSUES = Object.fromEntries(Object.keys(DOCS).map((d) => [d, issuesOf(d)]));
const CHECKS = new Set(
  [...text["검토 문서"].matchAll(/\*\*((?:C-(?:P|\d+(?:\.\d+)?)|X|I)-\d+[a-z]?)\*\*/g)].map((m) => m[1]),
);
const Q_ROWS = new Set([...text["검토 문서"].matchAll(/^\| \*\*(Q\d+)\*\*/gm)].map((m) => m[1]));
const R_DEFS = new Map();
for (const [doc, t] of Object.entries(text))
  for (const m of t.matchAll(/\*\*\[(R-\d+(?:\.\d+)?-[a-z0-9-]+)\]\*\*/g))
    R_DEFS.set(m[1], [...(R_DEFS.get(m[1]) ?? []), doc]);
const FIXTURE_IDS = new Set();
for (const f of fs.readdirSync(rel(FIXTURE_DIR)).filter((f) => f.endsWith(".json")))
  for (const c of JSON.parse(fs.readFileSync(rel(path.join(FIXTURE_DIR, f)), "utf8")).cases) FIXTURE_IDS.add(c.id);

// ── 참조 해석 ──

/** 매치 앞의 한정어를 찾는다 — `·`/`,` 로 이어진 참조 사슬(`ADR-036 §5·미결8·미결13`)은 건너뛰고,
 *  사슬 바로 앞에 붙어 있는 한정어만 인정한다(16자 안이라도 떨어져 있으면 무시 — 「검토 문서 Q11 · §9 미결10」의 §9 는 자기 문서). */
const RUN_RE = /(?:(?:§\d+(?:\.\d+|-\d+)?|미결\d+|[①-⑳])[\s·,~]*)+$/;
const QUAL_RE = /(설계서|설계 문서|검토 문서|본 문서|본 ADR|본 설계|이 문서|ADR-\d{3}|[\w-]+\.md|pitfalls|README|전사|기도서)\s*[(（]?\s*$/;
function qualifierBefore(line, idx) {
  const before = line.slice(0, idx);
  const run = RUN_RE.exec(before);
  const head = run ? before.slice(0, run.index) : before;
  const m = QUAL_RE.exec(head.slice(-24));
  if (!m) return null;
  const q = m[1];
  if (/\.md$|pitfalls|README|전사|기도서/.test(q)) return "external";
  if (q.startsWith("ADR-")) return DOCS[q] ? q : "external";
  if (q === "설계서" || q === "설계 문서") return "설계서";
  if (q === "검토 문서") return "검토 문서";
  return "self";
}

const unresolved = [];
const warnings = [];
function note(kind, doc, ln, ref, target) { unresolved.push(`${DOCS[doc] ?? SOURCES[doc]}:${ln}: ${ref} → ${target} (${kind})`); }
function warn(msg) { warnings.push(msg); }

function resolveSection(doc, ln, line, m) {
  const q = qualifierBefore(line, m.index);
  if (q === "external") return;
  const sec = m[1];
  const self = DOCS[doc] ? doc : null;
  if (q && q !== "self") {
    if (!SECTIONS[q].has(sec)) note("절", doc, ln, `§${sec}`, q);
    return;
  }
  if (q === "self" || (q === null && self)) {
    if (self && SECTIONS[self].has(sec)) {
      if (q === null && self !== "설계서" && SECTIONS["설계서"].has(sec))
        warn(`${DOCS[doc]}:${ln}: 한정어 없는 §${sec} — ${self} 와 설계서 양쪽에 있다`);
      return;
    }
    if (q === "self") { note("절", doc, ln, `§${sec}`, self); return; }
  }
  // 한정어 없음 · 자기 문서에 없음(또는 참조원) → 설계서 → 검토 문서 → ADR 순으로 찾고 경고한다.
  // (ADR-037 §1 의 「§10 "잠정 순번 id 금지"」처럼 남의 절을 한정어 없이 가리키는 곳이 있다 — PR ④ 에서 보강)
  for (const other of ["설계서", "검토 문서", "ADR-036", "ADR-037", "ADR-038"]) {
    if (other === self || !SECTIONS[other].has(sec)) continue;
    if (self || other !== "설계서") warn(`${DOCS[doc] ?? SOURCES[doc]}:${ln}: 한정어 없는 §${sec} — 자기 문서에 없어 ${other}로 풀었다`);
    return;
  }
  note("절", doc, ln, `§${sec}`, self ?? "설계서");
}

function resolveIssue(doc, ln, line, m) {
  const q = qualifierBefore(line, m.index);
  if (q === "external") return;
  const n = Number(m[1]);
  const self = DOCS[doc] ? doc : null;
  const has = (d) => ISSUES[d] && ISSUES[d].has(n);
  if (q && q !== "self") {
    if (!has(q)) note("미결", doc, ln, `미결${n}`, q);
    return;
  }
  if (self && ISSUES[self]) {
    if (has(self)) {
      if (q === null && self !== "설계서" && has("설계서"))
        warn(`${DOCS[doc]}:${ln}: 한정어 없는 미결${n} — ${self} 와 설계서 양쪽에 있다`);
      return;
    }
    if (q === "self") { note("미결", doc, ln, `미결${n}`, self); return; }
  }
  if (has("설계서")) {
    if (self && self !== "설계서" && ISSUES[self]) warn(`${DOCS[doc]}:${ln}: 한정어 없는 미결${n} — ${self} 에 없어 설계서로 풀었다`);
    return;
  }
  note("미결", doc, ln, `미결${n}`, self ?? "설계서");
}

for (const doc of Object.keys({ ...DOCS, ...SOURCES })) {
  const isSource = !DOCS[doc];
  lines[doc].forEach((line, i) => {
    const ln = i + 1;
    for (const m of line.matchAll(/§(\d+(?:\.\d+|-\d+)?)/g)) resolveSection(doc, ln, line, m);
    for (const m of line.matchAll(/미결(\d+)/g)) resolveIssue(doc, ln, line, m);
    if (isSource) return;
    for (const m of line.matchAll(/(?<![\w-])(C-(?:P|\d+(?:\.\d+)?)-\d+[a-z]?|X-\d+|I-\d+[ab]?)(?![\w-])/g))
      if (!CHECKS.has(m[1])) note("검증 항목", doc, ln, m[1], "검토 문서");
    for (const m of line.matchAll(/(?<![\w-])(Q\d+)(?![\w-])/g))
      if (!Q_ROWS.has(m[1])) note("사제 질문", doc, ln, m[1], "검토 문서 §6");
    for (const m of line.matchAll(/(?<![\w[-])(R-\d+(?:\.\d+)?-[a-z0-9-]+)/g))
      if (!R_DEFS.has(m[1])) note("정본 마커", doc, ln, m[1], "설계서");
    for (const m of line.matchAll(/(?<![\w-])([TOAW]-\d{4}-\d{2}-\d{2}-[a-z0-9-]+)/g))
      if (!FIXTURE_IDS.has(m[1])) note("픽스처", doc, ln, m[1], FIXTURE_DIR);
  });
}

// ── 테스트 ──

test("모든 §·미결·C/X/I/Q·R-·픽스처 참조가 실재하는 앵커를 가리킨다", (t) => {
  if (warnings.length) t.diagnostic(`한정어 없는 참조 경고 ${warnings.length}건 (첫 8):\n  ${warnings.slice(0, 8).join("\n  ")}`);
  assert.deepEqual(unresolved, [], `풀리지 않는 참조 ${unresolved.length}건:\n  ${unresolved.join("\n  ")}`);
});

test("설계서 § 헤딩 집합이 상수와 같다 — 절은 말미 추가만, 번호 재부여 금지", () => {
  assert.deepEqual([...SECTIONS["설계서"]], DESIGN_SECTIONS);
});

test("설계서 §9 항목이 1..N 연속이고 N ≥ 33 — 번호 재사용 금지", () => {
  const nums = [...ISSUES["설계서"]].sort((a, b) => a - b);
  assert.ok(nums.length >= DESIGN_ISSUE_MAX, `§9 항목 수 ${nums.length} < ${DESIGN_ISSUE_MAX}`);
  assert.deepEqual(nums, nums.map((_, i) => i + 1), "§9 항목 번호가 연속이 아니다");
});

test("ADR 「미결 사항」 항목 수가 상수와 같다 — 미결 번호는 설계서 §9 에서만 발급한다", () => {
  for (const [adr, n] of Object.entries(ADR_ISSUE_COUNT))
    assert.equal(ISSUES[adr]?.size ?? 0, n, `${adr} 미결 항목 수 — 새 물음은 설계서 §9 에 발급하고 여기서는 번호로 가리킬 것`);
});

test("정본 마커 R- 는 문서 전체에서 정확히 1회 정의된다", () => {
  const dup = [...R_DEFS].filter(([, docs]) => docs.length !== 1).map(([id, docs]) => `${id}: ${docs.join(", ")}`);
  assert.deepEqual(dup, [], `정의가 1회가 아닌 마커:\n  ${dup.join("\n  ")}`);
  const outside = [...R_DEFS].filter(([, docs]) => docs[0] !== "설계서").map(([id]) => id);
  assert.deepEqual(outside, [], "R- 마커는 설계서 §4·§6 에서만 발급한다");
  const wrongSection = [...R_DEFS.keys()].filter((id) => !/^R-(4|6)\.\d+-/.test(id));
  assert.deepEqual(wrongSection, [], "R- 마커의 절 번호는 4.x · 6.x 여야 한다");
});

test("센티널 문자열은 정본 파일 한 곳에만 있다", { skip: GATES.sentinels ? false : "PR ② 에서 켠다" }, () => {
  // 정본에서만 허용되는 문장 조각 — 켤 때 채운다.
  const SENTINELS = [
    { text: "02.14 발렌틴 ∧ 키릴", allow: ["설계서"], once: true },
    { text: "유효 precedence 9", allow: ["설계서"] },
    { text: "```facts", allow: ["설계서"], once: true },
  ];
  const bad = [];
  for (const s of SENTINELS)
    for (const [doc, t] of Object.entries(text)) {
      const n = t.split(s.text).length - 1;
      if (n && !s.allow.includes(doc)) bad.push(`${s.text} in ${doc} ×${n}`);
      if (s.once && s.allow.includes(doc) && n !== 1) bad.push(`${s.text} in ${doc} ×${n} (1회여야)`);
    }
  assert.deepEqual(bad, []);
});

test("동그라미 숫자 참조 형식이 없다", { skip: GATES.circledRefs ? false : "PR ② 에서 켠다" }, () => {
  const bad = [];
  for (const doc of Object.keys(DOCS))
    lines[doc].forEach((line, i) => {
      for (const m of line.matchAll(/(§\d+(?:\.\d+)? [①-⑳]|X-\d+ [①-⑳]|미결\d+ [①-⑳])/g)) bad.push(`${DOCS[doc]}:${i + 1}: ${m[1]}`);
    });
  assert.deepEqual(bad, []);
});

test("Qn 참조는 검토 문서 §6 대응표 줄을 빼고 없다", { skip: GATES.qRefs ? false : "PR ③ 에서 켠다" }, () => {
  const bad = [];
  for (const doc of Object.keys(DOCS))
    lines[doc].forEach((line, i) => {
      if (/Q→미결 대응|Q1→17/.test(line)) return;
      if (/(?<![\w-])Q\d+(?![\w-])/.test(line)) bad.push(`${DOCS[doc]}:${i + 1}`);
    });
  assert.deepEqual(bad, []);
});

test("ADR 미결 번호 참조는 ADR 미결 절 대응표 줄을 빼고 없다", { skip: GATES.adrIssueRefs ? false : "PR ④ 에서 켠다" }, () => {
  const bad = [];
  for (const doc of Object.keys(DOCS))
    lines[doc].forEach((line, i) => {
      if (/대응표|↔/.test(line)) return;
      if (/ADR-03[678] 미결\d+/.test(line)) bad.push(`${DOCS[doc]}:${i + 1}`);
    });
  assert.deepEqual(bad, []);
});

test("편집 원칙 — 개정 블록 · 취소선 · 해소/재개/정정 꼬리표가 없다", { skip: GATES.editingPrinciple ? false : "PR ④ 에서 켠다" }, () => {
  const bad = [];
  for (const doc of Object.keys(DOCS))
    lines[doc].forEach((line, i) => {
      if (/^> \*\*개정 \(|~~|\*\*(해소|재개|정정|재해소) (\d{4}-\d{2}-\d{2}|\()/.test(line)) bad.push(`${DOCS[doc]}:${i + 1}`);
    });
  assert.deepEqual(bad, []);
});
