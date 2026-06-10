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
//     (+ collapseFullVerseRefs, with a tiny `article.querySelectorAll`
//     stub so the rendered-spans lookup resolves)
//   - BOOKMARK_QUERY block — _walkBookmarks / findExistingChapterBookmarks
//     / _findItemInStore / _findParentFolderId / removeItemById / insertItem
//     / collectFolderOptions. `loadBookmarks` provided as stub.
//   - DRAG_CORE block (loaded after BOOKMARK_QUERY so `_findItemInStore`
//     resolves) — _isDescendant / moveBookmarkItem.
//   - SWIPED_ROW block — closeSwipedRow / _openSwipedRow / resetSwipedRow
//     / closeSwipedRowIfOutside, with a minimal Element stub.
//   - BOOKMARK_HREF block — _bookmarkHref (pure URL builder).
//   - BOOKMARK_ACTIVE block — _renderPathname state + _isActiveBookmark
//     + _hasActiveDescendant. Tests pass the pathname explicitly via the
//     optional parameter rather than driving the renderer.
//   - IMPORT_EXPORT block — _validateImportData / _mergeBookmarkStores /
//     _countBookmarks (pure helpers, no DOM).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
// `collapseFullVerseRefs` calls `article.querySelectorAll(".verse[data-vref]")`
// and reads `.getAttribute("data-vref")`. We pass either `null` (early
// return) or a tiny stub article — no full DOM needed for this slice.

function loadVerseSpec() {
  const ctx = {
    Object, Array, Set, String, Math, Number, JSON, console, Error,
    parseInt,
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  return {
    parseVerseSpec: ctx.parseVerseSpec,
    collapseFullVerseRefs: ctx.collapseFullVerseRefs,
    collapseSegmentedVerses: ctx.collapseSegmentedVerses,
    _compareRefs: ctx._compareRefs,
    selectedVersesToSpec: ctx.selectedVersesToSpec,
    mergeVerseSpecs: ctx.mergeVerseSpecs,
  };
}

/**
 * Tiny article stub for `collapseFullVerseRefs`. Each ref string in
 * `verseSpans` becomes one element with a `.getAttribute("data-vref")` that
 * returns the string. `querySelectorAll(".verse[data-vref]")` returns them
 * all, regardless of selector specifics — that selector is the only one
 * the function uses.
 */
function makeStubArticle(verseSpans) {
  const elements = verseSpans.map((ref) => ({
    getAttribute(name) { return name === "data-vref" ? ref : null; },
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
// Provides `loadBookmarks` / `saveBookmarks` stubs and a fake
// `window.renderBookmarkTree` so the post-move hook is observable.

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
  // loadBookmarks/saveBookmarks) to bump the observable counter.
  const prelude = `
    function loadBookmarks() { return _store; }
    function saveBookmarks(s) { _saveCalls.push(JSON.parse(JSON.stringify(s))); _store = s; }
    function _rerenderTree() { _renderCalls.count += 1; }
  `;
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
    saveCalls,
    renderCalls,
    _isDescendant: ctx._isDescendant,
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

test('mergeVerseSpecs: alpha-only union sorts and keeps each part', () => {
  const h = loadVerseSpec();
  assert.equal(h.mergeVerseSpecs("3a", "3b"), "3a,3b");
});

// ── collapseFullVerseRefs ────────────────────────────────────────────────────

test('collapseFullVerseRefs: null article → returns refs unchanged', () => {
  const h = loadVerseSpec();
  const refs = ["3a", "3b"];
  assert.deepEqual(h.collapseFullVerseRefs(refs, null), refs);
});

test('collapseFullVerseRefs: all parts of multi-part verse selected → collapsed to integer', () => {
  const h = loadVerseSpec();
  // Article reports verse 3 has spans "3a" and "3b"; both are selected
  const article = makeStubArticle(["3a", "3b"]);
  assert.deepEqual(h.collapseFullVerseRefs(["3a", "3b"], article), ["3"]);
});

test('collapseFullVerseRefs: only some parts selected → original refs kept', () => {
  const h = loadVerseSpec();
  // Article has 3a and 3b; only 3a selected → no collapse
  const article = makeStubArticle(["3a", "3b"]);
  assert.deepEqual(h.collapseFullVerseRefs(["3a"], article), ["3a"]);
});

test('collapseFullVerseRefs: single-part verse (no alpha) unchanged', () => {
  const h = loadVerseSpec();
  // Article reports "3" with no alpha — `hasAlpha` is false, skip collapse
  const article = makeStubArticle(["3"]);
  assert.deepEqual(h.collapseFullVerseRefs(["3"], article), ["3"]);
});

// ── collapseSegmentedVerses (bookmark-only whole-verse promotion) ─────────────

test('collapseSegmentedVerses: null article → returns refs unchanged', () => {
  const h = loadVerseSpec();
  const refs = ["3a", "3b"];
  assert.deepEqual(h.collapseSegmentedVerses(refs, null), refs);
});

test('collapseSegmentedVerses: partial selection of multi-part verse → promoted to whole verse', () => {
  const h = loadVerseSpec();
  // Article shows verse 23 split into 23a/23b/23c; user selected only 23a + 23c
  const article = makeStubArticle(["23a", "23b", "23c"]);
  assert.deepEqual(h.collapseSegmentedVerses(["23a", "23c"], article), ["23"]);
});

test('collapseSegmentedVerses: single part of multi-part verse → still whole verse', () => {
  const h = loadVerseSpec();
  const article = makeStubArticle(["23a", "23b", "23c"]);
  assert.deepEqual(h.collapseSegmentedVerses(["23b"], article), ["23"]);
});

test('collapseSegmentedVerses: all parts selected → whole verse (parity with full-collapse)', () => {
  const h = loadVerseSpec();
  const article = makeStubArticle(["3a", "3b"]);
  assert.deepEqual(h.collapseSegmentedVerses(["3a", "3b"], article), ["3"]);
});

test('collapseSegmentedVerses: single-part verse (no alpha) unchanged', () => {
  const h = loadVerseSpec();
  const article = makeStubArticle(["5"]);
  assert.deepEqual(h.collapseSegmentedVerses(["5"], article), ["5"]);
});

test('collapseSegmentedVerses: mixes multi-part and single-part verses, dedups, first-seen order', () => {
  const h = loadVerseSpec();
  // 23 is split (a/b/c), 24 is single; select 23a + 23c + 24 → "23" once + "24"
  const article = makeStubArticle(["23a", "23b", "23c", "24"]);
  assert.deepEqual(
    h.collapseSegmentedVerses(["23a", "23c", "24"], article),
    ["23", "24"],
  );
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
  const h = loadDragCore();
  const folder = {
    type: "folder", id: "f1", name: "F1",
    children: [{ type: "bookmark", id: "child-bm" }],
  };
  assert.equal(h._isDescendant(folder, "child-bm"), true);
});

test('_isDescendant: deeply nested descendant detected', () => {
  const h = loadDragCore();
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
  const h = loadDragCore();
  const folder = {
    type: "folder", id: "f1", name: "F1",
    children: [{ type: "bookmark", id: "child-bm" }],
  };
  assert.equal(h._isDescendant(folder, "missing"), false);
});

test('_isDescendant: empty children → false', () => {
  const h = loadDragCore();
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
  const ctx = { Object, Array, Set, String, JSON, console, Error };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("IMPORT_EXPORT", BOOKMARK_MODALS_SOURCE), ctx, { filename: "bookmark-modals.js" });
  return {
    _validateImportData: ctx._validateImportData,
    _mergeBookmarkStores: ctx._mergeBookmarkStores,
    _countBookmarks: ctx._countBookmarks,
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

test("_mergeBookmarkStores: duplicate folder id → entire folder dropped (children too)", () => {
  const h = loadImportExport();
  const existing = [{ type: "folder", id: "fld-1", children: [] }];
  const incoming = [
    {
      type: "folder",
      id: "fld-1",  // duplicate
      children: [{ type: "bookmark", id: "would-be-new" }],
    },
  ];
  const merged = h._mergeBookmarkStores(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "fld-1");
  // Incoming folder's children are NOT merged in — the whole folder is skipped.
  assert.equal(merged[0].children.length, 0);
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
