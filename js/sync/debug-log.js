// ── Sync Debug Log ────────────────────────────────────────────────────────────
// In-memory ring buffers only — never persisted to storage.
//
// Two-tier structure:
//   recent  (200 entries) — all events; oldest dropped first
//   errors  (20 entries)  — ERROR-class events only; survives normal activity
//
// Coalescing: consecutive LOCAL_CHANGE entries with the same (changeKind, changeId)
// are merged into one entry with a repeat count, preventing high-frequency saves
// (font-size drag, scroll lastRead) from filling the buffer before a failure.

const _recent = [];
const _errors = [];
const RECENT_CAP = 200;
const ERROR_CAP = 20;
const _consoleEnabled = location.hostname === "localhost";

// Deterministic session-stable fingerprint (djb2 hash) for tokens.
// Same token always maps to the same 8-char hex — useful for spotting
// "did the token change?" across entries without exposing the value.
function _fingerprint(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// ── Public: mask(field, value) ────────────────────────────────────────────────
// Single entry point for all masking. Raw values must never reach log() directly.
function mask(field, value) {
  if (value == null) return value;
  const s = String(value);
  switch (field) {
    case "token":
      return `[token:${_fingerprint(s)}]`;
    case "email": {
      const at = s.indexOf("@");
      return at < 1 ? "[email:MASKED]" : s[0] + "***" + s.slice(at);
    }
    case "fileId":
      return ".." + s.slice(-8);
    case "etag":
      return s.length > 64 ? s.slice(0, 16) + ".." : s;
    case "payload":
      // value should be the raw JSON string — only expose size
      return `payload(${s.length}B)`;
    default:
      return s;
  }
}

// ── Public: log(entry) ───────────────────────────────────────────────────────
// entry = { kind: 'TRANSITION'|'ACTION'|'NETWORK'|'ERROR', ...fields }
// All sensitive fields must be pre-masked by the caller via mask().
function log(entry) {
  const ts = Date.now();
  const isLocalChange = entry.kind === "ACTION" && entry.event === "LOCAL_CHANGE";

  // Coalesce consecutive LOCAL_CHANGE entries with same (changeKind, changeId).
  if (isLocalChange && _recent.length > 0) {
    const prev = _recent[_recent.length - 1];
    if (
      prev.event === "LOCAL_CHANGE" &&
      prev.changeKind === entry.changeKind &&
      prev.changeId === entry.changeId
    ) {
      prev._count = (prev._count ?? 1) + 1;
      prev._lastTs = ts;
      return;
    }
  }

  const item = { ts, ...entry };
  if (_consoleEnabled) {
    console.debug("[sync]", entry.event ?? entry.kind, entry);
  }

  if (_recent.length >= RECENT_CAP) _recent.shift();
  _recent.push(item);

  if (entry.kind === "ERROR") {
    if (_errors.length >= ERROR_CAP) _errors.shift();
    _errors.push(item);
  }
}

// ── Internal: format one entry for dump ──────────────────────────────────────
function _format(e, baseTs) {
  const elapsed = (((e.ts - baseTs) / 1000).toFixed(3)).padStart(7);
  const parts = [`[+${elapsed}s]`, e.event ?? e.kind];
  if (e.from)       parts.push(`${e.from}→${e.to ?? "?"}`);
  if (e.state)      parts.push(`state:${e.state}`);
  if (e.reason)     parts.push(`reason:${e.reason}`);
  if (e.status)     parts.push(`http:${e.status}`);
  if (e.changeKind) parts.push(`kind:${e.changeKind}`);
  if (e.changeId)   parts.push(`id:${e.changeId}`);
  if (e._count)     parts.push(`(×${e._count} in ${e._lastTs - e.ts}ms)`);
  return parts.join(" ");
}

// ── Public: dump() ────────────────────────────────────────────────────────────
function dump() {
  const baseTs = _recent[0]?.ts ?? Date.now();
  const lines = [
    "=== Sync Debug Log ===",
    `Recent: ${_recent.length}/${RECENT_CAP}  Errors: ${_errors.length}/${ERROR_CAP}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "--- Recent (oldest first) ---",
    ..._recent.map((e) => _format(e, baseTs)),
    "",
    "--- Errors ---",
    ...(_errors.length ? _errors.map((e) => _format(e, baseTs)) : ["(none)"]),
  ];
  return lines.join("\n");
}

// ── Public: copyToClipboard() ─────────────────────────────────────────────────
async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(dump());
    return true;
  } catch { return false; }
}

window.syncDebugLog = { log, mask, dump, copyToClipboard };
