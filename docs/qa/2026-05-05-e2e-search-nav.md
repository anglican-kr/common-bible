# E2E 테스트 보고서: Phase 5 — 검색·네비게이션 보강

**날짜:** 2026-05-05
**범위:** Phase 5 — 검색 결과 클릭, ref-card, hl 파라미터, 책/장 목록 이동, 장 선택 팝오버

## 1. 실행 환경

| 항목 | 값 |
|------|----|
| Python | 3.12.12 / pytest 9.0.2 / playwright 0.7.2 / Chromium 145.0.7632.6 |

## 2. 실행 결과

| 항목 | 값 |
|------|----|
| 신규 테스트 | 6건 (search +3, navigation +3) |
| 전체 e2e 테스트 | 126건 |
| 통과 | 126건 |
| 실패 | 0건 |
| 소요 시간 | 약 256초 |

## 3. 신규 시나리오

### `tests/e2e/test_search.py` 보강 (+3)

| 테스트 | 검증 내용 |
|--------|---------|
| `test_search_result_click_navigates_to_chapter` | 키워드 검색 결과 클릭 → `article.chapter-text .verse` 표시, URL = 해당 장 |
| `test_search_ref_card_click_navigates` | 구절 참조 카드(`.search-result-ref-card`) 클릭 → `/gen/1` 본문 로드 |
| `test_search_result_link_contains_hl_param` | 검색 결과 `a` 링크의 href에 `?hl=` 파라미터 포함 |

### `tests/e2e/test_navigation.py` 보강 (+3)

| 테스트 | 검증 내용 |
|--------|---------|
| `test_book_list_click_then_chapter_loads` | 홈 → `.book-list a[href='/gen']` 클릭 → `/gen` 장 목록 → `/gen/1` 클릭 → 본문 |
| `test_chapter_nav_next_btn_navigates` | `/gen/1`에서 `.chapter-nav a` last 클릭 → `/gen/2` URL |
| `test_chapter_picker_opens_and_navigates` | 장 선택 버튼 → `.chapter-popover` 열림 → 5장 링크 클릭 → `/gen/5` |

## 4. 발견된 이슈 / 중요 발견

| # | 내용 |
|---|------|
| 1 | `/gen` 링크 클릭은 `view=chapters` (장 목록 페이지)로 이동, `article.chapter-text` 없음. 홈 → 책 → 장의 2단계 네비게이션으로 테스트 수정. |

## 5. 비고

- 검색 하이라이트(`?hl=` → `mark.search-highlight`)는 기존 `test_navigation.py` 파라미터 테스트에서 이미 커버.
- 장 목록(`view=chapters`) 자체 렌더링 검증은 test_navigation.py의 `test_book_list_click_then_chapter_loads`에서 간접 확인.
