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

// ── Launch screen: line the cross up with the iOS startup image (ADR-007 §8) ──
// iOS shows the startup image (assets/splash) over the whole screen, then the page's #launch-screen. The home screen
// app's page usually starts below the status bar, so the launch screen's center sits half the status bar lower than
// the image's and the cross dropped at the handoff (seen on an iPhone, 2026-11-20). Measured here, before the page's
// first paint: the screen's height less the page's is the status bar (the page reaches the bottom edge), and the cross
// moves up by half of it (`--launch-shift`, css/style.css `#launch-screen svg`). Only the iOS home screen app in
// portrait, in a window as wide as the screen: the startup images are portrait and full screen, in Safari the gap is
// the browser's own bars, and an iPad window beside another app (Split View, Stage Manager) gets no image. When iOS
// draws the page under the status bar the gap is 0 and nothing moves.
/**
 * How far to move the launch screen's cross up, in CSS px; 0 when it should not move.
 * @param {boolean} standalone  the iOS home screen app (`navigator.standalone`)
 * @param {number} innerW  the page's width
 * @param {number} innerH  the page's height
 * @param {number} screenW  the screen's width (iOS reports the portrait width)
 * @param {number} screenH  the screen's height (iOS reports the portrait height)
 * @returns {number}
 */
function launchShift(standalone, innerW, innerH, screenW, screenH) {
  if (!standalone || innerH <= innerW || innerW !== screenW) return 0;
  const gap = screenH - innerH;
  // A status bar is under 100px; anything else is not one (a page still sizing, a bar we do not know)
  return gap > 0 && gap < 100 ? gap / 2 : 0;
}

try {
  const shift = launchShift(/** @type {Navigator & { standalone?: boolean }} */ (navigator).standalone === true,
    window.innerWidth, window.innerHeight, window.screen.width, window.screen.height);
  if (shift) document.documentElement.style.setProperty("--launch-shift", `${shift}px`);
} catch { /* the launch screen stays centered */ }
