// ── 교회력 설계 문서의 교차 참조 검사 ────────────────────────────────────────
// Run with: node --test tests/unit/docs-crossref.test.js
//
// 대상: 설계서 · 검토 문서 · ADR-036/037/038(앵커를 내고 참조도 한다) + status.md · architecture.md
// (참조만 한다 — 읽기 전용 참조원이지만 **같은 참조 검사를 전부 받는다**). 번호 부여 규약은 설계서 §1.4 가 정본이다.
//
// 무엇을 잡나 —
//   1. 참조가 실재하는 앵커를 가리키는가: `§n.m`(문서 한정어 우선 → 자기 문서 → 설계서 → 검토 문서 → ADR),
//      `미결n`(한정어 → 자기 문서의 미결 목록 → 설계서 §9), `C-/X-/I-/Qn` → 검토 문서,
//      `R-<§>-<slug>` → 설계서 정본 마커, `T-/O-/A-/W-<날짜>-<slug>` → 픽스처.
//   2. 번호 불변: 설계서 § 헤딩 목록과 §9 항목(§9.1 열림 + §9.2 닫힘 = 1..N, 중복 없음, 각 목록 번호순 · §9.2 는
//      한 줄 + 닫힘 날짜) · ADR 「미결 사항」 항목 수가 상수와 같다 — 번호 재부여·재사용을 막고, 미결 번호가
//      설계서 §9 에서만 발급되게 한다.
//   3. 정본 마커는 문서 전체에서 정확히 1회 정의된다.
//   4. (아래 GATES — ② 부터 문서 단위로 켠다) 센티널 문자열 단일성 · 동그라미 참조 금지 · Qn/ADR 미결 참조 금지 ·
//      편집 원칙(개정 블록 · 취소선 · 해소/재개/정정 꼬리표 0). 표기 금지 게이트는 **인라인 코드를 뺀 산문**만
//      본다(docs-anchors.js `stripInlineCode`) — §1.4 가 규약을 정의하며 금지 표기를 코드로 인용하기 때문이다.
//      점-시점 보관 문서(docs/archive/design/liturgical-engine-*.md)는 원장과 같은 층이라 검사 대상이 아니다.
// 한정어 없는 참조가 자기 문서와 설계서 양쪽에서 풀리면 **경고**로만 낸다(t.diagnostic) — ②~④ 에서 한정어를 보강한다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkIds, issueNumbers, rMarkerDefs, sectionList, stripInlineCode } from "./docs-anchors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const rel = (p) => path.join(ROOT, p);

// PR 단계별 게이트 — 센티널은 전 문서를 한꺼번에 보고(정본 밖에 있으면 안 되므로), 표기 금지 게이트 넷은
// **문서 목록**으로 켠다: 그 PR 이 정리한 문서부터 지키고, 다음 PR 이 자기 문서를 더한다(② 설계서 → ③ 검토 문서 → ④ ADR).
const GATES = {
  sentinels: true,                      // ②: 센티널 문자열은 정본(설계서) 한 곳에만
  circledRefs: ["설계서"],              // ②: `§6.2 ④` · `X-10 ②` · `§7 ⑩` 형식 참조 0 — ③ 검토 문서 · ④ ADR 추가
  qRefs: ["설계서"],                    // ②: `Qn` 참조는 §1.4 의 Q→미결 대응표 줄을 빼고 0 — ③ 검토 문서(§6 대응표) · ADR 추가
  adrIssueRefs: [],                     // PR ④: `ADR-03[678] 미결n` 참조는 ADR 미결 절 대응표 줄을 빼고 0
  editingPrinciple: ["설계서"],         // ②: `> **개정 (` · `~~` · 「해소/재개/정정」 꼬리표 0 — ④ 검토 문서 · ADR 추가
};
const gateDocs = (names) => (names.length ? names : "다음 PR 에서 켠다");

const DOCS = {
  설계서: "docs/design/liturgical-engine.md",
  "검토 문서": "docs/design/liturgical-engine-review.md",
  "ADR-036": "docs/decisions/036-liturgical-calendar-data-model.md",
  "ADR-037": "docs/decisions/037-eucharist-lectionary-data-and-engine.md",
  "ADR-038": "docs/decisions/038-calendar-lectionary-ui.md",
};
const SOURCES = { "status.md": "docs/status.md", "architecture.md": "docs/architecture.md" };
// 파일명 한정어(`liturgical-engine.md §3.4` · `(docs/design/liturgical-engine-review.md) §5.11`)를 추적 대상 문서로 되돌리는 역인덱스.
const BY_BASENAME = Object.fromEntries(Object.entries(DOCS).map(([k, p]) => [path.basename(p), k]));
const FIXTURE_DIR = "tests/fixtures/liturgical";

// 번호 불변 상수 — 절을 말미에 더하거나 미결을 발급하면 여기도 함께 고친다(그게 규약이다).
const DESIGN_SECTIONS = [
  "1", "1.1", "1.2", "1.3", "1.4", "2", "3", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6",
  "4", "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10",
  "5", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "6", "6.1", "6.2", "6.3", "6.4", "6.5", "7", "8", "9", "9.1", "9.2",
];
const DESIGN_ISSUE_MAX = 33;
const ADR_ISSUE_COUNT = { "ADR-036": 13, "ADR-037": 8, "ADR-038": 3 };

const text = Object.fromEntries(
  Object.entries({ ...DOCS, ...SOURCES }).map(([k, p]) => [k, fs.readFileSync(rel(p), "utf8")]),
);
const lines = Object.fromEntries(Object.entries(text).map(([k, t]) => [k, t.split("\n")]));
// 표기 금지 게이트가 보는 본문 — 인라인 코드를 뺀 산문(줄 단위, 줄 번호 보존).
const prose = Object.fromEntries(Object.entries(lines).map(([k, ls]) => [k, ls.map(stripInlineCode)]));

// ── 앵커 수집 — 추출 문법은 docs-anchors.js 가 정본이다(사본을 두지 않는다) ──

const issueHeading = (doc) => (doc === "설계서" ? "\n## 9. " : "\n## 미결 사항");
const DESIGN_SECTION_LIST = sectionList(text["설계서"]);
const SECTIONS = Object.fromEntries(Object.keys(DOCS).map((d) => [d, new Set(sectionList(text[d]))]));
// 미결 번호는 **목록**(문서 순서 · 중복 포함) — 재사용된 번호를 집합이 삼키지 않게.
const ISSUES = Object.fromEntries(Object.keys(DOCS).map((d) => [d, issueNumbers(text[d], issueHeading(d))]));
const CHECKS = checkIds(text["검토 문서"]);
const Q_ROWS = new Set([...text["검토 문서"].matchAll(/^\| \*\*(Q\d+)\*\*/gm)].map((m) => m[1]));
const R_DEFS = rMarkerDefs(text);
const FIXTURE_IDS = new Set();
for (const f of fs.readdirSync(rel(FIXTURE_DIR)).filter((f) => f.endsWith(".json")))
  for (const c of JSON.parse(fs.readFileSync(rel(path.join(FIXTURE_DIR, f)), "utf8")).cases) FIXTURE_IDS.add(c.id);

// ── 참조 해석 ──

/** 매치 앞의 한정어를 찾는다 — `·`/`,` 로 이어진 참조 사슬(`ADR-036 §5·미결8·미결13`)은 건너뛰고,
 *  사슬 **바로 앞에 붙어 있는** 한정어만 인정한다(떨어져 있으면 무시 — 「검토 문서 Q11 · §9 미결10」의 §9 는 자기 문서).
 *  끝에 닿아 있기만 하면 길이는 보지 않는다 — `liturgical-engine-review.md` 처럼 긴 파일명도 한정어다. 파일명은
 *  역따옴표 · 마크다운 링크의 닫는 괄호에 싸여 있어도 된다. */
const RUN_RE = /(?:(?:§\d+(?:\.\d+|-\d+)?|미결\d+|[①-⑳])[\s·,~]*)+$/;
const QUAL_RE = /(설계서|설계 문서|검토 문서|본 문서|본 ADR|본 설계|이 문서|ADR-\d{3}|[\w./-]+\.md|pitfalls|README|전사|기도서)[`)\]]*\s*[()（）]?\s*$/;
function qualifierBefore(line, idx) {
  const before = line.slice(0, idx);
  const run = RUN_RE.exec(before);
  const head = run ? before.slice(0, run.index) : before;
  const m = QUAL_RE.exec(head);
  if (!m) return null;
  const q = m[1];
  // 파일명 한정어는 추적 대상 5문서면 그 문서로 푼다 — `liturgical-engine.md §3.4` 는 외부 참조가 아니다.
  if (/\.md$/.test(q)) return BY_BASENAME[path.basename(q)] ?? "external";
  if (/pitfalls|README|전사|기도서/.test(q)) return "external";
  if (q.startsWith("ADR-")) return DOCS[q] ? q : "external";
  if (q === "설계서" || q === "설계 문서") return "설계서";
  if (q === "검토 문서") return "검토 문서";
  return "self";
}

const unresolved = [];
const warnings = [];
const fileOf = (doc) => DOCS[doc] ?? SOURCES[doc];
function note(kind, doc, ln, ref, target) { unresolved.push(`${fileOf(doc)}:${ln}: ${ref} → ${target} (${kind})`); }
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
        warn(`${fileOf(doc)}:${ln}: 한정어 없는 §${sec} — ${self} 와 설계서 양쪽에 있다`);
      return;
    }
    if (q === "self") { note("절", doc, ln, `§${sec}`, self); return; }
  }
  // 한정어 없음 · 자기 문서에 없음(또는 참조원) → 설계서 → 검토 문서 → ADR 순으로 찾고 경고한다.
  // (ADR-037 §1 의 「§10 "잠정 순번 id 금지"」처럼 남의 절을 한정어 없이 가리키는 곳이 있다 — PR ④ 에서 보강)
  for (const other of ["설계서", "검토 문서", "ADR-036", "ADR-037", "ADR-038"]) {
    if (other === self || !SECTIONS[other].has(sec)) continue;
    if (self || other !== "설계서") warn(`${fileOf(doc)}:${ln}: 한정어 없는 §${sec} — 자기 문서에 없어 ${other}로 풀었다`);
    return;
  }
  note("절", doc, ln, `§${sec}`, self ?? "설계서");
}

function resolveIssue(doc, ln, line, m) {
  const q = qualifierBefore(line, m.index);
  if (q === "external") return;
  const n = Number(m[1]);
  const self = DOCS[doc] ? doc : null;
  const has = (d) => ISSUES[d] && ISSUES[d].includes(n);
  if (q && q !== "self") {
    if (!has(q)) note("미결", doc, ln, `미결${n}`, q);
    return;
  }
  if (self && ISSUES[self]) {
    if (has(self)) {
      if (q === null && self !== "설계서" && has("설계서"))
        warn(`${fileOf(doc)}:${ln}: 한정어 없는 미결${n} — ${self} 와 설계서 양쪽에 있다`);
      return;
    }
    if (q === "self") { note("미결", doc, ln, `미결${n}`, self); return; }
  }
  if (has("설계서")) {
    if (self && self !== "설계서" && ISSUES[self]) warn(`${fileOf(doc)}:${ln}: 한정어 없는 미결${n} — ${self} 에 없어 설계서로 풀었다`);
    return;
  }
  note("미결", doc, ln, `미결${n}`, self ?? "설계서");
}

// 참조원(status.md · architecture.md)도 같은 검사를 전부 받는다 — 앵커를 내지 않을 뿐, 잘못 가리키면 잡힌다.
for (const doc of Object.keys({ ...DOCS, ...SOURCES })) {
  lines[doc].forEach((line, i) => {
    const ln = i + 1;
    for (const m of line.matchAll(/§(\d+(?:\.\d+|-\d+)?)/g)) resolveSection(doc, ln, line, m);
    for (const m of line.matchAll(/미결(\d+)/g)) resolveIssue(doc, ln, line, m);
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

test("설계서 § 헤딩 목록이 상수와 같다 — 절은 말미 추가만, 번호 재부여·중복 금지", () => {
  // 집합으로 비교하면 `### 6.2` 가 둘이어도 통과한다 — 목록으로 비교해야 중복이 잡힌다.
  assert.deepEqual(DESIGN_SECTION_LIST, DESIGN_SECTIONS);
});

test("설계서 §9 — §9.1(열림)·§9.2(닫힘)을 합치면 정확히 1..N(N ≥ 33), 각 목록은 오름차순 — 번호 재사용·건너뜀 금지", () => {
  // 두 목록을 **이어 붙여** 정렬 비교한다 — 같은 번호가 둘이면 길이가 늘어 1..N 과 어긋난다(집합은 그것을 삼킨다).
  const open = issueNumbers(text["설계서"], "\n### 9.1 ");
  const closed = issueNumbers(text["설계서"], "\n### 9.2 ");
  assert.ok(open && closed, "§9.1 · §9.2 헤딩이 없다");
  const all = [...open, ...closed].sort((a, b) => a - b);
  assert.ok(all.length >= DESIGN_ISSUE_MAX, `§9 항목 수 ${all.length} < ${DESIGN_ISSUE_MAX}`);
  assert.deepEqual(all, all.map((_, i) => i + 1), "§9 항목 번호가 1..N 이 아니다(재사용 · 건너뜀 · 두 목록에 중복)");
  assert.deepEqual(open, [...open].sort((a, b) => a - b), "§9.1 이 번호순이 아니다");
  assert.deepEqual(closed, [...closed].sort((a, b) => a - b), "§9.2 가 번호순이 아니다");
  assert.deepEqual(ISSUES["설계서"], [...open, ...closed], "`## 9.` 전체 목록이 두 소절의 합과 다르다 — 소절 밖에 항목이 있다");
});

test("설계서 §9.1 열림 항목은 일곱 필드(상태 · 확인 주체 · 질문 · 구체 예 · 잠정 답 · 뒤집히면/닫히면 · 정본)를 전부 가진다", () => {
  const t = text["설계서"];
  const start = t.indexOf("\n### 9.1 ");
  assert.ok(start >= 0, "§9.1 헤딩이 없다");
  const body = t.slice(start + 1).split(/\n#{1,3} /)[0].split("\n");
  const FIELDS = [["상태:", /상태:/], ["확인 주체:", /확인 주체:/], ["질문:", /질문:/], ["구체 예", /구체 예(\(|:)/],
    ["잠정 답", /잠정 답(\(|:)/], ["뒤집히면/닫히면", /(뒤집히면|닫히면)/], ["정본:", /정본:/]];
  const bad = [];
  for (const line of body) {
    const m = /^- \*\*미결(\d+)\*\*/.exec(line);
    if (!m) continue;
    const missing = FIELDS.filter(([, re]) => !re.test(line)).map(([name]) => name);
    if (missing.length) bad.push(`미결${m[1]}: ${missing.join(" · ")} 없음`);
  }
  assert.deepEqual(bad, [], `§9 머리의 필드 규약 위반:\n  ${bad.join("\n  ")}`);
});

test("설계서 §9.2 닫힘 항목은 한 줄이고 `닫힘(YYYY-MM-DD)` 을 적는다 — 전문은 §9.1 에서 옮길 때 한 줄로 줄인다", () => {
  const t = text["설계서"];
  const start = t.indexOf("\n### 9.2 ");
  assert.ok(start >= 0, "§9.2 헤딩이 없다");
  const body = t.slice(start + 1).split(/\n#{1,3} /)[0].split("\n").slice(1);
  const bad = [];
  body.forEach((line, i) => {
    if (!line.trim()) return;
    if (!/^- \*\*미결\d+/.test(line)) { bad.push(`${i + 1}: 항목 줄이 아니다 — ${line.slice(0, 40)}…`); return; }
    // `제목 — 닫힘(YYYY-MM-DD) · ` 가 머리에 와야 한다 — 괄호 안은 날짜뿐(누가 정했는지 · 데이터 PR 같은 주석은 결론 · 근거 필드로).
    if (!/^- \*\*미결\d+\*\* \*\*[^*]+\*\* — 닫힘\(\d{4}-\d{2}-\d{2}\) · /.test(line)) bad.push(`${i + 1}: 「제목 — 닫힘(YYYY-MM-DD) · 」 형식이 아니다 — ${line.slice(0, 60)}…`);
  });
  assert.deepEqual(bad, [], `§9.2 형식 위반:\n  ${bad.join("\n  ")}`);
});

test("ADR 「미결 사항」 항목 수가 상수와 같고 번호가 겹치지 않는다 — 미결 번호는 설계서 §9 에서만 발급한다", () => {
  for (const [adr, n] of Object.entries(ADR_ISSUE_COUNT)) {
    const list = ISSUES[adr] ?? [];
    assert.equal(list.length, n, `${adr} 미결 항목 수 — 새 물음은 설계서 §9 에 발급하고 여기서는 번호로 가리킬 것`);
    assert.equal(new Set(list).size, list.length, `${adr} 미결 번호가 겹친다: ${list}`);
  }
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
  // 정본 문장(R- 마커가 붙은 문장)에만 있어야 하는 조각 — 다른 곳에 또 나오면 사실이 두 번 적힌 것이다.
  // 인라인 코드 안의 인용(§1.4 의 ``` ```facts ```)은 세지 않는다. 조각을 고치면 정본 문장도 함께 고친다.
  const SENTINELS = [
    { text: "02.14 발렌틴 ∧ 키릴", allow: ["설계서"], once: true },             // R-6.1-prec7-tie-pairs — 5쌍 목록의 첫 쌍
    { text: "유효 precedence 9", allow: ["설계서"], once: true },                // R-6.1-ineligible
    { text: "주의 세례 주일은 연중시기의 첫날이다", allow: ["설계서"], once: true }, // R-4.5-baptism-ordinary-1
    { text: "한 열에 담고 있다", allow: ["설계서"], once: true },               // R-6.2-destinations
    { text: "수요일까지 직전, 목요일부터 다음", allow: ["설계서"], once: true },  // R-6.2-nearby-sunday — 경계
    { text: "lectionarypage.net 2025~2027", allow: ["설계서"], once: true },     // R-6.2-chain-model — 연쇄 모델의 근거
    { text: "도착한 축일은 품계와 무관하게 자리를 지킨다", allow: ["설계서"], once: true }, // R-6.2-first-come
    { text: "규칙일 유지 · 고정일 이동", allow: ["설계서"], once: true },        // R-6.2-rule-day-stays
    { text: "절기 기본색을 깔고", allow: ["설계서"], once: true },               // R-6.4-color-order
    { text: "사계재 날의 색은 승자(절기 평일)의 절기색", allow: ["설계서"], once: true }, // R-6.4-ember-color
    { text: "연도 캐시를 채울 때 한 번", allow: ["설계서"], once: true },        // R-6.5-year-pass
    { text: "```facts", allow: ["설계서"], once: true },                         // §5.2 실측 블록
  ];
  const bad = [];
  for (const s of SENTINELS)
    for (const [doc, ls] of Object.entries(prose)) {
      const n = ls.join("\n").split(s.text).length - 1;
      if (n && !s.allow.includes(doc)) bad.push(`${s.text} in ${doc} ×${n}`);
      if (s.once && s.allow.includes(doc) && n !== 1) bad.push(`${s.text} in ${doc} ×${n} (1회여야)`);
    }
  assert.deepEqual(bad, []);
});

test("동그라미 숫자 참조 형식이 없다", { skip: GATES.circledRefs.length ? false : gateDocs(GATES.circledRefs) }, () => {
  const bad = [];
  for (const doc of GATES.circledRefs)
    prose[doc].forEach((line, i) => {
      for (const m of line.matchAll(/(§\d+(?:\.\d+)? [①-⑳]|X-\d+ [①-⑳]|미결\d+ [①-⑳])/g)) bad.push(`${DOCS[doc]}:${i + 1}: ${m[1]}`);
    });
  assert.deepEqual(bad, [], `동그라미 참조 ${bad.length}건 — R- 마커 · 픽스처 id · 항목 이름으로 바꿀 것:\n  ${bad.join("\n  ")}`);
});

test("Qn 참조는 Q→미결 대응표 줄을 빼고 없다", { skip: GATES.qRefs.length ? false : gateDocs(GATES.qRefs) }, () => {
  const bad = [];
  for (const doc of GATES.qRefs)
    prose[doc].forEach((line, i) => {
      if (/Q→미결 대응|Q1→17/.test(line)) return;
      if (/(?<![\w-])Q\d+(?![\w-])/.test(line)) bad.push(`${DOCS[doc]}:${i + 1}`);
    });
  assert.deepEqual(bad, [], `Qn 참조 ${bad.length}건 — 미결n 으로:\n  ${bad.join("\n  ")}`);
});

test("ADR 미결 번호 참조는 ADR 미결 절 대응표 줄을 빼고 없다", { skip: GATES.adrIssueRefs.length ? false : "PR ④ 에서 켠다" }, () => {
  const bad = [];
  for (const doc of GATES.adrIssueRefs)
    prose[doc].forEach((line, i) => {
      if (/대응표|↔/.test(line)) return;
      if (/ADR-03[678] 미결\d+/.test(line)) bad.push(`${DOCS[doc]}:${i + 1}`);
    });
  assert.deepEqual(bad, []);
});

test("편집 원칙 — 개정 블록 · 취소선 · 해소/재개/정정 꼬리표가 없다", { skip: GATES.editingPrinciple.length ? false : gateDocs(GATES.editingPrinciple) }, () => {
  const bad = [];
  for (const doc of GATES.editingPrinciple)
    prose[doc].forEach((line, i) => {
      if (/^> \*\*개정 \(|~~|\*\*(해소|재개|정정|재해소) (\d{4}-\d{2}-\d{2}|\()/.test(line)) bad.push(`${DOCS[doc]}:${i + 1}`);
    });
  assert.deepEqual(bad, [], `편집 원칙 위반 ${bad.length}건 — 본문을 현재 결론으로 고치고 버린 선택지는 §9.2 · ADR 「검토한 대안」으로:\n  ${bad.join("\n  ")}`);
});
