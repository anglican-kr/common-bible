---
date: 2026-07-10
pr: 301
branch: docs/adr-036-liturgical-calendar
title: "docs: ADR-036 확정 + ADR-037·038 신설 — 감사성찬례 전례독서 설계"
---

# docs: ADR-036 확정 + ADR-037·038 신설 — 감사성찬례 전례독서 설계

## 요약

감사성찬례 전례독서 기능(데이터→엔진→UI→검색)의 설계 문서 묶음입니다. 구현 계획 승인(2026-07-04)에 따라 ADR-036을 확정하고 새 ADR 두 편을 추가합니다.

### ADR-036 (개정·확정)
- 스크래핑 워크스페이스 `common-bible-data/liturgical/` 이전·재수집(838기사) 경위 기록
- §2 요일·주기 축 병합 규칙(weekday 501→65, 전체 782→326 entries)
- §3 **송영 분리** 개정 — 본기도 열거(당일+성인축일+축성일) 시 송영 상수 3종 중 1회만 부착
- 상태: 제안됨 → **승인됨 — 구현 대기**

### ADR-037 (신설) — 전례독서 데이터 모델·교회력 엔진
- `eucharist-readings.json` 좌표 스키마: 한 레코드 = (교회력일 × 트랙 × 대안 세트), refs 배열이 장 경계 표현, verseSpec은 북마크 문법 재사용
- 전례시편 별도 책 `lps`(계응 구조 새 마크다운 DSL, division 필터로 숨김)
- 연중 주간 날짜 구간표(기도서 기반, 주간당 구간 최대 2개) + KASI 음력 표
- `liturgical-engine.js`: computus·대림 앵커·후보 관측일 전체 보존. 품계·이동 엔진은 분류 필드 2차와 함께 후속

### ADR-038 (신설) — 캘린더·전례독서 뷰·검색 이원화 UI
- 캘린더 탭(홈 옆 두 번째), 월간·주간·목록 3뷰
- `/lectionary/YYYY-MM-DD` 독서 뷰: 본기도 → 제1독서 → 시편 → 제2독서 → 복음, 본기도 대체안 탭 + 관측일 열거, 계응 시편 조판, 세트/트랙 전환
- 검색 화면 상단 탭으로 성서 본문/전례독서 이원화

### 기타
- architecture.md 부록 A에 036~038 인덱스 추가

## 구현 TODO (각 단계 별도 브랜치)

### 데이터 저장소 (common-bible-data)
- [ ] **D1** `feat/liturgical-psalter` — 전례시편(계응): `extract_psalter.py`(html 캐시→md, 영광송 분리) + 시편 DSL `psalter/*.md` + 파서 `src/liturgical_psalter.py` → `bible/lps-*.json` + books.json(`division:"liturgical"` 숨김) + 송가 부록 장 + build.yml·매니페스트 편입 + `test_psalter.py` + **ADR-039**(DSL)
- [ ] **D2** `feat/lectionary-data` — 독서 데이터: liturgical/ 워크스페이스 정식 커밋 + `coords.py` 추출 + `book_mappings.json` 별칭 보강 + `parse_readings.py` → `lectionary/eucharist-readings.json`(대안 세트 explode·장 경계 refs) + `search-lectionary.json` + 본기도 송영 분리(`ending` 코드) + `kasi-lunar.json` + `test_lectionary.py`
- [ ] **D3** `feat/ordinal-weeks` — 연중 주간 구간표: `ordinal-weeks.txt`(**사용자 표 입력**) + 파싱 스크립트 → `ordinal-weeks.json` + 구간 검증 pytest

### 앱 저장소 (common-bible)
- [ ] **A1** `feat/liturgical-engine` — 교회력 엔진 `js/app/liturgical-engine.js`(computus·대림 앵커·연중표·음력·`resolveDate` 후보 보존·좌표 폴백 조회) + sw.js `/data/lectionary/` 캐시 라우팅 + data 서브모듈 bump + 부활절 회귀표 유닛
- [ ] **A2** `feat/calendar-tab` — 캘린더 탭(홈 옆 두 번째) + `/calendar` 월간·주간·목록 3뷰 + 유닛·e2e
- [ ] **A3** `feat/lectionary-view` — `/lectionary/YYYY-MM-DD` 독서 뷰: 본기도 열거+대체안 탭+송영 상수·계응 시편 조판·세트/트랙 전환·관측일 스위처 + 유닛·e2e
- [ ] **A4** `feat/lectionary-search` — 검색 이원화: 상단 탭(성서 본문|전례독서) + 워커 lectionary 모드 + 결과 카드 + 유닛·e2e

### 사용자 입력·확인 필요
- [ ] 연중 주간 ↔ 날짜 구간표 타이핑 (성공회 기도서, D3)
- [ ] 본기도 송영 상수 3종 선택 원칙 확인 (성부/성자/성령 초점별 — 기도서)
- [ ] 시편 갭 리포트 검토 (스크랩에 없는 편 보충 여부, D1 후)

### 후속 (이번 범위 밖)
- 품계·이동(transfer) 엔진 + 분류 필드 2차 + 전례색 정식 (ADR-036 §6–8)
- **성인력 2차** (ADR-036 「성인력 보완 영역」): 전체 성인력 + `sanctoral_class` + 영명축일·성당축성일 오버레이(`scope`) + **성인 공통 본기도(Common)** — 본문의 성인 이름 자리를 변수 처리(복수 성인 함께 기리는 날 대비 이름 배열 + 연결 규칙), 사용자 타이핑 축일 본기도(마크다운) 병합
- 본기도 `_review` 공식 기도서 대조 (ADR-036 미결8) + 송영 상수 3종 `ending` 코드 배정
- 저녁·아침기도 기사 버킷 → Phase 4 성무일과

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation-only ADR and architecture index updates; no app or data pipeline code ships in this PR. Future implementation spans large liturgical surface area but risk here is limited to design drift if ADRs diverge from build.
> 
> **Overview**
> **감사성찬례 전례독서**(데이터 → 엔진 → UI → 검색) 구현 전 설계를 문서로 고정한다. 런타임 코드 변경은 없다.
> 
> **ADR-036**을 **승인·구현 대기**로 확정하고, 스크랩 워크스페이스 이전·재수집, 요일·주기 축 병합(782→326 entries), **송영을 본문에서 분리**(`ending` + 앱 상수 3종), 제목 정규화·품계·밀린 독서 보존 등을 반영한다.
> 
> **ADR-037**(신설)은 `eucharist-readings.json` 좌표 스키마(트랙·대안 세트 explode, `verseSpec`·`refs`), 전례시편 책 `lps`, `liturgical-engine.js`(computus·후보 관측일), `search-lectionary.json`, D1~A1 구현 순서를 정한다.
> 
> **ADR-038**(신설)은 홈 옆 **캘린더 탭**, `/lectionary/YYYY-MM-DD` 독서 뷰(본기도·계응 시편·트랙/세트), 검색 **성서/전례독서** 이원화를 정한다.
> 
> `architecture.md` 부록 A에 036~038 인덱스를 추가하고, `known-issues.md`에 곱슬 따옴표 전환(전례시편·`source/`·검색 정규화) 후속을 기록한다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 5013022e8d7b38b688c2293403efdeeecb6189c2. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
