"use strict";
// @ts-check

// ── markdown ── (ADR-026 Stage 1a-②)
// Tiny dependency-free Markdown for notes: a safe renderer (source → HTML),
// plain-text extraction (search / title), and pure textarea toolbar transforms.
//
// Security (ADR-026 §4.4): every text run is HTML-escaped first and only a
// fixed whitelist of tags is emitted — no raw HTML passthrough, no `style=`,
// no event handlers. Links accept only http(s): and internal "/…" hrefs;
// anything else renders as inert escaped text. External links get
// rel="noopener noreferrer". The result is safe to assign via innerHTML under
// the app's strict CSP.

// ── BEGIN MD_RENDER ──
/**
 * Escape the five HTML-significant characters. The single source of truth for
 * turning user text into inert markup.
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Only http(s) and same-origin absolute paths are linkable. Everything else
 * (javascript:, data:, vbscript:, relative, mailto, …) is rejected so a crafted
 * link can never execute or exfiltrate.
 * @param {string} url
 * @returns {{ href: string; external: boolean } | null}
 */
function safeUrl(url) {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return { href: u, external: true };
  if (/^\/[^/]/.test(u) || u === "/") return { href: u, external: false }; // internal path, not //host
  return null;
}

/**
 * Inline render: escapes text, then applies bold/italic/code/links. Operates on
 * already-escaped text so markup is the only HTML produced.
 * @param {string} text
 * @returns {string}
 */
function renderInline(text) {
  let s = escapeHtml(text);
  // Inline code first so its contents aren't re-processed for emphasis.
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // Links: [label](url) — label is already escaped; validate url.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, rawUrl) => {
    const decoded = rawUrl.replace(/&amp;/g, "&"); // url was escaped along with the text
    const safe = safeUrl(decoded);
    if (!safe) return m; // leave the (escaped) literal text in place
    const rel = safe.external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${escapeHtml(safe.href)}"${rel}>${label}</a>`;
  });
  // Bold then italic. Use non-greedy runs that don't span the marker char.
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, c) => `<strong>${c}</strong>`);
  s = s.replace(/__([^_]+)__/g, (_m, c) => `<strong>${c}</strong>`);
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, (_m, pre, c) => `${pre}<em>${c}</em>`);
  s = s.replace(/(^|[^_])_([^_]+)_/g, (_m, pre, c) => `${pre}<em>${c}</em>`);
  return s;
}

/**
 * Block render. Line-based: headings, hr, blockquote, ordered/unordered/
 * checkbox lists, and paragraphs (single newlines become <br>).
 * @param {string} src
 * @returns {string}
 */
function renderMarkdown(src) {
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ let para = [];
  /** @type {{ tag: "ul" | "ol"; items: string[] } | null} */ let list = null;
  /** @type {string[]} */ let quote = [];

  const flushPara = () => {
    if (para.length) { out.push(`<p>${para.map(renderInline).join("<br>")}</p>`); para = []; }
  };
  const flushList = () => {
    if (list) { out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`); list = null; }
  };
  const flushQuote = () => {
    if (quote.length) { out.push(`<blockquote>${quote.map(renderInline).join("<br>")}</blockquote>`); quote = []; }
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const line of lines) {
    if (!line.trim()) { flushAll(); continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushAll(); const lvl = Math.min(h[1].length, 6); out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`); continue; }

    if (/^(?:---+|\*\*\*+|___+)\s*$/.test(line)) { flushAll(); out.push("<hr>"); continue; }

    const q = line.match(/^>\s?(.*)$/);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }

    const cb = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (cb) {
      flushPara(); flushQuote();
      if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      const checked = cb[1].toLowerCase() === "x" ? " checked" : "";
      list.items.push(`<li class="md-task"><input type="checkbox" disabled${checked}> ${renderInline(cb[2])}</li>`);
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara(); flushQuote();
      if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      list.items.push(`<li>${renderInline(ul[1])}</li>`);
      continue;
    }

    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      flushPara(); flushQuote();
      if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
      list.items.push(`<li>${renderInline(ol[1])}</li>`);
      continue;
    }

    flushList(); flushQuote();
    para.push(line);
  }
  flushAll();
  return out.join("");
}
// ── END MD_RENDER ──

// ── BEGIN MD_PLAIN ──
/**
 * Strip Markdown to plain text — for search indexing and title derivation.
 * @param {string} src
 * @returns {string}
 */
function plainText(src) {
  return String(src ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")            // headings
    .replace(/^>\s?/gm, "")                 // blockquote
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "") // list markers
    .replace(/\[([ xX])\]\s+/g, "")         // checkbox marks
    .replace(/`([^`]+)`/g, "$1")            // inline code
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → label
    .replace(/(\*\*|__)(.*?)\1/g, "$2")     // bold
    .replace(/(\*|_)(.*?)\1/g, "$2")        // italic
    .replace(/^(?:---+|\*\*\*+|___+)\s*$/gm, "") // hr
    .replace(/[ \t]+/g, " ")
    .trim();
}
// ── END MD_PLAIN ──

// ── BEGIN MD_TOOLBAR ──
/**
 * @typedef {{ value: string; start: number; end: number }} TextSel
 */

/**
 * Wrap the selection in `marker` (bold/italic/code). Empty selection inserts
 * the pair and places the caret between. Returns the new value + selection.
 * @param {TextSel} t @param {string} marker
 * @returns {TextSel}
 */
function wrapSelection(t, marker) {
  const { value, start, end } = t;
  const sel = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  if (!sel) {
    const v = before + marker + marker + after;
    const caret = start + marker.length;
    return { value: v, start: caret, end: caret };
  }
  const v = before + marker + sel + marker + after;
  return { value: v, start: start + marker.length, end: end + marker.length };
}

/**
 * Toggle a line prefix (heading/quote/list/checkbox) on every line the
 * selection touches. Adds the prefix when absent, strips it when present.
 * @param {TextSel} t @param {string} prefix
 * @returns {TextSel}
 */
function toggleLinePrefix(t, prefix) {
  const { value, start, end } = t;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const allPrefixed = lines.every((l) => l.startsWith(prefix));
  const next = lines
    .map((l) => (allPrefixed ? l.slice(prefix.length) : prefix + l))
    .join("\n");
  const v = value.slice(0, lineStart) + next + value.slice(lineEnd);
  return { value: v, start: lineStart, end: lineStart + next.length };
}

/**
 * Insert a link. With a selection, it becomes the label and the caret lands in
 * the empty url parens; with no selection, a "텍스트"/url skeleton is inserted.
 * @param {TextSel} t
 * @returns {TextSel}
 */
function insertLink(t) {
  const { value, start, end } = t;
  const sel = value.slice(start, end);
  const label = sel || "텍스트";
  const snippet = `[${label}]()`;
  const v = value.slice(0, start) + snippet + value.slice(end);
  const caret = start + label.length + 3; // inside ()
  return { value: v, start: caret, end: caret };
}

// Strip any leading list marker (bullet / numbered / task) so list toggles
// don't collide — e.g. the bullet prefix `- ` is a substring of the task form
// `- [ ] `, which a plain prefix toggle would mangle into `[ ] item`.
const _LIST_MARKER = /^\s*(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/;

/**
 * Toggle a list-item kind on every selected line. Recognizes the existing list
 * form, so switching kinds replaces the marker cleanly and toggling the same
 * kind removes it.
 * @param {TextSel} t @param {"bullet" | "task"} kind
 * @returns {TextSel}
 */
function toggleListItem(t, kind) {
  const { value, start, end } = t;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const taskRe = /^\s*[-*+]\s+\[[ xX]\]\s+/;
  const bulletRe = /^\s*[-*+]\s+/;
  const isKind = (/** @type {string} */ l) =>
    kind === "task" ? taskRe.test(l) : (bulletRe.test(l) && !taskRe.test(l));
  const marker = kind === "task" ? "- [ ] " : "- ";
  const allKind = lines.every(isKind);
  const next = lines
    .map((l) => { const stripped = l.replace(_LIST_MARKER, ""); return allKind ? stripped : marker + stripped; })
    .join("\n");
  const v = value.slice(0, lineStart) + next + value.slice(lineEnd);
  return { value: v, start: lineStart, end: lineStart + next.length };
}
// ── END MD_TOOLBAR ──

window.appMarkdown = {
  escapeHtml, safeUrl, renderInline, renderMarkdown, plainText,
  wrapSelection, toggleLinePrefix, toggleListItem, insertLink,
};

// ESM module marker (ADR-019). No runtime effect.
export {};
