"use strict";
// @ts-check

// Cross-module transient state for the chapter view: which book/chapter the
// user is currently reading, and whether they are in verse-selection mode
// (with the set of selected verses + an in-flight pointer-drag, if any).
//
// Phase 6a of the app.js modularization (ADR-018 §5.1 Option A). Other
// modules — bookmark.js, search.js, future views-routing.js — read or
// mutate these fields directly via the exported `readingContext` object,
// rather than via getter/setter functions, because the access pattern is
// hot-path (e.g. scroll-tracking writes `chapter` on every chapter render)
// and JS object property access is the simplest cross-module mutation.

/** @typedef {import("../types").VerseSelectDrag} VerseSelectDrag */

/**
 * @typedef {Object} ReadingContext
 * @property {string | null} bookId      — id of the book currently rendered, or null on home/list views
 * @property {number | null} chapter     — chapter number currently rendered, or null
 * @property {boolean} verseSelectMode   — true when the user has entered verse-selection (long-press / FAB)
 * @property {Set<string>} selectedVerses — data-vref strings of currently selected verses
 * @property {VerseSelectDrag | null} verseSelectDrag — in-flight pointer drag during selection, or null
 */

/** @type {ReadingContext} */
const readingContext = {
  bookId: null,
  chapter: null,
  verseSelectMode: false,
  selectedVerses: new Set(),
  verseSelectDrag: null,
};

window.readingContext = readingContext;

export { readingContext };
