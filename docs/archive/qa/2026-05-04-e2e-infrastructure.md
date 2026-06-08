# E2E 테스트 보고서: Phase 0 — 인프라 강화 + 기존 회귀 수정

**날짜:** 2026-05-04
**범위:** Phase 0 — conftest 공통 fixture, docs/qa 컨벤션 정립, 기존 회귀 10건 수정
**작성자:** Joshua Huh

## 1. 실행 환경

| 항목 | 값 |
|------|----|
| Python | 3.12.12 |
| pytest | 9.0.2 |
| pytest-playwright | 0.7.2 |
| Chromium | 145.0.7632.6 |
| 개발 서버 | `python3 scripts/serve.py 8080` |
| OS | Linux 6.12.0-124.52.1.el10_1.x86_64 |

## 2. 실행 결과

| 항목 | 값 |
|------|----|
| 전체 e2e 테스트 | 72건 |
| 통과 | 72건 |
| 실패 | 0건 |
| 스킵 | 0건 |
| 소요 시간 | 약 145초 |

```
======================== 72 passed in 145.53s (0:02:25) ========================
```

## 3. Phase 0 변경 내역

### 3-1. conftest.py 공통 fixture 추가

`tests/e2e/conftest.py`에 후속 Phase 공통 재사용 요소 추가:

| 추가 항목 | 설명 |
|---------|------|
| `IPHONE_UA` | iPhone iOS 17.4 UA 문자열 (기존 test_features.py에서 중복 정의하던 것을 여기로 통합) |
| `MOBILE_VIEWPORT` | `{"width": 390, "height": 844}` |
| `CLEAR_APP_STORAGE` | `bible-*` 접두어 localStorage 키 14개 일괄 삭제 init script |
| `desktop_context` fixture | 기본 viewport + 스토리지 초기화된 BrowserContext |
| `mobile_context` fixture | 모바일 viewport + iPhone UA + 스토리지 초기화된 BrowserContext |
| `wait_app_ready(page)` | 기존 함수 유지 |
| `open_settings(page)` | 설정 팝오버 열기 헬퍼 |
| `close_popovers(page)` | Escape로 팝오버 닫기 헬퍼 |

### 3-2. docs/archive/qa/README.md 신설

보고서 파일명 컨벤션(`YYYY-MM-DD-e2e-{topic}.md`)과 표준 섹션 템플릿을 정의.

### 3-3. 기존 회귀 10건 수정 (Phase 0에 포함)

PR #25 (store-v2 마이그레이션) 이후 main에 머지된 채 방치되어 있던 회귀를 수정:

**원인 1 — `window.loadBookmarks/saveBookmarks` API 제거**
- store-v2 도입으로 북마크 저장소가 `bible-bookmarks` → `bible-bookmarks-v2` 키로 이전되고, 공개 API가 `window.syncStoreV2.loadBookmarks/saveBookmarks`로 교체됨.
- 테스트 헬퍼가 구 API를 사용해 빈 배열을 반환하거나 저장에 실패.

| 파일 | 수정 사항 |
|------|---------|
| `test_bookmark_export_import.py` | `_set_bookmarks` → `syncStoreV2.saveBookmarks` 사용 |
| `test_bookmark_export_import.py` | `_get_bookmarks` → `syncStoreV2.loadBookmarks` 사용 |
| `test_drive_sync.py` | `_add_bookmark` → `syncStoreV2.loadBookmarks/saveBookmarks` 사용 |
| `test_drive_sync.py` | `_bookmark_names` → `syncStoreV2.loadBookmarks` 사용 |

**원인 2 — 실제 GIS 라이브러리가 GIS stub을 덮어씀**
- `index.html:249`에서 `https://accounts.google.com/gsi/client`를 `async`로 로드.
- `page.route("**/accounts.google.com/**")`가 `/gsi/client` 요청에 대해 `route.continue_()`를 실행해 실제 라이브러리가 로드되고 `window.google`을 재정의.
- GIS stub이 무효화되어 token callback이 실행되지 않고 AUTHENTICATING 상태에 영구 정체.

| 파일 | 수정 사항 |
|------|---------|
| `test_drive_sync.py` | `FakeDrive.handle`에서 `gsi/client` URL 요청 → 빈 JS로 응답, 라이브러리 로드 차단 |

**원인 3 — scheduleUpload 300ms 디바운스 race condition**
- TOKEN_OK → IDLE 직후 SYNC_REQUEST → SYNCING이 발생하는 새 state machine 구조에서, `_enable_sync`가 `isAuthenticated()` 기반으로 변경되어 첫 sync cycle 완료 전에 return할 수 있음.
- 이후 `scheduleUpload()` (300ms debounce) + `_wait_idle()` 패턴에서 debounce 발동 전에 이미 IDLE인 상태를 감지해 즉시 return하는 race condition 발생.

| 파일 | 수정 사항 |
|------|---------|
| `test_drive_sync.py` | `_enable_sync` 변경: `isAuthenticated()` 후 추가로 IDLE wait (15,000ms) |
| `test_drive_sync.py` | `_sync_now(page, timeout)` 헬퍼 추가: `scheduleUpload + wait_for_timeout(350) + _wait_idle` |
| `test_drive_sync.py` | 모든 `scheduleUpload + _wait_idle` 쌍을 `_sync_now`로 교체 |

## 4. 발견된 이슈

기존 회귀 10건은 모두 테스트 헬퍼 수준에서 수정됨. 앱 코드 자체의 버그는 없음.

## 5. 비고

- 기존 conftest.py의 `wait_app_ready`, `base_url`, `BASE_URL`은 변경 없이 유지됨.
- `IPHONE_UA`/`MOBILE_VIEWPORT`는 conftest로 통합했으나 `test_features.py`는 현재 내부 상수를 그대로 사용 중. Phase 1 이후 신규 테스트부터 conftest 값을 참조.
- e2e는 로컬 수동 실행 전용 (CLAUDE.md 정책 유지, CI 비포함).
