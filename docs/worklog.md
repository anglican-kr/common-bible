# 작업 일지

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