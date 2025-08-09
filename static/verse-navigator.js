/**
 * 공동번역성서 프로젝트 - 성경 구절 네비게이션 스크립트
 * 절 검색 및 하이라이트 기능 제공
 */

(function () {
  "use strict";

  // DOM 요소들
  let searchForm;
  let searchInput;
  let searchButton;

  // 현재 하이라이트된 요소
  let currentHighlight = null;

  // 전역 검색(Web Worker) 관련
  let searchWorker = null;
  let resultsPanel = null;
  let pagination = { page: 1, pageSize: 50, q: "" };
  let isWorkerReady = false;
  let pendingQueries = [];

  // 주입된 별칭/슬러그 데이터
  const injected = window.BIBLE_ALIAS || { aliasToAbbr: {}, abbrToSlug: {} };
  const bookNameToAbbr = injected.aliasToAbbr;
  const abbrToSlug = injected.abbrToSlug;

  /**
   * 초기화 함수
   */
  function init() {
    // DOM 요소 가져오기
    searchForm = document.getElementById("verse-search-form");
    searchInput = document.getElementById("verse-search");
    searchButton = document.getElementById("verse-search-btn");

    if (!searchForm || !searchInput || !searchButton) {
      console.warn("검색 UI 요소를 찾을 수 없습니다.");
      return;
    }

    // 이벤트 리스너 등록
    searchForm.addEventListener("submit", handleSearch);
    searchInput.addEventListener("keydown", handleKeyDown);

    // 전역 검색 초기화
    initializeGlobalSearch();

    // URL 해시가 있으면 해당 절로 이동
    if (window.location.hash) {
      highlightVerse(window.location.hash.substring(1));
    }

    // 오디오 플레이어 초기화 (엄격한 멈춤 상태 강조)
    initializeAudioPlayers();

    console.log("성경 구절 네비게이션 초기화 완료");
  }

  /**
   * 전역 검색 초기화: Web Worker 및 결과 패널 준비
   */
  function initializeGlobalSearch() {
    try {
      // verse-navigator.js의 로딩 경로 기반으로 Worker/Index URL 추정
      const currentScripts = document.getElementsByTagName("script");
      let baseUrl = null;
      for (const s of currentScripts) {
        const src = s.getAttribute("src") || "";
        if (src && /verse-navigator\.js(\?.*)?$/.test(src)) {
          // 절대 URL로 변환
          const u = new URL(src, window.location.href);
          baseUrl = u.origin + u.pathname.replace(/[^/]+$/, "");
          break;
        }
      }

      // 구성: 외부에서 주입한 설정 우선
      const injectedConfig = window.BIBLE_SEARCH_CONFIG || {};
      const workerUrl =
        injectedConfig.workerUrl ||
        (baseUrl ? baseUrl + "search-worker.js" : null);
      const indexUrl =
        injectedConfig.searchIndexUrl ||
        (baseUrl ? baseUrl + "search/search-index.json" : null);

      if (!workerUrl || !indexUrl) {
        // 설정을 찾지 못해도 기능 전체를 차단하지는 않음(로컬 DOM 검색만 동작)
        console.warn(
          "전역 검색 구성을 찾을 수 없어 로컬 검색만 지원됩니다. BIBLE_SEARCH_CONFIG.workerUrl/searchIndexUrl를 설정하세요."
        );
        return;
      }

      // 결과 패널 생성
      createResultsPanel();

      // Web Worker 생성 및 구성 전달
      searchWorker = new Worker(workerUrl);
      searchWorker.onmessage = (ev) => {
        const data = ev.data || {};
        if (data.type === "ready") {
          isWorkerReady = true;
          // 인덱스 URL 전달
          searchWorker.postMessage({ type: "config", indexUrl });
          // 대기 중이던 쿼리 처리
          if (pendingQueries.length > 0) {
            for (const q of pendingQueries.splice(0)) {
              searchWorker.postMessage({ type: "query", q, limit: 50 });
            }
          }
          return;
        }
        if (data.type === "results") {
          renderGlobalResults(
            data.q,
            data.results || [],
            data.page || 1,
            data.total || 0,
            data.pageSize || 50
          );
          return;
        }
        if (data.type === "error") {
          showMessage(`검색 오류: ${data.message || "알 수 없음"}`, "error");
          return;
        }
      };
      // Worker 기동 신호
      searchWorker.postMessage({ type: "init" });
    } catch (e) {
      console.warn("전역 검색 초기화 실패:", e);
    }
  }

  /**
   * 전역 검색 결과 패널 생성
   */
  function createResultsPanel() {
    if (resultsPanel) return;
    resultsPanel = document.createElement("div");
    resultsPanel.className = "search-results-panel";
    resultsPanel.setAttribute("role", "dialog");
    resultsPanel.setAttribute("aria-label", "전역 검색 결과");

    Object.assign(resultsPanel.style, {
      position: "fixed",
      top: "70px",
      right: "20px",
      width: "380px",
      maxHeight: "60vh",
      overflow: "auto",
      backgroundColor: "#ffffff",
      border: "1px solid #ddd",
      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
      borderRadius: "6px",
      zIndex: "1001",
      display: "none",
    });

    const header = document.createElement("div");
    header.textContent = "전역 검색 결과";
    Object.assign(header.style, {
      padding: "10px 12px",
      fontWeight: "bold",
      borderBottom: "1px solid #eee",
      background: "#f9fafb",
    });
    resultsPanel.appendChild(header);

    const list = document.createElement("div");
    list.className = "search-results-list";
    Object.assign(list.style, { padding: "8px 10px" });
    resultsPanel.appendChild(list);

    const footer = document.createElement("div");
    Object.assign(footer.style, {
      padding: "8px 10px",
      borderTop: "1px solid #eee",
      textAlign: "right",
      background: "#f9fafb",
    });
    const navLeft = document.createElement("button");
    navLeft.type = "button";
    navLeft.textContent = "이전";
    Object.assign(navLeft.style, {
      padding: "6px 10px",
      marginRight: "8px",
      border: "1px solid #ccc",
      background: "#fff",
      borderRadius: "4px",
      cursor: "pointer",
    });
    navLeft.addEventListener("click", () => navigatePage(-1));

    const pageInfo = document.createElement("span");
    pageInfo.className = "search-page-info";
    Object.assign(pageInfo.style, { marginRight: "8px", color: "#555" });
    pageInfo.textContent = "";

    const navRight = document.createElement("button");
    navRight.type = "button";
    navRight.textContent = "다음";
    Object.assign(navRight.style, {
      padding: "6px 10px",
      marginRight: "8px",
      border: "1px solid #ccc",
      background: "#fff",
      borderRadius: "4px",
      cursor: "pointer",
    });
    navRight.addEventListener("click", () => navigatePage(1));

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "닫기";
    Object.assign(closeBtn.style, {
      padding: "6px 10px",
      border: "1px solid #ccc",
      background: "#fff",
      borderRadius: "4px",
      cursor: "pointer",
    });
    closeBtn.addEventListener("click", () => {
      resultsPanel.style.display = "none";
    });
    footer.appendChild(navLeft);
    footer.appendChild(pageInfo);
    footer.appendChild(navRight);
    footer.appendChild(closeBtn);
    resultsPanel.appendChild(footer);

    document.body.appendChild(resultsPanel);
  }

  /**
   * 오디오 플레이어 초기화: 초기에 항상 멈춤 상태로 고정
   */
  function initializeAudioPlayers() {
    const audios = document.querySelectorAll("audio.bible-audio");
    for (const audio of audios) {
      try {
        audio.autoplay = false;
      } catch (_) {}
      try {
        audio.preload = "metadata";
      } catch (_) {}

      const reset = () => {
        try {
          audio.pause();
        } catch (_) {}
        try {
          audio.currentTime = 0;
        } catch (_) {}
      };

      // 메타데이터/데이터 로드 시점에 항상 리셋
      audio.addEventListener("loadedmetadata", reset, { once: true });
      audio.addEventListener("loadeddata", reset, { once: true });
      // 혹시나 이미 로드된 경우도 처리
      if (audio.readyState >= 1) {
        reset();
      }
    }
  }

  /**
   * 검색 폼 제출 처리
   */
  function handleSearch(event) {
    event.preventDefault();

    const query = searchInput.value.trim();
    if (!query) {
      return;
    }

    // 절 참조 형식인지 확인 (예: "창세 1:1", "창세기 1:1")
    const verseRefMatch = query.match(/^(.+?)\s+(\d+):(\d+)$/);
    if (verseRefMatch) {
      searchByReference(verseRefMatch[1], verseRefMatch[2], verseRefMatch[3]);
    } else {
      // 텍스트 검색: 1) 현재 문서 내 검색 2) 전역 검색
      searchByText(query);
      globalSearch(query);
    }
  }

  /**
   * 키보드 입력 처리
   */
  function handleKeyDown(event) {
    // ESC 키로 하이라이트 제거
    if (event.key === "Escape") {
      clearHighlight();
      searchInput.blur();
    }
  }

  /**
   * 절 참조로 검색
   */
  function searchByReference(bookName, chapter, verse) {
    // 현재 페이지의 책 이름과 장 번호 추출
    const articleId = document.querySelector("article").id;
    const currentMatch = articleId.match(/^(.+?)-(\d+)$/);

    if (!currentMatch) {
      showMessage("현재 페이지 정보를 찾을 수 없습니다.", "error");
      return;
    }

    const currentBookAbbr = currentMatch[1];
    const currentChapter = currentMatch[2];

    const targetBookAbbr = bookNameToAbbr[bookName] || bookName;

    // 같은 책·장 → 현재 페이지에서 이동
    if (targetBookAbbr === currentBookAbbr && chapter === currentChapter) {
      const verseId = `${targetBookAbbr}-${chapter}-${verse}`;
      const found = highlightVerse(verseId);

      if (found) {
        showMessage(
          `${bookName} ${chapter}:${verse}로 이동했습니다.`,
          "success"
        );
        // URL 해시 업데이트
        history.replaceState(null, null, `#${verseId}`);
      } else {
        showMessage(
          `${bookName} ${chapter}:${verse}를 찾을 수 없습니다.`,
          "error"
        );
      }
    } else {
      // 다른 책/장 → 파일로 리다이렉트
      const slug = abbrToSlug[targetBookAbbr];
      if (!slug) {
        showMessage("해당 책을 찾을 수 없습니다.", "error");
        return;
      }
      const basePath = window.location.pathname.replace(/[^/]+$/, "");
      const filename = `${slug}-${chapter}.html#${targetBookAbbr}-${chapter}-${verse}`;
      window.location.href = basePath + filename;
    }
  }

  /**
   * 텍스트로 검색
   */
  function searchByText(query) {
    const verses = document.querySelectorAll('span[id*="-"]');
    let found = false;

    // 이전 하이라이트 제거
    clearTextHighlight();

    for (const verse of verses) {
      const text = verse.textContent || verse.innerText;
      if (text.toLowerCase().includes(query.toLowerCase())) {
        // 텍스트 하이라이트
        highlightTextInElement(verse, query);

        if (!found) {
          // 첫 번째 결과로 스크롤
          verse.scrollIntoView({ behavior: "smooth", block: "center" });
          found = true;
        }
      }
    }

    if (found) {
      showMessage(`"${query}" 검색 완료`, "success");
    } else {
      showMessage(`"${query}"를 찾을 수 없습니다.`, "error");
    }
  }

  /**
   * 절 하이라이트
   */
  function highlightVerse(verseId) {
    const verseElement = document.getElementById(verseId);

    if (!verseElement) {
      return false;
    }

    // 이전 하이라이트 제거
    clearHighlight();

    // 새 하이라이트 적용
    verseElement.classList.add("verse-highlight");
    currentHighlight = verseElement;

    // 해당 요소로 스크롤
    verseElement.scrollIntoView({ behavior: "smooth", block: "center" });

    // 포커스 설정 (접근성)
    verseElement.setAttribute("tabindex", "-1");
    verseElement.focus();

    return true;
  }

  /**
   * 요소 내 텍스트 하이라이트
   */
  function highlightTextInElement(element, query) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    const textNodes = [];
    let node;

    while ((node = walker.nextNode())) {
      if (
        node.parentElement.classList.contains("verse-number") ||
        node.parentElement.classList.contains("paragraph-marker")
      ) {
        continue; // 절 번호나 단락 마커는 제외
      }
      textNodes.push(node);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      const regex = new RegExp(`(${escapeRegExp(query)})`, "gi");

      if (regex.test(text)) {
        const highlightedText = text.replace(
          regex,
          '<span class="text-highlight">$1</span>'
        );
        const wrapper = document.createElement("div");
        wrapper.innerHTML = highlightedText;

        while (wrapper.firstChild) {
          textNode.parentNode.insertBefore(wrapper.firstChild, textNode);
        }
        textNode.remove();
      }
    }
  }

  /**
   * 정규식 이스케이프
   */
  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 하이라이트 제거
   */
  function clearHighlight() {
    if (currentHighlight) {
      currentHighlight.classList.remove("verse-highlight");
      currentHighlight.removeAttribute("tabindex");
      currentHighlight = null;
    }

    clearTextHighlight();
  }

  /**
   * 텍스트 하이라이트 제거
   */
  function clearTextHighlight() {
    const highlighted = document.querySelectorAll(".text-highlight");
    for (const element of highlighted) {
      const parent = element.parentNode;
      parent.replaceChild(
        document.createTextNode(element.textContent),
        element
      );
      parent.normalize();
    }
  }

  /**
   * 전역 검색 실행 (Web Worker)
   */
  function globalSearch(query) {
    if (!searchWorker) {
      // 초기화 중이거나 미구성 상태
      showGlobalResultsMessage("전역 검색을 사용할 수 없습니다.");
      return;
    }
    createResultsPanel();
    // 패널 표시 및 로딩 메시지
    resultsPanel.style.display = "block";
    renderGlobalResults(query, null); // 로딩 상태

    const trimmed = query.trim();
    if (!trimmed) return;

    pagination.q = trimmed;
    pagination.page = 1;

    if (!isWorkerReady) {
      pendingQueries.push(trimmed);
      return;
    }
    try {
      searchWorker.postMessage({
        type: "query",
        q: trimmed,
        limit: pagination.pageSize,
        page: pagination.page,
      });
    } catch (e) {
      showGlobalResultsMessage("검색 요청 중 오류가 발생했습니다.");
    }
  }

  function navigatePage(delta) {
    if (!searchWorker || !isWorkerReady || !pagination.q) return;
    const next = Math.max(1, pagination.page + delta);
    pagination.page = next;
    try {
      searchWorker.postMessage({
        type: "query",
        q: pagination.q,
        limit: pagination.pageSize,
        page: pagination.page,
      });
    } catch {}
  }

  function showGlobalResultsMessage(message) {
    createResultsPanel();
    const list = resultsPanel.querySelector(".search-results-list");
    if (!list) return;
    list.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = message;
    Object.assign(p.style, { color: "#666", margin: "8px 4px" });
    list.appendChild(p);
    resultsPanel.style.display = "block";
  }

  function renderGlobalResults(
    query,
    results,
    page = 1,
    total = 0,
    pageSize = 50
  ) {
    createResultsPanel();
    const list = resultsPanel.querySelector(".search-results-list");
    if (!list) return;
    list.innerHTML = "";

    if (results === null) {
      const loading = document.createElement("p");
      loading.textContent = `"${query}" 검색 중…`;
      Object.assign(loading.style, { color: "#666", margin: "8px 4px" });
      list.appendChild(loading);
      return;
    }

    if (!Array.isArray(results) || results.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = `"${query}" 결과가 없습니다.`;
      Object.assign(empty.style, { color: "#666", margin: "8px 4px" });
      list.appendChild(empty);
      updatePageInfo(0, 0, 0);
      return;
    }

    for (const item of results) {
      const a = document.createElement("a");
      a.href = item.h || item.href;
      a.title = item.i || item.id;
      a.innerHTML = highlightSnippet(item.t || item.text || "", query);
      Object.assign(a.style, {
        display: "block",
        padding: "8px 6px",
        borderRadius: "4px",
        color: "#111",
        textDecoration: "none",
      });
      a.addEventListener("mouseenter", () => {
        a.style.background = "#f3f4f6";
      });
      a.addEventListener("mouseleave", () => {
        a.style.background = "transparent";
      });
      list.appendChild(a);
    }

    updatePageInfo(page, pageSize, total);
  }

  function updatePageInfo(page, pageSize, total) {
    const pageInfo =
      resultsPanel && resultsPanel.querySelector(".search-page-info");
    if (!pageInfo) return;
    const totalPages =
      pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    pageInfo.textContent =
      total > 0 ? `${page}/${totalPages} (총 ${total}건)` : "";
    pagination.page = page || 1;
    pagination.pageSize = pageSize || 50;
  }

  function highlightSnippet(text, query) {
    const q = escapeRegExp(query);
    const regex = new RegExp(`(${q})`, "gi");
    // 주변 40자 스니펫
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + query.length + 40);
      const slice =
        (start > 0 ? "…" : "") +
        text.slice(start, end) +
        (end < text.length ? "…" : "");
      return slice.replace(regex, '<span class="text-highlight">$1</span>');
    }
    return text.replace(regex, '<span class="text-highlight">$1</span>');
  }

  /**
   * 메시지 표시
   */
  function showMessage(message, type = "info") {
    // 기존 메시지 제거
    const existingMessage = document.querySelector(".search-message");
    if (existingMessage) {
      existingMessage.remove();
    }

    // 새 메시지 생성
    const messageElement = document.createElement("div");
    messageElement.className = `search-message search-message-${type}`;
    messageElement.textContent = message;
    messageElement.setAttribute("role", "status");
    messageElement.setAttribute("aria-live", "polite");

    // 스타일 적용
    Object.assign(messageElement.style, {
      position: "fixed",
      top: "20px",
      right: "20px",
      padding: "10px 15px",
      borderRadius: "4px",
      color: "white",
      fontWeight: "bold",
      zIndex: "1000",
      opacity: "0",
      transition: "opacity 0.3s ease",
    });

    // 타입별 색상
    switch (type) {
      case "success":
        messageElement.style.backgroundColor = "#28a745";
        break;
      case "error":
        messageElement.style.backgroundColor = "#dc3545";
        break;
      case "info":
      default:
        messageElement.style.backgroundColor = "#17a2b8";
        break;
    }

    document.body.appendChild(messageElement);

    // 애니메이션
    setTimeout(() => {
      messageElement.style.opacity = "1";
    }, 10);

    // 3초 후 제거
    setTimeout(() => {
      messageElement.style.opacity = "0";
      setTimeout(() => {
        if (messageElement.parentNode) {
          messageElement.parentNode.removeChild(messageElement);
        }
      }, 300);
    }, 3000);
  }

  // DOM 로드 후 초기화
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // 전역 접근을 위한 API 노출
  window.BibleNavigator = {
    highlightVerse: highlightVerse,
    clearHighlight: clearHighlight,
    searchByText: searchByText,
  };
})();
