---
date: 2026-06-10
pr: 268
branch: feat/landscape-tabbar-mini-audio
title: "feat: 가로 모드 탭바 전체 유지 + 오디오 dock 미니 (ADR-030)"
---

# feat: 가로 모드 탭바 전체 유지 + 오디오 dock 미니 (ADR-030)

## 무엇을

아이폰 가로 모드에서 스크롤 축소 시 동작을 분기한다 — **탭바는 홈 원형으로 접지 않고 전체를 펴 두고, 오디오만 dock 행 미니로** 둔다. (세로 모드는 무변경.)

## 왜

가로는 화면이 넓어(아이폰 가로 ≥568px) 탭 전체 + 미니 오디오 + 검색을 한 dock 행에 담고도 여유가 있다. 세로 기준으로 만든 "탭바→홈 버튼 축소"는 가로에서 공간 낭비라는 사용자 피드백.

## 동작

| 상황 | 탭바 | 오디오 |
|---|---|---|
| **세로** | (무변경) 축소 시 홈 원형 | (무변경) 미니 = 재생+진행만 |
| **넓은 가로 ≥641px** | 항상 전체 | **항상 dock**(전체 컨트롤) — 맨 위로 스크롤해도 floating 풀바로 안 올라옴 |
| **좁은 가로 ≤640px** | 항상 전체 | 맨 위 floating / 축소 시 dock 미니 |
| └ ≤640px | | 속도 버튼 숨김 |
| └ ≤580px | | 속도 + 재생 시간 숨김 (재생+진행만) |

- **전체 컨트롤이 들어가는 폭이면 스크롤해도 오디오가 안 움직임**(≥641px 상시 dock) — 세로 높이 절약.
- 폭 부족 시 **속도 → 재생 시간 순 차등 숨김** 으로 진행바 최소 길이(`6rem`) 유지. 구형 소형기(가로 568 등) 대응.
- 검색 모핑(`.searching`)은 입력 폭이 필요하므로 가로에서도 홈 원형 유지.

## 어떻게

- **순수 CSS 동작 분기** — JS 스크롤 축소 로직은 무변경. `.collapsed`/`body.tabbar-collapsed` 훅을 `@media (orientation: landscape)` 에서 재해석.
- **탭 폭 견고성** — 노트 탭이 `hidden`(1.7.0 예정)이라 현재 탭 3개(180px). `tabbar.js` 가 보이는 탭 수를 세어 `:root --tab-bar-w = N × --dock-control` 로 노출 → 노트 활성(3→4) 시 오디오 위치 자동 정렬(JS 미설정 폴백 4탭 = 겹침 없음).

## 검증

- 실기기(iPhone) 가로/세로 확인 완료.
- tsc 0 errors / 유닛 721 통과(tabbar 12 포함).
- Playwright 레이아웃 스모크(터치 에뮬레이션): 가로 넓음/좁음 × top/collapsed + 세로 모두 좌표·컨트롤 노출 사양대로. 미니 캡슐 계산 스타일이 기존 세로 미니와 동일(회귀 아님).

## 문서

- ADR-030 §5 개정 블록(2026-06-10).
- DESIGN.md §7 가로 모드 항목.

## 참고

임계값(640/580px)·진행바 최소(`6rem`)는 진행바 최소 길이 + 컨트롤 폭 산정값 — 후속 조정 가능.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 모바일 하단 chrome 레이아웃만 바꾸는 CSS 분기와 탭 개수 CSS 변수 노출이며, 인증·데이터·핵심 내비 로직은 무변경이다.
> 
> **Overview**
> **가로 모드**에서 스크롤 축소(`.collapsed` / `body.tabbar-collapsed`) 동작을 **세로와 분기**한다. JS 스크롤 로직은 그대로 두고, `@media (orientation: landscape)`에서 기존 훅만 재해석한다.
> 
> **탭바:** 가로에서는 축소해도 홈 원형으로 접지 않고 **탭 전체를 유지**한다(검색 모핑 `.searching`은 여전히 홈 원형). **오디오:** 미니를 전체 탭바 우측~검색 사이 dock에 두고, 세로 미니에서 숨기던 **시간·속도는 가로에서 노출**(`portrait` 한정으로 기존 숨김 유지). **≥641px 가로**에서는 스크롤 위치와 관계없이 오디오를 **항상 dock 행**에 고정하고, 검색 모핑 중에만 floating으로 복귀한다. **좁은 가로**는 맨 위는 floating, 축소 시 미니이며 폭에 따라 **속도(≤640px) → 재생 시간(≤580px)** 순으로 숨겨 진행바 최소 `6rem`을 지킨다.
> 
> `tabbar.js`가 보이는 `.tab-item:not([hidden])` 개수로 `:root --tab-bar-w`를 설정해 dock 오디오 `left`가 탭 수(노트 탭 3→4)에 맞춰진다. ADR-030 §5·`DESIGN.md` §7에 동작을 문서화했다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 9d75fc28a931fd6b3abaa17c500f9f2734c1359d. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
