---
date: 2026-05-31
pr: 168
branch: feat/menu-routing-shell
title: "feat: 하단 내비 + 라우팅 셸 + ADR-026 (Stage 0)"
---

# feat: 하단 내비 + 라우팅 셸 + ADR-026 (Stage 0)

## 개요

`release/1.6.0` 이니셔티브의 **ADR-026**(결정 기록) + **Stage 0**(라우팅 셸 + 하단 4탭)을 담은 PR입니다. base = `release/1.6.0`.

## 포함 내용

### ADR-026 (결정 기록)
앱을 메뉴 기반 라우팅 앱으로 전환 + 노트(Drive 우선) 추가. 모바일 하단 4탭, 탭별 위치 복원, `notes.json` 분리 저장 + IDB 캐시/큐, 편집 가능 `date` + 캘린더/목록, 연합 검색, 단계 계획(Stage 0~5), 오디오 바 미니플레이어(§2.1).

### Stage 0 (코드)
- `js/app/bottom-nav.js` — 탭→라우트 매핑(`routeToTab`), `aria-current` 활성 표시, 탭별 마지막 위치 복원(인메모리), 읽기 화면 스크롤다운 시 내비 auto-hide.
- `index.html` — `#bottom-nav` 마크업(읽기/검색/북마크/노트) + 스크립트.
- `css/style.css` — 하단바(솔리드 + 상단 elevation), 오디오 바를 내비 위 **미니플레이어**로 스택, `#app` 하단 패딩, **모바일 검색 FAB 은퇴**(검색 탭이 대체) + FAB 잔재 정리.
- `views-routing.js` — `/notes` 라우트 + Stage 0 플레이스홀더, `route()`가 매 내비마다 `appBottomNav.onRoute()` 호출.
- `app.js` — 부트스트랩에 `initBottomNav`.

검색·북마크 탭은 Stage 0에선 기존 오버레이(시트/드로어)를 여는 **interim 배선**입니다 — Stage 2·3에서 `/search`·`/bookmarks` 라우트로 이관.

## 검증
- 유닛: `bottom-nav.test.js`(routeToTab 매핑) 추가, **전체 542 케이스 통과**.
- `tsc -p tsconfig.json --noEmit` **0 error**.
- ⚠️ 브라우저 시각 검증(하단바 레이아웃·오디오 바 스택·auto-hide·safe-area)은 e2e 로컬 전용이라 **수동 확인 필요**.

## 다음
Stage 1a(노트 코어) → 1b(캘린더·백업) → 2(검색 화면화) → 3(북마크 화면화) → 4(설정 화면화) → 5(데드패스 은퇴·ADR 개정·1.6.0 범프). 각 Stage는 별도 feature 브랜치 → 이 release로 PR 예정.

https://claude.ai/code/session_01WM3WYAF8uuLcQ3eARjGUKA

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches core mobile navigation, router integration, and fixed audio bar positioning; interim search/bookmark wiring and layout need manual mobile verification (safe-area, auto-hide).
> 
> **Overview**
> This PR lands **ADR-026** documentation and **Stage 0** implementation for mobile menu-style navigation on `release/1.6.0`.
> 
> **Mobile shell:** Adds `#bottom-nav` with four tabs (읽기 / 검색 / 북마크 / 노트), wired in new `js/app/bottom-nav.js` — `routeToTab()`, `aria-current` sync, in-memory last-route per tab for read/notes, and reading-view auto-hide on scroll-down via `body.bottom-nav-hidden`. The router calls `appBottomNav.onRoute()` after each navigation; bootstrap runs `init()` from `app.js`.
> 
> **Layout & audio:** Mobile CSS stacks the frosted `#audio-bar` as a mini-player above the solid bottom nav, pads `#app` for the bar + safe area, and retires the mobile search FAB (search tab is the entry). Chapter-nav / book-list FAB spacing is simplified accordingly.
> 
> **Routing placeholder:** `/notes` and `/notes/:id` parse and render a Stage 0 placeholder; search/bookmark tabs still open the legacy sheet/drawer until Stages 2–3.
> 
> **Supporting:** `index.html` markup + script, `sw.js` precache for `bottom-nav.js` and related modules, `bottom-nav.test.js` for `routeToTab`, architecture ADR index entry.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit b7e1b55c4579907a0ef6609931d241df1ca57f70. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
