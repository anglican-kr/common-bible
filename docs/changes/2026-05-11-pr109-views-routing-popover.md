---
date: 2026-05-11
pr: 109
branch: test/views-routing-popover
title: "test: views-routing.js POPOVER + COMPACT_HEADER 유닛 테스트"
---

# test: views-routing.js POPOVER + COMPACT_HEADER 유닛 테스트

## Summary

- app 레이어 유닛 테스트 확장 세 번째 단계
- `tests/unit/views-routing.test.js` 확장: 28 → 54 (+26). 전체 340 → 366
- `js/app/views-routing.js`에 BEGIN/END 마커 신설:
  - **POPOVER** (19 케이스): `setTitleWithDivisionPicker` / `setTitleWithChapterPicker`
  - **COMPACT_HEADER** (7 케이스): `initCompactHeader`

## POPOVER 검증

- 펼침/닫힘 + `aria-expanded` 미러 + `trapFocus` 호출 + 첫 링크 자동 포커스
- document 외부 클릭 닫기 / `$title` 내부 클릭 유지 / 항목 클릭 닫기
- 분류 메뉴: 3분류 순서, active 표시
- 장 선택: `chapter_count` 정확성, 시편 '편' 단위, `has_prologue` 머리말 링크, current 표시, back btn + bookmark btn 동행

## COMPACT_HEADER 검증

- passive scroll listener
- 60/10 hysteretic 토글, 경계값 strict 비교(`>` `<`)
- 사이 구간 유지, 반복 전이 안정성

## 테스트 패턴

- 기존 단순 `StubElement` 외에 더 풍부한 `RichElement` (addEventListener / classList / hidden / focus / contains / querySelector)
- `Node` / `Element` 글로벌은 `Symbol.hasInstance` duck-typed 매칭으로 production 코드의 `t instanceof Node` / `instanceof Element` 체크 통과
- jsdom 미도입 (ADR-013 dual-track 기조 유지)

## Test plan

- [x] \`node --test tests/unit/views-routing.test.js\` — 54 통과 / 110ms
- [x] \`node --test tests/unit/*.test.js\` — 366 통과 (회귀 0)
- [ ] CI green
