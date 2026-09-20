---
date: 2026-05-09
pr: 82
branch: feat/app-jsdoc-pr2
title: "chore: app.js JSDoc 도입 PR-2 — 설정 팝오버·외관·헬퍼 (ADR-012 2차)"
---

# chore: app.js JSDoc 도입 PR-2 — 설정 팝오버·외관·헬퍼 (ADR-012 2차)

## Summary

ADR-012 2차 적용 7단계 분할의 **2번째 PR**. PR-1([#81](https://github.com/anglican-kr/common-bible/pull/81)) 머지 후 라인 기준 **L595-L1273** — 설정 팝오버, 아이콘 리컬러, 컬러 스킴, 테마, 책 순서, 런치 스크린, `el`/`clearNode`, 북마크 스토리지 헬퍼.

- `js/types.d.ts`에 도메인 타입 4종 추가: `ColorSchemeId`, `ThemeMode`, `BookOrderKind`, `ColorSchemeEntry`
- `js/app.js` JSDoc + 타입 가드
  - `$settingsAnchor`를 PR-1의 `_$` 헬퍼로 통합 (anchor null 노이즈 제거)
  - `canvas.getContext("2d")` → `if (!ctx) return/reject` 가드 (`loadOrigIcon`, `updateAppIcons`)
  - `link[rel='icon']` / `link[rel='apple-touch-icon']` → `HTMLLinkElement` cast (4곳)
  - `COLOR_SCHEMES`를 `ReadonlyArray<ColorSchemeEntry>`로 narrow → `scheme.id`가 `ColorSchemeId`로 자동 추론
  - `cleanupTrap`(`(() => void) \| null`), `_systemThemeListener`(`((e: MediaQueryListEvent) => void) \| null`) 모듈 상태 narrow
  - `el()` generic narrow: `el(\"button\", ...)` → `HTMLButtonElement`, `el(\"input\", ...)` → `HTMLInputElement` 등으로 호출 측에서 per-call cast 없이 `.value` / `.disabled` / `.files` 접근 가능
  - 함수 시그니처 + 반환 타입 JSDoc
- `docs/design/app-typescript-migration.md` 진행 일지 갱신

## 알려진 부작용 (의도된 노출)

`el()` generic narrow의 부작용으로 **PR-3+ 영역(L1515-L2686)에 잠재 결함 22건**이 신규 노출됨. 이전엔 `el()` 반환이 implicit any였기 때문에 strictNullChecks 위반이 묻혀있었던 것. 후속 PR에서 자연스럽게 흡수.

| 분류 | 개수 | 예시 |
|---|---|---|
| `e.target` EventTarget narrow 누락 | ~8 | L1822, L1830, L1884, L1892, L2368, L2384, L2394 |
| `Element`에서 `.dataset` / `.focus` / `.contains` 접근 | ~6 | L1515, L1703, L1815, L1877, L2499 |
| `string \| null` parseInt/contains 인자 | ~4 | L2515, L2522, L2532, L2623 |
| 기타 (booksPromise, 빈 객체 destructure 등) | ~4 | L1743, L2045, L2686 |

## Test plan

- [x] `npx tsc -p tsconfig.app.json --noEmit` — baseline 282 → 잔여 294 (PR-2 영역 L595-L1273 **0 error**)
- [x] `npx tsc -p tsconfig.json --noEmit` — 0 error (회귀 없음)
- [x] `npx tsc -p tsconfig.worker.json --noEmit` — 0 error
- [x] `node --test tests/unit/*.test.js` — 111/111 pass
- [ ] e2e 회귀는 PR-7 머지 후 일괄 (CLAUDE.md 표준 — 코드 동작 변경 없음)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Mostly adds JSDoc/types to enable stricter TypeScript checking, with only small behavioral tweaks (extra null/instance guards) in DOM/canvas code paths.
> 
> **Overview**
> Continues the ADR-012 `app.js` TypeScript migration by adding JSDoc typings across the settings popover and appearance-related helpers (color scheme, theme, book order), including a generic-typed `el()` helper and tighter typing for module state/listeners.
> 
> Introduces new shared domain types in `js/types.d.ts` (`ColorSchemeId`, `ThemeMode`, `BookOrderKind`, `ColorSchemeEntry`) and updates `COLOR_SCHEMES`/setting loaders to use them, plus adds defensive guards/casts around `canvas.getContext`, `e.target`, and icon `<link>` lookups.
> 
> Updates the migration design doc progress tables/log to mark PR-1 merged and PR-2 completed.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit a924c08aa8b02ca405511e405c14cade0fa9b17c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
