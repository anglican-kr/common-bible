"use strict";
// @ts-check

// Verse selection mode — extracted from bookmark.js (ADR-034 후속). The in-reading
// affordance: tapping verses highlights them, the #verse-select-bar dock shows the
// running spec + 북마크·복사 actions, and copy serializes the run with a citation.
// Entered from the drawer's "절 선택" button (bookmark.js drawer toolbar) and from
// the reading view's verse-tap handler (which drives updateVerseSelectBar /
// updateVerseSelectionBoundaries via the window facade bookmark.js re-exports).
//
// A near-leaf: it never calls back into the bookmark tree/orchestrator, so no
// dependency injection is needed (unlike the gesture/select rounds). Deps:
// verse-spec (spec build/serialize), bookmark-modals (openSaveModal for 북마크),
// window.{readingContext, getBooksCache, _showSyncSnackbar, announce}, appHelpers.

const { _$ } = window.appHelpers;
const { readingContext } = window;

import {
  collapseFullVerseRefs, selectedVersesToSpec, serializeVerseRange,
} from "./verse-spec.js";
import { openSaveModal } from "./bookmark-modals.js";

// ── Verse-select bar (dock) DOM refs ──
const $verseSelectBar = _$("verse-select-bar");
const $verseSelectCount = _$("verse-select-count");
const $verseSelectBookmarkBtn = /** @type {HTMLButtonElement} */ (_$("verse-select-bookmark-btn"));
const $verseSelectCopyBtn = /** @type {HTMLButtonElement} */ (_$("verse-select-copy-btn"));
// Note action is a placeholder slot (ADR-030) — not yet built. It uses
// aria-disabled (not `disabled`) so a tap still announces "coming soon".
const $verseSelectNoteBtn = _$("verse-select-note-btn");
const $verseSelectCancelBtn = _$("verse-select-cancel-btn");

// Flatten the inner corners between adjacent selected verses so a run of
// consecutive selections renders as a single highlighted block.
function updateVerseSelectionBoundaries(scope) {
  const root = scope || document;
  const verses = [...root.querySelectorAll(".verse[data-vref]")];
  for (let i = 0; i < verses.length; i++) {
    const v = verses[i];
    const sel = v.classList.contains("verse-selected");
    const prevSel = sel && i > 0 && verses[i - 1].classList.contains("verse-selected");
    const nextSel = sel && i < verses.length - 1 && verses[i + 1].classList.contains("verse-selected");
    v.classList.toggle("verse-selected-join-prev", prevSel);
    v.classList.toggle("verse-selected-join-next", nextSel);
  }
}

function enterVerseSelectMode(bookId, chapter) {
  readingContext.verseSelectMode = true;
  readingContext.selectedVerses.clear();
  readingContext.bookId = bookId;
  readingContext.chapter = chapter;
  document.body.classList.add("verse-select-active");
  $verseSelectBar.hidden = false;
  updateVerseSelectBar();
  announce("절 선택 모드. 절을 눌러서 선택하세요.");
}

function exitVerseSelectMode() {
  readingContext.verseSelectMode = false;
  readingContext.selectedVerses.clear();
  document.body.classList.remove("verse-select-active");
  $verseSelectBar.hidden = true;
  document.querySelectorAll(".verse-selected, .verse-selected-join-prev, .verse-selected-join-next")
    .forEach(v => v.classList.remove("verse-selected", "verse-selected-join-prev", "verse-selected-join-next"));
}

function updateVerseSelectBar() {
  const count = readingContext.selectedVerses.size;
  if (count === 0) {
    $verseSelectCount.textContent = "구절을 눌러서 선택";
  } else {
    const articleEl = document.querySelector("article.chapter-text");
    const refs = collapseFullVerseRefs(Array.from(readingContext.selectedVerses), articleEl);
    const spec = refs.length
      ? selectedVersesToSpec(refs)
      : selectedVersesToSpec(Array.from(readingContext.selectedVerses));
    $verseSelectCount.textContent = `${spec.replace(/,/g, ', ')}절 선택됨`;
  }
  $verseSelectBookmarkBtn.disabled = count === 0;
  $verseSelectCopyBtn.disabled = count === 0;
}

// Serialize the currently selected verses to a clipboard-friendly text block
// with a trailing citation. Mirrors the article-level copy handler: groups of
// consecutive selected line-spans share their inter-verse breaks (stanza /
// paragraph / hemistich), non-consecutive groups separate with a blank line.
async function copySelectedVerses() {
  const article = document.querySelector("article.chapter-text");
  if (!article || readingContext.selectedVerses.size === 0) return;

  const children = [...article.children];
  /** @type {Array<[Element, Element]>} */
  const groups = [];
  /** @type {[Element, Element] | null} */
  let current = null;
  for (const child of children) {
    if (!child.classList.contains("verse")) continue;
    if (child.classList.contains("verse-selected")) {
      if (!current) {
        current = [child, child];
        groups.push(current);
      } else {
        current[1] = child;
      }
    } else {
      current = null;
    }
  }
  if (!groups.length) return;

  const textParts = groups.map(([first, last]) => serializeVerseRange(first, last));

  const refs = collapseFullVerseRefs(Array.from(readingContext.selectedVerses), article);
  const spec = refs.length
    ? selectedVersesToSpec(refs)
    : selectedVersesToSpec(Array.from(readingContext.selectedVerses));
  const book = (window.getBooksCache() ?? []).find((b) => b.id === readingContext.bookId);
  const bookName = book ? book.name_ko : readingContext.bookId;
  const citation = `— ${bookName} ${readingContext.chapter}:${spec} (공동번역성서)`;
  const fullText = `${textParts.join("\n\n")}\n\n${citation}`;

  try {
    await navigator.clipboard.writeText(fullText);
    announce("복사했습니다.");
    window._showSyncSnackbar?.("복사했습니다.");
    exitVerseSelectMode();
  } catch {
    announce("복사하지 못했습니다.");
    window._showSyncSnackbar?.("복사하지 못했습니다.");
  }
}

// ── Verse-select dock listeners ──
$verseSelectCancelBtn.addEventListener("click", exitVerseSelectMode);
$verseSelectBookmarkBtn.addEventListener("click", () => openSaveModal("verses"));
$verseSelectCopyBtn.addEventListener("click", copySelectedVerses);
$verseSelectNoteBtn.addEventListener("click", () => announce("노트 기능은 준비 중입니다."));

export {
  enterVerseSelectMode, exitVerseSelectMode,
  updateVerseSelectionBoundaries, updateVerseSelectBar,
};
