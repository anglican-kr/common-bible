"use strict";
// @ts-check

// ── notes ── (ADR-026 Stage 1a-②)
// /notes list + /notes/:id editor. Notes are Drive-gated (require a connection);
// data + sync live in js/sync/notes-store.js. Markdown via js/app/markdown.js.
// Editor: edit/preview toggle + a selection-preserving formatting toolbar, with
// debounced autosave and lifecycle durability delegated to notes-store
// (beginEditing/endEditing register the live buffer).

/** @typedef {import("../types").Note} Note */

const { _$, el, clearNode } = window.appHelpers;
const $app = _$("app");
const $title = _$("page-title");

const SAVE_DEBOUNCE_MS = 600;

/** @returns {import("../types").NotesStore | undefined} */
function store() { return window.notesStore; }
/** @param {string} p */
function navigate(p) { window.appViewsRouting?.navigate?.(p); }
/** Drive sync enabled (connected at least once)? Notes require it. */
function connected() { return window.driveSync?.isEnabled?.() === true; }

// Per-view teardown: unsubscribe store listener + flush/close any open editor.
/** @type {(() => void) | null} */
let _unsub = null;
/** @type {string | null} */
let _editorId = null;
function _cleanup() {
  if (_unsub) { _unsub(); _unsub = null; }
  if (_editorId) { store()?.endEditing(); _editorId = null; }
}

/** @param {number} pad @returns {string} */
function _2(pad) { return String(pad).padStart(2, "0"); }
/** @param {number} ts @returns {string} ISO yyyy-mm-dd (local) */
function isoDate(ts) { const d = new Date(ts); return `${d.getFullYear()}-${_2(d.getMonth() + 1)}-${_2(d.getDate())}`; }
/** @param {string} iso @returns {number} local-midnight ms */
function isoToTs(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); }

function setHeader() {
  window.setTitle?.("노트");
  $title.appendChild(window.buildSettingsTrigger());
}

const STATUS_LABEL = /** @type {Record<string, string>} */ ({
  synced: "저장됨", pending: "저장 대기", syncing: "동기화 중",
  offline: "오프라인", conflict: "충돌 사본 생성", error: "동기화 오류",
});

/** @param {string} status */
function statusChip(status) {
  return el("span", { className: `note-status note-status-${status}`, role: "status" }, STATUS_LABEL[status] ?? status);
}

// ── List view ──

function renderNotesList() {
  _cleanup();
  setHeader();
  clearNode($app);
  const s = store();
  const notes = s ? s.listNotes() : [];

  // Drive gate: only when there's nothing to show *and* never connected. If
  // notes exist locally (e.g. connected then went offline/disconnected) we show
  // them rather than hiding a user's writing behind a gate.
  if (!connected() && notes.length === 0) { $app.appendChild(buildGate()); return; }

  const head = el("div", { className: "notes-head" });
  const newBtn = el("button", { className: "notes-new-btn", type: "button" }, "+ 새 노트");
  newBtn.addEventListener("click", () => createAndOpen());
  head.appendChild(newBtn);
  if (s) head.appendChild(statusChip(s.getStatus()));
  $app.appendChild(head);

  if (!connected()) {
    $app.appendChild(el("p", { className: "notes-banner" }, "Drive 연결이 해제되어 동기화되지 않습니다. 설정에서 다시 연결하세요."));
  }

  if (notes.length === 0) {
    $app.appendChild(el("div", { className: "notes-empty" },
      el("p", {}, "아직 노트가 없습니다."),
      el("p", { className: "notes-empty-hint" }, "본문을 읽다가 구절을 선택해 노트를 시작하거나, 새 노트를 만드세요.")));
  } else {
    const list = el("ul", { className: "notes-list" });
    for (const n of notes) list.appendChild(buildNoteRow(n));
    $app.appendChild(list);
  }

  // Live refresh on store changes (sync status, remote merges) while on /notes.
  if (s) _unsub = s.onChange(() => { if (location.pathname === "/notes") renderNotesList(); });
}

/** @param {Note} n */
function buildNoteRow(n) {
  const md = window.appMarkdown;
  const title = n.title?.trim() || (md ? md.plainText(n.body).slice(0, 60) : "") || "제목 없음";
  const snippet = md ? md.plainText(n.body).slice(0, 100) : n.body.slice(0, 100);
  const li = el("li", { className: "note-row", role: "button", tabindex: "0", "data-id": n.id });
  li.appendChild(el("div", { className: "note-row-title" }, title));
  if (snippet) li.appendChild(el("div", { className: "note-row-snippet" }, snippet));
  li.appendChild(el("div", { className: "note-row-date" }, isoDate(n.date)));
  const open = () => navigate(`/notes/${n.id}`);
  li.addEventListener("click", open);
  li.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  return li;
}

function buildGate() {
  const wrap = el("div", { className: "notes-gate" });
  wrap.appendChild(el("h2", {}, "노트"));
  wrap.appendChild(el("p", {}, "노트는 Google Drive에 안전하게 저장됩니다. 시작하려면 Drive를 연결하세요."));
  const btn = el("button", { className: "notes-gate-btn", type: "button" }, "Google Drive 연결");
  btn.addEventListener("click", () => window.driveSync?.signIn?.());
  wrap.appendChild(btn);
  return wrap;
}

/** @param {Partial<Note>} [init] */
function createAndOpen(init) {
  const s = store();
  if (!s) { window.announce?.("노트를 사용할 수 없습니다."); return; }
  const note = s.createNote(init);
  navigate(`/notes/${note.id}`);
}

// ── Editor view ──

/** @param {string} id */
function renderNoteEditor(id) {
  _cleanup();
  const s = store();
  const note = s?.getNote(id);
  if (!s || !note) { navigate("/notes"); return; }
  setHeader();
  clearNode($app);

  const wrap = el("div", { className: "note-editor" });

  // Control bar: back · mode toggle · delete.
  const bar = el("div", { className: "note-editor-bar" });
  const back = el("button", { className: "note-back", type: "button", "aria-label": "노트 목록으로" }, "‹ 목록");
  back.addEventListener("click", () => navigate("/notes"));
  const seg = el("div", { className: "note-mode", role: "tablist" });
  const editTab = el("button", { className: "note-mode-btn active", type: "button", role: "tab", "aria-selected": "true" }, "편집");
  const prevTab = el("button", { className: "note-mode-btn", type: "button", role: "tab", "aria-selected": "false" }, "미리보기");
  seg.append(editTab, prevTab);
  const del = el("button", { className: "note-del", type: "button", "aria-label": "노트 삭제" }, "삭제");
  bar.append(back, seg, del);

  const titleInput = /** @type {HTMLInputElement} */ (el("input", { className: "note-title", type: "text", placeholder: "제목", value: note.title }));
  const dateInput = /** @type {HTMLInputElement} */ (el("input", { className: "note-date", type: "date", value: isoDate(note.date), "aria-label": "노트 날짜" }));

  const editPane = el("div", { className: "note-edit-pane" });
  const textarea = /** @type {HTMLTextAreaElement} */ (el("textarea", { className: "note-body", placeholder: "마크다운으로 작성…", spellcheck: "false" }));
  textarea.value = note.body;
  const toolbar = buildToolbar(textarea, () => scheduleSave());
  editPane.append(textarea, toolbar);

  const previewPane = el("div", { className: "note-preview-pane", hidden: true });

  wrap.append(bar, titleInput, dateInput, editPane, previewPane);
  $app.appendChild(wrap);

  // ── Autosave (debounced) — updateNote only bumps on real content change ──
  let _t = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  function scheduleSave() {
    if (_t) clearTimeout(_t);
    _t = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }
  function saveNow() {
    if (_t) { clearTimeout(_t); _t = null; }
    s.updateNote(id, { title: titleInput.value, body: textarea.value, date: isoToTs(dateInput.value) });
  }
  textarea.addEventListener("input", scheduleSave);
  titleInput.addEventListener("input", scheduleSave);
  dateInput.addEventListener("change", saveNow);
  titleInput.addEventListener("blur", saveNow);
  textarea.addEventListener("blur", saveNow);

  // Durability: register the live buffer so notes-store can flush on
  // hidden/pagehide. endEditing() (in _cleanup) flushes on route away.
  s.beginEditing(id, () => ({ title: titleInput.value, body: textarea.value }));
  _editorId = id;

  // ── Mode toggle ──
  function showEdit() {
    editTab.classList.add("active"); prevTab.classList.remove("active");
    editTab.setAttribute("aria-selected", "true"); prevTab.setAttribute("aria-selected", "false");
    previewPane.hidden = true; editPane.hidden = false;
  }
  function showPreview() {
    saveNow();
    prevTab.classList.add("active"); editTab.classList.remove("active");
    prevTab.setAttribute("aria-selected", "true"); editTab.setAttribute("aria-selected", "false");
    clearNode(previewPane);
    const html = window.appMarkdown?.renderMarkdown(textarea.value) ?? "";
    previewPane.innerHTML = html; // safe: renderMarkdown escapes + whitelists (ADR-026 §4.4)
    editPane.hidden = true; previewPane.hidden = false;
    textarea.blur(); // drop the keyboard on mobile
  }
  editTab.addEventListener("click", showEdit);
  prevTab.addEventListener("click", showPreview);

  // ── Delete ──
  del.addEventListener("click", () => {
    if (!confirm("이 노트를 삭제할까요?")) return;
    _editorId = null; // already removing; skip endEditing flush
    s.deleteNote(id);
    navigate("/notes");
  });
}

/**
 * Build the formatting toolbar. Each button applies a pure transform from
 * appMarkdown to the textarea, preserving the selection, then triggers save.
 * @param {HTMLTextAreaElement} ta
 * @param {() => void} onChange
 */
function buildToolbar(ta, onChange) {
  const md = window.appMarkdown;
  const bar = el("div", { className: "note-toolbar", role: "toolbar", "aria-label": "서식" });
  /** @param {(t:{value:string;start:number;end:number}) => {value:string;start:number;end:number}} fn */
  const apply = (fn) => {
    const r = fn({ value: ta.value, start: ta.selectionStart, end: ta.selectionEnd });
    ta.value = r.value;
    ta.setSelectionRange(r.start, r.end);
    ta.focus();
    onChange();
  };
  /** @param {string} label @param {string} aria @param {() => void} handler */
  const btn = (label, aria, handler) => {
    const b = el("button", { type: "button", className: "note-tool", "aria-label": aria }, label);
    b.addEventListener("click", handler);
    return b;
  };
  if (md) {
    bar.append(
      btn("B", "굵게", () => apply((t) => md.wrapSelection(t, "**"))),
      btn("I", "기울임", () => apply((t) => md.wrapSelection(t, "*"))),
      btn("H", "제목", () => apply((t) => md.toggleLinePrefix(t, "## "))),
      btn("≣", "목록", () => apply((t) => md.toggleLinePrefix(t, "- "))),
      btn("❝", "인용", () => apply((t) => md.toggleLinePrefix(t, "> "))),
      btn("☑", "체크박스", () => apply((t) => md.toggleLinePrefix(t, "- [ ] "))),
      btn("🔗", "링크", () => apply((t) => md.insertLink(t))),
    );
  }
  return bar;
}

window.appNotes = { renderNotesList, renderNoteEditor, createAndOpen };

// ESM module marker (ADR-019). No runtime effect.
export {};
