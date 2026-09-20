---
date: 2026-05-09
pr: 86
branch: feat/app-jsdoc-pr6
title: "chore: app.js JSDoc 도입 PR-6 — 설치 안내·북마크 UI·트리 렌더링·저장/병합 (ADR-012 2차)"
---

# chore: app.js JSDoc 도입 PR-6 — 설치 안내·북마크 UI·트리 렌더링·저장/병합 (ADR-012 2차)

## Summary

ADR-012 2차 적용 7단계 분할의 **6번째 PR**. PR-5([#85](https://github.com/anglican-kr/common-bible/pull/85)) 머지 후 라인 기준 **L4235-L5666** — 컴팩트 헤더, PWA 감지, 설치 안내 모달, 설치 nudge, 북마크 UI, 트리 렌더링, 저장/병합 모달. **가장 큰 단일 PR (~1,432줄)** 이지만 anchor 일괄 통일로 baseline 223 → 잔여 **11** (-212!).

- **모든 모듈-수준 anchor를 PR-1의 \`_$\` 헬퍼로 일괄 통일** (sed 단일 치환으로 48개 변환)
  - PR-1~5에서 점진 변환했던 anchor 외에 PR-6/7 영역의 anchor도 모두 정합. 영역 baseline 135개 중 다수가 이 한 변경으로 일거 해소
- **세부 narrow / 가드**
  - \`$bmSaveChapterBtn\` / \`$bmSelectVersesBtn\` → \`HTMLButtonElement\` (\`.disabled\` 접근)
  - \`$bmImportInput\` / \`$bmNewFolderInput\` → \`HTMLInputElement\` (\`.value\`/\`.files\`)
  - \`#install-never-show\` checkbox \`HTMLInputElement\` cast
  - modal expando \`_bmClose\`: \`HTMLElement & { _bmClose? }\` cast 4곳 (combobox close 콜백 패턴)
  - \`navigator.standalone\` (iOS legacy) \`any\` cast
  - install carousel \`timer\`: \`ReturnType<typeof setInterval>\` narrow + \`clearInterval(null)\` 가드
  - \`dataset.scrollY = String(scrollY)\` 2곳
  - \`_buildBookmarkTypeIcon\` JSDoc 매개변수 이름 정정 (\`active\`/\`size\`)
  - \`e.target instanceof Element\` 가드 3곳 (folder click, drawer keydown, drawer click)
  - \`BookmarkTreeNode\` 타입 narrow (folder vs bookmark) 3곳 — \`expanded\`(folder), \`verseSpec\`/\`label\`(bookmark)
  - \`BookmarkTreeBookmark\` 객체 리터럴 cast (\`commitSaveBookmark\`)
  - \`openMergeDialog\` 시그니처 JSDoc + \`target.bookId\`/\`target.verseSpec\` nullish 처리
  - \`link.click()\` \`HTMLElement\` cast (Enter/Space로 북마크 활성화)

## Test plan

- [x] \`npx tsc -p tsconfig.app.json --noEmit\` — baseline 223 → 잔여 **11** (PR-6 영역 L4235-L5666 **0 error**)
- [x] \`npx tsc -p tsconfig.json --noEmit\` — 0 error (회귀 없음)
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` — 0 error
- [x] \`node --test tests/unit/*.test.js\` — 111/111 pass
- [ ] e2e 회귀는 PR-7 머지 후 일괄 (CLAUDE.md 표준 — 코드 동작 변경 없음)

## 다음 단계

PR-7 영역(L5670-EOF, ~410줄)에 11개 잔여만 남음 — 내보내기/가져오기 + 절 선택 + 드로어 + SW 등록 + 최종 통합 (\`// @ts-check\` 영구 활성화 + \`tsconfig.app.json\` 삭제).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Mostly type-safety/JSDoc and DOM nullability guards with minimal runtime impact; small logic tweaks (e.g., `verseSpec`/`bookId` nullish defaults, `clearInterval` guards) are low-risk but touch bookmark merge/save paths.
> 
> **Overview**
> Strengthens `app.js` TypeScript-check readiness for the *install guide/nudge* and *bookmark UI/tree/save/merge* sections by converting module-level DOM anchors to the `_$()` helper and adding targeted casts/instance guards (inputs/buttons, `e.target`, expando `_bmClose`).
> 
> Adds a handful of defensive runtime tweaks uncovered by stricter typing: stringifying `dataset.scrollY`, guarding `clearInterval` when the carousel timer is null, casting iOS `navigator.standalone`, and narrowing bookmark node types so folder-only fields (`expanded`) and bookmark-only fields (`verseSpec`) are handled safely (including nullish defaults during save/merge).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 28ea37d57fb4953461b9708389f40553c275fa7c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
