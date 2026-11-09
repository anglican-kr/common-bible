// @ts-check
"use strict";

// Settings popover + icon recoloring + theme/color/font apply + launch
// screen. Phase 3 of the app.js modularization (ADR-018).
//
// Module pattern: IIFE + window.appSettings, mirrors helpers/storage.
// Cross-module dependencies:
//   - window.appHelpers: el, clearNode, _$, trapFocus
//   - window.appStorage: load/save × Settings + COLOR_SCHEMES/FONT_SIZES
//   - app.js (still global, will modularize): announce, openInstallModal,
//     openDriveDisconnectModal, clearAllCaches, parsePath, route, install
//   - sync layer: window.driveSync, window.syncDebugLog
//   - DOM anchors: $title (sync via window when needed)

/** @typedef {import("../types.js").AppSettings} AppSettings */

// The return type is declared so a member missing from `AppSettings` (types.d.ts) fails typecheck here, not
// later in whichever module destructures it (helpers.js does the same for `AppHelpers`).
window.appSettings = (/** @returns {AppSettings} */ () => {
  /** @typedef {import("../types.js").ColorSchemeEntry} ColorSchemeEntry */
  /** @typedef {import("../types.js").StartPage} StartPage */

  const { _$, el, clearNode, parishGroups } = window.appHelpers;
  const { createOverlay } = window.appOverlay;
  const {
    FONT_SIZES, DEFAULT_FONT_SIZE, COLOR_SCHEMES, START_PAGES,
    loadFontSize, saveFontSize,
    loadStartupBehavior, saveStartupBehavior,
    loadStartPage, saveStartPage,
    loadLectionaryAltShow, saveLectionaryAltShow,
    loadParish, saveParish,
    loadColorScheme, saveColorScheme,
    loadTheme, saveTheme,
    loadBookOrder, saveBookOrder,
    loadCiteShow, saveCiteShow,
    loadAudioShow, saveAudioShow,
  } = window.appStorage;

  const $settingsAnchor = _$("settings-anchor");

  // ── Font size ──
  /** @param {number | string} size */
  function applyFontSize(size) {
    document.documentElement.style.fontSize = `${size}px`;
  }

  // ── Icon recoloring ──
  /** @param {string} hex @returns {[number, number, number]} */
  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  // Luminance of the original icon background (#1a1a2e)
  const ICON_BG_LUM = (26 * 0.299 + 26 * 0.587 + 46 * 0.114) / 255; // ≈ 0.111

  // Monotonically-increasing counter used to cancel stale updateAppIcons calls.
  // Incremented each time applyColorScheme is called so any in-flight async
  // chain started by a previous call becomes a no-op when it resolves.
  let _iconGeneration = 0;

  // Loads the source icon's pixel data. Not cached: a decoded 512×512 ImageData is
  // ~1 MB and color-scheme changes are rare; releasing it after use keeps idle
  // memory low. The asset is served from the SW cache, so re-reads are cheap.
  /** @returns {Promise<ImageData>} */
  function loadOrigIcon() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas 2D context unavailable")); return; }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      };
      img.onerror = reject;
      img.src = "/assets/icons/icon-512-maskable.png";
    });
  }

  /** @param {ColorSchemeEntry} scheme */
  function updateAppIcons(scheme) {
    // Capture the generation at dispatch time; discard the result if a newer
    // applyColorScheme call has already superseded this one.
    const gen = _iconGeneration;
    // Defer to idle: favicon/apple-touch-icon updates have no visible effect
    // during reading, and the canvas pass blocks the main thread for a frame.
    const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
    idle(() => {
      if (_iconGeneration !== gen) return;
      loadOrigIcon().then((origData) => {
        if (_iconGeneration !== gen) return;
        const [nr, ng, nb] = hexToRgb(scheme.iconBg);
        const canvas = document.createElement("canvas");
        canvas.width = origData.width;
        canvas.height = origData.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const d = origData.data;
        for (let i = 0; i < d.length; i += 4) {
          // Normalize luminance: 0 = original bg, 1 = white cross
          const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
          const t = Math.max(0, Math.min(1, (lum - ICON_BG_LUM) / (1 - ICON_BG_LUM)));
          d[i]     = Math.round(nr + (255 - nr) * t);
          d[i + 1] = Math.round(ng + (255 - ng) * t);
          d[i + 2] = Math.round(nb + (255 - nb) * t);
        }
        ctx.putImageData(origData, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        const faviconLink = /** @type {HTMLLinkElement | null} */ (document.querySelector("link[rel='icon']"));
        if (faviconLink) faviconLink.href = dataUrl;
        const appleLink = /** @type {HTMLLinkElement | null} */ (document.querySelector("link[rel='apple-touch-icon']"));
        if (appleLink) appleLink.href = dataUrl;
      }).catch(() => { /* non-critical */ });
    });
  }

  // ── Color scheme apply ──
  // Default favicon/apple-touch-icon URLs as shipped in index.html. Captured
  // once so we can restore them when reverting to the navy scheme without
  // re-running the canvas recolor pipeline.
  const DEFAULT_FAVICON_HREF = "/favicon.ico";
  const DEFAULT_APPLE_ICON_HREF = "/assets/icons/icon-512-maskable.png";

  /** @param {string} schemeName */
  function applyColorScheme(schemeName) {
    // Defensive migration: Drive sync restore (state-machine.js) calls this
    // directly with whatever value the remote device sent, bypassing
    // loadColorScheme's migration. Mirror the rename here so any caller is
    // covered.
    if (schemeName === "terracotta") schemeName = "red";
    // Invalidate any in-flight updateAppIcons call from a previous scheme.
    _iconGeneration++;
    const scheme = COLOR_SCHEMES.find((s) => s.id === schemeName) || COLOR_SCHEMES[0];
    if (schemeName === "navy") {
      document.documentElement.removeAttribute("data-color-scheme");
      updateThemeMetaColor();
      // Default scheme: shipped favicon/apple-touch-icon already match. Skipping
      // the canvas recolor saves ~1 MB ImageData on every launch. If a previous
      // session left a recolored data: URL on these <link>s, restore the originals.
      const faviconLink = /** @type {HTMLLinkElement | null} */ (document.querySelector("link[rel='icon']"));
      if (faviconLink && faviconLink.href !== new URL(DEFAULT_FAVICON_HREF, location.href).href) {
        faviconLink.href = DEFAULT_FAVICON_HREF;
      }
      const appleLink = /** @type {HTMLLinkElement | null} */ (document.querySelector("link[rel='apple-touch-icon']"));
      if (appleLink && appleLink.href !== new URL(DEFAULT_APPLE_ICON_HREF, location.href).href) {
        appleLink.href = DEFAULT_APPLE_ICON_HREF;
      }
      return;
    }
    document.documentElement.setAttribute("data-color-scheme", schemeName);
    updateThemeMetaColor();
    updateAppIcons(scheme);
  }

  // ── Theme apply ──
  /** @type {((e: MediaQueryListEvent) => void) | null} */
  let _systemThemeListener = null;
  const _darkMQ = window.matchMedia("(prefers-color-scheme: dark)");

  function updateThemeMetaColor() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const color = isDark ? "#1f1f36" : "#faf8f5";
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", color);
    });
  }

  /** @param {string} theme */
  function applyTheme(theme) {
    if (_systemThemeListener) {
      _darkMQ.removeEventListener("change", _systemThemeListener);
      _systemThemeListener = null;
    }
    const resolved = theme === "system" ? (_darkMQ.matches ? "dark" : "light") : theme;
    document.documentElement.setAttribute("data-theme", resolved);
    updateThemeMetaColor();
    if (theme === "system") {
      _systemThemeListener = (e) => {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
        updateThemeMetaColor();
      };
      _darkMQ.addEventListener("change", _systemThemeListener);
    }
  }

  // ── Cite/note visibility (ADR-022) ──
  // The one place the setting takes effect: boot (app.js, before the first view draws), the switch below, and a value
  // synced from another device (sync/state-machine.js calls window.applyCiteShow). Views draw chips, ※ markers and
  // note anchors whatever the setting, so nothing is redrawn: the class shows or hides chips and ※ markers (CSS), and
  // the word note anchors already drawn turn into buttons or back into plain words (citations.js setNoteAnchorsActive).
  /** @param {boolean} on */
  function applyCiteShow(on) {
    document.body.classList.toggle("cites-shown", !!on);
    window.appCitations?.setNoteAnchorsActive(!!on);
  }

  // ── Launch screen ──
  // Gate fade-out on font readiness so a cold-cache visit does not show
  // system-font content briefly between fade-out end and swap arrival.
  // Bounded by timeout to avoid stalling on slow networks.
  const FONT_READY_TIMEOUT_MS = 1500;
  const _fontReadyPromise = (() => {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    const ready = document.fonts.ready.catch(() => {});
    const timeout = new Promise((resolve) => setTimeout(resolve, FONT_READY_TIMEOUT_MS));
    return Promise.race([ready, timeout]);
  })();

  let _launchScreenDismissed = false;

  function dismissLaunchScreen() {
    if (_launchScreenDismissed) return;
    _launchScreenDismissed = true;

    _fontReadyPromise.then(() => {
      const elNode = document.getElementById("launch-screen");
      if (!elNode) {
        document.documentElement.classList.add("launch-done");
        return;
      }

      // Decouple from heavy rendering task for smoother start
      requestAnimationFrame(() => {
        elNode.classList.add("fade-out");
        // Change background early to avoid flash but after animation has committed
        setTimeout(() => {
          document.documentElement.classList.add("launch-done");
        }, 50);
      });

      /** @param {AnimationEvent} e */
      const handler = (e) => {
        if (e.target !== elNode || (e.animationName !== "launch-screen-out")) return;
        elNode.removeEventListener("animationend", handler);
        elNode.remove();
      };
      elNode.addEventListener("animationend", handler);
    });
  }

  // ── OS detection (toggle look) ──
  // Drives the iOS (UISwitch) vs Material 3 vs desktop toggle styling. Kept
  // independent of install.js's detectPlatform(), which returns "installed"
  // when running standalone — here we always want the native OS look
  // regardless of install state. iPadOS 13+ masquerades as desktop Safari, so
  // fall back to the touch-points heuristic.
  /** @returns {"ios" | "android" | "desktop"} */
  function detectOS() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) return "ios";
    // A (pointer: fine) match alone is enough — touch-screen Windows laptops
    // report maxTouchPoints > 0 but still have a precise mouse pointer, so
    // gating on maxTouchPoints === 0 would mis-classify them as Android.
    const isDesktop = typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: fine)").matches;
    return isDesktop ? "desktop" : "android";
  }

  // ── Toggle switch component ──
  // Monotonic id source for caption ↔ aria-describedby wiring; survives
  // rebuild() since each rebuild discards the previous nodes.
  let _toggleIdSeq = 0;

  /**
   * Build a settings row: text label (+ optional dynamic caption) on the left,
   * an OS-styled toggle switch on the right. The entire row is the tap target —
   * the <label> wraps both text and switch, so a click anywhere toggles it. The
   * input carries role="switch"; an explicit aria-label keeps the accessible
   * name to the bare label (the caption is linked via aria-describedby instead).
   * @param {Object} opts
   * @param {string} opts.labelText
   * @param {boolean} opts.checked
   * @param {(on: boolean) => void} opts.onToggle
   * @param {(on: boolean) => string} [opts.getCaption] When given, a caption is rendered and updated on toggle
   * @returns {HTMLDivElement}
   */
  function makeToggleRow({ labelText, checked, onToggle, getCaption }) {
    const row = el("div", { className: "settings-row settings-toggle-row" });
    const label = el("label", { className: "settings-toggle-label" });

    const textWrap = el("div", { className: "settings-toggle-text" });
    textWrap.appendChild(el("span", { className: "settings-label" }, labelText));

    /** @type {string | null} */
    let captionId = null;
    /** @type {HTMLElement | null} */
    let captionEl = null;
    if (getCaption) {
      captionId = `settings-toggle-cap-${++_toggleIdSeq}`;
      captionEl = el("span", { className: "settings-toggle-caption", id: captionId }, getCaption(checked));
      textWrap.appendChild(captionEl);
    }
    label.appendChild(textWrap);

    const sw = el("span", { className: "switch" });
    /** @type {Record<string, string>} */
    const inputAttrs = { type: "checkbox", role: "switch", className: "switch-input", "aria-label": labelText };
    if (captionId) inputAttrs["aria-describedby"] = captionId;
    const input = el("input", inputAttrs);
    input.checked = !!checked;
    const track = el("span", { className: "switch-track", "aria-hidden": "true" });
    track.appendChild(el("span", { className: "switch-thumb" }));
    sw.appendChild(input);
    sw.appendChild(track);
    label.appendChild(sw);
    row.appendChild(label);

    input.addEventListener("change", () => {
      const on = input.checked;
      if (captionEl && getCaption) captionEl.textContent = getCaption(on);
      onToggle(on);
    });
    // role="switch" should toggle on Enter as well as Space (native checkbox
    // only handles Space). Mirror the Space behaviour for Enter.
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.checked = !input.checked;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    return row;
  }

  // ── Segment row component ──
  /**
   * Build a settings row: a label on the left, a .btn-group of values on the right.
   * Picking one updates state in place — no rebuild — so focus stays on the button
   * (same reason as makeToggleRow). The group takes the label as its name, since a
   * button alone says 「성서」 without saying what it sets.
   * @param {Object} opts
   * @param {string} opts.labelText
   * @param {string} opts.value
   * @param {[string, string][]} opts.options  [value, visible text]
   * @param {(value: string) => void} opts.onChange
   * @returns {HTMLDivElement}
   */
  function makeSegmentRow({ labelText, value, options, onChange }) {
    const row = el("div", { className: "settings-row" });
    const labelId = `settings-segment-${++_toggleIdSeq}`;
    row.appendChild(el("span", { className: "settings-label", id: labelId }, labelText));
    const group = el("div", { className: "btn-group", role: "group", "aria-labelledby": labelId });
    for (const [optValue, text] of options) {
      const btn = el("button", { className: "toolbar-btn", "aria-pressed": String(optValue === value) }, text);
      btn.addEventListener("click", () => {
        if (btn.getAttribute("aria-pressed") === "true") return;
        for (const other of group.children) other.setAttribute("aria-pressed", String(other === btn));
        onChange(optValue);
      });
      group.appendChild(btn);
    }
    row.appendChild(group);
    return row;
  }

  // ── Select row component ──
  /** @typedef {[string, string] | { label: string, options: [string, string][] }} SelectOption [value, visible text], or a labelled group of them */

  /**
   * Replace a <select>'s options. A group becomes an <optgroup>.
   * @param {HTMLSelectElement} select @param {SelectOption[]} options @param {string} value
   */
  function fillSelect(select, options, value) {
    clearNode(select);
    for (const opt of options) {
      if (Array.isArray(opt)) {
        select.appendChild(el("option", { value: opt[0] }, opt[1]));
      } else {
        const group = el("optgroup", { label: opt.label });
        for (const [optValue, text] of opt.options) group.appendChild(el("option", { value: optValue }, text));
        select.appendChild(group);
      }
    }
    select.value = value;
  }

  /**
   * Build a settings row: a label on the left, a native <select> on the right, so
   * each OS shows its own picker. Changing it updates state in place — no rebuild
   * — so focus stays on the control (same reason as makeToggleRow).
   * `labelExtra` (an ⓘ button) sits beside the label, outside the <label> element, so the
   * button's name does not become part of the select's name.
   * @param {Object} opts
   * @param {string} opts.labelText
   * @param {string} opts.value
   * @param {SelectOption[]} opts.options
   * @param {(value: string) => void} opts.onChange
   * @param {HTMLElement} [opts.labelExtra]
   * @returns {{ row: HTMLDivElement, select: HTMLSelectElement }}
   */
  function makeSelectRow({ labelText, value, options, onChange, labelExtra }) {
    const row = el("div", { className: "settings-row" });
    const id = `settings-select-${++_toggleIdSeq}`;
    if (labelExtra) {
      const labelWrap = el("span", { className: "settings-label" });
      labelWrap.appendChild(el("label", { for: id }, labelText));
      labelWrap.appendChild(labelExtra);
      row.appendChild(labelWrap);
    } else {
      row.appendChild(el("label", { className: "settings-label", for: id }, labelText));
    }
    const wrap = el("span", { className: "settings-select-wrap" });
    const select = /** @type {HTMLSelectElement} */ (el("select", { className: "settings-select", id }));
    fillSelect(select, options, value);
    select.addEventListener("change", () => onChange(select.value));
    wrap.appendChild(select);
    row.appendChild(wrap);
    return { row, select };
  }

  // ── ⓘ description (ADR-041 §7) ──
  /** @param {string} ariaLabel @returns {HTMLButtonElement} */
  function makeInfoButton(ariaLabel) {
    const svgNs = "http://www.w3.org/2000/svg";
    const btn = /** @type {HTMLButtonElement} */ (el("button", { className: "settings-drive-info-btn", type: "button", "aria-label": ariaLabel, "aria-expanded": "false" }));
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "drive-info-icon");
    const ring = document.createElementNS(svgNs, "circle"); ring.setAttribute("cx", "12"); ring.setAttribute("cy", "12"); ring.setAttribute("r", "10"); ring.setAttribute("fill", "none"); ring.setAttribute("stroke", "currentColor"); ring.setAttribute("stroke-width", "1.5");
    const dot = document.createElementNS(svgNs, "circle"); dot.setAttribute("cx", "12"); dot.setAttribute("cy", "8.5"); dot.setAttribute("r", "0.85"); dot.setAttribute("fill", "currentColor");
    const stem = document.createElementNS(svgNs, "line"); stem.setAttribute("x1", "12"); stem.setAttribute("y1", "11.5"); stem.setAttribute("x2", "12"); stem.setAttribute("y2", "16.5"); stem.setAttribute("stroke", "currentColor"); stem.setAttribute("stroke-width", "1.7"); stem.setAttribute("stroke-linecap", "round");
    svg.append(ring, dot, stem);
    btn.appendChild(svg);
    return btn;
  }

  /**
   * The description an ⓘ button opens below its row (ADR-041 §7). `head` takes the top line beside the close button
   * (백업 & 동기화 puts the account there, the text then goes below); without it the text sits there. `extra` follows.
   * The button's `aria-expanded` is the one source of truth: the buttons only set it, and an observer shows or hides
   * the row from it — so the app-wide Escape fallback that collapses expanded triggers (app.js) hides the row too.
   * Closing hands focus back to the ⓘ button.
   * @param {HTMLButtonElement} infoBtn @param {string} text
   * @param {{ head?: HTMLElement | null, extra?: HTMLElement[] }} [opts]
   * @returns {HTMLDivElement}
   */
  function makeInfoRow(infoBtn, text, { head = null, extra = [] } = {}) {
    const row = el("div", { className: "settings-drive-info-row", id: `settings-info-${++_toggleIdSeq}` });
    row.hidden = true;
    const desc = el("div", { className: "settings-drive-info-desc" }, text);
    const top = el("div", { className: "settings-drive-info-top" });
    top.appendChild(head ?? desc);
    // 두 설명을 함께 열어도 스크린 리더가 어느 것을 닫는지 알게 ⓘ 단추의 이름을 붙인다. 이름이 없는 단추면 「안내 닫기」다.
    const closeBtn = el("button", { className: "settings-drive-info-close", type: "button", "aria-label": `${infoBtn.getAttribute("aria-label") || "안내"} 닫기` }, "✕");
    top.appendChild(closeBtn);
    row.appendChild(top);
    if (head) row.appendChild(desc);
    for (const node of extra) row.appendChild(node);

    infoBtn.setAttribute("aria-controls", row.id);
    /** @param {boolean} open */
    const setOpen = (open) => infoBtn.setAttribute("aria-expanded", String(open));
    infoBtn.addEventListener("click", () => setOpen(infoBtn.getAttribute("aria-expanded") !== "true"));
    closeBtn.addEventListener("click", () => { setOpen(false); infoBtn.focus(); });
    new MutationObserver(() => { row.hidden = infoBtn.getAttribute("aria-expanded") !== "true"; })
      .observe(infoBtn, { attributes: true, attributeFilter: ["aria-expanded"] });
    return row;
  }

  // ── 소속교회 (ADR-041 §6, §7, §9) ──
  const PARISH_INFO = "교회 축성일과 교구설립일에 그날의 전례독서와 본기도를 보여줍니다.";
  const PARISH_LOAD_FAILED = "교회 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 설정을 다시 열어 주세요.";
  const PARISH_LIST_OUTDATED = "교회 목록을 아직 업데이트하지 못했습니다. 잠시 뒤 설정을 다시 열어 주세요.";
  // 응답 없이 멈춘 요청(연결은 됐지만 답이 오지 않는 망)을 이 시간 뒤에 받지 못한 것으로 본다. 서비스 워커는 캐시에
  // 없으면 시간 제한 없이 네트워크로 요청한다.
  const PARISH_LIST_TIMEOUT_MS = 10_000;

  /** @type {Promise<import("../types.js").ParishGroup[]> | null} */
  let _parishList = null;
  /**
   * 교회 목록을 본당 표에서 받는다. 받은 목록은 기억하고, 받지 못하면 다음에 설정을 열 때 다시 받는다. 옛 표(업데이트 전에
   * 받아 둔 사본이라 식별자가 없음)면 `outdated`가 참인 오류로 끝난다.
   * @returns {Promise<import("../types.js").ParishGroup[]>}
   */
  function loadParishList() {
    if (_parishList) return _parishList;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PARISH_LIST_TIMEOUT_MS);
    return (_parishList = fetch("/data/lectionary/local-observances.json", { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`local-observances.json: ${res.status}`);
        return res.json();
      })
      .then((table) => {
        const groups = parishGroups(table);
        if (!groups.length) throw Object.assign(new Error("local-observances.json: no church ids"), { outdated: true });
        return groups;
      })
      .finally(() => clearTimeout(timer))
      .catch((e) => { _parishList = null; throw e; }));
  }

  /**
   * 소속교회 행과 그 ⓘ 설명 행을 섹션에 넣는다(ADR-041 §9). 목록을 받는 동안 선택 상자는 「불러오는 중」 하나뿐이고 고를 수
   * 없다. 받지 못하면 「목록 없음」으로 고를 수 없게 두고 설명 행 아래에 안내를 보인다. 저장한 값이 목록에 없으면 「목록에
   * 없는 교회」 항목을 더해 그것을 고른 채 보인다. 「선택 안 함」을 고르면 저장한 값이 지워진다.
   * @param {HTMLElement} section
   */
  function appendParishRows(section) {
    const infoBtn = makeInfoButton("소속교회 안내");
    /** @type {HTMLOptionElement | null} */
    let missingOption = null;
    const { row, select } = makeSelectRow({
      labelText: "소속교회",
      value: "",
      options: [["", "불러오는 중"]],
      labelExtra: infoBtn,
      onChange: (churchId) => {
        saveParish(churchId);
        const name = select.selectedOptions[0]?.textContent ?? "";
        // 목록에 없던 값을 바꿨으면 그 항목은 더 고를 일이 없다
        if (missingOption && !missingOption.selected) { missingOption.remove(); missingOption = null; }
        announce(churchId ? `소속교회 ${name}` : "소속교회 선택 안 함");
      },
    });
    select.disabled = true;
    const infoRow = makeInfoRow(infoBtn, PARISH_INFO);
    section.appendChild(row);
    section.appendChild(infoRow);

    loadParishList().then((groups) => {
      if (!select.isConnected) return;   // the surface was rebuilt or closed meanwhile
      const saved = loadParish();
      const known = groups.some((g) => g.churches.some((c) => c.id === saved));
      fillSelect(select, [
        ["", "선택 안 함"],
        ...(saved && !known ? [/** @type {[string, string]} */ ([saved, "목록에 없는 교회"])] : []),
        ...groups.map((g) => ({ label: `${g.diocese}교구`, options: g.churches.map((c) => /** @type {[string, string]} */ ([c.id, c.name])) })),
      ], saved);
      if (saved && !known) missingOption = select.options[1];
      select.disabled = false;
    }, (/** @type {any} */ e) => {
      if (!select.isConnected) return;
      fillSelect(select, [["", "목록 없음"]], "");
      const note = el("p", { className: "settings-drive-note", id: `settings-note-${++_toggleIdSeq}` },
        e && e.outdated ? PARISH_LIST_OUTDATED : PARISH_LOAD_FAILED);
      select.setAttribute("aria-describedby", note.id);
      infoRow.after(note);
    });
  }

  // route() announces the view it draws, so a toggle's result goes after it, or that replaces the result. If the user
  // has moved on by then, the new view's title stays.
  /** @param {string} msg */
  async function redrawThenAnnounce(msg) {
    const drawing = route();
    const seq = window.routeSeq?.();
    await drawing;
    if (window.routeSeq?.() === seq) announce(msg);
  }

  /** @param {string} title @returns {HTMLElement} */
  function makeSection(title) {
    const section = el("section", { className: "settings-section" });
    section.appendChild(el("h2", { className: "settings-section-title" }, title));
    return section;
  }

  // ── Settings section builder (shared) ──
  // Builds the settings sections (시작, 성서, 전례독서, 모양, 시스템) and the about
  // lines into a target container. Reused by BOTH the desktop
  // popover (initSettings → rebuild) and the mobile full-screen view
  // (renderSettingsView), so section construction stays identical (ADR-029 / P2).
  //
  // The container is cleared first. `rerender` is called for in-place re-renders
  // (font size / theme / color changes rebuild the whole surface so disabled
  // states and pressed indicators update). `dismiss` is called by action buttons
  // (install guide / drive connect-disconnect) just before they open a modal or
  // start an OAuth flow, so the host surface (popover) can close itself — for
  // the full-screen view it is a no-op.
  /**
   * @param {HTMLElement} target
   * @param {{ rerender: () => void, dismiss: () => void }} cbs
   */
  function buildSettingsSections(target, { rerender, dismiss }) {
    clearNode(target);

    // Startup behavior: ON = resume last reading position, OFF = home. Built ahead
    // of the 시작 section: the start page below hides this row, which applies only
    // when the app opens on the book list. The saved value stays while hidden.
    const startupRow = makeToggleRow({
      labelText: "읽던 페이지에서 시작",
      checked: loadStartupBehavior() === "resume",
      onToggle: (on) => {
        saveStartupBehavior(on ? "resume" : "home");
        announce(on ? "마지막 읽던 페이지로 시작" : "첫 페이지로 시작");
      },
    });
    startupRow.hidden = START_PAGES[loadStartPage()].path !== "/";

    // ── Section: 시작 ──
    const startSection = makeSection("시작");
    startSection.appendChild(makeSegmentRow({
      labelText: "시작 화면",
      value: loadStartPage(),
      options: Object.entries(START_PAGES).map(([value, { label }]) => [value, label]),
      onChange: (value) => {
        const page = /** @type {StartPage} */ (value);
        saveStartPage(page);
        startupRow.hidden = START_PAGES[page].path !== "/";
        announce(`${START_PAGES[page].label}로 시작`);
      },
    }));
    target.appendChild(startSection);

    // ── Section: 성서 ──
    // Boolean settings rendered as OS-native toggle switches (see makeToggleRow).
    // Toggling updates state in place — no rebuild — so focus stays on the switch.
    const bibleSection = makeSection("성서");

    // Deuterocanon placement: ON = mixed into the OT (vulgate order),
    // OFF = separate section (canonical). Caption reflects the active state.
    const orderRow = makeToggleRow({
      labelText: "외경",
      checked: loadBookOrder() === "vulgate",
      getCaption: (on) => (on ? "구약에 포함" : "별도 섹션에 표시"),
      onToggle: (on) => {
        saveBookOrder(on ? "vulgate" : "canonical");
        const { view } = parsePath();
        const result = on ? "구약에 외경 포함" : "외경 분리";
        if (view === "chapter" || view === "prologue") announce(result);
        else redrawThenAnnounce(result);
      },
    });

    // Cite/note visibility (ADR-022): ON = show inline citations & notes.
    const citeRow = makeToggleRow({
      labelText: "인용·주석 표시",
      checked: loadCiteShow(),
      onToggle: (on) => {
        saveCiteShow(on);
        // 장 화면과 전례독서 모두 applyCiteShow가 표시를 바꾸므로 다시 그리지 않는다. 데스크톱 설정 팝오버도 열린 채 남는다.
        applyCiteShow(on);
        announce(on ? "인용 본문·주석 표시" : "인용 본문·주석 숨김");
      },
    });

    // Audiobook visibility — when off, audio bar is hidden and the FAB
    // falls back to its lower default position (CSS sibling rule keys off
    // #audio-bar[hidden]).
    const audioRow = makeToggleRow({
      labelText: "오디오북",
      checked: loadAudioShow(),
      onToggle: (on) => {
        saveAudioShow(on);
        if (typeof window.applyAudioShow === "function") window.applyAudioShow(on);
        announce(on ? "오디오북 켜기" : "오디오북 끄기");
      },
    });

    bibleSection.appendChild(startupRow);
    bibleSection.appendChild(orderRow);
    bibleSection.appendChild(citeRow);
    bibleSection.appendChild(audioRow);
    target.appendChild(bibleSection);

    // ── Section: 전례독서 ──
    const lectionarySection = makeSection("전례독서");
    lectionarySection.appendChild(makeToggleRow({
      labelText: "대체 독서 표시",
      checked: loadLectionaryAltShow(),
      onToggle: (on) => {
        saveLectionaryAltShow(on);
        const result = on ? "대체 독서 표시" : "대체 독서 숨김";
        // The desktop popover opens over the lectionary or the calendar's list, whose lines must follow. A
        // redraw closes the popover, as the 외경 toggle does over the book list.
        const here = parsePath();
        if (here.view === "lectionary" || (here.view === "calendar" && here.mode === "list")) redrawThenAnnounce(result);
        else announce(result);
      },
    }));
    appendParishRows(lectionarySection);
    target.appendChild(lectionarySection);

    // ── Section: 모양 ──
    const appearanceSection = makeSection("모양");

    // Font size
    const sizeRow = el("div", { className: "settings-row" });
    sizeRow.appendChild(el("span", { className: "settings-label" }, "글자 크기"));
    const size = loadFontSize();
    const idx = FONT_SIZES.indexOf(size);

    const btnMinus = el("button", { className: "toolbar-btn", "aria-label": "글자 작게" }, "A-");
    const btnReset = el("button", { className: "toolbar-btn", "aria-label": "글자 크기 초기화" }, "A");
    const btnPlus = el("button", { className: "toolbar-btn", "aria-label": "글자 크게" }, "A+");
    if (idx <= 0) btnMinus.disabled = true;
    if (idx >= FONT_SIZES.length - 1) btnPlus.disabled = true;
    if (size === DEFAULT_FONT_SIZE) btnReset.disabled = true;

    btnMinus.addEventListener("click", () => {
      const cur = FONT_SIZES.indexOf(loadFontSize());
      if (cur > 0) { const ns = FONT_SIZES[cur - 1]; saveFontSize(ns); applyFontSize(ns); rerender(); announce(`글자 크기 ${ns}px`); }
    });
    btnReset.addEventListener("click", () => {
      saveFontSize(DEFAULT_FONT_SIZE);
      applyFontSize(DEFAULT_FONT_SIZE);
      rerender();
      announce("글자 크기 초기화");
    });
    btnPlus.addEventListener("click", () => {
      const cur = FONT_SIZES.indexOf(loadFontSize());
      if (cur < FONT_SIZES.length - 1) { const ns = FONT_SIZES[cur + 1]; saveFontSize(ns); applyFontSize(ns); rerender(); announce(`글자 크기 ${ns}px`); }
    });

    const sizeGroup = el("div", { className: "btn-group" });
    sizeGroup.appendChild(btnMinus);
    sizeGroup.appendChild(btnReset);
    sizeGroup.appendChild(btnPlus);
    sizeRow.appendChild(sizeGroup);
    appearanceSection.appendChild(sizeRow);

    // Theme
    const themeRow = el("div", { className: "settings-row" });
    themeRow.appendChild(el("span", { className: "settings-label" }, "테마"));
    const current = loadTheme();
    const themeGroup = el("div", { className: "btn-group" });
    for (const [value, label] of [["light", "라이트"], ["system", "시스템"], ["dark", "다크"]]) {
      const tbtn = el("button", { className: "toolbar-btn", "aria-pressed": String(current === value) }, label);
      tbtn.addEventListener("click", () => {
        saveTheme(value);
        applyTheme(value);
        rerender();
        announce(label + " 테마");
      });
      themeGroup.appendChild(tbtn);
    }
    themeRow.appendChild(themeGroup);
    appearanceSection.appendChild(themeRow);

    // Color scheme
    const colorRow = el("div", { className: "settings-row" });
    colorRow.appendChild(el("span", { className: "settings-label" }, "색상"));
    const currentScheme = loadColorScheme();
    const swatches = el("div", { className: "color-swatches", role: "group", "aria-label": "색상 테마 선택" });
    for (const scheme of COLOR_SCHEMES) {
      const swatchBtn = el("button", {
        className: "color-swatch",
        "aria-label": scheme.name,
        "aria-pressed": String(currentScheme === scheme.id),
      });
      swatchBtn.style.setProperty("--swatch-color", scheme.swatch);
      swatchBtn.addEventListener("click", () => {
        saveColorScheme(scheme.id);
        applyColorScheme(scheme.id);
        rerender();
        announce(scheme.name + " 색상");
      });
      swatches.appendChild(swatchBtn);
    }
    colorRow.appendChild(swatches);
    appearanceSection.appendChild(colorRow);
    target.appendChild(appearanceSection);

    // ── Section: 시스템 (install, drive sync, update, cache) ──
    const showInstall = !!window.install && window.install.detectPlatform() !== "installed";
    const showCache = "caches" in window;
    const showDrive = !!window.driveSync;
    const showUpdateCheck = "serviceWorker" in navigator;
    if (showInstall || showCache || showDrive || showUpdateCheck) {
      const systemSection = makeSection("시스템");

      if (showInstall) {
        const installRow = el("div", { className: "settings-row" });
        installRow.appendChild(el("span", { className: "settings-label" }, "앱 설치"));
        const installBtn = el("button", { className: "settings-action-btn", "aria-label": "앱으로 설치 안내 열기" }, "안내");
        installBtn.addEventListener("click", () => {
          dismiss();
          openInstallModal();
        });
        installRow.appendChild(installBtn);
        systemSection.appendChild(installRow);
      }

      if (showDrive) {
        const driveRow = el("div", { className: "settings-row" });
        const driveLabelSpan = el("span", { className: "settings-label" });
        driveLabelSpan.appendChild(document.createTextNode("백업 & 동기화"));
        const driveAuthed = window.driveSync.isAuthenticated();

        // i icon — visible regardless of auth state so users can read the
        // description before connecting.
        const infoBtn = makeInfoButton("백업 및 동기화 안내");
        driveLabelSpan.appendChild(infoBtn);
        driveRow.appendChild(driveLabelSpan);

        // Action button — 해제 when connected, 연결 when not.
        if (driveAuthed) {
          const disconnectBtn = el("button", { className: "settings-action-btn", "aria-label": "Google Drive 연결 해제" }, "해제");
          disconnectBtn.addEventListener("click", () => { dismiss(); openDriveDisconnectModal(); });
          driveRow.appendChild(disconnectBtn);
        } else {
          const connectBtn = el("button", { className: "settings-action-btn", "aria-label": "Google Drive 연결" }, "연결");
          connectBtn.addEventListener("click", () => { dismiss(); window.driveSync.signIn(); });
          driveRow.appendChild(connectBtn);
        }
        systemSection.appendChild(driveRow);
        // An unfinished 「파일도 삭제」 (failed, or the page closed mid-way) — stays until a delete succeeds,
        // the user reconnects or keeps the file (the snackbar at the time was gone in seconds).
        if (!driveAuthed && window.driveSync.isDeletePending()) {
          systemSection.appendChild(el("p", { className: "settings-drive-note" },
            "Drive에 동기화 파일이 남아 있을 수 있습니다. 지우려면 다시 연결한 뒤 「해제」에서 「파일도 삭제」를 눌러 주세요."));
        }

        // Info row — description always present; email line + diag button only
        // when authenticated. Same part as 소속교회 (makeInfoRow): closing returns focus
        // to the ⓘ button, so the destructive 초기화 button below doesn't grab focus by
        // DOM order when the close button hides itself.
        /** @type {HTMLElement[]} */
        const extra = [];
        /** @type {HTMLDivElement | null} */
        let infoRow = null;
        if (driveAuthed) {
          const diagBtn = el("button", { className: "settings-drive-diag-btn", type: "button" }, "동기화 진단 정보 복사");
          diagBtn.addEventListener("click", async () => {
            const ok = await window.syncDebugLog?.copyToClipboard();
            if (ok) {
              diagBtn.textContent = "복사됨 ✓";
              setTimeout(() => { diagBtn.textContent = "동기화 진단 정보 복사"; }, 2000);
            } else {
              // Clipboard API unavailable — show text in a selectable textarea.
              const ta = el("textarea", { readOnly: true, rows: "6", style: "width:100%;font-size:0.7rem;margin-top:0.4rem;resize:none;" });
              ta.value = window.syncDebugLog?.dump() ?? "(로그 없음)";
              infoRow?.appendChild(ta);
              ta.select();
            }
          });
          extra.push(diagBtn);
        }
        infoRow = makeInfoRow(infoBtn, "북마크·설정·읽기 위치를 Google Drive에 백업하고, 여러 기기를 이용하는 경우 자동으로 동기화합니다.", {
          head: driveAuthed ? el("div", { className: "settings-drive-info-email" }, `계정: ${window.driveSync.getUserEmail() ?? "연결됨"}`) : null,
          extra,
        });
        systemSection.appendChild(infoRow);

        if (!driveAuthed) {
          const statusText = window.driveSync.getStatus();
          if (statusText === "ERROR") {
            systemSection.appendChild(el("p", { style: "font-size:0.78rem;color:var(--accent);padding:0 0.25rem 0.25rem;margin:0;" }, "세션 만료. 재연결해 주세요."));
          }
        }
      }

      if (showUpdateCheck) {
        // Manual SW update check (sits between 백업 & 동기화 and 캐시).
        // Reuses the existing showUpdateToast flow via window.checkForUpdates;
        // the button itself just renders transient status text.
        const updateRow = el("div", { className: "settings-row" });
        updateRow.appendChild(el("span", { className: "settings-label" }, "업데이트"));
        const updateBtn = el("button", {
          className: "settings-action-btn",
          type: "button",
          "aria-label": "업데이트 지금 확인",
        }, "지금 확인");
        let updateBusy = false;
        updateBtn.addEventListener("click", async () => {
          if (updateBusy) return;
          updateBusy = true;
          updateBtn.disabled = true;
          const restore = () => {
            setTimeout(() => {
              updateBusy = false;
              updateBtn.disabled = false;
              updateBtn.textContent = "지금 확인";
            }, 2500);
          };
          updateBtn.textContent = "확인 중…";
          try {
            const result = await (window.checkForUpdates?.() ?? Promise.resolve({ ok: false, reason: "not-ready" }));
            if (!result.ok) {
              updateBtn.textContent = "오류";
            } else if (result.status === "up-to-date") {
              updateBtn.textContent = "최신 버전";
            } else {
              // "waiting" or "installing" — toast is (or will be) on screen.
              updateBtn.textContent = "업데이트 발견";
            }
          } catch (_) {
            updateBtn.textContent = "오류";
          } finally {
            restore();
          }
        });
        updateRow.appendChild(updateBtn);
        systemSection.appendChild(updateRow);
      }

      if (showCache) {
        const cacheRow = el("div", { className: "settings-row" });
        cacheRow.appendChild(el("span", { className: "settings-label" }, "캐시"));
        const clearBtn = el("button", { className: "cache-clear-btn", "aria-label": "캐시 비우기" });
        const ns = "http://www.w3.org/2000/svg";
        const warnIcon = document.createElementNS(ns, "svg");
        warnIcon.setAttribute("viewBox", "0 0 20 20");
        warnIcon.setAttribute("aria-hidden", "true");
        warnIcon.setAttribute("class", "warn-icon");
        const tri = document.createElementNS(ns, "path");
        tri.setAttribute("d", "M10 2 L18.66 17 H1.34 Z");
        tri.setAttribute("fill", "none");
        tri.setAttribute("stroke", "currentColor");
        tri.setAttribute("stroke-width", "1.5");
        tri.setAttribute("stroke-linejoin", "round");
        const stem = document.createElementNS(ns, "line");
        stem.setAttribute("x1", "10"); stem.setAttribute("y1", "8");
        stem.setAttribute("x2", "10"); stem.setAttribute("y2", "12.5");
        stem.setAttribute("stroke", "currentColor");
        stem.setAttribute("stroke-width", "1.5");
        stem.setAttribute("stroke-linecap", "round");
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("cx", "10"); dot.setAttribute("cy", "14.5"); dot.setAttribute("r", "0.8");
        dot.setAttribute("fill", "currentColor");
        warnIcon.append(tri, stem, dot);
        clearBtn.appendChild(warnIcon);
        clearBtn.appendChild(document.createTextNode("초기화"));
        clearBtn.addEventListener("click", () => clearAllCaches());
        cacheRow.appendChild(clearBtn);
        systemSection.appendChild(cacheRow);
      }

      target.appendChild(systemSection);
    }

    // About
    const aboutRow = el("div", { className: "settings-about" });
    aboutRow.appendChild(document.createTextNode("공동번역성서 개정판 © 대한성서공회"));
    aboutRow.appendChild(el("br"));
    aboutRow.appendChild(document.createTextNode("서비스 © 대한성공회"));
    aboutRow.appendChild(el("br"));
    const privacyLink = el("a", {
      href: "/privacy.html",
      target: "_blank",
      rel: "noopener noreferrer",
      className: "settings-privacy-link",
    }, "개인정보처리방침");
    aboutRow.appendChild(privacyLink);
    aboutRow.appendChild(el("br"));
    const versionLabel = window.appVersion ? `공동번역성서 ${window.appVersion}` : "공동번역성서";
    const releaseHref = window.appVersion
      ? `https://github.com/anglican-kr/common-bible/releases/tag/${encodeURIComponent(window.appVersion)}`
      : "https://github.com/anglican-kr/common-bible/releases";
    const githubLink = el("a", { href: releaseHref, target: "_blank", rel: "noopener noreferrer" });
    const ns = "http://www.w3.org/2000/svg";
    const githubIcon = document.createElementNS(ns, "svg");
    githubIcon.setAttribute("viewBox", "0 0 16 16");
    githubIcon.setAttribute("width", "12");
    githubIcon.setAttribute("height", "12");
    githubIcon.setAttribute("aria-hidden", "true");
    githubIcon.setAttribute("class", "github-icon");
    const githubPath = document.createElementNS(ns, "path");
    githubPath.setAttribute("d", "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z");
    githubIcon.appendChild(githubPath);
    githubLink.appendChild(githubIcon);
    githubLink.appendChild(document.createTextNode(" " + versionLabel));
    aboutRow.appendChild(githubLink);
    target.appendChild(aboutRow);
  }

  // ── Mobile full-screen settings view (ADR-029 / P2) ──
  // Renders the same settings sections into #app for the mobile tab bar. Reuses
  // buildSettingsSections so desktop popover and this view stay identical. The
  // desktop popover is unaffected (it has its own host + open/close lifecycle).
  function renderSettingsView() {
    const $app = _$("app");
    const $title = _$("page-title");
    // Tag the document with the OS look so toggle styling can branch in CSS,
    // matching initSettings (which only runs once at boot).
    const os = detectOS();
    document.documentElement.classList.remove("os-ios", "os-android", "os-desktop");
    document.documentElement.classList.add(`os-${os}`);

    window.setTitle("설정");
    $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
    window.hideAudioBar();
    clearNode($app);

    const panel = el("div", { className: "settings-view", role: "region", "aria-label": "설정", tabindex: "-1" });
    $app.appendChild(panel);
    const rerender = () => buildSettingsSections(panel, { rerender, dismiss: () => {} });
    rerender();
    _viewRerender = () => {
      if (!panel.isConnected) { _viewRerender = null; return; }
      // Same as the popover's rebuild: focus on a removed control would fall to body — keep it in the view.
      const hadFocus = panel.contains(document.activeElement);
      rerender();
      if (hadFocus) panel.focus({ focusVisible: false });
    };
  }

  // The mobile settings view's re-render while it is on screen (renderSettingsView sets it) — auth changes
  // (sign-out · 「파일도 삭제」) redraw it like the popover; it used to keep showing 「해제」.
  /** @type {(() => void) | null} */
  let _viewRerender = null;

  // ── Settings popover ──
  function initSettings() {
    clearNode($settingsAnchor);

    // Tag the document with the OS look so toggle styling can branch in CSS.
    const os = detectOS();
    document.documentElement.classList.remove("os-ios", "os-android", "os-desktop");
    document.documentElement.classList.add(`os-${os}`);

    // Build a fresh gear-icon trigger button. The same popover is shared by
    // every trigger (desktop top-row + per-view mobile title-row button), so
    // we can mint as many of these as needed.
    function makeGearBtn() {
      const b = el("button", { className: "settings-btn", type: "button", "aria-label": "설정", "aria-expanded": "false" });
      const settingsSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      // Size comes from CSS (.settings-btn svg) in rem — see style.css header-icon rule.
      settingsSvg.setAttribute("viewBox", "0 0 24 24");
      settingsSvg.setAttribute("fill", "none");
      settingsSvg.setAttribute("stroke", "currentColor");
      settingsSvg.setAttribute("stroke-width", "2");
      settingsSvg.setAttribute("stroke-linecap", "round");
      settingsSvg.setAttribute("stroke-linejoin", "round");
      const gearCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      gearCircle.setAttribute("cx", "12");
      gearCircle.setAttribute("cy", "12");
      gearCircle.setAttribute("r", "3");
      const gearPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      gearPath.setAttribute("d", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z");
      settingsSvg.appendChild(gearCircle);
      settingsSvg.appendChild(gearPath);
      b.appendChild(settingsSvg);
      return b;
    }

    const wrapper = el("div", { className: "settings-wrapper" });
    const btn = makeGearBtn();
    const popover = el("div", { className: "settings-popover", tabindex: "-1" });
    popover.hidden = true;
    popover.addEventListener("click", (e) => e.stopPropagation());

    // Thin wrapper around the shared section builder (buildSettingsSections).
    // Re-render keeps focus on the popover container; action buttons dismiss
    // the popover via closeSettings before opening modals / OAuth.
    function rebuild() {
      buildSettingsSections(popover, { rerender: rebuild, dismiss: closeSettings });
      if (!popover.hidden) {
        // Move focus to the popover container so re-renders (e.g. drive sync
        // state updates) don't leave focus on a removed node. Pointer-driven
        // programmatic focus on a tabindex="-1" container does not match
        // :focus-visible, so no ring is drawn; Tab still leads into buttons.
        popover.focus();
      }
    }

    // The trigger that last opened the popover — drives positioning so the
    // popover anchors under whichever button (desktop top-row or mobile
    // title-row) was actually clicked.
    /** @type {HTMLElement} */
    let activeAnchor = btn;

    function positionPopover() {
      const rect = activeAnchor.getBoundingClientRect();
      popover.style.top = `${rect.bottom + 4}px`;
      popover.style.right = `${window.innerWidth - rect.right}px`;
    }

    // Overlay lifecycle (hidden toggle, focus-trap, aria-expanded on every gear,
    // outside-click, focus restore) is owned by the shared controller (ADR-032).
    // closeOnEsc stays off: app.js's central Escape coordinator routes Escape
    // here via window.closeSettings, keeping popover↔tab-search precedence in one
    // place.
    const settingsOverlay = createOverlay({
      panel: popover,
      closeOnOutside: true,
      outsideIgnore: ".settings-btn",
      ariaExpanded: ".settings-btn",
      returnFocus: true,
    });

    function closeSettings() { settingsOverlay.close(); }
    // Exposed so route() + app.js's Escape coordinator can dismiss it (ADR-029/032).
    window.closeSettings = closeSettings;

    // Wire a gear button to the shared popover. Reused for the desktop button
    // and every per-view mobile title-row button.
    /** @param {HTMLElement} triggerBtn */
    function wireTrigger(triggerBtn) {
      triggerBtn.addEventListener("click", (e) => {
        if (settingsOverlay.isOpen) { closeSettings(); return; }
        activeAnchor = triggerBtn;
        rebuild();
        positionPopover();
        settingsOverlay.open();
        // event.detail === 0 means activation via keyboard (Enter/Space).
        // Focus the first control so keyboard users land on a target. For
        // pointer activation, focus the popover container itself to avoid a
        // stray :focus-visible ring on the first button (iOS Safari).
        if (/** @type {MouseEvent} */ (e).detail === 0) {
          const first = /** @type {HTMLElement | null} */ (popover.querySelector('button, a[href], input, select'));
          if (first) first.focus();
        } else {
          popover.focus();
        }
      });
    }
    wireTrigger(btn);

    // Allow drive-sync.js to trigger a UI refresh when auth state changes.
    window.rebuildDriveSyncSection = () => {
      if (!popover.hidden) rebuild();
      _viewRerender?.();
    };

    // Per-view mobile trigger: the title row is re-rendered on every route, so
    // views.js mints a fresh one (CSS hides it on desktop, where the
    // top-row button is used instead). Shares this popover + open/close logic.
    window.buildSettingsTrigger = () => {
      const b = makeGearBtn();
      b.classList.add("title-settings-btn");
      wireTrigger(b);
      return b;
    };

    wrapper.appendChild(btn);
    document.body.appendChild(popover);
    $settingsAnchor.appendChild(wrapper);
  }

  // Per-name global for the mobile tab bar full-screen view (ADR-029 / P2),
  // mirroring renderBookmarksView so views.js can call it as a bare
  // global from route().
  window.renderSettingsView = renderSettingsView;

  return {
    initSettings,
    renderSettingsView,
    applyFontSize,
    applyTheme,
    applyColorScheme,
    applyCiteShow,
    dismissLaunchScreen,
  };
})();

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
