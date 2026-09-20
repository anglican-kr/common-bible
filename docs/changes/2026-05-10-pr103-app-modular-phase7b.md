---
date: 2026-05-10
pr: 103
branch: feat/app-modular-phase7b
title: "refactor: app.js 모듈 분할 Phase 7b — Views + Routing + Audio Player 추출"
---

# refactor: app.js 모듈 분할 Phase 7b — Views + Routing + Audio Player 추출

## Summary
- Views + Routing + Audio Player 전체를 \`js/app/views-routing.js\`에 합류 (540 → 1,783줄, +1,243)
- Phase 7a 시점 임시 노출했던 4개 const facade(\`DIVISION_LABELS\`/\`OT_SUBCATEGORY\`/\`OT_SUBCATEGORY_ORDER\`/\`OT_SUBCATEGORY_LABELS\`)는 같은 모듈 안 caller로 흡수돼 자연 해소
- **추가 이전 항목**:
  - Audio Player 상태 3개(\`currentAudio\` / \`_audioController\` / \`_audioSaveTimer\`)
  - Routing 상태 2개(\`_scrollTrackCleanup\` / \`_isInitialLoad\`)
  - \`startScrollTracking\` (Reading position section에 잔류했던 routing-internal 함수)
  - popstate listener
- **DOMContentLoaded 부트스트랩은 app.js 잔류** (app-main 책임): \`route\`/\`loadVersion\`/\`initCompactHeader\`/\`maybeShowInstallNudge\` 등은 window facade로 호출
- **\`window.getCurrentAudio\` 게터 신설**: app.js 접근성 spacebar handler가 currentAudio 읽기용 (Phase 7b까지 audio 모듈 상태가 분리되었으므로)

## Bonus 정리: gtag 잔재 회귀
ADR-019 ESM 일괄 전환 시 \`function gtag()\`이 module-scoped로 떨어졌고, 이후 \`gtag-init.js\` 내부 호출만 동작하던 상태. Phase 7b의 \`trackPageView\`(views-routing.js)가 bare \`gtag(...)\` 호출하면서 회귀 노출:
- \`gtag-init.js\`에 \`window.gtag = gtag\` 노출 추가 + \`dataLayer ?? []\` null 가드
- \`types.d.ts\`에 글로벌 \`function gtag(...)\` + \`const dataLayer\` 선언 + \`Window.gtag\`/\`Window.dataLayer\` 추가

결과로 **app.config tsc 잔여 5건도 동시 해소** (이번 PR로 0 error).

## 라인 변동
- app.js: **1,650 → 464줄 (−1,186)**
- views-routing.js: 540 → 1,783줄 (+1,243)
- 누적: 6,082 → 464줄 (**−5,618, 92% 감소**)

## Test plan
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.app.json --noEmit\` **0 error** (기존 5건 잔재 해소)
- [x] \`node --test tests/unit/*.test.js\` 245/245
- [ ] 브라우저 SW 캐시 무효화 후 콘솔 0 오류
- [ ] 페이지 라우팅 (책 목록 / 구분 / 책별 장 목록 / 장 / 머리말 / 검색 결과)
- [ ] 오디오 재생/일시정지/재생 위치 저장
- [ ] 스페이스바 키로 오디오 토글 (접근성 keydown handler)
- [ ] Pull-to-refresh / Compact Header 회귀 없음
- [ ] popstate (브라우저 뒤로가기) 동작

## 후속 (Phase 8)
- app.js 잔류 464줄을 정리: 부트스트랩 + 접근성 keydown + Audio cache LRU helpers + Service Worker 등록 + initBookmarkSheetDrag/initBookmarkDrawerResize(bookmark.js로 이동) — 작은 모듈 1~2개로 분리 후 \`tsconfig.app.json\` 삭제 + app.js에 \`// @ts-check\` 영구 활성화 (ADR-012 2차 라운드 종료)

🤖 Generated with [Claude Code](https://claude.com/claude-code)


<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Moves core SPA routing, view rendering, and audio player logic across modules and changes global facade wiring, so regressions could affect navigation, resume behavior, and playback despite being a refactor.
> 
> **Overview**
> **Completes Phase 7b modularization by relocating core UI flow.** `Views`, `Routing` (including `popstate` handling), reading-position scroll tracking, and the full Audio Player are moved out of `app.js` into `js/app/views-routing.js`, with `app.js` reduced to bootstrap, accessibility key handlers, audio-cache LRU maintenance, and service worker registration.
> 
> **Updates cross-module globals for the ESM transition.** `views-routing.js` now owns the `window` facade for `parsePath`/`route`/`navigate`/`hideAudioBar`/`renderError`, adds `window.getCurrentAudio()` for the spacebar play/pause handler, and removes the temporary Phase 7a constant facades. Google Analytics is fixed for ESM by guarding `dataLayer` and assigning `window.gtag = gtag`; `js/types.d.ts` is updated accordingly.
> 
> **Rolls cache version forward.** `sw.js` bumps `SHELL_CACHE` to `shell-62`, and docs (`CLAUDE.md`, `app-modularization.md`) are updated to reflect the new module responsibilities.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 535b1597fd2b17299a0efe21a960d135cefdae5b. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
