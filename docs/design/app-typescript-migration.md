# app.js TypeScript 점진 도입 — 설계 문서

> 이 문서는 `js/app.js`(현재 ~5,854줄)에 ADR-012 방식의 정적 타입 검사를 도입하는 다단계 작업의 진행 상황을 함께 추적한다. 각 PR 머지 후 갱신한다.
> 시점 고정 결정 기록은 ADR-012 본문 + 머지 시 추가될 `> **개정 (날짜):**` 블록 참조.

- 작성: 2026-05-09
- 상태: PR-1 진행 중
- 관련 ADR: ADR-001(SPA), ADR-012(TS 점진 도입), ADR-013(유닛 테스트)

---

## 1. 개요

### 1.1 목적

ADR-012의 1차 적용 범위(`js/sync/*`, `js/drive-sync.js`, `js/search-worker.js`)에서 보류됐던 `js/app.js`에 동일한 방식(`// @ts-check` + JSDoc + `tsc --noEmit`)으로 정적 타입 검사를 도입한다. Phase 2b~2f에서 sync 레이어의 결함 패턴(누락 키 갱신, 부분 응답 미처리, 워커 페이로드 키 오타, 상수 중복)이 정적 검사로 차단됐던 효과를 라우팅·렌더링·검색·북마크·오디오·설정 영역까지 확장하는 것이 목표.

### 1.2 대상 범위

- `js/app.js` — 본 작업의 단일 대상
- `js/types.d.ts` — 도메인 타입 단일 출처. 본 작업에서 신규 타입 다수 추가
- `tsconfig.json` — 변경 없음 (이미 `js/**/*.js` include + `checkJs: false` opt-in)
- `tsconfig.app.json` — **임시** 신설 (PR-1), PR-7에서 삭제

### 1.3 비대상

- 파일 분할 리팩터링 — 별도 의제로 미룸 (메모리 `project_inflight_work.md` 참조)
- 빌드 단계 신설 — ADR-001 SPA 단순성 유지, 브라우저는 원본 `.js` 그대로 로드
- CI에 `npx tsc --noEmit` 통합 — ADR-012 후속 작업 항목, 본 작업과 분리. `package.json` 신설이 선행되어야 함

---

## 2. 현재 코드베이스 (출발점)

### 2.1 ADR-012 1차 적용 현황 (Phase 2h 종료 시점)

`// @ts-check` + JSDoc 적용 완료:

- `js/sync/state-machine.js`, `transport.js`, `store-v2.js`, `debug-log.js`, `refresh-store.js`
- `js/drive-sync.js`
- `js/search-worker.js` (`tsconfig.worker.json`, `lib: WebWorker`)

도메인 타입 단일 출처: `js/types.d.ts` — `MTimed<T>`, `SyncDoc`, `SyncEvent`, `SyncMachine`, `SyncTransport`, `RefreshTokenStore`, `BibleAudioCache` 등. `Window` 인터페이스에 `applyFontSize` / `applyColorScheme` / `applyTheme` / `renderBookmarkTree` / `_showSyncSnackbar` / `rebuildDriveSyncSection`이 이미 선언돼 있어 호출 측은 타입 안전, **정의 측(app.js)이 아직 미적용** 상태.

### 2.2 app.js 섹션 지도 (5,854줄, 41개 섹션)

| 라인        | 섹션                               | 줄 수 |
| ----------- | ---------------------------------- | ----- |
| L1-L34      | 모듈 헤드 (DOM anchor + 모듈 상태) | 34    |
| L35-L81     | Accessibility                      | 47    |
| L82-L108    | Reading position persistence       | 27    |
| L109-L188   | Bookmark state                     | 80    |
| L189-L241   | Audio cache LRU helpers (ADR-016)  | 53    |
| L242-L412   | Pull-to-refresh                    | 171   |
| L413-L471   | Search history helpers             | 59    |
| L472-L490   | Font size                          | 19    |
| L491-L513   | Cache management                   | 23    |
| L514-L893   | Settings popover                   | 380   |
| L894-L961   | Icon recoloring                    | 68    |
| L962-L1006  | Color scheme                       | 45    |
| L1007-L1048 | Theme                              | 42    |
| L1049-L1070 | Book order                         | 22    |
| L1071-L1114 | Launch Screen                      | 44    |
| L1115-L1136 | Helpers                            | 22    |
| L1137-L1159 | Bookmark storage helpers           | 23    |
| L1160-L1270 | Verse spec utilities               | 111   |
| L1271-L1343 | Bookmark query helpers             | 73    |
| L1344-L1617 | Drag & drop helpers                | 274   |
| L1618-L1654 | Data fetching                      | 37    |
| L1655-L1856 | Rendering helpers                  | 202   |
| L1857-L2489 | Views                              | 633   |
| L2490-L2790 | Routing                            | 301   |
| L2791-L3021 | Audio Player                       | 231   |
| L3022-L3277 | Search                             | 256   |
| L3278-L3340 | Search input handlers              | 63    |
| L3341-L3389 | Search bottom sheet                | 49    |
| L3390-L4006 | Search history panel controller    | 617   |
| L4007-L4026 | Compact Header on Scroll           | 20    |
| L4027-L4116 | PWA install detection              | 90    |
| L4117-L4414 | Install guide modal                | 298   |
| L4415-L4453 | Install nudge auto-show            | 39    |
| L4454-L4655 | Bookmark UI                        | 202   |
| L4656-L5171 | Bookmark tree rendering            | 516   |
| L5172-L5359 | Save bookmark modal                | 188   |
| L5360-L5438 | Merge dialog                       | 79    |
| L5439-L5555 | Export/Import bookmarks            | 117   |
| L5556-L5607 | Verse selection mode               | 52    |
| L5608-L5754 | Drawer toolbar                     | 147   |
| L5755-L5854 | Service Worker registration        | 100   |

### 2.3 핫스팟 분포

- `JSON.parse(localStorage.getItem(...))` (~6곳): L165, L179, L425, L1147, L4420, L5700
- `localStorage.getItem` → `string | null` (~6곳): L463, L476, L966, L1011, L1053, L1146
- `document.querySelector` → `HTMLElement | null` (~7곳): L954, L956, L992, L1027, L2569-L2573
- Array 콜백 분해 implicit any (~6곳): L1787, L2315, L3414, L3429, L4075, L4161
- `fetch().json()` → `unknown` (~4곳): L1623, L1635, L1646, L1652

기존 JSDoc 흔적: 2블록만 (L4739, L4808). 사실상 백지 상태.

---

## 3. 단계 분할 (7개 PR)

분할 단위는 [섹션 지도](#22-appjs-섹션-지도-5854줄-41개-섹션)의 자연 경계를 따른다. 각 PR은 그 영역의 JSDoc 추가 + 필요한 도메인 타입을 `types.d.ts`에 누적. **PR-1~6은 영구 `// @ts-check`를 켜지 않는다** — 검증은 임시 `tsconfig.app.json`의 `checkJs: true`로 강제. PR-7에서 `// @ts-check`를 영구 활성화 + 임시 tsconfig 삭제.

### 진행 매트릭스

| PR   | 영역                                                                                                         | 라인 범위   | 상태                  | 머지 PR |
| ---- | ------------------------------------------------------------------------------------------------------------ | ----------- | --------------------- | ------- |
| PR-1 | 헤드 + 접근성 + 읽기위치 + 오디오 LRU + PTR + 검색 히스토리 + 폰트 + 캐시                                    | L1-L513     | 머지 완료             | [#81](https://github.com/anglican-kr/common-bible/pull/81) |
| PR-2 | 설정 팝오버 + 아이콘 + 컬러 스킴 + 테마 + 책 순서 + 런치 스크린 + 헬퍼 + 북마크 스토리지                     | L595-L1273 (PR-1 머지 후 라인) | 작성 완료 (커밋 대기) | —       |
| PR-3 | 절 스펙 + 북마크 쿼리 + 드래그앤드롭 + 데이터 페칭 + 렌더링 헬퍼 + Views                                     | L1160-L2489 | 대기                  | —       |
| PR-4 | 라우팅 + 오디오 플레이어                                                                                     | L2490-L3021 | 대기                  | —       |
| PR-5 | 검색 + 검색 시트 + 검색 히스토리 패널                                                                        | L3022-L4006 | 대기                  | —       |
| PR-6 | 컴팩트 헤더 + PWA 감지 + 설치 안내 + 북마크 UI + 트리 렌더링 + 저장/병합 모달                                | L4007-L5438 | 대기                  | —       |
| PR-7 | 내보내기/가져오기 + 절 선택 + 드로어 + SW 등록 + 최종 통합 (`// @ts-check` 영구화, `tsconfig.app.json` 삭제) | L5439-L5854 | 대기                  | —       |

---

## 4. 임시 `tsconfig.app.json` 운영 정책

### 4.1 형태 (PR-1 신설)

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "checkJs": true,
    "noImplicitAny": false, // PR-7에서 true로 전환 후 파일 자체 삭제
  },
  "include": ["js/app.js", "js/types.d.ts"],
  "exclude": ["js/search-worker.js"],
}
```

### 4.2 운영 원칙

- `checkJs: true`: 파일 헤드의 `// @ts-check` 없이도 강제 검사. 진행 중 영역의 JSDoc 정확도를 즉시 검증할 수 있게 함.
- `noImplicitAny: false`: 단계 진행 중에는 implicit any를 허용. 핵심은 `null` 검사 + 도메인 타입 불일치만 잡는다. 모든 함수에 한 번에 매개변수 타입을 달지 못하기 때문.
- 검증 명령: `npx tsc -p tsconfig.app.json --noEmit`. 각 PR 머지 전 0 error 또는 알려진 잔여 목록 명시.
- 메인 `tsconfig.json`은 변경하지 않음 — 1차 적용 파일들의 검증 흐름을 깨지 않기 위함.

### 4.3 PR-7 통합

1. `tsconfig.app.json`의 `noImplicitAny: true`로 전환
2. 잔여 implicit any 정리
3. `js/app.js` L1에 `// @ts-check` 추가
4. `tsconfig.app.json` 삭제 — 메인 `tsconfig.json`이 이미 `js/**/*.js`를 include + `checkJs: false`로 opt-in 방식이므로, `// @ts-check` 한 줄로 영구 활성
5. `npx tsc -p tsconfig.json --noEmit` 0 error 확인

---

## 5. `js/types.d.ts` 신규 도메인 타입 (누적)

PR 진행에 따라 추가되는 도메인 타입을 한곳에서 추적. 실제 구조는 코드를 읽어 확정.

### 5.1 PR-1 추가 예정

- `ReadingPosition` — `{ bookId: string; chapter: number; verse: number | null }` (`STORAGE_KEY = "bible-last-read"`). 기존 `LastReadValue`(`verseSpec?: string`)와 형태가 다름 — 코드 실제 형태가 권위 출처, 차이는 주석으로 명시
- `AudioPosition` — `{ bookId: string; chapter: number; time: number }` (`AUDIO_POS_KEY`)
- `SearchHistoryList` — `string[]` (`SEARCH_HISTORY_KEY`, 정규화 + LRU)
- `VerseSelectDrag` — `{ startIdx: number; allVerses: HTMLElement[]; isAdding: boolean; moved: boolean }` (모듈 상태 `_verseSelectDrag`)
- `DragState` — `{ id: string; ghost: HTMLElement; origLi: HTMLElement; startY: number; origTop: number }` (모듈 상태 `_dragState`)

### 5.2 PR-2 이후 (참고용 — 실제 구조는 그 PR에서 확정)

- `InstallNudgeState` — `{ visits: number; nextShow: number; neverShow: boolean }` (PR-6에서 사용. 단일 출처 보장 위해 PR-1 또는 PR-2에서 선제 정의 가능)
- `ColorSchemeId` — string literal union (`"navy" | "terracotta" | "green" | "purple"`)
- `ThemeMode` — string literal union (실제 값 확인 후 확정)
- `StartupBehavior` — `"resume" | "home"` (이미 `SettingKey`에 있음 — 값 union을 별도로 노출)
- `BookOrder` — string literal union (실제 값 확인 후 확정)
- `BooksData` (PR-3) — `data/books.json` 파싱 결과. 실제 키는 `id`, `name_ko`, `short_name_ko`, `name_en`, `division`, `chapter_count`, `has_prologue`
- `BibleChapter` (PR-3) — `data/bible/{book_id}-{chapter}.json` 파싱 결과
- `SearchInitMessage` / `SearchQueryMessage` / `SearchResultMessage` (PR-5) — `js/search-worker.js`의 in/out 페이로드. 워커 측 JSDoc(`InitMessage`, `SearchMessage`)과 양쪽이 동일 export를 import하도록 정합

---

## 6. 검증 절차

### 6.1 각 PR (CI는 변경 없음)

```bash
npx tsc -p tsconfig.app.json --noEmit       # PR-1~6: 진행 중인 영역 검증
npx tsc -p tsconfig.json --noEmit           # PR-7 이후: 메인 통합 검증
npx tsc -p tsconfig.worker.json --noEmit    # 회귀 확인 (워커 lib 충돌 점검)
node --test tests/unit/*.test.js            # 회귀 확인 (영향 없어야 함, 78 케이스)
```

브라우저 동작은 변경 없음 (주석만 추가). 런타임 회귀 위험은 본질적으로 없으나, 잘못된 JSDoc 표기가 검사 통과 후에도 의도와 어긋날 수는 있어 PR-7 머지 후 e2e 회귀 1회 수동 확인.

### 6.2 PR-7 머지 후 (전체 회귀)

CLAUDE.md `tests/e2e/` 절차를 따라 사용자가 수동 실행:

- `test_search.py` — 검색 파이프라인 + 새로고침 회귀
- `test_navigation.py` — URL 라우팅 8케이스
- `test_copy.py` — 클립보드 복사 경계
- `test_install_guide.py` — 플랫폼별 설치 안내
- `test_features.py` — 이어읽기 배너, 모바일 FAB
- `test_drive_sync.py` — Drive 동기화 (회귀 위험 가장 큼)
- `test_drive_sync_ios.py` — iOS OAuth 풀페이지 리디렉션

---

## 7. ADR 갱신 정책

- PR-7 머지 시 ADR-012에 `> **개정 (날짜):**` 블록 추가 — 2차 적용 완료, 적용 범위에 `js/app.js` 명시.
- 본 설계 문서는 PR-7 머지 후 "마이그레이션 완료" 상태로 표기. 이후에도 도메인 타입 갱신 이력 추적용으로 유지.
- 메모리 `project_inflight_work.md` "추후 점진 확장 후보"에서 `js/app.js` 항목 제거.

---

## 8. 진행 일지

| 일자       | 단계           | 내용                                                                                                                                                                                                                                                                                                        |
| ---------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-09 | PR-1 시작      | 본 설계 문서 초안 작성, `feat/app-jsdoc-pr1` 브랜치 분기                                                                                                                                                                                                                                                    |
| 2026-05-09 | PR-1 작성 완료 | `tsconfig.app.json` 신설, `js/types.d.ts`에 5종(`ReadingPosition`, `AudioPosition`, `SearchHistoryList`, `VerseSelectDrag`, `DragState`) 추가, `js/app.js` L1-L513 JSDoc 보강. baseline 428 → 잔여 282 (PR-1 영역 0). main `tsconfig.json`/`tsconfig.worker.json` 0 error 회귀 없음, 유닛 테스트 111건 통과 |
| 2026-05-09 | PR-1 머지 (#81) | CI Unit tests + Cursor Bugbot 모두 green, main 통합 |
| 2026-05-09 | PR-2 작성 완료 | `js/types.d.ts`에 4종(`ColorSchemeId`, `ThemeMode`, `BookOrderKind`, `ColorSchemeEntry`) 추가, `js/app.js` L595-L1273 JSDoc 보강. baseline 282 → 잔여 294. PR-2 영역 0 에러. **`el()` generic narrow의 부작용으로 PR-3+ 영역(L1515-L2686)에 잠재 결함 22건 신규 노출** — 후속 PR에서 흡수 (이전엔 implicit any에 묻혀있던 strictNullChecks 위반). main + worker tsc 0 error, 유닛 111건 통과 |
