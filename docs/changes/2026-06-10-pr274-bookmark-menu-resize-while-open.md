---
date: 2026-06-10
pr: 274
branch: fix/bookmark-menu-resize-while-open
title: "fix: 북마크 ⋯ 메뉴 열린 채 회전 시 높이 재계산"
---

# fix: 북마크 ⋯ 메뉴 열린 채 회전 시 높이 재계산

## 문제
⋯ 더 보기 메뉴의 `max-height` 를 **열 때 한 번만** 계산해, 메뉴를 연 채 기기를 돌리면 이전 방향의 cap 이 남았다.
1. **가로에서 열고 세로로 돌림** → 365px 그대로라 세로에선 공간이 남는데도 **스크롤바가 사라지지 않음**.
2. **세로에서 열고 가로로 돌림** → 819px 그대로라 짧은 가로 화면을 **넘쳐 하단 항목에 못 닿고 스크롤바도 안 생김**.

## 수정
계산을 `sizeMenu()` 로 묶어 **열 때 + 메뉴가 열려 있는 동안 매 `resize` 마다** 재계산(회전 시 `innerHeight` 와 앵커 top 이 동시에 바뀜). 리스너는 `openMenu` 등록 / `closeMenu` 해제, SPA 내비로 트리거가 떨어지면(`!isConnected`) `sizeMenu` 가 스스로 해제(기존 doc 리스너 self-clean 패턴 동일).

## 검증 (Playwright, 모바일)
| 시나리오 | 열 때 | 회전 후 |
|---|---|---|
| 가로 열기 → 세로 | maxH 365px·스크롤O | maxH **819px 재계산**·스크롤**X** ✅ |
| 세로 열기 → 가로 | maxH 819px·스크롤X | maxH **365px 재계산**·스크롤O·끝 항목 도달O ✅ |

- 페이지 오류 0 · tsc 0 errors · 유닛 728건 통과
- ADR-030 후속⁷ 재계산 노트 추가

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 북마크 헤더 ⋯ 메뉴의 로컬 JS·문서만 변경되며, 열림/닫힘 시 리스너 등록·해제 패턴은 기존과 동일하다.
> 
> **Overview**
> **북마크 ⋯ 더 보기** 메뉴의 뷰포트 하단 `max-height` 계산을 `sizeMenu()`로 묶고, **열 때 한 번**이 아니라 메뉴가 열려 있는 동안 **`resize`마다** 다시 적용한다. 기기 회전 시 `innerHeight`와 ⋯ 버튼 `top`이 같이 바뀌는데, 이전에는 한 방향에서 연 cap이 남아 세로로 돌리면 불필요한 스크롤이 남거나, 가로로 돌리면 화면을 넘쳐 하단 항목에 닿지 못하는 문제가 있었다.
> 
> `openMenu`에서 `sizeMenu()` 호출 후 `resize` 리스너를 등록하고, `closeMenu`에서 해제한다. SPA로 헤더가 사라져 트리거가 떨어지면 `sizeMenu`가 `!isConnected`일 때 리스너를 스스로 제거한다(기존 doc 클릭/키 리스너 self-clean과 동일). **ADR-030** 후속⁷에 회전 시 재계산 노트를 추가했다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit a270e445f3419736c7ede62044586eae7ad23b46. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
