---
date: 2026-05-12
pr: 122
branch: feat/verse-select-copy-button
title: "feat: 절 선택 화면에 복사 버튼 + 모바일 long-press 콜아웃 차단"
---

# feat: 절 선택 화면에 복사 버튼 + 모바일 long-press 콜아웃 차단

## 요약
- 절 선택 모드 액션 바에 **복사** 버튼 추가 (북마크 옆). 선택한 절을 본문 + 인용 출처(`— 책 장:절 (공동번역성서)`) 형태로 클립보드에 쓰고 알림 후 선택 모드 종료.
- 모바일에서 본문을 long-press할 때 OS 텍스트 선택 콜아웃(복사·공유·사전 등)이 떠 절 선택 모드 진입과 충돌하던 문제 차단.
- **순수 운문 multi-part 절은 통째로 선택** — 시편·잠언·전도서·아가·지혜서·집회서 등에서 한 줄을 탭/드래그/롱프레스해도 그 절의 모든 줄이 함께 선택·해제. 시 본문에서 연 하나만 발췌하는 어색함 해소. 혼합(운문+산문) 절과 단일 span 절은 기존대로.
- 부수: TypeScript를 로컬 devDependency로 잠금 (`npm run typecheck` 한 줄 실행). 중복돼 있던 verse-range → plain text 직렬화 로직을 `serializeVerseRange`로 일원화.

## 변경

### `feat: 절 선택 화면에 복사 버튼 추가`
- `index.html` — `#verse-select-copy-btn` 추가 (북마크-취소 사이)
- `css/style.css` — 강조색 외곽선 스타일
- `js/app/bookmark.js` — `copySelectedVerses()` + 비활성화 동기화 + 클릭 핸들러. 비연속 선택은 그룹별 빈 줄 구분, stanza/paragraph/hemistich 줄바꿈은 article 레벨 copy 핸들러와 동일 톤.

### `chore: TypeScript를 로컬 devDependency로 추가`
- `package.json` / `package-lock.json` 신규 — typescript ^5.7.2 (설치본 5.9.3), `npm run typecheck` / `npm test` 스크립트
- `.gitignore` — `node_modules/` 추가

### `fix: 모바일 본문 long-press 시 OS 콜아웃 차단`
- `css/style.css` — `@media (hover: none) and (pointer: coarse)`에서 `.chapter-text .verse`에 `-webkit-touch-callout: none` + `user-select: none`. 데스크톱은 그대로.
- 시스템 사전 접근은 별개 의제로 보류 — 본문 long-press를 OS에 양보해야 사전이 살아나므로 절 선택 진입 경로(설정 토글 등) 따로 설계 필요.

### `feat: 순수 운문 절은 통째로 선택 + 공통 직렬화 함수 추출`
- `js/app/views-routing.js` — `_verseSelectionUnit(article, vref)` 모듈 톱레벨 추출 (VERSE_SELECTION 마커). pointerdown/up/move 세 진입점에서 동일 분기 사용. article 레벨 copy 핸들러는 `serializeVerseRange` 호출로 단축.
- `js/app/bookmark.js` — `serializeVerseRange(firstNode, lastNode)` 신규 (VERSE_SERIALIZE 마커). `copySelectedVerses`가 이 헬퍼 호출로 줄어듦. 복사 버튼과 system-copy 핸들러가 동일 출력 보장.
- `tests/unit/views-routing.test.js` — 6 케이스 추가 (단일 span / 순수 운문 multi-part / 순수 산문 multi-part / 혼합 / 절 경계 격리 / null 방어)
- `tests/e2e/test_copy.py` — 4 케이스 추가 (복사 버튼 텍스트+인용 / 절 0건 비활성화 / 시편 1:1 통째 선택 / 통째 해제)
- `docs/qa/2026-05-12-unit-verse-selection.md` — 비기술 독자용 QA 보고서

## Test plan
- [x] `npm test` — 491 케이스 통과 (485 → 491, +6)
- [x] `npm run typecheck` — main + worker 0 error
- [x] 신규 e2e 4 케이스 통과 (`pytest tests/e2e/test_copy.py`)
- [ ] 로컬 e2e 추가 확인: 복사 → 다른 앱에 붙여넣어 포맷 검증
- [ ] iOS Safari / Android Chrome에서 본문 long-press 시 OS 콜아웃 차단 확인
- [ ] 데스크톱(마우스)에서 본문 드래그 선택 + Cmd/Ctrl+C → 인용 포함 복사 정상 동작 확인
- [ ] 시(詩) 본문(시편 등)에서 stanza/hemistich 줄바꿈 보존 확인
- [ ] 클립보드 권한 거부 시 "복사에 실패했습니다." 알림 확인

## 알려진 무관 e2e 회귀 (이 PR 범위 밖)
전체 e2e 실행 시 17건 실패하지만 baseline(이 PR 이전)에서도 동일하게 실패 — 이 PR이 도입한 것 아님. 대부분 ADR-018(app.js 모듈 분할) 잔여나 누적 회귀:
- `test_bookmark_export_import.py` 5건: `exportBookmarks`가 bare global이 아니라 `window`에 노출 안 됨 (ADR-018 후속)
- `test_a11y_axe.py` 4건: `#search-input` aria-allowed-attr 위반
- `test_drive_sync*.py` 4건: PKCE callback 후 상태머신 `DISABLED` 반환 (기대값 `NEEDS_CONSENT`)
- 나머지 4건: a11y_keyboard / audio_controls / bookmark 흐름

별도 PR로 정리 의제.
