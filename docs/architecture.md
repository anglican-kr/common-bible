# 아키텍처 개요

이 문서는 공동번역성서 PWA의 전체 구조를 한눈에 보기 위한 지도다. 세부 결정의 근거는 `docs/decisions/`의 ADR을 참조하고, 코드 줄 단위의 설명은 본문에서 가리킨 파일을 직접 읽기를 권한다.

> 이 문서는 **계속 변경되는 설계 문서**다. 결정 그 자체가 아니라 여러 결정이 모여 만든 구조를 설명한다. 새로운 결정이 생기면 ADR을 먼저 작성하고, 그 결과로 구조가 달라지면 이 문서를 갱신한다.

## 1. 한 줄 요약

브라우저가 정적 JSON 파일을 직접 읽어 화면에 그리는 **프레임워크 없는 단일 페이지 앱**(SPA)이고, 서비스 워커가 오프라인 캐시를 맡는다. 빌드 단계는 데이터 저장소의 Python 스크립트가 마크다운 원본과 전례 자료를 JSON으로 전처리하는 것뿐이다(데이터 저장소 main에 push되면 CI가 이 스크립트를 실행해 결과를 커밋한다. §3). 실행 중에는 서버가 없고, 정적 호스팅에 그대로 배포된다.

저장소는 넷으로 나뉜다(ADR-020). 이 앱 저장소(공개), `common-bible-data`(비공개. 마크다운 원본, 파이프라인, 빌드 출력), `common-bible-audio`(비공개 LFS. mp3), `common-bible-server`(비공개. nginx 설정과 배포 스크립트)다. 앱 저장소가 데이터 저장소를 서브모듈로 연결하고 데이터 저장소가 오디오 저장소를 중첩 서브모듈로 연결하므로, 문서 루트 기준 URL은 `/data/...`로 그대로 유지된다.

운영 도메인 `bible.anglican.kr`과 개발 도메인 `dev.anglican.kr`이 같은 웹 서버에서 가상 호스트로 제공된다. 각 도메인의 문서 루트는 `/var/www/{bible,dev}` 심볼릭 링크가 가리키는 디렉터리(`bible-{version}-{shortsha}`)이고, 배포와 롤백은 심볼릭 링크 교체 한 줄로 끝난다(`common-bible-server/scripts/deploy.sh` 참조).

Google Drive 동기화와 OAuth는 외부 서비스에 의존한다. 서버가 중간에서 맡는 곳은 `/oauth/token` POST 한 군데뿐이다. nginx가 서버 쪽에서 `client_secret`을 넣은 뒤 `oauth2.googleapis.com/token`으로 전달하는 BFF 패턴이다. 나머지는 클라이언트가 Google 엔드포인트와 직접 통신한다([ADR-017](decisions/017-oauth-bff-proxy.md)).

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

### 대상 사용자와 제품 원칙

옛 `docs/prd.md` §1.2-§2에서 옮겼다. PRD는 2026-10-22에 삭제했다(사용자 결정).

**대상 사용자**

- 주요 사용자: 스크린 리더(VoiceOver, TalkBack)로 디지털 콘텐츠에 접근하는 시각장애인.
- 보조 사용자: 빠르고 방해 없는 오프라인 성경 읽기를 원하는 일반 신자와 연구자.
- 기타 사용자: 인터넷 연결이 제한된 환경의 사용자.

**핵심 가치**

- 접근성 최우선: WCAG 2.1 AA를 준수한다.
- 오프라인 기능: 처음 불러온 뒤에는 인터넷 연결 없이도 동작한다.
- 성능: 가볍고 빨라서 저사양 기기에서도 원활하게 돈다.
- 오디오 통합: 모든 장에서 본문과 오디오를 오갈 수 있다.

**제품 원칙**

1. 접근성은 기본이다. 모든 기능은 시각장애인의 접근성을 고려해 설계한다.
2. 서버에 의존하지 않는다. 앱은 정적 사이트로서 클라이언트에서 완전히 실행된다. 데이터베이스나 백엔드 서버가 필요 없다.
3. 빠르고 효율적이다. 앱은 즉시 열리고 사용자 조작에 바로 반응한다.
4. 표준을 따른다. 표준 PWA 관행을 따르고 유효한 HTML과 CSS를 유지한다.
5. 안전하다. PWA의 보안 취약점을 막는 모범 사례를 따른다.

## 2. 아키텍처를 결정한 4가지 제약

1. **저작권**: 원본 텍스트는 비공개 저장소(`common-bible-data`, ADR-020)의 `source/` 아래 마크다운으로 관리한다. 앱 저장소가 그 저장소를 `data/`에 서브모듈로 연결하므로 문서 루트 URL은 그대로 `/data/...`다. 빌드 산출물(`bible/`, `books.json`, `search-*.json`, `lectionary/`, 매니페스트 2종)도 데이터 저장소에 커밋되므로(main에 push되면 CI가 다시 만들어 커밋한다) 앱은 서브모듈 포인터로 버전을 고정하기만 한다. 파이프라인은 데이터 저장소에 접근할 수 있는 사용자만 실행할 수 있다.
2. **비상업, 비영리**: 백엔드를 운영할 인력과 예산이 없다. 모든 상태는 클라이언트나 사용자의 Google Drive 앱 전용 폴더(`appDataFolder`)에 저장한다.
3. **오프라인 우선**: 교회와 예배 환경의 불안정한 네트워크를 가정한다. PWA의 서비스 워커가 설치할 때 셸(JS, CSS, HTML, 아이콘, `books.json`, `search-meta.json`, 매니페스트 2종)을 받아 둔다. 본문 장, 검색 청크, 교회력 표, mp3는 처음 쓸 때 캐시하므로 그 뒤로는 오프라인에서도 열린다. 미리 전부 받지는 않는다(§4.6).
4. **장기 유지보수성**: 1인 개발이 가능해야 한다. 프레임워크와 번들러를 쓰지 않고, 의존성을 최소로 하고, 테스트를 자동화하는 것이 핵심 안전장치다.

이 네 제약이 SPA, Vanilla JS, Python 일회성 전처리, Drive 앱 전용 폴더, 정적 호스팅이라는 선택을 사실상 하나의 결론으로 정했다. 자세한 내용은 [ADR-001](decisions/001-spa-architecture.md).

## 3. 빌드 타임: 데이터 파이프라인

원본 마크다운(73권)을 장별 JSON 1328장(시락 머리말 포함)과 검색 인덱스(별칭 메타 파일, 구약 청크, 신약 청크, 외경 청크)로 변환한다. 전례 원료(전례시편과 송가의 기준, 교회력 정의 표, 전례독서와 본기도 기사)는 전례 책의 장 JSON과 교회력 표, 전례독서 표로 변환한다. 빌드는 의도적으로 **일회성 스크립트의 조합**이고, make, just, poetry 같은 빌드 시스템에 묶지 않는다. 각 스크립트는 같은 입력에 같은 출력을 낸다. 다만 **순서는 지킨다**. `split_bible.py`가 `books.json`을 73권으로 새로 쓰므로, 전례시편 파서가 그 뒤에 돌아야 두 권의 등록이 남는다. 전례 표 파서끼리도 서로의 산출물을 읽는다. 명령과 순서의 기준은 데이터 저장소 `CLAUDE.md`의 「파이프라인 명령」이다(`build.yml`이 같은 순서로 돈다).

파이프라인은 `common-bible-data` 저장소 안에서 실행하며, 작업 디렉터리는 그 저장소 루트다(앱 저장소 기준 `data/`).

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
liturgical/*.py           ← 전례독서 · 연중 주간 · 본기도 · 교회력 정의 표 · 설·추석 · 성인 공통 · 반절 경계 (ADR-036 · 037)
        │  lectionary/*.json (12개 — 캘린더 묶음 다섯 · 전례독서 묶음 다섯 · 지역 축일 · 전례독서 검색 색인)
        ▼
scripts/gen_manifests.py  ← 콘텐츠 해시 매니페스트 (ADR-021)
           bible-manifest.json (bible/ · 검색 청크 셋 · lectionary/)
           audio-manifest.json (mp3 — LFS 포인터 OID)
```

(앱의 문서 루트에서는 같은 산출물이 `data/bible/...`와 `data/search-*.json` 위치에 보인다. 서브모듈 연결 때문에 `data/`가 앞에 붙는다.)

설계 포인트:

- **물리적 장 순서**: 시락 머리말, 다니엘 추가본 등 본래 장 번호가 어그러지는 부분은 "원전이 있는 그대로의 물리 순서"를 따른다 ([ADR-003](decisions/003-physical-chapter-ordering.md)).
- **검색 인덱스 분할(구약, 신약, 외경)**: 5.8 MB 단일 파일을 셋으로 나눠 첫 검색의 응답 속도를 앞세웠다([ADR-005](decisions/005-search-indexing-strategy.md)). 워커는 신약 청크만 받으면 검색을 시작한다(§4.2).
- **운문 본문 형식**: 마크다운 블록 인용(`>`)으로 적는다. 절 안의 산문과 운문은 `segments` 배열(`type: "prose"|"poetry"`)로 나누고, 연(스탠자)은 절 사이의 `stanza_break: true`나 절 안 텍스트의 `\n\n`으로 나눈다. 단락은 `segments` 항목의 `paragraph_break: true`로 나눈다. 자세한 내용은 [ADR-006](decisions/006-poetry-source-format.md).
- **교회력 데이터**: 교회력 정의 표가 「그날이 어떤 전례일인가」를 정하는 기준이며, 표에는 등급과 전례색이 있다. 전례독서와 본기도는 이름, 날짜, 절기 위치로 그 표에 조인되는 본문 표다. 독서와 본기도 파서는 전례일 키를 읽는 코드를 함께 쓴다([ADR-036](decisions/036-liturgical-calendar-data-model.md)과 [ADR-037](decisions/037-eucharist-lectionary-data-and-engine.md)). 이동 축일(temporal)의 규칙 문자열(`easter-46` 등)은 파서가 빌드할 때 구조화해 두므로 앱 엔진은 다시 파싱하지 않는다.

**자동화**: 데이터 저장소 main에 파이프라인 입력이 push되면 `build.yml`이 파이프라인, 매니페스트, 전체 pytest를 실행해 산출물을 main에 커밋하고, 앱 저장소의 `sync-data.yml`을 실행하도록 요청한다. `sync-data.yml`은 서브모듈 포인터와 `sitemap.xml`을 올리고 실데이터 테스트를 실행한다. 통과하면 `sync/data-<run_id>` PR을 열고, Unit tests 검사가 끝난 뒤 자동으로 스쿼시 머지한다(버전은 올리지 않는다). 실데이터 테스트에는 교회력 설계서의 사실 블록과 대조하는 검사가 들어 있다. 데이터가 바뀌어 문서의 실측치와 달라지면 이 자동 PR은 만들어지지 않고, 문서를 함께 고친 앱 PR이 포인터를 올린다.

자세한 실행 명령은 [README §데이터 파이프라인 실행](../README.md#데이터-파이프라인-실행).

## 4. 런타임: 클라이언트 모듈 지도

런타임 코드는 자바스크립트 파일 40개로 나뉜다(`js/` 7개, `js/app/` 28개, `js/sync/` 5개). 메인 스레드에서 쓰는 파일이 39개이고, 그 안에 `index.html`의 `<script src>` 31개, `import`로만 불러오는 `bookmark-*` 5개, 그 화면에 처음 갈 때 `import()`로 받는 교회력 모듈 3개가 든다. 나머지 1개는 Web Worker인 `search-worker.js`다. 서비스 워커 쪽(`sw.js`, `sw-version.js`)과 TypeScript 전용 `js/types.d.ts`는 이 수에 넣지 않는다.

ADR-018 모듈 분할(2026-05-10)로 옛 단일 `app.js` 약 6,000줄이 도메인 모듈 8개로 나뉘었고, 남은 `app.js`에는 부트스트랩과 서비스 워커 등록 정도만 있다. 자세한 분할 결과는 [`docs/archive/design/app-modularization.md`](archive/design/app-modularization.md). 분할과 함께 ADR-019로 모듈 시스템을 **ESM으로 한꺼번에 전환**했다(2026-05-09 · 05-10). 이후 ADR-022(인용과 주석), ADR-027, ADR 030-035, ADR-037, ADR-038이 모듈을 더했다. ADR-034 2차 분할과 그 뒤의 `bookmark.js` 분할이 커진 모듈을 나눠, 지금 `js/app/` 도메인 모듈은 **28개**다(교회력 엔진 `liturgical-engine.js`, 전례독서 뷰 `lectionary.js`, 캘린더 탭 `calendar.js` 포함).

### 로드 방식

`index.html`이 `<script src>` 태그 31개(로컬 JS)를 의존성이 있는 순서대로 **명시적으로 나열**한다(ADR-019 §"채택 방식"). 이 밖에 Google 태그 외부 스크립트(`async`) 1개와 JSON-LD 데이터 블록 1개가 있다. 진입점 하나를 두고 ESM `import` 그래프가 불러오게 하는 구조가 **아니다**. 모듈 대부분이 자기 `<script>` 태그를 가지며, 브라우저는 태그를 만나는 순서대로 불러온다. 예외는 아래 여덟이다. `bookmark-*` 5개는 태그 없이 `bookmark.js`의 `import`를 따라 부팅할 때 불러온다. 교회력 셋(`liturgical-engine.js`, `lectionary.js`, `calendar.js`)은 부팅할 때 싣지 않고, `/calendar`와 `/lectionary`에 처음 갈 때 `routing.js`의 `import()`로 불러온다(ADR-038 §2 「구현」).

| 로드 모드                                | 파일 수 | 비고                                                                                                                 |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| `<script type="module">` (자동 지연 실행) | 28      | 대부분의 모듈. 모듈 범위(scope)에서 `import`와 `export`를 쓸 수 있다                                                                   |
| `<script defer>` (classic)               | 2       | `audio-cache.js`와 `manifest-sync.js`. `sw.js`도 `audio-cache.js`를 `importScripts()`로 불러오므로 classic이어야 한다(ADR-019 §"예외"). `manifest-sync.js`도 classic이지만 `sw.js`는 불러오지 않는다 |
| `<script>` (head, 즉시 실행)             | 1       | `pre-fetch.js`. `<head>`에서 즉시 `data/books.json` 내려받기를 시작한다. `type="module"`은 자동으로 지연 실행되어 요청이 늦어진다 |

`<script>` 태그가 없는 런타임 파일이 9개 더 있다. `search-worker.js`는 `new Worker()`로 따로 만드는 독립 컨텍스트이다. `bookmark-{tree,gestures,select,menu,verse-select}.js` 5개는 `bookmark.js`가 ESM `import`로 끌어오며, 브라우저가 `import` 그래프를 따라 받는다. 교회력 셋은 `routing.js`가 그 화면에 처음 갈 때 동적 `import()`로 불러온다. 캘린더 탭은 셋을, 전례독서 화면은 뷰와 엔진 둘을 한꺼번에 요청한다. 차례로 받으면 왕복이 한 번 더 든다(Chromium. WebKit은 앱 안에서 처음 갈 때 의존 모듈을 한 번 더 요청한다. [`known-issues.md`](known-issues.md) §13). 성서만 읽는 세션은 셋(원본 약 210KB, gzip 약 70KB)을 불러오지 않고, 서비스 워커는 오프라인용으로 셋을 미리 받는다(§4.6). 이득과 대가는 서비스 워커 캐시가 없는 첫 방문에만 있다. 첫 화면은 느린 4G에서 0.39초 빨라지고, 첫 방문에 성서 화면에서 캘린더 탭을 열면 0.53초, 그 주소로 바로 들어오면 0.16-0.2초 늦어진다. 바로 열기를 미리 받는 `modulepreload`는 넣지 않았다. WebKit에서 실패한 미리 받기가 그 탭을 막기 때문이다(ADR-038 「검토한 대안 — 모듈 로드」 E). 재방문의 부팅 시간은 어느 쪽이든 측정 오차 안이다(ADR-038 §2 「구현」의 실측). 받지 못하면 라우터가 그 뷰의 제목으로 실패 화면을 그리고 「다시 불러오기」(페이지 새로 고침)를 단다. 지정자는 글자 그대로 둔다. `tests/unit/sw.test.js`가 그 지정자를 따라가 오프라인 목록과 대조하고, 셋이 부팅 그래프 밖에 있는지도 확인한다.

모듈 사이의 의존은 여전히 `window.X` 공개 인터페이스(파사드. `window.driveSync`, `window.appHelpers` 같은 전역 객체)가 주류이고, ADR-019는 이를 **점진적으로 폐기할 대상**으로 정했다. 새 코드는 `import`와 `export`로 작성하기를 권한다.

**최상위 (`js/`):**

| 파일                  | 역할                                                                                                                              | 라인 수 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `js/pre-fetch.js`     | 첫 페인트 직전에 `data/books.json`을 비동기로 미리 가져온다                                                                                    | ~10     |
| `js/gtag-init.js`     | Google Analytics 초기화                                                                                                           | ~15     |
| `js/app.js`           | 앱 부트스트랩, 접근성을 위한 `keydown` 이벤트 처리, 오디오 캐시 LRU 소프트캡, 서비스 워커 등록, 업데이트 확인(한 시간에 한 번까지. `checkForUpdates`), 업데이트 토스트, 탭에 돌아올 때 Drive `pollSync` 호출, `clearAllCaches` | ~330    |
| `js/audio-cache.js`   | 오디오 LRU 기록을 담는 IndexedDB ([ADR-016](decisions/016-audio-cache-lru.md))                                                        | ~190    |
| `js/manifest-sync.js` | 부팅할 때 콘텐츠 해시 매니페스트를 이전 것과 비교해 `DATA_CACHE`와 `AUDIO_CACHE`를 항목 단위로 무효화 ([ADR-021](decisions/021-pwa-versioning-content-hash.md)) | ~200    |
| `js/search-worker.js` | Web Worker. 청크 불러오기, 절 검색, 페이지네이션                                                                                    | ~390    |
| `js/drive-sync.js`    | Drive 동기화 파사드(조정 모듈). PKCE 콜백 처리, 업로드 디바운스, 로그아웃, 「파일도 삭제」(자격 증명을 먼저 지운다), 다른 탭의 로그아웃 감지, 동기화 스낵바(라이브 영역에도 알린다) | ~285    |
| `js/types.d.ts`       | 도메인 타입을 정의하는 한 곳 ([ADR-012](decisions/012-typescript-incremental-adoption.md))                                               | —       |

**`js/app/` 도메인 모듈 28개** (ADR-018 1차 분할, ADR-022 인용과 주석, ADR-034 2차 분할, `bookmark.js` 분할, 교회력 엔진, 전례독서 뷰, 캘린더 탭):

| 파일                               | 역할                                                                                                                                                                       | 라인 수 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `js/app/helpers.js`                | 공통 DOM 헬퍼(`_$`/`el`/`clearNode`/`setInert`/`trapFocus`)와 `emptyState` 빌더. 헤더 아이콘을 그리는 `headerIcon`과 `HEADER_ICON_PATHS`(헤더 아이콘 SVG 규격 하나와 글리프마다 path 하나. 집 단추, 전례독서 위 단계 꺾쇠, 인용 시트 뒤로 단추가 함께 쓴다). 새 탭에서 열리는 클릭인지 판정하는 `isModifiedClick`(전역 `<a>` 인터셉터와 탭 처리기가 함께 쓴다). 같은 화면을 다시 그린 뒤 누른 컨트롤로 포커스와 화면 위치를 돌려주는 `focusSpotOf`와 `restoreFocusSpot`(라우터가 연결한다. 포커스를 잃었을 때만 돌려준다. ADR-031 §5) | ~355    |
| `js/app/overlay.js`                | 오버레이 생명주기를 한 곳에서 맡는 컨트롤러 `createOverlay`(scrim, `trapFocus`, Esc 키, `inert`, 포커스 복원, 애니메이션을 거친 닫기), 시트 팩토리, 열린 오버레이를 모두 닫는 `closeAllOverlays()`와 그 등록부 ([ADR-032](decisions/032-component-view-layer.md), ADR-034 PR5b) | ~330    |
| `js/app/storage.js`                | localStorage 헬퍼, UI 공유 상수, 북마크 두 사본을 수정 시각을 올리지 않고 고쳐 쓰는 `rewriteBookmarks`, 전례독서 트랙 기억(`bible-lectionary-track`)                                                                                          | ~515    |
| `js/app/settings-ui.js`            | 설정 팝오버와 모바일 설정 화면, 외관 적용, 인용과 주석 토글, Drive 줄(연결, 해제, 진단 복사, 끝나지 않은 삭제를 알리는 `.settings-drive-note`). 로그인 상태가 바뀌면 두 화면을 모두 다시 그린다 | ~880    |
| `js/app/install.js`                | PWA 설치 감지, 안내 모달, 설치 안내 넛지                                                                                                                                          | ~495    |
| `js/app/search.js`                 | 검색 워커 연결, 결과 그리기, 이력 패널, 시트([ADR-033](decisions/033-search-options.md)). 쪽 링크는 포커스 키를 달고(라우터가 포커스를 돌려준다. ADR-031 §5), 쪽이 바뀌면 라이브 영역이 말로 알린다. 결과 건수 줄은 `h2`다 | ~1,595  |
| `js/app/reading-context.js`        | 현재 책과 장, 절 선택 모드의 공유 상태                                                                                                                                        | ~35     |
| `js/app/verse-spec.js`             | 절 스펙의 파싱, 비교, 직렬화, 병합. 북마크에 저장하는 표기 `verseNumberSpec`, 옛 버전 표기를 옮기는 `wholeVerseSpec`(ADR-010 「옛 저장값」), `verseInstanceKey`, 바깥에서 들어온 절 범위를 검사하는 `isWellFormedSpec`(가져오기 파일과 주소가 함께 쓴다. ADR-040). 다른 모듈에 의존하지 않는다(leaf. ADR-034). ADR-038 §3의 렌더 기반이다            | ~455    |
| `js/app/liturgical-engine.js`      | 교회력 엔진(다른 모듈에 의존하지 않는다. ADR-037 §6). 계산(A1-a, 설계서 §4)은 부활절 계산(computus), 절기 구간, 연중 주차, 주기, 기간 축이다. 조회(A1-b, 설계서 §5)는 두 묶음 프리로드, `resolveDate` 후보 집합, `findReadings`, `findCollects`, `findHalfVerse`다. 우선순위, 지정 전례일, 전례색, 재일, 옮김(B1, 설계서 §6)은 범주 순서, 재분류, `fastOf`, 연도 단위 옮김 계산 `computeTransfers`, 선택 봉헌 `setActivatedOptionals`다. 교회력을 계산하는 범위(1583-9999. `MIN_YEAR`, `MAX_YEAR`, `isComputableYear`, `isComputableDate`)의 기준이며, `resolveDate`는 범위 밖이면 `null`을 돌려준다. 부팅할 때 싣지 않는다. 전례독서와 캘린더가 `import`하고, 그 둘을 `routing.js`가 그 화면에 처음 갈 때 `import()`로 불러온다 | ~2,180 |
| `js/app/lectionary.js`             | 전례독서 뷰. `/lectionary[/YYYY-MM-DD]`를 맡는다. 순수 모델 `buildLectionaryModel`은 초기 선택, 트랙, 대안 세트 세 갈래(「또는」, 조건부, 괄호 선택 구절 합침), 본기도, 칩 라벨, 두 독서 카드, 헤더 색, URL 상태를 만든다(`LECTIONARY_MODEL` 마커 블록). DOM은 본기도와 그다음 독서 네 슬롯(`appendVerses`로 계응 시편과 영광송 1회, 선택 구절 〔 〕), 전례일 칩, 세그먼트, 날짜 이동 줄 `buildDateNav`(캘린더와 공유)를 그린다. 다시 그리는 링크는 포커스 키만 단다(포커스는 라우터가 돌려준다). 엔진을 처음 쓰는 화면이다([ADR-038](decisions/038-calendar-lectionary-ui.md) §3). 머리와 실패 화면은 `views.js`의 것을 쓴다. 부팅할 때 싣지 않는다. `/lectionary`(또는 캘린더 탭)에 처음 갈 때 `routing.js`가 `import()`로 불러온다 | ~1,380 |
| `js/app/calendar.js`               | 캘린더 탭. `/calendar[/YYYY-MM]` 월간 표를 맡는다. 순수 모델 `buildMonthGrid`와 `calendarDay`는 6주 × 7일 칸을 만들고, 칸마다 이름 하나(대표. 격자 평일이면 사계재, 기념일, 번호 주일 「연중29주」), 그날의 전례색 `colors`, 전례년 첫날 표지, 링크 이름을 정한다(`CALENDAR_MODEL` 마커 블록). DOM은 `<table>` 7열과 이전, 다음, 오늘 링크다. 캘린더 묶음만 프리로드한다. 이름, 날짜, 색 함수와 날짜 이동 줄은 `lectionary.js`에서, 계산 범위 판정은 엔진에서, 머리와 실패 화면은 `views.js`에서 `import`한다([ADR-038](decisions/038-calendar-lectionary-ui.md) §1, §2). 부팅할 때 싣지 않는다. `/calendar`에 처음 갈 때 `routing.js`가 `import()`로 불러온다 | ~390 |
| `js/app/bookmark-core.js`          | DOM이 없는 북마크 로직(트리 조회, 삽입, 삭제, href와 공유, 정렬과 최근 본 순서, 활성 경로 판정 함수, 옛 버전 절 범위 옮기기 `migrateLegacyBookmark`). `window` 파사드 없이 다른 모듈이 `import`로 쓴다(자기 `<script>` 태그는 있다. ADR-034) | ~455    |
| `js/app/bookmark-modals.js`        | 북마크 모달 7종(확인, 새 폴더, 폴더 콤보박스, 저장과 편집, 병합, 가져오기, 이동 선택기)과 렌더 콜백 의존성 주입, 하나로 모은 Esc 스택(`closeTopmostModal`)(ADR-034). 가져오기는 항목을 하나씩 검사해 어긋난 것만 빼고 들이고(`_sanitizeImportItems`. ADR-040), 옛 버전의 절 범위는 들이면서 옮긴다 | ~1,150  |
| `js/app/bookmark.js`               | 북마크 **드로어와 헤더의 조정 모듈**. 드로어 생명주기, 헤더 버튼, 초기화 연결, 파사드, `keydown` 처리와 Drive 연결 해제 모달(「파일 유지」, 「파일도 삭제」)을 맡는다. 트리 그리기, 제스처, 선택, ⋯ 메뉴, 절 선택은 아래 5개 모듈로 나눴다(ADR-034 후속, 2026-06-11) | ~570    |
| `js/app/bookmark-tree.js`          | 트리 렌더링. 행별 빌더(스와이프 액션, 드래그 핸들, 선택 원, 폴더 읽기 버튼), `renderBookmarkTree`(드로어 본문과 전체 화면), `_rerenderActiveBookmarkTree` 허브, `renderBookmarksView`, 드로어 키보드 내비게이션 | ~640    |
| `js/app/bookmark-gestures.js`      | 제스처 엔진. 드래그로 순서 바꾸기(≡ 핸들에서만 시작한다. ADR-010 개정), 스와이프 액션 노출, 스와이프를 놓을 때의 계산(`SWIPE_GESTURE` 마커 블록, 유닛 테스트), 통합 포인터 핸들러      | ~505    |
| `js/app/bookmark-select.js`        | 선택 삭제 모드. 선택 상태, 폴더를 고르면 안의 항목도 고르는 계산(`BOOKMARK_SELECT` 마커 블록), `#bm-select-bar` 독(공유, 이동, 삭제), 전체 선택 ([ADR-029](decisions/029-mobile-tab-bar.md) 개정) | ~365    |
| `js/app/bookmark-menu.js`          | 전체 화면 제목 줄의 액션. ⋯ 오버플로 메뉴(새 폴더, 내보내기, 가져오기, 선택), 정렬 기준과 순서 라디오, 🛈 안내 팝오버, `exportBookmarks`                                       | ~440    |
| `js/app/bookmark-verse-select.js`  | 절 선택 모드. 본문에서 절을 누르면 `#verse-select-bar` 독(진행 중인 절 스펙, 북마크와 복사)이 나온다. 조정 모듈을 다시 호출하지 않는다                                                                          | ~150    |
| `js/app/bookmark-read.js`          | 북마크 모아 읽기. 폴더 단위 연속 읽기 화면이다(`appendVerses`로 절 부분집합을 그리고, 인접한 연속 본문은 합치고, 중첩 폴더는 소제목으로 나눈다) ([ADR-035](decisions/035-bookmark-reading-view.md)) | ~475    |
| `js/app/citations.js`              | 인용 칩의 중복 제거와 그리기, 인용 본문 바텀 시트(확장 화면, 드래그로 크기 조절), 주석이 붙는 낱말의 위 첨자, 클릭 툴팁([ADR-022](decisions/022-citations-and-annotations.md)). 시트 머리의 뒤로 꺾쇠는 `headerIcon`으로 그린다 | ~1,135  |
| `js/app/parallels.js`              | 단락 단위 병행 본문. `chapter.parallels`를 범위 시작 절의 ※ 표지로 그리고, 누르면 주석과 같은 모양의 툴팁이 나온다. 그 안의 출처를 누르면 `#cite-sheet`가 열린다 ([ADR-027](decisions/027-source-dsl-and-parallel-passages.md)) | ~295    |
| `js/app/tab-history.js`            | 탭별 라우트와 스크롤 위치 복원. 뒤로 가기와 같은 방식(POP)으로 `popstate`와 탭 전환에서만 복원한다. `/lectionary`와 `/calendar`는 캘린더 탭이다 ([ADR-031](decisions/031-tab-history-restore.md))           | ~140    |
| `js/app/data-fetch.js`             | 데이터 가져오기(books, version, chapter, prologue 요청과 `booksCache`, `appVersion` 캐시). 다른 모듈에 의존하지 않는다(ADR-034 PR2)                                                                   | ~90     |
| `js/app/audio-player.js`           | 장별 mp3 플레이어 UI, 재생 상태, `#audio-bar` 생명주기(ADR-034 PR1)                                                                                                    | ~240    |
| `js/app/views.js`                  | 렌더 헬퍼, 화면 그리기 함수(코드의 `Views` 구역), `appendVerses` 절 그리기, 세그먼트 탭 빌더 `buildSegmentTabs`(구분 탭과 독서 뷰 세그먼트가 함께 쓴다. 항목의 `focusKey`로 라우터가 다시 그린 뒤 포커스를 돌려준다), 책 이름과 헤더를 자동으로 짧게 표시하는 처리, 캘린더와 전례독서의 머리와 전체 화면 실패(`commitLiturgicalTitle`, `renderLiturgicalFailure`. 두 화면 모듈과 라우터가 함께 쓴다. 화면 모듈을 받지 못해도 그릴 수 있게 부팅 모듈에 둔다). 데이터 가져오기는 data-fetch.js로, 오디오는 audio-player.js로, 탭 인디케이터는 tabbar.js로, 라우팅은 routing.js로 옮겼고, 당겨서 새로 고침(PTR)은 제거했다(ADR-034) | ~1,840 |
| `js/app/routing.js`                | URL 파싱(`parsePath`. `/lectionary`의 쿼리 상태를 포함하고, 여러 구간의 절 범위는 앱이 쓰는 표기만 강조한다. 앞뒤 쉼표는 떼고 `verse-spec.js isWellFormedSpec`으로 검사한다), SPA 내비게이션(`navigate`), `route()` 조정 함수, 페이지 메타 정보와 분석, 읽기 위치 스크롤 추적, 링크 클릭과 `popstate` 리스너(ADR-034 PR5a). 링크 클릭 인터셉터가 같은 화면을 다시 그리는 링크의 자리를 재 두었다가 `route()`의 `finally`에서 돌려주고(ADR-031 §5), 페이지 안 링크(「본문 바로가기」)는 라우트하지 않고 대상으로 포커스만 옮긴다. 캘린더와 전례독서 모듈은 그 분기에서 처음 갈 때 `import()`로 한꺼번에 받고(`openLazyView`. 받은 모듈은 기억해 두어 다시 그릴 때 기다리지 않는다), 받지 못하거나 그리다 오류가 나면 `views.js`의 실패 화면(그 뷰의 제목, 머리, 「다시 불러오기」. [ADR-038](decisions/038-calendar-lectionary-ui.md) §2 「구현」)을 그린다. 공용 `catch`도 낡은 `route()`의 실패는 버린다 | ~780 |
| `js/app/tabbar.js`                 | 탭 바. 활성 상태, 슬라이딩 인디케이터(ADR-034 PR3), 검색 모핑 독, 하단 입력, `visualViewport` 키보드 처리 ([ADR-030](decisions/030-morphing-tab-bar.md))                    | ~580    |

`bookmark-{tree,gestures,select,menu,verse-select}.js` 5개는 `index.html`에 `<script>` 태그가 없다. `bookmark.js`가 ESM `import`로 끌어온다. 교회력 셋(`liturgical-engine.js`, `lectionary.js`, `calendar.js`)도 태그가 없다(위 「로드 방식」).

**`js/sync/` 동기화 계층:**

| 파일                       | 역할                                                                                            | 라인 수 |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------- |
| `js/sync/state-machine.js` | 동기화 상태 머신(PKCE 단일 경로, [ADR-011](decisions/011-bookmark-sync.md) Phase 2h). 사이클에서 기다릴 때마다 `_leftSyncing`으로 확인하고, 끄는 길은 `_stopSync` 하나이며, 「파일도 삭제」는 `deleteRemoteFile`이 맡는다 | ~1,160  |
| `js/sync/transport.js`     | PKCE 기본 함수, Drive REST, `/oauth/token` BFF ([ADR-017](decisions/017-oauth-bff-proxy.md)). 찾기, 내려받기, 올리기, 지우기는 상태 코드를 함께 돌려준다 | ~525    |
| `js/sync/store-v2.js`      | 레코드별 수정 시각(mtime)과 삭제 표시(툼스톤) 병합                                                               | ~450    |
| `js/sync/refresh-store.js` | OAuth 갱신 토큰(refresh token)을 암호화해 저장하는 IndexedDB(AES-GCM 비추출 키)                                              | ~190    |
| `js/sync/debug-log.js`     | 오래된 줄부터 덮어쓰는 진단 로그                                                                           | ~160    |

위 파일 말고도 `js/types.d.ts`가 있다. TS 컴파일러의 입력으로만 쓰이며 `@typedef`와 `@type`이 참조한다. 의존 순서나 로드 모드를 바꿀 때는 [ADR-019](decisions/019-esm-module-system.md)를 본다.

### 4.1 라우팅 (History API SPA)

`js/app/routing.js`가 브라우저의 History API(`pushState`, `popstate`)로 URL을 갱신해 페이지 이동을 흉내 내고, 서비스 워커는 모든 페이지 이동 요청을 `/index.html`로 바꿔 같은 셸을 다시 띄운다. 단, `/privacy.html` 같은 별도 페이지는 그대로 통과시킨다([ADR-009](decisions/009-history-api-routing.md), `sw.js`의 `fetch` 리스너가 받는 `navigate` 요청). 옛 해시 주소(`#/…`)는 부팅할 때 같은 경로로 바꿔 준다.

라우트:

| 경로                                                       | 화면              |
| ---------------------------------------------------------- | ----------------- |
| `/`와 `/{division}`(`old_testament`, `deuterocanon`, `new_testament`) | 홈. 성서 목록과 구분 탭([ADR-024](decisions/024-book-list-tabs-and-header-nav.md)) |
| `/{book_id}`와 `/{book_id}/prologue` | 장 목록과 머리말(집회서) |
| `/{book_id}/{chapter}`와 `/{book_id}/{chapter}/{절 스펙}`(`?hl=`은 검색어 강조, `?resume`은 이어읽기) | 본문(절 스펙 예: `16`, `1-5,10-15`) |
| `/search?q=&page=&in=` | 검색 결과(모바일은 전체 화면. [ADR-030](decisions/030-morphing-tab-bar.md)과 [ADR-033](decisions/033-search-options.md)) |
| `/bookmarks`와 `/settings` | 북마크와 설정(모바일 탭 화면) |
| `/read`와 `/read/{folderId}` | 북마크 모아 읽기 ([ADR-035](decisions/035-bookmark-reading-view.md)) |
| `/calendar`와 `/calendar/{YYYY-MM}` | 캘린더 월간 표 ([ADR-038](decisions/038-calendar-lectionary-ui.md) §2) |
| `/lectionary`와 `/lectionary/{YYYY-MM-DD}`(`?obs&track&set&collect`) | 전례독서(교회력. [ADR-038](decisions/038-calendar-lectionary-ui.md) §3) |

로컬 개발 서버(`scripts/serve.py`)는 같은 폴백을 흉내 내어 강제 새로 고침이 깨지지 않게 한다. **`python -m http.server`는 쓰면 안 된다.** `/gen/1` 같은 라우트에 404를 돌려준다.

### 4.2 검색 (Web Worker와 청크 인덱스)

`js/app/search.js`는 메인 스레드에서 검색 UI와 결과 시트만 다루고, 실제 텍스트 검색은 `js/search-worker.js`가 전담한다.

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

워커 프로토콜은 `search-worker.js:1`의 상단 주석에 정의되어 있다. 워커는 검색마다 부여한 `searchId`로, 사용자가 새 검색어를 친 뒤 뒤늦게 도착한 옛 결과를 무시한다. 책 인덱스는 청크 JSON에 RLE(같은 값이 이어지는 구간을 `[값, 개수]`로 묶는 방식)로 줄여 두고 워커가 펼쳐 `Uint16Array`에 담는다. 장 인덱스와 절 인덱스도 `Uint16Array`로 보관해 메모리를 줄였다. 별칭(요한, 요, 요한복음 등)은 `data/search-meta.json`에 있다. 검색 범위는 책 필터 `in:<책 별칭>`(예: `사랑 in:요한`)이나 책 고르기(URL의 `in=`. [ADR-033](decisions/033-search-options.md))로 좁힌다([ADR-005](decisions/005-search-indexing-strategy.md)).

### 4.3 동기화 (Drive 앱 전용 폴더와 PKCE)

가장 복잡한 하위 시스템이다. 파사드 `drive-sync.js`와 `js/sync/`의 다섯 파일이 역할을 나눈다:

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
              │ 경쟁 상태 검사와  │ │ store.js          │ ┌─────────────────┐
              │ 카운터 캡 보유    │ │ - AES-GCM 암호화   │ │ sync/debug-     │
              └───────────────────┘ │   IndexedDB        │ │ log.js          │
                                    │ - 256-bit key      │ │ - ring buffer   │
                                    │   webcrypto 비추출  │ │ - 토큰 마스킹    │
                                    └───────────────────┘ └─────────────────┘
```

핵심 설계:

- **PKCE 단일 경로**: 데스크톱, Android, iOS가 같은 흐름을 쓴다. 앱을 다시 켰을 때 IndexedDB에 저장된 갱신 토큰(refresh token)으로 사용자 모르게 `/token`을 호출해 새 접근 토큰을 받는다. 갱신 토큰이 없으면 `NEEDS_CONSENT`로 바뀌고 사용자에게 다시 로그인을 요청한다([ADR-011](decisions/011-bookmark-sync.md), `docs/archive/design/pkce-migration.md`).
- **OAuth `/token` BFF**: `transport.js`는 `https://oauth2.googleapis.com/token`이 아니라 같은 출처(same-origin)의 `/oauth/token`으로 요청을 보낸다. 웹 서버(nginx)가 비밀 키(`client_secret`)를 서버 쪽에서 넣은 뒤 Google로 전달한다. Google의 "Web application" 클라이언트는 PKCE에서도 비밀 키를 요구해 RFC 7636(PKCE 표준)에서 벗어나는데, 이 방식으로 그 문제가 생기지 않게 한다(자세한 내용은 [ADR-017](decisions/017-oauth-bff-proxy.md)).
- **탭 복귀 폴**: 사용자가 탭으로 돌아올 때(`visibilitychange`의 visible 분기) `pollSync()`(`requestSync({ throttleMs: 15000 })`와 같다)를 한 번 호출한다. 다른 기기의 변경분을 새로 고침 없이 가져온다. 사이클이 끝난 지 15초 안이면 건너뛰고, 사이클이 도는 중이면 호출을 버린다(도는 사이클이 그 폴을 대신한다). OFFLINE이고 기기가 온라인이면 다시 시도한다.
- **상태 머신의 모든 변경은 `_transition()` 한 곳을 거친다.** 카운터(`{netFails, conflictFails, reAuthFails, backoffTimer}`)도 이때 함께 초기화된다. 다음 상태로 이어 가야 할 값은 명시적으로 넘겨야만 보존된다(`state-machine.js`의 머리 주석).
- **동시 실행 검사**: 상태(`_state`)를 검사하고, `localStorage["bible-drive-sync"]`의 켬 표지를 검사하고, 비동기 대기(`await`) 직후마다 다시 검사한다. 그래서 백그라운드 토큰 갱신, `code` 교환, 동기화 사이클(대기 여섯 곳마다 `_leftSyncing`) 도중에 연결을 끊어도 사용자의 의도가 지켜진다. 사이클은 하나만 돈다(`_startCycle`의 `_syncPending`). 확인은 대기마다 한 줄이며, 진행 중인 요청을 취소하는 구조(`AbortController`)로 바꾸지 않는다. 결정과 재검토 조건은 [coding-pitfalls.md](coding-pitfalls.md) §11에 있다.
- **끄는 길은 하나**: `_stopSync`다. 이 함수가 켬 표지를 "0"으로 쓰고, 동기화 캐시와 토큰을 지우고, DISABLED로 전환하고, 설정을 다시 그린다. `disable()`(어느 상태에서든)과 「파일도 삭제」가 함께 쓴다. 다른 탭은 켬 표지의 `storage` 이벤트로 멈춘다.
- **사이클 도중의 편집**: 병합 직전(내려받기 뒤)에 로컬을 다시 읽어서, 대기하는 동안 저장한 북마크와 설정을 덮어쓰지 않는다. 사이클이 도는 동안 들어온 사용자 요청은 사이클이 끝난 뒤 한 번 더 돈다(`_resyncRequested`, 다음 마이크로태스크).
- **캐시와 304**: fileId, ETag, 마지막으로 맞춘 문서의 지문을 캐시해 두고(`bible-drive-cache-*`) 목록 요청을 건너뛴다. 조건부 GET(`If-None-Match`)이 304를 돌려주면 내려받지 않고, 로컬 문서의 지문이 다르면 올리기만 한다. 구글이 앱에 ETag를 주지 않아 운영에서는 304가 오지 않는다(2026-10-30 확인, known-issues §42).
- **실패 처리**: 응답에 따라 다르게 처리한다. 401은 조용한 갱신으로 처리한다(갱신 토큰이 없으면 NEEDS_CONSENT, 새 토큰도 거절되면 상한에서 ERROR). 412는 다시 병합한다(세 번까지, 그 뒤에는 스낵바와 IDLE). 코드 오류(`no_token`, 예외)는 ERROR다. 그 밖의 실패(`http_<status>`. 네트워크 0, 403, 429, 5xx 등)는 1, 2, 4, 8, 16초로 백오프하고, 그래도 실패하면 네트워크 실패만 OFFLINE으로, HTTP 실패는 IDLE로 둔다(다음 요청이 다시 시도한다). 기기가 오프라인이면 곧바로 OFFLINE이다. 전송 함수는 실패를 「없음」과 다른 값(상태 코드)으로 돌려주고, 본문을 읽지 못한 2xx도 실패로 본다([coding-pitfalls.md](coding-pitfalls.md) §28).
- **카운터 상한**: `MAX_REAUTH=3`(반복되는 401), `MAX_CONFLICTS=3`(412 ETag), `MAX_NET_RETRIES=5`(1, 2, 4, 8, 16초로 점점 늘리는 대기), `MAX_REDIRECT_ATTEMPTS=3`(끝없는 리디렉션 방지).
- **연결 해제**: 「파일 유지」는 토큰을 폐기하고(Google `/revoke`), IndexedDB의 갱신 토큰과 계정 키를 지우고, 켬 표지를 "0"으로 쓴 뒤 `_stopSync`를 호출한다. 「파일도 삭제」는 페이지가 닫혀도 남으면 안 되는 것을 먼저 지운다. IndexedDB의 갱신 토큰(한 번 갱신할 몫은 메모리에만 둔다), 켬 표지, 계정 키가 그것이다. 그다음 토큰을 상태 머신에서 곧바로 지워 동기화를 멈추고, 진행 중인 사이클이 이미 보낸 요청을 10초까지 기다린 뒤 appDataFolder의 `sync.json`을 모두 지운다(목록, 캐시된 id, 이 페이지가 만든 id를 대상으로 하며, 404는 이미 없는 것으로 보고, 401이면 한 번 갱신하고, 기다림 시간을 넘겼으면 한 번 더 기다렸다가 다시 시도한다). 끝나면 토큰을 폐기한다. 결과는 `true`, `false`, `null`이고, 삭제를 확인하지 못하면 스낵바와 설정의 안내를 남긴다(`bible-drive-delete-pending`. 다시 연결할 때까지 남는다).
- **병합 정책**: 항목마다 마지막 수정 시각(`_u`, 밀리초)과 삭제 표시(툼스톤)를 함께 저장한다. 항목 단위로 나중에 수정한 쪽을 남기고, 파일 전체를 단위로 하지 않는다. 그래서 서로 다른 기기에서 다른 북마크를 추가해도 둘 다 보존된다.

진입과 복귀 시나리오는 [README §Google Drive 동기화](../README.md#google-drive-동기화-북마크-설정-읽기-위치)의 표를 본다.

### 4.4 인용과 주석 (`<cite>`와 `[^id]`)

`js/app/citations.js`가 본문 그리기 분기를 받아 두 종류의 추가 콘텐츠를 그린다([ADR-022](decisions/022-citations-and-annotations.md)).

- **인용 칩**: 본문의 `<cite src="…" parallels="…" tradition="…">…</cite>`는 속성 순서를 이대로 고정한다(파서 정규식 때문이다). 이 요소가 있는 세그먼트 끝에 옅은 회색 출처 칩을 단다. 같은 출처가 연속된 절에 걸치면 마지막 절에서만 표시한다(중복 제거). 운문 인용은 같은 줄에 이어 붙이지 않고 별도 줄로 그려 시의 행을 흐트러뜨리지 않는다.
- **인용 본문 시트**: 칩을 누르면 출처 본문을 같은 페이지 위의 시트로 띄운다. 모바일과 터치 기기는 바텀 시트, 데스크톱(≥769px, 정밀 포인터)은 오른쪽 패널이다. 여러 `ref`, `parallels`, 한 장의 여러 절(`53:5,7-9`), 장을 넘는 범위를 지원한다. 「› 더 보기」를 누르면 시트 안에서 장 본문을 펼치고 인용한 절을 강조한다. 바텀 시트는 높이를, 패널은 왼쪽 가장자리를 끌어 폭을 조절하거나 닫을 수 있다. 시트 안의 본문에는 칩과 주석을 그리지 않는다(시트가 겹치지 않게 한다).
- **주석**: `[^id]`가 붙는 어절은 점선 밑줄을 친 단추(`role=button`)로, 붙는 어절이 없는 주석은 절 끝의 ※로 그린다. 누르면 툴팁으로 본문이 펼쳐지고, 스크롤하면 툴팁이 따라간다. 인쇄 전용 표현은 없다.
- **토글**: 설정의 「인용·주석 표시」 하나로 칩과 주석을 함께 끄고 켠다(`bible-cite-show`. 기본값은 켬이고, Drive 동기화 대상은 `citeShow`다).

데이터 파이프라인(`common-bible-data/src/parser.py`)이 마크다운에서 `<cite>`와 `[^id]`를 추출해 절 JSON의 `segments`와 `notes` 필드에 담아 두므로, 시트는 인용한 장마다 `/data/bible/{book}-{ch}.json`을 받아(서비스 워커 캐시) 그린다. 다른 장에 옮겨 실린 절은 앞뒤 3장까지 찾아본다(`RELOCATION_MAX_DISTANCE`).

### 4.5 책 이름과 헤더 자동 짧게 표시

신약 책 이름은 정식 명칭이 길어("고린토인들에게 보낸 첫째 편지"), 좁은 화면이나 큰 글자에서 책 목록 버튼과 장 보기 헤더가 두 줄로 늘어나 읽기 흐름을 깬다. `js/app/views.js`의 `NT_MOBILE_NAME` 매핑이 짧은 명칭을 제공한다(신약 26권 중 사도행전만 빠진다). 두 곳에서 같은 방식으로 정식 명칭과 짧은 명칭을 바꿔 그린다:

- 정식 명칭과 짧은 명칭을 `span` 두 개(`.book-name-full`과 `.book-name-mobile`, 헤더는 `.title-text-full`과 `.title-text-mobile`)로 함께 그린다.
- **터치 기기**: `@media (hover:none) and (pointer:coarse)` 미디어 쿼리로 책 목록과 헤더 모두 늘 짧은 명칭을 보인다. 폰과 태블릿이 같다.
- **터치가 아닌 기기**: `ResizeObserver`로 잰다. 정식 명칭이 한 줄에 들어가지 않으면(`.book-name-full`의 본래 너비가 사용 가능한 너비보다 크면) `.compact`를 추가해 짧은 명칭으로 바꾼다. 글자 크기가 바뀌어도(브라우저 확대, OS 설정, 앱 글자 크기) 자동으로 다시 잰다.
- 헤더는 양옆 단추(뒤로, 북마크, 설정)가 차지한 자리 가운데 큰 쪽과 여유 `0.8rem`을 양쪽에서 빼고, 선택기 꺾쇠의 여유 `0.8rem`을 더 뺀 너비로 잰다. 고정값 `5.2rem`은 데스크톱 배치에만 맞았기 때문이다.

사도행전은 매핑이 없다(이미 짧다). 접근성: 책 목록 링크와 헤더 제목의 `aria-label`은 화면이 짧은 명칭을 보여도 늘 정식 명칭이다. 장 보기의 선택기 단추 이름은 「장 선택」(시편은 「편 선택」)이고, 정식 명칭은 문서 제목과 화면 전환 안내(라이브 영역)로 전한다.

### 4.6 오프라인: Service Worker 캐시 전략

`sw.js`는 도메인과 요청 종류에 따라 전략을 나눈다(`fetch` 리스너와 `cacheNameFor`). "캐시 우선(cache-first)"은 한 번 받아 둔 자료가 있으면 그것을 먼저 보여 주고, 없을 때만 네트워크로 가져오는 방식이다.

| 대상                                                                    | 전략                                                              | 이유                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| `fonts.gstatic.com`                                                     | 캐시 우선, **별도 `FONT_CACHE`**에 보관하며 다른 캐시가 갱신돼도 보존  | 글꼴 파일은 바뀌지 않고 URL에 버전이 들어 있다          |
| GET이 아닌 요청 (POST `/oauth/token` 등) | 서비스 워커를 거치지 않는다 | Cache API는 GET만 받는다 |
| OAuth/Drive 4개 호스트                                                  | **항상 네트워크 직행**, 서비스 워커 우회                          | 캐시하면 토큰과 동기화 데이터가 깨진다                             |
| 페이지 이동 요청 (HTML)                                                 | `/index.html`로 대체(단, `/privacy.html`은 통과). 운영은 캐시 우선, 개발 도메인과 localhost는 네트워크 우선 | SPA 라우팅                                                      |
| 셸(JS, CSS, HTML, 아이콘, `books.json`, `search-meta.json`, 매니페스트 2종) | 캐시 우선, `SHELL_CACHE`에 저장(개발 도메인과 localhost는 네트워크 우선이고 캐시는 오프라인 폴백) | 코드와 강하게 묶여 있어 릴리스마다 함께 갱신한다                              |
| 본문, 검색, 교회력(`/data/bible/*`, `/data/search-{ot,nt,dc}.json`, `/data/lectionary/*`) | 캐시 우선, `DATA_CACHE`에 저장(이름은 `"data"`로 고정)                     | 누적 캐시이고, 콘텐츠 해시 매니페스트를 비교해 항목 단위로 갱신한다        |
| 오디오 (`/data/audio/*`)                                                | 캐시 우선, `AUDIO_CACHE`에 저장(이름은 `"audio"`로 고정). 넣을 때 용량 상한을 적용한다([ADR-016](decisions/016-audio-cache-lru.md)) | 필요할 때 내려받고, 콘텐츠 해시 매니페스트를 비교해 항목 단위로 갱신한다 |
| 매니페스트 (`/data/{bible,audio}-manifest.json`)                        | **네트워크 우선**. 실패하면 `SHELL_CACHE`에 미리 받아 둔 사본으로 폴백 | 최신 상태가 핵심이다                                               |

캐시는 네 가지 이름으로 나뉜다(`sw.js`):

- `SHELL_CACHE`(예: `shell-1.6.4`): 셸과 부팅에 필요한 메타 정보, 그리고 부팅할 때 싣지 않는 교회력 모듈 셋을 담는다. 교회력 모듈 셋은 설치할 때 미리 받는다. 교회력 표는 처음 쓸 때 `DATA_CACHE`에 들어가므로, 오프라인에서 열리는 캘린더와 전례독서는 온라인에서 한 번 연 화면이다. 이름은 `importScripts('/sw-version.js')`로 `self.APP_VERSION`을 읽어 `"shell-" + APP_VERSION`으로 정한다. 릴리스마다 갱신한다.
- `DATA_CACHE`(`"data"`): 본문 장 JSON(73권 1328장, 머리말, 전례시편 150, 송가 13), 검색 청크 셋, 교회력 표, 전례독서 표를 담는다. 이름은 고정이고, 항목별 무효화는 `js/manifest-sync.js`가 맡는다(ADR-021).
- `AUDIO_CACHE`(`"audio"`): 장별 mp3를 담는다. 무효화 방식은 `DATA_CACHE`와 같다.
- `FONT_CACHE`(`"fonts"`): Google Font 파일을 담는다. 콘텐츠 주소를 기준으로 하므로 사실상 영구하다.

`scripts/release.py`가 `version.json`과 `sw-version.js`를 한 번에 갱신하고 자동으로 커밋한다. `--bump-data`와 `--bump-audio` 같은 콘텐츠 캐시 버전 올림 플래그는 ADR-021 이후 사라졌다. 콘텐츠 무효화는 `common-bible-data` 저장소 CI가 만든 `bible-manifest.json`과 `audio-manifest.json`의 변화를 앱이 부팅할 때 비교해 항목 단위로 처리한다. 새 서비스 워커가 활성화되면 `KNOWN_CACHES`에 없는 옛 캐시만 삭제하므로, 셸만 갱신된 릴리스에서 사용자가 이미 받은 본문과 오디오는 보존된다. 사용자 동의 없이 즉시 활성화하는 `skipWaiting()`은 호출하지 않는다. 사용자가 "업데이트" 버튼을 눌러 클라이언트가 `SKIP_WAITING` 메시지를 보낼 때만 새 서비스 워커가 곧바로 활성화된다. 설치할 때 셸 파일은 `?v=<APP_VERSION>`과 `cache: "reload"`로 HTTP 캐시를 건너뛰어 받아 원래 URL로 저장하고, 활성화할 때 오디오 캐시와 그 LRU 기록(IndexedDB)을 맞춘다.

## 5. 영속 데이터: 어디에 무엇이 저장되는가

| 위치 | 키/파일 | 내용 | 동기화? |
| --- | --- | --- | --- |
| `localStorage` | `bible-bookmarks-v2` | 동기화 문서 v2. 북마크(`items`, `tombstones`), 설정, 이어읽기를 담고 레코드마다 수정 시각이 있다 | ✅ |
| `localStorage` | `bible-bookmarks` | 옛 트리 사본. 저장할 때마다 동기화 문서 다음에 쓴다(ADR-015 D7). 2026-05-04 전의 버전이 이 키에만 둔 목록은 동기화 문서로 옮기고, 옮기기 전까지는 목록을 여기서 읽는다 | (호환) |
| `localStorage` | `bible-font-size`, `bible-theme`, `bible-color-scheme`, `bible-book-order`, `bible-startup`, `bible-cite-show`, `bible-audio-show` | 설정 7종 (v2 문서의 설정과 같은 값) | ✅ |
| `localStorage` | `bible-last-read` | 마지막 읽기 위치 (이어읽기 배너) | ✅ |
| `localStorage` | `bible-sync-meta` | `{schemaVersion, deviceId}` | (메타) |
| `localStorage` | `bible-drive-sync` | 켬 표지("0", "1"). 다른 탭은 이 키의 `storage` 이벤트로 로그아웃을 안다 | (메타) |
| `localStorage` | `bible-drive-sync-email` | 마지막 인증 이메일 (OAuth `login_hint`) | (메타) |
| `localStorage` | `bible-drive-cache-file-id`, `bible-drive-cache-etag`, `bible-drive-cache-synced-hash` | 동기화 캐시. fileId, ETag, 마지막으로 맞춘 문서의 지문을 담고, 목록 요청과 내려받기를 건너뛰는 데 쓴다. 구글이 ETag를 보내지 않아 운영에서는 ETag가 비어 있다 | (메타) |
| `localStorage` | `bible-drive-redirect-attempts` | 끝없는 리디렉션을 막는 카운터(상한 3) | (메타) |
| `localStorage` | `bible-drive-delete-pending` | 끝나지 않은 「파일도 삭제」. 설정에 남는 안내이며 다시 연결하면 지운다 | 로컬 전용 |
| `localStorage` | `bible-audio-pos` | 오디오 재생 위치 | 로컬 전용 |
| `localStorage` | `bible-lectionary-track` | 전례독서 트랙 기억. 값은 하나(`1` 또는 `2`)이고, 마지막 선택이 날짜와 해에 상관없이 기본값이 된다(사용자 결정 2026-10-13, ADR-038 §3) | 로컬 전용 |
| `localStorage` | `bible-search-history` | 검색 이력 (LRU, [ADR-014](decisions/014-search-history.md)) | 로컬 전용 |
| `localStorage` | `bible-bookmark-sort`, `bible-bookmark-sort-dir`, `bible-bookmark-viewed` | 북마크 정렬 기준, 방향, 최근 본 시각 | 로컬 전용 |
| `localStorage` | `bible-install-nudge`, `bible-cite-coachmark-seen` | 설치 안내 넛지 상태, 인용 칩 안내를 봤는지 여부 | 로컬 전용 |
| `sessionStorage` | `bible-drive-redirect-state-pkce` | PKCE `{nonce, verifier, returnTo, ts, flow}` (10분 TTL) | 임시 |
| `sessionStorage` | `bible-drive-back-nav-context` | 리디렉션 전의 기록 길이 (돌아온 뒤 뒤로 가기 보정) | 임시 |
| `IndexedDB` | `bible-drive-sync` (`keys`, `tokens`) | AES-GCM으로 암호화한 갱신 토큰(암호화 키는 꺼낼 수 없는 상태로 저장한다. `extractable: false`) | 로컬 전용 |
| `IndexedDB` | `bible-audio-cache` / `entries` | 오디오 LRU 기록([ADR-016](decisions/016-audio-cache-lru.md)) | 로컬 전용 |
| `IndexedDB` | `bible-manifest-sync` / `snapshots` | 직전 매니페스트 스냅샷(비교 기준) | 로컬 전용 |
| Cache Storage | `shell-X.Y.Z` (SHELL_CACHE) | 앱 셸, `books.json`, `search-meta.json`, 매니페스트 2종 | (배포물) |
| Cache Storage | `data` (DATA_CACHE) | 본문 장 JSON(전례시편과 송가 포함), 검색 청크 셋, 교회력 표와 전례독서 표 | (누적) |
| Cache Storage | `audio` (AUDIO_CACHE) | 장별 mp3 (필요 시 다운로드) | (누적) |
| Cache Storage | `fonts` (FONT_CACHE) | Google Font 파일 | (영구) |
| Google Drive (`appDataFolder`) | `sync.json` | 동기화 페이로드(v2 문서, `schemaVersion`, `deviceId`)와 ETag | ☁️ 원격 |

동기화 대상이 아닌 항목(오디오 위치, 정렬, 캐시 등)은 의도적으로 기기에만 둔다. 기기 ID는 다른 기기가 가져가지 않지만, 올리는 페이로드에 실려 병합에서 시각이 같을 때 순서를 정하는 데 쓰인다. 옛 키(`bible-drive-sync-updated`와 `bible-drive-silent-blocked`)는 지우기만 한다. 첫 북마크를 저장할 때와 첫 오디오를 재생할 때 `navigator.storage.persist()`를 한 번 요청한다(저장소 정리에 대비한 것이다. 아래 「알려진 한계」의 ITP). 동기화 페이로드 스키마는 `js/types.d.ts`의 `SyncDoc` 타입과 `js/sync/store-v2.js:1`의 헤더 주석에 정의되어 있다.

## 6. 정적 타입 검사: JSDoc과 `tsc --noEmit`

빌드 산출물 0개를 유지하면서도 타입 안전성을 얻기 위해 **TypeScript를 컴파일러로만 사용**한다 ([ADR-012](decisions/012-typescript-incremental-adoption.md)).

- **`js/`의 모든 클라이언트 JS가 검사 대상이다.** 두 `tsconfig` 파일 모두 `checkJs: true`다(2026-10-17). 앱 모듈, 동기화 계층, `js/pre-fetch.js`(`<head>`의 classic 스크립트), `js/gtag-init.js` 등은 `tsconfig.json`(DOM)이 검사하고, `js/search-worker.js`는 `tsconfig.worker.json`(WebWorker)이 검사한다. 검사에서 뺄 파일은 첫 줄에 `// @ts-nocheck`로 밝힌다. 지금은 그런 파일이 없다. 그 줄을 실행문 뒤에 두면 무시되어 파일이 검사된다(ADR-012 「파일 헤더」). 그전(2026-05-10부터 10-17까지)에는 파일마다 `// @ts-check`로 검사를 켰기 때문에, 지시문이 `"use strict";` 뒤에 있던 22개 파일이 오류 없이 검사에서 빠져 있었다. 2026-10-17부터 10-18까지 세 묶음으로 나눠 모두 검사에 넣었다. `sw.js`는 어느 `tsconfig`의 `include`에도 없다. [`known-issues.md`](known-issues.md) §7을 본다.
- 도메인 타입은 `js/types.d.ts` 한 곳에서 내보낸다(`export`).
- 다른 파일은 `@typedef {import("../types").Foo} Foo`로 가져온다.
- 설정 파일은 `tsconfig.json`(DOM 라이브러리)과 `tsconfig.worker.json`(WebWorker 라이브러리) 둘로 나눈다.

검증:

```bash
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
```

두 명령(`npm run typecheck`)을 CI의 필수 검사 「Unit tests」 잡이 PR마다 실행한다. 오류가 0건이어야 머지할 수 있다(2026-10-17부터. 그전에는 로컬 훅뿐이었다).

## 7. 테스트: 3계층과 유닛

테스트는 비용, 실행 빈도, 원본 텍스트 의존성에 따라 다음과 같이 나뉜다.

| 종류                                                                         | 위치                                         | 원본 필요?                               | CI?              | 무엇을 보호하는가                                                                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **클라이언트 JS 유닛** ([ADR-013](decisions/013-client-js-unit-tests.md))    | `tests/unit/*.test.js`                       | ❌                                       | ✅ (앱 저장소)   | 동기화 계층(상태 머신, PKCE 등), 앱 계층(storage, helpers, install, search, bookmark, views의 순수 영역), 교회력 엔진, 전례독서 뷰 모델. 케이스 수는 `tests/README.md`가 기준이다. DOM이 많은 영역은 e2e가 맡는다 |
| **Level 1 완전성** ([ADR-004](decisions/004-data-pipeline-test-strategy.md)) | `data/tests/test_completeness.py` (서브모듈) | ❌                                       | ✅ (data 저장소) | 1328개 장 파일과 구조의 누락                                                                                                                     |
| **Level 2 절 순서**                                                          | `data/tests/test_ordering.py`                | ❌ (`fixtures/verse_sequence.json` 사용) | ✅ (data 저장소) | 파이프라인을 바꿀 때 생기는 절 순서 회귀                                                                                                              |
| **Level 3 스냅샷**                                                           | `data/tests/test_snapshots.py`               | ❌                                       | ✅ (data 저장소) | 장 사이 재배치 등 특수한 경우                                                                                                          |
| **전례 데이터 검증**                                                         | `data/tests/test_{psalter,canticles,lectionary,ordinal_weeks,calendar_tables,collects,commons}.py` 등 | 일부(원료 마크다운, 기사, 표를 읽는다) | ✅ (data 저장소) | 전례시편과 송가 DSL, 전례독서와 본기도 스키마, 교회력 정의 표의 조인과 사계재, 연중 주간 구간표 |
| **E2E (Playwright)**                                                         | `tests/e2e/*.py`                             | ✅ (서버와 본문)                         | ❌ (로컬)        | 검색 UI, 라우팅, 클립보드, 설치 안내, 동기화 등의 회귀                                                                                         |

유닛 테스트는 `node --test`만으로 돌고, `tests/unit/harness.js`가 자체 `vm` 모듈 컨텍스트를 만들어 전역 상태가 테스트 사이에 이어지는 일을 막는다. 의존성은 없다. 앱 저장소 CI(`.github/workflows/test.yml`의 「Unit tests」)는 Node 24로 유닛 테스트를 자동 실행하고, 같은 잡에서 타입 검사(`npm run typecheck`, §6)도 실행한다. 브랜치 보호의 필수 검사는 「Unit tests」와 「Change ledger」(`ledger.yml`. PR의 변경 원장)다. 실데이터가 있어야 실행되는 테스트(`*.data.test.js`, `sw.test.js`, `docs-data-consistency.test.js`)는 그 잡에서 건너뛰고, `engine-data.yml`(엔진이나 뷰 경로의 파일이 바뀐 main push, 또는 수동 실행)과 `sync-data.yml`(데이터 저장소가 실행을 요청한다)이 실행한다. 이 검사는 PR을 막지 않는다. 데이터 저장소에서는 `validate.yml`이 PR과 main push마다 `pytest tests/`(Level 1-3과 전례 데이터)를 실행하고, `build.yml`도 산출물을 만든 뒤 같은 테스트를 통과해야 커밋한다. 그 봇 커밋은 기본 `GITHUB_TOKEN`으로 push되어 다른 워크플로를 실행시키지 않으므로, 빌드된 산출물은 `build.yml`의 테스트 단계에서 확인한다(분할 후 ADR-020).

E2E는 의도적으로 CI에서 제외한다. 본문 텍스트가 있는 환경에서만 의미가 있고, 시각 회귀는 사람이 봐야 가장 정확하기 때문이다.

## 8. 빌드, 배포, 릴리스

배포 대상은 운영 도메인 `bible.anglican.kr`과 개발 도메인 `dev.anglican.kr` 둘이고, 같은 nginx 호스트에서 가상 호스트로 나뉜다. 각 문서 루트는 `/var/www/{bible,dev}` 심볼릭 링크가 가리키는 버전 디렉터리이고, 배포와 롤백은 심볼릭 링크 교체 한 번으로 끝난다(원자적).

릴리스 단계(`release.py`)는 앱 저장소에 남아 있고, 빌드와 배포 단계(`build-deploy.sh`, `deploy.sh`)는 `common-bible-server` 저장소로 옮겼다(ADR-020).

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

`release.py`는 `version.json`과 `sw-version.js`의 `APP_VERSION`을 함께 갱신하고 자동으로 커밋한다. 한쪽만 바뀌어 서비스 워커가 새 셸을 가져오지 못하는 일을 막기 위해서다. `DATA_CACHE`와 `AUDIO_CACHE`는 ADR-021 이후 이름이 고정이다. 콘텐츠 무효화는 `common-bible-data` 저장소 CI가 `bible-manifest.json`과 `audio-manifest.json`을 자동으로 갱신하고, `js/manifest-sync.js`가 앱을 부팅할 때 항목 단위로 처리한다.

`deploy.sh`는 `bible-{version}-{shortsha}` 형식으로 디렉터리 이름을 붙인다. 그래서 `dev`에서 같은 버전을 여러 번 배포해도 덮어쓰지 않고, `promote`할 때 `dev`에서 검증한 디렉터리를 운영 심볼릭 링크가 그대로 가리킨다. `git diff --quiet` 검사는 커밋하지 않은 변경이 있는 작업 트리에 `-dirty` 접미사를 붙여, 실수로 한 배포를 추적할 수 있게 한다.

링크를 교체하거나 `promote`, `rollback`을 실행한 직후마다 자동 검증 9종이 실행된다. 검증은 `/version.json`의 버전 일치, `/sw.js`의 200과 Content-Type, `/index.html`의 200과 ETag, `/data/books.json`, `/sw-version.js`, 매니페스트 2종, 교회력 묶음 하나와 전례독서 묶음 하나(`lectionary/sanctoral.json`, `lectionary/eucharist-readings.json`)의 200이다. 실패하면 수동 롤백 안내를 출력한다. zip 파일에 넣을 경로는 `scripts/deploy-manifest.txt`가 정하고, 목록의 항목이 없으면 `build-deploy.sh`가 멈춘다. 목록에 없는 새 경로는 검사되지 않으므로 데이터 디렉터리를 더하면 목록도 고친다. 보호 심볼릭 링크 4개(`dev`, `bible`, `dev-previous`, `bible-previous`)와 `BUILD_RETENTION`(기본 3)개를 넘는 옛 빌드 디렉터리는 자동으로, 또는 확인한 뒤 정리한다. 자세한 흐름은 `common-bible-server/scripts/deploy.sh`의 헤더 주석에 있다.

릴리스 순서의 기준은 `CLAUDE.md` 「데이터 수정과 릴리스」 4번이다. `release.py patch`를 실행하면 push, 태그, GitHub Release까지 이어지고, 그다음 `deploy.sh dev`와 `deploy.sh promote`를 차례로 실행한다. main이 보호 브랜치라 버전 커밋은 `release/X.Y.Z` 브랜치에서 PR로 들어간다(예: #286. 원장이 릴리스 노트 초안이다). 변경 목록은 `scripts/changelog.py`가 만든다(`--generate-notes`를 대신한다).

업데이트 토스트 흐름:

1. 페이지가 서비스 워커 업데이트를 확인한다. 화면에 보이고 온라인일 때 한 시간에 한 번까지(`reg.update()`), 탭에 돌아올 때와 `online` 이벤트 때, 설정의 「업데이트 지금 확인」을 누를 때(`checkForUpdates`) 확인한다. 새 서비스 워커는 설치 단계에 들어간다.
2. 새 서비스 워커가 대기 상태(waiting)가 되면 `js/app.js`가 `GET_VERSION` 메시지로 새 서비스 워커의 `version.json`을 조회하고 토스트를 보인다.
3. 사용자가 "업데이트"를 누르면 `SKIP_WAITING` 메시지가 가고, 새 서비스 워커가 활성화되며, 페이지가 새로 고쳐진다.

자동으로 `skipWaiting()`을 호출하지 않는 이유: 사용자가 본문을 읽고 있을 때 갑자기 페이지가 새로 고쳐지면 안 된다.

## 9. 보안 모델

OAuth 측면 (가장 큰 공격 표면):

- **콘텐츠 보안 정책(CSP)**: `index.html`의 `<meta>`로 적용한다(서버 헤더는 없다). `script-src 'self' https://www.googletagmanager.com`이므로 스크립트는 같은 출처와 Google 태그(분석)만 허용하고, 실행되는 인라인 스크립트는 없다. 인라인 `<style>` 하나만 `style-src`의 sha256 해시로 허용하고, 그 해시는 `scripts/csp_hashes.py`와 `tests/unit/csp.test.js`가 지킨다. `accounts.google.com`은 `connect-src`에 없다(PKCE는 전체 페이지 리디렉션이라 프레임을 불러올 필요가 없다). `connect-src`의 `https://www.google.com`은 구글 애널리틱스가 페이지를 떠날 때 보내는 요청(`/g/collect`)을 위한 것이다. 구글 안내는 `https://*.google.com`을 권하지만 실제로 요청이 나가는 곳은 이 하나라 그것만 적었다(2026-10-18, 원장 `docs/changes/2026-10-18-csp-google-collect.md`. 와일드카드를 쓰면 `script.google.com` 같은 아무 하위 도메인으로나 요청을 보낼 수 있게 된다). `<meta>`로 주는 CSP는 위반을 보고받을 수 없어(`report-uri`와 `report-to`를 지원하지 않는다) 릴리스 전에 `tools/csp/csp_sweep.py`로 점검한다. 별도 페이지 `privacy.html`에는 CSP가 없다(인라인 스크립트가 하나 있다).
- **서비스 워커 우회**: OAuth와 Drive의 4개 도메인은 서비스 워커가 절대 캐시하지 않는다. GET이 아닌 요청(POST 등)도 서비스 워커를 거치지 않는다. Cache API가 GET만 지원하므로, 같은 출처의 POST `/oauth/token`도 캐시 대상에서 제외한다.
- **`client_secret` 서버 쪽 격리**: SPA 번들과 git 이력에는 비밀 키가 전혀 없다. 웹 서버(nginx)가 `proxy_set_body`로 `/oauth/token` 요청마다 비밀 키를 넣는다. 이렇게 하면 GitHub의 비밀 키 자동 감지(secret scanner)가 키를 무효화할 위험도, OAuth 2.1의 공개 클라이언트(public client) 원칙을 어기는 문제도 생기지 않는다([ADR-017](decisions/017-oauth-bff-proxy.md)).
- **OAuth 클라이언트 ID의 호스트 격리**: 개발용 클라이언트 ID는 Google Cloud Console에서 `dev.anglican.kr`만, 운영용 클라이언트 ID는 `bible.anglican.kr`만 허용된 출처(Authorized origin)와 리디렉션 URI로 등록한다. `localhost`는 의도적으로 등록하지 않는다. 사용자 PC의 악성 프록시가 같은 포트를 차지하고 PKCE 흐름을 가로챌 가능성을 막기 위해서다.
- **PKCE `state` 값(nonce)**: 10분 동안만 유효하다. 콜백 URL은 성공이든 실패든 곧바로 `replaceState`로 지운다(성공이나 검증된 오류는 돌아갈 주소로, 검증되지 않은 오류는 경로만 남긴다). 그래서 어떤 라우터나 로거도 콜백 URL을 보지 못한다.
- **갱신 토큰(refresh token)**: 브라우저 내장 암호화 API(webcrypto)의 AES-GCM 알고리즘으로 암호화하고, 암호화 키는 꺼낼 수 없는 상태로 저장한다(`extractable: false`). 평문은 IndexedDB에 한 번도 저장되지 않는다.
- **디버그 로그 마스킹**: `sync/debug-log.js`의 `mask()`가 토큰은 지문(djb2 8자리)으로만, 이메일은 첫 글자와 `***`와 도메인만, fileId는 끝 8자만, 긴 ETag는 앞 16자만, 페이로드는 크기만 남긴다. 로그는 메모리에만 둔다(최근 200개와 오류 20개. 운영 호스트에서는 콘솔에 출력하지 않는다).
- **연결 해제**: 「파일도 삭제」는 자격 증명(IndexedDB의 갱신 토큰, 켬 표지, 계정 키)을 네트워크 작업보다 먼저 지운다. 그래서 지우는 도중에 앱을 닫아도 「연결 해제됨」인데 자격 증명이 남는 일이 없다. 토큰 폐기는 지운 뒤에 한다(삭제 요청이 폐기된 토큰으로 나가지 않게 하기 위해서다). §4.3을 본다.
- **BFF 보안 강화**: `/oauth/token`은 POST만 받고(그 밖의 요청은 405), IP당 `limit_req` 60r/m에 `burst` 100, 본문 4k 상한을 둔다. 들어온 `Cookie`와 `Authorization`은 떼고 넘긴다(`common-bible-server/nginx/`의 예시).

브라우저 측면(심층 방어 헤더):

- **서버의 보안 헤더 6종(nginx 설정 조각)**: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 0`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), clipboard-read=(), fullscreen=(), display-capture=(), interest-cohort=(), browsing-topics=()`, `Cross-Origin-Opener-Policy: same-origin`. 모든 응답(HTML5 라우팅 폴백 포함)에 똑같이 적용한다. 설정은 한 곳 `/etc/nginx/snippets/security-headers.conf`에 있다(저장소 예시: `common-bible-server/nginx/security-headers.example.conf`).
  - `X-XSS-Protection: 0`: 옛 브라우저의 필터 자체 결함 때문에 다른 사이트로 정보가 유출된 사례가 있어, OWASP와 MDN 모두 `0`으로 두거나 헤더를 없애기를 권장한다. CSP(`script-src`. 같은 출처와 Google 태그만 허용)가 같은 역할을 한다.
  - `Referrer-Policy: strict-origin-when-cross-origin`: 최신 브라우저의 기본값을 명시한다. 다른 사이트로 이동할 때는 도메인만 보내 URL 경로가 노출되지 않게 한다.
- **nginx `add_header` 상속 함정 우회**: `location` 수준에 `add_header`가 하나라도 있으면 서버 수준 헤더가 모두 사라진다. 알려진 함정이다. 파일별 `Cache-Control`이 있는 `location`에도 같은 설정 조각을 다시 `include`해 모든 응답에 같은 헤더를 적용한다.

보안 감사: PKCE와 갱신 토큰 감사 [`2026-05-07-pkce-refresh-token.md`](archive/audit/2026-05-07-pkce-refresh-token.md)는 Critical, High, Medium이 0건이다. 그다음 2차 통합 감사 [`2026-05-08-second-comprehensive.md`](archive/audit/2026-05-08-second-comprehensive.md)는 Critical 0건, High 4건, Medium 9건, Low와 Info 15건이다(처리 상태는 그 문서에 있다).

## 10. 알려진 한계와 의도적 비결정

- **iOS Safari 탭 7일 자동 데이터 삭제 (ITP)**: 홈 화면에 설치하지 않고 Safari 탭에서만 쓰면 7일 동안 쓰지 않을 때 저장된 데이터가 비워진다(Apple의 Intelligent Tracking Prevention 정책). 대응은 설치 안내 모달을 강화하는 것이다([ADR-008](decisions/008-pwa-install-guide.md)). 홈 화면에 추가된 PWA는 이 정책의 영향을 받지 않는다.
- **외부 권한 회수**: 사용자가 Google 계정 설정에서 권한을 끊으면 다음 조용한 갱신이 `invalid_grant`로 실패하고, 앱은 IndexedDB를 비운 뒤 NEEDS_CONSENT로 돌아간다. (OAuth 앱 검수를 2026-05-19에 통과해 갱신 토큰에 만료 기간이 없다.)
- **iOS의 Chrome, Firefox, Edge**: iOS의 모든 브라우저는 내부적으로 Safari 엔진(WebKit)을 쓴다. iOS 17 이상은 공유 메뉴의 「홈 화면에 추가」로 설치할 수 있어 그 안내를 보이고(`ios-other`), iOS 16 이하는 「Safari에서 열어」 안내로 끝난다(`ios-legacy`. [ADR-008](decisions/008-pwa-install-guide.md) 개정 2026-05-11). 다른 브라우저와 동기화 데이터 분리는 보장되지 않는다.
- **백엔드 부재**: 사용자별 통계, 다중 기기 푸시, 서버 쪽 검색 등은 모두 할 수 없다. 의도적인 트레이드오프다. 운영비 0이 더 중요하다.
- **성서 번역본 1종**: 성서 본문은 공동번역만 다룬다. 전례시편과 송가는 기도서의 번역으로 전례용 책(`lps`, `cant`)에 따로 싣는다. 번역 대조는 로드맵 밖이다.
- 미해결 이슈와 후속 백로그의 기준 문서는 [`known-issues.md`](known-issues.md)다.

## 11. 장기 로드맵과의 관계

Phase 1(성경 읽기 PWA)은 완성됐고, Phase 3(교회력)은 일부 구현됐다. 구현된 것은 엔진([ADR-037](decisions/037-eucharist-lectionary-data-and-engine.md)), 전례독서 화면 `/lectionary`, 캘린더 월간 표 `/calendar`([ADR-038](decisions/038-calendar-lectionary-ui.md))다. 남은 것은 [`topics/liturgical.md`](topics/liturgical.md)의 「남은 일」과 ADR-038에 있다. 각 단계는 **콘텐츠를 더하는 일에 가까운 확장**으로 설계되어 있다:

- **Phase 2 기도서**: 첫 기도서 본문(전례시편과 송가)은 `source/`가 아니라 `liturgical/psalter`와 `liturgical/canticles`의 마크다운, 그리고 별도 파서(`src/liturgical_psalter.py`. 계응 구조, 데이터 저장소 ADR-039)로 들어왔다. 두 책은 `division`이 `liturgical`이라 성서 목록의 구분 탭에 나오지 않고, 전례독서 화면이 읽는다. 남은 기도서 본문도 같은 길(별도 원료와 파서로 책 단위 JSON을 만든다)을 따를 수 있다.
- **Phase 3 교회력**: 날짜 계산(부활절 계산, 절기, 연중 주차)은 순수 함수지만, 그날이 어떤 전례일인지, 등급, 전례색, 독서, 본기도는 데이터 저장소의 표(`lectionary/`의 캘린더 묶음 다섯과 전례독서 묶음 다섯)를 읽어 정한다([ADR-036](decisions/036-liturgical-calendar-data-model.md)과 037). 라우트는 `/calendar`와 `/lectionary`다.
- **Phase 4 성무일과 자동 생성**: 교회력(Phase 3), 성경(Phase 1), 기도서(Phase 2)를 조합해 매일 페이지를 자동으로 만든다. `/lectionary/YYYY-MM-DD`가 이미 엔진, 성서, 기도서 본문(본기도와 전례시편)을 감사성찬례 하루치로 엮고 있어, 그 초기 형태다.

각 단계를 **독립적으로 추가할 수 있도록** 데이터 디렉터리, 라우트, 검색 인덱스를 책 단위로 나눠 둔 것이 핵심이다. 동기화 페이로드도 `settings`, `bookmarks`, `lastRead` 키별로 병합하므로 새 키를 더해도 안전하다.

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
| [007](decisions/007-launch-screen-optimization.md)           | iOS 기기 13종 스플래시                                                                                                                                                                                                                                    |
| [008](decisions/008-pwa-install-guide.md)                    | 플랫폼별 설치 안내 모달                                                                                                                                                                                                                                       |
| [009](decisions/009-history-api-routing.md)                  | History API SPA 라우팅                                                                                                                                                                                                                                        |
| [010](decisions/010-bookmark-feature.md)                     | 북마크 데이터 모델 + UI                                                                                                                                                                                                                                       |
| [011](decisions/011-bookmark-sync.md)                        | Google Drive 동기화 (Phase 2a-2j. PKCE 단일 경로, OAuth 검수 통과 2026-05-19)                                                                                                                                                                                                                             |
| [012](decisions/012-typescript-incremental-adoption.md)      | JSDoc + `tsc --noEmit` 점진 도입. `js/` 전체를 기본으로 검사하고(`checkJs`), 빼는 파일은 `// @ts-nocheck`로 밝히며, CI에서 필수 검사로 둔다                                                                                                                                                                |
| [013](decisions/013-client-js-unit-tests.md)                 | `node --test` + vm 하네스 유닛 테스트                                                                                                                                                                                                                         |
| [014](decisions/014-search-history.md)                       | 검색 이력(LRU, 로컬 전용)                                                                                                                                                                                                                                     |
| [015](decisions/015-storage-strategy.md)                     | 저장 장치를 용도별로 나눈다. localStorage, sessionStorage, IndexedDB, Cache API를 쓰고(쿠키 없음) 키에는 `bible-*` 접두어를 붙인다                                                                                                                                                                                                                        |
| [016](decisions/016-audio-cache-lru.md)                      | 오디오 캐시 LRU 제한                                                                                                                                                                                                                                          |
| [017](decisions/017-oauth-bff-proxy.md)                      | nginx BFF로 `client_secret` 격리                                                                                                                                                                                                                              |
| [018](decisions/018-app-modularization.md)                   | `js/app.js` 6,082줄을 283줄로 줄이고 9개 도메인 모듈로 분할                                                                                                                                                                                                               |
| [019](decisions/019-esm-module-system.md)                    | ESM 일괄 채택 (`<script type="module">`), 빌드 단계 0 유지                                                                                                                                                                                                    |
| [020](decisions/020-monorepo-split.md)                       | 모노레포 4분할(app, data, audio, server)                                                                                                                                                                                                                        |
| [021](decisions/021-pwa-versioning-content-hash.md)          | `SHELL_CACHE`는 `version.json`에서 만들고, DATA와 AUDIO는 콘텐츠 해시 매니페스트를 쓴다                                                                                                                                                                                            |
| [022](decisions/022-citations-and-annotations.md)            | 본문 인용(`<cite>`)과 주석(각주)의 표현, 토글 하나로 켜고 끄기                                                                                                                                                                                                    |
| [023](decisions/023-settings-toggle-switches.md)             | 설정 상위 4개 옵션을 OS별 네이티브 토글 스위치로                                                                                                                                                                                                                |
| [024](decisions/024-book-list-tabs-and-header-nav.md)        | 성서 목록 탭 통합과 읽기 헤더 내비게이션 재설계                                                                                                                                                                                                                     |
| [025](decisions/025-header-scroll-elevation.md)              | 읽기 헤더 스크롤 elevation 그림자                                                                                                                                                                                                                             |
| [027](decisions/027-source-dsl-and-parallel-passages.md)     | 원본 마크업 DSL의 위치 잡기와 단락 단위 `<parallel>` 요소 도입                                                                                                                                                                                             |
| [028](decisions/028-design-system.md)                        | 디자인 시스템. 토큰 단계(간격, 타이포, 반경, elevation, 컨트롤, 모션)와 HIG 정렬(기준 문서 `DESIGN.md`)                                                                                                                                                         |
| [029](decisions/029-mobile-tab-bar.md)                       | 적응형 내비게이션 Phase 1. 모바일 하단 탭 바(전체 화면 라우트 뷰, iOS 2026 Liquid Glass). 첫 결정의 4탭(홈, 검색, 북마크, 설정) 가운데 검색은 ADR-030에서 따로 떨어진 원형 단추가 되었고, 캘린더 탭은 ADR-038에서 더해졌다                                                                                                                                                   |
| [030](decisions/030-morphing-tab-bar.md)                     | 모핑 탭 바. 라벨 없는 아이콘과 분리된 검색 원형이 입력창으로 모핑한다(ADR-029 개정). 옛 검색 시트를 제거했고, 스크롤 축소와 오디오 미니를 더했다(P3 완료)                                                                                                                                    |
| [031](decisions/031-tab-history-restore.md)                  | 탭 히스토리. 탭별로 마지막 라우트와 스크롤을 복원한다(홈은 읽던 위치, 검색은 마지막 검색). `scrollRestoration:"manual"`과 `route()` 시퀀스 검사를 쓰고, 다시 그린 뒤의 포커스는 라우터가 맡는다(2026-10-17)                                                                                                                              |
| [032](decisions/032-component-view-layer.md)                 | 컴포넌트와 뷰 층 모듈화. `el()` 위에 의존성 없는 컴포넌트 층(`createOverlay` 컨트롤러 하나, 시트 팩토리, 비동기 `closeTransition`, `emptyState` 빌더)을 두고 오버레이 12곳과 빈 상태를 통일하며 점진적으로 교체 (구현 완료)                                                      |
| [033](decisions/033-search-options.md)                       | 검색 옵션. 책 선택기(필터 시트), 결과 안에서 다시 검색(AND), 진입할 때 최근 검색 목록(개별 삭제와 전체 삭제), URL에 인코딩하는 필터 상태, 노트 검색 범위 확장 대비 (구현 완료)                                                                                                         |
| [034](decisions/034-views-routing-second-split.md)           | 뷰, 라우팅, 북마크 2차 분할. 관심사별로 모듈을 나누고, 순환하지 않는 파사드는 명시적 `import`로 바꾸고, 순환하는 dispatch는 등록부(registry)로 의존을 역전한다 (ADR-018 후속. `views-routing.js` 2,389줄은 audio-player, data-fetch, tabbar, routing, overlay로 나뉘어 없어졌고, `bookmark.js`는 3,578줄에서 589줄이 되었다. PR5c의 registerView 역전만 보류)                                                                                                             |
| [035](decisions/035-bookmark-reading-view.md)                | 북마크 모아 읽기. 폴더 단위 연속 읽기 화면(`/read/<id>`, 홈 탭 분류), 폴더 행의 `읽기`(auto_stories) 단추로 진입, 인접한 연속 본문 병합, 중첩 폴더는 소제목. `renderChapter`의 절 루프를 `appendVerses`로 추출(전례독서 페이지의 기반 기술) (구현 완료 — 모바일, 2026-06-09)                     |
| [036](decisions/036-liturgical-calendar-data-model.md)       | 교회력(전례력) 데이터 모델. 본기도 평면 배열(자기 전례일 키), explode와 병합 규칙, 영어 값과 `_vocab`, 이동 축일과 월별 축일(sanctoral)을 가르는 `kind`, 우선순위 8단계(2차), 전례색 4색, computus 기준, 맺음구 분리 (데이터 구현 완료 2026-07-27 · 앱 엔진 B1 2026-10-11)                                                                               |
| [037](decisions/037-eucharist-lectionary-data-and-engine.md) | 감사성찬례 전례독서 데이터와 엔진. `eucharist-readings.json` 전례일 키 스키마(refs=장 경계, verseSpec 재사용, 대안 세트 explode), 전례시편 별도 책 `lps`(계응 DSL, 숨김), 연중 주간 구간표, KASI 음력, `liturgical-engine.js`(computus, 후보 전례일 보존) **(A1-a 계산 계층 구현 2026-09-13 · A1-b 조회 계층 구현 2026-10-10 · B1 우선순위·지정 전례일·전례색·재일·옮김 계산 구현 2026-10-11 — 구현 완료)** |
| [038](decisions/038-calendar-lectionary-ui.md)               | 교회력 캘린더, 전례독서 뷰, 검색 이원화. 캘린더 탭(홈 옆, 월간, 주간, 목록 3뷰), `/lectionary/YYYY-MM-DD`(고른 전례일의 본기도만. 대체안 탭, 송영 상수, 계응 시편, 세트와 트랙 전환), 검색 상단 탭(성서 본문/전례독서) **(구현 중 — 렌더 기반 2026-07-27 · A3 독서 뷰 2026-10-12 · A2 캘린더 탭 1단계(탭 · 월간) 2026-10-15; A2 2단계(주간 · 목록) · A4 남음)** |
| [040](decisions/040-bookmark-import-items.md)                | 북마크 가져오기의 항목 검사. 어긋난 항목만 빼고 들이고, 뺀 개수는 병합이나 덮어쓰기 전에 알린다. 기준은 앱이 써 온 모양(ADR-010)이고, 멈출 때의 안내는 스낵바다 **(구현 완료 2026-10-18)** |

026은 main에 없다. 1.6.0 노트와 캘린더 설계는 개발을 멈춘 `release/1.6.0` 브랜치에만 있다. 데이터 저장소의 ADR(002, 003, 006, 039 전례시편 DSL)은 그 저장소의 `docs/decisions/`에 있다.

## 부록 B. 자주 보게 되는 파일 빠른 참조

- 부트스트랩과 서비스 워커 등록: `js/app.js`
- 라우팅(`parsePath`, `route`, `navigate`, `popstate`, 교회력 모듈을 그 화면에 처음 갈 때 `import()`로 불러오기): `js/app/routing.js`
- 본문 그리기, 화면 그리기 함수, 렌더 헬퍼, 캘린더와 전례독서의 머리와 실패 화면: `js/app/views.js`
- 데이터 가져오기(books, version, chapter, prologue와 캐시): `js/app/data-fetch.js`
- 교회력 계산, 조회, 우선순위, 옮김 (부활절 계산, 절기 구간, 연중 주차, 주기, 기간 축 / 프리로드, `resolveDate`, `findReadings`, `findCollects`, `findHalfVerse` / 지정 전례일, 재분류, 전례색, `fastOf` / 옮김 계산, 선택 봉헌): `js/app/liturgical-engine.js`
- 전례독서 뷰 (`/lectionary`. 전례일 칩, 본기도, 독서 네 슬롯, 영광송, 세트와 트랙, 두 독서 카드): `js/app/lectionary.js`
- 캘린더 탭 (`/calendar`. 월간 표, 칸 이름, 전례색 점, 전례년 표지, 링크 이름): `js/app/calendar.js`
- 오디오 플레이어 (장별 mp3 UI, 재생 상태, `#audio-bar`): `js/app/audio-player.js`
- 검색 UI, 결과 화면, 이력 패널: `js/app/search.js`
- 북마크 드로어와 헤더의 조정 모듈: `js/app/bookmark.js`
- 북마크 트리 그리기 (행 빌더, 다시 그리기 허브, 전체 화면): `js/app/bookmark-tree.js`
- 북마크 제스처 (드래그로 순서 바꾸기, 스와이프 액션): `js/app/bookmark-gestures.js`
- 북마크 선택 삭제 모드와 절 선택 모드: `js/app/bookmark-select.js`, `js/app/bookmark-verse-select.js`
- 북마크 모달 7종, 순수 로직, 절 스펙: `js/app/bookmark-modals.js`, `js/app/bookmark-core.js`, `js/app/verse-spec.js`
- 설정 화면 + 외관 적용: `js/app/settings-ui.js`
- 공통 DOM 헬퍼 + `emptyState` 빌더: `js/app/helpers.js`
- 오버레이 컨트롤러와 시트 팩토리 (모달, 드로어, 시트, 팝오버의 생명주기): `js/app/overlay.js`
- localStorage 영속화: `js/app/storage.js` (동기화 캐시, 북마크 정렬, 인용 안내 키는 각 모듈이 직접 쓴다. §5)
- 검색 워커 프로토콜: `js/search-worker.js:1` (헤더 주석)
- 상태 머신 진입점: `js/sync/state-machine.js`의 `dispatch()`, 끄는 길은 `_stopSync()`
- Drive 파사드 (PKCE 콜백, 로그아웃, 「파일도 삭제」, 다른 탭): `js/drive-sync.js`
- 업데이트 확인과 토스트: `js/app.js`, 셸 캐시 버전: `sw-version.js` (`scripts/release.py`가 갱신)
- 머지 알고리즘: `js/sync/store-v2.js`의 `mergeDocs()`
- SW 캐시 전략: `sw.js`의 `fetch` 리스너
- Drive REST 호출: `js/sync/transport.js` (모든 요청이 이 한 파일을 거친다)
- 도메인 타입: `js/types.d.ts`
