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
  app.js                ← app-main 부트스트랩(DOMContentLoaded → route + 지연 init 체인) + 접근성 keydown(Escape/Space) + Audio cache LRU 소프트캡 + Service Worker 등록 (ADR-018 모듈 분할 종료, ~283줄, `// @ts-check`)
  drive-sync.js         ← Google Drive 동기화 모듈 (PKCE 단일 경로, ADR-011 Phase 2h)
  search-worker.js      ← Web Worker 기반 전역 검색 엔진 (ADR-005)
  audio-cache.js        ← 오디오 LRU IDB sidecar (ADR-016)
  pre-fetch.js          ← books.json 선패치 (초기 로딩 성능)
  gtag-init.js          ← Google Analytics 초기화
  types.d.ts            ← 동기화·검색·앱 도메인 타입 단일 출처 (ADR-012)
  app/
    helpers.js          ← 공통 DOM 헬퍼 (_$/el/clearNode/setInert/trapFocus, ADR-018 Phase 1)
    storage.js          ← localStorage 헬퍼 + UI 공유 상수 (Phase 2)
    settings-ui.js      ← 설정 팝오버 + 외관 적용 (Phase 3)
    install.js          ← PWA 설치 감지 + 안내 모달 + nudge (Phase 4)
    search.js           ← 검색 워커 wire-up + 결과 렌더 + 이력 패널 + sheet (Phase 5)
    reading-context.js  ← 현재 읽고 있는 책/장 + 절 선택 모드 공유 상태 (Phase 6a)
    bookmark.js         ← 북마크 모듈 — verse spec / 트리 query / 드래그&드롭 / 드로어 / 트리 렌더 / 모달 / 셀렉션 모드 (Phase 6a + 6b)
    views-routing.js    ← 데이터 패칭 / 렌더 헬퍼 / Pull-to-refresh / Compact Header / Views / Routing / Audio Player (Phase 7a + 7b)
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
    transport.test.js        ← PKCE primitives + /token 교환 (Phase 2h 단계 2)
    audio-cache.test.js      ← 오디오 LRU IDB sidecar (ADR-016)
    storage.test.js          ← localStorage 헬퍼 (검색 이력 외 후속 합류)
    search.test.js           ← 검색 워커 wire-up + 결과 렌더 헬퍼 (ADR-018 Phase 5)
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
  qa/                   ← 자동 테스트(e2e + 유닛) 회귀 결과 보고서, 비기술 독자 톤
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

**파일 명명 컨벤션** (ADR-013 2026-05-09 개정): `tests/unit/<source-basename>.test.js`. 한 모듈 = 한 테스트 파일. 모듈 내부 영역 구분은 파일 안에서 `// ── <영역> ──` 코멘트 섹션으로.

```bash
# 전체 (CI와 동일)
node --test tests/unit/*.test.js

# 개별 파일 (소스 모듈 basename과 1:1)
node --test tests/unit/state-machine.test.js     # js/sync/state-machine.js
node --test tests/unit/refresh-store.test.js     # js/sync/refresh-store.js
node --test tests/unit/transport.test.js         # js/sync/transport.js
node --test tests/unit/audio-cache.test.js       # js/audio-cache.js
node --test tests/unit/storage.test.js           # js/app/storage.js
node --test tests/unit/search.test.js            # js/app/search.js
```

테스트마다 `loadMachine()`이 새 vm 컨텍스트에 `js/sync/state-machine.js`를 로드하므로 클로저 상태가 케이스 간에 새지 않는다. 2026-05-11 시점 **473 케이스 통과** — sync 92 (state-machine 42 + refresh-store 13 + transport 23 + audio-cache 14) + app 381 (storage 83 + helpers 31 + install 40 + search 69 + bookmark 104 + views-routing 54). app 레이어 no-jsdom 영역 1차 의제 완료 (PR #106·#108·#109·#110·#112·#113, 245 → 473 = 93% 증가).

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

상세 결정·구현 변천은 각 ADR과 살아있는 설계 문서가 권위 출처. 본 절은 "지금 무엇이 동작하는가"만 한두 줄로.

- **Phase 1 완료** — 성경 읽기 PWA: 73권, 오프라인, 검색, 오디오, 접근성. 검색 UI 재설계도 포함(ADR-005)
- **테스트 체계 완료** — ADR-004 데이터 파이프라인(Level 1-3) + e2e + ADR-013 유닛 473 케이스. 유닛은 vm + 수동 스텁(0 의존성), DOM-heavy 영역은 e2e가 책임
- **북마크 + Google Drive 동기화 완료** — ADR-011, PKCE 단일 경로(2026-05-08). 상세는 `docs/design/pkce-migration.md`, ADR-017(nginx BFF), `docs/audit/2026-05-07-pkce-refresh-token.md`. 미결: Google OAuth 앱 검수(2026-05-02 제출, 심사 대기 — 통과 시 refresh token TTL 7일 → 영구)
- **TypeScript 점진 도입 완료** — ADR-012. 모든 클라이언트 JS에 `// @ts-check` + JSDoc 영구 활성화. `npx tsc -p tsconfig.json --noEmit` 및 `tsconfig.worker.json` 모두 0 error
- **app.js 모듈 분할 완료** — ADR-018, 2026-05-10. `js/app.js` 6,082 → 283줄, 9개 도메인 모듈, ESM(ADR-019). 상세는 `docs/design/app-modularization.md`
- **보안 헤더 6종 통합 완료** — 2026-05-08. nginx server-level snippet, 두 vhost(dev/prod) 모두 적용. `nginx/security-headers.example.conf` 참조
- **진행 중**: 운문 본문 재구성 — `data/source/*.md` 편집 후 파이프라인 재실행
