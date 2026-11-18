// @ts-check

// 설정의 「오프라인 저장」(ADR-045). 성서 본문, 성서 검색 자료, 교회력 자료를 DATA_CACHE에 미리 받아 두어,
// 한 번도 열지 않은 장과 날도 인터넷 없이 열리게 한다. 받을 파일과 크기는 데이터 저장소가 만드는 크기 목록
// (`/data/bible-sizes.json`, ADR-045 §8)에서 얻는다.
//
// Flow: the switch calls enable() → run() lists the files not yet in DATA_CACHE, checks the free space,
// then fetches them CONCURRENCY at a time and awaits each cache.put, so a quota failure surfaces here
// (the service worker's own put is fire-and-forget). While the switch is on, resume() runs the same pass
// at boot after manifest-sync has evicted changed files (ADR-045 §4), and the `online` event resumes a
// pass the network cut short. disable() aborts the pass and deletes DATA_CACHE (ADR-045 §6).
//
// The switch state lives in localStorage on this device only and is not synced (ADR-045 §7).

window.offlineSave = (() => {
  const STORAGE_KEY = "bible-offline-save";
  const SIZES_URL = "/data/bible-sizes.json";
  const DATA_CACHE = "data";
  const CONCURRENCY = 6;
  // 앱이 아직 쓰지 않는 파일(ADR-045 §1). 성무일과 화면을 만들 때 뺀다.
  const UNUSED = new Set(["lectionary/office-readings.json"]);
  // 성서 색인 셋과 성시 색인(ADR-046 §6)
  const SEARCH_FILES = new Set(["search-ot.json", "search-nt.json", "search-dc.json", "search-lit.json"]);
  // sw.js passes a request carrying this header straight to the network without caching it, so the
  // page's awaited cache.put is the only write.
  const BYPASS_HEADER = "X-Offline-Save";
  // Headroom over the bytes still to fetch when comparing with navigator.storage.estimate(): a Cache API
  // entry stores its headers and bookkeeping besides the body.
  const SPACE_MARGIN = 1.05;

  /** @typedef {import("./types.js").OfflineSaveStatus} Status */
  /** @typedef {import("./types.js").OfflineSaveState} State */
  /** @typedef {import("./types.js").OfflineSaveSummary} Summary */
  /** @typedef {{ files: Map<string, number>, summary: Summary }} SizeList */

  /** @returns {boolean} */
  function isEnabled() {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  }

  /** @param {boolean} on */
  function setEnabled(on) {
    try {
      if (on) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage refused — the switch then reads off on the next visit */ }
  }

  /**
   * Which group a size-list key belongs to, or null when the app does not save it.
   * @param {string} key  e.g. "bible/gen-1.json"
   * @returns {"bible" | "search" | "lectionary" | null}
   */
  function groupOf(key) {
    if (UNUSED.has(key)) return null;
    if (key.startsWith("bible/")) return "bible";
    if (key.startsWith("lectionary/")) return "lectionary";
    if (SEARCH_FILES.has(key)) return "search";
    return null;
  }

  /**
   * @param {unknown} data
   * @returns {SizeList | null}
   */
  function parseSizeList(data) {
    if (!data || typeof data !== "object") return null;
    const { sizes } = /** @type {{ sizes?: unknown }} */ (data);
    if (!sizes || typeof sizes !== "object") return null;
    /** @type {Map<string, number>} */
    const files = new Map();
    let total = 0;
    for (const [key, size] of Object.entries(sizes)) {
      const group = groupOf(key);
      if (!group || typeof size !== "number" || !(size > 0)) continue;
      files.set(key, size);
      total += size;
    }
    if (!files.size) return null;
    return { files, summary: { total } };
  }

  /** @type {Promise<SizeList | null> | null} */
  let sizesPromise = null;

  /**
   * The size list, fetched once per session. A failed fetch is not remembered, so the next call retries.
   * @returns {Promise<SizeList | null>}
   */
  function loadSizes() {
    if (!sizesPromise) {
      sizesPromise = (async () => {
        try {
          const res = await fetch(SIZES_URL, { cache: "no-cache" });
          if (!res.ok) return null;
          return parseSizeList(await res.json());
        } catch {
          return null;
        }
      })();
      sizesPromise.then((list) => { if (!list) sizesPromise = null; });
    }
    return sizesPromise;
  }

  /** @param {string} requestUrl @returns {string | null} key under /data/ */
  function keyOf(requestUrl) {
    try {
      const { pathname } = new URL(requestUrl, location.href);
      return pathname.startsWith("/data/") ? pathname.slice("/data/".length) : null;
    } catch {
      return null;
    }
  }

  /** @param {Cache} cache @returns {Promise<Set<string>>} */
  async function cachedKeys(cache) {
    const keys = new Set();
    for (const req of await cache.keys()) {
      const key = keyOf(req.url);
      if (key) keys.add(key);
    }
    return keys;
  }

  /** @param {unknown} err @returns {boolean} */
  function isQuotaError(err) {
    const e = /** @type {{ name?: string, code?: number } | null} */ (err);
    return !!e && (e.name === "QuotaExceededError" || e.code === 22);
  }

  /** @param {number} need bytes still to store @returns {Promise<boolean>} */
  async function hasRoom(need) {
    try {
      const est = await navigator.storage?.estimate?.();
      if (!est || typeof est.quota !== "number" || typeof est.usage !== "number") return true;
      return est.quota - est.usage >= need * SPACE_MARGIN;
    } catch {
      return true;  // no way to tell (iOS 16 and older) — a failing put reports it instead
    }
  }

  /**
   * @param {Cache} cache @param {string} key
   * @returns {Promise<"ok" | "offline" | "failed" | "no-space">}
   */
  async function fetchAndStore(cache, key) {
    const url = `/data/${key}`;
    /** @type {Response} */
    let res;
    try {
      res = await fetch(url, { cache: "no-cache", headers: { [BYPASS_HEADER]: "1" } });
    } catch {
      return navigator.onLine === false ? "offline" : "failed";
    }
    if (!res.ok) return "failed";
    try {
      await cache.put(url, res);
      return "ok";
    } catch (err) {
      return isQuotaError(err) ? "no-space" : "failed";
    }
  }

  // ── State ──

  /** @type {State} */
  let state = {
    status: isEnabled() ? "checking" : "off",
    saved: null,
    total: null,
  };
  /** @type {Set<(state: State) => void>} */
  const listeners = new Set();

  /** @returns {State} */
  function getState() {
    return { ...state };
  }

  /** @param {Partial<State>} patch */
  function update(patch) {
    state = { ...state, ...patch };
    for (const fn of [...listeners]) {
      try { fn(getState()); } catch { /* a broken listener must not stop the pass */ }
    }
  }

  /** @param {(state: State) => void} fn @returns {() => void} unsubscribe */
  function subscribe(fn) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }

  // Bumped by every new pass and by disable(); a pass whose number is stale stops at its next step.
  let generation = 0;

  async function run() {
    if (!isEnabled()) return;
    const gen = ++generation;
    const list = await loadSizes();
    if (gen !== generation) return;
    if (!list) {
      update({ status: navigator.onLine === false ? "offline" : "failed" });
      return;
    }
    const total = list.summary.total;
    /** @type {Cache} */
    let cache;
    /** @type {Set<string>} */
    let have;
    try {
      cache = await caches.open(DATA_CACHE);
      have = await cachedKeys(cache);
    } catch {
      if (gen === generation) update({ status: "failed", total });
      return;
    }
    if (gen !== generation) return;

    const queue = [...list.files.keys()].filter((key) => !have.has(key));
    let need = 0;
    for (const key of queue) need += /** @type {number} */ (list.files.get(key));
    let saved = total - need;
    if (!queue.length) { update({ status: "done", saved, total }); return; }
    if (navigator.onLine === false) { update({ status: "offline", saved, total }); return; }
    if (!(await hasRoom(need))) {
      if (gen === generation) stopForSpace(saved, total);
      return;
    }
    if (gen !== generation) return;
    update({ status: "saving", saved, total });

    /** @type {"offline" | "failed" | "no-space" | null} */
    let outcome = null;
    const worker = async () => {
      while (queue.length && !outcome && gen === generation) {
        const key = /** @type {string} */ (queue.shift());
        const result = await fetchAndStore(cache, key);
        if (gen !== generation) return;
        if (result === "ok") {
          saved += /** @type {number} */ (list.files.get(key));
          update({ saved });
        } else if (!outcome) {
          outcome = result;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (gen !== generation) return;
    if (outcome === "no-space") stopForSpace(saved, total);
    else update({ status: outcome ?? "done", saved, total });
  }

  /** @param {number} saved @param {number} total */
  function stopForSpace(saved, total) {
    // 받은 파일은 지우지 않는다. 읽으며 저장된 장과 같은 곳에 있어 가를 수 없다(ADR-045 §5).
    generation++;
    setEnabled(false);
    update({ status: "no-space", saved, total });
  }

  // ── Public actions ──

  /** Turn the switch on. Call from the switch's own event so persist() runs within the user's gesture. */
  function enable() {
    setEnabled(true);
    // 오래 보관해 달라는 요청(ADR-045 §5). Firefox는 허락을 묻는 창을 띄우고, Safari와 Chrome은 스스로 정한다.
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* not supported */ }
    update({ status: "checking" });
    run();
  }

  /** Turn the switch off: stop the pass and delete the saved files (ADR-045 §6). */
  async function disable() {
    generation++;
    setEnabled(false);
    try { await caches.delete(DATA_CACHE); } catch { /* nothing to delete */ }
    update({ status: "off", saved: 0 });
  }

  /** At boot, after manifest-sync: fetch what is missing or changed while the switch is on (ADR-045 §4). */
  function resume() {
    if (isEnabled()) run();
  }

  /** 「캐시 초기화」 is about to delete every cache: the switch goes off with it (ADR-045 §6). */
  function forget() {
    generation++;
    setEnabled(false);
  }

  /** @returns {Promise<Summary | null>} sizes per group, null while the list cannot be fetched */
  async function summary() {
    return (await loadSizes())?.summary ?? null;
  }

  /** @returns {Promise<number>} bytes of the saved set now in DATA_CACHE (what turning off deletes) */
  async function savedBytes() {
    const list = await loadSizes();
    if (!list) return state.saved ?? 0;
    try {
      const have = await cachedKeys(await caches.open(DATA_CACHE));
      let bytes = 0;
      for (const [key, size] of list.files) if (have.has(key)) bytes += size;
      return bytes;
    } catch {
      return state.saved ?? 0;
    }
  }

  window.addEventListener("online", () => {
    if (isEnabled() && state.status === "offline") run();
  });

  return {
    isEnabled, getState, subscribe,
    enable, disable, resume, forget,
    summary, savedBytes,
    // Internals exposed for unit tests; not part of the public surface.
    _parseSizeList: parseSizeList,
    _run: run,
  };
})();
