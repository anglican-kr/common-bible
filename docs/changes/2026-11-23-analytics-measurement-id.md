---
pr: 648
date: 2026-11-23
branch: fix/analytics-measurement-id
title: "fix: 구글 애널리틱스 측정 ID를 관리 화면의 스트림에 맞추기"
---

## 요약

애널리틱스 관리 화면의 웹 스트림 「공동번역성서」(`https://bible.anglican.kr`, 측정 ID `G-2Q4SRGVNQN`, 스트림 ID 14348950825)가 「웹사이트에서 데이터 수집이 활성화되어 있지 않습니다」 · 「수신된 데이터 없음」을 보였다(사용자 화면, 2026-11-23). 앱이 다른 측정 ID(`G-CWVVPW11TE`)로 보내고 있었기 때문이다. `index.html`의 태그 주소와 `js/gtag-init.js`의 `config` 두 곳을 `G-2Q4SRGVNQN`으로 바꿨다.

## 확정 · 근거

- **원인은 측정 ID가 달랐던 것이다.** 처음 연동(`75b0286`)은 `G-2Q4SRGVNQN`이었고, 2026-05-05 커밋 `a38c017`(「측정 ID를 G-CWVVPW11TE로 통일」)이 두 곳을 모두 `G-CWVVPW11TE`로 바꿨다. 그 뒤로 이 스트림에는 데이터가 오지 않았다. 운영(`https://bible.anglican.kr/`)이 내려 주는 `index.html`과 `js/gtag-init.js`도 `G-CWVVPW11TE`였다(읽기만, 2026-11-23).
- **수집 경로는 고장이 아니다.** 태그 스크립트는 200으로 내려오고, CSP는 구글 태그 주소를 허용한다. 수집 요청이 204로 성공하는 것은 `docs/changes/2026-10-18-csp-google-collect.md`에서 확인했다.
- **사용자 결정 — 화면의 스트림(`G-2Q4SRGVNQN`)으로 모은다**(2026-11-23). 보인 안은 둘이다. ① 코드를 그대로 두고 `G-CWVVPW11TE` 스트림을 찾아 본다, ② 코드를 `G-2Q4SRGVNQN`으로 되돌린다. 사용자 「2로 진행」.
- **`G-CWVVPW11TE`가 어느 속성의 스트림인지는 확인하지 못했다.** 저장소에는 단서가 없다. 5월 5일부터 오늘까지의 기록이 그쪽에 있다면 이 변경을 배포한 날부터 두 스트림으로 나뉜다.
- **방문 2건 기록(known-issues §46)은 이 PR에서 다루지 않는다.** 따로 진행 중인 작업(`fix/analytics-double-pageview`)이 같은 줄을 고친다. 그 작업 폴더의 측정 ID 두 줄도 같은 값으로 맞춰 두었다(사용자 결정 「따로 PR」, 2026-11-23).

## 검증

- 저장소 전체에서 `G-CWVVPW11TE`를 찾으면 0건이고 `G-2Q4SRGVNQN`은 코드 두 곳과 문서뿐이다(`grep -rn`).
- `https://www.googletagmanager.com/gtag/js?id=G-2Q4SRGVNQN` — 200.
- 유닛 `node --test tests/unit/*.test.js` — 1991건 모두 통과. `npm run typecheck` — 0.
- e2e는 돌리지 않았다. 바뀐 것은 측정 ID 문자열 두 곳이고, e2e는 그 값을 보지 않는다.
- 배포한 뒤 애널리틱스 관리 화면의 실시간 보고서에서 수신을 확인해야 한다(사용자 확인 필요). 「수신된 데이터 없음」 표시는 반영에 최대 48시간이 걸릴 수 있다.

## 갱신한 문서

- `docs/topics/platform.md` — 「지금 동작」에 측정 ID와 그 스트림, 값을 적는 두 곳을 한 줄로 적었다.
