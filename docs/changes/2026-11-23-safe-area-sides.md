---
pr: 646
date: 2026-11-23
branch: fix/safe-area-sides
title: "fix: 본문 칸이 좌우 안전 영역을 넘지 않게 하기"
---

## 요약

가로로 든 아이폰에서 큰 글자를 쓰면 다이내믹 아일랜드가 본문을 가리던 것을 고쳤다. #645가 본문 칸을 40rem으로 바꾸면서 22px과 24px에서 칸이 화면 끝까지 넓어졌는데, 좌우 안전 영역을 고려한 곳이 없었다. `--max-width`의 상한을 화면 폭에서 좌우 안전 영역 가운데 넓은 쪽의 두 배를 뺀 폭으로 했다(ADR-055 §4 제자리 갱신). 이 값을 쓰는 아홉 곳(본문 칸, 헤더, 바텀 시트, 막대)이 모두 안전 영역 밖에 놓인다.

## 확정 · 근거

- **회귀였다**(사용자 실기기 확인 2026-11-23, iPhone 17 가로, 가장 큰 글자와 그 아래 단계). 720px 칸일 때는 앱 화면 폭 874pt의 양옆에 77pt씩 남아 아일랜드 쪽 안전 영역(62pt쯤)을 우연히 피했다. 40rem 칸은 22px에서 880px, 24px에서 960px이라 화면 폭이 되었고, 절 번호가 화면 왼쪽 16px에서 시작했다. 20px의 800px 칸도 양옆에 37px씩만 남아 안전 영역에 걸쳤다.
- **값 하나로 고쳤다.** 아홉 곳 모두 `margin: auto`로 가운데에 두므로 `--max-width`에 상한을 넣으면 모두 안전 영역을 피한다. 18px의 칸(720px)은 안전 영역을 뺀 750px 안에 들어가 그대로다. 20px, 22px, 24px은 750px이다.
- **넓은 쪽의 두 배를 뺀다.** 칸을 가운데에 두므로 양쪽 안전 영역의 합을 빼면, 한쪽에만 안전 영역이 있는 기기(카메라 구멍이 한쪽에 있는 안드로이드)에서 칸이 그쪽에 절반만큼 걸친다.
- **ADR-055를 제자리에서 고쳤다.** §4 "화면을 넘지 않는다"의 같은 방향이라 새 ADR을 쓰지 않았다.
- **하단 탭 바는 고치지 않았다.** 안전 영역 안의 단추를 모두 찾으니 하단 탭 바의 첫 탭(17-77px)과 검색 단추(798-858px)가 남았다. 글자 크기와 상관없이 전부터 이 자리였고, 화면 아래라 아일랜드에 가리지 않는다. ADR-030의 가로 규칙과 함께 실제 아이폰에서 볼 일이라 known-issues §60으로 남겼다.

## 검증

- 유닛: `node --test tests/unit/*.test.js` 통과. 타입 검사(`npm run typecheck`) 통과. `helpers.test.js`의 폭 시험이 `--max-width`의 상한까지 본다.
- e2e: `test_rem_widths.py` 28건 통과. 새 6건은 Chromium의 개발자 프로토콜(`Emulation.setSafeAreaInsetsOverride`)로 앱 화면 874×402에 좌우 안전 영역 62px을 흉내 내, 본문 칸, 헤더, 첫 절 번호, 인용 바텀 시트가 안전 영역 밖에 있는지 본다(18, 20, 22, 24px, 한쪽만 있는 경우). 고치기 전의 CSS로 돌리면 18px을 뺀 5건이 실패한다.
- 관련 e2e: `test_layout_tiers.py`, `test_top_bar.py`, `test_cite_sheet.py`, `test_tabbar.py`, `test_audio_controls.py`, `test_bookmark_select_delete.py`, `test_features.py` 114건 통과. `test_calendar_view.py`는 108건 가운데 107건 통과이고, 실패한 1건은 날짜 탓의 known-issues §59다.
- 안전 영역 안의 글자 찾기(Chromium, 874×402, 안전 영역 62px, 글자 18, 20, 22, 24px; 시편 23편, 성서 목록, 캘린더 월간과 목록, 검색 결과): 고치기 전에는 22px과 24px의 캘린더에서 축일 이름과 "오늘"이, 장 화면에서 절 번호와 본문이 안전 영역 안에 있었다. 20px에서도 시편 23편의 첫 절 번호가 화면 왼쪽 53px에서 시작해 안전 영역 안이었다(고치기 전의 CSS로 다시 잼). 고친 뒤에는 화면 밖에 두는 스크린 리더 알림(`#a11y-announce`) 말고는 없다.
- 실제 아이폰에서는 아직 보지 않았다. dev에 올린 뒤 사용자가 확인한다.

## 갱신한 문서

- `docs/decisions/055-rem-widths.md`: 「요약」 4와 §4를 "화면과 안전 영역을 넘지 않는다"로, §2에 안전 영역만큼 좁아진다는 줄.
- `DESIGN.md` §4 「레이아웃」: `--max-width`의 상한, 안전 영역 항목에 좌우 안전 영역과 known-issues §60.
- `docs/topics/design-system.md` 「지금 동작」의 "칸의 폭": 상한과 가로로 든 iPhone 17의 폭, e2e가 안전 영역을 흉내 내는 방법.
- `docs/known-issues.md` §60과 `docs/topics/routing.md` 「남은 일」: 하단 탭 바의 양 끝 단추와 긴 알림이 좌우 안전 영역에 놓이는 것.
- `index.html`: 첫 화면용 CSS의 `--max-width`를 `css/style.css`와 같은 값으로, CSP `style-src` 해시(리뷰 반영).
- `docs/architecture.md` 부록 A의 ADR-055 줄, `tests/README.md`의 `test_rem_widths.py` 줄(28건).

## 리뷰 반영

1회차(`/code-review medium --fix`, 중요한 것 세 건과 넘긴 것 둘):

- **20px도 회귀였는데 "그대로"라고 적었다.** 40rem은 20px에서 800px이라 안전 영역을 뺀 750px보다 넓다. 고치기 전에는 칸 왼쪽이 37px, 절 번호가 53px이라 안전 영역(62px) 안이었다. CSS는 20px도 바르게 좁혔고, 원장, ADR-055 §4, `topics/design-system.md`의 서술을 고쳤다.
- **안전 영역 e2e에 20px 경우가 없었다.** 이 고침이 폭을 바꾸면서 칸이 화면보다 좁은 단계는 20px뿐이다. 20px을 더했고, 글자 크기가 실제로 적용됐는지도 확인한다. 고치기 전의 CSS로 돌리면 18px을 뺀 5건이 실패한다.
- **원장의 측정 결과에 20px이 빠졌다.** 더했다.
- 넘긴 것 1: `index.html`의 첫 화면용 CSS에 `--max-width: 720px`이 남아 있었다(#645가 놓쳤다). 시작 화면이 덮는 동안만 쓰여 보이는 해는 없지만, `css/style.css`와 같은 값으로 맞추고 두 값이 같은지 유닛 시험이 보게 했다. 인라인 `<style>`이 바뀌어 CSP(`index.html`의 meta) `style-src` 해시를 `scripts/csp_hashes.py --fix`로 갱신했다(`csp.test.js` 통과, Chromium에서 CSP 위반 없음). nginx는 CSP를 보내지 않는다.
- 넘긴 것 2: 알림 묶음(`#notice-stack`)의 상한이 `calc(100vw - 2rem)`이라 긴 알림이 좌우 안전 영역에 들어갈 수 있다. 전부터 있던 것이라 탭 바와 함께 known-issues §60에 적었다.

2회차(`/code-review medium --fix`, 전부터 있던 것 하나와 사소한 것 하나):

- **휴대폰의 북마크 시트가 빠졌다.** 높이 600px보다 낮은 화면에서 북마크 시트(`#bookmark-drawer`)는 화면 전체 폭이고 `--max-width`를 쓰지 않아, 머리 줄의 제목(왼쪽 16px)이 좌우 안전 영역 안에 놓인다. 전부터 있던 것이라 고치지 않고 `topics/routing.md`의 known-issues §60과 `DESIGN.md`에 더했다. CSS에서 판단했고 실제로 재지는 않았다.
- **인용 시트 e2e가 글자 크기를 확인하지 않았다.** 글자 크기 설정이 적용되지 않으면 720px 시트로 통과한다. 24px인지 확인하게 했다.

2회차에 중요한 지적이 없어 리뷰를 멈췄다.
