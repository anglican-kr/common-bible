# GEMINI.md

이 파일은 공동번역성서 PWA 프로젝트의 아키텍처, 개발 가이드라인 및 워크플로우를 정의합니다. Gemini CLI 에이전트는 이 지침을 최우선으로 준수해야 합니다.

## 1. 프로젝트 개요
- **목적:** 대한성공회 공동번역성서의 디지털 독서 경험 제공 및 접근성 최적화(시각 장애인 지원).
- **핵심 가치:** 접근성 최우선(WCAG 2.1 AA), 오프라인 우선(Offline-first), 고성능 정적 앱.
- **아키텍처:** 프레임워크 없는 Vanilla JS 기반 SPA. 데이터는 JSON 형태로 페칭하여 렌더링.

## 2. 기술 스택
- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+).
- **Data:** JSON (장별 분할, `data/bible/`에 위치).
- **Backend:** 없음 (완전한 정적 사이트).
- **Search:** Web Worker 기반의 클라이언트 측 Full-text 검색 (`js/search-worker.js`).
- **Data Pipeline:** Python 3.12+ (마크다운 파싱 및 JSON 생성).
- **CI/CD:** Shell script (`scripts/build-deploy.sh`).

## 3. 프로젝트 구조
- `index.html`: SPA 진입점.
- `js/app.js`: 라우팅, 렌더링, 전반적인 앱 로직.
- `js/pre-fetch.js`: 성능 최적화를 위한 초기 데이터 조기 페칭.
- `js/search-worker.js`: 검색 인덱스 처리 및 검색 로직.
- `css/style.css`: 전체 스타일 (Vanilla CSS).
- `sw.js`: PWA 서비스 워커 및 캐싱 전략.
- `data/`: 성경 데이터 및 검색 인덱스 JSON 파일들.
- `src/`: 데이터 전처리를 위한 Python 소스 코드.
- `scripts/`: 빌드, 배포, 릴리즈 관련 스크립트.
- `docs/`: PRD, ADR(Architecture Decision Records), 작업 일지.

## 4. 개발 가이드라인
### 4.1 접근성 (Accessibility)
- 모든 인터랙티브 요소는 키보드로 접근 가능해야 하며 적절한 `aria-label`을 가져야 함.
- 절 번호나 단락 기호 등 스크린 리더에서 읽지 않아야 할 요소는 `aria-hidden="true"` 적용.
- 본문 복사 시 절 번호를 제외하고 출처를 자동 추가하는 로직 유지 (`app.js` 내 copy 핸들러).

### 4.2 성능 최적화
- **Critical CSS:** `index.html` 내부에 인라인 스타일로 핵심 레이아웃 유지. 스타일 수정 시 CSP 해시(`style-src`) 업데이트 필수.
- **Pre-fetching:** `js/pre-fetch.js`를 통해 `books.json`을 조기에 페칭하여 초기 렌더링 속도 개선.
- **Smooth Launch:** 2초간의 부드러운 페이드아웃 애니메이션과 GPU 가속(`will-change`) 적용. 끊김 방지를 위해 `renderBookList` 등 무거운 DOM 작업 시작 전에 `dismissLaunchScreen()`을 먼저 호출함.
- **Deferred Init:** GA 등 비핵심 로직은 `requestIdleCallback`을 사용하여 지연 실행.

### 4.3 보안 (CSP)
- `index.html`에 엄격한 Content-Security-Policy가 적용되어 있음.
- 인라인 스크립트 지양. 부득이하게 인라인 스타일 수정 시 해당 해시값을 CSP 메타 태그에 업데이트해야 함.

## 5. 주요 워크플로우
### 5.1 데이터 업데이트
성경 텍스트 수정 시 다음 순서로 실행 (Python 환경 필요):
1. `python src/parser.py data/source/ --save-json output/parsed_bible.json`
2. `python src/split_bible.py`
3. `python src/search_indexer.py`

### 5.2 릴리즈 및 배포
1. 버전 업데이트 및 캐시 갱신: `python scripts/release.py patch` (또는 minor/major)
   - 이 스크립트는 `version.json` 업데이트 및 `sw.js`의 `CACHE_NAME`을 자동 갱신함.
2. 배포 패키지 생성: `scripts/build-deploy.sh`
   - 루트 디렉토리에 `deploy-YYYYMMDD-HHMMSS.zip` 파일이 생성됨.

### 5.3 테스트
- 단위 테스트 및 완전성 검증: `pytest tests/test_completeness.py`
- Playwright 기반 로딩 성능 검증: `python tests/verify_loading.py` (Chrome 필요)

## 6. 주의 사항
- `sw.js`의 `CACHE_NAME`은 `release.py`에 의해 관리되므로 수동 수정을 지양함.
- `data/source/`는 비공개 서브모듈이므로 외부 유출에 주의함.
- 외부 라이브러리 추가 전 반드시 `docs/decisions/`의 ADR을 확인하여 프로젝트 철학(No Framework, No Heavy Library)과 일치하는지 검토함.
