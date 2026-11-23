---
pr: 653
date: 2026-11-24
branch: fix/csp-google-signals
title: "fix: CSP가 구글 시그널의 수집 요청을 막는다"
---

## 요약

2.2.5 릴리스 전 CSP 점검(`tools/csp/csp_sweep.py`)에서 위반이 38종 나왔다. #648이 측정 ID를 `G-2Q4SRGVNQN`으로 바꾼 뒤 생긴 것이다. 그 속성은 구글 시그널(연령대, 성별, 관심 분야 보고서)이 켜져 있어, 구글 태그가 옛 측정 ID 때와 다른 주소 셋으로 요청을 보내는데 CSP가 모두 막았다.

- `connect-src`에 `https://analytics.google.com`과 `https://stats.g.doubleclick.net`을 더했다.
- `img-src`에 `https://www.google.co.kr`을 더했다.
- `privacy.html`(개인정보 처리방침)에 연령대, 성별, 관심 분야의 추정과 광고 식별자, 거부하는 길을 적었다.

## 확정 · 근거

- **사용자 결정: CSP를 넓혀 구글 시그널을 허용한다**(2026-11-24). 보인 안은 셋이다. 첫째, `gtag` 설정에서 시그널을 끈다(`allow_google_signals: false`). 둘째, CSP를 넓힌다. 셋째, 애널리틱스 관리 화면에서 사용자가 직접 끈다. 사용자가 둘째를 골랐다.
- **막힌 요청과 그 결과**(Chromium, 서비스 워커 막음, 홈과 창세기 1장을 열고 스크롤한 뒤 떠나는 흐름).

  | 경우 | 방문 기록이 간 곳 | CSP 위반 |
  |---|---|---|
  | 옛 측정 ID(`G-CWVVPW11TE`) | `www.google-analytics.com/g/collect` 204 | 없음 |
  | 새 측정 ID, 고치기 전 | `analytics.google.com/g/collect`가 막히고 `www.google.com/g/collect`로 다시 보내 204 | `analytics.google.com`, `stats.g.doubleclick.net`, `www.google.co.kr/ads/ga-audiences` |
  | 새 측정 ID, 시그널 끔 | `www.google-analytics.com/g/collect` 204 | 없음 |
  | 새 측정 ID, 고친 뒤 | `analytics.google.com/g/collect` 204, `stats.g.doubleclick.net/g/collect` 204, `www.google.co.kr/ads/ga-audiences` 200 | 없음 |

  고치기 전에도 방문 기록은 `www.google.com`으로 다시 보내져 수집됐다. 막힌 채로 남은 것은 시그널의 두 요청이다.
- **`https://analytics.google.com`을 따로 적는 까닭.** 정책에 이미 있던 `https://*.analytics.google.com`은 하위 도메인만 허용해 `analytics.google.com` 자체와는 맞지 않는다.
- **와일드카드 대신 측정된 주소만 적었다.** 2026-10-18의 결정(`docs/changes/2026-10-18-csp-google-collect.md`, `connect-src`에 `https://*.google.com`을 받지 않음)을 따랐다. `connect-src`에는 `*.g.doubleclick.net`이 아니라 `stats.g.doubleclick.net`만 적었다.
- **한국 밖의 방문자는 `ga-audiences` 요청이 막힌다.** 그 주소는 방문자의 나라에 따라 `www.google.<나라>`로 바뀌고, CSP는 그 자리에 와일드카드를 쓸 수 없다. 한국(`www.google.co.kr`)과 전부터 있던 `*.google.com`만 허용했다. 다른 나라의 방문자는 그 요청 하나가 막혀 콘솔에 위반이 남고, 방문 기록은 그대로 간다. 나라를 더 넣을지는 보고서를 보고 정한다.
- **개인정보 처리방침.** 지금까지는 방문 기록, 기기와 브라우저, 지역, 세션 통계만 수집한다고 밝혔다. 시그널을 허용하면 Google이 광고 식별자로 연령대, 성별, 관심 분야를 추정하므로 수집 항목, 제3자 제공 항목, 거부하는 길(Google 내 광고 센터), 쿠키 설명에 적고 최종 수정일을 2026년 11월 24일로 고쳤다. 문구는 사용자 확인을 받는다.
- **dev.anglican.kr에는 #648이 이미 올라가 있다**(빌드 `2.2.4-913b12a`). 이 변경을 올리기 전까지 dev에서는 위 표의 「고치기 전」처럼 동작한다. 운영은 아직 옛 측정 ID다.

## 검증

- CSP 점검 `python -I tools/csp/csp_sweep.py http://localhost:8098`(서비스 워커 막음)과 `--sw`(켬): 둘 다 위반 0종(종료 코드 0). 건너뛴 단계는 이 브라우저에서 할 수 없는 데스크톱 오디오 재생 하나다. 고치기 전의 정책으로는 같은 점검이 위반 38종으로 실패했다(종료 코드 1).
- 유닛 `node --test tests/unit/*.test.js`: 1,991건 모두 통과. `npm run typecheck`: 통과.
- e2e는 돌리지 않았다. 바뀐 것은 CSP의 허용 주소와 별도 페이지 `privacy.html`의 글이고, e2e는 둘을 보지 않는다.
- 실제 아이폰(WebKit)에서는 확인하지 못했다. dev.anglican.kr에 올린 뒤 사용자에게 부탁한다.

## 갱신한 문서

- `docs/architecture.md` 「보안 모델」의 CSP 줄: 구글 시그널을 위한 세 주소와 그 까닭, 나라별 주소의 한계.
