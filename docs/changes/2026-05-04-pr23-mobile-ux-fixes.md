---
date: 2026-05-04
pr: 23
branch: feat/mobile-ux-fixes
title: "feat: 모바일 북마크 행 스와이프·롱프레스 UX (drive-sync 분리)"
---

# feat: 모바일 북마크 행 스와이프·롱프레스 UX (drive-sync 분리)

## Summary

- **모바일 북마크 행 swipe/longpress UX 살리기**: 기존 `feat/drive-sync` PR #20에서 drive-sync 코드와 함께 묶여 있던 비-sync 변경 2개를 분리해 main에 반영
- **drive-sync는 폐기 예정**: PR #20의 [`js/drive-sync.js`](https://github.com/anglican-kr/common-bible/blob/feat/drive-sync/js/drive-sync.js) 및 18개 fix 커밋은 ADR-011 재설계(별도 PR 1~4)로 대체하기 위해 통째로 폐기하기로 결정 (`docs/decisions/011-bookmark-sync.md` 재작성 예정)

## 포함된 커밋

| 원본 | 내용 |
|------|------|
| `7139d9b` | `css/style.css` + `js/app.js` — iOS Safari `:hover` 첫 탭 문제 해소를 위한 모바일 행 swipe·longpress·single-tap 분기 |
| `931f47` | `js/app.js` — 롱프레스 후 발생하는 `click` 이벤트가 노출된 액션 패널을 즉시 닫는 버그 수정 (capture·once로 직후 1회 click 흡수) |

원본 커밋들이 drive-sync와 한 브랜치에 섞여 있었으나, 두 커밋의 변경 내용에는 drive-sync 의존이 없음. 본 PR은 `main` 기준으로 cherry-pick·conflict 해소(드라이브 디스컨넥트 모달 css 제외)를 거친 결과.

ADR-010의 모바일 행 UX 개정 블록은 PR #21에서 이미 main에 반영됨.

## Test plan

- [ ] 모바일 뷰포트(≤768px)에서 북마크 행 단일 탭 = 즉시 이동
- [ ] 좌측 스와이프 = 우측에 수정/삭제 액션 슬라이드 노출
- [ ] 롱프레스(500ms) = 동일 액션 노출, 손 떼고 외부 탭 시 정상 닫힘
- [ ] 롱프레스로 액션 노출 후 액션 버튼 클릭이 정상 동작 (즉시 닫히지 않음)
- [ ] 데스크톱 hover-reveal UX 회귀 없음

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Medium risk: changes pointer/gesture handling for bookmark rows and modifies the DOM structure/CSS for those rows, which could introduce regressions in drag-to-reorder or tap navigation on mobile/desktop.
> 
> **Overview**
> Improves mobile bookmark-drawer UX by replacing hover-revealed row actions with a **swipe-left or 500ms long-press** slide-out action panel, avoiding iOS Safari’s first-tap-creates-`:hover` double-tap issue.
> 
> Updates bookmark/folder row markup to wrap content in `bm-row-content` and adds a hidden `bm-row-actions-mobile` panel (edit/delete) that is revealed via `bm-swiped`/`bm-swiping` classes; adds logic to ensure only one row is revealed at a time and to auto-close the panel when tapping elsewhere or closing the drawer.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 399585af226a90126b6b04dbfb1973d620339f9a. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
