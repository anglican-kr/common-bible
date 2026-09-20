---
date: 2026-05-09
pr: 87
branch: feat/app-jsdoc-pr7
title: "chore: app.js JSDoc 도입 PR-7 — 1라운드 종료 (ADR-012 2차)"
---

# chore: app.js JSDoc 도입 PR-7 — 1라운드 종료 (ADR-012 2차)

## Summary

ADR-012 2차 적용 7단계 분할의 **마지막 PR**. PR-6([#86](https://github.com/anglican-kr/common-bible/pull/86)) 머지 후 라인 기준 **L5670-L6082** — 내보내기/가져오기 + 절 선택 + 드로어 + SW 등록.

이 PR로 **마이그레이션 1라운드 종료**. 단, 원래 PR-7 plan의 \`// @ts-check\` 영구 활성화 + \`tsconfig.app.json\` 삭제는 **app.js 파일 분할 리팩터링과 결합한 별도 의제**로 보류. 사유: 5,800줄 단일 파일에 \`noImplicitAny: true\` 일괄 적용 시 ~262 implicit any가 발생해 단일 PR로 정리하면 거대한 변경량이 되고, 분할(modularization) 후 각 모듈이 자체 \`// @ts-check\`를 옵트인하는 게 자연스러움.

## 변경 내용

- **PR-7 영역 잔여 11 fix** (L5670-L6082)
  - button (\`$bmAddFolderBtn\`/\`$verseSelectBookmarkBtn\`) → \`HTMLButtonElement\`
  - file input \`$bmImportInput.files?.[0]\` 옵셔널 체이닝
  - \`e.target instanceof Element\` 가드
  - FileReader \`result\` (\`string | ArrayBuffer | null\`) → string narrow
  - \`bookmark-drawer-toolbar\` getElementById를 \`_$\` 헬퍼로 통일
- **모듈 상태 변수 ~30개 일괄 narrow** (\`/** @type {Foo | null} */\`)
  - \`booksCache: BooksData | null\`, \`appVersion: string | null\`, \`currentAudio: HTMLAudioElement | null\`, \`_audioController: AbortController | null\`, \`_audioSaveTimer: ReturnType<typeof setTimeout> | null\`
  - \`_scrollTrackCleanup: (() => void) | null\`, \`_selectedVerseRefs: Set<string>\`, \`_verseSelectDrag\`, \`_currentBookId/_currentChapter\`, 4개 \`*Trap\`, \`_bmNewFolderCallback\`, \`_bookmarkDrawerCloseTimer\`, \`_dragState\`
- **narrow 부작용 정리**
  - \`loadBooks\`: \`await promise\` 결과를 별도 변수로 받아 반환 흐름 narrow
  - \`loadVersion\` 반환 \`appVersion ?? ""\`
  - \`_audioSaveTimer\` clearTimeout null guard 2곳
  - \`getAttribute(...) ?? ""\` 패턴 ~10곳 (verse selection drag/tap 핸들러)
  - \`_bookmarkDrawerLastFocus = document.activeElement\` \`HTMLElement\` cast
- **tsconfig.app.json**: 헤더 주석 갱신 — 1라운드 완료 후에도 **유지** 사유 명시
- **docs/design/app-typescript-migration.md**: 상태 "1라운드 종료" + §9 PR-7 마무리 방식 변경 + 진행 일지 마무리
- **docs/decisions/012-typescript-incremental-adoption.md**: \`> **개정 (2026-05-09):**\` 블록 추가 — 1라운드 완료, 추가된 도메인 타입 16종, 운영 패턴, 다음 라운드 트리거

## 마이그레이션 1라운드 정리

| 단계 | PR | baseline | 잔여 | net |
|---|---|---|---|---|
| PR-1 | #81 | 428 | 282 | -146 |
| PR-2 | #82 | 282 | 294 | +12 |
| PR-3 | #83 | 294 | 280 | -14 |
| PR-4 | #84 | 280 | 262 | -18 |
| PR-5 | #85 | 262 | 223 | -39 |
| PR-6 | #86 | 223 | 11 | **-212** |
| PR-7 | (본 PR) | 11 | 3 | -8 |

최종 잔여 3개는 \`gtag-init.js\` (Google Analytics dataLayer global) — ADR-012 미적용 외부 파일.

## 후속 의제 (별도)

\`js/app.js\` 파일 분할 리팩터링 + 각 모듈의 \`// @ts-check\` 영구 활성화 + \`tsconfig.app.json\` 최종 삭제. 시작 시점에 \`docs/design/app-typescript-migration.md\` §10 등으로 이어쓰기.

## Test plan

- [x] \`npx tsc -p tsconfig.app.json --noEmit\` — 잔여 3 (gtag-init.js 외부)
- [x] \`npx tsc -p tsconfig.json --noEmit\` — 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` — 0 error
- [x] \`node --test tests/unit/*.test.js\` — 111/111 pass
- [ ] e2e 회귀는 본 PR 머지 후 일괄 (CLAUDE.md 표준 — 코드 동작 변경 없음)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Mostly type-safety/JSDoc-only changes with small defensive runtime guards (e.g., null checks around timers, FileReader parsing), so behavior impact should be minimal but touches widely-used `app.js` flows.
> 
> **Overview**
> Closes out **ADR-012 `js/app.js` 2차 적용 1라운드** by further narrowing module-level state in `js/app.js` with JSDoc types and tightening a handful of DOM/file/timer interactions (e.g., safer `FileReader` parsing, `getAttribute(...) ?? ""`, and `clearTimeout` null guards).
> 
> Updates `tsconfig.app.json` comments and the ADR/design docs to reflect that **`// @ts-check` is not yet enabled at the `app.js` head and `tsconfig.app.json` is intentionally kept** until a follow-up `app.js` modularization effort.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 7074575df0c03a975dbbbd6e4628c91dcec0bc4e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
