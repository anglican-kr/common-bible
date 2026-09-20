---
date: 2026-05-09
pr: 90
branch: feat/app-modular-phase3
title: "feat: app.js 모듈 분할 Phase 3 — settings-ui.js 추출 (ADR-018)"
---

# feat: app.js 모듈 분할 Phase 3 — settings-ui.js 추출 (ADR-018)

## Summary

ADR-012 2차 적용 2라운드의 **세 번째 단계**. Settings popover + icon recoloring + theme/color/font apply + launch screen을 단일 모듈로 분리. app.js **5,835 → 5,273줄** (-562).

## 신설 모듈

\`js/app/settings-ui.js\` (~570줄, multi-script + defer, IIFE + \`window.appSettings\`, \`// @ts-check\` 영구 활성화).

| 영역 | 함수 / 모듈 상태 |
|---|---|
| Settings popover | \`initSettings\` (Book order/Startup/Font/Theme/Color/Install/Drive/Cache/About 섹션) |
| Icon recoloring | \`hexToRgb\`, \`loadOrigIcon\`, \`updateAppIcons\` + \`ICON_BG_LUM\`, \`_iconGeneration\` |
| Color scheme apply | \`applyColorScheme\` + \`DEFAULT_FAVICON_HREF\`, \`DEFAULT_APPLE_ICON_HREF\` |
| Theme apply | \`applyTheme\`, \`updateThemeMetaColor\` + \`_systemThemeListener\`, \`_darkMQ\` |
| Launch screen | \`dismissLaunchScreen\` + \`_launchScreenDismissed\`, \`_fontReadyPromise\`, \`FONT_READY_TIMEOUT_MS\` |
| Font apply | \`applyFontSize\` |

multi-script + defer로 옵트인 (storage.js처럼 ESM 필요 없음 — 함수/typedef 이름 충돌 없음).

## types.d.ts 확장

- **\`AppSettings\` 인터페이스 신규**: \`initSettings\`/\`applyFontSize\`/\`applyTheme\`/\`applyColorScheme\`/\`dismissLaunchScreen\`/\`updateThemeMetaColor\`
- **임시 글로벌 declare** (settings-ui가 호출하는 app.js 함수들): \`announce\`, \`openInstallModal\`, \`openDriveDisconnectModal\`, \`clearAllCaches\`, \`parsePath\` (시그니처는 \`any\` — Phase 7에서 정확한 discriminated union으로 대체), \`route\`. 각 함수가 자기 모듈로 이동할 때 declaration도 함께 정리됨
- **Window augmentation**: \`install\`, \`appVersion\` 추가 (settings-ui가 \`window.install\`/\`window.appVersion\`로 접근)

## app.js 변경

- 모듈 헤드에 destructure 추가
- 추출된 정의 모두 제거 (sed 두 range 삭제로 깔끔히 잘림)
- \`const install = ...\` 다음 \`window.install = install;\` 라인 추가 (글로벌 const는 window에 자동 노출 안 됨)
- \`loadVersion\`: \`appVersion\` 갱신 시 \`window.appVersion\`도 미러 (Phase 7 data-fetching 모듈 이동 예정)

## index.html / sw.js

- \`<script defer src="/js/app/settings-ui.js"></script>\` 추가 (storage.js 다음)
- \`SHELL_CACHE\` \`shell-53\` → \`shell-54\`, \`/js/app/settings-ui.js\` 추가

## Test plan

- [x] \`npx tsc -p tsconfig.app.json --noEmit\` — 잔여 3 (gtag-init.js 외부)
- [x] \`npx tsc -p tsconfig.json --noEmit\` — 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` — 0 error
- [x] \`node --test tests/unit/*.test.js\` — 111/111 pass
- [ ] 브라우저 동작 확인 — 머지 전 사용자 수동 (\`scripts/serve.py 8080\` → \`/\` 접속, 콘솔 0 오류; 특히 ⚙ 설정 메뉴 열기 + 글자 크기/테마/색상 변경 + 외경 배치 변경 + 캐시 초기화 + Drive 연결/해제 + iOS 설치 안내 + 앱 시작 시 launch screen 페이드아웃)

## 다음 단계

Phase 4: \`install.js\` (~430줄) — PWA 감지 + 설치 안내 모달 + nudge auto-show. \`maybeShowInstallNudge\`, \`buildInstallBody\`, \`openInstallModal\`/\`closeInstallModal\` 등. settings-ui의 임시 declare 중 \`openInstallModal\`은 이때 정리.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Moderate refactor that moves a large chunk of UI logic into a new module and changes global wiring (`window.apply*`, `window.install`, `window.appVersion`), which could cause runtime/load-order regressions if miswired. Service worker shell cache is bumped, so any mistake will affect all clients after update.
> 
> **Overview**
> Completes ADR-018 **Phase 3** by extracting the settings popover, theme/color/font application, icon recoloring, and launch-screen dismissal out of `js/app.js` into a new `js/app/settings-ui.js` module exposed as `window.appSettings`.
> 
> Updates `app.js` to consume the new facade, re-expose `applyFontSize`/`applyTheme`/`applyColorScheme` on `window` for the sync layer, and mirror `install` and `appVersion` onto `window` for cross-module access.
> 
> Wires the new script into `index.html`, adds typings (`AppSettings`, new `Window` fields, and temporary global function declares), and bumps `sw.js` shell cache while precaching `settings-ui.js`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit e00edcafdfde1a0b8f7da931d87d0ad7368ce0a7. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
