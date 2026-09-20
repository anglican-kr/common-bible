---
date: 2026-05-11
pr: 113
branch: test/search-history-controller
title: "test: search.js HISTORY_CONTROLLER 유닛 테스트"
---

# test: search.js HISTORY_CONTROLLER 유닛 테스트

## Summary

- app 레이어 유닛 테스트 확장 마지막 단계 (project_unit_test_expansion 의제, no-jsdom 영역 마무리)
- \`tests/unit/search.test.js\` 확장: 36 → 69 (+33). 전체 440 → 473
- \`js/app/search.js\`에 BEGIN/END \`HISTORY_CONTROLLER\` 마커 신설 — \`createSearchHistoryController\` 팩토리 함수 전체 커버

## 검증

- **라이프사이클** (6 케이스): 빈 이력 open() no-op, 검색 이력 open/close 상태, syncToggleVisibility 토글 표시
- **렌더링** (5 케이스): \`SEARCH_HISTORY_VISIBLE\`(10) 캡, '더 보기' 조건부 노출, '모두 지우기' \`length >= 3\` 조건
- **토글 버튼** (2 케이스): 닫힘→열기, 열림→닫기+입력 포커스
- **키보드** (7 케이스): ArrowDown 빈/비빈 분기, ArrowDown 활성 이동, ArrowUp 닫힘 no-op, 첫 항목 ArrowUp 마지막 wrap, Escape 닫기, 가시 경계 초과 자동 expandMore
- **패널 클릭** (5 케이스): 항목 선택→입력·onSelect·닫기·clearBtn, remove → 삭제·refresh, 마지막 항목 삭제 후 자동 닫기, 더 보기·모두 지우기
- **바깥 클릭** (3 케이스): outside 닫기, panel/toggle 내부 유지
- **refresh** (1 케이스): 외부 이력 변경 반영
- **consumeEnter** (3 케이스): 닫힘/활성-없음/활성-있음 분기

## 테스트 패턴

기존 \`StubElement\`에 \`querySelectorAll\` / \`contains\` / \`closest\` / \`focus\` / \`scrollIntoView\` / \`id\` getter / \`_dispatch\` 추가. HISTORY_CONTROLLER 전용 의존 표면을 흉내. 기존 PURE/WORKER/IS_MOBILE/AUTO_NAVIGATE 테스트와 호환. jsdom 미도입.

DOM 헤비 영역(시트 드래그·결과 렌더·키보드 조정) 의도적 스킵.

## app 레이어 1차 마무리 누적 결과

| PR | 추가 | 합계 |
| --- | --- | --- |
| #106 storage | +64 | 309 |
| #108 helpers | +31 | 340 |
| #109 views-routing | +26 | 366 |
| #110 install | +40 | 406 |
| #112 bookmark | +34 | 440 |
| **이번 (search)** | **+33** | **473** |

전체 245 → 473 (**93% 증가**). 회귀 0.

## Test plan

- [x] \`node --test tests/unit/search.test.js\` — 69 통과 / 139ms
- [x] \`node --test tests/unit/*.test.js\` — 473 통과 (회귀 0)
- [x] CI green
