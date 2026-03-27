"use strict";

const DATA_DIR = "data";
const $app = document.getElementById("app");
const $title = document.getElementById("page-title");
const $breadcrumb = document.getElementById("breadcrumb");

let booksCache = null;

// ── Reading position persistence ──

const STORAGE_KEY = "bible-last-read";

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
  $title.textContent = text;
  document.title = text === "공동번역성서" ? text : `${text} — 공동번역성서`;
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
    } else {
      $breadcrumb.appendChild(el("span", null, c.label));
    }
  });
}

const DIVISION_LABELS = {
  old_testament: "구약",
  deuterocanon: "제2경전",
  new_testament: "신약",
};

const DIVISION_ORDER = ["old_testament", "deuterocanon", "new_testament"];

// ── Views ──

function renderBookList(books) {
  setTitle("공동번역성서");
  setBreadcrumb([]);
  clearNode($app);

  const pos = loadReadingPosition();
  if (pos) {
    const lastBook = books.find((b) => b.id === pos.bookId);
    if (lastBook) {
      const banner = el(
        "a",
        { className: "resume-banner", href: `#/${pos.bookId}/${pos.chapter}` },
        `이어읽기: ${lastBook.name_ko} ${pos.chapter}장`
      );
      $app.appendChild(banner);
    }
  }

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

function renderChapterList(book) {
  setTitle(book.name_ko);
  setBreadcrumb([{ label: "목록", href: "#/" }]);
  clearNode($app);

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
  setTitle(`${book.name_ko} ${ch}장`);
  setBreadcrumb([
    { label: "목록", href: "#/" },
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

    const text = v.text.replace(/^¶\s*/, "");
    const verseLabel = formatVerseLabel(v);
    let verseId = `v${v.number}`;
    if (v.part) verseId += v.part;
    if (v.alt_ref != null) verseId += `_${v.alt_ref}`;
    const classes = v.chapter_ref ? "verse verse-cross-ref" : "verse";

    const span = el("span", { className: classes, id: verseId });

    // Verse number
    const sup = el("sup", { className: "verse-num", "aria-label": `${verseLabel}절` }, verseLabel);
    // Cross-chapter reference: inline with verse number e.g. "14(13장)"
    if (v.chapter_ref) {
      sup.appendChild(el("span", { className: "cross-ref-tag" }, `(${v.chapter_ref}장)`));
    }
    // Dual numbering: add alt_ref as secondary superscript
    if (v.alt_ref != null) {
      sup.appendChild(el("span", { className: "alt-ref" }, `(${v.alt_ref})`));
    }
    span.appendChild(sup);

    span.appendChild(document.createTextNode(text + " "));
    article.appendChild(span);

    isFirst = false;
  }

  $app.appendChild(article);
  $app.appendChild(buildChapterNav(book, ch));
  window.scrollTo(0, 0);
}

function renderPrologue(data, book) {
  setTitle(`${book.name_ko} 머리말`);
  setBreadcrumb([
    { label: "목록", href: "#/" },
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
  if (parts.length === 1) return { view: "chapters", bookId: parts[0] };
  if (parts[1] === "prologue") return { view: "prologue", bookId: parts[0] };
  return { view: "chapter", bookId: parts[0], chapter: parseInt(parts[1], 10) };
}

async function route() {
  const { view, bookId, chapter } = parseHash();

  try {
    const books = await loadBooks();

    if (view === "books") {
      renderBookList(books);
      return;
    }

    const book = books.find((b) => b.id === bookId);
    if (!book) {
      renderError("해당 성경을 찾을 수 없습니다.");
      return;
    }

    if (view === "chapters") {
      renderChapterList(book);
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
