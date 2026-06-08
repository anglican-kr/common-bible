"use strict";
// @ts-check

// Audio Player — extracted from views.js (ADR-034 PR1, follow-up to
// ADR-018 Phase 7). Owns the per-chapter MP3 player UI, playback state, and the
// #audio-bar lifecycle (build / teardown / live toggle / unavailable message).
//
// Dependencies point downward only: appHelpers (el / clearNode / _$),
// appStorage (audio time + show flag + persist hint), window.bibleAudioCache
// (ADR-016 LRU), and the bare `announce` global (app.js Phase 8 owner). The one
// upward edge — applyAudioShow() needs the current route — reads `window.parsePath`
// via the facade rather than importing views.js, which would create an
// import cycle. ADR-034 PR5 (routing extraction) replaces that with a direct
// downward import of parsePath.

const { _$, el, clearNode } = window.appHelpers;
const {
  loadAudioShow, loadAudioTime, saveAudioTime, clearAudioTime,
  _maybeRequestPersist,
} = window.appStorage;

const DATA_DIR = "/data";
// DOM anchor. Redeclared locally so audio-player.js is self-contained (same
// pattern as views.js / bookmark.js).
const $audioBar = _$("audio-bar");

// Audio Player module state (was views.js L891-L895 / app.js L112-L116).
let currentAudio = null;
/** @type {AbortController | null} */
let _audioController = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _audioSaveTimer = null;

/** @param {number} sec @returns {string} */
function formatTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function _teardownAudio() {
  if (_audioController) { _audioController.abort(); _audioController = null; }
  if (_audioSaveTimer !== null) { clearTimeout(_audioSaveTimer); _audioSaveTimer = null; }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

function hideAudioBar() {
  _teardownAudio();
  $audioBar.hidden = true;
  clearNode($audioBar);
}

/** @param {string} bookId @param {number} chapter */
function showAudioPlayer(bookId, chapter) {
  if (!loadAudioShow()) { hideAudioBar(); return; }
  _teardownAudio();
  _audioController = new AbortController();
  const { signal } = _audioController;
  const src = `${DATA_DIR}/audio/${bookId}-${chapter}.mp3`;
  clearNode($audioBar);

  const audio = new Audio();
  currentAudio = audio;

  const savedTime = loadAudioTime(bookId, chapter);
  // Always preload metadata so total duration is visible before first play.
  // ADR-016 excludes preload accesses from LRU, so this does not pollute cache signals.
  audio.preload = "metadata";
  audio.src = src;

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
    const max = Number(progress.max);
    const pct = max > 0 ? (Number(progress.value) / max) * 100 : 0;
    progress.style.setProperty("--fill", `${pct}%`);
  }
  updateProgressFill();

  const timeDisplay = el("span", { className: "audio-time" }, "0:00");

  const progressWrap = el("div", { className: "audio-progress-wrap" });
  progressWrap.appendChild(progress);
  progressWrap.appendChild(timeDisplay);

  const SPEEDS = [1, 1.25, 1.5];
  let speedIndex = 0;
  const speedBtn = el("button", {
    className: "audio-speed-btn",
    "aria-label": "재생 속도 1배속",
  }, "1×");
  speedBtn.addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    const rate = SPEEDS[speedIndex];
    audio.playbackRate = rate;
    const label = `재생 속도 ${rate}배속`;
    speedBtn.setAttribute("aria-label", label);
    speedBtn.textContent = `${rate}×`;
    announce(label);
  });

  container.appendChild(playBtn);
  container.appendChild(progressWrap);
  container.appendChild(speedBtn);

  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", () => {
    playBtn.setAttribute("aria-label", "일시정지");
    announce("재생");
    // Touch LRU metadata + opportunistically request persisted storage on
    // first play after install (value moment, ADR-016 §F).
    const absUrl = new URL(src, location.href).href;
    window.bibleAudioCache?.touch(absUrl).catch(() => {});
    _maybeRequestPersist();
  }, { signal });

  audio.addEventListener("playing", () => {
    playIcon.className = "audio-icon-pause";
  }, { signal });

  audio.addEventListener("waiting", () => {
    playIcon.className = "audio-icon-loading";
  }, { signal });

  audio.addEventListener("pause", () => {
    playIcon.className = "audio-icon-play";
    playBtn.setAttribute("aria-label", "재생");
    announce("일시정지");
  }, { signal });

  // Progress updates
  audio.addEventListener("loadedmetadata", () => {
    progress.max = String(Math.floor(audio.duration));
    if (savedTime && savedTime < audio.duration - 3) {
      audio.currentTime = savedTime;
      progress.value = String(Math.floor(savedTime));
      updateProgressFill();
      timeDisplay.textContent = `${formatTime(savedTime)} / ${formatTime(audio.duration)}`;
    } else {
      timeDisplay.textContent = `${formatTime(0)} / ${formatTime(audio.duration)}`;
    }
  }, { signal });

  audio.addEventListener("timeupdate", () => {
    if (!seekingByUser) {
      progress.value = String(Math.floor(audio.currentTime));
    }
    updateProgressFill();
    timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    if (_audioSaveTimer !== null) clearTimeout(_audioSaveTimer);
    _audioSaveTimer = setTimeout(() => {
      if (audio.currentTime > 0 && !audio.ended) saveAudioTime(bookId, chapter, Math.floor(audio.currentTime));
    }, 1000);
  }, { signal });

  audio.addEventListener("ended", () => {
    clearAudioTime();
  }, { signal });

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
    _teardownAudio();
    showAudioUnavailable();
  }, { signal });

  $audioBar.appendChild(container);
  $audioBar.hidden = false;
}

function showAudioUnavailable() {
  clearNode($audioBar);
  const msg = el("p", { className: "audio-unavailable" });
  msg.appendChild(el("span", { className: "audio-unavailable-icon", "aria-hidden": "true" }));
  msg.appendChild(document.createTextNode(" 오디오 파일을 준비 중입니다."));
  $audioBar.appendChild(msg);
  $audioBar.hidden = false;
}

// Live-toggle the audio player from the settings popover. Off: tear it down
// so the FAB's audio-bar CSS sibling rule drops it back to the lower default
// position. On: rebuild for the chapter currently in view (no-op on non-chapter
// routes — next chapter navigation will pick the toggle up via showAudioPlayer).
/** @param {boolean} on */
function applyAudioShow(on) {
  if (!on) { hideAudioBar(); return; }
  // Upward edge: parsePath lives in views.js (PR5 → routing.js). Read
  // it through the facade to keep this module free of an import cycle.
  const parsed = window.parsePath();
  if (parsed.view === "chapter") showAudioPlayer(parsed.bookId, parsed.chapter);
  else if (parsed.view === "prologue") showAudioPlayer(parsed.bookId, 0);
}

// ── Window facade ──
// External callers stay on window (out of ADR-034 PR1 scope, migrate when those
// modules are touched): search.js / settings-ui.js / bookmark.js call
// hideAudioBar; settings-ui.js / state-machine.js call applyAudioShow; app.js's
// spacebar play/pause handler reads getCurrentAudio.
window.hideAudioBar = hideAudioBar;
window.applyAudioShow = applyAudioShow;
window.getCurrentAudio = () => currentAudio;

// In-module callers (views.js renderChapter / renderPrologue / route)
// receive these as explicit ESM imports.
export { showAudioPlayer, hideAudioBar, applyAudioShow };
