---
date: 2026-05-09
pr: 85
branch: feat/app-jsdoc-pr5
title: "chore: app.js JSDoc 도입 PR-5 — 검색·검색 시트·검색 히스토리 (ADR-012 2차)"
---

# chore: app.js JSDoc 도입 PR-5 — 검색·검색 시트·검색 히스토리 (ADR-012 2차)

## Summary

ADR-012 2차 적용 7단계 분할의 **5번째 PR**. PR-4([#84](https://github.com/anglican-kr/common-bible/pull/84)) 머지 후 라인 기준 **L3245-L4229** — Search · Search input handlers · Search bottom sheet · Search history panel controller. baseline 262 → 잔여 223 (-39 감소).

- **모듈 헤드 미세 조정**
  - \`$searchSheetInput\`을 \`HTMLInputElement\`로 narrow — \`.value\`/\`.setSelectionRange\` per-call cast 회피
- **Search 영역**
  - \`getElementById(\"app-header\")\` optional chaining (\`?.offsetHeight\`)
  - \`createSearchHistoryController.close({ restoreFocus })\` 빈 객체 destructure 회피 — \`opts = {}\` + \`{ restoreFocus } = opts\` 분리
  - \`document.body.dataset.scrollY = String(scrollY)\` (DOMStringMap에 number 직접 할당 금지)
  - chip \`pointerdown\`/\`click\` 핸들러에 \`e.target instanceof Element\` 가드 + \`closest(\".search-chip\")\` \`HTMLElement\` cast
- **\`init*\` 핸들러 통일 (handle/drawer null 21건 일거 해소)**
  - \`initSheetDrag\` / \`initBookmarkSheetDrag\` / \`initBookmarkDrawerResize\` / \`initCompactHeader\`의 \`document.getElementById(...)\` 호출을 PR-1의 **\`_\$\`** 헬퍼로 통일
  - 이유: \`const handle = getElementById(...); if (!handle) return;\` early return은 outer scope에서는 narrow되지만 closure 안의 inner 함수(\`onPointerMove\`/\`onPointerUp\`)에서는 TS가 narrow을 보존하지 않아 'possibly null' 에러가 다시 발생. \`_\$\` 헬퍼는 declaration 자체를 \`HTMLElement\` non-null cast하므로 closure 안에서도 안정적

## Test plan

- [x] \`npx tsc -p tsconfig.app.json --noEmit\` — baseline 262 → 잔여 223 (PR-5 영역 L3245-L4229 **0 error**)
- [x] \`npx tsc -p tsconfig.json --noEmit\` — 0 error (회귀 없음)
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` — 0 error
- [x] \`node --test tests/unit/*.test.js\` — 111/111 pass
- [ ] e2e 회귀는 PR-7 머지 후 일괄 (CLAUDE.md 표준 — 코드 동작 변경 없음)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Primarily static-typing/JSDoc and DOM-null-safety adjustments in search UI code; runtime behavior should be unchanged aside from avoiding null/target edge-case crashes.
> 
> **Overview**
> Continues the incremental TypeScript migration by adding JSDoc-based type narrowing across the **Search / Search Sheet / Search History panel** section of `js/app.js`.
> 
> This tightens DOM interactions: narrows `$searchSheetInput` to `HTMLInputElement`, makes `app-header` height lookup null-safe, avoids destructuring from possibly-undefined options in `close()`, ensures `dataset.scrollY` is stored as a string, and adds `e.target instanceof Element` guards for chip interactions.
> 
> It also standardizes several deferred drag/resize initializers to use the non-null `_$()` helper instead of `getElementById(...)` to prevent repeated nullable-element errors inside nested closures.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit f55b2d2077f539ad7878e0290507cde96a661d5e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
