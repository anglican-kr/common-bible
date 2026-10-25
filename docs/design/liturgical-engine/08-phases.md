## 8. 구현 단계

작업 방식대로 **작게 나눠 순서대로** 냈다. 날짜는 머지한 날(한국 시간)이다.

- **PR 0**(아주 작음). `sw.js`의 `cacheNameFor`가 `/data/lectionary/`를 `DATA_CACHE`로 보내는 한 줄(ADR-037 §7 미이행분). **완료 #319(2026-09-05)**.
- **PR 1**(중). A1-a 계산 계층, `LITURGICAL_CORE` 블록, 유닛. **완료 #325(2026-09-17)**.
- **PR 2**(중). A1-b 조회 계층, `LITURGICAL_LOOKUP` 블록, 프리로드와 캐시, 유닛. `js/types.d.ts` 공유 타입 신설(`Candidate` 포함), `index.html`과 `sw.js` 등록. `resolveDate`는 `Candidate[]`, `official: null`, **빈 `transfers`**로 낸다(§6.5 마지막 단락). 프리로드와 공개 래퍼는 `LITURGICAL_PRELOAD` 블록(§3.3)이다. **완료 #338(2026-10-10)**.
- **PR 3**(중). B1 우선순위와 전례색, **옮김 계산(§6.5)**, 선택 봉헌 `optional`, 유닛 §7 「옮김 계산」 항목, **§7 픽스처 소비**(`liturgical-engine.data.test.js`가 `tests/fixtures/liturgical/` 세 파일을 읽어, `skip` 아닌 케이스마다 `resolveDate` 결과에 `expect`를 부분집합으로 비교한다. README 「소비 방법」). **GitHub PR 둘로 냈다**(2026-10-10 사용자 결정). 첫째 #341은 우선순위, 지정 전례일, 재분류, 전례색, 재일(`fastOf`)과 `winners.cases.json` 소비(옮김이 필요한 두 케이스 제외)다. 둘째 #343은 옮김 계산, 선택 봉헌, `activated`, `transfers`와 `optionals` 소비, 1900-2100 불변식, 골든 덤프다. **완료 #341, #343(2026-10-11)**.
- **PR 3 후속**(작음). **책자대로.** 성주간과 부활 8일에 걸린 주요축일은 그날 지키고, 그날의 대축일이나 주일보다 후순위일 때만 옮긴다(→ R-6.3-holy-week-guard, 2026-10-11 사용자 결정). 그날의 축일 색, 보호 기간 픽스처, 골든 덤프, 불변식 I-11. **#345(2026-10-11)**.
- **PR 3 후속 2**(작음). **2027 책자 대조.** 보호 기간에서 밀린 주요축일은 부활 2주 월요일부터(→ R-6.3-guard-destination, 미결32), 그 축일끼리는 서열 순(→ R-6.3-guard-order), 도착에만 밀린 비연쇄 축일은 그날 기념(→ R-6.2-chain-scope, 미결17. 2026-10-24 폐기), 책자 대조 도구 `tools/booklet/`. **#347(2026-10-15)**.
- **PR 3 후속 3**(작음). **저녁 전례.** 부활밤과 성탄 밤은 드리는 날의 후보 끝(`evening`)이고, 대표, 색, 재분류, 옮김 어느 판정에도 들지 않는다. 성 토요일은 데이터 prec 1(data#32)로 그날을 지킨다(→ R-6.1-evening, 미결20). **#349(2026-10-17)**.
- **PR 3 후속 4**(작음). **기도서 대조.** 밀린 prec 7 축일은 성주간 밖에서 그날 기념한다(→ R-6.1-prec7-omit, #402). 연쇄 범위 규칙을 뺐다(→ R-6.2-chain-scope 폐기, #403). 부활 8일 평일의 축일은 책자대로 그날 지킨다(→ R-6.3-holy-week-guard, #404). **#402, #403, #404(2026-10-24)**.
- **이후**: ADR-038 A3 독서 화면(#346, 2026-10-14), A2 캘린더 탭(1단계 #348, 2026-10-15. 2단계 남음), A4 검색 이원화(남음).

각 PR에서 `npm run typecheck`와 `node --test tests/unit/*.test.js`를 돌린다. 실데이터 케이스를 만든 PR은 `liturgical-engine.data.test.js`를 `sync-data.yml`에 함께 등록한다(§7). 머지할 때 ADR-037 상태, 교회력 주제 문서(`docs/topics/liturgical.md`)의 「지금 동작」, `docs/architecture.md` §4 모듈 표를 함께 갱신한다(예전에 갱신하던 `docs/status.md`는 주제 문서로 나뉘어 없어졌다).
