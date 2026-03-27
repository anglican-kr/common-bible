# 작업 일지

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

### 알려진 이슈

- [ ] ¶ 기호가 렌더링에서 제거되고 새 단락으로 시작됨 (원문 기호 보존 필요)

- [ ] 단락 중간 줄바꿈 ¶ 기호만 표시되고 새 단락으로 바뀌지 않음

- [ ] 상단 헤더 레이아웃 재배열 필요

### 다음 작업

- [ ] ¶ 렌더링 로직 수정

- [ ] 헤더 레이아웃 개선

- [ ] 테스트 코드 작성

- [ ] PWA 아이콘 생성 (static/icon-192.png, static/icon-512.png)