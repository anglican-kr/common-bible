---
date: 2026-06-10
pr: 273
branch: feat/bookmark-sort-direction-labels
title: "feat: 북마크 정렬 방향에 기준별 설명 문구"
---

# feat: 북마크 정렬 방향에 기준별 설명 문구

## 무엇을
정렬 방향 "오름차순/내림차순" 라벨 옆에 **활성 정렬 기준에 맞는 설명**을 muted 로 단다. 오름/내림은 추상적이고 그 뜻이 기준마다 뒤집혀(제목 오름=가나다, "추가된 날짜" 오름=오래된 순) 혼동되기 쉬웠다.

| 정렬 기준 | 오름차순 | 내림차순 |
|---|---|---|
| 제목 | (가나다순) | (ㅎ→ㄱ) |
| 추가된 날짜 | (오래된 순) | (최신 순) |
| 수정한 날짜 | (오래된 순) | (최근 순) |
| 최근에 본 날짜 | (오래전 본 순) | (최근 본 순) |
| 직접 정렬 | 설명 없음 (행 비활성) | — |

## 구현
- 정적 문구가 아니라 `syncDirChecks` 가 메뉴 열 때 활성 기준에 맞춰 갱신.
- 괄호는 **CSS-only**(`::before`/`::after`)라 스크린리더는 단어만 읽음("오름차순 가나다순"). 직접 정렬엔 설명이 없어 `:empty` 로 괄호째 숨김.
- HIG: 선행 체크열 + 라벨 형태 유지(아이콘+라벨 표준 부합). 근거: [Menus](https://developer.apple.com/design/human-interface-guidelines/menus) HIG.

## 검증
- tsc 0 errors · 유닛 728건 통과(표현 전용이라 신규 유닛 없음)
- Playwright(모바일): 기준 전환 시 설명 갱신(제목→가나다순/ㅎ→ㄱ, created→오래된 순/최신 순, viewed→오래전 본 순/최근 본 순), 직접 정렬 시 설명 숨김+행 비활성, 페이지 오류 0 + 스크린샷으로 괄호·muted 렌더 확인
- ADR-010 개정 보강

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 표현·메뉴 UI만 바뀌며 정렬·저장 로직은 그대로다.
> 
> **Overview**
> 북마크 **더 보기** 메뉴의 **오름차순/내림차순** 행에, 현재 정렬 기준에 맞는 **짧은 설명**을 라벨 뒤에 muted 로 붙인다(예: 제목일 때 `가나다순`/`ㅎ→ㄱ`, 날짜 기준일 때 `오래된 순`/`최신 순`).
> 
> `syncDirChecks`가 메뉴를 열 때마다 `_DIR_CLARIFY` 맵으로 문구를 갱신하고, **직접 정렬**이면 설명을 비워 `:empty`로 괄호까지 숨긴다. 괄호는 CSS `::before`/`::after`만 사용해 스크린리더에는 단어만 읽히게 했다. ADR-010에 동작을 문서화했다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 5ba3ceacab2713733a10b741626148fff1e9373a. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
