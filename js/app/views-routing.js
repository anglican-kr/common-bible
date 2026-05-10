"use strict";
// @ts-check

// Phase 7a of the app.js modularization (ADR-018). Owns:
//  - Data fetching (loadBooks / loadVersion / loadChapter / loadPrologue)
//    + module-level caches (booksCache, appVersion) that feed everything else.
//  - Rendering helpers (setTitle / setBreadcrumb / division pickers /
//    breadcrumb builder) + division constants and book-order resolution
//    (canonical vs vulgate ordering).
//  - Pull-to-refresh gesture (page-level mobile, ADR-010 follow-up).
//  - Compact Header on Scroll (collapses breadcrumb past 60px scroll).
//
// Views, Routing, Audio Player join this module in Phase 7b; the file name
// reflects that destination.

/** @typedef {import("../types").BooksData} BooksData */
/** @typedef {import("../types").BookEntry} BookEntry */
/** @typedef {import("../types").BibleChapter} BibleChapter */
/** @typedef {import("../types").BiblePrologue} BiblePrologue */

const { _$, el, clearNode, chUnit, trapFocus } = window.appHelpers;
const { loadBookOrder } = window.appStorage;

// DOM anchors. Redeclared locally so views-routing.js is self-contained.
const $title = _$("page-title");
const $breadcrumb = _$("breadcrumb");

// Mirrors app.js's DATA_DIR — Phase 7b's audio player still uses the same
// constant in app.js until that section moves here as well.
const DATA_DIR = "/data";

// Module state — both caches are read by Phase 7b territory in app.js
// (Views/Routing) via `window.getBooksCache()` and `window.appVersion`.
/** @type {BooksData | null} */
let booksCache = null;
/** @type {string | null} */
let appVersion = null;

// ── Pull-to-refresh (mobile, page-level) ─────────────────────────────────────
// Drag-down gesture at the top of the page triggers Drive bookmark sync, the
// same operation visibilitychange→visible runs. The touchmove listener is
// non-passive (we preventDefault to suppress the rubber-band overscroll), so
// it is attached only for the duration of an active pull to keep the global
// scrolling fast path passive everywhere else.
(function setupPullToRefresh() {
  const PULL_THRESHOLD_PX  = 70;   // distance past which release triggers sync
  const PULL_MAX_PX        = 110;  // visual cap on indicator drop
  const PULL_RESISTANCE    = 0.5;  // 1px finger movement → 0.5px indicator drop
  const SYNC_FEEDBACK_MS   = 900;  // how long the spinner stays after trigger
  // Modal/sheet roots whose internal scroll must not be hijacked by PTR. We
  // walk e.target to see if the touch landed inside one of these.
  const MODAL_SELECTORS = "#bookmark-drawer, #search-sheet, #install-modal, #bm-save-modal, #bm-new-folder-modal, #bm-import-modal, #bm-merge-modal, #drive-disconnect-modal, .settings-popover, .chapter-popover, .bc-division-popover, .title-division-popover";

  /** @type {HTMLElement | null} */
  let indicator = null;
  /** @type {HTMLElement | null} */
  let scrim = null;
  let startY = 0;
  let delta = 0;
  let active = false;
  let syncing = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let resetCleanupTimer = null;

  // Inline styles always beat non-`!important` CSS, so the
  // `@media (prefers-reduced-motion: reduce)` block in style.css cannot
  // override `style.transition = "transform .25s ease, …"` we set below.
  // Gate the transition strings here in JS to honor the user preference.
  const _reducedMotionMQL = window.matchMedia("(prefers-reduced-motion: reduce)");
  function prefersReducedMotion() { return _reducedMotionMQL.matches; }

  function ensureIndicator() {
    if (indicator) return indicator;
    scrim = document.createElement("div");
    scrim.id = "pull-refresh-scrim";
    scrim.setAttribute("aria-hidden", "true");
    document.body.appendChild(scrim);
    indicator = document.createElement("div");
    indicator.id = "pull-refresh-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML =
      '<svg class="ptr-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M21 12a9 9 0 1 1-2.64-6.36"/>' +
      '</svg>';
    document.body.appendChild(indicator);
    return indicator;
  }

  function setVisual(d) {
    const ind = ensureIndicator();
    const dropped = Math.min(d, PULL_MAX_PX);
    const progress = Math.min(d / PULL_THRESHOLD_PX, 1);
    // Force transition off during finger drag so motion tracks 1:1. Without
    // this, a lingering ease curve from a previous resetVisual would make the
    // indicator slide rather than follow the finger.
    ind.style.transition = "none";
    ind.style.transform = `translateX(-50%) translateY(${dropped}px)`;
    ind.style.opacity = String(progress);
    const rot = progress * 270;
    const icon = ind.querySelector(".ptr-icon");
    if (icon) /** @type {SVGElement} */ (icon).style.transform = `rotate(${rot}deg)`;
  }

  function resetVisual(animated) {
    const ind = ensureIndicator();
    // Cancel any pending cleanup from a previous reset so a fast second pull
    // doesn't have its `ptr-loading` class stripped (or its transition string
    // overwritten) by a stale timer.
    if (resetCleanupTimer !== null) {
      clearTimeout(resetCleanupTimer);
      resetCleanupTimer = null;
    }
    const smooth = animated && !prefersReducedMotion();
    ind.style.transition = smooth ? "transform .25s ease, opacity .2s ease" : "none";
    ind.style.transform = "translateX(-50%) translateY(0)";
    ind.style.opacity = "0";
    if (scrim) scrim.classList.remove("ptr-scrim-visible");
    if (smooth) {
      resetCleanupTimer = setTimeout(() => {
        resetCleanupTimer = null;
        ind.style.transition = "none";
        ind.classList.remove("ptr-loading");
      }, 260);
    } else {
      ind.classList.remove("ptr-loading");
    }
  }

  function eligibleAt(target) {
    if (syncing) return false;
    if (!window.matchMedia("(max-width: 768px)").matches) return false;
    if (window.scrollY > 0) return false;
    if (target instanceof Element && target.closest(MODAL_SELECTORS)) return false;
    return true;
  }

  function onMove(e) {
    if (!active || e.touches.length !== 1) return;
    const raw = e.touches[0].clientY - startY;
    if (raw <= 0) {
      // User reversed direction — let normal scroll resume.
      active = false;
      delta = 0;
      detachMoveEnd();
      resetVisual(true);
      return;
    }
    delta = raw * PULL_RESISTANCE;
    setVisual(delta);
    if (e.cancelable) e.preventDefault();
  }

  function onEnd() {
    if (!active) return;
    const triggered = delta >= PULL_THRESHOLD_PX;
    active = false;
    detachMoveEnd();
    if (triggered) trigger(); else resetVisual(true);
  }

  function onCancel() {
    if (!active) return;
    active = false;
    detachMoveEnd();
    resetVisual(true);
  }

  function attachMoveEnd() {
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
  }

  function detachMoveEnd() {
    document.removeEventListener("touchmove", onMove, /** @type {any} */ ({ passive: false }));
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onCancel);
  }

  function trigger() {
    syncing = true;
    const ind = ensureIndicator();
    // Cancel any pending resetVisual cleanup so it doesn't fire mid-spinner
    // and strip the `ptr-loading` class we just added.
    if (resetCleanupTimer !== null) {
      clearTimeout(resetCleanupTimer);
      resetCleanupTimer = null;
    }
    ind.classList.add("ptr-loading");
    if (scrim) scrim.classList.add("ptr-scrim-visible");
    ind.style.transition = prefersReducedMotion() ? "none" : "transform .2s ease";
    ind.style.transform = `translateX(-50%) translateY(${PULL_THRESHOLD_PX}px)`;
    ind.style.opacity = "1";
    const sync = window.driveSync;
    if (sync?.isAuthenticated?.()) {
      sync.requestSync();
    } else if (sync?.isEnabled?.()) {
      window._showSyncSnackbar?.("Google Drive 재연결이 필요합니다.");
    } else {
      window._showSyncSnackbar?.("Google Drive 동기화가 꺼져 있습니다.");
    }
    setTimeout(() => {
      syncing = false;
      resetVisual(true);
    }, SYNC_FEEDBACK_MS);
  }

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    if (!eligibleAt(e.target)) return;
    active = true;
    delta = 0;
    startY = e.touches[0].clientY;
    attachMoveEnd();
  }, { passive: true });
})();

// Search history helpers were extracted to js/app/storage.js
// (ADR-018 Phase 2). The BEGIN/END markers + tests/unit/storage.test.js
// follow the new location.

// `loadStartupBehavior`, `saveStartupBehavior`, `loadFontSize`, `saveFontSize`
// were extracted to js/app/storage.js (ADR-018 Phase 2).

// ── Data fetching ──
// ── BEGIN DATA_FETCHING ──
// Exercised by tests/unit/views-routing.test.js. The 4 functions are
// fetch wrappers with caching: loadBooks/loadVersion update module state
// (booksCache/appVersion); loadChapter/loadPrologue are pure pass-throughs.
// Test loader provides `fetch` stub + booksCache/appVersion state in prelude.

/** @returns {Promise<BooksData>} */
async function loadBooks() {
  if (booksCache) return booksCache;
  // Use pre-fetched promise if available
  const promise = window.booksPromise || fetch(`${DATA_DIR}/books.json`).then((res) => {
    if (!res.ok) throw new Error("Failed to load books.json");
    return res.json();
  });
  const data = await promise;
  booksCache = data;
  return data;
}

/** @returns {Promise<string>} */
async function loadVersion() {
  if (appVersion) return appVersion;
  try {
    const res = await fetch("/version.json");
    const data = await res.json();
    appVersion = data.version;
  } catch {
    appVersion = "";
  }
  // Mirror to window so settings-ui.js can read it (ADR-018 Phase 3).
  // Will move into js/app/data-fetching.js (Phase 7) along with loadVersion.
  window.appVersion = appVersion;
  return appVersion ?? "";
}

/**
 * @param {string} bookId
 * @param {number} chapter
 * @returns {Promise<BibleChapter>}
 */
async function loadChapter(bookId, chapter) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-${chapter}.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-${chapter}.json`);
  return res.json();
}

/** @param {string} bookId @returns {Promise<BiblePrologue>} */
async function loadPrologue(bookId) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-prologue.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-prologue.json`);
  return res.json();
}
// ── END DATA_FETCHING ──

// ── Rendering helpers ──

// ── BEGIN TITLE ──
// Exercised by tests/unit/views-routing.test.js with a tiny $title stub
// + el / clearNode / announce shims provided by the loader prelude.
function setTitle(text) {
  clearNode($title);
  $title.appendChild(document.createTextNode(text));
  document.title = text === "공동번역성서" ? text : `${text} — 공동번역성서`;
  announce(text);
}
// ── END TITLE ──

function setTitleWithDivisionPicker(activeDivision) {
  clearNode($title);
  const labels = divisionLabels();
  const order = divisionOrder();
  const label = labels[activeDivision];
  document.title = `${label} — 공동번역성서`;
  announce(label);

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": "구분 선택", "aria-expanded": "false" },
    label
  );

  const popover = el("ul", { className: "bc-division-popover title-division-popover", role: "listbox", "aria-label": "구분 선택" });
  popover.hidden = true;

  for (const div of order) {
    const cls = div === activeDivision ? "bc-division-item active" : "bc-division-item";
    popover.appendChild(el("li", null, el("a", { className: cls, href: `/${div}` }, labels[div])));
  }

  /** @type {(() => void) | null} */
  let cleanupTrap = null;

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    if (!open) {
      cleanupTrap = trapFocus(popover);
      const first = /** @type {HTMLElement | null} */ (popover.querySelector('a[href]'));
      if (first) first.focus();
    } else if (cleanupTrap) {
      cleanupTrap(); cleanupTrap = null;
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!popover.hidden && t instanceof Node && !$title.contains(t)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  popover.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.tagName === "A") {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  $title.appendChild(btn);
  $title.appendChild(popover);
}

/**
 * @param {BookEntry} book
 * @param {number} currentCh
 */
function setTitleWithChapterPicker(book, currentCh) {
  clearNode($title);
  const unit = chUnit(book.id);
  document.title = `${book.name_ko} ${currentCh}${unit} — 공동번역성서`;
  announce(`${book.name_ko} ${currentCh}${unit}`);

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": `${unit} 선택`, "aria-expanded": "false" },
    `${book.name_ko} ${currentCh}${unit}`
  );

  const popover = el("div", { className: "chapter-popover", role: "listbox", "aria-label": `${unit} 선택` });
  popover.hidden = true;

  const grid = el("div", { className: "popover-grid" });
  if (book.has_prologue) {
    grid.appendChild(
      el("a", { className: "popover-item popover-prologue", href: `/${book.id}/prologue` }, "머리말")
    );
  }
  for (let i = 1; i <= book.chapter_count; i++) {
    const cls = i === currentCh ? "popover-item current" : "popover-item";
    grid.appendChild(el("a", { className: cls, href: `/${book.id}/${i}` }, String(i)));
  }
  popover.appendChild(grid);

  /** @type {(() => void) | null} */
  let cleanupTrap = null;

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    if (!open) {
      cleanupTrap = trapFocus(popover);
      const first = /** @type {HTMLElement | null} */ (popover.querySelector('a[href]'));
      if (first) first.focus();
    } else if (cleanupTrap) {
      cleanupTrap(); cleanupTrap = null;
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!popover.hidden && t instanceof Node && !$title.contains(t)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  popover.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.tagName === "A") {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  $title.appendChild(buildBackBtn(`${book.name_ko} 목록으로`, `/${book.id}`));
  $title.appendChild(btn);
  $title.appendChild(popover);
  $title.appendChild(buildBookmarkHeaderBtn(book.id, currentCh));
}

// ── BEGIN BREADCRUMB ──
// Exercised by tests/unit/views-routing.test.js. setBreadcrumb walks the
// crumbs array and emits one <a>/<span> per entry (with " › " separators);
// buildDivisionBreadcrumb is a small <a href="/${div}"> builder.
function setBreadcrumb(crumbs) {
  clearNode($breadcrumb);
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = el("span", { className: "sep", "aria-hidden": "true" }, "›");
      $breadcrumb.appendChild(sep);
    }
    if (c.href) {
      $breadcrumb.appendChild(el("a", { href: c.href }, c.label));
    } else if (c.divisionPicker) {
      $breadcrumb.appendChild(buildDivisionBreadcrumb(c.label, c.activeDivision));
    } else {
      $breadcrumb.appendChild(el("span", null, c.label));
    }
  });
}

function buildDivisionBreadcrumb(label, activeDivision) {
  return el("a", { href: `/${activeDivision}` }, label);
}
// ── END BREADCRUMB ──

// ── BEGIN DIVISION ──
// Exercised by tests/unit/views-routing.test.js. Pure: loadBookOrder() is
// the only side-effect (provided as a stub by the loader prelude).
const DIVISION_LABELS = {
  old_testament: "구약",
  deuterocanon: "외경",
  new_testament: "신약",
};

const DIVISION_ORDER = ["old_testament", "deuterocanon", "new_testament"];

// Old Testament subcategories (also covers deuterocanon books for vulgate mode)
const OT_SUBCATEGORY = {
  gen: "pentateuch", exod: "pentateuch", lev: "pentateuch", num: "pentateuch", deut: "pentateuch",
  josh: "history", judg: "history", ruth: "history",
  "1sam": "history", "2sam": "history", "1kgs": "history", "2kgs": "history",
  "1chr": "history", "2chr": "history", ezra: "history", neh: "history",
  tob: "history", jdt: "history", esth: "history", "1macc": "history", "2macc": "history",
  job: "wisdom", ps: "wisdom", prov: "wisdom", eccl: "wisdom", song: "wisdom",
  wis: "wisdom", sir: "wisdom",
  isa: "prophets", jer: "prophets", lam: "prophets", bar: "prophets",
  ezek: "prophets", dan: "prophets", hos: "prophets", joel: "prophets", amos: "prophets",
  obad: "prophets", jonah: "prophets", mic: "prophets", nah: "prophets", hab: "prophets",
  zeph: "prophets", hag: "prophets", zech: "prophets", mal: "prophets",
};
const OT_SUBCATEGORY_ORDER = ["pentateuch", "history", "wisdom", "prophets"];
const OT_SUBCATEGORY_LABELS = {
  pentateuch: "오경",
  history: "역사서",
  wisdom: "시서와 지혜서",
  prophets: "예언서",
};

const VULGATE_DIVISION_LABELS = {
  old_testament: "구약",
  new_testament: "신약",
};

const VULGATE_DIVISION_ORDER = ["old_testament", "new_testament"];

// Returns the appropriate labels/order for the current book-order setting
function divisionLabels() {
  return loadBookOrder() === "vulgate" ? VULGATE_DIVISION_LABELS : DIVISION_LABELS;
}
function divisionOrder() {
  return loadBookOrder() === "vulgate" ? VULGATE_DIVISION_ORDER : DIVISION_ORDER;
}

// In vulgate mode, deuterocanon books are grouped under old_testament
function effectiveDivision(book) {
  if (loadBookOrder() === "vulgate" && book.division === "deuterocanon") return "old_testament";
  return book.division;
}
// ── END DIVISION ──

// ── Compact Header on Scroll ──
// Deferred: not needed until after first render and first scroll.

function initCompactHeader() {
  const header = _$("app-header");
  const THRESHOLD_ON = 60;   // collapse breadcrumb when scrolling down past this
  const THRESHOLD_OFF = 10;  // restore breadcrumb only when near the very top
  let isCompact = false;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (!isCompact && y > THRESHOLD_ON) {
      isCompact = true;
      header.classList.add("compact");
    } else if (isCompact && y < THRESHOLD_OFF) {
      isCompact = false;
      header.classList.remove("compact");
    }
  }, { passive: true });
}

// ── Window facade ──
// Both an `appViewsRouting` aggregate and per-name globals so app.js's
// Phase 7b territory (Views/Routing/Audio Player) can call setTitle / loadBooks
// / divisionLabels etc. as bare globals. `window.appVersion` is mirrored by
// `loadVersion` for settings-ui.js (Phase 3 owner) which reads it for the
// version footer.

const appViewsRouting = {
  loadBooks, loadVersion, loadChapter, loadPrologue,
  setTitle, setBreadcrumb, setTitleWithDivisionPicker, setTitleWithChapterPicker,
  buildDivisionBreadcrumb, divisionLabels, divisionOrder, effectiveDivision,
  initCompactHeader,
};
window.appViewsRouting = appViewsRouting;

window.loadBooks = loadBooks;
window.loadVersion = loadVersion;
window.loadChapter = loadChapter;
window.loadPrologue = loadPrologue;
window.setTitle = setTitle;
window.setBreadcrumb = setBreadcrumb;
window.setTitleWithDivisionPicker = setTitleWithDivisionPicker;
window.setTitleWithChapterPicker = setTitleWithChapterPicker;
window.buildDivisionBreadcrumb = buildDivisionBreadcrumb;
window.divisionLabels = divisionLabels;
window.divisionOrder = divisionOrder;
window.effectiveDivision = effectiveDivision;
window.initCompactHeader = initCompactHeader;
window.getBooksCache = () => booksCache;

// Constants exposed for app.js's Phase 7b territory (Views/Routing) — bare
// global reads. Migrates out when those callers move into this module in 7b.
window.DIVISION_LABELS = DIVISION_LABELS;
window.OT_SUBCATEGORY = OT_SUBCATEGORY;
window.OT_SUBCATEGORY_ORDER = OT_SUBCATEGORY_ORDER;
window.OT_SUBCATEGORY_LABELS = OT_SUBCATEGORY_LABELS;

export {
  loadBooks, loadVersion, loadChapter, loadPrologue,
  setTitle, setBreadcrumb, setTitleWithDivisionPicker, setTitleWithChapterPicker,
  buildDivisionBreadcrumb, divisionLabels, divisionOrder, effectiveDivision,
  initCompactHeader,
};
