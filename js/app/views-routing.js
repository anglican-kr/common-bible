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
const {
  loadBookOrder, loadStartupBehavior,
  loadReadingPosition, saveReadingPosition, clearReadingPosition,
  loadAudioTime, saveAudioTime, clearAudioTime,
  _maybeRequestPersist,
} = window.appStorage;
const { dismissLaunchScreen } = window.appSettings;
const { readingContext } = window;

// DOM anchors. Redeclared locally so views-routing.js is self-contained.
const $app = _$("app");
const $title = _$("page-title");
const $breadcrumb = _$("breadcrumb");
const $audioBar = _$("audio-bar");
const $resumeBannerSlot = _$("resume-banner-slot");
const $searchInput = /** @type {HTMLInputElement} */ (_$("search-input"));
const $searchClear = _$("search-clear");
const $searchBar = _$("search-bar");
const $searchFab = _$("search-fab");

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

// ── BEGIN POPOVER ──
// Exercised by tests/unit/views-routing.test.js. setTitleWithDivisionPicker
// + setTitleWithChapterPicker render a button that toggles a popover (focus
// trap inside, click-outside-to-close, click-on-link-to-close). The two
// share the same open/close contract.
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
// ── END POPOVER ──

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

// ── BEGIN COMPACT_HEADER ──
// Exercised by tests/unit/views-routing.test.js. Hysteretic toggle:
// scrolling past 60px adds .compact to #app-header; only when returning
// near the top (<10px) do we remove it. Listener is passive — no
// preventDefault — so it cannot block scrolling.
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
// ── END COMPACT_HEADER ──


// ── Phase 7b additions ──
// Views (renderBookList / renderDivisionList / renderChapter / etc.),
// Routing (parsePath / route / navigate + popstate listener),
// Audio Player. State vars + startScrollTracking from former app.js
// Reading position section also live here since they are Routing-internal.

// Audio Player module state (was app.js L112-L116).
let currentAudio = null;
/** @type {AbortController | null} */
let _audioController = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _audioSaveTimer = null;
let _scrollTrackCleanup = null;
let _isInitialLoad = true;
function startScrollTracking(bookId, chapter) {
  if (_scrollTrackCleanup) _scrollTrackCleanup();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const handler = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      const verses = document.querySelectorAll(".verse[data-vref]");
      /** @type {number | null} */
      let currentVerse = null;
      for (const v of verses) {
        const n = parseInt(v.getAttribute("data-vref") ?? "", 10);
        if (!Number.isFinite(n)) continue;
        const top = v.getBoundingClientRect().top;
        if (top <= 80) {
          currentVerse = n;
        } else {
          break;
        }
      }
      if (currentVerse !== null) saveReadingPosition(bookId, chapter, currentVerse);
    }, 500);
  };
  window.addEventListener("scroll", handler, { passive: true });
  _scrollTrackCleanup = () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("scroll", handler);
    _scrollTrackCleanup = null;
  };
}

// ── Views ──

function renderBookList(books) {
  setTitle("공동번역성서");
  $title.appendChild(buildBookmarkHeaderBtn(null, null));
  setBreadcrumb([]);
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  const labels = divisionLabels();
  const order = divisionOrder();

  const grouped = {};
  for (const b of books) {
    const key = effectiveDivision(b);
    (grouped[key] ??= []).push(b);
  }

  for (const div of order) {
    const list = grouped[div];
    if (!list) continue;

    const details = el("details", { className: "division", open: "" });
    details.appendChild(el("summary", { className: "division-title" }, labels[div]));

    if (div === "old_testament") {
      // Group OT books into subcategories
      const subGrouped = {};
      for (const b of list) {
        const sub = OT_SUBCATEGORY[b.id] ?? "other";
        (subGrouped[sub] ??= []).push(b);
      }
      for (const sub of OT_SUBCATEGORY_ORDER) {
        const subList = subGrouped[sub];
        if (!subList) continue;
        const section = el("div", { className: "ot-subcategory" });
        section.appendChild(el("h3", { className: "ot-subcategory-title" }, OT_SUBCATEGORY_LABELS[sub]));
        const ul = el("ul", { className: "book-list", role: "list" });
        for (const b of subList) {
          ul.appendChild(el("li", null, el("a", { href: `/${b.id}` }, b.name_ko)));
        }
        section.appendChild(ul);
        details.appendChild(section);
      }
    } else {
      const ul = el("ul", { className: "book-list", role: "list" });
      for (const b of list) {
        ul.appendChild(el("li", null, el("a", { href: `/${b.id}` }, b.name_ko)));
      }
      details.appendChild(ul);
    }
    $app.appendChild(details);
  }
}

// `clearReadingPosition` was extracted to js/app/storage.js (ADR-018 Phase 2).

function renderResumeBanner(books) {
  const pos = loadReadingPosition();
  if (!pos) return;
  const lastBook = books.find((b) => b.id === pos.bookId);
  if (!lastBook) return;
  const isPrologue = pos.chapter === "prologue";
  const href = `/${pos.bookId}/${pos.chapter}?resume=1`;
  const label = isPrologue
    ? `이어읽기: ${lastBook.name_ko} 머리말`
    : `이어읽기: ${lastBook.name_ko} ${pos.chapter}${chUnit(lastBook.id)}`;

  const wrapper = el("div", { className: "resume-banner" });
  wrapper.appendChild(el("a", { className: "resume-banner-link", href }, label));

  const closeBtn = el("button", {
    className: "resume-banner-close",
    type: "button",
    "aria-label": "이어읽기 기록 삭제",
  }, "\u00d7");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearReadingPosition();
    wrapper.remove();
  });
  wrapper.appendChild(closeBtn);

  clearNode($resumeBannerSlot);
  $resumeBannerSlot.appendChild(wrapper);
}

function renderDivisionList(books, division) {
  setTitleWithDivisionPicker(division);
  $title.insertBefore(buildBackBtn("목록으로", "/"), $title.firstChild);
  $title.appendChild(buildBookmarkHeaderBtn(null, null));
  setBreadcrumb([{ label: "목록", href: "/" }]);
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  // In vulgate mode, old_testament division includes deuterocanon books (in file order)
  const list = (loadBookOrder() === "vulgate" && division === "old_testament")
    ? books.filter((b) => b.division !== "new_testament")
    : books.filter((b) => b.division === division);

  const details = el("details", { className: "division", open: "" });
  details.appendChild(el("summary", { className: "division-title" }, divisionLabels()[division]));

  if (division === "old_testament") {
    const subGrouped = {};
    for (const b of list) {
      const sub = OT_SUBCATEGORY[b.id] ?? "other";
      (subGrouped[sub] ??= []).push(b);
    }
    for (const sub of OT_SUBCATEGORY_ORDER) {
      const subList = subGrouped[sub];
      if (!subList) continue;
      const section = el("div", { className: "ot-subcategory" });
      section.appendChild(el("h3", { className: "ot-subcategory-title" }, OT_SUBCATEGORY_LABELS[sub]));
      const ul = el("ul", { className: "book-list", role: "list" });
      for (const b of subList) {
        ul.appendChild(el("li", null, el("a", { href: `/${b.id}` }, b.name_ko)));
      }
      section.appendChild(ul);
      details.appendChild(section);
    }
  } else {
    const ul = el("ul", { className: "book-list", role: "list" });
    for (const b of list) {
      ul.appendChild(el("li", null, el("a", { href: `/${b.id}` }, b.name_ko)));
    }
    details.appendChild(ul);
  }
  $app.appendChild(details);
}

function renderChapterList(book, books) {
  setTitle(book.name_ko);
  $title.insertBefore(buildBackBtn(`${divisionLabels()[effectiveDivision(book)]}으로`, `/${effectiveDivision(book)}`), $title.firstChild);
  $title.appendChild(buildBookmarkHeaderBtn(book.id, null));
  hideAudioBar();
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "/" },
    { divisionPicker: true, label: divisionLabels()[effDiv], activeDivision: effDiv },
  ]);
  clearNode($app);

  renderResumeBanner(books);

  const grid = el("div", { className: "chapter-grid" });

  if (book.has_prologue) {
    grid.appendChild(
      el("a", { className: "prologue-link", href: `/${book.id}/prologue` }, "머리말")
    );
  }

  for (let i = 1; i <= book.chapter_count; i++) {
    grid.appendChild(
      el("a", { href: `/${book.id}/${i}`, "aria-label": `${book.name_ko} ${i}${chUnit(book.id)}` }, String(i))
    );
  }

  $app.appendChild(grid);
}

// ── BEGIN VERSE_NUMBER ──
// Exercised by tests/unit/views-routing.test.js. Pure: derives the displayed
// verse label/number from a verse object — no DOM, no global state.

function formatVerseLabel(v) {
  let label = String(v.number);
  if (v.part) label += v.part;
  if (v.range_end) label += `-${v.range_end}`;
  return label;
}

// Display string for the verse-number marker (rendered via CSS ::before).
// LXX-only verses ([_N]) show the LXX number in parens; dual-numbered verses
// ([N_M]) append the LXX number in parens; cross-chapter refs prefix the
// original chapter number.
function formatVerseNumber(v) {
  const label = formatVerseLabel(v);
  if (v.lxx_only) return `(${label})`;
  let dataV = v.chapter_ref ? `${v.chapter_ref}:${label}` : label;
  if (v.alt_ref != null) dataV += `(${v.alt_ref})`;
  return dataV;
}
// ── END VERSE_NUMBER ──

// ── BEGIN VERSE_SELECTION ──
// Exercised by tests/unit/views-routing.test.js. DOM-pure: reads classList +
// data-vref from a passed article node, no global state, no event bindings.

// Pure-poetry multi-part verses (e.g. Psalms, Proverbs, Wisdom books) are
// treated as a single selection unit: tapping one line selects/deselects the
// whole verse. Prose-only or mixed (poetry+prose) multi-part verses, plus
// single-span verses, keep per-line control.
//
// Returns the array of data-vref values that should be toggled together with
// `vref`. For pure-poetry multi-part verses this is every part of the verse
// number; otherwise just [vref].
/**
 * @param {ParentNode | null | undefined} article
 * @param {string} vref
 * @returns {string[]}
 */
function _verseSelectionUnit(article, vref) {
  if (!article) return [vref];
  const m = vref.match(/^(\d+)/);
  const num = m ? m[1] : vref;
  /** @type {Element[]} */
  const parts = [];
  for (const v of article.querySelectorAll(".verse[data-vref]")) {
    const r = v.getAttribute("data-vref") ?? "";
    const rm = r.match(/^(\d+)/);
    if ((rm ? rm[1] : r) === num) parts.push(v);
  }
  if (parts.length > 1 && parts.every((p) => p.classList.contains("verse-poetry"))) {
    return parts.map((p) => p.getAttribute("data-vref") ?? "");
  }
  return [vref];
}
// ── END VERSE_SELECTION ──

function renderChapter(data, book, opts) {
  const ch = data.chapter;
  const hlQuery = opts && opts.highlightQuery;
  const hlVerse = opts && opts.highlightVerse;
  let hlVerseEnd = opts && opts.highlightVerseEnd;
  const hlVerseSpec = opts && opts.highlightVerseSpec;
  let hlSegments = hlVerseSpec ? parseVerseSpec(hlVerseSpec) : null;

  // Compute max verse number once; used by both clipping paths below.
  let _maxVerse = 0;
  for (const v of data.verses) {
    const vn = v.range_end != null ? v.range_end : v.number;
    if (vn > _maxVerse) _maxVerse = vn;
  }

  // ── Single simple range: clip hlVerseEnd to chapter max ──
  // e.g. "창세 3:1-100" → "창세 3:1-24"
  if (hlVerseEnd && !hlSegments) {
    if (hlVerseEnd > _maxVerse) {
      hlVerseEnd = _maxVerse;
      const pathMatch = location.pathname.match(/^(\/[^/]+\/\d+\/\d+)-\d+$/);
      if (pathMatch) {
        history.replaceState(null, "", `${pathMatch[1]}-${_maxVerse}${location.search}`);
      }
    }
  }
  // Drop a single verse that is entirely out of range (works for both simple and range URLs).
  if (!hlSegments && hlVerse > _maxVerse) {
    const pathMatch = location.pathname.match(/^(\/[^/]+\/\d+)\/\d+.*$/);
    if (pathMatch) history.replaceState(null, "", pathMatch[1] + location.search);
  }

  // ── Multi-segment: clamp integer segments to chapter max; drop out-of-range.
  // Alpha-part segments (e.g. {start:3,end:3,part:"a"}) are kept as-is since
  // they don't extend beyond a single verse.
  if (hlSegments) {
    const clamped = hlSegments
      .map(s => s.part ? s : { start: s.start, end: Math.min(s.end, _maxVerse) })
      .filter(s => s.start <= _maxVerse);
    const pathBase = location.pathname.match(/^(\/[^/]+\/\d+)/)?.[1];
    if (clamped.length === 0) {
      hlSegments = null;
      if (pathBase) history.replaceState(null, "", pathBase + location.search);
    } else {
      const serializeSeg = s => s.part ? `${s.start}${s.part}` : s.start === s.end ? `${s.start}` : `${s.start}-${s.end}`;
      const newSpec = clamped.map(serializeSeg).join(",");
      const needsRewrite = newSpec !== hlSegments.map(serializeSeg).join(",");
      hlSegments = clamped;
      if (needsRewrite && pathBase) {
        history.replaceState(null, "", `${pathBase}/${newSpec}${location.search}`);
      }
    }
  }

  setTitleWithChapterPicker(book, ch);
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "/" },
    { divisionPicker: true, label: divisionLabels()[effDiv], activeDivision: effDiv },
  ]);
  clearNode($app);

  if (data.has_dual_numbering) {
    $app.appendChild(
      el("p", { className: "dual-numbering-note" }, "※ 괄호 안 번호는 70인역 사본(그리스어)의 절 번호입니다.")
    );
  }

  const article = el("article", { className: "chapter-text", lang: "ko" });
  let isFirst = true;
  let prevVerseEndType = null;

  for (const v of data.verses) {
    const segs = v.segments || [{ type: "prose", text: v.text || "" }];

    // Inter-verse break
    // hemistich-break (no gap): only when both prev and current are poetry (stanza continuation)
    // paragraph-break (gap): prose→poetry transition, or ¶ marker
    const startsWithPoetry = segs[0]?.type === "poetry";
    if (!isFirst) {
      if (v.stanza_break) {
        article.appendChild(el("span", { className: "stanza-break", role: "presentation" }));
      } else if (startsWithPoetry && prevVerseEndType === "poetry") {
        article.appendChild(el("span", { className: "hemistich-break", role: "presentation" }));
      } else if (startsWithPoetry || segs[0]?.paragraph_break) {
        article.appendChild(el("span", { className: "paragraph-break", role: "presentation" }));
      }
    }

    const verseLabel = formatVerseLabel(v);
    let verseId = `v${v.number}`;
    if (v.part) verseId += v.part;
    if (v.alt_ref != null) verseId += `_${v.alt_ref}`;
    // LXX-only verses can share a number with a Hebrew verse in the same
    // chapter (e.g. Daniel 3); suffix keeps the DOM id unique.
    if (v.lxx_only) verseId += "_lxx";
    const baseClasses = v.chapter_ref ? "verse verse-cross-ref" : "verse";

    const vn = v.number;

    // Verse number (rendered via CSS ::before to exclude from clipboard)
    const dataV = formatVerseNumber(v);

    function appendSegText(target, raw) {
      const hasPilcrow = raw.startsWith("¶");
      if (hasPilcrow) {
        target.appendChild(el("span", { className: "pilcrow", "aria-hidden": "true" }, "¶"));
      }
      const textContent = hasPilcrow ? raw.replace(/^¶\s*/, "") : raw;
      appendTextWithHighlight(target, textContent + " ", hlQuery);
    }

    // Count total lines across all segments to determine if multi-part
    const totalLines = segs.reduce((n, s) => n + s.text.split("\n").filter(l => l !== "").length, 0);
    const isMultiPart = totalLines > 1;
    const partLetters = "bcdefghijklmnop";
    let partIdx = 0;
    let isFirstLine = true;
    let prevSegType = null;

    for (const seg of segs) {
      const isPoetry = seg.type === "poetry";
      const isSegChange = prevSegType !== null && prevSegType !== seg.type;
      const lines = seg.text.split("\n");

      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];

        if (line === "") {
          // Empty line from \n\n = mid-verse stanza break
          article.appendChild(el("span", { className: "stanza-break", role: "presentation" }));
          continue;
        }

        // Break before non-first lines
        if (!isFirstLine) {
          const breakClass = ((seg.paragraph_break || isSegChange) && li === 0) ? "paragraph-break"
            : isPoetry ? "hemistich-break" : "paragraph-break";
          article.appendChild(el("span", {
            className: breakClass,
            role: "presentation"
          }));
        }

        // Compute vref before classes so per-span highlight can use it.
        let vref;
        if (isFirstLine && !isMultiPart) {
          vref = verseLabel;
        } else if (isFirstLine) {
          vref = `${verseLabel}a`;
        } else {
          vref = `${verseLabel}${partLetters[partIdx]}`;
          partIdx++;
        }

        // Per-span highlight: alpha-part segments match only the specific span;
        // integer-range segments match all spans of that verse.
        const isHighlightedSpan = hlSegments
          ? hlSegments.some(s => s.part ? vref === `${s.start}${s.part}` : (vn >= s.start && vn <= s.end))
          : (hlVerse && vn >= hlVerse && vn <= (hlVerseEnd || hlVerse));

        let classes = baseClasses;
        if (isPoetry) classes += " verse-poetry";
        if (isHighlightedSpan) classes += " verse-highlight";

        const span = el("span", { className: classes });
        if (isFirstLine) {
          span.id = verseId;
          const sup = el("sup", { className: "verse-num", "aria-hidden": "true", "data-v": dataV });
          span.appendChild(sup);
          span.appendChild(document.createTextNode("\u2060"));
        }

        span.setAttribute("data-vref", vref);
        // Hanging punctuation: pull leading quote outside the indent.
        // Single quote is narrower, so it uses a smaller offset (see .hanging-quote--single).
        if (isPoetry && (line[0] === '"' || line[0] === "'")) {
          const cls = line[0] === '"' ? "hanging-quote" : "hanging-quote hanging-quote--single";
          span.appendChild(el("span", { className: cls }, line[0]));
          appendSegText(span, line.slice(1));
        } else {
          appendSegText(span, line);
        }
        article.appendChild(span);
        isFirstLine = false;
      }
      prevSegType = seg.type;
    }

    prevVerseEndType = segs[segs.length - 1]?.type;
    isFirst = false;
  }

  // Flatten inner corners between adjacent highlighted verses so a run from
  // a search/bookmark deep link renders as a single block.
  {
    const verses = [...article.querySelectorAll(".verse[data-vref]")];
    for (let i = 0; i < verses.length; i++) {
      const v = verses[i];
      if (!v.classList.contains("verse-highlight")) continue;
      if (i > 0 && verses[i - 1].classList.contains("verse-highlight")) {
        v.classList.add("verse-highlight-join-prev");
      }
      if (i < verses.length - 1 && verses[i + 1].classList.contains("verse-highlight")) {
        v.classList.add("verse-highlight-join-next");
      }
    }
  }

  // Track current chapter context for verse selection mode
  readingContext.bookId = book.id;
  readingContext.chapter = ch;

  // Announce verse number on click/tap for screen reader users,
  // or toggle verse selection when in select mode.
  article.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const vs = t.closest(".verse[data-vref]");
    if (!vs) return;
    if (readingContext.verseSelectMode) {
      e.stopPropagation(); // selection is handled by pointer events
      return;
    }
    announce(`${vs.getAttribute("data-vref")}절`);
  });

  // Long-press (300ms) to enter verse selection mode.
  // pointermove only cancels after >10px of movement to tolerate natural finger drift.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let _longPressTimer = null;
  let _longPressStartX = 0;
  let _longPressStartY = 0;

  article.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (readingContext.verseSelectMode) {
      const vs = t.closest(".verse[data-vref]");
      if (!vs) return;
      e.preventDefault(); // prevent text selection during drag
      const allVerses = /** @type {HTMLElement[]} */ ([...article.querySelectorAll(".verse[data-vref]")]);
      const startIdx = allVerses.indexOf(/** @type {HTMLElement} */ (vs));
      const startUnit = _verseSelectionUnit(article, vs.getAttribute("data-vref") ?? "");
      const isAdding = !startUnit.some((r) => readingContext.selectedVerses.has(r));
      readingContext.verseSelectDrag = { startIdx, allVerses, isAdding, moved: false, snapshot: new Set(readingContext.selectedVerses) };
      article.setPointerCapture(e.pointerId);
      return;
    }
    const vs = t.closest(".verse[data-vref]");
    if (!vs) return;
    _longPressStartX = e.clientX;
    _longPressStartY = e.clientY;
    _longPressTimer = setTimeout(() => {
      _longPressTimer = null;
      enterVerseSelectMode(book.id, ch);
      const vref = vs.getAttribute("data-vref");
      if (vref) {
        for (const r of _verseSelectionUnit(article, vref)) {
          readingContext.selectedVerses.add(r);
        }
        article.querySelectorAll(".verse[data-vref]").forEach((v) => {
          v.classList.toggle("verse-selected", readingContext.selectedVerses.has(v.getAttribute("data-vref") ?? ""));
        });
        updateVerseSelectionBoundaries(article);
        updateVerseSelectBar();
      }
    }, 300);
  });
  const cancelLongPress = (e) => {
    if (!_longPressTimer) return;
    if (e && e.type === "pointermove") {
      const dx = e.clientX - _longPressStartX;
      const dy = e.clientY - _longPressStartY;
      if (dx * dx + dy * dy < 100) return; // ignore drift < 10px
    }
    clearTimeout(_longPressTimer);
    _longPressTimer = null;
  };

  article.addEventListener("pointermove", (e) => {
    if (readingContext.verseSelectDrag) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const vs = /** @type {HTMLElement | null} */ (target && target.closest(".verse[data-vref]"));
      if (!vs) return;
      const { startIdx, allVerses, isAdding, snapshot } = readingContext.verseSelectDrag;
      const currentIdx = allVerses.indexOf(vs);
      if (currentIdx === -1) return;
      if (!readingContext.verseSelectDrag.moved && currentIdx === startIdx) return;
      readingContext.verseSelectDrag.moved = true;
      const [lo, hi] = startIdx <= currentIdx ? [startIdx, currentIdx] : [currentIdx, startIdx];
      readingContext.selectedVerses = new Set(snapshot);
      for (let i = lo; i <= hi; i++) {
        const vref = allVerses[i].getAttribute("data-vref") ?? "";
        if (isAdding) readingContext.selectedVerses.add(vref);
        else readingContext.selectedVerses.delete(vref);
      }
      // Pure-poetry verses are atomic: if any part falls in [lo, hi], extend
      // the toggle to all parts of that verse number.
      const seenNums = new Set();
      for (let i = lo; i <= hi; i++) {
        const vref = allVerses[i].getAttribute("data-vref") ?? "";
        const m = vref.match(/^(\d+)/);
        const num = m ? m[1] : vref;
        if (seenNums.has(num)) continue;
        seenNums.add(num);
        const unit = _verseSelectionUnit(article, vref);
        if (unit.length === 1) continue;
        if (isAdding) unit.forEach((r) => readingContext.selectedVerses.add(r));
        else unit.forEach((r) => readingContext.selectedVerses.delete(r));
      }
      allVerses.forEach((v) => {
        const vref = v.getAttribute("data-vref") ?? "";
        v.classList.toggle("verse-selected", readingContext.selectedVerses.has(vref));
      });
      updateVerseSelectionBoundaries(article);
      updateVerseSelectBar();
      return;
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointerup", (e) => {
    if (readingContext.verseSelectDrag) {
      if (!readingContext.verseSelectDrag.moved) {
        // Simple tap: toggle the verse's selection unit (whole verse for pure
        // poetry, single line otherwise).
        const vs = readingContext.verseSelectDrag.allVerses[readingContext.verseSelectDrag.startIdx];
        if (vs) {
          const vref = vs.getAttribute("data-vref") ?? "";
          const unit = _verseSelectionUnit(article, vref);
          if (readingContext.verseSelectDrag.isAdding) {
            unit.forEach((r) => readingContext.selectedVerses.add(r));
          } else {
            unit.forEach((r) => readingContext.selectedVerses.delete(r));
          }
          readingContext.verseSelectDrag.allVerses.forEach((v) => {
            v.classList.toggle("verse-selected", readingContext.selectedVerses.has(v.getAttribute("data-vref") ?? ""));
          });
          updateVerseSelectionBoundaries(article);
          updateVerseSelectBar();
        }
      }
      readingContext.verseSelectDrag = null;
      return;
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointercancel", (e) => {
    if (readingContext.verseSelectDrag) { readingContext.verseSelectDrag = null; return; }
    cancelLongPress(e);
  });

  // Copy handler: serialize the selection ourselves so that stanza breaks
  // become blank lines and the appended reference uses plain verse numbers
  // (no line-part letters like "1a"). Shared serializer lives in bookmark.js
  // (VERSE_SERIALIZE block) so this path and the 복사 button emit identical text.
  article.addEventListener("copy", (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    // Expand partial selections to full verse boundaries so a dragged-across
    // fragment still yields a complete citation.
    const range = sel.getRangeAt(0);
    let firstVerse = null;
    let lastVerse = null;
    for (const v of article.querySelectorAll(".verse")) {
      if (range.intersectsNode(v)) {
        if (!firstVerse) firstVerse = v;
        lastVerse = v;
      }
    }
    if (!firstVerse || !lastVerse) return;

    const firstNum = parseInt(firstVerse.getAttribute("data-vref") ?? "", 10);
    const lastNum = parseInt(lastVerse.getAttribute("data-vref") ?? "", 10);
    if (!Number.isFinite(firstNum) || !Number.isFinite(lastNum)) return;

    const plainText = window.serializeVerseRange(firstVerse, lastVerse);
    const ref = firstNum === lastNum
      ? `${book.name_ko} ${ch}:${firstNum}`
      : `${book.name_ko} ${ch}:${firstNum}-${lastNum}`;

    if (!e.clipboardData) return;
    e.clipboardData.setData("text/plain", `${plainText}\n\n— ${ref} (공동번역성서)`);
    e.preventDefault();
  });

  $app.appendChild(article);
  $app.appendChild(buildChapterNav(book, ch));
  showAudioPlayer(book.id, ch);
  observeFabLift();

  // Scroll to highlighted verse, resumed position, or top
  const scrollVerse = hlVerse || (opts && opts.resumeVerse) || null;
  if (scrollVerse) {
    const target = document.getElementById(`v${scrollVerse}`);
    if (target) {
      const behavior = hlVerse ? "smooth" : "instant";
      requestAnimationFrame(() => target.scrollIntoView({ behavior, block: hlVerse ? "center" : "start" }));
    }
  } else {
    window.scrollTo(0, 0);
  }
}

function renderPrologue(data, book) {
  setTitle(`${book.name_ko} 머리말`);
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "/" },
    { divisionPicker: true, label: divisionLabels()[effDiv], activeDivision: effDiv },
  ]);
  clearNode($app);

  const article = el("article", { className: "prologue-text", lang: "ko" });
  for (const p of data.paragraphs) {
    article.appendChild(el("p", null, p));
  }

  $app.appendChild(article);

  const nav = el("nav", { className: "chapter-nav", "aria-label": "장 이동" });
  nav.appendChild(el("span", { className: "placeholder" }));
  nav.appendChild(el("a", { href: `/${book.id}/1` }, `1${chUnit(book.id)} →`));
  $app.appendChild(nav);
  showAudioPlayer(book.id, 0);
  observeFabLift();
  window.scrollTo(0, 0);
}

function buildChapterNav(book, currentCh) {
  const unit = chUnit(book.id);
  const nav = el("nav", { className: "chapter-nav", "aria-label": `${unit} 이동` });

  if (currentCh > 1) {
    nav.appendChild(el("a", { href: `/${book.id}/${currentCh - 1}` }, `← ${currentCh - 1}${unit}`));
  } else if (book.has_prologue) {
    nav.appendChild(el("a", { href: `/${book.id}/prologue` }, "← 머리말"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  if (currentCh < book.chapter_count) {
    nav.appendChild(el("a", { href: `/${book.id}/${currentCh + 1}` }, `${currentCh + 1}${unit} →`));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  return nav;
}

function renderLoading() {
  clearNode($app);
  $app.appendChild(el("div", { className: "loading", "aria-live": "polite" }, "불러오는 중…"));
}

function renderError(msg) {
  clearNode($app);
  $app.appendChild(el("div", { className: "error", role: "alert" }, msg));
}

// ── Routing ──

function parsePath() {
  const pathname = location.pathname.replace(/^\//, "");
  if (!pathname) return { view: "books" };

  const query = new URLSearchParams(location.search || "");

  // Search route: /search?q=...&page=...
  if (pathname === "search") {
    return {
      view: "search",
      query: query.get("q") || "",
      page: parseInt(query.get("page") ?? "", 10) || 1,
    };
  }

  const parts = pathname.split("/");
  if (parts.length === 1) {
    if (DIVISION_LABELS[parts[0]]) return { view: "division", division: parts[0] };
    return { view: "chapters", bookId: parts[0] };
  }
  if (parts[1] === "prologue") return { view: "prologue", bookId: parts[0] };

  // Chapter view with optional verse deep-link: /john/3/16 or /john/3/16-20.
  // Multi-segment: /john/3/1-5,10-15  ?hl=... carries search-term highlight.
  const highlightQuery = query.get("hl") || null;
  let highlightVerse = null;
  let highlightVerseEnd = null;
  let highlightVerseSpec = null;

  if (parts[2]) {
    const spec = parts[2];
    const simpleMatch = spec.match(/^(\d+)(?:-(\d+))?$/);
    if (simpleMatch) {
      const v1 = parseInt(simpleMatch[1], 10);
      const v2 = simpleMatch[2] ? parseInt(simpleMatch[2], 10) : null;
      if (v1 > 0) {
        if (v2 && v2 > 0 && v2 !== v1) {
          highlightVerse = Math.min(v1, v2);
          highlightVerseEnd = Math.max(v1, v2);
        } else {
          highlightVerse = v1;
        }
      }
    } else if (/^[\d,\-a-z]+$/.test(spec)) {
      const segs = parseVerseSpec(spec);
      if (segs.length > 0) {
        // Sort ascending (by start, then part letter) and re-serialize for canonical URLs.
        segs.sort((a, b) => a.start !== b.start ? a.start - b.start : (a.part || "").localeCompare(b.part || ""));
        highlightVerseSpec = selectedVersesToSpec(
          segs.flatMap(s => s.part ? [`${s.start}${s.part}`] : Array.from({ length: s.end - s.start + 1 }, (_, i) => `${s.start + i}`))
        );
        highlightVerse = segs[0].start;
        highlightVerseEnd = segs[segs.length - 1].end;
      }
    }
  }

  return {
    view: "chapter",
    bookId: parts[0],
    chapter: parseInt(parts[1], 10),
    highlightQuery,
    highlightVerse,
    highlightVerseEnd,
    highlightVerseSpec,
    resume: query.has("resume"),
  };
}

/** @param {string} path */
function navigate(path) {
  history.pushState(null, "", path);
  route();
}

/** @param {{ title?: string, description?: string }} [opts] */
function updatePageMeta(opts = {}) {
  const { title, description } = opts;
  const fullTitle = title ? `${title} — 공동번역성서` : "공동번역성서";
  document.title = fullTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", description ?? "대한성공회 공동번역성서. 구약·신약 73권 전문을 오프라인에서도 읽을 수 있는 웹 앱.");
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", fullTitle);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", description ?? "대한성공회 공동번역성서. 구약·신약 73권 전문을 오프라인에서도 읽을 수 있는 웹 앱.");
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", `https://bible.anglican.kr${location.pathname}`);
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", `https://bible.anglican.kr${location.pathname}`);
}

function trackPageView() {
  if (typeof gtag !== "function") return;
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
  idle(() => {
    gtag("event", "page_view", {
      page_title: document.title,
      page_location: location.href,
      page_path: location.pathname + location.search,
    });
  });
}

async function route() {
  const isInitialLoad = _isInitialLoad;
  _isInitialLoad = false;
  if (_scrollTrackCleanup) _scrollTrackCleanup();
  clearNode($resumeBannerSlot);
  if (readingContext.verseSelectMode) exitVerseSelectMode();
  const parsed = parsePath();
  const { view, bookId, chapter, division } = parsed;

  // Sync search input with current route
  if (view === "search") {
    if (isMobile()) {
      // On mobile, redirect search route to overlay
      openSearchSheet(parsed.query);
      dismissLaunchScreen();
      return;
    }
    $searchInput.value = parsed.query ?? "";
    $searchClear.hidden = !parsed.query;
    $searchBar.dataset.clearHidden = String(!parsed.query);
  } else {
    $searchInput.value = "";
    $searchClear.hidden = true;
    $searchBar.dataset.clearHidden = "true";
  }

  try {
    if (view === "search") {
      if (parsed.query) {
        const autoNav = consumeSearchAutoNavigate();
        await renderSearchResults(parsed.query, parsed.page, autoNav);
        // If renderSearchResults auto-navigated to a chapter, the inner route() call
        // already handles meta and analytics for that view — don't overwrite.
        if (parsePath().view !== "search") return;
        updatePageMeta({
          title: `"${parsed.query}" 검색`,
          description: `공동번역성서에서 "${parsed.query}" 검색 결과`,
        });
      } else {
        const books = await loadBooks();
        renderBookList(books);
        dismissLaunchScreen();
        updatePageMeta();
      }
      trackPageView();
      return;
    }

    const books = await loadBooks();

    if (view === "books") {
      if (isInitialLoad && loadStartupBehavior() === "resume") {
        const savedPos = loadReadingPosition();
        if (savedPos && savedPos.bookId) {
          navigate(`/${savedPos.bookId}/${savedPos.chapter}?resume=1`);
          return;
        }
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderBookList(books);
      updatePageMeta();
      trackPageView();
      return;
    }

    if (view === "division") {
      // In vulgate mode, deuterocanon has no separate page — redirect to old_testament
      if (division === "deuterocanon" && loadBookOrder() === "vulgate") {
        navigate("/old_testament");
        return;
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderDivisionList(books, division);
      const divLabel = DIVISION_LABELS[division ?? ""] ?? division;
      updatePageMeta({
        title: divLabel,
        description: `공동번역성서 ${divLabel} 목록`,
      });
      trackPageView();
      return;
    }

    const book = books.find((b) => b.id === bookId);
    if (!book) {
      renderError("해당 성서를 찾을 수 없습니다.");
      dismissLaunchScreen();
      return;
    }

    if (view === "chapters") {
      dismissLaunchScreen(); // Start fade-out immediately
      renderChapterList(book, books);
      updatePageMeta({
        title: book.name_ko,
        description: `${book.name_ko} — 공동번역성서 전문 읽기`,
      });
      trackPageView();
      return;
    }

    // For chapter/prologue: dismiss as soon as the loading placeholder appears,
    // so the user sees the skeleton instead of the launch screen while data loads.
    renderLoading();
    dismissLaunchScreen();

    if (view === "prologue") {
      if (!bookId) return;
      const data = await loadPrologue(bookId);
      renderPrologue(data, book);
      saveReadingPosition(bookId, "prologue");
      updatePageMeta({
        title: `${book.name_ko} 머리말`,
        description: `${book.name_ko} 머리말 — 공동번역성서`,
      });
      trackPageView();
      return;
    }

    if (view === "chapter") {
      if (!bookId || typeof chapter !== "number") return;
      if (chapter < 1 || chapter > book.chapter_count) {
        renderError("해당 장을 찾을 수 없습니다.");
        return;
      }
      const data = await loadChapter(bookId, chapter);
      const savedPos = loadReadingPosition();
      const autoRestore = isInitialLoad
        && loadStartupBehavior() === "resume"
        && savedPos
        && savedPos.bookId === bookId
        && savedPos.chapter === chapter
        && savedPos.verse;
      const resumeVerse = (parsed.resume || autoRestore) && savedPos && savedPos.verse
        ? savedPos.verse
        : null;
      renderChapter(data, book, {
        highlightQuery: parsed.highlightQuery,
        highlightVerse: parsed.highlightVerse,
        highlightVerseEnd: parsed.highlightVerseEnd,
        highlightVerseSpec: parsed.highlightVerseSpec,
        resumeVerse,
      });
      saveReadingPosition(bookId, chapter, resumeVerse);
      startScrollTracking(bookId, chapter);
      updatePageMeta({
        title: `${book.name_ko} ${chapter}${chUnit(book.id)}`,
        description: `${book.name_ko} ${chapter}${chUnit(book.id)} — 공동번역성서`,
      });
      trackPageView();
    }
  } catch (err) {
    renderError("데이터를 불러올 수 없습니다.");
    console.error(err);
  } finally {
    dismissLaunchScreen(); // safety fallback (already a no-op if called above)
  }
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const a = /** @type {HTMLAnchorElement | null} */ (t.closest("a[href]"));
  if (!a) return;
  if (e.defaultPrevented) return;
  if (a.href.startsWith("blob:")) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return;
  if (a.target === "_blank") return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  const path = url.pathname + url.search;
  if (path === location.pathname + location.search) {
    route();
  } else {
    navigate(path);
  }
});

// popstate stays here (route is module-local). The DOMContentLoaded
// bootstrap handler stayed in app.js (Phase 8 territory) — it kicks off
// route() and the deferred init chain (initCompactHeader / initSheetDrag /
// initBookmarkSheetDrag / registerServiceWorker / maybeShowInstallNudge /
// driveSync.initDriveSync), several of which still live in app.js.
window.addEventListener("popstate", route);

// ── Audio Player ──

/** @param {number} sec @returns {string} */
function formatTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Lift FAB above chapter-nav when it scrolls into view on mobile.
// Anchors against the nav's real viewport position so the audio bar's
// height doesn't matter — the FAB always sits centered in the gap
// above chapter-nav.
let _fabNavObserver = null;
let _fabScrollHandler = null;
let _fabRafPending = false;
/** @param {HTMLElement} nav */
function _updateFabLift(nav) {
  const fabH = $searchFab.offsetHeight;
  const gapPx = parseFloat(getComputedStyle(nav).marginTop) || 0;
  const navTop = nav.getBoundingClientRect().top;
  const liftPx = window.innerHeight - navTop + (gapPx - fabH) / 2;
  $searchFab.style.setProperty("--fab-lift-nav", `${Math.max(liftPx, 0)}px`);
}
function observeFabLift() {
  if (_fabNavObserver) { _fabNavObserver.disconnect(); _fabNavObserver = null; }
  if (_fabScrollHandler) {
    window.removeEventListener("scroll", _fabScrollHandler);
    _fabScrollHandler = null;
  }
  _fabRafPending = false;
  const nav = /** @type {HTMLElement | null} */ ($app.querySelector(".chapter-nav"));
  if (!nav) return;
  const onScroll = () => {
    if (_fabRafPending) return;
    _fabRafPending = true;
    requestAnimationFrame(() => {
      _fabRafPending = false;
      if (!nav.isConnected) return;
      _updateFabLift(nav);
    });
  };
  _fabNavObserver = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible) {
      _updateFabLift(nav);
      if (!_fabScrollHandler) {
        _fabScrollHandler = onScroll;
        window.addEventListener("scroll", onScroll, { passive: true });
      }
    } else {
      $searchFab.style.removeProperty("--fab-lift-nav");
      if (_fabScrollHandler) {
        window.removeEventListener("scroll", _fabScrollHandler);
        _fabScrollHandler = null;
      }
    }
  }, { threshold: 0 });
  _fabNavObserver.observe(nav);
}

function _teardownAudio() {
  if (_audioController) { _audioController.abort(); _audioController = null; }
  if (_audioSaveTimer !== null) { clearTimeout(_audioSaveTimer); _audioSaveTimer = null; }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

function hideAudioBar() {
  _teardownAudio();
  $audioBar.hidden = true;
  clearNode($audioBar);
}

/** @param {string} bookId @param {number} chapter */
function showAudioPlayer(bookId, chapter) {
  _teardownAudio();
  _audioController = new AbortController();
  const { signal } = _audioController;
  const src = `${DATA_DIR}/audio/${bookId}-${chapter}.mp3`;
  clearNode($audioBar);

  const audio = new Audio();
  currentAudio = audio;

  const savedTime = loadAudioTime(bookId, chapter);
  // Always preload metadata so total duration is visible before first play.
  // ADR-016 excludes preload accesses from LRU, so this does not pollute cache signals.
  audio.preload = "metadata";
  audio.src = src;

  // Build player UI
  const container = el("div", { className: "audio-player" });

  const playBtn = el("button", {
    className: "audio-play-btn",
    "aria-label": "재생",
  });
  const playIcon = el("span", { className: "audio-icon-play", "aria-hidden": "true" });
  playBtn.appendChild(playIcon);

  const progress = document.createElement("input");
  progress.type = "range";
  progress.className = "audio-progress";
  progress.min = "0";
  progress.max = "100";
  progress.value = "0";
  progress.setAttribute("aria-label", "재생 위치");

  function updateProgressFill() {
    const max = Number(progress.max);
    const pct = max > 0 ? (Number(progress.value) / max) * 100 : 0;
    progress.style.setProperty("--fill", `${pct}%`);
  }
  updateProgressFill();

  const timeDisplay = el("span", { className: "audio-time" }, "0:00");

  const progressWrap = el("div", { className: "audio-progress-wrap" });
  progressWrap.appendChild(progress);
  progressWrap.appendChild(timeDisplay);

  const SPEEDS = [1, 1.25, 1.5];
  let speedIndex = 0;
  const speedBtn = el("button", {
    className: "audio-speed-btn",
    "aria-label": "재생 속도 1배속",
  }, "1×");
  speedBtn.addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    const rate = SPEEDS[speedIndex];
    audio.playbackRate = rate;
    const label = `재생 속도 ${rate}배속`;
    speedBtn.setAttribute("aria-label", label);
    speedBtn.textContent = `${rate}×`;
    announce(label);
  });

  container.appendChild(playBtn);
  container.appendChild(progressWrap);
  container.appendChild(speedBtn);

  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", () => {
    playBtn.setAttribute("aria-label", "일시정지");
    announce("재생");
    // Touch LRU metadata + opportunistically request persisted storage on
    // first play after install (value moment, ADR-016 §F).
    const absUrl = new URL(src, location.href).href;
    window.bibleAudioCache?.touch(absUrl).catch(() => {});
    _maybeRequestPersist();
  }, { signal });

  audio.addEventListener("playing", () => {
    playIcon.className = "audio-icon-pause";
  }, { signal });

  audio.addEventListener("waiting", () => {
    playIcon.className = "audio-icon-loading";
  }, { signal });

  audio.addEventListener("pause", () => {
    playIcon.className = "audio-icon-play";
    playBtn.setAttribute("aria-label", "재생");
    announce("일시정지");
  }, { signal });

  // Progress updates
  audio.addEventListener("loadedmetadata", () => {
    progress.max = String(Math.floor(audio.duration));
    if (savedTime && savedTime < audio.duration - 3) {
      audio.currentTime = savedTime;
      progress.value = String(Math.floor(savedTime));
      updateProgressFill();
      timeDisplay.textContent = `${formatTime(savedTime)} / ${formatTime(audio.duration)}`;
    } else {
      timeDisplay.textContent = `${formatTime(0)} / ${formatTime(audio.duration)}`;
    }
  }, { signal });

  audio.addEventListener("timeupdate", () => {
    if (!seekingByUser) {
      progress.value = String(Math.floor(audio.currentTime));
    }
    updateProgressFill();
    timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    if (_audioSaveTimer !== null) clearTimeout(_audioSaveTimer);
    _audioSaveTimer = setTimeout(() => {
      if (audio.currentTime > 0 && !audio.ended) saveAudioTime(bookId, chapter, Math.floor(audio.currentTime));
    }, 1000);
  }, { signal });

  audio.addEventListener("ended", () => {
    clearAudioTime();
  }, { signal });

  // Seeking
  let seekingByUser = false;
  progress.addEventListener("input", () => {
    seekingByUser = true;
    audio.currentTime = Number(progress.value);
    updateProgressFill();
  });
  progress.addEventListener("change", () => {
    seekingByUser = false;
  });

  // Error: audio not found → show unavailable message
  audio.addEventListener("error", () => {
    _teardownAudio();
    showAudioUnavailable();
  }, { signal });

  $audioBar.appendChild(container);
  $audioBar.hidden = false;
}

function showAudioUnavailable() {
  clearNode($audioBar);
  const msg = el("p", { className: "audio-unavailable" });
  msg.appendChild(el("span", { className: "audio-unavailable-icon", "aria-hidden": "true" }));
  msg.appendChild(document.createTextNode(" 오디오 파일을 준비 중입니다."));
  $audioBar.appendChild(msg);
  $audioBar.hidden = false;
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
  parsePath, route, navigate, hideAudioBar, renderError,
  _verseSelectionUnit,
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

// Phase 7b ownership: routing + rendering helpers that earlier phases
// (settings-ui / search / bookmark / app.js bootstrap) call as bare
// globals. Without these assignments their bare calls would resolve to
// undefined on globalThis at runtime even though TS sees the global
// declares in types.d.ts (the exact ESM ReferenceError trap).
window.parsePath = parsePath;
window.route = route;
window.navigate = navigate;
window.hideAudioBar = hideAudioBar;
window.renderError = renderError;

// Audio Player module state read accessor — app.js's Accessibility keydown
// handler (Phase 8 territory) reads `currentAudio` for the spacebar
// play/pause toggle. Migrates out when Accessibility itself moves into a
// dedicated app-main module.
window.getCurrentAudio = () => currentAudio;

// (Phase 7a's temporary window.DIVISION_LABELS / OT_SUBCATEGORY{,_ORDER,_LABELS}
// scaffolding was removed in Phase 7b — all callers (parsePath / route /
// renderBookList / renderDivisionList) now live in this module.)

export {
  loadBooks, loadVersion, loadChapter, loadPrologue,
  setTitle, setBreadcrumb, setTitleWithDivisionPicker, setTitleWithChapterPicker,
  buildDivisionBreadcrumb, divisionLabels, divisionOrder, effectiveDivision,
  initCompactHeader,
  _verseSelectionUnit,
};
