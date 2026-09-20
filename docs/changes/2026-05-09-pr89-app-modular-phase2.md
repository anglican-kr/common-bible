---
date: 2026-05-09
pr: 89
branch: feat/app-modular-phase2
title: "feat: app.js 모듈 분할 Phase 2 — storage.js 추출 (ADR-018)"
---

# feat: app.js 모듈 분할 Phase 2 — storage.js 추출 (ADR-018)

## Summary

ADR-012 2차 적용 2라운드의 **두 번째 단계**. localStorage 기반 load/save 헬퍼와 UI 공유 상수를 단일 모듈로 분리. app.js 6,053 → **5,835줄** (-218).

## 신설 모듈

\`js/app/storage.js\` — 28개 함수 + 4개 export 상수, IIFE + \`window.appStorage\`, \`// @ts-check\` 영구 활성화.

| 영역 | 함수 |
|---|---|
| Reading position | \`save\`/\`load\`/\`clearReadingPosition\` |
| Audio time | \`save\`/\`load\`/\`clearAudioTime\` |
| Search history | \`normalize\`/\`load\`/\`save\`/\`push\`/\`remove\`/\`clearSearchHistory\` (BEGIN/END 마커도 함께 이동) |
| Settings | \`load\`/\`save\` × {\`StartupBehavior\`, \`FontSize\`, \`ColorScheme\`, \`Theme\`, \`BookOrder\`} |
| Bookmarks | \`generateId\`, \`loadBookmarks\`, \`saveBookmarks\` |
| Install nudge | \`_loadNudgeState\`, \`_saveNudgeState\` |
| Storage 헬퍼 | \`_maybeRequestPersist\` (\`saveBookmarks\` 내부 호출 + 오디오 play에서도 사용 예정) |

상수 export: \`FONT_SIZES\`, \`DEFAULT_FONT_SIZE\`, \`COLOR_SCHEMES\`, \`SEARCH_HISTORY_MAX\`.

## ESM 옵트인 (ADR-018 §모듈-vs-스크립트 예외 신설)

\`storage.js\`가 정의하는 \`saveBookmarks\`/\`loadBookmarks\`가 \`js/sync/store-v2.js\`의 동일 이름 글로벌 함수와 충돌. 두 파일 모두 ES module로 옵트인 (\`export {};\` + \`<script type="module">\`)하여 함수/typedef를 module scope로 격리.

- 다른 sync 파일은 store-v2 함수를 \`window.syncStoreV2.X\` facade로만 호출 → **caller 변경 0**
- ADR-001 SPA 단순성 유지 (빌드 단계 0, import/export 의무 없음, \`window.X\` 글로벌 노출 그대로)
- ADR-018에 옵트인 절차·사유·범위 명시

부수 효과: \`store-v2.js\`가 ESM이라 글로벌 \`BookmarkTreeNode\` typedef 끊김 → \`app.js\` 모듈 헤드에 자체 typedef 추가 (1라운드 PR-3에서 충돌 회피로 deferred했던 부분이 자연 해소).

## 다른 변경

- \`js/types.d.ts\`: \`AppStorage\` 인터페이스 + \`InstallNudgeState\` + \`Window\` augmentation
- \`js/app.js\`: 정의 모두 제거, 모듈 헤드에 destructure 추가
- \`index.html\`: \`<script type="module">\` 두 개 (storage.js + store-v2.js)
- \`sw.js\`: SHELL_CACHE \`shell-52\` → \`shell-53\`, \`/js/app/storage.js\` 추가
- \`tests/unit/search-history.test.js\`: \`APP_PATH\` 갱신

## Test plan

- [x] \`npx tsc -p tsconfig.app.json --noEmit\` — 잔여 3 (gtag-init.js 외부)
- [x] \`npx tsc -p tsconfig.json --noEmit\` — 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` — 0 error
- [x] \`node --test tests/unit/*.test.js\` — 111/111 pass
- [ ] 브라우저 동작 확인 — 머지 전 사용자 수동 (\`scripts/serve.py 8080\` → \`/\` 접속, 콘솔 0 오류; 특히 북마크 저장/불러오기 + 설정 변경 + 검색 history)

## 다음 단계

Phase 3: \`settings-ui.js\` (~600줄) — Settings popover + 외관(Color/Theme/Book order/Icon recoloring/Launch screen). storage 의존, helpers 의존.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Mostly a refactor, but it changes script loading to mix `defer` and `type="module"` for `storage.js` and `sync/store-v2.js`, plus bumps the SW shell cache; any load-order/CSP/module-scope mismatch could break app initialization or sync/bookmark persistence.
> 
> **Overview**
> Implements ADR-018 Phase 2 by extracting all localStorage-backed persistence logic (reading position, audio time, search history, settings, bookmarks, install nudge, and persisted-storage request) into a new `js/app/storage.js` facade exposed as `window.appStorage`, and wiring `app.js` to consume these helpers/constants via destructuring.
> 
> To avoid TypeScript global name collisions (`saveBookmarks`/`loadBookmarks`) the PR opts `js/app/storage.js` and `js/sync/store-v2.js` into ES module scope via `export {}` and loads both with `<script type="module">` in `index.html`.
> 
> Updates typings (`AppStorage`, `InstallNudgeState`, `window.appStorage`), moves the search-history unit-test extraction target to `storage.js`, documents the new module-vs-script exception in ADR/design docs, and bumps the service worker shell cache to include the new module.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 46a2d3ffdee1cc28e8b5d8a47d2d6bc59406494a. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
