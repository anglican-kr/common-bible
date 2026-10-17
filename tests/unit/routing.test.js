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

test("parsePath: /read/<깨진 퍼센트 이스케이프>는 throw 하지 않고 원문을 folderId 로 — 뷰가 「읽을 북마크가 없습니다」(PR #348 리뷰)", () => {
  // parsePath 는 route() 의 try 밖에서 돈다 — 여기서 throw 하면 런치 화면이 걷히지 않는다(known-issues §6 이던 것).
  assert.deepEqual(parse("/read/%E0%A4%A"), { view: "bookmark-read", folderId: "%E0%A4%A" });
});

test("parsePath: /read/<id> percent-encoding 디코드", () => {
  assert.equal(parse("/read/a%20b").folderId, "a b");
});

// ── lectionary route (ADR-038 §3) ──

test("parsePath: /lectionary → lectionary 뷰, date null(오늘), 상태 전부 null", () => {
  assert.deepEqual(parse("/lectionary"), {
    view: "lectionary", date: null, obs: null, track: null, set: null, collect: null,
  });
});

test("parsePath: /lectionary/YYYY-MM-DD + 쿼리 네 키 파싱", () => {
  const r = parse("/lectionary/2026-04-05", "?obs=grid:easter-1-sunday&track=2&set=2&collect=3");
  assert.deepEqual(r, {
    view: "lectionary", date: "2026-04-05", obs: "grid:easter-1-sunday", track: 2, set: 2, collect: 3,
  });
});

test("parsePath: lectionary 쿼리의 범위 밖 값은 null(track 3 · set 0 · 빈 obs)", () => {
  const r = parse("/lectionary/2026-04-05", "?obs=&track=3&set=0&collect=abc");
  assert.equal(r.obs, null);
  assert.equal(r.track, null);
  assert.equal(r.set, null);
  assert.equal(r.collect, null);
});

test("parsePath: lectionary 쿼리 값은 통째로 양의 정수여야 한다 — 「2junk」 「1.5」 「3x」 「02」 는 null(Copilot 3회차)", () => {
  const r = parse("/lectionary/2026-04-05", "?track=2junk&set=1.5&collect=3x");
  assert.deepEqual([r.track, r.set, r.collect], [null, null, null]);
  assert.equal(parse("/lectionary/2026-04-05", "?set=02").set, null);
  assert.equal(parse("/lectionary/2026-04-05", "?set=12").set, 12);
  // 자릿수가 넘치면 Number 가 Infinity · 근사 정수가 된다 — 안전 정수가 아니면 null(Copilot 10회차)
  assert.equal(parse("/lectionary/2026-04-05", "?set=" + "9".repeat(400)).set, null);
  assert.equal(parse("/lectionary/2026-04-05", "?collect=9007199254740993").collect, null);
  assert.equal(parse("/lectionary/2026-04-05", "?collect=9007199254740991").collect, 9007199254740991);
});

test("parsePath: 깨진 퍼센트 이스케이프는 throw 하지 않고 원문을 date 로 넘긴다 — 뷰가 「잘못된 날짜」로 거부(Copilot 3회차)", () => {
  assert.equal(parse("/lectionary/%E0%A4%A").date, "%E0%A4%A");
  assert.equal(parse("/lectionary/2026-04-05").date, "2026-04-05");
});

test("parsePath: /lectionary/ 아래 나머지는 date 로 그대로 넘긴다(검증은 뷰) — A4 의 d/<slug> 포함", () => {
  assert.equal(parse("/lectionary/d/advent-1-sun-A").date, "d/advent-1-sun-A");
  assert.equal(parse("/lectionary/2026-13-99").date, "2026-13-99");
});

test("parsePath: 'lectionary' 는 책 id 로 읽히지 않는다", () => {
  assert.equal(parse("/lectionary").view, "lectionary");
  assert.equal(parse("/lectionaryx").view, "chapters");   // 정확 일치 · 접두 'lectionary/' 만
});

// ── calendar route (ADR-038 §1 · §2 A2) ──

test("parsePath: /calendar → calendar 월간, month null(이번 달)", () => {
  assert.deepEqual(parse("/calendar"), { view: "calendar", mode: "month", month: null });
});

test("parsePath: /calendar/YYYY-MM → 그 달 — 검증은 뷰(깨진 값도 month 로 넘긴다)", () => {
  assert.deepEqual(parse("/calendar/2026-11"), { view: "calendar", mode: "month", month: "2026-11" });
  assert.equal(parse("/calendar/2026-13").month, "2026-13");
  assert.equal(parse("/calendar/%E0%A4%A").month, "%E0%A4%A");   // 깨진 퍼센트 이스케이프는 throw 하지 않는다
});

test("parsePath: 'calendar' 는 책 id 로 읽히지 않는다 — 정확 일치 · 접두 'calendar/' 만", () => {
  assert.equal(parse("/calendar").view, "calendar");
  assert.equal(parse("/calendarx").view, "chapters");
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

// ── IN_PAGE_LINK — 페이지 안 링크(「본문 바로가기」)는 라우트가 아니다 ─────────────
// 전역 <a> 인터셉터가 이것으로 갈라 대상으로 포커스만 옮긴다(known-issues §5 — 그전엔 route() 로 같은 화면을 다시 그렸다).

function loadInPageLink() {
  const ctx = { decodeURIComponent, String };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("IN_PAGE_LINK", ROUTING_SOURCE, "routing.js"), ctx, { filename: "routing.js#in-page" });
  return ctx.inPageTargetId;
}
const inPageTargetId = loadInPageLink();
const linkUrl = (href) => new URL(href, "https://bible.anglican.kr/john/3?hl=x");
const HERE = { pathname: "/john/3", search: "?hl=x" };

test("inPageTargetId: 같은 경로 · 쿼리로 가는 조각 링크는 대상 id — 「본문 바로가기」(#app)", () => {
  assert.strictEqual(inPageTargetId(linkUrl("#app"), HERE), "app");
  assert.strictEqual(inPageTargetId(linkUrl("/john/3?hl=x#app"), HERE), "app");
  assert.strictEqual(inPageTargetId(linkUrl("#%EB%B3%B8%EB%AC%B8"), HERE), "본문");   // 퍼센트 이스케이프는 풀어서
  assert.strictEqual(inPageTargetId(linkUrl("#%E0%A4%A"), HERE), "%E0%A4%A");        // 깨진 이스케이프는 원문 그대로(throw 아님)
});

test("inPageTargetId: 조각이 없거나(빈 「#」 포함) 다른 경로 · 쿼리로 가는 링크는 null — 라우터가 이동한다", () => {
  for (const href of ["/john/3?hl=x", "/john/4#app", "/john/3#app", "#", "/john/3?hl=x#"]) {
    assert.strictEqual(inPageTargetId(linkUrl(href), HERE), null, href);
  }
});
