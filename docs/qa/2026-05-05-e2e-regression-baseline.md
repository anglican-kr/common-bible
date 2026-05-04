# E2E 테스트 보고서: Phase 7 — 종합 회귀 베이스라인 (1.3.0)

**날짜:** 2026-05-05
**범위:** Phase 7 — 전체 e2e 회귀 + 1.3.0 기점 베이스라인 정의
**작성자:** Joshua Huh

## 1. 실행 환경

| 항목 | 값 |
|------|----|
| Python | 3.12.12 |
| pytest | 9.0.2 |
| pytest-playwright | 0.7.2 |
| Chromium | 145.0.7632.6 |
| axe-playwright-python | 0.1.7 |
| 개발 서버 | `python3 scripts/serve.py 8080` |
| OS | Linux 6.12.0-124.52.1.el10_1.x86_64 |

## 2. 실행 결과

| 항목 | 값 |
|------|----|
| **전체 e2e 테스트** | **141건** |
| 통과 | 141건 |
| 실패 | 0건 |
| 스킵 | 0건 |
| 소요 시간 | 약 274초 |
| axe-core critical/serious 위반 | **0건** |

```
141 passed in 273.51s (0:04:33)
```

## 3. 테스트 파일 현황

| 파일 | 건수 | 커버 도메인 |
|------|------|------------|
| `test_bookmark.py` | 3 | 드로어 열기, 장 저장, bm-empty → 저장 후 사라짐 |
| `test_bookmark_dnd.py` | 5 | 드래그&드롭 재정렬 (before/after/into, 순환방지) |
| `test_bookmark_edit.py` | 4 | 레이블 수정, 빈레이블 거부, 메모, 취소 |
| `test_bookmark_export_import.py` | 27 | 내보내기/가져오기(덮어쓰기·병합), 폴더, 왕복 |
| `test_bookmark_folders.py` | 8 | 폴더 생성·이름변경·삭제·펼침·영속성 |
| `test_bookmark_swipe.py` | 6 | 모바일 스와이프·롱프레스·데스크톱 무효·삭제 |
| `test_audio.py` | 6 | 바 가시성, teardown, 오류 처리 |
| `test_audio_controls.py` | 6 | 배속·재생/일시정지·seek·timeupdate·ended |
| `test_copy.py` | 2 | 절 선택 확대, 범위 선택 복사 |
| `test_drive_sync.py` | 8 | 업로드/다운로드, 충돌, 마이그레이션, 연결해제, 진단 |
| `test_features.py` | 3 | 이어읽기 배너, 모바일 FAB, 롱프레스 북마크 |
| `test_install_guide.py` | 21 | 플랫폼별 안내, 자동 넛지, 체크박스 |
| `test_navigation.py` | 11 | URL 라우팅, 책/장 목록, 다음 장, 장 선택 팝오버 |
| `test_search.py` | 7 | 키워드 검색, 절 참조, ref-card, hl 파라미터 |
| `test_settings.py` | 13 | 시작화면·책순서·글꼴·테마·색상·캐시·영속성 |
| `test_update_toast.py` | 3 | SW 업데이트 토스트·릴리스링크·SKIP_WAITING |
| `test_a11y_axe.py` | 7 | axe-core 7개 화면 critical/serious 스캔 |
| `test_a11y_keyboard.py` | 7 | Enter·Escape·포커스 트랩·포커스 복귀 |
| **합계** | **141** | |

## 4. Phase별 성과 요약

| Phase | 신규 테스트 | 주요 성과 | 발견·수정 버그 |
|-------|-----------|---------|-------------|
| 0 | 인프라 | conftest 공통 fixture, docs/qa 컨벤션 | 기존 회귀 10건(store-v2 마이그레이션·GIS stub·debounce race) |
| 1 | 12 | 1.3.0 신규 기능 전수 | 내보내기 파일명 UTC vs 로컬 날짜 버그 |
| 2 | 17 | 북마크 도메인 전수 | `folder.expanded` 무시·빈 레이블 폴백 |
| 3 | 13 | 설정 도메인 전수 | `clearAllCaches` SW unregister 예외 격리 |
| 4 | 6 | 오디오 컨트롤 전수 | `audio`가 DOM에 없어 `Audio()` constructor intercept 패턴 발견 |
| 5 | 6 | 검색·네비게이션 보강 | `/gen` = chapters 뷰 (2단계 네비게이션) |
| 6 | 14 | axe-core + 키보드 | **실제 접근성 버그 2건 수정** |
| 7 | +1 (bm-empty) | 종합 회귀 | — |

## 5. 1.3.0 기점 axe-core 위반 현황

| 화면 | critical | serious | moderate | minor |
|------|---------|---------|---------|-------|
| 홈 | 0 | 0 | — | — |
| 본문 | 0 | 0 | — | — |
| 검색 결과 | 0 | 0 | — | — |
| 북마크 드로어 | 0 | 0 | — | — |
| 설정 팝오버 | 0 | 0 | — | — |
| 저장 모달 | 0 | 0 | — | — |
| Drive 연결 해제 모달 | 0 | 0 | — | — |

(moderate/minor는 별도 백로그로 관리, 이번 베이스라인에는 미포함)

## 6. 수정된 앱 버그 목록 (테스트 과정 발견)

| # | 파일 | 내용 |
|---|------|------|
| 1 | `js/app.js` | `new Date().toISOString().slice(0,10)` → UTC 기준 → 로컬 날짜로 수정 |
| 2 | `js/app.js` | `_buildFolderItem`: `_hasActiveDescendant`만 사용 → `|| folder.expanded` 추가 |
| 3 | `js/app.js` | 폴더 클릭 핸들러: DOM 토글만 → `saveBookmarks`로 영속화 추가 |
| 4 | `js/app.js` | 빈 레이블 저장 시 `defaultLabel` 조용한 폴백 → `aria-invalid` + 저장 중단 |
| 5 | `js/app.js` | `clearAllCaches`: SW unregister 예외 시 reload 실행 안 됨 → 별도 try-catch |
| 6 | `css/style.css` | `.ot-subcategory-title` color #888 → `var(--text-muted)` (대비 3.05:1→5.54:1) |
| 7 | `js/app.js` | `li.bm-empty`에 `role="presentation"` 추가 (`role=tree` 필수 자식 위반 해소) |

## 7. 비고

- e2e는 로컬 수동 실행 전용 (CI 포함 없음, CLAUDE.md 정책 유지)
- 데스크톱 Chromium 단일 브라우저 실행 (iOS/Android는 UA 시뮬레이션)
- 스크린 리더 실제 발화 검증은 수동 QA 영역 (자동화 한계)
- Lighthouse 성능 측정은 별도 작업
