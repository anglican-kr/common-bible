---
date: 2026-05-09
pr: 84
branch: feat/app-jsdoc-pr4
title: "chore: app.js JSDoc 도입 PR-4 — 라우팅 + 오디오 플레이어 (ADR-012 2차)"
---

# chore: app.js JSDoc 도입 PR-4 — 라우팅 + 오디오 플레이어 (ADR-012 2차)

## Summary

ADR-012 2차 적용 7단계 분할의 **4번째 PR**. PR-3([#83](https://github.com/anglican-kr/common-bible/pull/83)) 머지 후 라인 기준 **L2702-L3233** — 라우팅(`parsePath`/`route`/anchor click 핸들러)과 오디오 플레이어.

- **Routing**
  - `parseInt(query.get("page") ?? "", 10)` null 가드
  - `updatePageMeta` 빈 객체 destructure 회피 (`opts = {}` + `{ title, description } = opts`)
  - `route()`의 `view === "prologue"` / `view === "chapter"` branch마다 `bookId`/`chapter` narrow 가드 (parsePath 반환의 view-disjoint 필드를 destructure로 받는 구조에서 TS가 narrow하지 못함)
  - `$searchInput.value = parsed.query ?? ""` null 처리
  - 전역 anchor click 핸들러: `e.target instanceof Element` 가드 + `closest(\"a[href]\")` 결과 `HTMLAnchorElement` cast (`.href`/`.target` 접근)
- **Audio Player**
  - `progress.max` 를 `Number(...)`로 cast하여 number 비교 (`max > 0`)
  - `observeFabLift`의 `querySelector(\".chapter-nav\")` 결과 `HTMLElement` cast
  - 시그니처 JSDoc: `formatTime(sec: number)`, `_updateFabLift(nav: HTMLElement)`, `showAudioPlayer(bookId, chapter)`
- **모듈 헤드 미세 조정 (PR-1 영역)**
  - `$searchInput`을 `HTMLInputElement`로 narrow — `.value` 접근의 per-call cast 회피. PR-5에서 `$searchSheetInput` 등도 같은 패턴 예정
- **PR-3과의 일관성 보강**
  - `saveReadingPosition` signature를 `chapter: number \| \"prologue\"` 로 확장 — PR-3에서 `ReadingPosition.chapter` union narrow와 일관

## Test plan

- [x] \`npx tsc -p tsconfig.app.json --noEmit\` — baseline 280 → 잔여 262 (PR-4 영역 L2702-L3233 **0 error**)
- [x] \`npx tsc -p tsconfig.json --noEmit\` — 0 error (회귀 없음)
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` — 0 error
- [x] \`node --test tests/unit/*.test.js\` — 111/111 pass
- [ ] e2e 회귀는 PR-7 머지 후 일괄 (CLAUDE.md 표준 — 코드 동작 변경 없음)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk: changes are primarily JSDoc annotations and defensive null/type guards, with only minor runtime behavior changes (early returns and safer parsing/casting).
> 
> **Overview**
> **Adds PR-4 TypeScript-check hardening for `js/app.js` routing and audio player.**
> 
> Routing now has explicit null/union handling (`parsePath` page parsing, `updatePageMeta(opts={})`, `$searchInput` narrowed to `HTMLInputElement`, and `route()` branches guarded to ensure `bookId`/`chapter` are valid before use). The global anchor click handler also guards `e.target` and casts `closest("a[href]")` to an `HTMLAnchorElement`.
> 
> Audio-player related helpers add JSDoc signatures and safer DOM/number handling (casts for `.chapter-nav` lookup and `progress.max` arithmetic). The migration design doc is updated to mark PR-3 merged and PR-4 as in-progress/complete in the log.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit e2148c8f4d140b8e6b85487f5ced2d4703273afe. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
