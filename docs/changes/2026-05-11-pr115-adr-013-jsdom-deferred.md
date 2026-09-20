---
date: 2026-05-11
pr: 115
branch: docs/adr-013-jsdom-deferred
title: "docs: ADR-013 재정정 — jsdom 도입 보류, 미커버는 e2e가 책임"
---

# docs: ADR-013 재정정 — jsdom 도입 보류, 미커버는 e2e가 책임

## Summary

PR #105의 dual-track 개정(jsdom 허용) 직후 실제 도입을 재검토하다가 결정적 사실 발견:

**jsdom과 happy-dom 둘 다 진짜 layout 계산을 하지 않는다** — \`getBoundingClientRect()\`는 \`{x:0, y:0, width:0, height:0}\` 반환(CSS 엔진 미구현). Canvas 2D도 jsdom은 별도 \`canvas\` 네이티브 패키지(C++) 필요, happy-dom은 미지원.

따라서 "jsdom 필요"라고 미뤘던 세 영역 중:
- \`startScrollTracking\`의 \`getBoundingClientRect\` → **jsdom으로도 해결 불가**
- Pull-to-refresh의 touch gesture + transform → 시뮬레이션은 되지만 layout 의존 부분 약함
- settings-ui Canvas 아이콘 채색 → 별도 네이티브 패키지 + Font API, 도입 비용 큼

→ 본질적으로 실제 브라우저가 필요한 통합 동작이라는 결론. **e2e(Playwright)가 더 적합한 책임 경계**.

## 결정

1. jsdom / happy-dom 도입 보류 — \`package.json\` 신설 안 함
2. PR #105의 "0 의존성 완화" 취소, **원래의 "0 의존성"(Node 내장만)** 원칙 복원
3. 남은 미커버 영역(settings-ui Canvas/Font 전체, views-routing Pull-to-refresh·Audio Player·startScrollTracking, install 모달/슬라이더/buildInstallBody, bookmark drawer/save modal/tree render/drag handle, search 시트 드래그·결과 렌더)은 \`tests/e2e/\` 시나리오로 보완
4. 유닛 테스트는 향후에도 \`node:vm\` + 수동 스텁 패턴만 사용. 새 의존성 추가 시 본 ADR을 다시 개정

## 형식

PR #105의 dual-track 블록은 **역사적 기록으로 남기고**, 그 아래에 "재정정 (2026-05-11)" 블록을 추가해 결정 변천을 그대로 보존. 향후 누군가 jsdom을 다시 고려할 때 같은 분석을 반복하지 않도록.

## 후속 의제

e2e 시나리오 추가(\`tests/e2e/test_*.py\` 신설 + \`docs/qa/YYYY-MM-DD-e2e-{topic}.md\`)는 별도 PR. 본 ADR은 결정 기록에 한정.

## Test plan

- [x] 코드 변경 0
- [x] 문서 단독 변경
