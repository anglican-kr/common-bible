"use strict";

// App-level domain types live in js/types.d.ts. See ADR-012.
/** @typedef {import("./types").ReadingPosition} ReadingPosition */
/** @typedef {import("./types").AudioPosition} AudioPosition */
/** @typedef {import("./types").SearchHistoryList} SearchHistoryList */
/** @typedef {import("./types").VerseSelectDrag} VerseSelectDrag */
/** @typedef {import("./types").DragState} DragState */
/** @typedef {import("./types").ColorSchemeId} ColorSchemeId */
/** @typedef {import("./types").ThemeMode} ThemeMode */
/** @typedef {import("./types").BookOrderKind} BookOrderKind */
/** @typedef {import("./types").ColorSchemeEntry} ColorSchemeEntry */
/** @typedef {import("./types").BookEntry} BookEntry */
/** @typedef {import("./types").BooksData} BooksData */
/** @typedef {import("./types").BibleChapter} BibleChapter */
/** @typedef {import("./types").BiblePrologue} BiblePrologue */
/** @typedef {import("./types").BibleVerse} BibleVerse */
// `BookmarkTreeNode` was previously deferred to the global typedef declared
// in js/sync/store-v2.js, but ADR-018 Phase 2 opted store-v2.js into an ES
// module (so its `saveBookmarks`/`loadBookmarks` no longer collide with
// js/app/storage.js). That moved the alias into module scope, so app.js now
// declares its own typedef.
/** @typedef {import("./types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("./types").BookmarkTreeBookmark} BookmarkTreeBookmark */
/** @typedef {import("./types").BookmarkTreeFolder} BookmarkTreeFolder */

const DATA_DIR = "/data";

// Common DOM helpers live in js/app/helpers.js (ADR-018 Phase 1). `defer`
// load order in index.html guarantees window.appHelpers is populated by
// the time this script runs.
const { _$, chUnit, el, clearNode, setInert, trapFocus } = window.appHelpers;

// localStorage helpers + UI-shared constants live in js/app/storage.js
// (ADR-018 Phase 2). All save fns also notify window.syncStoreV2 + driveSync.
const {
  FONT_SIZES, DEFAULT_FONT_SIZE, COLOR_SCHEMES, SEARCH_HISTORY_MAX,
  saveReadingPosition, loadReadingPosition, clearReadingPosition,
  saveAudioTime, loadAudioTime, clearAudioTime,
  normalizeSearchQuery, loadSearchHistory, saveSearchHistory,
  pushSearchHistory, removeSearchHistory, clearSearchHistory,
  loadStartupBehavior, saveStartupBehavior,
  loadFontSize, saveFontSize,
  loadColorScheme, saveColorScheme,
  loadTheme, saveTheme,
  loadBookOrder, saveBookOrder,
  generateId, loadBookmarks, saveBookmarks,
  _maybeRequestPersist,
} = window.appStorage;

// Settings popover + icon recoloring + theme/color/font apply + launch
// screen live in js/app/settings-ui.js (ADR-018 Phase 3).
const {
  initSettings, applyFontSize, applyTheme, applyColorScheme,
  dismissLaunchScreen,
} = window.appSettings;

// Cross-module reading-view state (current book/chapter + verse selection)
// owned by js/app/reading-context.js (ADR-018 Phase 6a). Local reference for
// terse access — `readingContext.bookId = "gen"` mutates the shared object.
const { readingContext } = window;
// Re-expose on window so the sync layer (state-machine.js) can apply Drive
// settings updates via its `typeof window.applyXxx === "function"` guards.
// `const` destructure does not auto-register on window — must be explicit.
window.applyFontSize = applyFontSize;
window.applyTheme = applyTheme;
window.applyColorScheme = applyColorScheme;

// Window facade for cross-module bare global calls (settings-ui.js,
// search.js, future bookmark.js). Before ADR-019's ESM bulk conversion
// these were resolved via classic-script shared global scope; ESM module
// scope makes each `function X()` module-private, so callers in another
// module would hit `globalThis.X` and fail. Each name below is hoisted
// within this module and re-exposed for ESM bare-global resolution.
// Migrates out as each owner ships in a later phase (ADR-018):
//   announce               → Phase 8 (with $announce anchor)
//   parsePath, route, navigate → Phase 7 (views-routing.js)
//   setTitle, setBreadcrumb    → Phase 7 (rendering helpers)
//   hideAudioBar               → Phase 7 (audio player)
//   renderError                → Phase 7 (rendering helpers)
//   openDriveDisconnectModal   → Phase 6 (bookmark.js) or stays in app-main
//   clearAllCaches             → Phase 8 (app-main)
window.announce = announce;
window.parsePath = parsePath;
window.route = route;
window.navigate = navigate;
// `setTitle` / `setBreadcrumb` / `getBooksCache` moved to views-routing.js
// (ADR-018 Phase 7a) along with the rendering helpers + data fetching.
window.hideAudioBar = hideAudioBar;
window.renderError = renderError;
// `openDriveDisconnectModal` was extracted to bookmark.js (ADR-018 Phase 6b).
window.clearAllCaches = clearAllCaches;

const $app = _$("app");
const $title = _$("page-title");
const $announce = _$("a11y-announce");
const $audioBar = _$("audio-bar");
const $resumeBannerSlot = _$("resume-banner-slot");
// Search-related anchors retained here — still referenced by app.js's
// Escape keydown handler ($searchSheet), route() handler ($searchBar /
// $searchInput / $searchClear), and audio bar lift ($searchFab). The
// remaining 11 search-only anchors live inside js/app/search.js (Phase 5).
const $searchBar = _$("search-bar");
const $searchInput = /** @type {HTMLInputElement} */ (_$("search-input"));
const $searchClear = _$("search-clear");
const $searchFab = _$("search-fab");
const $searchSheet = _$("search-sheet");

// `booksCache` and `appVersion` were extracted to js/app/views-routing.js
// (ADR-018 Phase 7a) along with `loadBooks` / `loadVersion`.
/** @type {HTMLAudioElement | null} */
let currentAudio = null;
/** @type {AbortController | null} */
let _audioController = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _audioSaveTimer = null;

// ── Accessibility ──

/** @param {string} msg */
function announce(msg) {
  $announce.textContent = "";
  requestAnimationFrame(() => { $announce.textContent = msg; });
}

// `trapFocus` was extracted to js/app/helpers.js (ADR-018 Phase 1).

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // Close search overlay if open
    if ($searchSheet && !$searchSheet.hidden) {
      closeSearchSheet();
      return;
    }
    /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll(".chapter-popover:not([hidden]), .bc-division-popover:not([hidden]), .settings-popover:not([hidden]), .title-division-popover:not([hidden])")
    ).forEach((p) => { p.hidden = true; });
    /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll("[aria-expanded='true']")
    ).forEach((b) => { b.setAttribute("aria-expanded", "false"); b.focus(); });
  }
  // Space to toggle audio playback (when not in an input/button)
  const target = e.target;
  if (e.key === " " && currentAudio && target instanceof Element && !["INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(target.tagName)) {
    e.preventDefault();
    if (currentAudio.paused) currentAudio.play(); else currentAudio.pause();
  }
});

// ── Reading position persistence ──
// Storage key constants + load/save helpers were extracted to
// js/app/storage.js (ADR-018 Phase 2). `SEARCH_HISTORY_VISIBLE` moved to
// js/app/search.js (Phase 5) — search history panel controller is the only
// consumer.

/** @type {(() => void) | null} */
let _scrollTrackCleanup = null;
let _isInitialLoad = true;


// `saveReadingPosition` was extracted to js/app/storage.js (ADR-018 Phase 2).

/**
 * @param {string} bookId
 * @param {number} chapter
 */
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

// `loadReadingPosition`, `saveAudioTime`, `loadAudioTime`, `clearAudioTime`
// were extracted to js/app/storage.js (ADR-018 Phase 2).

// ── Audio cache LRU helpers (ADR-016) ──
// One-shot persisted-storage request: called on the first value moment
// (audio play, bookmark save, etc.). navigator.storage.persist() may show a
// browser prompt on Safari/Firefox; on Chrome it grants silently when the
// site has high engagement. We swallow result errors — even if denied, the
// LRU loop in audio-cache.js still functions, just without iOS 7-day evict
// immunity.
// `_maybeRequestPersist` was extracted to js/app/storage.js (ADR-018 Phase 2).

// Soft-cap eviction. Page-driven (SW only enforces hard cap on put). Called
// on visibilitychange→hidden so the work runs while the user is not actively
// reading. SW already opens AUDIO_CACHE under the same name; we use the
// constant exported by audio-cache.js to avoid drift.
async function _enforceAudioSoftCap() {
  const ac = window.bibleAudioCache;
  if (!ac) return;
  try {
    const total = await ac.totalSize();
    if (total <= ac.SOFT_CAP) return;
    const { urls } = await ac.pickEvictions(ac.SOFT_CAP);
    if (!urls.length) return;
    const cache = await caches.open(ac.AUDIO_CACHE_NAME);
    await Promise.all(urls.map((u) => cache.delete(u)));
    await ac.removeEntries(urls);
    window.syncDebugLog?.log({
      kind: "ACTION", event: "audio-evict", reason: "soft",
      count: urls.length, totalBefore: total,
    });
  } catch (_) { /* best-effort */ }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    _enforceAudioSoftCap();
  } else if (document.visibilityState === "visible") {
    // Pull updates from Drive when the user returns to this tab so changes
    // made on another device are reflected without a manual reload.
    // requestSync only dispatches if the machine is IDLE, so rapid toggles
    // can't overlap cycles, and ETag 304 makes a no-change check ~free.
    window.driveSync?.requestSync?.();
  }
});

// ── Font size ──
// `applyFontSize` was extracted to js/app/settings-ui.js (ADR-018 Phase 3).

// ── Cache management ──

/** @returns {Promise<void>} */
async function clearAllCaches() {
  if (!("caches" in window)) return;
  if (!navigator.onLine) {
    alert("오프라인 상태에서는 캐시를 비울 수 없습니다.\n인터넷에 연결된 후 다시 시도해 주세요.");
    return;
  }
  if (!confirm("캐시를 비우면 오프라인 데이터가 삭제됩니다.\n저장된 북마크는 사라지지 않습니다.\n비울까요?")) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.unregister();
    } catch (_) { /* SW unregister failed — continue to reload */ }
    window.location.reload();
  } catch (err) {
    console.error("Cache clear failed:", err);
    alert("캐시를 비우지 못했습니다. 다시 시도해 주세요.");
  }
}

// ── Book order ──
// `loadBookOrder`/`saveBookOrder` were extracted to js/app/storage.js.

// Apply saved settings on load
window.syncStoreV2?.migrateLegacyIfNeeded();
window.syncStoreV2?.sweepTombstones();
applyFontSize(loadFontSize());
applyTheme(loadTheme());
applyColorScheme(loadColorScheme());
initSettings();


// ── Helpers ──
// `el`, `clearNode`, `_$`, `chUnit`, `trapFocus` were extracted to
// js/app/helpers.js (ADR-018 Phase 1). Imported via destructure at module head.

// Verse spec utilities + bookmark query helpers + drag & drop pointer
// handling were extracted to js/app/bookmark.js (ADR-018 Phase 6a). The
// module assigns its functions to `window.X` for legacy bare-global
// callers (Phase 6b territory: bookmark UI / tree / modals / drawer
// handlers — those move out in Phase 6b).


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

function formatVerseLabel(v) {
  let label = String(v.number);
  if (v.part) label += v.part;
  if (v.range_end) label += `-${v.range_end}`;
  return label;
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
    const baseClasses = v.chapter_ref ? "verse verse-cross-ref" : "verse";

    const vn = v.number;

    // Verse number (rendered via CSS ::before to exclude from clipboard)
    let dataV = v.chapter_ref ? `${v.chapter_ref}:${verseLabel}` : verseLabel;
    if (v.alt_ref != null) dataV += `(${v.alt_ref})`;

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
      const isAdding = !readingContext.selectedVerses.has(vs.getAttribute("data-vref") ?? "");
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
        readingContext.selectedVerses.add(vref);
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
      allVerses.forEach((v, i) => {
        const vref = v.getAttribute("data-vref") ?? "";
        if (i >= lo && i <= hi) {
          if (isAdding) readingContext.selectedVerses.add(vref);
          else readingContext.selectedVerses.delete(vref);
        }
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
        // Simple tap: toggle start verse
        const vs = readingContext.verseSelectDrag.allVerses[readingContext.verseSelectDrag.startIdx];
        if (vs) {
          const vref = vs.getAttribute("data-vref") ?? "";
          if (readingContext.verseSelectDrag.isAdding) readingContext.selectedVerses.add(vref);
          else readingContext.selectedVerses.delete(vref);
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
  // (no line-part letters like "1a").
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

    const expanded = document.createRange();
    expanded.setStartBefore(firstVerse);
    expanded.setEndAfter(lastVerse);

    const work = document.createElement("div");
    work.appendChild(expanded.cloneContents());

    // Drop aria-hidden verse-number glyphs (rendered via ::before).
    work.querySelectorAll(".verse-num").forEach((n) => n.remove());
    // Stanza and paragraph boundaries become blank lines; pilcrow markers also
    // emit a blank line (redundant \n\n adjacent to a paragraph-break collapses
    // via the \n{3,} rule below). Hemistich breaks stay as a single line break.
    work.querySelectorAll(".stanza-break, .paragraph-break, .pilcrow").forEach((n) => { n.textContent = "\n\n"; });
    work.querySelectorAll(".hemistich-break").forEach((n) => { n.textContent = "\n"; });

    /** @type {number | null} */
    let firstNum = null;
    /** @type {number | null} */
    let lastNum = null;
    for (const vs of work.querySelectorAll(".verse[data-vref]")) {
      const n = parseInt(vs.getAttribute("data-vref") ?? "", 10);
      if (!Number.isFinite(n)) continue;
      if (firstNum === null) firstNum = n;
      lastNum = n;
    }
    if (firstNum === null) return;

    const plainText = (work.textContent ?? "")
      .replace(/\u2060/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

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

window.addEventListener("popstate", route);
window.addEventListener("DOMContentLoaded", () => {
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));

  // Redirect legacy hash URLs: bible.anglican.kr/#/gen/1 → /gen/1
  if (location.hash.startsWith("#/")) {
    history.replaceState(null, "", location.hash.slice(1));
  }

  // 1. Prioritize UI rendering
  route().finally(() => {
    // 2. Load non-critical work after first paint. Each item targets a surface
    //    the user cannot interact with until they explicitly open it (drawers,
    //    search sheet) or that has no first-paint impact (version label,
    //    compact-header scroll listener, install nudge, SW registration).
    idle(() => {
      loadVersion();
      initCompactHeader();
      initSheetDrag();
      initBookmarkSheetDrag();
      initBookmarkDrawerResize();
      registerServiceWorker();
      maybeShowInstallNudge();
      if (window.driveSync) window.driveSync.initDriveSync();
    });
  });
});

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
  $audioBar.style.position = "sticky";
}

function showAudioUnavailable() {
  clearNode($audioBar);
  const msg = el("p", { className: "audio-unavailable" });
  msg.appendChild(el("span", { className: "audio-unavailable-icon", "aria-hidden": "true" }));
  msg.appendChild(document.createTextNode(" 오디오 파일을 준비 중입니다."));
  $audioBar.appendChild(msg);
  $audioBar.hidden = false;
  $audioBar.style.position = "static";
}

// Search engine + history panel + bottom sheet + drag init live in
// js/app/search.js (ADR-018 Phase 5). The module assigns
// `window.openSearchSheet` / `window.closeSearchSheet` /
// `window.renderSearchResults` / `window.initSheetDrag` for legacy callers
// (route handler, Escape keydown, bootstrap).

function initBookmarkSheetDrag() {
  const handle = _$("bookmark-drawer-handle");
  const drawer = _$("bookmark-drawer");
  let startY = 0;
  let startH = 0;

  function onMove(clientY) {
    const delta = startY - clientY;
    const newH = Math.min(Math.max(startH + delta, window.innerHeight * 0.3), window.innerHeight * 0.92);
    drawer.style.height = `${newH}px`;
  }

  handle.addEventListener("pointerdown", (e) => {
    if (window.innerWidth >= 769) return; // desktop uses fixed-size side panel
    e.preventDefault();
    startY = e.clientY;
    startH = drawer.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  function onPointerMove(e) { onMove(e.clientY); }
  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
    if (drawer.offsetHeight < window.innerHeight * 0.2) {
      closeBookmarkDrawer();
      drawer.style.height = "";
    }
  }
}

function initBookmarkDrawerResize() {
  const handle = _$("bookmark-drawer-resize");
  const drawer = _$("bookmark-drawer");
  let startX = 0;
  let startW = 0;

  handle.addEventListener("pointerdown", (e) => {
    if (window.innerWidth < 769) return;
    e.preventDefault();
    startX = e.clientX;
    startW = drawer.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  function onPointerMove(e) {
    const delta = startX - e.clientX; // drag left = wider
    const newW = Math.min(Math.max(startW + delta, 240), window.innerWidth * 0.85);
    drawer.style.width = `${newW}px`;
  }

  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
  }
}


// PWA install detection + Install guide modal + Install nudge auto-show
// live in js/app/install.js (ADR-018 Phase 4). Loaded as ESM in index.html;
// the module assigns `window.install` / `window.openInstallModal` /
// `window.maybeShowInstallNudge` for legacy callers (settings popover +
// app.js bootstrap).
//
// Background-inert helper shared with the bookmark drawer/sheet UI. Moves
// alongside bookmark UI when Phase 6 ships.
// ── Service Worker Registration & Update ──
// Invoked from the deferred startup hook (DOMContentLoaded → requestIdleCallback)
// so SW lookup, update checks, and shell pre-caching never block first paint.

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  // Ask the waiting SW for the version it has cached, since loadVersion()
  // returns the version of the currently running app (served by the active SW).
  // Falls back to "" on timeout/error so the toast still renders.
  function fetchWaitingVersion(waitingSW) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        resolve(v || "");
      };
      channel.port1.onmessage = (e) => finish(e.data && e.data.version);
      try {
        waitingSW.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      } catch {
        finish("");
        return;
      }
      setTimeout(() => finish(""), 1500);
    });
  }

  async function showUpdateToast(waitingSW) {
    // Prevent duplicate toasts
    if (document.getElementById("sw-update-toast")) return;
    const version = await fetchWaitingVersion(waitingSW);
    const btn = el("button", { id: "sw-update-btn", "aria-label": "새 버전이 있습니다." }, "업데이트");
    const releaseUrl = version
      ? `https://github.com/anglican-kr/common-bible/releases/tag/${encodeURIComponent(version)}`
      : "https://github.com/anglican-kr/common-bible/releases";
    const versionLink = el("a", {
      href: releaseUrl,
      target: "_blank",
      rel: "noopener noreferrer",
      id: "sw-update-release-link",
    }, version || "최신 버전");
    const toast = el("div", { id: "sw-update-toast", role: "alert", "aria-label": "앱 업데이트 알림" },
      el("span", {}, "새 버전이 있습니다: "),
      versionLink,
      btn,
    );
    btn.addEventListener("click", () => {
      waitingSW.postMessage({ type: "SKIP_WAITING" });
      toast.remove();
    });
    document.body.appendChild(toast);
  }

  function trackInstalling(reg) {
    if (!reg.installing) return;
    reg.installing.addEventListener("statechange", () => {
      if (reg.waiting) showUpdateToast(reg.waiting);
    });
  }

  // Poll for a new SW at most once per hour, and only while the tab is visible
  // and online — a phone in the user's pocket performs zero update traffic.
  // visibilitychange/online also retrigger the check on tab return / reconnect,
  // since interval timers are heavily throttled in hidden tabs.
  const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
  function schedulePeriodicUpdate(reg) {
    let lastCheck = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (navigator.onLine === false) return;
      const now = Date.now();
      if (now - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = now;
      reg.update().catch(() => {});
    };
    setInterval(tick, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
  }

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    // A waiting SW already exists (e.g. installed on a previous visit)
    if (reg.waiting) showUpdateToast(reg.waiting);
    // A new SW is being installed right now
    else if (reg.installing) trackInstalling(reg);
    // Listen for future updates — fired when reg.update() finds a new SW too
    reg.addEventListener("updatefound", () => trackInstalling(reg));
    schedulePeriodicUpdate(reg);
  }).catch(() => {});
}

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
