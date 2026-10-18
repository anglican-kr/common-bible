# 아키텍처 개요

이 문서는 공동번역성서 PWA의 전체 구조를 한눈에 보기 위한 지도다. 세부 결정의 근거는 `docs/decisions/`의 ADR을 참조하고, 코드 라인 단위 설명은 본문에 인라인으로 인용한 파일을 직접 읽기를 권한다.

> 이 문서는 **계속 변경되는 설계 문서**다. 결정 그 자체가 아니라 결정들의 합쳐진 결과를 설명한다. 새로운 결정이 생기면 ADR을 먼저 작성하고, 그 결과로 본 문서가 달라지면 여기를 갱신한다.

## 1. 한 줄 요약

브라우저가 정적 JSON 파일을 직접 읽어 렌더링하는 **프레임워크 없는 단일 페이지 앱(SPA) + 서비스 워커 오프라인 캐시**. 빌드 단계는 data 저장소의 Python 스크립트가 마크다운 원본과 전례 자료를 JSON으로 전처리하는 것뿐이고(data 저장소 main에 push되면 CI가 돌려 커밋한다 — §3), 런타임에는 서버가 없다 — 정적 호스팅에 그대로 배포된다.

저장소는 4개로 분리되어 있다 (ADR-020): 본 앱 저장소(공개) + `common-bible-data`(비공개, 마크다운·파이프라인·빌드 출력) + `common-bible-audio`(비공개 LFS, mp3) + `common-bible-server`(비공개, nginx·배포 스크립트). 앱이 data를 서브모듈로 마운트하고 data가 audio를 nested 서브모듈로 마운트하므로 docroot 기준 URL은 `/data/...`로 그대로 유지된다.

`bible.anglican.kr` (운영) + `dev.anglican.kr` (개발) 두 도메인이 동일한 웹 서버에서 가상 호스트로 서빙된다. 각 도메인의 docroot는 `/var/www/{bible,dev}` 심볼릭 링크가 가리키는 디렉터리(`bible-{version}-{shortsha}`)이고, 배포·롤백은 심볼릭 링크 교체 한 줄로 끝난다 (`common-bible-server/scripts/deploy.sh` 참조).

Google Drive 동기화·OAuth는 외부 의존이지만 단 한 군데 — `/oauth/token` POST는 nginx가 `client_secret`을 server-side로 주입한 뒤 `oauth2.googleapis.com/token`으로 forward하는 BFF 패턴 — 만 서버 단 매개를 쓰고, 나머지는 클라이언트가 직접 Google 엔드포인트와 통신한다 ([ADR-017](decisions/017-oauth-bff-proxy.md)).

```
        ┌────────────────────────────────────────────────────────────┐
        │  common-bible-data  (비공개)                               │
        │   source/*.md  →  src/parser.py → src/split_bible.py       │
        │                →  src/search_indexer.py                    │
        │   liturgical/  →  src/liturgical_psalter.py                │
        │                →  liturgical/*.py (교회력 · 전례독서 표)   │
        │                →  bible/*.json · books.json · search-*.json│
        │                   lectionary/*.json · *-manifest.json      │
        │   audio/  (nested 서브모듈 → common-bible-audio, LFS mp3)  │
        └──────────────────────────────────┬─────────────────────────┘
                                           │ git submodule pointer
                                           ▼
        ┌────────────────────────────────────────────────────────────┐
        │  common-bible  (공개, 본 저장소)                           │
        │   index.html · sw.js · js/ · css/ · assets/                │
        │   data/  ← common-bible-data 마운트                        │
        └──────────────────────────────────┬─────────────────────────┘
                                           │ build-deploy.sh + ssh
                                           ▼
        ┌────────────────────────────────────────────────────────────┐
        │  common-bible-server  (비공개)                             │
        │   nginx/  (BFF·보안 헤더)                                  │
        │   scripts/deploy.sh  → seoul:/var/www/bible-{ver}-{sha}/   │
        │                                                            │
        │   bible.anglican.kr → /var/www/bible →                     │
        │   dev.anglican.kr   → /var/www/dev   →                     │
        │     (각 심볼릭 링크가 bible-{ver}-{sha}/ 가리킴)           │
        │                                                            │
        │   location = /oauth/token  (BFF, ADR-017)                  │
        │     │ inject client_secret                                 │
        │     ▼                                                      │
        │     oauth2.googleapis.com/token                            │
        └──────────────────────────────────┬─────────────────────────┘
                                           │ HTTPS
                                           ▼
        ┌────────────────────────────────────────────────────────────┐
        │  브라우저 (PWA)                                            │
        │                                                            │
        │   ┌─ index.html (<script src> 31개) ─────┐                 │
        │   │  app.js + app/* 20개 (화면)          │                 │
        │   │   + import 전용 app/* 5개(bookmark-*)│                 │
        │   │   + 처음 갈 때 import() 3개(교회력)  │                 │
        │   │  drive-sync.js + sync/* 5개 (동기화) │                 │
        │   │  audio-cache.js  (오프라인 오디오)   │                 │
        │   │  manifest-sync.js (콘텐츠 해시 diff) │                 │
        │   │  pre-fetch.js + gtag-init.js         │                 │
        │   │  ─ Web Worker ─                      │                 │
        │   │  search-worker.js (별도 컨텍스트)    │                 │
        │   └──────────────────────────────────────┘                 │
        │                                                            │
        │   sw.js (오프라인 셸 · 캐시 우선 — 매니페스트는            │
        │          네트워크 우선, Google은 우회)                     │
        │                                                            │
        │   localStorage · sessionStorage · IndexedDB 3 · 캐시 4     │
        └──────────────────────────────────┬─────────────────────────┘
                                           │ HTTPS
                                           ▼
                        Google: accounts.google.com (consent),
                                www.googleapis.com (Drive appdata · userinfo),
                                oauth2.googleapis.com (/revoke)
                                ※ /token만 BFF 경유
```

## 2. 아키텍처를 결정한 4가지 제약

1. **저작권** — 원본 텍스트는 비공개 저장소(`common-bible-data`, ADR-020)의 `source/` 하위 마크다운으로 관리된다. 본 앱 저장소가 그 저장소를 `data/`에 서브모듈로 마운트하므로 docroot URL은 그대로 `/data/...`. 빌드 산출물(`bible/` · `books.json` · `search-*.json` · `lectionary/` · 매니페스트 2종)도 data 저장소에 commit 되므로(main에 push되면 CI가 다시 만들어 커밋한다) 앱은 서브모듈 포인터로 잠금만 한다. 파이프라인 실행은 권한 있는 사용자만 가능 (data 저장소 접근권 필요).
2. **비상업·비영리** — 백엔드를 운영할 인력·예산이 없다. 모든 상태는 클라이언트 또는 사용자의 Google Drive(appdata)에 산다.
3. **오프라인 우선** — 교회·예배 환경의 불안정한 네트워크를 가정. PWA + Service Worker가 설치 때 셸(JS · CSS · HTML · 아이콘 · `books.json` · `search-meta.json` · 매니페스트 2종)을 받아 두고, 본문 장 · 검색 청크 · 교회력 표 · mp3는 처음 쓸 때 캐시해 그 뒤로는 오프라인에서도 열린다 — 미리 전부 받지는 않는다(§4.6).
4. **장기 유지보수성** — 1인 개발이 가능해야 한다. 프레임워크/번들러 부재, 의존성 최소, 테스트 자동화 — 이 셋이 핵심 가드다.

이 4개가 SPA·Vanilla JS·Python 일회성 전처리·Drive appdata·정적 호스팅이라는 선택을 거의 단일 결론으로 강제했다. 자세히는 [ADR-001](decisions/001-spa-architecture.md).

## 3. 빌드 타임 — 데이터 파이프라인

원본 마크다운(73권)을 1328장의 장별 JSON(+ 시락 머리말)과 검색 인덱스(별칭 메타 + 구약 · 신약 · 외경 청크 셋)로, 전례 원료(전례시편 · 송가 정본, 교회력 정의 표, 전례독서 · 본기도 기사)를 전례 책의 장 JSON과 교회력 · 전례독서 표로 변환한다. 빌드는 의도적으로 **일회성 스크립트의 합성**이고, 어떤 빌드 시스템(make/just/poetry)에도 묶지 않는다 — 각 스크립트가 같은 입력에 같은 출력을 준다. 다만 **순서는 지킨다** — `split_bible.py`가 `books.json`을 73권으로 새로 쓰므로 전례시편 파서가 그 뒤에 돌아야 두 권의 등록이 남고, 전례 표 파서끼리도 서로의 산출을 읽는다. 명령과 순서의 정본은 data 저장소 `CLAUDE.md` 「파이프라인 명령」이다(`build.yml`이 같은 순서로 돈다).

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
src/search_indexer.py     ← 절 단위 인덱스를 구약/신약/외경으로 분할 (전례 책은 넣지 않는다)
        │  search-meta.json   (~10 KB, 책 별칭)
        │  search-ot.json     (~3.8 MB)
        │  search-nt.json     (~1.3 MB)
        │  search-dc.json     (~700 KB)
        ▼
src/liturgical_psalter.py ← 전례시편 · 송가 — liturgical/psalter · canticles의 마크다운 (계응 구조라 별도 파서, data 저장소 ADR-039)
        │  bible/lps-{n}.json (150) · bible/cant-{n}.json (13)
        │  books.json에 lps · cant 추가 (→ 75권, division "liturgical")
        ▼
liturgical/*.py           ← 전례독서 · 연중 주간 · 본기도 · 교회력 정의 표 · 설·추석 · 성인 공통 (ADR-036 · 037)
        │  lectionary/*.json (11개 — 캘린더 묶음 다섯 · 전례독서 묶음 넷 · 지역 축일 · 전례독서 검색 색인)
        ▼
scripts/gen_manifests.py  ← 콘텐츠 해시 매니페스트 (ADR-021)
           bible-manifest.json (bible/ · 검색 청크 셋 · lectionary/)
           audio-manifest.json (mp3 — LFS 포인터 OID)
```

(앱 docroot에서는 동일 산출물이 `data/bible/...`·`data/search-*.json` 위치로 보인다 — 서브모듈 마운트에 따른 prefix.)

설계 포인트:

- **물리적 장 순서**: 시락 머리말, 다니엘 추가본 등 본래 장 번호가 어그러지는 부분은 "원전이 있는 그대로의 물리 순서"를 따른다 ([ADR-003](decisions/003-physical-chapter-ordering.md)).
- **검색 인덱스 분할 (구약/신약/외경)**: 5.8 MB 단일 파일을 3개로 쪼개 첫 검색 응답 속도를 우선 ([ADR-005](decisions/005-search-indexing-strategy.md)). 워커는 신약 청크만 받으면 검색을 시작한다(§4.2).
- **운문 본문 포맷**: 마크다운 블록인용(`>`)으로 표기. 절 내 산문/운문 구분은 `segments` 배열(`type: "prose"|"poetry"`), 스탠자 구분은 절 간 `stanza_break: true` 또는 절 내 텍스트의 `\n\n`, 단락 구분은 segment 레벨 `paragraph_break: true`. 자세히 [ADR-006](decisions/006-poetry-source-format.md).
- **교회력 데이터**: 교회력 정의 표가 「그날이 무슨 날인가」의 권위이고(품계 · 전례색), 전례독서 · 본기도는 이름 · 좌표로 그 표에 조인되는 본문 표다 — 독서와 본기도 파서는 좌표 계산을 함께 쓴다 ([ADR-036](decisions/036-liturgical-calendar-data-model.md) · [ADR-037](decisions/037-eucharist-lectionary-data-and-engine.md)). 이동 축일 규칙 문자열(`easter-46` 등)은 파서가 빌드 때 구조화해 두므로 앱 엔진은 다시 파싱하지 않는다.

**자동화**: data 저장소 main에 파이프라인 입력이 푸시되면 `build.yml`이 파이프라인 · 매니페스트 · 전체 pytest를 돌려 산출물을 main에 커밋하고, 앱 저장소의 `sync-data.yml`을 디스패치한다. `sync-data.yml`은 서브모듈 포인터와 `sitemap.xml`을 올리고 실데이터 테스트를 돌린 뒤, 통과하면 `sync/data-<run_id>` PR을 열어 Unit tests 뒤 자동으로 스쿼시 머지한다(버전 범프 없음). 실데이터 테스트에는 교회력 설계서의 사실 블록 대조가 들어 있어, 데이터가 문서의 실측치를 바꾸면 이 자동 PR은 만들어지지 않는다 — 문서를 함께 고친 앱 PR이 포인터를 올린다.

자세한 실행 명령은 [README §데이터 파이프라인 실행](../README.md#데이터-파이프라인-실행).

## 4. 런타임 — 클라이언트 모듈 지도

런타임은 40개의 자바스크립트 파일로 분산되어 있다(`js/` 7 · `js/app/` 28 · `js/sync/` 5) — 메인 스레드 39개(`index.html`의 `<script src>` 31 + `import` 전용 `bookmark-*` 5 + 그 화면에 처음 갈 때 `import()`로 받는 교회력 3) + Web Worker 1개(`search-worker.js`). 서비스 워커 쪽(`sw.js` · `sw-version.js`)과 TypeScript 전용 `js/types.d.ts`는 이 수에 넣지 않는다.

ADR-018 모듈 분할(2026-05-10)로 옛 단일 `app.js` 약 6,000줄이 8개 도메인 모듈로 쪼개졌고, 잔류 `app.js`는 부트스트랩 + Service Worker 등록 정도만 남았다. 자세한 분할 결과는 [`docs/archive/design/app-modularization.md`](archive/design/app-modularization.md). 분할과 함께 ADR-019로 모듈 시스템을 **ESM으로 일괄 전환**했다(2026-05-09 · 05-10). 이후 ADR-022(인용·주석)·ADR-027·ADR 030-035·ADR-037·ADR-038이 모듈을 더했고, ADR-034 2차 분할과 그 후속 `bookmark.js` 분할이 비대 모듈을 갈라 현재 `js/app/` 도메인 모듈은 **28개**다(교회력 엔진 `liturgical-engine.js` · 전례독서 뷰 `lectionary.js` · 캘린더 탭 `calendar.js` 포함).

### 로드 방식

`index.html`이 31개 `<script src>` 태그(로컬 JS)를 의존성이 있는 순서대로 **명시적으로 나열**한다 (ADR-019 §"채택 방식") — 그 밖에 Google 태그 외부 스크립트(`async`) 1개와 JSON-LD 데이터 블록 1개가 있다. 진입점 하나를 두고 ESM `import` 그래프에 로드를 맡기는 구조가 **아니다** — 모듈 대부분이 자기 `<script>` 태그를 가지며, 브라우저는 태그를 발견 순서로 로드한다. 예외는 아래의 여덟이다 — `bookmark-*` 5개는 태그 없이 `bookmark.js`의 `import`를 따라 부팅 때 로드되고, 교회력 셋(`liturgical-engine.js` · `lectionary.js` · `calendar.js`)은 부팅 때 싣지 않고 `/calendar` · `/lectionary`에 처음 갈 때 `routing.js`의 `import()`로 로드된다(ADR-038 §2 「구현」).

| 로드 모드                                | 파일 수 | 비고                                                                                                                 |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `<script type="module">` (자동 deferred) | 28      | 대부분의 모듈. 모듈 scope + `import`/`export` 가능                                                                   |
| `<script defer>` (classic)               | 2       | `audio-cache.js`·`manifest-sync.js` — `audio-cache.js`는 `sw.js`의 `importScripts()`도 가져가므로 classic이어야 한다 (ADR-019 §"예외"). `manifest-sync.js`도 classic이지만 `sw.js`는 가져가지 않는다 |
| `<script>` (head, 즉시 실행)             | 1       | `pre-fetch.js` — `<head>`에서 즉시 `data/books.json` 다운로드 시작. `type="module"`은 자동 deferred라 fetch가 늦어짐 |

`<script>` 태그가 없는 런타임 파일이 9개 더 있다: `search-worker.js`는 `new Worker()`로 별도 생성되는 독립 컨텍스트이고, `bookmark-{tree,gestures,select,menu,verse-select}.js` 5개는 `bookmark.js`가 ESM `import`로 끌어오며(브라우저가 import 그래프를 따라 가져온다), 교회력 셋은 `routing.js`가 그 화면에 처음 갈 때 동적 `import()`로 불러온다 — 캘린더 탭은 셋을, 전례독서 화면은 뷰와 엔진 둘을 한꺼번에 요청한다(차례로 받으면 왕복이 한 번 더 든다 — Chromium; WebKit은 앱 안에서 처음 갈 때 의존 모듈을 한 번 더 요청한다, [`known-issues.md`](known-issues.md) §13). 성서만 읽는 세션은 셋(원본 약 210KB · gzip 약 70KB)을 싣지 않고, 서비스 워커는 오프라인용으로 셋을 미리 받는다(§4.6). 이득과 대가는 서비스 워커 캐시가 없는 첫 방문에만 있다 — 첫 화면은 느린 4G에서 0.39초 빨라지고, 첫 방문에 성서 화면에서 캘린더 탭을 열면 0.53초, 그 주소로 바로 들어오면 0.16-0.2초 늦어진다(바로 열기를 미리 받는 `modulepreload`는 WebKit에서 실패한 미리 받기가 그 탭을 막아 넣지 않았다 — ADR-038 「검토한 대안 — 모듈 로드」 E). 재방문의 부팅 시간은 어느 쪽이든 측정 오차 안이다(ADR-038 §2 「구현」의 실측). 받지 못하면 라우터가 그 뷰의 제목으로 실패 화면을 그리고 「다시 불러오기」(페이지 새로 고침)를 단다. 지정자는 글자 그대로 둔다 — `tests/unit/sw.test.js`가 그것을 따라가 오프라인 목록을 대조하고, 셋이 부팅 그래프 밖에 있는지도 본다.

모듈 간 의존은 여전히 `window.X` 공개 인터페이스(facade — `window.driveSync` / `window.appHelpers` 등 전역 객체)가 주류이고, ADR-019는 이를 **점진 폐기** 대상으로 정의 — 신규 코드는 `import`/`export`로 작성 권장.

**최상위 (`js/`):**

| 파일                  | 역할                                                                                                                              | 라인 수 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `js/pre-fetch.js`     | 첫 페인트 직전 `data/books.json` 비동기 선패치                                                                                    | ~10     |
| `js/gtag-init.js`     | Google Analytics 초기화                                                                                                           | ~15     |
| `js/app.js`           | app-main 부트스트랩 + 접근성 keydown + Audio cache LRU 소프트캡 + SW 등록 · 업데이트 확인(한 시간에 한 번까지 · `checkForUpdates`) · 업데이트 토스트 + 탭 복귀 때 Drive `pollSync` · `clearAllCaches` | ~330    |
| `js/audio-cache.js`   | 오디오 LRU IndexedDB sidecar ([ADR-016](decisions/016-audio-cache-lru.md))                                                        | ~190    |
| `js/manifest-sync.js` | 부팅 시 콘텐츠 해시 매니페스트 diff → DATA/AUDIO_CACHE 항목 단위 무효화 ([ADR-021](decisions/021-pwa-versioning-content-hash.md)) | ~200    |
| `js/search-worker.js` | Web Worker. 청크 로딩 + 절 검색 + 페이지네이션                                                                                    | ~390    |
| `js/drive-sync.js`    | Drive 동기화 파사드(코디네이터) — PKCE 콜백 흡수 · 업로드 디바운스 · 로그아웃 · 「파일도 삭제」(자격 증명 먼저) · 다른 탭의 로그아웃 감지 · 동기화 스낵바(라이브 리전에도) | ~285    |
| `js/types.d.ts`       | 도메인 타입 단일 출처 ([ADR-012](decisions/012-typescript-incremental-adoption.md))                                               | —       |

**`js/app/` — 도메인 모듈 28개 (ADR-018 1차 분할 + ADR-022 인용·주석 + ADR-034 2차 분할 + bookmark 분할 + 교회력 엔진 + 전례독서 뷰 + 캘린더 탭):**

| 파일                               | 역할                                                                                                                                                                       | 라인 수 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `js/app/helpers.js`                | 공통 DOM 헬퍼 (`_$`/`el`/`clearNode`/`setInert`/`trapFocus`) + `emptyState` 빌더 + `headerIcon` · `HEADER_ICON_PATHS`(헤더 아이콘 SVG 규격 하나와 글리프마다 path 하나 — 집 단추 · 전례독서 위 단계 꺾쇠 · 인용 시트 뒤로 단추 공용) + `isModifiedClick`(새 탭 클릭 판정 — 전역 `<a>` 인터셉터 · 탭 처리기 공용) + `focusSpotOf` · `restoreFocusSpot`(같은 화면을 다시 그린 뒤 누른 컨트롤로 포커스 · 화면 위치를 돌려준다 — 라우터가 잇는다, 포커스를 잃었을 때만, ADR-031 §5) | ~355    |
| `js/app/overlay.js`                | 오버레이 생명주기 단일 컨트롤러 `createOverlay`(scrim·trapFocus·Escape·inert·포커스 복원·애니메이션 dismiss) + 시트 팩토리 + `closeAllOverlays()` registry ([ADR-032](decisions/032-component-view-layer.md), ADR-034 PR5b) | ~330    |
| `js/app/storage.js`                | localStorage 헬퍼 + UI 공유 상수 (+ 전례독서 트랙 기억 `bible-lectionary-track`)                                                                                          | ~465    |
| `js/app/settings-ui.js`            | 설정 팝오버 · 모바일 설정 화면 + 외관 적용 + 인용·주석 토글 + Drive 줄(연결 · 해제 · 진단 복사 · 끝나지 않은 삭제의 남는 안내 `.settings-drive-note` — 로그인 상태가 바뀌면 두 화면 다 다시 그린다) | ~880    |
| `js/app/install.js`                | PWA 설치 감지 + 안내 모달 + nudge                                                                                                                                          | ~495    |
| `js/app/search.js`                 | 검색 워커 wire-up + 결과 렌더 + 이력 패널 + sheet ([ADR-033](decisions/033-search-options.md)). 쪽 링크는 포커스 키를 달고(라우터가 돌려준다 — ADR-031 §5) 쪽은 라이브 영역이 말로 알린다, 결과 건수 줄은 `h2` | ~1,575  |
| `js/app/reading-context.js`        | 현재 책/장 + 절 선택 모드 공유 상태                                                                                                                                        | ~35     |
| `js/app/verse-spec.js`             | 절 스펙 파싱·비교·직렬화·병합 + `verseInstanceKey` (leaf, ADR-034·ADR-038 §3 렌더 기반)                                                                                              | ~335    |
| `js/app/liturgical-engine.js`      | 교회력 엔진 (leaf, ADR-037 §6) — 계산(A1-a, 설계서 §4: computus·절기 스팬·연중 주차·주기·기간 축) + 조회(A1-b, 설계서 §5: 두 묶음 프리로드·`resolveDate` 후보 집합·`findReadings`·`findCollects`) + 품계·승자·전례색·재일·이동(B1, 설계서 §6: 범주 사다리·재분류·`fastOf`·연도 단위 이동 패스 `computeTransfers`·선택 봉헌 `setActivatedOptionals`). 교회력을 계산하는 범위(1583-9999 — `MIN_YEAR` · `MAX_YEAR` · `isComputableYear` · `isComputableDate`)의 정본이고 `resolveDate`는 범위 밖에 null. 부팅 때 싣지 않는다 — 전례독서 · 캘린더가 import하고, 그 둘을 `routing.js`가 그 화면에 처음 갈 때 `import()`로 불러온다 | ~2,155 |
| `js/app/lectionary.js`             | 전례독서 뷰 — `/lectionary[/YYYY-MM-DD]`: 순수 모델 `buildLectionaryModel`(초기 선택 · 트랙 · 대안 세트 세 갈래(「또는」·조건부·괄호 선택 구절 합침) · 본기도 · 칩 라벨 · 두 독서 카드 · 헤더 색 · URL 상태, `LECTIONARY_MODEL` 마커 블록) + DOM(본기도 → 독서 네 슬롯 — `appendVerses` 계응 시편 + 영광송 1회 + 선택 구절 〔 〕, 관측일 칩, 세그먼트, 날짜 이동 줄 `buildDateNav` — 캘린더와 공유; 다시 그리는 링크는 포커스 키만 단다 — 라우터가 돌려준다). 엔진의 첫 소비자 ([ADR-038](decisions/038-calendar-lectionary-ui.md) §3). 머리 · 실패 화면은 `views.js`의 것을 쓴다. 부팅 때 싣지 않는다 — `/lectionary`(또는 캘린더 탭)에 처음 갈 때 `routing.js`가 `import()`로 불러온다 | ~1,275 |
| `js/app/calendar.js`               | 캘린더 탭 — `/calendar[/YYYY-MM]` 월간 표: 순수 모델 `buildMonthGrid` · `calendarDay`(6주 × 7일 · 칸 이름 하나 — 대표, 격자 평일이면 사계재 · 기념일 · 번호 주일 「연중29주」 · 그날의 전례색 `colors` · 전례년 첫날 표지 · 링크 이름, `CALENDAR_MODEL` 마커 블록) + DOM(`<table>` 7열 · 이전/다음/오늘 링크). 캘린더 묶음만 프리로드, 이름 · 날짜 · 색 함수와 날짜 이동 줄은 `lectionary.js`에서, 계산 범위 판정은 엔진에서, 머리 · 실패 화면은 `views.js`에서 import ([ADR-038](decisions/038-calendar-lectionary-ui.md) §1 · §2). 부팅 때 싣지 않는다 — `/calendar`에 처음 갈 때 `routing.js`가 `import()`로 불러온다 | ~390 |
| `js/app/bookmark-core.js`          | DOM-free 북마크 로직 (트리 query/insert/remove·href/share·정렬/최근본·active-route 술어) — 창 객체(facade) 없이 다른 모듈이 `import`로 쓴다(자기 `<script>` 태그는 있다, ADR-034) | ~405    |
| `js/app/bookmark-modals.js`        | 북마크 모달 7종(confirm·새 폴더·폴더 콤보박스·save/edit·merge·import·move picker) + 렌더 콜백 의존성 주입 + 단일 Escape 스택(`closeTopmostModal`) (ADR-034) | ~910    |
| `js/app/bookmark.js`               | 북마크 **드로어/헤더 오케스트레이터** — 드로어 lifecycle·헤더 버튼·init 배선·facade·keydown + Drive 연결 해제 모달(「파일 유지」 · 「파일도 삭제」). 트리 렌더·제스처·선택·⋯ 메뉴·절 선택은 아래 5모듈로 분리 (ADR-034 후속, 2026-06-11) | ~560    |
| `js/app/bookmark-tree.js`          | 트리 렌더링 — per-row 빌더(스와이프 액션·드래그 핸들·선택 원·폴더 읽기 버튼) + `renderBookmarkTree`(드로어 본문/전체뷰) + `_rerenderActiveBookmarkTree` 허브 + `renderBookmarksView` + 드로어 키보드 내비 | ~635    |
| `js/app/bookmark-gestures.js`      | 제스처 엔진 — 드래그 reorder(≡ 핸들에서만 개시, ADR-010 개정) + 스와이프-액션 노출 + 스와이프 릴리스 수학(`SWIPE_GESTURE` 마커 블록, 유닛 테스트) + 통합 포인터 핸들러      | ~505    |
| `js/app/bookmark-select.js`        | 선택 삭제 모드 — 선택 상태 + 캐스케이드 수학(`BOOKMARK_SELECT` 마커 블록) + `#bm-select-bar` dock(공유·이동·삭제) + 전체 선택 ([ADR-029](decisions/029-mobile-tab-bar.md) 개정) | ~365    |
| `js/app/bookmark-menu.js`          | 전체뷰 title-row 액션 — ⋯ 오버플로 메뉴(새 폴더·내보내기·가져오기·선택) + 정렬 필드/순서 라디오 + 🛈 안내 팝오버 + `exportBookmarks`                                       | ~440    |
| `js/app/bookmark-verse-select.js`  | 절 선택 모드 — 본문에서 절 탭 → `#verse-select-bar` dock(진행 중 스펙 + 북마크·복사), near-leaf                                                                            | ~150    |
| `js/app/bookmark-read.js`          | 북마크 모아 읽기 — 폴더 단위 연속 읽기 화면(`appendVerses`로 절 부분집합 렌더, 인접·연속 본문 병합, 네스팅 폴더는 소제목) ([ADR-035](decisions/035-bookmark-reading-view.md)) | ~465    |
| `js/app/citations.js`              | 인용 칩 dedup·렌더 + 인용 본문 바텀 시트 (확장 뷰·드래그 리사이즈) + 주석 anchor 위첨자 + 클릭 툴팁 ([ADR-022](decisions/022-citations-and-annotations.md)). 시트 머리의 뒤로 꺾쇠는 `headerIcon` 으로 그린다 | ~1,135  |
| `js/app/parallels.js`              | 단락 단위 병행 본문 — `chapter.parallels` → range 시작 절 ※ anchor, 누르면 주석 꼴 툴팁 · 그 안의 출처를 누르면 cite-sheet ([ADR-027](decisions/027-source-dsl-and-parallel-passages.md)) | ~295    |
| `js/app/tab-history.js`            | 탭별 라우트·스크롤 위치 복원 (POP 의미론: popstate·탭 전환에서만 복원; `/lectionary`·`/calendar` 는 캘린더 탭) ([ADR-031](decisions/031-tab-history-restore.md))           | ~140    |
| `js/app/data-fetch.js`             | 데이터 패칭 (books/version/chapter/prologue fetch + booksCache/appVersion 캐시), leaf 모듈 (ADR-034 PR2)                                                                   | ~90     |
| `js/app/audio-player.js`           | 장별 mp3 플레이어 UI + 재생 상태 + `#audio-bar` lifecycle (ADR-034 PR1)                                                                                                    | ~240    |
| `js/app/views.js`                  | 렌더 헬퍼 + Views + `appendVerses` 절 렌더 + 세그먼트 탭 빌더 `buildSegmentTabs`(구분 탭 · 독서 뷰 세그먼트 공유 — 항목의 `focusKey`로 라우터가 다시 그린 뒤 포커스를 돌려준다) + 책 이름/헤더 자동 짧게 swap + 캘린더 · 전례독서의 머리 · 전체 화면 실패(`commitLiturgicalTitle` · `renderLiturgicalFailure` — 두 화면 모듈과 라우터가 함께 쓴다; 화면 모듈을 받지 못해도 그릴 수 있게 부팅 모듈에 둔다) (데이터 패칭→data-fetch.js·오디오→audio-player.js·탭 인디케이터→tabbar.js·라우팅→routing.js·PTR 제거, ADR-034) | ~1,810 |
| `js/app/routing.js`                | URL 파싱(parsePath — `/lectionary` 쿼리 상태 포함)·SPA 내비(navigate)·route() 오케스트레이터·page meta/분석·읽기 위치 스크롤 추적·링크클릭/popstate 리스너 (ADR-034 PR5a). 링크클릭 인터셉터가 같은 화면을 다시 그리는 링크의 자리를 재 두었다가 `route()`의 `finally`에서 돌려주고(ADR-031 §5), 페이지 안 링크(「본문 바로가기」)는 라우트하지 않고 대상으로 포커스만 옮긴다. 캘린더 · 전례독서 모듈은 그 분기에서 처음 갈 때 `import()`로 한꺼번에 받고(`openLazyView` — 받은 모듈은 기억해 다시 그릴 때 기다리지 않는다), 받지 못하거나 그리다 오류가 나면 `views.js`의 실패 화면(그 뷰의 제목 · 머리 · 「다시 불러오기」 — [ADR-038](decisions/038-calendar-lectionary-ui.md) §2 「구현」)을 그린다. 공용 `catch`도 낡은 route의 실패는 버린다 | ~760 |
| `js/app/tabbar.js`                 | 탭 바 — 활성 상태·슬라이딩 인디케이터(ADR-034 PR3) + 검색 모핑 dock·하단 입력·visualViewport 키보드 처리 ([ADR-030](decisions/030-morphing-tab-bar.md))                    | ~580    |

`bookmark-{tree,gestures,select,menu,verse-select}.js` 5개는 `index.html`에 `<script>` 태그가 없다 — `bookmark.js`가 ESM `import`로 끌어온다. 교회력 셋(`liturgical-engine.js` · `lectionary.js` · `calendar.js`)도 태그가 없다 — 위 「로드 방식」.

**`js/sync/` — 동기화 레이어:**

| 파일                       | 역할                                                                                            | 라인 수 |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| `js/sync/state-machine.js` | 동기화 상태 머신 (PKCE 단일 경로, [ADR-011](decisions/011-bookmark-sync.md) Phase 2h) — 사이클 대기마다 `_leftSyncing` · 끄는 길 `_stopSync` · 「파일도 삭제」 `deleteRemoteFile` | ~1,160  |
| `js/sync/transport.js`     | PKCE primitives + Drive REST + `/oauth/token` BFF ([ADR-017](decisions/017-oauth-bff-proxy.md)) — 찾기 · 내려받기 · 올리기 · 지우기는 상태 코드를 함께 돌려준다 | ~525    |
| `js/sync/store-v2.js`      | per-record mtime + tombstone 머지                                                               | ~430    |
| `js/sync/refresh-store.js` | OAuth refresh token 암호화 IDB (AES-GCM 비추출 키)                                              | ~190    |
| `js/sync/debug-log.js`     | ring buffer 진단 로그                                                                           | ~160    |

위 파일들 외에 `js/types.d.ts`는 TS 컴파일러 입력 전용으로 쓰인다(`@typedef`/`@type`이 참조). 의존 순서·로드 모드 변경 시 [ADR-019](decisions/019-esm-module-system.md) 참조.

### 4.1 라우팅 (History API SPA)

`js/app/routing.js`가 브라우저 history API(`pushState`/`popstate`)로 URL을 갱신해 페이지 이동을 흉내내고, 서비스 워커는 모든 페이지 이동 요청을 `/index.html`로 대체해 같은 셸을 다시 띄운다. 단, `/privacy.html` 같은 별도 페이지는 그대로 통과시킨다 ([ADR-009](decisions/009-history-api-routing.md), `sw.js`의 `fetch` 리스너 — `navigate` 요청). 옛 해시 주소(`#/…`)는 부팅 때 같은 경로로 바꿔 준다.

라우트:

| 경로                                                       | 화면              |
| ---------------------------------------------------------- | ----------------- |
| `/` · `/{division}` (`old_testament` · `deuterocanon` · `new_testament`) | 홈 — 성서 목록과 구분 탭 ([ADR-024](decisions/024-book-list-tabs-and-header-nav.md)) |
| `/{book_id}` · `/{book_id}/prologue` | 장 목록 · 머리말(집회서) |
| `/{book_id}/{chapter}` · `/{book_id}/{chapter}/{절 스펙}` (`?hl=` 검색어 강조 · `?resume` 이어읽기) | 본문 (절 스펙 예: `16` · `1-5,10-15`) |
| `/search?q=&page=&in=` | 검색 결과 (모바일은 전체 화면 — [ADR-030](decisions/030-morphing-tab-bar.md) · [ADR-033](decisions/033-search-options.md)) |
| `/bookmarks` · `/settings` | 북마크 · 설정 (모바일 탭 화면) |
| `/read` · `/read/{folderId}` | 북마크 모아 읽기 ([ADR-035](decisions/035-bookmark-reading-view.md)) |
| `/calendar` · `/calendar/{YYYY-MM}` | 캘린더 월간 표 ([ADR-038](decisions/038-calendar-lectionary-ui.md) §2) |
| `/lectionary` · `/lectionary/{YYYY-MM-DD}` (`?obs&track&set&collect`) | 전례독서 (교회력 — [ADR-038](decisions/038-calendar-lectionary-ui.md) §3) |

로컬 개발 서버(`scripts/serve.py`)는 동일한 폴백을 흉내내어 강제 새로고침이 깨지지 않도록 한다. **`python -m http.server`는 사용 금지** — `/gen/1` 같은 라우트를 404로 반환한다.

### 4.2 검색 (Web Worker + 청크 인덱스)

`js/app/search.js`는 메인 스레드에서 검색 UI/결과 시트만 다루고, 실제 텍스트 검색은 `js/search-worker.js`가 전담한다.

```
사용자 입력  →  app/search.js  ──postMessage──▶  search-worker.js (첫 검색 때 생성)
                                       │
                                       ├─ data/search-meta.json  (init — 먼저)
                                       ├─ data/search-nt.json    ┐
                                       ├─ data/search-dc.json    ├ init에서 셋을 한꺼번에 받기 시작
                                       └─ data/search-ot.json    ┘ (신약 · 외경 · 구약 순)
                                       │
            partial-results / results  ◀──── 신약 청크만 기다린 뒤, 남은 청크가 있으면 부분 결과 한 번 · 다 받으면 최종 결과
```

워커 프로토콜은 `search-worker.js:1` 상단 주석에 정의됐다. 검색마다 부여한 `searchId`로 사용자가 새 검색어를 친 뒤 뒤늦게 도착한 옛 결과는 무시한다. 책 인덱스는 청크 JSON에서 RLE(같은 값이 이어지는 구간을 `[값, 개수]`로 묶음)로 줄여 두고 워커가 펼쳐 `Uint16Array`에 담으며, 장 · 절 인덱스도 `Uint16Array`로 들고 있어 메모리를 줄였다. 별칭(요한/요/요한복음 등)은 `data/search-meta.json`에 있다. 범위는 책 한정자 `in:<책 별칭>`(예: `사랑 in:요한`)이나 책 고르기(URL의 `in=` — [ADR-033](decisions/033-search-options.md))로 좁힌다 ([ADR-005](decisions/005-search-indexing-strategy.md)).

### 4.3 동기화 (Drive appdata + PKCE)

가장 복잡한 서브시스템. 파사드 `drive-sync.js`와 `js/sync/` 다섯 파일이 역할을 나눈다:

```
                       ┌─────────────────────────────────────────────┐
                       │  settings-ui.js (연결 · 상태)               │
                       │  bookmark.js (연결 해제 모달)               │
                       │  storage.js (scheduleUpload)                │
                       │  app.js (pollSync · initDriveSync)          │
                       └────────────────────┬────────────────────────┘
                                            │ window.driveSync (메서드 13개)
                                            ▼
                       ┌─────────────────────────────────────────────┐
                       │  js/drive-sync.js  (파사드)                 │
                       │   - PKCE 콜백 흡수 (?code=… 처리)           │
                       │   - 업로드 디바운스 (300ms) · 탭 복귀 폴    │
                       │   - 로그아웃 · 「파일도 삭제」              │
                       │     (자격 증명 먼저 지운다)                 │
                       │   - 다른 탭의 로그아웃 (storage 이벤트)     │
                       │   - 스낵바 (라이브 리전에도)                │
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

- **PKCE 단일 경로**. 데스크톱·Android·iOS가 같은 흐름. 앱을 다시 켰을 때(콜드 스타트) IndexedDB에 저장된 갱신 토큰(refresh token)으로 사용자 모르게 `/token` 호출로 새 접근 토큰을 받음 — 없으면 `NEEDS_CONSENT`로 전환해 사용자에게 다시 로그인 요청. ([ADR-011](decisions/011-bookmark-sync.md), `docs/archive/design/pkce-migration.md`)
- **OAuth `/token` BFF**. `transport.js`는 `https://oauth2.googleapis.com/token`이 아니라 같은 출처(same-origin) `/oauth/token`으로 보낸다. 웹 서버(nginx)가 비밀 키(`client_secret`)를 서버 쪽에서 주입한 뒤 Google로 전달 — Google "Web application" 클라이언트가 PKCE에서도 비밀 키를 요구하는 RFC 7636(PKCE 표준) 일탈을 회피 (자세히 [ADR-017](decisions/017-oauth-bff-proxy.md)).
- **탭 복귀 폴**. 사용자가 탭으로 돌아올 때(`visibilitychange`의 visible 분기) `pollSync()`(= `requestSync({ throttleMs: 15000 })`)를 한 번 부른다 — 다른 디바이스의 변경분을 새로고침 없이 가져온다. 사이클이 끝난 지 15초 안이면 건너뛰고, 도는 중이면 버린다(도는 사이클이 그 폴이다). OFFLINE이고 기기가 온라인이면 다시 시도한다.
- **상태 머신의 모든 변이는 `_transition()` 한 곳을 거친다.** 카운터(`{netFails, conflictFails, reAuthFails, backoffTimer}`)도 같이 리셋된다. 다음 상태로 이어가야 할 값은 명시적으로 넘겨야만 보존됨 (`state-machine.js` 머리 주석).
- **동시 실행 가드**: 상태(`_state`) 검사 + `localStorage["bible-drive-sync"]` 켬 표지 검사 + 모든 비동기 대기(`await`) 직후 재검사 — 백그라운드 토큰 갱신 · code 교환 · 동기화 사이클(대기 여섯 곳마다 `_leftSyncing`) 도중에 연결을 끊어도 의도가 지켜진다. 사이클은 하나만 돈다(`_startCycle`의 `_syncPending`). 확인은 대기마다 한 줄이고, 진행 중 요청을 취소하는 구조(`AbortController`)로 바꾸지 않는다 — 결정과 재검토 조건은 [coding-pitfalls.md](coding-pitfalls.md) §11.
- **끄는 길은 하나**: `_stopSync` — 켬 표지 "0" · 동기화 캐시 · 토큰 · DISABLED 전이 · 설정 다시 그리기. `disable()`(어느 상태에서든)과 「파일도 삭제」가 함께 쓴다. 다른 탭은 켬 표지의 `storage` 이벤트로 멈춘다.
- **사이클 도중의 편집**: 병합 직전(내려받기 뒤)에 로컬을 다시 읽어 대기 중 저장한 북마크 · 설정을 덮지 않고, 도는 동안 들어온 사용자 요청은 끝난 뒤 한 번 더 돈다(`_resyncRequested` — 다음 마이크로태스크).
- **캐시와 304**: fileId · ETag · 마지막으로 올린 본문의 maxU를 캐시해(`bible-drive-cache-*`) 목록 요청을 건너뛰고, 조건부 GET(`If-None-Match`)이 304면 내려받지 않는다 — 로컬에 새 편집이 있으면 올리기만 한다.
- **실패 처리**: 401 → 조용한 갱신(refresh token이 없으면 NEEDS_CONSENT, 새 토큰도 거절되면 상한에서 ERROR) · 412 → 다시 병합(세 번까지, 그 뒤 스낵바 + IDLE) · 코드 오류(`no_token` · 예외) → ERROR · 그 밖의 실패(`http_<status>` — 네트워크 0 · 403 · 429 · 5xx …) → 백오프 1 · 2 · 4 · 8 · 16초, 그래도 실패하면 네트워크 실패만 OFFLINE · HTTP 실패는 IDLE(다음 요청이 다시 시도). 기기가 오프라인이면 곧바로 OFFLINE. 전송 함수는 실패를 「없음」과 다른 값(상태 코드)으로 돌려주고, 본문을 읽지 못한 2xx도 실패다([coding-pitfalls.md](coding-pitfalls.md) §28).
- **카운터 캡**: `MAX_REAUTH=3` (만성 401), `MAX_CONFLICTS=3` (412 ETag), `MAX_NET_RETRIES=5` (1·2·4·8·16초 점진 대기), `MAX_REDIRECT_ATTEMPTS=3` (무한 리디렉션 방어).
- **연결 해제**: 「파일 유지」는 토큰 폐기(Google `/revoke`) · IDB refresh token · 계정 키 · 켬 표지 "0" 뒤 `_stopSync`. 「파일도 삭제」는 페이지가 닫혀도 남으면 안 되는 것(IDB refresh token — 한 번 갱신할 몫은 메모리에만 · 켬 표지 · 계정 키)을 먼저 지우고, 토큰을 상태 기계에서 곧바로 빼 동기화를 멈춘 뒤, 진행 중 사이클이 이미 보낸 요청을 10초까지 기다려 appDataFolder의 `sync.json`을 모두 지운다(목록 · 캐시된 id · 이 페이지가 만든 id, 404는 이미 없음, 401이면 한 번 갱신, 기다림을 넘겼으면 한 번 더 기다렸다 다시). 끝나면 토큰을 폐기한다. 결과는 `true` · `false` · `null` — 확인하지 못하면 스낵바와 설정의 남는 안내(`bible-drive-delete-pending` — 다시 연결할 때까지).
- **머지 정책**: 각 항목마다 마지막 수정 시각(`_u`, 밀리초)과 삭제 표시(툼스톤)를 함께 저장. 항목 단위로 나중에 수정한 쪽을 남긴다 — 파일 전체 단위 아님 — 서로 다른 기기에서 다른 북마크를 추가해도 둘 다 보존.

진입·복귀 시나리오는 [README §Google Drive 동기화](../README.md#google-drive-동기화-북마크설정읽기-위치) 표 참조.

### 4.4 인용·주석 (`<cite>` + `[^id]`)

`js/app/citations.js`가 본문 렌더 분기를 받아 두 종류의 추가 콘텐츠를 그린다 ([ADR-022](decisions/022-citations-and-annotations.md)).

- **인용 칩**: 본문의 `<cite src="…" parallels="…" tradition="…">…</cite>`(속성 순서는 이대로 고정 — 파서 정규식) segment 끝에 옅은 회색 출처 칩을 단다. 같은 출처가 연속된 절에 걸치면 마지막 절에서만 표시 (dedup). 운문 인용은 인라인이 아니라 별도 줄로 그려 시 행을 흩뜨리지 않는다.
- **인용 본문 시트**: 칩 클릭 시 출처 본문을 같은 페이지 위 시트로 띄운다 — 모바일 · 터치는 바텀 시트, 데스크톱(≥769px · 정밀 포인터)은 오른쪽 패널. 다중 ref / parallels / 한 장의 여러 절(`53:5,7-9`) · 장을 넘는 범위 지원, 「› 더 보기」로 시트 안에서 장 본문 확장 + 인용 절 강조, 바텀 시트는 높이를(패널은 왼쪽 가장자리로 폭을) 끌어 조절 · 닫기. 시트 안 본문은 칩·주석 비렌더(중첩 시트 회피).
- **주석**: `[^id]`의 anchor 어절은 점선 밑줄을 친 단추(`role=button`)로, 어절이 없는 주석은 절 끝 ※로 그리고, 누르면 툴팁으로 본문이 펼쳐진다 (스크롤 따라가기). 인쇄 전용 표현은 없다.
- **토글**: 설정의 「인용·주석 표시」 하나로 칩과 주석을 함께 끄고 켠다 (`bible-cite-show`, 기본 켬 — Drive 동기화 대상 `citeShow`).

데이터 파이프라인 (`common-bible-data/src/parser.py`)이 마크다운에서 `<cite>`와 `[^id]`를 추출해 절 JSON의 `segments`와 `notes` 필드에 보존하므로, 시트는 인용한 장마다 `/data/bible/{book}-{ch}.json`을 받아(SW 캐시) 그리고, 다른 장에 옮겨 실린 절은 앞뒤 3장까지 찾아본다(`RELOCATION_MAX_DISTANCE`).

### 4.5 책 이름·헤더 자동 짧게 표시

신약 책 이름은 정식 명칭이 길어("고린토인들에게 보낸 첫째 편지") 좁은 화면이나 큰 글자에서 책 목록 버튼·장 보기 헤더가 2줄로 부풀어 읽기 흐름을 깬다. `js/app/views.js`의 `NT_MOBILE_NAME` 매핑(신약 26권 — 사도행전만 빠진다)이 짧은 명칭을 제공하고, 두 곳에서 같은 swap 메커니즘으로 그린다:

- 정식 명칭과 짧은 명칭을 두 span (`.book-name-full` / `.book-name-mobile`, 헤더는 `.title-text-full` / `.title-text-mobile`) 으로 함께 렌더.
- **터치 기기** — `@media (hover:none) and (pointer:coarse)` 미디어 쿼리로 책 목록 · 헤더 모두 늘 짧은 명칭. 폰·태블릿 모두 일관.
- **비-터치 기기** — `ResizeObserver` 측정. 정식 명칭이 한 줄에 안 들어가면 (`.book-name-full` natural 너비 > 사용 가능 너비) `.compact` 추가 → swap. 글자 크기 변경(브라우저 줌, OS 설정, 앱 글자 크기)도 자동 재측정.
- 헤더는 양옆 단추(뒤로 · 북마크 · 설정)가 차지한 자리 가운데 큰 쪽 + 여유 `0.8rem`을 양쪽에서 빼고, picker 꺾쇠 여유 `0.8rem`을 더 빼고 잰다 — 고정값 `5.2rem`은 데스크톱 배치에만 맞아 버렸다.

사도행전은 매핑이 없다(이미 짧다). 접근성: 책 목록 링크와 헤더 제목의 `aria-label`은 화면이 짧은 명칭을 보여도 늘 정식 명칭이다. 장 보기의 picker 단추 이름은 「장 선택」(시편은 「편 선택」)이고, 정식 명칭은 문서 제목과 화면 전환 안내(라이브 리전)로 전한다.

### 4.6 오프라인 — Service Worker 캐시 전략

`sw.js`는 도메인 / 요청 종류별로 전략을 가른다 (`fetch` 리스너 · `cacheNameFor`). "캐시 우선(cache-first)"은 한 번 받아둔 자료가 있으면 그것부터 보여주고 없을 때만 네트워크로 가져오는 방식.

| 대상                                                                    | 전략                                                              | 이유                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `fonts.gstatic.com`                                                     | 캐시 우선, **별도 `FONT_CACHE`** 보관, 다른 캐시가 갱신돼도 보존  | 폰트 파일은 절대 안 바뀌고 URL 자체에 버전이 박혀 있음          |
| GET이 아닌 요청 (POST `/oauth/token` 등) | 서비스 워커를 거치지 않는다 | Cache API는 GET만 받는다 |
| OAuth/Drive 4개 호스트                                                  | **항상 네트워크 직행**, 서비스 워커 우회                          | 캐싱 시 토큰·동기화 데이터가 깨진다                             |
| 페이지 이동 요청 (HTML)                                                 | `/index.html`로 대체 (단, `/privacy.html`은 통과) — 운영은 캐시 우선, dev · localhost는 네트워크 우선 | SPA 라우팅                                                      |
| 셸 (JS/CSS/HTML/icons + `books.json`·`search-meta.json`·매니페스트 2종) | 캐시 우선 → `SHELL_CACHE` (dev · localhost는 네트워크 우선, 캐시는 오프라인 폴백) | 코드와 강결합, 매 릴리스 동기 갱신                              |
| 본문·검색·교회력 (`/data/bible/*`, `/data/search-{ot,nt,dc}.json`, `/data/lectionary/*`) | 캐시 우선 → `DATA_CACHE` (이름 고정 `"data"`)                     | 누적 캐시; 콘텐츠 해시 매니페스트 diff로 항목 단위 갱신        |
| 오디오 (`/data/audio/*`)                                                | 캐시 우선 → `AUDIO_CACHE` (이름 고정 `"audio"`) — 넣을 때 용량 상한([ADR-016](decisions/016-audio-cache-lru.md)) | 필요 시 다운로드; 콘텐츠 해시 매니페스트 diff로 항목 단위 갱신 |
| 매니페스트 (`/data/{bible,audio}-manifest.json`)                        | **네트워크 우선**, 실패 시 SHELL_CACHE 의 precached 사본 fallback | freshness 가 핵심                                               |

캐시는 4개 식별자로 분리 (`sw.js`):

- `SHELL_CACHE` (예: `shell-1.6.4`) — 셸과 부팅에 필요한 메타, 그리고 부팅 때 싣지 않는 교회력 모듈 셋(설치 때 미리 받는다 — 교회력 표는 처음 쓸 때 `DATA_CACHE`에 들어가므로, 오프라인에서 열리는 캘린더 · 전례독서는 온라인에서 한 번 연 화면이다). `importScripts('/sw-version.js')`로 `self.APP_VERSION`을 읽어 `"shell-" + APP_VERSION`으로 파생. 매 릴리스 갱신.
- `DATA_CACHE` (`"data"`) — 본문 장 JSON(73권 1328장 + 머리말 · 전례시편 150 · 송가 13) + 검색 청크 셋 + 교회력 · 전례독서 표. 이름 자체는 고정, 항목별 무효화는 `js/manifest-sync.js`가 담당 (ADR-021).
- `AUDIO_CACHE` (`"audio"`) — 장별 mp3. 같은 메커니즘.
- `FONT_CACHE` (`"fonts"`) — Google Font 파일. 콘텐츠 주소 기반이라 사실상 영구.

`scripts/release.py`가 `version.json`과 `sw-version.js`를 한 번에 갱신 + 자동 commit. `--bump-data`/`--bump-audio` 같은 콘텐츠 캐시 bump 플래그는 ADR-021 이후 사라짐 — 콘텐츠 무효화는 `common-bible-data` 저장소 CI가 만든 `bible-manifest.json`·`audio-manifest.json` 변화를 앱이 부팅 시 비교해 항목 단위로 처리. 새 서비스 워커가 활성화되면 KNOWN_CACHES에 없는 옛 캐시만 삭제되므로, 셸 영역만 갱신된 릴리스에서 사용자가 이미 받은 본문·오디오는 보존된다. 사용자 동의 없이 즉시 활성화(`skipWaiting()`)는 호출하지 않는다 — 사용자가 "업데이트" 버튼을 눌러 클라이언트가 `SKIP_WAITING` 메시지를 보낼 때만 새 서비스 워커가 곧바로 활성화된다. 설치 때 셸 파일은 `?v=<APP_VERSION>`과 `cache: "reload"`로 HTTP 캐시를 건너뛰어 받아 원래 URL로 저장하고, activate 때 오디오 캐시와 그 sidecar(IndexedDB)를 맞춘다.

## 5. 영속 데이터 — 어디에 무엇이 저장되는가

| 위치 | 키/파일 | 내용 | 동기화? |
| --- | --- | --- | --- |
| `localStorage` | `bible-bookmarks-v2` | 동기화 문서 v2 — 북마크(`items` · `tombstones`) · 설정 · 이어읽기, 레코드마다 수정 시각 | ✅ |
| `localStorage` | `bible-bookmarks` | 옛 트리 사본 — 저장할 때마다 함께 쓰고, v0/v1 이전의 원본으로 읽는다 | (호환) |
| `localStorage` | `bible-font-size`, `bible-theme`, `bible-color-scheme`, `bible-book-order`, `bible-startup`, `bible-cite-show`, `bible-audio-show` | 설정 7종 (v2 문서의 설정과 같은 값) | ✅ |
| `localStorage` | `bible-last-read` | 마지막 읽기 위치 (이어읽기 배너) | ✅ |
| `localStorage` | `bible-sync-meta` | `{schemaVersion, deviceId}` | (메타) |
| `localStorage` | `bible-drive-sync` | 켬 표지 ("0"/"1") — 다른 탭은 이 키의 `storage` 이벤트로 로그아웃을 안다 | (메타) |
| `localStorage` | `bible-drive-sync-email` | 마지막 인증 이메일 (OAuth `login_hint`) | (메타) |
| `localStorage` | `bible-drive-cache-file-id`, `bible-drive-cache-etag`, `bible-drive-cache-synced-u` | 동기화 캐시 — fileId · ETag · 마지막으로 올린 본문의 maxU (목록 요청 · 내려받기를 건너뛴다) | (메타) |
| `localStorage` | `bible-drive-redirect-attempts` | 무한 리디렉션 카운터 (cap 3) | (메타) |
| `localStorage` | `bible-drive-delete-pending` | 끝나지 않은 「파일도 삭제」 — 설정의 남는 안내, 다시 연결하면 지운다 | 로컬 전용 |
| `localStorage` | `bible-audio-pos` | 오디오 재생 위치 | 로컬 전용 |
| `localStorage` | `bible-lectionary-track` | 전례독서 트랙 기억 — 값 하나(`1` 또는 `2`), 마지막 선택이 날짜 · 해와 무관하게 기본값(사용자 결정 2026-10-13 · ADR-038 §3) | 로컬 전용 |
| `localStorage` | `bible-search-history` | 검색 이력 (LRU, [ADR-014](decisions/014-search-history.md)) | 로컬 전용 |
| `localStorage` | `bible-bookmark-sort`, `bible-bookmark-sort-dir`, `bible-bookmark-viewed` | 북마크 정렬 기준 · 방향 · 최근 본 시각 | 로컬 전용 |
| `localStorage` | `bible-install-nudge`, `bible-cite-coachmark-seen` | 설치 안내 넛지 상태 · 인용 칩 안내를 봤는지 | 로컬 전용 |
| `sessionStorage` | `bible-drive-redirect-state-pkce` | PKCE `{nonce, verifier, returnTo, ts, flow}` (10분 TTL) | 임시 |
| `sessionStorage` | `bible-drive-back-nav-context` | 리디렉션 전의 기록 길이 (돌아온 뒤 뒤로 가기 보정) | 임시 |
| `IndexedDB` | `bible-drive-sync` (`keys` · `tokens`) | AES-GCM 암호화 refresh token (암호화 키는 꺼낼 수 없는 상태로 저장 — `extractable: false`) | 로컬 전용 |
| `IndexedDB` | `bible-audio-cache` / `entries` | 오디오 LRU sidecar ([ADR-016](decisions/016-audio-cache-lru.md)) | 로컬 전용 |
| `IndexedDB` | `bible-manifest-sync` / `snapshots` | 직전 매니페스트 스냅샷 (diff 기준) | 로컬 전용 |
| Cache Storage | `shell-X.Y.Z` (SHELL_CACHE) | 앱 셸 + `books.json` + `search-meta.json` + 매니페스트 2종 | (배포물) |
| Cache Storage | `data` (DATA_CACHE) | 본문 장 JSON(전례시편 · 송가 포함) + 검색 청크 셋 + 교회력 · 전례독서 표 | (누적) |
| Cache Storage | `audio` (AUDIO_CACHE) | 장별 mp3 (필요 시 다운로드) | (누적) |
| Cache Storage | `fonts` (FONT_CACHE) | Google Font 파일 | (영구) |
| Google Drive (`appDataFolder`) | `sync.json` | 동기화 페이로드 (v2 문서 + `schemaVersion` · `deviceId`) + ETag | ☁️ 원격 |

동기화 대상이 아닌 항목(오디오 위치, 정렬, 캐시 등)은 의도적으로 기기 로컬에 머문다. 디바이스 ID는 다른 기기가 가져가지 않지만 올리는 페이로드에 실려 병합에서 동점을 가르는 데 쓰인다. 옛 키(`bible-drive-sync-updated` · `bible-drive-silent-blocked`)는 지우기만 한다. 첫 북마크 저장 · 첫 오디오 재생 때 `navigator.storage.persist()`를 한 번 청한다(저장소 정리 대비 — 아래 「알려진 한계」의 ITP). 동기화 페이로드 스키마는 `js/types.d.ts`의 `SyncDoc` 타입과 `js/sync/store-v2.js:1` 헤더 주석에서 정의된다.

## 6. 정적 타입 검사 — JSDoc + `tsc --noEmit`

빌드 산출물 0개를 유지하면서도 타입 안전성을 얻기 위해 **TypeScript를 컴파일러로만 사용**한다 ([ADR-012](decisions/012-typescript-incremental-adoption.md)).

- **`js/`의 모든 클라이언트 JS가 검사 대상이다** — 두 tsconfig 모두 `checkJs: true`(2026-10-17). 앱 모듈 · sync 레이어 · `js/pre-fetch.js`(`<head>` classic 스크립트) · `js/gtag-init.js` 등은 `tsconfig.json`(DOM), `js/search-worker.js`는 `tsconfig.worker.json`(WebWorker). 검사에서 빼는 파일은 첫 줄 `// @ts-nocheck`로 명시한다 — 지금은 오류가 남은 6개(`views` · `search` · bookmark 계열 넷 — 떼면 155건)뿐이고, 그 줄을 문 뒤에 두면 무시돼 파일이 검사된다(ADR-012 「파일 헤더」). 그전(2026-05-10부터 10-17까지)에는 파일마다 `// @ts-check`로 켜는 방식이라, 지시문이 `"use strict";` 뒤에 있던 22개가 오류 없이 검사 밖이었다. `sw.js`는 어느 tsconfig의 `include`에도 없다. [`known-issues.md`](known-issues.md) §7.
- 도메인 타입은 `js/types.d.ts` 한 곳에서 export.
- 다른 파일은 `@typedef {import("../types").Foo} Foo`로 가져온다.
- `tsconfig.json` (DOM lib) + `tsconfig.worker.json` (WebWorker lib) 두 개 분리.

검증:

```bash
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
```

두 명령(`npm run typecheck`)을 CI 의 필수 검사 「Unit tests」 잡이 PR 마다 돌린다 — 0 error 가 머지 전제다(2026-10-17 부터; 그전엔 로컬 훅뿐이었다).

## 7. 테스트 — 3계층 + 유닛

테스트는 비용/실행 빈도/원본 텍스트 의존성에 따라 다음과 같이 나뉜다.

| 종류                                                                         | 위치                                         | 원본 필요?                               | CI?              | 무엇을 보호하는가                                                                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **클라이언트 JS 유닛** ([ADR-013](decisions/013-client-js-unit-tests.md))    | `tests/unit/*.test.js`                       | ❌                                       | ✅ (앱 저장소)   | sync 레이어(상태 머신·PKCE 등) + app 레이어(storage·helpers·install·search·bookmark·views 순수 영역) + 교회력 엔진 · 전례독서 뷰 모델 — 케이스 수는 CLAUDE.md 「테스트」가 정본. DOM-heavy 영역은 e2e가 책임 |
| **Level 1 완전성** ([ADR-004](decisions/004-data-pipeline-test-strategy.md)) | `data/tests/test_completeness.py` (서브모듈) | ❌                                       | ✅ (data 저장소) | 1328개 장 파일·구조 누락                                                                                                                     |
| **Level 2 절 순서**                                                          | `data/tests/test_ordering.py`                | ❌ (`fixtures/verse_sequence.json` 사용) | ✅ (data 저장소) | 파이프라인 변경 시 절 순서 회귀                                                                                                              |
| **Level 3 스냅샷**                                                           | `data/tests/test_snapshots.py`               | ❌                                       | ✅ (data 저장소) | cross-chapter 재배치 등 특수 케이스                                                                                                          |
| **전례 데이터 검증**                                                         | `data/tests/test_{psalter,canticles,lectionary,ordinal_weeks,calendar_tables,collects,commons}.py` 등 | 일부 (원료 마크다운 · 기사 · 표를 읽는다) | ✅ (data 저장소) | 전례시편 · 송가 DSL, 전례독서 · 본기도 스키마, 교회력 정의 표 조인 · 사계재, 연중 주간 구간표 |
| **E2E (Playwright)**                                                         | `tests/e2e/*.py`                             | ✅ (서버 + 본문)                         | ❌ (로컬)        | 검색 UI, 라우팅, 클립보드, 설치 안내, 동기화 등 회귀                                                                                         |

유닛 테스트는 `node --test`만으로 돌고, `tests/unit/harness.js`가 자체 vm 컨텍스트를 생성해 글로벌 상태 누수를 막는다 — 의존성 0. 앱 저장소 CI(`.github/workflows/test.yml` 「Unit tests」)는 Node 24로 유닛 테스트를 자동 실행하고, 같은 잡에서 타입 검사(`npm run typecheck` — §6)도 돌린다. 브랜치 보호의 필수 검사는 「Unit tests」와 「Change ledger」(`ledger.yml` — PR의 변경 원장)다. 실데이터가 있어야 도는 테스트(`*.data.test.js` · `sw.test.js` · `docs-data-consistency.test.js`)는 그 잡에서 skip되고 `engine-data.yml`(main push — 엔진 · 뷰 경로 — 또는 수동) · `sync-data.yml`(data 저장소의 디스패치)이 돌린다 — PR을 막지는 않는다. data 저장소에서는 `validate.yml`이 PR과 main push마다 `pytest tests/`(Level 1-3 + 전례 데이터)를 돌리고, `build.yml`도 산출물을 만든 뒤 같은 테스트를 통과해야 커밋한다. 그 봇 커밋은 기본 `GITHUB_TOKEN`으로 push되어 다른 워크플로를 부르지 않으므로, 빌드된 산출물을 확인하는 것은 `build.yml`의 테스트 단계다 (분할 후 ADR-020).

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
~/projects/common-bible-server/scripts/deploy.sh dev      # /var/www/bible-{ver}-{sha} 생성 + /var/www/dev 교체
~/projects/common-bible-server/scripts/deploy.sh prod     # 동일하게 생성 + /var/www/bible 교체 (확인 프롬프트)
~/projects/common-bible-server/scripts/deploy.sh promote  # /var/www/bible -> readlink(/var/www/dev), 재빌드 X
~/projects/common-bible-server/scripts/deploy.sh rollback dev|prod  # -previous와 swap (reversible)
```

`release.py`는 `version.json`과 `sw-version.js`의 `APP_VERSION`을 함께 갱신하고 자동 commit 한다 — 한쪽만 변경되어 SW가 새 셸을 못 가져오는 시나리오 차단. `DATA_CACHE`/`AUDIO_CACHE`는 ADR-021 이후 이름 자체가 고정이고, 콘텐츠 무효화는 `common-bible-data` 저장소 CI가 `bible-manifest.json`/`audio-manifest.json`을 자동 갱신해 `js/manifest-sync.js`가 앱 부팅 시 항목 단위로 처리한다.

`deploy.sh`는 `bible-{version}-{shortsha}` 디렉터리 명명을 쓴다 — dev에서 같은 버전을 여러 번 배포해도 덮어쓰지 않고, promote 시 dev에서 검증한 동일 디렉터리를 prod 심볼릭 링크가 가리키게 된다. `git diff --quiet` 체크가 dirty working tree에 `-dirty` suffix를 붙여 우발 배포를 추적 가능하게 한다.

매 swap·promote·rollback 직후 자동 검증 9종(`/version.json` 버전 일치·`/sw.js` 200+Content-Type·`/index.html` 200+ETag·`/data/books.json` · `/sw-version.js` · 매니페스트 2종 · 교회력 · 전례독서 묶음 하나씩(`lectionary/sanctoral.json` · `lectionary/eucharist-readings.json`) 200)이 실행되고, 실패 시 manual rollback 안내 출력. zip에 넣을 경로는 `scripts/deploy-manifest.txt`가 정하고, 목록의 항목이 없으면 `build-deploy.sh`가 멈춘다 — 목록에 없는 새 경로는 검사되지 않으므로 데이터 디렉터리를 더하면 목록도 고친다. 4개 보호 심볼릭(dev·bible·dev-previous·bible-previous) + `BUILD_RETENTION`(기본 3)개를 넘는 옛 빌드 디렉터리는 자동/확인 후 정리. 자세한 흐름은 `common-bible-server/scripts/deploy.sh` 헤더 주석.

릴리스 순서의 정본은 `CLAUDE.md` 「데이터 파이프라인」 4번(`release.py patch` → push + 태그 + GitHub Release → `deploy.sh dev` → `deploy.sh promote`)이다. main이 보호 브랜치라 버전 커밋은 `release/X.Y.Z` 브랜치에서 PR로 들어가고(예: #286 — 원장이 릴리스 노트 초안), 변경 목록은 `scripts/changelog.py`가 만든다(`--generate-notes` 대체).

업데이트 토스트 흐름:

1. 페이지가 서비스 워커 업데이트를 확인한다 — 보이고 온라인일 때 한 시간에 한 번까지(`reg.update()`), 탭 복귀 · `online` 때, 설정의 「업데이트 지금 확인」(`checkForUpdates`). 새 SW가 install 단계로.
2. 새 SW가 waiting이 되면 `js/app.js`가 `GET_VERSION` 메시지로 새 SW의 `version.json`을 조회 → 토스트 노출.
3. 사용자가 "업데이트" 클릭 → `SKIP_WAITING` → 새 SW activate → 페이지 reload.

자동 skipWaiting을 하지 않는 이유: 사용자가 본문을 읽고 있을 때 갑작스러운 reload가 일어나면 안 된다.

## 9. 보안 모델

OAuth 측면 (가장 큰 공격 표면):

- **콘텐츠 보안 정책 (CSP)**: `index.html`의 `<meta>`로 준다(서버 헤더는 없다). `script-src 'self' https://www.googletagmanager.com` — 스크립트는 같은 출처와 Google 태그(분석)만, 실행되는 인라인 스크립트는 없다. 인라인 `<style>` 하나만 `style-src`의 sha256 해시로 허용하고, 그 해시는 `scripts/csp_hashes.py` · `tests/unit/csp.test.js`가 지킨다. `accounts.google.com`은 connect-src에 없다 (PKCE는 전체 페이지 리디렉션이라 프레임 로드 불요). connect-src의 `https://www.google.com`은 구글 애널리틱스가 페이지를 떠날 때 보내는 요청(`/g/collect`)의 자리다 — 구글 안내는 `https://*.google.com`을 권하지만 실제로 나가는 곳은 이 하나라 그것만 적었다(2026-10-18, 원장 `docs/changes/2026-10-18-csp-google-collect.md` — 와일드카드면 `script.google.com` 같은 아무 하위 도메인으로나 보낼 통로가 열린다). meta CSP는 위반을 보고받을 수 없어(report-uri · report-to 미지원) 릴리스 전에 `tools/csp/csp_sweep.py`로 점검한다. 별도 페이지 `privacy.html`에는 CSP가 없다(인라인 스크립트 하나).
- **서비스 워커 우회**: OAuth/Drive 4개 도메인은 서비스 워커가 절대 캐싱하지 않음. GET 외 요청(POST 등)도 서비스 워커를 우회 — Cache API가 GET만 지원하기 때문에 같은 출처의 POST `/oauth/token`도 캐시 대상에서 제외.
- **`client_secret` 서버 쪽 격리**: SPA 번들·git 이력에 비밀 키가 일절 없음. 웹 서버(nginx)가 `proxy_set_body`로 매 `/oauth/token` 요청에 비밀 키를 주입. GitHub의 비밀 키 자동 감지(secret scanner)에 의한 무효화 위험 + OAuth 2.1 public client 정신 위배를 모두 회피 ([ADR-017](decisions/017-oauth-bff-proxy.md)).
- **OAuth Client ID 호스트 격리**: 개발용 Client ID는 Cloud Console에서 `dev.anglican.kr`만, 운영용 Client ID는 `bible.anglican.kr`만 허용된 출처(Authorized origin) / 리디렉션 URI로 등록. `localhost` 등록은 의도적으로 제외 — 사용자 PC의 악성 프록시가 같은 포트로 자리잡고 PKCE 흐름을 가로챌 가능성 차단.
- **PKCE state nonce**: 10분 동안만 유효. 콜백 URL은 성공이든 실패든 곧바로 `replaceState`로 지워(성공 · 검증된 오류는 돌아갈 주소로, 검증되지 않은 오류는 경로만) 어떤 라우터·로거도 보지 못하게 한다.
- **갱신 토큰 (Refresh token)**: 브라우저 내장 암호화 API(webcrypto)의 AES-GCM 알고리즘으로 암호화 + 암호화 키는 꺼낼 수 없는 상태로 저장(`extractable: false`). 평문은 한 번도 IndexedDB에 닿지 않는다.
- **디버그 로그 마스킹**: `sync/debug-log.js`의 `mask()`가 토큰은 지문(djb2 8자리)으로만, 이메일은 첫 글자 + `***` + 도메인, fileId는 끝 8자만, 긴 ETag는 앞 16자만, 페이로드는 크기만 남긴다. 로그는 메모리에만 둔다(최근 200 · 오류 20, 운영 호스트에서는 콘솔에 찍지 않는다).
- **연결 해제**: 「파일도 삭제」는 자격 증명(IDB refresh token · 켬 표지 · 계정 키)을 네트워크 작업보다 먼저 지워, 지우는 도중 앱을 닫아도 「연결 해제됨」인데 자격 증명이 남는 일이 없다. 토큰 폐기는 지운 뒤에 한다(지우기 요청이 폐기된 토큰으로 나가지 않게) — §4.3.
- **BFF 경화**: `/oauth/token`은 POST만 받고(그 밖은 405), IP 당 `limit_req` 60r/m · burst 100, 본문 4k 상한, 들어온 `Cookie` · `Authorization`은 떼고 넘긴다 (`common-bible-server/nginx/` 예시).

브라우저 측면 (defense-in-depth 헤더):

- **서버 단 보안 헤더 6종 (nginx snippet)**: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 0`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), clipboard-read=(), fullscreen=(), display-capture=(), interest-cohort=(), browsing-topics=()`, `Cross-Origin-Opener-Policy: same-origin`. 모든 응답(HTML5 라우팅 폴백 포함)에 일관 적용. 단일 출처 `/etc/nginx/snippets/security-headers.conf` (저장소 예시: `common-bible-server/nginx/security-headers.example.conf`).
  - `X-XSS-Protection: 0`: 옛 브라우저가 자체 결함으로 다른 사이트로 정보가 새는 사례가 있어 OWASP/MDN 모두 `0` 또는 제거를 권장. CSP(`script-src` — 같은 출처와 Google 태그만)가 같은 역할을 함.
  - `Referrer-Policy: strict-origin-when-cross-origin`: 모던 브라우저 기본값을 명시. 다른 사이트로 이동할 때는 도메인만 보내 URL 경로 노출 차단.
- **nginx `add_header` 상속 함정 우회**: location 수준에 `add_header`가 하나라도 있으면 서버 수준 헤더가 통째로 끊긴다 — 알려진 함정. 파일별 Cache-Control이 있는 위치에도 같은 snippet을 다시 include해 일관 적용 보장.

보안 감사: PKCE · refresh token [`2026-05-07-pkce-refresh-token.md`](archive/audit/2026-05-07-pkce-refresh-token.md) — Critical/High/Medium 0건. 그다음 2차 통합 감사 [`2026-05-08-second-comprehensive.md`](archive/audit/2026-05-08-second-comprehensive.md) — Critical 0 · High 4 · Medium 9 · Low/Info 15(처리 상태는 그 문서).

## 10. 알려진 한계와 의도적 비결정

- **iOS Safari 탭 7일 자동 데이터 삭제 (ITP)**: 홈 화면에 설치하지 않고 Safari 탭에서만 쓰면 7일 미사용 시 저장된 데이터가 비워진다 (Apple의 Intelligent Tracking Prevention 정책). 대응: 설치 안내 모달 강화([ADR-008](decisions/008-pwa-install-guide.md)). 홈 화면에 추가된 PWA는 이 정책의 영향을 받지 않음.
- **외부 권한 회수**: 사용자가 Google 계정 설정에서 권한을 끊으면 다음 조용한 갱신이 `invalid_grant`로 실패 → IDB를 비우고 NEEDS_CONSENT로 돌아간다. (OAuth 앱 검수는 2026-05-19 통과 — refresh token에 만료 기간이 없다.)
- **iOS Chrome/Firefox/Edge**: iOS의 모든 브라우저는 내부적으로 Safari 엔진(WebKit)을 쓴다. iOS 17+ 는 공유 메뉴의 「홈 화면에 추가」로 설치할 수 있어 그 안내를 보이고(`ios-other`), iOS 16 이하는 「Safari에서 열어」 안내로 끝난다(`ios-legacy` — [ADR-008](decisions/008-pwa-install-guide.md) 개정 2026-05-11). 다른 브라우저와 동기화 데이터 분리는 보장되지 않는다.
- **백엔드 부재**: 사용자별 통계, 다중 기기 푸시, 서버사이드 검색 등은 모두 불가. 의도적 트레이드오프 — 운영비 0이 더 중요하다.
- **성서 번역본 1종**: 성서 본문은 공동번역만 다룬다. 전례시편 · 송가는 기도서의 번역으로 전례용 책(`lps` · `cant`)에 따로 싣는다. 번역 대조는 로드맵 밖.
- 미해결 이슈 · 후속 백로그의 권위 출처는 [`known-issues.md`](known-issues.md)다.

## 11. 장기 로드맵과의 관계

Phase 1(성경 읽기 PWA)은 완성됐고, Phase 3(교회력)은 일부 구현됐다 — 엔진([ADR-037](decisions/037-eucharist-lectionary-data-and-engine.md)) · 전례독서 화면 `/lectionary` · 캘린더 월간 표 `/calendar`([ADR-038](decisions/038-calendar-lectionary-ui.md)). 남은 것은 [`status.md`](status.md)와 ADR-038. 단계들은 **컨텐츠 추가에 가까운 확장**으로 설계되어 있다:

- Phase 2 — **기도서**: 첫 기도서 본문(전례시편 · 송가)은 `source/`가 아니라 `liturgical/psalter` · `liturgical/canticles`의 마크다운과 별도 파서(`src/liturgical_psalter.py` — 계응 구조, data 저장소 ADR-039)로 들어왔다. 두 책은 division `liturgical`로 성서 목록의 구분 탭 밖에 있고, 전례독서 화면이 읽는다. 남은 기도서 본문도 같은 길(별도 원료 · 파서 → 책 단위 JSON)을 따를 수 있다.
- Phase 3 — **교회력**: 날짜 계산(computus · 절기 · 연중 주차)은 순수 함수지만, 그날이 무슨 날인지 · 품계 · 전례색 · 독서 · 본기도는 data 저장소의 표(`lectionary/` — 캘린더 묶음 다섯 · 전례독서 묶음 넷)를 읽는다([ADR-036](decisions/036-liturgical-calendar-data-model.md) · 037). 라우트는 `/calendar` · `/lectionary`.
- Phase 4 — **성무일과 자동 생성**: 교회력(Phase 3) + 성경(Phase 1) + 기도서(Phase 2) 조합 → 매일 자동 페이지 생성. `/lectionary/YYYY-MM-DD`가 이미 엔진 · 성서 · 기도서 본문(본기도 · 전례시편)을 감사성찬례 하루치로 엮는다 — 그 앞선 모습이다.

각 단계가 **독립적으로 추가 가능**하도록 데이터 디렉토리·라우트·검색 인덱스를 책 단위로 분리해 둔 것이 핵심이다. 동기화 페이로드도 `settings`/`bookmarks`/`lastRead` 키별로 머지하므로 새 키 추가가 안전하다.

---

## 부록 A. ADR 인덱스 (한 줄 요약)

| ADR                                                          | 결정                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001](decisions/001-spa-architecture.md)                     | Vanilla JS SPA + Python 일회성 전처리                                                                                                                                                                                                                         |
| [002](decisions/002-sirach-prologue-handling.md)             | 시락 머리말은 별도 JSON으로 추출 _(common-bible-data로 이전, ADR-020)_                                                                                                                                                                                        |
| [003](decisions/003-physical-chapter-ordering.md)            | 원전의 물리적 장 순서를 따름 _(common-bible-data로 이전, ADR-020)_                                                                                                                                                                                            |
| [004](decisions/004-data-pipeline-test-strategy.md)          | Level 1-3 데이터 검증 전략                                                                                                                                                                                                                                    |
| [005](decisions/005-search-indexing-strategy.md)             | 검색 인덱스 구약/신약/외경 청크 분할                                                                                                                                                                                                                          |
| [006](decisions/006-poetry-source-format.md)                 | 운문 본문 segments 표현 _(common-bible-data로 이전, ADR-020)_                                                                                                                                                                                                 |
| [007](decisions/007-launch-screen-optimization.md)           | iOS 13종 디바이스 스플래시                                                                                                                                                                                                                                    |
| [008](decisions/008-pwa-install-guide.md)                    | 플랫폼별 설치 안내 모달                                                                                                                                                                                                                                       |
| [009](decisions/009-history-api-routing.md)                  | History API SPA 라우팅                                                                                                                                                                                                                                        |
| [010](decisions/010-bookmark-feature.md)                     | 북마크 데이터 모델 + UI                                                                                                                                                                                                                                       |
| [011](decisions/011-bookmark-sync.md)                        | Google Drive 동기화 (Phase 2a-2j — PKCE 단일 경로, OAuth 검수 통과 2026-05-19)                                                                                                                                                                                                                             |
| [012](decisions/012-typescript-incremental-adoption.md)      | JSDoc + `tsc --noEmit` 점진 도입 — `js/` 전체 기본 검사(`checkJs`) · 빼는 파일은 `// @ts-nocheck` · CI 필수                                                                                                                                                                |
| [013](decisions/013-client-js-unit-tests.md)                 | `node --test` + vm 하네스 유닛 테스트                                                                                                                                                                                                                         |
| [014](decisions/014-search-history.md)                       | 검색 이력 (LRU·로컬 전용)                                                                                                                                                                                                                                     |
| [015](decisions/015-storage-strategy.md)                     | 저장 장치를 용도별로 — localStorage · sessionStorage · IndexedDB · Cache API(쿠키 없음) + `bible-*` 키 접두어                                                                                                                                                                                                                        |
| [016](decisions/016-audio-cache-lru.md)                      | 오디오 캐시 LRU 제한                                                                                                                                                                                                                                          |
| [017](decisions/017-oauth-bff-proxy.md)                      | nginx BFF로 `client_secret` 격리                                                                                                                                                                                                                              |
| [018](decisions/018-app-modularization.md)                   | `js/app.js` 6,082 → 283줄, 9개 도메인 모듈 분할                                                                                                                                                                                                               |
| [019](decisions/019-esm-module-system.md)                    | ESM 일괄 채택 (`<script type="module">`), 빌드 단계 0 유지                                                                                                                                                                                                    |
| [020](decisions/020-monorepo-split.md)                       | 모노레포 4분할 (app·data·audio·server)                                                                                                                                                                                                                        |
| [021](decisions/021-pwa-versioning-content-hash.md)          | SHELL_CACHE = version.json 파생, DATA/AUDIO 콘텐츠 해시 매니페스트                                                                                                                                                                                            |
| [022](decisions/022-citations-and-annotations.md)            | 본문 인용(`<cite>`) + 주석(footnote) 표현과 단일 토글 렌더                                                                                                                                                                                                    |
| [023](decisions/023-settings-toggle-switches.md)             | 설정 상위 4개 옵션 → OS별 네이티브 토글 스위치                                                                                                                                                                                                                |
| [024](decisions/024-book-list-tabs-and-header-nav.md)        | 성서 목록 탭 통합 + 읽기 헤더 내비 재설계                                                                                                                                                                                                                     |
| [025](decisions/025-header-scroll-elevation.md)              | 읽기 헤더 스크롤 elevation 그림자                                                                                                                                                                                                                             |
| [027](decisions/027-source-dsl-and-parallel-passages.md)     | source markup DSL 위치 잡기 + 단락 단위 `<parallel>` element 도입                                                                                                                                                                                             |
| [028](decisions/028-design-system.md)                        | 디자인 시스템 — 토큰 사다리(간격·타이포·반경·elevation·컨트롤·모션) + HIG 정렬 (권위 문서 `DESIGN.md`)                                                                                                                                                        |
| [029](decisions/029-mobile-tab-bar.md)                       | 적응형 내비 Phase 1 — 모바일 하단 탭 바(전체화면 라우트 뷰, iOS 2026 Liquid Glass). 첫 결정의 4탭(홈·검색·북마크·설정) 가운데 검색은 ADR-030에서 따로 떨어진 원형으로, 캘린더 탭은 ADR-038에서 더해졌다                                                                                                                                                   |
| [030](decisions/030-morphing-tab-bar.md)                     | 모핑 탭 바 — 라벨 없는 아이콘 + 분리 검색 원형 → 입력 모핑(ADR-029 개정), 옛 검색 시트 제거, 스크롤 축소+오디오 미니(P3 완료)                                                                                                                                    |
| [031](decisions/031-tab-history-restore.md)                  | 탭 히스토리 — 탭별 마지막 라우트+스크롤 복원(홈=읽던 위치, 검색=마지막 검색), `scrollRestoration:"manual"` + route() 시퀀스 가드 · 다시 그린 뒤 포커스는 라우터가(2026-10-17)                                                                                                                              |
| [032](decisions/032-component-view-layer.md)                 | 컴포넌트·뷰 층 모듈화 — `el()` 위 무의존성 컴포넌트 층(`createOverlay` 단일 컨트롤러 + 시트 팩토리 + 비동기 `closeTransition` + `emptyState` 빌더)으로 오버레이 12곳·빈 상태 통일, 점진 교체 (구현 완료)                                                      |
| [033](decisions/033-search-options.md)                       | 검색 옵션 — 책 picker(필터 시트)·결과 내 검색(AND)·진입 시 최근 검색 목록(개별/전체 삭제), URL 인코딩 필터 상태, 노트 검색 범위 확장 대비 (구현 완료)                                                                                                         |
| [034](decisions/034-views-routing-second-split.md)           | 뷰·라우팅·북마크 2차 분할 — 관심사별 모듈화 + 비순환 facade→명시 import 전환 + 순환 dispatch는 registry 역전 (ADR-018 후속. `views-routing.js` 2,389줄은 audio-player·data-fetch·tabbar·routing·overlay 로 분해돼 소멸, `bookmark.js` 3,578→589줄. PR5c registerView 역전만 보류)                                                                                                             |
| [035](decisions/035-bookmark-reading-view.md)                | 북마크 모아 읽기 — 폴더 단위 연속 읽기 화면(`/read/<id>`, 홈 탭 분류), 폴더 행 `읽기`(auto_stories) 진입, 인접·연속 본문 병합, 네스팅 폴더는 소제목. `renderChapter` 절 루프를 `appendVerses`로 추출(전례독서 페이지 기반 기술) (구현 완료 — 모바일, 2026-06-09)                     |
| [036](decisions/036-liturgical-calendar-data-model.md)       | 교회력(전례력) 데이터 모델 — 본기도 평면 배열(자기 좌표)·explode/병합 규칙·영어 값+`_vocab`·temporal/sanctoral·품계 8단계(2차)·전례색 4색·computus 기준·맺음구 분리 (데이터 구현 완료 2026-07-27 · 앱 엔진 B1 2026-10-11)                                                                               |
| [037](decisions/037-eucharist-lectionary-data-and-engine.md) | 감사성찬례 전례독서 데이터·엔진 — `eucharist-readings.json` 좌표 스키마(refs=장 경계, verseSpec 재사용, 대안 세트 explode), 전례시편 별도 책 `lps`(계응 DSL, 숨김), 연중 주간 구간표·KASI 음력, `liturgical-engine.js`(computus·후보 관측일 보존) **(A1-a 계산 계층 구현 2026-09-13 · A1-b 조회 계층 구현 2026-10-10 · B1 품계·승자·전례색·재일·이동 패스 구현 2026-10-11 — 구현 완료)** |
| [038](decisions/038-calendar-lectionary-ui.md)               | 교회력 캘린더·전례독서 뷰·검색 이원화 — 캘린더 탭(홈 옆, 월간·주간·목록 3뷰), `/lectionary/YYYY-MM-DD`(고른 관측일의 본기도만 — 대체안 탭 · 송영 상수 · 계응 시편 · 세트/트랙 전환), 검색 상단 탭(성서 본문/전례독서) **(구현 중 — 렌더 기반 2026-07-27 · A3 독서 뷰 2026-10-12 · A2 캘린더 탭 1단계(탭 · 월간) 2026-10-15; A2 2단계(주간 · 목록) · A4 남음)** |

026은 main에 없다 — 1.6.0 노트 · 캘린더 설계는 개발을 멈춘 `release/1.6.0` 브랜치에만 있다. data 저장소의 ADR(002 · 003 · 006 · 039 전례시편 DSL)은 그 저장소 `docs/decisions/`에 있다.

## 부록 B. 자주 보게 되는 파일 빠른 참조

- 부트스트랩 / Service Worker 등록: `js/app.js`
- 라우팅 (parsePath·route·navigate·popstate · 교회력 모듈을 그 화면에 처음 갈 때 `import()`): `js/app/routing.js`
- 본문 렌더 + Views + 렌더 헬퍼 · 캘린더 · 전례독서의 머리 · 실패 화면: `js/app/views.js`
- 데이터 패칭 (books/version/chapter/prologue + 캐시): `js/app/data-fetch.js`
- 교회력 계산·조회·품계·이동 (computus·절기 스팬·연중 주차·주기·기간 축 / 프리로드·`resolveDate`·`findReadings`·`findCollects` / 승자·재분류·전례색·`fastOf` / 이동 패스·선택 봉헌): `js/app/liturgical-engine.js`
- 전례독서 뷰 (`/lectionary` — 관측일 칩·본기도·독서 네 슬롯·영광송·세트/트랙·두 독서 카드): `js/app/lectionary.js`
- 캘린더 탭 (`/calendar` — 월간 표·칸 이름·전례색 점·전례년 표지·링크 이름): `js/app/calendar.js`
- 오디오 플레이어 (장별 mp3 UI·재생 상태·#audio-bar): `js/app/audio-player.js`
- 검색 UI / 결과 화면 / 이력 패널: `js/app/search.js`
- 북마크 드로어/헤더 오케스트레이터: `js/app/bookmark.js`
- 북마크 트리 렌더 (행 빌더·재렌더 허브·전체뷰): `js/app/bookmark-tree.js`
- 북마크 제스처 (드래그 reorder·스와이프 액션): `js/app/bookmark-gestures.js`
- 북마크 선택 삭제 모드 / 절 선택 모드: `js/app/bookmark-select.js` · `js/app/bookmark-verse-select.js`
- 북마크 모달 7종 / 순수 로직 / 절 스펙: `js/app/bookmark-modals.js` · `js/app/bookmark-core.js` · `js/app/verse-spec.js`
- 설정 화면 + 외관 적용: `js/app/settings-ui.js`
- 공통 DOM 헬퍼 + `emptyState` 빌더: `js/app/helpers.js`
- 오버레이 컨트롤러 / 시트 팩토리 (모달·드로어·시트·팝오버 생명주기): `js/app/overlay.js`
- localStorage 영속화: `js/app/storage.js` (동기화 캐시 · 북마크 정렬 · 인용 안내 키는 각 모듈이 직접 쓴다 — §5)
- 검색 워커 프로토콜: `js/search-worker.js:1` (헤더 주석)
- 상태 머신 진입점: `js/sync/state-machine.js`의 `dispatch()` · 끄는 길 `_stopSync()`
- Drive 파사드 (PKCE 콜백 · 로그아웃 · 「파일도 삭제」 · 다른 탭): `js/drive-sync.js`
- 업데이트 확인 · 토스트: `js/app.js` · 셸 캐시 버전: `sw-version.js` (`scripts/release.py`가 갱신)
- 머지 알고리즘: `js/sync/store-v2.js`의 `mergeDocs()`
- SW 캐시 전략: `sw.js`의 `fetch` 리스너
- Drive REST 호출: `js/sync/transport.js` (모든 fetch가 여기 한 파일)
- 도메인 타입: `js/types.d.ts`
