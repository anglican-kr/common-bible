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
  /** @typedef {import("../types").CiteParallelRef} CiteParallelRef */

  // ADR-022 §2: a parallel entry's inline `[전통]` suffix. Same regex shape
  // as parser.py's _PARALLEL_TRADITION_RE — round-trips data-cite-parallels
  // through the source markdown's own notation.
  const _PARALLEL_TRADITION_RE = /^(.+?)\s*\[([^\[\]]+)\]\s*$/;

  /**
   * Round-trip parse a `data-cite-parallels` attribute back into structured refs.
   * Format mirrors the source markdown: `"ref [전통]; ref2; ref3 [vulgata]"`.
   *
   * @param {string | null} raw
   * @returns {Array<CiteParallelRef> | null}
   */
  function _parseParallelsAttr(raw) {
    if (!raw) return null;
    const out = [];
    for (const part of raw.split(";")) {
      const s = part.trim();
      if (!s) continue;
      const m = _PARALLEL_TRADITION_RE.exec(s);
      if (m) {
        out.push({ ref: m[1].trim(), tradition: m[2].trim() });
      } else {
        out.push({ ref: s });
      }
    }
    return out.length ? out : null;
  }

  /**
   * Inverse of `_parseParallelsAttr` — serialize back to the `[전통]` shape.
   *
   * @param {ReadonlyArray<CiteParallelRef>} parallels
   * @returns {string}
   */
  function _serializeParallelsAttr(parallels) {
    return parallels
      .map((p) => (p.tradition ? `${p.ref} [${p.tradition}]` : p.ref))
      .join(";");
  }

  const { el, clearNode, dragReleaseAction } = window.appHelpers;
  const { createOverlay } = window.appOverlay;

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
            // ADR-022 §6 dedup: each parallel's (ref, tradition) tuple is part
            // of the equality key — a parallel that shifts from MT-default to
            // [칠십인역] should break the dedup group even if `ref` is identical.
            par: s.parallels
              ? s.parallels.map((p) => `${p.tradition || ""}~${p.ref}`).join("|")
              : "",
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
   * Compose the chip text "(src · parallel1 · parallel2 …)".
   * Each ref (primary or parallel) is prefixed with its own tradition label
   * when present, e.g. `(칠십인역 이사 40:3 · 신명 5:17 · 칠십인역 시편 16:8)`.
   *
   * @param {string} src
   * @param {ReadonlyArray<CiteParallelRef> | null | undefined} parallels
   * @param {string | null | undefined} tradition
   * @returns {string}
   */
  function chipText(src, parallels, tradition) {
    const primary = (tradition ? `${tradition} ` : "") + src;
    const parts = [primary];
    if (parallels && parallels.length) {
      for (const p of parallels) {
        parts.push((p.tradition ? `${p.tradition} ` : "") + p.ref);
      }
    }
    return `(${parts.join(" · ")})`;
  }

  /**
   * Build a chip element. Render style depends on segment type:
   *   - "poetry" → block-style chip on its own line (ADR-022 §6 운문 예외)
   *   - "prose"  → inline chip following the segment text
   *
   * Rendered as `<span role="button">` rather than a native `<button>`: the
   * browser forces `<button>` to display:inline-block, so a long chip label
   * (tradition + src + several parallels) can never break across lines — it
   * wraps as one atomic box and drops wholesale to the next line. A span flows
   * inline like the surrounding text, so a long label wraps mid-label at the
   * ` · ` separators. Keyboard activation (Enter/Space) is wired manually in
   * `initCiteSheet` since a span gets none for free. Data attributes carry
   * src/tradition/parallels for the click delegation.
   *
   * @param {string} src
   * @param {ReadonlyArray<CiteParallelRef> | null | undefined} parallels
   * @param {string | null | undefined} tradition
   * @param {"prose" | "poetry"} segmentType
   * @returns {HTMLElement}
   */
  function buildCiteChip(src, parallels, tradition, segmentType) {
    const label = chipText(src, parallels, tradition);
    const cls = segmentType === "poetry" ? "cite-chip cite-chip--poetry" : "cite-chip";
    /** @type {Record<string, string>} */
    const attrs = {
      role: "button",
      tabindex: "0",
      className: cls,
      "data-cite-src": src,
      "aria-label": `인용 출처 ${label} — 본문 보기`,
    };
    if (tradition) attrs["data-cite-tradition"] = tradition;
    if (parallels && parallels.length) {
      // Serialize per-parallel tradition using the same `[전통]` inline
      // notation as source markdown so `_parseParallelsAttr` can round-trip.
      attrs["data-cite-parallels"] = _serializeParallelsAttr(parallels);
    }
    return el("span", attrs, label);
  }

  /**
   * Walk an already-rendered chapter article and wrap each note's anchor
   * occurrence with a clickable button. The note body is stashed in a data
   * attribute so the delegated click handler can show it in a tooltip
   * (ADR-022 §6 — anchor click → 툴팁).
   *
   * @param {HTMLElement} article  the `.chapter-text` article element
   * @param {ReadonlyArray<BibleVerse>} verses
   */
  // Variant-style marker used when a note has no text anchor (typical case:
  // "이 구절에 어떤 사본은 다음을 추가" — author wraps whitespace or empty
  // in <note>...</note>). Rendered as a small ※ button at the verse end.
  const VARIANT_MARKER = "※";

  function wrapNoteAnchorsInArticle(article, verses) {
    for (const v of verses) {
      if (!v.notes || !v.notes.length) continue;
      const vrefRoot = `${v.number}`;
      const spans = Array.from(article.querySelectorAll(".verse[data-vref]"))
        .filter((sp) => {
          const ref = sp.getAttribute("data-vref") || "";
          const m = /^\d+/.exec(ref);
          return m ? m[0] === vrefRoot : false;
        });
      if (!spans.length) continue;
      for (const note of v.notes) {
        const occurrence = note.anchor_occurrence || 1;
        const trimmed = (note.anchor || "").trim();
        if (!trimmed) {
          // No text anchor — append a ※ marker at the last span's end so the
          // reader sees a clickable cue at the verse's end position.
          _appendVariantMarker(spans, note.body);
        } else {
          _wrapAnchor(spans, note.anchor, occurrence, note.body);
        }
      }
    }
  }

  /**
   * Append a clickable variant-marker (※) at the end of the verse's last
   * span. Rendered as a superscript glued to the preceding text — strip any
   * trailing whitespace before the marker, then re-add one trailing space
   * after so inter-verse spacing stays intact.
   *
   * @param {ReadonlyArray<Element>} spans
   * @param {string} noteBody
   */
  function _appendVariantMarker(spans, noteBody) {
    const lastSpan = spans[spans.length - 1];
    if (!lastSpan) return;
    // Strip trailing whitespace from the span's last text node so the
    // superscript marker glues directly to the previous character.
    for (let i = lastSpan.childNodes.length - 1; i >= 0; i--) {
      const n = lastSpan.childNodes[i];
      if (n.nodeType === 3 /* Node.TEXT_NODE */) {
        n.nodeValue = (n.nodeValue || "").replace(/\s+$/, "");
        break;
      }
    }
    const btn = el("button", {
      type: "button",
      className: "note-anchor note-anchor--variant",
      "data-note-anchor": VARIANT_MARKER,
      "data-note-body": noteBody,
      "aria-label": "본문 변형 주석 보기",
    }, VARIANT_MARKER);
    lastSpan.appendChild(btn);
    // Re-add a single trailing space so the next verse still has visible
    // word separation in inline flow.
    lastSpan.appendChild(document.createTextNode(" "));
  }

  /**
   * Internal: search `spans` text nodes in order for the Nth occurrence of
   * `anchorWord` and wrap it in a clickable button carrying the note body.
   * No-op when occurrence not found.
   *
   * @param {ReadonlyArray<Element>} spans
   * @param {string} anchorWord
   * @param {number} occurrence  1-indexed
   * @param {string} noteBody
   */
  function _wrapAnchor(spans, anchorWord, occurrence, noteBody) {
    if (!anchorWord) return;
    let count = 0;
    for (const span of spans) {
      /** @type {Text[]} */
      const textNodes = [];
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let n = walker.nextNode();
      while (n) {
        textNodes.push(/** @type {Text} */ (n));
        n = walker.nextNode();
      }
      for (const tn of textNodes) {
        const text = tn.nodeValue || "";
        let idx = text.indexOf(anchorWord);
        while (idx !== -1) {
          count++;
          if (count === occurrence) {
            const parent = tn.parentNode;
            if (!parent) return;
            const before = text.slice(0, idx);
            const after  = text.slice(idx + anchorWord.length);
            // <span role="button"> instead of <button>: the browser forces
            // <button> to display:inline-block + text-align:center, which
            // makes a long anchor (e.g. a full sentence) sit on its own line
            // and centered. A span flows inline like surrounding text.
            const btn = el("span", {
              role: "button",
              tabindex: "0",
              className: "note-anchor",
              "data-note-anchor": anchorWord,
              "data-note-body": noteBody,
              "aria-label": `${anchorWord} 주석 보기`,
            }, anchorWord);
            if (before) parent.insertBefore(document.createTextNode(before), tn);
            parent.insertBefore(btn, tn);
            if (after) parent.insertBefore(document.createTextNode(after), tn);
            parent.removeChild(tn);
            return;
          }
          idx = text.indexOf(anchorWord, idx + anchorWord.length);
        }
      }
    }
  }

  // ── Note tooltip (anchored popover) ────────────────────────────────────

  /** @type {HTMLElement | null} */
  let _currentNoteAnchor = null;
  /** @type {(() => void) | null} */
  let _tooltipReposListener = null;
  // Truncate anchor label in tooltip if it exceeds this many characters.
  const TOOLTIP_ANCHOR_MAX = 18;

  function _ensureNoteTooltip() {
    let tt = /** @type {HTMLElement | null} */ (document.getElementById("note-tooltip"));
    if (tt) return tt;
    tt = el("div", {
      id: "note-tooltip",
      role: "tooltip",
    });
    tt.hidden = true;
    document.body.appendChild(tt);
    return tt;
  }

  /**
   * Position the tooltip just above the anchor element; if not enough room
   * above, flip below. Clamp horizontally to viewport edges.
   *
   * @param {HTMLElement} tt
   * @param {HTMLElement} anchorEl
   */
  function _positionNoteTooltip(tt, anchorEl) {
    tt.style.position = "fixed";
    tt.style.left = "0px";
    tt.style.top  = "0px";
    tt.style.maxWidth = "min(90vw, 22rem)";
    const ttRect = tt.getBoundingClientRect();
    const aRect  = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 8;
    let top = aRect.top - ttRect.height - GAP;
    let placedAbove = true;
    if (top < GAP) {
      top = aRect.bottom + GAP;
      placedAbove = false;
    }
    // If even below overflows, clamp to viewport bottom.
    if (top + ttRect.height + GAP > vh) {
      top = Math.max(GAP, vh - ttRect.height - GAP);
    }
    let left = aRect.left + aRect.width / 2 - ttRect.width / 2;
    left = Math.max(GAP, Math.min(left, vw - ttRect.width - GAP));
    tt.style.top  = `${top}px`;
    tt.style.left = `${left}px`;
    tt.setAttribute("data-placement", placedAbove ? "above" : "below");
  }

  /**
   * Open the note tooltip anchored to `anchorEl`. Renders the note body and
   * positions itself. Followers the anchor on scroll/resize until closed by
   * ESC or outside-click (wired by initCiteSheet).
   *
   * Long anchor labels are truncated with an ellipsis so the tooltip header
   * stays readable.
   *
   * `body` may be a plain string OR an array of strings/DOM nodes so callers
   * (e.g. parallels.js) can inject inline link elements into the tooltip.
   * Plain string bodies prepend " — "; array bodies start with " — " then
   * append each item verbatim (no further punctuation).
   *
   * @param {HTMLElement} anchorEl
   * @param {string} anchor
   * @param {string | ReadonlyArray<string | HTMLElement>} body
   */
  function openNoteTooltip(anchorEl, anchor, body) {
    const tt = _ensureNoteTooltip();
    clearNode(tt);
    const labelText = anchor.length > TOOLTIP_ANCHOR_MAX
      ? anchor.slice(0, TOOLTIP_ANCHOR_MAX - 1) + "…"
      : anchor;
    tt.appendChild(el("strong", { className: "note-tooltip-anchor" }, labelText));
    if (typeof body === "string") {
      tt.appendChild(document.createTextNode(" — " + body));
    } else {
      tt.appendChild(document.createTextNode(" — "));
      for (const part of body) {
        if (typeof part === "string") tt.appendChild(document.createTextNode(part));
        else if (part) tt.appendChild(part);
      }
    }
    tt.hidden = false;
    _positionNoteTooltip(tt, anchorEl);
    _currentNoteAnchor = anchorEl;

    // Follow anchor on scroll/resize so the tooltip stays glued to its anchor.
    if (_tooltipReposListener) {
      window.removeEventListener("scroll", _tooltipReposListener, true);
      window.removeEventListener("resize", _tooltipReposListener);
    }
    _tooltipReposListener = () => {
      if (_currentNoteAnchor && !tt.hidden) {
        _positionNoteTooltip(tt, _currentNoteAnchor);
      }
    };
    window.addEventListener("scroll", _tooltipReposListener, true);
    window.addEventListener("resize", _tooltipReposListener);
  }

  function closeNoteTooltip() {
    const tt = /** @type {HTMLElement | null} */ (document.getElementById("note-tooltip"));
    if (tt) tt.hidden = true;
    if (_tooltipReposListener) {
      window.removeEventListener("scroll", _tooltipReposListener, true);
      window.removeEventListener("resize", _tooltipReposListener);
      _tooltipReposListener = null;
    }
    if (_currentNoteAnchor && typeof _currentNoteAnchor.focus === "function") {
      _currentNoteAnchor.focus();
    }
    _currentNoteAnchor = null;
  }

  // ── ADR-022 cite sheet (bottom sheet, modal) ──────────────────────────

  /** @type {Map<string, string> | null} */
  let _booksByShort = null;
  // Sheet lifecycle (hidden toggle, rootClass, focus-trap, focus-restore) now
  // lives in the overlay controller (ADR-032), created in initCiteSheet.
  /** @type {ReturnType<typeof createOverlay> | null} */
  let _citeSheetOverlay = null;
  /** @type {{ src: string, parallels: ReadonlyArray<CiteParallelRef> | null, tradition: string | null, expandedRefIndex: number | null } | null} */
  let _sheetState = null;

  const COACHMARK_KEY = "bible-cite-coachmark-seen";
  const COACHMARK_AUTO_DISMISS_MS = 12000;
  /** @type {number | null} */
  let _coachmarkTimer = null;

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
    const defaultCh = parseInt(top[2], 10);
    const spec = top[3];
    const parts = [];
    // Each comma-separated part: optional "<chap>:" prefix (multi-chapter
    // commas), then verse, then optional "-<chap>:<v>" or "-<v>" range.
    const partRe = /^(?:(\d+):)?(\d+)(?:-(?:(\d+):)?(\d+))?$/;
    for (const raw of spec.split(",")) {
      const token = raw.trim();
      const m = token.match(partRe);
      if (!m) return null;
      parts.push({
        startCh: m[1] ? parseInt(m[1], 10) : defaultCh,
        startV: parseInt(m[2], 10),
        endCh:  m[3] ? parseInt(m[3], 10) : null,
        endV:   m[4] ? parseInt(m[4], 10) : null,
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
   * ADR-003 cross-chapter relocation lookup. When a cite names (ch, v) but
   * ch's own chapter file has no such v, the verse physically lives in a
   * neighboring chapter file marked with `chapter_ref === ch` (e.g.
   * 호세 13:14 sits inside hos-14.json between 14:5 and 14:6 because that
   * is where the printed text places it). Scan outward (±1, ±2, …) until
   * a home chapter is found. ADR-003 lists six such relocations; most are
   * adjacent but 1역대 9:33 lives 3 chapters away in 1chr-6.
   *
   * Returns both the matching verses *and* the physical chapter data so
   * the caller can render the printed reading position when the user
   * expands the cite sheet — ADR-003's whole point is to preserve that
   * physical order, so we honour it here rather than re-sorting into the
   * scholarly chapter.
   *
   * @param {string} bookId
   * @param {number} ch academic chapter as named by cite src
   * @param {Array<{ startCh: number, startV: number, endCh: number | null, endV: number | null }>} parts
   * @returns {Promise<{ verses: Array<BibleVerse>, fromChapter: number, chapterData: BibleChapter } | null>}
   */
  async function _findRelocated(bookId, ch, parts) {
    const wanted = new Set();
    for (const p of parts) {
      const partEndCh = p.endCh ?? p.startCh;
      if (p.startCh !== ch && partEndCh !== ch) continue;
      if (p.endV === null) {
        wanted.add(p.startV);
      } else if (p.startCh === partEndCh) {
        for (let v = p.startV; v <= p.endV; v++) wanted.add(v);
      }
    }
    if (wanted.size === 0) return null;

    /** @type {BooksData} */
    const books = await (window.booksPromise || fetch("/data/books.json").then((r) => r.json()));
    const book = books.find((b) => b.id === bookId);
    const chapterCount = book?.chapter_count ?? 0;
    if (chapterCount === 0) return null;

    const maxDelta = Math.max(ch - 1, chapterCount - ch);
    for (let d = 1; d <= maxDelta; d++) {
      for (const other of [ch + d, ch - d]) {
        if (other < 1 || other > chapterCount) continue;
        let data;
        try {
          const r = await fetch(`/data/bible/${bookId}-${other}.json`);
          if (!r.ok) continue;
          data = await r.json();
        } catch (_) {
          continue;
        }
        const verses = (data.verses || []).filter(
          (v) => v.chapter_ref === ch && wanted.has(v.number),
        );
        if (verses.length > 0) {
          return { verses, fromChapter: other, chapterData: data };
        }
      }
    }
    return null;
  }

  /**
   * Render a set of verses in the sheet using the SAME structure as the
   * main reading view (`.verse` / `.verse-poetry` / break spans / sup
   * `.verse-num`). The sheet's article carries `.chapter-text` so it
   * inherits the body serif font + line-height + poetry indents from the
   * shared verse stylesheet — visual parity with the main view.
   *
   * Per ADR-022 §6 the sheet body deliberately skips cite chips and note
   * anchors (those are part of the main view only). This is a simpler
   * mirror of views-routing.js's render loop minus those features.
   *
   * @param {HTMLElement} container
   * @param {ReadonlyArray<BibleVerse>} verses
   * @param {Set<number> | null} [highlightedNumbers] verse numbers to mark as
   *   the originally-cited slice (full-chapter expanded view).
   */
  function _renderVerses(container, verses, highlightedNumbers) {
    const article = el("article", { className: "chapter-text cite-sheet-article", lang: "ko" });
    let isFirst = true;
    let prevVerseEndType = null;

    for (const v of verses) {
      const segs = v.segments || [{ type: "prose", text: v.text || "" }];
      const startsWithPoetry = segs[0]?.type === "poetry";
      const isCited = !!(highlightedNumbers && highlightedNumbers.has(v.number));

      // Inter-verse break (mirror views-routing.js logic).
      if (!isFirst) {
        if (v.stanza_break) {
          article.appendChild(el("span", { className: "stanza-break", role: "presentation" }));
        } else if (startsWithPoetry && prevVerseEndType === "poetry") {
          article.appendChild(el("span", { className: "hemistich-break", role: "presentation" }));
        } else if (startsWithPoetry || segs[0]?.paragraph_break) {
          article.appendChild(el("span", { className: "paragraph-break", role: "presentation" }));
        }
      }

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
            article.appendChild(el("span", { className: "stanza-break", role: "presentation" }));
            continue;
          }

          if (!isFirstLine) {
            let breakClass = null;
            if ((seg.paragraph_break || isSegChange) && li === 0) {
              breakClass = "paragraph-break";
            } else if (isPoetry) {
              breakClass = "hemistich-break";
            }
            if (breakClass) {
              article.appendChild(el("span", { className: breakClass, role: "presentation" }));
            }
          }

          let classes = "verse";
          if (isPoetry) classes += " verse-poetry";
          if (isCited)  classes += " verse-highlight";

          const span = el("span", { className: classes });
          if (isFirstLine) {
            span.appendChild(el("sup", {
              className: "verse-num",
              "aria-hidden": "true",
              "data-v": String(v.number),
            }));
            span.appendChild(document.createTextNode("⁠"));
          }

          // Hanging punctuation for poetry quote lines (parity with main render).
          if (isPoetry && (line[0] === '"' || line[0] === "'")) {
            const hqCls = line[0] === '"'
              ? "hanging-quote" : "hanging-quote hanging-quote--single";
            span.appendChild(el("span", { className: hqCls }, line[0]));
            _appendLineText(span, line.slice(1));
          } else {
            _appendLineText(span, line);
          }
          article.appendChild(span);
          isFirstLine = false;
        }
        prevSegType = seg.type;
      }

      prevVerseEndType = segs[segs.length - 1]?.type;
      isFirst = false;
    }

    container.appendChild(article);
  }

  /**
   * Append line text to `span`, splitting out a leading pilcrow (¶) as the
   * same `<span class="pilcrow">` the main render uses. Trailing space keeps
   * inter-verse spacing.
   */
  function _appendLineText(span, raw) {
    if (raw.startsWith("¶")) {
      span.appendChild(el("span", { className: "pilcrow", "aria-hidden": "true" }, "¶"));
      const rest = raw.replace(/^¶\s*/, "");
      span.appendChild(document.createTextNode(rest + " "));
    } else {
      span.appendChild(document.createTextNode(raw + " "));
    }
  }

  /**
   * Fetch + render one cite reference (primary or parallel) in the sheet body.
   *
   * @param {HTMLElement} container
   * @param {string} src
   * @param {string | null} tradition  null when not the primary reference
   * @param {boolean} expanded  true → render full chapters, mark cited verses
   * @param {(() => void) | null} onExpand  click handler for the per-ref
   *   "더 보기" button. Pass null in expanded mode (button is hidden).
   */
  async function _renderRef(container, src, tradition, expanded, onExpand) {
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
    const refTitle = (tradition ? `${tradition} ` : "") + src;
    const headerEl = el("div", { className: "cite-sheet-ref-header" });
    headerEl.appendChild(el("h3", { className: "cite-sheet-ref-title" }, refTitle));
    if (onExpand) {
      const expandBtn = el("button", {
        type: "button",
        className: "cite-sheet-ref-expand",
      }, "› 더 보기");
      expandBtn.addEventListener("click", onExpand);
      headerEl.appendChild(expandBtn);
    }
    container.appendChild(headerEl);

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
        const slice = _selectVerses(data.verses, parsed.parts, ch);
        // ADR-022 §2 + ADR-003: when the chapter file lacks the cited
        // verse, the verse physically lives in a neighboring chapter file
        // with chapter_ref === ch (호세 13:14, 잠언 6:22, 이사 41:6,
        // 1역대 9:33, 욥 26:5, 욥 26 → 27 are the six known cases).
        // Expanded view shows the *physical* home chapter so the reader
        // sees the printed reading position ADR-003 preserves.
        const relocated = slice.length === 0
          ? await _findRelocated(bookId, ch, parsed.parts)
          : null;
        if (expanded) {
          if (relocated) {
            const cited = new Set(relocated.verses.map((v) => v.number));
            _renderVerses(container, relocated.chapterData.verses, cited);
          } else {
            const cited = new Set(slice.map((v) => v.number));
            _renderVerses(container, data.verses, cited);
          }
        } else {
          _renderVerses(container, slice.length > 0 ? slice : (relocated?.verses ?? []), null);
        }
      } catch (_) {
        container.appendChild(el("p", { className: "cite-sheet-error" },
          `${parsed.abbr} ${ch}장을 불러오지 못했습니다.`));
      }
    }
  }

  /**
   * Re-render the sheet body using the current `_sheetState`.
   *
   * When `expandedRefIndex === null` (default), all refs are rendered in
   * compact slice mode with a "› 더 보기" button beside each header.
   * When set to an index, only that ref is rendered with full chapters and
   * the first cited verse is scrolled into the middle of the body so the
   * user lands on the passage with its surrounding context already visible.
   */
  async function _renderSheetBody() {
    const bodyEl = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet-body"));
    if (!bodyEl || !_sheetState) return;
    clearNode(bodyEl);
    bodyEl.appendChild(el("p", { className: "cite-sheet-loading" }, "불러오는 중…"));
    try {
      clearNode(bodyEl);
      const { src, parallels, tradition, expandedRefIndex } = _sheetState;
      // Flatten primary + parallels into a single {ref, tradition} sequence
      // so per-entry tradition (ADR-022 §2 개정) flows through one code path.
      /** @type {Array<{ref: string, tradition: string | null}>} */
      const refs = [
        { ref: src, tradition: tradition || null },
        ...((parallels || []).map((p) => ({ ref: p.ref, tradition: p.tradition || null }))),
      ];
      if (expandedRefIndex !== null) {
        const idx = expandedRefIndex;
        const r = refs[idx];
        await _renderRef(bodyEl, r.ref, r.tradition, true, null);
        _scrollFirstHighlightIntoView(bodyEl);
      } else {
        for (let i = 0; i < refs.length; i++) {
          if (i > 0) bodyEl.appendChild(el("hr", { className: "cite-sheet-divider" }));
          const idx = i;
          const r = refs[i];
          await _renderRef(bodyEl, r.ref, r.tradition, false, () => {
            if (!_sheetState) return;
            _sheetState.expandedRefIndex = idx;
            _updateSheetHeader();
            void _renderSheetBody();
          });
        }
      }
    } catch (_) {
      clearNode(bodyEl);
      bodyEl.appendChild(el("p", { className: "cite-sheet-error" }, "불러오는 데 실패했습니다."));
    }
  }

  /**
   * Center the first cited verse in the sheet body so at least one verse
   * before and after is visible as context (request: "인용된 절을 중심으로
   * 1절, +1절에 포커스"). The body itself is the scroll container; the
   * sheet shell does not scroll.
   *
   * @param {HTMLElement} bodyEl
   */
  function _scrollFirstHighlightIntoView(bodyEl) {
    const first = bodyEl.querySelector(".verse-highlight");
    if (first && typeof first.scrollIntoView === "function") {
      first.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }

  /**
   * Toggle the header back-button visibility based on whether the sheet is
   * currently showing an expanded ref view.
   */
  function _updateSheetHeader() {
    const backBtn = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet-back"));
    if (!backBtn) return;
    backBtn.hidden = !(_sheetState && _sheetState.expandedRefIndex !== null);
  }

  /**
   * Drag-resize the sheet by its top handle. Mirrors the bookmark-drawer
   * pattern (pointerdown → setPointerCapture → pointermove
   * adjusts inline height → pointerup releases). Move clamp is loose (0 to
   * 90vh) so the user can drag visually below the rest min; release decides
   * close vs snap-back vs stay via `appHelpers.dragReleaseAction`.
   */
  function _initSheetDrag() {
    const handle = document.getElementById("cite-sheet-handle");
    const sheet = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet"));
    if (!handle || !sheet) return;
    let startY = 0;
    let startH = 0;
    /** @param {number} clientY */
    function onMove(clientY) {
      const delta = startY - clientY;
      const newH = Math.min(
        Math.max(startH + delta, 0),
        window.innerHeight * 0.90,
      );
      sheet.style.height = `${newH}px`;
    }
    /** @param {PointerEvent} e */
    function onPointerMove(e) { onMove(e.clientY); }
    function onPointerUp() {
      handle.removeEventListener("pointermove", onPointerMove);
      const action = dragReleaseAction(sheet.offsetHeight, window.innerHeight);
      if (action === "close") {
        closeCiteSheet();
      } else if (action === "snap-min") {
        sheet.style.height = `${window.innerHeight * 0.30}px`;
      }
    }
    handle.addEventListener("pointerdown", (e) => {
      if (window.innerWidth >= 769) return; // desktop uses fixed-size side panel
      e.preventDefault();
      startY = e.clientY;
      startH = sheet.offsetHeight;
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp, { once: true });
    });
  }

  /**
   * Desktop-only: drag the left edge to resize the side panel width.
   * Mirrors `initBookmarkDrawerResize` in bookmark.js — drag left widens, drag
   * right narrows. Clamp [240, 85vw] matches that handler.
   */
  function _initSheetResize() {
    const handle = document.getElementById("cite-sheet-resize");
    const sheet = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet"));
    if (!handle || !sheet) return;
    let startX = 0;
    let startW = 0;
    /** @param {PointerEvent} e */
    function onPointerMove(e) {
      const delta = startX - e.clientX; // drag left = wider
      const newW = Math.min(Math.max(startW + delta, 240), window.innerWidth * 0.85);
      sheet.style.width = `${newW}px`;
    }
    function onPointerUp() {
      handle.removeEventListener("pointermove", onPointerMove);
    }
    handle.addEventListener("pointerdown", (e) => {
      if (window.innerWidth < 769) return;
      e.preventDefault();
      startX = e.clientX;
      startW = sheet.offsetWidth;
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp, { once: true });
    });
  }

  /**
   * Open the cite sheet showing the cited passage(s). Primary src first, then
   * each parallel divided by a horizontal rule (ADR-022 §6).
   *
   * @param {string} src
   * @param {ReadonlyArray<CiteParallelRef> | null} parallels
   * @param {string | null} tradition
   * @param {HTMLElement | null} returnFocusEl
   */
  async function openCiteSheet(src, parallels, tradition, returnFocusEl) {
    const sheet  = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet"));
    const titleEl = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet-title"));
    const bodyEl = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet-body"));
    if (!sheet || !titleEl || !bodyEl || !_citeSheetOverlay) return;

    _sheetState = { src, parallels: parallels || null, tradition: tradition || null, expandedRefIndex: null };
    titleEl.textContent = "인용된 구절";
    // Reset any drag-resize from a previous open. The body stays interactive
    // while the sheet is open (only a focus trap, no scrim) so cite chips
    // visible in the unobscured portion can re-trigger openCiteSheet without
    // a closeCiteSheet in between — the previous inline height/width would leak in.
    // Re-trigger while open: open() is a no-op by the controller's idempotency
    // guard, so the sheet stays open and we just refresh state + body. This also
    // fixes a focus-trap listener leak the old hand-rolled path had on re-trigger;
    // return-focus stays the first opener (ADR-032).
    sheet.style.height = "";
    sheet.style.width = "";
    _citeSheetOverlay.open(returnFocusEl);
    _updateSheetHeader();

    await _renderSheetBody();
  }

  // Lifecycle (hidden toggle, rootClass remove, focus-trap cleanup, focus
  // restore) is owned by the controller; its onClose resets the drag-resize
  // inline styles (so the next open starts from the CSS default) + clears state.
  function closeCiteSheet() {
    _citeSheetOverlay?.close();
  }

  /** Wire up close button, back button, drag handle, ESC key, and `.cite-chip` click delegation. */
  function initCiteSheet() {
    const sheet = /** @type {HTMLElement | null} */ (document.getElementById("cite-sheet"));
    if (sheet) {
      // No scrim (body stays interactive); closeOnEsc off — the custom 2-step
      // Escape below steps expanded→list before closing (ADR-032).
      _citeSheetOverlay = createOverlay({
        panel: sheet,
        rootClass: "cite-sheet-open",
        closeOnEsc: false,
        initialFocus: () => document.getElementById("cite-sheet-close"),
        onClose: () => {
          sheet.style.height = "";
          sheet.style.width = "";
          _sheetState = null;
        },
      });
    }
    document.getElementById("cite-sheet-close")?.addEventListener("click", closeCiteSheet);
    document.getElementById("cite-sheet-back")?.addEventListener("click", () => {
      if (!_sheetState || _sheetState.expandedRefIndex === null) return;
      _sheetState.expandedRefIndex = null;
      _updateSheetHeader();
      void _renderSheetBody();
    });
    _initSheetDrag();
    _initSheetResize();

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const sheet = document.getElementById("cite-sheet");
        if (sheet && !sheet.hidden) {
          e.stopPropagation();
          // In expanded ref view, Esc steps back to the compact list first
          // before closing — mirrors the visual nav stack the back button
          // exposes.
          if (_sheetState && _sheetState.expandedRefIndex !== null) {
            _sheetState.expandedRefIndex = null;
            _updateSheetHeader();
            void _renderSheetBody();
            return;
          }
          closeCiteSheet();
          return;
        }
        const tt = document.getElementById("note-tooltip");
        if (tt && !tt.hidden) {
          e.stopPropagation();
          closeNoteTooltip();
        }
        return;
      }
      // Enter / Space activates a focused cite chip or note anchor (both are
      // span role=button and need manual key handling; a native <button> would
      // do this for us).
      if (e.key === "Enter" || e.key === " ") {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.classList.contains("cite-chip")) {
          e.preventDefault();
          const src = target.getAttribute("data-cite-src");
          if (!src) return;
          const parallels = _parseParallelsAttr(target.getAttribute("data-cite-parallels"));
          const tradition = target.getAttribute("data-cite-tradition") || null;
          _markCoachmarkSeen();
          openCiteSheet(src, parallels, tradition, target);
        } else if (target.classList.contains("note-anchor")) {
          e.preventDefault();
          const anchor = target.getAttribute("data-note-anchor") || target.textContent || "";
          const body   = target.getAttribute("data-note-body")   || "";
          openNoteTooltip(target, anchor, body);
        }
      }
    });

    // Delegated click: cite chips → sheet, note anchors → tooltip, outside → close.
    document.body.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      // Cite chip
      const chip = target.closest(".cite-chip");
      if (chip instanceof HTMLElement) {
        const src = chip.getAttribute("data-cite-src");
        if (!src) return;
        const parallels = _parseParallelsAttr(chip.getAttribute("data-cite-parallels"));
        const tradition = chip.getAttribute("data-cite-tradition") || null;
        _markCoachmarkSeen();
        openCiteSheet(src, parallels, tradition, chip);
        return;
      }

      // Note anchor
      const noteBtn = target.closest(".note-anchor");
      if (noteBtn instanceof HTMLElement) {
        const anchor = noteBtn.getAttribute("data-note-anchor") || noteBtn.textContent || "";
        const body   = noteBtn.getAttribute("data-note-body")   || "";
        openNoteTooltip(noteBtn, anchor, body);
        return;
      }

      // Click outside any open tooltip → close it.
      const tt = document.getElementById("note-tooltip");
      if (tt && !tt.hidden && !tt.contains(target)) {
        closeNoteTooltip();
      }
    });
  }

  // ── First-use coachmark ────────────────────────────────────────────────

  function _markCoachmarkSeen() {
    try { localStorage.setItem(COACHMARK_KEY, "1"); } catch (_) {}
    const existing = document.getElementById("cite-coachmark");
    if (existing) existing.remove();
    if (_coachmarkTimer !== null) {
      clearTimeout(_coachmarkTimer);
      _coachmarkTimer = null;
    }
  }

  /**
   * Show a one-time floating banner pointing out the cite chips.
   * No-op if: coachmark already seen, cites toggle is OFF, no chip in DOM,
   * banner is already showing.
   */
  function maybeShowCoachmark() {
    try {
      if (localStorage.getItem(COACHMARK_KEY) === "1") return;
    } catch (_) { /* localStorage unavailable → skip silently */ return; }
    if (!document.body.classList.contains("cites-shown")) return;
    if (!document.querySelector(".cite-chip")) return;
    if (document.getElementById("cite-coachmark")) return;

    const banner = el("div", {
      id: "cite-coachmark",
      role: "status",
      "aria-live": "polite",
    });
    banner.appendChild(el("span", { className: "cite-coachmark-text" },
      "회색 인용 출처 버튼을 누르면 인용 본문이 시트로 열려요."));
    const closeBtn = el("button", {
      type: "button",
      className: "cite-coachmark-close",
      "aria-label": "안내 닫기",
    }, "×");
    closeBtn.addEventListener("click", _markCoachmarkSeen);
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);

    _coachmarkTimer = /** @type {any} */ (setTimeout(_markCoachmarkSeen, COACHMARK_AUTO_DISMISS_MS));
  }

  return {
    _computeCiteShowPositions,
    chipText,
    buildCiteChip,
    wrapNoteAnchorsInArticle,
    openCiteSheet,
    closeCiteSheet,
    openNoteTooltip,
    closeNoteTooltip,
    initCiteSheet,
    maybeShowCoachmark,
  };
})();

// ESM module marker (ADR-019)
export {};
