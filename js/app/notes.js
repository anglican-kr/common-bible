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

// Per-view teardown: cancel pending autosave + unsubscribe + flush/close editor.
/** @type {(() => void) | null} */
let _unsub = null;
/** @type {string | null} */
let _editorId = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _saveTimer = null;
function _cleanup() {
  // Cancel the debounced autosave before flushing so a stale timer can't fire
  // later (after the note is reopened) and overwrite newer edits.
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  if (_unsub) { _unsub(); _unsub = null; }
  if (_editorId) { store()?.endEditing(); _editorId = null; }
}

// Current path with any trailing slash stripped — routing treats `/notes` and
// `/notes/` as the same view, so onChange refresh checks must too.
function _path() { return location.pathname.replace(/\/+$/, "") || "/"; }
function _onListPath() { return _path() === "/notes"; }

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

// ── View preference (list / month / week), persisted locally ──
const VIEW_KEY = "bible-notes-view";
/** @returns {"list"|"month"|"week"} */
function loadView() {
  try { const v = localStorage.getItem(VIEW_KEY); return v === "month" || v === "week" ? v : "list"; }
  catch { return "list"; }
}
/** @param {"list"|"month"|"week"} v */
function saveView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch { /* */ } }

// Anchor date for the calendar views (which month/week is shown). Module state
// so prev/next persist across the store-driven re-renders.
let _calAnchor = Date.now();

// ── BEGIN CAL_GRID ──
/** @param {number} ts @returns {number} local midnight ms (day key) */
function dayKey(ts) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

/**
 * Bucket notes by their `date` day. @param {Array<{date:number}>} notes
 * @returns {Map<number, number>} dayKey → count
 */
function bucketByDay(notes) {
  const m = new Map();
  for (const n of notes) { const k = dayKey(n.date); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

/**
 * Month grid: 6 weeks × 7 days of dayKeys covering the month of `anchor`,
 * padded to whole weeks (Sun-start). @param {number} anchor
 * @returns {{ year:number, month:number, weeks:number[][] }}
 */
function monthGrid(anchor) {
  const a = new Date(anchor);
  const year = a.getFullYear(), month = a.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay()); // back up to Sunday
  /** @type {number[][]} */ const weeks = [];
  for (let w = 0; w < 6; w++) {
    /** @type {number[]} */ const row = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      row.push(cur.getTime());
    }
    weeks.push(row);
  }
  return { year, month, weeks };
}

/**
 * Week grid: 7 dayKeys (Sun-start) for the week containing `anchor`.
 * @param {number} anchor @returns {number[]}
 */
function weekGrid(anchor) {
  const a = new Date(anchor);
  const sun = new Date(a.getFullYear(), a.getMonth(), a.getDate() - a.getDay());
  return Array.from({ length: 7 }, (_, i) => new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i).getTime());
}

/** @param {number} ts @param {number} months @returns {number} */
function addMonths(ts, months) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth() + months, 1).getTime(); }
/** @param {number} ts @param {number} days @returns {number} */
function addDays(ts, days) { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime(); }
// ── END CAL_GRID ──

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

// ── List view ──

function renderNotesList() {
  _cleanup();
  setHeader();
  clearNode($app);
  const s = store();
  // Subscribe *before* the gate early-return so the screen re-renders when the
  // IDB load finishes (init's notify), a sync lands, or a post–sign-in sync
  // flips the connection — otherwise the gate could stick until manual renav.
  if (s) _unsub = s.onChange(() => { if (_onListPath()) renderNotesList(); });
  const notes = s ? s.listNotes() : [];

  // Drive gate: only when there's nothing to show *and* never connected. If
  // notes exist locally (e.g. connected then went offline/disconnected) we show
  // them rather than hiding a user's writing behind a gate.
  if (!connected() && notes.length === 0) { $app.appendChild(buildGate()); return; }

  const view = loadView();
  const head = el("div", { className: "notes-head" });
  const newBtn = el("button", { className: "notes-new-btn", type: "button" }, "+ 새 노트");
  newBtn.addEventListener("click", () => createAndOpen());
  head.appendChild(newBtn);
  head.appendChild(buildViewToggle(view));
  head.appendChild(buildOverflowMenu());
  if (s) head.appendChild(statusChip(s.getStatus()));
  $app.appendChild(head);

  if (!connected()) {
    $app.appendChild(el("p", { className: "notes-banner" }, "Drive 연결이 해제되어 동기화되지 않습니다. 설정에서 다시 연결하세요."));
  }

  if (view === "month") renderMonthView(notes);
  else if (view === "week") renderWeekView(notes);
  else renderListView(notes);
}

/** @param {"list"|"month"|"week"} active */
function buildViewToggle(active) {
  const seg = el("div", { className: "notes-view-toggle", role: "tablist", "aria-label": "보기" });
  /** @type {Array<["list"|"month"|"week", string]>} */
  const opts = [["list", "목록"], ["month", "월"], ["week", "주"]];
  for (const [v, label] of opts) {
    const b = el("button", {
      type: "button", className: `notes-view-btn${v === active ? " active" : ""}`,
      role: "tab", "aria-selected": String(v === active),
    }, label);
    b.addEventListener("click", () => { saveView(v); renderNotesList(); });
    seg.appendChild(b);
  }
  return seg;
}

// Backup overflow menu: export JSON / import JSON / export all as .md (§4.6).
function buildOverflowMenu() {
  const wrap = el("div", { className: "notes-overflow" });
  const btn = el("button", { type: "button", className: "notes-overflow-btn", "aria-label": "백업", "aria-haspopup": "true", "aria-expanded": "false" }, "⋯");
  const menu = el("div", { className: "notes-overflow-menu", hidden: true, role: "menu" });
  const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  /** @param {string} label @param {() => void} fn */
  const item = (label, fn) => {
    const b = el("button", { type: "button", className: "notes-overflow-item", role: "menuitem" }, label);
    b.addEventListener("click", () => { close(); fn(); });
    return b;
  };
  menu.append(
    item("JSON 내보내기", exportJson),
    item("JSON 가져오기", importJsonPrompt),
    item("전체 마크다운 내보내기", exportAllMarkdown),
  );
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) document.addEventListener("click", close, { once: true });
  });
  wrap.append(btn, menu);
  return wrap;
}

/** @param {string} name @param {string} mime @param {string} text */
function downloadFile(name, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const s = store();
  if (!s) return;
  const stamp = isoDate(Date.now());
  const payload = { schemaVersion: 1, exportedAt: Date.now(), notes: s.listNotes() };
  downloadFile(`공동번역-노트-${stamp}.json`, "application/json", JSON.stringify(payload, null, 2));
}

function exportAllMarkdown() {
  const s = store();
  if (!s) return;
  const notes = s.listNotes();
  if (!notes.length) { window.announce?.("내보낼 노트가 없습니다."); return; }
  const parts = notes.map((n) => {
    const title = n.title?.trim() || "제목 없음";
    return `# ${title}\n\n_${isoDate(n.date)}_\n\n${n.body}`;
  });
  downloadFile(`공동번역-노트-${isoDate(Date.now())}.md`, "text/markdown", parts.join("\n\n---\n\n"));
}

function importJsonPrompt() {
  const input = /** @type {HTMLInputElement} */ (el("input", { type: "file", accept: "application/json,.json" }));
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const list = Array.isArray(data) ? data : (Array.isArray(data?.notes) ? data.notes : null);
        if (!list) { window.announce?.("올바른 노트 백업 파일이 아닙니다."); return; }
        const mode = confirm(`노트 ${list.length}개를 가져옵니다.\n[확인] 기존에 추가 · [취소] 전체 덮어쓰기`) ? "merge" : "overwrite";
        const n = store()?.importNotes(list, mode) ?? 0;
        window.announce?.(`${n}개 노트를 가져왔습니다.`);
        renderNotesList();
      } catch { window.announce?.("파일을 읽지 못했습니다."); }
    };
    reader.readAsText(file);
  });
  input.click();
}

/** @param {Array<Note>} notes */
function renderListView(notes) {
  if (notes.length === 0) {
    $app.appendChild(el("div", { className: "notes-empty" },
      el("p", {}, "아직 노트가 없습니다."),
      el("p", { className: "notes-empty-hint" }, "본문을 읽다가 구절을 선택해 노트를 시작하거나, 새 노트를 만드세요.")));
    return;
  }
  const list = el("ul", { className: "notes-list" });
  for (const n of notes) list.appendChild(buildNoteRow(n));
  $app.appendChild(list);
}

// ── Calendar: month view ──
/** @param {Array<Note>} notes */
function renderMonthView(notes) {
  const counts = bucketByDay(notes);
  const { year, month, weeks } = monthGrid(_calAnchor);
  const today = dayKey(Date.now());

  const nav = el("div", { className: "cal-nav" });
  const prev = el("button", { type: "button", className: "cal-nav-btn", "aria-label": "이전 달" }, "‹");
  const next = el("button", { type: "button", className: "cal-nav-btn", "aria-label": "다음 달" }, "›");
  const todayBtn = el("button", { type: "button", className: "cal-today-btn" }, "오늘");
  prev.addEventListener("click", () => { _calAnchor = addMonths(_calAnchor, -1); renderNotesList(); });
  next.addEventListener("click", () => { _calAnchor = addMonths(_calAnchor, 1); renderNotesList(); });
  todayBtn.addEventListener("click", () => { _calAnchor = Date.now(); renderNotesList(); });
  nav.append(prev, el("span", { className: "cal-title" }, `${year}년 ${month + 1}월`), next, todayBtn);
  $app.appendChild(nav);

  const grid = el("div", { className: "cal-grid", role: "grid", "aria-label": `${year}년 ${month + 1}월` });
  for (const wd of WEEKDAY_KO) grid.appendChild(el("div", { className: "cal-weekday", role: "columnheader" }, wd));
  for (const week of weeks) {
    for (const k of week) {
      const d = new Date(k);
      const inMonth = d.getMonth() === month;
      const count = counts.get(k) ?? 0;
      const cell = el("button", {
        type: "button", role: "gridcell",
        className: `cal-cell${inMonth ? "" : " cal-out"}${k === today ? " cal-today" : ""}`,
        "aria-label": `${d.getMonth() + 1}월 ${d.getDate()}일${count ? `, 노트 ${count}개` : ""}`,
      });
      cell.appendChild(el("span", { className: "cal-date" }, String(d.getDate())));
      if (count > 0) cell.appendChild(el("span", { className: "cal-dot", "aria-hidden": "true" }, count > 1 ? String(count) : ""));
      cell.addEventListener("click", () => openDay(k, notes));
      grid.appendChild(cell);
    }
  }
  $app.appendChild(grid);
}

// ── Calendar: week view (shows note titles inline) ──
/** @param {Array<Note>} notes */
function renderWeekView(notes) {
  const days = weekGrid(_calAnchor);
  const today = dayKey(Date.now());
  const byDay = new Map();
  for (const n of notes) { const k = dayKey(n.date); (byDay.get(k) ?? byDay.set(k, []).get(k)).push(n); }

  const nav = el("div", { className: "cal-nav" });
  const prev = el("button", { type: "button", className: "cal-nav-btn", "aria-label": "이전 주" }, "‹");
  const next = el("button", { type: "button", className: "cal-nav-btn", "aria-label": "다음 주" }, "›");
  const todayBtn = el("button", { type: "button", className: "cal-today-btn" }, "이번 주");
  prev.addEventListener("click", () => { _calAnchor = addDays(_calAnchor, -7); renderNotesList(); });
  next.addEventListener("click", () => { _calAnchor = addDays(_calAnchor, 7); renderNotesList(); });
  todayBtn.addEventListener("click", () => { _calAnchor = Date.now(); renderNotesList(); });
  const first = new Date(days[0]), last = new Date(days[6]);
  const range = `${first.getMonth() + 1}.${first.getDate()}–${last.getMonth() + 1}.${last.getDate()}`;
  nav.append(prev, el("span", { className: "cal-title" }, range), next, todayBtn);
  $app.appendChild(nav);

  const list = el("div", { className: "cal-week" });
  for (let i = 0; i < 7; i++) {
    const k = days[i];
    const d = new Date(k);
    const row = el("div", { className: `cal-week-row${k === today ? " cal-today" : ""}` });
    const label = el("div", { className: "cal-week-day" }, `${WEEKDAY_KO[i]} ${d.getDate()}`);
    const items = el("div", { className: "cal-week-items" });
    for (const n of (byDay.get(k) ?? [])) {
      const md = window.appMarkdown;
      const title = n.title?.trim() || (md ? md.plainText(n.body).slice(0, 40) : "") || "제목 없음";
      const chip = el("button", { type: "button", className: "cal-week-note" }, title);
      chip.addEventListener("click", () => navigate(`/notes/${n.id}`));
      items.appendChild(chip);
    }
    const add = el("button", { type: "button", className: "cal-week-add", "aria-label": `${d.getMonth() + 1}월 ${d.getDate()}일에 새 노트` }, "+");
    add.addEventListener("click", () => createAndOpen({ date: k }));
    row.append(label, items, add);
    list.appendChild(row);
  }
  $app.appendChild(list);
}

// Day detail sheet (month-cell tap): that day's notes + "new note on this date".
/** @param {number} k dayKey @param {Array<Note>} notes */
function openDay(k, notes) {
  const d = new Date(k);
  const dayNotes = notes.filter((n) => dayKey(n.date) === k);
  clearNode($app);
  setHeader();
  const head = el("div", { className: "notes-head" });
  const back = el("button", { type: "button", className: "notes-new-btn" }, "‹ 달력");
  back.addEventListener("click", () => renderNotesList());
  head.appendChild(back);
  $app.appendChild(head);
  $app.appendChild(el("h2", { className: "cal-day-title" }, `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`));
  if (dayNotes.length) {
    const list = el("ul", { className: "notes-list" });
    for (const n of dayNotes) list.appendChild(buildNoteRow(n));
    $app.appendChild(list);
  } else {
    $app.appendChild(el("p", { className: "notes-empty-hint" }, "이 날짜에 노트가 없습니다."));
  }
  const add = el("button", { type: "button", className: "notes-new-btn cal-day-add" }, "+ 이 날짜로 새 노트");
  add.addEventListener("click", () => createAndOpen({ date: k }));
  $app.appendChild(add);
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
  if (!s) { navigate("/notes"); return; }
  const note = s.getNote(id);
  if (!note) {
    // Cold load: the note may exist in IndexedDB but init() hasn't populated
    // memory yet. Wait for the store rather than bouncing to the list, then
    // re-render once init's notify (or a sync) lands. Only redirect when the
    // store is ready and the note is genuinely gone.
    if (!s.isReady()) {
      setHeader();
      clearNode($app);
      $app.appendChild(el("div", { className: "notes-empty" }, el("p", {}, "불러오는 중…")));
      _unsub = s.onChange(() => { if (_path() === `/notes/${id}`) renderNoteEditor(id); });
      return;
    }
    navigate("/notes");
    return;
  }
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
  // _saveTimer is module-scoped so _cleanup can cancel it on route change: a
  // stale timer firing after this note is reopened would write the old detached
  // textarea values and roll back newer edits.
  function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  }
  function saveNow() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    s.updateNote(id, { title: titleInput.value, body: textarea.value, date: isoToTs(dateInput.value) });
  }
  textarea.addEventListener("input", scheduleSave);
  titleInput.addEventListener("input", scheduleSave);
  dateInput.addEventListener("change", saveNow);
  titleInput.addEventListener("blur", saveNow);
  textarea.addEventListener("blur", saveNow);

  // Durability: register the live buffer so notes-store can flush on
  // hidden/pagehide. endEditing() (in _cleanup) flushes on route away.
  s.beginEditing(id, () => ({ title: titleInput.value, body: textarea.value, date: isoToTs(dateInput.value) }));
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
      btn("≣", "목록", () => apply((t) => md.toggleListItem(t, "bullet"))),
      btn("❝", "인용", () => apply((t) => md.toggleLinePrefix(t, "> "))),
      btn("☑", "체크박스", () => apply((t) => md.toggleListItem(t, "task"))),
      btn("🔗", "링크", () => apply((t) => md.insertLink(t))),
    );
  }
  return bar;
}

window.appNotes = { renderNotesList, renderNoteEditor, createAndOpen, teardown: _cleanup };

// ESM module marker (ADR-019). No runtime effect.
export {};
