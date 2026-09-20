---
date: 2026-06-01
pr: 173
branch: fix/parallel-anchor-focus-and-chapter
title: "fix: <parallel> anchor chapter 검증 + tooltip ref link focus 복원"
---

# fix: <parallel> anchor chapter 검증 + tooltip ref link focus 복원

## Summary

1.5.12 릴리스 PR (#170, #172) 의 Cursor Bugbot 리뷰에서 발견된 두 medium 버그를 동시에 수정. 두 버그 모두 `js/app/parallels.js` 의 ADR-027 신규 코드 — 같은 PR 에서 발견했으므로 한 commit 으로 묶음.

### Bug 1 — `findParallelsStartingAt` ignores range chapter ([PR #170 review](https://github.com/anglican-kr/common-bible/pull/170#pullrequestreview-4397047529))

range 의 chapter prefix 를 검사하지 않고 `startV === verseNumber` 만으로 매치. parser cross-check 가 정상 데이터에선 잡아주지만, 잘못된 데이터가 다른 chapter 에 ※ 를 stray-render 할 여지가 있었음.

**수정**: `findParallelsStartingAt(parallels, verseNumber, currentChapter?)` — chapter 매개변수 (옵션) 추가 + 매칭 확인. `views-routing.js` 호출 시 `data.chapter` 전달.

### Bug 2 — Cite sheet focus restore broken ([PR #172 review](https://github.com/anglican-kr/common-bible/pull/172#discussion_r3330394743))

tooltip 의 ref link 클릭 시 cite-sheet 의 `returnFocusEl` 이 곧 닫힐 tooltip 안 link 를 가리킴. cite-sheet 가 나중에 닫히며 focus 복원 시도해도 link 가 이미 숨겨진 tooltip 내부라 사라진 채로 끝남 — 접근성 회귀.

**수정**: `_activeAnchor` 모듈 변수에 tooltip 을 띄운 ※ anchor 를 저장. ref link 활성화 시 그 anchor 를 `returnFocusEl` 로 전달 (anchor 는 본문에 남아 visible). ESC / 바깥 클릭 시 `_activeAnchor` clear (stale focus 방지).

## 테스트

- 신규 3 케이스 (총 25): chapter 필터 / undefined 시 기존 동작 / ref link 활성화 시 returnFocusEl 검증
- 기존 562 + 3 신규 = 565 통과
- TypeScript 0 error

## 머지 후

- main 에 fix 들어가면 1.5.12 재태그 + GitHub Release 재작성 (기존 태그·릴리스는 이미 제거됨)
- dev 재배포 + 검증 → prod promote

## Test plan

- [x] `node --test tests/unit/*.test.js` 565 통과
- [x] `npx tsc -p tsconfig.json --noEmit` 0 error
- [ ] Cursor Bugbot 통과 확인 후 머지
- [ ] 머지 후 1.5.12 재태그 + dev 재배포 + 시각 회귀 확인 (사무엘하 5장)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> UI-only changes to parallel markers and focus handling in `parallels.js`/`views-routing.js`; no auth, sync, or data pipeline impact.
> 
> **Overview**
> This PR tightens **ADR-027 parallel ※ markers** and fixes **focus restore** when opening the cite sheet from a parallel tooltip.
> 
> **Chapter-aware matching:** `findParallelsStartingAt` now accepts an optional `currentChapter` and skips parallels whose parsed `range` start chapter differs from the chapter being rendered. `renderChapter` passes `data.chapter` so a stray `12:1-…` entry cannot place a ※ on chapter 11 verse 1 when only the verse number matched before.
> 
> **Accessibility:** Opening a tooltip stores the source ※ in `_activeAnchor`. Activating a tooltip ref link is centralized in `_activateRefLink`, which calls `openCiteSheet` with that anchor as `returnFocusEl` (not the link inside the closing tooltip), then closes the tooltip. The code **does not** clear `_activeAnchor` on unrelated body clicks—documented to avoid a regression where clicking a cite chip elsewhere nulled the anchor and broke focus again.
> 
> Types (`AppParallels`) and unit tests cover chapter filtering, legacy calls without `currentChapter`, return-focus behavior, cite-chip interaction, and defensive fallback when no anchor was opened.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 125092e29d245dc54c52684403ffa9f81c27216a. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
