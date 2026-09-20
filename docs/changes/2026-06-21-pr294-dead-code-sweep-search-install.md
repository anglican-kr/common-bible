---
date: 2026-06-21
pr: 294
branch: refactor/dead-code-sweep-search-install
title: "refactor: search·install 잔여 죽은 코드 제거"
---

# refactor: search·install 잔여 죽은 코드 제거

## 배경

미완료 작업 롤업의 "모듈 분할 후 죽은 코드 일괄 제거" 백로그 후속. PR #243이 북마크 모듈만 정리했고, 나머지 모듈은 미점검 상태였다. search·install 모듈을 sweep 한 결과 잔재 3건을 확인·제거한다.

## 변경

모듈 분할(ADR-018) 후 search.js·install.js 가 **개별 window facade** 와 **미사용 aggregate 객체** 를 함께 노출하고 있었다. 소비자는 개별 facade 만 쓰고 aggregate 객체는 어디서도 읽히지 않았다.

| 제거 | 위치 | 근거 |
| --- | --- | --- |
| `window.appSearch` | search.js | 멤버 전부 개별 `window.X`+ESM export 로 중복 노출, 객체 자체 참조 0 |
| `window.appInstall` | install.js | 동일 — 멤버 개별 노출, 객체 참조 0 |
| `window.closeBookFilterSheet` | search.js | ADR-032/033 teardown 이 `closeAllOverlays()` 로 대체, 호출자 0 |
| `AppSearch`·`AppInstall` 인터페이스 + Window 멤버 + `closeBookFilterSheet` 선언 2곳 | types.d.ts | 위 제거에 동반 |

순수 삭제 31줄(추가 0). 개별 facade(`renderSearchResults`·`install`·`maybeShowInstallNudge` 등)와 다른 모듈의 aggregate(`appHelpers`·`appStorage`·`appOverlay` 등 — 실제 사용 중)는 그대로 유지.

## 검증

- 전 저장소 grep 무참조 확증 (js/ + index.html 인라인 + tests/, `window.X`/bare 양형)
- `tsc -p tsconfig.json --noEmit` → 0 errors
- `node --test tests/unit/*.test.js` → 734 pass / 0 fail
- playwright 로드 스모크 → 제거 facade 3종 `undefined`, live facade 유지, JS pageerror 0 (`/` → `/search` → `/` 라우트 왕복 포함)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Deletion-only cleanup with no remaining references; search/install and overlay teardown paths are unchanged aside from removing unused exports.
> 
> **Overview**
> Follow-up dead-code sweep after ADR-018 modularization: **search** and **install** no longer expose unused aggregate `window` objects alongside their real APIs.
> 
> **`js/app/search.js`** drops `window.appSearch` (members were already on `window.renderSearchResults`, `commitTopSearch`, etc.) and **`window.closeBookFilterSheet`**, which had zero callers now that **`route()`** tears down overlays via **`appOverlay.closeAllOverlays()`** (ADR-034).
> 
> **`js/app/install.js`** drops **`window.appInstall`** for the same reason—**`window.install`**, **`openInstallModal`**, and related hooks stay.
> 
> **`js/types.d.ts`** removes **`AppSearch`**, **`AppInstall`**, and **`closeBookFilterSheet`** from **`Window`** and bare global declarations so TypeScript matches runtime. Pure deletion (~31 lines); behavior unchanged for live facades.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 2786e850c539c061af3adb6c073367364286cc58. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
