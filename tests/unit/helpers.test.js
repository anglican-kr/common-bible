// ── Unit tests for js/app/helpers.js ────────────────────────────────────────
// Run with: node --test tests/unit/helpers.test.js
//
// Loads the full helpers.js IIFE in a vm context with a hand-written DOM
// stub. The stub is deliberately minimal — only the surface helpers.js
// touches (createElement, querySelectorAll on document AND container,
// activeElement, focus(), addEventListener / dispatch). This avoids jsdom
// while still letting us test focus-trap key cycling and inert toggling.
//
// Sections:
//   - _$ (getElementById wrapper)
//   - chUnit (psalm vs everything else)
//   - el (createElement + attrs + children)
//   - clearNode (firstChild loop)
//   - hangingQuoteClass (leading quote → gutter class, straight + curly)
//   - setInert (inert + aria-hidden toggle on selector matches)
//   - trapFocus (Tab / Shift-Tab cycling within a container)
//   - dragReleaseAction (bottom-sheet drag-resize release thresholds)
//   - headerIcon · HEADER_ICON_PATHS (page-title icon SVG — one spec and one path per glyph for every header control)
//   - isModifiedClick (modifier / non-primary clicks the page leaves to the browser)
//   - createFocusMemory (focus back to the pressed control after a view redraws itself)

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.resolve(__dirname, "../../js/app/helpers.js");
// Strip the trailing `export {};` ESM marker so vm.runInContext (classic
// script) accepts it.
const SOURCE = fs.readFileSync(SOURCE_PATH, "utf8")
  .replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");

// ── DOM stub ────────────────────────────────────────────────────────────────

/**
 * Build a fresh in-memory DOM stub. Tracks every element created so that
 * `document.getElementById` and `document.querySelectorAll` can resolve
 * against the registry without us walking a tree. `activeElement` is
 * mutable via `el.focus()` so the focus-trap tests can simulate browser
 * focus state.
 */
function makeDom() {
  /** @type {Array<any>} */
  const registry = [];
  let activeElement = null;
  // Page scroll for createFocusMemory: an element's `_docTop` is its document
  // offset, so its viewport top is `_docTop - view.scrollY`. scrollTo and
  // scrollIntoView clamp to [0, view.maxScroll] like a real page and record the
  // requested y and behavior (the restore must scroll instantly).
  const view = { scrollY: 0, innerHeight: 800, maxScroll: 100000, scrolls: /** @type {Array<{ y: number, behavior: string }>} */ ([]) };
  const scrollPage = (y, behavior) => {
    view.scrolls.push({ y, behavior });
    view.scrollY = Math.max(0, Math.min(view.maxScroll, y));
  };

  function makeElement(tag) {
    const listeners = new Map(); // type -> Set<fn>
    const el = {
      tagName: String(tag).toUpperCase(),
      _attrs: /** @type {Record<string,string>} */ ({}),
      _children: /** @type {Array<any>} */ ([]),
      _parent: /** @type {any} */ (null),
      _classNameStr: "",
      _textContentStr: "",
      _inert: false,
      _disabled: false,
      get className() { return this._classNameStr; },
      set className(v) { this._classNameStr = String(v); },
      get textContent() {
        return this._children
          .map((c) => typeof c === "string" ? c : (c?.nodeType === 3 ? c.data : c?.textContent ?? ""))
          .join("") || this._textContentStr;
      },
      set textContent(v) {
        this._textContentStr = String(v);
        this._children = [];
      },
      get firstChild() { return this._children[0] || null; },
      get inert() { return this._inert; },
      set inert(v) { this._inert = !!v; },
      get disabled() { return this._disabled; },
      set disabled(v) { this._disabled = !!v; },
      appendChild(child) {
        this._children.push(child);
        if (child && typeof child === "object") child._parent = this;
        return child;
      },
      removeChild(child) {
        const i = this._children.indexOf(child);
        if (i >= 0) this._children.splice(i, 1);
        if (child && typeof child === "object") child._parent = null;
        return child;
      },
      setAttribute(k, v) {
        const s = String(v);
        this._attrs[k] = s;
        // Mirror to the property mode for the few attrs the spec exposes
        // both ways. Helpers test only relies on tabindex via attribute.
      },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
      removeAttribute(k) { delete this._attrs[k]; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      _listeners: listeners,
      /** Test-only: dispatch a fake event-like object to the registered listeners. */
      _dispatch(type, evt) {
        const set = listeners.get(type);
        if (!set) return;
        for (const fn of [...set]) fn(evt);
      },
      focus(opts) { activeElement = this; this._focusOpts = opts; },
      querySelectorAll(selector) {
        return findAll(this, selector);
      },
      closest(selector) {
        for (let n = this; n; n = n._parent) if (n.tagName && matches(n, selector)) return n;
        return null;
      },
      contains(node) {
        for (let n = node; n; n = n._parent) if (n === this) return true;
        return false;
      },
      /** block: "center" only — the restore's off-screen fallback. */
      scrollIntoView(opts) {
        scrollPage(view.scrollY + this.getBoundingClientRect().top - (view.innerHeight - this._height) / 2, opts && opts.behavior);
      },
      /** data-* attributes → camelCase keys, read-only (enough for `dataset.focusKey`). */
      get dataset() {
        const ds = {};
        for (const [k, v] of Object.entries(this._attrs)) {
          if (k.startsWith("data-")) ds[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
        }
        return ds;
      },
      _docTop: 0,
      _height: 20,
      getBoundingClientRect() {
        const top = this._docTop - view.scrollY;
        return { top, bottom: top + this._height, height: this._height };
      },
    };
    registry.push(el);
    return el;
  }

  function makeText(data) {
    return { nodeType: 3, data: String(data), parentNode: null };
  }

  // Selector matcher tailored to helpers.js needs:
  //   - 'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  //     '[tabindex]:not([tabindex="-1"])'
  //   - tag-only: 'span', 'main'
  //   - class:  '.foo'
  //   - attr:   '[name="x"]', '[hidden]'
  //   - combos: 'tag.class', 'tag[attr]', 'tag:not(...)', '[a]:not([b])'
  function matches(el, sel) {
    sel = sel.trim();
    // commas: split into alternatives
    if (sel.includes(",")) {
      return sel.split(",").some((p) => matches(el, p));
    }
    // :not(...)
    const notIdx = sel.indexOf(":not(");
    if (notIdx >= 0) {
      const head = sel.slice(0, notIdx);
      const innerEnd = sel.lastIndexOf(")");
      const inner = sel.slice(notIdx + 5, innerEnd);
      const tail = sel.slice(innerEnd + 1).trim();
      if (head && !matches(el, head)) return false;
      if (matches(el, inner)) return false;
      if (tail) return matches(el, tail);
      return true;
    }
    // attribute pattern at end
    const attrMatch = sel.match(/^(.*?)(\[[^\]]+\])$/);
    if (attrMatch && attrMatch[1] !== sel) {
      const [, head, attr] = attrMatch;
      if (head && !matches(el, head)) return false;
      const m = attr.match(/^\[(\w[\w-]*)(?:=(.*))?\]$/);
      if (!m) return false;
      const [, k, vRaw] = m;
      if (vRaw === undefined) return Object.prototype.hasOwnProperty.call(el._attrs, k);
      const want = vRaw.replace(/^"|"$/g, "");
      return el._attrs[k] === want;
    }
    // .class
    if (sel.startsWith(".")) {
      return el._classNameStr.split(/\s+/).includes(sel.slice(1));
    }
    // #id
    if (sel.startsWith("#")) {
      return el._attrs.id === sel.slice(1);
    }
    // tag.class
    const tagClass = sel.match(/^([a-z]+)\.(\S+)$/i);
    if (tagClass) {
      return el.tagName === tagClass[1].toUpperCase()
        && el._classNameStr.split(/\s+/).includes(tagClass[2]);
    }
    // bare tag
    if (/^[a-z]+$/i.test(sel)) {
      return el.tagName === sel.toUpperCase();
    }
    return false;
  }

  // Walk the descendants of `root` (or registry if root is document)
  function findAll(root, selector) {
    const parts = selector.split(",").map((p) => p.trim());
    /** @type {Array<any>} */
    const out = [];
    function visit(node) {
      if (!node || !node._children) return;
      for (const child of node._children) {
        if (child && child.tagName) {
          if (parts.some((p) => matches(child, p))) out.push(child);
          visit(child);
        }
      }
    }
    visit(root);
    return out;
  }

  const document = {
    createElement: (tag) => makeElement(tag),
    // headerIcon builds SVG — keep the namespace so the test can check it
    createElementNS: (ns, tag) => Object.assign(makeElement(tag), { namespaceURI: ns }),
    createTextNode: (d) => makeText(d),
    getElementById: (id) => registry.find((e) => e._attrs.id === id) || null,
    querySelectorAll: (selector) => {
      const parts = selector.split(",").map((p) => p.trim());
      const out = registry.filter((el) => parts.some((p) => matches(el, p)));
      // forEach is already inherited from Array, but keep an explicit
      // reference so the call shape mirrors NodeList.
      return out;
    },
    get activeElement() { return activeElement; },
    // Identity only — restore treats focus on <body> / <html> as "lost with the old screen".
    body: {},
    documentElement: {},
  };

  return {
    document,
    view,
    scrollPage,
    /** Test-only hook to seed activeElement directly. */
    setActive(el) { activeElement = el; },
    /** Test-only hook to read activeElement without going through getter. */
    getActive() { return activeElement; },
    _registry: registry,
  };
}

// ── Loader ──────────────────────────────────────────────────────────────────

// `instanceof Element` / `HTMLElement` inside helpers.js — stub nodes pass by shape (they carry a tagName).
function shapeClass() {
  const C = function () {};
  Object.defineProperty(C, Symbol.hasInstance, { value: (o) => !!o && typeof o.tagName === "string" });
  return C;
}

/**
 * @param {{ anchoring?: boolean }} [opts]  anchoring: the page has CSS scroll anchoring
 *   (`CSS.supports("overflow-anchor", "auto")` — read once when helpers.js loads)
 */
function loadHelpers(opts = {}) {
  const dom = makeDom();
  const { view } = dom;
  const ctx = {
    console, JSON, Object, Array, Set, Map, Error, String, Number, Boolean, Math,
    document: dom.document,
    Element: shapeClass(),
    HTMLElement: shapeClass(),
    get scrollY() { return view.scrollY; },
    get innerHeight() { return view.innerHeight; },
    scrollTo(a, b) {
      const o = typeof a === "object" && a ? a : { top: b, behavior: undefined };
      dom.scrollPage(o.top, o.behavior);
    },
  };
  if (opts.anchoring) ctx.CSS = { supports: (prop, value) => prop === "overflow-anchor" && value === "auto" };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(SOURCE, ctx, { filename: "helpers.js" });
  return {
    helpers: ctx.appHelpers,
    dom,
    ctx,
  };
}

// ── _$ ──────────────────────────────────────────────────────────────────────

test("_$: returns the element with the given id", () => {
  const h = loadHelpers();
  const target = h.helpers.el("button", { id: "go" });
  // `el()` doesn't attach to the document, but it still registers the node;
  // _$ uses getElementById which scans the registry.
  assert.equal(h.helpers._$("go"), target);
});

test("_$: returns null when no element matches", () => {
  const h = loadHelpers();
  assert.equal(h.helpers._$("missing"), null);
});

// ── chUnit ──────────────────────────────────────────────────────────────────

test("chUnit: 'ps' returns '편'", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.chUnit("ps"), "편");
});

test("chUnit: any other book id returns '장'", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.chUnit("gen"), "장");
  assert.equal(h.helpers.chUnit("rev"), "장");
  assert.equal(h.helpers.chUnit(""), "장");
  assert.equal(h.helpers.chUnit("PS"), "장");  // case-sensitive
});

// ── el ──────────────────────────────────────────────────────────────────────

test("el: creates an element with the given tag", () => {
  const h = loadHelpers();
  const node = h.helpers.el("div");
  assert.equal(node.tagName, "DIV");
});

test("el: applies className via attrs.className", () => {
  const h = loadHelpers();
  const node = h.helpers.el("button", { className: "primary big" });
  assert.equal(node.className, "primary big");
});

test("el: applies textContent via attrs.textContent", () => {
  const h = loadHelpers();
  const node = h.helpers.el("span", { textContent: "안녕" });
  assert.equal(node.textContent, "안녕");
});

test("el: applies other attrs via setAttribute", () => {
  const h = loadHelpers();
  const node = h.helpers.el("a", { href: "/gen/1", id: "x", "aria-label": "구약" });
  assert.equal(node.getAttribute("href"), "/gen/1");
  assert.equal(node.getAttribute("id"), "x");
  assert.equal(node.getAttribute("aria-label"), "구약");
});

test("el: appends string children as text nodes", () => {
  const h = loadHelpers();
  const node = h.helpers.el("p", null, "사랑은 ", "오래 참고");
  // Two text node children
  assert.equal(node._children.length, 2);
  assert.equal(node._children[0].nodeType, 3);
  assert.equal(node._children[0].data, "사랑은 ");
  assert.equal(node._children[1].data, "오래 참고");
});

test("el: appends Node children directly", () => {
  const h = loadHelpers();
  const inner = h.helpers.el("strong", null, "사랑");
  const outer = h.helpers.el("p", null, "은 ", inner, " 오래 참고");
  assert.equal(outer._children.length, 3);
  assert.equal(outer._children[1], inner);
});

test("el: skips null/undefined children", () => {
  const h = loadHelpers();
  const node = h.helpers.el("div", null, "a", null, undefined, "b");
  assert.equal(node._children.length, 2);
  assert.equal(node._children[0].data, "a");
  assert.equal(node._children[1].data, "b");
});

test("el: handles null/undefined attrs (no throw, no attrs set)", () => {
  const h = loadHelpers();
  const a = h.helpers.el("div", null);
  const b = h.helpers.el("div", undefined);
  assert.deepEqual(a._attrs, {});
  assert.deepEqual(b._attrs, {});
});

test("el: numeric / boolean attribute values are coerced via setAttribute (string)", () => {
  const h = loadHelpers();
  const node = h.helpers.el("textarea", { rows: 4, readOnly: true });
  assert.equal(node.getAttribute("rows"), "4");
  assert.equal(node.getAttribute("readOnly"), "true");
});

// ── clearNode ──────────────────────────────────────────────────────────────

test("clearNode: removes all children", () => {
  const h = loadHelpers();
  const node = h.helpers.el("ul", null,
    h.helpers.el("li"), h.helpers.el("li"), h.helpers.el("li"));
  assert.equal(node._children.length, 3);
  h.helpers.clearNode(node);
  assert.equal(node._children.length, 0);
  assert.equal(node.firstChild, null);
});

test("clearNode: empty node is a no-op", () => {
  const h = loadHelpers();
  const node = h.helpers.el("div");
  assert.doesNotThrow(() => h.helpers.clearNode(node));
  assert.equal(node._children.length, 0);
});

test("clearNode: only removes direct children (not deeper)", () => {
  const h = loadHelpers();
  const grandchild = h.helpers.el("span", null, "deep");
  const child = h.helpers.el("p", null, grandchild);
  const root = h.helpers.el("div", null, child);
  h.helpers.clearNode(root);
  assert.equal(root._children.length, 0);
  // The grandchild is still attached to its (now-detached) parent
  assert.equal(child._children.length, 1);
  assert.equal(child._children[0], grandchild);
});

// ── hangingQuoteClass ───────────────────────────────────────────────────────

test("hangingQuoteClass: straight double quote hangs with the wide offset", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.hangingQuoteClass('"'), "hanging-quote");
});

test("hangingQuoteClass: curly double quotes hang with their own offset", () => {
  const h = loadHelpers();
  // Liturgical psalter text is typeset with “ ” (ADR-039). A poetry line may
  // open with either, and both are wider than the straight form (0.444em vs
  // 0.389em), so they carry the --curly offset.
  assert.equal(h.helpers.hangingQuoteClass("“"), "hanging-quote hanging-quote--curly");
  assert.equal(h.helpers.hangingQuoteClass("”"), "hanging-quote hanging-quote--curly");
});

test("hangingQuoteClass: straight single quote gets the narrow offset", () => {
  const h = loadHelpers();
  assert.equal(
    h.helpers.hangingQuoteClass("'"),
    "hanging-quote hanging-quote--single",
  );
});

test("hangingQuoteClass: curly single quotes get the narrow offset", () => {
  const h = loadHelpers();
  assert.equal(
    h.helpers.hangingQuoteClass("‘"),
    "hanging-quote hanging-quote--single",
  );
  assert.equal(
    h.helpers.hangingQuoteClass("’"),
    "hanging-quote hanging-quote--single",
  );
});

test("hangingQuoteClass: non-quote characters do not hang", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.hangingQuoteClass("주"), "");
  assert.equal(h.helpers.hangingQuoteClass("("), "");
  assert.equal(h.helpers.hangingQuoteClass("¶"), "");
});

test("hangingQuoteClass: empty line and undefined do not hang", () => {
  const h = loadHelpers();
  // `line[0]` is undefined on an empty line — must not throw or hang.
  assert.equal(h.helpers.hangingQuoteClass(undefined), "");
  assert.equal(h.helpers.hangingQuoteClass(""), "");
});

// ── setInert ───────────────────────────────────────────────────────────────

test("setInert: on=true sets .inert and aria-hidden on every match", () => {
  const h = loadHelpers();
  const a = h.helpers.el("main", { id: "m" });
  const b = h.helpers.el("aside");
  const c = h.helpers.el("nav");
  // Wire them under a notional document root so querySelectorAll can find them
  // — our registry-based document.querySelectorAll works without a tree.
  h.helpers.setInert(true, "main, aside, nav");
  for (const n of [a, b, c]) {
    assert.equal(n.inert, true);
    assert.equal(n.getAttribute("aria-hidden"), "true");
  }
});

test("setInert: on=false clears .inert and removes aria-hidden", () => {
  const h = loadHelpers();
  const a = h.helpers.el("main");
  a.inert = true;
  a.setAttribute("aria-hidden", "true");
  h.helpers.setInert(false, "main");
  assert.equal(a.inert, false);
  assert.equal(a.getAttribute("aria-hidden"), null);
});

test("setInert: no-op when no elements match", () => {
  const h = loadHelpers();
  assert.doesNotThrow(() => h.helpers.setInert(true, "section.does-not-exist"));
});

test("setInert: comma selector hits multiple element types", () => {
  const h = loadHelpers();
  const m = h.helpers.el("main");
  const x = h.helpers.el("aside");
  const y = h.helpers.el("nav");  // also matched
  h.helpers.setInert(true, "main, aside");
  assert.equal(m.inert, true);
  assert.equal(x.inert, true);
  assert.equal(y.inert, false, "nav not in selector list");
});

// ── trapFocus ───────────────────────────────────────────────────────────────

function makeKeyEvent(key, opts = {}) {
  return {
    key,
    shiftKey: !!opts.shiftKey,
    _prevented: false,
    preventDefault() { this._prevented = true; },
  };
}

function buildFocusableContainer(helpers) {
  // Three focusable elements inside a container. Selector match relies on
  // 'a[href]', 'button:not([disabled])', 'input:not([disabled])'.
  const link = helpers.el("a", { href: "/x" });
  const btn = helpers.el("button");
  const inp = helpers.el("input");
  const container = helpers.el("div", null, link, btn, inp);
  return { container, link, btn, inp };
}

test("trapFocus: returns a cleanup function", () => {
  const h = loadHelpers();
  const { container } = buildFocusableContainer(h.helpers);
  const cleanup = h.helpers.trapFocus(container);
  assert.equal(typeof cleanup, "function");
});

test("trapFocus: non-Tab keys do not preventDefault and do not move focus", () => {
  const h = loadHelpers();
  const { container, link } = buildFocusableContainer(h.helpers);
  link.focus();
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Enter");
  container._dispatch("keydown", e);
  assert.equal(e._prevented, false);
  assert.equal(h.dom.getActive(), link, "focus unchanged");
});

test("trapFocus: empty container (no focusables) is a silent no-op on Tab", () => {
  const h = loadHelpers();
  const container = h.helpers.el("div");  // no children
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Tab");
  assert.doesNotThrow(() => container._dispatch("keydown", e));
  assert.equal(e._prevented, false);
});

test("trapFocus: Tab from the last focusable wraps to the first", () => {
  const h = loadHelpers();
  const { container, link, inp } = buildFocusableContainer(h.helpers);
  inp.focus();  // last focusable
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Tab");
  container._dispatch("keydown", e);
  assert.equal(e._prevented, true);
  assert.equal(h.dom.getActive(), link, "focus wrapped to first");
});

test("trapFocus: Shift+Tab from the first focusable wraps to the last", () => {
  const h = loadHelpers();
  const { container, link, inp } = buildFocusableContainer(h.helpers);
  link.focus();  // first focusable
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Tab", { shiftKey: true });
  container._dispatch("keydown", e);
  assert.equal(e._prevented, true);
  assert.equal(h.dom.getActive(), inp, "focus wrapped to last");
});

test("trapFocus: Shift+Tab from the container itself wraps to the last", () => {
  const h = loadHelpers();
  const { container, inp } = buildFocusableContainer(h.helpers);
  // activeElement === container — happens right after a modal opens and
  // focus hasn't been moved into a child yet.
  h.dom.setActive(container);
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Tab", { shiftKey: true });
  container._dispatch("keydown", e);
  assert.equal(e._prevented, true);
  assert.equal(h.dom.getActive(), inp);
});

test("trapFocus: Tab between focusables does not preventDefault (browser default)", () => {
  const h = loadHelpers();
  const { container, btn } = buildFocusableContainer(h.helpers);
  btn.focus();  // middle focusable, neither first nor last
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Tab");
  container._dispatch("keydown", e);
  assert.equal(e._prevented, false);
  assert.equal(h.dom.getActive(), btn, "focus unchanged — browser handles default");
});

test("trapFocus: cleanup function removes the listener", () => {
  const h = loadHelpers();
  const { container, link, inp } = buildFocusableContainer(h.helpers);
  inp.focus();
  const cleanup = h.helpers.trapFocus(container);
  cleanup();
  // After cleanup, dispatching Tab should NOT trigger the wrap.
  const e = makeKeyEvent("Tab");
  container._dispatch("keydown", e);
  assert.equal(e._prevented, false);
  assert.equal(h.dom.getActive(), inp, "focus unchanged after cleanup");
});

test("trapFocus: ignores disabled inputs / buttons", () => {
  const h = loadHelpers();
  const link = h.helpers.el("a", { href: "/x" });
  const btn = h.helpers.el("button");
  btn.disabled = true;  // excluded by 'button:not([disabled])'... but our
                         // matcher checks the [disabled] attribute, not the property
  const inp = h.helpers.el("input");
  const container = h.helpers.el("div", null, link, btn, inp);

  // helpers.js' selector is 'button:not([disabled])'. Our matcher reads
  // the [disabled] attribute, so we set it explicitly to mirror the real
  // browser semantics for this test.
  btn.setAttribute("disabled", "");

  inp.focus();
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Tab");
  container._dispatch("keydown", e);
  // Last focusable was inp; first should be the link, btn skipped.
  assert.equal(e._prevented, true);
  assert.equal(h.dom.getActive(), link);
});

test("trapFocus: ignores tabindex=-1 elements", () => {
  const h = loadHelpers();
  const link = h.helpers.el("a", { href: "/x" });
  const skip = h.helpers.el("span", { tabindex: "-1" });
  const inp = h.helpers.el("input");
  const container = h.helpers.el("div", null, link, skip, inp);
  inp.focus();
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Tab");
  container._dispatch("keydown", e);
  assert.equal(e._prevented, true);
  // [tabindex]:not([tabindex="-1"]) excludes tabindex=-1, so first is the link
  assert.equal(h.dom.getActive(), link);
});

test("trapFocus: includes elements with explicit tabindex (not -1)", () => {
  const h = loadHelpers();
  const div = h.helpers.el("div", { tabindex: "0" });
  const btn = h.helpers.el("button");
  const container = h.helpers.el("section", null, div, btn);
  btn.focus();  // last focusable
  h.helpers.trapFocus(container);
  const e = makeKeyEvent("Tab");
  container._dispatch("keydown", e);
  // div has tabindex=0 — first focusable; btn was last → wraps to div
  assert.equal(e._prevented, true);
  assert.equal(h.dom.getActive(), div);
});

// ── dragReleaseAction ───────────────────────────────────────────────────────
// Three-tier release semantics for any drag-resizable bottom sheet.
// Regression guard: Cursor Bugbot caught that an earlier cite-sheet draft
// clamped the move handler at 30vh while checking close at <20vh, making
// snap-close unreachable. Pinning this as a pure helper means the same
// bug class can't reappear in search-sheet, bookmark-drawer, or any future
// sheet that reuses this decision.

test("dragReleaseAction: well below 20vh → close", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.dragReleaseAction(50, 1000), "close"); // 5vh
});

test("dragReleaseAction: just below 20vh → close", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.dragReleaseAction(199, 1000), "close");
});

test("dragReleaseAction: exactly at 20vh → snap-min (close is strict <)", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.dragReleaseAction(200, 1000), "snap-min");
});

test("dragReleaseAction: between 20vh and 30vh → snap-min", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.dragReleaseAction(250, 1000), "snap-min");
});

test("dragReleaseAction: just below 30vh → snap-min", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.dragReleaseAction(299, 1000), "snap-min");
});

test("dragReleaseAction: exactly at 30vh → stay (snap-min is strict <)", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.dragReleaseAction(300, 1000), "stay");
});

test("dragReleaseAction: well above 30vh → stay", () => {
  const h = loadHelpers();
  assert.equal(h.helpers.dragReleaseAction(700, 1000), "stay");
});

test("dragReleaseAction: thresholds scale with viewport height", () => {
  const h = loadHelpers();
  // 100px in an 800px viewport is 12.5vh → close
  assert.equal(h.helpers.dragReleaseAction(100, 800), "close");
  // 200px in 800px is 25vh → snap-min
  assert.equal(h.helpers.dragReleaseAction(200, 800), "snap-min");
  // 400px in 800px is 50vh → stay
  assert.equal(h.helpers.dragReleaseAction(400, 800), "stay");
});

// ── emptyState (shared empty-state builder, ADR-032) ─────────────────────────

test("emptyState: builds icon slot + title + subtitle structure", () => {
  const h = loadHelpers();
  const icon = h.helpers.el("svg");
  const node = h.helpers.emptyState({ icon, title: "없음", subtitle: "안내" });
  assert.equal(node.tagName, "DIV");
  assert.equal(node.className, "empty-state");
  assert.equal(node._children.length, 3);
  const [iconWrap, title, subtitle] = node._children;
  assert.equal(iconWrap.className, "empty-state-icon");
  assert.equal(iconWrap.getAttribute("aria-hidden"), "true");
  assert.equal(iconWrap._children[0], icon); // the passed-in glyph node
  assert.equal(title.className, "empty-state-title");
  assert.equal(title.textContent, "없음");
  assert.equal(subtitle.className, "empty-state-subtitle");
  assert.equal(subtitle.textContent, "안내");
});

test("emptyState: tag + role mount it as a presentational <li>", () => {
  const h = loadHelpers();
  const node = h.helpers.emptyState({ icon: null, title: "t", subtitle: "s", tag: "li", role: "presentation" });
  assert.equal(node.tagName, "LI");
  assert.equal(node.getAttribute("role"), "presentation");
});

test("emptyState: null icon leaves an empty icon slot (no crash)", () => {
  const h = loadHelpers();
  const node = h.helpers.emptyState({ icon: null, title: "t", subtitle: "s" });
  assert.equal(node._children[0].className, "empty-state-icon");
  assert.equal(node._children[0]._children.length, 0);
});

// ── headerIcon · HEADER_ICON_PATHS (page-title icon glyph — one spec, one path per glyph) ──

test("headerIcon: a 24×24 stroked SVG with the given path — the header icon spec the home button and the lectionary up link share", () => {
  const h = loadHelpers();
  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = h.helpers.headerIcon("M15.5 5 8.5 12l7 7");
  assert.equal(svg.tagName, "SVG");
  assert.equal(svg.namespaceURI, SVG_NS);
  // No width / height — the .title-back-icon rem rule in style.css sizes it
  assert.deepEqual({ ...svg._attrs }, { viewBox: "0 0 24 24", "aria-hidden": "true", class: "title-back-icon" });
  assert.equal(svg._children.length, 1);
  const path = svg._children[0];
  assert.equal(path.tagName, "PATH");
  assert.equal(path.namespaceURI, SVG_NS);
  assert.deepEqual({ ...path._attrs }, {
    d: "M15.5 5 8.5 12l7 7",
    stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", fill: "none",
  });
});

test("HEADER_ICON_PATHS: one frozen path per glyph — every control drawing the chevron or the house passes the same entry", () => {
  const h = loadHelpers();
  const P = h.helpers.HEADER_ICON_PATHS;
  // back: the lectionary's up link and the cite sheet's back button (index.html used to hold a static copy)
  assert.deepEqual({ ...P }, {
    back: "M15.5 5 8.5 12l7 7",
    home: "M3 11.5 12 4l9 7.5M5.5 9.8V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.8",
  });
  assert.ok(Object.isFrozen(P));
  assert.equal(h.helpers.headerIcon(P.back)._children[0].getAttribute("d"), P.back);
});

test("headerIcon: only the path differs between icons, and every call builds a fresh node", () => {
  const h = loadHelpers();
  const HOME = "M3 11.5 12 4l9 7.5M5.5 9.8V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.8";
  const a = h.helpers.headerIcon(HOME);
  const b = h.helpers.headerIcon(HOME);
  assert.notEqual(a, b);
  assert.notEqual(a._children[0], b._children[0]);
  assert.equal(a._children[0].getAttribute("d"), HOME);
  const back = h.helpers.headerIcon("M15.5 5 8.5 12l7 7");
  assert.deepEqual({ ...a._attrs }, { ...back._attrs });
  const { d: _d1, ...homeStroke } = a._children[0]._attrs;
  const { d: _d2, ...backStroke } = back._children[0]._attrs;
  assert.deepEqual(homeStroke, backStroke);
});

// ── isModifiedClick (new-tab clicks the page must not act on, PR #348) ───────

test("isModifiedClick: a plain primary click is handled in the page", () => {
  const h = loadHelpers();
  const plain = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, button: 0 };
  assert.equal(h.helpers.isModifiedClick(plain), false);
});

test("isModifiedClick: any modifier key or a non-primary button belongs to the browser (new tab / window)", () => {
  const h = loadHelpers();
  const base = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, button: 0 };
  for (const key of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    assert.equal(h.helpers.isModifiedClick({ ...base, [key]: true }), true, key);
  }
  assert.equal(h.helpers.isModifiedClick({ ...base, button: 1 }), true, "middle button");
});

// ── createFocusMemory (focus back to the pressed control after a redraw, PR #348 review) ──

const CLICK = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, button: 0 };

/**
 * A view root at document offset `rootTop` holding links tagged with data-focus-key,
 * each `[key, offsetWithinRoot]`. Returns the root and the links by key.
 */
function viewWith(helpers, rootTop, links) {
  const root = helpers.el("div", { className: "view" });
  root._docTop = rootTop;
  const byKey = {};
  for (const [key, offset] of links) {
    const a = helpers.el("a", { href: "/x", "data-focus-key": key }, helpers.el("span", null, key));
    a._docTop = rootTop + offset;
    root.appendChild(a);
    byKey[key] = a;
  }
  return { root, byKey };
}

test("createFocusMemory: remember 는 누른 링크의 자리(키 · 스크롤 · 화면 루트 안 위치)를 남기고, take 는 한 번만 꺼낸다", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  const { root, byKey } = viewWith(h.helpers, 100, [["next", 60]]);
  h.dom.view.scrollY = 50;
  // 링크 안의 글자를 눌러도 그 링크의 키
  mem.remember({ ...CLICK, target: byKey.next._children[0], currentTarget: root });
  assert.deepEqual({ ...mem.take() }, { key: "next", y: 50, top: 110, offset: 60, pointer: false });
  assert.equal(mem.take(), null, "렌더 하나에 한 번");
});

test("createFocusMemory: 새 탭으로 여는 클릭(수정 키 · 가운데 단추)은 기억하지 않고, 키 없는 곳을 누르면 앞서 남긴 자리를 지운다", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  const { root, byKey } = viewWith(h.helpers, 0, [["prev", 10], ["next", 10]]);
  mem.remember({ ...CLICK, metaKey: true, target: byKey.next, currentTarget: root });
  mem.remember({ ...CLICK, button: 1, target: byKey.next, currentTarget: root });
  assert.equal(mem.take(), null, "새 탭 클릭만 있었다");
  mem.remember({ ...CLICK, target: byKey.prev, currentTarget: root });
  mem.remember({ ...CLICK, ctrlKey: true, target: byKey.next, currentTarget: root });   // 이 화면은 그대로 — 앞의 자리가 남는다
  assert.equal(mem.take().key, "prev");
  mem.remember({ ...CLICK, target: byKey.prev, currentTarget: root });
  mem.remember({ ...CLICK, target: root, currentTarget: root });   // 키 없는 곳 — 이 화면을 다시 그리지 않는 클릭
  assert.equal(mem.take(), null);
});

test("createFocusMemory: 이미 취소된 클릭(defaultPrevented — 라우터가 이동하지 않는다)은 기억하지 않는다", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  const { root, byKey } = viewWith(h.helpers, 0, [["next", 10]]);
  mem.remember({ ...CLICK, defaultPrevented: true, target: byKey.next, currentTarget: root });
  assert.equal(mem.take(), null, "다음 렌더(뒤로 가기 · 탭 전환)가 엉뚱한 자리를 꺼내지 않게");
});

test("createFocusMemory: 자리는 그것을 남긴 클릭이 아직 퍼지는 동안에만 꺼낸다 — 루트 위에서 취소돼 다시 그리지 못한 클릭의 자리가 나중 렌더(뒤로 가기 · 탭 전환)로 새지 않게", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  const { root, byKey } = viewWith(h.helpers, 0, [["next", 10]]);
  // 버블링 중(3) — document 의 전역 <a> 인터셉터가 route() 를 부르고 뷰가 take 하는 바로 그 디스패치 안
  const click = { ...CLICK, eventPhase: 3, target: byKey.next, currentTarget: root };
  mem.remember(click);
  assert.equal(mem.take().key, "next");
  mem.remember(click);
  click.eventPhase = 0;   // 디스패치가 끝났다 — 루트 위의 처리기가 취소해 라우터가 움직이지 않았다
  assert.equal(mem.take(), null);
});

test("createFocusMemory: 마우스 · 탭으로 누른 복원은 링 없이(focusVisible: false — iOS 는 탭 뒤 스크립트 포커스에 링을 그린다), Enter 는 링을 남긴다", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  const { root, byKey } = viewWith(h.helpers, 0, [["next", 10]]);
  mem.remember({ ...CLICK, detail: 1, target: byKey.next, currentTarget: root });   // 탭 · 마우스 — 누른 횟수
  mem.restore(root, mem.take(), "today");
  assert.deepEqual({ ...byKey.next._focusOpts }, { preventScroll: true, focusVisible: false });
  mem.remember({ ...CLICK, detail: 0, target: byKey.next, currentTarget: root });   // Enter — 키보드가 만든 클릭
  mem.restore(root, mem.take(), "today");
  assert.deepEqual({ ...byKey.next._focusOpts }, { preventScroll: true });
});

test("createFocusMemory: 기억은 만든 화면마다 따로다 — 한 화면이 남긴 자리를 다른 화면이 꺼내지 않는다", () => {
  const h = loadHelpers();
  const calendar = h.helpers.createFocusMemory();
  const lectionary = h.helpers.createFocusMemory();
  const { root, byKey } = viewWith(h.helpers, 0, [["next", 10]]);
  lectionary.remember({ ...CLICK, target: byKey.next, currentTarget: root });
  assert.equal(calendar.take(), null);
  assert.equal(lectionary.take().key, "next");
});

test("createFocusMemory: restore 는 새 루트에서 같은 키를 값으로 찾는다 — 콜론 · 한글이 든 관측일 id 도, 없으면 대체 키, 그것도 없으면 null", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  const keys = ["prev", "today", "obs:grid:lent-2-weekday-tue", "obs:d0916-니니안"];
  const { root, byKey } = viewWith(h.helpers, 0, keys.map((k, i) => [k, 40 * i]));
  assert.equal(mem.restore(root, { key: "obs:d0916-니니안", y: 0, offset: 120 }, "today"), byKey["obs:d0916-니니안"]);
  assert.equal(h.dom.getActive(), byKey["obs:d0916-니니안"]);
  assert.deepEqual({ ...byKey["obs:d0916-니니안"]._focusOpts }, { preventScroll: true });   // 스크롤은 restore 가 정한다
  assert.equal(mem.restore(root, { key: "obs:grid:lent-2-weekday-tue", y: 0, offset: 80 }), byKey["obs:grid:lent-2-weekday-tue"]);
  // 계산 범위 끝 — 누른 「다음」이 새 화면에 없으면 「오늘」
  assert.equal(mem.restore(root, { key: "next", y: 0, offset: 0 }, "today"), byKey.today);
  h.dom.setActive(null);
  assert.equal(mem.restore(root, { key: "next", y: 0, offset: 0 }), null);
  assert.equal(mem.restore(root, null, "today"), null);
  assert.equal(h.dom.getActive(), null, "찾지 못하면 포커스를 옮기지 않는다");
});

test("createFocusMemory: restore 는 누른 때의 화면 위치로 — 스켈레톤이 스크롤을 맨 위로 눌렀어도 같은 컨트롤이 같은 자리에, 스크롤은 즉시", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  // 누른 때: 스크롤 218, 루트 문서 위치 100, 컨트롤은 루트 안 300 — 화면 위치 182
  const spot = { key: "set:2", y: 218, top: 182, offset: 300 };
  h.dom.view.scrollY = 0;   // 새 장을 받는 사이 스켈레톤이 그려져 맨 위로
  const { root, byKey } = viewWith(h.helpers, 100, [["set:1", 300], ["set:2", 300]]);
  mem.restore(root, spot, "today");
  assert.equal(h.dom.view.scrollY, 218);
  assert.equal(byKey["set:2"].getBoundingClientRect().top, 182);
  // root 의 scroll-behavior: smooth 를 옵션으로 넘는다 — 인라인 스타일 토글은 Chromium 에서 (0, 0) 스크롤이 여전히 애니메이트됐다
  assert.deepEqual(h.dom.view.scrolls, [{ y: 218, behavior: "instant" }]);
  // 새 화면에서 컨트롤이 루트 안 40px 아래로 왔으면(위의 내용이 늘었다) 그만큼 더 내려 화면 위치를 지킨다
  const h2 = loadHelpers();
  const m2 = h2.helpers.createFocusMemory();
  const v2 = viewWith(h2.helpers, 100, [["set:2", 340]]);
  m2.restore(v2.root, spot, "today");
  assert.equal(v2.byKey["set:2"].getBoundingClientRect().top, 182);
  // 스크롤이 그대로인 다시 그리기(받을 것이 없었다)는 스크롤하지 않는다
  const h3 = loadHelpers();
  h3.dom.view.scrollY = 218;
  const v3 = viewWith(h3.helpers, 100, [["set:2", 300]]);
  h3.helpers.createFocusMemory().restore(v3.root, spot, "today");
  assert.deepEqual(h3.dom.view.scrolls, []);
});

test("createFocusMemory: 누를 때 이미 화면 밖이던 컨트롤(포커스를 둔 채 스크롤해 내려간 뒤 Enter)은 같은 자리 대신 가운데로", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  // 누른 때: 스크롤 2000, 「다음날」은 문서 120(루트 100 + 20) — 화면 위 -1880
  const spot = { key: "next", y: 2000, top: -1880, offset: 20 };
  const { root, byKey } = viewWith(h.helpers, 100, [["prev", 20], ["next", 20]]);
  mem.restore(root, spot, "today");
  assert.equal(h.dom.getActive(), byKey.next);
  assert.deepEqual(h.dom.view.scrolls.map((s) => s.behavior), ["instant", "instant"], "같은 자리 → 가운데, 둘 다 즉시");
  assert.equal(h.dom.view.scrollY, 0);   // 가운데에 둘 만큼 올라갈 수 없어 맨 위 — 컨트롤은 화면 안
  assert.equal(byKey.next.getBoundingClientRect().top, 120);
});

test("createFocusMemory: 스크롤 고정(scroll anchoring)이 있으면 누른 때의 화면 위치(top)로 — 그사이 데스크톱 머리의 검색 줄이 펼쳐져 루트가 내려가도", () => {
  // 누른 때: 스크롤 166, 머리가 접혀 루트는 문서 100, 컨트롤은 루트 안 236 — 화면 위치 170
  const press = (h) => {
    const mem = h.helpers.createFocusMemory();
    h.dom.view.scrollY = 166;
    const v = viewWith(h.helpers, 100, [["set:2", 236]]);
    mem.remember({ ...CLICK, target: v.byKey["set:2"], currentTarget: v.root });
    return { mem, spot: mem.take() };
  };
  // 새 장을 받는 사이 스크롤이 0 으로 눌리며 머리의 검색 줄(46px)이 펼쳐졌다 — 새 루트는 문서 146
  const redraw = (h, mem, spot) => {
    h.dom.view.scrollY = 0;
    const v = viewWith(h.helpers, 146, [["set:2", 236]]);
    mem.restore(v.root, spot, "today");
    return v.byKey["set:2"].getBoundingClientRect().top;
  };
  const a = loadHelpers({ anchoring: true });
  const pa = press(a);
  assert.equal(redraw(a, pa.mem, pa.spot), 170, "지금 레이아웃에서 화면 위치 그대로 — 머리가 다시 접혀도 브라우저가 내용을 붙잡는다");
  // 스크롤 고정이 없는 브라우저(Safari 26 까지)는 루트 안 위치로 — 지금은 46px 아래지만, 머리가 다시 접히며 내용이 올라와 170
  const b = loadHelpers();
  const pb = press(b);
  assert.equal(redraw(b, pb.mem, pb.spot), 216);
});

test("createFocusMemory: 다시 그리는 사이 독자가 포커스를 다른 데로 옮겼으면(머리의 검색 · 팝오버) 포커스도 스크롤도 건드리지 않는다", () => {
  const h = loadHelpers();
  const mem = h.helpers.createFocusMemory();
  // 누른 링크는 옛 화면과 함께 사라져 포커스가 body 로 떨어진다 — 그때만 돌려준다
  const search = h.helpers.el("input", { id: "search-input" });
  h.dom.setActive(search);
  const { root, byKey } = viewWith(h.helpers, 100, [["set:2", 300]]);
  assert.equal(mem.restore(root, { key: "set:2", y: 218, top: 182, offset: 300 }, "today"), null);
  assert.equal(h.dom.getActive(), search, "검색 칸에 남는다 — 이어 치는 글자 · Enter 가 그 칸으로 간다");
  assert.deepEqual(h.dom.view.scrolls, []);
  h.dom.setActive(h.dom.document.body);
  assert.equal(mem.restore(root, { key: "set:2", y: 218, top: 182, offset: 300 }, "today"), byKey["set:2"]);
  assert.equal(h.dom.getActive(), byKey["set:2"]);
});
