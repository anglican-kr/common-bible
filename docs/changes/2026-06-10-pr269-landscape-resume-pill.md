---
date: 2026-06-10
pr: 269
branch: feat/landscape-resume-pill
title: "feat: 가로 모드 dock 정리 — 이어읽기 pill + 검색 모핑 탭바 유지 (ADR-030)"
---

# feat: 가로 모드 dock 정리 — 이어읽기 pill + 검색 모핑 탭바 유지 (ADR-030)

## 무엇을

아이폰 가로 모드에서 헤더·배너·탭이 세로로 쌓여 본문을 많이 가리는 문제를, 하단 dock 행을 적극 활용해 정리한다. 한 브랜치에 누적된 네 가지 (모두 가로 전용, 세로 무변경):

1. **이어읽기 배너 → 하단 dock pill** — 책 목록 뷰의 이어읽기 배너를 sticky 그룹 띠에서 빼내 하단 dock 행(미니 오디오와 동일 자리, `--tab-bar-w` 정렬)에 `--radius-pill` 60px pill 로. 헤더 아래 띠가 사라져 세로 공간 확보. 테마색 솔리드 채움 유지(주요 CTA).
2. **닫기 × 다듬기** — 세로 구분선 제거 + 크기 확대(`--font-2xl`) + 버튼 폭 `--dock-control` 로 × 중심을 우측 반원 캡 중심(우측 끝 −30px)에 정렬.
3. **Bugbot 2건 수정** — (Medium) 검색 모핑 충돌: `body:not(.tabbar-searching)` 게이트 + 검색 중 배너 `display:none`. (Low) pass-through 과적용: `body:has(#resume-banner-slot .resume-banner):not(.tabbar-searching)` 로 게이트.
4. **가로 검색 모핑도 탭바 유지** — 검색 버튼을 눌러도 탭바를 홈 원형으로 접지 않고 전체 유지. 검색 입력(`#tab-search-dock` flex:1)은 탭바 우측~검색 사이 남은 공간(미니 오디오·이어읽기 pill 자리)만 채운다. 키보드가 떠도 가로에선 탭바 유지.

## 핵심 구현

- **순수 CSS** (JS 무변경). `@media (orientation: landscape)` + mobile 게이트(`max-width:768` OR `pointer:coarse` — 넓은 가로 아이폰 >768 은 coarse 로 포착).
- **`#tab-dock` 클릭 가로채기 수정** — 투명 레이아웃 레이어가 빈 가운데에서 pill 클릭(링크·×)을 먹던 문제를, pill 이 실제 dock 에 있을 때만 `#tab-dock{pointer-events:none}` + 실제 컨트롤만 `auto` 로 되살려 해결.
- **탭 폭 견고성** — `tabbar.js` 가 보이는 탭 수 × `--dock-control` 을 `--tab-bar-w` 로 노출 → 노트 탭(현재 hidden, 1.7.0 예정) 활성(3→4) 시 자동 정렬.

## 검증

- 실기기(iPhone) 가로/세로 확인.
- Playwright 레이아웃 스모크(터치 에뮬레이션): 이어읽기 pill 위치·× 캡 중심 정렬·× 클릭 닫힘·링크 이동·검색 가드(배너/검색/없음 3시나리오)·검색 모핑 탭바 유지(wide/narrow × 키보드) 모두 사양대로.
- 유닛 721 통과(CSS 무관, 회귀 없음).

## 문서

- ADR-030 §5 개정 블록 + §적용 확장(2026-06-10).
- DESIGN.md §7 가로 모드 항목 3종.
