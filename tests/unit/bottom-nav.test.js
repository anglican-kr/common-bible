// ── Unit tests for js/app/bottom-nav.js ─────────────────────────────────────
// Run with: node --test tests/unit/bottom-nav.test.js
//
// Same BEGIN/END marker-slice + vm approach as views-routing.test.js. The
// route→tab mapping is the pure logic most likely to regress as new routes
// land (Stages 2–3 add /search and /bookmarks routes). The DOM-wired parts
// (click handlers, scroll auto-hide, per-tab memory) are exercised by e2e —
// the project defers DOM-heavy surfaces to e2e (ADR-013).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(__dirname, "../../js/app/bottom-nav.js"), "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = SRC.indexOf(begin);
  const endIdx = SRC.indexOf(end);
  if (startIdx < 0 || endIdx < 0) throw new Error(`marker block ${name} not found`);
  return SRC.slice(startIdx, endIdx + end.length);
}

function loadRouteToTab() {
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("ROUTE_TO_TAB"), ctx, { filename: "bottom-nav-route-to-tab.js" });
  return ctx.routeToTab;
}

test("routeToTab — reading stack maps to 'read'", () => {
  const routeToTab = loadRouteToTab();
  assert.equal(routeToTab("/"), "read");
  assert.equal(routeToTab("/old_testament"), "read");
  assert.equal(routeToTab("/deuterocanon"), "read");
  assert.equal(routeToTab("/new_testament"), "read");
  assert.equal(routeToTab("/john"), "read");
  assert.equal(routeToTab("/john/3"), "read");
  assert.equal(routeToTab("/john/3/16"), "read");
  assert.equal(routeToTab("/sirach/prologue"), "read");
});

test("routeToTab — search / bookmarks routes", () => {
  const routeToTab = loadRouteToTab();
  assert.equal(routeToTab("/search"), "search");
  assert.equal(routeToTab("/bookmarks"), "bookmarks");
});

test("routeToTab — notes list and editor", () => {
  const routeToTab = loadRouteToTab();
  assert.equal(routeToTab("/notes"), "notes");
  assert.equal(routeToTab("/notes/abc123"), "notes");
});

test("routeToTab — query string is ignored", () => {
  const routeToTab = loadRouteToTab();
  assert.equal(routeToTab("/search?q=love&page=2"), "search");
  assert.equal(routeToTab("/john/3?resume=1"), "read");
});

test("routeToTab — empty / falsy path defaults to reading", () => {
  const routeToTab = loadRouteToTab();
  assert.equal(routeToTab(""), "read");
  assert.equal(routeToTab(undefined), "read");
});

test("routeToTab — a book literally named like a tab is still reading", () => {
  // Only exact '/search' & '/bookmarks' (and '/notes' prefix) are special;
  // a deeper path such as a hypothetical book id does not collide.
  const routeToTab = loadRouteToTab();
  assert.equal(routeToTab("/searching"), "read");
  assert.equal(routeToTab("/notesomething"), "read");
});
