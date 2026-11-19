---
pr: 614
date: 2026-11-20
branch: chore/remove-morph-css
title: "refactor: 쓰이지 않는 하단 검색 입력창 CSS 제거"
---

## 요약

ADR-048의 2단계다. 1단계(#612)에서 휴대폰의 검색 입력창을 검색 화면 위쪽으로 옮기고 하단 입력창의 마크업과 스크립트를 지웠다. 이 PR은 하단 입력창과 키보드 위로 올리기에 쓰던 CSS 규칙을 지운다. 맞는 요소가 없어 아무 일도 하지 않던 규칙이라, 화면과 동작은 바뀌지 않는다. ADR-048을 구현 완료로 바꾼다.

## 확정 · 근거

- 사용자 지시(2026-11-20): 쓰이지 않는 CSS를 지운다. `docs/topics/routing.md` 「남은 일」에 적어 둔 2단계다.
- 지운 것
  - 하단 입력창이 쓰던 규칙: `#tab-dock.searching`과 그 아래 규칙 전부, `body.tabbar-searching`, `body.tabbar-keyboard`, `#tab-search-input`, `#tab-search-clear`, `#tab-search-close`.
  - `#tab-dock`의 `bottom`에 더하던 `--kb-overlap`(키보드 높이). 이 값을 넣던 스크립트는 1단계에서 지웠다.
  - 하단 입력창이 넓어질 때만 쓰던 트랜지션(`#tab-search-dock`의 `flex-grow`, `#tab-search`의 `width`). `#tab-search`의 나머지 트랜지션(누를 때 줄어들기, 검색 화면에서 바탕색 바뀌기)은 기본 규칙으로 합쳤다.
- 남긴 것
  - 스크롤 축소(`#tab-dock.collapsed`)가 함께 쓰던 규칙에서는 `.searching` 선택자만 뺐다(홈 원형, 탭 접기, 인디케이터 숨기기, 가로 화면에서 탭 바를 펴 두기). 그 블록의 제목도 검색 모핑에서 스크롤 축소로 바꿨다.
  - 가로 화면의 이어 읽기 알약 단추와 넓은 가로 화면의 오디오 바에 붙어 있던 「검색 중이 아닐 때」 조건(`:not(.tabbar-searching)`)을 뺐다. 선택자의 우선순위가 낮아졌으나, 아래 「검증」의 계산된 스타일 비교에서 결과가 같았다.
  - `#tab-search-dock`은 검색 원형을 감싸는 자리로 남는다.
- 지워진 요소를 설명하던 주석을 고쳤다(CSS와 `search.js`).

## 검증

- `npm run typecheck` 통과, `node --test tests/unit/*.test.js` 1,949개 통과.
- 계산된 스타일 비교. 지우기 전후에 같은 130개 상태에서 하단 탭 바, 오디오 바, 이어 읽기 단추, 휴대폰 위쪽 검색 입력창, 데스크톱 검색창과 그 안의 모든 요소(가상 요소 포함)의 계산된 스타일과 위치를 재어 비교했다. 상태는 다섯 화면 크기(휴대폰 세로 390px, 가로 844px, 가로 568px, 320px, 데스크톱)와 네 화면(성서 목록, 장, 최근 검색, 검색 결과)마다 스크롤 축소의 켜고 끔, 오디오 바와 이어 읽기 단추의 있고 없음을 곱한 것이다. 다크 모드와 동작 줄이기, 투명도 줄이기 설정도 더했다.
  - 다른 값은 지운 트랜지션뿐이었다(`#tab-search-dock`의 `flex-grow`, `#tab-search`의 `width`). 위치, 크기, 색, 표시 여부는 모두 같았다.
  - 한 상태(320px 검색 결과, 스크롤 축소)에서 책 선택 깔때기 자리의 폭이 한 번 다르게 나왔다. 지운 뒤의 CSS로 같은 상태를 네 번 다시 재니 모두 지우기 전과 같아, 잴 때의 시점 차이로 보았다.
- e2e `test_tabbar.py`, `test_book_name_swap.py`, `test_top_bar.py`, `test_features.py`, `test_bookmark.py`, `test_calendar_view.py` 210개를 작업 폴더 서버(8095)에서 돌려 모두 통과했다.

## 갱신한 문서

- `docs/decisions/048-mobile-search-input-on-top.md`: 상태를 구현 완료(2026-11-20)로.
- `docs/architecture.md`: 부록 A의 ADR 목록에서 ADR-048을 구현 완료(2026-11-20)로.
- `docs/decisions/030-morphing-tab-bar.md`: §1, §2, §5, 「구현 메모」, 「적용 확장」의 이어 읽기 항목에 검색 모핑 부분을 ADR-048이 대체했다는 안내. §3과 §6에는 1단계에서 넣었다.
- `docs/decisions/033-search-options.md`: 토큰 자리를 끼우는 필드를 셋에서 둘로(하단 모핑 pill을 뺌). 모핑 pill의 토큰 항목을 지웠다.
- `docs/topics/routing.md`: 「남은 일」의 CSS 정리 항목을 지우고, 「결정」의 ADR-048 줄에서 「CSS 정리 남음」을 뺐다.
- `DESIGN.md`: 탭 바의 인디케이터, 슬롯 크기, 글래스 질감 문장에서 검색 모핑을 뺐다. §7 상태 블록에 ADR-048이 대체했다는 말을 더했다.
