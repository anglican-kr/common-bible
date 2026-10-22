# 검색

소유 코드: `js/app/search.js`, `js/search-worker.js`

본문 검색(Web Worker와 청크 인덱스), 검색 옵션, 검색 기록을 다룬다. 검색 인덱스는 `common-bible-data`의 파이프라인이 만든다.

## 지금 동작

- **검색 옵션 완료** — ADR-033, 2026-06-07(개정 2026-06-09). 검색 필드 안 토큰(ADR-033 개정 B): 책 picker(분류별 다중 선택 시트 `#book-filter-sheet`, 선택 책=제거 가능한 칩, 워커 `restrictBooks` 재사용). 빈 쿼리로 `/search` 진입 시 최근 검색 목록(행 우측에 검색 날짜 절대표기 `YYYY. M. D.` — ADR-014 개정으로 저장 모델에 `ts` 추가·`string[]`→`{q,ts}` 자동 마이그레이션; 헤더 ▾ 드롭다운과 `bible-search-history` 공유). 필터 상태는 URL 인코딩(`?q&in&page`)으로 히스토리·탭 복원(ADR-031)·페이지네이션·공유 일관. 시트는 `createOverlay`(ADR-032) 재사용. **'결과 내 검색'(AND)은 2026-06-09 제거** — 좁히기 크롬의 UX 문제(모바일 공간 잠식·데스크탑 겹침·× 액션 미정의), ADR-033 개정. 상세는 ADR-033·ADR-014.

## 결정

- ADR-005 「검색 인덱싱 전략」
- ADR-014 「검색 히스토리 + 검색 입력창 터치 타깃」
- ADR-033 「검색 옵션」
- 구조는 `architecture.md` §4.2와 `js/search-worker.js` 머리 주석에 있다.

## 남은 일

없음
