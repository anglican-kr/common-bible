---
date: 2026-05-09
pr: 81
branch: feat/app-jsdoc-pr1
title: "chore: app.js JSDoc 도입 PR-1 — 헤드 영역 (ADR-012 2차)"
---

# chore: app.js JSDoc 도입 PR-1 — 헤드 영역 (ADR-012 2차)

## Summary

ADR-012(점진적 TS 도입) 2차 적용의 **첫 PR**. `js/sync/*` · `js/drive-sync.js` · `js/search-worker.js`에 1차 적용된 `// @ts-check` + JSDoc 방식을 `js/app.js`(5,854줄)에도 단계적으로 도입한다. 본 PR은 7단계 분할 중 1단계로 **L1-L513**(헤드 + 접근성 + 읽기 위치 + 오디오 시간 + 검색 히스토리 + 폰트 + 캐시)를 다룬다.

- `js/types.d.ts`에 도메인 타입 5종 추가: `ReadingPosition`, `AudioPosition`, `SearchHistoryList`, `VerseSelectDrag`, `DragState`
- `tsconfig.app.json` 신설 — PR 단계 검증용 임시 설정. `checkJs: true` + `noImplicitAny: false`로 단계 진행 중 핵심(`null` 검사·도메인 타입 불일치)만 잡는다. **PR-7에서 삭제** 후 메인 `tsconfig.json`이 `// @ts-check` opt-in으로 인계
- `js/app.js` L1-L513에 JSDoc + null/타입 가드 추가
  - DOM anchor 헬퍼 `_$` 도입(`HTMLElement` cast)으로 anchor null 노이즈 일괄 해소
  - `loadReadingPosition` / `loadAudioTime` / `loadSearchHistory` / `loadFontSize`의 `localStorage.getItem` → `null` 가드
  - `trapFocus` / 전역 keydown의 `querySelectorAll` 결과 `NodeListOf<HTMLElement>` narrow, `e.target instanceof Element` 가드
  - 함수 매개변수 + 반환 타입 JSDoc
- `docs/design/app-typescript-migration.md` 살아있는 설계 문서 신설 — 7단계 진행 매트릭스 + types.d.ts 누적 타입 + 임시 tsconfig 운영 정책 + 검증 절차

브라우저 동작은 변경 없음 (주석 + 형 캐스트만).

## Test plan

- [x] `npx tsc -p tsconfig.app.json --noEmit` — baseline 428 → **잔여 282** (PR-1 영역 L1-L513 **0 error**)
- [x] `npx tsc -p tsconfig.json --noEmit` — 0 error (1차 적용 파일 회귀 없음)
- [x] `npx tsc -p tsconfig.worker.json --noEmit` — 0 error
- [x] `node --test tests/unit/*.test.js` — 111/111 pass
- [ ] e2e 회귀는 PR-7 머지 후 일괄 (CLAUDE.md 표준 — 코드 동작 변경 없음)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Mostly adds JSDoc typing and null/type guards to enable gradual `tsc` checking of `js/app.js`, with minimal expected runtime behavior change. Main risk is inadvertent behavior drift from added guards/casts around DOM and `localStorage` access, but changes are localized to early app initialization utilities.
> 
> **Overview**
> Begins the staged migration of `js/app.js` to ADR-012 style static checking by adding JSDoc typedef imports, tightening a handful of DOM/keyboard-event and `localStorage` read paths with explicit null/type guards, and introducing the `_$(id)` anchor helper to avoid repetitive null checks.
> 
> Adds new app-level domain types (`ReadingPosition`, `AudioPosition`, `SearchHistoryList`, `VerseSelectDrag`, `DragState`) to `js/types.d.ts`, introduces a temporary `tsconfig.app.json` (`checkJs: true`, relaxed `noImplicitAny`) for incremental validation, and documents the 7-PR migration plan in `docs/design/app-typescript-migration.md`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit f554f0cbb5a4666f35c21333642f922096551d8b. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
