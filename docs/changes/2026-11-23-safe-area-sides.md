---
pr: 646
date: 2026-11-23
branch: fix/safe-area-sides
title: "fix: 본문 칸이 좌우 안전 영역을 넘지 않게 하기"
---

## 요약

가로로 든 아이폰에서 큰 글자를 쓰면 다이내믹 아일랜드가 본문을 가리던 것을 고쳤다. #645가 본문 칸을 40rem으로 바꾸면서 22px과 24px에서 칸이 화면 끝까지 넓어졌는데, 좌우 안전 영역을 고려한 곳이 없었다. `--max-width`의 상한을 화면 폭에서 좌우 안전 영역 가운데 넓은 쪽의 두 배를 뺀 폭으로 했다(ADR-055 §4 제자리 갱신). 이 값을 쓰는 아홉 곳(본문 칸, 헤더, 바텀 시트, 막대)이 모두 안전 영역 밖에 놓인다.

## 확정 · 근거

- **회귀였다**(사용자 실기기 확인 2026-11-23, iPhone 17 가로, 가장 큰 글자와 그 아래 단계). 720px 칸일 때는 앱 화면 폭 874pt의 양옆에 77pt씩 남아 아일랜드 쪽 안전 영역(62pt쯤)을 우연히 피했다. 40rem 칸은 22px에서 880px, 24px에서 960px이라 화면 폭이 되었고, 절 번호가 화면 왼쪽 16px에서 시작했다.
- **값 하나로 고쳤다.** 아홉 곳 모두 `margin: auto`로 가운데에 두므로 `--max-width`에 상한을 넣으면 모두 안전 영역을 피한다. 18px과 20px의 칸(720px, 800px)은 안전 영역을 뺀 750px 안에 들어가 그대로다. 22px과 24px은 750px이다.
- **넓은 쪽의 두 배를 뺀다.** 칸을 가운데에 두므로 양쪽 안전 영역의 합을 빼면, 한쪽에만 안전 영역이 있는 기기(카메라 구멍이 한쪽에 있는 안드로이드)에서 칸이 그쪽에 절반만큼 걸친다.
- **ADR-055를 제자리에서 고쳤다.** §4 "화면을 넘지 않는다"의 같은 방향이라 새 ADR을 쓰지 않았다.
- **하단 탭 바는 고치지 않았다.** 안전 영역 안의 단추를 모두 찾으니 하단 탭 바의 첫 탭(17-77px)과 검색 단추(798-858px)가 남았다. 글자 크기와 상관없이 전부터 이 자리였고, 화면 아래라 아일랜드에 가리지 않는다. ADR-030의 가로 규칙과 함께 실제 아이폰에서 볼 일이라 known-issues §60으로 남겼다.

## 검증

- 유닛: `node --test tests/unit/*.test.js` 통과. 타입 검사(`npm run typecheck`) 통과. `helpers.test.js`의 폭 시험이 `--max-width`의 상한까지 본다.
- e2e: `test_rem_widths.py` 27건 통과. 새 5건은 Chromium의 개발자 프로토콜(`Emulation.setSafeAreaInsetsOverride`)로 앱 화면 874×402에 좌우 안전 영역 62px을 흉내 내, 본문 칸, 헤더, 첫 절 번호, 인용 바텀 시트가 안전 영역 밖에 있는지 본다(18, 22, 24px, 한쪽만 있는 경우). 고치기 전의 CSS로 돌리면 18px을 뺀 4건이 실패한다.
- 관련 e2e: `test_layout_tiers.py`, `test_top_bar.py`, `test_cite_sheet.py`, `test_tabbar.py`, `test_audio_controls.py`, `test_bookmark_select_delete.py`, `test_features.py` 114건 통과. `test_calendar_view.py`는 108건 가운데 107건 통과이고, 실패한 1건은 날짜 탓의 known-issues §59다.
- 안전 영역 안의 글자 찾기(Chromium, 874×402, 안전 영역 62px, 글자 18, 20, 22, 24px; 시편 23편, 성서 목록, 캘린더 월간과 목록, 검색 결과): 고치기 전에는 22px과 24px의 캘린더에서 축일 이름과 "오늘"이, 장 화면에서 절 번호와 본문이 안전 영역 안에 있었다. 고친 뒤에는 화면 밖에 두는 스크린 리더 알림(`#a11y-announce`) 말고는 없다.
- 실제 아이폰에서는 아직 보지 않았다. dev에 올린 뒤 사용자가 확인한다.

## 갱신한 문서

- `docs/decisions/055-rem-widths.md`: 「요약」 4와 §4를 "화면과 안전 영역을 넘지 않는다"로, §2에 안전 영역만큼 좁아진다는 줄.
- `DESIGN.md` §4 「레이아웃」: `--max-width`의 상한, 안전 영역 항목에 좌우 안전 영역과 known-issues §60.
- `docs/topics/design-system.md` 「지금 동작」의 "칸의 폭": 상한과 가로로 든 iPhone 17의 폭, e2e가 안전 영역을 흉내 내는 방법.
- `docs/known-issues.md` §60과 `docs/topics/routing.md` 「남은 일」: 하단 탭 바의 양 끝 단추가 좌우 안전 영역에 놓이는 것.
- `docs/architecture.md` 부록 A의 ADR-055 줄, `tests/README.md`의 `test_rem_widths.py` 줄(27건).
