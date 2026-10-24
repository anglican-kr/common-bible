---
date: 2026-10-24
branch: docs/design-engine-s4
title: "docs: 교회력 설계서 §4 고쳐 쓰기와 내용 검증"
---

## 요약

교회력 설계서 `docs/design/liturgical-engine.md`를 절마다 고쳐 쓰며 내용을 검증하는 작업(known-issues §24)의 둘째 PR이다. §4(계산 계층)를 다뤘다. 날짜 계산 도구, 부활절 계산, 이동 축일 규칙, 대림 1주일, 절기 구분, 연중 주차, 주일과 평일 주기, 음력 표, 연도 캐시, 기간 판정이 여기 있다. 절 번호와 규칙 마커(R-4.5-baptism-ordinary-1), 미결 번호는 그대로 두었다.

- 사실을 하나씩 뽑아 엔진 코드(`js/app/liturgical-engine.js`), 데이터(`data/lectionary/*.json`), 기도서 원문(`docs/reference/liturgical-calendar-rules.md`), 테스트와 대조했다. 낡은 설명은 코드와 데이터에 맞춰 고쳤다(아래 「확정 · 근거」).
- 문장을 `docs/writing.md`에 맞게 고쳐 썼다. 명사를 가운뎃점과 줄표로 잇던 곳을 문장으로 풀었고, 「throw」, 「준용」, 「기각」을 한국어로 바꿨다. 화살표로 동작을 잇던 곳(「`easter_offset` → 레코드」, 「규칙 1개 → 날짜 1개」)도 문장으로 바꿨다. 숫자 사이 물결표는 「부터 … 까지」나 하이픈으로 바꿨다.
- 길게 이어 쓴 문단을 목록으로 나눴다. §4.6의 구간 분포, §4.9의 캐시가 둘인 이유와 캐시를 비우는 때, §4.10의 `inSpan` 규약이다.

## 확정 · 근거

어긋난 것은 모두 문서가 구현을 설명하다 낡은 경우였다. 사용자 결정이나 기도서 규칙과 코드가 어긋난 곳은 없었다.

- **규칙 종류 `date`는 어휘표에 없다.** §4.3 표는 `date`를 「`_vocab`에만 있고 미사용」으로 적었는데, `_vocab.rule`에는 일곱 종류만 있고 `date`가 없다. `date`는 `ember_wfs`의 앵커 종류로만 쓰인다(추계재 09.14, 동계재 12.13). 표에서 행을 빼고 이 사실을 적었다.
- **주요축일(가)의 「나머지 여섯」.** 가 그룹에서 `outranks_sunday: false`인 것은 주님의 세례를 빼면 일곱이다. 그 가운데 왕이신 그리스도 주일은 언제나 그 주일이라 `transfer_to: null`이고, 나머지 여섯이 `next_day`다. 「주님의 세례와 왕이신 그리스도 주일을 뺀 여섯」으로 고쳤다.
- **쓰는 곳이 없는 기간 셋.** §4.10 표의 `ascensionToPentecost`, `dec17to24`, `christmasOctave`는 엔진 코드에서 `inSpan`으로 묻는 곳이 없고 테스트(C-P-3, C-P-4)만 본다. 「소비자」 칸이 쓰이는 것처럼 적고 있어, 「쓰는 곳이 없다」와 만든 이유로 고쳤다.
- **성주간 기간을 쓰는 곳.** `holyWeek`는 문서에 적힌 색 가드와 축일 생략 말고도 격자 이름(「성주간 X요일」, §5.5)과 그날 기본색(§6.4)이 쓴다. 표와 「왜 한 함수로 모으나」를 실제 호출에 맞췄다. 그 문단은 「지금 세 곳이 각자 날짜 비교로 갖고 있다」로 시작해 구현 전의 이야기였는데, 지금은 모두 이 함수를 본다.
- **#404 뒤의 낡은 한 줄.** 검토 문서 C-P-2가 「`guard(d)`가 `transferGuard`만 본다」고 적었는데, #404에서 `guard(d)`는 `holyWeek`를 보게 됐다. 설계서 §4.10 표는 #404에서 이미 고쳤고, 이 PR에서 C-P-2를 고쳤다.
- **인용한 줄 번호.** 「`search.js:199` 선례」는 코드가 바뀌어 줄이 밀렸다. 같은 방식의 함수 이름(`formatSearchDate`)으로 바꿨다. 엔진 머리 주석에도 같은 줄 번호가 있어 함께 고쳤다(주석만 바뀐다).
- **사계재 본문.** 「16건 전부 `weekday`」는 본기도의 수다. 독서 20건도 모두 `weekday`가 있다는 것을 더했다.
- **주님의 세례 본문 id**를 실제 id(`ordinary-1-sun-주님의-세례-{A,B,C}-t1-s1`)로 고쳤다.
- **I/II 주기.** 엔진의 `weekdayCycle`은 연중 평일에만 값을 내고, 그 밖의 날은 좌표의 주기 칸에 주일 주기를 싣는다는 것을 더했다. 홀수해가 I, 짝수해가 II다.
- **기간 표의 `periods.json` 인용**을 데이터의 실제 `_meta.model` 문구로 바꿨다.

확인했고 맞았던 것:

- §4.1의 함수 열세 개가 모두 있고, `MIN_YEAR` 1583, `MAX_YEAR` 9999다. 1583년부터 9999년까지의 날짜는 3,074,246일이다. `shift`는 실패하면 예외를 던지고, `parseDate`는 0-99년을 받지 않는다.
- §4.2의 부활절 함수는 정수 연산 15줄 남짓이고 연도별로 캐시한다.
- §4.3: `easter_offset` 12건과 오프셋 값, 규칙 종류 7종과 건수(4, 1, 1, 1, 1, 4), 사계재 앵커 넷, `rule: null` 0건, 사계재 요일 배정(수 성직자, 금 성직후보자와 수도자, 토 모든 신자), 본문의 `season`과 `coord_name`.
- §4.4: 1900-2100의 대림 1주일은 11.27-12.03에 28-29회씩 온다. 2023-12-01은 전년의 전례년, 2024-12-01은 새 전례년이다. `liturgicalYearOf`가 판정한다.
- §4.5: 절기 판정 코드(`seasonOf`)가 표와 같다. `t-주님의-세례`의 좌표와 `transferable`, 기도서 원문 9, 13, 24, 111, 143행의 문구가 문서대로다. 주님의 세례는 1900-2100 모든 해에 01-07부터 01-13까지의 창에 든다.
- §4.6: 34주, 구간 38개, 6-9주만 구간이 둘, 9주 `doy` 구간은 03-04부터 03-07까지다. 2052년 부활은 4.21이고, 엔진은 2052-02-25를 8주, 03-03을 9주로 낸다.
- §4.7: 주기 경계 네 날(2025-11-29 다해, 11-30 가해, 2026-11-28 가해, 11-29 나해)이 엔진과 같다.
- §4.8: `kasi-lunar.json`의 형식과 `_meta.range` [2025, 2050], `complete: true`.
- §4.9: 앵커 캐시 필드(`year`, `easter`, `advent1`, `baptism`, `ash`, `pentecost`). 42칸을 그리면 부활절 계산은 2026년 12월에 세 해(2025-2027), 6월에 두 해다. 1900-2100에서 해를 넘기는 12월 이동은 0건이다. `setActivatedOptionals`는 집합이 바뀔 때만 캐시를 비운다. 사계재와 주님의 세례가 자기 달력년 안에 떨어진다는 것을 실데이터 테스트가 본다.
- §4.10: 기간 일곱의 구간과 조각 수, 모르는 이름에 예외, `periods.json` 1건.

## 검증

- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --strict-counts --allow-new '^2052-02-25$'`에서 사라진 토큰과 줄어든 토큰이 0이다. 새 토큰(2052-02-25)은 위에서 더한 확인 결과다.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/design/liturgical-engine.md' --kinds general --strict-counts`에서 사라진 토큰 일곱은 의도한 것이다. `_vocab`(어휘표 설명을 고침), `search.js:199`(함수 이름으로 바꿈), `ordinary-1-sun-주님의-세례-{A,B,C}`(실제 id로 고침), 화살표 표기 셋(「`easter_offset` → 레코드」, 「규칙 1개 → 날짜 1개」, 「날짜 → 행」), `periods.json` 인용(데이터의 실제 문구로 바꿈)이다. 줄어든 `Y` 하나는 `christmasOctave` 조각 ①을 「`Y`-01-01 하루」로 줄여 쓴 것이다.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js tests/unit/liturgical-engine.test.js` 145개가 모두 통과했다. `npm run typecheck`도 통과했다.

## 갱신한 문서

- `docs/design/liturgical-engine.md`: §4를 고쳐 쓰고 낡은 내용을 고쳤다.
- `docs/design/liturgical-engine-review.md`: C-P-2.
- `js/app/liturgical-engine.js`: `parseDate` 머리 주석의 인용(주석만).
