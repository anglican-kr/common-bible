"use strict";

const DATA_DIR = "data";
const $app = document.getElementById("app");
const $title = document.getElementById("page-title");
const $breadcrumb = document.getElementById("breadcrumb");
const $announce = document.getElementById("a11y-announce");
const $audioBar = document.getElementById("audio-bar");
const $searchInput = document.getElementById("search-input");
const $searchClear = document.getElementById("search-clear");
const $searchFab = document.getElementById("search-fab");
const $searchScrim = document.getElementById("search-scrim");
const $searchSheet = document.getElementById("search-sheet");
const $searchSheetInput = document.getElementById("search-sheet-input");
const $searchSheetClear = document.getElementById("search-sheet-clear");
const $searchSheetResults = document.getElementById("search-sheet-results");

let booksCache = null;
let currentAudio = null;

// ── Accessibility ──

function announce(msg) {
  $announce.textContent = "";
  requestAnimationFrame(() => { $announce.textContent = msg; });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // Close search overlay if open
    if ($searchSheet && !$searchSheet.hidden) {
      closeSearchSheet();
      return;
    }
    document.querySelectorAll(".chapter-popover:not([hidden]), .bc-division-popover:not([hidden]), .settings-popover:not([hidden]), .title-division-popover:not([hidden])")
      .forEach((p) => { p.hidden = true; });
    document.querySelectorAll("[aria-expanded='true']")
      .forEach((b) => { b.setAttribute("aria-expanded", "false"); b.focus(); });
  }
  // Space to toggle audio playback (when not in an input/button)
  if (e.key === " " && currentAudio && !["INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
    e.preventDefault();
    if (currentAudio.paused) currentAudio.play(); else currentAudio.pause();
  }
});

// ── Reading position persistence ──

const STORAGE_KEY = "bible-last-read";
const FONT_SIZE_KEY = "bible-font-size";
const THEME_KEY = "bible-theme";
const FONT_SIZES = [16, 18, 20, 22, 24];
const DEFAULT_FONT_SIZE = 18;

function saveReadingPosition(bookId, chapter) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bookId, chapter }));
  } catch (_) {}
}

function loadReadingPosition() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return null;
  }
}

// ── Font size ──

function loadFontSize() {
  try {
    const v = parseInt(localStorage.getItem(FONT_SIZE_KEY), 10);
    return FONT_SIZES.includes(v) ? v : DEFAULT_FONT_SIZE;
  } catch (_) {
    return DEFAULT_FONT_SIZE;
  }
}

function saveFontSize(size) {
  try { localStorage.setItem(FONT_SIZE_KEY, String(size)); } catch (_) {}
}

function applyFontSize(size) {
  document.documentElement.style.fontSize = `${size}px`;
}

// ── Settings popover ──

const $settingsAnchor = document.getElementById("settings-anchor");

function initSettings() {
  clearNode($settingsAnchor);

  const wrapper = el("div", { className: "settings-wrapper" });
  const btn = el("button", { className: "settings-btn", "aria-label": "설정", "aria-expanded": "false" }, "\u2699");
  const popover = el("div", { className: "settings-popover" });
  popover.hidden = true;

  function rebuild() {
    clearNode(popover);

    // Font size
    const sizeRow = el("div", { className: "settings-row" });
    sizeRow.appendChild(el("span", { className: "settings-label" }, "글자 크기"));
    const size = loadFontSize();
    const idx = FONT_SIZES.indexOf(size);

    const btnMinus = el("button", { className: "toolbar-btn", "aria-label": "글자 작게" }, "A-");
    const btnPlus = el("button", { className: "toolbar-btn", "aria-label": "글자 크게" }, "A+");
    if (idx <= 0) btnMinus.disabled = true;
    if (idx >= FONT_SIZES.length - 1) btnPlus.disabled = true;

    btnMinus.addEventListener("click", () => {
      const cur = FONT_SIZES.indexOf(loadFontSize());
      if (cur > 0) { const ns = FONT_SIZES[cur - 1]; saveFontSize(ns); applyFontSize(ns); rebuild(); announce(`글자 크기 ${ns}px`); }
    });
    btnPlus.addEventListener("click", () => {
      const cur = FONT_SIZES.indexOf(loadFontSize());
      if (cur < FONT_SIZES.length - 1) { const ns = FONT_SIZES[cur + 1]; saveFontSize(ns); applyFontSize(ns); rebuild(); announce(`글자 크기 ${ns}px`); }
    });

    sizeRow.appendChild(btnMinus);
    sizeRow.appendChild(btnPlus);
    popover.appendChild(sizeRow);

    // Theme
    const themeRow = el("div", { className: "settings-row" });
    themeRow.appendChild(el("span", { className: "settings-label" }, "테마"));
    const btnTheme = el(
      "button",
      { className: "toolbar-btn", "aria-label": "다크/라이트 모드 전환" },
      loadTheme() === "dark" ? "☀ 라이트" : "☾ 다크"
    );
    btnTheme.addEventListener("click", () => {
      const next = loadTheme() === "dark" ? "light" : "dark";
      saveTheme(next);
      applyTheme(next);
      rebuild();
      announce(next === "dark" ? "다크 모드" : "라이트 모드");
    });
    themeRow.appendChild(btnTheme);
    popover.appendChild(themeRow);

    // About
    const aboutRow = el("div", { className: "settings-about" });
    aboutRow.appendChild(document.createTextNode("대한성서공회 허락 하에 대한성공회 사용 · "));
    aboutRow.appendChild(el("a", { href: "https://github.com/anglican-kr/common-bible", target: "_blank", rel: "noopener" }, "공동번역성서 2.0"));
    popover.appendChild(aboutRow);
  }

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    if (!open) rebuild();
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !wrapper.contains(e.target)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(popover);
  $settingsAnchor.appendChild(wrapper);
}

// ── Theme ──

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch (_) {}
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

// Apply saved settings on load
applyFontSize(loadFontSize());
applyTheme(loadTheme());
initSettings();

// ── Helpers ──

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") node.className = v;
      else if (k === "textContent") node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else if (child) node.appendChild(child);
  }
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── Data fetching ──

async function loadBooks() {
  if (booksCache) return booksCache;
  const res = await fetch(`${DATA_DIR}/books.json`);
  if (!res.ok) throw new Error("Failed to load books.json");
  booksCache = await res.json();
  return booksCache;
}

async function loadChapter(bookId, chapter) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-${chapter}.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-${chapter}.json`);
  return res.json();
}

async function loadPrologue(bookId) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-prologue.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-prologue.json`);
  return res.json();
}

// ── Rendering helpers ──

function setTitle(text) {
  clearNode($title);
  $title.appendChild(document.createTextNode(text));
  document.title = text === "공동번역성서" ? text : `${text} — 공동번역성서`;
  announce(text);
}

function setTitleWithDivisionPicker(activeDivision) {
  clearNode($title);
  const label = DIVISION_LABELS[activeDivision];
  document.title = `${label} — 공동번역성서`;
  announce(label);

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": "구분 선택", "aria-expanded": "false" },
    label
  );

  const popover = el("ul", { className: "bc-division-popover title-division-popover", role: "listbox", "aria-label": "구분 선택" });
  popover.hidden = true;

  for (const div of DIVISION_ORDER) {
    const cls = div === activeDivision ? "bc-division-item active" : "bc-division-item";
    popover.appendChild(el("li", null, el("a", { className: cls, href: `#/${div}` }, DIVISION_LABELS[div])));
  }

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !$title.contains(e.target)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  popover.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  $title.appendChild(btn);
  $title.appendChild(popover);
}

function setTitleWithChapterPicker(book, currentCh) {
  clearNode($title);
  document.title = `${book.name_ko} ${currentCh}장 — 공동번역성서`;
  announce(`${book.name_ko} ${currentCh}장`);

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": "장 선택", "aria-expanded": "false" },
    `${book.name_ko} ${currentCh}장`
  );

  const popover = el("div", { className: "chapter-popover", role: "listbox", "aria-label": "장 선택" });
  popover.hidden = true;

  if (book.has_prologue) {
    popover.appendChild(
      el("a", { className: "popover-item popover-prologue", href: `#/${book.id}/prologue` }, "머리말")
    );
  }
  const grid = el("div", { className: "popover-grid" });
  for (let i = 1; i <= book.chapter_count; i++) {
    const cls = i === currentCh ? "popover-item current" : "popover-item";
    grid.appendChild(el("a", { className: cls, href: `#/${book.id}/${i}` }, String(i)));
  }
  popover.appendChild(grid);

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !$title.contains(e.target)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  popover.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  $title.appendChild(btn);
  $title.appendChild(popover);
}

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
  const wrapper = el("span", { className: "bc-division-picker" });

  const btn = el("button", { className: "bc-division-btn", "aria-expanded": "false", "aria-label": `${label} — 구분 선택` }, label);

  const popover = el("ul", { className: "bc-division-popover", role: "listbox", "aria-label": "구분 선택" });
  popover.hidden = true;

  for (const div of DIVISION_ORDER) {
    const cls = div === activeDivision ? "bc-division-item active" : "bc-division-item";
    const item = el("li", null,
      el("a", { className: cls, href: `#/${div}` }, DIVISION_LABELS[div])
    );
    popover.appendChild(item);
  }

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !wrapper.contains(e.target)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }
  });

  popover.addEventListener("click", () => {
    popover.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(popover);
  return wrapper;
}

const DIVISION_LABELS = {
  old_testament: "구약",
  deuterocanon: "외경",
  new_testament: "신약",
};

const DIVISION_ORDER = ["old_testament", "deuterocanon", "new_testament"];

// ── Views ──

function renderBookList(books) {
  setTitle("공동번역성서");
  setBreadcrumb([]);
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  const grouped = {};
  for (const b of books) {
    (grouped[b.division] ??= []).push(b);
  }

  for (const div of DIVISION_ORDER) {
    const list = grouped[div];
    if (!list) continue;

    const section = el("section", { className: "division" });
    section.appendChild(el("h2", { className: "division-title" }, DIVISION_LABELS[div]));

    const ul = el("ul", { className: "book-list", role: "list" });
    for (const b of list) {
      ul.appendChild(el("li", null, el("a", { href: `#/${b.id}` }, b.name_ko)));
    }
    section.appendChild(ul);
    $app.appendChild(section);
  }
}

function renderResumeBanner(books) {
  const pos = loadReadingPosition();
  if (!pos) return;
  const lastBook = books.find((b) => b.id === pos.bookId);
  if (!lastBook) return;
  const isPrologue = pos.chapter === "prologue";
  const href = `#/${pos.bookId}/${pos.chapter}`;
  const label = isPrologue
    ? `이어읽기: ${lastBook.name_ko} 머리말`
    : `이어읽기: ${lastBook.name_ko} ${pos.chapter}장`;
  $app.appendChild(el("a", { className: "resume-banner", href }, label));
}

function renderDivisionList(books, division) {
  setTitleWithDivisionPicker(division);
  setBreadcrumb([{ label: "목록", href: "#/" }]);
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  const list = books.filter((b) => b.division === division);
  const section = el("section", { className: "division" });
  section.appendChild(el("h2", { className: "division-title" }, DIVISION_LABELS[division]));

  const ul = el("ul", { className: "book-list", role: "list" });
  for (const b of list) {
    ul.appendChild(el("li", null, el("a", { href: `#/${b.id}` }, b.name_ko)));
  }
  section.appendChild(ul);
  $app.appendChild(section);
}

function renderChapterList(book, books) {
  setTitle(book.name_ko);
  hideAudioBar();
  setBreadcrumb([
    { label: "목록", href: "#/" },
    { divisionPicker: true, label: DIVISION_LABELS[book.division], activeDivision: book.division },
  ]);
  clearNode($app);

  renderResumeBanner(books);

  const grid = el("div", { className: "chapter-grid" });

  if (book.has_prologue) {
    grid.appendChild(
      el("a", { className: "prologue-link", href: `#/${book.id}/prologue` }, "머리말")
    );
  }

  for (let i = 1; i <= book.chapter_count; i++) {
    grid.appendChild(
      el("a", { href: `#/${book.id}/${i}`, "aria-label": `${book.name_ko} ${i}장` }, String(i))
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
  const hlVerseEnd = opts && opts.highlightVerseEnd;

  setTitleWithChapterPicker(book, ch);
  setBreadcrumb([
    { label: "목록", href: "#/" },
    { divisionPicker: true, label: DIVISION_LABELS[book.division], activeDivision: book.division },
    { label: book.name_ko, href: `#/${book.id}` },
  ]);
  clearNode($app);

  if (data.has_dual_numbering) {
    $app.appendChild(
      el("p", { className: "dual-numbering-note" }, "※ 괄호 안 번호는 70인역 사본(그리스어)의 절 번호입니다.")
    );
  }

  const article = el("article", { className: "chapter-text", lang: "ko" });
  let isFirst = true;

  for (const v of data.verses) {
    if (v.has_paragraph && !isFirst) {
      article.appendChild(el("span", { className: "paragraph-break", role: "presentation" }));
    }

    const verseLabel = formatVerseLabel(v);
    let verseId = `v${v.number}`;
    if (v.part) verseId += v.part;
    if (v.alt_ref != null) verseId += `_${v.alt_ref}`;
    let classes = v.chapter_ref ? "verse verse-cross-ref" : "verse";

    // Verse highlight (from verse reference navigation)
    const vn = v.number;
    const isHighlightedVerse = hlVerse && vn >= hlVerse && vn <= (hlVerseEnd || hlVerse);
    if (isHighlightedVerse) classes += " verse-highlight";

    const span = el("span", { className: classes, id: verseId });

    // Verse number
    const sup = el("sup", { className: "verse-num", "aria-hidden": "true" }, verseLabel);
    if (v.chapter_ref) {
      sup.appendChild(el("span", { className: "cross-ref-tag" }, `(${v.chapter_ref}장)`));
    }
    if (v.alt_ref != null) {
      sup.appendChild(el("span", { className: "alt-ref" }, `(${v.alt_ref})`));
    }
    span.appendChild(sup);

    // Render text, handling ¶ marks and mid-verse paragraph breaks (\n¶)
    const segments = v.text.split("\n");
    const hasSplit = segments.length > 1;

    function appendSegText(target, raw) {
      const hasPilcrow = raw.startsWith("¶");
      if (hasPilcrow) {
        target.appendChild(el("span", { className: "pilcrow", "aria-hidden": "true" }, "¶"));
      }
      const textContent = hasPilcrow ? raw.replace(/^¶\s*/, "") : raw;
      appendTextWithHighlight(target, textContent + " ", hlQuery);
    }

    span.setAttribute("data-vref", hasSplit ? `${verseLabel}a` : verseLabel);
    appendSegText(span, segments[0]);
    article.appendChild(span);

    // Mid-verse continuation paragraphs
    const partLetters = "bcdefgh";
    for (let pi = 1; pi < segments.length; pi++) {
      article.appendChild(el("span", { className: "paragraph-break", role: "presentation" }));
      const cont = el("span", { className: classes, "data-vref": `${verseLabel}${partLetters[pi - 1]}` });
      appendSegText(cont, segments[pi]);
      article.appendChild(cont);
    }

    isFirst = false;
  }

  // Announce verse number on click/tap for screen reader users
  article.addEventListener("click", (e) => {
    const vs = e.target.closest(".verse[data-vref]");
    if (vs) announce(`${vs.getAttribute("data-vref")}절`);
  });

  // Copy handler: append reference metadata to copied text
  article.addEventListener("copy", (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const allVerseSpans = article.querySelectorAll(".verse[data-vref]");
    let firstRef = null;
    let lastRef = null;

    for (const vs of allVerseSpans) {
      if (range.intersectsNode(vs)) {
        const vref = vs.getAttribute("data-vref");
        if (!firstRef) firstRef = vref;
        lastRef = vref;
      }
    }

    if (!firstRef) return;

    const ref = firstRef === lastRef
      ? `${book.name_ko} ${ch}:${firstRef}`
      : `${book.name_ko} ${ch}:${firstRef}-${lastRef}`;

    const plainText = sel.toString().trim();
    e.clipboardData.setData("text/plain", `${plainText}\n\n— ${ref} (공동번역성서)`);
    e.preventDefault();
  });

  $app.appendChild(article);
  $app.appendChild(buildChapterNav(book, ch));
  showAudioPlayer(book.id, ch);

  // Scroll to highlighted verse or top
  if (hlVerse) {
    const target = document.getElementById(`v${hlVerse}`);
    if (target) {
      requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  } else {
    window.scrollTo(0, 0);
  }
}

function renderPrologue(data, book) {
  setTitle(`${book.name_ko} 머리말`);
  setBreadcrumb([
    { label: "목록", href: "#/" },
    { divisionPicker: true, label: DIVISION_LABELS[book.division], activeDivision: book.division },
    { label: book.name_ko, href: `#/${book.id}` },
  ]);
  clearNode($app);

  const article = el("article", { className: "prologue-text", lang: "ko" });
  for (const p of data.paragraphs) {
    article.appendChild(el("p", null, p));
  }

  $app.appendChild(article);

  const nav = el("nav", { className: "chapter-nav", "aria-label": "장 이동" });
  nav.appendChild(el("span", { className: "placeholder" }));
  nav.appendChild(el("a", { href: `#/${book.id}/1` }, "1장 →"));
  $app.appendChild(nav);
  showAudioPlayer(book.id, 0);
  window.scrollTo(0, 0);
}

function buildChapterNav(book, currentCh) {
  const nav = el("nav", { className: "chapter-nav", "aria-label": "장 이동" });

  if (currentCh > 1) {
    nav.appendChild(el("a", { href: `#/${book.id}/${currentCh - 1}` }, `← ${currentCh - 1}장`));
  } else if (book.has_prologue) {
    nav.appendChild(el("a", { href: `#/${book.id}/prologue` }, "← 머리말"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  if (currentCh < book.chapter_count) {
    nav.appendChild(el("a", { href: `#/${book.id}/${currentCh + 1}` }, `${currentCh + 1}장 →`));
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

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return { view: "books" };

  // Search route: #/search?q=...&page=...
  if (hash.startsWith("search")) {
    const params = new URLSearchParams(hash.replace(/^search\??/, ""));
    return {
      view: "search",
      query: params.get("q") || "",
      page: parseInt(params.get("page"), 10) || 1,
    };
  }

  const parts = hash.split("/");
  if (parts.length === 1) {
    if (DIVISION_LABELS[parts[0]]) return { view: "division", division: parts[0] };
    return { view: "chapters", bookId: parts[0] };
  }
  if (parts[1] === "prologue") return { view: "prologue", bookId: parts[0] };

  // Chapter with optional highlight params: #/gen/1?hl=빛&v=3&ve=11
  const qIdx = parts[1].indexOf("?");
  let chapterStr = parts[1];
  let highlightQuery = null;
  let highlightVerse = null;
  let highlightVerseEnd = null;
  if (qIdx !== -1) {
    chapterStr = parts[1].substring(0, qIdx);
    const cp = new URLSearchParams(parts[1].substring(qIdx + 1));
    highlightQuery = cp.get("hl") || null;
    highlightVerse = parseInt(cp.get("v"), 10) || null;
    highlightVerseEnd = parseInt(cp.get("ve"), 10) || null;
  }
  return {
    view: "chapter",
    bookId: parts[0],
    chapter: parseInt(chapterStr, 10),
    highlightQuery,
    highlightVerse,
    highlightVerseEnd,
  };
}

async function route() {
  const parsed = parseHash();
  const { view, bookId, chapter, division } = parsed;

  // Sync search input with current route
  if (view === "search") {
    if (isMobile()) {
      // On mobile, redirect search route to overlay
      openSearchSheet(parsed.query);
      return;
    }
    $searchInput.value = parsed.query;
    $searchClear.hidden = !parsed.query;
  } else {
    $searchInput.value = "";
    $searchClear.hidden = true;
  }

  try {
    if (view === "search") {
      if (parsed.query) {
        await renderSearchResults(parsed.query, parsed.page);
      } else {
        const books = await loadBooks();
        renderBookList(books);
      }
      return;
    }

    const books = await loadBooks();

    if (view === "books") {
      renderBookList(books);
      return;
    }

    if (view === "division") {
      renderDivisionList(books, division);
      return;
    }

    const book = books.find((b) => b.id === bookId);
    if (!book) {
      renderError("해당 성경을 찾을 수 없습니다.");
      return;
    }

    if (view === "chapters") {
      renderChapterList(book, books);
      return;
    }

    renderLoading();

    if (view === "prologue") {
      const data = await loadPrologue(bookId);
      renderPrologue(data, book);
      saveReadingPosition(bookId, "prologue");
      return;
    }

    if (view === "chapter") {
      if (chapter < 1 || chapter > book.chapter_count) {
        renderError("해당 장을 찾을 수 없습니다.");
        return;
      }
      const data = await loadChapter(bookId, chapter);
      renderChapter(data, book, {
        highlightQuery: parsed.highlightQuery,
        highlightVerse: parsed.highlightVerse,
        highlightVerseEnd: parsed.highlightVerseEnd,
      });
      saveReadingPosition(bookId, chapter);
    }
  } catch (err) {
    renderError("데이터를 불러올 수 없습니다.");
    console.error(err);
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);

// ── Audio Player ──

function formatTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function hideAudioBar() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  $audioBar.hidden = true;
  clearNode($audioBar);
}

function showAudioPlayer(bookId, chapter) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  const src = `${DATA_DIR}/audio/${bookId}-${chapter}.mp3`;
  clearNode($audioBar);

  const audio = new Audio();
  audio.preload = "metadata";
  currentAudio = audio;

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
    const pct = progress.max > 0 ? (Number(progress.value) / Number(progress.max)) * 100 : 0;
    progress.style.setProperty("--fill", `${pct}%`);
  }
  updateProgressFill();

  const timeDisplay = el("span", { className: "audio-time" }, "0:00");

  const progressWrap = el("div", { className: "audio-progress-wrap" });
  progressWrap.appendChild(progress);
  progressWrap.appendChild(timeDisplay);

  container.appendChild(playBtn);
  container.appendChild(progressWrap);

  // Play/pause toggle
  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", () => {
    playIcon.className = "audio-icon-pause";
    playBtn.setAttribute("aria-label", "일시정지");
    announce("재생");
  });

  audio.addEventListener("pause", () => {
    playIcon.className = "audio-icon-play";
    playBtn.setAttribute("aria-label", "재생");
    announce("일시정지");
  });

  // Progress updates
  audio.addEventListener("loadedmetadata", () => {
    progress.max = String(Math.floor(audio.duration));
    timeDisplay.textContent = formatTime(audio.duration);
  });

  audio.addEventListener("timeupdate", () => {
    if (!seekingByUser) {
      progress.value = String(Math.floor(audio.currentTime));
    }
    updateProgressFill();
    timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  });

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
    currentAudio = null;
    showAudioUnavailable();
  });

  $audioBar.appendChild(container);
  $audioBar.hidden = false;
  $audioBar.style.position = "sticky";
  audio.src = src;
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

// ── Search ──

let searchWorker = null;
let pendingSearchCb = null;

function ensureSearchWorker() {
  if (searchWorker) return searchWorker;
  searchWorker = new Worker("search-worker.js");
  searchWorker.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (msg.type === "results" || msg.type === "error") {
      if (pendingSearchCb) {
        const cb = pendingSearchCb;
        pendingSearchCb = null;
        cb(msg.type === "error" ? null : msg);
      }
    }
  });
  searchWorker.postMessage({ type: "init", indexUrl: `${DATA_DIR}/search-index.json` });
  return searchWorker;
}

function doSearch(query, page, pageSize) {
  return new Promise((resolve) => {
    const worker = ensureSearchWorker();
    pendingSearchCb = resolve;
    worker.postMessage({ type: "search", q: query, page, pageSize });
  });
}

// Text highlight helper: splits text on query matches and wraps in <mark>
function appendTextWithHighlight(target, text, query) {
  if (!query) {
    target.appendChild(document.createTextNode(text));
    return;
  }
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  let pos = 0;
  let idx = lower.indexOf(qLower, pos);
  if (idx === -1) {
    target.appendChild(document.createTextNode(text));
    return;
  }
  while (idx !== -1) {
    if (idx > pos) target.appendChild(document.createTextNode(text.substring(pos, idx)));
    target.appendChild(el("mark", { className: "search-highlight" }, text.substring(idx, idx + query.length)));
    pos = idx + query.length;
    idx = lower.indexOf(qLower, pos);
  }
  if (pos < text.length) target.appendChild(document.createTextNode(text.substring(pos)));
}

// Build snippet with highlighted query for search results
function buildSnippet(text, query) {
  const frag = document.createDocumentFragment();
  const span = el("span", { className: "search-result-text" });

  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const matchIdx = lower.indexOf(qLower);

  // Show ~40 chars before/after match
  let displayText = text;
  let prefix = "";
  let suffix = "";
  if (text.length > 100 && matchIdx > 40) {
    displayText = text.substring(matchIdx - 30);
    prefix = "…";
  }
  if (displayText.length > 100) {
    displayText = displayText.substring(0, 100);
    suffix = "…";
  }

  if (prefix) span.appendChild(document.createTextNode(prefix));
  appendTextWithHighlight(span, displayText, query);
  if (suffix) span.appendChild(document.createTextNode(suffix));
  frag.appendChild(span);
  return frag;
}

function buildSearchPagination(query, currentPage, totalPages) {
  const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
  const encoded = encodeURIComponent(query);

  if (currentPage > 1) {
    nav.appendChild(el("a", { href: `#/search?q=${encoded}&page=${currentPage - 1}` }, "← 이전"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  nav.appendChild(el("span", { className: "search-page-info" }, `${currentPage} / ${totalPages}`));

  if (currentPage < totalPages) {
    nav.appendChild(el("a", { href: `#/search?q=${encoded}&page=${currentPage + 1}` }, "다음 →"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  return nav;
}

async function renderSearchResults(query, page) {
  setTitle(`"${query}" 검색`);
  setBreadcrumb([{ label: "목록", href: "#/" }]);
  hideAudioBar();
  clearNode($app);

  $app.appendChild(el("div", { className: "loading", "aria-live": "polite" }, "검색 중…"));

  // Estimate page size from available viewport height
  const headerH = document.getElementById("app-header").offsetHeight || 80;
  const availH = window.innerHeight - headerH - 40;
  const itemH = 80;
  const pageSize = Math.max(5, Math.floor(availH / itemH));

  const result = await doSearch(query, page, pageSize);

  if (!result) {
    renderError("검색에 실패했습니다.");
    return;
  }

  // Verse reference match → navigate directly
  if (result.refMatch) {
    const ref = result.refMatch;
    let hash = `#/${ref.bookId}/${ref.chapter}`;
    const params = [];
    if (ref.verse) params.push(`v=${ref.verse}`);
    if (ref.verseEnd) params.push(`ve=${ref.verseEnd}`);
    if (params.length) hash += `?${params.join("&")}`;
    location.replace(hash);
    return;
  }

  clearNode($app);

  if (result.total === 0) {
    $app.appendChild(el("p", { className: "search-empty" }, `"${query}"에 대한 검색 결과가 없습니다.`));
    announce("검색 결과 없음");
    return;
  }

  const totalPages = Math.ceil(result.total / pageSize);
  $app.appendChild(el("p", { className: "search-count" },
    `총 ${result.total}건 (${page}/${totalPages}쪽)`));

  const list = el("ul", { className: "search-results", role: "list" });
  for (const r of result.results) {
    const li = el("li", { className: "search-result-item" });
    const link = el("a", {
      href: `#/${r.b}/${r.c}?hl=${encodeURIComponent(query)}&v=${r.v}`,
    });
    link.appendChild(el("span", { className: "search-result-ref" }, `${r.bookNameKo} ${r.c}:${r.v}`));
    link.appendChild(buildSnippet(r.t, query));
    li.appendChild(link);
    list.appendChild(li);
  }
  $app.appendChild(list);

  if (totalPages > 1) {
    $app.appendChild(buildSearchPagination(query, page, totalPages));
  }

  announce(`"${query}" 검색 결과 ${result.total}건`);
  window.scrollTo(0, 0);
}

// ── Search input event handlers (Desktop inline) ──

let searchDebounceTimer = null;

$searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(searchDebounceTimer);
    const q = $searchInput.value.trim();
    if (q) location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }
});

$searchInput.addEventListener("input", () => {
  const q = $searchInput.value.trim();
  $searchClear.hidden = !q;
  clearTimeout(searchDebounceTimer);
  if (!q) return;
  searchDebounceTimer = setTimeout(() => {
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }, 400);
});

$searchClear.addEventListener("click", () => {
  $searchInput.value = "";
  $searchClear.hidden = true;
  $searchInput.focus();
  if (parseHash().view === "search") location.hash = "#/";
});

// ── Search bottom sheet (Mobile FAB) ──

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function openSearchSheet(query) {
  $searchScrim.hidden = false;
  $searchSheet.hidden = false;
  $searchSheetInput.value = query || "";
  $searchSheetClear.hidden = !query;
  $searchFab.hidden = true;
  requestAnimationFrame(() => $searchSheetInput.focus());
  if (query) runSheetSearch(query, 1);
}

function closeSearchSheet() {
  $searchScrim.hidden = true;
  $searchSheet.hidden = true;
  $searchSheet.style.height = "";
  $searchFab.hidden = false;
  clearNode($searchSheetResults);
}

let sheetDebounceTimer = null;

function getSheetPageSize() {
  // Estimate how many results fit in the visible sheet area
  const resultsH = $searchSheetResults.clientHeight || (window.innerHeight * 0.55 - 90);
  const itemH = 80; // approx height per result item
  return Math.max(5, Math.floor(resultsH / itemH));
}

async function runSheetSearch(query, page) {
  clearNode($searchSheetResults);
  if (!query) return;

  $searchSheetResults.appendChild(el("div", { className: "loading" }, "검색 중…"));

  const pageSize = getSheetPageSize();
  const result = await doSearch(query, page, pageSize);
  clearNode($searchSheetResults);

  if (!result) {
    $searchSheetResults.appendChild(el("div", { className: "error" }, "검색에 실패했습니다."));
    return;
  }

  // Verse reference → navigate and close
  if (result.refMatch) {
    const ref = result.refMatch;
    let hash = `#/${ref.bookId}/${ref.chapter}`;
    const params = [];
    if (ref.verse) params.push(`v=${ref.verse}`);
    if (ref.verseEnd) params.push(`ve=${ref.verseEnd}`);
    if (params.length) hash += `?${params.join("&")}`;
    closeSearchSheet();
    location.hash = hash;
    return;
  }

  if (result.total === 0) {
    $searchSheetResults.appendChild(el("p", { className: "search-empty" }, `"${query}"에 대한 검색 결과가 없습니다.`));
    return;
  }

  const totalPages = Math.ceil(result.total / pageSize);
  $searchSheetResults.appendChild(el("p", { className: "search-count" },
    `총 ${result.total}건 (${page}/${totalPages}쪽)`));

  const list = el("ul", { className: "search-results", role: "list" });
  for (const r of result.results) {
    const li = el("li", { className: "search-result-item" });
    const link = el("a", {
      href: `#/${r.b}/${r.c}?hl=${encodeURIComponent(query)}&v=${r.v}`,
    });
    link.appendChild(el("span", { className: "search-result-ref" }, `${r.bookNameKo} ${r.c}:${r.v}`));
    link.appendChild(buildSnippet(r.t, query));
    link.addEventListener("click", () => closeSearchSheet());
    li.appendChild(link);
    list.appendChild(li);
  }
  $searchSheetResults.appendChild(list);

  if (totalPages > 1) {
    const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
    if (page > 1) {
      const prev = el("a", { href: "#", "aria-label": "이전 페이지" }, "← 이전");
      prev.addEventListener("click", (e) => { e.preventDefault(); runSheetSearch(query, page - 1); $searchSheetResults.scrollTop = 0; });
      nav.appendChild(prev);
    } else {
      nav.appendChild(el("span", { className: "placeholder" }));
    }
    nav.appendChild(el("span", { className: "search-page-info" }, `${page} / ${totalPages}`));
    if (page < totalPages) {
      const next = el("a", { href: "#", "aria-label": "다음 페이지" }, "다음 →");
      next.addEventListener("click", (e) => { e.preventDefault(); runSheetSearch(query, page + 1); $searchSheetResults.scrollTop = 0; });
      nav.appendChild(next);
    } else {
      nav.appendChild(el("span", { className: "placeholder" }));
    }
    $searchSheetResults.appendChild(nav);
  }

  announce(`"${query}" 검색 결과 ${result.total}건`);
}

$searchFab.addEventListener("click", () => openSearchSheet(""));

$searchScrim.addEventListener("click", closeSearchSheet);

$searchSheetInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(sheetDebounceTimer);
    const q = $searchSheetInput.value.trim();
    if (q) runSheetSearch(q, 1);
  }
});

$searchSheetInput.addEventListener("input", () => {
  const q = $searchSheetInput.value.trim();
  $searchSheetClear.hidden = !q;
  clearTimeout(sheetDebounceTimer);
  if (!q) { clearNode($searchSheetResults); return; }
  sheetDebounceTimer = setTimeout(() => runSheetSearch(q, 1), 400);
});

$searchSheetClear.addEventListener("click", () => {
  $searchSheetInput.value = "";
  $searchSheetClear.hidden = true;
  clearNode($searchSheetResults);
  $searchSheetInput.focus();
});

// Drag handle to resize sheet
(function initSheetDrag() {
  const handle = document.getElementById("search-sheet-handle");
  let startY = 0;
  let startH = 0;

  function onMove(clientY) {
    const delta = startY - clientY;
    const newH = Math.min(Math.max(startH + delta, window.innerHeight * 0.3), window.innerHeight * 0.9);
    $searchSheet.style.height = `${newH}px`;
  }

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = $searchSheet.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  function onPointerMove(e) { onMove(e.clientY); }
  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
    // Snap close if dragged very low
    if ($searchSheet.offsetHeight < window.innerHeight * 0.2) {
      closeSearchSheet();
      $searchSheet.style.height = "";
    }
  }
})();

// ── Service Worker Registration ──

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
