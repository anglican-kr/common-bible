"use strict";
// @ts-check

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

window.appSettings = (() => {
  /** @typedef {import("../types").ColorSchemeEntry} ColorSchemeEntry */

  const { _$, el, clearNode, trapFocus } = window.appHelpers;
  const {
    FONT_SIZES, DEFAULT_FONT_SIZE, COLOR_SCHEMES,
    loadFontSize, saveFontSize,
    loadStartupBehavior, saveStartupBehavior,
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
    const color = isDark ? "#1a1a2e" : "#faf8f5";
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
  /** @param {boolean} on */
  function applyCiteShow(on) {
    document.body.classList.toggle("cites-shown", !!on);
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
  // Drives the iOS (UISwitch) vs Material 3 toggle styling. Kept independent
  // of install.js's detectPlatform(), which returns "installed" when running
  // standalone — here we always want the native OS look regardless of install
  // state. iPadOS 13+ masquerades as desktop Safari, so fall back to the
  // touch-points heuristic.
  /** @returns {"ios" | "android"} */
  function detectOS() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return isIOS ? "ios" : "android";
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
   * @param {(on: boolean) => string} [opts.getCaption] — when given, a caption is rendered and updated on toggle
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

  // ── Settings popover ──
  function initSettings() {
    clearNode($settingsAnchor);

    // Tag the document with the OS look so toggle styling can branch in CSS.
    const os = detectOS();
    document.documentElement.classList.remove("os-ios", "os-android");
    document.documentElement.classList.add(os === "ios" ? "os-ios" : "os-android");

    // Build a fresh gear-icon trigger button. The same popover is shared by
    // every trigger (desktop top-row + per-view mobile title-row button), so
    // we can mint as many of these as needed.
    function makeGearBtn() {
      const b = el("button", { className: "settings-btn", type: "button", "aria-label": "설정", "aria-expanded": "false" });
      const settingsSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      settingsSvg.setAttribute("width", "18");
      settingsSvg.setAttribute("height", "18");
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

    function rebuild() {
      clearNode(popover);

      // ── Section 1: Reading-experience toggles ──
      // Four boolean settings rendered as OS-native toggle switches (see
      // makeToggleRow). Toggling updates state in place — no popover rebuild —
      // so focus stays on the switch and the segmented re-render is avoided.
      const section1 = el("section", { className: "settings-section" });

      // Startup behavior: ON = resume last reading position, OFF = home.
      const startupRow = makeToggleRow({
        labelText: "읽던 페이지에서 시작",
        checked: loadStartupBehavior() === "resume",
        onToggle: (on) => {
          saveStartupBehavior(on ? "resume" : "home");
          announce(on ? "마지막 읽던 페이지로 시작" : "첫 페이지로 시작");
        },
      });

      // Deuterocanon placement: ON = mixed into the OT (vulgate order),
      // OFF = separate section (canonical). Caption reflects the active state.
      const orderRow = makeToggleRow({
        labelText: "제2경전",
        checked: loadBookOrder() === "vulgate",
        getCaption: (on) => (on ? "구약에 포함" : "별도 섹션에 표시"),
        onToggle: (on) => {
          saveBookOrder(on ? "vulgate" : "canonical");
          const { view } = parsePath();
          if (view !== "chapter" && view !== "prologue") route();
          announce(on ? "구약에 외경 포함" : "외경 분리");
        },
      });

      // Cite/note visibility (ADR-022): ON = show inline citations & notes.
      const citeRow = makeToggleRow({
        labelText: "인용·주석 표시",
        checked: loadCiteShow(),
        onToggle: (on) => {
          saveCiteShow(on);
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

      section1.appendChild(startupRow);
      section1.appendChild(orderRow);
      section1.appendChild(citeRow);
      section1.appendChild(audioRow);
      popover.appendChild(section1);

      // ── Section 2: Typography & appearance ──
      const section2 = el("section", { className: "settings-section" });

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
        if (cur > 0) { const ns = FONT_SIZES[cur - 1]; saveFontSize(ns); applyFontSize(ns); rebuild(); announce(`글자 크기 ${ns}px`); }
      });
      btnReset.addEventListener("click", () => {
        saveFontSize(DEFAULT_FONT_SIZE);
        applyFontSize(DEFAULT_FONT_SIZE);
        rebuild();
        announce("글자 크기 초기화");
      });
      btnPlus.addEventListener("click", () => {
        const cur = FONT_SIZES.indexOf(loadFontSize());
        if (cur < FONT_SIZES.length - 1) { const ns = FONT_SIZES[cur + 1]; saveFontSize(ns); applyFontSize(ns); rebuild(); announce(`글자 크기 ${ns}px`); }
      });

      const sizeGroup = el("div", { className: "btn-group" });
      sizeGroup.appendChild(btnMinus);
      sizeGroup.appendChild(btnReset);
      sizeGroup.appendChild(btnPlus);
      sizeRow.appendChild(sizeGroup);
      section2.appendChild(sizeRow);

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
          rebuild();
          announce(label + " 테마");
        });
        themeGroup.appendChild(tbtn);
      }
      themeRow.appendChild(themeGroup);
      section2.appendChild(themeRow);

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
          rebuild();
          announce(scheme.name + " 색상");
        });
        swatches.appendChild(swatchBtn);
      }
      colorRow.appendChild(swatches);
      section2.appendChild(colorRow);
      popover.appendChild(section2);

      // ── Section 3: App lifecycle (install, drive sync, cache) ──
      const showInstall = !!window.install && window.install.detectPlatform() !== "installed";
      const showCache = "caches" in window;
      const showDrive = !!window.driveSync;
      const showUpdateCheck = "serviceWorker" in navigator;
      if (showInstall || showCache || showDrive || showUpdateCheck) {
        const section3 = el("section", { className: "settings-section" });

        if (showInstall) {
          const installRow = el("div", { className: "settings-row" });
          installRow.appendChild(el("span", { className: "settings-label" }, "앱 설치"));
          const installBtn = el("button", { className: "settings-action-btn", "aria-label": "앱으로 설치 안내 열기" }, "안내");
          installBtn.addEventListener("click", () => {
            popover.hidden = true;
            btn.setAttribute("aria-expanded", "false");
            if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
            openInstallModal();
          });
          installRow.appendChild(installBtn);
          section3.appendChild(installRow);
        }

        if (showDrive) {
          const driveRow = el("div", { className: "settings-row" });
          const driveLabelSpan = el("span", { className: "settings-label" });
          driveLabelSpan.appendChild(document.createTextNode("백업 & 동기화"));
          const driveAuthed = window.driveSync.isAuthenticated();

          // i icon — visible regardless of auth state so users can read the
          // description before connecting.
          const svgNs = "http://www.w3.org/2000/svg";
          const infoBtn = el("button", { className: "settings-drive-info-btn", type: "button", "aria-label": "백업 및 동기화 안내", "aria-expanded": "false" });
          const infoSvg = document.createElementNS(svgNs, "svg");
          infoSvg.setAttribute("viewBox", "0 0 24 24"); infoSvg.setAttribute("aria-hidden", "true"); infoSvg.setAttribute("class", "drive-info-icon");
          const ic = document.createElementNS(svgNs, "circle"); ic.setAttribute("cx", "12"); ic.setAttribute("cy", "12"); ic.setAttribute("r", "10"); ic.setAttribute("fill", "none"); ic.setAttribute("stroke", "currentColor"); ic.setAttribute("stroke-width", "1.5");
          const idot = document.createElementNS(svgNs, "circle"); idot.setAttribute("cx", "12"); idot.setAttribute("cy", "8.5"); idot.setAttribute("r", "0.85"); idot.setAttribute("fill", "currentColor");
          const istem = document.createElementNS(svgNs, "line"); istem.setAttribute("x1", "12"); istem.setAttribute("y1", "11.5"); istem.setAttribute("x2", "12"); istem.setAttribute("y2", "16.5"); istem.setAttribute("stroke", "currentColor"); istem.setAttribute("stroke-width", "1.7"); istem.setAttribute("stroke-linecap", "round");
          infoSvg.append(ic, idot, istem);
          infoBtn.appendChild(infoSvg);
          driveLabelSpan.appendChild(infoBtn);
          driveRow.appendChild(driveLabelSpan);

          // Action button — 해제 when connected, 연결 when not.
          if (driveAuthed) {
            const disconnectBtn = el("button", { className: "settings-action-btn", "aria-label": "Google Drive 연결 해제" }, "해제");
            disconnectBtn.addEventListener("click", () => { popover.hidden = true; btn.setAttribute("aria-expanded", "false"); if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; } openDriveDisconnectModal(); });
            driveRow.appendChild(disconnectBtn);
          } else {
            const connectBtn = el("button", { className: "settings-action-btn", "aria-label": "Google Drive 연결" }, "연결");
            connectBtn.addEventListener("click", () => { popover.hidden = true; btn.setAttribute("aria-expanded", "false"); if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; } window.driveSync.signIn(); });
            driveRow.appendChild(connectBtn);
          }
          section3.appendChild(driveRow);

          // Info row — description always present; email line + diag button only
          // when authenticated.
          const infoRow = el("div", { className: "settings-drive-info-row" });
          infoRow.hidden = true;
          const infoTop = el("div", { className: "settings-drive-info-top" });
          if (driveAuthed) {
            const email = window.driveSync.getUserEmail();
            infoTop.appendChild(el("div", { className: "settings-drive-info-email" }, `계정: ${email ?? "연결됨"}`));
          }
          const closeBtn = el("button", { className: "settings-drive-info-close", type: "button", "aria-label": "닫기" }, "✕");
          infoTop.appendChild(closeBtn);
          infoRow.appendChild(infoTop);
          infoRow.appendChild(el("div", { className: "settings-drive-info-desc" }, "북마크·설정·읽기 위치를 Google Drive에 백업하고, 여러 기기를 이용하는 경우 자동으로 동기화합니다."));
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
                infoRow.appendChild(ta);
                ta.select();
              }
            });
            infoRow.appendChild(diagBtn);
          }
          section3.appendChild(infoRow);

          const toggleInfo = () => { const open = infoRow.hidden; infoRow.hidden = !open; infoBtn.setAttribute("aria-expanded", String(open)); };
          infoBtn.addEventListener("click", toggleInfo);
          // Return focus to the trigger so the destructive 초기화 button below
          // doesn't grab focus by DOM order when the close button hides itself.
          closeBtn.addEventListener("click", () => { infoRow.hidden = true; infoBtn.setAttribute("aria-expanded", "false"); infoBtn.focus(); });

          if (!driveAuthed) {
            const statusText = window.driveSync.getStatus();
            if (statusText === "ERROR") {
              section3.appendChild(el("p", { style: "font-size:0.78rem;color:var(--accent);padding:0 0.25rem 0.25rem;margin:0;" }, "세션 만료. 재연결해 주세요."));
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
          section3.appendChild(updateRow);
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
          section3.appendChild(cacheRow);
        }

        popover.appendChild(section3);
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
      popover.appendChild(aboutRow);

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

    /** @type {(() => void) | null} */
    let cleanupTrap = null;

    function closeSettings() {
      popover.hidden = true;
      document.querySelectorAll(".settings-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }

    // Wire a gear button to the shared popover. Reused for the desktop button
    // and every per-view mobile title-row button.
    /** @param {HTMLElement} triggerBtn */
    function wireTrigger(triggerBtn) {
      triggerBtn.addEventListener("click", (e) => {
        if (popover.hidden) {
          activeAnchor = triggerBtn;
          rebuild();
          positionPopover();
          popover.hidden = false;
          triggerBtn.setAttribute("aria-expanded", "true");
          cleanupTrap = trapFocus(popover);
          // event.detail === 0 means activation via keyboard (Enter/Space).
          // Focus the first control so keyboard users land on a target. For
          // pointer activation, focus the popover container itself to avoid a
          // stray :focus-visible ring on the first button (iOS Safari).
          if (/** @type {MouseEvent} */ (e).detail === 0) {
            const first = /** @type {HTMLElement | null} */ (popover.querySelector('button, a[href], input'));
            if (first) first.focus();
          } else {
            popover.focus();
          }
        } else {
          closeSettings();
        }
      });
    }
    wireTrigger(btn);

    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!popover.hidden && t instanceof Node && !popover.contains(t) &&
          !(t instanceof Element && t.closest(".settings-btn"))) {
        closeSettings();
      }
    });

    // Allow drive-sync.js to trigger a UI refresh when auth state changes.
    window.rebuildDriveSyncSection = () => { if (!popover.hidden) rebuild(); };

    // Per-view mobile trigger: the title row is re-rendered on every route, so
    // views-routing.js mints a fresh one (CSS hides it on desktop, where the
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

  return {
    initSettings,
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
