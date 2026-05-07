# 아키텍처 개요

이 문서는 공동번역성서 PWA의 전체 구조를 한눈에 보기 위한 지도다. 세부 결정의 근거는 `docs/decisions/`의 ADR을 참조하고, 코드 라인 단위 설명은 본문에 인라인으로 인용한 파일을 직접 읽기를 권한다.

> 이 문서는 **살아있는 설계 문서**다. 결정 그 자체가 아니라 결정들의 합쳐진 결과를 설명한다. 새로운 결정이 생기면 ADR을 먼저 작성하고, 그 결과로 본 문서가 달라지면 여기를 갱신한다.

## 1. 한 줄 요약

브라우저가 정적 JSON 파일을 직접 읽어 렌더링하는 **프레임워크 없는 SPA + Service Worker 오프라인 캐시**. 빌드 단계는 Python 스크립트로 마크다운 원본을 장별 JSON으로 전처리하는 일회성 작업뿐이고, 런타임에는 서버가 없다 — 정적 호스팅에 그대로 배포된다.

`bible.anglican.kr` 도메인 한 곳에 정적 파일을 올리면 그게 곧 배포다. Google Drive 동기화·OAuth만 외부 의존이며, 그것조차 클라이언트가 직접 Google 엔드포인트와 통신한다.

```
                  ┌────────────────────────────────────────────┐
                  │  빌드 (수동, 원본 텍스트 보유 환경에서만)     │
                  │                                            │
                  │   data/source/*.md  (비공개 서브모듈)        │
                  │            │                               │
                  │   src/parser.py → src/split_bible.py        │
                  │            │                               │
                  │   src/search_indexer.py                     │
                  │            ▼                               │
                  │   data/bible/*.json + data/search-*.json    │
                  └────────────────┬───────────────────────────┘
                                   │ git push
                                   ▼
                  ┌────────────────────────────────────────────┐
                  │  정적 호스팅 (bible.anglican.kr)             │
                  │                                            │
                  │   index.html  sw.js  manifest.webmanifest   │
                  │   js/  css/  assets/  data/                 │
                  └────────────────┬───────────────────────────┘
                                   │ HTTPS
                                   ▼
                  ┌────────────────────────────────────────────┐
                  │  브라우저 (PWA)                              │
                  │                                            │
                  │   ┌─ index.html (단일 진입점) ──────────┐    │
                  │   │  app.js (라우팅·렌더·UI)            │    │
                  │   │   ├─ search-worker.js  (Web Worker) │    │
                  │   │   └─ drive-sync.js + sync/*         │    │
                  │   └────────────────────────────────────┘    │
                  │                                            │
                  │   sw.js (오프라인 셸 + stale-while-          │
                  │          revalidate, 폰트·OAuth 예외)        │
                  │                                            │
                  │   localStorage  +  IndexedDB(refresh-store) │
                  └────────────────┬───────────────────────────┘
                                   │ HTTPS (OAuth/Drive only)
                                   ▼
                  Google: accounts.google.com / oauth2.googleapis.com
                          www.googleapis.com (Drive appdata)
```

## 2. 아키텍처를 결정한 4가지 제약

1. **저작권** — 원본 텍스트는 비공개 서브모듈(`data/source/`)이므로 빌드 산출물(`data/bible/*.json`)은 gitignore되어 있다. 파이프라인은 권한 있는 사용자만 실행한다.
2. **비상업·비영리** — 백엔드를 운영할 인력·예산이 없다. 모든 상태는 클라이언트 또는 사용자의 Google Drive(appdata)에 산다.
3. **오프라인 우선** — 교회·예배 환경의 불안정한 네트워크를 가정. PWA + Service Worker로 첫 방문 후 모든 본문이 로컬에 캐시된다.
4. **장기 유지보수성** — 1인 개발이 가능해야 한다. 프레임워크/번들러 부재, 의존성 최소, 테스트 자동화 — 이 셋이 핵심 가드다.

이 4개가 SPA·Vanilla JS·Python 일회성 전처리·Drive appdata·정적 호스팅이라는 선택을 거의 단일 결론으로 강제했다. 자세히는 [ADR-001](decisions/001-spa-architecture.md).

## 3. 빌드 타임 — 데이터 파이프라인

원본 마크다운(73권)을 1328장의 장별 JSON과 3개의 검색 인덱스로 변환한다. 빌드는 의도적으로 **일회성 스크립트의 합성**이고, 어떤 빌드 시스템(make/just/poetry)에도 묶지 않는다 — 각 스크립트가 결정적 입력→결정적 출력이라 의존 그래프가 단순하다.

```
data/source/{book_id}.md
        │
        ▼
src/parser.py             ← 마크다운을 segments(텍스트·연·운문·헤딩) 시퀀스로 파싱
        │  output/parsed_bible.json (전체 73권 단일 파일)
        ▼
src/split_bible.py        ← 장별로 분리, 시락 머리말 별도 추출
        │  data/bible/{book_id}-{chapter}.json   (1328개)
        │  data/bible/sir-prologue.json          (ADR-002)
        │  data/books.json                       (메타데이터)
        ▼
src/search_indexer.py     ← 절 단위 인덱스를 구약/신약/외경으로 분할
           data/search-meta.json   (~9 KB, 책 별칭)
           data/search-ot.json     (~3.8 MB)
           data/search-nt.json     (~1.3 MB)
           data/search-dc.json     (~700 KB)
```

설계 포인트:

- **물리적 장 순서**: 시락 머리말, 다니엘 추가본 등 본래 장 번호가 어그러지는 부분은 "원전이 있는 그대로의 물리 순서"를 따른다 ([ADR-003](decisions/003-physical-chapter-ordering.md)).
- **검색 인덱스 분할 (구약/신약/외경)**: 5.8 MB 단일 파일을 3개로 쪼개 첫 검색 응답 속도를 우선 ([ADR-005](decisions/005-search-indexing-strategy.md)). 워커가 청크 단위로 로드하면서 partial-results를 흘려 보낸다.
- **운문 본문 포맷**: `_` (이탤릭), 연/장 구분은 `segments` 시퀀스로 표현 ([ADR-006](decisions/006-poetry-source-format.md)).

자세한 실행 명령은 [README §데이터 파이프라인 실행](../README.md#데이터-파이프라인-실행).

## 4. 런타임 — 클라이언트 모듈 지도

런타임은 정확히 6개의 자바스크립트 파일에 분산되어 있다. 모든 모듈은 `<script defer>`로 순서 보장 로드되고, 모듈 시스템(import/export) 대신 `window.*` 네임스페이스를 명시적으로 사용한다 — 빌드 단계 0개를 유지하기 위함이다.

| 파일 | 역할 | 라인 수 (개략) |
|------|-----|--------------|
| `js/pre-fetch.js` | 첫 페인트 직전 `data/books.json` 비동기 선패치 | ~5 |
| `js/gtag-init.js` | Google Analytics 초기화 | ~5 |
| `js/app.js` | 라우팅, 렌더링, 검색 UI, 오디오, 북마크, 설정, 모달 — UI 전체 | ~5,300 |
| `js/search-worker.js` | Web Worker. 청크 로딩 + 절 검색 + 페이지네이션 | ~370 |
| `js/drive-sync.js` | Drive 동기화 파사드(코디네이터) | ~220 |
| `js/sync/*` | 동기화 상태 머신·전송·저장·리프레시 토큰·디버그 로그 | ~1,900 |

`index.html`은 `<script>` 태그 6개를 `defer`로 직렬 로드한다 (`drive-sync.js`가 마지막). 의존 순서는 `js/drive-sync.js` 상단 주석에 한 곳에 명시되어 있다.

### 4.1 라우팅 (History API SPA)

`app.js`가 `pushState`/`popstate` 기반으로 라우팅하고, `sw.js`는 모든 navigation 요청을 `/index.html`로 폴백한다. 단, `/privacy.html` 같은 stand-alone 페이지는 그대로 통과시킨다 ([ADR-009](decisions/009-history-api-routing.md), `sw.js:113`).

라우트:

| 경로 | 화면 |
|------|------|
| `/` | 홈 (전체 책 목록) |
| `/{book_id}/{chapter}` 또는 `/{book_id}/{chapter}/{verse}` | 본문 |
| `/검색` (해시·쿼리) | 검색 결과 시트 |

로컬 개발 서버(`scripts/serve.py`)는 동일한 폴백을 흉내내어 강제 새로고침이 깨지지 않도록 한다. **`python -m http.server`는 사용 금지** — `/gen/1` 같은 라우트를 404로 반환한다.

### 4.2 검색 (Web Worker + 청크 인덱스)

`app.js`는 메인 스레드에서 검색 UI/결과 시트만 다루고, 실제 텍스트 검색은 `js/search-worker.js`가 전담한다.

```
사용자 입력  →  app.js  ──postMessage──▶  search-worker.js
                                       │
                                       ├─ data/search-meta.json (lazy fetch)
                                       ├─ data/search-ot.json   (lazy fetch)
                                       ├─ data/search-nt.json
                                       └─ data/search-dc.json
                                       │
            partial-results / results  ◀──── 청크 1개 로드 끝날 때마다 흘려 보냄
```

워커 프로토콜은 `search-worker.js:1` 상단 주석에 정의됐다. `searchId` 카운터로 stale 결과를 무시하고, `Uint16Array`로 책·장·절을 RLE 인코딩해 메모리를 줄였다. 별칭(요한/요/요한복음 등)·책 범위 한정자(`in:신약`)는 `data/search-meta.json`이 갖고 있다 ([ADR-005](decisions/005-search-indexing-strategy.md)).

### 4.3 동기화 (Drive appdata + PKCE)

가장 복잡한 서브시스템. 5개 파일이 명확히 책임을 나눈다:

```
                       ┌─────────────────────────────────────────────┐
                       │  app.js  (UI: 설정 화면, "연결" 버튼, 토스트) │
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

- **PKCE 단일 경로**. 데스크탑·Android·iOS가 같은 흐름. 콜드 스타트 시 IDB의 refresh token으로 백그라운드 `/token` 갱신, 없으면 `NEEDS_CONSENT`. ([ADR-011](decisions/011-bookmark-sync.md), `docs/design/pkce-migration.md`)
- **상태 머신의 모든 변이는 `_transition()` 한 곳을 거친다.** 컨텍스트(`{netFails, conflictFails, reAuthFails, backoffTimer}`)도 같이 리셋된다. carry-forward는 명시적 patch로만 가능 (`state-machine.js:91`).
- **Race 가드 3중**: `_state` 검사 + `localStorage["bible-drive-sync"]` 플래그 검사 + 모든 `await` 직후 재검사. 사용자가 silent refresh / code 교환 도중 disconnect 했을 때 의도가 보존된다.
- **카운터 캡**: `MAX_REAUTH=3` (만성 401), `MAX_CONFLICTS=3` (412 ETag), `MAX_NET_RETRIES=5` (1·2·4·8·16s 백오프), `MAX_REDIRECT_ATTEMPTS=3` (무한 리디렉션 방어).
- **머지 정책**: per-record `_u` (mtime, ms) + 툼스톤. last-write-wins per record, 절대 last-write-wins per file 아님 — 서로 다른 기기에서 다른 북마크를 추가해도 둘 다 보존.

진입·복귀 시나리오는 [README §Google Drive 동기화](../README.md#google-drive-동기화-북마크설정읽기-위치) 표 참조.

### 4.4 오프라인 — Service Worker 캐시 전략

`sw.js`는 3가지 전략을 호스트네임/요청 모드별로 분기한다 (`sw.js:101`):

| 대상 | 전략 | 이유 |
|------|------|------|
| `fonts.gstatic.com` | cache-first, **별도 `FONT_CACHE`**, CACHE_NAME bump 시에도 보존 | 폰트는 immutable + content-addressed |
| OAuth/Drive 4개 호스트 | **항상 네트워크**, SW 우회 | 캐싱 시 토큰·동기화 데이터가 깨진다 |
| navigation (HTML) | `/index.html` 폴백 (단, `/privacy.html`은 통과) | SPA 라우팅 |
| 그 외 (JS/CSS/JSON/이미지) | cache-first, 누락 시 `cache: "reload"`로 fetch 후 캐시 | HTTP 캐시가 SW 캐시를 오염시키지 않게 |

`CACHE_NAME` (예: `rev-49`)은 `scripts/release.py`가 `version.json`과 함께 동시에 bump한다. 새 SW가 activate되면 이전 캐시가 모두 비워지므로 본문/검색 데이터 갱신이 클라이언트에 도달한다. 사용자 동의 없이 `skipWaiting()`은 호출하지 않는다 — 클라이언트가 `SKIP_WAITING` 메시지를 보내야 새 SW가 즉시 활성화된다.

## 5. 영속 데이터 — 어디에 무엇이 저장되는가

| 위치 | 키/파일 | 내용 | 동기화? |
|------|---------|------|---------|
| `localStorage` | `bible-bookmarks-v2` | 북마크/폴더 (flat-map + 툼스톤) | ✅ |
| `localStorage` | `bible-font-size`, `bible-theme`, `bible-color-scheme`, `bible-book-order`, `bible-startup` | 설정 5종 | ✅ |
| `localStorage` | `bible-last-read` | 마지막 읽기 위치 (이어읽기 배너) | ✅ |
| `localStorage` | `bible-sync-meta` | `{schemaVersion, deviceId}` | (메타) |
| `localStorage` | `bible-drive-sync` | sync enabled 플래그 ("0"/"1") | (메타) |
| `localStorage` | `bible-drive-sync-email`, `bible-drive-sync-updated` | 마지막 인증 이메일·시각 | (메타) |
| `localStorage` | `bible-drive-redirect-attempts` | 무한 리디렉션 카운터 (cap 3) | (메타) |
| `localStorage` | `bible-audio-pos` | 오디오 재생 위치 | 로컬 전용 |
| `sessionStorage` | `bible-drive-redirect-state-pkce` | PKCE state nonce + verifier (10분 TTL) | 임시 |
| `IndexedDB` | `refreshStore` | AES-GCM 암호화 refresh token (key는 비추출) | 로컬 전용 |
| Cache Storage | `rev-XX` (CACHE_NAME) | 앱 셸 + 데이터 JSON | (배포물) |
| Cache Storage | `fonts-v1` | Google Font 파일 | (영구) |
| Google Drive (`appdata`) | `bookmarks-v2.json` | 동기화 페이로드 (북마크+설정+이어읽기) + ETag | ☁️ 원격 |

동기화 대상이 아닌 항목(오디오 위치, 디바이스 ID, 캐시 등)은 의도적으로 기기 로컬에 머문다. 동기화 페이로드 스키마는 `js/types.d.ts`의 `SyncDoc` 타입과 `js/sync/store-v2.js:1` 헤더 주석에서 정의된다.

## 6. 정적 타입 검사 — `// @ts-check` + JSDoc

빌드 산출물 0개를 유지하면서도 타입 안전성을 얻기 위해 **TypeScript를 컴파일러로만 사용**한다 ([ADR-012](decisions/012-typescript-incremental-adoption.md)).

- 모든 sync 모듈은 파일 상단에 `// @ts-check`.
- 도메인 타입은 `js/types.d.ts` 한 곳에서 export.
- 다른 파일은 `@typedef {import("../types").Foo} Foo`로 가져온다.
- `tsconfig.json` (DOM lib) + `tsconfig.worker.json` (WebWorker lib) 두 개 분리.

검증:
```bash
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
```

`js/app.js`는 다음 사이클에 `// @ts-check`를 적용 예정이다.

## 7. 테스트 — 3계층 + 유닛

테스트는 비용/실행 빈도/원본 텍스트 의존성에 따라 4종으로 분리되어 있다.

| 종류 | 위치 | 원본 필요? | CI? | 무엇을 보호하는가 |
|------|------|-----------|-----|------------------|
| **클라이언트 JS 유닛** ([ADR-013](decisions/013-client-js-unit-tests.md)) | `tests/unit/*.test.js` | ❌ | ✅ | 상태 머신·refresh-store·PKCE primitives 회귀 |
| **Level 1 완전성** ([ADR-004](decisions/004-data-pipeline-test-strategy.md)) | `tests/test_completeness.py` | ❌ | ✅ | 1328개 장 파일·구조 누락 |
| **Level 2 절 순서** | `tests/test_ordering.py` | ❌ (`fixtures/verse_sequence.json` 사용) | ✅ | 파이프라인 변경 시 절 순서 회귀 |
| **Level 3 스냅샷** | `tests/test_snapshots.py` | ❌ | ✅ | cross-chapter 재배치 등 특수 케이스 |
| **E2E (Playwright)** | `tests/e2e/*.py` | ✅ (서버 + 본문) | ❌ (로컬) | 검색 UI, 라우팅, 클립보드, 설치 안내, 동기화 등 회귀 |

유닛 테스트는 `node --test`만으로 돌고, `tests/unit/harness.js`가 자체 vm 컨텍스트를 생성해 글로벌 상태 누수를 막는다 — 의존성 0. CI는 `.github/workflows/test.yml`에서 Node 24로 자동 실행된다.

E2E는 의도적으로 CI에서 제외 — 본문 텍스트가 있는 환경에서만 의미가 있고, 시각 회귀는 사람이 봐야 가장 정확하다.

## 8. 빌드·배포·릴리스

배포는 `bible.anglican.kr`에 정적 파일을 그대로 올리는 방식이다.

```bash
# 1. 버전 bump (version.json + sw.js CACHE_NAME 동시 갱신)
python scripts/release.py minor   # 또는 major / patch

# 2. 배포 zip 생성 (스테이징/CDN 업로드용)
bash scripts/build-deploy.sh
```

`release.py`는 `version.json`의 `version`과 `sw.js`의 `CACHE_NAME` 값을 한 트랜잭션처럼 함께 올린다 — 둘이 어긋나면 SW가 새 셸을 가져오지 못한다. 빌드 zip은 git ignore된 산출물(`data/bible/*.json`, `data/search-*.json`)을 포함해 호스트에 그대로 풀 수 있는 형태다.

업데이트 토스트 흐름:
1. 활성 SW가 정기 업데이트 체크 → 새 SW가 install 단계.
2. `app.js`가 `GET_VERSION` 메시지로 새 SW의 `version.json`을 조회 → 토스트 노출.
3. 사용자가 "업데이트" 클릭 → `SKIP_WAITING` → 새 SW activate → 페이지 reload.

자동 skipWaiting을 하지 않는 이유: 사용자가 본문을 읽고 있을 때 갑작스러운 reload가 일어나면 안 된다.

## 9. 보안 모델

OAuth 측면 (가장 큰 공격 표면):

- **CSP**: `script-src 'self'` + 명시적 sha256 해시. `accounts.google.com`은 더 이상 connect-src에 없다 (PKCE는 풀페이지 리디렉션이라 프레임 로드 불요).
- **SW 우회**: OAuth/Drive 4개 호스트는 SW가 절대 캐싱하지 않음.
- **PKCE state nonce**: 10분 TTL. 검증 실패 시 콜백 URL을 즉시 `replaceState`로 덮어 어떤 라우터·로거도 보지 못하게 한다.
- **Refresh token**: webcrypto AES-GCM 암호화 + 비추출 키(`extractable: false`). 평문은 한 번도 IDB에 닿지 않는다.
- **디버그 로그 마스킹**: `sync/debug-log.js`의 `mask()`가 토큰·이메일·fileId를 머리·꼬리만 남기고 `…`로 가린다.

마지막 보안 감사: [`docs/audit/2026-05-07-pkce-refresh-token.md`](audit/2026-05-07-pkce-refresh-token.md) — Critical/High/Medium 0건.

## 10. 알려진 한계와 의도적 비결정

- **iOS Safari 탭 7일 ITP**: 홈 화면 설치하지 않고 Safari 탭에서 사용하면 7일 미사용 시 storage가 비워진다. 대응: 설치 안내 모달 강화([ADR-008](decisions/008-pwa-install-guide.md)). PWA(HSWA)는 영향 없음.
- **OAuth 검수 진행 중**: refresh token TTL 7일 (Google Testing 상태). 검수 통과 시 영구로 자동 전환 — 코드 변경 0.
- **iOS Chrome/Firefox**: WebKit 래퍼라 설치 불가 + 동기화 컨텍스트 격리 미보장. "Safari에서 열기" 안내로 끝.
- **백엔드 부재**: 사용자별 통계, 다중 기기 푸시, 서버사이드 검색 등은 모두 불가. 의도적 트레이드오프 — 운영비 0이 더 중요하다.
- **번역본 1종**: 공동번역만 다룬다. 다국역 비교는 로드맵 밖.

## 11. 장기 로드맵과의 관계

현재(Phase 1)는 성경 읽기 PWA로 완성된 상태다. 다음 단계는 **컨텐츠 추가에 가까운 확장**으로 설계되어 있다:

- Phase 2 — **기도서**: `data/source/` 옆에 또 다른 마크다운 트리. 같은 파이프라인 재사용 가능. UI는 책 목록에 새 카테고리 추가 수준.
- Phase 3 — **교회력 계산기**: 순수 함수. 데이터 의존 없음. `app.js`에 별도 라우트.
- Phase 4 — **성무일과 자동 생성**: 교회력(Phase 3) + 성경(Phase 1) + 기도서(Phase 2) 조합 → 매일 자동 페이지 생성.

각 단계가 **독립적으로 추가 가능**하도록 데이터 디렉토리·라우트·검색 인덱스를 책 단위로 분리해 둔 것이 핵심이다. 동기화 페이로드도 `settings`/`bookmarks`/`lastRead` 키별로 머지하므로 새 키 추가가 안전하다.

---

## 부록 A. ADR 인덱스 (한 줄 요약)

| ADR | 결정 |
|-----|-----|
| [001](decisions/001-spa-architecture.md) | Vanilla JS SPA + Python 일회성 전처리 |
| [002](decisions/002-sirach-prologue-handling.md) | 시락 머리말은 별도 JSON으로 추출 |
| [003](decisions/003-physical-chapter-ordering.md) | 원전의 물리적 장 순서를 따름 |
| [004](decisions/004-data-pipeline-test-strategy.md) | Level 1-3 데이터 검증 전략 |
| [005](decisions/005-search-indexing-strategy.md) | 검색 인덱스 구약/신약/외경 청크 분할 |
| [006](decisions/006-poetry-source-format.md) | 운문 본문 segments 표현 |
| [007](decisions/007-launch-screen-optimization.md) | iOS 13종 디바이스 스플래시 |
| [008](decisions/008-pwa-install-guide.md) | 플랫폼별 설치 안내 모달 |
| [009](decisions/009-history-api-routing.md) | History API SPA 라우팅 |
| [010](decisions/010-bookmark-feature.md) | 북마크 데이터 모델 + UI |
| [011](decisions/011-bookmark-sync.md) | Google Drive 동기화 (Phase 2a~2h) |
| [012](decisions/012-typescript-incremental-adoption.md) | `// @ts-check` + JSDoc 점진 도입 |
| [013](decisions/013-client-js-unit-tests.md) | `node --test` + vm 하네스 유닛 테스트 |

## 부록 B. 자주 보게 되는 파일 빠른 참조

- 라우팅 진입점: `js/app.js` (route 디스패처는 상단부)
- 검색 워커 프로토콜: `js/search-worker.js:1` (헤더 주석)
- 상태 머신 진입점: `js/sync/state-machine.js`의 `dispatch()`
- 머지 알고리즘: `js/sync/store-v2.js`의 `mergeDocs()`
- SW 캐시 전략: `sw.js:101`의 `fetch` 리스너
- Drive REST 호출: `js/sync/transport.js` (모든 fetch가 여기 한 파일)
- 도메인 타입: `js/types.d.ts`
