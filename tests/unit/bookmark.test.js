// ── Unit tests for js/app/bookmark.js ────────────────────────────────────────
// Run with: node --test tests/unit/bookmark.test.js
//
// Same vm + BEGIN/END marker slice approach as search.test.js. The bookmark
// surface is partly DOM/pointer-event bound at module top level (drag handle
// setup, swipe state mutations against real DOM rows), so we extract testable
// blocks via marker pairs and run each in a vm context with the minimum stubs
// that block needs. The blocks now live across the split bookmark modules
// (bookmark-core / -modals / -gestures / verse-spec); each loader names the
// source it slices from.
//
// Coverage:
//   - VERSE_SPEC block — verse spec parse / compare / serialize / merge
//     + isWellFormedSpec, the check a spec from outside (import file ·
//     address) must pass, over specs written with a tiny
//     `article.querySelectorAll` stub (selectedSpanVrefs · selectionCitation).
//     The save serializer (verseNumberSpec), the move of the pre-#205 forms
//     (wholeVerseSpec) and the verse-select citation are in verse-spec.test.js
//   - BOOKMARK_LEGACY block (with VERSE_SPEC) — migrateLegacyBookmark, the
//     move of a pre-#205 bookmark's verse range and old default name
//   - BOOKMARK_QUERY block — _isDescendant / _walkBookmarks / findExistingChapterBookmarks
//     / _findItemInStore / _findParentFolderId / removeItemById / insertItem
//     / collectFolderOptions. `loadBookmarks` provided as stub.
//   - DRAG_CORE block (loaded after BOOKMARK_QUERY so `_findItemInStore` and
//     `_isDescendant` resolve) — moveBookmarkItem.
//   - SWIPED_ROW block — closeSwipedRow / _openSwipedRow / resetSwipedRow
//     / closeSwipedRowIfOutside, with a minimal Element stub.
//   - BOOKMARK_HREF block — _bookmarkHref (pure URL builder).
//   - BOOKMARK_ACTIVE block — _renderPathname state + _isActiveBookmark
//     + _hasActiveDescendant. Tests pass the pathname explicitly via the
//     optional parameter rather than driving the renderer.
//   - IMPORT_EXPORT block — _validateImportData / _mergeBookmarkStores /
//     _countBookmarks / _sanitizeImportItems / _fitsStorage
//     (pure helpers, no DOM — loaded after VERSE_SPEC, whose isWellFormedSpec
//     the item check imports), with the real sync store (js/sync/store-v2.js)
//     for the save-and-read round trips.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripEsmMarker, makeLocalStorage } from "./harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKMARK_PATH = path.resolve(__dirname, "../../js/app/bookmark.js");
const BOOKMARK_SOURCE = fs.readFileSync(BOOKMARK_PATH, "utf8");
// Verse-spec utilities moved to verse-spec.js (ADR-034 후속); the VERSE_SPEC
// marker block now lives there, so its loader slices from this source.
const VERSE_SPEC_PATH = path.resolve(__dirname, "../../js/app/verse-spec.js");
const VERSE_SPEC_SOURCE = fs.readFileSync(VERSE_SPEC_PATH, "utf8");
// Href/share, sort, query/tree, and active-route helpers moved to bookmark-core.js
// (ADR-034 후속 PR2~4); their marker blocks (BOOKMARK_HREF / BOOKMARK_SORT /
// BOOKMARK_QUERY / BOOKMARK_ACTIVE) now live there.
const BOOKMARK_CORE_PATH = path.resolve(__dirname, "../../js/app/bookmark-core.js");
const BOOKMARK_CORE_SOURCE = fs.readFileSync(BOOKMARK_CORE_PATH, "utf8");
// Modal dialogs (incl. the IMPORT_EXPORT pure helpers) moved to bookmark-modals.js
// (ADR-034 후속 PR5); the IMPORT_EXPORT marker block now lives there.
const BOOKMARK_MODALS_PATH = path.resolve(__dirname, "../../js/app/bookmark-modals.js");
const BOOKMARK_MODALS_SOURCE = fs.readFileSync(BOOKMARK_MODALS_PATH, "utf8");
// Gesture engine (drag/swipe pointer handling) moved to bookmark-gestures.js
// (ADR-034 후속); the DRAG_CORE / SWIPED_ROW / SWIPE_GESTURE marker blocks now
// live there, so their loaders slice from this source.
const BOOKMARK_GESTURES_PATH = path.resolve(__dirname, "../../js/app/bookmark-gestures.js");
const BOOKMARK_GESTURES_SOURCE = fs.readFileSync(BOOKMARK_GESTURES_PATH, "utf8");
// Select-delete mode (cascade math) moved to bookmark-select.js (ADR-034 후속);
// the BOOKMARK_SELECT marker block now lives there.
const BOOKMARK_SELECT_PATH = path.resolve(__dirname, "../../js/app/bookmark-select.js");
const BOOKMARK_SELECT_SOURCE = fs.readFileSync(BOOKMARK_SELECT_PATH, "utf8");

function extractBlock(name, source = BOOKMARK_SOURCE) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found`);
  }
  return source.slice(startIdx, endIdx + end.length);
}

// ── Helpers shared across loaders ─────────────────────────────────────────────

// Build a fresh sample bookmark store. Each test that mutates calls this
// to avoid state bleeding across cases.
function sampleStore() {
  return [
    { type: "bookmark", id: "bm-root1", bookId: "gen", chapter: 1, verseSpec: "all" },
    {
      type: "folder",
      id: "fld-old",
      name: "Old Testament",
      children: [
        { type: "bookmark", id: "bm-ot1", bookId: "exo", chapter: 3, verseSpec: "1-5" },
        {
          type: "folder",
          id: "fld-pent",
          name: "Pentateuch",
          children: [
            { type: "bookmark", id: "bm-pent1", bookId: "deu", chapter: 6, verseSpec: "all" },
          ],
        },
      ],
    },
    { type: "bookmark", id: "bm-root2", bookId: "gen", chapter: 1, verseSpec: "1-3" },
  ];
}

// ── VERSE_SPEC loader ────────────────────────────────────────────────────────
// `selectedSpanVrefs` · `selectionCitation` call `article.querySelectorAll`
// and read `.getAttribute("data-vref")` · `("data-vkey")`. We pass a tiny stub
// article — no full DOM needed for this slice.

function loadVerseSpec() {
  const ctx = {
    Object, Array, Set, String, Math, Number, JSON, console, Error,
    parseInt,
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  return {
    parseVerseSpec: ctx.parseVerseSpec,
    isWellFormedSpec: ctx.isWellFormedSpec,
    verseNumberSpec: ctx.verseNumberSpec,
    wholeVerseSpec: ctx.wholeVerseSpec,
    selectedSpanVrefs: ctx.selectedSpanVrefs,
    selectionCitation: ctx.selectionCitation,
    _compareRefs: ctx._compareRefs,
    selectedVersesToSpec: ctx.selectedVersesToSpec,
    mergeVerseSpecs: ctx.mergeVerseSpecs,
  };
}

/**
 * Tiny article stub for `selectedSpanVrefs` · `selectionCitation`. Each ref
 * string in `verseSpans` becomes one element with a `.getAttribute("data-vref")`
 * that returns the string. `querySelectorAll(...)` returns them all, regardless
 * of selector specifics — every selector those functions use matches all spans.
 */
function makeStubArticle(verseSpans) {
  // `data-vkey` is "<i>/<ref>" — one key per span, as views.js appendVerses gives (selectionCitation reads it).
  const elements = verseSpans.map((ref, i) => ({
    getAttribute(name) { return name === "data-vref" ? ref : name === "data-vkey" ? `${i}/${ref}` : null; },
    classList: { contains: () => false },
  }));
  return {
    querySelectorAll(_selector) { return elements; },
  };
}

// ── BOOKMARK_QUERY loader ────────────────────────────────────────────────────

function loadBookmarkQuery(initialStore = []) {
  const ctx = {
    Object, Array, Set, String, Number, JSON, console, Error,
  };
  vm.createContext(ctx);
  // `findExistingChapterBookmarks` calls `loadBookmarks()` from outer
  // scope. The prelude provides a stub the test can swap by reassigning
  // `ctx._loadBookmarksImpl`.
  let storeForLoad = initialStore;
  const prelude = `
    function loadBookmarks() { return _loadBookmarksImpl(); }
  `;
  ctx._loadBookmarksImpl = () => storeForLoad;
  vm.runInContext(prelude + extractBlock("BOOKMARK_QUERY", BOOKMARK_CORE_SOURCE), ctx, { filename: "bookmark-core.js" });
  return {
    ctx,
    setStore: (s) => { storeForLoad = s; },
    _walkBookmarks: ctx._walkBookmarks,
    findExistingChapterBookmarks: ctx.findExistingChapterBookmarks,
    _selectAllState: ctx._selectAllState,
    _bmSelectCountLabel: ctx._bmSelectCountLabel,
    _findItemInStore: ctx._findItemInStore,
    _findParentFolderId: ctx._findParentFolderId,
    removeItemById: ctx.removeItemById,
    insertItem: ctx.insertItem,
    collectFolderOptions: ctx.collectFolderOptions,
    _descendantIds: ctx._descendantIds,
    _isDescendant: ctx._isDescendant,
  };
}

// ── BOOKMARK_SELECT loader ───────────────────────────────────────────────────
// Pure cascade math for select-delete mode. The block reads the module-scoped
// `_bmSelected` set; the prelude defines it so each test can seed explicit ticks.
function loadBookmarkSelect() {
  const ctx = {
    Object, Array, Set, Map, String, Number, JSON, console, Error,
  };
  vm.createContext(ctx);
  // `var` (not const/let) so the Set surfaces as a context property the test can
  // seed via setSelected; the extracted functions close over the same binding.
  const prelude = `var _bmSelected = new Set();\n`;
  vm.runInContext(prelude + extractBlock("BOOKMARK_SELECT", BOOKMARK_SELECT_SOURCE), ctx, { filename: "bookmark-select.js" });
  return {
    /** @param {string[]} ids */
    setSelected: (ids) => { ctx._bmSelected.clear(); for (const id of ids) ctx._bmSelected.add(id); },
    _bmBuildParentMap: ctx._bmBuildParentMap,
    _bmAncestorSelected: ctx._bmAncestorSelected,
    _bmCountMarked: ctx._bmCountMarked,
    _bmEffectiveTargets: ctx._bmEffectiveTargets,
    _collectSelectedBookmarks: ctx._collectSelectedBookmarks,
  };
}

// ── DRAG_CORE loader ─────────────────────────────────────────────────────────
// Concatenates BOOKMARK_QUERY (so `_findItemInStore` resolves) + DRAG_CORE.
// Provides `loadBookmarks` / `commitBookmarks` stubs and a fake
// `window.renderBookmarkTree` so the post-move hook is observable. loadBookmarks
// hands out a copy, as the real one reads storage, so a refused save leaves the
// stored list as it was.

function loadDragCore() {
  let currentStore = [];
  const saveCalls = [];
  const renderCalls = { count: 0 };

  const ctx = {
    Object, Array, Set, String, Number, JSON, console, Error,
  };
  vm.createContext(ctx);
  // moveBookmarkItem calls the injected _rerenderTree() (ADR-034 후속: the
  // gesture module's hook into the orchestrator, which re-renders whichever
  // bookmark surface is mounted — drawer or /bookmarks full view). The DRAG_CORE
  // marker block doesn't include that hook, so the prelude stubs it (plus
  // loadBookmarks/commitBookmarks) to bump the observable counter.
  const prelude = `
    function loadBookmarks() { return JSON.parse(JSON.stringify(_store)); }
    function commitBookmarks(s) { _saveCalls.push(JSON.parse(JSON.stringify(s))); if (_refuse) return false; _store = s; return true; }
    function _rerenderTree() { _renderCalls.count += 1; }
  `;
  ctx._refuse = false;
  ctx._renderCalls = renderCalls;
  ctx._store = currentStore;
  ctx._saveCalls = saveCalls;
  vm.runInContext(
    prelude + extractBlock("BOOKMARK_QUERY", BOOKMARK_CORE_SOURCE) + "\n" + extractBlock("DRAG_CORE", BOOKMARK_GESTURES_SOURCE),
    ctx,
    { filename: "bookmark-gestures.js" },
  );
  return {
    ctx,
    setStore: (s) => { ctx._store = s; },
    getStore: () => ctx._store,
    refuseSaves: () => { ctx._refuse = true; },
    saveCalls,
    renderCalls,
    moveBookmarkItem: ctx.moveBookmarkItem,
    _findItemInStore: ctx._findItemInStore,
  };
}

// ── SWIPED_ROW loader ────────────────────────────────────────────────────────
// `closeSwipedRow`/`_openSwipedRow` mutate row.classList + read
// row.querySelector(".bm-row-content") + clear content.style.transform.
// `closeSwipedRowIfOutside` uses `_swipedRow.contains(target) && target
// instanceof Node`. We provide a minimal Element/Node stub that supports
// just those.

function loadSwipedRow() {
  // `Node` constructor stub — `instanceof Node` is the only check
  // closeSwipedRowIfOutside performs against `target`.
  class Node {}
  class Element extends Node {
    constructor() {
      super();
      this._classes = new Set();
      this._actionsChild = null;
      this.classList = {
        add: (...c) => c.forEach((x) => this._classes.add(x)),
        remove: (...c) => c.forEach((x) => this._classes.delete(x)),
        contains: (c) => this._classes.has(c),
      };
      /** @type {Set<Node>} */
      this._descendants = new Set();
    }
    /** Add a child as a descendant for `.contains()` to find. */
    appendChild(node) { this._descendants.add(node); return node; }
    setContentChild(content) { this._contentChild = content; }
    querySelector(selector) {
      if (selector === ".bm-row-content") return this._contentChild;
      return null;
    }
    contains(target) { return this === target || this._descendants.has(target); }
  }
  // Stub for the sliding .bm-row-content layer; the swipe helpers clear its
  // inline transform when opening/closing.
  class ContentEl extends Element {
    constructor() {
      super();
      this.style = { transform: "" };
    }
  }

  const ctx = { Object, Array, Set, String, Number, JSON, console, Error, Node };
  vm.createContext(ctx);
  // Append a peek helper. `let _swipedRow` is block-scoped to the script, so
  // ctx._swipedRow is undefined; a function declaration at the same script
  // scope can read the binding AND attaches itself to globalThis (script
  // semantics, not module), so ctx._peekSwipedRow becomes callable.
  const peekHelper = `\nfunction _peekSwipedRow() { return _swipedRow; }\n`;
  vm.runInContext(extractBlock("SWIPED_ROW", BOOKMARK_GESTURES_SOURCE) + peekHelper, ctx, { filename: "bookmark-gestures.js" });

  return {
    ctx,
    Node, Element, ContentEl,
    closeSwipedRow: ctx.closeSwipedRow,
    _openSwipedRow: ctx._openSwipedRow,
    resetSwipedRow: ctx.resetSwipedRow,
    closeSwipedRowIfOutside: ctx.closeSwipedRowIfOutside,
    /** @returns {any} */
    peekSwipedRow: () => ctx._peekSwipedRow(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

// ── parseVerseSpec ───────────────────────────────────────────────────────────

test('parseVerseSpec: empty string → empty array', () => {
  const h = loadVerseSpec();
  assert.deepEqual(h.parseVerseSpec(""), []);
});

test('parseVerseSpec: "all" → empty array', () => {
  const h = loadVerseSpec();
  assert.deepEqual(h.parseVerseSpec("all"), []);
});

test('parseVerseSpec: single verse "3" → [{start:3, end:3}]', () => {
  const h = loadVerseSpec();
  assert.deepEqual(h.parseVerseSpec("3"), [{ start: 3, end: 3 }]);
});

test('parseVerseSpec: range "3-5" → [{start:3, end:5}]', () => {
  const h = loadVerseSpec();
  assert.deepEqual(h.parseVerseSpec("3-5"), [{ start: 3, end: 5 }]);
});

test('parseVerseSpec: reversed range "5-3" normalized to {3, 5}', () => {
  const h = loadVerseSpec();
  assert.deepEqual(h.parseVerseSpec("5-3"), [{ start: 3, end: 5 }]);
});

test('parseVerseSpec: alpha suffix "3a" → {start:3, end:3, part:"a"}', () => {
  const h = loadVerseSpec();
  assert.deepEqual(h.parseVerseSpec("3a"), [{ start: 3, end: 3, part: "a" }]);
});

test('parseVerseSpec: mixed "1,3-5,7a" produces 3 segments in order', () => {
  const h = loadVerseSpec();
  const out = h.parseVerseSpec("1,3-5,7a");
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { start: 1, end: 1 });
  assert.deepEqual(out[1], { start: 3, end: 5 });
  assert.deepEqual(out[2], { start: 7, end: 7, part: "a" });
});

test('parseVerseSpec: tolerates whitespace around commas', () => {
  const h = loadVerseSpec();
  const out = h.parseVerseSpec(" 1 , 3-5 , 7a ");
  assert.equal(out.length, 3);
});

test('parseVerseSpec: zero "0" is dropped (only positives)', () => {
  const h = loadVerseSpec();
  assert.deepEqual(h.parseVerseSpec("0"), []);
});

test('parseVerseSpec: malformed "abc" segment is skipped', () => {
  const h = loadVerseSpec();
  assert.deepEqual(h.parseVerseSpec("abc"), []);
});

// ── _compareRefs ─────────────────────────────────────────────────────────────

test('_compareRefs: 3 < 4', () => {
  const h = loadVerseSpec();
  assert.ok(h._compareRefs("3", "4") < 0);
});

test('_compareRefs: 3 < 3a (integer comes before alpha at same number)', () => {
  const h = loadVerseSpec();
  assert.ok(h._compareRefs("3", "3a") < 0);
});

test('_compareRefs: 3a < 3b', () => {
  const h = loadVerseSpec();
  assert.ok(h._compareRefs("3a", "3b") < 0);
});

test('_compareRefs: 3b < 4 (any 3-prefixed sorts before 4)', () => {
  const h = loadVerseSpec();
  assert.ok(h._compareRefs("3b", "4") < 0);
});

// ── selectedVersesToSpec ─────────────────────────────────────────────────────

test('selectedVersesToSpec: empty array → "all"', () => {
  const h = loadVerseSpec();
  assert.equal(h.selectedVersesToSpec([]), "all");
});

test('selectedVersesToSpec: single int → "3"', () => {
  const h = loadVerseSpec();
  assert.equal(h.selectedVersesToSpec(["3"]), "3");
});

test('selectedVersesToSpec: consecutive ints compressed to range', () => {
  const h = loadVerseSpec();
  assert.equal(h.selectedVersesToSpec(["1", "2", "3", "4"]), "1-4");
});

test('selectedVersesToSpec: non-consecutive ints comma-listed', () => {
  const h = loadVerseSpec();
  assert.equal(h.selectedVersesToSpec(["1", "3", "5"]), "1,3,5");
});

test('selectedVersesToSpec: alpha refs kept individually, integers compressed', () => {
  const h = loadVerseSpec();
  // Sort order (per _compareRefs) is "3", "3a", "3b", "5", "6", "7"
  // → "3,3a,3b,5-7" (3 stays as int, alphas kept, 5-7 compressed)
  assert.equal(h.selectedVersesToSpec(["3a", "3b", "5", "6", "7"]), "3a,3b,5-7");
});

test('selectedVersesToSpec: deduplicates input', () => {
  const h = loadVerseSpec();
  assert.equal(h.selectedVersesToSpec(["3", "3", "3"]), "3");
});

// ── mergeVerseSpecs ──────────────────────────────────────────────────────────

test('mergeVerseSpecs: both "all" → "all"', () => {
  const h = loadVerseSpec();
  assert.equal(h.mergeVerseSpecs("all", "all"), "all");
});

test('mergeVerseSpecs: one "all" → "all"', () => {
  const h = loadVerseSpec();
  assert.equal(h.mergeVerseSpecs("all", "1-3"), "all");
  assert.equal(h.mergeVerseSpecs("1-3", "all"), "all");
});

test('mergeVerseSpecs: identical specs round-trip unchanged', () => {
  const h = loadVerseSpec();
  assert.equal(h.mergeVerseSpecs("3-5", "3-5"), "3-5");
});

test('mergeVerseSpecs: overlapping ranges merge into superset', () => {
  const h = loadVerseSpec();
  assert.equal(h.mergeVerseSpecs("3-5", "4-7"), "3-7");
});

test('mergeVerseSpecs: alpha ref dropped when integer covers same number', () => {
  // "3a" and "3" both reference verse 3; integer wins (intRefs.has(3))
  const h = loadVerseSpec();
  assert.equal(h.mergeVerseSpecs("3", "3a"), "3");
});

test('mergeVerseSpecs: part letters go — the result is in verse numbers, as a bookmark stores them', () => {
  const h = loadVerseSpec();
  assert.equal(h.mergeVerseSpecs("3a", "3b"), "3");
  assert.equal(h.mergeVerseSpecs("7-8", "9"), "7-9");
});

test('mergeVerseSpecs: a pre-#205 spec keeps its verses — 「16aa」에 1절을 합치면 16절이 빠졌다(2026-10-22 재현)', () => {
  const h = loadVerseSpec();
  assert.equal(h.mergeVerseSpecs("16aa", "1"), "1,16");          // 이사 10 — main은 「1」
  assert.equal(h.mergeVerseSpecs("7-8a", "1"), "1,7-8");         // 나훔 1 — main은 「1」
  assert.equal(h.mergeVerseSpecs("20a,20c", "1"), "1,20");       // 창세 27 — main은 「1,20a,20c」
  assert.equal(h.mergeVerseSpecs("16-17a", "16-17b"), "16-17");   // 아모 5 — main은 「all」(장 전체). 옛 판끼리만 닿는다
});

test('mergeVerseSpecs: a range from an unchecked import is not walked verse by verse (known-issues §15)', () => {
  const h = loadVerseSpec();
  const t0 = Date.now();
  assert.equal(h.mergeVerseSpecs("1-20000000", "5"), "1-20000000");   // main은 4-5초 뒤 「Set maximum size exceeded」
  assert.ok(Date.now() - t0 < 50, `${Date.now() - t0}ms`);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKMARK_QUERY tests
// ─────────────────────────────────────────────────────────────────────────────

// ── _walkBookmarks ───────────────────────────────────────────────────────────

test('_walkBookmarks: visits every node (recursive into folders)', () => {
  const h = loadBookmarkQuery();
  const visited = [];
  h._walkBookmarks(sampleStore(), (item) => { visited.push(item.id); });
  // Order: bm-root1 → fld-old → bm-ot1 → fld-pent → bm-pent1 → bm-root2
  assert.deepEqual(visited, [
    "bm-root1", "fld-old", "bm-ot1", "fld-pent", "bm-pent1", "bm-root2",
  ]);
});

test('_walkBookmarks: returning false short-circuits remaining traversal', () => {
  const h = loadBookmarkQuery();
  const visited = [];
  h._walkBookmarks(sampleStore(), (item) => {
    visited.push(item.id);
    return item.id === "bm-ot1" ? false : undefined;
  });
  assert.deepEqual(visited, ["bm-root1", "fld-old", "bm-ot1"]);
});

test('_walkBookmarks: folder with missing/null children does not throw', () => {
  const h = loadBookmarkQuery();
  const visited = [];
  const store = [
    { type: "folder", id: "f-nochildren" /* no children */ },
    { type: "folder", id: "f-null", children: null },
    { type: "bookmark", id: "bm" },
  ];
  assert.doesNotThrow(() => h._walkBookmarks(store, (item) => { visited.push(item.id); }));
  assert.deepEqual(visited, ["f-nochildren", "f-null", "bm"]);
});

test('_walkBookmarks: null root → no-op (no throw)', () => {
  const h = loadBookmarkQuery();
  assert.doesNotThrow(() => h._walkBookmarks(null, () => {}));
});

// ── findExistingChapterBookmarks ─────────────────────────────────────────────

test('findExistingChapterBookmarks: 0 matches when no bookmark in chapter', () => {
  const h = loadBookmarkQuery();
  h.setStore(sampleStore());
  assert.equal(h.findExistingChapterBookmarks("rev", 1).length, 0);
});

test('findExistingChapterBookmarks: returns 2 matches across root for same chapter', () => {
  const h = loadBookmarkQuery();
  h.setStore(sampleStore());
  // Sample has bm-root1 and bm-root2 both at gen/1
  const matches = h.findExistingChapterBookmarks("gen", 1);
  assert.equal(matches.length, 2);
  const ids = matches.map((m) => m.id).sort();
  assert.deepEqual(ids, ["bm-root1", "bm-root2"]);
});

test('findExistingChapterBookmarks: walks into nested folders', () => {
  const h = loadBookmarkQuery();
  h.setStore(sampleStore());
  // bm-pent1 (deu/6) is two folders deep
  const matches = h.findExistingChapterBookmarks("deu", 6);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "bm-pent1");
});

test('findExistingChapterBookmarks: empty store → empty array', () => {
  const h = loadBookmarkQuery();
  h.setStore([]);
  assert.equal(h.findExistingChapterBookmarks("gen", 1).length, 0);
});

// ── _selectAllState ──────────────────────────────────────────────────────────
// Tri-state for the bookmark bulk-select "전체 선택" checkbox.

test('_selectAllState: nothing ticked → none', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._selectAllState(0, 3), "none");
});

test('_selectAllState: some ticked → some (indeterminate)', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._selectAllState(1, 3), "some");
  assert.equal(h._selectAllState(2, 3), "some");
});

test('_selectAllState: every row ticked → all', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._selectAllState(3, 3), "all");
});

test('_selectAllState: empty list → none (never indeterminate)', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._selectAllState(0, 0), "none");
});

// ── _bmSelectCountLabel ──────────────────────────────────────────────────────

test('_bmSelectCountLabel: 0 → guidance prompt', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._bmSelectCountLabel(0), "항목을 선택하세요");
});

test('_bmSelectCountLabel: count → "N개 선택됨"', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._bmSelectCountLabel(1), "1개 선택됨");
  assert.equal(h._bmSelectCountLabel(5), "5개 선택됨");
});

// ── _findItemInStore ─────────────────────────────────────────────────────────

test('_findItemInStore: finds root-level bookmark', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  const found = h._findItemInStore(store, "bm-root1");
  assert.ok(found);
  assert.equal(found.item.id, "bm-root1");
  assert.equal(found.parent, store);
  assert.equal(found.index, 0);
});

test('_findItemInStore: finds item nested in folder', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  const found = h._findItemInStore(store, "bm-pent1");
  assert.ok(found);
  assert.equal(found.item.id, "bm-pent1");
  // Parent is the Pentateuch folder's children array
  assert.equal(found.parent.length, 1);
});

test('_findItemInStore: returns null when id missing', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._findItemInStore(sampleStore(), "bm-nonexistent"), null);
});

// ── _findParentFolderId ──────────────────────────────────────────────────────

test('_findParentFolderId: root item → null parent', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._findParentFolderId(sampleStore(), "bm-root1"), null);
});

test('_findParentFolderId: nested item → parent folder id', () => {
  const h = loadBookmarkQuery();
  // bm-ot1 is inside fld-old
  assert.equal(h._findParentFolderId(sampleStore(), "bm-ot1"), "fld-old");
  // bm-pent1 is inside fld-pent
  assert.equal(h._findParentFolderId(sampleStore(), "bm-pent1"), "fld-pent");
});

test('_findParentFolderId: missing id → undefined', () => {
  const h = loadBookmarkQuery();
  assert.equal(h._findParentFolderId(sampleStore(), "bm-nonexistent"), undefined);
});

// ── removeItemById ───────────────────────────────────────────────────────────

test('removeItemById: removes root bookmark', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  h.removeItemById(store, "bm-root1");
  assert.equal(store.length, 2);
  assert.equal(h._findItemInStore(store, "bm-root1"), null);
});

test('removeItemById: removes nested bookmark, parent folder unaffected', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  h.removeItemById(store, "bm-pent1");
  // fld-pent still exists, just has empty children now
  const pent = h._findItemInStore(store, "fld-pent");
  assert.ok(pent);
  assert.equal(pent.item.children.length, 0);
});

test('removeItemById: missing id → no-op (no throw)', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  const beforeLen = store.length;
  h.removeItemById(store, "bm-nonexistent");
  assert.equal(store.length, beforeLen);
});

// ── insertItem ───────────────────────────────────────────────────────────────

test('insertItem: folderId null → push to root', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  const item = { type: "bookmark", id: "new-bm", bookId: "rev", chapter: 1, verseSpec: "all" };
  h.insertItem(store, null, item);
  assert.equal(store[store.length - 1].id, "new-bm");
});

test('insertItem: valid folderId → push to folder.children', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  const item = { type: "bookmark", id: "new-bm", bookId: "rev", chapter: 1, verseSpec: "all" };
  h.insertItem(store, "fld-old", item);
  const fld = h._findItemInStore(store, "fld-old");
  assert.ok(fld);
  assert.equal(fld.item.children[fld.item.children.length - 1].id, "new-bm");
});

test('insertItem: invalid folderId → fallback push to root', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  const item = { type: "bookmark", id: "new-bm", bookId: "rev", chapter: 1, verseSpec: "all" };
  h.insertItem(store, "fld-nonexistent", item);
  assert.equal(store[store.length - 1].id, "new-bm");
});

// ── collectFolderOptions ─────────────────────────────────────────────────────

test('collectFolderOptions: collects only folders, with depth', () => {
  const h = loadBookmarkQuery();
  const opts = h.collectFolderOptions(sampleStore());
  // 2 folders: fld-old (depth 0) and fld-pent (depth 1)
  assert.equal(opts.length, 2);
  assert.equal(opts[0].id, "fld-old");
  assert.equal(opts[0].depth, 0);
  assert.equal(opts[1].id, "fld-pent");
  assert.equal(opts[1].depth, 1);
});

test('collectFolderOptions: empty store → empty array', () => {
  const h = loadBookmarkQuery();
  assert.deepEqual(h.collectFolderOptions([]), []);
});

test('collectFolderOptions: bookmarks-only store → empty array', () => {
  const h = loadBookmarkQuery();
  const onlyBookmarks = [
    { type: "bookmark", id: "a", bookId: "gen", chapter: 1, verseSpec: "all" },
    { type: "bookmark", id: "b", bookId: "gen", chapter: 2, verseSpec: "all" },
  ];
  assert.deepEqual(h.collectFolderOptions(onlyBookmarks), []);
});

// ── _descendantIds ───────────────────────────────────────────────────────────

test('_descendantIds: every nested id under a folder (excludes the folder)', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  const fldOld = h._findItemInStore(store, "fld-old").item;
  assert.deepEqual(h._descendantIds(fldOld).sort(), ["bm-ot1", "bm-pent1", "fld-pent"].sort());
});

test('_descendantIds: bookmark node → empty', () => {
  const h = loadBookmarkQuery();
  const store = sampleStore();
  const bm = h._findItemInStore(store, "bm-root1").item;
  assert.deepEqual(h._descendantIds(bm), []);
});

test('_descendantIds: empty folder → empty', () => {
  const h = loadBookmarkQuery();
  assert.deepEqual(h._descendantIds({ type: "folder", id: "f", name: "x", children: [] }), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKMARK_SELECT tests (select-delete mode cascade math)
// ─────────────────────────────────────────────────────────────────────────────

// ── _bmBuildParentMap ────────────────────────────────────────────────────────

test('_bmBuildParentMap: maps each node id → parent folder id (null at root)', () => {
  const h = loadBookmarkSelect();
  const map = h._bmBuildParentMap(sampleStore());
  assert.equal(map.size, 6);
  assert.equal(map.get("bm-root1"), null);
  assert.equal(map.get("fld-old"), null);
  assert.equal(map.get("bm-ot1"), "fld-old");
  assert.equal(map.get("fld-pent"), "fld-old");
  assert.equal(map.get("bm-pent1"), "fld-pent");
  assert.equal(map.get("bm-root2"), null);
});

// ── _bmAncestorSelected ──────────────────────────────────────────────────────

test('_bmAncestorSelected: a ticked folder covers its whole subtree (any depth)', () => {
  const h = loadBookmarkSelect();
  const map = h._bmBuildParentMap(sampleStore());
  h.setSelected(["fld-old"]);
  assert.equal(h._bmAncestorSelected("bm-ot1", map), true);   // direct child
  assert.equal(h._bmAncestorSelected("bm-pent1", map), true); // grandchild
  assert.equal(h._bmAncestorSelected("fld-pent", map), true); // nested folder
  assert.equal(h._bmAncestorSelected("fld-old", map), false); // the tick itself
  assert.equal(h._bmAncestorSelected("bm-root1", map), false);// unrelated root
});

// ── _bmCountMarked ───────────────────────────────────────────────────────────

test('_bmCountMarked: folder tick counts every node it removes', () => {
  const h = loadBookmarkSelect();
  const map = h._bmBuildParentMap(sampleStore());
  h.setSelected(["fld-old"]); // fld-old + bm-ot1 + fld-pent + bm-pent1
  assert.equal(h._bmCountMarked(map), 4);
});

test('_bmCountMarked: independent ticks sum (no double count)', () => {
  const h = loadBookmarkSelect();
  const map = h._bmBuildParentMap(sampleStore());
  h.setSelected(["bm-root1", "fld-pent"]); // bm-root1 + fld-pent + bm-pent1
  assert.equal(h._bmCountMarked(map), 3);
});

// ── _bmEffectiveTargets ──────────────────────────────────────────────────────

test('_bmEffectiveTargets: drops ticks already covered by a ticked ancestor', () => {
  const h = loadBookmarkSelect();
  const map = h._bmBuildParentMap(sampleStore());
  // bm-pent1 is under fld-old → redundant; only the top-most fld-old is a target.
  h.setSelected(["fld-old", "bm-pent1"]);
  assert.deepEqual(h._bmEffectiveTargets(map).sort(), ["fld-old"]);
});

test('_bmEffectiveTargets: independent ticks are all kept', () => {
  const h = loadBookmarkSelect();
  const map = h._bmBuildParentMap(sampleStore());
  h.setSelected(["bm-root1", "fld-pent"]);
  assert.deepEqual(h._bmEffectiveTargets(map).sort(), ["bm-root1", "fld-pent"].sort());
});

// ── _collectSelectedBookmarks (share expands folders to leaves) ───────────────

test('_collectSelectedBookmarks: a ticked folder yields its bookmark leaves', () => {
  const h = loadBookmarkSelect();
  h.setSelected(["fld-old"]); // contains bm-ot1 + (fld-pent → bm-pent1)
  const ids = h._collectSelectedBookmarks(sampleStore()).map((b) => b.id);
  assert.deepEqual(ids, ["bm-ot1", "bm-pent1"]);
});

test('_collectSelectedBookmarks: ticked bookmarks included; folders contribute only leaves', () => {
  const h = loadBookmarkSelect();
  h.setSelected(["bm-root1", "fld-pent"]); // a bookmark + a folder (→ bm-pent1)
  const ids = h._collectSelectedBookmarks(sampleStore()).map((b) => b.id);
  assert.deepEqual(ids.sort(), ["bm-pent1", "bm-root1"]);
});

test('_collectSelectedBookmarks: nothing selected → empty', () => {
  const h = loadBookmarkSelect();
  h.setSelected([]);
  assert.deepEqual(h._collectSelectedBookmarks(sampleStore()), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// DRAG_CORE tests
// ─────────────────────────────────────────────────────────────────────────────

// ── _isDescendant ────────────────────────────────────────────────────────────

test('_isDescendant: direct child detected', () => {
  const h = loadBookmarkQuery();
  const folder = {
    type: "folder", id: "f1", name: "F1",
    children: [{ type: "bookmark", id: "child-bm" }],
  };
  assert.equal(h._isDescendant(folder, "child-bm"), true);
});

test('_isDescendant: deeply nested descendant detected', () => {
  const h = loadBookmarkQuery();
  const folder = {
    type: "folder", id: "f1", name: "F1",
    children: [{
      type: "folder", id: "f2", name: "F2",
      children: [{
        type: "folder", id: "f3", name: "F3",
        children: [{ type: "bookmark", id: "deep-bm" }],
      }],
    }],
  };
  assert.equal(h._isDescendant(folder, "deep-bm"), true);
});

test('_isDescendant: id not present → false', () => {
  const h = loadBookmarkQuery();
  const folder = {
    type: "folder", id: "f1", name: "F1",
    children: [{ type: "bookmark", id: "child-bm" }],
  };
  assert.equal(h._isDescendant(folder, "missing"), false);
});

test('_isDescendant: empty children → false', () => {
  const h = loadBookmarkQuery();
  const folder = { type: "folder", id: "f1", name: "F1", children: [] };
  assert.equal(h._isDescendant(folder, "anything"), false);
});

// ── moveBookmarkItem ─────────────────────────────────────────────────────────

test('moveBookmarkItem: same id (source = target) → no-op (no save / no render)', () => {
  const h = loadDragCore();
  h.setStore(sampleStore());
  h.moveBookmarkItem("bm-root1", "bm-root1", "before");
  assert.equal(h.saveCalls.length, 0);
  assert.equal(h.renderCalls.count, 0);
});

test('moveBookmarkItem: "before" reorders within root', () => {
  const h = loadDragCore();
  h.setStore(sampleStore());
  // Move bm-root2 BEFORE bm-root1 (was [root1, fld-old, root2])
  h.moveBookmarkItem("bm-root2", "bm-root1", "before");
  const store = h.getStore();
  assert.equal(store[0].id, "bm-root2");
  assert.equal(store[1].id, "bm-root1");
  assert.equal(h.saveCalls.length, 1);
  assert.equal(h.renderCalls.count, 1);
});

test('moveBookmarkItem: "into" non-folder target falls back to "after"', () => {
  const h = loadDragCore();
  h.setStore(sampleStore());
  // bm-root1 is a bookmark, not a folder. Drop "into" should fallback.
  h.moveBookmarkItem("bm-root2", "bm-root1", "into");
  const store = h.getStore();
  // After fallback: bm-root2 inserted after bm-root1 (was at index 0)
  // Original [root1, fld-old, root2] → [root1, root2, fld-old]
  assert.equal(store[0].id, "bm-root1");
  assert.equal(store[1].id, "bm-root2");
  assert.equal(store[2].id, "fld-old");
});

test('moveBookmarkItem: "into" valid folder → unshift to folder.children', () => {
  const h = loadDragCore();
  h.setStore(sampleStore());
  h.moveBookmarkItem("bm-root1", "fld-old", "into");
  const store = h.getStore();
  // fld-old is now at index 0 (was index 1; bm-root1 removed from 0).
  const fldOld = store.find((s) => s.id === "fld-old");
  assert.ok(fldOld);
  // bm-root1 should be at fld-old.children[0] (unshift)
  assert.equal(fldOld.children[0].id, "bm-root1");
});

test('moveBookmarkItem: dropping folder into its own descendant is rejected', () => {
  const h = loadDragCore();
  h.setStore(sampleStore());
  // fld-old contains fld-pent (descendant). Try to move fld-old INTO fld-pent.
  h.moveBookmarkItem("fld-old", "fld-pent", "into");
  // No save/render — the move was rejected
  assert.equal(h.saveCalls.length, 0);
  assert.equal(h.renderCalls.count, 0);
});

test('moveBookmarkItem: dropping folder before/after its own descendant is rejected', () => {
  const h = loadDragCore();
  h.setStore(sampleStore());
  h.moveBookmarkItem("fld-old", "bm-pent1", "before");
  assert.equal(h.saveCalls.length, 0);
});

test("moveBookmarkItem: a save the device refuses still redraws the list — it shows the order that is stored (known-issues §15.4)", () => {
  const h = loadDragCore();
  h.setStore(sampleStore());
  h.refuseSaves();
  h.moveBookmarkItem("bm-root2", "bm-root1", "before");
  assert.equal(h.saveCalls.length, 1);
  assert.deepEqual(h.getStore().map((n) => n.id), ["bm-root1", "fld-old", "bm-root2"]);
  assert.equal(h.renderCalls.count, 1);
});

// ── commitBookmarks (known-issues §15.4) ────────────────────────────────────
// The one way the bookmark screens save the list: a save the device refuses is said on screen.

function loadBookmarkCommit(outcome) {
  const calls = { saves: [], snackbar: [], announce: [] };
  const ctx = {
    Object, Array, String, JSON, console, Error,
    saveBookmarks: (s) => { calls.saves.push(s); return outcome; },
    window: {
      _showSyncSnackbar: (msg) => { calls.snackbar.push(msg); },
      announce: (msg) => { calls.announce.push(msg); },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("BOOKMARK_COMMIT", BOOKMARK_CORE_SOURCE), ctx, { filename: "bookmark-core.js" });
  return { ctx, calls, commitBookmarks: ctx.commitBookmarks };
}

test("commitBookmarks: a saved list returns true and says nothing", () => {
  const h = loadBookmarkCommit("saved");
  const list = [{ type: "folder", id: "f", name: "가", children: [] }];
  assert.equal(h.commitBookmarks(list), true);
  assert.equal(h.calls.saves[0], list);
  assert.deepEqual(h.calls.snackbar, []);
  assert.deepEqual(h.calls.announce, [], "the caller says the success line, not this");
});

test("commitBookmarks: storage full — false, and the snackbar says what to do (사용자 결정 2026-10-26)", () => {
  const h = loadBookmarkCommit("full");
  assert.equal(h.commitBookmarks([]), false);
  assert.deepEqual(h.calls.snackbar, ["저장 공간이 가득 차 바꾼 내용을 저장하지 못했습니다. 쓰지 않는 북마크를 지운 뒤 다시 시도해 주세요."]);
  assert.deepEqual(h.calls.announce, [], "the snackbar reads it to the live region itself — announcing again reads it twice");
});

test("commitBookmarks: any other refusal — false, and the snackbar says the list was not saved", () => {
  const h = loadBookmarkCommit("failed");
  assert.equal(h.commitBookmarks([]), false);
  assert.deepEqual(h.calls.snackbar, ["북마크를 저장하지 못했습니다."]);
  assert.deepEqual(h.calls.announce, []);
});

test("commitBookmarks: without the snackbar (sync not loaded), the screen reader still hears it", () => {
  const h = loadBookmarkCommit("full");
  delete h.ctx.window._showSyncSnackbar;
  assert.equal(h.commitBookmarks([]), false);
  assert.equal(h.calls.announce.length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// SWIPED_ROW tests
// ─────────────────────────────────────────────────────────────────────────────

// ── closeSwipedRow ───────────────────────────────────────────────────────────

test('closeSwipedRow: when nothing swiped → no-op', () => {
  const h = loadSwipedRow();
  // No state change should crash. Initial _swipedRow is null.
  h.closeSwipedRow(null);
  assert.equal(h.peekSwipedRow(), null);
});

test('closeSwipedRow: when current row is the "except" → no-op (kept open)', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  const content = new h.ContentEl();
  row.setContentChild(content);
  h._openSwipedRow(row, "edit");
  // Now _swipedRow is `row`. close(row) should leave it alone.
  h.closeSwipedRow(row);
  assert.equal(h.peekSwipedRow(), row);
});

test('closeSwipedRow: closes when except differs — strips swipe classes + clears content transform', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  const content = new h.ContentEl();
  row.setContentChild(content);
  h._openSwipedRow(row, "delete");
  assert.ok(row.classList.contains("bm-swiped-delete"));
  // Different except (e.g. about to open another row)
  h.closeSwipedRow(new h.Element());
  assert.equal(h.peekSwipedRow(), null);
  assert.equal(row.classList.contains("bm-swiped"), false);
  assert.equal(row.classList.contains("bm-swiped-delete"), false);
  assert.equal(content.style.transform, "");
});

// ── _openSwipedRow ───────────────────────────────────────────────────────────

test('_openSwipedRow: marks new row (with direction) + clears prior swiped row', () => {
  const h = loadSwipedRow();
  const rowA = new h.Element();
  rowA.setContentChild(new h.ContentEl());
  const rowB = new h.Element();
  rowB.setContentChild(new h.ContentEl());

  h._openSwipedRow(rowA, "edit");
  assert.equal(h.peekSwipedRow(), rowA);
  assert.ok(rowA.classList.contains("bm-swiped"));
  assert.ok(rowA.classList.contains("bm-swiped-edit"));

  h._openSwipedRow(rowB, "delete");
  // Auto-close of rowA when opening rowB
  assert.equal(h.peekSwipedRow(), rowB);
  assert.equal(rowA.classList.contains("bm-swiped"), false);
  assert.ok(rowB.classList.contains("bm-swiped"));
  assert.ok(rowB.classList.contains("bm-swiped-delete"));
});

test('_openSwipedRow: re-snapping the same row to the opposite edge drops the stale direction', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  row.setContentChild(new h.ContentEl());
  h._openSwipedRow(row, "edit");
  assert.ok(row.classList.contains("bm-swiped-edit"));
  // Snap the SAME (already-tracked) row the other way — only the new direction
  // class should remain, not both.
  h._openSwipedRow(row, "delete");
  assert.ok(row.classList.contains("bm-swiped-delete"));
  assert.equal(row.classList.contains("bm-swiped-edit"), false);
  assert.equal(h.peekSwipedRow(), row);
});

// ── resetSwipedRow ───────────────────────────────────────────────────────────

test('resetSwipedRow: clears _swipedRow without DOM mutation', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  row.setContentChild(new h.ContentEl());
  h._openSwipedRow(row, "edit");
  // Tracking cleared but DOM class is intentionally left in place — caller
  // is expected to be re-rendering anyway, and stripping the class would
  // race the render replacement.
  const classBefore = row.classList.contains("bm-swiped");
  h.resetSwipedRow();
  assert.equal(h.peekSwipedRow(), null);
  assert.equal(row.classList.contains("bm-swiped"), classBefore);
});

// ── closeSwipedRowIfOutside ──────────────────────────────────────────────────

test('closeSwipedRowIfOutside: nothing swiped → no-op', () => {
  const h = loadSwipedRow();
  // Should not crash, _swipedRow remains null.
  h.closeSwipedRowIfOutside(new h.Element());
  assert.equal(h.peekSwipedRow(), null);
});

test('closeSwipedRowIfOutside: target inside swiped row → no-op (stays open)', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  row.setContentChild(new h.ContentEl());
  const inner = new h.Element();
  row.appendChild(inner);
  h._openSwipedRow(row, "edit");
  h.closeSwipedRowIfOutside(inner);
  assert.equal(h.peekSwipedRow(), row);
});

test('closeSwipedRowIfOutside: target outside → closeSwipedRow fires', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  const content = new h.ContentEl();
  row.setContentChild(content);
  h._openSwipedRow(row, "delete");
  const outside = new h.Element();
  h.closeSwipedRowIfOutside(outside);
  assert.equal(h.peekSwipedRow(), null);
  assert.equal(row.classList.contains("bm-swiped"), false);
});

test('closeSwipedRowIfOutside: non-Node target → guard rejects, close fires', () => {
  // `target instanceof Node` returns false for plain objects, so the
  // function falls through to closeSwipedRow(null).
  const h = loadSwipedRow();
  const row = new h.Element();
  row.setContentChild(new h.ContentEl());
  h._openSwipedRow(row, "edit");
  h.closeSwipedRowIfOutside(/** @type {any} */ ({ not: "a node" }));
  assert.equal(h.peekSwipedRow(), null);
});

// ── SWIPE_GESTURE loader ─────────────────────────────────────────────────────
// Pure functions + constants only — Math is the sole dependency.

function loadSwipeGesture() {
  const ctx = { Object, Array, Math, Number, console, Error };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("SWIPE_GESTURE", BOOKMARK_GESTURES_SOURCE), ctx, { filename: "bookmark-gestures.js" });
  return {
    _classifySwipeAxis: ctx._classifySwipeAxis,
    _swipeReleaseVelocity: ctx._swipeReleaseVelocity,
    _resolveSwipeRelease: ctx._resolveSwipeRelease,
    SWIPE_REVEAL_PX: ctx.SWIPE_REVEAL_PX,
    SWIPE_SLOP_PX: ctx.SWIPE_SLOP_PX,
  };
}

// ── _classifySwipeAxis ───────────────────────────────────────────────────────

test('_classifySwipeAxis: sub-slop movement → null (keep sampling)', () => {
  const h = loadSwipeGesture();
  assert.equal(h._classifySwipeAxis(5, 3), null);
  assert.equal(h._classifySwipeAxis(-4, 4), null);
  assert.equal(h._classifySwipeAxis(0, 0), null);
});

test('_classifySwipeAxis: horizontal-dominant beyond bias → "swipe"', () => {
  const h = loadSwipeGesture();
  assert.equal(h._classifySwipeAxis(10, 2), "swipe");
  assert.equal(h._classifySwipeAxis(-12, 5), "swipe");
  assert.equal(h._classifySwipeAxis(9, 0), "swipe");
});

test('_classifySwipeAxis: vertical-dominant → "scroll"', () => {
  const h = loadSwipeGesture();
  assert.equal(h._classifySwipeAxis(2, 10), "scroll");
  assert.equal(h._classifySwipeAxis(5, -12), "scroll");
  // Exact diagonal counts as scroll: when in doubt, don't steal the gesture
  // from the browser.
  assert.equal(h._classifySwipeAxis(8, 8), "scroll");
});

test('_classifySwipeAxis: ambiguous diagonal cone → null (wait for a clearer sample)', () => {
  const h = loadSwipeGesture();
  // |dy| < |dx| ≤ |dy|·1.2 — horizontal leads but not decisively.
  assert.equal(h._classifySwipeAxis(10, 9), null);
  assert.equal(h._classifySwipeAxis(-11, 10), null);
});

// ── _swipeReleaseVelocity ────────────────────────────────────────────────────

test('_swipeReleaseVelocity: fewer than two samples in window → 0', () => {
  const h = loadSwipeGesture();
  assert.equal(h._swipeReleaseVelocity([], 1000), 0);
  assert.equal(h._swipeReleaseVelocity([{ t: 1000, x: 50 }], 1000), 0);
});

test('_swipeReleaseVelocity: slope over the recent samples', () => {
  const h = loadSwipeGesture();
  const samples = [{ t: 900, x: 0 }, { t: 950, x: -25 }, { t: 1000, x: -50 }];
  assert.equal(h._swipeReleaseVelocity(samples, 1000), -0.5);
});

test('_swipeReleaseVelocity: samples older than the window are ignored', () => {
  const h = loadSwipeGesture();
  // The 0→200 burst happened long ago; only the recent stationary samples
  // count, so a drag that PAUSED before release has no flick velocity.
  const samples = [{ t: 0, x: 0 }, { t: 100, x: 200 }, { t: 950, x: 200 }, { t: 1000, x: 200 }];
  assert.equal(h._swipeReleaseVelocity(samples, 1000), 0);
});

// ── _resolveSwipeRelease ─────────────────────────────────────────────────────
// rowWidth 360 → commitPx = max(360×0.45, 88+40) = 162. Reveal snap at ±44.

test('_resolveSwipeRelease: closed row, slow pull — snap thresholds', () => {
  const h = loadSwipeGesture();
  assert.equal(h._resolveSwipeRelease(-30, 0, 0, 360), "close");
  assert.equal(h._resolveSwipeRelease(-44, 0, 0, 360), "open-delete");
  assert.equal(h._resolveSwipeRelease(44, 0, 0, 360), "open-edit");
  assert.equal(h._resolveSwipeRelease(-161, 0, 0, 360), "open-delete");
});

test('_resolveSwipeRelease: closed row, full pull → commit', () => {
  const h = loadSwipeGesture();
  assert.equal(h._resolveSwipeRelease(-162, 0, 0, 360), "commit-delete");
  assert.equal(h._resolveSwipeRelease(162, 0, 0, 360), "commit-edit");
});

test('_resolveSwipeRelease: narrow row — commit floor is reveal+40', () => {
  const h = loadSwipeGesture();
  // 200×0.45 = 90 < 128 → commitPx = 128.
  assert.equal(h._resolveSwipeRelease(-127, 0, 0, 200), "open-delete");
  assert.equal(h._resolveSwipeRelease(-128, 0, 0, 200), "commit-delete");
});

test('_resolveSwipeRelease: short flick opens without the full drag distance', () => {
  const h = loadSwipeGesture();
  // 30px alone would close; -0.6px/ms projects 48px further → open.
  assert.equal(h._resolveSwipeRelease(-30, 0, -0.6, 360), "open-delete");
  assert.equal(h._resolveSwipeRelease(30, 0, 0.6, 360), "open-edit");
});

test('_resolveSwipeRelease: flick back from an open row closes it', () => {
  const h = loadSwipeGesture();
  // Open-delete (base -88), small rightward flick → projected past -44 → close.
  assert.equal(h._resolveSwipeRelease(20, -88, 0.5, 360), "close");
});

test('_resolveSwipeRelease: flick never escalates to commit', () => {
  const h = loadSwipeGesture();
  // Violent flick, modest distance: projection is clamped to the snap
  // decision — 삭제 must not execute from a twitch.
  assert.equal(h._resolveSwipeRelease(-100, 0, -10, 360), "open-delete");
});

test('_resolveSwipeRelease: re-grabbed open row needs the same gesture distance to commit', () => {
  const h = loadSwipeGesture();
  // Open-delete (base -88). Under the old absolute-offset rule a further
  // -74px pull committed 삭제 (hair-trigger); now the gesture itself must
  // travel commitPx.
  assert.equal(h._resolveSwipeRelease(-74, -88, 0, 360), "open-delete");
  assert.equal(h._resolveSwipeRelease(-162, -88, 0, 360), "commit-delete");
});

test('_resolveSwipeRelease: reversing from the opposite panel cannot commit at the center', () => {
  const h = loadSwipeGesture();
  // Open-edit (base +88), long pull left: gesture distance reaches commitPx
  // but the row has barely crossed center (-74 > -88) → snap to open, not
  // execute 삭제.
  assert.equal(h._resolveSwipeRelease(-162, 88, 0, 360), "open-delete");
});

// ── BOOKMARK_HREF loader ─────────────────────────────────────────────────────

function loadBookmarkHref() {
  const ctx = { Object, Array, String, console, Error };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("BOOKMARK_HREF", BOOKMARK_CORE_SOURCE), ctx, { filename: "bookmark-core.js" });
  return { _bookmarkHref: ctx._bookmarkHref, _buildSharePayload: ctx._buildSharePayload };
}

const LEGACY_BOOKS = [
  { id: "isa", name_ko: "이사야", short_name_ko: "이사", chapter_count: 66 },
  { id: "gen", name_ko: "창세기", short_name_ko: "창세", chapter_count: 50 },
  { id: "nah", name_ko: "나훔", short_name_ko: "나훔", chapter_count: 3 },
];

// ── BOOKMARK_LEGACY loader ───────────────────────────────────────────────────
// The block calls wholeVerseSpec (an import of bookmark-core.js) — the VERSE_SPEC block stands in for it — and the
// store's loadBookmarks · rewriteBookmarks (window.appStorage) and window.loadBooks · getBooksCache, stubbed here.
// `calls` records what the startup move asked for.

function loadBookmarkLegacy({ stored = [], books = LEGACY_BOOKS, booksCached = true, booksFail = false, storeThrows = false } = {}) {
  const calls = { loadBooks: 0, rewrites: [], rerenders: 0 };
  // The book list arrives a task later, as a fetch does — so a test that awaits the move sees whether it waited.
  const later = (settle) => new Promise((resolve, reject) => setTimeout(() => settle(resolve, reject), 0));
  const ctx = {
    Object, Array, Set, String, Math, Number, JSON, console, Error, parseInt, Promise,
    loadBookmarks: () => { if (storeThrows) throw new TypeError("unreadable"); return stored; },
    rewriteBookmarks: (patch) => { calls.rewrites.push(patch); },
    window: {
      loadBooks: () => {
        calls.loadBooks += 1;
        return later((resolve, reject) => (booksFail ? reject(new Error("offline")) : resolve(books)));
      },
      getBooksCache: () => (booksCached ? books : null),
      rerenderActiveBookmarkTree: () => { calls.rerenders += 1; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  vm.runInContext(extractBlock("BOOKMARK_LEGACY", BOOKMARK_CORE_SOURCE), ctx, { filename: "bookmark-core.js" });
  return {
    migrateLegacyBookmark: ctx.migrateLegacyBookmark,
    migrateStoredBookmarks: ctx.migrateStoredBookmarks,
    migrateLegacyBookmarkDoc: ctx.migrateLegacyBookmarkDoc,
    calls,
  };
}

// ── BOOKMARK_ACTIVE loader ───────────────────────────────────────────────────
// ACTIVE block calls `_bookmarkHref`, so the loader concatenates the HREF
// block first to satisfy that dependency in the same vm context.

function loadBookmarkActive() {
  const ctx = { Object, Array, String, console, Error };
  vm.createContext(ctx);
  vm.runInContext(
    extractBlock("BOOKMARK_HREF", BOOKMARK_CORE_SOURCE) + "\n" + extractBlock("BOOKMARK_ACTIVE", BOOKMARK_CORE_SOURCE),
    ctx,
    { filename: "bookmark-core.js" },
  );
  return {
    _isActiveBookmark: ctx._isActiveBookmark,
    _hasActiveDescendant: ctx._hasActiveDescendant,
  };
}

// ── IMPORT_EXPORT loader ────────────────────────────────────────────────────

function loadImportExport() {
  const ctx = { Object, Array, Set, Map, String, JSON, console, Error };
  vm.createContext(ctx);
  // The verse-spec check (isWellFormedSpec) is an import of bookmark-modals.js — the VERSE_SPEC block stands in for it.
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  vm.runInContext(extractBlock("IMPORT_EXPORT", BOOKMARK_MODALS_SOURCE), ctx, { filename: "bookmark-modals.js" });
  // A top-level const is not a property of the context's global — read it as an expression.
  const constant = (name) => vm.runInContext(name, ctx);
  return {
    _validateImportData: ctx._validateImportData,
    _mergeBookmarkStores: ctx._mergeBookmarkStores,
    _countBookmarks: ctx._countBookmarks,
    _sanitizeImportItems: ctx._sanitizeImportItems,
    _fitsStorage: ctx._fitsStorage,
    IMPORT_MAX_FOLDER_DEPTH: constant("IMPORT_MAX_FOLDER_DEPTH"),
    STORAGE_QUOTA_BYTES: constant("STORAGE_QUOTA_BYTES"),
    STORAGE_HEADROOM_BYTES: constant("STORAGE_HEADROOM_BYTES"),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKMARK_HREF tests
// ─────────────────────────────────────────────────────────────────────────────

test("_bookmarkHref: verseSpec='all' → /:bookId/:chapter (no verse segment)", () => {
  const h = loadBookmarkHref();
  assert.equal(h._bookmarkHref({ bookId: "gen", chapter: 1, verseSpec: "all" }), "/gen/1");
  assert.equal(h._bookmarkHref({ bookId: "ps", chapter: 23, verseSpec: "all" }), "/ps/23");
});

test("_bookmarkHref: explicit verseSpec appends /:verseSpec", () => {
  const h = loadBookmarkHref();
  assert.equal(h._bookmarkHref({ bookId: "gen", chapter: 1, verseSpec: "1-3" }), "/gen/1/1-3");
  assert.equal(h._bookmarkHref({ bookId: "matt", chapter: 5, verseSpec: "3" }), "/matt/5/3");
});

test("_bookmarkHref: comma-list verseSpec preserved verbatim", () => {
  const h = loadBookmarkHref();
  assert.equal(h._bookmarkHref({ bookId: "rom", chapter: 8, verseSpec: "1,3-5,9" }), "/rom/8/1,3-5,9");
});

test("_bookmarkHref: chapter zero (theoretical) → /:bookId/0", () => {
  const h = loadBookmarkHref();
  // Sanity: pathname builder uses template literal, no minimum-chapter guard.
  assert.equal(h._bookmarkHref({ bookId: "x", chapter: 0, verseSpec: "all" }), "/x/0");
});

// ── _buildSharePayload (Web Share data from bookmarks) ────────────────────────

test("_buildSharePayload: single bookmark → {title, url} (absolute SITE_BASE link)", () => {
  const h = loadBookmarkHref();
  const p = h._buildSharePayload([{ label: "창세기 1장", bookId: "gen", chapter: 1, verseSpec: "all" }]);
  assert.equal(p.title, "창세기 1장");
  assert.equal(p.url, "https://bible.anglican.kr/gen/1");
  assert.equal(p.text, undefined);
});

test("_buildSharePayload: multiple → {title, text} list of label + absolute url", () => {
  const h = loadBookmarkHref();
  const p = h._buildSharePayload([
    { label: "창세기 1장", bookId: "gen", chapter: 1, verseSpec: "all" },
    { label: "요한 3장", bookId: "john", chapter: 3, verseSpec: "16" },
  ]);
  assert.equal(p.url, undefined);
  assert.equal(
    p.text,
    "창세기 1장\nhttps://bible.anglican.kr/gen/1\n\n요한 3장\nhttps://bible.anglican.kr/john/3/16",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKMARK_LEGACY tests — 옛 판(2026-04-25부터 06-06 #205까지)의 절 범위를 지금 표기로 옮긴다(사용자 결정 2026-10-22,
// coding-pitfalls §38)
// ─────────────────────────────────────────────────────────────────────────────

test("migrateLegacyBookmark: the range moves, and an old default name with it", () => {
  const h = loadBookmarkLegacy();
  const bm = { type: "bookmark", id: "a", bookId: "isa", chapter: 10, verseSpec: "16aa", label: "이사 10:16aa", note: "" };
  assert.equal(h.migrateLegacyBookmark(bm, LEGACY_BOOKS), true);
  assert.deepEqual({ ...bm }, { type: "bookmark", id: "a", bookId: "isa", chapter: 10, verseSpec: "16", label: "이사 10:16", note: "" });
  // 합치기가 지은 이름도 같은 형식이다 — 창세 27 「20a,20c」에 1절을 합친 결과
  const merged = { bookId: "gen", chapter: 27, verseSpec: "1,20a,20c", label: "창세 27:1,20a,20c" };
  h.migrateLegacyBookmark(merged, LEGACY_BOOKS);
  assert.deepEqual({ ...merged }, { bookId: "gen", chapter: 27, verseSpec: "1,20", label: "창세 27:1,20" });
  const nah = { bookId: "nah", chapter: 1, verseSpec: "7-8a", label: "나훔 1:7-8a" };
  h.migrateLegacyBookmark(nah, LEGACY_BOOKS);
  assert.deepEqual({ ...nah }, { bookId: "nah", chapter: 1, verseSpec: "7-8", label: "나훔 1:7-8" });
});

test("migrateLegacyBookmark: a name the user wrote stays — only the exact old default name changes", () => {
  const h = loadBookmarkLegacy();
  for (const label of ["아하스에게 주신 징조", "이사 10:16aa ", "이사야 10:16aa", "이사 10:16", ""]) {
    const bm = { bookId: "isa", chapter: 10, verseSpec: "16aa", label };
    assert.equal(h.migrateLegacyBookmark(bm, LEGACY_BOOKS), true);
    assert.equal(bm.verseSpec, "16");
    assert.equal(bm.label, label, JSON.stringify(label));
  }
  // 성서 목록에 없는 책 — 저장 대화상자처럼 책 id로 지은 이름
  const unknown = { bookId: "xyz", chapter: 2, verseSpec: "3a", label: "xyz 2:3a" };
  h.migrateLegacyBookmark(unknown, LEGACY_BOOKS);
  assert.deepEqual({ ...unknown }, { bookId: "xyz", chapter: 2, verseSpec: "3", label: "xyz 2:3" });
});

test("migrateLegacyBookmark: today's ranges and the forms the app never wrote are left alone", () => {
  const h = loadBookmarkLegacy();
  for (const verseSpec of ["all", "16", "1-5,10-15", "6,7-8,9", "16aa,3", " 16a", undefined]) {
    const bm = { bookId: "isa", chapter: 10, verseSpec, label: `이사 10:${verseSpec}` };
    const before = JSON.stringify(bm);
    assert.equal(h.migrateLegacyBookmark(bm, LEGACY_BOOKS), false, String(verseSpec));
    assert.equal(JSON.stringify(bm), before);
  }
});

test("migrateStoredBookmarks: nothing to move — resolves at once, without waiting for the book list (PR #367 review)", async () => {
  const stored = [
    { type: "bookmark", id: "a", bookId: "john", chapter: 3, verseSpec: "16", label: "요한 3:16" },
    { type: "folder", id: "f", name: "", children: [{ type: "bookmark", id: "b", bookId: "gen", chapter: 1, verseSpec: "all", label: "" }] },
  ];
  const h = loadBookmarkLegacy({ stored });
  await h.migrateStoredBookmarks();
  assert.deepEqual({ loadBooks: h.calls.loadBooks, rewrites: h.calls.rewrites.length }, { loadBooks: 0, rewrites: 0 });
});

test("migrateStoredBookmarks: a pre-#205 range in a folder — waits for the book list, then rewrites with the move", async () => {
  // A bookmark without a verse range (the type allows it) must not stop the check (PR #367 review, 2회차).
  const stored = [{ type: "folder", id: "f", name: "", children: [
    { type: "bookmark", id: "z", bookId: "gen", chapter: 1, label: "" },
    { type: "bookmark", id: "a", bookId: "isa", chapter: 10, verseSpec: "16aa", label: "이사 10:16aa" },
  ] }];
  const h = loadBookmarkLegacy({ stored });
  await h.migrateStoredBookmarks();
  assert.equal(h.calls.loadBooks, 1);
  assert.equal(h.calls.rewrites.length, 1);
  // The patch handed to rewriteBookmarks is the move itself — the store applies it to both copies (storage.test.js).
  const item = { bookId: "isa", chapter: 10, verseSpec: "16aa", label: "이사 10:16aa", _u: 5 };
  assert.equal(h.calls.rewrites[0](item), true);
  assert.deepEqual({ ...item }, { bookId: "isa", chapter: 10, verseSpec: "16", label: "이사 10:16", _u: 5 });
});

test("migrateStoredBookmarks: the book list fails or the store cannot be read — nothing moves, and it still resolves", async () => {
  const stored = [{ type: "bookmark", id: "a", bookId: "isa", chapter: 10, verseSpec: "16aa", label: "" }];
  const offline = loadBookmarkLegacy({ stored, booksFail: true });
  await offline.migrateStoredBookmarks();
  assert.deepEqual({ loadBooks: offline.calls.loadBooks, rewrites: offline.calls.rewrites.length }, { loadBooks: 1, rewrites: 0 });
  const broken = loadBookmarkLegacy({ storeThrows: true });
  await broken.migrateStoredBookmarks();
  assert.deepEqual({ loadBooks: broken.calls.loadBooks, rewrites: broken.calls.rewrites.length }, { loadBooks: 0, rewrites: 0 });
});

test("migrateLegacyBookmarkDoc: a merged sync document's bookmarks move in place, per-item times kept, odd items passed over", () => {
  const h = loadBookmarkLegacy();
  const doc = { bookmarks: { tombstones: {}, items: {
    a: { id: "a", type: "bookmark", bookId: "isa", chapter: 10, verseSpec: "16aa", label: "이사 10:16aa", parentId: "f", _order: 0, _u: 7 },
    b: { id: "b", type: "bookmark", bookId: "gen", chapter: 27, verseSpec: "20a,20c", label: "야곱의 속임수", parentId: null, _order: 1, _u: 9 },
    c: { id: "c", type: "bookmark", bookId: "gen", chapter: 1, verseSpec: "1-3", label: "창세 1:1-3", parentId: null, _order: 2, _u: 3 },
    f: { id: "f", type: "folder", name: "옛 북마크", parentId: null, _order: 3, _u: 1 },
    n: null, s: "x",
  } } };
  assert.doesNotThrow(() => h.migrateLegacyBookmarkDoc(doc));
  const it = doc.bookmarks.items;
  assert.deepEqual([it.a.verseSpec, it.a.label, it.a._u], ["16", "이사 10:16", 7]);
  assert.deepEqual([it.b.verseSpec, it.b.label, it.b._u], ["20", "야곱의 속임수", 9]);
  assert.deepEqual([it.c.verseSpec, it.c._u], ["1-3", 3]);
  assert.deepEqual([it.n, it.s], [null, "x"]);
  assert.doesNotThrow(() => h.migrateLegacyBookmarkDoc(undefined));
});

test("migrateLegacyBookmarkDoc: without the book list the document is saved as it came, and the stored list moves once the list loads", async () => {
  // 캘린더로 시작하면 첫 화면이 성서 목록을 받지 않아, 드라이브 왕복이 더 빠르면 병합이 먼저 온다(PR #367 리뷰 2회차).
  const stored = [{ type: "bookmark", id: "a", bookId: "isa", chapter: 10, verseSpec: "16aa", label: "", _u: 1 }];
  const h = loadBookmarkLegacy({ stored, booksCached: false });
  const doc = { bookmarks: { tombstones: {}, items: { a: { id: "a", type: "bookmark", bookId: "isa", chapter: 10, verseSpec: "16aa", label: "", _u: 1 } } } };
  h.migrateLegacyBookmarkDoc(doc);
  assert.equal(doc.bookmarks.items.a.verseSpec, "16aa");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual({ loadBooks: h.calls.loadBooks, rewrites: h.calls.rewrites.length, rerenders: h.calls.rerenders },
    { loadBooks: 1, rewrites: 1, rerenders: 1 });
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOKMARK_ACTIVE tests
// ─────────────────────────────────────────────────────────────────────────────

test("_isActiveBookmark: pathname matches whole-chapter href → true", () => {
  const h = loadBookmarkActive();
  const bm = { bookId: "gen", chapter: 1, verseSpec: "all" };
  assert.equal(h._isActiveBookmark(bm, "/gen/1"), true);
});

test("_isActiveBookmark: pathname matches verse-range href → true", () => {
  const h = loadBookmarkActive();
  const bm = { bookId: "matt", chapter: 5, verseSpec: "3-12" };
  assert.equal(h._isActiveBookmark(bm, "/matt/5/3-12"), true);
});

test("_isActiveBookmark: pathname mismatch → false", () => {
  const h = loadBookmarkActive();
  const bm = { bookId: "gen", chapter: 1, verseSpec: "all" };
  assert.equal(h._isActiveBookmark(bm, "/gen/2"), false);
  assert.equal(h._isActiveBookmark(bm, "/exo/1"), false);
});

test("_isActiveBookmark: whole-chapter bm does NOT match verse-range pathname", () => {
  const h = loadBookmarkActive();
  const bm = { bookId: "gen", chapter: 1, verseSpec: "all" };
  assert.equal(h._isActiveBookmark(bm, "/gen/1/3"), false);
});

test("_isActiveBookmark: default pathname (no second arg) → never matches (empty string)", () => {
  const h = loadBookmarkActive();
  const bm = { bookId: "gen", chapter: 1, verseSpec: "all" };
  // Module-scope `_renderPathname` starts as "" until renderBookmarkTree sets it
  assert.equal(h._isActiveBookmark(bm), false);
});

test("_hasActiveDescendant: empty folder.children → false", () => {
  const h = loadBookmarkActive();
  assert.equal(h._hasActiveDescendant({ children: [] }, "/gen/1"), false);
});

test("_hasActiveDescendant: missing folder.children → false (no throw)", () => {
  const h = loadBookmarkActive();
  assert.equal(h._hasActiveDescendant({}, "/gen/1"), false);
});

test("_hasActiveDescendant: direct bookmark child matches → true", () => {
  const h = loadBookmarkActive();
  const folder = {
    children: [
      { type: "bookmark", bookId: "gen", chapter: 1, verseSpec: "all" },
      { type: "bookmark", bookId: "exo", chapter: 2, verseSpec: "all" },
    ],
  };
  assert.equal(h._hasActiveDescendant(folder, "/exo/2"), true);
});

test("_hasActiveDescendant: nested folder containing match → true", () => {
  const h = loadBookmarkActive();
  const folder = {
    children: [
      { type: "bookmark", bookId: "gen", chapter: 1, verseSpec: "all" },
      {
        type: "folder",
        children: [
          { type: "bookmark", bookId: "deu", chapter: 6, verseSpec: "4-5" },
        ],
      },
    ],
  };
  assert.equal(h._hasActiveDescendant(folder, "/deu/6/4-5"), true);
});

test("_hasActiveDescendant: deep nesting (3 levels) finds the match", () => {
  const h = loadBookmarkActive();
  const folder = {
    children: [
      {
        type: "folder",
        children: [
          {
            type: "folder",
            children: [
              { type: "bookmark", bookId: "rev", chapter: 22, verseSpec: "all" },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(h._hasActiveDescendant(folder, "/rev/22"), true);
});

test("_hasActiveDescendant: no descendant matches → false", () => {
  const h = loadBookmarkActive();
  const folder = {
    children: [
      { type: "bookmark", bookId: "gen", chapter: 1, verseSpec: "all" },
      {
        type: "folder",
        children: [
          { type: "bookmark", bookId: "exo", chapter: 2, verseSpec: "all" },
        ],
      },
    ],
  };
  assert.equal(h._hasActiveDescendant(folder, "/rev/22"), false);
});

test("_hasActiveDescendant: folder with empty nested folder still returns false", () => {
  const h = loadBookmarkActive();
  const folder = {
    children: [
      { type: "folder", children: [] },
      { type: "folder", children: [{ type: "folder", children: [] }] },
    ],
  };
  assert.equal(h._hasActiveDescendant(folder, "/gen/1"), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT_EXPORT tests
// ─────────────────────────────────────────────────────────────────────────────

// ── _validateImportData ─────────────────────────────────────────────────────

test("_validateImportData: null/undefined → false", () => {
  const h = loadImportExport();
  assert.equal(h._validateImportData(null), false);
  assert.equal(h._validateImportData(undefined), false);
});

test("_validateImportData: non-object primitives → false", () => {
  const h = loadImportExport();
  assert.equal(h._validateImportData("string"), false);
  assert.equal(h._validateImportData(123), false);
  assert.equal(h._validateImportData(true), false);
});

test("_validateImportData: object without bookmarks array → false", () => {
  const h = loadImportExport();
  assert.equal(h._validateImportData({}), false);
  assert.equal(h._validateImportData({ bookmarks: "not array" }), false);
  assert.equal(h._validateImportData({ bookmarks: { items: [] } }), false);
  assert.equal(h._validateImportData({ bookmarks: null }), false);
});

test("_validateImportData: object with bookmarks array → true (even if empty)", () => {
  const h = loadImportExport();
  assert.equal(h._validateImportData({ bookmarks: [] }), true);
  assert.equal(h._validateImportData({ bookmarks: [{}] }), true);
  assert.equal(h._validateImportData({ _version: 1, exportedAt: 0, bookmarks: [] }), true);
});

// ── _mergeBookmarkStores ────────────────────────────────────────────────────

test("_mergeBookmarkStores: empty existing + non-empty incoming → all incoming", () => {
  const h = loadImportExport();
  const incoming = [
    { type: "bookmark", id: "a", bookId: "gen", chapter: 1 },
    { type: "bookmark", id: "b", bookId: "exo", chapter: 2 },
  ];
  const merged = h._mergeBookmarkStores([], incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "a");
  assert.equal(merged[1].id, "b");
});

test("_mergeBookmarkStores: non-empty existing + empty incoming → existing unchanged", () => {
  const h = loadImportExport();
  const existing = [{ type: "bookmark", id: "a" }];
  const merged = h._mergeBookmarkStores(existing, []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "a");
});

test("_mergeBookmarkStores: duplicate id → existing wins (incoming dropped)", () => {
  const h = loadImportExport();
  const existing = [{ type: "bookmark", id: "a", label: "from-existing" }];
  const incoming = [{ type: "bookmark", id: "a", label: "from-incoming" }];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].label, "from-existing");
});

test("_mergeBookmarkStores: distinct ids merge as union", () => {
  const h = loadImportExport();
  const existing = [{ type: "bookmark", id: "a" }];
  const incoming = [{ type: "bookmark", id: "b" }];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((m) => m.id), ["a", "b"]);
});

test("_mergeBookmarkStores: folder with new id keeps its children (filtered by id)", () => {
  const h = loadImportExport();
  const existing = [{ type: "bookmark", id: "child-1" }];  // id duplicates incoming child
  const incoming = [
    {
      type: "folder",
      id: "new-folder",
      children: [
        { type: "bookmark", id: "child-1" },  // duplicate
        { type: "bookmark", id: "child-2" },  // unique
      ],
    },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  // existing 1 + new folder appended
  assert.equal(merged.length, 2);
  const folder = merged[1];
  assert.equal(folder.type, "folder");
  assert.equal(folder.id, "new-folder");
  // child-1 (duplicate of existing) filtered out
  assert.equal(folder.children.length, 1);
  assert.equal(folder.children[0].id, "child-2");
});

// 같은 id의 폴더는 그 안으로 들어가 새 항목만 더한다. 폴더의 자리와 이름은 지금 목록을 따른다(ADR-011 Phase 2a
// 「폴더 children 재귀 처리」, known-issues §15.1). 전에는 폴더를 안의 것까지 건너뛰어 백업의 새 북마크가 빠졌다.

test("_mergeBookmarkStores: duplicate folder id → its new children join the existing folder, name kept", () => {
  const h = loadImportExport();
  const existing = [{ type: "folder", id: "fld-1", name: "지금", children: [{ type: "bookmark", id: "old" }] }];
  const incoming = [
    {
      type: "folder",
      id: "fld-1",  // duplicate
      name: "백업",
      children: [{ type: "bookmark", id: "old" }, { type: "bookmark", id: "new" }],
    },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "fld-1");
  assert.equal(merged[0].name, "지금");
  assert.deepEqual(merged[0].children.map((c) => c.id), ["old", "new"]);
});

test("_mergeBookmarkStores: a duplicate folder elsewhere in the file fills the existing one where it stands", () => {
  const h = loadImportExport();
  const existing = [
    { type: "bookmark", id: "a" },
    { type: "folder", id: "fld-1", name: "지금", children: [] },
  ];
  const incoming = [
    { type: "folder", id: "outer", name: "새 폴더", children: [
      { type: "folder", id: "fld-1", name: "백업", children: [{ type: "bookmark", id: "new" }] },
    ] },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.deepEqual(merged.map((n) => n.id), ["a", "fld-1", "outer"]);
  assert.deepEqual(merged[1].children.map((c) => c.id), ["new"]);
  assert.deepEqual(merged[2].children, []);   // the new folder comes in; the folder it held stays where it is
});

test("_mergeBookmarkStores: duplicate folders nest — new items reach the inner existing folder", () => {
  const h = loadImportExport();
  const existing = [
    { type: "folder", id: "f", children: [{ type: "folder", id: "g", children: [{ type: "bookmark", id: "x" }] }] },
  ];
  const incoming = [
    { type: "folder", id: "f", children: [
      { type: "folder", id: "g", children: [{ type: "bookmark", id: "x" }, { type: "bookmark", id: "y" }] },
      { type: "bookmark", id: "z" },
    ] },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.equal(merged.length, 1);
  const f = merged[0];
  assert.deepEqual(f.children.map((c) => c.id), ["g", "z"]);
  assert.deepEqual(f.children[0].children.map((c) => c.id), ["x", "y"]);
});

test("_mergeBookmarkStores: a folder whose id is an existing bookmark is skipped with its children", () => {
  // The import check leaves these out first (ADR-040 — an id of the other kind); merge does not fold them in either.
  const h = loadImportExport();
  const existing = [{ type: "bookmark", id: "dup" }];
  const incoming = [{ type: "folder", id: "dup", children: [{ type: "bookmark", id: "inner" }] }];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.deepEqual(JSON.parse(JSON.stringify(merged)), [{ type: "bookmark", id: "dup" }]);
});

test("_mergeBookmarkStores: the merged list stays within 64 levels — a folder that would go deeper is left out with its contents", () => {
  // A folder the list has is filled where it stands, so the file's depth adds to the list's (PR #438 review): the
  // import check's 64-level limit (ADR-040) holds for the merged list too.
  const h = loadImportExport();
  /** @param {string} prefix @param {number} n */
  const chain = (prefix, n) => {
    let node = null;
    for (let i = n; i >= 1; i--) node = { type: "folder", id: `${prefix}${i}`, name: "", children: node ? [node] : [] };
    return node;
  };
  const depthOf = (nodes) => Math.max(0, ...nodes.map((n) => (n.type === "folder" ? 1 + depthOf(n.children) : 0)));
  const existing = [chain("a", 64)];
  const incoming = [
    { type: "folder", id: "a64", name: "", children: [chain("b", 3), { type: "bookmark", id: "x" }] },
    { type: "folder", id: "a10", name: "", children: [chain("c", 3)] },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.equal(depthOf(merged), 64);
  const at = (level) => { let f = merged[0]; for (let i = 1; i < level; i++) f = f.children[0]; return f; };
  assert.deepEqual(at(64).children.map((c) => c.id), ["x"]);          // the bookmark joins; the folder would be 65th
  assert.deepEqual(at(10).children.map((c) => c.id), ["a11", "c1"]);  // 13 levels fit
});

test("_mergeBookmarkStores: a folder the list has, inside a new folder left out for depth, still gets its new items", () => {
  // The new folder would sit 65th and is left out with what it holds — but a folder the list already has is filled
  // where it stands wherever it shows up in the file, so its new bookmark has no depth problem (2nd review of PR #438).
  const h = loadImportExport();
  let deep = null;
  for (let i = 64; i >= 1; i--) deep = { type: "folder", id: `a${i}`, name: "", children: deep ? [deep] : [] };
  const existing = [deep, { type: "folder", id: "e", name: "얕은 폴더", children: [] }];
  const incoming = [
    { type: "folder", id: "a64", name: "", children: [
      { type: "folder", id: "n", name: "", children: [
        { type: "folder", id: "e", name: "", children: [{ type: "bookmark", id: "z" }] },
        { type: "bookmark", id: "w" },
      ] },
    ] },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  let f = merged[0];
  for (let i = 1; i < 64; i++) f = f.children[0];
  assert.deepEqual(f.children, []);                                   // n would be the 65th level: left out, w with it
  assert.equal(merged.length, 2);                                      // …and not put anywhere else
  assert.deepEqual(merged[1].children.map((c) => c.id), ["z"]);
});

test("_mergeBookmarkStores: inside a folder left out for depth, a folder whose id is a bookmark is skipped with its contents", () => {
  // As addNew does at any depth — the import check leaves these out first (ADR-040), so this only keeps the two
  // paths alike (3rd review of PR #438).
  const h = loadImportExport();
  let deep = null;
  for (let i = 64; i >= 1; i--) deep = { type: "folder", id: `a${i}`, name: "", children: deep ? [deep] : [] };
  const existing = [deep, { type: "bookmark", id: "e" }, { type: "folder", id: "g", name: "", children: [] }];
  const incoming = [
    { type: "folder", id: "a64", name: "", children: [
      { type: "folder", id: "n", name: "", children: [
        { type: "folder", id: "e", name: "", children: [
          { type: "folder", id: "g", name: "", children: [{ type: "bookmark", id: "z" }] },
        ] },
      ] },
    ] },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.deepEqual(merged[2].children, []);
});

test("_mergeBookmarkStores: the existing tree passed in is left as it was", () => {
  const h = loadImportExport();
  const existing = [{ type: "folder", id: "f", children: [{ type: "bookmark", id: "x" }] }];
  const before = JSON.stringify(existing);
  h._mergeBookmarkStores(existing, [{ type: "folder", id: "f", children: [{ type: "bookmark", id: "y" }] }]);
  assert.equal(JSON.stringify(existing), before);
});

test("_mergeBookmarkStores: deeply nested folder filters at each level", () => {
  const h = loadImportExport();
  const existing = [
    { type: "bookmark", id: "deep-child" },
  ];
  const incoming = [
    {
      type: "folder",
      id: "outer",
      children: [
        {
          type: "folder",
          id: "inner",
          children: [
            { type: "bookmark", id: "deep-child" },  // dup
            { type: "bookmark", id: "kept" },         // unique
          ],
        },
      ],
    },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  const inner = merged[1].children[0];
  assert.equal(inner.children.length, 1);
  assert.equal(inner.children[0].id, "kept");
});

test("_mergeBookmarkStores: folder without children property handles gracefully", () => {
  const h = loadImportExport();
  const incoming = [{ type: "folder", id: "f1" }];  // no children
  const merged = h._mergeBookmarkStores([], incoming);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].children, []);
});

// ── _countBookmarks ─────────────────────────────────────────────────────────

test("_countBookmarks: empty array → 0", () => {
  const h = loadImportExport();
  assert.equal(h._countBookmarks([]), 0);
});

test("_countBookmarks: flat list of bookmarks → length", () => {
  const h = loadImportExport();
  const items = [
    { type: "bookmark", id: "a" },
    { type: "bookmark", id: "b" },
    { type: "bookmark", id: "c" },
  ];
  assert.equal(h._countBookmarks(items), 3);
});

test("_countBookmarks: folders themselves do NOT contribute", () => {
  const h = loadImportExport();
  const items = [{ type: "folder", id: "f", children: [] }];
  assert.equal(h._countBookmarks(items), 0);
});

test("_countBookmarks: folder with bookmark children sums their count", () => {
  const h = loadImportExport();
  const items = [
    { type: "bookmark", id: "a" },
    {
      type: "folder",
      id: "f",
      children: [
        { type: "bookmark", id: "f-1" },
        { type: "bookmark", id: "f-2" },
      ],
    },
  ];
  assert.equal(h._countBookmarks(items), 3);
});

test("_countBookmarks: deeply nested counts at every level", () => {
  const h = loadImportExport();
  const items = [
    {
      type: "folder",
      children: [
        { type: "bookmark", id: "b1" },
        {
          type: "folder",
          children: [
            { type: "bookmark", id: "b2" },
            { type: "bookmark", id: "b3" },
            {
              type: "folder",
              children: [{ type: "bookmark", id: "b4" }],
            },
          ],
        },
      ],
    },
  ];
  assert.equal(h._countBookmarks(items), 4);
});

test("_countBookmarks: folder with non-array children is skipped (no throw)", () => {
  const h = loadImportExport();
  const items = [
    { type: "folder", id: "f" /* no children property */ },
    { type: "folder", id: "f2", children: null },
    { type: "bookmark", id: "b" },
  ];
  assert.equal(h._countBookmarks(items), 1);
});

// ── _sanitizeImportItems ────────────────────────────────────────────────────
// 가져오기는 어긋난 항목만 빼고 들인다(사용자 결정 2026-10-18). 「올바르다」 = 앱이 써 온 모양(ADR-010).

/** Chapter counts for the books these cases use — gen 50 · john 21 · ps 150; anything else is unknown. */
const IMPORT_CHAPTERS = { gen: 50, john: 21, ps: 150 };
const importChapterCountOf = (id) => IMPORT_CHAPTERS[id] ?? null;

/** A bookmark exactly as the app saves it (bookmark-modals.js commitSaveBookmark). */
function appBookmark(over = {}) {
  return { type: "bookmark", id: "b1", bookId: "john", chapter: 3, verseSpec: "16", label: "요한 3:16", note: "", createdAt: 1_700_000_000_000, ...over };
}

test("_sanitizeImportItems: a tree in the app's own shape comes through unchanged", () => {
  const h = loadImportExport();
  const items = [
    { type: "folder", id: "f1", name: "대림1주일", expanded: false, createdAt: 1, children: [
      appBookmark({ id: "b1" }),
      { type: "folder", id: "f2", name: "", expanded: true, children: [appBookmark({ id: "b2", verseSpec: "1-5,10-15" })] },
    ] },
    appBookmark({ id: "b3", bookId: "gen", chapter: 1, verseSpec: "all", label: "창세 1장" }),
    appBookmark({ id: "b4", bookId: "ps", chapter: 150, verseSpec: "3a,3b,5-7", updatedAt: 2 }),
  ];
  const { nodes, skipped } = h._sanitizeImportItems(items, importChapterCountOf);
  assert.equal(skipped, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(nodes)), items);
});

test("_sanitizeImportItems: empty file → nothing kept, nothing skipped", () => {
  const h = loadImportExport();
  assert.deepEqual(JSON.parse(JSON.stringify(h._sanitizeImportItems([], importChapterCountOf))), { nodes: [], skipped: 0 });
});

test("_sanitizeImportItems: each ill-formed bookmark is left out and counted", () => {
  const h = loadImportExport();
  const bad = [
    null, 1, "x", [],                                   // not an object
    appBookmark({ id: "" }), appBookmark({ id: 7 }),       // id
    appBookmark({ type: "note" }),                         // unknown type
    appBookmark({ bookId: undefined }), appBookmark({ bookId: "xyz" }),   // book
    appBookmark({ chapter: 0 }), appBookmark({ chapter: 1.5 }), appBookmark({ chapter: "3" }), appBookmark({ chapter: 22 }),   // chapter (john has 21)
    appBookmark({ verseSpec: undefined }), appBookmark({ verseSpec: "" }), appBookmark({ verseSpec: "1-x" }),
    appBookmark({ verseSpec: "0" }), appBookmark({ verseSpec: "3,abc" }),  // spec — not the form the app writes
    appBookmark({ verseSpec: " 16" }), appBookmark({ verseSpec: "1-20000000" }),
    appBookmark({ label: undefined }), appBookmark({ label: 3 }),          // label
    appBookmark({ note: 5 }), appBookmark({ createdAt: "today" }), appBookmark({ updatedAt: null }),   // optional fields
  ].map((x, i) => (x && typeof x === "object" && !Array.isArray(x) && typeof x.id === "string" && x.id !== "" ? { ...x, id: `bad${i}` } : x));
  const good = appBookmark({ id: "good" });
  const { nodes, skipped } = h._sanitizeImportItems([...bad, good], importChapterCountOf);
  assert.deepEqual(nodes.map((n) => n.id), ["good"]);
  assert.equal(skipped, bad.length);
});

test("_sanitizeImportItems: an ill-formed folder takes its whole subtree, counted node by node", () => {
  const h = loadImportExport();
  const items = [
    { type: "folder", id: "f1", name: 3, children: [appBookmark({ id: "a" }), { type: "folder", id: "f2", name: "x", children: [appBookmark({ id: "b" })] }] },
    { type: "folder", id: "f3", name: "x", children: "not an array" },
    appBookmark({ id: "c" }),
  ];
  const { nodes, skipped } = h._sanitizeImportItems(items, importChapterCountOf);
  assert.deepEqual(nodes.map((n) => n.id), ["c"]);
  assert.equal(skipped, 4 + 1);   // f1 · a · f2 · b, then f3
});

test("_sanitizeImportItems: a well-formed folder keeps its well-formed children only", () => {
  const h = loadImportExport();
  const items = [{ type: "folder", id: "f1", name: "x", children: [appBookmark({ id: "a" }), appBookmark({ id: "b", chapter: 99 })] }];
  const { nodes, skipped } = h._sanitizeImportItems(items, importChapterCountOf);
  assert.equal(skipped, 1);
  assert.deepEqual(nodes[0].children.map((n) => n.id), ["a"]);
});

test("_sanitizeImportItems: a repeated id keeps the first well-formed item, anywhere in the tree", () => {
  const h = loadImportExport();
  const items = [
    appBookmark({ id: "dup", label: "first" }),
    { type: "folder", id: "f1", name: "x", children: [appBookmark({ id: "dup", label: "second" })] },
    appBookmark({ id: "late", chapter: 0 }),      // ill-formed, so the later "late" is the first well-formed one
    appBookmark({ id: "late", label: "kept" }),
  ];
  const { nodes, skipped } = h._sanitizeImportItems(items, importChapterCountOf);
  assert.equal(skipped, 2);
  assert.deepEqual(nodes.map((n) => n.label ?? n.id), ["first", "f1", "kept"]);
  assert.equal(nodes[1].children.length, 0);
});

test("_sanitizeImportItems: unknown fields ride along (a newer app's extras survive)", () => {
  const h = loadImportExport();
  const items = [appBookmark({ id: "a", color: "red", futureField: { x: 1 } })];
  const { nodes } = h._sanitizeImportItems(items, importChapterCountOf);
  assert.equal(nodes[0].color, "red");
  assert.deepEqual(JSON.parse(JSON.stringify(nodes[0].futureField)), { x: 1 });
});

test("_sanitizeImportItems: an id naming an Object.prototype member is left out (PR #359 review)", () => {
  const h = loadImportExport();
  const items = [
    appBookmark({ id: "constructor" }), appBookmark({ id: "toString" }), appBookmark({ id: "__proto__" }),
    { type: "folder", id: "hasOwnProperty", name: "x", children: [appBookmark({ id: "inner" })] },
    appBookmark({ id: "ok" }),
  ];
  const { nodes, skipped } = h._sanitizeImportItems(items, importChapterCountOf);
  assert.deepEqual(nodes.map((n) => n.id), ["ok"]);
  assert.equal(skipped, 3 + 2);   // three bookmarks, then the folder with its child
});

test("_sanitizeImportItems: a bookmark carrying children is left out with them — children is structure (PR #359 review)", () => {
  const h = loadImportExport();
  const items = [
    appBookmark({ id: "b-empty", children: [] }),
    appBookmark({ id: "b-null", children: [null] }),
    appBookmark({ id: "b-kid", children: [appBookmark({ id: "kid" })] }),
    appBookmark({ id: "ok" }),
  ];
  const { nodes, skipped } = h._sanitizeImportItems(items, importChapterCountOf);
  assert.deepEqual(nodes.map((n) => n.id), ["ok"]);
  assert.equal(skipped, 1 + 2 + 2);
});

// Round trip through the real sync store (js/sync/store-v2.js — saveBookmarks · loadBookmarks go through it once
// sync is loaded): what the import check keeps must survive a save and a read. The raw file broke the store in
// three ways, so these tests do exercise the hazards the check guards against (PR #359 review). The store reads a
// toString id since known-issues §15.2, but a device on an older build still fails on one that sync brings it.
const STORE_V2_SOURCE = stripEsmMarker(fs.readFileSync(path.resolve(__dirname, "../../js/sync/store-v2.js"), "utf8"));
function loadSyncStore(localStorage = makeLocalStorage({})) {
  const win = {};
  const ctx = {
    localStorage, window: win,
    JSON, Object, Array, Set, Map, String, Number, Boolean, Math, Date, console, Error, isNaN, parseInt,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(STORE_V2_SOURCE, ctx, { filename: "store-v2.js" });
  return win.syncStoreV2;
}

test("_sanitizeImportItems: the raw file trips the sync store — a null child, a __proto__ id (a toString id until §15.2)", () => {
  // Throws while flattening — storage.js saveBookmarks swallows it, so 「덮어썼습니다」 stood over an unchanged list.
  assert.throws(() => loadSyncStore().saveBookmarks([appBookmark({ id: "b-kid", children: [null] })]), { name: "TypeError" });
  // The next read called .sort() on the inherited toString and the whole list failed to load — read since
  // known-issues §15.2.
  const s1 = loadSyncStore();
  s1.saveBookmarks([appBookmark({ id: "toString" }), appBookmark({ id: "b" })]);
  assert.deepEqual(s1.loadBookmarks().map((n) => n.id), ["toString", "b"]);
  // Vanishes without a sound.
  const s2 = loadSyncStore();
  s2.saveBookmarks([appBookmark({ id: "__proto__" }), appBookmark({ id: "b" })]);
  assert.deepEqual(s2.loadBookmarks().map((n) => n.id), ["b"]);
});

test("_sanitizeImportItems: what it keeps survives the sync store's save and read unchanged", () => {
  const h = loadImportExport();
  const raw = [
    { type: "folder", id: "f1", name: "대림", expanded: false, createdAt: 1, children: [appBookmark({ id: "a" }), { type: "folder", id: "f2", name: "", children: [] }] },
    appBookmark({ id: "toString" }),
    appBookmark({ id: "__proto__" }),
    appBookmark({ id: "b-kid", children: [null] }),
    appBookmark({ id: "b", verseSpec: "all" }),
  ];
  const { nodes, skipped } = h._sanitizeImportItems(raw, importChapterCountOf);
  assert.equal(skipped, 1 + 1 + 2);
  const store = loadSyncStore();
  store.saveBookmarks(nodes);
  assert.deepEqual(JSON.parse(JSON.stringify(store.loadBookmarks())), JSON.parse(JSON.stringify(nodes)));
});

// ── PR #359 리뷰 2회차 — 검사가 타입만 보고, 그 값을 받는 코드가 다룰 수 있는 형식인지 보지 않아 샌 것들 ──

test("isWellFormedSpec: the forms the app writes, and the two the pre-#205 app wrote, are accepted", () => {
  const h = loadVerseSpec();
  const accepted = [
    "all", "16", "1-5,10-15", "3a,3b,5-7", "1-3", "3a", "6,7-8,9", "3,3a", "2-3,3a,4", "176", "1p",
    // #205(2026-06-06) 전 앱이 쓴 표기 — 반쪽 절의 한 줄 「16aa」, 병합 절의 한 줄 「16-17a」. 그 판의 정렬은 줄 글자를
    // 따르지 않았다(「16-17b,16-17a」). 그대로 받는다(사용자 결정 2026-10-19).
    "16aa", "16-17a,16-17b", "16-17b,16-17a", "8ba,8ab", "3a,3bb",
  ];
  assert.deepEqual(accepted.filter((spec) => !h.isWellFormedSpec(spec)), []);
});

test("isWellFormedSpec: what got through before is rejected (PR #359 review)", () => {
  const h = loadVerseSpec();
  const flood = (seg, n) => Array(n).fill(seg).join(",");
  const rejected = [
    // a huge number hung 합치기 (mergeVerseSpecs walks every verse of a range) · a huge range threw while routing
    "9007199254740992", "9".repeat(400), "1000", "1-1000", "1-4294967296,7", "1-20000000",
    // whitespace stayed in the link, so nothing was highlighted
    " 16 ", "1, 2", "16　", "﻿16", "16\t", "1,\n2", " all",
    // backward and empty ranges — "5-0" lost verses on 합치기
    "5-0", "1-0", "0-5", "0", "5-3", "3-3",
    // repeats, overlaps, out of order — "5a,3" · "16aa,3" are caught only by the ascending-start check (PR #362 review)
    "16,16", "1-5,3-7", "5,3", "3b,3a", "16aa,16aa", "1-5,3a", "5a,3", "16aa,3",
    // not a segment
    "", ",1", "1,", "1,,2", "01", "3z", "3A", "3ab-5", "16aaa", "16-17ab", "16-15a", "ALL", "abc",
    // floods — the router re-reads the spec on every scroll frame
    flood("16", 100_000), flood("1-176", 100_000),
    Array.from({ length: 2000 }, (_, i) => `${1 + Math.floor(i / 16)}${"abcdefghijklmnop"[i % 16]}a`).join(","),
  ];
  assert.deepEqual(rejected.filter((spec) => h.isWellFormedSpec(spec)).map((spec) => spec.slice(0, 24)), []);
});

// Every spec the app writes passes: today's 저장 (verseNumberSpec) and 합치기 (mergeVerseSpecs), and the half-verse
// form the verse-select citation keeps (selectionCitation). Synthetic
// chapters shaped like the data — half verses ("3a" "3b"), merged verses ("7-8"), verses drawn in lines ("9a" … up to
// "p"), and both at once ("8aa", "7-8a") — from a fixed seed, so no real data is needed (the public CI has none).
// Checked once against the real data too: 34,003 specs today's app writes, 60,384 the pre-#205 app wrote — all pass.
test("isWellFormedSpec: every spec the app writes over synthetic chapters is accepted", () => {
  const v = loadVerseSpec();
  let seed = 20261019;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const LINE = "abcdefghijklmnop";
  const lines = (label, k) => (k === 1 ? [label] : Array.from({ length: k }, (_, i) => `${label}${LINE[i]}`));
  const lineCount = () => (rnd() < 0.15 ? (rnd() < 0.1 ? 16 : 2 + Math.floor(rnd() * 3)) : 1);
  const failures = [];
  let checked = 0;
  for (let c = 0; c < 120; c++) {
    const refs = [];
    // Mostly short chapters (selectionCitation scans the whole chapter for each pick); every tenth up to 176 (Psalm 119)
    const last = 5 + Math.floor(rnd() * (c % 10 === 0 ? 172 : 30));
    for (let n = 1; n <= last;) {
      const kind = rnd();
      if (kind < 0.08 && n < last) {                   // a merged verse
        const end = n + 1 + Math.floor(rnd() * 2);
        refs.push(...lines(`${n}-${end}`, lineCount()));
        n = end + 1;
      } else if (kind < 0.16) {                        // half verses from the data
        refs.push(...lines(`${n}a`, lineCount()), ...lines(`${n}b`, lineCount()));
        n += 1;
      } else {
        refs.push(...lines(`${n}`, lineCount()));
        n += 1;
      }
    }
    const article = makeStubArticle(refs);
    const keys = refs.map((r, i) => `${i}/${r}`);
    const written = [];
    for (let t = 0; t < 9; t++) {
      let pick;
      if (t % 3 === 0) {
        const a = Math.floor(rnd() * keys.length);
        pick = keys.slice(a, a + 1 + Math.floor(rnd() * 8));
      } else {
        pick = keys.filter(() => rnd() < (t % 3 === 1 ? 0.15 : 0.5));
      }
      if (!pick.length) continue;
      written.push(v.verseNumberSpec(v.selectedSpanVrefs(new Set(pick), article)));
      written.push(v.selectedVersesToSpec(v.selectionCitation(new Set(pick), article).refs));
    }
    const saved = written.length;
    for (let i = 1; i < saved; i++) written.push(v.mergeVerseSpecs(written[i - 1], written[i]));
    for (const spec of written) {
      checked += 1;
      if (!v.isWellFormedSpec(spec)) failures.push(spec);
    }
  }
  assert.ok(checked > 3000, `${checked} specs`);
  assert.ok(failures.length === 0, `rejected: ${failures.slice(0, 5).join(" | ")}`);
});

// The pre-#205 save, as it was (`git show 0789632^:js/app/bookmark.js` — collapseFullVerseRefs, then the same
// selectedVersesToSpec): a verse drawn in lines stored its number only when every line was picked, otherwise the lines
// themselves. Every such spec moves (wholeVerseSpec) to what today's 저장 writes for the same lines, and passes the
// check (사용자 결정 2026-10-22, coding-pitfalls §38). One loss stays: with every line of a merged verse drawn in lines
// picked, that app stored the first number ("7" for 나훔 1:7-8 — known-issues §17), and without the chapter the move
// cannot tell it from verse 7. The real data — every chapter — is checked in the PR (ledger).
function pre205Save(refs, article) {
  const selected = new Set(refs);
  const byVerse = {};
  for (const ref of refs) {
    const n = parseInt(ref, 10);
    if (!byVerse[n]) byVerse[n] = [];
    byVerse[n].push(ref);
  }
  const result = [];
  for (const [n, verseRefs] of Object.entries(byVerse)) {
    const allSpanRefs = [...article.querySelectorAll(".verse[data-vref]")]
      .map((s) => s.getAttribute("data-vref") ?? "")
      .filter((r) => r && parseInt(r, 10) === Number(n));
    const hasAlpha = allSpanRefs.some((r) => /[a-z]$/.test(r));
    const allSelected = allSpanRefs.length > 0 && allSpanRefs.every((r) => selected.has(r));
    if (hasAlpha && allSelected) result.push(`${n}`);
    else result.push(...verseRefs);
  }
  return result;
}

test("wholeVerseSpec: what the pre-#205 app saved over synthetic chapters moves to what today's app saves", () => {
  const v = loadVerseSpec();
  let seed = 20261022;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const LINE = "abcdefghijklmnop";
  const lines = (label, k) => (k === 1 ? [label] : Array.from({ length: k }, (_, i) => `${label}${LINE[i]}`));
  const lineCount = () => (rnd() < 0.3 ? 2 + Math.floor(rnd() * 4) : 1);
  const failures = [];
  let moved = 0;
  for (let c = 0; c < 80; c++) {
    const refs = [];
    const last = 5 + Math.floor(rnd() * 30);
    for (let n = 1; n <= last;) {
      const kind = rnd();
      if (kind < 0.1 && n < last) {                    // a merged verse
        const end = n + 1 + Math.floor(rnd() * 2);
        refs.push(...lines(`${n}-${end}`, lineCount()));
        n = end + 1;
      } else if (kind < 0.2) {                         // half verses from the data
        refs.push(...lines(`${n}a`, lineCount()), ...lines(`${n}b`, lineCount()));
        n += 1;
      } else {
        refs.push(...lines(`${n}`, lineCount()));
        n += 1;
      }
    }
    const article = makeStubArticle(refs);
    for (let t = 0; t < 12; t++) {
      // The pre-#205 selection was any set of lines (it keyed by data-vref).
      const pick = t % 2 ? [refs[Math.floor(rnd() * refs.length)]] : refs.filter(() => rnd() < 0.3);
      if (!pick.length) continue;
      const legacy = v.selectedVersesToSpec(pre205Save(pick, article));
      // Today's 저장 of the same lines, but with the merged verses that app stored by their first number.
      const lineLabel = (r) => r.replace(/[a-p]+$/, "");
      const lossy = pick.map((r) => {
        const merged = /^(\d+)-\d+$/.exec(lineLabel(r));
        if (!merged || lineLabel(r) === r) return r;
        const all = refs.filter((x) => lineLabel(x) === lineLabel(r));
        return all.every((x) => pick.includes(x)) ? merged[1] : r;
      });
      const today = v.verseNumberSpec(lossy);
      const now = v.wholeVerseSpec(legacy);
      if (/[a-z]/.test(legacy)) moved += 1;
      // A spec without part letters is not a pre-#205 form and stays as it is; it already covers the same verses.
      const expected = /[a-z]/.test(legacy) ? today : legacy;
      if (now !== expected || !v.isWellFormedSpec(now) || v.verseNumberSpec(now.split(",")) !== today) {
        failures.push(`${legacy} → ${now} (today ${today})`);
      }
    }
  }
  assert.ok(moved > 300, `${moved} moved`);
  assert.deepEqual(failures.slice(0, 5), []);
});

/** `depth` folders, each inside the one before, with a bookmark at the bottom. */
function folderChain(depth) {
  let node = appBookmark({ id: "leaf" });
  for (let d = depth; d >= 1; d--) node = { type: "folder", id: `f${d}`, name: "", children: [node] };
  return node;
}
/** How many levels of folders a kept tree has. */
function folderDepth(nodes) {
  const foldersIn = (list) => list.filter((n) => n.type === "folder");
  let depth = 0;
  for (let level = foldersIn(nodes); level.length; level = level.flatMap((f) => foldersIn(f.children))) depth += 1;
  return depth;
}

test("_sanitizeImportItems: folders 64 deep are kept, the 65th level goes with what it holds (PR #359 review)", () => {
  const h = loadImportExport();
  assert.equal(h.IMPORT_MAX_FOLDER_DEPTH, 64);
  const at64 = h._sanitizeImportItems([folderChain(64)], importChapterCountOf);
  assert.equal(at64.skipped, 0);
  assert.equal(folderDepth(at64.nodes), 64);
  const at65 = h._sanitizeImportItems([folderChain(65)], importChapterCountOf);
  assert.equal(at65.skipped, 2);   // f65 and the bookmark in it
  assert.equal(folderDepth(at65.nodes), 64);
});

test("_sanitizeImportItems: 20,000 levels neither overflow the check nor reach the list", () => {
  const h = loadImportExport();
  const { nodes, skipped } = h._sanitizeImportItems([folderChain(20_000)], importChapterCountOf);
  assert.equal(folderDepth(nodes), 64);
  assert.equal(skipped, 20_000 - 64 + 1);
});

test("_sanitizeImportItems: 64 levels of folders survive the sync store's save and read", () => {
  const h = loadImportExport();
  const { nodes } = h._sanitizeImportItems([folderChain(64)], importChapterCountOf);
  const store = loadSyncStore();
  store.saveBookmarks(nodes);
  assert.deepEqual(JSON.parse(JSON.stringify(store.loadBookmarks())), JSON.parse(JSON.stringify(nodes)));
});

test("_sanitizeImportItems: a time stamp has to be a finite number — JSON reads 1e400 as Infinity (PR #359 review)", () => {
  const h = loadImportExport();
  const items = [
    ...JSON.parse('[{"type":"bookmark","id":"e400","bookId":"john","chapter":3,"verseSpec":"16","label":"x","createdAt":1e400}]'),
    appBookmark({ id: "inf", updatedAt: Infinity }), appBookmark({ id: "ninf", createdAt: -Infinity }), appBookmark({ id: "nan", createdAt: NaN }),
    { type: "folder", id: "f", name: "x", createdAt: Infinity, children: [appBookmark({ id: "in-f" })] },
    { type: "folder", id: "g", name: "x", updatedAt: 1_760_000_000_000, children: [] },
    appBookmark({ id: "ok", createdAt: 0, updatedAt: 1_760_000_000_000 }),
  ];
  const { nodes, skipped } = h._sanitizeImportItems(items, importChapterCountOf);
  assert.deepEqual(nodes.map((n) => n.id), ["g", "ok"]);
  assert.equal(skipped, 4 + 2);
});

test("_sanitizeImportItems: an id is letters, digits, _ and - — a folder id goes into the 모아 읽기 link as is (PR #359 review)", () => {
  const h = loadImportExport();
  const bad = ["a b", "a/b", "a?b", "a#b", "%41", "..", ".", "a.b", "é", "가", "a\nb", "a​b"];
  const good = ["lq8x2k9z3abcdef", "ABC_def-123"];
  const { nodes, skipped } = h._sanitizeImportItems([...bad, ...good].map((id) => appBookmark({ id })), importChapterCountOf);
  assert.deepEqual(nodes.map((n) => n.id), good);
  assert.equal(skipped, bad.length);
});

test("_sanitizeImportItems: an id the current list uses for the other kind is left out (PR #359 review)", () => {
  const h = loadImportExport();
  const current = { bm: "bookmark", fd: "folder" };
  const items = [
    { type: "folder", id: "bm", name: "x", children: [appBookmark({ id: "kid" })] },   // a bookmark in the list
    appBookmark({ id: "fd" }),                                                        // a folder in the list
    appBookmark({ id: "bm", label: "same kind" }),   // the same kind — 병합 keeps the list's, 덮어쓰기 takes this one
    appBookmark({ id: "new" }),
  ];
  const { nodes, skipped } = h._sanitizeImportItems(items, importChapterCountOf, (id) => current[id] ?? null);
  assert.deepEqual(nodes.map((n) => n.id), ["bm", "new"]);
  assert.equal(nodes[0].label, "same kind");
  assert.equal(skipped, 2 + 1);
});

test("_fitsStorage: the save's characters at 2 bytes each must leave 64 KiB of Safari's 5 MiB", () => {
  const h = loadImportExport();
  assert.equal(h.STORAGE_QUOTA_BYTES, 5 * 1024 * 1024);
  assert.equal(h.STORAGE_HEADROOM_BYTES, 64 * 1024);
  const limit = (h.STORAGE_QUOTA_BYTES - h.STORAGE_HEADROOM_BYTES) / 2;   // 2,588,672 characters
  assert.equal(h._fitsStorage(limit), true);
  assert.equal(h._fitsStorage(limit + 1), false);
});

// localStorage as WebKit counts it (LocalStorageManager.cpp `localStorageQuotaInBytes` · SQLiteStorageArea::requestSpace
// · WTFString.h `sizeInBytes`): key and value in bytes — 1 a character for a Latin-1-only string, 2 once anything else is
// in it — against 5 MiB per origin. A write past it throws, as the browser's does.
function makeWebKitLocalStorage() {
  const map = new Map();
  const bytes = (str) => str.length * (/[^\u0000-ÿ]/.test(str) ? 2 : 1);
  let used = 0;
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const value = String(v);
      const next = used + bytes(value) - (map.has(k) ? bytes(map.get(k)) : -bytes(k));
      if (next > 5 * 1024 * 1024) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
      map.set(k, value);
      used = next;
    },
    removeItem(k) { if (map.has(k)) { used -= bytes(k) + bytes(map.get(k)); map.delete(k); } },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    get used() { return used; },
  };
}

// The app's two storage layers in one realm — storage.js over the real sync store — on the given localStorage, so a
// save takes the app's own path (storage.js saveBookmarks: store-v2.js, then the legacy key).
const STORAGE_SOURCE = stripEsmMarker(fs.readFileSync(path.resolve(__dirname, "../../js/app/storage.js"), "utf8"));
function loadAppStorage(localStorage) {
  const ctx = {
    localStorage, navigator: {},
    JSON, Object, Array, Set, Map, String, Number, Boolean, Math, Date, console, Error, isNaN, parseInt,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(STORE_V2_SOURCE, ctx, { filename: "store-v2.js" });
  vm.runInContext(STORAGE_SOURCE, ctx, { filename: "storage.js" });
  return { appStorage: ctx.appStorage, syncStore: ctx.syncStoreV2 };
}

// The check measures what will be stored. The fixed budget it replaced — the list's JSON at most 600,000 characters —
// got both of these wrong (PR #359 review): the sync store repeats a parent's id under every child, and a list of
// notes is stored at about twice its JSON.
test("_fitsStorage over projectedStorageChars: a backup of notes comes in, a 1,000-character folder id stays out", () => {
  const h = loadImportExport();
  const bm = (i, over = {}) => appBookmark({ id: `b${i.toString(36)}`, ...over });
  const notes = Array.from({ length: 300 }, (_, i) => bm(i, { note: "메".repeat(2000) }));
  assert.ok(JSON.stringify(notes).length > 600_000);
  const a = loadAppStorage(makeWebKitLocalStorage());
  assert.equal(h._fitsStorage(a.appStorage.projectedStorageChars(notes)), true);
  a.appStorage.saveBookmarks(notes);
  assert.equal(a.syncStore.loadBookmarks().length, 300);

  const longId = "f".repeat(1000);
  const tree = [{ type: "folder", id: longId, name: "x", children: Array.from({ length: 3000 }, (_, i) => bm(i)) }];
  assert.ok(JSON.stringify(tree).length < 600_000);
  const webKit = makeWebKitLocalStorage();
  const b = loadAppStorage(webKit);
  assert.equal(h._fitsStorage(b.appStorage.projectedStorageChars(tree)), false);
  // Saved anyway, this list does not fit: the sync store refuses it, and the legacy key is left alone — until
  // known-issues §15.4 the legacy key took it and the two copies parted.
  assert.equal(b.appStorage.saveBookmarks(tree), "full");
  assert.equal(b.syncStore.loadBookmarks().length, 0);
  assert.equal(webKit.getItem("bible-bookmarks"), null);
});

test("_fitsStorage over projectedStorageChars: the largest overwrite it lets in over a large legacy copy, WebKit stores in full (ADR-015 D7)", () => {
  // The sync store is written before the legacy key, so while it is written the legacy key still holds the old list.
  // A list of long notes keeps its legacy copy large; counting that copy as already replaced let in an overwrite the
  // sync store then refused (PR review, 2026-10-26).
  const h = loadImportExport();
  const notes = Array.from({ length: 800 }, (_, i) => appBookmark({ id: `n${i.toString(36)}`, note: "메".repeat(1200) }));
  // One Korean name, as in a real list: WebKit then counts the whole value at 2 bytes a character.
  const folders = (n) => Array.from({ length: n }, (_, i) => ({ type: "folder", id: `f${i.toString(36)}`, name: i ? "" : "가", children: [] }));
  const { appStorage, syncStore } = loadAppStorage(makeWebKitLocalStorage());
  assert.equal(appStorage.saveBookmarks(notes), "saved");
  const fits = (n) => h._fitsStorage(appStorage.projectedStorageChars(folders(n)));
  let lo = 0, hi = 40000;
  assert.ok(fits(lo) && !fits(hi));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  assert.equal(appStorage.saveBookmarks(folders(lo)), "saved");
  assert.equal(syncStore.loadBookmarks().length, lo);
});

test("storage full: a save that does not fit is refused as full and both copies keep the list — a delete still saves (known-issues §15.4)", () => {
  const webKit = makeWebKitLocalStorage();
  const { appStorage, syncStore } = loadAppStorage(webKit);
  const list = Array.from({ length: 20 }, (_, i) => appBookmark({ id: `b${i}`, chapter: i + 1, label: `요한 ${i + 1}장` }));
  assert.equal(appStorage.saveBookmarks(list), "saved");
  webKit.setItem("bible-filler", "x".repeat(5 * 1024 * 1024 - webKit.used - "bible-filler".length - 100));   // 100 bytes left
  const legacy = webKit.getItem("bible-bookmarks");
  assert.equal(appStorage.saveBookmarks([...list, appBookmark({ id: "new", label: "요한 21장" })]), "full");
  assert.equal(webKit.getItem("bible-bookmarks"), legacy);
  assert.deepEqual(syncStore.loadBookmarks().map((n) => n.id), list.map((n) => n.id));
  // 「쓰지 않는 북마크를 지운 뒤 다시 시도해 주세요」 — a delete shrinks both copies, so it fits.
  assert.equal(appStorage.saveBookmarks(list.slice(1)), "saved");
  assert.deepEqual(appStorage.loadBookmarks().map((n) => n.id), list.slice(1).map((n) => n.id));
  assert.deepEqual(JSON.parse(webKit.getItem("bible-bookmarks")).map((n) => n.id), list.slice(1).map((n) => n.id));
});

test("_fitsStorage over projectedStorageChars: the largest overwrite it lets in, WebKit stores in full", () => {
  // The smallest items (empty folders — the sync store's per-record fields weigh most against them), one Korean name,
  // over another list whose ids then stay as tombstones for 30 days.
  const h = loadImportExport();
  const folders = (prefix, n) => Array.from({ length: n }, (_, i) => ({ type: "folder", id: `${prefix}${i.toString(36)}`, name: i ? "" : "가", children: [] }));
  const { appStorage, syncStore } = loadAppStorage(makeWebKitLocalStorage());
  appStorage.saveBookmarks(folders("a", 6000));
  assert.equal(syncStore.loadBookmarks().length, 6000);
  const fits = (n) => h._fitsStorage(appStorage.projectedStorageChars(folders("b", n)));
  let lo = 6000, hi = 20000;                           // fits(lo), !fits(hi) — the edge is 16,415 today
  assert.ok(fits(lo) && !fits(hi));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  const largest = folders("b", lo);
  appStorage.saveBookmarks(largest);
  assert.equal(syncStore.loadBookmarks().length, lo);
  assert.equal(appStorage.loadBookmarks().length, lo);
});

// ── BOOKMARK_SORT loader ─────────────────────────────────────────────────────
// The sort helpers read/write localStorage for the per-device preference and
// the last-viewed map. A Map-backed fake lets each test seed and inspect state.

function makeFakeLocalStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    _dump() { return Object.fromEntries(m); },
  };
}

function loadBookmarkSort(seed = {}) {
  const localStorage = makeFakeLocalStorage(seed);
  const ctx = {
    Object, Array, Set, String, Math, Number, JSON, console, Error, Date,
    localStorage,
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("BOOKMARK_SORT", BOOKMARK_CORE_SOURCE), ctx, { filename: "bookmark-core.js" });
  return {
    getBookmarkSort: ctx.getBookmarkSort,
    setBookmarkSort: ctx.setBookmarkSort,
    getBookmarkSortDir: ctx.getBookmarkSortDir,
    setBookmarkSortDir: ctx.setBookmarkSortDir,
    markBookmarkViewed: ctx.markBookmarkViewed,
    _forgetViewed: ctx._forgetViewed,
    sortBookmarkNodes: ctx.sortBookmarkNodes,
    _ls: localStorage,
  };
}

const idsOf = (nodes) => nodes.map((n) => n.id);

// ── sort preference (localStorage, per-device) ──

test("getBookmarkSort: defaults to 'manual' when unset", () => {
  const h = loadBookmarkSort();
  assert.equal(h.getBookmarkSort(), "manual");
});

test("getBookmarkSort: returns a stored valid mode", () => {
  const h = loadBookmarkSort({ "bible-bookmark-sort": "title" });
  assert.equal(h.getBookmarkSort(), "title");
});

test("getBookmarkSort: ignores an unknown stored value → 'manual'", () => {
  const h = loadBookmarkSort({ "bible-bookmark-sort": "bogus" });
  assert.equal(h.getBookmarkSort(), "manual");
});

test("setBookmarkSort: persists a valid mode", () => {
  const h = loadBookmarkSort();
  h.setBookmarkSort("created");
  assert.equal(h.getBookmarkSort(), "created");
});

test("setBookmarkSort: rejects an invalid mode (no write)", () => {
  const h = loadBookmarkSort({ "bible-bookmark-sort": "title" });
  h.setBookmarkSort("nope");
  assert.equal(h.getBookmarkSort(), "title");
});

// ── last-viewed map (localStorage, per-device) ──

test("markBookmarkViewed: records a timestamp under the bookmark id", () => {
  const h = loadBookmarkSort();
  h.markBookmarkViewed("bm-1");
  const map = JSON.parse(h._ls.getItem("bible-bookmark-viewed"));
  assert.ok(map["bm-1"] > 0);
});

test("markBookmarkViewed: ignores empty id", () => {
  const h = loadBookmarkSort();
  h.markBookmarkViewed("");
  assert.equal(h._ls.getItem("bible-bookmark-viewed"), null);
});

test("_forgetViewed: removes a single id, leaves others", () => {
  const h = loadBookmarkSort({ "bible-bookmark-viewed": JSON.stringify({ a: 10, b: 20 }) });
  h._forgetViewed("a");
  const map = JSON.parse(h._ls.getItem("bible-bookmark-viewed"));
  assert.deepEqual(map, { b: 20 });
});

test("_forgetViewed: an id named like an Object.prototype member that was never viewed writes nothing (PR #438 review)", () => {
  const h = loadBookmarkSort();
  h._forgetViewed("toString");
  assert.equal(h._ls.getItem("bible-bookmark-viewed"), null);
});

// ── sortBookmarkNodes ──

test("sortBookmarkNodes: 'manual' preserves stored order (shallow copy)", () => {
  const h = loadBookmarkSort({ "bible-bookmark-sort": "manual" });
  const nodes = [
    { type: "bookmark", id: "b", label: "Z" },
    { type: "folder", id: "f", name: "A" },
    { type: "bookmark", id: "a", label: "A" },
  ];
  const out = h.sortBookmarkNodes(nodes);
  assert.deepEqual(idsOf(out), ["b", "f", "a"]);
  assert.notStrictEqual(out, nodes); // copy, not the same array
});

test("sortBookmarkNodes: 'title' sorts folders-first, then by label A→Z", () => {
  const h = loadBookmarkSort({ "bible-bookmark-sort": "title" });
  const nodes = [
    { type: "bookmark", id: "b-c", label: "다" },
    { type: "folder", id: "f-b", name: "나" },
    { type: "bookmark", id: "b-a", label: "가" },
    { type: "folder", id: "f-a", name: "가" },
  ];
  // folders (가, 나) before bookmarks (가, 다), each alphabetical
  assert.deepEqual(idsOf(h.sortBookmarkNodes(nodes)), ["f-a", "f-b", "b-a", "b-c"]);
});

test("sortBookmarkNodes: 'created' sorts newest-first", () => {
  const h = loadBookmarkSort({ "bible-bookmark-sort": "created" });
  const nodes = [
    { type: "bookmark", id: "old", createdAt: 100 },
    { type: "bookmark", id: "new", createdAt: 300 },
    { type: "bookmark", id: "mid", createdAt: 200 },
  ];
  assert.deepEqual(idsOf(h.sortBookmarkNodes(nodes)), ["new", "mid", "old"]);
});

test("sortBookmarkNodes: 'modified' falls back to createdAt when updatedAt missing", () => {
  const h = loadBookmarkSort({ "bible-bookmark-sort": "modified" });
  const nodes = [
    { type: "bookmark", id: "edited", createdAt: 100, updatedAt: 500 },
    { type: "bookmark", id: "fresh",  createdAt: 400 },
  ];
  // edited's updatedAt(500) beats fresh's createdAt(400)
  assert.deepEqual(idsOf(h.sortBookmarkNodes(nodes)), ["edited", "fresh"]);
});

test("sortBookmarkNodes: 'viewed' uses the local viewed map, newest-first", () => {
  const h = loadBookmarkSort({
    "bible-bookmark-sort": "viewed",
    "bible-bookmark-viewed": JSON.stringify({ a: 10, c: 30 }),
  });
  const nodes = [
    { type: "bookmark", id: "a", createdAt: 999 },
    { type: "bookmark", id: "b", createdAt: 5 },   // never viewed → falls back to createdAt(5)
    { type: "bookmark", id: "c", createdAt: 1 },
  ];
  // viewed: c(30), a(10), then b(createdAt 5)
  assert.deepEqual(idsOf(h.sortBookmarkNodes(nodes)), ["c", "a", "b"]);
});

test("sortBookmarkNodes: 'viewed' — a never-viewed id named like an Object.prototype member falls back to createdAt", () => {
  // The viewed map is a plain object: toString read the inherited function and the sort key became NaN, so the item
  // kept whatever place it had (PR #438 review — the sync store reads such ids since known-issues §15.2).
  const h = loadBookmarkSort({
    "bible-bookmark-sort": "viewed",
    "bible-bookmark-viewed": JSON.stringify({ a: 10 }),
  });
  const nodes = [
    { type: "bookmark", id: "toString", createdAt: 1 },
    { type: "bookmark", id: "a", createdAt: 999 },
    { type: "bookmark", id: "b", createdAt: 5 },
  ];
  assert.deepEqual(idsOf(h.sortBookmarkNodes(nodes)), ["a", "b", "toString"]);
});

test("sortBookmarkNodes: non-array input → empty array", () => {
  const h = loadBookmarkSort({ "bible-bookmark-sort": "title" });
  assert.deepEqual(h.sortBookmarkNodes(undefined), []);
});

// ── sort direction (per-mode, localStorage) ──

test("getBookmarkSortDir: natural defaults — title asc, date keys desc", () => {
  const h = loadBookmarkSort();
  assert.equal(h.getBookmarkSortDir("title"), "asc");
  assert.equal(h.getBookmarkSortDir("created"), "desc");
  assert.equal(h.getBookmarkSortDir("modified"), "desc");
  assert.equal(h.getBookmarkSortDir("viewed"), "desc");
});

test("getBookmarkSortDir: unknown mode → 'asc' fallback", () => {
  const h = loadBookmarkSort();
  assert.equal(h.getBookmarkSortDir("manual"), "asc");
  assert.equal(h.getBookmarkSortDir("bogus"), "asc");
});

test("getBookmarkSortDir: returns a stored direction, ignores garbage", () => {
  const h = loadBookmarkSort({
    "bible-bookmark-sort-dir": JSON.stringify({ title: "desc", created: "nope" }),
  });
  assert.equal(h.getBookmarkSortDir("title"), "desc");      // stored
  assert.equal(h.getBookmarkSortDir("created"), "desc");    // garbage → natural default
});

test("setBookmarkSortDir: persists per mode independently", () => {
  const h = loadBookmarkSort();
  h.setBookmarkSortDir("title", "desc");
  h.setBookmarkSortDir("created", "asc");
  assert.equal(h.getBookmarkSortDir("title"), "desc");
  assert.equal(h.getBookmarkSortDir("created"), "asc");
  assert.equal(h.getBookmarkSortDir("viewed"), "desc");     // untouched → default
});

test("setBookmarkSortDir: rejects manual mode and invalid direction (no write)", () => {
  const h = loadBookmarkSort();
  h.setBookmarkSortDir("manual", "asc");   // manual has no direction
  h.setBookmarkSortDir("title", "sideways"); // invalid dir
  assert.equal(h._ls.getItem("bible-bookmark-sort-dir"), null);
});

test("sortBookmarkNodes: 'created' with asc direction → oldest-first", () => {
  const h = loadBookmarkSort({
    "bible-bookmark-sort": "created",
    "bible-bookmark-sort-dir": JSON.stringify({ created: "asc" }),
  });
  const nodes = [
    { type: "bookmark", id: "old", createdAt: 100 },
    { type: "bookmark", id: "new", createdAt: 300 },
    { type: "bookmark", id: "mid", createdAt: 200 },
  ];
  assert.deepEqual(idsOf(h.sortBookmarkNodes(nodes)), ["old", "mid", "new"]);
});

test("sortBookmarkNodes: 'title' with desc direction → Z→A, folders still first", () => {
  const h = loadBookmarkSort({
    "bible-bookmark-sort": "title",
    "bible-bookmark-sort-dir": JSON.stringify({ title: "desc" }),
  });
  const nodes = [
    { type: "bookmark", id: "b-a", label: "가" },
    { type: "folder", id: "f-a", name: "가" },
    { type: "bookmark", id: "b-c", label: "다" },
    { type: "folder", id: "f-b", name: "나" },
  ];
  // folders desc (나, 가) before bookmarks desc (다, 가)
  assert.deepEqual(idsOf(h.sortBookmarkNodes(nodes)), ["f-b", "f-a", "b-c", "b-a"]);
});
