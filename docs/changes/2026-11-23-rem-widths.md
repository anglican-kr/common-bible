---
pr: 645
date: 2026-11-23
branch: style/rem-widths
title: "style: 글자를 담는 칸의 폭을 rem으로 맞추기"
---

## 요약

본문 칸, 시트, 막대, 옆 패널, 대화상자의 폭을 px에서 rem으로 바꿔, 글자 크기 설정을 바꾸면 이 칸들이 같은 비율로 커지고 작아지게 했다(ADR-055. ADR-050 §4를 대체한다). 본문 칸은 40rem이라 글자 크기 16px에서 640px, 24px에서 960px이고, 넓은 화면의 한 줄은 어느 글자 크기에서나 한글 40자다. 기본 글자 크기(18px)에서는 모든 폭이 전과 1px 안에서 같다. 옆 패널을 끌어 줄일 수 있는 가장 좁은 폭도 rem으로 바꿨다. 설계 문서 `design/responsive-composition.md` §7의 2다.

## 확정 · 근거

- **글자를 담는 칸의 폭을 모두 rem으로 맞춘다**(사용자 결정 2026-11-23). 설계 문서 §6의 2에서 권한 안이다. 본문 칸만 rem으로 바꾸면 시트와 막대와의 비율이 글자 크기마다 달라진다(설계 문서 §4.1, 사용자 지적 2026-11-21).
- **본문 칸은 40rem으로 dev에서 써 본다**(사용자 동의 2026-11-23). 설계 문서 §6의 1(720px로 둘지, 40rem으로 할지)은 실제 기기에서 며칠 써 보고 정하기로 했다. rem으로 맞추면 본문 칸만 px로 남길 수 없으므로 40rem을 dev.anglican.kr에 올리고, 운영(720px)과 견주어 운영에 내기 전에 확정한다. 720px로 돌아가면 ADR-055 §2와 `--max-width`를 함께 고친다. 확정할 일은 `topics/design-system.md` 「남은 일」에 적었다.
- **값은 18px에서 전의 px 폭에 가장 가까운 0.1rem 단위다.** 420px은 23.3rem, 440px은 24.4rem, 380px은 21.1rem, 240px은 13.3rem이다. 설계 문서 §4.1에 적은 값과 같다.
- **바뀌는 화면.** 세로로 든 휴대폰의 본문 칸은 그대로다(40rem이 화면보다 넓다). 가로로 든 휴대폰과 세로로 든 iPad는 글자 크기를 키우면 본문 칸이 화면 폭까지 넓어진다. 폭 390px 휴대폰의 글자 16px에서는 20rem 대화상자가 320px, 옮기기 대화상자가 338px로 전(359px)보다 좁다. 18px 이상에서는 화면 폭의 92%가 정해 전과 같다.
- **px로 남긴 것.** 레이아웃 결정 조건, 테두리, 안전 영역, 누르는 자리 44px, 아이콘, 스위치(51-52px), 시트의 손잡이, 색 견본, 여백이다(ADR-055 §3). 쓰이지 않는 예약 토큰 `--sidebar-w`(260px)는 그대로 두었다.
- **옆 패널을 끌어 줄이는 하한**은 `overlay.js`의 `attachSheetResize`가 끌기를 시작할 때마다 그때의 글자 크기로 계산한다. 설정에서 글자 크기를 바꾼 뒤에도 맞다. 끌어 바꾼 폭은 전처럼 px로 남고, 패널을 닫으면 지운다.

## 검증

- 유닛: `node --test tests/unit/*.test.js` 1,991건 통과. 타입 검사(`npm run typecheck`) 통과.
  - 새 유닛 2건. `helpers.test.js`는 `css/style.css`에서 100px 이상의 px 폭과 40rem이 아닌 `--max-width`를 찾는다. 옮기기 대화상자를 380px로 되돌리면 실패한다. `overlay.test.js`는 옆 패널 폭 조절의 하한이 글자 크기(24px, 16px)를 따르는지 본다. 하한을 18px 기준의 고정값으로 바꾸면 실패한다. 하한 시험에는 상한(창 폭의 85%)도 더했다.
- e2e: 새 `test_rem_widths.py` 22건 통과. 바꾸기 전의 `css/style.css`로 돌리면 12건이 실패한다(데스크톱과 가로로 든 휴대폰의 본문 칸 4건, 옆 패널 6건, 데스크톱의 대화상자 2건). 휴대폰의 대화상자 2건은 전에도 화면 폭의 92%가 정해 통과한다. 이 시험은 화면을 넘지 않는지 본다.
- 관련 e2e: `test_rem_widths.py`, `test_layout_tiers.py`, `test_top_bar.py`, `test_cite_sheet.py`, `test_bookmark.py`, `test_search.py`, `test_calendar_view.py`, `test_audio_controls.py`, `test_bookmark_select_delete.py`, `test_bookmark_folders.py`, `test_bookmark_export_import.py`, `test_install_guide.py`, `test_settings.py`의 484건 가운데 483건 통과. 실패한 `test_calendar_view.py`의 `test_tab_in_scrolled_list_goes_back_to_today`는 dev(`192930f`)의 코드에서도 실패하는 날짜 탓의 시험 문제라 이 PR에서 고치지 않고 known-issues §59로 남겼다. 오늘부터 70일 뒤(2027-02-01)가 달의 첫날이라 앱이 달 이름부터 상단 바 아래에 둔다(`calendar.js`의 `scrollToRow`).
- 실측(2026-11-23, Chromium, 폭 1,280px 창의 요한 1장): 본문 칸 안의 한 줄은 글자 크기 16, 18, 20, 22, 24px에서 모두 한글 40자다. 전의 720px 칸에서는 46, 40, 36, 33, 30자였다(설계 문서 §2.1).

## 갱신한 문서

- `docs/decisions/055-rem-widths.md`: 새 ADR.
- `docs/decisions/050-layout-tiers.md`: 상태, 「요약」 4, §4 첫머리에 ADR-055가 대체했다고 적었다.
- `docs/decisions/043-desktop-top-bar.md` §1: "본문 칼럼(720px)"을 `--max-width`로 고쳤다.
- `DESIGN.md` §4 「레이아웃」: `--max-width` 40rem과 칸의 폭을 rem으로 적는 규칙.
- `docs/design/responsive-composition.md`: 상위 결정에 ADR-055, §2.1에 지금의 한 줄 길이, §4.1을 ADR-055를 가리키는 줄로 줄였다. §6의 1과 2, §7의 2.
- `docs/topics/design-system.md`: 「지금 동작」에 "칸의 폭", 「결정」에 ADR-055, 「남은 일」에 본문 칸 40rem의 확정, known-issues §22에 이 PR이 디자인 시스템 아티팩트를 맞추지 않은 것.
- `docs/architecture.md` 부록 A: ADR-055 줄.
- `tests/README.md`: `helpers.test.js`(98건), `overlay.test.js`(30건. 전의 27건은 이미 맞지 않았다), `test_rem_widths.py`(22건) 줄.
- `docs/known-issues.md` §59와 `docs/topics/liturgical.md` 「남은 일」: 캘린더 목록의 뒤로 가기 e2e가 70일 뒤가 달의 첫날인 날 실패하는 것.

## 리뷰 반영

1회차(`/code-review medium --fix`, 사소한 것 세 건):

- **ADR-055 §4가 폭 390px 휴대폰의 20rem 대화상자를 "20px부터" 화면 폭의 92%라고 적었다.** 18px에서 20rem은 360px이라 이미 92%(359px)보다 넓다. "18px부터"로 고쳤다.
- **px 폭을 막는 유닛 시험이 `;`와 `{` 바로 뒤의 선언만 보았다.** 중첩 규칙을 닫는 `}` 바로 뒤의 선언도 보게 넓혔다. 넓혀서 새로 걸리는 선언은 없다.
- **옆 패널 끌기 하한이 글자 크기를 읽지 못할 때의 대체값이 16px였다.** 앱의 기본 글자 크기와 같은 18px로 고쳤다.

중요한 지적이 없어 리뷰를 멈췄다.
