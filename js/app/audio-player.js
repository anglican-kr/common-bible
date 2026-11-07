// @ts-check
"use strict";

// Audio Player — extracted from views.js (ADR-034 PR1, follow-up to
// ADR-018 Phase 7). Owns the per-chapter MP3 player UI, playback state, and the
// #audio-bar lifecycle (build / teardown / live toggle / the notice shown when
// the mp3 cannot load).
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
/** @type {HTMLAudioElement | null} */
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

// ── BEGIN AUDIO_ERROR_NOTICE ── (tests/unit/audio-player.test.js가 이 블록을 잘라 내어 검증한다)
// Which notice the audio bar shows when a chapter's mp3 fails to load (ADR-016 D4). The media error cannot say why:
// Chromium reports a 404, a dropped connection and an offline device with the same MediaError (code 4), so the reasons
// are checked one by one, cheapest first, and the network is asked only when the first two leave "offline" possible.
// 오프라인이고, 오디오가 있는 장인데 이 기기에 저장되어 있지 않아 불러오지 못하면 「인터넷에 연결하면 들을 수 있습니다.」를,
// 그 밖에는 「오디오 파일을 준비 중입니다.」를 보인다. 캐시에서 지운 장과 한 번도 듣지 않은 장은 구별하지 않는다
// (사용자 결정 2026-11-07, known-issues §26).

/** @typedef {"offline" | "unavailable"} AudioNotice */

/** @type {Record<AudioNotice, string>} */
const AUDIO_NOTICE_TEXT = {
  offline: "인터넷에 연결하면 들을 수 있습니다.",
  unavailable: "오디오 파일을 준비 중입니다.",
};

const AUDIO_MANIFEST_URL = "/data/audio-manifest.json";
// On a Wi-Fi with no internet a request can hang for a long time; past this, treat the server as unreachable.
const NETWORK_WAIT_MS = 5000;

/**
 * Key of a chapter's mp3 in `audio-manifest.json` entries. Chapter 0 is a book's prologue (`sir-0`).
 * @param {string} bookId @param {number} chapter
 */
function audioManifestKey(bookId, chapter) {
  return `audio/${bookId}-${chapter}.mp3`;
}

/**
 * fetch() that gives up after NETWORK_WAIT_MS, or as soon as `signal` aborts (the player was torn down). `read` takes
 * what it needs from the response, the body included, inside that same window: fetch() settles once the headers are in,
 * and a server that then stalls mid-body kept a body read waiting past the limit, and past leaving the chapter
 * (PR #520 review).
 * @template T
 * @param {string} url @param {RequestInit} init @param {AbortSignal} signal
 * @param {(res: Response) => Promise<T> | T} read
 * @returns {Promise<T>}
 */
async function _fetchWithin(url, init, signal, read) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  const timer = setTimeout(stop, NETWORK_WAIT_MS);
  if (signal.aborted) stop();
  else signal.addEventListener("abort", stop);
  try {
    return await read(await fetch(url, { ...init, signal: ctl.signal }));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

/**
 * Does the audio manifest list this mp3? sw.js precaches the manifest into its shell cache and refreshes that copy on
 * every online start, so Cache Storage is read first and the answer never waits on the network. The network is asked
 * only when no worker has cached it (first visit, or no service worker). Unreadable → false (the 「준비 중」 notice).
 * @param {string} key @param {AbortSignal} signal @returns {Promise<boolean>}
 */
async function audioListed(key, signal) {
  /** @param {Response} res @returns {Promise<boolean>} */
  const lists = async (res) => {
    if (!res.ok) return false;
    const manifest = await res.json();
    const entries = manifest && manifest.entries;
    return typeof entries === "object" && entries !== null && Object.prototype.hasOwnProperty.call(entries, key);
  };
  try {
    /** @type {Response | undefined} */
    let cached;
    try {
      cached = await caches.match(AUDIO_MANIFEST_URL);
    } catch { /* no Cache Storage (insecure context, some private modes): ask the network */ }
    return cached ? await lists(cached) : await _fetchWithin(AUDIO_MANIFEST_URL, {}, signal, lists);
  } catch {
    return false;
  }
}

/**
 * Is the mp3 saved on this device? Looks it up in Cache Storage as sw.js does before playing it; ignoreVary so a
 * response stored with a Vary header still counts as saved. Unreadable → false.
 * @param {string} src @returns {Promise<boolean>}
 */
async function audioStored(src) {
  try {
    return !!(await caches.match(src, { ignoreVary: true }));
  } catch {
    return false;
  }
}

/**
 * Can the app reach its server right now? navigator.onLine is false only when the device has no network at all; it
 * stays true on a Wi-Fi with no internet, so the server is asked. A HEAD request skips the service worker (sw.js handles
 * GET only), and any HTTP answer, 404 included, means the network works.
 * @param {string} src @param {AbortSignal} signal @returns {Promise<boolean>}
 */
async function serverReachable(src, signal) {
  if (navigator.onLine === false) return false;
  try {
    return await _fetchWithin(src, { method: "HEAD", cache: "no-store" }, signal, () => true);   // any answer will do
  } catch {
    return false;
  }
}

/**
 * Pick the notice for a chapter whose mp3 failed to load. Never rejects.
 * @param {string} src  the mp3 path the player requested
 * @param {string} key  its manifest key (audioManifestKey)
 * @param {AbortSignal} signal  the player's signal; leaving the chapter cancels the pending requests
 * @returns {Promise<AudioNotice>}
 */
async function audioErrorNotice(src, key, signal) {
  if (!(await audioListed(key, signal))) return "unavailable"; // no recording for this chapter: connecting will not help
  if (await audioStored(src)) return "unavailable"; // the saved file itself failed: connecting will not help either
  return (await serverReachable(src, signal)) ? "unavailable" : "offline";
}
// ── END AUDIO_ERROR_NOTICE ──

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

  // Error: the mp3 did not load (preload="metadata" fetches it when the chapter opens, before any play). Find out why,
  // then replace the player with the matching notice.
  audio.addEventListener("error", () => {
    audioErrorNotice(src, audioManifestKey(bookId, chapter), signal).then((notice) => {
      // Leaving the chapter or turning the player off while the checks ran aborted this signal; this chapter's notice
      // must not replace the bar the next chapter has built.
      if (signal.aborted) return;
      _teardownAudio();
      showAudioUnavailable(notice);
    });
  }, { signal });

  $audioBar.appendChild(container);
  $audioBar.hidden = false;
}

/** @param {AudioNotice} notice */
function showAudioUnavailable(notice) {
  clearNode($audioBar);
  const msg = el("p", { className: "audio-unavailable" });
  // 두 안내 모두 같은 아이콘을 쓴다.
  msg.appendChild(el("span", { className: "audio-unavailable-icon", "aria-hidden": "true" }));
  msg.appendChild(document.createTextNode(` ${AUDIO_NOTICE_TEXT[notice]}`));
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
