"use strict";

// Unit tests for js/app/routing.js — the pure PARSE_PATH block (parsePath).
// parsePath turns location.pathname/search into a route descriptor with no DOM
// or history side effects, so it slices cleanly into a bare vm. The real
// verse-spec VERSE_SPEC block (parseVerseSpec / selectedVersesToSpec) is loaded
// alongside so the multi-segment deep-link branch is exercised faithfully
// rather than against a stub. Harness mirrors tests/unit/views.test.js.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROUTING_PATH = path.resolve(__dirname, "../../js/app/routing.js");
const ROUTING_SOURCE = fs.readFileSync(ROUTING_PATH, "utf8");
const VERSE_SPEC_PATH = path.resolve(__dirname, "../../js/app/verse-spec.js");
const VERSE_SPEC_SOURCE = fs.readFileSync(VERSE_SPEC_PATH, "utf8");

/** Slice a `// ── BEGIN NAME ── … // ── END NAME ──` block out of a source. */
function extractBlock(name, source, file) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in ${file}`);
  }
  return source.slice(startIdx, endIdx + end.length);
}

// ── parsePath loader ─────────────────────────────────────────────────────────
// Builds a context whose `location` is mutable so each test can point at a
// different URL without rebuilding the vm. DIVISION_LABELS carries the real
// division ids so a single-segment division resolves differently from a book.

function loadParsePath() {
  const locationStub = { pathname: "/", search: "" };
  const ctx = {
    Promise, Object, Array, Set, Map, JSON, console, Error, Math, RegExp,
    String, Number, parseInt, parseFloat, isFinite, decodeURIComponent,
    URLSearchParams,
    location: locationStub,
  };
  vm.createContext(ctx);
  const prelude = `
    const DIVISION_LABELS = {
      old_testament: "구약",
      deuterocanon: "외경",
      new_testament: "신약",
    };
  `;
  vm.runInContext(
    prelude
      + extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE, "verse-spec.js")
      + extractBlock("PARSE_PATH", ROUTING_SOURCE, "routing.js"),
    ctx,
    { filename: "routing.js" },
  );
  return {
    /** @param {string} pathname @param {string} [search] */
    parse(pathname, search = "") {
      locationStub.pathname = pathname;
      locationStub.search = search;
      return ctx.parsePath();
    },
  };
}

const { parse } = loadParsePath();

// ── root + tab destinations ──

test("parsePath: 루트('/')는 books 뷰", () => {
  assert.deepEqual(parse("/"), { view: "books" });
});

test("parsePath: 빈 pathname(슬래시 없음)도 books", () => {
  assert.deepEqual(parse(""), { view: "books" });
});

test("parsePath: /bookmarks → bookmarks 뷰", () => {
  assert.deepEqual(parse("/bookmarks"), { view: "bookmarks" });
});

test("parsePath: /settings → settings 뷰", () => {
  assert.deepEqual(parse("/settings"), { view: "settings" });
});

// ── search route ──

test("parsePath: /search 빈 쿼리는 기본값(page 1, filterBooks [])", () => {
  assert.deepEqual(parse("/search"), {
    view: "search", query: "", page: 1, filterBooks: [],
  });
});

test("parsePath: /search 쿼리·페이지·in 스코프 파싱", () => {
  const r = parse("/search", "?q=사랑&page=3&in=john&in=mark");
  assert.equal(r.view, "search");
  assert.equal(r.query, "사랑");
  assert.equal(r.page, 3);
  assert.deepEqual(r.filterBooks, ["john", "mark"]);
});

test("parsePath: /search page가 비정상이면 1로 폴백", () => {
  assert.equal(parse("/search", "?page=abc").page, 1);
  assert.equal(parse("/search", "?page=0").page, 1);
});

test("parsePath: /search in의 빈 값은 걸러짐", () => {
  assert.deepEqual(parse("/search", "?in=&in=john").filterBooks, ["john"]);
});

// ── bookmark-read route (ADR-035) ──

test("parsePath: /read → bookmark-read, folderId null", () => {
  assert.deepEqual(parse("/read"), { view: "bookmark-read", folderId: null });
});

test("parsePath: /read/<id> → folderId 디코드", () => {
  assert.deepEqual(parse("/read/abc123"),
    { view: "bookmark-read", folderId: "abc123" });
});

test("parsePath: /read/<id> percent-encoding 디코드", () => {
  assert.equal(parse("/read/a%20b").folderId, "a b");
});

// ── division vs book (single segment) ──

test("parsePath: 알려진 division id → division 뷰", () => {
  assert.deepEqual(parse("/old_testament"),
    { view: "division", division: "old_testament" });
  assert.deepEqual(parse("/deuterocanon"),
    { view: "division", division: "deuterocanon" });
});

test("parsePath: division이 아닌 단일 세그먼트는 책 chapters 뷰", () => {
  assert.deepEqual(parse("/genesis"), { view: "chapters", bookId: "genesis" });
});

// ── prologue ──

test("parsePath: /<book>/prologue → prologue 뷰", () => {
  assert.deepEqual(parse("/john/prologue"), { view: "prologue", bookId: "john" });
});

// ── chapter view + verse deep-links ──

test("parsePath: /<book>/<chapter> → chapter 뷰, 하이라이트 없음", () => {
  const r = parse("/john/3");
  assert.equal(r.view, "chapter");
  assert.equal(r.bookId, "john");
  assert.equal(r.chapter, 3);
  assert.equal(r.highlightVerse, null);
  assert.equal(r.highlightVerseEnd, null);
  assert.equal(r.highlightVerseSpec, null);
  assert.equal(r.resume, false);
});

test("parsePath: 단일 절 딥링크 /<book>/<ch>/<v>", () => {
  const r = parse("/john/3/16");
  assert.equal(r.highlightVerse, 16);
  assert.equal(r.highlightVerseEnd, null);
});

test("parsePath: 절 범위 딥링크 /<book>/<ch>/<v1>-<v2>", () => {
  const r = parse("/john/3/16-20");
  assert.equal(r.highlightVerse, 16);
  assert.equal(r.highlightVerseEnd, 20);
});

test("parsePath: 역순 범위는 min/max로 정규화", () => {
  const r = parse("/john/3/20-16");
  assert.equal(r.highlightVerse, 16);
  assert.equal(r.highlightVerseEnd, 20);
});

test("parsePath: 동일 범위(16-16)는 단일 절로 축약", () => {
  const r = parse("/john/3/16-16");
  assert.equal(r.highlightVerse, 16);
  assert.equal(r.highlightVerseEnd, null);
});

test("parsePath: 다중 세그먼트 스펙은 verse-spec로 정규화", () => {
  const r = parse("/john/3/10-12,1-3");
  // segs sorted ascending → start 1, end 12; spec re-serialized canonical.
  assert.equal(r.highlightVerse, 1);
  assert.equal(r.highlightVerseEnd, 12);
  assert.equal(r.highlightVerseSpec, "1-3,10-12");
});

test("parsePath: 부분 절(3a,3b) 스펙 보존", () => {
  const r = parse("/john/3/3a,3b");
  assert.equal(r.highlightVerse, 3);
  assert.equal(r.highlightVerseSpec, "3a,3b");
});

test("parsePath: hl 쿼리는 highlightQuery로 전달", () => {
  assert.equal(parse("/john/3/16", "?hl=사랑").highlightQuery, "사랑");
});

test("parsePath: resume 쿼리 존재 시 resume true", () => {
  assert.equal(parse("/john/3", "?resume").resume, true);
});

test("parsePath: chapter는 정수로 파싱", () => {
  assert.strictEqual(parse("/genesis/12").chapter, 12);
});
