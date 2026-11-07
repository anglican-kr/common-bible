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

// ── selectionCitation · formatVerseRanges · selectedSpanVrefs ──
// 절 선택 막대의 「…절 선택됨」, 절 선택 복사, 장 본문과 전례독서의 끌어 선택 복사가 같은 두 함수로 출처를 적는다(사용자
// 결정 2026-11-07, known-issues §16.1). 선택은 줄마다 다른 `data-vkey`(인스턴스 키 "/" data-vref)로 하고, 출처는 그
// 줄들의 `data-vref`로 적는다. 끌어 선택 복사는 글자가 겹친 줄을 고른 줄로 넘긴다(views.js bindCopyAttribution). 장
// 이름을 붙인 발췌(이사 40, 다니 3, 에스 4, 이사 7, 1사무 24, 욥 31, 나훔 1, 이사 10, 판관 17, 마르 9)는 실제 화면의
// 키와 표지에서 뽑았다(2026-10-21 · 10-22 · 11-07 덤프). 가운데 절이나 절의 뒷줄을 뺀 곳이 있다. 이름 없는 발췌는
// 규칙을 보이려고 만든 것이다. 절 선택은 절 전체를 고르지만(views.js `_verseSelectionUnit`, 사용자 결정 2026-10-22),
// 끌어 선택 복사는 한 줄만 고를 수 있다. 어느 쪽이든 출처에 줄 글자를 쓰지 않는다.

/**
 * @param {Array<[string, string?, string?]>} rows [data-vkey, class list, data-chapter-ref] in document order
 * @param {string | null} [absent] the article's `data-absent`
 */
function articleOf(rows, absent = null) {
  const elements = rows.map(([key, cls = "", chapterRef = null]) => ({
    getAttribute: (k) => (k === "data-vkey" ? key : k === "data-vref" ? key.slice(key.indexOf("/") + 1)
      : k === "data-chapter-ref" ? chapterRef : null),
    classList: { contains: (c) => cls.split(" ").includes(c) },
  }));
  return {
    querySelectorAll: (sel) => (sel === ".verse[data-vkey]" ? elements : []),
    getAttribute: (k) => (k === "data-absent" ? absent : null),
  };
}
/** 「장:절」 — 이 장의 번호면 장 없이 절만. 사람이 읽는 표기(formatVerseRanges)로. */
const citeSpec = (keys, article) => {
  const { chapter, runs } = ctx.selectionCitation(new Set(keys), article);
  return `${chapter != null ? `${chapter}:` : ""}${ctx.formatVerseRanges(runs)}`;
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
  assert.strictEqual(citeSpec(["5/5", "7/7-8a", "7/7-8b"], a), "5, 7-8");
});

// 이사 7 — 8a · 9a · 8b · 9b 순서로 실리고, 반쪽 절이 다시 두 줄이다.
const ISA7 = [...poem("7", "7", "ab"), ...poem("8a", "8a", "ab"), ...poem("9a", "9a", "ab"), ...poem("8b", "8b", "ab"),
  ...poem("9b", "9b", "ab")];

test("selectionCitation: 데이터의 반쪽 절 — 둘 다 고르면 번호, 한쪽이면 인쇄본대로 「8ㄱ」(사용자 결정 2026-10-22, 종전 「8aa,8ab」)", () => {
  const a = articleOf(ISA7);
  assert.strictEqual(citeSpec(["8a/8aa", "8a/8ab", "8b/8ba", "8b/8bb"], a), "8");
  assert.strictEqual(citeSpec(["8a/8aa", "8a/8ab"], a), "8ㄱ");
  assert.strictEqual(citeSpec(["8b/8ba", "8b/8bb"], a), "8ㄴ");
  // 7 → 9ㄱ 범위: 8은 반쪽이 둘 다, 9는 ㄱ만(종전 막대 「7-8, 9aa, 9ab」).
  assert.strictEqual(citeSpec(["7/7a", "7/7b", "8a/8aa", "8a/8ab", "9a/9aa", "9a/9ab", "8b/8ba", "8b/8bb"], a), "7-8, 9ㄱ");
  assert.strictEqual(citeSpec(["7/7a", "7/7b", "8a/8aa", "8a/8ab"], a), "7, 8ㄱ");
  // 반쪽 절 하나는 [n, n, part] — 구간을 시작하지도 끝내지도 않는다
  assert.deepStrictEqual(plain(ctx.selectionCitation(new Set(["8a/8aa", "8a/8ab", "9a/9aa", "9a/9ab"]), a).runs),
    [[8, 8, "a"], [9, 9, "a"]]);
});

test("selectionCitation: 끌어 선택 복사는 반쪽 절 줄의 글자를 조금이라도 고르면 그 반쪽 — 두 반쪽이면 그 절", () => {
  const a = articleOf(ISA7);
  // 종전 장 본문 복사는 반쪽 절도 절 번호로 적었다 — 「7:7-8」 · 「7:8」 · 「7:8-9」
  assert.strictEqual(citeSpec(["7/7a", "7/7b", "8a/8aa"], a), "7, 8ㄱ");       // 8ㄱ의 첫 줄에서 멈춘 선택
  assert.strictEqual(citeSpec(["8a/8aa"], a), "8ㄱ");                          // 한 줄 안의 몇 글자
  assert.strictEqual(citeSpec(["8a/8ab", "9a/9aa", "9a/9ab", "8b/8ba"], a), "8, 9ㄱ");   // 8은 두 반쪽의 글자를 다 골랐고 9는 ㄱ만
  assert.strictEqual(citeSpec(ISA7.map(([k]) => k), a), "7-9");
});

test("selectionCitation: 한 줄짜리 반쪽 절(1사무 24:5ㄱ)과 줄 수가 다른 반쪽 절(욥 31:40ㄱ 두 줄 · 40ㄴ 한 줄)", () => {
  const sam = articleOf([["4/4"], ["5a/5a"], ["7/7"], ["8a/8a"], ["5b/5b"], ["6/6"], ["8b/8b"], ["9/9"]]);
  assert.strictEqual(citeSpec(["5a/5a"], sam), "5ㄱ");
  assert.strictEqual(citeSpec(["4/4", "5a/5a", "7/7"], sam), "4, 5ㄱ, 7");
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
  assert.strictEqual(citeSpec(["1/1", ...linesOf(NAH1, "2a")], a), "1, 2ㄱ");
  assert.strictEqual(citeSpec(keys.slice(0, keys.indexOf("2b/2ba")), a), "1, 2ㄱ, 3-9");
  assert.strictEqual(citeSpec(keys, a), "1-10");
  assert.strictEqual(citeSpec(linesOf(NAH1, "7"), a), "7-8");
});

test("selectionCitation: ㄴ 이 ㄱ 보다 앞에 실린 장 — 이사 10(18ㄴ 이 16ㄱ · 16ㄴ 사이) · 판관 17(3ㄴ 이 2ㄱ · 2ㄴ 사이)", () => {
  const ISA10 = [...poem("15", "15", "abcd"), ...poem("16a", "16a", "ab"), ...poem("18b", "18b", "ab"),
    ...poem("16b", "16b", "ab"), ...poem("17", "17", "abc"), ...poem("18a", "18a", "ab"), ...poem("19", "19", "ab")];
  const isa = articleOf(ISA10);
  assert.strictEqual(citeSpec([...linesOf(ISA10, "16a"), ...linesOf(ISA10, "18b"), ...linesOf(ISA10, "16b")], isa), "16, 18ㄴ");
  assert.strictEqual(citeSpec(linesOf(ISA10, "18b"), isa), "18ㄴ");
  assert.strictEqual(citeSpec(ISA10.map(([k]) => k).filter((k) => !k.startsWith("19/")), isa), "15-18");
  const judg = articleOf([["1/1"], ["2a/2a"], ["3b/3b"], ["2b/2b"], ["3a/3a"], ["4/4"]]);
  assert.strictEqual(citeSpec(["3b/3b"], judg), "3ㄴ");
  assert.strictEqual(citeSpec(["1/1", "2a/2a", "3b/3b"], judg), "1, 2ㄱ, 3ㄴ");
  assert.strictEqual(citeSpec(["1/1", "2a/2a", "3b/3b", "2b/2b", "3a/3a"], judg), "1-3");
});

// 마르 9 — 공동번역에 44절과 46절이 없다(`<article data-absent="44,46">`, views.js absentVerseNumbers).
const MARK9 = [["42/42"], ["43/43"], ["45/45"], ["47/47"], ["48/48"], ["49/49"]];

test("selectionCitation: 이 번역에 없는 절 번호만 사이에 있으면 잇는다 — 장 본문 복사처럼 「9:43-48」(사용자 결정 2026-10-14 · 11-07)", () => {
  const a = articleOf(MARK9, "44,46");
  assert.strictEqual(citeSpec(["43/43", "45/45", "47/47", "48/48"], a), "43-48");   // 종전 절 선택 「43,45,47-48」
  assert.strictEqual(citeSpec(["43/43", "45/45"], a), "43-45");
  // 있는 절(45)을 건너뛰면 끊는다. 건너뛴 절은 쉼표다.
  assert.strictEqual(citeSpec(["43/43", "47/47"], a), "43, 47");
  // 없는 번호를 모르는 화면(`data-absent`가 없다)에서는 번호대로
  assert.strictEqual(citeSpec(["43/43", "45/45"], articleOf(MARK9)), "43, 45");
});

test("selectionCitation: 다른 번호 체계만 고르면 data-absent로 잇지 않는다 — 그 장 자신의 번호다", () => {
  // 장의 6절이 없는 것으로 적힌 화면에서 옮겨 실린 41:5와 41:7만 골라도 「41:5, 7」이다(41장의 6절은 따로 있다).
  const a = articleOf([["5/5"], ["5_c41/5", "verse-cross-ref", "41"], ["7_c41/7", "verse-cross-ref", "41"], ["7/7"]], "6");
  assert.strictEqual(citeSpec(["5_c41/5", "7_c41/7"], a), "41:5, 7");
  assert.strictEqual(citeSpec(["5/5", "7/7"], a), "5-7");
});

test("formatVerseRanges: 구간은 쉼표와 한 칸으로, 반쪽 절은 「ㄱ · ㄴ」(사용자 결정 2026-11-07 — 종전 절 선택은 「7-8,9ㄱ」)", () => {
  assert.strictEqual(ctx.formatVerseRanges([[1, 3], [5, 5], [8, 8, "a"]]), "1-3, 5, 8ㄱ");
  assert.strictEqual(ctx.formatVerseRanges([[7, 8], [9, 9, "a"]]), "7-8, 9ㄱ");
  assert.strictEqual(ctx.formatVerseRanges([[9, 9, "b"], [12, 13]]), "9ㄴ, 12-13");
  assert.strictEqual(ctx.formatVerseRanges([[43, 48]]), "43-48");
  assert.strictEqual(ctx.formatVerseRanges([]), "");
});

test("halfVerseMark: a 는 「ㄱ」, b 는 「ㄴ」", () => {
  assert.strictEqual(ctx.halfVerseMark("a"), "ㄱ");
  assert.strictEqual(ctx.halfVerseMark("b"), "ㄴ");
});

test("selectionCitation: 기사가 없거나 고른 줄이 화면에 없으면 빈 runs", () => {
  assert.deepStrictEqual(plain(ctx.selectionCitation(new Set(["3/3"]), null)), { chapter: null, runs: [] });
  assert.deepStrictEqual(plain(ctx.selectionCitation(new Set(["9/9"]), articleOf([["3/3"]]))), { chapter: null, runs: [] });
});

test("selectedSpanVrefs: 저장할 줄의 data-vref를 문서 순서로 모은다. 이 장의 절과 함께 고른 옮겨 실린 절은 뺀다(사용자 결정 2026-11-07)", () => {
  const a = articleOf(ISA40);
  assert.deepStrictEqual(plain(ctx.selectedSpanVrefs(new Set(["20/20a", "6_c41/6a", "19/19a"]), a)), ["19a", "20a"]);   // 종전 「19a,6a,20a」
  assert.deepStrictEqual(plain(ctx.selectedSpanVrefs(new Set(["7_c41/7b", "6_c41/6a"]), a)), ["6a", "7b"]);   // 그 절만이면 그 줄
  assert.deepStrictEqual(plain(ctx.selectedSpanVrefs(new Set(["19/19a"]), null)), []);
});

// ── 북마크 저장(selectedSpanVrefs, verseNumberSpec) ──
// 절 선택으로 저장하는 값이다(bookmark-modals.js openSaveModal). 저장할 절은 출처와 같은 규칙으로 고른다(사용자 결정
// 2026-11-07, known-issues §16.2). 이 장의 절을 하나라도 골랐으면 옮겨 실린 절과 그리스어 추가 본문은 저장하지 않는다. 그 절만
// 고르면 지금처럼 그 번호로 저장한다. 저장 표기와 주소 문법은 그대로라 옛 버전도 저장값을 읽는다.

const saveSpec = (keys, article) => ctx.verseNumberSpec(ctx.selectedSpanVrefs(new Set(keys), article));
/** 옮겨 실린 운문 절의 줄. 줄마다 [「인스턴스/번호+글자」, 표지, 본래 장]이다. */
const moved = (instance, ref, letters, chapter) => [...letters].map((l) => [`${instance}/${ref}${l}`, "verse-cross-ref verse-poetry", chapter]);
// 이사 40장의 4-8절과 18-21절, 그리고 19절과 20절 사이에 옮겨 실린 41:6-7이다. 2026-11-07 화면의 키와 줄 수 그대로다.
const ISA40_SAVE = [...poem("4", "4", "ab"), ...poem("5", "5", "abc"), ...poem("6", "6", "abcd"), ...poem("7", "7", "abc"),
  ...poem("8", "8", "ab"), ...poem("18", "18", "ab"), ...poem("19", "19", "abc"), ...moved("6_c41", "6", "ab", "41"),
  ...moved("7_c41", "7", "abcdef", "41"), ...poem("20", "20", "ab"), ...poem("21", "21", "abcd")];
const isaLines = (...verses) => verses.flatMap((v) => linesOf(ISA40_SAVE, v));

test("북마크 저장: 이사 40:19부터 20까지 고르면 사이에 옮겨 실린 41:6-7은 저장하지 않는다(종전 「6-7,19-20」)", () => {
  const a = articleOf(ISA40_SAVE);
  assert.strictEqual(saveSpec(isaLines("19", "6_c41", "7_c41", "20"), a), "19-20");
  assert.strictEqual(saveSpec(isaLines("18", "19", "6_c41", "7_c41", "20", "21"), a), "18-21");   // 종전 「6-7,18-21」
  assert.strictEqual(saveSpec(isaLines("19", "20"), a), "19-20");                                 // 19절과 20절만 눌러도 같다
  assert.strictEqual(saveSpec(isaLines("6_c41", "7_c41", "20"), a), "20");                       // 41:6부터 20절까지, 종전 「6-7,20」
});

test("북마크 저장: 이사 40:5-7에서 이 장의 6-7절은 저장하고, 함께 고른 41:6은 5절과 7절 사이를 메우지 않는다", () => {
  const a = articleOf(ISA40_SAVE);
  assert.strictEqual(saveSpec(isaLines("5", "6", "7"), a), "5-7");
  assert.strictEqual(saveSpec(isaLines("5", "6", "7", "6_c41", "7_c41"), a), "5-7");
  // 5절과 7절에 41:6을 함께 고르면 「5,7」이다. 종전엔 41:6의 번호가 사이를 메워 「5-7」이 되어, 고르지 않은 40:6까지 저장했다.
  assert.strictEqual(saveSpec(isaLines("5", "7", "6_c41"), a), "5,7");
  assert.strictEqual(saveSpec(isaLines("4", "8", "6_c41", "7_c41"), a), "4,8");                  // 종전 「4,6-8」
});

test("북마크 저장: 옮겨 실린 절만 고르면 지금처럼 그 번호로 저장한다. 이사 40장의 41:6-7은 「6-7」(하위 절 표기를 정할 때 고친다)", () => {
  const a = articleOf(ISA40_SAVE);
  assert.strictEqual(saveSpec(isaLines("6_c41", "7_c41"), a), "6-7");
  assert.strictEqual(saveSpec(["7_c41/7c"], a), "7");
});

test("북마크 저장: 다니 3장에서 히브리 절과 함께 고른 그리스어 추가 본문은 저장하지 않는다(종전 23절부터 24(91)절까지가 실제 장에서 「23-90」)", () => {
  const a = articleOf(DAN3);
  assert.strictEqual(saveSpec(DAN3.map(([k]) => k).slice(0, -2), a), "23-24");                    // 23절부터 24(91)절까지, 이 발췌에서 종전 「23-26」
  assert.strictEqual(saveSpec(["23/23", "24_lxx/24", "25_lxx/25"], a), "23");                    // 종전 「23-25」
  assert.strictEqual(saveSpec(["25_lxx/25", "26_lxx/26a", "26_lxx/26b", "24_91/24"], a), "24");  // 종전 「24-26」
  assert.strictEqual(saveSpec(["24_lxx/24", "25_lxx/25"], a), "24-25");                           // 그리스어 절만이면 지금처럼
});

test("북마크 저장: 에스 4:17의 추가 본문은 이 장의 번호라 빼지 않는다. 한 번호를 여러 절이 함께 써서 「17」이다(known-issues §16.2)", () => {
  const a = articleOf(ESTH4);
  assert.strictEqual(saveSpec(["16/16", ...linesOf(ESTH4, "17_5")], a), "16-17");
  assert.strictEqual(saveSpec(["17_14/17a", "17_14/17b"], a), "17");
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
