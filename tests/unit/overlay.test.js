// ── Unit tests for js/app/overlay.js (ADR-032) ──────────────────────────────
// Run with: node --test tests/unit/overlay.test.js
//
// Loads the overlay.js IIFE in a vm context with a hand-written DOM stub (no
// jsdom), mirroring tests/unit/helpers.test.js. The stub exposes only what the
// controller touches: element .hidden / .focus() / .contains() / .closest() /
// setAttribute, a document with add/removeEventListener (+ test _dispatch),
// querySelectorAll and documentElement.classList, a *controllable*
// requestAnimationFrame (queued, flushed by the test), and Node/Element/
// HTMLElement classes so the controller's instanceof checks resolve. The
// appHelpers.setInert / trapFocus primitives are spies so we can assert the
// controller delegates to them (their real behavior is covered by
// helpers.test.js).
//
// Sections:
//   - open (show panel+scrim, inert, trap, aria, initial focus, onOpen)
//   - close (hide, inert off, trap cleanup, listeners off, focus restore, onClose order)
//   - escape (closeOnEsc gating)
//   - outside click (closeOnOutside, deferred attach, inside / ignore)
//   - misc (idempotency, rootClass, returnFocus variants)

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.resolve(__dirname, "../../js/app/overlay.js");
// Strip the trailing `export {};` ESM marker so vm.runInContext (classic
// script) accepts it.
const SOURCE = fs.readFileSync(SOURCE_PATH, "utf8")
  .replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");

// ── DOM stub ────────────────────────────────────────────────────────────────

// Module-level so they're the SAME class objects the vm context sees — the
// controller's `x instanceof HTMLElement` resolves against these.
class Node {}
class Element extends Node {}
class HTMLElement extends Element {}

function makeEnv() {
  let activeElement = null;
  const docListeners = new Map(); // type -> Set<fn>
  const registry = []; // every element, for document.querySelectorAll
  const rafCbs = [];
  const trapCalls = [];
  const inertCalls = [];
  let trapCleanupCount = 0;

  class StubEl extends HTMLElement {
    constructor(tag = "div") {
      super();
      this.tagName = String(tag).toUpperCase();
      this.hidden = false;
      this._attrs = /** @type {Record<string,string>} */ ({});
      this._children = /** @type {StubEl[]} */ ([]);
      this._parent = /** @type {StubEl|null} */ (null);
      this.focusCount = 0;
      registry.push(this);
    }
    focus() { activeElement = this; this.focusCount++; }
    appendChild(c) { this._children.push(c); if (c) c._parent = this; return c; }
    contains(node) {
      if (node === this) return true;
      return this._children.some((c) => c && c.contains && c.contains(node));
    }
    setAttribute(k, v) { this._attrs[k] = String(v); }
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null;
    }
    removeAttribute(k) { delete this._attrs[k]; }
    // Minimal selector matcher: #id, .class, bare tag.
    matchesSel(sel) {
      sel = sel.trim();
      if (sel.startsWith("#")) return this._attrs.id === sel.slice(1);
      if (sel.startsWith(".")) return (this._attrs.class || "").split(/\s+/).includes(sel.slice(1));
      if (/^[a-z]+$/i.test(sel)) return this.tagName === sel.toUpperCase();
      return false;
    }
    closest(sel) {
      let n = this;
      while (n) { if (n.matchesSel && n.matchesSel(sel)) return n; n = n._parent; }
      return null;
    }
    querySelector(sel) {
      for (const c of this._children) {
        if (c.matchesSel && c.matchesSel(sel)) return c;
        const deep = c.querySelector && c.querySelector(sel);
        if (deep) return deep;
      }
      return null;
    }
  }

  const documentElement = new StubEl("html");
  const classes = new Set();
  documentElement.classList = {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  };

  const document = {
    get activeElement() { return activeElement; },
    documentElement,
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { docListeners.get(type)?.delete(fn); },
    querySelectorAll(sel) {
      return registry.filter((e) => e.matchesSel && e.matchesSel(sel));
    },
    /** Test-only: fire registered listeners with a fake event. */
    _dispatch(type, evt) {
      const set = docListeners.get(type);
      if (!set) return;
      for (const fn of [...set]) fn(evt);
    },
    _listenerCount(type) { return docListeners.get(type)?.size || 0; },
  };

  const ctx = {
    console, JSON, Object, Array, Set, Map, Error, String, Number, Boolean,
    document,
    Node, Element, HTMLElement,
    requestAnimationFrame: (cb) => { rafCbs.push(cb); return rafCbs.length; },
    appHelpers: {
      setInert: (on, sel) => { inertCalls.push([on, sel]); },
      trapFocus: (container) => { trapCalls.push(container); return () => { trapCleanupCount++; }; },
    },
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(SOURCE, ctx, { filename: "overlay.js" });

  return {
    createOverlay: ctx.appOverlay.createOverlay,
    document,
    StubEl,
    setActive: (el) => { activeElement = el; },
    getActive: () => activeElement,
    /** Run + clear all queued requestAnimationFrame callbacks. */
    flushRaf: () => { rafCbs.splice(0).forEach((cb) => cb()); },
    trapCalls,
    inertCalls,
    getTrapCleanupCount: () => trapCleanupCount,
    classes,
  };
}

const ESC = { key: "Escape", preventDefault() {} };

// ── open ─────────────────────────────────────────────────────────────────────

test("open: shows panel + scrim, delegates inert/trap, sets aria, runs onOpen", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const scrim = new env.StubEl();
  panel.hidden = true;
  scrim.hidden = true;
  const trigger = new env.StubEl();
  trigger.setAttribute("id", "trg");
  let opened = 0;
  const ov = env.createOverlay({
    panel, scrim, inertSelectors: "main", ariaExpanded: "#trg",
    onOpen: () => { opened++; },
  });

  ov.open();

  assert.equal(panel.hidden, false);
  assert.equal(scrim.hidden, false);
  assert.deepEqual(env.inertCalls[0], [true, "main"]);
  assert.equal(env.trapCalls[0], panel);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(opened, 1);
  assert.equal(ov.isOpen, true);
});

test("open: initial focus runs on the next frame, not synchronously", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const input = new env.StubEl("input");
  panel.appendChild(input);
  const ov = env.createOverlay({ panel, initialFocus: () => input });

  ov.open();
  assert.equal(input.focusCount, 0); // deferred

  env.flushRaf();
  assert.equal(input.focusCount, 1);
  assert.equal(env.getActive(), input);
});

// ── close ──────────────────────────────────────────────────────────────────

test("close: hides, inert off, trap cleanup, aria false, restores focus, onClose first", () => {
  const env = makeEnv();
  const prev = new env.StubEl();
  const panel = new env.StubEl();
  const scrim = new env.StubEl();
  const trigger = new env.StubEl();
  trigger.setAttribute("id", "t");
  env.setActive(prev); // focused before open → restore target

  const order = [];
  const ov = env.createOverlay({
    panel, scrim, inertSelectors: "main", ariaExpanded: "#t",
    onClose: () => order.push("onClose"),
  });
  ov.open();
  // Record focus-restore ordering relative to onClose.
  const realFocus = prev.focus.bind(prev);
  prev.focus = () => { order.push("focus"); realFocus(); };

  ov.close();

  assert.equal(panel.hidden, true);
  assert.equal(scrim.hidden, true);
  assert.deepEqual(env.inertCalls.at(-1), [false, "main"]);
  assert.equal(env.getTrapCleanupCount(), 1);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(ov.isOpen, false);
  assert.deepEqual(order, ["onClose", "focus"]); // onClose before focus restore
  assert.equal(env.getActive(), prev);
});

// ── escape ───────────────────────────────────────────────────────────────────

test("escape: closeOnEsc=true closes and then detaches the keydown listener", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const ov = env.createOverlay({ panel, closeOnEsc: true });

  ov.open();
  assert.equal(env.document._listenerCount("keydown"), 1);
  env.document._dispatch("keydown", ESC);
  assert.equal(ov.isOpen, false);
  assert.equal(panel.hidden, true);
  assert.equal(env.document._listenerCount("keydown"), 0); // removed on close
});

test("escape: non-Escape keys are ignored", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const ov = env.createOverlay({ panel, closeOnEsc: true });
  ov.open();
  env.document._dispatch("keydown", { key: "a", preventDefault() {} });
  assert.equal(ov.isOpen, true);
});

test("escape: closeOnEsc defaults off — no keydown listener, Escape ignored", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const ov = env.createOverlay({ panel }); // closeOnEsc omitted → false
  ov.open();
  assert.equal(env.document._listenerCount("keydown"), 0);
  env.document._dispatch("keydown", ESC);
  assert.equal(ov.isOpen, true);
});

// ── outside click ────────────────────────────────────────────────────────────

test("outside click: attaches next frame; inside and ignored targets stay open", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const child = new env.StubEl();
  panel.appendChild(child);
  const trigger = new env.StubEl();
  trigger.setAttribute("id", "tg");
  const outside = new env.StubEl();

  const ov = env.createOverlay({ panel, closeOnOutside: true, outsideIgnore: "#tg" });
  ov.open();
  assert.equal(env.document._listenerCount("click"), 0); // deferred
  env.flushRaf();
  assert.equal(env.document._listenerCount("click"), 1);

  env.document._dispatch("click", { target: child });   // inside
  assert.equal(ov.isOpen, true);
  env.document._dispatch("click", { target: trigger }); // ignored trigger
  assert.equal(ov.isOpen, true);
  env.document._dispatch("click", { target: outside }); // truly outside
  assert.equal(ov.isOpen, false);
  assert.equal(env.document._listenerCount("click"), 0); // removed on close
});

// ── misc ─────────────────────────────────────────────────────────────────────

test("idempotency: re-open / re-close are no-ops", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const ov = env.createOverlay({ panel });
  ov.open();
  ov.open(); // no-op
  assert.equal(env.trapCalls.length, 1);
  ov.close();
  ov.close(); // no-op
  assert.equal(env.getTrapCleanupCount(), 1);
});

test("rootClass: toggled on <html> across open/close", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const ov = env.createOverlay({ panel, rootClass: "sheet-open" });
  ov.open();
  assert.equal(env.classes.has("sheet-open"), true);
  ov.close();
  assert.equal(env.classes.has("sheet-open"), false);
});

test("returnFocus: explicit element wins over pre-open active element", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const target = new env.StubEl();
  const other = new env.StubEl();
  env.setActive(other);
  const ov = env.createOverlay({ panel, returnFocus: target });
  ov.open();
  ov.close();
  assert.equal(env.getActive(), target);
});

test("returnFocus: false skips restore entirely", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const other = new env.StubEl();
  const ov = env.createOverlay({ panel, returnFocus: false });
  ov.open();
  env.setActive(other);
  ov.close();
  assert.equal(env.getActive(), other); // untouched
});

test("open(arg): explicit return-focus argument overrides the default capture", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const prev = new env.StubEl();
  const explicit = new env.StubEl();
  env.setActive(prev);
  const ov = env.createOverlay({ panel }); // returnFocus default true
  ov.open(explicit);
  ov.close();
  assert.equal(env.getActive(), explicit);
});
