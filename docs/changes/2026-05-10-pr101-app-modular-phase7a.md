---
date: 2026-05-10
pr: 101
branch: feat/app-modular-phase7a
title: "refactor: app.js 모듈 분할 Phase 7a — views-routing.js 신설 + 유닛 28건"
---

# refactor: app.js 모듈 분할 Phase 7a — views-routing.js 신설 + 유닛 28건

## Summary
- **\`js/app/views-routing.js\` 신설** (~540줄): Data fetching + Rendering helpers + Pull-to-refresh + Compact Header
- 세 영역이 app.js 곳곳에 흩어져 있던 코드를 하나로 모음 (Pull-to-refresh L255-L440, Data fetching+Rendering helpers L490-L749, Compact Header L1995-L2013)
- **window facade 13건** + 4개 const(\`DIVISION_LABELS\` / \`OT_SUBCATEGORY\` / \`OT_SUBCATEGORY_ORDER\` / \`OT_SUBCATEGORY_LABELS\`) 노출 — Phase 7b territory 호출자가 직접 참조. 이름 대문자 const라 일관성 약간 깨지지만 일시적(7b 머지 시 자연 해소)
- app.js facade 정리: \`window.setTitle\` / \`window.setBreadcrumb\` / \`window.getBooksCache\` 이전. \`booksCache\`/\`appVersion\` 모듈 상태도 동행 이전
- app.js의 \`DIVISION_LABELS[division]\` 인덱스에 \`?? ""\` 가드 추가 (parsePath 반환 narrowing으로 division이 string|undefined가 됨)

## 유닛 테스트 28건
- **DATA_FETCHING (11)**: loadBooks 캐시 hit / window.booksPromise 우선 / fetch fallback / !ok throw, loadVersion 캐시·window.appVersion 미러·실패 시 빈 문자열, loadChapter/loadPrologue 정상·throw
- **DIVISION (7)**: divisionLabels canonical 3건/vulgate 2건, divisionOrder 매트릭스, effectiveDivision deuterocanon → vulgate에서 old_testament 흡수
- **TITLE (4)**: clearNode→appendChild→announce 흐름, '공동번역성서' 단독은 \`document.title\` suffix 없음, 일반 텍스트는 suffix, 재호출 시 prior 클리어
- **BREADCRUMB (6)**: 빈 배열, single href/no-href, 다중 분리자, divisionPicker 분기, buildDivisionBreadcrumb \`<a href=\"/\${div}\">\`

미커버(jsdom 도입 전 보류): setTitleWithDivisionPicker/setTitleWithChapterPicker(popover trap focus), Pull-to-refresh IIFE(touch 이벤트), initCompactHeader(scroll).

## 라인 변동
- app.js: **2,126 → 1,661줄 (−465)**
- views-routing.js: 540줄 (신규)
- 누적: 6,082 → 1,661줄 (−4,421, **73% 감소**)

## Test plan
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.app.json --noEmit\` 신규 0 error
- [x] \`node --test tests/unit/*.test.js\` 245/245 (28건 추가, 회귀 0)
- [ ] 브라우저: SW 캐시 무효화 후 콘솔 0 오류
- [ ] 책 목록 (구약/외경/신약 각각, OT 소분류 표시)
- [ ] vulgate 모드 전환 시 deuterocanon이 구약 안에 흡수되는지
- [ ] 페이지 제목 + breadcrumb 정상 표시
- [ ] 모바일 Pull-to-refresh 제스처 동작 + Drive sync 트리거
- [ ] 스크롤 60px 초과 시 breadcrumb 접기

## 후속 (Phase 7b)
- Views + Routing + Audio Player 추출 (~1,200줄). 7a에서 임시 노출한 상수 4건은 7b 시점에 caller가 같은 모듈 안으로 들어와서 facade에서 제거 가능

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Moderate risk because it relocates core navigation/rendering/data-fetching helpers and changes global facades; regressions would surface as broken routing, titles/breadcrumbs, or book metadata loading.
> 
> **Overview**
> Introduces **`js/app/views-routing.js`** to pull **data fetching**, **title/breadcrumb rendering helpers**, **division constants**, **mobile pull-to-refresh**, and **compact-header-on-scroll** out of `app.js`, while keeping existing callers working via a `window` facade (including `getBooksCache` and temporarily exposing division-related constants).
> 
> Updates `index.html` and `sw.js` to load/cache the new module and bumps `SHELL_CACHE` to invalidate the shell cache. `app.js` is simplified accordingly, and adds a small guard when indexing `DIVISION_LABELS`.
> 
> Extends `js/types.d.ts` with the new facade/globals and adds `tests/unit/views-routing.test.js` covering the extracted pure blocks (data fetching, title, breadcrumb, division logic).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 12c6c54ee2ed142aaa15d61c323d7f211cc7ee17. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
