# 아키텍처 개요

이 문서는 공동번역성서 PWA의 전체 구조를 한눈에 보기 위한 지도다. 세부 결정의 근거는 `docs/decisions/`의 ADR을 참조하고, 코드 라인 단위 설명은 본문에 인라인으로 인용한 파일을 직접 읽기를 권한다.

> 이 문서는 **계속 변경되는 설계 문서**다. 결정 그 자체가 아니라 결정들의 합쳐진 결과를 설명한다. 새로운 결정이 생기면 ADR을 먼저 작성하고, 그 결과로 본 문서가 달라지면 여기를 갱신한다.

## 1. 한 줄 요약

브라우저가 정적 JSON 파일을 직접 읽어 렌더링하는 **프레임워크 없는 단일 페이지 앱(SPA) + 서비스 워커 오프라인 캐시**. 빌드 단계는 Python 스크립트로 마크다운 원본을 장별 JSON으로 전처리하는 일회성 작업뿐이고, 런타임에는 서버가 없다 — 정적 호스팅에 그대로 배포된다.

저장소는 4개로 분리되어 있다 (ADR-020): 본 앱 저장소(공개) + `common-bible-data`(비공개, 마크다운·파이프라인·빌드 출력) + `common-bible-audio`(비공개 LFS, mp3) + `common-bible-server`(비공개, nginx·배포 스크립트). 앱이 data를 서브모듈로 마운트하고 data가 audio를 nested 서브모듈로 마운트하므로 docroot 기준 URL은 `/data/...`로 그대로 유지된다.

`bible.anglican.kr` (운영) + `dev.anglican.kr` (개발) 두 도메인이 동일한 웹 서버에서 가상 호스트로 서빙된다. 각 도메인의 docroot는 `/var/www/{bible,dev}` 심볼릭 링크가 가리키는 디렉터리(`bible-{version}-{shortsha}`)이고, 배포·롤백은 심볼릭 링크 교체 한 줄로 끝난다 (`common-bible-server/scripts/deploy.sh` 참조).

Google Drive 동기화·OAuth는 외부 의존이지만 단 한 군데 — `/oauth/token` POST는 nginx가 `client_secret`을 server-side로 주입한 뒤 `oauth2.googleapis.com/token`으로 forward하는 BFF 패턴 — 만 서버 단 매개를 쓰고, 나머지는 클라이언트가 직접 Google 엔드포인트와 통신한다 ([ADR-017](decisions/017-oauth-bff-proxy.md)).

```
        ┌──────────────────────────────────────────────────────────┐
        │  common-bible-data  (비공개)                             │
        │   source/*.md  →  src/parser.py → src/split_bible.py      │
        │                →  src/search_indexer.py                    │
        │                →  bible/*.json + search-*.json + books.json│
        │   audio/  (nested 서브모듈 → common-bible-audio, LFS mp3)  │
        └──────────────────────────────────┬───────────────────────┘
                                           │ git submodule pointer
                                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │  common-bible  (공개, 본 저장소)                          │
        │   index.html · sw.js · js/ · css/ · assets/                │
        │   data/  ← common-bible-data 마운트                        │
        └──────────────────────────────────┬───────────────────────┘
                                           │ build-deploy.sh + ssh
                                           ▼
        ┌──────────────────────────────────────────────────────────┐
        │  common-bible-server  (비공개)                            │
        │   nginx/  (BFF·보안 헤더)                                 │
        │   scripts/deploy.sh  → seoul:/var/www/bible-{ver}-{sha}/   │
        │                                                          │
        │   bible.anglican.kr → /var/www/bible →                    │
        │   dev.anglican.kr   → /var/www/dev   →                    │
        │     (각 심볼릭 링크가 bible-{ver}-{sha}/ 가리킴)            │
        │                                                          │
        │   location = /oauth/token  (BFF, ADR-017)                 │
        │     │ inject client_secret                                │
        │     ▼                                                    │
        │     oauth2.googleapis.com/token                           │
        └──────────────────────────────────┬───────────────────────┘
                                   │ HTTPS
                                   ▼
                  ┌────────────────────────────────────────────┐
                  │  브라우저 (PWA)                              │
                  │                                            │
                  │   ┌─ index.html (<script> 19개, dep 순) ─┐   │
                  │   │  app.js + app/* 8개  (UI·라우팅)      │   │
                  │   │  drive-sync.js + sync/* 5개 (동기화)   │   │
                  │   │  audio-cache.js  (오프라인 오디오)     │   │
                  │   │  manifest-sync.js (콘텐츠 해시 diff)   │   │
                  │   │  pre-fetch.js + gtag-init.js          │   │
                  │   │  ─ Web Worker ─                       │   │
                  │   │  search-worker.js (별도 컨텍스트)      │   │
                  │   └───────────────────────────────────────┘   │
                  │                                            │
                  │   sw.js (오프라인 셸 + stale-while-          │
                  │          revalidate, 폰트·OAuth 예외)        │
                  │                                            │
                  │   localStorage  +  IndexedDB(refresh-store) │
                  └────────────────┬───────────────────────────┘
                                   │ HTTPS
                                   ▼
                  Google: accounts.google.com (consent),
                          www.googleapis.com (Drive appdata)
                          ※ /token만 BFF 경유
```

## 2. 아키텍처를 결정한 4가지 제약

1. **저작권** — 원본 텍스트는 비공개 저장소(`common-bible-data`, ADR-020)의 `source/` 하위 마크다운으로 관리된다. 본 앱 저장소가 그 저장소를 `data/`에 서브모듈로 마운트하므로 docroot URL은 그대로 `/data/...`. 빌드 산출물(`bible/*.json`·`search-*.json`)도 data 저장소에 commit되므로 앱은 서브모듈 포인터로 잠금만 한다. 파이프라인 실행은 권한 있는 사용자만 가능 (data 저장소 접근권 필요).
2. **비상업·비영리** — 백엔드를 운영할 인력·예산이 없다. 모든 상태는 클라이언트 또는 사용자의 Google Drive(appdata)에 산다.
3. **오프라인 우선** — 교회·예배 환경의 불안정한 네트워크를 가정. PWA + Service Worker로 첫 방문 후 모든 본문이 로컬에 캐시된다.
4. **장기 유지보수성** — 1인 개발이 가능해야 한다. 프레임워크/번들러 부재, 의존성 최소, 테스트 자동화 — 이 셋이 핵심 가드다.

이 4개가 SPA·Vanilla JS·Python 일회성 전처리·Drive appdata·정적 호스팅이라는 선택을 거의 단일 결론으로 강제했다. 자세히는 [ADR-001](decisions/001-spa-architecture.md).

## 3. 빌드 타임 — 데이터 파이프라인

원본 마크다운(73권)을 1328장의 장별 JSON과 3개의 검색 인덱스로 변환한다. 빌드는 의도적으로 **일회성 스크립트의 합성**이고, 어떤 빌드 시스템(make/just/poetry)에도 묶지 않는다 — 각 스크립트가 같은 입력에 같은 출력을 주므로 의존 그래프가 단순하다.

파이프라인은 `common-bible-data` 저장소 내부에서 실행되며, 작업 디렉토리는 그 저장소 루트(앱 저장소 기준 `data/`):

```
source/{book_id}.md
        │
        ▼
src/parser.py             ← 마크다운을 segments(텍스트·연·운문·헤딩) 시퀀스로 파싱
        │  output/parsed_bible.json (전체 73권 단일 파일)
        ▼
src/split_bible.py        ← 장별로 분리, 시락 머리말 별도 추출
        │  bible/{book_id}-{chapter}.json   (1328개)
        │  bible/sir-prologue.json          (ADR-002)
        │  books.json                       (메타데이터)
        ▼
src/search_indexer.py     ← 절 단위 인덱스를 구약/신약/외경으로 분할
           search-meta.json   (~9 KB, 책 별칭)
           search-ot.json     (~3.8 MB)
           search-nt.json     (~1.3 MB)
           search-dc.json     (~700 KB)
```

(앱 docroot에서는 동일 산출물이 `data/bible/...`·`data/search-*.json` 위치로 보인다 — 서브모듈 마운트에 따른 prefix.)

설계 포인트:

- **물리적 장 순서**: 시락 머리말, 다니엘 추가본 등 본래 장 번호가 어그러지는 부분은 "원전이 있는 그대로의 물리 순서"를 따른다 ([ADR-003](decisions/003-physical-chapter-ordering.md)).
- **검색 인덱스 분할 (구약/신약/외경)**: 5.8 MB 단일 파일을 3개로 쪼개 첫 검색 응답 속도를 우선 ([ADR-005](decisions/005-search-indexing-strategy.md)). 워커가 청크 단위로 로드하면서 partial-results를 흘려 보낸다.
- **운문 본문 포맷**: 마크다운 블록인용(`>`)으로 표기. 절 내 산문/운문 구분은 `segments` 배열(`type: "prose"|"poetry"`), 스탠자 구분은 절 간 `stanza_break: true` 또는 절 내 텍스트의 `\n\n`, 단락 구분은 segment 레벨 `paragraph_break: true`. 자세히 [ADR-006](decisions/006-poetry-source-format.md).

자세한 실행 명령은 [README §데이터 파이프라인 실행](../README.md#데이터-파이프라인-실행).

## 4. 런타임 — 클라이언트 모듈 지도

런타임은 21개의 자바스크립트 파일로 분산되어 있다 — 메인 스레드 20개 + Web Worker 1개(`search-worker.js`). `js/types.d.ts`는 TypeScript 컴파일러 전용이라 런타임 카운트에서 제외.

ADR-018 모듈 분할(2026-05-10)로 옛 단일 `app.js` ~6,000줄이 8개 도메인 모듈로 쪼개졌고, 잔류 `app.js`는 부트스트랩 + Service Worker 등록 정도만 남았다. 자세한 분할 결과는 [`docs/design/app-modularization.md`](design/app-modularization.md). 이어서 ADR-019(2026-05-09)로 모듈 시스템을 **ESM 일괄 채택**. ADR-022 인용·주석 작업으로 `js/app/citations.js`가 추가되어 현재 도메인 모듈은 **9개**.

### 로드 방식

`index.html`이 19개 `<script>` 태그를 의존성이 있는 순서대로 **명시적으로 나열**한다 (ADR-019 §"채택 방식"). ESM이 `import` 그래프를 따라가며 알아서 의존성을 가져오는 방식은 **아니다** — `<script type="module">`도 결국 브라우저가 각 태그를 발견 순서로 로드한다.

| 로드 모드                                | 파일 수 | 비고                                                                                                                 |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `<script type="module">` (자동 deferred) | 17      | 대부분의 모듈. 모듈 scope + `import`/`export` 가능                                                                   |
| `<script defer>` (classic)               | 2       | `audio-cache.js`·`manifest-sync.js` — `sw.js`의 `importScripts()` 호환을 위해 classic 유지 (ADR-019 §"예외")          |
| `<script>` (head, 즉시 실행)             | 1       | `pre-fetch.js` — `<head>`에서 즉시 `data/books.json` 다운로드 시작. `type="module"`은 자동 deferred라 fetch가 늦어짐 |

21번째 런타임 파일인 `search-worker.js`는 `<script>`가 아니라 `new Worker()`로 메인 스레드에서 별도 생성 — 독립 컨텍스트.

모듈 간 의존은 여전히 `window.X` 공개 인터페이스(facade — `window.driveSync` / `window.appHelpers` 등 전역 객체)가 주류이고, ADR-019는 이를 **점진 폐기** 대상으로 정의 — 신규 코드는 `import`/`export`로 작성 권장.

**최상위 (`js/`):**

| 파일                  | 역할                                                                                | 라인 수 |
| --------------------- | ----------------------------------------------------------------------------------- | ------- |
| `js/pre-fetch.js`     | 첫 페인트 직전 `data/books.json` 비동기 선패치                                      | ~10     |
| `js/gtag-init.js`     | Google Analytics 초기화                                                             | ~15     |
| `js/app.js`           | app-main 부트스트랩 + 접근성 keydown + Audio cache LRU 소프트캡 + SW 등록           | ~290    |
| `js/audio-cache.js`   | 오디오 LRU IndexedDB sidecar ([ADR-016](decisions/016-audio-cache-lru.md))          | ~190    |
| `js/manifest-sync.js` | 부팅 시 콘텐츠 해시 매니페스트 diff → DATA/AUDIO_CACHE 항목 단위 무효화 ([ADR-021](decisions/021-pwa-versioning-content-hash.md)) | ~200    |
| `js/search-worker.js` | Web Worker. 청크 로딩 + 절 검색 + 페이지네이션                                      | ~370    |
| `js/drive-sync.js`    | Drive 동기화 파사드(코디네이터)                                                     | ~250    |
| `js/types.d.ts`       | 도메인 타입 단일 출처 ([ADR-012](decisions/012-typescript-incremental-adoption.md)) | —       |

**`js/app/` — 9개 도메인 모듈 (ADR-018 분할 + ADR-022 인용·주석):**

| 파일                        | 역할                                                                                                                              | 라인 수 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `js/app/helpers.js`         | 공통 DOM 헬퍼 (`_$`/`el`/`clearNode`/`setInert`/`trapFocus`)                                                                      | ~150    |
| `js/app/storage.js`         | localStorage 헬퍼 + UI 공유 상수                                                                                                  | ~370    |
| `js/app/settings-ui.js`     | 설정 팝오버 + 외관 적용 + 인용·주석 토글                                                                                          | ~650    |
| `js/app/install.js`         | PWA 설치 감지 + 안내 모달 + nudge                                                                                                 | ~500    |
| `js/app/search.js`          | 검색 워커 wire-up + 결과 렌더 + 이력 패널 + sheet                                                                                 | ~1,090  |
| `js/app/reading-context.js` | 현재 책/장 + 절 선택 모드 공유 상태                                                                                               | ~40     |
| `js/app/bookmark.js`        | 북마크 (verse spec / 트리 / 드래그&드롭 / 모달 / 셀렉션)                                                                          | ~2,210  |
| `js/app/citations.js`       | 인용 칩 dedup·렌더 + 인용 본문 바텀 시트 (확장 뷰·드래그 리사이즈) + 주석 anchor 위첨자 + 클릭 툴팁 ([ADR-022](decisions/022-citations-and-annotations.md)) | ~940    |
| `js/app/views-routing.js`   | 데이터 패칭 + 렌더 헬퍼 + Pull-to-refresh + Views + Routing + Audio Player + 책 이름/헤더 자동 짧게 swap                          | ~2,110  |

**`js/sync/` — 동기화 레이어:**

| 파일                       | 역할                                                                                            | 라인 수 |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| `js/sync/state-machine.js` | 동기화 상태 머신 (PKCE 단일 경로, [ADR-011](decisions/011-bookmark-sync.md) Phase 2h)           | ~1,000  |
| `js/sync/transport.js`     | PKCE primitives + Drive REST + `/oauth/token` BFF ([ADR-017](decisions/017-oauth-bff-proxy.md)) | ~510    |
| `js/sync/store-v2.js`      | per-record mtime + tombstone 머지                                                               | ~405    |
| `js/sync/refresh-store.js` | OAuth refresh token 암호화 IDB (AES-GCM 비추출 키)                                              | ~190    |
| `js/sync/debug-log.js`     | ring buffer 진단 로그                                                                           | ~160    |

위 20개 파일 외에 `js/types.d.ts`는 TS 컴파일러 입력 전용으로 쓰인다(`@typedef`/`@type`이 참조). 의존 순서·로드 모드 변경 시 [ADR-019](decisions/019-esm-module-system.md) 참조.

### 4.1 라우팅 (History API SPA)

`js/app/views-routing.js`가 브라우저 history API(`pushState`/`popstate`)로 URL을 갱신해 페이지 이동을 흉내내고, 서비스 워커는 모든 페이지 이동 요청을 `/index.html`로 대체해 같은 셸을 다시 띄운다. 단, `/privacy.html` 같은 별도 페이지는 그대로 통과시킨다 ([ADR-009](decisions/009-history-api-routing.md), `sw.js:113`).

라우트:

| 경로                                                       | 화면              |
| ---------------------------------------------------------- | ----------------- |
| `/`                                                        | 홈 (전체 책 목록) |
| `/{book_id}/{chapter}` 또는 `/{book_id}/{chapter}/{verse}` | 본문              |
| `/검색` (해시·쿼리)                                        | 검색 결과 시트    |

로컬 개발 서버(`scripts/serve.py`)는 동일한 폴백을 흉내내어 강제 새로고침이 깨지지 않도록 한다. **`python -m http.server`는 사용 금지** — `/gen/1` 같은 라우트를 404로 반환한다.

### 4.2 검색 (Web Worker + 청크 인덱스)

`js/app/search.js`는 메인 스레드에서 검색 UI/결과 시트만 다루고, 실제 텍스트 검색은 `js/search-worker.js`가 전담한다.

```
사용자 입력  →  app/search.js  ──postMessage──▶  search-worker.js
                                       │
                                       ├─ data/search-meta.json (lazy fetch)
                                       ├─ data/search-ot.json   (lazy fetch)
                                       ├─ data/search-nt.json
                                       └─ data/search-dc.json
                                       │
            partial-results / results  ◀──── 청크 1개 로드 끝날 때마다 흘려 보냄
```

워커 프로토콜은 `search-worker.js:1` 상단 주석에 정의됐다. 검색마다 부여한 `searchId`로 사용자가 새 검색어를 친 뒤 뒤늦게 도착한 옛 결과는 무시하고, 책·장·절 인덱스는 `Uint16Array`로 RLE(연속된 같은 값을 묶어 압축) 인코딩해 메모리를 줄였다. 별칭(요한/요/요한복음 등)·책 범위 한정자(`in:신약`)는 `data/search-meta.json`이 갖고 있다 ([ADR-005](decisions/005-search-indexing-strategy.md)).

### 4.3 동기화 (Drive appdata + PKCE)

가장 복잡한 서브시스템. 5개 파일이 명확히 역할과 책임을 나눈다:

```
                       ┌─────────────────────────────────────────────┐
                       │  app/settings-ui.js  (설정 화면, "연결" 버튼) │
                       └────────────────────┬────────────────────────┘
                                            │ window.driveSync.{signIn,signOut,scheduleUpload,...}
                                            ▼
                       ┌─────────────────────────────────────────────┐
                       │  js/drive-sync.js  (파사드)                  │
                       │   - PKCE 콜백 흡수 (?code=… 처리)             │
                       │   - 업로드 디바운스 (300ms)                   │
                       │   - 머신 위에 얇은 공개 API                    │
                       └──┬───────────────────┬───────────────────┬──┘
                          │                   │                   │
                          ▼                   ▼                   ▼
              ┌───────────────────┐ ┌───────────────────┐ ┌─────────────────┐
              │ sync/state-       │ │ sync/transport.js │ │ sync/store-v2.js│
              │ machine.js        │ │  (순수 함수)        │ │ (per-record     │
              │                   │ │  - PKCE 생성/교환   │ │  mtime + 툼스톤) │
              │ 6 상태:            │ │  - Drive REST     │ │                 │
              │  DISABLED/IDLE/   │ │  - 토큰 갱신·revoke │ │ - 머지 알고리즘   │
              │  SYNCING/OFFLINE/ │ └───────────────────┘ │ - localStorage  │
              │  NEEDS_CONSENT/   │                       │ - flat-map ↔ tree│
              │  ERROR            │ ┌───────────────────┐ └─────────────────┘
              │                   │ │ sync/refresh-     │
              │ 모든 race 가드와    │ │ store.js          │ ┌─────────────────┐
              │ 카운터 캡 보유       │ │ - AES-GCM 암호화   │ │ sync/debug-     │
              └───────────────────┘ │   IndexedDB        │ │ log.js          │
                                    │ - 256-bit key      │ │ - ring buffer   │
                                    │   webcrypto 비추출  │ │ - 토큰 마스킹    │
                                    └───────────────────┘ └─────────────────┘
```

핵심 설계:

- **PKCE 단일 경로**. 데스크톱·Android·iOS가 같은 흐름. 앱을 다시 켰을 때(콜드 스타트) IndexedDB에 저장된 갱신 토큰(refresh token)으로 사용자 모르게 `/token` 호출로 새 접근 토큰을 받음 — 없으면 `NEEDS_CONSENT`로 전환해 사용자에게 다시 로그인 요청. ([ADR-011](decisions/011-bookmark-sync.md), `docs/design/pkce-migration.md`)
- **OAuth `/token` BFF**. `transport.js`는 `https://oauth2.googleapis.com/token`이 아니라 같은 출처(same-origin) `/oauth/token`으로 보낸다. 웹 서버(nginx)가 비밀 키(`client_secret`)를 서버 쪽에서 주입한 뒤 Google로 전달 — Google "Web application" 클라이언트가 PKCE에서도 비밀 키를 요구하는 RFC 7636(PKCE 표준) 일탈을 회피 (자세히 [ADR-017](decisions/017-oauth-bff-proxy.md)).
- **탭 활성화 자동 sync**. 사용자가 탭으로 돌아올 때(`visibilitychange`의 visible 분기) `requestSync()`를 한 번 호출. 다른 디바이스의 변경분을 새로고침 없이 자동으로 가져옴. 다만 IDLE 상태일 때만 실행해 동시 요청 충돌을 피함.
- **상태 머신의 모든 변이는 `_transition()` 한 곳을 거친다.** 카운터(`{netFails, conflictFails, reAuthFails, backoffTimer}`)도 같이 리셋된다. 다음 상태로 이어가야 할 값은 명시적으로 넘겨야만 보존됨 (`state-machine.js:91`).
- **동시 실행 가드 3중**: 상태(`_state`) 검사 + `localStorage["bible-drive-sync"]` 활성 플래그 검사 + 모든 비동기 대기(`await`) 직후 재검사. 사용자가 백그라운드 토큰 갱신/code 교환 도중 연결을 끊었을 때 의도가 보존된다.
- **카운터 캡**: `MAX_REAUTH=3` (만성 401), `MAX_CONFLICTS=3` (412 ETag), `MAX_NET_RETRIES=5` (1·2·4·8·16초 점진 대기), `MAX_REDIRECT_ATTEMPTS=3` (무한 리디렉션 방어).
- **머지 정책**: 각 항목마다 마지막 수정 시각(`_u`, 밀리초)과 삭제 표시(툼스톤)를 함께 저장. 항목 단위로 "나중에 수정한 쪽이 이김", 파일 전체 단위 아님 — 서로 다른 기기에서 다른 북마크를 추가해도 둘 다 보존.

진입·복귀 시나리오는 [README §Google Drive 동기화](../README.md#google-drive-동기화-북마크설정읽기-위치) 표 참조.

### 4.4 인용·주석 (`<cite>` + `[^id]`)

`js/app/citations.js`가 본문 렌더 분기를 받아 두 종류의 추가 콘텐츠를 그린다 ([ADR-022](decisions/022-citations-and-annotations.md)).

- **인용 칩**: 본문의 `<cite src="…" tradition="…" parallels="…">…</cite>` segment 끝에 옅은 회색 출처 칩을 단다. 같은 출처가 연속된 절에 걸치면 마지막 절에서만 표시 (dedup). 운문 인용은 인라인이 아니라 별도 줄로 그려 시 행을 흩뜨리지 않는다.
- **인용 본문 바텀 시트**: 칩 클릭 시 출처 본문을 같은 페이지 위 바텀 시트로 띄운다. 다중 ref / parallels / 다중 장 (`53:5,7-9`) 지원, "이 장 전체 보기"로 시트 안에서 장 본문 확장 + 인용 절 강조, 드래그 핸들로 시트 높이 리사이즈·닫기. 시트 안 본문은 칩·주석 비렌더(중첩 시트 회피).
- **주석**: 본문에서 `[^id]` anchor 가 ※ 위첨자로 표시되고, 클릭 시 본문 옆 툴팁으로 본문이 펼쳐진다 (스크롤 따라가기). 인쇄 본은 페이지 하단 footnote 양식으로 별도 렌더.
- **토글**: 설정에서 칩·주석 각각 끄고 켤 수 있다 (`bible-cite-show`·`bible-note-show` localStorage). 기본값 ON.

데이터 파이프라인 (`common-bible-data/src/parser.py`)이 마크다운에서 `<cite>` 와 `[^id]` 를 추출해 절 JSON 의 `segments` 와 `notes` 필드에 보존하므로, 칩 클릭 시 시트 본문은 별도 fetch 없이 같은 장 JSON 또는 출처 책 JSON 으로 가져온다.

### 4.5 책 이름·헤더 자동 짧게 표시

신약 책 이름은 정식 명칭이 길어("고린토인들에게 보낸 첫째 편지") 좁은 화면이나 큰 글자에서 책 목록 버튼·장 보기 헤더가 2줄로 부풀어 읽기 흐름을 깬다. `js/app/views-routing.js` 의 `NT_MOBILE_NAME` 매핑(22개 신약 책)이 짧은 명칭을 제공하고, 두 곳에서 같은 swap 메커니즘으로 그린다:

- 정식 명칭과 짧은 명칭을 두 span (`.book-name-full` / `.book-name-mobile`, 헤더는 `.title-text-full` / `.title-text-mobile`) 으로 함께 렌더.
- **터치 기기** — `@media (hover:none) and (pointer:coarse)` 미디어 쿼리로 책 목록 항상 짧은 명칭. 폰·태블릿 모두 일관.
- **비-터치 기기** — `ResizeObserver` 측정. 정식 명칭이 한 줄에 안 들어가면 (`.book-name-full` natural 너비 > 사용 가능 너비) `.compact` 추가 → swap. 글자 크기 변경(브라우저 줌, OS 설정, 앱 글자 크기)도 자동 재측정.
- 헤더는 좌우 뒤로가기/북마크 버튼 자리(`5.2rem`) 와 picker chevron 여유(`0.8rem`) 를 빼고 측정.

복음서 4권 + 사도행전은 매핑 없음 (이미 짧음). 접근성: 화면이 짧은 명칭을 보여도 `aria-label` 은 항상 정식 명칭을 유지해 스크린리더 동작 무변경.

### 4.6 오프라인 — Service Worker 캐시 전략

`sw.js`는 3가지 전략을 도메인 / 요청 종류별로 분기한다 (`sw.js:101`). "캐시 우선(cache-first)"은 한 번 받아둔 자료가 있으면 그것부터 보여주고 없을 때만 네트워크로 가져오는 방식.

| 대상                                                        | 전략                                                                          | 이유                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `fonts.gstatic.com`                                         | 캐시 우선, **별도 `FONT_CACHE`** 보관, 다른 캐시가 갱신돼도 보존             | 폰트 파일은 절대 안 바뀌고 URL 자체에 버전이 박혀 있음     |
| OAuth/Drive 4개 호스트                                      | **항상 네트워크 직행**, 서비스 워커 우회                                      | 캐싱 시 토큰·동기화 데이터가 깨진다                         |
| 페이지 이동 요청 (HTML)                                     | `/index.html`로 대체 (단, `/privacy.html`은 통과)                             | SPA 라우팅                                                  |
| 셸 (JS/CSS/HTML/icons + `books.json`·`search-meta.json`·매니페스트 2종)    | 캐시 우선 → `SHELL_CACHE`                                                     | 코드와 강결합, 매 릴리스 동기 갱신                          |
| 본문·검색 (`/data/bible/*`, `/data/search-{ot,nt,dc}.json`) | 캐시 우선 → `DATA_CACHE` (이름 고정 `"data"`)                                 | 누적 캐시; 콘텐츠 해시 매니페스트 diff 로 항목 단위 갱신     |
| 오디오 (`/data/audio/*`)                                    | 캐시 우선 → `AUDIO_CACHE` (이름 고정 `"audio"`)                               | 필요 시 다운로드; 콘텐츠 해시 매니페스트 diff 로 항목 단위 갱신 |
| 매니페스트 (`/data/{bible,audio}-manifest.json`)            | **네트워크 우선**, 실패 시 SHELL_CACHE 의 precached 사본 fallback              | freshness 가 핵심                                            |

캐시는 4개 식별자로 분리 (`sw.js`):

- `SHELL_CACHE` (예: `shell-1.4.16`) — 셸과 부팅에 필요한 메타. `importScripts('/sw-version.js')`로 `self.APP_VERSION`을 읽어 `"shell-" + APP_VERSION`으로 파생. 매 릴리스 갱신.
- `DATA_CACHE` (`"data"`) — 1329장 본문 + 검색 인덱스. 이름 자체는 고정, 항목별 무효화는 `js/manifest-sync.js`가 담당 (ADR-021).
- `AUDIO_CACHE` (`"audio"`) — 장별 mp3. 같은 메커니즘.
- `FONT_CACHE` (`"fonts"`) — Google Font 파일. 콘텐츠 주소 기반이라 사실상 영구.

`scripts/release.py`가 `version.json`과 `sw-version.js`를 한 번에 갱신 + 자동 commit. `--bump-data`/`--bump-audio` 같은 콘텐츠 캐시 bump 플래그는 ADR-021 이후 사라짐 — 콘텐츠 무효화는 `common-bible-data` 저장소 CI가 만든 `bible-manifest.json`·`audio-manifest.json` 변화를 앱이 부팅 시 비교해 항목 단위로 처리. 새 서비스 워커가 활성화되면 KNOWN_CACHES 에 없는 옛 캐시만 삭제되므로, 셸 영역만 갱신된 릴리스에서 사용자가 이미 받은 본문·오디오는 보존된다. 사용자 동의 없이 즉시 활성화(`skipWaiting()`)는 호출하지 않는다 — 사용자가 "업데이트" 버튼을 눌러 클라이언트가 `SKIP_WAITING` 메시지를 보낼 때만 새 서비스 워커가 곧바로 활성화된다.

## 5. 영속 데이터 — 어디에 무엇이 저장되는가

| 위치                     | 키/파일                                                                                     | 내용                                          | 동기화?   |
| ------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------- | --------- |
| `localStorage`           | `bible-bookmarks-v2`                                                                        | 북마크/폴더 (flat-map + 툼스톤)               | ✅        |
| `localStorage`           | `bible-font-size`, `bible-theme`, `bible-color-scheme`, `bible-book-order`, `bible-startup` | 설정 5종                                      | ✅        |
| `localStorage`           | `bible-last-read`                                                                           | 마지막 읽기 위치 (이어읽기 배너)              | ✅        |
| `localStorage`           | `bible-sync-meta`                                                                           | `{schemaVersion, deviceId}`                   | (메타)    |
| `localStorage`           | `bible-drive-sync`                                                                          | sync enabled 플래그 ("0"/"1")                 | (메타)    |
| `localStorage`           | `bible-drive-sync-email`, `bible-drive-sync-updated`                                        | 마지막 인증 이메일·시각                       | (메타)    |
| `localStorage`           | `bible-drive-redirect-attempts`                                                             | 무한 리디렉션 카운터 (cap 3)                  | (메타)    |
| `localStorage`           | `bible-audio-pos`                                                                           | 오디오 재생 위치                              | 로컬 전용 |
| `sessionStorage`         | `bible-drive-redirect-state-pkce`                                                           | PKCE state nonce + verifier (10분 TTL)        | 임시      |
| `IndexedDB`              | `refreshStore`                                                                              | AES-GCM 암호화 refresh token (암호화 키는 꺼낼 수 없는 상태로 저장 — `extractable: false`) | 로컬 전용 |
| Cache Storage            | `shell-X.Y.Z` (SHELL_CACHE)                                                                 | 앱 셸 + `books.json` + `search-meta.json` + 매니페스트 2종 | (배포물)  |
| Cache Storage            | `data` (DATA_CACHE)                                                                         | 1329장 본문 + 검색 인덱스 (ot/nt/dc)          | (누적)    |
| Cache Storage            | `audio` (AUDIO_CACHE)                                                                       | 장별 mp3 (필요 시 다운로드)                   | (누적)    |
| Cache Storage            | `fonts` (FONT_CACHE)                                                                        | Google Font 파일                              | (영구)    |
| `IndexedDB`              | `bible-manifest-sync/snapshots`                                                             | 직전 매니페스트 스냅샷 (diff 기준)            | 로컬 전용 |
| Google Drive (`appdata`) | `bookmarks-v2.json`                                                                         | 동기화 페이로드 (북마크+설정+이어읽기) + ETag | ☁️ 원격   |

동기화 대상이 아닌 항목(오디오 위치, 디바이스 ID, 캐시 등)은 의도적으로 기기 로컬에 머문다. 동기화 페이로드 스키마는 `js/types.d.ts`의 `SyncDoc` 타입과 `js/sync/store-v2.js:1` 헤더 주석에서 정의된다.

## 6. 정적 타입 검사 — `// @ts-check` + JSDoc

빌드 산출물 0개를 유지하면서도 타입 안전성을 얻기 위해 **TypeScript를 컴파일러로만 사용**한다 ([ADR-012](decisions/012-typescript-incremental-adoption.md)).

- 모든 클라이언트 JS 파일(sync 레이어 + `js/app.js` + `js/app/*.js` 9개 + `js/drive-sync.js` + `js/search-worker.js` + `js/audio-cache.js`)에 파일 상단 `// @ts-check`가 영구 활성화돼 있다 (2026-05-10, ADR-018 모듈 분할과 동행).
- 도메인 타입은 `js/types.d.ts` 한 곳에서 export.
- 다른 파일은 `@typedef {import("../types").Foo} Foo`로 가져온다.
- `tsconfig.json` (DOM lib) + `tsconfig.worker.json` (WebWorker lib) 두 개 분리.

검증:

```bash
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
```

두 명령 모두 0 error를 유지하는 것이 PR 머지 전제.

## 7. 테스트 — 3계층 + 유닛

테스트는 비용/실행 빈도/원본 텍스트 의존성에 따라 4종으로 분리되어 있다.

| 종류                                                                         | 위치                                       | 원본 필요?                               | CI?                   | 무엇을 보호하는가                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **클라이언트 JS 유닛** ([ADR-013](decisions/013-client-js-unit-tests.md))    | `tests/unit/*.test.js`                     | ❌                                       | ✅ (앱 저장소)        | sync 레이어(상태 머신·PKCE 등) + app 레이어(storage·helpers·install·search·bookmark·views-routing 순수 영역) 485 케이스. DOM-heavy 영역은 e2e가 책임 |
| **Level 1 완전성** ([ADR-004](decisions/004-data-pipeline-test-strategy.md)) | `data/tests/test_completeness.py` (서브모듈) | ❌                                       | ✅ (data 저장소)      | 1328개 장 파일·구조 누락                                                                                                                             |
| **Level 2 절 순서**                                                          | `data/tests/test_ordering.py`              | ❌ (`fixtures/verse_sequence.json` 사용) | ✅ (data 저장소)      | 파이프라인 변경 시 절 순서 회귀                                                                                                                      |
| **Level 3 스냅샷**                                                           | `data/tests/test_snapshots.py`             | ❌                                       | ✅ (data 저장소)      | cross-chapter 재배치 등 특수 케이스                                                                                                                  |
| **E2E (Playwright)**                                                         | `tests/e2e/*.py`                           | ✅ (서버 + 본문)                         | ❌ (로컬)             | 검색 UI, 라우팅, 클립보드, 설치 안내, 동기화 등 회귀                                                                                                 |

유닛 테스트는 `node --test`만으로 돌고, `tests/unit/harness.js`가 자체 vm 컨텍스트를 생성해 글로벌 상태 누수를 막는다 — 의존성 0. 앱 저장소 CI(`.github/workflows/test.yml`)는 Node 24로 유닛 테스트를 자동 실행. Level 1-3 데이터 파이프라인 검증은 `common-bible-data` 저장소의 `.github/workflows/validate.yml`이 push 시 자동 실행 (분할 후 ADR-020).

E2E는 의도적으로 CI에서 제외 — 본문 텍스트가 있는 환경에서만 의미가 있고, 시각 회귀는 사람이 봐야 가장 정확하다.

## 8. 빌드·배포·릴리스

배포는 `bible.anglican.kr` (운영) + `dev.anglican.kr` (개발) 두 도메인 — 동일 nginx 호스트에서 가상 호스트로 분리. 각 docroot는 `/var/www/{bible,dev}` 심볼릭 링크가 가리키는 버전 디렉터리이고, 배포·롤백은 심볼릭 링크 교체 한 번으로 끝난다 (atomic).

릴리스 단계(`release.py`)는 앱 저장소에 남아 있고, 빌드·배포 단계(`build-deploy.sh`·`deploy.sh`)는 `common-bible-server` 저장소로 이전 (ADR-020).

```bash
# 1. 버전 bump (앱 저장소에서, version.json + sw-version.js 동시 갱신 + 자동 commit)
python scripts/release.py patch                       # 또는 minor / major / X.Y.Z
# ADR-021 이후 본문/오디오 콘텐츠 무효화는 데이터 저장소 CI가 매니페스트 자동 갱신.
# 앱 저장소의 --bump-data / --bump-audio 플래그는 제거됨.

# 2. 배포 (common-bible-server 저장소에서 실행, $APP_ROOT 자동 감지 또는 명시)
~/Projects/common-bible-server/scripts/deploy.sh dev      # /var/www/bible-{ver}-{sha} 생성 + /var/www/dev 교체
~/Projects/common-bible-server/scripts/deploy.sh prod     # 동일하게 생성 + /var/www/bible 교체 (확인 프롬프트)
~/Projects/common-bible-server/scripts/deploy.sh promote  # /var/www/bible -> readlink(/var/www/dev), 재빌드 X
~/Projects/common-bible-server/scripts/deploy.sh rollback dev|prod  # -previous 와 swap (reversible)
```

`release.py`는 `version.json`과 `sw-version.js`의 `APP_VERSION`을 함께 갱신하고 자동 commit 한다 — 한쪽만 변경되어 SW가 새 셸을 못 가져오는 시나리오 차단. `DATA_CACHE`/`AUDIO_CACHE`는 ADR-021 이후 이름 자체가 고정이고, 콘텐츠 무효화는 `common-bible-data` 저장소 CI가 `bible-manifest.json`/`audio-manifest.json`을 자동 갱신해 `js/manifest-sync.js`가 앱 부팅 시 항목 단위로 처리한다.

`deploy.sh`는 `bible-{version}-{shortsha}` 디렉터리 명명을 쓴다 — dev에서 같은 버전을 여러 번 배포해도 덮어쓰지 않고, promote 시 dev에서 검증한 동일 디렉터리를 prod 심볼릭 링크가 가리키게 된다. `git diff --quiet` 체크가 dirty working tree에 `-dirty` suffix를 붙여 우발 배포를 추적 가능하게 한다.

매 swap·promote·rollback 직후 자동 검증 4종(`/version.json` 버전 일치·`/sw.js` 200+Content-Type·`/index.html` 200+ETag·`/data/books.json` 200)이 실행되고, 실패 시 manual rollback 안내 출력. 4개 보호 심볼릭(dev·bible·dev-previous·bible-previous) + `BUILD_RETENTION`(기본 3)개를 넘는 옛 빌드 디렉터리는 자동/확인 후 정리. 자세한 흐름은 `common-bible-server/scripts/deploy.sh` 헤더 주석.

전형적 릴리스 사이클: `release.py` → `deploy.sh dev` → `dev.anglican.kr` 시운전 → PR 머지 + 태그 + GitHub Release → `deploy.sh promote`.

업데이트 토스트 흐름:

1. 활성 SW가 정기 업데이트 체크 → 새 SW가 install 단계.
2. `js/app/settings-ui.js`가 `GET_VERSION` 메시지로 새 SW의 `version.json`을 조회 → 토스트 노출.
3. 사용자가 "업데이트" 클릭 → `SKIP_WAITING` → 새 SW activate → 페이지 reload.

자동 skipWaiting을 하지 않는 이유: 사용자가 본문을 읽고 있을 때 갑작스러운 reload가 일어나면 안 된다.

## 9. 보안 모델

OAuth 측면 (가장 큰 공격 표면):

- **콘텐츠 보안 정책 (CSP)**: `script-src 'self'` + 명시적 sha256 해시로 외부 스크립트 실행을 원천 차단. `accounts.google.com`은 더 이상 connect-src에 없다 (PKCE는 전체 페이지 리디렉션이라 프레임 로드 불요).
- **서비스 워커 우회**: OAuth/Drive 4개 도메인은 서비스 워커가 절대 캐싱하지 않음. GET 외 요청(POST 등)도 서비스 워커를 우회 — Cache API가 GET만 지원하기 때문에 같은 출처의 POST `/oauth/token`도 캐시 대상에서 제외.
- **`client_secret` 서버 쪽 격리**: SPA 번들·git 이력에 비밀 키가 일절 없음. 웹 서버(nginx)가 `proxy_set_body`로 매 `/oauth/token` 요청에 비밀 키를 주입. GitHub의 비밀 키 자동 감지(secret scanner)에 의한 무효화 위험 + OAuth 2.1 public client 정신 위배를 모두 회피 ([ADR-017](decisions/017-oauth-bff-proxy.md)).
- **OAuth Client ID 호스트 격리**: 개발용 Client ID는 Cloud Console에서 `dev.anglican.kr`만, 운영용 Client ID는 `bible.anglican.kr`만 허용된 출처(Authorized origin) / 리디렉션 URI로 등록. `localhost` 등록은 의도적으로 제외 — 사용자 PC의 악성 프록시가 같은 포트로 자리잡고 PKCE 흐름을 가로챌 가능성 차단.
- **PKCE state nonce**: 10분 동안만 유효. 검증 실패 시 콜백 URL을 즉시 `replaceState`로 덮어 어떤 라우터·로거도 보지 못하게 한다.
- **갱신 토큰 (Refresh token)**: 브라우저 내장 암호화 API(webcrypto)의 AES-GCM 알고리즘으로 암호화 + 암호화 키는 꺼낼 수 없는 상태로 저장(`extractable: false`). 평문은 한 번도 IndexedDB에 닿지 않는다.
- **디버그 로그 마스킹**: `sync/debug-log.js`의 `mask()`가 토큰·이메일·fileId의 머리·꼬리만 남기고 가운데를 `…`로 가린다.

브라우저 측면 (defense-in-depth 헤더):

- **서버 단 보안 헤더 6종 (nginx snippet)**: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 0`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=()`, `Cross-Origin-Opener-Policy: same-origin`. 모든 응답(HTML5 라우팅 폴백 포함)에 일관 적용. 단일 출처 `/etc/nginx/snippets/security-headers.conf` (저장소 예시: `common-bible-server/nginx/security-headers.example.conf`).
  - `X-XSS-Protection: 0`: 옛 브라우저가 자체 결함으로 다른 사이트로 정보가 새는 사례가 있어 OWASP/MDN 모두 `0` 또는 제거를 권장. 이미 인라인 CSP(`script-src 'self' + sha256`)가 같은 역할을 함.
  - `Referrer-Policy: strict-origin-when-cross-origin`: 모던 브라우저 기본값을 명시. 다른 사이트로 이동할 때는 도메인만 보내 URL 경로 노출 차단.
- **nginx `add_header` 상속 함정 우회**: location 수준에 `add_header`가 하나라도 있으면 서버 수준 헤더가 통째로 끊긴다 — 알려진 함정. 파일별 Cache-Control이 있는 위치에도 같은 snippet을 다시 include해 일관 적용 보장.

마지막 보안 감사: [`docs/audit/2026-05-07-pkce-refresh-token.md`](audit/2026-05-07-pkce-refresh-token.md) — Critical/High/Medium 0건.

## 10. 알려진 한계와 의도적 비결정

- **iOS Safari 탭 7일 자동 데이터 삭제 (ITP)**: 홈 화면에 설치하지 않고 Safari 탭에서만 쓰면 7일 미사용 시 저장된 데이터가 비워진다 (Apple의 Intelligent Tracking Prevention 정책). 대응: 설치 안내 모달 강화([ADR-008](decisions/008-pwa-install-guide.md)). 홈 화면에 추가된 PWA는 이 정책의 영향을 받지 않음.
- **Google OAuth 검수 진행 중**: 갱신 토큰(refresh token) 유효 기간이 현재 7일 (Google Testing 상태). 검수 통과 시 영구 유효로 자동 전환 — 코드 변경 0.
- **iOS Chrome/Firefox**: iOS의 모든 브라우저는 내부적으로 Safari 엔진(WebKit)을 쓰기 때문에 다른 브라우저 형태여도 설치 불가 + 다른 브라우저와 동기화 데이터 분리 미보장. "Safari에서 열기" 안내로 끝.
- **백엔드 부재**: 사용자별 통계, 다중 기기 푸시, 서버사이드 검색 등은 모두 불가. 의도적 트레이드오프 — 운영비 0이 더 중요하다.
- **번역본 1종**: 공동번역만 다룬다. 다국역 비교는 로드맵 밖.

## 11. 장기 로드맵과의 관계

현재(Phase 1)는 성경 읽기 PWA로 완성된 상태다. 다음 단계는 **컨텐츠 추가에 가까운 확장**으로 설계되어 있다:

- Phase 2 — **기도서**: `common-bible-data` 저장소의 `source/` 옆에 또 다른 마크다운 트리. 같은 파이프라인 재사용 가능. UI는 책 목록에 새 카테고리 추가 수준.
- Phase 3 — **교회력 계산기**: 순수 함수. 데이터 의존 없음. `js/app/views-routing.js`에 별도 라우트.
- Phase 4 — **성무일과 자동 생성**: 교회력(Phase 3) + 성경(Phase 1) + 기도서(Phase 2) 조합 → 매일 자동 페이지 생성.

각 단계가 **독립적으로 추가 가능**하도록 데이터 디렉토리·라우트·검색 인덱스를 책 단위로 분리해 둔 것이 핵심이다. 동기화 페이로드도 `settings`/`bookmarks`/`lastRead` 키별로 머지하므로 새 키 추가가 안전하다.

---

## 부록 A. ADR 인덱스 (한 줄 요약)

| ADR                                                     | 결정                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| [001](decisions/001-spa-architecture.md)                | Vanilla JS SPA + Python 일회성 전처리                      |
| [002](decisions/002-sirach-prologue-handling.md)        | 시락 머리말은 별도 JSON으로 추출 *(common-bible-data로 이전, ADR-020)* |
| [003](decisions/003-physical-chapter-ordering.md)       | 원전의 물리적 장 순서를 따름 *(common-bible-data로 이전, ADR-020)* |
| [004](decisions/004-data-pipeline-test-strategy.md)     | Level 1-3 데이터 검증 전략                                 |
| [005](decisions/005-search-indexing-strategy.md)        | 검색 인덱스 구약/신약/외경 청크 분할                       |
| [006](decisions/006-poetry-source-format.md)            | 운문 본문 segments 표현 *(common-bible-data로 이전, ADR-020)* |
| [007](decisions/007-launch-screen-optimization.md)      | iOS 13종 디바이스 스플래시                                 |
| [008](decisions/008-pwa-install-guide.md)               | 플랫폼별 설치 안내 모달                                    |
| [009](decisions/009-history-api-routing.md)             | History API SPA 라우팅                                     |
| [010](decisions/010-bookmark-feature.md)                | 북마크 데이터 모델 + UI                                    |
| [011](decisions/011-bookmark-sync.md)                   | Google Drive 동기화 (Phase 2a~2h)                          |
| [012](decisions/012-typescript-incremental-adoption.md) | `// @ts-check` + JSDoc 점진 도입                           |
| [013](decisions/013-client-js-unit-tests.md)            | `node --test` + vm 하네스 유닛 테스트                      |
| [014](decisions/014-search-history.md)                  | 검색 이력 (LRU·로컬 전용)                                  |
| [015](decisions/015-storage-strategy.md)                | localStorage 키 네임스페이스·크기 가드                     |
| [016](decisions/016-audio-cache-lru.md)                 | 오디오 캐시 LRU 제한                                       |
| [017](decisions/017-oauth-bff-proxy.md)                 | nginx BFF로 `client_secret` 격리                           |
| [018](decisions/018-app-modularization.md)              | `js/app.js` 6,082 → 283줄, 9개 도메인 모듈 분할            |
| [019](decisions/019-esm-module-system.md)               | ESM 일괄 채택 (`<script type="module">`), 빌드 단계 0 유지 |
| [020](decisions/020-monorepo-split.md)                  | 모노레포 4분할 (app·data·audio·server)                     |
| [021](decisions/021-pwa-versioning-content-hash.md)     | SHELL_CACHE = version.json 파생, DATA/AUDIO 콘텐츠 해시 매니페스트 |
| [022](decisions/022-citations-and-annotations.md)       | 본문 인용(`<cite>`) + 주석(footnote) 표현과 단일 토글 렌더  |
| [023](decisions/023-settings-toggle-switches.md)        | 설정 상위 4개 옵션 → OS별 네이티브 토글 스위치             |
| [024](decisions/024-book-list-tabs-and-header-nav.md)   | 성서 목록 탭 통합 + 읽기 헤더 내비 재설계                  |
| [025](decisions/025-header-scroll-elevation.md)         | 읽기 헤더 스크롤 elevation 그림자                          |

## 부록 B. 자주 보게 되는 파일 빠른 참조

- 부트스트랩 / Service Worker 등록: `js/app.js`
- 라우팅 + 본문 렌더 + 데이터 패칭: `js/app/views-routing.js`
- 검색 UI / 결과 시트 / 이력 패널: `js/app/search.js`
- 북마크 (트리/모달/셀렉션): `js/app/bookmark.js`
- 설정 화면 + 외관 적용: `js/app/settings-ui.js`
- 공통 DOM 헬퍼: `js/app/helpers.js`
- localStorage 영속화: `js/app/storage.js`
- 검색 워커 프로토콜: `js/search-worker.js:1` (헤더 주석)
- 상태 머신 진입점: `js/sync/state-machine.js`의 `dispatch()`
- 머지 알고리즘: `js/sync/store-v2.js`의 `mergeDocs()`
- SW 캐시 전략: `sw.js`의 `fetch` 리스너
- Drive REST 호출: `js/sync/transport.js` (모든 fetch가 여기 한 파일)
- 도메인 타입: `js/types.d.ts`
