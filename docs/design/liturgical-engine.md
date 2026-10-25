# 교회력 계산 엔진 설계 — ADR-037 A1 · B1

> 이 문서는 구현을 진행하면서 갱신한다.
> 결정의 이유와 버린 선택지는 ADR-036(데이터 모델, 우선순위, 전례색), ADR-037(독서 데이터, 엔진 명세), ADR-038(캘린더와 독서 화면)에 있다.

- 작성: 2026-08-08
- 상태: **A1과 B1을 모두 구현했다.** 단계별 PR은 다음과 같다. 그 뒤 #345에서 성주간과 부활 8일에 든 주요축일을 책자대로 그날 지키게 고쳤다.
  - A1-a 계산 계층: PR 1(#325)
  - A1-b 조회 계층: PR 2(#338)
  - B1 우선순위, 지정 전례일, 전례색, 재일: PR 3 첫째(#341)
  - B1 옮김 계산, 선택 봉헌: PR 3 둘째(#343)
- 남은 일: §9의 열린 물음이 남았다. 엔진을 쓰는 화면(ADR-038)은 독서 화면과 캘린더 월간 화면이 나왔고, 캘린더의 주간과 목록 화면, 검색 이원화가 남았다.
- 구현 파일
  - 엔진: `js/app/liturgical-engine.js`. 다른 모듈에 의존하지 않는다(§3.1).
  - 공유 타입: `js/types.d.ts`
  - 합성 표로 검사하는 유닛 테스트: `tests/unit/liturgical-engine.test.js`
  - 실데이터로 검사하는 유닛 테스트: `tests/unit/liturgical-engine.data.test.js`(§7)
- 관련 ADR
  - ADR-036: 교회력 데이터 모델. 전례일 키, 등급과 우선순위, 옮김, 전례색은 이 ADR이 근거다.
  - ADR-037 §6: 엔진 명세. 이 설계의 상위 문서다.
  - ADR-038: 엔진을 쓰는 화면
  - ADR-039: 전례시편 `lps`(data 저장소에 있다)
  - ADR-013(유닛 테스트 하네스), ADR-012(JSDoc 타입), ADR-018 · 019 · 034(모듈 계층과 ESM), ADR-021(캐시 무효화), ADR-035(절 일부만 그리기)
- 기도서 원문: [`docs/reference/liturgical-calendar-rules.md`](../reference/liturgical-calendar-rules.md). 기도서의 교회력 규칙을 해석하지 않고 옮겨 적은 문서다. 「기도서 원문 143행」처럼 적은 행 번호는 이 파일의 줄 번호다.
- 기대값 픽스처: [`tests/fixtures/liturgical/`](../../tests/fixtures/liturgical/README.md). 실제 연도의 옮김, 선택 봉헌, 지정 전례일, 색 기대값은 이 파일들이 기준이다(§1.4, §7).
- 검토 문서: [`docs/design/liturgical-engine-review.md`](liturgical-engine-review.md). 외부 구현과 견준 판정(§3, §4), PR 1-3 검증 체크리스트(§5), 사제 확인 질문지(§6)가 있다.

---

## 목차

장마다 파일을 하나씩 두었다(2026-10-24). 절 번호, 규칙 마커, 미결 번호는 나누기 전과 같다. 문서 검사는 이 파일과 장 파일들을 차례로 이어 붙여 설계서 하나로 읽는다.

- [1. 개요](liturgical-engine/01-overview.md)
- [2. 엔진이 마주하는 데이터 현실](liturgical-engine/02-data-reality.md)
- [3. 배치와 계층](liturgical-engine/03-placement-layers.md)
- [4. A1-a 계산 계층](liturgical-engine/04-compute-layer.md)
- [5. A1-b 조회 계층](liturgical-engine/05-lookup-layer.md)
- [6. B1 우선순위 · 옮김 · 전례색](liturgical-engine/06-rank-transfer-color.md)
- [7. 테스트 계획](liturgical-engine/07-test-plan.md)
- [8. 구현 단계](liturgical-engine/08-phases.md)
- [9. 미결](liturgical-engine/09-open-items.md)
