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
  - Python: html_generator.py, wordpress_api.py, pwa_builder.py, __init__.py, run.py, setup.py
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
  - 장기 로드맵(Phase 1~4) 추가
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

### 다음 작업
- [ ] SPA 뼈대 구현 (index.html + app.js + router)
- [ ] 기본 성경 읽기 기능 구현
