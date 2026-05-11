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

최상위 레이아웃만 — **모듈별 역할·라인 수 등 상세 지도는 [`docs/architecture.md`](docs/architecture.md) §4 + 부록 B**.

- 루트 — `index.html` / `privacy.html` / `sw.js` / `manifest.webmanifest` / `version.json` / `tsconfig.json` + `tsconfig.worker.json` (ADR-012)
- `js/` — 클라이언트 JS. 최상위(app/audio-cache/search-worker/drive-sync/types.d.ts) + `js/app/` 9개 도메인 모듈 (ADR-018) + `js/sync/` 5개 동기화 레이어 (ADR-011)
- `css/style.css` — 메인 스타일
- `data/` — 73권 JSON(`bible/`) + 검색 인덱스 4종(`search-{meta,ot,nt,dc}.json`) + 오디오(`audio/`) + 비공개 마크다운 서브모듈(`source/`)
- `src/` — Python 전처리: `parser.py` → `split_bible.py` → `search_indexer.py`. `generate_splash.py`는 iOS 스플래시 PNG 생성용 (ADR-007)
- `scripts/` — `deploy.sh`(dev/prod/promote), `release.py`(version/캐시 bump), `serve.py`(SPA-aware 로컬 서버), `build-deploy.sh`
- `nginx/` — `oauth-proxy.example.conf`(ADR-017 BFF), `security-headers.example.conf`(6종 통합)
- `tests/` — Python 데이터 검증(`test_completeness/ordering/snapshots.py`, ADR-004) + e2e(`e2e/`, Playwright, 로컬 전용) + JS 유닛(`unit/`, ADR-013, CI 자동)
- `docs/` — `architecture.md`(아키텍처 개요·ADR 인덱스), `decisions/`(ADR), `design/`(살아있는 설계 문서), `audit/`(보안 감사), `qa/`(자동 테스트 회귀 보고서, 비기술 독자 톤), `coding-pitfalls.md`, `prd.md`, `worklog.md`
- `assets/` — 아이콘(`icons/`), 스플래시(`splash/`, ADR-007), 설치 안내 3컷(`install-guide/`, ADR-008)
- `.github/workflows/test.yml` — CI (Node 24 + `node --test`, ADR-013, pull_request 트리거)

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

`BibleParser.parse_md_file()`로 단일 `.md`를 파싱한 뒤 `data/bible/{book_id}-{chapter}.json`에 직접 쓰기. 예시 코드는 `src/parser.py` 헤더 주석 참조 — `book_abbr`/`division_ko`/`division_en` 필드는 출력에서 제거, `chapter_number` → `chapter`로 rename.

`split_bible.py` 출력 스키마: 장별 데이터는 `null` 필드 생략 + `stanza_break`는 `true`일 때만 포함. `sir-prologue.json`은 집회서 머리말(ADR-002), `books.json`은 73권 메타데이터(책 순서·장 수·`has_prologue` 플래그).

## 테스트

### 클라이언트 JS 유닛 테스트 (ADR-013)

Node 자체 테스트 러너 + 자체 vm 하네스. 의존성 0, CI 자동 실행. **479 케이스 통과** (2026-05-11). 파일 명명 컨벤션: `tests/unit/<source-basename>.test.js`, 한 모듈 = 한 테스트 파일, 내부 영역은 `// ── <영역> ──` 섹션. 상세는 ADR-013.

```bash
node --test tests/unit/*.test.js                 # 전체 (CI와 동일)
node --test tests/unit/storage.test.js           # 개별 파일 (소스 basename과 1:1)
```

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

Phase 1(성경 읽기) → Phase 2(기도서) → Phase 3(교회력 계산기) → Phase 4(성무일과 자동 생성). 각 단계가 독립 추가 가능하도록 데이터·라우트·검색 인덱스를 책 단위로 분리. 상세는 [`docs/architecture.md`](docs/architecture.md) §11.

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
- **테스트 체계 완료** — ADR-004 데이터 파이프라인(Level 1-3) + e2e + ADR-013 유닛 479 케이스. 유닛은 vm + 수동 스텁(0 의존성), DOM-heavy 영역은 e2e가 책임
- **북마크 + Google Drive 동기화 완료** — ADR-011, PKCE 단일 경로(2026-05-08). 상세는 `docs/design/pkce-migration.md`, ADR-017(nginx BFF), `docs/audit/2026-05-07-pkce-refresh-token.md`. 미결: Google OAuth 앱 검수(2026-05-02 제출, 심사 대기 — 통과 시 refresh token TTL 7일 → 영구)
- **TypeScript 점진 도입 완료** — ADR-012. 모든 클라이언트 JS에 `// @ts-check` + JSDoc 영구 활성화. `npx tsc -p tsconfig.json --noEmit` 및 `tsconfig.worker.json` 모두 0 error
- **app.js 모듈 분할 완료** — ADR-018, 2026-05-10. `js/app.js` 6,082 → 283줄, 9개 도메인 모듈, ESM(ADR-019). 상세는 `docs/design/app-modularization.md`
- **보안 헤더 6종 통합 완료** — 2026-05-08. nginx server-level snippet, 두 vhost(dev/prod) 모두 적용. `nginx/security-headers.example.conf` 참조
- **진행 중**: 운문 본문 재구성 — `data/source/*.md` 편집 후 파이프라인 재실행
