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
//   - setInert (inert + aria-hidden toggle on selector matches)
//   - trapFocus (Tab / Shift-Tab cycling within a container)
//   - dragReleaseAction (bottom-sheet drag-resize release thresholds)

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
      focus() { activeElement = this; },
      querySelectorAll(selector) {
        return findAll(this, selector);
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
  };

  return {
    document,
    /** Test-only hook to seed activeElement directly. */
    setActive(el) { activeElement = el; },
    /** Test-only hook to read activeElement without going through getter. */
    getActive() { return activeElement; },
    _registry: registry,
  };
}

// ── Loader ──────────────────────────────────────────────────────────────────

function loadHelpers() {
  const dom = makeDom();
  const ctx = {
    console, JSON, Object, Array, Set, Map, Error, String, Number, Boolean,
    document: dom.document,
  };
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
