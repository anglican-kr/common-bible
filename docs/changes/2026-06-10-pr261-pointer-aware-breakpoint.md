---
date: 2026-06-10
pr: 261
branch: feat/pointer-aware-breakpoint
title: "feat: 적응형 내비 분기를 포인터 인식으로 (ADR-029 개정)"
---

# feat: 적응형 내비 분기를 포인터 인식으로 (ADR-029 개정)

## 요약

"모바일/터치 ↔ 데스크탑" 레이아웃 경계를 **너비 단독 → 포인터 인식**으로 전환합니다. 전면 화면 iPhone 을 가로로 들면 768px 을 넘어 데스크탑 티어로 잘못 분류돼 탭 바가 사라지던 문제를 해소합니다.

## 규칙 (정확한 여집합)
- 모바일/터치 = `(max-width: 768px), (pointer: coarse)` — 좁은 창 **또는** 터치
- 데스크탑 = `(min-width: 769px) and (pointer: fine)` — 넓은 창 **그리고** 마우스

## 효과

| 환경 | 변경 후 |
|---|---|
| 폰 세로 | 모바일 |
| **폰 가로 (844)** | **모바일** (탭 바 유지) |
| **아이패드 (터치)** | **모바일** |
| 데스크탑 넓은 창 | 데스크탑 |
| 데스크탑 좁은 창 (<769) | 모바일 (유지) |

`pointer:coarse`+`hover:none` 은 터치 기기(아이폰·아이패드 포함)를 안정적으로 식별. 미디어 쿼리라 회전·마우스 연결에 자동 대응(JS resize 리스너 불필요).

## 변경
- **CSS 17개 티어 미디어 쿼리** 전환(`min-width:769px` → `and (pointer:fine)`, `max-width:768px` → `, (pointer:coarse)`) + 설명 주석 3곳
- **JS 4곳**: `isMobile`(search) · `_isMobileViewport`(bookmark) · `overlay.js` 시트↔사이드패널(`_isDesktopPanel` 헬퍼) · `tabbar.js` 모핑 정리 리스너
- **유닛 2곳**: search 쿼리 단언 갱신, overlay 하니스 matchMedia 스텁 추가
- **문서**: ADR-029 개정 블록, status.md

## 트레이드오프
- 터치 노트북(coarse+마우스)·아이패드+트랙패드 → 모바일 티어 (수용; `settings-ui` 의 `pointer:fine` 선례와 동일 방향)
- 좁은 데스크탑 창 → 모바일 (현행 동작 보존)
- 넓은 태블릿도 지금은 폰 스타일 모바일 레이아웃 (전용 2-pane 은 Phase 2+)

## 검증
- `tsc` 0, 유닛 **708/708** 통과
- Playwright 매트릭스 — 아이폰 세로/가로·아이패드·데스크탑 넓은/좁은 5종 전부 설계대로. `is_mobile` 컨텍스트가 `pointer:coarse` 보고 확인.
- dev 테스트 배포본으로 실기기 점검 진행 중

## 범위 밖 (후속)
- 데스크탑 사이드바(≥1024 and pointer:fine) — ADR-029 §6
- 태블릿 전용 2-pane 레이아웃

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 반응형 내비·오버레이·북마크/검색 분기 전반에 걸친 동작 변경이며, 터치 노트북·아이패드+트랙패드는 모바일 티어로 묶이는 수용된 트레이드오프가 있습니다.
> 
> **Overview**
> **모바일/데스크탑 적응형 내비 경계**를 너비만 보던 `≤768px` / `≥769px`에서 **포인터 인식 미디어 쿼리**로 바꿉니다 (ADR-029 개정 2026-06-09).
> 
> - **모바일·터치 티어:** `(max-width: 768px), (pointer: coarse)` — 좁은 창이거나 터치 기기
> - **데스크탑 티어:** `(min-width: 769px) and (pointer: fine)` — 넓은 창이면서 마우스
> 
> 가로로 돌린 iPhone·iPad처럼 너비만 넓어져 데스크탑 티어로 잘못 잡히던 경우에도 **하단 탭 바·모바일 헤더·바텀 시트**가 유지됩니다.
> 
> **CSS** — 탭 dock, 시트/드로어(데스크탑 사이드 패널·모달), 북마크 스와이프, 헤더 북마크/설정 등 **17개 티어 `@media` 규칙**을 위 조합으로 통일하고 관련 주석을 갱신합니다.
> 
> **JS** — `search.js` `isMobile()`, `bookmark.js` `_isMobileViewport()`, `overlay.js` `_isDesktopPanel()`(시트 드래그 vs 사이드 패널), `tabbar.js` 데스크탑 전환 시 검색 모핑 정리 리스너가 **동일한 `matchMedia` 쿼리**를 씁니다.
> 
> **문서·테스트** — ADR-029 개정 블록, `docs/status.md` 한 줄, `search.test.js`·`overlay.test.js` 쿼리/`matchMedia` 스텁을 맞춥니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 11234fa58d5537d2377cafb8f9a0fabb153cbc9c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
