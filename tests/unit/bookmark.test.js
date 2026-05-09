// ── Unit tests for js/app/bookmark.js ────────────────────────────────────────
// Run with: node --test tests/unit/bookmark.test.js
//
// Same vm + BEGIN/END marker slice approach as search.test.js. bookmark.js
// is partly DOM/pointer-event bound at module top level (drag handle setup,
// swipe state mutations against real DOM rows), so we extract testable
// blocks via four marker pairs and run each in a vm context with the
// minimum stubs that block needs.
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

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOOKMARK_PATH = path.resolve(__dirname, "../../js/app/bookmark.js");
const BOOKMARK_SOURCE = fs.readFileSync(BOOKMARK_PATH, "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = BOOKMARK_SOURCE.indexOf(begin);
  const endIdx = BOOKMARK_SOURCE.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in js/app/bookmark.js`);
  }
  return BOOKMARK_SOURCE.slice(startIdx, endIdx + end.length);
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
  vm.runInContext(extractBlock("VERSE_SPEC"), ctx, { filename: "bookmark-verse-spec.js" });
  return {
    parseVerseSpec: ctx.parseVerseSpec,
    collapseFullVerseRefs: ctx.collapseFullVerseRefs,
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
  vm.runInContext(prelude + extractBlock("BOOKMARK_QUERY"), ctx, { filename: "bookmark-query.js" });
  return {
    ctx,
    setStore: (s) => { storeForLoad = s; },
    _walkBookmarks: ctx._walkBookmarks,
    findExistingChapterBookmarks: ctx.findExistingChapterBookmarks,
    _findItemInStore: ctx._findItemInStore,
    _findParentFolderId: ctx._findParentFolderId,
    removeItemById: ctx.removeItemById,
    insertItem: ctx.insertItem,
    collectFolderOptions: ctx.collectFolderOptions,
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

  const windowStub = {
    renderBookmarkTree() { renderCalls.count += 1; },
  };
  const ctx = {
    Object, Array, Set, String, Number, JSON, console, Error,
    window: windowStub,
  };
  vm.createContext(ctx);
  const prelude = `
    function loadBookmarks() { return _store; }
    function saveBookmarks(s) { _saveCalls.push(JSON.parse(JSON.stringify(s))); _store = s; }
  `;
  ctx._store = currentStore;
  ctx._saveCalls = saveCalls;
  vm.runInContext(
    prelude + extractBlock("BOOKMARK_QUERY") + "\n" + extractBlock("DRAG_CORE"),
    ctx,
    { filename: "bookmark-drag-core.js" },
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
// row.querySelector(".bm-row-actions-mobile") + write actions.style.transform.
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
    setActionsChild(actions) { this._actionsChild = actions; }
    querySelector(selector) {
      if (selector === ".bm-row-actions-mobile") return this._actionsChild;
      return null;
    }
    contains(target) { return this === target || this._descendants.has(target); }
  }
  class ActionsEl extends Element {
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
  vm.runInContext(extractBlock("SWIPED_ROW") + peekHelper, ctx, { filename: "bookmark-swiped-row.js" });

  return {
    ctx,
    Node, Element, ActionsEl,
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
  const actions = new h.ActionsEl();
  row.setActionsChild(actions);
  h._openSwipedRow(row);
  // Now _swipedRow is `row`. close(row) should leave it alone.
  h.closeSwipedRow(row);
  assert.equal(h.peekSwipedRow(), row);
});

test('closeSwipedRow: closes when except differs — strips bm-swiped + clears actions transform', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  const actions = new h.ActionsEl();
  row.setActionsChild(actions);
  h._openSwipedRow(row);
  // Different except (e.g. about to open another row)
  h.closeSwipedRow(new h.Element());
  assert.equal(h.peekSwipedRow(), null);
  assert.equal(row.classList.contains("bm-swiped"), false);
  assert.equal(actions.style.transform, "");
});

// ── _openSwipedRow ───────────────────────────────────────────────────────────

test('_openSwipedRow: marks new row + clears prior swiped row', () => {
  const h = loadSwipedRow();
  const rowA = new h.Element();
  const actionsA = new h.ActionsEl();
  rowA.setActionsChild(actionsA);
  const rowB = new h.Element();
  const actionsB = new h.ActionsEl();
  rowB.setActionsChild(actionsB);

  h._openSwipedRow(rowA);
  assert.equal(h.peekSwipedRow(), rowA);
  assert.ok(rowA.classList.contains("bm-swiped"));

  h._openSwipedRow(rowB);
  // Auto-close of rowA when opening rowB
  assert.equal(h.peekSwipedRow(), rowB);
  assert.equal(rowA.classList.contains("bm-swiped"), false);
  assert.ok(rowB.classList.contains("bm-swiped"));
});

// ── resetSwipedRow ───────────────────────────────────────────────────────────

test('resetSwipedRow: clears _swipedRow without DOM mutation', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  row.setActionsChild(new h.ActionsEl());
  h._openSwipedRow(row);
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
  row.setActionsChild(new h.ActionsEl());
  const inner = new h.Element();
  row.appendChild(inner);
  h._openSwipedRow(row);
  h.closeSwipedRowIfOutside(inner);
  assert.equal(h.peekSwipedRow(), row);
});

test('closeSwipedRowIfOutside: target outside → closeSwipedRow fires', () => {
  const h = loadSwipedRow();
  const row = new h.Element();
  const actions = new h.ActionsEl();
  row.setActionsChild(actions);
  h._openSwipedRow(row);
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
  row.setActionsChild(new h.ActionsEl());
  h._openSwipedRow(row);
  h.closeSwipedRowIfOutside(/** @type {any} */ ({ not: "a node" }));
  assert.equal(h.peekSwipedRow(), null);
});
