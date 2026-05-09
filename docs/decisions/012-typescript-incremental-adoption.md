# ADR-012: TypeScript 점진 도입 (JSDoc + `// @ts-check`)

- 일시: 2026-05-06
- 상태: 승인됨 (1차 sync 레이어 + search worker 적용 완료)

## 결정

빌드 단계를 추가하지 않은 채로 TypeScript 타입 체크를 도입한다. 구현 방식은 **`// @ts-check` + JSDoc 타입 주석** + **`tsconfig.json --noEmit`**. 적용 범위는 동기화 레이어와 검색 워커를 1차로 하고, `js/app.js`(라우팅·렌더링·UI)는 추후 단계로 보류한다.

## 맥락

ADR-001은 "프레임워크 없는 Vanilla JS"를 선언하고 있고 ADR-005·010·011이 누적되며 클라이언트 JS는 이미 5,000줄을 넘는다. Phase 2b~2f를 진행하면서 다음과 같은 결함 패턴이 반복적으로 나타났다.

- `_ctx.reAuthFails`처럼 **암묵적인 컨텍스트 키**가 한 곳에서만 갱신되거나 누락
- GIS Token Client / Identity Client 응답 객체의 **부분적인 형태**(error 없음 + access_token 없음)에 대한 분기 누락
- 서비스 워커 `postMessage` 페이로드의 키 오타가 런타임까지 살아있어 토스트가 잘못된 버전을 표시
- redirect attempts 키 같은 **상수의 중복 하드코딩**

이 결함들은 모두 정적 검사로 사전에 잡을 수 있는 종류였다. 동시에 Phase 2의 OAuth 흐름은 검수 후에는 함부로 손대기 어려운 코드라 추후 회귀 비용도 높다.

## 검토한 대안

| 방식 | 빌드 변화 | 진입 비용 | 채택 |
| --- | --- | --- | --- |
| `.ts` 파일 + tsc 빌드 산출물 배포 | 빌드 파이프라인 신설, 소스맵, 캐시 무효화 정책 재설계 | 큼 | ❌ — ADR-001 SPA 단순성 훼손 |
| `// @ts-check` + JSDoc + `tsc --noEmit` | 없음 (브라우저는 그대로 `.js`) | 작음 | ✅ |
| ESLint + JSDoc 룰만 사용 | 없음 | 작음 | ❌ — 흐름 분석/추론 부족 |
| Flow / TypeScript JSX(.jsx) | 빌드 변화 큼 | 큼 | ❌ |

## 적용 방식

### 파일 헤더

```js
// @ts-check
// ...module description...
```

### 도메인 타입 단일 출처

`js/types.d.ts` 하나에 동기화 레이어가 공유하는 도메인 타입을 정의한다.

- `MTimed<T>` — per-record mtime wrapper (`{ v: T | null, _u: number }`)
- 북마크: `BookmarkTreeBookmark | BookmarkTreeFolder | BookmarkFlatRow`
- 동기화 문서: `SyncDocV1`, `SyncDocV2`
- 상태 머신 이벤트: `SyncEvent`(union), `SyncState`(string literal)
- GIS 응답: `TokenResponse`, `IdCredentialResponse`(부분 응답 허용 케이스 명시)
- 글로벌 싱글톤: `interface Window { syncTransport, driveSyncMachine, __pendingRedirectToken, __driveSyncInteractionTs }`

다른 모듈은 JSDoc `@typedef {import("../types").Foo} Foo` 로 가져와 사용한다.

### tsconfig 분리

| 파일 | 대상 | lib |
| --- | --- | --- |
| `tsconfig.json` | DOM 모듈 (`js/**/*.js`, `js/types.d.ts`) | `["DOM", "DOM.Iterable", "ES2022"]` |
| `tsconfig.worker.json` | `js/search-worker.js` (Web Worker) | `["WebWorker", "ES2022"]` |

워커는 메인 스레드와 글로벌이 다르므로(`window` 없음, `self`만 존재) 분리하지 않으면 양쪽 모두에서 타입 오류가 난다. 메인 tsconfig는 워커 파일을 `exclude`로 빼고, 워커 tsconfig는 `include` 단일 파일로 한정.

### 컴파일러 옵션

- `allowJs: true` + `checkJs: false` — 파일별 opt-in (`// @ts-check`)
- `noEmit: true` — 산출물 없음, 브라우저는 원본 `.js` 그대로 로드
- `strict: true` + `noImplicitAny` + `strictNullChecks` — 점진 도입 시에도 새 코드는 엄격 모드
- `skipLibCheck: true` — 외부 타입(특히 `lib.dom.d.ts` × Web Worker 충돌) 검사 생략

## 1차 적용 범위 (2026-05-06)

| 파일 | 비고 |
| --- | --- |
| `js/sync/debug-log.js` | ring buffer + 마스킹 |
| `js/sync/transport.js` | GIS 응답 정규화, `IdentityCallback`, `TokenCallback` 시그니처 |
| `js/sync/store-v2.js` | `MTimed<T>`, `mergeDocs`, flat-map ↔ tree 변환 |
| `js/sync/state-machine.js` | `SyncEvent` union을 `_transition` 입력에 강제 |
| `js/drive-sync.js` | window.* 싱글톤 노출, `acceptRedirectToken` 시그니처 |
| `js/search-worker.js` | `parseQuery`, `restrictBooks`, `unmatchedScopes` 타입 (워커 tsconfig) |

`js/app.js`는 다음 사이클로 보류 — 라우팅·DOM 조작·접근성 트리 코드가 섞여 있어 1차 PR에서 분리하기에 변경 폭이 크다.

## 검증

- `npx tsc -p tsconfig.json --noEmit` — 0 error (적용 범위 한정)
- `npx tsc -p tsconfig.worker.json --noEmit` — 0 error
- 브라우저 동작: 변경 없음 (원본 `.js` 로드, JSDoc은 주석)

## 채택 이유 요약

- **빌드 파이프라인 0 변경**: ADR-001의 SPA 아키텍처를 훼손하지 않음. 서비스 워커 캐시·배포 zip 구성도 그대로.
- **점진 도입 가능**: `// @ts-check`가 파일 단위 opt-in이라 한 PR에 한 모듈씩 적용. 도입 도중 깨지는 모듈 없음.
- **도메인 타입 1개 파일**: GIS 응답·MTimed wrapper·BookmarkFlatRow 같은 핵심 도메인이 한 곳에 모여 ADR-011 데이터 스키마와 코드 간 표류 차단.
- **유닛 테스트와 시너지**: ADR-013의 Node 자체 테스트 러너도 `--test` 만으로 `.js`를 그대로 임포트. TypeScript 빌드 산출물이 없어 테스트와 런타임이 동일 파일을 본다.

## 결과

- Phase 2b~2f 정제 과정에서 발견된 결함 패턴(누락 키 갱신, 부분 응답 미처리, 상수 중복) 대부분이 정적 검사 단계에서 차단 가능
- `js/types.d.ts`는 ADR-011 스키마 변경 시 first-class 갱신 대상 — ADR ↔ 코드 표류 감지점
- 추후 단계: `js/app.js` 적용 (라우팅·UI·접근성), `tests/unit/*.js` 적용

## 관련 ADR

- ADR-001: SPA 아키텍처 — 빌드 단계 회피의 출발점
- ADR-011: 북마크 동기화 — 도메인 타입의 주요 소비자
- ADR-013: 클라이언트 JS 유닛 테스트 전략 — 같은 사이클에 도입

---

> **개정 (2026-05-09): `js/app.js` 2차 적용 1라운드 완료**
>
> 1차 적용에서 보류했던 `js/app.js`(~5,800줄)에 7단계 분할 PR(#81~#87)로 JSDoc + null/도메인 타입 가드를 도입. 살아있는 설계 문서: `docs/design/app-typescript-migration.md`.
>
> **추가된 도메인 타입 (`js/types.d.ts`)**: `ReadingPosition`, `AudioPosition`, `SearchHistoryList`, `VerseSelectDrag`, `DragState`, `ColorSchemeId`, `ThemeMode`, `BookOrderKind`, `ColorSchemeEntry`, `BookEntry`, `BooksData`, `BibleVerseSegment`, `BibleVerse`, `BibleChapter`, `BiblePrologue`, `Window.booksPromise`. `ReadingPosition.chapter`는 `number | "prologue"` union으로 narrow.
>
> **운영 패턴**: `_$` 헬퍼(L20)로 모든 모듈-수준 anchor를 `getElementById` 결과로 통일(HTMLElement non-null cast). input/button/file input은 사용 측에서 더 narrow한 cast(`HTMLInputElement`, `HTMLButtonElement`).
>
> **임시 인프라**: `tsconfig.app.json`(`checkJs: true`, `noImplicitAny: false`)을 두어 단계별 검증. `js/app.js` 헤드의 `// @ts-check` 영구 활성화와 `tsconfig.app.json` 삭제는 **`js/app.js` 파일 분할(modularization) 리팩터링과 결합한 별도 의제로 보류** — 5,800줄 단일 파일에 `noImplicitAny: true`를 일거에 적용하면 ~262 implicit any가 발생하는데, 이를 모듈 단위로 옵트인해 정리하는 게 자연스럽기 때문.
>
> **다음 라운드 트리거**: `js/app.js` 분할 리팩터링 의제 시작 시점. 본 ADR 본문의 검토한 대안 표에 "`.ts` 파일 + tsc 빌드 산출물 배포: ❌ ADR-001 SPA 단순성 훼손" 결정은 그대로 유효.
