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
      // Sheet-drag surface: style holds inline height/width strings; offset*
      // reflect the rendered size (parsed from style, falling back to _base*).
      this.style = /** @type {Record<string,string>} */ ({});
      this._baseH = 0;
      this._baseW = 0;
      this._listeners = /** @type {Map<string, Set<Function>>} */ (new Map());
      registry.push(this);
    }
    get offsetHeight() { const h = parseFloat(this.style.height); return Number.isNaN(h) ? this._baseH : h; }
    get offsetWidth() { const w = parseFloat(this.style.width); return Number.isNaN(w) ? this._baseW : w; }
    setPointerCapture() { /* no-op in stub */ }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { this._listeners.get(type)?.delete(fn); }
    /** Test-only: fire registered listeners with a fake event. */
    _dispatch(type, evt) {
      const set = this._listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) fn(evt);
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
    console, JSON, Object, Array, Set, Map, Error, String, Number, Boolean, Math,
    document,
    Node, Element, HTMLElement,
    // Default mobile viewport (drag is mobile-only; resize is desktop-only).
    innerWidth: 400,
    innerHeight: 800,
    requestAnimationFrame: (cb) => { rafCbs.push(cb); return rafCbs.length; },
    appHelpers: {
      setInert: (on, sel) => { inertCalls.push([on, sel]); },
      trapFocus: (container) => { trapCalls.push(container); return () => { trapCleanupCount++; }; },
      // Real threshold logic (mirrors js/app/helpers.js) so the drag-release
      // decision is exercised end-to-end.
      dragReleaseAction: (h, vh) => (h < vh * 0.20 ? "close" : h < vh * 0.30 ? "snap-min" : "stay"),
    },
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(SOURCE, ctx, { filename: "overlay.js" });

  return {
    createOverlay: ctx.appOverlay.createOverlay,
    attachSheetDrag: ctx.appOverlay.attachSheetDrag,
    attachSheetResize: ctx.appOverlay.attachSheetResize,
    document,
    StubEl,
    setActive: (el) => { activeElement = el; },
    getActive: () => activeElement,
    /** Run + clear all queued requestAnimationFrame callbacks. */
    flushRaf: () => { rafCbs.splice(0).forEach((cb) => cb()); },
    /** Override the stub viewport (drag is mobile-only, resize desktop-only). */
    setViewport: (w, h) => { ctx.innerWidth = w; ctx.innerHeight = h; },
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

// ── closeTransition (animated / async dismiss) ───────────────────────────────

test("closeTransition: defers panel hide to finalizeHide; cleanup is immediate", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const scrim = new env.StubEl();
  /** @type {(() => void) | null} */
  let finalize = null;
  const ov = env.createOverlay({
    panel, scrim, inertSelectors: "main",
    closeTransition: (_panel, done) => { finalize = done; }, // capture, don't call yet
  });
  ov.open();
  ov.close();
  // Logical close ran immediately…
  assert.equal(scrim.hidden, true);
  assert.deepEqual(env.inertCalls.at(-1), [false, "main"]);
  assert.equal(env.getTrapCleanupCount(), 1);
  assert.equal(ov.isOpen, false);
  // …but the panel is still visible while the exit animation plays.
  assert.equal(panel.hidden, false);
  // Animation end → finalize hides it.
  /** @type {() => void} */ (finalize)();
  assert.equal(panel.hidden, true);
});

test("closeTransition: re-open before finalizeHide cancels the pending hide", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  /** @type {(() => void) | null} */
  let finalize = null;
  const ov = env.createOverlay({
    panel,
    closeTransition: (_panel, done) => { finalize = done; },
  });
  ov.open();
  ov.close();
  assert.equal(panel.hidden, false); // deferred
  ov.open(); // re-open mid-animation
  assert.equal(ov.isOpen, true);
  /** @type {() => void} */ (finalize)(); // stale finalize from the cancelled close
  assert.equal(panel.hidden, false); // NOT hidden — the re-open won
});

// ── attachSheetDrag (bottom-sheet drag-to-dismiss) ───────────────────────────

/**
 * Drive one drag gesture: pointerdown at startClientY (sheet at restH), move to
 * endClientY, release. Returns the sheet so the caller can assert height/close.
 */
function dragGesture(env, { restH = 500, startClientY, endClientY, onClose, maxRatio }) {
  const handle = new env.StubEl();
  const sheet = new env.StubEl();
  sheet._baseH = restH;
  env.attachSheetDrag(handle, sheet, maxRatio === undefined ? { onClose } : { onClose, maxRatio });
  handle._dispatch("pointerdown", { clientY: startClientY, pointerId: 1, preventDefault() {} });
  handle._dispatch("pointermove", { clientY: endClientY });
  handle._dispatch("pointerup", {});
  return { handle, sheet };
}

test("attachSheetDrag: release below the close threshold fires onClose", () => {
  const env = makeEnv(); // vh 800 → close < 160px
  let closed = 0;
  // restH 500, drag down 450px → 50px (< 160) → close.
  dragGesture(env, { restH: 500, startClientY: 300, endClientY: 750, onClose: () => { closed++; } });
  assert.equal(closed, 1);
});

test("attachSheetDrag: release in the snap range snaps to 30vh, no close", () => {
  const env = makeEnv(); // vh 800 → snap-min band [160, 240)
  let closed = 0;
  // restH 500, drag down 300px → 200px (in [160,240)) → snap-min.
  const { sheet } = dragGesture(env, { restH: 500, startClientY: 300, endClientY: 600, onClose: () => { closed++; } });
  assert.equal(closed, 0);
  assert.equal(sheet.style.height, "240px"); // 0.3 · 800
});

test("attachSheetDrag: release tall stays where dropped, no close", () => {
  const env = makeEnv();
  let closed = 0;
  // restH 500, drag down 100px → 400px (≥ 240) → stay.
  const { sheet } = dragGesture(env, { restH: 500, startClientY: 300, endClientY: 400, onClose: () => { closed++; } });
  assert.equal(closed, 0);
  assert.equal(sheet.style.height, "400px");
});

test("attachSheetDrag: height is clamped to maxRatio·vh while dragging up", () => {
  const env = makeEnv(); // vh 800, default maxRatio 0.9 → cap 720
  // restH 500, drag up 700px → would be 1200, clamped to 720.
  const { sheet } = dragGesture(env, { restH: 500, startClientY: 700, endClientY: 0, onClose: () => {} });
  assert.equal(sheet.style.height, "720px");
});

test("attachSheetDrag: custom maxRatio caps the dragged height", () => {
  const env = makeEnv(); // vh 800, maxRatio 0.5 → cap 400
  const { sheet } = dragGesture(env, { restH: 300, startClientY: 700, endClientY: 0, onClose: () => {}, maxRatio: 0.5 });
  assert.equal(sheet.style.height, "400px");
});

test("attachSheetDrag: desktop (≥769px) pointerdown is a no-op", () => {
  const env = makeEnv();
  env.setViewport(1000, 800); // desktop
  let closed = 0;
  const handle = new env.StubEl();
  const sheet = new env.StubEl();
  sheet._baseH = 500;
  env.attachSheetDrag(handle, sheet, { onClose: () => { closed++; } });
  handle._dispatch("pointerdown", { clientY: 300, pointerId: 1, preventDefault() {} });
  handle._dispatch("pointermove", { clientY: 750 }); // no listener registered
  handle._dispatch("pointerup", {});
  assert.equal(closed, 0);
  assert.equal(sheet.style.height, undefined); // never touched
});

// ── attachSheetResize (desktop side-panel width) ─────────────────────────────

test("attachSheetResize: desktop drag-left widens within clamp", () => {
  const env = makeEnv();
  env.setViewport(1200, 800); // desktop → cap 0.85·1200 = 1020
  const handle = new env.StubEl();
  const sheet = new env.StubEl();
  sheet._baseW = 400;
  env.attachSheetResize(handle, sheet);
  handle._dispatch("pointerdown", { clientX: 900, pointerId: 1, preventDefault() {} });
  handle._dispatch("pointermove", { clientX: 700 }); // drag left 200 → 600
  assert.equal(sheet.style.width, "600px");
});

test("attachSheetResize: width is clamped to the [minWidth, maxRatio·vw] band", () => {
  const env = makeEnv();
  env.setViewport(1000, 800); // cap 850, floor 240
  const handle = new env.StubEl();
  const sheet = new env.StubEl();
  sheet._baseW = 300;
  env.attachSheetResize(handle, sheet);
  handle._dispatch("pointerdown", { clientX: 500, pointerId: 1, preventDefault() {} });
  handle._dispatch("pointermove", { clientX: 1200 }); // drag right far → below floor → 240
  assert.equal(sheet.style.width, "240px");
});

test("attachSheetResize: mobile (<769px) pointerdown is a no-op", () => {
  const env = makeEnv();
  env.setViewport(400, 800); // mobile
  const handle = new env.StubEl();
  const sheet = new env.StubEl();
  sheet._baseW = 400;
  env.attachSheetResize(handle, sheet);
  handle._dispatch("pointerdown", { clientX: 300, pointerId: 1, preventDefault() {} });
  handle._dispatch("pointermove", { clientX: 100 });
  assert.equal(sheet.style.width, undefined);
});
