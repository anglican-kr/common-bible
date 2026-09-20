---
date: 2026-05-09
pr: 93
branch: feat/app-modular-phase4
title: "refactor: app.js 모듈 분할 Phase 4 — install.js 추출"
---

# refactor: app.js 모듈 분할 Phase 4 — install.js 추출

## Summary
- ADR-018 Phase 4: PWA install detection + Install guide modal + Install nudge auto-show를 \`js/app/install.js\` (~432줄)로 분리
- ADR-019 ESM 패턴 첫 적용: named exports + \`window.install\`/\`window.openInstallModal\`/\`window.maybeShowInstallNudge\`/\`window.appInstall\` facade
- \`setInert\`을 \`helpers.js\`로 승격(install + bookmark drawer 공용). \`AppHelpers\` 인터페이스에 추가
- \`BOOKMARK_INERT_SELECTORS\` + \`setBookmarkBackgroundInert\`은 app.js 유지(Phase 6에서 bookmark.js로 이동 예정)
- \`types.d.ts\`: \`InstallObject\`/\`InstallSubscriptionState\`/\`AppInstall\` 인터페이스 + \`Window.appInstall\` + 글로벌 \`function maybeShowInstallNudge()\` 선언
- app.js: 5,290 → 4,878줄 (−412). \`_loadNudgeState\`/\`_saveNudgeState\` storage destructure 제거(install.js로 이동)
- index.html: \`<script type=\"module\" src=\"/js/app/install.js\">\` 추가(settings-ui.js 다음, app.js 이전)
- sw.js: SHELL_FILES에 \`/js/app/install.js\` 추가, SHELL_CACHE shell-55 → shell-56

## Test plan
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.app.json --noEmit\` Phase 4 신규 0 error (잔여 5건은 ESM 변환 후 gtag/dataLayer 외부, ADR-012 미적용)
- [x] \`node --test tests/unit/*.test.js\` 111/111 통과
- [ ] 브라우저 콘솔 0 오류 (SW 캐시 무효화 후)
- [ ] 설치 안내 모달 동작 확인 (설정 → 앱 설치 → 안내)
- [ ] iOS Safari/Android Chrome platform detection
- [ ] Install nudge auto-show (특정 방문 횟수 후)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Moderate risk because the PR changes script load order/exports and moves install-modal logic across modules, which can cause runtime regressions if globals or service-worker caching are miswired.
> 
> **Overview**
> Extracts all PWA install-related logic (platform detection, install guide modal, and install nudge auto-show) from `js/app.js` into a new ESM module `js/app/install.js`, exporting named functions while also re-exposing `window.install`/`window.openInstallModal`/`window.maybeShowInstallNudge` (plus `window.appInstall`) for legacy callers.
> 
> Promotes the shared background accessibility helper to `window.appHelpers.setInert`, updates `types.d.ts` with new install-related interfaces/window globals, and wires the new module into `index.html` and the service worker shell cache (including a `SHELL_CACHE` bump).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit d9960dee2b0f47441ba601df9360faad7c4019b0. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
