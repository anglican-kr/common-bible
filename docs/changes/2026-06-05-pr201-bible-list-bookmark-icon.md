---
date: 2026-06-05
pr: 201
branch: claude/bible-list-bookmark-icon-uMrAH
title: "style: 성서 목록 헤더 북마크 아이콘 제거 + 장 선택 팝오버 볼드 제거"
---

# style: 성서 목록 헤더 북마크 아이콘 제거 + 장 선택 팝오버 볼드 제거

## 요약

읽기 화면 헤더/장 선택 UI 정리 두 건.

### 1. 성서 목록 화면 헤더에서 북마크 아이콘 제거
성서 목록 화면(`renderBookList`) 헤더에서 북마크 아이콘을 제거하고, **책 읽기 화면(장·머리말) 헤더에만** 북마크 아이콘이 노출되도록 정리했습니다.

- 성서 목록 화면은 장 맥락이 없어 헤더 북마크의 '이 장 저장' 동작이 의미가 없었습니다.
- 북마크 전체 관리는 하단 탭 바의 북마크 탭(ADR-029)이 담당하므로, 목록 헤더의 북마크 진입점은 중복이었습니다.

### 2. 장 선택 팝오버에서 현재 장 숫자 볼드 제거
`.popover-item.current` 의 `font-weight: 700` 을 제거했습니다. 현재 보고 있는 장은 꽉 찬 accent 배경 + 링으로 충분히 구별되므로 볼드는 불필요한 강조였습니다.

## 변경 내용

- `js/app/views-routing.js` — `renderBookList`에서 `buildBookmarkHeaderBtn(null, null)` 호출 제거. 읽기 화면(`renderChapter`·`renderPrologue`)의 북마크 버튼은 그대로 유지.
- `css/style.css` — `.popover-item.current` 의 `font-weight: 700` 제거.
- `docs/decisions/010-bookmark-feature.md` — 헤더 북마크 아이콘이 읽기 화면 전용임을 개정 블록으로 명문화.

## 검증

- `npx tsc -p tsconfig.json --noEmit` — 0 error
- `node --test tests/unit/*.test.js` — 589/589 통과

https://claude.ai/code/session_01PNgjSTcuWAYUKzZMXXznou

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> UI/문서 정리로 라우팅·북마크 저장 로직은 건드리지 않으며, 장 맥락이 있는 화면의 북마크 동작은 유지됩니다.
> 
> **Overview**
> **성서 목록**(`renderBookList`) 헤더에서 `buildBookmarkHeaderBtn` 호출을 제거해, 헤더 북마크 진입점이 **장 읽기·장 목록** 등 장 맥락이 있는 화면에만 남도록 정리합니다. 전체 북마크 관리는 하단 **북마크 탭**(ADR-029)으로 일원화하는 UX 정리입니다.
> 
> **ADR-010**에 2026-06-05 개정 블록을 추가해, 헤더 북마크 아이콘이 읽기 화면 전용임을 문서화했습니다.
> 
> 부수적으로 장 선택 팝오버 **현재 장** 스타일(`.popover-item.current`)에서 `font-weight: 700`만 제거했습니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 984e9824d020f6ccc8ada4e11e2d556d46b85985. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
