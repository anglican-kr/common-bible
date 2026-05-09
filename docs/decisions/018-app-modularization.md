# ADR-018: app.js 모듈 분할 (modularization)

- 일시: 2026-05-09
- 상태: 승인됨 (Phase 1 진행 예정)
- 관련 설계 문서: `docs/design/app-modularization.md`

## 결정

`js/app.js`(현재 6,082줄)를 도메인별 모듈로 분할한다. 각 모듈은 `js/app/<name>.js` 파일에 두고, IIFE 패턴으로 `window.app<X>` 객체에 export한다. `index.html`에 `<script defer>` 태그로 의존 순서대로 로드. 모듈마다 `// @ts-check` 영구 활성화 + 함수 매개변수 JSDoc + ADR-012 1라운드의 도메인 타입 가드 유지.

목표는 ADR-012 1라운드 종료 시 보류한 "`// @ts-check` 영구화 + `tsconfig.app.json` 삭제"를 모듈 단위로 옵트인해 자연스럽게 달성하는 것.

분할 단계 (8 PR):

1. `helpers.js` (~70줄) — `el`, `clearNode`, `_$`, `announce`, `trapFocus`, `chUnit`. 모든 후속 모듈의 의존 대상
2. `storage.js` (~250줄) — localStorage 헬퍼 묶음
3. `settings-ui.js` (~600줄) — 설정 팝오버 + 외관 적용
4. `install.js` (~430줄) — PWA 감지 + 설치 안내 모달
5. `search.js` (~990줄) — 검색 전체 (sheet + 히스토리 패널 포함)
6. `bookmark.js` (~1,800줄) + `state.js` — 북마크 전체 + 공유 상태(`_currentBookId`/`_currentChapter`/`_verseSelectMode`/`_selectedVerseRefs`) 분리
7. `views-routing.js` (~1,400줄) — 라우팅 + Views + 오디오 + PTR + Compact header
8. `app-main.js` 부트스트랩 + `tsconfig.app.json` 최종 삭제 (Phase 8)

## 맥락

ADR-012 1라운드(PR-1~7, 2026-05-09 머지)에서 `js/app.js`에 JSDoc + null/도메인 타입 가드를 도입했다. 그 시점에 main `tsconfig.json` 검사 환경에서 `// @ts-check`를 추가해 보면 **약 262 implicit any**가 발생함을 확인했다(함수 매개변수 ~150 + 모듈 상태 ~30 + index access ~17 등). 단일 PR로 정리하기엔 변경 폭이 거대하고, 5,800줄 단일 파일에 strict 타입을 입히는 작업은 모듈 분할과 결합하는 게 자연스럽다.

또한 본 의제는 미래 monorepo split의 기반이기도 하다(일정 미정). 분할 계획:

- **앱 저장소**(root): `index.html`, `js/**`, `css/**`, `sw.js`, 빌드/배포 스크립트
  - **데이터(성서) 서브모듈**: `data/source/`(현재 이미 `anglican-kr/common-bible-text` private submodule), parser 출력 JSON 포함
  - **데이터(오디오) 서브모듈**: `data/audio/` MP3 ~수백 MB
- **서버(nginx) 저장소**(별도): prod nginx config, BFF `/oauth/token` location 블록 — 운영 인프라라 코드 라이프사이클이 다름

데이터 두 저장소는 git submodule로 앱에 포함되므로 clone 시 `git submodule update --init`만으로 함께 보인다. 따라서 앱 저장소가 자기 완결적이려면 내부 모듈 경계가 명확해야 함 — 본 모듈화가 그 선행 작업.

## 검토한 대안

| 방식 | 빌드 변화 | 진입 비용 | 채택 |
| --- | --- | --- | --- |
| 단일 거대 PR (`// @ts-check` + ~262 implicit any 일괄 정리) | 없음 | 매우 큼, 리뷰 어려움 | ❌ |
| **Multi-script + `defer` 모듈 분할** | 없음 | 단계별 분할 가능 | ✅ |
| ESM (`<script type="module">`) | 없음 | 동기 초기화 보장 부족, 모듈 헤드 anchor 캡처 + side-effect 의존 패턴과 충돌 | ❌ — `gtag-init.js` 같은 외부 스크립트와 정합 부담 |
| `.ts` + tsc 빌드 | 큼 | ADR-001 SPA 단순성 위배 | ❌ |
| 그대로 유지 (`// @ts-check` 영구화 보류) | 없음 | 0 | ❌ — 1라운드 산출물의 검증 흐름이 임시 인프라(`tsconfig.app.json`)에 영구 의존하게 됨 |

## 채택 방식

### 모듈 패턴 (IIFE + `window.appXxx`)

각 모듈은 IIFE로 감싸 한 객체에 export. 1차 적용된 sync 레이어(`window.driveSync`, `window.syncTransport` 등)와 동일.

```js
// js/app/helpers.js (Phase 1)
"use strict";
// @ts-check
window.appHelpers = (() => {
  function _$(id) { /* ... */ }
  // ...
  return { _$, chUnit, el, clearNode, trapFocus };
})();
```

호출 측은 `window.appHelpers._$()` 또는 IIFE 직후 `const { _$ } = window.appHelpers;`로 받음.

### module-vs-script 예외 (Phase 2부터)

원칙은 `<script defer>` + 글로벌 `window.X` 패턴(위)이지만, 모듈이 정의하는 `function`/`@typedef` 이름이 다른 1차 적용 파일(특히 `js/sync/store-v2.js`)의 글로벌 정의와 충돌하면 그 모듈만 ES module로 옵트인한다. 옵트인 방법:

1. 파일 끝에 `export {};` 한 줄 추가 (런타임 동작 무변동, TypeScript는 그 파일을 module로 인식 → 함수/typedef가 module scope)
2. `index.html`에서 그 파일을 `<script type="module" src="..."></script>`로 로드 (`type="module"` 은 자동 deferred + 등장 순서 실행 보장)

Phase 2(`storage.js`) 시점에 `saveBookmarks`/`loadBookmarks` 이름이 `js/sync/store-v2.js`와 글로벌 충돌해 두 파일 모두 옵트인. 다른 sync 파일은 store-v2 함수를 `window.syncStoreV2.X` facade로만 호출하므로 caller 변경 불필요. ADR-001 SPA 단순성은 여전히 유효 (빌드 단계 0, import/export 의무 없음, `window.X` 글로벌 노출 그대로).

향후 단계도 충돌 발생 시 모듈 단위로 같은 옵트인 적용. 모든 모듈을 일괄 ESM 전환하는 광범위 변경은 의도하지 않음.

### 공유 상태 (Phase 6)

`_currentBookId` / `_currentChapter` / `_verseSelectMode` / `_selectedVerseRefs`는 4~6개 섹션이 접근. 별도 `js/app/state.js` 모듈이 owns + getter/setter export (설계 문서 §5.1 Option A).

### 임시 인프라 처리

- `tsconfig.app.json`은 Phase 1~7 동안 유지 (`checkJs: true`, `noImplicitAny: false`)
- 각 모듈에 `// @ts-check` 추가 시점부터 그 모듈은 strict (메인 `tsconfig.json` 의 `noImplicitAny: true`) 적용
- Phase 8에서 `tsconfig.app.json` 삭제

### `index.html` / `sw.js` 영향

`index.html`에 `<script defer>` 태그 추가. `sw.js`의 셸 캐시 매니페스트에 신규 모듈 파일들 추가 + `CACHE_NAME` 증분.

## 검증

- 단계별 PR마다: `tsc -p tsconfig.app.json --noEmit` + `tsc -p tsconfig.json --noEmit` 모두 0 error
- 회귀: `tsc -p tsconfig.worker.json --noEmit` + `node --test tests/unit/*.test.js`
- **브라우저 동작 확인**: 매 단계 PR마다 로컬 SPA 서버에서 콘솔 0 오류 확인 (1라운드와 다름 — 분할은 코드 위치 이동이라 로드 순서 누락이 런타임 깨짐으로 즉시 드러남)
- Phase 8 머지 후 e2e (`tests/e2e/*.py`) 일괄

## 채택 이유 요약

- **분할 단위로 implicit any 정리** — 단일 거대 PR 회피 (~262건을 8개 PR로 분산)
- **ADR-001 SPA 단순성 유지** — 빌드 단계 0
- **sync 레이어와 일관 패턴** — IIFE + `window.appXxx`로 노출, `defer`로 순서 보장
- **미래 monorepo split 기반** — 앱 저장소 자기 완결성을 위해 내부 모듈 경계 명확화 선행 필요
- **부수 효과**: 셸 캐시 입자 개선(한 모듈 변경 시 그 파일만 재다운), 인지적 부담 감소, 단위 테스트 도입 기회 (설계 문서 §10 참조)

## 결과

- ADR-012 2차 적용 2라운드 완료(Phase 8 머지) 시 ADR-012에 `> 개정` 블록 추가
- `tsconfig.app.json` 삭제 → 메인 `tsconfig.json` 단일 출처
- 향후 lazy load / tree-shaking 등 추가 최적화 옵션 열림 (별도 의제)

## 관련 ADR

- ADR-001: SPA 아키텍처 — 빌드 단계 회피의 출발점
- ADR-012: TypeScript 점진 도입 — 1라운드 완료 + 본 ADR이 2라운드 시작점
- ADR-013: 클라이언트 JS 유닛 테스트 전략 — 분할 후 unit test 추가 기회 (storage / verse spec / search worker wire-up 등 순수 로직 영역)
- ADR-016: 오디오 캐시 LRU — `views-routing.js`의 audio player 영역 분할 시 audio cache 의존성 정합 유지
