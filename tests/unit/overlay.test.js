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
      this.isConnected = true; // DOM-connected by default; tests set false to detach

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
    // Default small-layout viewport (drag is small-layout only; resize is large-layout only).
    innerWidth: 400,
    innerHeight: 800,
    matchMedia: (q) => ({ media: q, matches: false }),
    // Root font size = the app's font-size setting (html font-size); the side-panel resize floor is in rem.
    rootFontSize: "18px",
    getComputedStyle: (el) => ({ fontSize: el === document.documentElement ? ctx.rootFontSize : "16px" }),
    requestAnimationFrame: (cb) => { rafCbs.push(cb); return rafCbs.length; },
    appHelpers: {
      setInert: (on, sel) => { inertCalls.push([on, sel]); },
      trapFocus: (container) => { trapCalls.push(container); return () => { trapCleanupCount++; }; },
      // Real threshold logic (mirrors js/app/helpers.js) so the drag-release
      // decision is exercised end-to-end.
      dragReleaseAction: (h, vh) => (h < vh * 0.20 ? "close" : h < vh * 0.30 ? "snap-min" : "stay"),
      // The sheet↔side-panel gate (ADR-050 §2), mirroring helpers.js LARGE_LAYOUT_QUERY on the stubbed viewport.
      // setViewport stays the control knob.
      isLargeLayout: () => ctx.innerWidth >= 700 && ctx.innerHeight >= 600,
    },
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(SOURCE, ctx, { filename: "overlay.js" });

  return {
    createOverlay: ctx.appOverlay.createOverlay,
    closeAllOverlays: ctx.appOverlay.closeAllOverlays,
    whenNoOverlayOpen: ctx.appOverlay.whenNoOverlayOpen,
    anyOverlayOpen: ctx.appOverlay.anyOverlayOpen,
    attachSheetDrag: ctx.appOverlay.attachSheetDrag,
    attachSheetResize: ctx.appOverlay.attachSheetResize,
    document,
    StubEl,
    setActive: (el) => { activeElement = el; },
    getActive: () => activeElement,
    /** Run + clear all queued requestAnimationFrame callbacks. */
    flushRaf: () => { rafCbs.splice(0).forEach((cb) => cb()); },
    /** Override the stub viewport (drag is small-layout only, resize large-layout only). */
    setViewport: (w, h) => { ctx.innerWidth = w; ctx.innerHeight = h; },
    setRootFontSize: (px) => { ctx.rootFontSize = `${px}px`; },
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

/** A click whose dispatch path (`composedPath()`) is fixed when it is sent, like a browser's. */
const clickOn = (target, path) => ({ target, composedPath: () => path });

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

  env.document._dispatch("click", clickOn(child, [child, panel]));   // inside
  assert.equal(ov.isOpen, true);
  env.document._dispatch("click", clickOn(trigger, [trigger])); // ignored trigger
  assert.equal(ov.isOpen, true);
  env.document._dispatch("click", clickOn(outside, [outside])); // truly outside
  assert.equal(ov.isOpen, false);
  assert.equal(env.document._listenerCount("click"), 0); // removed on close
});

test("outside click: a node the click re-rendered out of the panel still counts as inside (dispatch path)", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const gone = new env.StubEl();   // pressed inside, then removed by the panel's own click handler
  const ov = env.createOverlay({ panel, closeOnOutside: true });
  ov.open();
  env.flushRaf();
  assert.equal(panel.contains(gone), false);
  env.document._dispatch("click", clickOn(gone, [gone, panel]));
  assert.equal(ov.isOpen, true);
});

test("modal: false leaves the background usable — no inert, no focus trap, no outside-click close (ADR-058 §3)", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  const outside = new env.StubEl();
  const trigger = new env.StubEl();
  trigger.setAttribute("id", "drop");
  const ov = env.createOverlay({ panel, modal: false, inertSelectors: "main", closeOnOutside: true, ariaExpanded: "#drop" });

  ov.open();
  env.flushRaf();
  assert.equal(panel.hidden, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.deepEqual(env.inertCalls, []);
  assert.deepEqual(env.trapCalls, []);
  assert.equal(env.document._listenerCount("click"), 0);
  env.document._dispatch("click", clickOn(outside, [outside]));
  assert.equal(ov.isOpen, true);

  ov.close();
  assert.equal(panel.hidden, true);
  assert.deepEqual(env.inertCalls, []);   // nothing to undo
  assert.equal(env.getTrapCleanupCount(), 0);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
});

test("modal: a function is read at each open, and close undoes only what that open did", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  let large = false;
  const ov = env.createOverlay({ panel, modal: () => large, inertSelectors: "main" });

  ov.open();
  large = true;   // the layout changes while open: close must not lift an inert that open never set
  ov.close();
  assert.deepEqual(env.inertCalls, []);
  assert.equal(env.getTrapCleanupCount(), 0);

  ov.open();
  assert.deepEqual(env.inertCalls, [[true, "main"]]);
  assert.equal(env.trapCalls.length, 1);
  large = false;
  ov.close();
  assert.deepEqual(env.inertCalls, [[true, "main"], [false, "main"]]);
  assert.equal(env.getTrapCleanupCount(), 1);
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

// ── closeAllOverlays (route() dismiss-on-navigation, ADR-034 PR5b) ───────────

test("closeAllOverlays: closes every open overlay (full unwind) + force-hides panel", () => {
  const env = makeEnv();
  const a = new env.StubEl();
  const b = new env.StubEl();
  const ovA = env.createOverlay({ panel: a, inertSelectors: "main" });
  const ovB = env.createOverlay({ panel: b });
  ovA.open();
  ovB.open();
  env.closeAllOverlays();
  assert.equal(ovA.isOpen, false);
  assert.equal(ovB.isOpen, false);
  assert.equal(a.hidden, true);
  assert.equal(b.hidden, true);
});

// The bug Bugbot caught (PR #227): force-hide must key off panel VISIBILITY, not
// isOpen. closeTransition overlays (cite sheet / drawer) set isOpen=false on
// close() but keep the panel visible until the exit animation finalizes — so a
// navigation mid-dismiss left them lingering when the force-hide was gated on
// isOpen.
test("closeAllOverlays: force-hides an animated panel mid-dismiss (isOpen already false)", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  /** @type {(() => void) | null} */
  let finalize = null;
  const ov = env.createOverlay({
    panel,
    closeTransition: (_p, done) => { finalize = done; }, // capture, never finalize
  });
  ov.open();
  ov.close(); // logical close: isOpen=false, panel deferred-visible
  assert.equal(ov.isOpen, false);
  assert.equal(panel.hidden, false); // still visible (animation in flight)
  env.closeAllOverlays(); // navigation lands mid-dismiss
  assert.equal(panel.hidden, true); // force-hidden so it doesn't linger over the next view
});

test("closeAllOverlays: onNavigateAway runs instead of the force-hide, open or mid-dismiss, and the exit finishes over the new view (ADR-058 §3)", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  /** @type {(() => void) | null} */
  let finalize = null;
  let away = 0;
  const ov = env.createOverlay({ panel, onNavigateAway: () => { away++; }, closeTransition: (_p, done) => { finalize = done; } });
  ov.open();
  env.closeAllOverlays();   // open: close() runs, then the hook
  assert.equal(ov.isOpen, false);
  assert.equal(panel.hidden, false);   // still folding away
  assert.equal(away, 1);
  env.closeAllOverlays();   // mid-dismiss (a normal close the reader made just before leaving): the hook again, no force-hide
  assert.equal(away, 2);
  assert.equal(panel.hidden, false);
  /** @type {() => void} */ (/** @type {unknown} */ (finalize))();
  assert.equal(panel.hidden, true);
  env.closeAllOverlays();   // hidden: nothing to settle
  assert.equal(away, 2);
});

test("closeAllOverlays({ keepNonBlocking }): a same-address redraw leaves an open non-blocking overlay open and closes the rest (ADR-058 §3)", () => {
  const env = makeEnv();
  const drop = new env.StubEl();
  const sheet = new env.StubEl();
  let away = 0;
  const dropOv = env.createOverlay({ panel: drop, modal: false, onNavigateAway: () => { away++; } });
  const sheetOv = env.createOverlay({ panel: sheet, modal: false });
  const blocking = env.createOverlay({ panel: new env.StubEl() });
  dropOv.open();
  sheetOv.open();
  env.closeAllOverlays({ keepNonBlocking: true });
  assert.equal(dropOv.isOpen && sheetOv.isOpen, true);
  assert.equal(drop.hidden, false);
  assert.equal(away, 0);
  blocking.open();   // closes the non-blocking ones (one layer at a time)
  env.closeAllOverlays({ keepNonBlocking: true });
  assert.equal(blocking.isOpen, false);
  dropOv.open();
  env.closeAllOverlays();   // a real navigation still closes it (no exit animation here, so no hook either)
  assert.equal(dropOv.isOpen, false);
  assert.equal(drop.hidden, true);
});

test("closeAllOverlays({ keepNonBlocking }): a non-blocking panel mid-dismiss finishes its own exit, without onNavigateAway (ADR-058 §3)", () => {
  const env = makeEnv();
  const drop = new env.StubEl();
  /** @type {(() => void) | null} */
  let finalize = null;
  let away = 0;
  const dropOv = env.createOverlay({ panel: drop, modal: false, onNavigateAway: () => { away++; }, closeTransition: (_p, done) => { finalize = done; } });
  dropOv.open();
  dropOv.close();   // folding up
  env.closeAllOverlays({ keepNonBlocking: true });   // a same-address redraw lands mid-fold
  assert.equal(away, 0);
  assert.equal(drop.hidden, false);
  /** @type {() => void} */ (/** @type {unknown} */ (finalize))();
  assert.equal(drop.hidden, true);
});

test("whenNoOverlayOpen: an open non-blocking overlay does not hold the work back (ADR-058 §3)", async () => {
  const env = makeEnv();
  const dropOv = env.createOverlay({ panel: new env.StubEl(), modal: false });
  const modalOv = env.createOverlay({ panel: new env.StubEl(), modal: () => true });
  const ran = [];
  dropOv.open();
  assert.equal(env.anyOverlayOpen(), false);
  env.whenNoOverlayOpen(() => ran.push("now"));
  assert.deepStrictEqual(ran, ["now"]);
  modalOv.open();
  assert.equal(env.anyOverlayOpen(), true);
  env.whenNoOverlayOpen(() => ran.push("later"));
  assert.deepStrictEqual(ran, ["now"]);
  modalOv.close();
  await Promise.resolve();
  assert.deepStrictEqual(ran, ["now", "later"]);
});

test("open: a blocking overlay closes an open non-blocking one first, which hands focus back before the capture (ADR-058 §3)", () => {
  const env = makeEnv();
  const drop = new env.StubEl();
  const sheet = new env.StubEl();
  const chip = new env.StubEl();
  const icon = new env.StubEl();
  const order = [];
  const dropOv = env.createOverlay({ panel: drop, modal: false, onClose: () => { order.push("drop closed"); env.setActive(icon); } });
  const sheetOv = env.createOverlay({ panel: sheet, inertSelectors: "main" });
  const otherDrop = env.createOverlay({ panel: new env.StubEl(), modal: false });
  dropOv.open();
  otherDrop.open();   // two non-blocking ones stay open together
  assert.equal(dropOv.isOpen && otherDrop.isOpen, true);
  env.setActive(chip);
  sheetOv.open();
  assert.equal(dropOv.isOpen, false);
  assert.equal(otherDrop.isOpen, false);
  assert.deepEqual(order, ["drop closed"]);
  sheetOv.close();
  assert.equal(env.getActive(), icon);   // the sheet returns focus to where the closing drop left it
  // A non-blocking open leaves a blocking one alone
  sheetOv.open();
  dropOv.open();
  assert.equal(sheetOv.isOpen, true);
});

test("closeAllOverlays: leaves an already-hidden, never-opened overlay untouched", () => {
  const env = makeEnv();
  const panel = new env.StubEl();
  panel.hidden = true; // overlays ship hidden until first open
  env.createOverlay({ panel });
  env.closeAllOverlays();
  assert.equal(panel.hidden, true);
});

test("closeAllOverlays: skips detached panels (per-open-rebuilt overlays) without closing them", () => {
  const env = makeEnv();
  const stale = new env.StubEl();
  const live = new env.StubEl();
  const ovStale = env.createOverlay({ panel: stale });
  const ovLive = env.createOverlay({ panel: live });
  ovStale.open();
  ovLive.open();
  stale.isConnected = false; // its element was replaced in the DOM
  env.closeAllOverlays();
  // Detached entry is pruned + skipped (not closed); the live overlay still closes.
  assert.equal(ovStale.isOpen, true);
  assert.equal(ovLive.isOpen, false);
  assert.equal(live.hidden, true);
  // Pruned: a second pass is a no-op that doesn't revisit the stale entry.
  env.closeAllOverlays();
  assert.equal(ovLive.isOpen, false);
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

test("attachSheetDrag: large layout (≥700×600) pointerdown is a no-op", () => {
  const env = makeEnv();
  env.setViewport(1000, 800); // large layout
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

// ── attachSheetResize (large-layout side-panel width) ─────────────────────────────

test("attachSheetResize: large-layout drag-left widens within clamp", () => {
  const env = makeEnv();
  env.setViewport(1200, 800); // large layout → cap 0.85·1200 = 1020
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
  env.setViewport(1000, 800); // cap 850, floor 13.3rem = 239.4px at the default 18px
  const handle = new env.StubEl();
  const sheet = new env.StubEl();
  sheet._baseW = 300;
  env.attachSheetResize(handle, sheet);
  handle._dispatch("pointerdown", { clientX: 500, pointerId: 1, preventDefault() {} });
  handle._dispatch("pointermove", { clientX: 1200 }); // drag right far → below floor → 239.4
  assert.equal(sheet.style.width, "239.4px");
  handle._dispatch("pointermove", { clientX: -1000 }); // drag left far → above cap → 850
  assert.equal(sheet.style.width, "850px");
});

test("attachSheetResize: the floor follows the font-size setting, read at each drag (ADR-055 §1)", () => {
  const env = makeEnv();
  env.setViewport(1000, 800);
  const handle = new env.StubEl();
  const sheet = new env.StubEl();
  sheet._baseW = 400;
  env.attachSheetResize(handle, sheet);
  for (const [font, floor] of [[24, 13.3 * 24], [16, 13.3 * 16]]) {
    env.setRootFontSize(font); // changed between two drags, as the settings popover does
    handle._dispatch("pointerdown", { clientX: 500, pointerId: 1, preventDefault() {} });
    handle._dispatch("pointermove", { clientX: 1200 });
    assert.ok(Math.abs(parseFloat(sheet.style.width) - floor) < 1e-6, `${font}px: ${sheet.style.width}`);
    handle._dispatch("pointerup", {});
  }
});

test("attachSheetResize: small layout (<700px wide) pointerdown is a no-op", () => {
  const env = makeEnv();
  env.setViewport(400, 800); // small layout
  const handle = new env.StubEl();
  const sheet = new env.StubEl();
  sheet._baseW = 400;
  env.attachSheetResize(handle, sheet);
  handle._dispatch("pointerdown", { clientX: 300, pointerId: 1, preventDefault() {} });
  handle._dispatch("pointermove", { clientX: 100 });
  assert.equal(sheet.style.width, undefined);
});

// ── whenNoOverlayOpen ────────────────────────────────────────────────────────

test("whenNoOverlayOpen: 열린 창이 없으면 바로 실행하고, 있으면 마지막 창이 닫힌 뒤에 실행한다(ADR-041 §6)", async () => {
  const env = makeEnv();
  const a = env.createOverlay({ panel: new env.StubEl("div") });
  const b = env.createOverlay({ panel: new env.StubEl("div") });
  const ran = [];
  env.whenNoOverlayOpen(() => ran.push("now"));
  assert.deepStrictEqual(ran, ["now"]);
  a.open();
  b.open();
  env.whenNoOverlayOpen(() => ran.push("later"));
  a.close();
  await Promise.resolve();
  assert.deepStrictEqual(ran, ["now"]);   // b가 아직 열려 있다
  b.close();
  await Promise.resolve();
  assert.deepStrictEqual(ran, ["now", "later"]);
  // 한 번만 실행한다
  a.open();
  a.close();
  await Promise.resolve();
  assert.deepStrictEqual(ran, ["now", "later"]);
});
