---
date: 2026-06-13
pr: 289
branch: claude/bookmark-range-selection-evmipi
title: "feat: 절 선택 범위를 앵커 기반(Shift+클릭·홀드+탭)으로 교체"
---

# feat: 절 선택 범위를 앵커 기반(Shift+클릭·홀드+탭)으로 교체

## 요약

절 선택 모드의 **범위 선택**을 한-손가락 슬라이드 드래그에서 **기억된 앵커(anchor) 기반 모델**로 교체합니다. 종전 슬라이드 방식은 모바일에서 패닝하는 손가락이 페이지 스크롤과 경합해 사실상 동작하지 않았습니다(끌면 화면만 스크롤됨).

## 동작

- **탭/클릭**: 단일 절 토글 + 앵커 이동. 반복 탭으로 **비연속 절** 선택(기존 유지).
- **범위 확장 (앵커→타깃, additive)**: 앵커가 기억되므로 두 끝점이 한 화면에 같이 보일 필요가 없습니다 — **시작 절 탭 → 자유 스크롤 → 끝 절 지정**.
  - **데스크탑**: 끝 절을 **Shift+클릭** (파일 탐색기·에디터 표준 관용구).
  - **모바일**: 끝 절을 **롱프레스(약 300ms 길게 누르기)** — 모바일의 "Shift" 역할.
- 손가락을 끝까지 물고 있을 필요가 없어 **화면 분량 제약이 사라지고** 스크롤 경합도 없습니다.
- 롱프레스 300ms / 드로어 "절 선택" 버튼 진입은 그대로, 진입 절이 첫 앵커가 됩니다.

## 변경 내용

- `readingContext.selectAnchor`(`string | null`) 상태 추가 — 마지막 개별 토글 절의 `data-vref`.
- 선택 모드 `pointerdown`은 per-pointer 롱프레스 타이머(`_activePointers` 맵)를 걸고, >10px 드리프트(스크롤)나 빠른 lift(=탭)면 타이머 취소. 선택 모드에서 `preventDefault` 미적용 → 자유 스크롤 보존(텍스트 선택은 `user-select:none`으로 차단).
- 순수 헬퍼 `_verseRangeVrefs(allVrefs, anchor, target, unitFn)` — 양방향·운문 다중부분 경계 확장. `views.js` `VERSE_SELECTION` 마커 블록.
- 슬라이드 드래그 핸들러 + `VerseSelectDrag` 타입 제거 (`reading-context.js`·`types.d.ts`·`bookmark.js` 정리).
- ADR-010 개정 블록(2026-06-13) 추가.

## 테스트

- `_verseRangeVrefs` 유닛 7케이스 추가 → `node --test tests/unit/*.test.js` **734 통과**.
- `tsc -p tsconfig.json` / `tsconfig.worker.json` 0 error.
- ⚠️ 모바일 롱프레스 확장 / 스크롤 후 확장 / 데스크탑 Shift+클릭은 실제 브라우저 e2e 수동 확인 권장(CI 미실행).

https://claude.ai/code/session_01NwghbUmURTDCpNpeG66zEp

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches core chapter pointer/gesture handling and shared `readingContext`; regressions in tap vs long-press vs scroll are possible though guarded and unit-tested for range math.
> 
> **Overview**
> Replaces **in-mode slide-drag range selection** (pointer drag + `elementFromPoint`) with an **anchor-based model** so users can tap a start verse, scroll freely, then extend the range to a distant end verse—fixing mobile scroll fighting the old gesture.
> 
> **Behavior:** `readingContext.selectAnchor` tracks the last individually toggled `data-vref`. Plain taps still build non-contiguous selections. **Desktop** uses **Shift+click** on the far verse; **mobile** uses a **~300ms long-press** on the far verse (with >10px drift canceling the timer for scroll). Range fills are **additive** via new helper `_verseRangeVrefs` (bidirectional, pure-poetry unit expansion). Select-mode `pointerdown` no longer calls `preventDefault`, so scrolling works; `setPointerCapture` plus `verseSelectMode` / `article.isConnected` guards avoid stale toggles after exit or navigation.
> 
> **Cleanup:** `VerseSelectDrag` and `verseSelectDrag` are removed from types and `reading-context.js`; enter/exit verse-select resets `selectAnchor` and long-press entry sets the first anchor. ADR-010 documents the change; **7 unit tests** cover `_verseRangeVrefs`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit e71c1ffa825a33ad92db124f25b690e18d02d809. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
