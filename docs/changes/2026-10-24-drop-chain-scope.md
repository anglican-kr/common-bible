---
date: 2026-10-24
branch: refactor/drop-chain-scope
title: "refactor: 연쇄 범위 규칙을 뺌"
---

## 요약

교회력 엔진에서 연쇄 범위 규칙(설계서 R-6.2-chain-scope)을 뺐다. 이 규칙은 옮겨 온 축일에만 밀린 축일 가운데 사도, 복음사가, 성탄 8일의 순교 축일만 다음 날로 연쇄하고, 그 밖의 성인 축일은 그날 기념하게 했다(2026-10-13). 이제는 옮겨 온 축일에 밀린 옮길 수 있는 축일을 성인 분류와 무관하게 모두 연쇄한다(설계서 R-6.2-chain-model). 옮길 수 없는 축일(prec 7)은 지금처럼 그날 기념한다(R-6.1-prec7-omit).

- **엔진(`js/app/liturgical-engine.js`)**: 판정 함수 `chainsOnArrival`, `staysOnArrival`, 성탄 8일 날짜 판정 `inChristmasOctaveDate`를 지우고, 이동 패스와 승자 판정(`settle`)에서 이 규칙의 분기를 뺐다.
- **사용자가 겪는 일**: 없다. 1900-2100 실데이터에서 이 규칙이 바꾸던 날이 0건이라 화면에 보이는 날짜, 상태, 색이 그대로다. 골든 덤프도 바뀌지 않았다.
- **실데이터에 없는 경우 하나가 달라졌다.** 옮길 수 있는 prec 7 축일(성모 탄신, 성모시태, 모든 별세자의 날)이 보호 기간(성주간과 부활 8일) 안에서 옮겨 온 축일에 밀리면, 생략하지 않고 보호 기간 뒤 첫 빈 날로 옮긴다. 주일에 밀릴 때와 같다. 이 세 축일의 날짜는 보호 기간에 들지 않아 실제로는 생기지 않는다(합성 C-6.5-23).
- **문서**: 설계서 R-6.2-chain-scope 문장을 「(폐기 — 날짜, 이유)」로 바꾸고 미결43을 닫았다. 검토 문서, ADR-036, ADR-037, 주제 문서를 맞췄다.

## 확정 · 근거

- **사용자 결정(2026-10-24)**: 기도서 대조 PR(#402)을 머지한 뒤 이 규칙을 정리하기로 했다. 그 PR의 대조에서, 규칙의 유일한 근거였던 2027 책자 7.26의 안나와 요아킴(옮겨 온 야고보 옆에 이름만)이 기도서대로 축일이 되었다(설계서 미결27). 축일은 밀리면 그날 기념하므로 같은 결과가 축일 규칙으로 설명된다. 기도서의 규칙이 오히려 단순했다는 사용자의 관찰과 같은 결론이다.
- **실데이터 확인**: 1900-2100에서 옮겨 온 축일에만 밀린 옮길 수 있는 축일(규칙이 「기념」으로 바꾸던 경우)을 세면 0건이다. 그래서 골든 덤프 `transfers-1900-2100.golden.txt`가 그대로 통과한다.
- **미결43 닫힘**: 연쇄 대상 밖 주요축일(요셉, 막달라 마리아, 성 십자가, 주님 축일)이 옮겨 온 축일에만 밀리면 기념하는지 묻던 항목이다. 규칙이 없어져 연쇄로 옮긴다. 사제 질문지(검토 문서 §6)에서도 뺐다.
- 의도적 삭제: 설계서 미결43의 예시(「3.18의 축일이 … 3.19 … 3.20」)는 닫힌 항목을 한 줄로 줄이며 뺐다.

## 검증

- 유닛 `node --test tests/unit/*.test.js`: 1365개 가운데 1364개 통과, 1개는 원래 건너뛰는 케이스(미결13)다. 규칙을 뺀 직후 실패한 것은 이 규칙을 직접 검사하던 합성 테스트 둘(C-6.5-20, C-6.5-23)이었고, 새 동작에 맞게 고쳤다. 실데이터 테스트, 픽스처, 골든 덤프는 고치지 않고 통과했다.
- `npm run typecheck` 통과.
- 문서 검사 `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js` 31개 통과.
- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE`: 사라진 토큰은 위 미결43 예시의 3.18, 3.20 둘이고, 새 토큰은 없다.
- e2e `test_calendar_view.py`, `test_lectionary_view.py`, `test_liturgical_lazy_load.py`, `test_liturgical_render.py` 88개 통과.

## 갱신한 문서

- `docs/design/liturgical-engine.md`: §1.4 마커 목록, §5.5 status 표, §6.1 승자와 재분류, §6.2 R-6.2-chain-model과 R-6.2-chain-scope(폐기 문장), §6.5 이동 패스 의사코드와 연쇄 설명, §7 테스트 계획, §8 표, §9 미결17(부속), 미결43(닫힘, §9.2로).
- `docs/design/liturgical-engine-review.md`: X-3 행, C-6.5-20, C-6.5-21, C-6.5-23, X-13, §6 질문지에서 미결43을 뺌.
- `docs/decisions/036-liturgical-calendar-data-model.md`: 상태, §6 품계 표의 B 행, §7 규칙 3, 「검토한 대안 — 옮겨 온 축일에 밀린 축일 — 연쇄의 범위」(원안 B를 채택, A를 채택 안 함).
- `docs/decisions/037-eucharist-lectionary-data-and-engine.md`: 상태, 이동 규칙 문장.
- `docs/topics/liturgical.md`: 「지금 동작」 새 항목과 2027 책자 대조 항목, 「함정」 pitfalls §22 · §23.
- 픽스처: T-2027-12-27-christmas-triad, T-2027-07-26-anna-joachim-commemorated, A-2025-11-03-all-souls-all-saints-activated, A-2071-06-01-visitation-ascension-activated의 `canon`과 근거(id와 기대값은 그대로).
