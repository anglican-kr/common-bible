# 공동번역성서 PWA

## 프로젝트 개요

대한성공회를 위한 공동번역성서 PWA.
장기적으로 성공회 교회력, 성무일과, 기도서까지 통합하는 전례 앱으로 확장 예정.

## 아키텍처 결정

- **SPA 방식** (프론트엔드 중심) — ADR: `docs/decisions/001-spa-architecture.md`
- 프레임워크 없이 Vanilla JS
- 브라우저가 JSON을 직접 읽어 렌더링
- 4분할 저장소 — ADR-020 (앱·데이터·오디오·서버)

## 기술 스택

- Frontend: HTML, CSS, Vanilla JavaScript
- Data: JSON (장별 분리) — `common-bible-data` 서브모듈에서 제공
- Audio: mp3 (LFS) — `common-bible-audio` nested 서브모듈에서 제공
- Offline: Service Worker

## 저장소 토폴로지 (ADR-020)

| 저장소 | 가시성 | 역할 |
|---|---|---|
| `anglican-kr/common-bible` (본 저장소) | 공개 | PWA 프론트엔드 · sw.js · JS 유닛/e2e · 릴리스 스크립트 |
| `anglican-kr/common-bible-data` | 비공개 | 마크다운 원본 + Python 파이프라인 + 빌드 출력 + 데이터 검증 테스트 |
| `anglican-kr/common-bible-audio` | 비공개 | 장별 mp3 (Git LFS) |
| `anglican-kr/common-bible-server` | 비공개 | nginx 설정(BFF·보안 헤더) + 배포 스크립트 |

서브모듈 토폴로지:
- 본 저장소가 `data/`에 `common-bible-data` 마운트
- `common-bible-data` 안의 `audio/`에 `common-bible-audio` nested 마운트
- clone 시 `git clone --recurse-submodules` 또는 `git submodule update --init --recursive`

## 프로젝트 구조

최상위 레이아웃만 — **모듈별 역할·라인 수 등 상세 지도는 [`docs/architecture.md`](docs/architecture.md) §4 + 부록 B**.

- 루트 — `index.html` / `privacy.html` / `sw.js` / `sw-version.js` / `manifest.webmanifest` / `version.json` / `tsconfig.json` + `tsconfig.worker.json` (ADR-012). `sw-version.js`는 `release.py`가 갱신하며 sw.js가 importScripts로 가져와 SHELL_CACHE 이름을 파생 (ADR-021).
- `js/` — 클라이언트 JS. 최상위(app/audio-cache/manifest-sync/search-worker/drive-sync/types.d.ts) + `js/app/` 9개 도메인 모듈 (ADR-018) + `js/sync/` 5개 동기화 레이어 (ADR-011)
- `css/style.css` — 메인 스타일
- `data/` — **서브모듈 `common-bible-data`** 마운트 위치 (73권 JSON `bible/`, 검색 인덱스 4종 `search-{meta,ot,nt,dc}.json`, 콘텐츠 해시 매니페스트 `bible-manifest.json`·`audio-manifest.json` (ADR-021), 오디오 nested 서브모듈 `audio/`, 마크다운 원본 `source/`, Python 파이프라인 `src/`, 데이터 검증 테스트 `tests/`)
- `scripts/` — `release.py`(version.json + sw-version.js bump + 자동 commit), `changelog.py`(릴리스 노트용 변경 목록 — 앱 git log + data 서브모듈 compare, `--generate-notes` 대체), `serve.py`(SPA-aware 로컬 서버), `generate_splash.py`(iOS 스플래시, ADR-007)
- `tests/` — e2e(`e2e/`, Playwright, 로컬 전용) + JS 유닛(`unit/`, ADR-013, CI 자동)
- `docs/` — `architecture.md`(아키텍처 개요·ADR 인덱스), `decisions/`(ADR), `design/`(설계 변천 문서), `audit/`(보안 감사), `qa/`(자동 테스트 회귀 보고서, 비기술 독자 톤), `coding-pitfalls.md`, `prd.md`, `worklog.md`
- `assets/` — 아이콘(`icons/`), 스플래시(`splash/`, ADR-007), 설치 안내 3컷(`install-guide/`, ADR-008)
- `.github/workflows/test.yml` — CI (Node 24 + `node --test`, ADR-013, pull_request 트리거)

배포·nginx 설정은 `common-bible-server` 저장소(별도 clone).
데이터 파이프라인은 `common-bible-data` 저장소 내부(서브모듈).

## 데이터 파이프라인

마크다운 원본·Python 파이프라인·검증 테스트는 `common-bible-data` 저장소에 있다. 본 저장소에서는 서브모듈 포인터로 잠금된 빌드 산출물(`data/bible/`, `data/search-*.json`, `data/books.json`)을 그대로 사용한다.

```
data/source/*.md (73권, common-bible-data 서브모듈)
  → src/parser.py → output/parsed_bible.json
  → src/split_bible.py → data/bible/{book_id}-{chapter}.json + books.json
  → src/search_indexer.py → search-{meta,ot,nt,dc}.json
```

빌드·검증 절차 상세는 `common-bible-data/README.md` 참조.

마크다운 수정 흐름 (ADR-021 이후, 2026-05-23 개정):
1. `common-bible-data` 저장소에서 `source/*.md` 편집 → PR → main 머지
2. main의 `build.yml` CI 가 자동으로 파이프라인 + 매니페스트 생성 + 자동 커밋백 (validate.yml 가 빌드된 산출물에 대해 재검증)
3. 앱 저장소의 `sync-data.yml` webhook 이 자동으로 서브모듈 포인터 + `sitemap.xml` 갱신 commit·push (버전 bump 없음)
4. 사용자가 적절한 시점에 직접 `python scripts/release.py patch` → push + tag + GitHub Release → `deploy.sh dev` → `deploy.sh promote`

## 테스트

### 클라이언트 JS 유닛 테스트 (ADR-013)

Node 자체 테스트 러너 + 자체 vm 하네스. 의존성 0, CI 자동 실행. **537 케이스 통과** (2026-05-27). 파일 명명 컨벤션: `tests/unit/<source-basename>.test.js`, 한 모듈 = 한 테스트 파일, 내부 영역은 `// ── <영역> ──` 섹션. 상세는 ADR-013.

```bash
node --test tests/unit/*.test.js                 # 전체 (CI와 동일)
node --test tests/unit/storage.test.js           # 개별 파일 (소스 basename과 1:1)
```

### 데이터 파이프라인 테스트 (Level 1-3, ADR-004)

`common-bible-data` 저장소로 이전. 본 저장소 CI에서는 실행하지 않음 — 그 저장소의 `validate.yml` 워크플로우가 push 시 자동 실행한다. 로컬에서 검증 시:

```bash
cd data && pytest tests/   # 서브모듈 디렉토리에서
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
3. **구현 PR 머지 시점**: ADR 상단 `상태` 필드와 본 CLAUDE.md "현재 상태" 절을 함께 갱신한다.
   — ADR 상태: `승인됨 — 구현 대기` → `승인됨 — 구현 완료` (날짜 병기 권장)
   — CLAUDE.md "현재 상태" 절에 한 줄 추가 또는 갱신 — "지금 무엇이 동작하는가" 의 권위 출처.
   — 새 ADR 채택이라면 `docs/architecture.md` 부록 A 의 ADR 인덱스에도 한 줄 추가.

데이터 도메인 ADR(002·003·006)은 분할 후 `common-bible-data` 저장소로 이전 검토 대상 (ADR-020 후속).

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
| `data`     | 데이터 서브모듈 포인터 bump        |
| `style`    | CSS, UI 스타일만 변경              |
| `refactor` | 기능 변경 없이 코드 구조 개선      |

본문 데이터 변경 자체는 `common-bible-data` 저장소에서 `data:` 커밋. 앱 저장소에서는 서브모듈 포인터 bump를 `data:` 또는 `chore:`로 기록.

## 브랜치 보호 / 작업 흐름

`main` 은 보호 브랜치다 (2026-05-29 적용). 모든 변경은 feature 브랜치 → PR → 머지 흐름을 따른다.

- **직접 push 금지** — 관리자(저장소 소유자) 포함 누구도 `main` 에 직접 push 불가 (`enforce_admins: true`).
- **PR 필수** — `Unit tests` CI(`node --test tests/unit/*.test.js`) 통과해야 머지 가능. 승인자 수는 0이라 솔로 환경에서는 본인 PR 셀프 머지 OK.
- **머지 방법** — rebase 또는 squash만 (저장소 설정, [[project_merge_policy]]). 머지 커밋 금지.
- **force push / 브랜치 삭제 금지**, PR 리뷰 코멘트 미해결 시 머지 차단.

작업 표준 흐름:

```bash
git checkout -b <topic-branch>
# 작업 + 커밋
git push -u origin <topic-branch>
gh pr create --title "..." --body "..."
# CI 통과 확인 후
gh pr merge --rebase --delete-branch     # 또는 --squash
```

`main` 에 직접 commit 후 push 하면 `protected branch hook declined` 로 거부된다. 핫픽스도 동일 — 짧은 브랜치 + PR 로 통과.

## 현재 상태

상세 결정·구현 변천은 각 ADR과 설계 변천 문서가 권위 출처. 본 절은 "지금 무엇이 동작하는가"만 한두 줄로.

- **Phase 1 완료** — 성경 읽기 PWA: 73권, 오프라인, 검색, 오디오, 접근성. 검색 UI 재설계도 포함(ADR-005)
- **디자인 시스템 완료** — ADR-028, 2026-06-02. 디자인 단일 권위 출처 `DESIGN.md`(루트) + `css/style.css` `:root` 토큰 사다리. 기존 색상 토큰에 더해 반경(`--radius-*`)·elevation(`--shadow-1..4`, 다크 alpha 자동 보강)·간격(8pt px `--space-*`)·타이포(rem `--font-*`/`--leading-*`)·컨트롤(`--touch-target` 44px 등)·모션·내비 예약 토큰 추가. 본문 Serif 유지는 의도적 HIG 이탈로 명문화(frosted glass 는 오디오 바·절 선택 바·검색 스크림 등 하단/오버레이에 적용, 헤더만 솔리드 — ADR-025). 헤더 아이콘 버튼 44pt 터치타깃 보강. **적응형 내비(모바일 하단 탭바 5탭: 홈·검색·북마크·노트·설정 / 데스크탑 사이드바)는 "결정됨 — 구현 대기"** — 토큰 예약 + `DESIGN.md` §7 스펙만, 실제 렌더·라우팅·노트 기능은 후속 PR
- **성서 목록 탭 통합 + 헤더 내비 재설계 완료** — ADR-024, 2026-05-29. 첫 페이지·구약·외경·신약을 탭 한 페이지(`renderBookList(books, activeDivision)`)로 통합, 탭은 외경 설정 반영. 읽기 헤더는 홈 버튼(`buildHomeBtn`, 책의 구분 탭으로) + 브레드크럼 제거 + 설정 버튼 반응형 배치(데스크탑 상단줄 / 모바일 제목 헤더). 구분 탭은 `#sticky-group` 안에 sticky 고정 + 슬라이드 인디케이터(트랙 동색 칩 + elevation 그림자, 윤곽선 중립화 — ADR-024 개정 2026-05-30), 구약 소분류는 제거해 세 탭 평면 통일 (ADR-024 개정 2026-05-29)
- **읽기 헤더 스크롤 elevation 그림자 완료** — ADR-025, 2026-05-30. `#scroll-sentinel` IntersectionObserver(`initScrollElevation`)가 페이지 최상단 이탈을 감지해 `#sticky-group.scrolled` 토글, 라이트 `0 4px 16px rgba(0,0,0,0.12)` / 다크 `0 4px 20px rgba(0,0,0,0.25)` 그림자가 0.18s 페이드 인. `#app-header::after` 1px hairline 은 always-on 경계로 유지(ADR-025 개정 2026-05-30, dev 검증 후 복구), shadow 는 스크롤 elevation 신호로 역할 분리. `#sticky-group::after` fade gradient 는 그림자 상단을 덮어 헤더-그림자 사이 빈 여백처럼 보이게 해 제거, 라이트 알파 `0.04`→`0.12` 로 보강(ADR-025 개정 2026-05-30). iOS 26 toolbar tinting / PWA status bar 비동기 회피를 위해 frosted glass 는 의도적 미적용
- **인용·주석 시스템 완료** — ADR-022 Phase 1(데이터 파이프라인) + Phase 2(앱 UI) 동작 중. 본문 `<cite>` → 옅은 회색 칩(클릭 시 인용 본문 바텀 시트, '이 장 전체 보기'·'더 보기' 확장), `[^id]` 주석 → 본문 anchor 위첨자 ※ + 클릭 시 툴팁. `js/app/citations.js`(~940줄) + `setCiteShow`/`setNoteShow` 토글. 절 복사 시 칩·※ 주석 마커는 본문에서 제외(`serializeVerseRange`, ADR-022 개정 2026-05-31). per-parallel tradition 표기 지원 (ADR-022 §2 개정 2026-05-31, `parallels="시편 16:8 [칠십인역]; 사도 2:25"` 인라인 표기). Phase 3(NT 전 본문 수기 저작)은 콘텐츠 작업으로 분리
- **단락 단위 병행 본문 마커 완료** — ADR-027, 2026-05-31. `<parallel src="2사무 5:1-10" range="11:1-9"/>` block 마커가 chapter-level `parallels` 메타데이터로 추출되고 (parser.py + split_bible.py), 앱은 range 시작 절 직전에 ※ anchor (`.parallel-anchor`) 를 렌더. 클릭 시 기존 note-tooltip 재사용으로 `range — sourceLink 참조` 표시, sourceLink 클릭 시 기존 cite-sheet 로 병행 본문 표시. 시각은 변형 주석 ※ 와 통일 (ADR-027 §2 UI 렌더 개정 2026-05-31, 초기 배너 안 dev 검증 후 footnote 패턴으로 전환). source DSL 위치 잡기 (markdown + USFM/OSIS 풍 자체 element) 도 같은 ADR 에 명문화. `js/app/parallels.js` 신규 (~230줄), `tests/test_parallels.py` 14 케이스 + `tests/unit/parallels.test.js` 21 케이스. 실제 마크업은 콘텐츠 작업으로 별도 (현재 시범 1건: 2사무 5장)
- **테스트 체계 완료** — ADR-004 데이터 파이프라인(Level 1-3, data 저장소) + e2e + ADR-013 유닛 537 케이스. 유닛은 vm + 수동 스텁(0 의존성), DOM-heavy 영역은 e2e가 책임
- **북마크 + Google Drive 동기화 완료** — ADR-011, PKCE 단일 경로(2026-05-08). 상세는 `docs/design/pkce-migration.md`, ADR-017(nginx BFF), `docs/audit/2026-05-07-pkce-refresh-token.md`. Google OAuth 앱 검수 통과(2026-05-19) — refresh token TTL 영구, 코드 변경 0
- **TypeScript 점진 도입 완료** — ADR-012. 모든 클라이언트 JS에 `// @ts-check` + JSDoc 영구 활성화. `npx tsc -p tsconfig.json --noEmit` 및 `tsconfig.worker.json` 모두 0 error
- **app.js 모듈 분할 완료** — ADR-018, 2026-05-10. `js/app.js` 6,082 → 283줄, 9개 도메인 모듈, ESM(ADR-019). 상세는 `docs/design/app-modularization.md`
- **보안 헤더 6종 통합 완료** — 2026-05-08. nginx server-level snippet, 두 vhost(dev/prod) 모두 적용. `common-bible-server/nginx/security-headers.example.conf` 참조
- **모노레포 4분할 완료** — ADR-020, 2026-05-11. 앱·데이터·오디오·서버 4개 저장소. data는 본 저장소 `data/`에 직접 서브모듈, audio는 data 안에 nested 서브모듈, server는 별도 clone
- **PWA 버전·캐시 무효화 재설계** — ADR-021, 2026-05-13. SHELL_CACHE 는 `version.json`에서 파생 (`sw-version.js` importScripts), DATA/AUDIO_CACHE 는 콘텐츠 해시 매니페스트(`bible-manifest.json`·`audio-manifest.json`) diff 로 항목 단위 lazy 무효화. 데이터 저장소 CI 가 main 머지 시 파이프라인 + 매니페스트 자동 빌드 + 자동 커밋백. release.py 가 git 자동 commit (M8 해소). Phase 3 webhook 자동화 후속
