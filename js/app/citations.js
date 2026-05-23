"use strict";
// @ts-check

// ADR-022 citation + annotation chip rendering helpers.
//
// Phase 2 C2 scope (this file):
//   - _computeCiteShowPositions: dedup consecutive same-cite verses → only
//     the LAST emits a chip (ADR-022 §6 dedup rule).
//   - buildCiteChip: build a clickable chip showing src + optional parallels
//     + optional tradition.
//   - buildNoteElement: build a verse-attached annotation paragraph.
//
// Click wiring (cite chip → bottom sheet) lives in C3 (cite-sheet logic),
// also added to this module. C2 only renders chips with data-* attrs that
// C3's delegated click listener will read.
//
// Cross-module dependencies:
//   - window.appHelpers: el (DOM builder)

window.appCitations = (() => {
  /** @typedef {import("../types").BibleVerseSegment} BibleVerseSegment */
  /** @typedef {import("../types").BibleVerse} BibleVerse */
  /** @typedef {import("../types").BibleVerseNote} BibleVerseNote */
  /** @typedef {import("../types").BibleChapter} BibleChapter */
  /** @typedef {import("../types").BooksData} BooksData */

  const { el, clearNode, trapFocus } = window.appHelpers;

  /**
   * For each `(verseIndex, segmentIndex)` whose segment has a `cite`, decide
   * whether that segment should render a chip. Per ADR-022 §6: when consecutive
   * cite segments share `(src, tradition, parallels)`, only the LAST emits a
   * chip — earlier ones suppress (visually merged into one citation unit).
   *
   * Adjacency rule: a "consecutive" group means cite segments either in the
   * same verse or in immediately neighboring verses (no gap verse in between).
   *
   * @param {ReadonlyArray<BibleVerse>} verses
   * @returns {Set<string>} keys of the form `"<vi>:<si>"` that SHOULD render
   */
  function _computeCiteShowPositions(verses) {
    const flat = [];
    verses.forEach((v, vi) => {
      const segs = v.segments || [];
      segs.forEach((s, si) => {
        if (s.cite) {
          flat.push({
            vi, si,
            src: s.cite,
            tr: s.tradition || null,
            // Stringify parallels list for cheap equality comparison.
            par: s.parallels ? s.parallels.join("|") : "",
            vNum: v.number,
          });
        }
      });
    });

    const showAt = new Set();
    for (let i = 0; i < flat.length; i++) {
      const cur = flat[i];
      const next = flat[i + 1];
      const sameGroup = next
        && cur.src === next.src
        && cur.tr  === next.tr
        && cur.par === next.par
        && (next.vNum === cur.vNum || next.vNum === cur.vNum + 1);
      if (!sameGroup) showAt.add(`${cur.vi}:${cur.si}`);
    }
    return showAt;
  }

  /**
   * Compose the chip text "(src · tradition · parallel1 · parallel2 …)".
   * tradition (if present) follows src; parallels follow tradition.
   *
   * @param {string} src
   * @param {ReadonlyArray<string> | null | undefined} parallels
   * @param {string | null | undefined} tradition
   * @returns {string}
   */
  function chipText(src, parallels, tradition) {
    const parts = [src];
    if (tradition) parts.push(tradition);
    if (parallels && parallels.length) parts.push(...parallels);
    return `(${parts.join(" · ")})`;
  }

  /**
   * Build a chip element. Render style depends on segment type:
   *   - "poetry" → block-style chip on its own line (ADR-022 §6 운문 예외)
   *   - "prose"  → inline chip following the segment text
   *
   * The chip is a `<button>` for keyboard accessibility. Data attributes
   * carry src/tradition/parallels for the C3 click delegation.
   *
   * @param {string} src
   * @param {ReadonlyArray<string> | null | undefined} parallels
   * @param {string | null | undefined} tradition
   * @param {"prose" | "poetry"} segmentType
   * @returns {HTMLElement}
   */
  function buildCiteChip(src, parallels, tradition, segmentType) {
    const label = chipText(src, parallels, tradition);
    const cls = segmentType === "poetry" ? "cite-chip cite-chip--poetry" : "cite-chip";
    /** @type {Record<string, string>} */
    const attrs = {
      type: "button",
      className: cls,
      "data-cite-src": src,
      "aria-label": `인용 출처 ${label} — 본문 보기`,
    };
    if (tradition) attrs["data-cite-tradition"] = tradition;
    if (parallels && parallels.length) attrs["data-cite-parallels"] = parallels.join(";");
    return el("button", attrs, label);
  }

  /**
   * Build a verse-attached note paragraph: "anchor — body".
   * Block-level; placed after the verse text. Visible only when body has
   * the `cites-shown` class.
   *
   * @param {BibleVerseNote} note
   * @returns {HTMLElement}
   */
  function buildNoteElement(note) {
    const wrap = el("div", { className: "verse-note", role: "note" });
    wrap.appendChild(el("span", { className: "verse-note-anchor" }, note.anchor));
    wrap.appendChild(document.createTextNode(" — " + note.body));
    return wrap;
  }

  // ── ADR-022 cite sheet (bottom sheet, modal) ──────────────────────────

  /** @type {Map<string, string> | null} */
  let _booksByShort = null;
  /** @type {HTMLElement | null} */
  let _sheetReturnFocus = null;
  /** @type {(() => void) | null} */
  let _sheetTrapCleanup = null;
  /** @type {{ src: string, parallels: ReadonlyArray<string> | null, tradition: string | null, expanded: boolean } | null} */
  let _sheetState = null;

  /**
   * Lazily build short_name_ko → book_id map from books.json.
   * Uses window.booksPromise (pre-fetched at boot) when available.
   *
   * @returns {Promise<Map<string, string>>}
   */
  async function _ensureBooksByShort() {
    if (_booksByShort) return _booksByShort;
    /** @type {BooksData} */
    const books = await (window.booksPromise || fetch("/data/books.json").then((r) => r.json()));
    const map = new Map();
    for (const b of books) {
      if (b.short_name_ko) map.set(b.short_name_ko, b.id);
    }
    _booksByShort = map;
    return map;
  }

  /**
   * Parse a cite src string into structured parts.
   * Returns null when format is invalid (caller renders error message).
   *
   * @param {string} src
   * @returns {{ abbr: string, parts: Array<{ startCh: number, startV: number, endCh: number | null, endV: number | null }> } | null}
   */
  function _parseCiteSrc(src) {
    const top = src.match(/^([^\s]+)\s+(\d+):(.+)$/);
    if (!top) return null;
    const abbr = top[1];
    const startCh = parseInt(top[2], 10);
    const spec = top[3];
    const parts = [];
    for (const raw of spec.split(",")) {
      const token = raw.trim();
      const m = token.match(/^(\d+)(?:-(?:(\d+):)?(\d+))?$/);
      if (!m) return null;
      parts.push({
        startCh,
        startV: parseInt(m[1], 10),
        endCh: m[2] ? parseInt(m[2], 10) : null,
        endV:  m[3] ? parseInt(m[3], 10) : null,
      });
    }
    return { abbr, parts };
  }

  /**
   * Decide which verses of a fetched chapter belong to the slice for any of
   * the cite parts (a part may span the current chapter as start/middle/end).
   *
   * @param {ReadonlyArray<BibleVerse>} allVerses
   * @param {Array<{ startCh: number, startV: number, endCh: number | null, endV: number | null }>} parts
   * @param {number} currentCh
   */
  function _selectVerses(allVerses, parts, currentCh) {
    const wanted = new Set();
    for (const p of parts) {
      const endCh = p.endCh ?? p.startCh;
      if (p.endV === null) {
        if (currentCh === p.startCh) wanted.add(p.startV);
        continue;
      }
      if (p.endCh === null) {
        if (currentCh === p.startCh) {
          for (let v = p.startV; v <= p.endV; v++) wanted.add(v);
        }
        continue;
      }
      // Cross-chapter range
      if (currentCh === p.startCh) {
        for (const v of allVerses) {
          if (v.number >= p.startV) wanted.add(v.number);
        }
      } else if (currentCh > p.startCh && currentCh < endCh) {
        for (const v of allVerses) wanted.add(v.number);
      } else if (currentCh === endCh) {
        for (let v = 1; v <= p.endV; v++) wanted.add(v);
      }
    }
    return allVerses.filter((v) => wanted.has(v.number));
  }

  /**
   * Render a set of verses in the sheet — minimal style without cite/note
   * chips (ADR-022 §6 — sheet body keeps "토글 off" effective).
   *
   * @param {HTMLElement} container
   * @param {string} bookNameKo
   * @param {number} chapter
   * @param {ReadonlyArray<BibleVerse>} verses
   * @param {Set<number> | null} [highlightedNumbers] verse numbers to mark as
   *   the originally-cited slice (used in expanded full-chapter view).
   */
  function _renderVerses(container, bookNameKo, chapter, verses, highlightedNumbers) {
    container.appendChild(el("div", { className: "cite-sheet-chapter-label" },
      `${bookNameKo} ${chapter}장`));
    const article = el("article", { className: "cite-sheet-verses", lang: "ko" });
    for (const v of verses) {
      const isCited = highlightedNumbers && highlightedNumbers.has(v.number);
      const p = el("p", {
        className: isCited ? "cite-sheet-verse cite-sheet-verse--highlighted" : "cite-sheet-verse",
      });
      p.appendChild(el("sup", { className: "cite-sheet-verse-num" }, String(v.number)));
      p.appendChild(document.createTextNode(" "));
      const segs = v.segments || [{ type: "prose", text: v.text || "" }];
      const flat = segs.map((s) => s.text).join("\n");
      // Preserve line breaks via simple <br> insertion (poetry hemistichs).
      const lines = flat.split("\n");
      lines.forEach((line, idx) => {
        if (idx > 0) p.appendChild(el("br"));
        p.appendChild(document.createTextNode(line));
      });
      article.appendChild(p);
    }
    container.appendChild(article);
  }

  /**
   * Fetch + render one cite reference (primary or parallel) in the sheet body.
   *
   * @param {HTMLElement} container
   * @param {string} src
   * @param {string | null} tradition  null when not the primary reference
   * @param {boolean} expanded  true → render full chapters, mark cited verses
   */
  async function _renderRef(container, src, tradition, expanded) {
    const parsed = _parseCiteSrc(src);
    if (!parsed) {
      container.appendChild(el("p", { className: "cite-sheet-error" },
        `잘못된 인용 형식: ${src}`));
      return;
    }
    const booksByShort = await _ensureBooksByShort();
    const bookId = booksByShort.get(parsed.abbr);
    if (!bookId) {
      container.appendChild(el("p", { className: "cite-sheet-error" },
        `알 수 없는 책 약어: ${parsed.abbr}`));
      return;
    }
    const refTitle = src + (tradition ? ` · ${tradition}` : "");
    container.appendChild(el("h3", { className: "cite-sheet-ref-title" }, refTitle));

    const chapters = new Set();
    for (const p of parsed.parts) {
      chapters.add(p.startCh);
      if (p.endCh) chapters.add(p.endCh);
    }
    const sortedChapters = [...chapters].sort((a, b) => a - b);

    for (let ci = 0; ci < sortedChapters.length; ci++) {
      const ch = sortedChapters[ci];
      if (ci > 0) container.appendChild(el("hr", { className: "cite-sheet-chapter-divider" }));
      try {
        /** @type {BibleChapter} */
        const data = await fetch(`/data/bible/${bookId}-${ch}.json`).then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        });
        if (expanded) {
          // Show full chapter; highlight verses that were originally cited.
          const cited = new Set(_selectVerses(data.verses, parsed.parts, ch).map((v) => v.number));
          _renderVerses(container, data.book_name_ko, ch, data.verses, cited);
        } else {
          const slice = _selectVerses(data.verses, parsed.parts, ch);
          _renderVerses(container, data.book_name_ko, ch, slice, null);
        }
      } catch (_) {
        container.appendChild(el("p", { className: "cite-sheet-error" },
          `${parsed.abbr} ${ch}장을 불러오지 못했습니다.`));
      }
    }
  }

  /**
   * Re-render the sheet body using the current `_sheetState`. Used after
   * the user toggles expanded mode.
   */
  async function _renderSheetBody() {
    const bodyEl = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet-body"));
    if (!bodyEl || !_sheetState) return;
    clearNode(bodyEl);
    bodyEl.appendChild(el("p", { className: "cite-sheet-loading" }, "불러오는 중…"));
    try {
      clearNode(bodyEl);
      const { src, parallels, tradition, expanded } = _sheetState;
      const refs = [src, ...(parallels || [])];
      for (let i = 0; i < refs.length; i++) {
        if (i > 0) bodyEl.appendChild(el("hr", { className: "cite-sheet-divider" }));
        await _renderRef(bodyEl, refs[i], i === 0 ? tradition : null, expanded);
      }
      if (!expanded) bodyEl.appendChild(_buildExpandButton());
    } catch (_) {
      clearNode(bodyEl);
      bodyEl.appendChild(el("p", { className: "cite-sheet-error" }, "불러오는 데 실패했습니다."));
    }
  }

  function _buildExpandButton() {
    const btn = el("button", {
      type: "button",
      className: "cite-sheet-expand-btn",
    }, "이 장 전체 보기");
    btn.addEventListener("click", async () => {
      if (!_sheetState) return;
      _sheetState.expanded = true;
      await _renderSheetBody();
    });
    return btn;
  }

  /**
   * Open the cite sheet showing the cited passage(s). Primary src first, then
   * each parallel divided by a horizontal rule (ADR-022 §6).
   *
   * @param {string} src
   * @param {ReadonlyArray<string> | null} parallels
   * @param {string | null} tradition
   * @param {HTMLElement | null} returnFocusEl
   */
  async function openCiteSheet(src, parallels, tradition, returnFocusEl) {
    const sheet  = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet"));
    const titleEl = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet-title"));
    const bodyEl = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet-body"));
    if (!sheet || !titleEl || !bodyEl) return;

    _sheetReturnFocus = returnFocusEl;
    _sheetState = { src, parallels: parallels || null, tradition: tradition || null, expanded: false };
    titleEl.textContent = chipText(src, parallels, tradition).slice(1, -1);
    sheet.hidden = false;
    document.documentElement.classList.add("cite-sheet-open");

    const closeBtn = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet-close"));
    if (closeBtn) closeBtn.focus();
    _sheetTrapCleanup = trapFocus(sheet);

    await _renderSheetBody();
  }

  function closeCiteSheet() {
    const sheet = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet"));
    if (!sheet) return;
    sheet.hidden = true;
    document.documentElement.classList.remove("cite-sheet-open");
    if (_sheetTrapCleanup) { _sheetTrapCleanup(); _sheetTrapCleanup = null; }
    if (_sheetReturnFocus && typeof _sheetReturnFocus.focus === "function") {
      _sheetReturnFocus.focus();
    }
    _sheetReturnFocus = null;
    _sheetState = null;
  }

  /** Wire up close button, ESC key, and `.cite-chip` click delegation. */
  function initCiteSheet() {
    document.getElementById("cite-sheet-close")?.addEventListener("click", closeCiteSheet);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const sheet = document.getElementById("cite-sheet");
        if (sheet && !sheet.hidden) {
          e.stopPropagation();
          closeCiteSheet();
        }
      }
    });

    // Delegated click: any .cite-chip anywhere in the main reading article.
    document.body.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const chip = target.closest(".cite-chip");
      if (!(chip instanceof HTMLElement)) return;
      const src = chip.getAttribute("data-cite-src");
      if (!src) return;
      const parallelsRaw = chip.getAttribute("data-cite-parallels") || "";
      const parallels = parallelsRaw
        ? parallelsRaw.split(";").map((p) => p.trim()).filter(Boolean)
        : null;
      const tradition = chip.getAttribute("data-cite-tradition") || null;
      openCiteSheet(src, parallels, tradition, chip);
    });
  }

  return {
    _computeCiteShowPositions,
    chipText,
    buildCiteChip,
    buildNoteElement,
    openCiteSheet,
    closeCiteSheet,
    initCiteSheet,
  };
})();

// ESM module marker (ADR-019)
export {};
