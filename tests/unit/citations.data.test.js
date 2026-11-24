// ── citations.js 의 옮겨 실린 절 찾기 ↔ 실데이터 — data/ 서브모듈이 있어야 돈다 ───────────────
// Run with: node --test tests/unit/citations.data.test.js
//
// **공개 저장소의 필수 `Unit tests` 잡에서는 돌지 않는다**(서브모듈이 없다) — engine-data.yml ·
// sync-data.yml 에서 돈다. 합성 장으로 볼 수 있는 것(범위에서 멈추기 · 책 끝)은 citations.test.js 에 있다.
//
// 인용 시트는 인용한 절이 그 장 파일에 없으면 앞뒤 장에서 `chapter_ref` 로 찾는데(ADR-003 — 인쇄본이 다른 장
// 사이에 실은 절), 앞뒤 3장(`RELOCATION_MAX_DISTANCE`)에서 멈춘다(PR #353 리뷰, 2026-10-17 — 그전엔 없는 절이면
// 책의 모든 장을 받았다). 여기서는 데이터에 옮겨 실린 절이 하나도 빠짐없이 그 안에서 찾아지는지 본다 — 데이터에
// 더 먼 절이 생기면 인용 시트가 조용히 빈칸이 되는 대신 이 테스트가 데이터 동기화 때 걸린다.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAppHelpers } from "./harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const BIBLE_DIR = path.join(ROOT, "data/bible");
const BOOKS_JSON = path.join(ROOT, "data/books.json");
const haveData = fs.existsSync(BOOKS_JSON) && fs.existsSync(BIBLE_DIR);
const SKIP = haveData ? false : "data/ 서브모듈 미체크아웃 — 로컬과 engine-data.yml·sync-data.yml 에서 돈다";

// citations.js reads `window.appHelpers` · `window.appOverlay` at load; the lookup itself only needs `fetch` and
// `window.booksPromise`, served here from the data files on disk.
function loadCitations() {
  const ctx = {
    console, JSON, Date, Math, Object, Array, Set, Map, Promise, Error, String, Number, Boolean, parseInt, parseFloat,
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  ctx.appHelpers = { el: () => ({}), clearNode: () => {}, hangingQuoteClass: () => "", trapFocus: () => () => {} };
  ctx.appOverlay = { createOverlay: () => ({ open() {}, close() {}, get isOpen() { return false; } }) };
  ctx.document = {
    createTextNode: () => ({}), addEventListener: () => {}, body: { addEventListener: () => {} },
    documentElement: { classList: { add: () => {}, remove: () => {} } }, getElementById: () => null,
  };
  ctx.booksPromise = Promise.resolve(JSON.parse(fs.readFileSync(BOOKS_JSON, "utf8")));
  ctx.fetch = async (url) => {
    const file = path.join(BIBLE_DIR, path.basename(String(url)));
    if (!fs.existsSync(file)) return { ok: false, json: async () => null };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  const source = fs.readFileSync(path.join(ROOT, "js/app/citations.js"), "utf8").replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");
  vm.runInContext(source, ctx, { filename: "citations.js" });
  return ctx.appCitations;
}

// Every verse a chapter file holds for another chapter: { bookId, physical, ch, number }.
function relocatedVerses() {
  const out = [];
  for (const name of fs.readdirSync(BIBLE_DIR)) {
    const m = name.match(/^(.+)-(\d+)\.json$/);
    if (!m) continue;
    const physical = Number(m[2]);
    const data = JSON.parse(fs.readFileSync(path.join(BIBLE_DIR, name), "utf8"));
    for (const v of data.verses ?? []) {
      if (v.chapter_ref != null && v.chapter_ref !== physical) {
        out.push({ bookId: m[1], physical, ch: v.chapter_ref, number: v.number });
      }
    }
  }
  return out;
}

test("옮겨 실린 절은 모두 인용 시트의 탐색 범위(앞뒤 3장) 안에서 그 자리 장으로 찾아진다", { skip: SKIP }, async () => {
  const c = loadCitations();
  const relocated = relocatedVerses();
  // 데이터에 옮겨 실린 절이 하나도 없다면 이 검사는 아무것도 지키지 않는다 — 읽기가 깨진 것으로 본다.
  assert.ok(relocated.length > 0, "data/bible 에서 chapter_ref 로 옮겨 실린 절을 하나도 찾지 못했다");
  for (const { bookId, physical, ch, number } of relocated) {
    const label = `${bookId} ${ch}:${number}(인쇄본 ${physical}장)`;
    const r = await c._findRelocated(bookId, ch, [{ startCh: ch, startV: number, endCh: null, endV: null }]);
    assert.ok(r, `${label} 을 찾지 못했다 — 탐색 범위(RELOCATION_MAX_DISTANCE) 밖이거나 그 장 파일이 없다`);
    assert.equal(r.fromChapter, physical, label);
    assert.ok(r.verses.some((v) => v.number === number && v.chapter_ref === ch), label);
  }
});

// 운문에서 두 글자 사이의 따옴표는 양옆 글자와 줄바꿈하지 않는 상자로 묶는다(helpers.js wrapQuoteRuns, ADR-053 §2).
// 묶음은 글자 조각 하나 안에서만 만들고, 어절 주석은 그 전에 낱말을 제 상자로 떼어 낸다. 그래서 주석의 경계가 묶음
// 자리를 가르면 그 행은 따옴표 옆에서 다시 줄이 바뀔 수 있다. 지금 데이터에는 그런 주석이 없다(2026-11-23) — 생기면
// 여기서 걸린다.
test("운문의 어절 주석은 따옴표 묶음 자리를 가르지 않는다", { skip: SKIP }, () => {
  const { quoteRuns } = loadAppHelpers();
  let anchors = 0;
  /** @type {string[]} */
  const split = [];
  for (const name of fs.readdirSync(BIBLE_DIR)) {
    if (!/^.+-\d+\.json$/.test(name)) continue;
    const data = JSON.parse(fs.readFileSync(path.join(BIBLE_DIR, name), "utf8"));
    for (const v of data.verses ?? []) {
      const words = (v.notes ?? []).map((n) => n.anchor).filter(Boolean);
      if (!words.length) continue;
      for (const seg of v.segments ?? []) {
        if (seg.type !== "poetry") continue;
        for (const line of seg.text.split("\n")) {
          const runs = Array.from(quoteRuns(line));
          for (const word of words) {
            for (let at = line.indexOf(word); at >= 0; at = line.indexOf(word, at + word.length)) {
              anchors++;
              const end = at + word.length;
              if (runs.some(([s, e]) => (s < at && at < e) || (s < end && end < e))) split.push(`${name} ${v.number}: ${word}`);
            }
          }
        }
      }
    }
  }
  assert.ok(anchors > 0, "data/bible 의 운문에서 어절 주석을 하나도 찾지 못했다");
  assert.deepEqual(split, []);
});

// 선창 끝 ◯는 마지막 글자와 함께 줄바꿈하지 않는 상자에 넣는다(helpers.js holdResponsoryMarks, ADR-053 §2). 검색 강조는
// 둘로 나눠 마지막 글자만 상자에 넣지만, 어절 주석은 단추라 나누지 못한다. 공백이 없는 주석은 통째로 상자에 들어 긴 낱말이
// 본문 칸을 넘을 수 있고, 공백이 있는 주석은 상자에 들지 않아 Safari가 그 뒤에서 ◯를 넘길 수 있다(2026-11-24 리뷰). 지금
// 전례시편과 송가에는 어절 주석이 없다(2026-11-24) — 선창 줄의 마지막 낱말에 주석이 생기면 여기서 걸린다.
test("◯가 붙는 선창 줄의 마지막 낱말에는 어절 주석이 없다", { skip: SKIP }, () => {
  let cantorLines = 0;
  /** @type {string[]} */
  const touched = [];
  for (const name of fs.readdirSync(BIBLE_DIR)) {
    if (!/^(lps|cant)-\d+\.json$/.test(name)) continue;
    const data = JSON.parse(fs.readFileSync(path.join(BIBLE_DIR, name), "utf8"));
    for (const v of data.verses ?? []) {
      const segs = v.segments ?? [];
      const words = (v.notes ?? []).map((n) => n.anchor).filter(Boolean);
      segs.forEach((seg, i) => {
        if (seg.response || !segs[i + 1]?.response) return;   // ◯ 는 응답이 따라오는 선창 줄 끝에만 붙는다
        cantorLines++;
        const lines = seg.text.split("\n");
        const line = lines[lines.length - 1];
        const lastWord = line.lastIndexOf(" ") + 1;
        for (const word of words) {
          for (let at = line.indexOf(word); at >= 0; at = line.indexOf(word, at + word.length)) {
            if (at + word.length > lastWord) touched.push(`${name} ${v.number}: ${word}`);
          }
        }
      });
    }
  }
  assert.ok(cantorLines > 2000, `◯가 붙는 선창 줄이 ${cantorLines}개뿐이다`);
  assert.deepEqual(touched, []);
});
