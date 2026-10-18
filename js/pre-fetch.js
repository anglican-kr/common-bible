// @ts-check

// Start fetching books.json immediately to avoid waiting for app.js to load.
//
// This file stays as a classic script (no `export {};` marker, no
// `<script type="module">`) — see ADR-019 §"예외". `<head>` non-defer
// loading lets the books.json fetch start before DOM parsing finishes; ESM
// would force automatic deferred execution and lose that head-start.
window.booksPromise = fetch("/data/books.json").then(res => {
  if (!res.ok) throw new Error("Failed to pre-fetch books.json");
  return res.json();
});

// A deep link to the calendar tab or the lectionary view (a shared
// /lectionary/<date>, say) starts fetching that view's modules here, with the
// boot, for the same head-start. routing.js loads them with import() only once
// route() runs after DOMContentLoaded, which on a cold first visit queued the
// module round trip behind the whole boot — the view drew later than when the
// modules were boot tags (Slow 4G +158-198 ms, PR #355 review 2026-10-18). A
// modulepreload fills the module map entry import() then asks for, so nothing
// is fetched twice; a browser without it (before Safari 17 · Firefox 115)
// ignores the hint and loads as before. Each list equals routing.js's at-once
// group for that view — tests/unit/sw.test.js checks it. Keyed by the first
// path segment; a Map so a segment like "constructor" finds nothing.
{
  const LAZY_VIEW_MODULES = new Map([
    ["calendar", ["/js/app/calendar.js", "/js/app/lectionary.js", "/js/app/liturgical-engine.js"]],
    ["lectionary", ["/js/app/lectionary.js", "/js/app/liturgical-engine.js"]],
  ]);
  for (const href of LAZY_VIEW_MODULES.get(location.pathname.split("/")[1]) ?? []) {
    const link = document.createElement("link");
    link.rel = "modulepreload";
    link.href = href;
    document.head.appendChild(link);
  }
}
