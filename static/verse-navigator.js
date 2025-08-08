/**
 * 공동번역성서 프로젝트 - 성경 구절 네비게이션 스크립트
 * 절 검색 및 하이라이트 기능 제공
 */

(function () {
  'use strict';

  // DOM 요소들
  let searchForm;
  let searchInput;
  let searchButton;

  // 현재 하이라이트된 요소
  let currentHighlight = null;

  // 주입된 별칭/슬러그 데이터
  const injected = window.BIBLE_ALIAS || { aliasToAbbr: {}, abbrToSlug: {} };
  const bookNameToAbbr = injected.aliasToAbbr;
  const abbrToSlug = injected.abbrToSlug;

  /**
   * 초기화 함수
   */
  function init() {
    // DOM 요소 가져오기
    searchForm = document.getElementById('verse-search-form');
    searchInput = document.getElementById('verse-search');
    searchButton = document.getElementById('verse-search-btn');

    if (!searchForm || !searchInput || !searchButton) {
      console.warn('검색 UI 요소를 찾을 수 없습니다.');
      return;
    }

    // 이벤트 리스너 등록
    searchForm.addEventListener('submit', handleSearch);
    searchInput.addEventListener('keydown', handleKeyDown);

    // URL 해시가 있으면 해당 절로 이동
    if (window.location.hash) {
      highlightVerse(window.location.hash.substring(1));
    }

    // 오디오 플레이어 초기화 (엄격한 멈춤 상태 강조)
    initializeAudioPlayers();

    console.log('성경 구절 네비게이션 초기화 완료');
  }

  /**
   * 오디오 플레이어 초기화: 초기에 항상 멈춤 상태로 고정
   */
  function initializeAudioPlayers() {
    const audios = document.querySelectorAll('audio.bible-audio');
    for (const audio of audios) {
      try { audio.autoplay = false; } catch (_) {}
      try { audio.preload = 'metadata'; } catch (_) {}

      const reset = () => {
        try { audio.pause(); } catch (_) {}
        try { audio.currentTime = 0; } catch (_) {}
      };

      // 메타데이터/데이터 로드 시점에 항상 리셋
      audio.addEventListener('loadedmetadata', reset, { once: true });
      audio.addEventListener('loadeddata', reset, { once: true });
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
      // 텍스트 검색
      searchByText(query);
    }
  }

  /**
   * 키보드 입력 처리
   */
  function handleKeyDown(event) {
    // ESC 키로 하이라이트 제거
    if (event.key === 'Escape') {
      clearHighlight();
      searchInput.blur();
    }
  }

  /**
   * 절 참조로 검색
   */
  function searchByReference(bookName, chapter, verse) {
    // 현재 페이지의 책 이름과 장 번호 추출
    const articleId = document.querySelector('article').id;
    const currentMatch = articleId.match(/^(.+?)-(\d+)$/);

    if (!currentMatch) {
      showMessage('현재 페이지 정보를 찾을 수 없습니다.', 'error');
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
        showMessage(`${bookName} ${chapter}:${verse}로 이동했습니다.`, 'success');
        // URL 해시 업데이트
        history.replaceState(null, null, `#${verseId}`);
      } else {
        showMessage(`${bookName} ${chapter}:${verse}를 찾을 수 없습니다.`, 'error');
      }
    } else {
      // 다른 책/장 → 파일로 리다이렉트
      const slug = abbrToSlug[targetBookAbbr];
      if (!slug) {
        showMessage('해당 책을 찾을 수 없습니다.', 'error');
        return;
      }
      const basePath = window.location.pathname.replace(/[^/]+$/, '');
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
          verse.scrollIntoView({ behavior: 'smooth', block: 'center' });
          found = true;
        }
      }
    }

    if (found) {
      showMessage(`"${query}" 검색 완료`, 'success');
    } else {
      showMessage(`"${query}"를 찾을 수 없습니다.`, 'error');
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
    verseElement.classList.add('verse-highlight');
    currentHighlight = verseElement;

    // 해당 요소로 스크롤
    verseElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // 포커스 설정 (접근성)
    verseElement.setAttribute('tabindex', '-1');
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

    while (node = walker.nextNode()) {
      if (node.parentElement.classList.contains('verse-number') ||
        node.parentElement.classList.contains('paragraph-marker')) {
        continue; // 절 번호나 단락 마커는 제외
      }
      textNodes.push(node);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');

      if (regex.test(text)) {
        const highlightedText = text.replace(regex, '<span class="text-highlight">$1</span>');
        const wrapper = document.createElement('div');
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
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 하이라이트 제거
   */
  function clearHighlight() {
    if (currentHighlight) {
      currentHighlight.classList.remove('verse-highlight');
      currentHighlight.removeAttribute('tabindex');
      currentHighlight = null;
    }

    clearTextHighlight();
  }

  /**
   * 텍스트 하이라이트 제거
   */
  function clearTextHighlight() {
    const highlighted = document.querySelectorAll('.text-highlight');
    for (const element of highlighted) {
      const parent = element.parentNode;
      parent.replaceChild(document.createTextNode(element.textContent), element);
      parent.normalize();
    }
  }

  /**
   * 메시지 표시
   */
  function showMessage(message, type = 'info') {
    // 기존 메시지 제거
    const existingMessage = document.querySelector('.search-message');
    if (existingMessage) {
      existingMessage.remove();
    }

    // 새 메시지 생성
    const messageElement = document.createElement('div');
    messageElement.className = `search-message search-message-${type}`;
    messageElement.textContent = message;
    messageElement.setAttribute('role', 'status');
    messageElement.setAttribute('aria-live', 'polite');

    // 스타일 적용
    Object.assign(messageElement.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '10px 15px',
      borderRadius: '4px',
      color: 'white',
      fontWeight: 'bold',
      zIndex: '1000',
      opacity: '0',
      transition: 'opacity 0.3s ease'
    });

    // 타입별 색상
    switch (type) {
      case 'success':
        messageElement.style.backgroundColor = '#28a745';
        break;
      case 'error':
        messageElement.style.backgroundColor = '#dc3545';
        break;
      case 'info':
      default:
        messageElement.style.backgroundColor = '#17a2b8';
        break;
    }

    document.body.appendChild(messageElement);

    // 애니메이션
    setTimeout(() => {
      messageElement.style.opacity = '1';
    }, 10);

    // 3초 후 제거
    setTimeout(() => {
      messageElement.style.opacity = '0';
      setTimeout(() => {
        if (messageElement.parentNode) {
          messageElement.parentNode.removeChild(messageElement);
        }
      }, 300);
    }, 3000);
  }

  // DOM 로드 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 전역 접근을 위한 API 노출
  window.BibleNavigator = {
    highlightVerse: highlightVerse,
    clearHighlight: clearHighlight,
    searchByText: searchByText
  };

})();
