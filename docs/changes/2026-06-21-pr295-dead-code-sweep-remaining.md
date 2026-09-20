---
date: 2026-06-21
pr: 295
branch: refactor/dead-code-sweep-remaining
title: "refactor: install 고아 setBackgroundInert 헬퍼 제거"
---

# refactor: install 고아 setBackgroundInert 헬퍼 제거

## 배경

"모듈 분할 후 죽은 코드 일괄 제거" 백로그 후속. PR #294(search·install aggregate 객체) 에 이어 **나머지 모듈 전수 sweep** 을 진행했다.

## sweep 결과

다음 4개 죽은코드 범주를 전 모듈(`js/app/*`, `js/*`)에 자동 점검 + 직접 확인:

| 범주 | 결과 |
| --- | --- |
| 정의 외 참조 0인 window facade | 없음 (rebuildDriveSyncSection 는 state-machine.js 의 동적 `typeof` 가드로 살아있음 — 거짓양성) |
| 미사용 export | 없음 |
| 미사용 ESM import | 없음 |
| 미사용 window 디스트럭처 바인딩 | 없음 |
| 미호출 지역 함수 | **1건** → `setBackgroundInert` (install.js) |

## 변경

ADR-032 오버레이 컨트롤러 이행으로 install 모달 inert 처리가 `createOverlay({ inertSelectors })` 내부로 옮겨가면서, 수동 래퍼 `setBackgroundInert()` 가 호출자 없는 잔재로 남았다. 제거하고, 그에만 쓰이던 `setInert` 디스트럭처 바인딩도 정리. `INSTALL_INERT_SELECTORS` 는 createOverlay 옵션으로 계속 쓰여 유지.

순수 정리 −5/+3.

## 검증

- grep 무참조 확증 (js/ + index.html + tests/)
- `tsc --noEmit` → 0 errors
- `node --test tests/unit/*.test.js` → 734 pass / 0 fail
- playwright 스모크 → 모달 open 시 배경 `#app` inert 적용, close 시 해제, `setBackgroundInert` undefined, JS pageerror 0

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Pure deletion of unreferenced code with no change to overlay inert wiring or modal behavior.
> 
> **Overview**
> Dead-code cleanup in `install.js` after ADR-032 moved install modal inert handling into `createOverlay({ inertSelectors: INSTALL_INERT_SELECTORS })`.
> 
> Removes the unused local wrapper `setBackgroundInert()` and drops the `setInert` import from `window.appHelpers` because nothing in this module calls it anymore. **`INSTALL_INERT_SELECTORS` is unchanged** and still drives background inert via the overlay controller; only comments are tightened to document that flow.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 1107577ca467d87b9ab596bec259f8e75c39fbd7. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
