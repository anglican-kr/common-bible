"use strict";
// @ts-check

// Phase 7a of the app.js modularization (ADR-018). Owns:
//  - Rendering helpers (setTitle / chapter picker / division tabs) + division
//    constants and book-order resolution (canonical vs vulgate ordering).
//  - Compact Header on Scroll (collapses breadcrumb past 60px scroll).
//
// Views and Routing join this module in Phase 7b; the file name reflects that
// destination. (Data fetching → data-fetch.js, Audio Player → audio-player.js,
// page-level Pull-to-refresh removed — all ADR-034.)

/** @typedef {import("../types").BooksData} BooksData */
/** @typedef {import("../types").BookEntry} BookEntry */
/** @typedef {import("../types").BibleChapter} BibleChapter */
/** @typedef {import("../types").BiblePrologue} BiblePrologue */

// Audio Player lives in its own module (ADR-034 PR1). Explicit ESM import —
// the in-module callers (renderChapter / renderPrologue) bind these directly
// instead of through the window facade. applyAudioShow stays facade-only
// (settings-ui / state-machine read it) so it is not imported here.
import { showAudioPlayer, hideAudioBar } from "./audio-player.js";

const { _$, el, clearNode, chUnit } = window.appHelpers;
const { createOverlay } = window.appOverlay;
const {
  loadBookOrder, loadStartupBehavior,
  loadReadingPosition, saveReadingPosition, clearReadingPosition,
} = window.appStorage;
const { dismissLaunchScreen } = window.appSettings;
const { readingContext } = window;

// DOM anchors. Redeclared locally so views.js is self-contained.
const $app = _$("app");
const $title = _$("page-title");
const $audioBar = _$("audio-bar");
const $resumeBannerSlot = _$("resume-banner-slot");
const $divisionTabsSlot = _$("division-tabs-slot");
const $searchInput = /** @type {HTMLInputElement} */ (_$("search-input"));
const $searchClear = _$("search-clear");
const $searchBar = _$("search-bar");

// ── Rendering helpers ──

// ── BEGIN TITLE ──
// Exercised by tests/unit/views.test.js with a tiny $title stub
// + el / clearNode / announce shims provided by the loader prelude.
/**
 * @param {string} text  full (canonical) title text
 * @param {string} [mobileText]  shortened variant to swap to when the full
 *   text would overflow `#page-title` (back/bookmark buttons reserve space
 *   on either side). Omit to render plain text only.
 */
function setTitle(text, mobileText) {
  clearNode($title);
  document.title = text === "공동번역성서" ? text : `${text} — 공동번역성서`;
  announce(text);
  if (mobileText && mobileText !== text) {
    // Canonical name stays the accessible name; both visible spans are
    // aria-hidden so AT speaks aria-label regardless of which is shown.
    $title.setAttribute("aria-label", text);
    $title.appendChild(el("span", { className: "title-text-full", "aria-hidden": "true" }, text));
    $title.appendChild(el("span", { className: "title-text-mobile", "aria-hidden": "true" }, mobileText));
    applyTitleCompactness();
  } else {
    $title.removeAttribute("aria-label");
    $title.classList.remove("compact");
    $title.appendChild(document.createTextNode(text));
  }
}
// ── END TITLE ──

// ── BEGIN POPOVER ──
// Exercised by tests/unit/views.test.js. setTitleWithChapterPicker
// renders a button that toggles a popover (focus trap inside,
// click-outside-to-close, click-on-link-to-close).
/**
 * @param {BookEntry} book
 * @param {number} currentCh
 */
function setTitleWithChapterPicker(book, currentCh) {
  clearNode($title);
  $title.removeAttribute("aria-label");
  $title.classList.remove("compact");
  const unit = chUnit(book.id);
  const fullText = `${book.name_ko} ${currentCh}${unit}`;
  const mobileBookName = NT_MOBILE_NAME[book.id];
  const mobileText = mobileBookName ? `${mobileBookName} ${currentCh}${unit}` : null;
  document.title = `${fullText} — 공동번역성서`;
  announce(fullText);

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": `${unit} 선택`, "aria-expanded": "false" }
  );
  if (mobileText) {
    btn.appendChild(el("span", { className: "title-text-full", "aria-hidden": "true" }, fullText));
    btn.appendChild(el("span", { className: "title-text-mobile", "aria-hidden": "true" }, mobileText));
  } else {
    btn.appendChild(document.createTextNode(fullText));
  }

  const popover = el("div", { className: "chapter-popover", role: "listbox", "aria-label": `${unit} 선택` });
  popover.hidden = true;

  const grid = el("div", { className: "popover-grid" });
  if (book.has_prologue) {
    grid.appendChild(
      el("a", { className: "popover-item popover-prologue", href: `/${book.id}/prologue` }, "머리말")
    );
  }
  for (let i = 1; i <= book.chapter_count; i++) {
    const isCurrent = i === currentCh;
    const item = el("a", { className: isCurrent ? "popover-item current" : "popover-item", href: `/${book.id}/${i}` }, String(i));
    if (isCurrent) item.setAttribute("aria-current", "true");
    grid.appendChild(item);
  }
  popover.appendChild(grid);

  // Overlay lifecycle (hidden toggle, focus-trap, outside-click, focus restore)
  // is owned by the shared controller (ADR-032). closeOnEsc stays off: app.js's
  // central Escape coordinator routes Escape via window.closeChapterPopover.
  // aria-expanded is set on the specific btn in onOpen/onClose (per-instance, so
  // a document-wide ariaExpanded selector isn't needed). outsideIgnore is the
  // toggle btn itself; clicking the settings gear (outside the popover, not the
  // toggle) closes the picker — the controller's "outside panel" rule subsumes
  // the old explicit settings-gear clause.
  const chapterOverlay = createOverlay({
    panel: popover,
    closeOnOutside: true,
    outsideIgnore: ".title-picker-btn",
    returnFocus: true,
    onOpen: () => {
      btn.setAttribute("aria-expanded", "true");
      // Land on the currently-open chapter (falling back to the first link, e.g.
      // when arriving from the prologue). preventScroll keeps the browser from
      // jumping the element to the viewport edge; we then center it within the
      // popover's own scroll box — popover is position:absolute, so children's
      // offsetTop is relative to it and the page never moves.
      const current = /** @type {HTMLElement | null} */ (popover.querySelector(".popover-item.current"));
      const target = current || /** @type {HTMLElement | null} */ (popover.querySelector('a[href]'));
      if (target) target.focus({ preventScroll: true });
      if (current) {
        popover.scrollTop = current.offsetTop - (popover.clientHeight - current.offsetHeight) / 2;
      }
    },
    onClose: () => { btn.setAttribute("aria-expanded", "false"); },
  });
  // Exposed for app.js's Escape coordinator + route() nav dismissal (ADR-032).
  window.closeChapterPopover = () => chapterOverlay.close();

  btn.addEventListener("click", () => {
    if (chapterOverlay.isOpen) chapterOverlay.close(); else chapterOverlay.open();
  });

  popover.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.tagName === "A") chapterOverlay.close();
  });

  $title.appendChild(buildHomeBtn(`/${effectiveDivision(book)}`, "성서 목록으로", book.id));
  $title.appendChild(btn);
  $title.appendChild(popover);
  $title.appendChild(buildBookmarkHeaderBtn(book.id, currentCh));
  if (mobileText) {
    $title.setAttribute("aria-label", fullText);
    applyTitleCompactness();
  }
}
// ── END POPOVER ──

// ── BEGIN DIVISION ──
// Exercised by tests/unit/views.test.js. Pure: loadBookOrder() is
// the only side-effect (provided as a stub by the loader prelude).
const DIVISION_LABELS = {
  old_testament: "구약",
  deuterocanon: "외경",
  new_testament: "신약",
};

const DIVISION_ORDER = ["old_testament", "deuterocanon", "new_testament"];

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

// ── BEGIN DIVISION_TABS ──
// Exercised by tests/unit/views.test.js. The book-list page is a
// single tabbed view (구약 / 외경 / 신약); the tab set follows the active
// book-order setting (vulgate drops the 외경 tab). Tabs are anchors to the
// per-division routes (/old_testament etc.) so deep links, the back button,
// and SEO indexing (ADR-009) keep working. CSS flexes them to fill the row.
// Active-tab index of the most recent render, so the sliding indicator can
// animate from the previously selected tab to the new one across re-renders
// (each tab click is a full route change that rebuilds the nav).
let _prevDivisionIdx = null;

function buildDivisionTabs(activeDivision) {
  const labels = divisionLabels();
  const order = divisionOrder();
  const activeIdx = Math.max(0, order.indexOf(activeDivision));
  // Slide from the previous selection when one exists and differs; otherwise
  // render the indicator already under the active tab (no animation).
  const startIdx = _prevDivisionIdx != null && _prevDivisionIdx !== activeIdx && _prevDivisionIdx < order.length
    ? _prevDivisionIdx
    : activeIdx;
  const nav = el("nav", { className: "division-tabs", "aria-label": "구분" });
  // Style is applied via the CSSOM (.style), not a `style` attribute: the app's
  // CSP has no 'unsafe-inline' for style-src, so style attributes are blocked —
  // but programmatic .style assignments are always allowed.
  nav.style.setProperty("--tab-count", String(order.length));
  // The sliding accent-outlined box that marks the active tab. The transform is
  // set directly (not via a custom property) so `transition: transform` has a
  // proper before/after value to interpolate.
  const indicator = el("div", { className: "division-tab-indicator", "aria-hidden": "true" });
  indicator.style.transform = `translateX(${startIdx * 100}%)`;
  nav.appendChild(indicator);
  for (const div of order) {
    const isActive = div === activeDivision;
    const a = el("a", { className: isActive ? "division-tab active" : "division-tab", href: `/${div}` }, labels[div]);
    if (isActive) a.setAttribute("aria-current", "page");
    nav.appendChild(a);
  }
  // Browser-only: slide from the previously-active tab (startIdx, set inline
  // above) to the new one. Double rAF so the indicator is painted at startIdx in
  // the first frame, then moved in the next — giving `transition: transform` a
  // committed before/after pair to interpolate (a single frame can coalesce both
  // into one paint and skip the animation). Guarded so the unit-test vm harness
  // (no requestAnimationFrame) is unaffected.
  if (startIdx !== activeIdx && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        indicator.style.transform = `translateX(${activeIdx * 100}%)`;
      });
    });
  }
  _prevDivisionIdx = activeIdx;
  return nav;
}
// ── END DIVISION_TABS ──

// ── BEGIN BOOK_LIST_LINK ──
// Book-list buttons (/, /old_testament, /new_testament, /deuterocanon) show
// `name_ko` by default. NT names are long enough that buttons can wrap to two
// lines, especially on narrow viewports or with enlarged text. For NT books we
// also emit a shortened name and let CSS swap to it on touch devices, or JS
// swap to it (.compact class) when the full name would wrap inside the button.
// 복음서 4권은 "~의 복음서" 접미사를 떼어 표시(마태오/마르코/루가/요한). 사도행전은
// 명칭 변경 없음.
const NT_MOBILE_NAME = {
  matt:   "마태오",
  mark:   "마르코",
  luke:   "루가",
  john:   "요한",
  rom:    "로마서",
  "1cor": "1고린토",
  "2cor": "2고린토",
  gal:    "갈라디아",
  eph:    "에페소",
  phil:   "필립비",
  col:    "골로사이",
  "1thess": "1데살로니카",
  "2thess": "2데살로니카",
  "1tim": "1디모테오",
  "2tim": "2디모테오",
  titus:  "디도서",
  phlm:   "필레몬서",
  heb:    "히브리서",
  jas:    "야고보서",
  "1pet": "1베드로",
  "2pet": "2베드로",
  "1john": "요한1서",
  "2john": "요한2서",
  "3john": "요한3서",
  jude:   "유다서",
  rev:    "요한묵시록",
};

// Returns the `<li>` for a book-list entry. When a NT mobile-shortened name
// exists, emits two spans (.book-name-full / .book-name-mobile) and sets the
// anchor's aria-label to the canonical name so screen readers always speak
// the formal title regardless of which span is visually shown.
function buildBookListItem(b) {
  const mobile = NT_MOBILE_NAME[b.id];
  if (!mobile) {
    return el("li", null, el("a", { href: `/${b.id}`, "data-book-id": b.id }, b.name_ko));
  }
  const a = el("a", { href: `/${b.id}`, "data-book-id": b.id, "aria-label": b.name_ko });
  a.appendChild(el("span", { className: "book-name-full" }, b.name_ko));
  a.appendChild(el("span", { className: "book-name-mobile" }, mobile));
  return el("li", null, a);
}

// Compactness fallback: on devices where the touch-device media query does
// not apply (desktop/laptop), the full NT name may still wrap when the user
// enlarges text (browser zoom, OS-level scaling, or the app's font-size
// setting). For each book-list anchor with a mobile-shortened span, measure
// the single-line natural width of `.book-name-full`; if it exceeds the
// anchor's available inner width, add the `.compact` class so CSS swaps to
// the shortened name. Re-runs on container resize via ResizeObserver, which
// also fires when root font-size changes (since item heights reflow).
/** @type {ResizeObserver | null} */
let _bookListResizeObs = null;
/** @type {Map<Element, ReturnType<typeof setTimeout>>} */
const _bookListDebounce = new Map();

function _getBookListResizeObserver() {
  if (_bookListResizeObs) return _bookListResizeObs;
  _bookListResizeObs = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const ul = entry.target;
      const prev = _bookListDebounce.get(ul);
      if (prev) clearTimeout(prev);
      _bookListDebounce.set(ul, setTimeout(() => {
        _bookListDebounce.delete(ul);
        if (ul.isConnected) applyBookListCompactness(/** @type {HTMLElement} */ (ul));
      }, 50));
    }
  });
  return _bookListResizeObs;
}

/** @param {HTMLElement} ul */
function applyBookListCompactness(ul) {
  const anchors = /** @type {NodeListOf<HTMLAnchorElement>} */ (
    ul.querySelectorAll("a")
  );
  for (const a of anchors) {
    const full = /** @type {HTMLElement | null} */ (a.querySelector(".book-name-full"));
    const mobile = a.querySelector(".book-name-mobile");
    if (!full || !mobile) continue;

    // Reset to measure the natural (non-compact) state.
    a.classList.remove("compact");

    const prevWs = full.style.whiteSpace;
    const prevDisplay = full.style.display;
    full.style.whiteSpace = "nowrap";
    full.style.display = "inline-block";
    const naturalWidth = full.offsetWidth;
    full.style.whiteSpace = prevWs;
    full.style.display = prevDisplay;

    const cs = getComputedStyle(a);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const availableWidth = a.clientWidth - padL - padR;

    if (naturalWidth > availableWidth + 0.5) {
      a.classList.add("compact");
    }
  }
}

/** @param {ParentNode} root */
function observeBookListsIn(root) {
  const lists = root.querySelectorAll(".book-list");
  const obs = _getBookListResizeObserver();
  for (const ul of lists) {
    applyBookListCompactness(/** @type {HTMLElement} */ (ul));
    obs.observe(ul);
  }
}

// Same idea as book-list compactness, but for the page-title header.
// `setTitle` / `setTitleWithChapterPicker` emit .title-text-full and
// .title-text-mobile spans when an NT mobile-shortened variant exists; this
// function measures whether the full text would overflow the room remaining
// in #page-title once the absolute-positioned back and bookmark buttons
// (~2.2rem each + breathing) are reserved. ResizeObserver on $title keeps
// the choice fresh across viewport resizes and root font-size changes.
/** @type {ResizeObserver | null} */
let _titleResizeObs = null;

function applyTitleCompactness() {
  // Lazy ResizeObserver setup on first call: keeps the title decision fresh
  // across viewport resize and root font-size changes without coupling to
  // the bootstrap path. (Tests load this module via vm with no $title — the
  // function early-returns there and the observer is never created.)
  if (!_titleResizeObs && typeof ResizeObserver !== "undefined" && $title) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    _titleResizeObs = new ResizeObserver(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; applyTitleCompactness(); }, 50);
    });
    _titleResizeObs.observe($title);
  }

  // Defer the actual measurement to the next frame. Several render paths append
  // the settings gear *after* calling setTitle/setTitleWithChapterPicker, and on
  // mobile that gear is part of the right-side reservation — measuring before
  // it lands would undercount the reserved space. rAF also lets layout and web
  // fonts settle so offsetWidth reflects the final rendered title.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(measureTitleCompactness);
  } else {
    measureTitleCompactness();
  }
}

function measureTitleCompactness() {
  if (!$title) return;
  const full = /** @type {HTMLElement | null} */ ($title.querySelector(".title-text-full"));
  const mobile = $title.querySelector(".title-text-mobile");
  if (!full || !mobile) {
    $title.classList.remove("compact");
    return;
  }
  const container = full.parentElement;
  if (!container) return;

  // Reset so measurement reflects the non-compact (full) layout.
  $title.classList.remove("compact");

  const prevWs = full.style.whiteSpace;
  const prevDisplay = full.style.display;
  full.style.whiteSpace = "nowrap";
  full.style.display = "inline-block";
  const naturalWidth = full.offsetWidth;
  full.style.whiteSpace = prevWs;
  full.style.display = prevDisplay;

  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // The title text is centered (text-align: center) while the home / bookmark /
  // settings buttons are absolute-positioned at the edges. A centered string
  // overruns whichever side reaches furthest inward, symmetrically — so the room
  // for the text is clientWidth − 2 × (largest side reservation). Measure the
  // real buttons from the live DOM rather than hardcoding, because the layout
  // differs by breakpoint: on desktop the bookmark sits flush right (right: 0)
  // and the settings gear lives in the top row (absent here); on mobile the
  // settings gear is minted into this row at right: 0 and the bookmark is inset
  // to right: 2.4rem, so the right side reserves ~4.6rem, not 2.2rem. The old
  // fixed 5.2rem matched only the desktop layout, leaving mobile titles to
  // collide with the bookmark/gear.
  //
  // Use getBoundingClientRect, not getComputedStyle left/right: for an
  // abs-positioned element the browser resolves *both* insets to used pixels
  // even when only one was authored, so a left-anchored button would report a
  // right inset of ~full width and bogusly inflate the opposite side. Geometry
  // sidesteps that — classify each button by whichever container edge it sits
  // closer to, then take only that side's inward intrusion.
  const titleRect = $title.getBoundingClientRect();
  let leftReserve = 0;
  let rightReserve = 0;
  for (const b of $title.querySelectorAll(".title-back-btn, .title-bookmark-btn, .title-settings-btn")) {
    const r = b.getBoundingClientRect();
    if (r.width === 0) continue; // hidden at this breakpoint (e.g. desktop gear)
    if (r.left - titleRect.left <= titleRect.right - r.right) {
      leftReserve = Math.max(leftReserve, r.right - titleRect.left);
    } else {
      rightReserve = Math.max(rightReserve, titleRect.right - r.left);
    }
  }
  const breathing = 0.8 * rem;
  const sideReserve = Math.max(leftReserve, rightReserve) + breathing;
  // Picker button has a ~0.4em chevron after the label — allow for it.
  const chevronAllowance = container.classList.contains("title-picker-btn") ? 0.8 * rem : 0;
  const availableWidth = $title.clientWidth - 2 * sideReserve;

  if (naturalWidth + chevronAllowance > availableWidth + 0.5) {
    $title.classList.add("compact");
  }
}
// ── END BOOK_LIST_LINK ──

// ── Compact Header on Scroll ──
// Deferred: not needed until after first render and first scroll.

// ── BEGIN COMPACT_HEADER ──
// Exercised by tests/unit/views.test.js. Hysteretic toggle:
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

// ── BEGIN SCROLL_ELEVATION ──
// ADR-025: toggle `.scrolled` on #sticky-group based on whether the
// zero-height #scroll-sentinel at the top of <body> is in the viewport.
// IntersectionObserver fires only on visibility flips (cheaper than a
// scroll listener + throttle) and route() resets to scroll-top, which
// naturally puts the sentinel back in view → `.scrolled` clears on its own.
function initScrollElevation() {
  const sentinel = document.getElementById("scroll-sentinel");
  const stickyGroup = _$("sticky-group");
  if (!sentinel || typeof IntersectionObserver === "undefined") return;
  const obs = new IntersectionObserver(([entry]) => {
    stickyGroup.classList.toggle("scrolled", !entry.isIntersecting);
  });
  obs.observe(sentinel);
}
// ── END SCROLL_ELEVATION ──


// ── Views ──
// Routing (parsePath / route / navigate + listeners + scroll tracker) moved to
// routing.js (ADR-034 PR5a); the Audio Player to audio-player.js (PR1, still
// imported above for renderChapter / renderPrologue). This module owns the view
// renderers + render helpers; route() imports the entry points it dispatches to.

// The unified book-list page. The first page (/) and the per-division routes
// (/old_testament · /deuterocanon · /new_testament) all render here, differing
// only by which tab is active — replacing the former separate landing +
// division pages. `activeDivision` falls back to the first tab when missing or
// invalid (e.g. /deuterocanon while in vulgate mode, which the router also
// redirects to /old_testament).
// When the reading-view home button sends us back to the book list, it stashes
// the book we were reading here so renderBookList can move focus onto its list
// item (keyboard users land in context instead of at the top). One-shot: it is
// cleared the moment it is consumed, so a plain tab/back navigation to the list
// never inherits a stale focus target.
/** @type {string | null} */
let _pendingBookFocus = null;

/** @param {string} bookId */
function setPendingBookFocus(bookId) {
  _pendingBookFocus = bookId;
}

function renderBookList(books, activeDivision) {
  const labels = divisionLabels();
  const order = divisionOrder();
  const active = order.includes(activeDivision) ? activeDivision : order[0];

  setTitle("공동번역성서");
  $title.appendChild(buildSettingsTrigger());
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  // Tabs live in the sticky group (after the resume banner) so they stay pinned
  // below the header — and below the banner whenever one is shown. route()
  // clears this slot on every navigation.
  clearNode($divisionTabsSlot);
  $divisionTabsSlot.appendChild(buildDivisionTabs(active));

  const panel = el("div", { className: "division-panel", role: "region", "aria-label": labels[active] });
  const list = books.filter((b) => effectiveDivision(b) === active);

  // Flat list for every division — OT is no longer split into 오경/역사서/etc.
  // subcategories, so all three tabs share one consistent layout.
  const ul = el("ul", { className: "book-list", role: "list" });
  for (const b of list) {
    ul.appendChild(buildBookListItem(b));
  }
  panel.appendChild(ul);
  $app.appendChild(panel);
  observeBookListsIn($app);
  focusPendingBook();
}

// Consume a pending "focus the book I was just reading" request left by the
// reading-view home button. We only act when the book is in the division that
// is actually rendered (the home button targets the book's own division, so it
// will be); scrollIntoView keeps it clear of the sticky header.
function focusPendingBook() {
  const id = _pendingBookFocus;
  _pendingBookFocus = null;
  if (!id) return;
  const target = /** @type {HTMLAnchorElement | null} */ (
    $app.querySelector(`.book-list a[data-book-id="${CSS.escape(id)}"]`)
  );
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "center" });
  // Programmatic focus() does not trigger :focus-visible (the browser reserves
  // that pseudo-class for keyboard/AT focus), so the card would carry DOM focus
  // with no visible highlight. Add an explicit one-shot marker class so the book
  // we were just reading is unmistakably highlighted on the list. It clears on
  // the first user interaction (pointer/key) — at which point :focus-visible
  // takes over for keyboard users — and is gone anyway on the next render.
  target.classList.add("is-last-read");
  const clear = () => {
    target.classList.remove("is-last-read");
    document.removeEventListener("pointerdown", clear, true);
    document.removeEventListener("keydown", clear, true);
  };
  document.addEventListener("pointerdown", clear, true);
  document.addEventListener("keydown", clear, true);
}

// `clearReadingPosition` was extracted to js/app/storage.js (ADR-018 Phase 2).

function renderResumeBanner(books) {
  const pos = loadReadingPosition();
  if (!pos) return;
  const lastBook = books.find((b) => b.id === pos.bookId);
  if (!lastBook) return;
  const isPrologue = pos.chapter === "prologue";
  const href = `/${pos.bookId}/${pos.chapter}?resume=1`;
  const suffix = isPrologue ? "머리말" : `${pos.chapter}${chUnit(lastBook.id)}`;
  const fullLabel = `이어읽기: ${lastBook.name_ko} ${suffix}`;
  const mobileBookName = NT_MOBILE_NAME[lastBook.id];
  const mobileLabel = mobileBookName ? `이어읽기: ${mobileBookName} ${suffix}` : null;

  const wrapper = el("div", { className: "resume-banner" });
  const link = el("a", { className: "resume-banner-link", href });
  if (mobileLabel) {
    link.setAttribute("aria-label", fullLabel);
    link.appendChild(el("span", { className: "resume-text-full", "aria-hidden": "true" }, fullLabel));
    link.appendChild(el("span", { className: "resume-text-mobile", "aria-hidden": "true" }, mobileLabel));
  } else {
    link.textContent = fullLabel;
  }
  wrapper.appendChild(link);

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
  if (mobileLabel) {
    applyResumeBannerCompactness(wrapper);
    _observeResumeBanner(wrapper);
  }
}

// Resume banner compactness — same measurement idea as book-list / title.
// Banner is a flex row: .resume-banner-link (flex:1) + .resume-banner-close
// (2.2rem). When the full text natural width exceeds the link's available
// inner width, swap to the mobile-shortened label.
/** @type {ResizeObserver | null} */
let _resumeBannerObs = null;

/** @param {HTMLElement} wrapper */
function applyResumeBannerCompactness(wrapper) {
  const link = /** @type {HTMLElement | null} */ (wrapper.querySelector(".resume-banner-link"));
  const full = /** @type {HTMLElement | null} */ (wrapper.querySelector(".resume-text-full"));
  const mobile = wrapper.querySelector(".resume-text-mobile");
  if (!link || !full || !mobile) {
    wrapper.classList.remove("compact");
    return;
  }
  wrapper.classList.remove("compact");

  const prevWs = full.style.whiteSpace;
  const prevDisplay = full.style.display;
  full.style.whiteSpace = "nowrap";
  full.style.display = "inline-block";
  const naturalWidth = full.offsetWidth;
  full.style.whiteSpace = prevWs;
  full.style.display = prevDisplay;

  const cs = getComputedStyle(link);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const availableWidth = link.clientWidth - padL - padR;

  if (naturalWidth > availableWidth + 0.5) {
    wrapper.classList.add("compact");
  }
}

/** @param {HTMLElement} wrapper */
function _observeResumeBanner(wrapper) {
  if (typeof ResizeObserver === "undefined") return;
  if (!_resumeBannerObs) {
    /** @type {Map<Element, ReturnType<typeof setTimeout>>} */
    const debounce = new Map();
    _resumeBannerObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        const prev = debounce.get(target);
        if (prev) clearTimeout(prev);
        debounce.set(target, setTimeout(() => {
          debounce.delete(target);
          if (target.isConnected) applyResumeBannerCompactness(/** @type {HTMLElement} */ (target));
        }, 50));
      }
    });
  }
  _resumeBannerObs.observe(wrapper);
}

function renderChapterList(book, books) {
  setTitle(book.name_ko, NT_MOBILE_NAME[book.id]);
  $title.insertBefore(buildHomeBtn(`/${effectiveDivision(book)}`, "성서 목록으로", book.id), $title.firstChild);
  $title.appendChild(buildBookmarkHeaderBtn(book.id, null));
  $title.appendChild(buildSettingsTrigger());
  hideAudioBar();
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
// Exercised by tests/unit/views.test.js. Pure: derives the displayed
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
// Exercised by tests/unit/views.test.js. DOM-pure: reads classList +
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

// Inclusive list of data-vref strings spanning anchor→target (in either
// direction) given the document-order array `allVrefs`. Used by anchored range
// selection (desktop Shift+click, mobile hold-and-tap). Each endpoint is
// expanded to its whole pure-poetry unit via `unitFn` so a range edge that
// lands on one line-part of a multi-part verse still pulls in the rest.
/**
 * @param {string[]} allVrefs
 * @param {string} anchorVref
 * @param {string} targetVref
 * @param {(vref: string) => string[]} [unitFn]
 * @returns {string[]}
 */
function _verseRangeVrefs(allVrefs, anchorVref, targetVref, unitFn) {
  const ai = allVrefs.indexOf(anchorVref);
  const ti = allVrefs.indexOf(targetVref);
  if (ai === -1 || ti === -1) return [];
  let lo = ai <= ti ? ai : ti;
  let hi = ai <= ti ? ti : ai;
  if (unitFn) {
    const loUnit = unitFn(allVrefs[lo]);
    if (loUnit.length > 1) {
      const f = allVrefs.indexOf(loUnit[0]);
      if (f !== -1 && f < lo) lo = f;
    }
    const hiUnit = unitFn(allVrefs[hi]);
    if (hiUnit.length > 1) {
      const l = allVrefs.indexOf(hiUnit[hiUnit.length - 1]);
      if (l !== -1 && l > hi) hi = l;
    }
  }
  return allVrefs.slice(lo, hi + 1);
}
// ── END VERSE_SELECTION ──

// Render a list of verses into `article` as inline verse spans + inter-verse
// break markers + cite chips. Extracted from renderChapter so the bookmark
// reading view (ADR-035) can render verse subsets through the same logic. Does
// NOT wrap note anchors or run highlight-join post-processing — callers do that
// on the finished article (note anchors match by integer verse number, so they
// must be scoped per single-chapter article to avoid cross-chapter collisions).
/**
 * @param {HTMLElement} article
 * @param {ReadonlyArray<BibleVerse>} verses
 * @param {{ hlQuery?: string|null, hlVerse?: number|null, hlVerseEnd?: number|null, hlSegments?: Array<{start:number,end:number,part?:string}>|null, parallels?: ChapterParallel[]|null, chapter?: number|null }} [opts]
 */
function appendVerses(article, verses, opts = {}) {
  const { hlQuery = null, hlVerse = null, hlVerseEnd = null, hlSegments = null, parallels = null, chapter = null, hideCites = false } = opts;
  let isFirst = true;
  let prevVerseEndType = null;

  // ADR-022: precompute which (verse, segment) cite chips actually render
  // (dedup of consecutive same-cite groups; only LAST in group renders).
  // `hideCites` (ADR-035 bookmark reading view) suppresses inline cite chips for
  // a clean reading surface — an empty set means no position ever shows a chip.
  const _citeShowAt = (!hideCites && window.appCitations)
    ? window.appCitations._computeCiteShowPositions(verses)
    : new Set();

  for (let vIdx = 0; vIdx < verses.length; vIdx++) {
    const v = verses[vIdx];
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

    // ADR-027 (개정 2026-05-31): section-level parallel-passage anchor(s) —
    // render a ※ marker right before the verse whose number matches a
    // parallel's range start. Plural — range 중첩 허용 (§2 검증 규칙 개정)
    // 이라 한 절에서 여러 marker 가 시작할 수 있고, 각자 자기 anchor 가
    // 나란히 렌더됨 (각 tooltip 독립). 클릭 시 footnote-style tooltip 이
    // 열리고 본문 안 sourceLink 가 cite-sheet 로 위임. 토글은 `body.cites-shown`.
    if (window.appParallels && parallels && parallels.length) {
      // Pass chapter so a range whose chapter prefix belongs elsewhere (rare —
      // parser cross-check normally catches it) cannot stray-render here.
      const matched = window.appParallels.findParallelsStartingAt(
        parallels, v.number, chapter,
      );
      for (const p of matched) {
        article.appendChild(window.appParallels.buildParallelAnchor(p));
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

    function appendSegText(target, raw, opts) {
      const hasPilcrow = raw.startsWith("¶");
      if (hasPilcrow) {
        target.appendChild(el("span", { className: "pilcrow", "aria-hidden": "true" }, "¶"));
      }
      const textContent = hasPilcrow ? raw.replace(/^¶\s*/, "") : raw;
      // Trailing space normally separates this span from the next inline
      // sibling (verse continuation). When a cite chip will be appended right
      // after this segment, the chip's own padding provides the gap — skip
      // the trailing space to avoid a double-gap (ADR-022 §6 dev-server tweak).
      // Also skip when the segment is punctuation-only (e.g. a stray opening
      // quote split off when a cite begins mid-quote like `'<cite>…</cite>'`):
      // appending a space would force `' 그는…` instead of the intended
      // `'그는…`. Punctuation glues to the next segment in Korean prose.
      const isPunctOnly = /^[\s'"“”‘’«»‹›()…,.;:!?¶·]+$/.test(textContent);
      const suffix = (opts && opts.noTrailingSpace) || isPunctOnly ? "" : " ";
      appendTextWithHighlight(target, textContent + suffix, hlQuery);
    }

    // Count total lines across all segments to determine if multi-part
    const totalLines = segs.reduce((n, s) => n + s.text.split("\n").filter(l => l !== "").length, 0);
    const isMultiPart = totalLines > 1;
    const partLetters = "bcdefghijklmnop";
    let partIdx = 0;
    let isFirstLine = true;
    let prevSegType = null;

    for (let segIdx = 0; segIdx < segs.length; segIdx++) {
      const seg = segs[segIdx];
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

        // Break before non-first lines:
        // - explicit paragraph break (¶ or segment-type change) → paragraph-break
        // - poetry continuation → hemistich-break
        // - prose continuation (e.g. ADR-022 cite-split prose) → no break, text flows inline
        if (!isFirstLine) {
          let breakClass = null;
          if ((seg.paragraph_break || isSegChange) && li === 0) {
            breakClass = "paragraph-break";
          } else if (isPoetry) {
            breakClass = "hemistich-break";
          }
          if (breakClass) {
            article.appendChild(el("span", {
              className: breakClass,
              role: "presentation"
            }));
          }
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
        // Suppress trailing space on the last line of a prose cite segment
        // — the chip that follows immediately provides its own padding gap.
        const segWillShowChip = !!(seg.cite && _citeShowAt.has(`${vIdx}:${segIdx}`));
        const isLastSegLine = li === lines.length - 1;
        const segTextOpts = (!isPoetry && segWillShowChip && isLastSegLine)
          ? { noTrailingSpace: true } : undefined;
        // Hanging punctuation: pull leading quote outside the indent.
        // Single quote is narrower, so it uses a smaller offset (see .hanging-quote--single).
        if (isPoetry && (line[0] === '"' || line[0] === "'")) {
          const cls = line[0] === '"' ? "hanging-quote" : "hanging-quote hanging-quote--single";
          span.appendChild(el("span", { className: cls }, line[0]));
          appendSegText(span, line.slice(1), segTextOpts);
        } else {
          appendSegText(span, line, segTextOpts);
        }
        article.appendChild(span);
        isFirstLine = false;
      }
      // ADR-022: append cite chip after this segment if it carries one and
      // dedup decided this position should render (not suppressed).
      if (seg.cite && window.appCitations && _citeShowAt.has(`${vIdx}:${segIdx}`)) {
        article.appendChild(window.appCitations.buildCiteChip(
          seg.cite, seg.parallels || null, seg.tradition || null, seg.type,
        ));
      }

      prevSegType = seg.type;
    }

    prevVerseEndType = segs[segs.length - 1]?.type;
    isFirst = false;
  }
}

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
  // setTitleWithChapterPicker already prepends the home button; add the mobile
  // settings trigger alongside the bookmark button it appended.
  $title.appendChild(buildSettingsTrigger());
  clearNode($app);

  if (data.has_dual_numbering) {
    $app.appendChild(
      el("p", { className: "dual-numbering-note" }, "※ 괄호 안 번호는 70인역 사본(그리스어)의 절 번호입니다.")
    );
  }

  const article = el("article", { className: "chapter-text", lang: "ko" });
  appendVerses(article, data.verses, {
    hlQuery, hlVerse, hlVerseEnd, hlSegments,
    parallels: data.parallels, chapter: data.chapter,
  });

  // ADR-022: wrap each note anchor in a clickable button — tooltip on click
  // shows the note body (no chapter-end section; ADR §6 개정 2026-05-24).
  if (window.appCitations) {
    window.appCitations.wrapNoteAnchorsInArticle(article, data.verses);
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

  // ── Verse selection gestures ──
  // Outside select mode: a 300ms long-press on a verse enters select mode and
  // selects that verse (pointermove only cancels after >10px to tolerate
  // natural finger drift).
  //
  // Inside select mode, range selection is anchored on the last individually
  // tapped verse (readingContext.selectAnchor):
  //   • Desktop — click a verse, then Shift+click another to fill the range.
  //   • Mobile  — hold one verse and tap another with a second finger to fill
  //     the range. A one-finger slide is deliberately NOT used: a panning
  //     finger fights the page scroll, whereas two still touch points never
  //     start a scroll.
  // A plain tap/click toggles a single verse and moves the anchor there.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let _longPressTimer = null;
  let _longPressStartX = 0;
  let _longPressStartY = 0;

  // In-flight touches in select mode: pointerId → { vref, consumed }. `consumed`
  // marks a pointer whose pointerdown already drove a range selection, so its
  // later pointerup must not also toggle the verse.
  /** @type {Map<number, { vref: string, consumed: boolean }>} */
  const _activePointers = new Map();

  // Refresh verse-highlight classes + dock after mutating selectedVerses.
  const refreshSelection = () => {
    article.querySelectorAll(".verse[data-vref]").forEach((v) => {
      v.classList.toggle("verse-selected", readingContext.selectedVerses.has(v.getAttribute("data-vref") ?? ""));
    });
    updateVerseSelectionBoundaries(article);
    updateVerseSelectBar();
  };

  // Additively select every verse from `anchorVref` to `targetVref` inclusive,
  // then move the anchor to the target. Returns false if the range is empty.
  const selectRange = (anchorVref, targetVref) => {
    const allVrefs = [...article.querySelectorAll(".verse[data-vref]")]
      .map((v) => v.getAttribute("data-vref") ?? "");
    const range = _verseRangeVrefs(allVrefs, anchorVref, targetVref,
      (vref) => _verseSelectionUnit(article, vref));
    if (!range.length) return false;
    for (const r of range) readingContext.selectedVerses.add(r);
    readingContext.selectAnchor = targetVref;
    refreshSelection();
    return true;
  };

  // Toggle a single verse's selection unit; the anchor follows a selection and
  // clears on a deselection.
  const toggleVerse = (vref) => {
    const unit = _verseSelectionUnit(article, vref);
    const wasSelected = unit.some((r) => readingContext.selectedVerses.has(r));
    if (wasSelected) unit.forEach((r) => readingContext.selectedVerses.delete(r));
    else unit.forEach((r) => readingContext.selectedVerses.add(r));
    readingContext.selectAnchor = wasSelected ? null : vref;
    refreshSelection();
  };

  article.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (readingContext.verseSelectMode) {
      const vs = t.closest(".verse[data-vref]");
      if (!vs) return;
      const vref = vs.getAttribute("data-vref") ?? "";
      e.preventDefault(); // suppress native text selection / iOS callout
      // Desktop: Shift+click extends the selection from the existing anchor.
      if (e.shiftKey && readingContext.selectAnchor && selectRange(readingContext.selectAnchor, vref)) {
        _activePointers.set(e.pointerId, { vref, consumed: true });
        return;
      }
      // Mobile: a second finger landing on a different verse while the first is
      // still held selects the range between the held verse and this one.
      let heldVref = null;
      for (const p of _activePointers.values()) {
        if (p.vref && p.vref !== vref) { heldVref = p.vref; break; }
      }
      if (heldVref && selectRange(heldVref, vref)) {
        for (const p of _activePointers.values()) p.consumed = true;
        _activePointers.set(e.pointerId, { vref, consumed: true });
        return;
      }
      _activePointers.set(e.pointerId, { vref, consumed: false });
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
        readingContext.selectAnchor = vref;
        refreshSelection();
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

  article.addEventListener("pointermove", cancelLongPress);

  article.addEventListener("pointerup", (e) => {
    if (readingContext.verseSelectMode) {
      const entry = _activePointers.get(e.pointerId);
      if (entry) {
        _activePointers.delete(e.pointerId);
        if (!entry.consumed) toggleVerse(entry.vref);
      }
      return;
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointercancel", (e) => {
    if (readingContext.verseSelectMode) { _activePointers.delete(e.pointerId); return; }
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
  // ADR-022: one-time hint pointing out the cite chips (no-op after first show
  // or chip click, and when toggle is OFF or chapter has no chips).
  window.appCitations?.maybeShowCoachmark();

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
  const mobileBookName = NT_MOBILE_NAME[book.id];
  setTitle(`${book.name_ko} 머리말`, mobileBookName ? `${mobileBookName} 머리말` : undefined);
  $title.insertBefore(buildHomeBtn(`/${effectiveDivision(book)}`, "성서 목록으로", book.id), $title.firstChild);
  $title.appendChild(buildSettingsTrigger());
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

// ── Window facade ──
// `appViewsRouting` aggregate + per-name globals so other modules (app.js
// bootstrap, settings-ui / search / bookmark) call setTitle / divisionLabels /
// renderError etc. as bare globals. The view renderers route() needs are ESM-
// exported below for routing.js to import (one-directional). Routing's facade
// (parsePath / route / navigate / routeSeq) moved to routing.js (ADR-034 PR5a);
// data fetching's to data-fetch.js (PR2); audio's to audio-player.js (PR1).

const appViewsRouting = {
  setTitle, setTitleWithChapterPicker,
  buildDivisionTabs, divisionLabels, divisionOrder, effectiveDivision,
  initCompactHeader, initScrollElevation,
  renderError,
  _verseSelectionUnit,
  _verseRangeVrefs,
};
window.appViewsRouting = appViewsRouting;

window.setTitle = setTitle;
window.setTitleWithChapterPicker = setTitleWithChapterPicker;
window.buildDivisionTabs = buildDivisionTabs;
window.divisionLabels = divisionLabels;
window.divisionOrder = divisionOrder;
window.effectiveDivision = effectiveDivision;
window.initCompactHeader = initCompactHeader;
window.initScrollElevation = initScrollElevation;
window.setPendingBookFocus = setPendingBookFocus;
// renderError stays here (view renderer); search.js calls it as a bare global.
window.renderError = renderError;

// ESM exports. The first group is the long-standing public surface; the second
// is the view-renderer entry points routing.js imports (route() dispatch).
export {
  setTitle, setTitleWithChapterPicker,
  buildDivisionTabs, divisionLabels, divisionOrder, effectiveDivision,
  initCompactHeader, initScrollElevation,
  _verseSelectionUnit, _verseRangeVrefs,
  DIVISION_LABELS,
  renderBookList, renderChapterList, renderChapter, renderPrologue,
  renderLoading, renderError,
  appendVerses,
};
