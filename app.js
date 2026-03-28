"use strict";

const DATA_DIR = "data";
const $app = document.getElementById("app");
const $title = document.getElementById("page-title");
const $breadcrumb = document.getElementById("breadcrumb");

let booksCache = null;

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
      if (cur > 0) { const ns = FONT_SIZES[cur - 1]; saveFontSize(ns); applyFontSize(ns); rebuild(); }
    });
    btnPlus.addEventListener("click", () => {
      const cur = FONT_SIZES.indexOf(loadFontSize());
      if (cur < FONT_SIZES.length - 1) { const ns = FONT_SIZES[cur + 1]; saveFontSize(ns); applyFontSize(ns); rebuild(); }
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
    });
    themeRow.appendChild(btnTheme);
    popover.appendChild(themeRow);
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
}

function setTitleWithDivisionPicker(activeDivision) {
  clearNode($title);
  const label = DIVISION_LABELS[activeDivision];
  document.title = `${label} — 공동번역성서`;

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": "구분 선택", "aria-expanded": "false" },
    label
  );

  const popover = el("ul", { className: "bc-division-popover title-division-popover" });
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

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": "장 선택", "aria-expanded": "false" },
    `${book.name_ko} ${currentCh}장`
  );

  const popover = el("div", { className: "chapter-popover" });
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

  const btn = el("button", { className: "bc-division-btn" }, label);

  const popover = el("ul", { className: "bc-division-popover" });
  popover.hidden = true;

  for (const div of DIVISION_ORDER) {
    const cls = div === activeDivision ? "bc-division-item active" : "bc-division-item";
    const item = el("li", null,
      el("a", { className: cls, href: `#/${div}` }, DIVISION_LABELS[div])
    );
    popover.appendChild(item);
  }

  btn.addEventListener("click", () => {
    popover.hidden = !popover.hidden;
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !wrapper.contains(e.target)) {
      popover.hidden = true;
    }
  });

  popover.addEventListener("click", () => {
    popover.hidden = true;
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
  $app.appendChild(
    el("a", { className: "resume-banner", href: `#/${pos.bookId}/${pos.chapter}` },
      `이어읽기: ${lastBook.name_ko} ${pos.chapter}장`)
  );
}

function renderDivisionList(books, division) {
  setTitleWithDivisionPicker(division);
  setBreadcrumb([{ label: "목록", href: "#/" }]);
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

function renderChapter(data, book) {
  const ch = data.chapter;
  setTitleWithChapterPicker(book, ch);
  setBreadcrumb([
    { label: "목록", href: "#/" },
    { divisionPicker: true, label: DIVISION_LABELS[book.division], activeDivision: book.division },
    { label: book.name_ko, href: `#/${book.id}` },
  ]);
  clearNode($app);

  if (data.has_dual_numbering) {
    $app.appendChild(
      el("p", { className: "dual-numbering-note" }, "※ 위첨자 번호는 그리스어 사본 절 번호입니다.")
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
    const classes = v.chapter_ref ? "verse verse-cross-ref" : "verse";

    const span = el("span", { className: classes, id: verseId });

    // Verse number
    const sup = el("sup", { className: "verse-num", "aria-label": `${verseLabel}절` }, verseLabel);
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
      if (raw.startsWith("¶")) {
        target.appendChild(el("span", { className: "pilcrow", "aria-hidden": "true" }, "¶"));
        target.appendChild(document.createTextNode(raw.replace(/^¶\s*/, "") + " "));
      } else {
        target.appendChild(document.createTextNode(raw + " "));
      }
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
  window.scrollTo(0, 0);
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

  const parts = hash.split("/");
  if (parts.length === 1) {
    if (DIVISION_LABELS[parts[0]]) return { view: "division", division: parts[0] };
    return { view: "chapters", bookId: parts[0] };
  }
  if (parts[1] === "prologue") return { view: "prologue", bookId: parts[0] };
  return { view: "chapter", bookId: parts[0], chapter: parseInt(parts[1], 10) };
}

async function route() {
  const { view, bookId, chapter, division } = parseHash();

  try {
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
      return;
    }

    if (view === "chapter") {
      if (chapter < 1 || chapter > book.chapter_count) {
        renderError("해당 장을 찾을 수 없습니다.");
        return;
      }
      const data = await loadChapter(bookId, chapter);
      renderChapter(data, book);
      saveReadingPosition(bookId, chapter);
    }
  } catch (err) {
    renderError("데이터를 불러올 수 없습니다.");
    console.error(err);
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);

// ── Service Worker Registration ──

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
