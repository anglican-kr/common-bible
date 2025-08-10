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
  let breadcrumbNav;

  // 현재 하이라이트된 요소
  let currentHighlight = null;

  // 전역 검색(Web Worker) 관련
  let searchWorker = null;
  let resultsPanel = null;
  // 모바일 바텀시트 결과 렌더 타깃
  let mobileResultsContainer = null;
  let useMobileResults = false;
  let mobileResultsBody = null; // 높이 측정용
  let mobilePagesContainer = null; // 모바일 페이지 번호 컨테이너
  let lastTotalResults = 0; // 총 결과 수 저장
  let resultsToggleBtn = null;
  let pagination = { page: 1, pageSize: 50, q: "" };
  let isWorkerReady = false;
  let pendingQueries = [];
  // 로컬/전역 검색 메시지 조율용 상태
  let suppressLocalToast = false;
  let lastLocalFound = false;
  let lastQueryText = "";
  let pendingRefCheck = null;
  const SEARCH_STATE_KEY = "BIBLE_SEARCH_STATE";
  const PANEL_STATE_KEY = "BIBLE_SEARCH_PANEL";
  let isCollapsed = false;
  const MOBILE_BREAKPOINT = 768; // px
  let autoManagedCollapse = false;

  function clearSavedSearchState() {
    try {
      sessionStorage.removeItem(SEARCH_STATE_KEY);
    } catch (error) {
      // sessionStorage 접근 실패 시 무시 (프라이빗 모드 등)
    }
  }

  function resetResultsPanel() {
    if (!resultsPanel) return;
    const list = resultsPanel.querySelector(".search-results-list");
    if (list) list.innerHTML = "";
    hideResultsPanel();
  }

  function resetSearchUI() {
    clearSavedSearchState();
    resetResultsPanel();
    if (searchInput) searchInput.value = "";
  }

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

    breadcrumbNav = document.getElementById("bible-breadcrumb");

    if (!searchForm || !searchInput || !searchButton) {
      console.warn("검색 UI 요소를 찾을 수 없습니다.");
      return;
    }

    // 이벤트 리스너 등록
    searchForm.addEventListener("submit", handleSearch);
    searchInput.addEventListener("keydown", handleKeyDown);

    // 전역 키보드 이벤트 리스너 추가 (Esc 키 처리용)
    document.addEventListener("keydown", handleGlobalKeyDown);

    // 데스크탑 검색 버튼을 돋보기 아이콘으로 변경
    if (searchButton) {
      searchButton.innerHTML = iconSvg("search");
      searchButton.setAttribute("aria-label", "검색");
      searchButton.title = "검색";
      // 모바일 FAB와 유사한 스타일 적용
      Object.assign(searchButton.style, {
        width: "40px",
        height: "40px",
        padding: "0",
        border: "1px solid #d1d5db",
        background: "#0066cc",
        color: "#ffffff",
        borderRadius: "6px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0", // 텍스트 숨기기
      });
    }

    // 검색창 옆 결과 패널 토글 버튼 추가
    try {
      resultsToggleBtn = document.createElement("button");
      resultsToggleBtn.type = "button";
      resultsToggleBtn.className = "search-results-toggle-btn";
      resultsToggleBtn.setAttribute("aria-label", "검색 결과 패널 열기");
      resultsToggleBtn.setAttribute("aria-expanded", "false");
      resultsToggleBtn.setAttribute(
        "aria-controls",
        "bible-search-results-panel"
      );
      // 간단 스타일
      Object.assign(resultsToggleBtn.style, {
        marginLeft: "6px",
        padding: "6px 10px",
        border: "1px solid #d1d5db",
        background: "#ffffff",
        borderRadius: "6px",
        cursor: "pointer",
        lineHeight: "1",
      });
      resultsToggleBtn.innerHTML = iconSvg("panel");
      resultsToggleBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        // 패널 없으면 생성 후 열기
        if (!resultsPanel) createResultsPanel();
        const isHidden = !resultsPanel || resultsPanel.style.display === "none";
        if (isHidden) {
          showResultsPanel(true);
        } else {
          hideResultsPanel();
        }
      });
      // 검색 버튼 뒤에 삽입 (데스크톱)
      if (searchButton && searchButton.parentNode) {
        searchButton.insertAdjacentElement("afterend", resultsToggleBtn);
      }

      // 모바일: 플로팅 액션 버튼(FAB) 추가
      const fab = document.createElement("button");
      fab.type = "button";
      fab.className = "search-fab";
      fab.setAttribute("aria-label", "검색 열기");
      fab.innerHTML = iconSvg("search");
      Object.assign(fab.style, {
        position: "fixed",
        right: "16px",
        bottom: "16px",
        width: "56px",
        height: "56px",
        borderRadius: "50%",
        border: "1px solid #d0d7de",
        background: "#ffffff",
        color: "#0066cc",
        display: "none",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 6px 16px rgba(0,0,0,.22)",
        zIndex: 1100,
        cursor: "pointer",
      });
      document.body.appendChild(fab);

      function updateFabVisibility() {
        if (window.innerWidth < MOBILE_BREAKPOINT) {
          fab.style.display = "inline-flex";
        } else {
          fab.style.display = "none";
        }
      }
      updateFabVisibility();
      window.addEventListener("resize", updateFabVisibility);

      fab.addEventListener("click", () => {
        openMobileSearchSheet();
      });
    } catch (error) {
      // UI 요소 생성 실패 시 무시 (기본 기능은 계속 동작)
    }

    // 전역 검색 초기화
    initializeGlobalSearch();

    // 브레드크럼 렌더링
    try {
      renderBreadcrumb();
    } catch (e) {
      console.warn("브레드크럼 렌더링 실패:", e);
    }

    // URL 해시가 있으면 해당 절로 이동
    if (window.location.hash) {
      highlightVerse(window.location.hash.substring(1));
    }

    // 오디오 플레이어 초기화 (엄격한 멈춤 상태 강조)
    initializeAudioPlayers();
  }

  // 모바일 검색 바텀시트
  function openMobileSearchSheet() {
    const sheetId = "mobile-search-sheet";
    let sheet = document.getElementById(sheetId);
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = sheetId;
      Object.assign(sheet.style, {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: "65vh",
        background: "#fff",
        borderTopLeftRadius: "16px",
        borderTopRightRadius: "16px",
        boxShadow: "0 -12px 24px rgba(0,0,0,0.18)",
        zIndex: 1101,
        display: "none",
        padding: "0", // 패딩 제거하여 내부 요소들이 정확한 위치에 배치되도록 함
        display: "flex",
        flexDirection: "column",
      });

      // 시트 외부를 덮는 오버레이(닫기 용도)
      const overlay = document.createElement("div");
      overlay.id = "mobile-search-overlay";
      Object.assign(overlay.style, {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        zIndex: 1100,
        display: "none",
      });
      overlay.addEventListener("click", () => closeMobileSearchSheet());
      document.body.appendChild(overlay);

      const grip = document.createElement("div");
      Object.assign(grip.style, {
        width: "40px",
        height: "4px",
        background: "#e5e7eb",
        borderRadius: "999px",
        margin: "12px auto 16px", // 상단 여백 추가
      });
      sheet.appendChild(grip);

      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "10px",
        padding: "0 12px", // 좌우 패딩 추가
      });
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "절 ID 또는 단어 검색";
      input.value = searchInput ? searchInput.value : "";
      Object.assign(input.style, {
        flex: 1,
        height: "40px",
        border: "1px solid #ccc",
        borderRadius: "6px",
        padding: "0 12px",
        fontSize: "16px",
      });
      const goBtn = document.createElement("button");
      goBtn.setAttribute("aria-label", "검색");
      goBtn.title = "검색";
      goBtn.innerHTML = iconSvg("search");
      Object.assign(goBtn.style, {
        height: "40px",
        width: "40px",
        padding: 0,
        background: "#0066cc",
        color: "#fff",
        border: "none",
        borderRadius: "8px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      });
      // 지우기 버튼
      const clearBtn = document.createElement("button");
      clearBtn.setAttribute("aria-label", "검색 결과 지우기");
      clearBtn.title = "지우기";
      clearBtn.innerHTML = iconSvg("trash");
      Object.assign(clearBtn.style, {
        height: "40px",
        width: "40px",
        padding: 0,
        background: "#ffffff",
        color: "#111",
        border: "1px solid #d1d5db",
        borderRadius: "8px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      });
      row.appendChild(input);
      row.appendChild(goBtn);
      row.appendChild(clearBtn);
      sheet.appendChild(row);

      const body = document.createElement("div");
      body.id = "mobile-search-results";
      Object.assign(body.style, {
        position: "relative",
        overflow: "auto", // 스크롤바 표시
        height: "auto", // 동적 높이로 설정하여 내용에 맞게 자동 조정
        maxHeight: "calc(65vh - 146px)", // 최대 높이 제한으로 스크롤바 표시
        padding: "0 12px", // 좌우 패딩 추가
        // 모바일 스크롤바 스타일링
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(0, 0, 0, 0.2) transparent",
        webkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
      });

      // 웹킷 기반 브라우저용 스크롤바 스타일링
      const scrollbarStyle = document.createElement("style");
      scrollbarStyle.textContent = `
        #mobile-search-results::-webkit-scrollbar {
          width: 6px;
        }
        #mobile-search-results::-webkit-scrollbar-track {
          background: transparent;
        }
        #mobile-search-results::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }
        #mobile-search-results::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.3);
        }
      `;
      document.head.appendChild(scrollbarStyle);

      // 모바일 전용 결과 컨테이너 설정
      const list = document.createElement("div");
      list.className = "search-results-list";
      Object.assign(list.style, { padding: "8px 0 0 0" }); // 상단 패딩만 유지, 하단 패딩 제거
      body.appendChild(list);
      mobileResultsContainer = list;
      mobileResultsBody = body;
      sheet.appendChild(body);

      // 모바일 페이지네이션 푸터
      const footer = document.createElement("div");
      Object.assign(footer.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 12px 12px 12px", // 좌우 패딩 추가, 하단 여백 유지
        gap: "8px",
        borderTop: "none", // 상단 테두리 제거하여 여백 감소
        marginTop: "0", // 상단 여백 제거
        flexShrink: "0",
        background: "#fff",
        position: "absolute", // 절대 위치로 변경
        bottom: "0", // 하단에 고정
        left: "0",
        right: "0",
        zIndex: "1",
      });
      const mPrev = document.createElement("button");
      mPrev.id = "mobile-search-prev";
      mPrev.setAttribute("aria-label", "이전 페이지");
      mPrev.innerHTML = iconSvg("chevronLeft");
      Object.assign(mPrev.style, {
        width: "40px",
        height: "40px",
        padding: "0",
        border: "1px solid #d1d5db",
        background: "#fff",
        borderRadius: "6px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      });
      const mInfo = document.createElement("span");
      mInfo.id = "mobile-search-info";
      Object.assign(mInfo.style, {
        color: "#555",
        fontSize: "14px",
        textAlign: "center",
        flex: "1",
      });
      const mNext = document.createElement("button");
      mNext.id = "mobile-search-next";
      mNext.setAttribute("aria-label", "다음 페이지");
      mNext.innerHTML = iconSvg("chevronRight");
      Object.assign(mNext.style, {
        width: "40px",
        height: "40px",
        padding: "0",
        border: "1px solid #d1d5db",
        background: "#fff",
        borderRadius: "6px",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      });
      mPrev.addEventListener("click", () => navigatePage(-1));
      mNext.addEventListener("click", () => navigatePage(1));
      footer.appendChild(mPrev);
      footer.appendChild(mInfo);
      footer.appendChild(mNext);
      sheet.appendChild(footer);

      document.body.appendChild(sheet);

      function triggerMobileSearch() {
        if (!input.value.trim()) return;
        if (searchInput) searchInput.value = input.value;
        // 모바일 검색 모드 강제 설정
        useMobileResults = true;
        // 검색 실행
        handleSearch(new Event("submit"));
      }
      goBtn.addEventListener("click", triggerMobileSearch);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          triggerMobileSearch();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          closeMobileSearchSheet();
        }
      });

      clearBtn.addEventListener("click", () => {
        try {
          clearSavedSearchState();
        } catch (error) {
          // 상태 초기화 실패 시 무시
        }
        if (searchInput) searchInput.value = "";
        input.value = "";
        if (mobileResultsContainer) mobileResultsContainer.innerHTML = "";
        lastLocalFound = false;
        updatePageInfo(0, 0, 0);
        // 모바일 검색 시트 닫기
        closeMobileSearchSheet();
      });
    }
    // 열기
    const overlay = document.getElementById("mobile-search-overlay");
    if (overlay) overlay.style.display = "block";
    sheet.style.display = "block";
    const inputEl = sheet.querySelector("input");
    try {
      inputEl && inputEl.focus();
    } catch (error) {
      // 포커스 설정 실패 시 무시
    }
  }

  function closeMobileSearchSheet() {
    const sheet = document.getElementById("mobile-search-sheet");
    const overlay = document.getElementById("mobile-search-overlay");
    if (sheet) sheet.style.display = "none";
    if (overlay) overlay.style.display = "none";
    // 모바일 렌더 모드는 유지하여 결과를 보존
    useMobileResults = true;
  }
  function renderBreadcrumb() {
    if (!breadcrumbNav) return;
    const booksData = window.BIBLE_BOOKS || [];
    // 현재 페이지 정보
    const articleEl = document.querySelector("article");
    if (!articleEl || !articleEl.id) return;
    const m = articleEl.id.match(/^(.+?)-(\d+)$/);
    if (!m) return;
    const currentAbbr = m[1];
    const currentChapter = parseInt(m[2], 10);

    // 현재 책 메타
    let currentBookMeta = null;
    const divisions = ["구약", "외경", "신약"];
    const byDivision = { 구약: [], 외경: [], 신약: [] };
    for (const b of booksData) {
      const div = b["구분"]; // 구약/외경/신약
      if (divisions.includes(div)) {
        byDivision[div].push(b);
      }
      if (b["약칭"] === currentAbbr) currentBookMeta = b;
    }

    // 컨테이너 스타일
    breadcrumbNav.innerHTML = "";
    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      flexWrap: "wrap",
    });
    breadcrumbNav.appendChild(wrap);
    // 상단 레이아웃이 한 줄(Grid)로 배치되므로 여백을 주지 않는다
    try {
      breadcrumbNav.style.marginBottom = "0";
    } catch (error) {
      // 스타일 적용 실패 시 무시
    }

    // index.html 이동 버튼/링크 (브레드크럼 앞)
    const basePath = window.location.pathname.replace(/[^/]+$/, "");
    const indexBtn = document.createElement("a");
    indexBtn.href = basePath + "index.html";
    indexBtn.setAttribute("aria-label", "목차로 이동");
    indexBtn.title = "목차";
    indexBtn.innerHTML = `${iconSvg(
      "home"
    )}<span style="margin-left:6px">목차</span>`;
    Object.assign(indexBtn.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "6px 10px",
      minHeight: "40px",
      border: "1px solid #d1d5db",
      background: "#ffffff",
      borderRadius: "6px",
      cursor: "pointer",
      textDecoration: "none",
      color: "#111",
      fontSize: "14px",
      lineHeight: "1",
      gap: "6px",
    });
    indexBtn.addEventListener(
      "mouseenter",
      () => (indexBtn.style.background = "#f3f4f6")
    );
    indexBtn.addEventListener(
      "mouseleave",
      () => (indexBtn.style.background = "#ffffff")
    );
    wrap.appendChild(indexBtn);

    // 공통 드롭다운 생성기
    function createDropdown(labelText) {
      const container = document.createElement("div");
      Object.assign(container.style, { position: "relative" });

      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      button.textContent = labelText;
      Object.assign(button.style, {
        padding: "6px 10px",
        minHeight: "40px",
        border: "1px solid #d1d5db",
        background: "#fff",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: "14px",
        lineHeight: "1",
        color: "#111",
      });

      const list = document.createElement("ul");
      list.setAttribute("role", "listbox");
      Object.assign(list.style, {
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        minWidth: "200px",
        maxHeight: "280px",
        overflow: "auto",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
        padding: "6px",
        display: "none",
        zIndex: 1002,
        // 모바일 스크롤바 스타일링
        scrollbarWidth: "thin",
        scrollbarColor: "rgba(0, 0, 0, 0.2) transparent",
        webkitOverflowScrolling: "touch",
        overscrollBehavior: "contain",
      });

      // 웹킷 기반 브라우저용 스크롤바 스타일링
      const scrollbarStyle = document.createElement("style");
      scrollbarStyle.textContent = `
        .bible-breadcrumb ul::-webkit-scrollbar {
          width: 6px;
        }
        .bible-breadcrumb ul::-webkit-scrollbar-track {
          background: transparent;
        }
        .bible-breadcrumb ul::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 3px;
        }
        .bible-breadcrumb ul::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.3);
        }
      `;
      document.head.appendChild(scrollbarStyle);

      button.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // 모바일: 바텀시트 전환
        if (window.innerWidth < MOBILE_BREAKPOINT) {
          const items = (button._mobileItems || []).slice();
          openBottomSheet(button.textContent, items);
          return;
        }
        const opened = list.style.display === "block";
        list.style.display = opened ? "none" : "block";
        button.setAttribute("aria-expanded", opened ? "false" : "true");
      });
      document.addEventListener("click", () => {
        list.style.display = "none";
        button.setAttribute("aria-expanded", "false");
      });

      container.appendChild(button);
      container.appendChild(list);
      return { container, button, list };
    }

    // 1단계: 권역(구약/외경/신약)
    const div1 = createDropdown(
      currentBookMeta ? currentBookMeta["구분"] : "권역"
    );
    const div1MobileItems = [];
    for (const name of divisions) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = name;
      Object.assign(li.style, {
        padding: "6px 8px",
        borderRadius: "6px",
        cursor: "pointer",
      });
      li.addEventListener(
        "mouseenter",
        () => (li.style.background = "#f3f4f6")
      );
      li.addEventListener(
        "mouseleave",
        () => (li.style.background = "transparent")
      );
      li.addEventListener("click", () => {
        // 해당 권역의 첫 책 첫 장으로 이동
        const listBooks = byDivision[name] || [];
        if (listBooks.length === 0) return;
        const target = listBooks[0];
        navigateToBookChapter(target["약칭"], 1);
      });
      div1.list.appendChild(li);
      div1MobileItems.push({
        label: name,
        action: () => {
          const listBooks = byDivision[name] || [];
          if (listBooks.length === 0) return;
          const target = listBooks[0];
          navigateToBookChapter(target["약칭"], 1);
        },
      });
    }
    div1.button._mobileItems = div1MobileItems;
    wrap.appendChild(div1.container);

    // 2단계: 책 선택 (현재 권역의 책 목록)
    const currentDivision = currentBookMeta
      ? currentBookMeta["구분"]
      : divisions[0];
    const div2 = createDropdown(
      currentBookMeta ? currentBookMeta["전체 이름"] : "책"
    );
    const div2MobileItems = [];
    for (const b of byDivision[currentDivision] || []) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = b["전체 이름"] || b["약칭"];
      Object.assign(li.style, {
        padding: "6px 8px",
        borderRadius: "6px",
        cursor: "pointer",
      });
      li.addEventListener(
        "mouseenter",
        () => (li.style.background = "#f3f4f6")
      );
      li.addEventListener(
        "mouseleave",
        () => (li.style.background = "transparent")
      );
      li.addEventListener("click", () => {
        // 선택된 책의 1장으로 이동 (또는 현재 장 1로 초기화)
        navigateToBookChapter(b["약칭"], 1);
        // 장 드롭다운을 실제 장 수로 갱신
        requestChaptersAndRender(b["약칭"], div3);
      });
      div2.list.appendChild(li);
      div2MobileItems.push({
        label: (b["전체 이름"] || b["약칭"]) + " 1장",
        action: () => navigateToBookChapter(b["약칭"], 1),
      });
    }
    div2.button._mobileItems = div2MobileItems;
    wrap.appendChild(div2.container);

    // 3단계: 장 선택 (해당 책의 장 목록)
    const div3 = createDropdown(`${currentChapter}장`);
    requestChaptersAndRender(currentAbbr, div3);
    // 드롭다운 버튼 클릭 시, 최신 장 목록을 보장하기 위해 재요청
    try {
      div3.button.addEventListener("click", () => {
        if (isWorkerReady)
          requestChaptersAndRender(
            (document.querySelector("article").id || "").split("-")[0],
            div3
          );
      });
    } catch (error) {
      // 이벤트 리스너 부착 실패 시 무시
    }
    wrap.appendChild(div3.container);
  }

  function requestChaptersAndRender(bookAbbr, drop) {
    const render = (book, chapters) => {
      drop.list.innerHTML = "";
      const mobileItems = [];
      const list = Array.isArray(chapters) && chapters.length ? chapters : [];
      for (const n of list) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = `${n}장`;
        Object.assign(li.style, {
          padding: "6px 8px",
          borderRadius: "6px",
          cursor: "pointer",
        });
        li.addEventListener(
          "mouseenter",
          () => (li.style.background = "#f3f4f6")
        );
        li.addEventListener(
          "mouseleave",
          () => (li.style.background = "transparent")
        );
        li.addEventListener("click", () => navigateToBookChapter(book, n));
        drop.list.appendChild(li);
        mobileItems.push({
          label: `${n}장`,
          action: () => navigateToBookChapter(book, n),
        });
      }
      drop.button._mobileItems = mobileItems;
    };
    // 워커 준비 전이면 잠시 후 재시도
    if (!searchWorker || !isWorkerReady) {
      // 로딩 표시
      try {
        drop.list.innerHTML = "";
        const p = document.createElement("li");
        p.textContent = "로딩 중…";
        Object.assign(p.style, { padding: "6px 8px", color: "#666" });
        drop.list.appendChild(p);
      } catch (error) {
        // 로딩 표시 생성 실패 시 무시
      }
      setTimeout(() => requestChaptersAndRender(bookAbbr, drop), 200);
      return;
    }
    if (searchWorker) {
      const handler = (ev) => {
        const d = ev.data || {};
        if (d.type === "chapters" && d.book === bookAbbr) {
          searchWorker.removeEventListener("message", handler);
          render(bookAbbr, d.chapters);
        }
      };
      searchWorker.addEventListener("message", handler);
      try {
        searchWorker.postMessage({ type: "chapters", book: bookAbbr });
      } catch (error) {
        // 워커 메시지 전송 실패 시 리스너 정리 후 무시
        searchWorker.removeEventListener("message", handler);
      }
    }
  }

  function navigateToBookChapter(bookAbbr, chapterNumber) {
    const abbrToSlug =
      (window.BIBLE_ALIAS && window.BIBLE_ALIAS.abbrToSlug) || {};
    const slug = abbrToSlug[bookAbbr];
    if (!slug) {
      showMessage("해당 책을 찾을 수 없습니다.", "error");
      return;
    }
    const basePath = window.location.pathname.replace(/[^/]+$/, "");
    const filename = `${slug}-${chapterNumber}.html`;
    window.location.href = basePath + filename;
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
          // 저장된 상태 복구
          restoreSearchState();
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

  // 아이콘 SVG 헬퍼 (헤더/툴바 공용)
  function iconSvg(icon) {
    const map = {
      search:
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
      chevronUp:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"></polyline></svg>',
      chevronDown:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>',
      chevronLeft:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>',
      chevronRight:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"></polyline></svg>',
      trash:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>',
      close:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
      panel:
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect><line x1="9" y1="4" x2="9" y2="20"></line></svg>',
      home: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"></path><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
    };
    return map[icon] || "";
  }

  // 바텀시트(모바일)
  function openBottomSheet(title, items) {
    closeBottomSheet();
    const overlay = document.createElement("div");
    overlay.className = "bible-bottomsheet-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: 0,
      background: "rgba(17,24,39,0.45)",
      zIndex: 1003,
      display: "flex",
      alignItems: "flex-end",
      justifyContent: "center",
    });

    const sheet = document.createElement("div");
    Object.assign(sheet.style, {
      width: "100%",
      maxWidth: "640px",
      background: "#fff",
      borderTopLeftRadius: "16px",
      borderTopRightRadius: "16px",
      boxShadow: "0 -8px 24px rgba(0,0,0,0.18)",
      padding: "12px 12px 16px",
      maxHeight: "70vh",
      overflow: "auto",
      // 모바일 스크롤바 스타일링
      scrollbarWidth: "thin",
      scrollbarColor: "rgba(0, 0, 0, 0.2) transparent",
      webkitOverflowScrolling: "touch",
      overscrollBehavior: "contain",
    });

    // 웹킷 기반 브라우저용 스크롤바 스타일링
    const scrollbarStyle = document.createElement("style");
    scrollbarStyle.textContent = `
      .bible-bottomsheet-overlay .bible-bottomsheet-overlay > div::-webkit-scrollbar {
        width: 6px;
      }
      .bible-bottomsheet-overlay .bible-bottomsheet-overlay > div::-webkit-scrollbar-track {
        background: transparent;
      }
      .bible-bottomsheet-overlay .bible-bottomsheet-overlay > div::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
      }
      .bible-bottomsheet-overlay .bible-bottomsheet-overlay > div::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 0, 0, 0.3);
      }
    `;
    document.head.appendChild(scrollbarStyle);

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: "8px",
    });
    const h = document.createElement("div");
    h.textContent = title || "선택";
    Object.assign(h.style, { fontWeight: "bold", fontSize: "16px" });
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "닫기");
    close.innerHTML = iconSvg("close");
    Object.assign(close.style, {
      border: "1px solid #d1d5db",
      background: "#fff",
      borderRadius: "6px",
      padding: "6px 8px",
      cursor: "pointer",
    });
    close.addEventListener("click", closeBottomSheet);
    header.appendChild(h);
    header.appendChild(close);

    const list = document.createElement("div");
    for (const it of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = it.label;
      Object.assign(btn.style, {
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        border: "1px solid #e5e7eb",
        background: "#fff",
        borderRadius: "8px",
        cursor: "pointer",
        marginBottom: "8px",
      });
      btn.addEventListener("click", () => {
        try {
          it.action && it.action();
        } catch (error) {
          // 액션 실행 중 오류는 사용자 인터랙션을 막지 않음
        } finally {
          closeBottomSheet();
        }
      });
      list.appendChild(btn);
    }

    sheet.appendChild(header);
    sheet.appendChild(list);
    overlay.appendChild(sheet);

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) closeBottomSheet();
    });

    document.body.appendChild(overlay);
  }

  function closeBottomSheet() {
    const exist = document.querySelector(".bible-bottomsheet-overlay");
    if (exist && exist.parentNode) exist.parentNode.removeChild(exist);
  }

  function saveSearchState() {
    try {
      const state = { q: pagination.q || "", page: pagination.page || 1 };
      sessionStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state));
      if (history && history.replaceState) {
        history.replaceState(state, document.title);
      }
    } catch (error) {
      // 상태 저장 실패 시 무시 (프라이빗 모드 등)
    }
  }

  function getSavedState() {
    try {
      const h = (history && history.state) || null;
      if (h && typeof h === "object" && (h.q || h.page)) return h;
      const raw = sessionStorage.getItem(SEARCH_STATE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (error) {
      // 저장된 상태 읽기 실패 시 무시
    }
    return null;
  }

  function restoreSearchState() {
    const st = getSavedState();
    if (!st || !st.q) return;
    if (searchInput) searchInput.value = st.q;
    // 패널 생성만 하고 표시하지 않음 (사용자가 직접 열어야 함)
    createResultsPanel();
    // 데스크탑에서는 패널을 숨김 상태로 유지
    if (window.innerWidth >= MOBILE_BREAKPOINT) {
      resultsPanel.style.display = "none";
    } else {
      resultsPanel.style.display = "block";
    }
    renderGlobalResults(st.q, null);
    pagination.q = st.q;
    pagination.page = st.page || 1;
    try {
      if (searchWorker && isWorkerReady) {
        searchWorker.postMessage({
          type: "query",
          q: pagination.q,
          limit: pagination.pageSize,
          page: pagination.page,
        });
      } else {
        pendingQueries.push(pagination.q);
      }
    } catch (error) {
      // 검색 상태 복원 실패 시 무시
    }
  }

  /**
   * 검색 결과 패널 생성
   */
  function createResultsPanel() {
    if (resultsPanel) return;
    resultsPanel = document.createElement("div");
    resultsPanel.className = "search-results-panel";
    resultsPanel.id = "bible-search-results-panel";
    resultsPanel.setAttribute("role", "dialog");
    resultsPanel.setAttribute("aria-label", "검색 결과");

    Object.assign(resultsPanel.style, {
      position: "fixed",
      top: "70px",
      right: "20px",
      width: "480px", // 380px에서 480px로 폭 확장
      height: "60vh", // maxHeight에서 height로 변경하여 고정 높이 설정
      overflow: "hidden",
      backgroundColor: "#ffffff",
      border: "1px solid #ddd",
      boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
      borderRadius: "6px",
      zIndex: "1001",
      display: "none",
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      padding: "10px 12px",
      fontWeight: "bold",
      borderBottom: "1px solid #eee",
      background: "#f9fafb",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      position: "sticky",
      top: "0",
      zIndex: "1",
    });
    resultsPanel.appendChild(header);

    // 제목(줄바꿈 방지, 여유 여백)
    const headerTitle = document.createElement("span");
    headerTitle.textContent = "검색 결과";
    Object.assign(headerTitle.style, {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      padding: "0 8px",
      marginRight: "6px",
    });
    header.appendChild(headerTitle);

    // 헤더 액션 컨테이너
    const headerActions = document.createElement("div");
    Object.assign(headerActions.style, {
      display: "flex",
      gap: "6px",
      alignItems: "center",
    });
    header.appendChild(headerActions);

    // 접기/펼치기 토글 버튼
    function setButtonBaseStyles(btn) {
      Object.assign(btn.style, {
        padding: "4px 8px",
        border: "1px solid #d1d5db",
        background: "#ffffff",
        borderRadius: "999px",
        cursor: "pointer",
        fontSize: "12px",
        lineHeight: "1",
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
      });
      btn.addEventListener(
        "mouseenter",
        () => (btn.style.background = "#f3f4f6")
      );
      btn.addEventListener(
        "mouseleave",
        () => (btn.style.background = "#ffffff")
      );
    }

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", "검색 결과 창 접기");
    setButtonBaseStyles(toggleBtn);
    toggleBtn.innerHTML = iconSvg("chevronUp");
    headerActions.appendChild(toggleBtn);

    // 바디 컨테이너
    const body = document.createElement("div");
    body.className = "search-results-body";

    // 정확한 높이 설정: 패널 전체 높이 - 헤더 높이 - 푸터 높이
    const calculateBodyHeight = () => {
      const panelHeight = (60 * window.innerHeight) / 100; // 60vh
      const headerHeight = 40; // 헤더 높이 (고정값)
      const footerHeight = 40; // 푸터 높이 (고정값)
      return Math.max(0, panelHeight - headerHeight - footerHeight);
    };

    // 초기 높이 설정
    Object.assign(body.style, {
      height: `${calculateBodyHeight()}px`,
      zIndex: "1", // 스크롤바 스타일링을 위한 z-index
    });

    // 웹킷 기반 브라우저용 스크롤바 스타일링
    const scrollbarStyle = document.createElement("style");
    scrollbarStyle.textContent = `
      .search-results-body::-webkit-scrollbar {
        width: 6px;
      }
      .search-results-body::-webkit-scrollbar-track {
        background: transparent;
      }
      .search-results-body::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 3px;
      }
      .search-results-body::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 0, 0, 0.3);
      }
    `;
    document.head.appendChild(scrollbarStyle);

    resultsPanel.appendChild(body);

    const list = document.createElement("div");
    list.className = "search-results-list";
    // 스크롤을 위한 스타일 설정
    Object.assign(list.style, {
      height: "100%",
      overflowY: "auto",
      overflowX: "hidden",
    });
    body.appendChild(list);
    // 초기 상태: 검색 결과 없음 메시지 표시
    try {
      const empty = document.createElement("p");
      empty.textContent = "검색 결과 없음";
      Object.assign(empty.style, { color: "#666", margin: "8px 4px 0px 4px" }); // 하단 여백 제거
      list.appendChild(empty);
    } catch (error) {
      // 초기 메시지 생성 실패 시 무시
    }

    const footer = document.createElement("div");
    footer.className = "search-results-footer";
    // 명시적으로 높이 설정
    Object.assign(footer.style, {
      height: "40px",
      minHeight: "40px",
      zIndex: "1", // 헤더와 동일한 z-index
    });
    const navLeft = document.createElement("button");
    navLeft.type = "button";
    navLeft.className = "search-page-prev";
    navLeft.setAttribute("aria-label", "이전 페이지");
    navLeft.innerHTML = iconSvg("chevronLeft");
    Object.assign(navLeft.style, {
      width: "32px",
      height: "32px",
      padding: "0",
      border: "1px solid #d0d7de",
      background: "#fff",
      borderRadius: "6px",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: "0",
      marginRight: "8px",
    });
    navLeft.addEventListener("click", () => navigatePage(-1));

    const pageInfo = document.createElement("span");
    pageInfo.className = "search-page-info";
    Object.assign(pageInfo.style, {
      color: "#555",
      fontSize: "14px",
      textAlign: "center",
      flex: "1",
    });
    pageInfo.textContent = "";

    const navRight = document.createElement("button");
    navRight.type = "button";
    navRight.className = "search-page-next";
    navRight.setAttribute("aria-label", "다음 페이지");
    navRight.innerHTML = iconSvg("chevronRight");
    Object.assign(navRight.style, {
      width: "32px",
      height: "32px",
      padding: "0",
      border: "1px solid #d0d7de",
      background: "#fff",
      borderRadius: "6px",
      cursor: "pointer",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: "0",
      marginLeft: "8px",
    });
    navRight.addEventListener("click", () => navigatePage(1));

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.innerHTML = iconSvg("trash");
    clearBtn.setAttribute("aria-label", "검색 결과 지우기");
    setButtonBaseStyles(clearBtn);
    clearBtn.addEventListener("click", () => {
      // 검색 상태/입력/결과/페이지네이션 완전 초기화
      try {
        clearSavedSearchState();
      } catch (error) {
        // 상태 초기화 실패 시 무시
      }
      if (searchInput) searchInput.value = "";
      const listEl = resultsPanel.querySelector(".search-results-list");
      if (listEl) listEl.innerHTML = "";
      // 페이지네이션 초기화 및 버튼 비활성화
      pagination.q = "";
      pagination.page = 1;
      updatePageInfo(0, 0, 0);
      // 패널에 빈 상태 메시지 표시
      showGlobalResultsMessage("검색 결과 없음");
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.innerHTML = iconSvg("close");
    setButtonBaseStyles(closeBtn);
    closeBtn.addEventListener("click", () => {
      hideResultsPanel();
    });
    // 왼쪽에 이전 버튼 배치
    footer.appendChild(navLeft);
    // 중앙에 페이지 정보 배치
    footer.appendChild(pageInfo);
    // 오른쪽에 다음 버튼 배치
    footer.appendChild(navRight);
    headerActions.appendChild(clearBtn);
    headerActions.appendChild(closeBtn);

    // 푸터를 패널에 직접 추가 (body가 아닌)
    resultsPanel.appendChild(footer);

    document.body.appendChild(resultsPanel);

    function setCollapsed(state, persist = true) {
      isCollapsed = !!state;
      body.style.display = isCollapsed ? "none" : "block";
      toggleBtn.innerHTML = isCollapsed
        ? iconSvg("chevronDown")
        : iconSvg("chevronUp");
      toggleBtn.setAttribute(
        "aria-label",
        isCollapsed ? "검색 결과 창 펼치기" : "검색 결과 창 접기"
      );
      toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
      // 너비를 조금 줄여 헤더만 보이도록
      if (isCollapsed) {
        resultsPanel.style.width = "220px";
      } else {
        resultsPanel.style.width = "380px";
      }
      if (persist) {
        try {
          sessionStorage.setItem(
            PANEL_STATE_KEY,
            JSON.stringify({ collapsed: isCollapsed })
          );
        } catch (error) {
          // 상태 저장 실패 시 무시 (프라이빗 모드 등)
        }
      }
    }
    // 외부에서 펼치기/접기 호출할 수 있도록 보조 핸들러 부착
    resultsPanel._setCollapsed = setCollapsed;

    // 버튼/헤더 클릭으로 토글
    toggleBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      autoManagedCollapse = false;
      setCollapsed(!isCollapsed);
    });
    header.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      autoManagedCollapse = false;
      setCollapsed(!isCollapsed);
    });

    // 패널이 접힌 상태에서 패널 영역 클릭 시 펼치기
    resultsPanel.addEventListener("click", () => {
      if (isCollapsed) {
        autoManagedCollapse = false;
        setCollapsed(false);
      }
    });

    // 패널 바깥 클릭 시 접기
    document.addEventListener("click", (ev) => {
      if (!resultsPanel || resultsPanel.style.display === "none") return;
      const target = ev.target;
      if (resultsPanel.contains(target)) return;
      if (!isCollapsed) {
        autoManagedCollapse = false;
        setCollapsed(true);
      }
    });

    // 저장된 패널 상태 복원
    try {
      const raw = sessionStorage.getItem(PANEL_STATE_KEY);
      if (raw) {
        const st = JSON.parse(raw);
        if (st && typeof st.collapsed === "boolean") setCollapsed(st.collapsed);
      } else {
        // 데스크탑: 기본적으로 패널 숨김, 모바일: 자동 접기
        if (window.innerWidth < MOBILE_BREAKPOINT) {
          autoManagedCollapse = true;
          setCollapsed(true, false);
        } else {
          // 데스크탑: 패널을 숨김 상태로 설정
          resultsPanel.style.display = "none";
        }
      }
    } catch (error) {
      // 저장된 상태 복원 실패 시 무시
    }

    // 화면 크기 변경에 따른 자동 접기/펼치기
    function handleResize() {
      // 자동 접기: 모바일 폭 미만이고 현재 펼쳐져 있으며 자동 관리 중일 때
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        if (!isCollapsed) {
          autoManagedCollapse = true;
          setCollapsed(true, false);
        }
      } else {
        // 데스크탑 폭 이상이고 자동 관리 상태이며 저장된 값이 펼치기라면 복원
        if (autoManagedCollapse) {
          try {
            const raw = sessionStorage.getItem(PANEL_STATE_KEY);
            const st = raw ? JSON.parse(raw) : { collapsed: false };
            if (!st || st.collapsed === false) {
              setCollapsed(false, false);
            }
          } catch (error) {
            // 패널 상태 복원 실패 시 기본값으로 복원
            setCollapsed(false, false);
          }
          autoManagedCollapse = false;
        }
      }
    }
    window.addEventListener("resize", handleResize);
  }

  /**
   * 오디오 플레이어 초기화: 초기에 항상 멈춤 상태로 고정
   */
  function initializeAudioPlayers() {
    const audios = document.querySelectorAll("audio.bible-audio");
    for (const audio of audios) {
      try {
        audio.autoplay = false;
      } catch (error) {
        // autoplay 설정 실패 시 무시
      }
      try {
        audio.preload = "metadata";
      } catch (error) {
        // preload 설정 실패 시 무시
      }

      const reset = () => {
        try {
          audio.pause();
        } catch (error) {
          // 오디오 정지 실패 시 무시
        }
        try {
          audio.currentTime = 0;
        } catch (error) {
          // 오디오 시간 초기화 실패 시 무시
        }
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
      // 참조 검색은 상태를 저장하지 않고, 기존 키워드 검색 상태를 제거
      resetSearchUI();
      // 참조 검색 전 존재 검증(워커가 준비되어 있으면 빠르게 체크)
      const bookName = verseRefMatch[1];
      const chapter = verseRefMatch[2];
      const verse = verseRefMatch[3];
      searchByReference(bookName, chapter, verse);
    } else {
      // 텍스트 검색: 1) 현재 문서 내 검색 2) 전역 검색
      suppressLocalToast = true;
      lastQueryText = query;
      searchByText(query);
      suppressLocalToast = false;
      // 새로운 키워드 검색: 기존 결과 초기화 후 저장
      resetResultsPanel();
      globalSearch(query);
      saveSearchState();
    }
  }

  /**
   * 키보드 입력 처리 (검색 입력창 전용)
   */
  function handleKeyDown(event) {
    // ESC 키로 하이라이트 제거
    if (event.key === "Escape") {
      clearHighlight();
      searchInput.blur();
    }
  }

  /**
   * 전역 키보드 이벤트 처리 (Esc 키로 UI 닫기)
   */
  function handleGlobalKeyDown(event) {
    if (event.key === "Escape") {
      // 검색 결과 패널이 열려있으면 닫기
      if (resultsPanel && resultsPanel.style.display !== "none") {
        hideResultsPanel();
        return;
      }

      // 모바일 바텀시트가 열려있으면 닫기
      const mobileSheet = document.getElementById("mobile-search-sheet");
      if (mobileSheet && mobileSheet.style.display !== "none") {
        closeMobileSearchSheet();
        return;
      }
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

    // 같은 책·장 → 현재 페이지에서 이동 (존재 검증 포함)
    if (targetBookAbbr === currentBookAbbr && chapter === currentChapter) {
      const verseId = `${targetBookAbbr}-${chapter}-${verse}`;
      // 우선 DOM에서 시도
      const found = highlightVerse(verseId);
      if (found) {
        showMessage(
          `${bookName} ${chapter}:${verse}로 이동했습니다.`,
          "success"
        );
        history.replaceState(null, null, `#${verseId}`);
        return;
      }
      // DOM에 없으면 전역 인덱스에서 존재 여부 확인(워커 사용)
      checkReferenceExistence(verseId, (ok) => {
        if (ok) {
          // 현재 문서에 없으면 전역 파일로 이동
          const slug = abbrToSlug[targetBookAbbr];
          const basePath = window.location.pathname.replace(/[^/]+$/, "");
          const filename = `${slug}-${chapter}.html#${verseId}`;
          window.location.href = basePath + filename;
        } else {
          showMessage(
            `${bookName} ${chapter}:${verse}은(는) 없는 구절입니다.`,
            "error"
          );
        }
      });
    } else {
      // 다른 책/장 → 파일로 리다이렉트
      const slug = abbrToSlug[targetBookAbbr];
      if (!slug) {
        showMessage("해당 책을 찾을 수 없습니다.", "error");
        return;
      }
      const verseId = `${targetBookAbbr}-${chapter}-${verse}`;
      // 이동 전 전역 인덱스에서 존재 여부 확인(워커)
      checkReferenceExistence(verseId, (ok) => {
        if (!ok) {
          showMessage(
            `${bookName} ${chapter}:${verse}은(는) 없는 구절입니다.`,
            "error"
          );
          return;
        }
        const basePath = window.location.pathname.replace(/[^/]+$/, "");
        const filename = `${slug}-${chapter}.html#${verseId}`;
        window.location.href = basePath + filename;
      });
    }
  }

  // 전역 인덱스에서 해당 절 ID 존재 여부 확인
  function checkReferenceExistence(verseId, cb) {
    if (!searchWorker) {
      // 워커 미구성: 보수적으로 존재한다고 가정하고 이동 시도
      cb(true);
      return;
    }
    const handler = (ev) => {
      const data = ev.data || {};
      if (data.type === "checkResult" && data.id === verseId) {
        searchWorker.removeEventListener("message", handler);
        cb(!!data.ok);
      }
    };
    searchWorker.addEventListener("message", handler);
    try {
      searchWorker.postMessage({ type: "check", id: verseId });
    } catch (error) {
      searchWorker.removeEventListener("message", handler);
      cb(true);
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

    // 로컬 검색 결과 토스트는 전역 검색과 충돌하지 않도록 조절
    lastLocalFound = found;
    if (found && !suppressLocalToast) {
      showMessage(`"${query}" 검색 완료`, "success");
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

    // 모바일 검색 시트가 열려있으면 모바일 모드로 설정
    const mobileSheet = document.getElementById("mobile-search-sheet");
    if (mobileSheet && mobileSheet.style.display !== "none") {
      useMobileResults = true;
    }

    if (useMobileResults) {
      // 바텀시트 높이에 맞춰 페이지 크기 산정
      try {
        const newSize = getMobilePageSize();
        if (newSize && newSize !== pagination.pageSize) {
          pagination.pageSize = newSize;
        }
      } catch (error) {
        // 모바일 페이지 크기 계산 실패 시 무시
      }
      // 모바일: 패널 생성/표시는 생략, 바텀시트 컨테이너에 렌더
      renderGlobalResults(query, null);
    } else {
      createResultsPanel();
      showResultsPanel(true);
      renderGlobalResults(query, null); // 로딩 상태
    }

    const trimmed = query.trim();
    if (!trimmed) return;

    pagination.q = trimmed;
    pagination.page = 1;

    if (!isWorkerReady) {
      pendingQueries.push(trimmed);
      saveSearchState();
      return;
    }
    try {
      searchWorker.postMessage({
        type: "query",
        q: trimmed,
        limit: pagination.pageSize,
        page: pagination.page,
      });
      saveSearchState();
    } catch (error) {
      // 검색 요청 실패 시 사용자 메시지 표시
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
      saveSearchState();
    } catch (error) {
      // 페이지 이동 실패 시 무시
    }
  }

  function showGlobalResultsMessage(message) {
    // 모바일 검색 시트가 열려있으면 모바일 모드로 강제 설정
    const mobileSheet = document.getElementById("mobile-search-sheet");
    if (mobileSheet && mobileSheet.style.display !== "none") {
      useMobileResults = true;
    }

    if (useMobileResults && mobileResultsContainer) {
      mobileResultsContainer.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = message || "검색 결과가 없습니다.";
      Object.assign(p.style, {
        color: "#666",
        margin: "8px 4px",
        textAlign: "center",
        fontSize: "14px",
        padding: "20px 0",
        display: "block", // 명시적으로 표시
        visibility: "visible", // 가시성 보장
        opacity: "1", // 투명도 보장
        position: "static", // 위치 보장
        zIndex: "1", // 레이어 순서 보장
      });
      mobileResultsContainer.appendChild(p);
      updatePageInfo(0, 0, 0);
    } else {
      createResultsPanel();
      const list = resultsPanel.querySelector(".search-results-list");
      if (!list) return;
      list.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = message || "검색 결과가 없습니다.";
      Object.assign(p.style, { color: "#666", margin: "8px 4px" });
      list.appendChild(p);
      updatePageInfo(0, 0, 0);
      showResultsPanel(false);
    }
  }

  function renderGlobalResults(
    query,
    results,
    page = 1,
    total = 0,
    pageSize = 50
  ) {
    // 모바일 검색 시트가 열려있으면 모바일 모드로 강제 설정
    const mobileSheet = document.getElementById("mobile-search-sheet");
    if (mobileSheet && mobileSheet.style.display !== "none") {
      useMobileResults = true;
      // 디버그 로깅 제거
    }

    let list;
    if (useMobileResults && mobileResultsContainer) {
      list = mobileResultsContainer;
      list.innerHTML = "";
      // 디버그 로깅 제거
    } else {
      createResultsPanel();
      list = resultsPanel.querySelector(".search-results-list");
      if (!list) return;
      list.innerHTML = "";
      // 디버그 로깅 제거
    }

    if (results === null) {
      const loading = document.createElement("p");
      loading.textContent = `"${query}" 검색 중…`;
      Object.assign(loading.style, {
        color: "#666",
        margin: "8px 4px 0px 4px", // 하단 여백 제거
      });
      list.appendChild(loading);
      return;
    }

    if (!Array.isArray(results) || results.length === 0) {
      // 이전 로딩 메시지 제거
      const existingLoading = list.querySelector("p");
      if (existingLoading && existingLoading.textContent.includes("검색 중")) {
        existingLoading.remove();
      }

      const empty = document.createElement("p");
      if (useMobileResults && mobileResultsContainer) {
        empty.textContent = "검색 결과가 없습니다.";
        Object.assign(empty.style, {
          color: "#666",
          margin: "8px 4px",
          textAlign: "center",
          fontSize: "14px",
          padding: "20px 0",
          display: "block", // 명시적으로 표시
          visibility: "visible", // 가시성 보장
          opacity: "1", // 투명도 보장
          position: "static", // 위치 보장
          zIndex: "1", // 레이어 순서 보장
        });
      } else {
        empty.textContent = `"${query}" 결과가 없습니다.`;
        Object.assign(empty.style, {
          color: "#666",
          margin: "8px 4px 0px 4px", // 하단 여백 제거
        });
      }
      list.appendChild(empty);
      // 디버그 상세 로깅 제거

      updatePageInfo(0, 0, 0);
      // 전역/로컬 모두 실패한 경우에만 에러 토스트 표시
      if (query === lastQueryText && !lastLocalFound) {
        showMessage(`"${query}"를 찾을 수 없습니다.`, "error");
      }
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

      // 레퍼런스(책 장:절) 표시 추가
      const bookAbbr = item.b || (item.i || item.id || "").split("-")[0] || "";
      let chap = item.c;
      let ver = item.v;
      if (chap == null || ver == null) {
        const parts = String(item.i || item.id || "").split("-");
        if (parts.length >= 3) {
          chap = chap == null ? parseInt(parts[1], 10) : chap;
          ver = ver == null ? parseInt(parts[2], 10) : ver;
        }
      }
      if (bookAbbr && chap && ver) {
        const ref = document.createElement("span");
        ref.className = "search-result-ref";
        ref.textContent = ` — ${bookAbbr} ${chap}:${ver}`;
        Object.assign(ref.style, {
          marginLeft: "6px",
          color: "#555",
          fontSize: "12px",
        });
        a.appendChild(ref);
      }

      a.addEventListener("mouseenter", () => {
        a.style.background = "#f3f4f6";
      });
      a.addEventListener("mouseleave", () => {
        a.style.background = "transparent";
      });

      // 마지막 항목인 경우 하단 여백 제거
      if (results.indexOf(item) === results.length - 1) {
        a.style.marginBottom = "0";
      }

      list.appendChild(a);
    }

    updatePageInfo(page, pageSize, total);
  }

  // 패널 표시/숨김 공통 처리 (토글 버튼 접근성 상태 포함)
  function showResultsPanel(expandIfCollapsed) {
    createResultsPanel();
    if (resultsPanel) {
      resultsPanel.style.display = "block";
      if (
        expandIfCollapsed &&
        typeof resultsPanel._setCollapsed === "function" &&
        isCollapsed
      ) {
        try {
          resultsPanel._setCollapsed(false, true);
        } catch (error) {
          // 패널 펼치기 실패 시 무시
        }
      }
    }
    if (resultsToggleBtn) {
      resultsToggleBtn.setAttribute("aria-expanded", "true");
      resultsToggleBtn.setAttribute("aria-label", "검색 결과 패널 닫기");
    }
  }

  function hideResultsPanel() {
    if (resultsPanel) {
      resultsPanel.style.display = "none";
    }
    if (resultsToggleBtn) {
      resultsToggleBtn.setAttribute("aria-expanded", "false");
      resultsToggleBtn.setAttribute("aria-label", "검색 결과 패널 열기");
    }
  }

  function updatePageInfo(page, pageSize, total) {
    const pageInfo =
      resultsPanel && resultsPanel.querySelector(".search-page-info");
    const prevBtn =
      resultsPanel && resultsPanel.querySelector(".search-page-prev");
    const nextBtn =
      resultsPanel && resultsPanel.querySelector(".search-page-next");
    if (!pageInfo) return;
    const totalPages =
      pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
    pageInfo.textContent =
      total > 0 ? `${page}/${totalPages} (총 ${total}건)` : "";
    // 버튼 활성/비활성
    if (prevBtn) prevBtn.disabled = !(total > 0 && page > 1);
    if (nextBtn) nextBtn.disabled = !(total > 0 && page < totalPages);
    pagination.page = page || 1;
    pagination.pageSize = pageSize || 50;
    // 검색어가 없거나 total=0이면 상태 저장 지움
    if (!pagination.q || !(total > 0)) {
      try {
        sessionStorage.removeItem(SEARCH_STATE_KEY);
      } catch (error) {
        // 상태 저장 지우기 실패 시 무시
      }
    } else {
      saveSearchState();
    }

    // 모바일 바텀시트 푸터 동기화
    const mPrev = document.getElementById("mobile-search-prev");
    const mInfo = document.getElementById("mobile-search-info");
    const mNext = document.getElementById("mobile-search-next");
    if (mInfo) mInfo.textContent = total > 0 ? `${page}/${totalPages}` : "";
    if (mPrev) mPrev.disabled = !(total > 0 && page > 1);
    if (mNext) mNext.disabled = !(total > 0 && page < totalPages);

    // 모바일 페이지 번호 렌더링
    lastTotalResults = total || 0;
  }

  function getMobilePageSize() {
    // 바텀시트의 높이를 고려해서 검색 결과 영역에 표시할 수 있는 항목 수 계산
    try {
      const sheet = document.getElementById("mobile-search-sheet");
      if (!sheet) return pagination.pageSize;

      // 바텀시트 전체 높이 (65vh)
      const sheetHeight = sheet.clientHeight || 0;

      // 검색 행 높이 (44px + 여백 10px)
      const searchRowHeight = 54;

      // 페이지네이션 네비게이션 높이 (44px + 여백 8px)
      const paginationHeight = 52;

      // 검색 결과 영역에 사용 가능한 높이
      const availableHeight = sheetHeight - searchRowHeight - paginationHeight;

      // 각 검색 결과 항목의 높이 (대략 68px/항목: 링크 2줄 + 여백)
      const perItemHeight = 68;

      // 표시 가능한 항목 수 (최소 4개)
      const items = Math.max(4, Math.floor(availableHeight / perItemHeight));

      return items;
    } catch (error) {
      return pagination.pageSize;
    }
  }

  function gotoPage(targetPage) {
    if (!searchWorker || !isWorkerReady || !pagination.q) return;
    const totalPages =
      pagination.pageSize > 0
        ? Math.max(1, Math.ceil((lastTotalResults || 0) / pagination.pageSize))
        : 1;
    const next = Math.min(Math.max(1, targetPage), totalPages);
    pagination.page = next;
    try {
      searchWorker.postMessage({
        type: "query",
        q: pagination.q,
        limit: pagination.pageSize,
        page: pagination.page,
      });
      saveSearchState();
    } catch (error) {
      // 페이지 이동 실패 시 무시
    }
  }

  // 브라우저 뒤/앞 이동 시 상태 복구
  window.addEventListener("popstate", () => {
    restoreSearchState();
  });

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
