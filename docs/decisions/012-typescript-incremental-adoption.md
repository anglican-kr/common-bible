# ADR-012: TypeScript 점진 도입 (JSDoc + `tsc --noEmit`)

- 일시: 2026-05-06
- 상태: 승인됨 — 구현 완료. 2026-05-06에 동기화 레이어, 2026-05-10에 앱 레이어를 들였다. 2026-10-17부터 기본 검사(`checkJs: true`)와 CI 타입 검사를 켰고, 2026-10-18에 검사 밖이던 앱 모듈을 모두 들였다. `sw.js`는 아직 어느 설정에도 없다(`docs/known-issues.md` §7).

## 결정

빌드 단계를 두지 않고 TypeScript를 **타입 검사기로만** 쓴다. JSDoc 타입 주석, `js/types.d.ts`, `tsc --noEmit`으로 검사한다. 브라우저는 원본 `.js`를 그대로 받는다.

- **대상은 `js/`의 모든 클라이언트 JS다**(`checkJs: true`). 파일에 지시문이 없어도 검사된다. 검사에서 빼야 하는 파일은 첫 줄을 `// @ts-nocheck`로 명시한다. 지금은 그런 파일이 없다(2026-10-18, 검사 밖이던 22개를 세 묶음으로 모두 들였다). 빼야 할 때는 같은 줄에 이유와 고칠 곳을 적고, 그 오류를 고치는 PR이 그 줄을 지운다.
- 설정은 둘이다. `tsconfig.json`(DOM, 앱 모듈)과 `tsconfig.worker.json`(WebWorker, 검색 워커)이다. 서비스 워커 `sw.js`는 아직 어느 설정에도 없다(known-issues §7).
- **CI의 필수 검사 「Unit tests」 잡이 `npm run typecheck`(두 설정)를 돌린다.** 타입 오류가 있으면 머지되지 않는다. 로컬에서는 편집한 뒤에 훅(`.claude/hooks/typecheck-js.sh`)이 같은 명령을 돌린다.

## 맥락

ADR-001은 "프레임워크 없는 Vanilla JS"를 선언했고, ADR-005, 010, 011이 쌓이며 클라이언트 JS는 이미 5,000줄을 넘었다. Phase 2b-2f를 진행하면서 다음 결함이 되풀이해 나타났다.

- `_ctx.reAuthFails`처럼 **드러나지 않은 컨텍스트 키**가 한 곳에서만 갱신되거나 빠졌다.
- GIS Token Client와 Identity Client 응답 객체의 **일부만 있는 모양**(error도 access_token도 없음)을 다루는 분기가 빠졌다.
- 서비스 워커 `postMessage` 페이로드의 키 오타가 실행할 때까지 남아, 토스트가 잘못된 버전을 보였다.
- redirect attempts 키 같은 **상수를 여러 곳에 하드코딩**했다.

이 결함들은 모두 정적 검사로 미리 잡을 수 있는 종류였다. 또 Phase 2의 OAuth 흐름은 검수를 받은 뒤에는 함부로 손대기 어려운 코드라, 나중의 회귀 비용도 높다.

처음에는 파일마다 `// @ts-check`로 검사를 켰다(`checkJs: false`). 동기화 레이어와 검색 워커부터 켰고, `js/app.js`는 모듈 분할(ADR-018)과 함께 켰다. 2026-10-15에 이 방식의 구멍이 드러났다. 지시문 앞에 `"use strict";` 같은 문이 있으면, TypeScript는 지시문을 읽지 않고 그 파일을 **오류 없이** 뺀다. 22개 파일이 그렇게 검사 밖이었는데, CI는 타입 검사를 돌리지 않았고 로컬 `npm run typecheck`는 0이라 오래 드러나지 않았다. 켜 보니 선언이 데이터나 코드와 어긋난 곳이 쏟아졌다(첫 묶음 16개에서 44건, 원장 `docs/changes/2026-10-17-typecheck-batch-1.md`, `docs/coding-pitfalls.md` §27).

## 검토한 대안

| 방식 | 빌드 변화 | 진입 비용 | 채택 |
| --- | --- | --- | --- |
| `.ts` 파일 + tsc 빌드 산출물 배포 | 빌드 파이프라인 신설, 소스맵, 캐시 무효화 정책 재설계 | 큼 | ❌ — ADR-001 SPA 단순성 훼손 |
| JSDoc + `tsc --noEmit` | 없음 (브라우저는 그대로 `.js`) | 작음 | ✅ |
| ESLint + JSDoc 룰만 사용 | 없음 | 작음 | ❌ — 흐름 분석/추론 부족 |
| Flow / TypeScript JSX(.jsx) | 빌드 변화 큼 | 큼 | ❌ |

- **파일별로 켜기(`checkJs: false` + 파일마다 `// @ts-check`)**: 채택하지 않음 2026-10-17(2026-05-06부터 쓰던 방식) · 이유: 지시문이 문 뒤로 밀리면 그 파일이 오류 없이 검사에서 빠진다(위 「맥락」). 실패가 조용하다. `checkJs: true`에서는 빼는 쪽(`// @ts-nocheck`)이 명시적이고, 그 줄을 잘못 두면 파일이 검사돼 오류로 드러난다 · 재검토: 없음.
- **파일 첫 줄을 보는 유닛 테스트(지시문 순서 검사)**: 채택하지 않음 2026-10-17(PR #353 리뷰가 낸 둘째 안) · 이유: 지시문 위치만 지킬 뿐, 타입 오류 자체는 여전히 CI 밖이다. 기본 검사와 CI의 타입 검사가 둘 다를 덮는다 · 재검토: 없음.
- **타입 검사는 로컬 훅과 수동으로만**: 채택하지 않음 2026-10-17 · 이유: 훅은 저장소 루트에서 연 Claude Code 세션에서만 돈다. 사람이 고친 PR이나 상위 폴더에서 연 세션의 PR은 타입 오류를 안고 머지될 수 있었다 · 재검토: 없음.
- **느슨한 별도 설정으로 큰 파일을 먼저 검사(임시 `tsconfig.app.json`, `checkJs: true`, `noImplicitAny: false`)**: 2026-05-09에 두고 2026-05-10에 지움 · 이유: 5,800줄짜리 `js/app.js`에 엄격 모드를 한 번에 켜면 implicit any가 약 262건이라, 느슨한 설정으로 단계를 나눠 검증했다. 모듈 분할(ADR-018) 뒤에는 모듈마다 엄격 모드로 들이는 편이 자연스러웠다 · 재검토: 없음.

## 적용 방식

### 파일 헤더

```js
// @ts-check
"use strict";
// ...module description...
```

`checkJs: true`라서 지시문 없이도 검사된다. 기존 파일 첫 줄의 `// @ts-check`는 그대로 둔다. 해가 없고, 파일을 `checkJs: false` 설정으로 옮겨도 검사가 따라간다. 새 파일에는 적지 않아도 된다.

검사에서 빼야 하는 파일만 첫 줄에 `// @ts-nocheck`를 두고, 같은 줄에 이유와 고칠 곳을 적는다. 2026-10-17부터 10-18까지 쓴 형식은 `// @ts-nocheck — 타입 오류가 남아 검사에서 뺐다(docs/known-issues.md §7 묶음 ③). …`이다. 지시문은 파일의 **어떤 문(statement)보다도 앞**에 있어야 TypeScript가 읽는다. 앞에 주석만 있는 것은 괜찮다. `"use strict";` 뒤에 둔 `// @ts-nocheck`는 무시돼 그 파일이 검사되고 오류가 드러난다(2026-10-17 확인, `bookmark.js` 11건). 빼는 쪽의 실수가 조용히 지나가지 않는다.

`window`에 거는 네임스페이스 객체(`window.appX = (() => { … return { … }; })()`)의 IIFE에는 `@returns {AppX}`(`js/types.d.ts`의 인터페이스)를 단다. 그러면 반환 객체에 인터페이스에 없는 멤버가 있을 때, 그것을 구조 분해하는 다른 모듈이 아니라 정의한 자리에서 오류가 난다(helpers, storage, settings-ui, citations, parallels, overlay). 네임스페이스 객체가 IIFE가 아니라 객체 리터럴이면 `@type {AppX}`를 단다(bookmark, 2026-10-18. 선언이 실제 객체와 어긋나 있었다).

### 도메인 타입은 한 파일에

`js/types.d.ts` 하나에 모듈이 함께 쓰는 도메인 타입을 정의한다.

- `MTimed<T>`: 레코드마다 수정 시각을 붙이는 감싸개(`{ v: T | null, _u: number }`)
- 북마크: `BookmarkTreeBookmark | BookmarkTreeFolder | BookmarkFlatRow`
- 동기화 문서: `SyncDocV1`, `SyncDocV2`
- 상태 머신 이벤트: `SyncEvent`(union), `SyncState`(string literal)
- GIS 응답: `TokenResponse`, `IdCredentialResponse`(일부만 오는 응답을 허용하는 경우를 명시)
- 읽기와 데이터: `ReadingPosition`(`chapter`는 `number | "prologue"`), `BookEntry`, `BooksData`, `BibleChapter`, `BibleVerse`, `BibleVerseSegment`, `BiblePrologue`. 데이터의 모양을 바꿀 때는 파이프라인(`data/src/parser.py` 등)의 필드 타입과 실제 JSON을 함께 대조한다.
- 라우트: `Route`(`parsePath()`의 반환. 뷰마다 하나인 판별 유니온)
- 네임스페이스 객체의 인터페이스(`AppHelpers`, `AppStorage`, `AppCitations` …)와 `declare global`의 전역 함수, `interface Window`

다른 모듈은 JSDoc `@typedef {import("../types").Foo} Foo`로 가져와 쓴다.

### tsconfig 분리

| 파일 | 대상 | lib |
| --- | --- | --- |
| `tsconfig.json` | DOM 모듈 (`js/**/*.js`, `js/types.d.ts`) | `["DOM", "DOM.Iterable", "ES2022"]` |
| `tsconfig.worker.json` | `js/search-worker.js` (Web Worker) | `["WebWorker", "ES2022"]` |

워커는 메인 스레드와 전역이 달라서(`window`가 없고 `self`만 있다), 나누지 않으면 양쪽 모두에서 타입 오류가 난다. 메인 tsconfig는 워커 파일을 `exclude`로 빼고, 워커 tsconfig는 `include`를 그 파일 하나로 한정한다. 서비스 워커(`sw.js`, 저장소 루트)는 둘 다의 `include` 밖이다(known-issues §7).

### 컴파일러 옵션

- `allowJs: true` + `checkJs: true`: `js/`의 모든 파일을 검사한다. 빼는 파일은 첫 줄 `// @ts-nocheck`
- `noEmit: true`: 산출물이 없다. 브라우저는 원본 `.js`를 그대로 불러온다
- `strict: true` + `noImplicitAny` + `strictNullChecks`: 새 코드는 엄격 모드
- `skipLibCheck: true`: 외부 타입(특히 `lib.dom.d.ts`와 Web Worker의 충돌) 검사를 건너뛴다

## 검증

- `npm run typecheck`: `tsc -p tsconfig.json --noEmit`과 `tsc -p tsconfig.worker.json --noEmit`. 0 error. CI 「Unit tests」 잡(`.github/workflows/test.yml`)과 로컬 편집 훅이 돌린다.
- 설정이나 네임스페이스 객체의 반환 타입을 바꿀 때는 타입 오류를 일부러 하나 넣어, `npm run typecheck`가 그 파일에서 잡는지 본다.
- 브라우저 동작: 바뀌지 않는다(원본 `.js`를 불러오고, JSDoc은 주석이다).
- 사각지대: 모듈에서 `import`를 빠뜨려도 그 이름이 전역으로 선언돼 있으면 통과한다. 이것은 로드 스모크와 e2e가 맡는다(`tests/README.md` §2, ADR-019).

## 채택 이유 요약

- **빌드 파이프라인을 바꾸지 않는다**: ADR-001의 SPA 아키텍처를 해치지 않는다. 서비스 워커 캐시와 배포 zip 구성도 그대로다.
- **조금씩 들일 수 있다**: 오류가 남은 파일은 `// @ts-nocheck` 한 줄로 빼 두고 묶음별 PR로 들인다. 도입하는 동안 깨지는 모듈이 없다.
- **도메인 타입이 한 파일에 있다**: GIS 응답, MTimed 감싸개, BookmarkFlatRow 같은 핵심 도메인이 한 곳에 모여, ADR-011 데이터 스키마와 코드가 어긋나는 것을 막는다.
- **유닛 테스트와 함께 쓰기 좋다**: ADR-013의 Node 자체 테스트 러너도 `--test`만으로 `.js`를 그대로 가져온다. TypeScript 빌드 산출물이 없어 테스트와 실행 코드가 같은 파일을 본다.

## 결과

- Phase 2b-2f를 다듬으며 찾은 결함(키 갱신 누락, 일부만 온 응답을 다루지 않음, 상수 중복) 대부분을 정적 검사 단계에서 막을 수 있다.
- `js/types.d.ts`는 ADR-011 스키마를 바꿀 때 가장 먼저 갱신할 대상이다. ADR과 코드가 어긋나는 것을 알아채는 자리다.
- 검사 밖에 있던 파일은 선언이 데이터나 코드와 어긋난 채 쌓였다(2026-10-17 첫 묶음: `BookEntry.division`에 데이터의 `"liturgical"`이 없었고, `chapter_ref`가 `string`이었고, 네임스페이스 객체 선언이 빠져 있었다). 실행 결함은 아니었지만 선언을 믿고 짠 새 코드가 틀릴 자리였다. 마지막 묶음(2026-10-18, 북마크 모듈)에서도 같았다. `AppBookmark` 선언은 verse-spec.js로 옮겨 간 함수 넷을 그대로 들고 실제 멤버 스물 가운데 열셋을 빠뜨렸고, 함수와 떨어진 JSDoc 둘이 엉뚱한 선언에 붙어 있었다(원장 `docs/changes/2026-10-18-typecheck-batch-3.md`).
- 남은 일: `sw.js` 설정(known-issues §7). `tests/unit/*.js`는 검사 대상 밖이다(`exclude`).

## 관련 ADR

- ADR-001: SPA 아키텍처. 빌드 단계를 피한 출발점이다.
- ADR-011: 북마크 동기화. 도메인 타입을 가장 많이 쓴다.
- ADR-013: 클라이언트 JS 유닛 테스트 전략. 같은 시기에 도입했다.
- ADR-018: app.js 모듈 분할. 앱 레이어를 모듈 단위로 검사 안에 들인 단계다.
- ADR-019: ESM 모듈 시스템. typedef를 모듈마다 가르고, import 누락의 사각지대가 생긴다.
