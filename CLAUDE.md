# 공동번역성서 PWA

## 프로젝트 개요

대한성공회를 위한 공동번역성서 PWA.
장기적으로 성공회 교회력, 성무일과, 기도서까지 통합하는 전례 앱으로 확장 예정.

## 아키텍처 결정

- **SPA 방식** (프론트엔드 중심) — ADR: `docs/decisions/001-spa-architecture.md`
- Python은 데이터 전처리(JSON 분리)에만 사용
- 프레임워크 없이 Vanilla JS
- 브라우저가 JSON을 직접 읽어 렌더링

## 기술 스택

- Frontend: HTML, CSS, Vanilla JavaScript
- Data: JSON (장별 분리)
- Offline: Service Worker
- Data preprocessing: Python (일회성 스크립트)

## 프로젝트 구조

```
index.html              ← SPA 진입점 (단일 HTML)
privacy.html            ← 개인정보처리방침
sw.js                   ← 서비스 워커 (오프라인, 루트 필수)
manifest.webmanifest    ← PWA 매니페스트
favicon.ico             ← 파비콘 (루트 필수)
robots.txt / sitemap.xml
version.json            ← 앱 버전 (release.py로 관리)
requirements.txt        ← Python 의존성
tsconfig.json           ← 메인 tsconfig (DOM lib, ADR-012)
tsconfig.worker.json    ← 워커 전용 tsconfig (WebWorker lib, ADR-012)
js/
  app.js                ← 라우팅, 렌더링, 검색 UI, 오디오 플레이어
  drive-sync.js         ← Google Drive 동기화 모듈 (PKCE 단일 경로, ADR-011 Phase 2h)
  search-worker.js      ← Web Worker 기반 전역 검색 엔진 (ADR-005)
  pre-fetch.js          ← books.json 선패치 (초기 로딩 성능)
  gtag-init.js          ← Google Analytics 초기화
  types.d.ts            ← 동기화·검색 도메인 타입 단일 출처 (ADR-012)
  sync/
    state-machine.js    ← 동기화 상태 머신 (PKCE 단일 경로, Phase 2h)
    transport.js        ← PKCE primitives + Drive REST + nginx /oauth/token 호출 (ADR-011·017)
    store-v2.js         ← per-record mtime + tombstone 머지 (Phase 2c)
    debug-log.js        ← ring buffer 진단 로그
    refresh-store.js    ← OAuth refresh token 암호화 IDB 저장소 (Phase 2h, AES-GCM 비추출 키)
css/
  style.css             ← 메인 스타일
assets/
  icons/
    icon-192.png        ← PWA 홈 화면 아이콘
    icon-512.png        ← PWA 홈 화면 아이콘 (고해상도)
    icon-512-maskable.png ← PWA maskable 아이콘
    skh-cross.svg       ← 성공회 십자가 SVG (스플래시 생성용 소스)
  install-guide/
    install-step-1.webp  ← iOS 설치 안내 스크린샷 1: Safari 앱 화면 (ADR-008)
    install-step-2.webp  ← iOS 설치 안내 스크린샷 2: ··· 메뉴 (ADR-008)
    install-step-3.webp  ← iOS 설치 안내 스크린샷 3: 홈 화면에 추가 (ADR-008)
  splash/
    dark-{device}.png   ← iOS apple-touch-startup-image (13 디바이스, ADR-007)
data/
  books.json            ← 73권 목록 (메타데이터, has_prologue 플래그 포함)
  book_mappings.json    ← 책 ID·이름·별칭·구분 매핑
  search-meta.json      ← 검색용 별칭·책 메타데이터 (~9 KB)
  search-ot.json        ← 구약 절 검색 인덱스 (~3.8 MB)
  search-nt.json        ← 신약 절 검색 인덱스 (~1.3 MB)
  search-dc.json        ← 외경 절 검색 인덱스 (~700 KB)
  bible/
    {book_id}-{chapter}.json  ← 장별 성경 데이터
    sir-prologue.json   ← 집회서 머리말 (ADR-002)
  audio/
    {book_slug}-{chapter}.mp3 ← 장별 오디오
  source/
    {book_id}.md        ← 73권 마크다운 소스 (서브모듈)
src/
  parser.py             ← .md 소스 → parsed_bible.json (segments 기반)
  split_bible.py        ← parsed_bible.json → 장별 JSON 분리 스크립트
  search_indexer.py     ← 장별 JSON → data/search-{meta,ot,nt,dc}.json
  generate_splash.py    ← iOS 스플래시 PNG 생성 (cairosvg + Pillow, ADR-007)
  convert_txt_to_md.py  ← .txt → .md 일괄 변환 (일회성, 완료됨)
scripts/
  build-deploy.sh       ← 배포 zip 생성
  deploy.sh             ← dev/prod/promote 서브커맨드 (서버 업로드 + 심볼릭 링크 교체)
  release.py            ← version.json + sw.js 캐시 식별자 bump (shell/data/audio 독립)
  serve.py              ← SPA-aware 로컬 개발 서버 (History API 경로 지원)
nginx/
  oauth-proxy.example.conf       ← OAuth /token BFF location 블록 예시 (ADR-017)
  security-headers.example.conf  ← 보안 헤더 6종 snippet 예시
tests/
  test_completeness.py  ← Level 1 완전성 검증 (ADR-004)
  test_ordering.py      ← Level 2 절 순서 검증 (ADR-004)
  test_snapshots.py     ← Level 3 특수 케이스 스냅샷 (ADR-004)
  fixtures/
    verse_sequence.json ← 1328장 절 순서 스냅샷 (generate_fixtures.py로 생성)
  generate_fixtures.py  ← 픽스처 재생성 스크립트 (로컬 전용, 원본 텍스트 필요)
  unit/
    harness.js               ← node:vm 격리 + 브라우저 글로벌 스텁 (ADR-013)
    state-machine.test.js    ← 동기화 상태 머신 유닛 테스트 (Node --test)
    refresh-store.test.js    ← refresh token 암호화 IDB 저장소 (Phase 2h 단계 1)
    transport-pkce.test.js   ← PKCE primitives + /token 교환 (Phase 2h 단계 2)
  e2e/
    test_search.py      ← 검색 파이프라인 + 새로고침 회귀
    test_navigation.py  ← URL 라우팅 8케이스
    test_copy.py        ← 클립보드 복사 경계 확장
    test_install_guide.py ← 플랫폼별 설치 안내 모달
    test_features.py    ← 이어읽기 배너, 모바일 FAB
    test_drive_sync.py  ← Drive 동기화 e2e (GIS 스텁, ADR-011)
    test_drive_sync_ios.py ← iOS OAuth 풀페이지 리디렉션 (Phase 2f)
.github/
  workflows/
    test.yml            ← CI: Node 24 + `node --test tests/unit/*.test.js` (ADR-013)
docs/
  architecture.md       ← 아키텍처 개요 (전체 구조 한눈에, ADR 인덱스 포함)
  decisions/            ← ADR (아키텍처 결정 기록, ADR-001~017)
  design/               ← 살아있는 설계 문서 (pkce-migration.md 등)
  audit/                ← 보안 감사 보고서
  qa/                   ← e2e 회귀 테스트 결과 보고서
  coding-pitfalls.md    ← 반복 발생 실수 패턴 모음 (살아있는 문서)
  prd.md                ← 제품 요구사항 문서
  worklog.md            ← 작업 일지
```

## 데이터 파이프라인

```
data/source/*.md  (73권 마크다운 소스)
  → (parser.py) → output/parsed_bible.json
  → (split_bible.py) → data/bible/{book_id}-{chapter}.json
                      → data/bible/sir-prologue.json (집회서 머리말, 원본 텍스트에서 직접 추출)
                      → data/books.json
  → (search_indexer.py) → data/search-meta.json (별칭·책 메타데이터)
                         → data/search-ot.json   (구약)
                         → data/search-nt.json   (신약)
                         → data/search-dc.json   (외경)
```

### 전체 재생성 (소스 변경 시)

```bash
# 프로젝트 루트에서 실행
python src/parser.py data/source/ --save-json output/parsed_bible.json
python src/split_bible.py
python src/search_indexer.py
```

### 특정 책만 교체 (부분 작업 시)

```python
from src.parser import BibleParser
from dataclasses import asdict
import json

parser = BibleParser('data/book_mappings.json')
chapters = parser.parse_md_file('data/source/ps.md')

for ch in chapters:
    data = asdict(ch)
    del data['book_abbr'], data['division_ko'], data['division_en']
    data['chapter'] = data.pop('chapter_number')
    with open(f'data/bible/{ch.book_id}-{ch.chapter_number}.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
```

### split_bible.py 출력 상세

| 출력 파일 | 설명 |
|-----------|------|
| `data/bible/{book_id}-{chapter}.json` | 장별 성경 데이터. `null` 필드 생략, `stanza_break`는 `true`일 때만 포함 |
| `data/bible/sir-prologue.json` | 집회서 머리말. 원본 텍스트에서 직접 추출 (ADR-002) |
| `data/books.json` | 73권 메타데이터. 책 순서, 장 수, `has_prologue` 플래그 포함 |

## 테스트

### 클라이언트 JS 유닛 테스트 (ADR-013)

Node 자체 테스트 러너 + 자체 vm 하네스. 의존성 0, CI 자동 실행.

```bash
# 전체 (CI와 동일)
node --test tests/unit/*.test.js

# 개별 파일
node --test tests/unit/state-machine.test.js
node --test tests/unit/refresh-store.test.js
node --test tests/unit/transport-pkce.test.js
```

테스트마다 `loadMachine()`이 새 vm 컨텍스트에 `js/sync/state-machine.js`를 로드하므로 클로저 상태가 케이스 간에 새지 않는다. Phase 2i 시점 73 케이스(state-machine 37 + refresh-store 13 + transport-pkce 23) 통과 — Phase 2h 단계 4의 GIS 분기 제거에 더해 Phase 2i의 sync 캐시 시나리오 8건(304 fast path, 캐시 무효화, fileId 재사용)이 추가됨.

### 데이터 파이프라인 테스트 (Level 1-3)

원본 텍스트 없이 실행 가능. CI에서 자동 실행됨.

```bash
# 전체 실행
pytest tests/test_completeness.py tests/test_ordering.py tests/test_snapshots.py -v

# Level별 개별 실행
pytest tests/test_completeness.py   # Level 1: 파일 수, 구조 완전성
pytest tests/test_ordering.py       # Level 2: 1328장 절 순서 = 픽스처 일치
pytest tests/test_snapshots.py      # Level 3: cross-chapter·재배치 고정값
```

### 픽스처 갱신 (parser.py 또는 split_bible.py 변경 시)

```bash
python tests/generate_fixtures.py   # data/bible/ 읽어 verse_sequence.json 재생성
# 결과 파일을 커밋에 포함
```

### E2E 테스트 (브라우저, 로컬 전용)

```bash
# 1. 의존성 설치 (최초 1회)
pip install pytest-playwright
playwright install chromium

# 2. 개발 서버 실행 (별도 터미널)
#    SPA-aware 서버를 사용해야 Ctrl+Shift+R(강제 새로고침)이 정상 동작함.
#    python -m http.server는 /gen/1 같은 History API 경로를 404로 반환하므로 사용하지 말 것.
python3 scripts/serve.py 8080

# 3. 테스트 실행
pytest tests/e2e/ -v
```

e2e 테스트는 서버가 `http://localhost:8080`에 실행 중이어야 합니다.
CI에서는 실행하지 않으며 로컬에서 기능 개발 후 수동으로 확인합니다.

## 장기 로드맵

1. Phase 1: 성경 읽기 PWA (현재)
2. Phase 2: 기도서 콘텐츠 추가
3. Phase 3: 교회력 계산기
4. Phase 4: 성무일과 자동 생성

## ADR 워크플로우

기능을 구현하거나 수정할 때 다음 순서를 따른다:

1. **구현 전**: `docs/decisions/` 에서 관련 ADR을 먼저 확인한다.
   기존 결정(채택 이유, 검토한 대안, 데이터 스키마, UI 컴포넌트 등)과 충돌하지 않도록 맥락을 파악한다.
2. **구현 후**: ADR에 기술된 내용과 실제 구현이 달라진 부분이 있으면 해당 ADR을 갱신한다.
   — 새로운 결정 항목이면 새 ADR 파일 생성(`NNN-이름.md`, 다음 번호 이어서)
   — 기존 결정의 개정이면 해당 파일에 `> **개정 (날짜):**` 블록으로 내용 추가 또는 수정

## 컨벤션

- 문서: 한국어 기본
- 코드 주석: 영어
- 접근성: WCAG 2.1 AA 준수

## 커밋 메시지 규칙

타입은 영어, 내용은 한국어. 예: `feat: 장 내비게이션 드롭다운 구현`

| 타입       | 언제                               |
| ---------- | ---------------------------------- |
| `feat`     | 새 기능 추가                       |
| `fix`      | 버그 수정                          |
| `docs`     | 문서만 변경 (PRD, worklog, ADR 등) |
| `chore`    | 빌드, 설정, 파일 정리 등           |
| `data`     | 성경 데이터, JSON 파일 관련 변경   |
| `style`    | CSS, UI 스타일만 변경              |
| `refactor` | 기능 변경 없이 코드 구조 개선      |

## 현재 상태

- Phase 1 완료: 성경 읽기 PWA (73권, 오프라인, 검색, 오디오, 접근성)
- 완료: 테스트 체계 (ADR-004 Level 1-3 + e2e + ADR-013 유닛 테스트)
- 완료: 북마크 내보내기/가져오기 — Phase 2a (ADR-011)
- 완료: Google Drive 자동 동기화 — Phase 2a~2f (ADR-011)
  - Phase 2b: GIS Token Flow, `_accessToken` 메모리 전용, debounce 업로드, merge-by-updatedAt
  - Phase 2c: `js/sync/store-v2.js` per-record mtime + tombstone, ETag 412 재시도, exponential backoff, 디버그 ring buffer
  - Phase 2d: iOS FedCM/One Tap 시도 (이후 2f에서 일부 가정 정정)
  - Phase 2e: FedCM-mandatory deprecation — `prompt()` 콜백 + timeout 폴백 폐기
  - Phase 2f (2026-05-05~06): iOS는 GIS Token Client 우회 → OAuth Implicit Flow + 풀페이지 리디렉션 (`transport.beginRedirectAuth`/`consumeRedirectCallback`, state nonce CSRF, redirect attempts cap 3)
  - Phase 2f 후속 정제 (2026-05-06): Cursor Bugbot 6차 + GIS 빈 응답 stuck fix (PR #37·#40 머지)
  - Phase 2g (2026-05-06): iOS 앱 재실행 시 `prompt=none` silent 자동 리디렉션 — Phase 2f 매트릭스와 실제 구현 갭 정정. `bible-drive-silent-blocked` 플래그로 무한 재시도 차단, `signIn`/`SYNC_DONE`에서 해제
  - **Phase 2h (2026-05-06~08)** ✅ **완료**: Implicit Flow → Authorization Code + PKCE + refresh token 마이그레이션. desktop·Android·iOS 단일 경로 통일
    - 단계 1: `js/sync/refresh-store.js` AES-GCM 암호화 IndexedDB (PR #52)
    - 단계 2: `transport.js` PKCE 유틸 + `/token` 교환 함수 (PR #53)
    - 단계 3 (PR #54): `state-machine.js` `_attemptSilentRefresh` + `acceptRedirectCode`, IIFE PKCE 콜백 흡수, MAX_REAUTH cap이 silent refresh 진입 전 적용. Bugbot 3차 race·URL leak·DISABLED 가드 정정. 기존 GIS / Implicit 흐름은 그대로 공존 (IDB 빈 채면 폴백)
    - 단계 4 (PR #57): GIS Token Client / Implicit Flow / FedCM 의존 모두 제거. 상태 집합 축소(6개), `index.html` `gsi/client` `<script>` + CSP의 `accounts.google.com` 제거, `transport.js` GIS wrapper 7종 + Implicit Flow 제거, PKCE 함수 canonical 이름 인계. Bugbot IDB await 갭 race 가드 정정
    - 단계 5 (PR #61): `bible-drive-silent-blocked` localStorage one-shot cleanup, `coding-pitfalls.md` PKCE 함정 섹션 3개(§11~13), `docs/audit/2026-05-07-pkce-refresh-token.md` 보안 감사(0건), README.md PKCE 단일 경로
    - 단계 6 — **dev 환경 분리 + nginx BFF + visibility sync (PR #64, 2026-05-08)**:
      - `dev.anglican.kr` 환경 도입. 호스트 체크 inversion으로 소스에서 `localhost` 제거 (prod 호스트 1개만 명시, 그 외 모두 dev Client ID로 fallback)
      - **nginx BFF 패턴**: Google Web client가 PKCE에서도 `client_secret` 강제하는 RFC 7636 일탈 발견. SPA 임베드는 GitHub secret scanner 자동 무효화 위험 → `location = /oauth/token`이 server-side에서 secret 주입 (`nginx/oauth-proxy.example.conf`, ADR-017)
      - `scripts/deploy.sh` `dev`/`prod`/`promote` 서브커맨드 + `bible-{version}-{shortsha}` 명명 + `.gitignore`에서 제거(저장소 포함)
      - 탭 활성화 시 자동 sync (visibilitychange visible → `driveSync.requestSync()`)
      - sw.js POST cache.put 회귀 + 검색 액션 버튼 `[hidden]` 무력화 + 모바일 sheet clear가 모달 닫는 회귀 수정
    - 살아있는 설계 문서: `docs/design/pkce-migration.md`
  - **Phase 2i (2026-05-08)** — sync 사이클 캐시 (라운드트립 단축):
    - `localStorage`에 `bible-drive-cache-{file-id,etag,synced-u}` 캐시 도입. 매 사이클 `findSyncFileId` 생략 + `If-None-Match`로 304 조건부 GET + 로컬·원격 모두 미변경이면 사이클 no-op.
    - 분기별 소요: 둘 다 미변경 ~0.2s (94%↓), 로컬만 변경 ~2.0s (41%↓), 원격만 변경 ~1.3s (62%↓), 둘 다 변경 ~2.9s (15%↓). 기존 ~3.4s 대비.
    - 캐시 무효화: 다운로드 404, 업로드 412, `disable()`, `deleteRemoteFile()`. ADR-011 Phase 2i 참조.
  - 보안 감사: `docs/audit/2026-05-02-171111.md` (Implicit 시점, Critical 0·Medium 2건 수정), `docs/audit/2026-05-07-pkce-refresh-token.md` (PKCE 시점, Critical/High/Medium 0건)
  - 인프라: `dev.anglican.kr` (개발) + `bible.anglican.kr` (운영) 동일 서버에서 nginx 가상 호스트로 분리, 두 vhost 모두 `/oauth/token` BFF location 적용 완료. 보안 헤더 6종(X-Frame-Options·X-Content-Type-Options·X-XSS-Protection·Referrer-Policy·Permissions-Policy·Cross-Origin-Opener-Policy)을 server level snippet으로 통합 (2026-05-08)
  - 미결: Google OAuth 앱 검수 통과 (2026-05-02 제출 완료, 심사 대기 — 통과 시 refresh token TTL 7일 → 영구, 코드 변경 0)
- 완료: TypeScript 점진 도입 — `// @ts-check` + JSDoc + tsconfig --noEmit (ADR-012, 2026-05-06)
  - 1차 적용: `js/sync/*` + `js/drive-sync.js` + `js/search-worker.js`. `js/app.js`는 다음 사이클.
  - 검증: `npx tsc -p tsconfig.json --noEmit`, `npx tsc -p tsconfig.worker.json --noEmit` 모두 0 error
- 완료: 클라이언트 JS 유닛 테스트 (ADR-013, 2026-05-06~08)
  - `tests/unit/state-machine.test.js` (37, Phase 2i 캐시 8건 추가) + `refresh-store.test.js` (13, Phase 2h 단계 1) + `transport-pkce.test.js` (23, Phase 2h 단계 2). Node 24 `--test` + 자체 vm 하네스, 73 케이스 통과
  - CI: `.github/workflows/test.yml` `unit` job — `node --test tests/unit/*.test.js`
- 완료: 검색 UI 재설계 — 컴팩트 모달 → 결과 시트 + `in:` 연산자 (ADR-005, 2026-05-05)
- 진행 중: 운문 본문 재구성 (data/source/*.md 편집 후 파이프라인 재실행)
