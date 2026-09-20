---
date: 2026-05-09
pr: 92
branch: feat/esm-bulk-conversion
title: "feat: ESM 일괄 전환 (ADR-019)"
---

# feat: ESM 일괄 전환 (ADR-019)

## Summary

ADR-019([#91](https://github.com/anglican-kr/common-bible/pull/91))의 결정을 코드에 적용. 빌드 단계 0을 유지하면서 모든 모듈을 ES module로 전환.

- 10개 파일에 `export {};` ESM marker 추가
- `index.html`의 9개 `<script defer>` → `<script type="module">`
- 예외 2건 (audio-cache.js / pre-fetch.js): 외부 제약 — ADR-019 §"예외" 신설
- 테스트 하네스 호환 — vm classic script 평가 위해 ESM marker stripper 추가
- `window.X` facade는 그대로 (sync 회귀 방지)

## ESM 전환 목록

| 파일 | 변경 |
|---|---|
| `js/sync/debug-log.js` | `export {};` + `<script type="module">` |
| `js/sync/refresh-store.js` | 동일 |
| `js/sync/transport.js` | 동일 |
| `js/sync/state-machine.js` | 동일 |
| `js/sync/store-v2.js` | (이미 ESM, Phase 2) |
| `js/drive-sync.js` | `export {};` + module |
| `js/gtag-init.js` | `export {};` + module |
| `js/app/helpers.js` | `export {};` + module |
| `js/app/storage.js` | (이미 ESM, Phase 2) |
| `js/app/settings-ui.js` | `export {};` + module |
| `js/app.js` | `export {};` + module |

## 예외 2건

| 파일 | 사유 |
|---|---|
| `js/audio-cache.js` | `sw.js`의 `importScripts()`로도 로드되는데, `importScripts`는 classic script만 받음. `<script defer>` 그대로 |
| `js/pre-fetch.js` | `<head>`에 non-defer로 즉시 fetch 시작 (books.json). `type="module"`의 자동 deferred로 인한 회귀 회피 |

ADR-019에 §"예외" 절 신설.

## 테스트 하네스 호환

`tests/unit/harness.js`가 `vm.runInContext`로 sync 파일을 평가 — classic script만 지원하므로 `export {};`가 SyntaxError. `stripEsmMarker` 정규식으로 marker만 제거 후 평가. production runtime 영향 0.

ADR-019에 §"테스트 하네스 호환" 절 신설.

## window.X facade 유지

기존 `window.driveSync`, `window.syncTransport`, `window.appHelpers`, `window.appStorage` 등은 그대로. 본 PR은 module scope 격리만 목적이며, facade 점진 폐기는 후속 작업(`import`/`export`로 개별 호출 전환)에서 진행.

`const` 바인딩이 자동으로 `window`에 등록되지 않는 사실은 Phase 3 PR #90에서 이미 발견 — sync layer가 의존하는 `window.applyFontSize`/`Theme`/`ColorScheme` 노출 패턴은 그대로 적용됨.

## Test plan

- [x] `npx tsc -p tsconfig.app.json --noEmit` — 잔여 2 (gtag-init.js의 dataLayer 글로벌, ADR-012 미적용)
- [x] `npx tsc -p tsconfig.json --noEmit` — 0 error
- [x] `npx tsc -p tsconfig.worker.json --noEmit` — 0 error
- [x] `node --test tests/unit/*.test.js` — 111/111 pass
- [ ] 브라우저 동작 — 머지 전 사용자 수동 (`scripts/serve.py 8080` → `/` 접속, 콘솔 0 오류; 특히 Drive 동기화 + 설정 변경 + 검색 + 이어읽기)

## 다음 단계

Phase 4: `js/app/install.js` (~430줄) — PWA 감지 + 설치 안내 모달 + nudge auto-show. ESM 패턴으로 시작.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Switching most browser scripts from classic `defer` to ESM can change execution timing and global exposure, with potential runtime regressions (especially around Drive sync and app bootstrap). Risk is mitigated by keeping `window.*` facades and explicitly exempting `audio-cache.js`/`pre-fetch.js`, plus a test-harness adaptation.
> 
> **Overview**
> Adopts **ADR-019** by converting the app and sync client scripts to load as **ES modules**: `index.html` changes the main script tags from `defer` to `type="module"`, and the affected `.js` files append an `export {}` marker to force module scoping for TypeScript and name isolation.
> 
> Keeps two files as classic scripts for compatibility/perf (`js/audio-cache.js` remains classic for `sw.js` `importScripts()`; `js/pre-fetch.js` remains non-deferred to start `books.json` fetch early), bumps the service worker `SHELL_CACHE`, and updates the Node `vm` unit-test harness to strip the ESM marker before evaluation.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ab344f3b39abc993f20995c83c19ee9190ca7052. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
