---
pr: 356
date: 2026-10-18
branch: fix/csp-google-collect
title: "fix: CSP가 애널리틱스의 페이지 이탈 요청을 막는다"
---

# fix: CSP가 애널리틱스의 페이지 이탈 요청을 막는다

## 요약

배포 전 CSP 점검(사용자 지시 「배포전에 CSP 정책 위반 없는지 확인해봐」)에서 위반이 한 종류 나왔다 — 구글 애널리틱스(gtag)가 **페이지를 떠날 때** `https://www.google.com/g/collect`로 보내는 요청을 `connect-src`가 막았다. 정책은 `index.html`의 `<meta>` 한 곳이고 운영(bible.anglican.kr) · dev도 같은 판이라, 운영에서 이미 나고 있던 일이다(#355가 바꾼 것이 아니다). 방문 · 페이지뷰를 보내는 본 요청(`www.google-analytics.com/g/collect`)은 매번 204로 성공해 기본 집계는 됐고, 막힌 것은 떠날 때의 요청뿐이다.

`connect-src`에 `https://www.google.com` 하나를 더했다(사용자 결정 「1번으로 수정」). 같은 점검을 도구로 남겼다 — `tools/csp/csp_sweep.py`(사용자 「같이 머지」). meta로 준 CSP는 위반을 보고받을 수 없어(`report-uri` · `report-to` 미지원), 릴리스 전에 이것으로 돈다.

- **`index.html`** — CSP `connect-src`에 `https://www.google.com`(구글 태그 항목 옆).
- **`tools/csp/csp_sweep.py`** · **`README.md`** — 주요 화면 · 기능(성서 목록 · 장 · 오디오 · 인용 시트 · 검색 워커 · 캘린더 · 전례독서 · 북마크 · 모아 읽기 · 설정 · 실패 화면, 데스크톱과 휴대폰)을 실제 브라우저로 돌고 마지막에 페이지를 떠나며, 콘솔의 CSP 메시지를 지시어 · 막힌 주소별로 묶는다. 떠나는 순간의 위반은 `securitypolicyviolation` 이벤트를 읽기 전에 문서가 사라져 콘솔이 신호다. 종료 코드 0(없음) · 1(위반) · 2(돌지 못한 단계 — 점검 범위가 덜 참). `--browser webkit` · `--sw`.

## 확정·근거

- **사용자 결정 — `https://www.google.com`만 적는다**(1번, 2026-10-18). 보인 안은 셋 — ① `https://www.google.com`만 · ② `https://*.google.com`(구글 안내 그대로) · ③ 그대로 둠. 사용자 「2로 하면 구글 어낼리틱스 분석이 더 좋지 않을까?」 · 「아니면 구체적으로 도메인을 열거할 수 있나?」에 측정으로 답했다(아래 「검증」) — 지금 되살리는 요청은 ①과 ②가 같고, 애널리틱스가 쓰는 `google.com` 주소는 `www.google.com` 하나뿐이었다. 그 뒤 「1번으로 수정하고 같이 머지」.
- **근거 — 구글 태그 CSP 안내**([Google 태그 CSP 안내](https://developers.google.com/tag-platform/security/guides/csp), 2026-09-18 갱신 — 원문 확인 2026-10-18): 광고 기능을 쓰지 않는 Google 애널리틱스도 `connect-src: https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com`. 지금 정책에는 `*.google.com`이 빠져 있었다. 광고 기능을 쓰면 더 넓다(`*.google.<TLD>` · `*.g.doubleclick.net` · `pagead2.googlesyndication.com`) — 이 앱은 쓰지 않는다.
- **와일드카드를 받지 않은 까닭 — 보안.** `https://*.google.com`이면 페이지가 `script.google.com`(누구나 만들 수 있는 Apps Script 주소)을 포함한 구글 하위 도메인 아무 곳으로나 데이터를 보낼 수 있다. 누가 스크립트를 끼워 넣는다면 데이터를 내보낼 통로가 넓어진다(`script-src`가 같은 출처와 구글 태그만이라 끼워 넣기 자체는 어렵다). 대가: 구글이 다른 하위 도메인을 쓰기 시작하면 그 요청이 다시 막힌다 — 영향은 애널리틱스 일부이고, 이 도구가 릴리스 전에 잡는다.
- **구글 시그널과는 무관하다** — `gtag("config", …, { allow_google_signals: false })`로 바꿔도 같은 요청이 나갔다. 탭을 숨길 때(visibilitychange)는 본 주소로만 보내고, `www.google.com`으로는 페이지를 실제로 떠날 때만 보낸다.
- **CSP의 나머지는 위반이 없다**(점검 범위 — 「검증」). 인라인 `<style>` 해시는 지금 내용과 맞고(`tests/unit/csp.test.js`), 실행되는 인라인 스크립트 · 인라인 이벤트 처리기 · `style=` 속성 · `eval`은 없다.

## 검증

- **점검 도구** `python3 -I tools/csp/csp_sweep.py` — 고친 판: 위반 0종(종료 코드 0, Chromium · 서비스 워커 막음과 켬). WebKit(Playwright 26.4 — coding-pitfalls §34의 방법으로 띄움): 위반 0종(오디오 단계는 그 빌드가 mp3를 못 틀어 건너뜀). **main의 정책에 대면** 위반 1종 — `connect-src ✕ https://www.google.com/g/collect` 28번(종료 코드 1) — 도구가 헛통과하지 않는다.
- **세 정책 비교**(같은 흐름 — 페이지 열기 · 스크롤 · 화면 이동 · 떠나기, Chromium):

  | `connect-src`에 더한 것 | 본 요청(`www.google-analytics.com`) | 떠날 때의 요청 | 위반 |
  |---|---|---|---|
  | 없음(main) | 8번 모두 204 | 막힘 | 4건(메시지 8) |
  | `https://www.google.com` | 8번 모두 204 | `www.google.com/g/collect`로 나감 | 0 |
  | `https://*.google.com` | 8번 모두 204 | `www.google.com/g/collect`로 나감 | 0 |

  떠날 때의 요청은 브라우저 수준 네트워크 기록(CDP)으로 봤다 — 다른 `google.com` 하위 도메인으로 가는 요청도, 다른 주소로의 리다이렉트도 없었다.
- **운영 · dev** — `https://bible.anglican.kr/` · `https://dev.anglican.kr/`의 CSP meta가 저장소(main)와 같고 CSP 헤더는 없다(읽기만 — 2026-10-18).
- **유닛** `node --test tests/unit/*.test.js` — 1289건, 1288 통과 · 1 skip(main과 같다 — 정책 한 줄과 도구만 바뀌었다). `npm run typecheck` — 0. 문서 검사 16(한정어 없는 참조 경고 7 — main과 같다).
- **e2e** 전체 `pytest tests/e2e/` 341건 모두 통과(9분 13초) · **로드 스모크** 16개 경로 오류 0.

## 갱신한 문서

- `docs/architecture.md` — 「보안 모델」 CSP 줄: `connect-src`의 `https://www.google.com`(왜 하나만인가 · 와일드카드의 대가) · meta CSP는 위반을 보고받을 수 없어 `tools/csp`로 점검.
- `CLAUDE.md` — 「프로젝트 구조」 `tools/`에 `csp/`.
- `docs/index.md` — 「Service Worker · 캐시 · 릴리스」 행에 `tools/csp/README.md`(릴리스 전 CSP 점검).
- `tools/csp/README.md` — 새 파일(쓰는 법 · 종료 코드 · 위반이 나오면).
- status · ADR · known-issues · coding-pitfalls — 없음. 기능이 아니라 정책 한 줄이고, CSP의 정본은 architecture.md 「보안 모델」이다.
