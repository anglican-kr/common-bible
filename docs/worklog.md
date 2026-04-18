# 작업 일지

## 2026-04-18

### 초기 로딩 최적화 및 PWA 정리 (버전 1.0.21)

- `js/pre-fetch.js` 신규: HTML 파싱 중 즉시 `books.json` fetch 시작 (app.js 로딩 대기 제거)
- GA `page_view`, `loadVersion`, `initCompactHeader`를 `requestIdleCallback`으로 지연
- 런치 스크린 fade-out을 `requestAnimationFrame`으로 분리, 애니메이션 `2s`로 완화
- critical CSS에 디자인 토큰 변수 인라인, CSP `style-src` 해시 갱신
- `manifest.webmanifest`: `purpose: "any"` 명시, `short_name`/`start_url` 정리, `og:image` 경로 수정
- `apple-touch-icon`을 maskable 아이콘으로 교체, `skh-cross.svg` viewBox 타이트닝

### URL 라우팅 — 절 단위 확장 (`/#/{book}/{chapter}/{verse}[-{verse}]`)

- 해시 경로에 절(범위) 세그먼트 추가 — 검색 결과·딥링크에서 특정 절 강조 표시
- 기존 레거시 쿼리 폼(`?v=&ve=`) 제거, `?hl=` 텍스트 하이라이트는 유지
- 범위 오버플로 clamp, 역순 정규화, 동일값 처리 후 `replaceState`로 URL 재작성
- 향후 본문 공유(카드 이미지 생성) 기반

### 본문 복사 개선

- 단락 기호(¶) 제거, 산문 단락 경계를 빈 줄로 구분
- 절의 일부만 선택해도 절 전체 경계로 자동 확장해 복사

### iOS 시스템 한글 글꼴 스택 적용

- Noto Sans KR 대신 `-apple-system` → `Apple SD Gothic Neo` 우선 적용
- iOS 네이티브 폰트 일관성·소형 화면 가독성 확보, macOS Chromium 커버를 위해 `BlinkMacSystemFont` 함께 명시

### PWA 설치 가이드 추가 (ADR-008)

플랫폼별 안내 내용이 다른 설치 가이드 모달을 설정 팝오버에 추가했다.

- **iOS Safari**: 공유 버튼 → '홈 화면에 추가' 수동 가이드 (SVG 일러스트 포함)
- **iOS 타 브라우저**: Safari로 열기 유도 + 주소 복사 버튼
- **Android/데스크탑 Chromium**: `beforeinstallprompt` 기반 CTA 버튼
- **standalone 모드**: 이미 설치된 상태에서는 진입점 숨김
- `assets/install-guide/ios-*.svg` 플레이스홀더 추가 (실기기 스크린샷으로 차후 교체)
- `docs/decisions/008-pwa-install-guide.md` ADR 작성
- 접근성 보완: 모달 열림 시 배경에 `inert` + `aria-hidden`, `aria-disabled` 포커스 트랩, min 44×44px 터치 타깃, 다크 모드 대비비 수정

### 설정 팝오버 구조 개선 및 검색 UX 개선 (버전 1.0.22)

- 설정 항목을 **외경 배치 / 타이포그래피 / 앱 관리** 세 섹션으로 범주화, 글자 크기 확대
- 구절 참조('요한 3:16') 검색 시 자동 이동 대신 '구절 바로가기' 카드 상단 표시 (3초 자동 이동 타이머 제거)
- 검색 시트에서도 구절 카드 표시, 클릭 시 시트 닫기
- 검색 워커 오류 시 `searchId` 없어도 pending 콜백 정리 (UI 멈춤 방지)

### 테스트 체계 구축 (ADR-004 완성 + e2e)

#### 배경

미커밋 상태로 남아 있던 `verify_*.py` 11개 파일(Playwright ad-hoc 스크립트)을 정리하면서
ADR-004에서 설계만 하고 구현하지 않았던 Level 2·3 테스트와
체계적인 e2e 테스트 디렉터리를 함께 구축했다.

#### 데이터 파이프라인 테스트 (Level 2·3)

**Level 2 — 절 순서 검증** (`tests/test_ordering.py`)
- `tests/generate_fixtures.py`: `data/bible/` 전체를 읽어 각 장의 절 번호 시퀀스를
  `tests/fixtures/verse_sequence.json`으로 저장 (로컬 전용, 원본 텍스트 필요)
- `verse_sequence.json`: 1328장 × 절 번호 배열. cross-chapter 절은 `{"n": num, "chapter_ref": ch}` 형태
- `test_ordering.py`: 1328개 파라미터화 테스트 — 현재 `data/bible/` 파일이 픽스처와 정확히 일치하는지 검증
- `parser.py` 또는 `split_bible.py` 변경 후 `generate_fixtures.py` 재실행 → 픽스처 커밋

**Level 3 — 특수 케이스 스냅샷** (`tests/test_snapshots.py`)
- Cross-chapter 삽입 6곳 고정값 검증
  - 이사야 40장: 41:6·7절 삽입 확인 + 41장에서 6·7절 누락 확인
  - 잠언 5장: 6:22절 삽입
  - 호세아 14장: 13:14절이 5절 직후에 위치
  - 호세아 13장: 14절 부재
  - 욥기 27장: 24:18-24절 삽입
- 같은 장 내 재배치 3개 검증 (아모스 5·6장, 이사야 40장 순서)

#### e2e 테스트 (`tests/e2e/`)

기존 `verify_*.py` 중 품질 좋은 것들을 pytest-playwright 형식으로 변환.
진단/일회성 스크립트(`verify_loading*.py`, `verify_timeline.py`,
`verify_keyword_search.py`, `verify_verse_search.py`)는 중복이므로 삭제.

| 파일 | 커버 범위 |
|------|-----------|
| `test_search.py` | 키워드 검색, 절 참조 자동 이동, Worker 오류 UI 노출, 검색 URL 새로고침 회귀 |
| `test_navigation.py` | URL 라우팅 8케이스 (단일 절, 범위, over-range 클램프, 역순 정규화, legacy form, hl 파라미터, 유효하지 않은 절) |
| `test_copy.py` | 부분 선택 시 절 전체로 확장, 절 경계 걸친 선택 처리 |
| `test_install_guide.py` | iOS Safari/Chrome, Android, Desktop UA별 모달 내용, standalone 모드 진입점 숨김 |
| `test_features.py` | 이어읽기 배너, 모바일 검색 FAB → 바텀시트 |

e2e는 서버가 `http://localhost:8080`에서 실행 중이어야 하므로 CI 대상 아님.

#### CI

`.github/workflows/test.yml`: push/PR 시 Level 1-3 자동 실행 (e2e 제외).

#### 수정 파일 요약

| 파일 | 변경 유형 |
|------|-----------|
| `tests/test_ordering.py` | 신규 — Level 2 |
| `tests/test_snapshots.py` | 신규 — Level 3 |
| `tests/fixtures/verse_sequence.json` | 신규 — 1328장 픽스처 |
| `tests/generate_fixtures.py` | 신규 — 픽스처 생성 스크립트 |
| `tests/e2e/conftest.py` | 신규 — BASE_URL, wait_app_ready |
| `tests/e2e/test_search.py` | 신규 |
| `tests/e2e/test_navigation.py` | 신규 |
| `tests/e2e/test_copy.py` | 신규 |
| `tests/e2e/test_install_guide.py` | 신규 |
| `tests/e2e/test_features.py` | 신규 |
| `.github/workflows/test.yml` | 신규 — CI |
| `requirements.txt` | 수정 — pytest-playwright 추가 |
| `CLAUDE.md` | 수정 — 테스트 섹션, 프로젝트 구조, 현재 상태 갱신 |
| `tests/verify_*.py` (11개) | 삭제 |

## 2026-04-14

### iOS PWA 스플래시 화면 추가

- iOS는 `apple-touch-startup-image` 부재 시 앱 실행 때마다 흰 화면 노출 — `background_color` manifest 값은 iOS가 무시함
- `src/generate_splash.py` 신규: cairosvg + Pillow로 `assets/icons/skh-cross.svg`를 렌더링, 디바이스별 PNG 생성 스크립트
- `assets/splash/dark-{device}.png` 13장 생성 (iPhone SE 2세대 ~ iPhone 15 Pro Max, iPad mini ~ iPad Pro 12.9")
  - 배경 `#1a1a2e`(icon-512.png와 동일), 십자가 `#faf8f5`
  - `prefers-color-scheme` 구분 없이 단일 다크 테마로 통일
- `index.html`: `<link rel="apple-touch-startup-image">` 13개 추가 (디바이스별 portrait 미디어 쿼리)
- `sw.js`: CACHE_NAME rev-18 → rev-19 (SHELL_FILES 경로 변경 반영)

### iOS 런치 스크린 — apple-touch-startup-image와 일관성 맞추기

- **페이드인 애니메이션 제거**: `css/style.css`의 `launch-cross-in` keyframe 및 SVG animation 삭제
- **배경색 고정**: `var(--accent)` 대신 `#1a1a2e` 고정 (테마색 무관) — `css/pre-paint.css`·`css/style.css` 모두 적용, 테마별 분기 제거
- **십자가 크기 통일**: `width: 25vmin; aspect-ratio: 494 / 671` — 스플래시 생성 공식 `min(px_w, px_h) × 0.25`와 DPR 무관하게 동일한 물리적 크기
- **십자가 색상 통일**: `fill="white"` → `fill="#faf8f5"` (스플래시 이미지와 동일)
- `index.html`: SVG 인라인 `width="140" height="190"` 속성 제거 (CSS로 제어)

### Android 스플래시 대응 + iOS 잠금 화면 아이콘 이중 라운딩 수정

- **원인**: `icon-192.png`·`icon-512.png`에 rounded corner가 구워져 있어 iOS 잠금 화면 미디어 위젯이 자체 클리핑을 한 번 더 적용 → 이중 라운딩
- **`assets/icons/icon-512-maskable.png`** 신규: 512×512 정사각형, 라운딩 없음, 십자가가 safe zone(중앙 80%) 내 65% 높이로 배치
- `manifest.webmanifest`:
  - `background_color` `#faf8f5` → `#1a1a2e` (Android 스플래시 배경 통일)
  - maskable 아이콘 항목 추가 (`purpose: "maskable"`)
- `js/app.js`: Media Session artwork 소스를 `icon-192.png` → `icon-512-maskable.png` (잠금 화면 이중 라운딩 해소)
- `sw.js`: SHELL_FILES에 `icon-512-maskable.png` 추가, CACHE_NAME rev-19 → rev-20
- `src/generate_splash.py`: `make_maskable_icon()` 함수 추가

### 프로젝트 파일 구조 정리 (chore)

루트 디렉터리 과밀 해소 — 성격별로 서브디렉터리로 이동

| 이동 전 (루트) | 이동 후 |
|---|---|
| `app.js`, `gtag-init.js`, `search-worker.js` | `js/` |
| `pre-paint.css`, `style.css` | `css/` |
| `icon-192.png`, `icon-512.png`, `skh-cross.svg` | `assets/icons/` |

루트 유지 파일: `index.html`, `sw.js`(스코프 필수), `manifest.webmanifest`, `favicon.ico`, `robots.txt`, `sitemap.xml`, `version.json`

참조 업데이트: `index.html`, `js/app.js`, `manifest.webmanifest`, `sw.js` SHELL_FILES, `src/generate_splash.py`, `scripts/build-deploy.sh`

### 런치 스크린 흰 플래시 제거 — pre-paint.css (버전 1.0.14)

- 증상: PWA 앱 실행 시 메인 스타일시트가 로드되기 전 순간적으로 흰 배경이 노출
- 원인: 브라우저가 `style.css` 파싱 완료 전에 첫 페인트를 실행, 배경색과 런치 스크린 레이아웃이 적용되지 않은 상태가 노출
- `pre-paint.css` 신규: 메인 스타일시트 로드 전 테마색 배경과 런치 스크린 레이아웃만 담은 critical CSS
- `index.html`: `theme-color` 메타를 라이트/다크 `media` 쿼리로 분리, `pre-paint.css` 링크 추가
- `app.js`: `updateThemeMetaColor`가 복수 `theme-color` 메타를 모두 갱신; `dismissLaunchScreen` 핸들러를 `launch-screen-out` 애니메이션에만 반응하도록 필터링
- `style.css`: `launch-cross-in` keyframe 추가, fade-out `3s` → `5s`
- `sw.js`: `SHELL_FILES`에 `pre-paint.css` 추가, `CACHE_NAME` rev-15 → rev-17
- `scripts/build-deploy.sh`: 배포 zip에 `pre-paint.css` 포함
- `version.json`: 1.0.13 → 1.0.14

### 브레드크럼 구분 링크화 및 클립보드 복사 개선

- **브레드크럼 구분 링크화**: 브레드크럼의 구약/외경/신약 구분 항목을 드롭다운 피커에서 직접 링크로 변경 — 클릭 시 즉시 해당 구분의 첫 책으로 이동
- **브레드크럼 책이름 제거**: 장 보기 및 머리말 보기 브레드크럼에서 중복 노출이던 책이름 항목 제거
- **클립보드 복사 개선**: 절 복사 시 연(stanza) 나누기를 빈 줄로, 절 번호를 숫자만 사용 (마침표·공백 제외)
- `app.js`: 브레드크럼 렌더링 로직 단순화, 클립보드 핸들러 수정
- `style.css`: 미사용 CSS 제거 — `.bc-division-picker`, `.bc-division-btn`

### 소스 파일 업데이트

- `data/source` 서브모듈 최신 커밋으로 갱신

### 데이터 업데이트 및 초기 로딩 최적화 (버전 1.0.16–1.0.18)

**데이터 업데이트:**
- 검색 인덱스 재생성 (`search-dc.json` — 외경 데이터 변경 반영)
- 구약 데이터 업데이트 → 버전 1.0.16

**pre-paint.css 인라인 전환 (버전 1.0.17):**
- `css/pre-paint.css`를 `index.html` `<style>` 블록으로 인라인화 — 별도 네트워크 요청 제거
- SW 캐시 여부와 무관하게 첫 페인트 즉시 배경색 적용됨
- `css/pre-paint.css` 삭제, `sw.js` SHELL_FILES에서 제거

**초기 로딩 경량화:**
- `index.html`: `books.json` preload 추가 — JS 파싱과 병렬로 fetch 시작
- `app.js`: 목록·장목차 뷰는 렌더 직후, 장 뷰는 `renderLoading()` 직후 `dismissLaunchScreen()` 호출 (장 데이터 로드 전에 런치 스크린 먼저 해제)
- `initCompactHeader()`를 `requestIdleCallback`으로 지연 등록

**캐시 초기화 기능 추가 (버전 1.0.18):**
- 설정 팝오버에 '캐시 · 초기화' 버튼 추가 (`caches` API 지원 환경에서만 노출)
- `clearAllCaches()`: SW 캐시 전체 삭제 + SW 등록 해제 후 새로고침 (오프라인 상태에서는 차단, 실행 전 confirm)
- `.cache-clear-btn` 스타일 추가 (라이트/다크)

## 2026-04-15

### 검색 워커 데이터 경로 버그 수정 (버전 1.0.19)

- **원인**: `js/` 디렉터리로 파일 이동 후 `search-worker.js` 내 `fetch()`가 상대경로를 워커 스크립트 기준(`/js/`)으로 해석 → 404로 검색 전체 불능
- **수정**: `DATA_DIR` 경로에 `/` 접두사 추가 (`data/...` → `/data/...`) — 절대 경로 강제
- `manifest.webmanifest`: `short_name`을 '공동번역성서'로 변경

## 2026-04-17

### 초기 로딩 성능 집중 개선 (버전 1.0.20)

**렌더링 차단 해소:**
- Google Fonts stylesheet를 `media=print onload` 패턴으로 비차단화
- `app.js`, `gtag-init.js`에 `defer` 속성 추가
- `launch-screen` 마크업을 `<body>` 첫 자식으로 이동 — 헤더·메인보다 먼저 파싱
- `dismissLaunchScreen`에서 `.launch-done` 클래스로 라이트 모드 본문 색 전환

**런치 스크린 품질:**
- fade-out 애니메이션 `5s` → `0.8s` 단축, `prefers-reduced-motion` 대응
- `body::before` 다크 오버레이로 launch-screen 파싱 전 흰 화면 완전 차단
- `.loading`, `#sw-update-toast`에 시스템 폰트 fallback 명시 (폰트 swap 중 안정성)

**인라인 SVG 최적화:**
- svgo `--multipass --precision=2`로 path 좌표 정밀도 축소
- `index.html` 37KB → 15KB (인라인 SVG 28KB → 6KB), 시각적 회귀 없음

**서비스 워커 캐싱 전략 단순화 (버전 1.0.20):**
- chapter/search JSON의 network-first 분기 제거, shell과 동일한 stale-while-revalidate 패턴으로 일원화
- 이미 본 chapter는 캐시에서 즉시 반환, 백그라운드 revalidate
- 본문 수정은 release 시 `CACHE_NAME` bump → activate에서 옛 캐시 자동 삭제

**브랜드 표기 정리:**
- 문서·메타데이터의 '대한성공회 서울교구' → '대한성공회' 통일 (8곳)
- CSP: 인라인 `<style>`, JSON-LD `<script>`, `onload` 이벤트 핸들러용 SHA-256 해시 추가

## 2026-04-13

### 절 범위 검색 clamp (미릴리즈)

- 현재 `search-worker.js`의 `REF_RE`가 이미 `창세 3:1-17` 같은 범위 입력을 파싱하고, `app.js`의 하이라이트 조건 `vn >= hlVerse && vn <= (hlVerseEnd || hlVerse)`가 범위 표시를 자연스럽게 처리하고 있었음 — 사실상 이미 동작
- 개선: `renderChapter`에서 장의 실제 마지막 절 번호로 `hlVerseEnd`를 clamp. `창세 3:1-100`을 입력해도 24절에 멈추고, URL 해시도 `history.replaceState`로 `ve=24`로 교정돼 공유 링크가 정확한 범위를 반영
- `v.range_end`(절 범위를 가진 절)도 고려해 max verse 계산

### 절 참조 검색에 책 id 별칭 추가 (미릴리즈)

- 목적: 기존에는 `창세 3:1`, `창 3:1`처럼 `korean_name`·`aliases_ko`로만 절 참조 검색 가능. 내부 id(`gen`, `rev`, `sir` 등)로도 동일 검색이 되도록 확장
- `src/search_indexer.py`: `aliases` 생성 블록에 `aliases[bid] = bid` 한 줄 추가 — 책 id 자체를 별칭 키로 등록
- `data/search-meta.json` 재생성: 별칭 수 301 → 374 (+73권 id), 파일 크기 약 10.3 KB
- `search-worker.js`: `tryVerseRef` 별칭 조회를 `meta.aliases[bookQuery] || meta.aliases[bookQuery.toLowerCase()]`로 변경 — `Gen 3:1`·`GEN 3:1`처럼 대소문자 혼용 id 입력도 매칭. `toLowerCase()`는 한글에 무영향이라 기존 한국어 별칭에는 영향 없음
- `python -m pytest tests/test_completeness.py` 22건 통과

### 운문 행 hanging punctuation — 작은따옴표 offset 보정 (미릴리즈)

- 증상: 운문 단락 첫 글자가 `"`일 때 왼쪽으로 내어쓰기(hanging)되도록 했으나, `'`로 시작하는 단락도 동일 offset(`-0.4em`)으로 내어쓰기가 되면서 정렬이 어긋남
- 원인: `app.js`의 조건문이 `"`와 `'`을 동일하게 처리하고, CSS `.hanging-quote`는 큰따옴표 폭 기준으로만 조정돼 있었음
- `app.js` (`renderChapterView` 내부): `'` 시작 행에는 `hanging-quote hanging-quote--single` 수식자 클래스 부여
- `style.css`: `.verse.verse-poetry .hanging-quote--single { margin-left: -0.2em; }` 추가 — 큰따옴표 offset의 50%

### PWA 업데이트 후 stale 셸 수정 (버전 1.0.12)

- 증상: Linux 데스크탑 PWA에서 1.0.10 사용 중 업데이트 토스트 확인 → 새로고침 → 여전히 1.0.10 노출
- 원인: 서버가 셸 파일에 `Cache-Control: max-age=2592000, public, immutable` 헤더를 내려주어, SW install 단계의 `cache.addAll()` 네트워크 요청이 브라우저 HTTP 캐시에서 이전 버전 바이트를 재사용. 새 `CACHE_NAME`에 stale 셸이 저장됨
- `sw.js`
  - `install`: `cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: "reload" })))` — HTTP 캐시 우회
  - `fetch` 셸 분기: 백그라운드 재검증도 `new Request(event.request, { cache: "reload" })`로 강제 재요청, 실패 시 캐시 fallback
  - `CACHE_NAME` rev-11 → rev-12
- `app.js`: About 링크 버전 표기 1.0.11 → 1.0.12
- 참고: 서버 측 헤더에서 셸 파일의 `immutable` 제거 및 짧은 `max-age`로 변경하는 것이 근본 해결책이나, 본 패치는 SW 레벨에서 선제적으로 우회

### 신약 전권 마크다운 리포맷 (data/source)

- **신약 성서** (`acts.md`, `john.md`, `luke.md`, `mark.md`, `matt.md`, `rom.md`, `1cor.md`, `2cor.md`, `gal.md`, `eph.md`, `phil.md`, `col.md`, `1tim.md`, `2tim.md`, `heb.md`, `1pet.md`, `1john.md`, `rev.md`)
  - 시 구절 verse-line 적용, 단락 구분 정리
  - 신약 27권 전체 마크다운 형식 정리 완료

### 버전 1.0.11 및 SW 캐시 갱신

- `app.js`: About 링크 버전 표기 1.0.10 → 1.0.11
- `sw.js`: `CACHE_NAME` rev-10 → rev-11

## 2026-04-12

### 스크린리더 접근성 개선

- `index.html`
  - `#audio-bar`에 `role="region" aria-label="오디오 플레이어"` 추가 — 랜드마크 탐색 지원
  - `#search-scrim`에 `aria-hidden="true"` 추가 — 시각적 오버레이를 AT에서 숨김
  - `#search-sheet`에 `role="dialog" aria-label="검색"` 추가 — 모달 다이얼로그로 명시
  - `#search-sheet-handle`에 `aria-hidden="true"` 추가 — 포인터 전용 드래그 핸들 숨김
- `app.js`
  - `trapFocus(container)` 헬퍼 추가 — Tab 키를 열린 팝오버 안에서 순환시키고 클린업 함수 반환
  - 설정 팝오버, 타이틀 구분 선택, 장/편 선택, 브레드크럼 구분 선택 등 4개 팝오버에 포커스 트랩 적용
    - 팝오버 열릴 때 첫 항목으로 포커스 이동, 닫힐 때(버튼·외부클릭·ESC) 트랩 해제
  - `<mark class="search-highlight">`에 `role="presentation"` 추가 — 검색 하이라이트 의미 중복 읽힘 방지
  - SW 업데이트 토스트 접근성 강화
    - 토스트 표시 시 업데이트 버튼으로 `focus()` 이동 — 키보드/스크린리더로 즉시 대응 가능
    - 버튼 `aria-label="새 버전으로 업데이트"` 추가
    - 토스트 `aria-label="앱 업데이트 알림"` 추가
    - 텍스트 스팬에 `aria-hidden="true"` — `role="alert"` + 버튼 레이블 중복 읽힘 방지
- 절 번호(`<sup class="verse-num" aria-hidden="true">`)는 독서 몰입을 위한 의도적 설계로 유지

### PWA 업데이트 토스트 구현

- `sw.js`: `install` 이벤트에서 `self.skipWaiting()` 제거, `SKIP_WAITING` 메시지 수신 시에만 발동
  - 사용자가 토스트에서 "업데이트" 버튼을 눌러야만 새 SW가 활성화됨
- `style.css`: `#sw-update-toast`, `#sw-update-btn`, `@keyframes toast-in` 추가
- `app.js`: `showUpdateToast(waitingSW)` 함수 — waiting SW 감지 시 하단 토스트 표시, 클릭 시 `SKIP_WAITING` 전송

### iOS Safari PWA 업데이트 미감지 수정

- `app.js`: `navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })` — HTTP 캐시 우회로 iOS Safari에서 SW 파일 변경 감지 보장
- `sw.js`: `CACHE_NAME` rev-9 → rev-10 bump

### 책 배열 설정 레이블 명확화 및 버전 표기

- `app.js`: 설정 팝오버 책 배열 버튼 레이블 변경
  - `"성공회"` → `"외경 분리"` (canonical 모드)
  - `"불가타"` → `"구약에 외경 포함"` (vulgate 모드)
  - About 링크 버전 표기 1.0.9 → 1.0.10

### SW 업데이트 토스트 자동 포커스 제거

- `app.js`: `showUpdateToast()` 내 `btn.focus()` 제거 — 토스트 표시 시 포커스 강제 이동하지 않음

### 런치 스크린 추가

- 앱 실행 시 테마 색상(`--accent`) 배경에 흰색 십자가(skh-cross.svg)를 표시하는 런치 스크린 구현
- 십자가가 scale-up되며 3초간 페이드아웃, 이후 DOM에서 제거
- `index.html`: `#launch-screen` div에 SVG 인라인 삽입 (fill white)
- `style.css`: 런치 스크린 오버레이 스타일 + `launch-screen-out`, `launch-cross-out` 키프레임 애니메이션
- `app.js`: `dismissLaunchScreen()` 함수, `route()` 첫 렌더 완료 시 1회 호출 (플래그 기반 중복 방지)
- `scripts/build-deploy.sh`: `skh-cross.svg` 배포 패키지에 추가

## 2026-04-11

### 불필요 파일 정리

- `static/sw.js` 삭제 — 구 아키텍처 서비스 워커, 아무데서도 참조 안 됨
- `static/pwa.js` 삭제 — 삭제된 static/sw.js 등록용
- `static/search-worker.js` 삭제 — 루트 search-worker.js의 구버전
- `static/verse-navigator.js` 삭제 — 구 독립 컴포넌트, app.js로 통합됨
- `static/verse-style.css` 삭제 — 구 CSS, style.css로 통합됨
- `static/manifest.webmanifest` 삭제 — 구버전 (경로 오류, 루트 manifest가 현재 버전)
- `deploy-20260410-232707.zip` 삭제 — 빌드 아티팩트, 저장소 불필요

### PWA 업데이트 감지 및 자동 새로고침 구현

- `app.js` SW 등록 로직 강화:
  - `hadController` 플래그로 첫 방문 vs. 업데이트 구분
  - `controllerchange` 이벤트 → `window.location.reload()` (업데이트 시에만)
- `sw.js` CACHE_NAME 변경 시점 주석 추가
- 운용 방침: 성경 장 JSON은 network-first로 자동 처리, books.json·셸 파일 변경 시에만 CACHE_NAME 버전업

### 문서 현행화

- `CLAUDE.md`: 프로젝트 구조(search-worker.js 추가, config.py 제거, static/ 정리), 현재 상태 갱신
- `docs/prd.md`: 데이터 파이프라인 입력 소스(.txt → .md), 프로젝트 구조 갱신, 인덱싱 단계 추가
- `tests/test_parser.py` 삭제 — 구 아키텍처(src.config, src.models) 기반, 실행 불가
- `tests/test_completeness.py` 신규 — ADR-004 Level 1 완전성 검증 (8개 테스트, 원본 텍스트 불필요)
  - 73권 존재, 1328개 장 파일, books.json 정합성, has_prologue 플래그, sir-prologue.json 구조, segments 스키마

### 구약 소분류 UI 추가

- `/#/` (홈) 및 `/#/old_testament` 페이지의 구약 목록을 4개 소분류로 세분화
  - **오경**: 창세기–신명기 (5권)
  - **역사서**: 여호수아–느헤미야·에스델 (12권, 불가타 모드에서 토비트·유딧·마카베오상하 포함)
  - **시서와 지혜서**: 욥기·시편·잠언·전도서·아가 (5권, 불가타 모드에서 지혜서·집회서 포함)
  - **예언서**: 이사야–말라기 (17권, 불가타 모드에서 바룩 포함)
- `OT_SUBCATEGORY` 맵으로 책 ID → 소분류 매핑, 불가타 모드(제2경전 혼합)에도 대응
- `style.css` `.ot-subcategory-title` 소제목 스타일 추가

### 수정 파일 요약

| 파일 | 변경 유형 |
|------|-----------|
| `static/sw.js`, `static/pwa.js`, `static/search-worker.js`, `static/verse-navigator.js`, `static/verse-style.css`, `static/manifest.webmanifest` | 삭제 |
| `deploy-20260410-232707.zip` | 삭제 |
| `app.js` | 수정 — SW controllerchange 자동 새로고침, 구약 소분류 UI, 버전 1.0.7 |
| `sw.js` | 수정 — CACHE_NAME 변경 시점 주석, 아이콘 파일 SHELL_FILES 추가 |
| `style.css` | 수정 — `.ot-subcategory-title` 소제목 스타일 |
| `index.html` | 수정 — 아이콘·OG 이미지 경로 루트로 수정 |
| `manifest.webmanifest` | 수정 — 아이콘 경로 루트로 수정 |
| `favicon.ico`, `icon-192.png`, `icon-512.png` | 신규 — 루트로 이동 |
| `CLAUDE.md` | 수정 — 구조·현재 상태 현행화 |
| `docs/prd.md` | 수정 — 파이프라인·구조 현행화 |
| `tests/test_parser.py` | 삭제 — 구 아키텍처 잔재 |
| `tests/test_completeness.py` | 신규 — ADR-004 Level 1 완전성 검증 |

### 검색 인덱스 분할 로딩 (ADR-005 개정)

- `search-index.json`(6.6MB 단일) → 4개 파일 분리:
  - `search-meta.json` (~9KB) — aliases + books 메타데이터
  - `search-nt.json` (~1.3MB) — 신약 7,940절
  - `search-dc.json` (~700KB) — 제2경전 4,114절
  - `search-ot.json` (~3.8MB) — 구약 23,430절
- 컬럼형 포맷 + RLE 인코딩: 키 이름 반복 제거, Worker에서 `Uint16Array`로 메모리 절감
- Progressive search: NT 로드 즉시 partial-results 전송, 전체 로드 후 최종 결과로 교체
- `search-worker.js` 전면 재작성, `app.js` 검색 관련 코드 리팩터링
- `sw.js` CACHE_NAME rev-7, `search-meta.json` SHELL_FILES 추가
- ADR-005 개정 섹션 추가

### compact 헤더 진동 수정

- 이어읽기 배너 `position: sticky` 제거 (불필요한 stacking context 원인)
- compact 헤더 hysteresis 적용: 접기 60px / 펴기 10px 임계값 분리로 피드백 루프 방지
- `#app-header` z-index 10→20으로 조정 (드롭다운이 배너에 가려지는 문제 해결)

### 보안 강화 및 Google Analytics 연동

- **Content Security Policy(CSP)** 메타태그 추가 — `'unsafe-inline'` 없이 최소 권한 정책 적용
  - `script-src 'self' googletagmanager.com`
  - `style-src 'self' fonts.googleapis.com`
  - `font-src fonts.gstatic.com`
  - `connect-src 'self' google-analytics.com analytics.google.com`
  - `object-src 'none'` / `base-uri 'self'`
- **Google Analytics (GA4)** 연동 (`G-2Q4SRGVNQN`)
  - 인라인 스크립트 대신 `gtag-init.js` 분리 (CSP 호환)
  - `sw.js` SHELL_FILES에 `gtag-init.js` 추가
- `<noscript>` 인라인 스타일 → `.noscript-fallback` CSS 클래스 분리 (CSP 대응)
- `rel="noopener"` → `rel="noopener noreferrer"` 수정 (Referrer 노출 방지)

## 2026-04-07

### 첫 페이지 SEO 기본 정보 노출

- **Open Graph / Twitter Card 메타 태그 추가**: SNS 공유 시 제목·설명·이미지 미리보기 지원
- **canonical URL**: `https://bible.anglican.kr/` 지정
- **JSON-LD 구조화 데이터**: `WebApplication` 스키마 (Schema.org) — 검색 엔진 리치 결과 지원
- **`<noscript>` 폴백**: JS 미실행 크롤러 및 스크린리더를 위한 서비스 설명 텍스트
- **`robots.txt`**: 크롤링 허용 + sitemap 경로 명시
- **`sitemap.xml`**: 첫 페이지 URL 포함 (SPA 단일 페이지)

### 서브모듈 업데이트

- **`data/source` (song.md)**: 아가 전문을 산문체에서 시(詩) 행 구분 형식으로 재구성, 화자 지시(신부, 신랑, 합창단)를 별도 행으로 분리

### 버전 범프

- `app.js`: 1.0.4 → 1.0.5

### 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `index.html` | 수정 — OG/Twitter/JSON-LD 메타 태그, noscript 추가 |
| `robots.txt` | 신규 — 크롤링 허용 + sitemap 경로 |
| `sitemap.xml` | 신규 — 첫 페이지 URL |
| `app.js` | 수정 — 버전 1.0.5 |
| `data/source` | 서브모듈 업데이트 — 아가 시행 구분 재구성 |

## 2026-04-06

### 마크다운 소스 파서 구현 및 데이터 파이프라인 전환

- **소스 포맷 전환**: `.txt` → `.md` 형식으로 전면 전환
  - `src/convert_txt_to_md.py` 신규 — 71개 `.txt` 파일을 `.md`로 일괄 변환
  - 장 헤더 `# N장`, 절 마커 `[N]`, 특수 토큰(`[N-M]`, `[Na]`, `[N_M]`) 정확 변환
  - 기존 `gen.md`, `ps.md` 보존 (총 73개 `.md` 소스 파일)

- **파서 리팩터링**: `.txt` 파서 제거, `.md` 파서(`parse_md_file`)만 유지
  - `parse_file()`, `_parse_verse_line()`, `_extract_verse_from_chapter_line()` 등 삭제
  - `parse_file_with_cache()`, `chapter_pattern` 등 `.txt` 전용 코드 제거
  - `load_from_json()`의 old `text` 호환 코드 제거
  - `main()` CLI를 `.md` 파일/디렉터리 입력으로 교체

- **전체 파이프라인 재실행**: 73권 1328장 35,482절 파싱 및 분리 완료
  - `data/source/*.md` → `output/parsed_bible.json` → `data/bible/*.json`

### 렌더러 개선 — segments 기반 산문/운문 처리

- **절 간 break 로직 개선**: `prevVerseEndType` 추적
  - `hemistich-break`: 이전 절·현재 절 모두 운문일 때만 (스탠자 내 반행 연결)
  - `paragraph-break`: 산문→운문 전환, 또는 `¶` 마커
  - 기존 `inPoetryStanza` 휴리스틱 완전 제거

- **절 내 세그먼트 전환 여백**: 산문→운문, 운문→산문 전환 시 `paragraph-break` 삽입
  - `prevSegType`으로 세그먼트 타입 변경 감지

- **운문 hanging punctuation**: `"`, `'`로 시작하는 운문 행의 따옴표를 왼쪽으로 내어쓰기
  - `.hanging-quote { margin-left: -0.4em }` — 따옴표 뒤 첫 글자가 들여쓰기 기준선에 정렬

- **운문 절 번호 왼쪽 정렬**: `text-align: right` → `text-align: left`
  - 절 번호가 산문 시작 위치에 맞춰 정렬

### 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `src/convert_txt_to_md.py` | 신규 — `.txt` → `.md` 일괄 변환 스크립트 |
| `src/parser.py` | 수정 — `.txt` 파서 제거, `.md` 파서만 유지, CLI 교체 |
| `src/split_bible.py` | 수정 — segments 출력 (기존 호환 유지) |
| `src/search_indexer.py` | 수정 — segments에서 텍스트 추출 (기존 호환 유지) |
| `app.js` | 수정 — segments 기반 렌더링, 절 간/세그먼트 간 break 로직, hanging punctuation |
| `style.css` | 수정 — 절 번호 왼쪽 정렬, hanging-quote 스타일 |
| `data/source/*.md` | 신규 — 71개 마크다운 소스 파일 |

## 2026-03-25

### 프로젝트 방향 전환 논의

- 기존 Python 빌드 방식(html_generator → 정적 HTML)에서 SPA 방식으로 전환 결정
- 장기 비전 확정: 성경 → 기도서 → 교회력 → 성무일과
- 세 가지 대안(A: 기존 코드 수정, B: HTML 생성기 재작성, C: SPA) 비교 후 C 선택
- ADR-001 작성

### 프로젝트 관리 체계 수립

- CLAUDE.md: 매 대화 자동 로드되는 프로젝트 컨텍스트
- docs/decisions/: 아키텍처 결정 기록 (ADR)
- docs/worklog.md: 작업 일지 (이 파일)
- 자동 메모리: 대화 간 맥락 유지

### 불필요한 파일 정리

- SPA 전환에 따라 불필요해진 파일 삭제:
  - Python: html_generator.py, wordpress_api.py, pwa_builder.py, **init**.py, run.py, setup.py
  - 설정: pyrightconfig.json, requirements.txt, env.example, .python-version
  - 빌드 결과물: output/html/, output/pwa/
  - 프론트엔드: templates/, static/ (전부 새로 작성 예정)
  - 테스트: tests/ (이전 코드 대상)
  - 문서: CHANGELOG.md, CONTRIBUTING.md
- 기존 문서 8개를 docs/archive/로 이동 (design-system, wireframes, prd, technical-design 등)
- 유지된 파일: parser.py, config.py, parsed_bible.json, 원본 텍스트, 매핑, 오디오

### 다음 작업

- [ ] parsed_bible.json → 장별 JSON 분리 스크립트 작성

- [ ] SPA 뼈대 구현 (index.html + app.js + router)

- [ ] 기본 성경 읽기 기능 구현

## 2026-03-26

### PRD 재작성

- 기존 PRD(archive/prd.md) 검토 후 SPA 아키텍처 기준으로 전면 재작성
- 변경 사항:
  - 기술 스택: Python 빌드 도구 → Vanilla JS SPA, Python은 전처리만
  - 데이터 흐름: parser→builder→HTML → parser→JSON 분리→브라우저 fetch/렌더링
  - 내비게이션: 브레드크럼 → 간결한 책/장 선택 드롭다운
  - Lighthouse 90+ 성능 목표 제거
  - 장기 로드맵(Phase 1\~4) 추가
- 기존 archive/prd.md 삭제

### PRD 요구사항 추가

- **이어읽기**: 앱 재진입 시 마지막 읽던 장/절로 자동 이동 (localStorage 사용, 쿠키 불필요)
- **HTTP 보안 헤더**: 배포 URL(https://bible.anglican.kr) 공개 서비스 고려
  - HSTS, X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy
  - 호스팅 레벨 설정으로 분리하여 명세
- 배포 URL 명시: https://bible.anglican.kr

### book_mappings.json 별칭 정리

- 별칭 추가: 탈출기, 사무엘기 상/하권, 열왕기 상/하권, 역대기 상/하권, 에즈라기, 느헤미야기
- 오타 수정: 호세야서 → 호세아서
- 중복/부정확 별칭 제거: 시편(abbr와 동일), 잠언(abbr와 동일), 바룩, 요나, 미가, 나훔, 하깨

### 다음 작업

- [x] parsed_bible.json → 장별 JSON 분리 스크립트 작성

- [ ] SPA 뼈대 구현 (index.html + app.js + router)

- [ ] 기본 성경 읽기 기능 구현

## 2026-03-26 (오후)

### book_id OSIS 소문자 표준화

- book_mappings.json의 id 필드를 OSIS 소문자 기준으로 전면 교체
- Paratext/USX 대신 OSIS를 선택한 이유: 성공회 전례 자료(RCL 등)와의 호환성, 웹 URL 친화성, 오픈소스 생태계
- 변경 45개, 유지 28개
- 주요 수정:
  - 빌립보서 `php` → `phil`, 빌레몬서 `phm` → `phlm` (기존 데이터 오류 수정 포함)
  - 시편 `psa` → `ps`, 마태 `mat` → `matt`, 마르코 `mrk` → `mark` 등
- parser.py 재실행으로 parsed_bible.json 재생성

### 집회서 머리말 처리 방식 결정 (ADR-002)

- 머리말은 절 번호 없는 산문으로 기존 parser.py가 누락하고 있었음
- B안(별도 파일) 채택: `data/bible/sir-prologue.json`
- books.json에 `has_prologue: true` 플래그 추가
- 검색 범위에서 제외

### split_bible.py 작성 완료

- `output/parsed_bible.json` → `data/bible/{book_id}-{chapter}.json` (1328개)
- `data/bible/sir-prologue.json` 생성 (집회서 머리말, 2단락)
- `data/books.json` 생성 (73권 메타데이터)
- CLAUDE.md 및 데이터 파이프라인 문서 업데이트

### parser.py 버그 수정 — 물리적 장(physical chapter) 처리

- **발견**: 원문에 `아모 6:9`, `이사 41:6`처럼 같은 장 또는 다른 장의 절이 중간에 표기되는 경우가 있음
- **원인**: 공동번역성서는 성서학자들의 사본 연구를 반영해 절의 위치를 재배치한 번역. parser.py가 `책이름 장:절` 패턴을 모두 새 장 시작으로 인식해 48개 장 중복, 4개 장 교차(cross-chapter) 누락이 발생하고 있었음
- **결정**: 원문의 물리적 읽기 순서를 존중(A안). 학자들의 배열이 성서 읽기의 취지에 부합
- **수정 내용**:
  - 새 장 시작 조건: `(book_abbr, chapter_num)` 미개방 + 절 번호 == 1인 경우에만
  - 같은 장 재등장(`아모 6:9`): 동일 장의 절로 처리
  - 다른 장 삽입(`이사 41:6` in isa-40): `chapter_ref` 필드로 표기
- **결과**: 중복 48개 해소, cross-chapter 삽입 6곳 `chapter_ref` 표기
  - 이사야 40장 ← 41:6절, 잠언 5장 ← 6:22절, 호세아 14장 ← 13:14절 등
- **데이터 모델 변경**: `Verse`에 `chapter_ref: Optional[int]` 필드 추가

### 데이터 파이프라인 테스트 전략 수립 (ADR-004)

- 원본 텍스트 저작권 제약으로 CI에서 직접 사용 불가
- 픽스처 기반 접근 채택: 절 번호 시퀀스만 추출해 저장소에 커밋 (본문 미포함)
- 3단계 테스트 기준 정의:
  - Level 1 완전성: 73권, 1328개 장 파일, books.json 정합성
  - Level 2 순서 보존: 픽스처와 JSON 출력물 비교 (CI 가능)
  - Level 3 스냅샷: cross-chapter 6곳, 재배치 구간 고정값 검증
- 픽스처 생성 스크립트(`generate_fixtures.py`)와 테스트 코드 작성은 다음 세션으로 미룸

### ¶ 연속 줄 이어붙이기 처리 (parser.py)

- **발견**: 원문에서 하나의 절이 두 줄에 걸쳐 표기되고 둘째 줄이 `¶`로 시작하는 패턴 59곳 발견

  ```
  20 예루살렘과 유다는 야훼의 진노를 사 마침내 그 앞에서 쫓겨나고 말았다.
  ¶ 시드키야가 바빌론 왕에게 반기를 들었다.
  ```

- **원인**: `_parse_verse_line`이 `parts[0].isdigit()` 조건으로 파싱하므로 `¶`로 시작하는 줄을 `None` 반환 → 텍스트 유실

- **결정**: A안(이어붙이기) — `¶`를 단락 구분자로 유지하며 이전 절 텍스트에 `\n¶ ...`로 연결

- **수정**: `parse_file`의 continuation 처리 로직 추가

  ```python
  elif current_verses and line.strip().startswith('¶'):
      current_verses[-1].text += '\n' + line.strip()
      current_verses[-1].has_paragraph = True
  ```

- **결과**: 열왕기하 24:20 등 59곳 텍스트 완전 복구, `has_paragraph: true` 올바르게 설정

- parser.py → parsed_bible.json → data/bible/ 파이프라인 재실행 완료

### 다음 작업

- [ ] SPA 뼈대 구현 (index.html + app.js + router)

- [ ] 기본 성경 읽기 기능 구현

- [ ] 테스트 코드 작성 (generate_fixtures.py, test_completeness.py, test_ordering.py, test_snapshots.py)

## 2026-03-27

### README.md 재작성

- 워드프레스 중심 내용 삭제, SPA/PWA 아키텍처 기준으로 전면 재작성

### 절 표기 패턴 전수 조사 및 파서 확장 (ADR-003 v2)

- 원본 텍스트를 전수 조사하여 파서가 누락하던 패턴 4종 발견 및 처리 결정:

**1. 단락 연속 (¶ 또는 빈 줄)**

- ¶ 연속 59곳은 이전 세션에서 처리 완료
- 빈 줄 + 마커 없는 연속 줄 8곳 추가 발견 (출애굽기 2, 이사야 4, 오바댜 1, 요한복음 1)
- 모두 앞 절의 b단락 (새 단락 시작) → 앞 절 text에 `\n` 이어붙임, `has_paragraph=true`
- ¶와 빈 줄 연속을 동일 조건으로 통합 (`not line.strip()[0].isdigit()`)

**2. 절 범위 (**`17-18`**, 16곳)**

- `range_end: Optional[int]` 필드 추가
- 검색: 범위 내 모든 절 번호에 인덱싱

**3. 부분절 (**`2a/3b`**, 24곳)**

- 성서학자들의 절 분할·재배치. 판관기, 사무엘기, 욥기, 시편, 이사야서 등
- `part: Optional[str]` 필드 추가 (`"a"`, `"b"`)
- 검색: `"2a"` 형태로 인덱싱

**4. 사본 이중 번호 (**`1_1`**, 116곳)**

- 에스더서(106)·다니엘서(10) 그리스어 부가문. LXX vs 히브리어 사본 번호 병기

- `alt_ref: Optional[int]` 필드 추가 (밑줄 뒤 번호)

- 렌더링: 뒷 번호 위첨자 표시. 해당 장 JSON에 `has_dual_numbering: true` 플래그

- 검색: 앞 번호(LXX) 기준

- ADR-003 v2로 개정 (개정 이력 포함)

- 데이터 파이프라인 재실행 완료

### SPA 뼈대 구현 완료

- 5개 파일 생성:
  - `index.html`: SPA 진입점 (단일 HTML, 시맨틱 구조)
  - `app.js`: 해시 기반 라우팅 + DOM 렌더링 (Vanilla JS)
  - `style.css`: 모바일 우선 반응형 스타일 (세리프 한글 서체, WCAG 2.1 AA)
  - `sw.js`: 서비스 워커 (앱 셸 캐시 우선, 성경 데이터 네트워크 우선)
  - `manifest.webmanifest`: PWA 매니페스트
- 해시 라우팅 구조:
  - `#/` — 73권 목록 (구약 / 외경 / 신약 구분)
  - `#/{book_id}` — 장 선택 그리드
  - `#/{book_id}/{chapter}` — 본문 읽기 (절 번호, 단락 구분, 이전/다음 장 내비게이션)
  - `#/{book_id}/prologue` — 머리말 (집회서)
- 보안: `innerHTML` 미사용, 모든 DOM을 `createElement`/`textContent`로 생성
- 접근성: `aria-label`, `aria-live`, breadcrumb 내비게이션, `focus-visible`

### 기본 성경 읽기 기능 구현

- **이어읽기**: localStorage에 마지막 읽은 위치(`bookId`, `chapter`) 저장, 목록 화면 상단에 "이어읽기: ○○ N장" 배너 표시
- **사본 이중 번호 렌더링**: 에스델·다니엘 등 `alt_ref` 필드 → `1(2)` 형태 위첨자 표시, `has_dual_numbering` 장 상단에 안내 문구
- **절 범위 표시**: `range_end` 필드 → `14-15` 형태 절 번호 렌더링
- **부분절 표시**: `part` 필드 → `6a` 형태 절 번호 렌더링, DOM ID도 `v6a`로 구분
- **교차 참조 표시**: `chapter_ref` 필드 → `14(13장)` 형태로 원래 장 번호를 절 번호 옆에 괄호 표기 + 연한 배경색으로 시각적 구분

## 2026-03-28

### UX 기능 구현

- **장 선택 팝오버**: 본문 읽기 뷰 toolbar에 `N장` pill 버튼 추가, 탭 시 장 번호 그리드 팝오버 표시 (바깥 클릭 시 닫힘)
- **글자 크기 조절**: toolbar에 A-/A+ 버튼 (16\~24px 5단계), localStorage 저장
- **다크모드**: `prefers-color-scheme` 감지 + 수동 토글 (☾/☀), CSS 변수 기반 테마 전환
- **브레드크럼 구분 추가**: `목록 › 구약/외경/신약 › 책이름` 형태로 상위 구분 표시
- **헤더 레이아웃 개편**: 제목 가운데 정렬, toolbar(장 선택 + 글자 크기 + 테마)을 우측에 배치
- **용어 변경**: "제2경전" → "외경"

### ¶ 렌더링 수정

- **¶ 기호 표시**: 기존에 `replace(/^¶\s*/, "")`로 제거하던 것을 `<span class="pilcrow">¶</span>`으로 렌더링, 색상은 `--paragraph-mark` CSS 변수
- **절 중간 단락 나눔**: 절 텍스트에 `\n¶`가 포함된 경우 (parser.py가 이어붙인 연속 줄), `paragraph-break`로 시각적 단락 분리. 절 번호는 첫 파트에만 표시

### 복사 시 출처 메타데이터 자동 추가

- 본문 선택 후 복사 시 클립보드에 출처 정보 자동 첨부: `— 창세기 1:1-3 (공동번역성서)`
- 단락 나뉨이 있는 절은 a/b로 구분: `data-vref` 속성으로 각 파트 식별
  - 단락 없는 절: `data-vref="2"` → `2`
  - 단락 있는 절: 첫 파트 `data-vref="5a"`, 둘째 `data-vref="5b"`
  - 예: 역대기상 22:2\~5절 첫 단락 선택 → `— 역대기상 22:2-5a (공동번역성서)`

### 네비게이션 및 헤더 개편

- **브레드크럼 division 팝오버**: 브레드크럼의 구약/외경/신약 항목을 클릭하면 3개 division 세로 목록 팝오버 표시, 선택 시 `/#/{division}` 페이지로 이동
- **division 페이지 (`/#/{division}`)**: 구약/외경/신약 별도 라우트 페이지 추가, 이어읽기 배너 포함
- **제목 division 피커**: division 페이지 제목을 클릭 가능한 버튼으로 변경, 장 선택 피커와 동일한 스타일 (CSS 셰브론 포함)
- **설정 팝오버**: 기존 toolbar(A-/A+, 다크모드 토글)를 제거하고 브레드크럼 행 우측에 ⚙ 설정 버튼으로 대체. 클릭 시 글자 크기·테마 설정 팝오버 표시. 모든 페이지에서 항상 접근 가능
- **헤더 구조 변경**: `#header-row` + `#toolbar` → `#breadcrumb-row`(브레드크럼 + 설정 버튼) + `#page-title` 구조로 단순화

### 접근성(A11y) 구현

- **스킵 내비게이션**: Tab 키 시 "본문 바로가기" 링크 표시, `#app`으로 점프
- **SPA 라우트 변경 알림**: `aria-live="polite"` 영역을 통해 페이지 전환 시 스크린리더에 페이지 제목 알림
- **Escape 키 팝오버 닫기**: 모든 팝오버(장 선택, division, 설정) Escape로 닫기 + 트리거 버튼에 포커스 복귀
- **랜드마크 라벨**: `<main aria-label="성경 본문">`, `<footer aria-label="사이트 정보">`
- **설정 변경 알림**: 글자 크기 변경 시 "글자 크기 20px", 테마 전환 시 "다크 모드"/"라이트 모드" 스크린리더 알림
- **팝오버 ARIA**: 모든 팝오버에 `role="listbox"` + `aria-label`, 트리거 버튼에 `aria-expanded` 상태 관리
- **절 번호 스크린리더 처리**: 연속 읽기 시 절 번호 숨김(`aria-hidden`), 절 텍스트 클릭/탭 시 "N절" 온디맨드 알림(`announce()`)
- **`.sr-only` 유틸리티**: 시각적으로 숨기되 스크린리더에는 보이는 CSS 클래스

### 오디오 플레이어 구현

- **푸터 → 설정 팝오버 이동**: `<footer>` 제거, 저작권 표기·GitHub 링크를 설정(⚙) 팝오버 하단으로 이동. 하단 영역을 오디오 플레이어 전용으로 확보
- **Sticky bottom bar 오디오 플레이어**: 장(chapter) 뷰·머리말(prologue) 뷰 진입 시 하단에 오디오 플레이어 표시
  - 재생/일시정지 버튼 (CSS 아이콘), 프로그레스 바 (재생 구간 accent 색 채움), 시간 표시
  - 반투명 배경 + `backdrop-filter: blur` 처리
  - 장 이동 시 이전 오디오 정지 후 새 오디오 로드
  - 오디오 파일 없는 경우 (토비트): static 위치에 "🎧 오디오 파일을 준비 중입니다." 메시지 (스크롤하면 사라짐)
- **키보드 단축키**: Space 키로 재생/정지 토글 (입력 필드 외)
- **접근성**: `aria-label`(재생/일시정지/재생 위치), `announce()` 상태 알림, 프로그레스 바 `role="slider"`
- **집회서 머리말 오디오**: `sir-0.mp3` 재생 지원 (`showAudioPlayer(book.id, 0)`)
- **이어읽기 머리말 지원**: `saveReadingPosition(bookId, "prologue")` 저장, 이어읽기 배너에 "머리말" 표시

### 책 목록 그리드 UI 개선

- **버튼 높이 통일**: `display: flex; align-items: center; height: 100%`로 같은 행 내 동일 높이
- **텍스트 가운데 정렬**: `justify-content: center; text-align: center`
- **단어 단위 줄바꿈**: `word-break: keep-all`로 한국어 단어가 잘리지 않게 처리

### 다음 작업

- [ ] 테스트 코드 작성

- [ ] PWA 아이콘 생성 (static/icon-192.png, static/icon-512.png)

## 2026-03-29

### 전역 검색 기능 구현 (3단계 핵심)

- **검색 인덱스 생성**: `src/search_indexer.py` 작성. `data/bible/*.json` → `data/search-index.json` (35,482절, 301개 별칭, 6.51MB)
  - `meta.aliases`: `book_mappings.json`의 `korean_name` + `aliases_ko` → book `id` 매핑
  - `meta.books`: 정렬 인덱스(`bo`) + 한국어 이름
  - 텍스트 클리닝: `¶` 제거, `\n` → 공백. 프롤로그 제외
  - `.gitignore`에 `data/search-index.json` 추가

- **Web Worker 검색 엔진**: `search-worker.js` (프로젝트 루트) 신규 생성
  - 메시지 프로토콜: `init` → `ready`, `search` → `results`/`error`
  - 절 참조 감지: 정규식으로 "창세 1:3" 패턴 인식 → `meta.aliases`로 bookId 변환
  - 전문 검색: 선형 스캔 + `String.includes` (대소문자 무시), 페이지네이션 슬라이스

- **반응형 검색 UI**:
  - **데스크탑 (≥769px)**: 브레드크럼 행 우측 인라인 검색바 (pill 형태, 포커스 시 확장). 400ms 디바운스 → `#/search?q=...` 해시 라우트. 결과는 메인 영역에 렌더링
  - **모바일 (≤768px)**: FAB 버튼 → 바텀시트(Bottom Sheet) 패턴. 드래그 핸들로 높이 조절 (30%~90vh), 아래로 많이 내리면 자동 닫힘. 결과는 시트 내부 렌더링
  - 브라우저 네이티브 검색 × 버튼 숨김 (커스텀 클리어 버튼 사용)

- **동적 페이지네이션**: 데스크탑·모바일 모두 뷰포트/시트 높이 기반으로 pageSize 자동 계산 (고정 50건 → 화면 맞춤)

- **검색 결과 → 본문 하이라이트**:
  - 검색 결과 클릭 시 `#/{bookId}/{chapter}?hl=검색어&v=절` 해시로 이동
  - `renderChapter`에서 `<mark class="search-highlight">` 래핑 + 해당 절 `.verse-highlight` 클래스 + 자동 스크롤

- **서비스 워커 업데이트**: `CACHE_NAME` → `"bible-v2"`, `SHELL_FILES`에 `search-worker.js` 추가, `data/search-index.json` 네트워크 우선 캐싱

- **헤더 여백 조정**: `#page-title`에 상하 마진 추가 (상 0.3rem, 하 0.2rem)

### ADR-005: 검색 인덱싱 전략

- 플랫 JSON 배열 + 선형 스캔 방식 채택 (C안)
- 검토한 대안: A안(외부 라이브러리 lunr.js 등), B안(역색인)
- 채택 근거: 35,482절은 선형 스캔으로 수십 ms 이내 처리 가능, 한국어 교착어 특성상 부분 문자열 매칭이 역색인보다 자연스러움, 외부 의존성 제로
- 향후 코퍼스 10만 건 이상 확장 시 역색인 또는 `Intl.Segmenter` 기반 토크나이저 재검토

### 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `src/search_indexer.py` | 신규 — 검색 인덱스 생성 스크립트 |
| `search-worker.js` | 신규 — Web Worker 검색 엔진 |
| `index.html` | 수정 — 인라인 검색바, FAB, 바텀시트 마크업 |
| `app.js` | 수정 — 해시 라우팅 확장, Worker 통합, 검색 UI, 하이라이트 |
| `style.css` | 수정 — 검색바, FAB, 바텀시트, 하이라이트, 페이지네이션 스타일 |
| `sw.js` | 수정 — 캐싱 전략 추가, 버전 범프 |
| `.gitignore` | 수정 — `data/search-index.json` 추가 |
| `docs/prd.md` | 수정 — 3단계 체크리스트 갱신, 검색 UI 상세 추가 |

### 다음 작업

- [ ] 테스트 코드 작성
- [ ] PWA 아이콘 생성 (static/icon-192.png, static/icon-512.png)
- [ ] 정적 파일 배포 설정 및 보안 검토
- [ ] 성능 최적화 및 오류 로깅 체계 구축