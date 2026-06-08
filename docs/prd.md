# 제품 요구사항 문서 (PRD): 공동번역성서 PWA

## 1. 개요

### 1.1 목적

이 프로젝트의 목적은 "공동번역성서"를 위한 **프로그레시브 웹 앱(PWA)**을 개발하는 것입니다. 이 애플리케이션은 시각 장애인이 스크린 리더와 오디오 기능을 통해 쉽게 접근할 수 있도록 접근성을 제공하고, 오프라인 우선(offline-first)의 디지털 성서 독서 경험을 제공하는 것을 목표로 합니다.

### 1.2 타겟 사용자

- **주요 사용자**: 스크린 리더(VoiceOver, TalkBack)를 사용하여 디지털 콘텐츠에 접근하는 시각 장애인
- **보조 사용자**: 빠르고 방해 없는 오프라인 성경 읽기 경험을 원하는 일반 신자 및 연구자
- **기타 사용자**: 인터넷 연결이 제한적인 환경의 사용자

### 1.3 핵심 가치 제안

- **접근성 최우선**: WCAG 2.1 AA 표준 준수
- **오프라인 기능**: 초기 로딩 후 인터넷 연결 없이도 완전히 기능
- **성능**: 매우 가볍고 빠르며, 저사양 기기에서도 원활하게 실행
- **오디오 통합**: 모든 장에서 텍스트와 오디오 간의 원활한 이동 지원

---

## 2. 제품 원칙

1. **접근성은 기본**: 모든 기능은 시각장애인을 위한 접근성을 고려하여 설계되어야 합니다.
2. **서버 의존성 없음**: 앱은 정적 사이트로서 클라이언트 측에서 완전히 실행되어야 합니다. 데이터베이스나 백엔드 서버는 필요하지 않습니다.
3. **속도 및 효율성**: 앱은 즉시 로드되어야 하며 사용자 상호작용에 즉각적으로 반응해야 합니다.
4. **표준 준수**: 표준 PWA 관행을 따르며 유효한 HTML/CSS를 유지합니다.
5. **안전성**: PWA의 보안 취약점 방지를 위한 모범 사례 준수

---

## 3. 기능 요구사항

### 3.1 콘텐츠 관리

- **원본 텍스트**: 비공개 마크다운 원본(`common-bible-data` 서브모듈의 `source/*.md`)에서 공동번역성서 전체(구약, 외경, 신약)를 파싱하여 표시해야 합니다.
- **구조**: 
  - 콘텐츠는 성서(Testament) -> 책(Book) -> 장(Chapter) -> 절(Verse)의 계층 구조로 구성되어야 합니다.
  - 집회서는 다른 책과 다르게 1장 앞에 "머리말"이 있습니다. 머리말은 절 번호가 없다는 점도 고려해야 합니다.
    - 고려사항: 집회서 머리말은 장/절 검색에서 제외합니다.
- **포맷팅**:
  - 문단은 시각적으로 구분되고 의미론적으로 마크업되어야 합니다.
  - ¶ 기호와 절 번호는 시각적으로 존재해야 하지만 스크린 리더에서는 적절히 건너뛰도록 처리되어야 합니다(예: `aria-hidden="true"`).
  - 웹 브라우저에서 사용자가 텍스트를 선택하고 복사하는 경우, ¶ 기호와 텍스트 사이에 있는 절 번호는 복사되지 않고, 성서 이름과 책 약어,장, 절 번호가 텍스트 뒤에 복사되도록 처리해야 합니다(예: `한처음에 하느님께서 하늘과 땅을 지어내셨다. 땅은 아직 모양을 갖추지 않고 아무것도 생기지 않았는데, 어둠이 깊은 물 위에 뒤덮여 있었고 그 물 위에 하느님의 기운이 휘돌고 있었다. - 공동번역성서 창세 1:1-2`).

### 3.2 사용자 경험 및 내비게이션

- **목차 (TOC)**:
  - 모든 책을 성서별로 그룹화하여 나열하는 중앙 홈 페이지 (`index.html`).
  - 모든 책/장에 한 번의 클릭으로 접근 가능.
- **장(Chapter) 내비게이션**:
  - 모든 장 페이지에 "이전 장" 및 "다음 장" 버튼 제공.
  - 브레드크럼 내비게이션 제공 (예: 홈 > 구약 > 창세기 > 1장).
- **절(Verse) 이동**:
  - 고유 ID 앵커(예: `#genesis-1-1`)를 사용하여 특정 절로 자동 스크롤하는 딥 링크 지원.

### 3.3 검색 기능

- **범위**: 성경 전체에 대한 전역 전문(Full-text) 검색.
- **메커니즘 (유지보수 및 성능 최적화)**: 무거운 외부 라이브러리 의존성을 피하기 위해 빌드 시 생성되는 **단일 커스텀 JSON 인덱스**와 이를 런타임에 지연 로드(lazy load)하여 메인 스레드 프리즈를 방지하는 **Web Worker 기반 아키텍처**를 사용합니다.
- **입력**:
  - **절 ID 검색**: "창세 1:3", "창세 1:3-11" 등의 입력 시 해당 절 또는 범위로 직접 이동.
  - **단어 검색**: 특정 단어나 문구 검색 시 뷰포트 높이에 맞춘 동적 페이지네이션으로 스니펫 목록 표시.
- **반응형 검색 UI**:
  - **데스크탑 (≥769px)**: 브레드크럼 행 우측에 인라인 검색바. 검색 결과는 `#/search?q=...` 해시 라우트로 메인 영역에 표시.
  - **모바일 (≤768px)**: FAB(Floating Action Button) 클릭 → 바텀시트(Bottom Sheet) 패턴. 드래그 핸들로 높이 조절 가능. 검색 결과는 시트 내부에 렌더링.
- **결과 UX**: 책 → 장 → 절 순으로 정렬되며, 뷰포트 기반 동적 페이지네이션 적용. 결과 클릭 시 해당 장으로 이동하며 본문 내 검색어가 하이라이트 됩니다.

### 3.4 오디오

- **재생**: 해당 장에 대한 오디오 파일이 존재하는 경우, 각 장 페이지에 오디오 플레이어를 포함해야 합니다.
- **오디오 누락 시**: 오디오를 사용할 수 없는 경우, UI는 페이지를 깨뜨리지 않고 우아하게 처리하여 "준비 중" 메시지를 표시하거나 플레이어를 숨깁니다.
- **제어**: 키보드 및 스크린 리더로 접근 가능한 표준 재생/일시정지/탐색 제어. 브라우저 미지원 시 다운로드 링크를 제공합니다.

### 3.5 오프라인 (PWA)

- **설치**: 사용자가 앱을 홈 화면에 "설치"하도록 유도하거나 설치할 수 있어야 합니다 (Prompt 제공).
- **서비스 워커**:
  - Cache First 전략: "앱 셸"(HTML/CSS/JS) 정적 자원 캐싱.
  - Network First / Stale-While-Revalidate 전략: 방문한 콘텐츠(장, 오디오) 및 검색 인덱스 캐싱.
  - 오프라인 상태에서 방문하지 않은 콘텐츠 접근 시 기능적인 오프라인 대체(Fallback) 페이지 표시.

---

## 4. 비기능 요구사항

### 4.1 성능

- **Lighthouse 점수**: 성능, 접근성, 모범 사례, SEO 카테고리에서 90점 이상.
- **최초 콘텐츠 페인트 (FCP)**: 4G 네트워크에서 1.5초 미만.
- **검색 지연 시간**: Web Worker 처리로 쿼리 결과 200ms 미만 달성.

### 4.2 호환성

- **브라우저**: Chrome, Firefox, Safari, Edge (최신 2개 메이저 버전).
- **모바일**: Android (Chrome) 및 iOS (Safari). 반응형 레이아웃 및 터치 최적화 UI(바텀시트 등) 적용.

### 4.3 배포 및 보안

- **호스트 불가지론(Host Agnostic)**: 출력물은 모든 정적 호스트에 배포 가능한 정적 파일 폴더(`.html`, `.css`, `.js`, `.json`, `.mp3`)여야 합니다.
- **보안**: HTTPS 필수 권장, 콘텐츠 이스케이프를 통한 클라이언트 사이드 XSS 방지.

---

## 5. 기술 아키텍처

### 5.1 기술 스택

- **아키텍처**: 프론트엔드 중심 SPA (→ [ADR-001](decisions/001-spa-architecture.md))
- **저장소 토폴로지**: 4분할 — 앱(공개) + `common-bible-data`(비공개) + `common-bible-audio`(비공개 LFS) + `common-bible-server`(비공개) (→ [ADR-020](decisions/020-monorepo-split.md))
- **데이터 전처리**: Python 3.12+ (파싱, JSON 분리). `common-bible-data` 저장소 내부에서 실행. 런타임에는 관여하지 않음.
- **프론트엔드**: Vanilla HTML5, CSS3, JavaScript (ES6+). 단일 `index.html`에서 해시 라우팅으로 JSON 데이터를 읽어 렌더링. ESM 일괄 채택(ADR-019).
- **검색 엔진**: Web Worker에서 실행되는 클라이언트 측 역색인 — 구약/신약/외경 청크 분할 (ADR-005).

### 5.2 데이터 흐름 및 프로젝트 구조

데이터 파이프라인은 `common-bible-data` 저장소 내부에서 실행되며, 앱 저장소는 그 출력을 서브모듈 포인터로 잠금:

1. **수집 (Ingest)**: `src/parser.py`가 `source/*.md`(73권 마크다운)를 읽고 segments(산문/운문) 단위로 파싱 → `output/parsed_bible.json`.
2. **분리 (Split)**: `src/split_bible.py`가 `parsed_bible.json`을 장별 JSON과 `books.json`(메타데이터)으로 분리.
3. **인덱싱 (Index)**: `src/search_indexer.py`가 장별 JSON에서 `search-{meta,ot,nt,dc}.json` 4개 청크 생성.
4. **렌더링 (Runtime)**: 브라우저에서 앱이 JSON을 fetch하여 DOM으로 렌더링. 빌드 시 HTML 생성 없음.

```text
common-bible/                       # 앱 저장소 (공개)
├── index.html                      # SPA 진입점
├── sw.js                           # 서비스 워커
├── manifest.webmanifest
├── favicon.ico · robots.txt · sitemap.xml · version.json
├── js/
│   ├── app.js · drive-sync.js · search-worker.js · pre-fetch.js · types.d.ts
│   ├── app/                        # 9개 도메인 모듈 (ADR-018)
│   └── sync/                       # 5개 동기화 레이어 (ADR-011)
├── css/style.css
├── assets/                         # icons · splash · install-guide
├── data/                           # 서브모듈: common-bible-data
│   ├── source/                     # 73권 마크다운
│   ├── src/                        # parser · split_bible · search_indexer
│   ├── tests/                      # Level 1-3 데이터 검증 (ADR-004)
│   ├── bible/                      # 장별 성경 JSON (1328 + sir-prologue)
│   ├── audio/                      # nested 서브모듈: common-bible-audio (mp3, LFS)
│   ├── books.json · book_mappings.json
│   └── search-{meta,ot,nt,dc}.json # 검색 인덱스 4 청크
├── scripts/
│   ├── release.py                  # version.json + sw.js 캐시 ID bump
│   ├── serve.py                    # SPA-aware 로컬 서버
│   └── generate_splash.py          # iOS 스플래시 PNG 생성
├── tests/
│   ├── unit/                       # JS 유닛 (Node --test, ADR-013, CI 자동)
│   └── e2e/                        # Playwright (로컬 전용)
└── docs/
    ├── decisions/                  # ADR
    ├── archive/                    # 완료·점-시점 기록 (design·audit·qa)
    ├── status.md · known-issues.md
    └── prd.md · architecture.md · worklog.md

common-bible-server/                # 서버 저장소 (비공개)
├── nginx/                          # BFF·보안 헤더 (ADR-017)
└── scripts/
    ├── deploy.sh                   # dev/prod/promote/rollback + 자동 검증 4종
    ├── build-deploy.sh             # manifest 기반 zip 빌드
    └── deploy-manifest.txt
```

### 5.3 접근성 구현 세부사항

- **ARIA 레이블**: 모든 대화형 요소 및 오디오 플레이어에 적용.
- **시맨틱 HTML**: `<main>`, `<article>`, `<nav>`, `<header>`, `<footer>`의 올바른 사용.
- **숨김 요소**: 시각적으로만 보이고 스크린 리더에서는 건너뛰어야 할 요소(절 번호, 단락 기호)에 `aria-hidden="true"` 적용.

---

## 6. 마일스톤 및 요약 체크리스트

전체 개발 로드맵을 3단계로 나누어 진행 상황을 추적하는 통합 체크리스트입니다.

### 1단계: 핵심 리더 (MVP) 및 파서 — ✅ 완료

- [x] 성경 장/절/단락별 파싱 로직 구현 (`parser.py`).
- [x] `parsed_bible.json` → 장별 JSON 분리 (`split_bible.py`).
- [x] SPA 렌더링: JSON을 fetch하여 절 번호 + 본문을 접근성을 고려한 DOM으로 렌더링 (`app.js`).
- [x] 시맨틱 마크업 구성 (`aria-hidden`, 고유 `id` 앵커 등).
- [x] 오디오 파일 존재 여부 확인 및 조건부 표시 로직 구현 (부재 시 대체 메시지 포함).
- [x] 기본적인 반응형 CSS 스타일링 적용.

### 2단계: PWA, 네비게이션 및 접근성 — ✅ 완료

- [x] 브레드크럼, 이전/다음 장 등 전체 네비게이션 구현.
- [x] 목차 페이지 (SPA 홈 화면에서 `books.json` 기반 렌더링).
- [x] PWA 매니페스트(`manifest.webmanifest`) 및 서비스 워커(`sw.js`) 구현.
- [x] 오프라인 캐싱 전략 구현.
- [x] 스크린 리더 테스트 및 WCAG 2.1 AA 기준 준수 확인.
- [x] 오디오 플레이어 (재생/일시정지/탐색, 키보드 접근성).
- [x] 복사 시 절 번호 제외 + 인용 출처 자동 추가.
- [x] 사용자 설정 (폰트 크기 조절, 다크모드).

### 3단계: 전역 검색 및 고도화 — ✅ 완료

- [x] 전체 텍스트 검색을 위한 단일 인덱스 생성 (`search_indexer.py`).
- [x] Web Worker 기반 전역 검색 로직 및 UI 구현 (지연 로딩, 페이지네이션).
- [x] 검색 결과 본문 내 하이라이트 기능 추가.
- [x] 절 참조 내비게이션 ("창세 1:3" 입력 → 해당 절로 이동).
- [x] PWA 아이콘 생성 (`assets/icons/icon-192.png` · `icon-512.png` · `icon-512-maskable.png`).
- [x] 정적 파일 배포 설정(`common-bible-server/scripts/deploy.sh`) 및 보안(HTTPS·CSP·보안 헤더 6종·OAuth BFF — ADR-017) 적용.
- [x] 성능 최적화(pre-fetch·SW 셸/데이터/오디오 캐시 분리·검색 청크 분할·이미지 maskable) 적용 완료.

### 4단계: 북마크 + Drive 동기화 — ✅ 완료 (ADR-010·011)

- [x] 북마크 데이터 모델 + 트리 UI + 드래그&드롭 (ADR-010).
- [x] Google Drive `appdata` 영역 OAuth 동기화 — PKCE 단일 경로 + refresh token (ADR-011).
- [x] OAuth `/token` BFF 프록시 — `client_secret` 서버 격리 (ADR-017).

### 5단계: 인프라 정리 — ✅ 완료

- [x] TypeScript `// @ts-check` + JSDoc 전 모듈 영구 활성화 (ADR-012).
- [x] `app.js` 6,082 → 283줄, 9개 도메인 모듈 분할 (ADR-018) + ESM 일괄 채택 (ADR-019).
- [x] 클라이언트 JS 유닛 테스트 537 케이스 (ADR-013).
- [x] 모노레포 4분할(앱·data·audio·server) — ADR-020.
- [x] PWA 버전·캐시 무효화 재설계 (콘텐츠 해시 매니페스트 항목별 lazy 무효화) — ADR-021.

### 6단계: 본문 인용·주석 — ✅ Phase 1·2 완료 (ADR-022)

- [x] 데이터 파이프라인: `<cite src="…">…</cite>` segment 추출, `[^id]` 주석 추출 (`common-bible-data/src/parser.py`).
- [x] 인용 칩: dedup 렌더, 운문 인용은 별도 줄, 옅은 회색 톤.
- [x] 인용 본문 바텀 시트: 칩 클릭 → 출처 본문, "이 장 전체 보기" 확장 + 인용 절 강조, 드래그 핸들로 리사이즈·닫기, 다중 ref / parallels / 다중 장 (`53:5,7-9`) 지원.
- [x] 주석: ※ 위첨자 anchor + 클릭 시 본문 옆 툴팁, 인쇄 시 하단 footnote 양식.
- [x] 토글: 설정에서 칩·주석 각각 켜기/끄기 (`bible-cite-show` / `bible-note-show`).
- [x] 첫 진입 코치마크.
- [x] 유닛 테스트 20 케이스(`tests/unit/citations.test.js`) + QA 보고서.
- [ ] Phase 3 (장기): NT 전 본문에 `<cite>` + 주석을 사목·신학 자문 협업으로 수기 저작 — 콘텐츠 작업.

### 7단계: 모바일 가독성 폴리시 — ✅ 완료

- [x] 신약 책 이름 자동 짧게 표시 (책 목록·장 헤더): 터치 기기 미디어 쿼리 + 비-터치 ResizeObserver 측정. 글자 크기 변경 자동 재측정. 정식 명칭은 `aria-label` 로 항상 스크린리더에 노출 (2026-05-27, `docs/archive/qa/2026-05-27-book-name-shortening.md`).

