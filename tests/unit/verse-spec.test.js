// ── Unit tests for js/app/verse-spec.js ─────────────────────────────────────
// Run with: node --test tests/unit/verse-spec.test.js
//
// Same vm + BEGIN/END marker slice approach as bookmark-read.test.js. Covers the
// parts of the VERSE_SPEC block that are not exercised through bookmark.test.js:
// `specCoversVerse` / `chapterMaxVerse` (moved here from bookmark-read.js so the
// lectionary view can share them — ADR-038 §3), the verse-instance identity
// helpers (ADR-039 ¶ 구절 · ADR-003 에스델 추가 본문), and the verse-select citation
// that reads them off the rendered spans (selectionCitation · selectedSpanVrefs —
// known-issues §5).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(__dirname, "../../js/app/verse-spec.js"), "utf8");

function extractBlock(name, source) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) throw new Error(`marker block ${name} not found`);
  return source.slice(startIdx, endIdx + end.length);
}

const ctx = { Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error, parseInt, isNaN };
vm.createContext(ctx);
vm.runInContext(extractBlock("VERSE_SPEC", SOURCE), ctx, { filename: "verse-spec.js" });

// vm values carry the sandbox realm's prototypes, so deepStrictEqual trips on
// the cross-realm mismatch. Normalize to plain data first.
const plain = (v) => JSON.parse(JSON.stringify(v));

// ── specCoversVerse ──

test("specCoversVerse: all covers everything", () => {
  assert.strictEqual(ctx.specCoversVerse("all", 99), true);
});

test("specCoversVerse: range + hemistich membership", () => {
  assert.strictEqual(ctx.specCoversVerse("1-3,4a", 2), true);
  assert.strictEqual(ctx.specCoversVerse("1-3,4a", 4), true); // 4a promotes to verse 4
  assert.strictEqual(ctx.specCoversVerse("1-3,4a", 5), false);
});

test("specCoversVerse: an unparseable spec covers nothing", () => {
  assert.strictEqual(ctx.specCoversVerse("garbage", 1), false);
});

// ── chapterMaxVerse ──

test("chapterMaxVerse: counts a merged verse's range_end", () => {
  assert.strictEqual(ctx.chapterMaxVerse({ verses: [{ number: 1 }, { number: 4, range_end: 6 }] }), 6);
});

test("chapterMaxVerse: missing data is 0, not a throw", () => {
  assert.strictEqual(ctx.chapterMaxVerse(null), 0);
  assert.strictEqual(ctx.chapterMaxVerse({}), 0);
});

// ── verseInstanceKey ──
// 번호만으로는 절이 식별되지 않는다 — 한 장에 같은 번호의 절이 여럿 있을 수 있다.

test("verseInstanceKey: 평범한 절은 번호 그대로", () => {
  assert.strictEqual(ctx.verseInstanceKey({ number: 12 }), "12");
});

test("verseInstanceKey: 반절·추가본문·칠십인역·무번호구절·교차참조를 구분한다", () => {
  assert.strictEqual(ctx.verseInstanceKey({ number: 3, part: "a" }), "3a");
  assert.strictEqual(ctx.verseInstanceKey({ number: 17, alt_ref: 12 }), "17_12");
  assert.strictEqual(ctx.verseInstanceKey({ number: 24, lxx_only: true }), "24_lxx");
  assert.strictEqual(ctx.verseInstanceKey({ number: 4, versicle: true }), "4_v");
  assert.strictEqual(ctx.verseInstanceKey({ number: 18, chapter_ref: 24 }), "18_c24");
});

test("verseInstanceKey: 같은 번호의 무번호 구절이 번호 절과 갈린다", () => {
  // 전례시편 23편 — 4절 다음에 ¶ 구절이 같은 번호로 온다(ADR-039).
  const numbered = ctx.verseInstanceKey({ number: 4 });
  const versicle = ctx.verseInstanceKey({ number: 4, versicle: true });
  assert.notStrictEqual(numbered, versicle);
});

// ── verseInstanceKeys ──

test("verseInstanceKeys: 전례시편 23편과 같은 구조에서 7개 절이 모두 남는다", () => {
  const verses = [
    { number: 1 }, { number: 2 }, { number: 3 }, { number: 4 },
    { number: 4, versicle: true }, { number: 5 }, { number: 6 },
  ];
  const keys = ctx.verseInstanceKeys(verses);
  assert.strictEqual(keys.length, 7);
  assert.strictEqual(new Set(keys).size, 7, `중복: ${keys}`);
});

test("verseInstanceKeys: 에스델 추가 본문처럼 한 번호 아래 여러 절도 모두 남는다", () => {
  const verses = Array.from({ length: 5 }, (_, i) => ({ number: 17, alt_ref: i + 1 }));
  assert.strictEqual(new Set(ctx.verseInstanceKeys(verses)).size, 5);
});

test("verseInstanceKeys: 원본 중복 마커는 절을 버리지 않고 순번을 붙인다", () => {
  // 원본 자체에 같은 번호가 두 번 찍힌 장(욥 32:9 등) — 어느 쪽도 버리면 안 된다.
  // vm 실현체의 배열이라 프로토타입이 달라 deepStrictEqual 을 쓰지 않는다.
  const keys = plain(ctx.verseInstanceKeys([{ number: 9 }, { number: 9 }]));
  assert.deepStrictEqual(keys, ["9", "9~2"]);
});

test("verseInstanceKeys: 빈 입력은 빈 배열", () => {
  assert.deepStrictEqual(plain(ctx.verseInstanceKeys([])), []);
  assert.deepStrictEqual(plain(ctx.verseInstanceKeys(null)), []);
});

// ── selectionCitation · selectedSpanVrefs ──
// 절 선택 막대의 「…절 선택됨」 · 복사 출처. 선택은 줄마다 다른 `data-vkey`(인스턴스 키 "/" data-vref)로 하고, 출처는
// 그 줄들의 `data-vref`로 적는다. 장 이름을 붙인 발췌(이사 40, 다니 3, 에스 4, 이사 7, 1사무 24, 욥 31, 나훔 1,
// 이사 10, 판관 17)는 실제 화면의 키와 표지에서 뽑았다(2026-10-21 · 10-22 덤프). 가운데 절이나 절의 뒷줄을 뺀 곳이
// 있다. 이름 없는 발췌는 규칙을 보이려고 만든 것이다. 화면은 절 전체를 고르므로(views.js `_verseSelectionUnit`, 사용자 결정 2026-10-22)
// 한 줄만 고른 경우는 생기지 않지만, 생겨도 출처에 줄 글자를 쓰지 않는다는 것을 함께 본다.

/** @param {Array<[string, string?, string?]>} rows [data-vkey, class list, data-chapter-ref] in document order */
function articleOf(rows) {
  const elements = rows.map(([key, cls = "", chapterRef = null]) => ({
    getAttribute: (k) => (k === "data-vkey" ? key : k === "data-vref" ? key.slice(key.indexOf("/") + 1)
      : k === "data-chapter-ref" ? chapterRef : null),
    classList: { contains: (c) => cls.split(" ").includes(c) },
  }));
  return { querySelectorAll: (sel) => (sel === ".verse[data-vkey]" ? elements : []) };
}
/** 「장:절」 — 이 장의 번호면 장 없이 절만. 사람이 읽는 표기(citationVerseSpec)로. */
const citeSpec = (keys, article) => {
  const { chapter, refs } = ctx.selectionCitation(new Set(keys), article);
  return `${chapter != null ? `${chapter}:` : ""}${ctx.citationVerseSpec(refs)}`;
};
const linesOf = (rows, verse) => rows.map(([k]) => k).filter((k) => k.startsWith(`${verse}/`));
/** 운문 여러 줄 — 줄 글자마다 [「인스턴스/번호+글자」, "verse-poetry"]. */
const poem = (instance, ref, letters) => [...letters].map((l) => [`${instance}/${ref}${l}`, "verse-poetry"]);

// 이사 40 — 41:6-7 이 19 와 20 사이에 옮겨 실렸다.
const ISA40 = [
  ["6/6a", "verse-poetry"], ["6/6b", "verse-poetry"], ["6/6c", "verse-poetry"], ["6/6d", "verse-poetry"],
  ["7/7a", "verse-poetry"], ["7/7b", "verse-poetry"], ["7/7c", "verse-poetry"],
  ["19/19a", "verse-poetry"], ["19/19b", "verse-poetry"], ["19/19c", "verse-poetry"],
  ["6_c41/6a", "verse-cross-ref verse-poetry", "41"], ["6_c41/6b", "verse-cross-ref verse-poetry", "41"],
  ["7_c41/7a", "verse-cross-ref verse-poetry", "41"], ["7_c41/7b", "verse-cross-ref verse-poetry", "41"],
  ["20/20a", "verse-poetry"], ["20/20b", "verse-poetry"],
];
// 다니 3 — 그리스어 추가 본문 (24)- 가 히브리 24(91)- 와 번호를 함께 쓴다.
const DAN3 = [
  ["23/23"], ["24_lxx/24", "verse-lxx"], ["25_lxx/25", "verse-lxx"],
  ["26_lxx/26a", "verse-lxx verse-poetry"], ["26_lxx/26b", "verse-lxx verse-poetry"],
  ["24_91/24"], ["25_92/25"], ["26_93/26"],
];
// 에스 4 — 추가 본문이 모두 17 이다.
const ESTH4 = [
  ["16/16"], ["17/17"], ["17_1/17"],
  ["17_2/17a", "verse-poetry"], ["17_2/17b", "verse-poetry"],
  ["17_5/17a", "verse-poetry"], ["17_5/17b", "verse-poetry"], ["17_5/17c", "verse-poetry"],
  ["17_11/17"],
  ["17_14/17a"], ["17_14/17b", "verse-poetry"],
];

test("selectionCitation: 이사 40:19 → 20 — 사이에 옮겨 실린 41:6-7 은 출처 번호에 들지 않는다(종전 「6a,6b,7,19-20」)", () => {
  const keys = [...linesOf(ISA40, "19"), ...linesOf(ISA40, "6_c41"), ...linesOf(ISA40, "7_c41"), ...linesOf(ISA40, "20")];
  assert.strictEqual(citeSpec(keys, articleOf(ISA40)), "19-20");
});

test("selectionCitation: 이사 40 — 옮겨 실린 절만 고르면 제 장의 번호(「41:6」 — 사용자 결정 2026-10-21), 이 장의 6절은 그 줄만 본다", () => {
  const a = articleOf(ISA40);
  assert.strictEqual(citeSpec(linesOf(ISA40, "6_c41"), a), "41:6");
  assert.strictEqual(citeSpec([...linesOf(ISA40, "6_c41"), ...linesOf(ISA40, "7_c41")], a), "41:6-7");
  assert.strictEqual(citeSpec(["6_c41/6a"], a), "41:6");               // 줄 글자는 쓰지 않는다(종전 「41:6a」)
  assert.strictEqual(citeSpec(linesOf(ISA40, "6"), a), "6");          // 41:6 의 줄이 남아도 40:6 은 다 골랐다
  assert.strictEqual(citeSpec(["6/6a", "6/6b"], a), "6");             // 종전 「6a,6b」
});

test("selectionCitation: 다니 3 — 그리스어 절은 히브리 절과 섞이지 않는다", () => {
  const a = articleOf(DAN3);
  assert.strictEqual(citeSpec(["24_lxx/24", "25_lxx/25"], a), "24-25");
  assert.strictEqual(citeSpec(["26_lxx/26a"], a), "26");              // 그리스어 (26) 의 첫 줄(종전 「26a」)
  assert.strictEqual(citeSpec(linesOf(DAN3, "26_lxx"), a), "26");
  assert.strictEqual(citeSpec(["26_lxx/26a", "26_93/26"], a), "26");   // 히브리 절이 있으면 그 번호 체계만
  assert.strictEqual(citeSpec(["23/23", "24_lxx/24", "24_91/24"], a), "23-24");
});

test("selectionCitation: 에스 4:17 — 한 번호 아래 여러 절이면 줄 글자 없이 번호로(종전 「17a」)", () => {
  const a = articleOf(ESTH4);
  assert.strictEqual(citeSpec(linesOf(ESTH4, "17_5"), a), "17");
  assert.strictEqual(citeSpec(["17_5/17b"], a), "17");
  assert.strictEqual(citeSpec(["17_14/17a"], a), "17");
  assert.strictEqual(citeSpec(["16/16", "17/17"], a), "16-17");
});

test("selectionCitation: 토비 11:15 — 원본의 중복 절 표시도 한 번호를 함께 쓰는 다른 절이라 번호로 적는다(줄 글자가 겹치지 않아도)", () => {
  // 15절은 운문 두 줄(15a · 15b), 중복 표시된 둘째 15절(15~2)은 한 줄(15) — data-vref 는 겹치지 않는다(리뷰 2026-10-21).
  const a = articleOf([["14/14"], ["15/15a", "verse-poetry"], ["15/15b", "verse-poetry"], ["15~2/15"], ["16/16"]]);
  assert.strictEqual(citeSpec(["15/15a", "15/15b"], a), "15");
  assert.strictEqual(citeSpec(["14/14", "15/15a", "15/15b"], a), "14-15");
  assert.strictEqual(citeSpec(["15~2/15"], a), "15");
});

test("selectionCitation: 전례시편 ¶ 구절 — 앞 절과 줄 글자가 겹쳐 번호로 적는다", () => {
  const a = articleOf([["4/4a", "verse-poetry"], ["4/4b", "verse-poetry"], ["4_v/4a", "verse-poetry"], ["4_v/4b", "verse-poetry"], ["5/5a", "verse-poetry"]]);
  assert.strictEqual(citeSpec(["4_v/4a", "4_v/4b"], a), "4");
  assert.strictEqual(citeSpec(["4/4a", "4/4b", "4_v/4a", "4_v/4b", "5/5a"], a), "4-5");
  // ¶ 구절이 한 줄이라 줄 글자가 겹치지 않아도 같다.
  const b = articleOf([["4/4a"], ["4/4b"], ["4_v/4"]]);
  assert.strictEqual(citeSpec(["4/4a"], b), "4");
});

test("selectionCitation: 여러 줄 절은 번호로 — 줄 글자는 인쇄본 표기가 아니다(사용자 결정 2026-10-22, 종전 「3a」 「2,3b,4」)", () => {
  const a = articleOf([["2/2"], ["3/3a"], ["3/3b"], ["4/4"]]);
  assert.strictEqual(citeSpec(["3/3a", "3/3b"], a), "3");
  assert.strictEqual(citeSpec(["3/3a"], a), "3");
  assert.strictEqual(citeSpec(["2/2", "3/3b", "4/4"], a), "2-4");
  assert.strictEqual(citeSpec(["4/4"], a), "4");
});

test("selectionCitation: 병합 절 「7-8a」「7-8b」를 다 고르면 「7-8」 — 끝 번호를 잃지 않는다(Copilot 9회차)", () => {
  const a = articleOf([["5/5"], ["6/6"], ["7/7-8a"], ["7/7-8b"], ["9/9"]]);
  assert.strictEqual(citeSpec(["7/7-8a", "7/7-8b"], a), "7-8");
  assert.strictEqual(citeSpec(["7/7-8a"], a), "7-8");                  // 종전 「7-8a」
  // 병합 절도 앞뒤 구간에 잇는다(나훔 1 — 종전 「7-8,9」 「5-6,7-8,9」).
  assert.strictEqual(citeSpec(["7/7-8a", "7/7-8b", "9/9"], a), "7-9");
  assert.strictEqual(citeSpec(["5/5", "6/6", "7/7-8a", "7/7-8b", "9/9"], a), "5-9");
  assert.strictEqual(citeSpec(["5/5", "7/7-8a", "7/7-8b"], a), "5,7-8");
});

test("selectionCitation: 데이터의 반쪽 절 — 둘 다 고르면 번호, 한쪽이면 인쇄본대로 「8ㄱ」(사용자 결정 2026-10-22, 종전 「8aa,8ab」)", () => {
  // 이사 7 — 8a · 9a · 8b · 9b 순서로 실린다.
  const a = articleOf([...poem("7", "7", "ab"), ...poem("8a", "8a", "ab"), ...poem("9a", "9a", "ab"), ...poem("8b", "8b", "ab"),
    ...poem("9b", "9b", "ab")]);
  assert.strictEqual(citeSpec(["8a/8aa", "8a/8ab", "8b/8ba", "8b/8bb"], a), "8");
  assert.strictEqual(citeSpec(["8a/8aa", "8a/8ab"], a), "8ㄱ");
  assert.strictEqual(citeSpec(["8b/8ba", "8b/8bb"], a), "8ㄴ");
  // 7 → 9ㄱ 범위: 8은 반쪽이 둘 다, 9는 ㄱ만(종전 막대 「7-8, 9aa, 9ab」).
  assert.strictEqual(citeSpec(["7/7a", "7/7b", "8a/8aa", "8a/8ab", "9a/9aa", "9a/9ab", "8b/8ba", "8b/8bb"], a), "7-8,9ㄱ");
  assert.strictEqual(citeSpec(["7/7a", "7/7b", "8a/8aa", "8a/8ab"], a), "7,8ㄱ");
  // refs 는 저장 표기 그대로 — 주소와 북마크의 문법(ADR-010 · 040)
  assert.deepStrictEqual(plain(ctx.selectionCitation(new Set(["8a/8aa", "8a/8ab", "9a/9aa", "9a/9ab"]), a).refs), ["8a", "9a"]);
});

test("selectionCitation: 한 줄짜리 반쪽 절(1사무 24:5ㄱ)과 줄 수가 다른 반쪽 절(욥 31:40ㄱ 두 줄 · 40ㄴ 한 줄)", () => {
  const sam = articleOf([["4/4"], ["5a/5a"], ["7/7"], ["8a/8a"], ["5b/5b"], ["6/6"], ["8b/8b"], ["9/9"]]);
  assert.strictEqual(citeSpec(["5a/5a"], sam), "5ㄱ");
  assert.strictEqual(citeSpec(["4/4", "5a/5a", "7/7"], sam), "4,5ㄱ,7");
  assert.strictEqual(citeSpec(["5a/5a", "5b/5b"], sam), "5");
  // 욥 31 — 38-40ㄱ 이 8절 뒤에 실리고 40ㄴ(산문 한 줄)은 장 끝에 있다(사이의 절은 뺐다).
  const job = articleOf([...poem("39", "39", "ab"), ...poem("40a", "40a", "ab"), ...poem("9", "9", "ab"), ["40b/40b"]]);
  assert.strictEqual(citeSpec(["40a/40aa", "40a/40ab"], job), "40ㄱ");   // 종전 막대 「40aa」
  assert.strictEqual(citeSpec(["40b/40b"], job), "40ㄴ");
});

// 나훔 1 — 2ㄱ 은 1절 뒤, 2ㄴ 은 9절 뒤에 실린다. 7-8 은 일곱 줄인 병합 절이다. 1절만 산문이다(10절까지).
const NAH1 = [["1/1"], ...poem("2a", "2a", "ab"), ...poem("3", "3", "abcde"), ...poem("4", "4", "abcd"),
  ...poem("5", "5", "abcd"), ...poem("6", "6", "abcd"), ...poem("7", "7-8", "abcdefg"), ...poem("9", "9", "abc"),
  ...poem("2b", "2b", "ab"), ...poem("10", "10", "ab")];

test("selectionCitation: 나훔 1 — 2ㄱ 은 1절 뒤, 2ㄴ 은 9절 뒤에 실린다(사용자 결정 2026-10-22, 종전 1 → 2ㄱ 이 「1-6,7-8,9」)", () => {
  const a = articleOf(NAH1);
  const keys = NAH1.map(([k]) => k);
  assert.strictEqual(citeSpec(["1/1", ...linesOf(NAH1, "2a")], a), "1,2ㄱ");
  assert.strictEqual(citeSpec(keys.slice(0, keys.indexOf("2b/2ba")), a), "1,2ㄱ,3-9");
  assert.strictEqual(citeSpec(keys, a), "1-10");
  assert.strictEqual(citeSpec(linesOf(NAH1, "7"), a), "7-8");
});

test("selectionCitation: ㄴ 이 ㄱ 보다 앞에 실린 장 — 이사 10(18ㄴ 이 16ㄱ · 16ㄴ 사이) · 판관 17(3ㄴ 이 2ㄱ · 2ㄴ 사이)", () => {
  const ISA10 = [...poem("15", "15", "abcd"), ...poem("16a", "16a", "ab"), ...poem("18b", "18b", "ab"),
    ...poem("16b", "16b", "ab"), ...poem("17", "17", "abc"), ...poem("18a", "18a", "ab"), ...poem("19", "19", "ab")];
  const isa = articleOf(ISA10);
  assert.strictEqual(citeSpec([...linesOf(ISA10, "16a"), ...linesOf(ISA10, "18b"), ...linesOf(ISA10, "16b")], isa), "16,18ㄴ");
  assert.strictEqual(citeSpec(linesOf(ISA10, "18b"), isa), "18ㄴ");
  assert.strictEqual(citeSpec(ISA10.map(([k]) => k).filter((k) => !k.startsWith("19/")), isa), "15-18");
  const judg = articleOf([["1/1"], ["2a/2a"], ["3b/3b"], ["2b/2b"], ["3a/3a"], ["4/4"]]);
  assert.strictEqual(citeSpec(["3b/3b"], judg), "3ㄴ");
  assert.strictEqual(citeSpec(["1/1", "2a/2a", "3b/3b"], judg), "1,2ㄱ,3ㄴ");
  assert.strictEqual(citeSpec(["1/1", "2a/2a", "3b/3b", "2b/2b", "3a/3a"], judg), "1-3");
});

test("citationVerseSpec: 병합 절을 구간에 잇고 반쪽 절은 「ㄱ · ㄴ」 — 저장 표기(selectedVersesToSpec)와 다른 두 곳", () => {
  assert.strictEqual(ctx.citationVerseSpec(["6", "7-8", "9"]), "6-9");
  assert.strictEqual(ctx.selectedVersesToSpec(["6", "7-8", "9"]), "6,7-8,9");
  assert.strictEqual(ctx.citationVerseSpec(["7-8"]), "7-8");
  assert.strictEqual(ctx.citationVerseSpec(["1", "7-8"]), "1,7-8");
  assert.strictEqual(ctx.citationVerseSpec(["7", "8", "9a"]), "7-8,9ㄱ");
  assert.strictEqual(ctx.citationVerseSpec(["9b", "12", "13"]), "9ㄴ,12-13");
});

test("halfVerseMark: a 는 「ㄱ」, b 는 「ㄴ」", () => {
  assert.strictEqual(ctx.halfVerseMark("a"), "ㄱ");
  assert.strictEqual(ctx.halfVerseMark("b"), "ㄴ");
});

test("selectionCitation: 기사가 없거나 고른 줄이 화면에 없으면 빈 refs", () => {
  assert.deepStrictEqual(plain(ctx.selectionCitation(new Set(["3/3"]), null)), { chapter: null, refs: [] });
  assert.deepStrictEqual(plain(ctx.selectionCitation(new Set(["9/9"]), articleOf([["3/3"]]))), { chapter: null, refs: [] });
});

test("selectedSpanVrefs: 고른 줄의 data-vref 를 문서 순서로 — 북마크 저장은 번호 단위 그대로(ADR-010)", () => {
  const a = articleOf(ISA40);
  assert.deepStrictEqual(plain(ctx.selectedSpanVrefs(new Set(["20/20a", "6_c41/6a", "19/19a"]), a)), ["19a", "6a", "20a"]);
  assert.deepStrictEqual(plain(ctx.selectedSpanVrefs(new Set(["19/19a"]), null)), []);
});

// ── verseNumberSpec · wholeVerseSpec ──
// 북마크는 절 번호 단위로 저장한다(ADR-010). 옛 판(2026-04-25부터 06-06 #205까지)이 저장한 줄 글자는 지금 표기로
// 옮긴다(사용자 결정 2026-10-22, coding-pitfalls §38). 표본은 화면에서 재현한 것이다(이사 10 · 나훔 1 · 마태 10 · 창세 27 ·
// 1사무 24 · 이사 7).

test("verseNumberSpec: 고른 줄의 글자를 모두 떼고 번호를 구간으로 잇는다 — 북마크 저장(ADR-010)", () => {
  assert.strictEqual(ctx.verseNumberSpec(["23a", "23c"]), "23");
  assert.strictEqual(ctx.verseNumberSpec(["23b"]), "23");
  assert.strictEqual(ctx.verseNumberSpec(["3a", "3b"]), "3");
  assert.strictEqual(ctx.verseNumberSpec(["5"]), "5");
  assert.strictEqual(ctx.verseNumberSpec(["23a", "23c", "24"]), "23-24");
  assert.strictEqual(ctx.verseNumberSpec(["1", "3", "4", "5", "9"]), "1,3-5,9");
  assert.strictEqual(ctx.verseNumberSpec(["9", "3"]), "3,9");
  assert.strictEqual(ctx.verseNumberSpec([]), "all");
  // 데이터의 반쪽 절은 그 번호로 — 「8ㄱ」만 골라도 8(이사 7은 반쪽 절이 다시 두 줄이다)
  assert.strictEqual(ctx.verseNumberSpec(["8aa", "8ab"]), "8");
  assert.strictEqual(ctx.verseNumberSpec(["5a"]), "5");
});

test("verseNumberSpec: 여러 줄인 병합 절은 범위로, 앞뒤 절과 잇는다 — 첫 번호로 저장되던 것(known-issues §17)", () => {
  const nah7 = ["7-8a", "7-8b", "7-8c", "7-8d", "7-8e", "7-8f", "7-8g"];
  assert.strictEqual(ctx.verseNumberSpec(nah7), "7-8");
  assert.strictEqual(ctx.verseNumberSpec(["6", ...nah7, "9"]), "6-9");
  assert.strictEqual(ctx.verseNumberSpec(["1", ...nah7]), "1,7-8");
  // 한 줄인 병합 절도 같다 — 그전에는 「16,17-18,19」였다
  assert.strictEqual(ctx.verseNumberSpec(["16", "17-18", "19"]), "16-19");
});

test("verseNumberSpec: 범위를 절마다 펼치지 않는다 — 검사 없이 들어온 큰 범위(known-issues §15)도 바로 끝난다", () => {
  const t0 = Date.now();
  assert.strictEqual(ctx.verseNumberSpec(["1-4294967296", "5"]), "1-4294967296");
  assert.strictEqual(ctx.verseNumberSpec(["5-1"]), "1-5");
  assert.ok(Date.now() - t0 < 50, `${Date.now() - t0}ms`);
});

test("wholeVerseSpec: 옛 판이 저장한 줄 글자를 떼어 지금 저장 표기로 옮긴다", () => {
  const moved = {
    "16aa": "16",          // 이사 10:16ㄱ의 첫 줄
    "16-17a": "16-17",     // 병합 절의 한 줄
    "7-8a": "7-8",         // 나훔 1:7-8의 첫 줄
    "35a": "35",           // 마태 10:35의 첫 줄(인용 칩 자리에서 나뉜 산문 절)
    "20a,20c": "20",       // 창세 27:20의 두 줄
    "5a": "5",             // 1사무 24:5ㄱ(한 줄짜리 반쪽 절)
    "8a": "8",             // 이사 7
    "3a,5-7": "3,5-7",
    "16,16aa": "16",
    "1,20a,20c": "1,20",   // 지금 앱의 합치기가 남기던 것
    "34,35a": "34-35",
    "16-17b,16-17a": "16-17",
    "8ba,8ab": "8",
    "3a,3bb": "3",
  };
  for (const [legacy, now] of Object.entries(moved)) {
    assert.strictEqual(ctx.wholeVerseSpec(legacy), now, legacy);
    assert.ok(ctx.isWellFormedSpec(now), now);
    assert.strictEqual(ctx.wholeVerseSpec(now), now, `${now} — 다시 옮겨도 그대로`);
  }
});

test("wholeVerseSpec: 글자가 없는 범위 · 「all」 · 앱이 쓴 적 없는 표기는 그대로 둔다", () => {
  for (const spec of ["all", "16", "1-5,10-15", "6,7-8,9", "1-2000000"]) assert.strictEqual(ctx.wholeVerseSpec(spec), spec);
  // 순서가 어긋나거나 겹치거나 공백이 든 것 — 검사 없이 들어온 북마크(known-issues §15)는 고쳐 쓰지 않는다
  for (const spec of ["16aa,3", "5a,3", "1-5,3a", " 16a", "3z", "abc", ""]) assert.strictEqual(ctx.wholeVerseSpec(spec), spec);
});
