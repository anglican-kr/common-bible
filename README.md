# 공동번역성서 PWA

대한성공회를 위한 공동번역성서 프로그레시브 웹 앱(PWA).
장기적으로 기도서, 교회력, 성무일과까지 통합하는 전례 앱으로 넓힐 예정이다.

배포 URL: https://bible.anglican.kr

> 실제 공동번역성서 개정판의 저작권은 대한성서공회에 있으며, 이 프로젝트는 비상업적 용도로만 사용됩니다. 성경 원본 텍스트와 음원은 비공개 서브모듈로 관리되며, 접근 권한이 있는 사용자만 이용할 수 있습니다.

## 아키텍처

Python 스크립트가 마크다운 원본을 JSON으로 미리 변환하고, 브라우저가 JSON을 직접 읽어 화면에 그리는 SPA 방식이다.

```
source/*.md  (data 저장소 안, 73권 마크다운)
  → parser.py → output/parsed_bible.json
  → split_bible.py → bible/{book_id}-{chapter}.json (1328) + books.json
  → search_indexer.py → search-{meta,ot,nt,dc}.json
liturgical/  (data 저장소 안 — 전례시편 · 송가 기준, 교회력 표, 전례독서 원료)
  → liturgical_psalter.py → bible/lps-{n}.json (150) · cant-{n}.json (13) + books.json에 2권 추가 (→ 75권)
  → liturgical/parse_*.py · normalize.py → lectionary/*.json (교회력 · 전례독서 · 본기도)
```

본문 데이터와 Python 파이프라인은 `common-bible-data` 비공개 저장소(`data/` 서브모듈)에 있고, 오디오는 `common-bible-audio` LFS 저장소(`data/audio/` 중첩 서브모듈)에 있다.

## 저장소 토폴로지 (ADR-020)

| 저장소 | 가시성 | 역할 |
|---|---|---|
| `anglican-kr/common-bible` (본 저장소) | 공개 | PWA 프론트엔드, sw.js, JS 유닛과 e2e, 릴리스 스크립트 |
| `anglican-kr/common-bible-data` | 비공개 | 마크다운 원본, Python 파이프라인, 빌드 출력, 데이터 검증 테스트 |
| `anglican-kr/common-bible-audio` | 비공개 (LFS) | 장별 mp3 |
| `anglican-kr/common-bible-server` | 비공개 | nginx 설정(BFF와 보안 헤더), 배포 스크립트 |

clone할 때 중첩 서브모듈까지 함께 받는다:

```bash
git clone --recurse-submodules git@github.com:anglican-kr/common-bible.git
# 또는
git submodule update --init --recursive
```

## git 서브모듈 운영

본 저장소는 서브모듈이 두 단계로 중첩된다(앱, data, audio 순). 일상 작업에서 자주 쓰는 명령어를 모았다.

### data 변경 반영 (마크다운, 파이프라인, 빌드 산출물)

```bash
# 1. common-bible-data 저장소에서 작업 후 push
cd data
# ... 마크다운 수정 → 파이프라인 재실행 → 산출물 ...
git commit -am "data: ..."
git push

# 2. 앱 저장소에서 서브모듈 포인터 bump
cd ..
git submodule update --remote data
git commit -am "data: 서브모듈 포인터 bump"
git push
```

### audio 변경 반영 (이중 hop)

audio는 data 안에 중첩된 서브모듈이라, audio에서 data로, data에서 앱으로 두 번 포인터를 올려야 한다.

```bash
# 1. common-bible-audio에 새 mp3 push (LFS)
cd data/audio
# ... mp3 추가/교체 ...
git commit -am "..."
git push

# 2. data 저장소에서 audio 서브모듈 포인터 bump
cd ..
git submodule update --remote audio
git commit -am "chore: audio 서브모듈 포인터 bump"
git push

# 3. 앱 저장소에서 data 서브모듈 포인터 bump
cd ..
git submodule update --remote data
git commit -am "data: 서브모듈 포인터 bump (audio 갱신)"
git push
```

### 브랜치 switch 시 서브모듈 충돌 해소

분할(ADR-020) 이전 브랜치(`data/`가 일반 디렉토리이고 그 안의 파일을 추적한다)와 이후 브랜치(`data/`가 서브모듈이다) 사이에서 `git switch`를 하면 `untracked working tree files would be overwritten` 오류가 난다. 작업 트리의 같은 경로가 서브모듈 안의 파일이면서 부모 저장소가 추적하는 파일이기 때문이다.

```bash
# 권장: 옛 브랜치를 분할 후로 fast-forward (working tree 안 건드림)
git fetch origin
git update-ref refs/heads/<branch> origin/<branch>
git switch <branch>

# 대안: 서브모듈 통째 비우고 switch (audio 6.3 GB 재 pull 비용)
git submodule deinit -f data
rm -rf data
git switch <branch>
git submodule update --init --recursive
```

### 작업 디렉토리 구분

`cd data`를 하면 git이 다루는 저장소가 data 서브모듈로 바뀐다. 앱 저장소의 커밋과 헷갈리지 않도록 작업 뒤 `git status`로 어느 저장소에서 작업 중인지 확인한다. 부모 저장소(앱 저장소)에서는 서브모듈 포인터(SHA) 말고는 서브모듈 안의 파일을 직접 `git add`할 수 없다.

## 기술 스택

- Frontend: HTML, CSS, Vanilla JavaScript (프레임워크 없음)
- Data: 장별로 나눈 JSON(OSIS 소문자 book_id). data 서브모듈이 제공한다.
- Audio: mp3(Git LFS). audio 중첩 서브모듈이 제공한다.
- Offline: Service Worker

## 플랫폼별 동작 차이

앱 설치는 웹 표준이 플랫폼마다 다르게 구현되어 있어 코드 분기가 필요하다. 다른 모든 기능(읽기, 검색, 북마크, 오디오, 동기화)은 플랫폼과 상관없이 같은 코드 경로로 동작한다.

### 앱 설치 (홈 화면 추가)

| 플랫폼 | 설치 방식 | 비고 |
|--------|----------|------|
| Android Chrome / Edge / Samsung Internet | `beforeinstallprompt`를 자동으로 가로채 두었다가 "설치" 단추를 누르면 네이티브 프롬프트를 띄운다 | 1-탭 설치 |
| Desktop Chrome / Edge | 동일 (`beforeinstallprompt`) | macOS Safari와 Firefox는 지원하지 않음 |
| **iOS Safari** | 수동 3단계 안내 모달(공유를 누르고 홈 화면에 추가) | `beforeinstallprompt`를 지원하지 않음(WebKit 정책) |
| iOS Chrome / Firefox / Edge | iOS 17 이상은 공유 메뉴의 「홈 화면에 추가」 안내, iOS 16 이하는 "Safari에서 열어 설치" 안내 | iOS의 모든 브라우저는 WebKit 래퍼이고, iOS 17부터는 다른 브라우저도 홈 화면에 추가할 수 있다(ADR-008 개정 2026-05-11) |

자세한 안내 화면 설계는 [ADR-008](docs/decisions/008-pwa-install-guide.md), iOS 디바이스별 스플래시(13종 `apple-touch-startup-image`)는 [ADR-007](docs/decisions/007-launch-screen-optimization.md) 참고.

### iOS 고유 제약

- **iOS Safari 탭 사용 시 7일 ITP**: 홈 화면에 설치하지 않고 Safari 탭에서 직접 여는 경우, 7일 동안 쓰지 않으면 ITP가 저장 공간(쿠키, localStorage, IndexedDB 포함)을 정리한다. 그러면 모든 로컬 상태(북마크, 설정, 동기화 인증)를 다시 만들어야 한다. **홈 화면에 설치한 PWA(iOS 17 이상의 HSWA)는 저장 공간이 계속 남아 ITP 대상이 아니다.** 자세한 내용은 ADR-011 §맥락에 있다.
- **iOS Chrome / Firefox / Edge (WebKit 래퍼)**: iOS 17 이상은 공유 메뉴로 홈 화면에 추가할 수 있고, iOS 16 이하는 설치할 수 없어 "Safari에서 열기" 안내로 끝난다. Drive 동기화에서 PWA 격리 컨텍스트를 보장하지 않는다.

## Google Drive 동기화 (북마크, 설정, 읽기 위치)

데스크톱, Android, iOS가 모두 OAuth 2.0 Authorization Code, PKCE, refresh token을 쓰는 하나의 경로로 동기화한다([ADR-011 Phase 2h](docs/decisions/011-bookmark-sync.md), [`docs/archive/design/pkce-migration.md`](docs/archive/design/pkce-migration.md)). Phase 2h 이전에 있던 GIS Token Client, Implicit Flow, FedCM 분기는 모두 제거했다. Google OAuth 앱 검수는 2026-05-19에 통과해(「In production」) refresh token에 만료 기간이 없다.

| 시나리오 | 동작 |
|---------|-----|
| 첫 연결 ("연결" 클릭) | `accounts.google.com`으로 페이지 전체를 리디렉션하고, 동의 화면(consent)을 거쳐 `?code=…`가 붙은 callback으로 돌아온다. 같은 origin의 `/oauth/token`에 POST해 access token과 refresh token을 받으면 IDLE이 된다 |
| 앱 재실행 (refresh token 보유) | IndexedDB에 AES-GCM으로 암호화해 둔 refresh token으로 백그라운드에서 `/oauth/token`에 POST해 access token을 갱신하고 IDLE이 된다. 화면 변화가 없고 팝업, 리디렉션, 깜박임도 없다. |
| 앱 재실행 (refresh token 없음) | NEEDS_CONSENT 상태가 되고, 설정 화면에 "연결" 단추가 보인다 |
| 탭 활성화 | `visibilitychange` 이벤트로 `pollSync()`를 한 번 호출해 다른 기기의 변경분을 새로고침 없이 자동으로 가져온다. 사이클이 끝난 지 15초 안이면 건너뛰고, 도는 중이면 버린다. OFFLINE이고 기기가 온라인이면 다시 시도한다 |
| 401 (access token 만료) | refresh token으로 백그라운드에서 갱신하고 동기화를 다시 시작한다. refresh token도 유효하지 않으면 NEEDS_CONSENT로 폴백한다 |
| `signOut()` | Google `/revoke`를 호출하고, IDB를 비우고, localStorage의 email과 state를 정리한다 |
| 동기화 도중 로그아웃 | 진행 중이던 사이클은 다음 대기에서 멈춘다. 로그아웃 뒤에는 Drive로 요청을 보내지 않고, 원격 자료를 로컬에 쓰지 않으며, 비운 캐시를 다시 채우지 않는다 |
| 요청 실패 (네트워크, 403, 429, 5xx 등. 401은 제외) | 지수 백오프(1, 2, 4, 8, 16초)로 다섯 번까지 다시 시도한다. 그래도 실패하면 네트워크 실패는 OFFLINE이 되고(`online` 이벤트나 다음 요청이 다시 시도한다), 그 밖의 실패는 IDLE이 된다(다음 요청이 다시 시도한다). 실패한 응답을 「파일 없음」이나 「원격 없음」으로 읽지 않는다 |
| 연결 해제 때 「파일도 삭제」를 누르면 | 자격 증명(IDB의 refresh token과 계정 키)을 먼저 지우고, 진행 중인 사이클을 10초까지 기다린 뒤 appDataFolder의 `sync.json`을 모두 지운다(만료된 토큰이면 한 번 갱신한다). 지우지 못하면 스낵바로 알리고, 다시 연결할 때까지 설정에 안내를 남긴다 |
| 다른 탭에서 로그아웃 | 공유 켬 표지(`bible-drive-sync`)가 "0"이 되면(`storage` 이벤트) 이 탭도 멈춘다 |

**OAuth /token BFF**: `/oauth/token`은 nginx가 같은 origin에서 받은 요청에 서버 쪽에서 `client_secret`을 넣은 뒤 `oauth2.googleapis.com/token`으로 전달한다. Google "Web application" 클라이언트 유형은 RFC 7636에서 벗어나 PKCE에서도 secret을 요구하고, GitHub secret scanner가 secret을 자동으로 무효화할 위험도 있다. 이 두 문제를 피하려는 것이다 ([ADR-017](docs/decisions/017-oauth-bff-proxy.md), `common-bible-server/nginx/oauth-proxy.example.conf`).

운영 안전장치:
- **무한 리디렉션 상한**: localStorage 카운터가 상한(3회)을 넘으면 ERROR 상태로 강제로 넘어간다. SYNC_DONE에서만 0으로 되돌린다.
- **반복되는 401의 상한(`MAX_REAUTH=3`)**: 새 access token도 Drive가 거절하면 네 번째 401에서 ERROR 상태가 되고 스낵바로 알린다.
- **경쟁 상태 검사**: 상태 기준 검사, `localStorage["bible-drive-sync"]` 표지 기준 검사, 비동기 `await` 직후마다 다시 하는 검사를 함께 쓴다. 사용자가 조용한 refresh, code 교환, 동기화 사이클 중에 연결을 해제해도 그 의도를 지킨다.
- **사이클 도중의 편집 보존**: 병합 직전에 로컬을 다시 읽고(기다리는 동안 저장한 북마크와 설정을 덮지 않는다), 도는 동안 들어온 사용자 요청은 끝난 뒤 한 번 더 돈다.

### 알려진 한계

- **외부 권한 회수**: 사용자가 Google 계정 설정에서 권한을 끊으면 다음 조용한 refresh가 `invalid_grant`로 실패하고, IDB를 비운 뒤 NEEDS_CONSENT로 폴백한다.

iOS Safari ITP가 저장 공간을 정리하면 동기화 말고 다른 로컬 상태도 영향을 받으므로, 그 내용은 [iOS 고유 제약](#ios-고유-제약) 절에 적었다.

보안 모델의 자세한 내용은 [`docs/archive/audit/2026-05-07-pkce-refresh-token.md`](docs/archive/audit/2026-05-07-pkce-refresh-token.md)에 있다.

## 프로젝트 구조

```
index.html              ← SPA 진입점 (단일 HTML)
privacy.html            ← 개인정보처리방침
sw.js                   ← 서비스 워커 (오프라인, 루트 필수)
sw-version.js           ← 셸 캐시 이름의 버전 — release.py가 갱신, sw.js가 importScripts (ADR-021)
manifest.webmanifest    ← PWA 매니페스트
favicon.ico             ← 파비콘 (루트 필수)
robots.txt / sitemap.xml
version.json            ← 앱 버전 (release.py로 관리)
tsconfig.json           ← TypeScript 설정 (--noEmit · checkJs — js/ 전체 기본 검사, ADR-012)
tsconfig.worker.json    ← Web Worker 전용 tsconfig
package.json            ← devDependency는 typescript 하나 — npm run typecheck · npm test
DESIGN.md               ← 디자인 시스템 (토큰 · 컴포넌트 · 접근성)
js/
  app.js                ← 부트스트랩 · 서비스 워커 등록 · 접근성 키보드 · 탭 복귀 처리
  drive-sync.js         ← Google Drive 동기화 모듈
  search-worker.js      ← Web Worker 기반 전역 검색 엔진
  pre-fetch.js          ← books.json 선패치 (초기 로딩 성능)
  gtag-init.js          ← Google Analytics 초기화
  types.d.ts            ← 앱 도메인 타입 단일 출처 (동기화 · 검색 · 라우팅 · 교회력 …)
  app/                  ← 28개 도메인 모듈 (ADR-018 · 034 · 038 — 목록은 docs/architecture.md §4)
  sync/                 ← 동기화 상태 머신·전송·저장 (ADR-011)
                          state-machine·transport·store-v2·debug-log·refresh-store
css/
  style.css             ← 메인 스타일
assets/
  icons/
    icon-192.png · icon-512.png · icon-512-maskable.png
    skh-cross.svg       ← 성공회 십자가 SVG (스플래시 생성용 소스)
  install-guide/        ← iOS 설치 안내 스크린샷 (webp, 3단계)
  splash/               ← iOS apple-touch-startup-image (13 디바이스)
data/                   ← 서브모듈: common-bible-data
  source/               ← 73권 마크다운 원본
  src/                  ← parser·split_bible·search_indexer
  tests/                ← Level 1-3 데이터 검증 (ADR-004)
  liturgical/           ← 전례시편 · 송가 기준, 교회력 표, 전례독서 원료와 그 파서
  bible/                ← 빌드 산출: 장별 JSON (전례시편 · 송가 포함)
  audio/                ← nested 서브모듈: common-bible-audio (mp3, LFS)
  lectionary/           ← 빌드 산출: 교회력 · 전례독서 자료 (ADR-036 · 037)
  books.json · book_mappings.json
  search-{meta,ot,nt,dc}.json
scripts/
  release.py            ← version.json + sw-version.js bump (셸 캐시 식별자, ADR-021)
  changelog.py          ← 릴리스 노트용 변경 목록 (앱 git log + data 서브모듈 비교)
  serve.py              ← SPA-aware 로컬 개발 서버
  build_sitemap.py      ← sitemap.xml 생성 (장별 lastmod)
  csp_hashes.py         ← index.html CSP 인라인 해시 검사 · 갱신
  generate_splash.py    ← iOS 스플래시 PNG 생성 (cairosvg + Pillow)
  lock_merged_ledgers.sh ← 머지된 변경 원장을 로컬에서 읽기 전용으로
  pr_body.sh            ← 변경 원장에서 PR 본문 생성 (frontmatter 제외)
  docs_facts_snapshot.py ← 문서의 사실 토큰과 옮긴 줄을 리비전 간 비교
tests/
  unit/                 ← 클라이언트 JS 유닛 테스트 (Node --test, ADR-013)
  e2e/                  ← 브라우저 E2E 테스트 (로컬 전용)
tools/
  booklet/              ← 개발자용 — 「전례독서」 책자 PDF ↔ 교회력 엔진 대조 (앱이 쓰지 않는다)
.claude/
  hooks/                ← Claude Code 훅 — 편집 뒤 타입 검사 · 끝낼 때 유닛 · PR의 변경 원장 게이트
.github/
  workflows/
    test.yml            ← CI 「Unit tests」: JS 유닛 + 타입 검사 (PR 필수)
    ledger.yml          ← CI 「Change ledger」: PR의 변경 원장 검사 (PR 필수)
    engine-data.yml     ← 교회력 엔진 ↔ 실데이터 테스트
    sync-data.yml       ← data 서브모듈 포인터 · sitemap 자동 갱신
docs/
  architecture.md       ← 아키텍처 개요 · ADR 인덱스
  decisions/            ← 아키텍처 결정 기록 (ADR)
  topics/                ← 주제 문서 (주제마다 지금 동작 · 결정 · 함정 · 남은 일)
  known-issues.md       ← 이슈 번호 대장 (본문은 주제 문서)
  coding-pitfalls.md    ← 공통 함정 · 작업 방식 교정 · 함정 번호 대장
  design/               ← 진행 중인 구현 설계서 (완료되면 archive/design/ 으로)
  reference/            ← 기도서 등 외부 원문을 옮겨 적은 문서
  archive/              ← 완료·점-시점 기록 (design 설계 변천 · audit 보안 감사)
  index.md              ← 진입점: 작업 유형 → 먼저 읽을 문서
  changes/              ← 변경 원장 (변경 하나에 파일 하나, PR 본문의 원본)
```

배포 설정(nginx·deploy.sh)은 `common-bible-server` 저장소로 분리(ADR-020).

## 데이터 파이프라인 실행

보통은 `common-bible-data`의 `build.yml` CI가 main에 push될 때 전체를 돌리고 산출물을 커밋한다. 손으로 돌릴 때는 서브모듈 접근 권한이 있는 환경에서 **순서를 지킨다**. `split_bible.py`가 `books.json`을 73권으로 새로 쓰므로, 전례시편과 송가 파서가 그 뒤에 실행되어야 두 권의 등록이 남는다.

```bash
# 서브모듈 초기화 (최초 1회, recursive로 audio까지)
git submodule update --init --recursive

# data 디렉토리(서브모듈 루트)에서:
cd data
python src/parser.py source/ --save-json output/parsed_bible.json
python src/split_bible.py
python src/search_indexer.py
python src/liturgical_psalter.py      # 전례시편 · 송가 — 73권 파이프라인 다음
# 그 뒤 교회력 · 전례독서 표(liturgical/parse_*.py · normalize.py)와 매니페스트(scripts/gen_manifests.py)
```

전체 명령과 표 파서끼리의 순서는 `data/CLAUDE.md` 「파이프라인 명령」이 기준이다(`build.yml`이 같은 순서로 돈다). 검증 절차는 `data/README.md`.

## 테스트

```bash
# 클라이언트 JS 유닛 테스트 (Node 24+, CI 자동 실행)
node --test tests/unit/*.test.js

# 타입 검사 (CI 자동 실행 — 「Unit tests」 잡)
npm run typecheck

# 실데이터 의존 유닛만 (data 서브모듈이 없으면 건너뛴다 — CI는 engine-data.yml · sync-data.yml)
node --test tests/unit/*.data.test.js

# 데이터 파이프라인 검증 (data 서브모듈 내부)
cd data && pytest tests/

# E2E 테스트 (로컬, SPA-aware 서버 실행 필요)
python3 scripts/serve.py 8080
pytest tests/e2e/ -v
```

## 정적 타입 검사

JSDoc을 바탕으로 하며 빌드 산출물이 없다. 두 설정 파일(`tsconfig.json`, `tsconfig.worker.json`)이 `checkJs: true`라 `js/` 전체가 기본으로 검사를 받고, 빼야 할 파일은 첫 줄 `// @ts-nocheck`로 표시한다(2026-10-18 기준으로 없다). CI 「Unit tests」 잡이 PR마다 돌린다([ADR-012](docs/decisions/012-typescript-incremental-adoption.md)).

```bash
npm run typecheck   # tsc -p tsconfig.json --noEmit && tsc -p tsconfig.worker.json --noEmit
```

## 장기 로드맵

1. Phase 1: 성경 읽기 PWA(완료)
2. Phase 2: 기도서 콘텐츠 추가
3. Phase 3: 교회력 계산기. 엔진, 전례독서 화면, 캘린더 월간 표를 구현했고(ADR 036-038), 남은 일은 [`docs/topics/liturgical.md`](docs/topics/liturgical.md)에 있다.
4. Phase 4: 성무일과 자동 생성

## 문서

- [문서 진입점](docs/index.md): 작업 유형별로 먼저 읽을 문서
- [아키텍처 개요](docs/architecture.md): 전체 구조를 한눈에 보여 준다
- [아키텍처 결정 기록](docs/decisions/): ADR 001-038
- [주제 문서](docs/topics/), [알려진 이슈 대장](docs/known-issues.md), [자주 하는 실수](docs/coding-pitfalls.md), [디자인 시스템](DESIGN.md)
- [변경 원장](docs/changes/): 변경 하나에 파일 하나이며 PR 본문의 원본이다
