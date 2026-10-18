// @ts-nocheck — 타입 오류가 남아 검사에서 뺐다(docs/known-issues.md §7 묶음 ②). 고치는 PR 이 이 줄을 지운다 — ADR-012.
"use strict";

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
// Copy-attribution translation label shared with the lectionary view and the verse-select bar (verse-spec.js).
import { citationSource } from "./verse-spec.js";

const { _$, el, clearNode, chUnit, hangingQuoteClass, emptyState, headerIcon, HEADER_ICON_PATHS } = window.appHelpers;
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

  $title.appendChild(buildHomeBtn(bookListPath(book), "성서 목록으로", book.id));
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
// Partial: routing.js looks it up with a URL segment, which can miss — the type says so instead of promising a string.
/** @type {Readonly<Partial<Record<string, string>>>} */
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

// Where 「성서 목록으로」 (the reading views' home button · the tab bar's home tab) lands: the book's own
// division tab. A book in no tab — 전례시편 · 송가 (`division: "liturgical"`, ADR-037 §3; reached from the
// lectionary, a bookmark or a shared link, never from the list) — lands on the list's first screen: `/liturgical`
// is no route — parsePath reads it as a book id and the view says 「해당 성서를 찾을 수 없습니다」.
/** @param {BookEntry} book @returns {string} */
function bookListPath(book) {
  const division = effectiveDivision(book);
  return divisionOrder().includes(division) ? `/${division}` : "/";
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

/**
 * Generic segmented tab row — the sliding-indicator pattern the division tabs
 * established, reusable by any "pick one of N" control that routes through a
 * link per option (the lectionary view's collect / set / track segments,
 * ADR-038 §3). Options are anchors so deep links, the back button and keyboard
 * navigation keep working without bespoke handlers. `startIdx` is where the
 * indicator is painted first: pass the previously selected index to animate
 * the slide, or omit it to render the indicator directly under the active tab.
 * An item's `focusKey` becomes the anchor's `data-focus-key`, so when these
 * links redraw their own view the router puts focus back on the pressed option
 * (routing.js — helpers.js focusSpotOf / restoreFocusSpot).
 * @param {Array<{ label: string, href: string, active: boolean, title?: string, focusKey?: string }>} items
 * @param {{ ariaLabel: string, startIdx?: number | null, className?: string }} opts
 * @returns {HTMLElement}
 */
function buildSegmentTabs(items, opts) {
  const activeIdx = Math.max(0, items.findIndex((it) => it.active));
  const startIdx = opts.startIdx != null && opts.startIdx !== activeIdx && opts.startIdx < items.length
    ? opts.startIdx
    : activeIdx;
  const nav = el("nav", {
    className: opts.className ? `division-tabs ${opts.className}` : "division-tabs",
    "aria-label": opts.ariaLabel,
  });
  // Style is applied via the CSSOM (.style), not a `style` attribute: the app's
  // CSP has no 'unsafe-inline' for style-src, so style attributes are blocked —
  // but programmatic .style assignments are always allowed.
  nav.style.setProperty("--tab-count", String(items.length));
  // The sliding accent-outlined box that marks the active tab. The transform is
  // set directly (not via a custom property) so `transition: transform` has a
  // proper before/after value to interpolate.
  const indicator = el("div", { className: "division-tab-indicator", "aria-hidden": "true" });
  indicator.style.transform = `translateX(${startIdx * 100}%)`;
  nav.appendChild(indicator);
  for (const it of items) {
    const a = el("a", { className: it.active ? "division-tab active" : "division-tab", href: it.href }, it.label);
    if (it.title) a.setAttribute("title", it.title);
    if (it.focusKey) a.setAttribute("data-focus-key", it.focusKey);
    if (it.active) a.setAttribute("aria-current", "page");
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
  return nav;
}

function buildDivisionTabs(activeDivision) {
  const labels = divisionLabels();
  const order = divisionOrder();
  const activeIdx = Math.max(0, order.indexOf(activeDivision));
  // Slide from the previous selection when one exists and differs; otherwise
  // render the indicator already under the active tab (no animation).
  // `focusKey`: route() clears this slot and redraws the list, so the router
  // puts focus back on the pressed tab once the list is drawn (routing.js —
  // WCAG 2.4.3; the slot lives outside #app, sticky, so no scroll restore).
  const nav = buildSegmentTabs(
    order.map((div) => ({ label: labels[div], href: `/${div}`, active: div === activeDivision, focusKey: `div:${div}` })),
    { ariaLabel: "구분", startIdx: _prevDivisionIdx },
  );
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
  $title.insertBefore(buildHomeBtn(bookListPath(book), "성서 목록으로", book.id), $title.firstChild);
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
// The element a verse deep-link should scroll to. The exact id wins; otherwise
// the first rendered span whose number matches. The fallback is what makes
// `/dan/3/24`, `/job/27/24`, `/hos/14/14` work: those verses render under an
// instance-qualified id (`v24_lxx`, `v24_c26`) because the number alone does not
// identify them, so `getElementById("v24")` finds nothing.
/**
 * @param {Document | Element} root
 * @param {number | string} n
 * @returns {Element | null}
 */
function findVerseAnchor(root, n) {
  const exact = /** @type {Document} */ (root).getElementById
    ? /** @type {Document} */ (root).getElementById(`v${n}`)
    : root.querySelector(`[id="v${n}"]`);
  if (exact) return exact;
  for (const span of root.querySelectorAll(".verse[data-vref]")) {
    if (parseInt(span.getAttribute("data-vref") ?? "", 10) === Number(n)) return span;
  }
  return null;
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
 * @param {{ hlQuery?: string|null, hlVerse?: number|null, hlVerseEnd?: number|null, hlSegments?: Array<{start:number,end:number,part?:string}>|null, parallels?: ChapterParallel[]|null, chapter?: number|null, hideCites?: boolean, instanceKeys?: ReadonlyArray<string>|null , idPrefix?: string}} [opts]
 */
function appendVerses(article, verses, opts = {}) {
  const { hlQuery = null, hlVerse = null, hlVerseEnd = null, hlSegments = null, parallels = null, chapter = null, hideCites = false, instanceKeys: keysOverride = null, idPrefix = "" } = opts;
  let isFirst = true;
  let prevVerseEndType = null;
  // Several verses in one chapter can share a number (전례시편의 ¶ 구절, 에스델
  // 추가 본문) — DOM ids must come from the instance identity, not the number.
  // The `~N` ordinal in that identity depends on which verses precede it, so
  // subset callers (bookmark reading view) pass keys sliced from the FULL
  // chapter list; recomputing from the excerpt could drift the ordinal on a
  // duplicate-marker chapter.
  // A malformed override (length mismatch) falls back to recomputing — a
  // drifted ordinal id is better than a mid-render crash on undefined.
  const instanceKeys = (keysOverride && keysOverride.length === verses.length)
    ? keysOverride
    : (window.verseInstanceKeys
      ? window.verseInstanceKeys(verses)
      : verses.map((v) => String(v.number)));
  // ADR-039 부(部): 원문이 나눈 편에서 봉독 토막의 첫 절 앞에 "(N)" 소제목.
  let prevSection = null;

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

    // ADR-039 부(部): "(N)" centred sub-heading before the section's first verse.
    // Every verse of a section carries `section`, so a partial excerpt that does
    // not include the section's first verse still labels the toma correctly.
    if (v.section != null && v.section !== prevSection) {
      article.appendChild(el("div", { className: "psalm-section" }, `(${v.section})`));
    }
    if (v.section != null) prevSection = v.section;

    const verseLabel = formatVerseLabel(v);
    // Instance key, not the bare number: an LXX-only verse can share a number
    // with a Hebrew one (Daniel 3), a ¶ clause inherits the previous number
    // (전례시편), and Greek Esther stacks its additions under one number.
    // `~` (the duplicate-marker fallback) is not id-safe, so it becomes `-`.
    // `idPrefix` keeps ids unique when one page renders several chapters (lectionary slots — Copilot review round 7)
    const verseId = `${idPrefix}v${instanceKeys[vIdx].replace(/~/g, "-")}`;
    // `verse-cross-ref` (moved in from another chapter) and `verse-lxx` (Greek-only addition, Daniel 3) mark the spans whose
    // numbers are not this chapter's numbering — the copy citation leaves them out (bindCopyAttribution).
    const baseClasses = v.chapter_ref ? "verse verse-cross-ref" : v.lxx_only ? "verse verse-lxx" : "verse";

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
    /** @type {HTMLElement|null} */
    let lastSpan = null;

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
        // ADR-039 \uacc4\uc751: the response half-line is visually distinct from the
        // cantor's half-line the congregation answers.
        if (seg.response) classes += " verse-response";

        const span = el("span", { className: classes });
        if (isFirstLine) {
          span.id = verseId;
          if (v.versicle) {
            // ADR-039 \ubb34\ubc88\ud638 \ud6c4\uc18d \uad6c\uc808: printed as \u00b6, not as a verse number (it
            // inherits the previous verse's number and has none of its own).
            span.appendChild(el("span", { className: "versicle-mark", "aria-hidden": "true" }, "\u00b6"));
          } else {
            const sup = el("sup", { className: "verse-num", "aria-hidden": "true", "data-v": dataV });
            span.appendChild(sup);
          }
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
        const hqCls = isPoetry ? hangingQuoteClass(line[0]) : "";
        if (hqCls) {
          span.appendChild(el("span", { className: hqCls }, line[0]));
          appendSegText(span, line.slice(1), segTextOpts);
        } else {
          appendSegText(span, line, segTextOpts);
        }
        article.appendChild(span);
        lastSpan = span;
        isFirstLine = false;
      }
      // ADR-039 계응: ◯ closes the cantor's half-line to cue the response. Only
      // where a response actually follows — a trailing cantor line with nothing
      // answering it gets no cue ("마지막 아닌 홀수 줄").
      if (!seg.response && segIdx < segs.length - 1 && segs[segIdx + 1]?.response && lastSpan) {
        lastSpan.appendChild(el("span", {
          className: "responsory-mark", "aria-hidden": "true",
        }, "◯"));
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

/**
 * Copy handler shared by the chapter view and the lectionary view: serialize the
 * selection ourselves so that stanza breaks become blank lines, and append a plain
 * verse-number reference (no line-part letters like "1a" — ADR-022 · the original
 * chapter-view contract). Shared serializer: verse-spec.js `serializeVerseRange`.
 *
 * A verse counts only when the selection overlaps at least one character of it — a
 * range that merely touches the next line's offset 0 (triple-click) or starts at the
 * previous verse's end does not drag that verse in. Selected verses expand to whole
 * rendered spans, as before.
 *
 * `root` may hold several citation units (`unitSelector` — the lectionary's reading
 * sections), each possibly spanning several `<article>`s (a reading that crosses a
 * chapter): every unit becomes its own block 「text — reference」, articles inside a
 * unit are joined by a blank line, and blocks are joined by a blank line too. When
 * the selection also covers other text (`bailoutSelector` — collects, cards, header),
 * or leaves `root` with `strictRoot`, the browser's own copy runs instead so nothing
 * the user selected is dropped (self-review 2026-10-13).
 *
 * Reference numbers are the verses actually selected — merged verses keep both ends
 * (「7-8」), excerpt gaps stay gaps (「2, 14」) — as continuous integer runs. Two exceptions (pre-merge review
 * 2026-10-14): numbers this translation does not have (the article's `data-absent` — 마르 9:44 · 46) do not break a
 * run (「9:43-48」, as on main — user decision 2026-10-14), and spans whose number belongs to another numbering — moved
 * in from another chapter (`verse-cross-ref`, 이사 40 의 41:6-7) or a Greek-only addition (`verse-lxx`, 다니 3) — are
 * left out of the numbers unless nothing else was selected (otherwise 「이사야 40:6-7, 19-20」 · 「다니엘 3:1-90」).
 * `tail` (the lectionary's 영광송 after a psalm) is extra text inside a unit that is not a verse: when the selection
 * covers it, its text follows the unit's verses, before the reference.
 * @param {HTMLElement} root
 * @param {(unit: HTMLElement, runs: Array<{ article: HTMLElement, ranges: Array<[number, number]>, firstNum: number, lastNum: number, atStart: boolean, atEnd: boolean }>) => string} citeOf
 *   the text after 「— 」 for one unit; `runs` = per article in document order — `ranges` the selected verse numbers
 *   as continuous runs, `atStart`/`atEnd` whether the selection reached the article's first/last numbered verse
 * @param {{ unitSelector?: string, bailoutSelector?: string, strictRoot?: boolean, tail?: { selector: string, text: (el: Element) => string } }} [opts]
 */
function bindCopyAttribution(root, citeOf, opts = {}) {
  root.addEventListener("copy", (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (opts.strictRoot && !root.contains(range.commonAncestorContainer)) return;
    if (opts.bailoutSelector && [...root.querySelectorAll(opts.bailoutSelector)].some((n) => overlapsText(range, n))) return;
    const tail = opts.tail;
    // Document order: querySelectorAll returns matches in tree order whatever the selector list order.
    const items = [...root.querySelectorAll(tail ? `.verse[data-vref], ${tail.selector}` : ".verse[data-vref]")]
      .filter((n) => range.intersectsNode(n) && overlapsText(range, n));
    if (!items.some((n) => n.matches(".verse[data-vref]"))) return;
    /** @type {Array<{ unit: HTMLElement, articles: Array<{ article: HTMLElement, spans: Element[] }>, tail: Element | null }>} */
    const units = [];
    for (const v of items) {
      const unit = /** @type {HTMLElement} */ ((opts.unitSelector && v.closest(opts.unitSelector)) || root);
      let u = units[units.length - 1];
      if (!u || u.unit !== unit) units.push(u = { unit, articles: [], tail: null });
      if (tail && v.matches(tail.selector)) { u.tail = v; continue; }
      const article = /** @type {HTMLElement} */ (v.closest("article") || unit);
      let a = u.articles[u.articles.length - 1];
      if (!a || a.article !== article) u.articles.push(a = { article, spans: [] });
      a.spans.push(v);
    }
    const blocks = units.map(({ unit, articles, tail: tailEl }) => {
      const parts = articles.map(({ spans }) => window.serializeVerseRange(spans[0], spans[spans.length - 1]));
      if (tail && tailEl) parts.push(tail.text(tailEl));
      const text = parts.join("\n\n");
      if (!articles.length) return text;   // 영광송만 걸친 단위 — 본문 절이 없으니 출처도 없다
      const runs = articles.map(({ article, spans }) => {
        const own = spans.filter((s) => !s.classList.contains("verse-cross-ref") && !s.classList.contains("verse-lxx"));
        const nums = [...new Set((own.length ? own : spans).flatMap(vrefNumbers))].sort((x, y) => x - y);
        const absent = new Set((article.getAttribute("data-absent") || "").split(",").filter(Boolean).map(Number));
        const numbered = article.querySelectorAll(".verse[data-vref]");
        return {
          article, ranges: numberRuns(nums, absent), firstNum: nums[0], lastNum: nums[nums.length - 1],
          atStart: numbered[0] === spans[0], atEnd: numbered[numbered.length - 1] === spans[spans.length - 1],
        };
      });
      return `${text}\n\n— ${citeOf(unit, runs)}`;
    });
    if (!e.clipboardData) return;
    e.clipboardData.setData("text/plain", blocks.join("\n\n"));
    e.preventDefault();
  });
}

/** 선택이 그 노드의 글자(공백 · U+2060 제외)와 한 글자 이상 겹치나 — 경계에 닿기만 한 것은 아니다. */
function overlapsText(/** @type {Range} */ range, /** @type {Node} */ node) {
  const r = document.createRange();
  r.selectNodeContents(node);
  if (range.compareBoundaryPoints(Range.START_TO_START, r) > 0) r.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, r) < 0) r.setEnd(range.endContainer, range.endOffset);
  return /[^\s\u2060]/.test(r.toString());
}

/** `data-vref` 의 절 번호들 — 「7-8a」 → [7, 8] · 「11b」 → [11] · 「3」 → [3]. @param {Element} v @returns {number[]} */
function vrefNumbers(v) {
  const m = /^(\d+)(?:-(\d+))?/.exec(v.getAttribute("data-vref") || "");
  if (!m) return [];
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
  return Array.from({ length: Math.max(0, b - a) + 1 }, (_, i) => a + i);
}

/**
 * 정렬된 번호 → 연속 구간. 사이에 이 번역에 없는 번호(`absent`)만 있으면 이어진 구간이다 — 없는 절은 건너뛴 절이
 * 아니다(마르 9:43-48 — 사용자 결정 2026-10-14).
 * @param {number[]} nums @param {Set<number>} [absent] @returns {Array<[number, number]>}
 */
function numberRuns(nums, absent) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const n of nums) {
    const last = out[out.length - 1];
    if (last && n > last[1] && onlyAbsentBetween(last[1], n, absent)) last[1] = n;
    else if (!last || n > last[1]) out.push([n, n]);
  }
  return out;
}

/** a 와 b 사이의 번호가 모두 이 번역에 없는가(사이가 비면 참). @param {number} a @param {number} b @param {Set<number>} [absent] */
function onlyAbsentBetween(a, b, absent) {
  for (let k = a + 1; k < b; k++) if (!absent || !absent.has(k)) return false;
  return true;
}

/**
 * 이 장에서 이 번역에 없는 절 번호 — 1 부터 장의 마지막 절까지 가운데 어느 절도 덮지 않는 번호(병합 절은 끝까지 덮는다).
 * 다른 장에서 옮겨 실린 절(`chapter_ref`)과 그리스어 추가 본문(`lxx_only`)은 이 장의 번호 체계가 아니라 세지 않는다.
 * 장 본문 · 전례독서의 `<article data-absent>` 가 되어 복사 출처가 읽는다(마르 9 → [44, 46]).
 * @param {import("../types").BibleVerse[]} verses @returns {number[]}
 */
function absentVerseNumbers(verses) {
  /** @type {Set<number>} */
  const have = new Set();
  let last = 0;
  for (const v of verses) {
    if (v.lxx_only || v.chapter_ref != null) continue;
    const end = Number(v.range_end) || v.number;
    for (let n = v.number; n <= end; n++) have.add(n);
    if (end > last) last = end;
  }
  /** @type {number[]} */
  const out = [];
  for (let n = 1; n <= last; n++) if (!have.has(n)) out.push(n);
  return out;
}

/** 구간 → 「1-3, 5」. @param {Array<[number, number]>} ranges */
function formatVerseRanges(ranges) {
  return ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(", ");
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
  // 이 번역에 없는 절 번호 — 복사 출처가 그 자리에서 구간을 끊지 않게(사용자 결정 2026-10-14, bindCopyAttribution)
  const absent = absentVerseNumbers(data.verses);
  if (absent.length) article.setAttribute("data-absent", absent.join(","));
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
  // Outside select mode: a 500ms long-press on a verse enters select mode and
  // selects that verse (pointermove only cancels after >10px to tolerate
  // natural finger drift). 500ms — not a snappier value — is deliberate: this
  // is the false-positive-prone path, so a finger merely *resting* on the text
  // while reading (or pausing before a scroll) must clear the platform-standard
  // long-press window rather than tripping the mode on a brief 300ms touch.
  //
  // Inside select mode, range selection is anchored on the last individually
  // tapped verse (readingContext.selectAnchor):
  //   • A plain tap/click toggles a single verse and moves the anchor there —
  //     repeated taps build a non-contiguous selection.
  //   • To fill a range, extend from the anchor to another verse. The page
  //     stays scrollable, so the two endpoints need not share a screen:
  //       – Desktop: Shift+click the far verse.
  //       – Mobile:  long-press the far verse (the mobile equivalent of Shift).
  //     A held finger is NOT required across the range — the anchor is
  //     remembered — so the user can tap the start, scroll any distance, then
  //     long-press the end.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let _longPressTimer = null;
  let _longPressStartX = 0;
  let _longPressStartY = 0;

  // Entering select mode is the false-positive-prone path (a finger merely
  // resting on the text while reading must NOT arm it), so it uses the longer,
  // platform-standard 500ms threshold. Range extension *inside* select mode is
  // a deliberate gesture by an already-engaged user, so it stays snappier.
  const ENTER_SELECT_MS = 500;
  const RANGE_EXTEND_MS = 300;
  // In-flight touches in select mode: pointerId → per-pointer gesture state.
  // `timer` fires the long-press range extension; `longPressed`/`moved` decide
  // whether the pointerup should still toggle (a plain tap) or do nothing.
  /** @type {Map<number, { vref: string, x: number, y: number, timer: ReturnType<typeof setTimeout> | null, longPressed: boolean, moved: boolean }>} */
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
      // Desktop: Shift+click extends from the anchor (or, with no anchor yet,
      // acts as a plain toggle that sets the anchor). Handled fully here and
      // returns, so it never also arms the tap/long-press path below — that
      // would leave a spurious toggle queued for the matching pointerup.
      if (e.shiftKey) {
        if (readingContext.selectAnchor) selectRange(readingContext.selectAnchor, vref);
        else toggleVerse(vref);
        return;
      }
      // Otherwise arm a long-press: holding in place extends the range from the
      // anchor; a quick lift (handled in pointerup) toggles the single verse. We
      // do NOT preventDefault — that would block the page scroll the user needs
      // to reach a far range endpoint (text selection is already suppressed by
      // body.verse-select-active { user-select: none }).
      const entry = { vref, x: e.clientX, y: e.clientY, timer: /** @type {ReturnType<typeof setTimeout> | null} */ (null), longPressed: false, moved: false };
      entry.timer = setTimeout(() => {
        entry.timer = null;
        // Guard against firing after the user left select mode or navigated
        // away while the finger was still down (the pointerup that would have
        // cleared this timer never arrived in the same view).
        if (!readingContext.verseSelectMode || !article.isConnected) return;
        entry.longPressed = true;
        if (readingContext.selectAnchor) selectRange(readingContext.selectAnchor, vref);
        else toggleVerse(vref); // no anchor yet → behave like a tap (select + set anchor)
      }, RANGE_EXTEND_MS);
      _activePointers.set(e.pointerId, entry);
      // Capture the pointer so the matching pointermove/up/cancel always reach
      // this article — even if the finger lifts or drifts outside it — so the
      // timer and entry are reliably cleared. Capture does NOT block scrolling:
      // when a pan begins the browser fires pointercancel (releasing capture),
      // which our handler treats as an abort.
      try { article.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
      return;
    }
    const vs = t.closest(".verse[data-vref]");
    if (!vs) return;
    _longPressStartX = e.clientX;
    _longPressStartY = e.clientY;
    _longPressTimer = setTimeout(() => {
      _longPressTimer = null;
      if (!article.isConnected) return; // view was replaced before the press matured
      enterVerseSelectMode(book.id, ch);
      const vref = vs.getAttribute("data-vref");
      if (vref) {
        for (const r of _verseSelectionUnit(article, vref)) {
          readingContext.selectedVerses.add(r);
        }
        readingContext.selectAnchor = vref;
        refreshSelection();
      }
    }, ENTER_SELECT_MS);
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
    // Cancel a pending in-mode long-press once the finger drifts >10px — the
    // user is scrolling (to reach a far verse), not pressing-and-holding.
    const entry = _activePointers.get(e.pointerId);
    if (entry && !entry.longPressed) {
      const dx = e.clientX - entry.x;
      const dy = e.clientY - entry.y;
      if (dx * dx + dy * dy >= 100) {
        entry.moved = true;
        if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
      }
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointerup", (e) => {
    const entry = _activePointers.get(e.pointerId);
    if (entry) {
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
      _activePointers.delete(e.pointerId);
      // A quick tap (no long-press, no scroll-drift) toggles the verse. A
      // long-press already extended the range; a drifted pointer was a scroll.
      // Guard verseSelectMode: if the mode ended while the finger was down
      // (cancel / copy / navigation), a late pointerup must not re-toggle.
      if (!entry.longPressed && !entry.moved && readingContext.verseSelectMode) toggleVerse(entry.vref);
      return;
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointercancel", (e) => {
    const entry = _activePointers.get(e.pointerId);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      _activePointers.delete(e.pointerId);
      return;
    }
    cancelLongPress(e);
  });

  // one article — one chapter. The liturgical books (전례시편 · 송가) are the prayer-book translation, not 공동번역
  // (ADR-037 §1 · §3), so they are credited to 「(대한성공회 기도서)」 (사용자 결정 2026-10-13 — verse-spec.js citationSource).
  bindCopyAttribution(article, (_unit, runs) =>
    `${book.name_ko} ${ch}:${formatVerseRanges(runs[0].ranges)} ${citationSource(book.division === "liturgical")}`);

  $app.appendChild(article);
  $app.appendChild(buildChapterNav(book, ch));
  showAudioPlayer(book.id, ch);
  // ADR-022: one-time hint pointing out the cite chips (no-op after first show
  // or chip click, and when toggle is OFF or chapter has no chips).
  window.appCitations?.maybeShowCoachmark();

  // Scroll to highlighted verse, resumed position, or top
  const scrollVerse = hlVerse || (opts && opts.resumeVerse) || null;
  if (scrollVerse) {
    const target = findVerseAnchor(document, scrollVerse);
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
  $title.insertBefore(buildHomeBtn(bookListPath(book), "성서 목록으로", book.id), $title.firstChild);
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

// ── Liturgical view shell (ADR-038) ──
// 캘린더 탭 · 전례독서 화면의 껍데기 — 이름 · 바깥 상자 · 머리 · 전체 화면 실패. 두 화면의 모듈(calendar.js · lectionary.js)은
// 처음 갈 때 받고(routing.js), 그 모듈을 받지 못하면 모듈 안의 것을 쓸 수 없으므로 라우터와 두 모듈이 같이 쓰는 것은 부팅
// 모듈인 여기 둔다. 한 곳이라 머리 컨트롤 · 문구가 화면마다 갈라지지 않는다(PR #355 리뷰, 2026-10-18 — 그전엔 세 벌이었고,
// 전례독서 모듈을 받지 못한 화면만 휴대폰에서 머리에 누를 단추가 없었다).

/** @typedef {"calendar" | "lectionary"} LiturgicalView */

/**
 * 두 화면의 이름 · 바깥 상자 클래스 · 자료(또는 화면 모듈)를 받지 못했을 때의 제목.
 * @type {Readonly<Record<LiturgicalView, { title: string, panel: string, loadFailure: string }>>}
 */
const LITURGICAL_VIEWS = Object.freeze({
  calendar: { title: "캘린더", panel: "calendar", loadFailure: "교회력 자료를 불러오지 못했습니다" },
  lectionary: { title: "전례독서", panel: "lectionary", loadFailure: "전례독서 자료를 불러오지 못했습니다" },
});

// 전체 화면 실패의 다음 행동 이름 — 부제가 이 이름으로 할 일을 가리킨다(coding-pitfalls §29).
const RELOAD_LABEL = "다시 불러오기";
const THIS_MONTH_LABEL = "이번 달 캘린더";

/**
 * 머리 — 제목과 머리 컨트롤, 오디오 바는 내린다(성공 화면 · 실패 화면이 같이 쓴다). 캘린더는 성서 목록 집 단추(데스크톱 —
 * 모바일은 탭 바가 대신해 CSS가 숨긴다; 설정 · 북마크 탭 화면과 같다). 전례독서는 위 단계 — 그 날짜가 든 달의 캘린더로 가는
 * 꺾쇠다(ADR-038 §2 「구현」). 다른 탭 머리의 집 단추는 성서 목록을 뜻하고 모바일에서 숨는데(`.title-home-btn`), 이 꺾쇠는
 * 캘린더 탭 안에서 한 단계 위(iOS 캘린더의 「< 10월」)라 모바일에서도 보인다. 다른 컨트롤처럼 링크라 전역 <a> 인터셉터가 이동한다.
 * @param {LiturgicalView} view
 * @param {{ y: number, m: number } | null} [month]  전례독서 — 그 날짜가 든 달. 없으면(깨진 · 범위 밖 날짜 · 실패 화면) 이번 달
 */
function commitLiturgicalTitle(view, month = null) {
  setTitle(LITURGICAL_VIEWS[view].title);
  const control = view === "calendar" ? window.buildHomeBtn("/", "성서 목록으로") : buildCalendarUpLink(month);
  $title.insertBefore(control, $title.firstChild);
  hideAudioBar();
}

/** @param {{ y: number, m: number } | null} month */
function buildCalendarUpLink(month) {
  const a = el("a", month
    ? {
      className: "title-back-btn",
      href: `/calendar/${String(month.y).padStart(4, "0")}-${String(month.m).padStart(2, "0")}`,
      "aria-label": `${month.y}년 ${month.m}월 캘린더로`,
    }
    : { className: "title-back-btn", href: "/calendar", "aria-label": "캘린더로" });
  a.appendChild(headerIcon(HEADER_ICON_PATHS.back));   // 왼쪽 꺾쇠
  return a;
}

/**
 * 전체 화면 실패(DESIGN.md §6) — 캘린더 · 전례독서를 통째로 그리지 못했을 때. 머리는 그 뷰의 것이고 앞 화면의 헤더 · 제목 ·
 * 오디오 바를 남기지 않는다(ADR-038 §3 「실패 · 범위」 — 그래서 본문만 바꾸는 `.error` 한 줄이 아니다). 본문은 아이콘 없는 빈
 * 상태(제목은 안 된 것, 부제는 다음 할 일을 단추 이름으로)와 다음 행동 하나. 라이브 영역에는 제목과 안 된 것을 함께 읽힌다 —
 * setTitle 만으로는 제목만 들려 성공한 화면과 귀로 구별되지 않았다(리뷰 2026-10-18).
 * @param {LiturgicalView} view
 * @param {{ message: string, subtitle: string, action: "reload" | "this-month" }} failure  action — 「다시 불러오기」(그 자리에서
 *   다시 — 단추) 또는 「이번 달 캘린더」(날짜를 다시 고르러 — 링크)
 * @returns {string} 페이지 메타의 제목
 */
function renderLiturgicalFailure(view, { message, subtitle, action }) {
  const { title, panel } = LITURGICAL_VIEWS[view];
  commitLiturgicalTitle(view);
  clearNode($app);
  const box = el("div", { className: panel });
  box.appendChild(emptyState({ icon: null, title: message, subtitle }));
  box.appendChild(el("p", { className: "state-action" },
    action === "reload" ? buildReloadButton() : el("a", { href: "/calendar" }, THIS_MONTH_LABEL)));
  $app.appendChild(box);
  announce(`${title} — ${message}`);
  return title;
}

/**
 * 「다시 불러오기」 — 페이지를 새로 고친다. 화면 모듈을 받지 못했을 때 브라우저는 그 실패를 새로 고칠 때까지 기억해서(그것을
 * 바꾼 HTML 표준 변경이 2026-07 — 엔진마다 반영 중) 화면을 다시 여는 것만으로는 풀리지 않을 수 있다(사용자 결정 2026-10-17).
 * 교회력 자료를 받지 못했을 때도 같은 단추다 — 같은 꼴의 화면에 같은 행동이고, 실패한 그 달 · 그날이 다시 열린다(리뷰
 * 2026-10-18 — 그전의 「이번 달 캘린더」는 /calendar/2027-03에서 실패한 3월이 아니라 이번 달로 갔다).
 */
function buildReloadButton() {
  const button = el("button", { type: "button" }, RELOAD_LABEL);
  button.addEventListener("click", () => location.reload());
  return button;
}

/**
 * 자료나 화면 모듈을 받지 못했을 때(연결이 끊김 · 캐시 없음 · 배포 사이의 어긋남)의 실패 화면 — 사용자에게는 같은 일이라
 * 화면도 같다.
 * @param {LiturgicalView} view
 * @returns {string} 페이지 메타의 제목
 */
function renderLiturgicalLoadFailure(view) {
  return renderLiturgicalFailure(view, {
    message: LITURGICAL_VIEWS[view].loadFailure,
    subtitle: `네트워크 연결을 확인한 뒤 「${RELOAD_LABEL}」를 눌러 주세요.`,
    action: "reload",
  });
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
window.bookListPath = bookListPath;   // tabbar.js — the home tab lands where the home button does
window.initCompactHeader = initCompactHeader;
window.initScrollElevation = initScrollElevation;
window.setPendingBookFocus = setPendingBookFocus;
// renderError stays here (view renderer); search.js calls it as a bare global.
window.renderError = renderError;

// ESM exports. The first group is the long-standing public surface; the second
// is the view-renderer entry points routing.js imports (route() dispatch); the
// last is the liturgical view shell calendar.js · lectionary.js · routing.js share.
export {
  setTitle, setTitleWithChapterPicker,
  buildDivisionTabs, buildSegmentTabs, bindCopyAttribution, formatVerseRanges, absentVerseNumbers, divisionLabels, divisionOrder, effectiveDivision,
  bookListPath,
  initCompactHeader, initScrollElevation,
  _verseSelectionUnit, _verseRangeVrefs,
  DIVISION_LABELS,
  renderBookList, renderChapterList, renderChapter, renderPrologue,
  renderLoading, renderError,
  appendVerses,
  LITURGICAL_VIEWS, THIS_MONTH_LABEL, commitLiturgicalTitle, renderLiturgicalFailure, renderLiturgicalLoadFailure,
};
