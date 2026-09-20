---
date: 2026-05-10
pr: 104
branch: feat/app-modular-phase8
title: "refactor: app.js 모듈 분할 Phase 8 — 모듈 분할 종료 + // @ts-check 영구화"
---

# refactor: app.js 모듈 분할 Phase 8 — 모듈 분할 종료 + // @ts-check 영구화

## Summary
**ADR-018 모듈 분할 8단계 종료**. 6,082줄 단일 파일이 9개 도메인 모듈 + 283줄의 app-main 부트스트랩으로 분리됐습니다 (95% 감소).

## 작업 내용
1. **drag init 2건 이전**: \`initBookmarkSheetDrag\` / \`initBookmarkDrawerResize\`를 app.js → bookmark.js로 이동. drawer geometry init은 bookmark 모듈 책임. bookmark.js facade(\`appBookmark.initBookmarkSheetDrag\` / \`initBookmarkDrawerResize\`) 추가
2. **app.js 헤드 슬림화**:
   - 미사용 typedef 14개 제거
   - 미사용 destructure 26개 제거 (storage 22개, helpers 4개) — 잔존: \`_$\`/\`el\` (helpers), \`loadFontSize\`/\`loadTheme\`/\`loadColorScheme\` (storage, 시작 시 settings 적용용), \`initSettings\`/\`applyXxx\`/\`dismissLaunchScreen\` (settings)
   - 마이그레이션 경위 코멘트 + dead 섹션 마커 정리 (\`Reading position\` / \`Font size\` / \`Book order\` / \`Helpers\`)
3. **`// @ts-check` 영구 활성화** + `tsconfig.app.json` 삭제 — 메인 `tsconfig.json` 단일 검증으로 통일
4. **ADR-012 개정 블록**: 2차 라운드(`js/app.js` + `js/app/*` 9개 모듈) 종료 마킹
5. **ADR-018 진행 일지**: Phase 8 + "모듈 분할 종료" 항목 추가
6. **CLAUDE.md**: 아키텍처 트리에서 app.js 역할 갱신, "현재 상태" 섹션에 모듈 분할 완료 항목 추가
7. **메모리 \`project_inflight_work.md\`**: 1라운드 보류 사유 → 2라운드 종료로 갱신

## 라인 변동
- app.js: **464 → 283줄 (−181)**
- bookmark.js: drawer geometry 2개 함수 흡수 (+~60줄)
- 누적: **6,082 → 283줄 (95% 감소)**
- 모듈별 분할 결과: helpers ~120, storage ~350, settings-ui ~600, install ~430, search ~1,065, reading-context ~37, bookmark ~2,090, views-routing ~1,790

## 검증
- [x] `npx tsc -p tsconfig.json --noEmit` 0 error (\`// @ts-check\` 적용된 모든 모듈 포함)
- [x] `npx tsc -p tsconfig.worker.json --noEmit` 0 error
- [x] `tsconfig.app.json` 삭제됨 (이상 잔재 없음)
- [x] `node --test tests/unit/*.test.js` 245/245 통과
- [ ] 브라우저: SW 캐시 무효화 후 콘솔 0 오류
- [ ] 책 목록 / 장 보기 / 검색 / 북마크 추가·삭제·드래그 / 설정 팝오버
- [ ] PWA 설치 안내 / 절 선택 모드 / 오디오 재생·spacebar 토글
- [ ] Drive 동기화 / Pull-to-refresh / Compact Header

## ADR/메모리 갱신
- `docs/decisions/012-typescript-incremental-adoption.md`: 2차 라운드 종료 개정 블록
- `docs/design/app-modularization.md`: Phase 7b 머지 + Phase 8 진행 일지
- `CLAUDE.md`: 파일 트리 + 현재 상태 섹션
- 메모리 `project_inflight_work.md`: 1라운드 보류 → 2라운드 종료로 전체 갱신

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Moderate risk because it changes app bootstrap wiring and global facade exposure (moving bookmark drawer init and enabling `// @ts-check`), which could cause runtime `ReferenceError`s or missing-init regressions if any callsites were overlooked; also bumps the service worker shell cache, forcing a client refresh path.
> 
> **Overview**
> Completes ADR-018 Phase 8 by trimming `js/app.js` down to an `app-main` bootstrap module and moving the bookmark drawer drag/resize initialization (`initBookmarkSheetDrag`, `initBookmarkDrawerResize`) into `js/app/bookmark.js` with corresponding `window` facade/type updates.
> 
> Enables permanent TypeScript checking for the app layer by adding `// @ts-check` to `js/app.js`, deleting the temporary `tsconfig.app.json`, and updating docs/ADR notes to reflect single-source validation via `tsconfig.json`.
> 
> Bumps the service worker `SHELL_CACHE` (`shell-62` → `shell-63`) to roll out the updated module set.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ce05ca1dd438dd66727c8c9ed5af2148fb4e9daf. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
