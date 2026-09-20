---
date: 2026-05-09
pr: 95
branch: feat/app-modular-phase5
title: "refactor: app.js 모듈 분할 Phase 5 — search.js 추출"
---

# refactor: app.js 모듈 분할 Phase 5 — search.js 추출

## Summary
- ADR-018 Phase 5: Search 영역 전체를 \`js/app/search.js\` (~1,065줄)로 분리
- 추출 범위: 워커 wire-up + 결과 렌더 + 데스크톱 입력 핸들러 + 모바일 bottom sheet + 히스토리 패널 컨트롤러 + sheet drag init
- ESM 패턴(ADR-019): named exports + \`window.openSearchSheet\`/\`closeSearchSheet\`/\`renderSearchResults\`/\`initSheetDrag\`/\`isMobile\`/\`appendTextWithHighlight\`/\`consumeSearchAutoNavigate\`/\`appSearch\` facade
- \`searchAutoNavigate\` 모듈 상태는 \`consumeSearchAutoNavigate()\` 헬퍼로 app.js의 route()가 read-and-reset
- app.js facade 블록 5건 추가 노출(\`navigate\`/\`setTitle\`/\`setBreadcrumb\`/\`hideAudioBar\`/\`renderError\`) — search.js의 cross-module 호출용
- app.js header에서 search-only anchor 11개 제거 + 5개 유지(\`\$searchBar\`/\`\$searchInput\`/\`\$searchClear\`/\`\$searchSheet\`/\`\$searchFab\` — Escape/route/audio bar에서 직접 사용)
- \`types.d.ts\`: \`AppSearch\` 인터페이스 + \`Window.appSearch\` + 글로벌 declare 8건(\`openSearchSheet\`/\`closeSearchSheet\`/\`renderSearchResults\`/\`initSheetDrag\`/\`isMobile\`/\`appendTextWithHighlight\`/\`consumeSearchAutoNavigate\` + Phase 5 인접 5건)
- SHELL_CACHE shell-57 → shell-58
- app.js: 4,878 → 3,969줄 (−909)

## 알려진 잔여 (회귀 아님)
- \`tests/unit/*.test.js\`는 sync 레이어 한정(111 통과는 회귀 없음만 보장). app 레이어 유닛 테스트 0건 — 별도 의제로 추후 도입 (메모리 \`project_unit_test_expansion.md\`)
- \`tsconfig.app.json\` 5건: 기존 gtag/dataLayer ESM 외부, ADR-012 미적용

## Test plan
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.app.json --noEmit\` 신규 0 error (잔여 5건 위 참조)
- [x] \`node --test tests/unit/*.test.js\` 111 통과 (sync 레이어 회귀 없음)
- [ ] 브라우저: SW 캐시 무효화 후 데스크톱 검색(헤더 입력 + Enter)
- [ ] 모바일 FAB → 시트 열기/닫기 + Enter 검색
- [ ] in: 칩 입력 + 알 수 없는 별칭 안내
- [ ] 검색 히스토리 패널 ▾ 토글 + 화살표 이동 + 더 보기 + 모두 지우기 + 개별 삭제
- [ ] 구절 참조 매치(예: "요한 3:16") Enter → auto-navigate, URL 진입 → 클릭 카드
- [ ] 검색 결과 클릭 시 \`?hl=\` 강조 표시 (chapter 렌더의 appendTextWithHighlight 재사용)
- [ ] sheet drag handle로 높이 조정/스냅 닫기

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Refactors a large, user-facing search surface into a new ESM module and expands the `window` facade; regressions would show up at runtime in routing/search UI interactions and service-worker cached assets.
> 
> **Overview**
> Extracts the entire search feature set (worker wiring, results rendering, desktop input handling, mobile bottom sheet + history panel + drag-resize) out of `js/app.js` into a new ESM module `js/app/search.js`, keeping legacy call sites working via `window.openSearchSheet`/`closeSearchSheet`/`renderSearchResults`/`initSheetDrag` and a new `window.appSearch` facade.
> 
> Updates `app.js` to remove search-owned DOM anchors/state and to consume `searchAutoNavigate` via `consumeSearchAutoNavigate()`, while also re-exposing additional app-level functions on `window` (`navigate`, `setTitle`, `setBreadcrumb`, `hideAudioBar`, `renderError`) for cross-module calls.
> 
> Wires the new module into `index.html` and the service worker shell cache (bumping `SHELL_CACHE`), adds `AppSearch` typings and related global declarations in `types.d.ts`, and introduces new unit tests `tests/unit/search.test.js` for extracted search helpers/worker logic.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 126df5ada729e931cc3d016c4f71baf5c153b091. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
