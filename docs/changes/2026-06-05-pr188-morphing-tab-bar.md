---
date: 2026-06-05
pr: 188
branch: feat/morphing-tab-bar
title: "feat: 모핑 탭 바 — 아이콘 전용 + 검색/스크롤 모핑 + 오디오 미니 (ADR-030)"
---

# feat: 모핑 탭 바 — 아이콘 전용 + 검색/스크롤 모핑 + 오디오 미니 (ADR-030)

Apple Music 벤치마크로 모바일 하단 내비를 모핑 탭 바로 재설계. ADR-029(검색=탭, glass=::before, 스크롤 축소 미채택)를 개정. 모바일(≤768px) 전용, 데스크탑 무변경.

**ADR:** [docs/decisions/030-morphing-tab-bar.md](docs/decisions/030-morphing-tab-bar.md)

## 변경 요약

**구조 (P1)**
- 탭 라벨 제거(아이콘 전용), 검색을 탭에서 분리한 우측 원형 버튼. `#tab-dock`(투명 flex)이 탭 pill + 검색 원형을 묶어 오디오 바와 좌우 가장자리 정렬.
- frosted glass 를 `::before`가 아닌 요소에 직접(fixed 부모는 `#tab-dock`뿐이라 Safari 틴팅 무관). 탭바·검색·오디오 셋 다 동일 floating 스타일(glass + 1px 테두리 + `--shadow-2`, 60px). 노트 탭 목업.

**검색 모핑 (P2)**
- 검색 원형 → 입력 pill 확장(비-홈 탭 접고 홈 60px 원형). 하단 입력이 단일 검색 필드(Enter→`commitTopSearch`→`/search`), `/search` 상단 입력은 숨김.
- 키보드: `--kb-overlap`(visualViewport)로 dock 을 키보드 위로, focus 시 `scrollTo(0,0)`+`preventScroll`로 iOS 페이지 밀림 상쇄, X(키보드 내리기)·홈 숨김은 입력 focus/blur 에 묶음(높이 감지 불안정 회피). 키보드 시 홈 숨고 입력이 홈 자리까지 확장.
- 옛 모바일 검색 바텀 시트 제거(검색 = 탭바 모핑 단일 경로).

**스크롤 축소 + 오디오 미니 (P3)**
- 아래로 스크롤 → `.collapsed`: 홈 원형 + 검색 원형. 오디오 재생 중이면 오디오 바가 홈·검색 사이 dock 행으로 `fixed` 축소·이동(재생 + 진행바만). 복구 = 최상단 자동 + 홈 탭은 홈 이동이 아니라 펼치기(읽던 위치 유지).

**마감 (P4)**
- floating↔미니 오디오 전환을 `position:fixed` 통일로 부드럽게(스냅 제거). 문서(ADR-030·CLAUDE.md·DESIGN.md §7)·e2e(test_tabbar) 갱신.
- dev/localhost 는 SW shell network-first(테스트 stale 회피), 프로덕션 cache-first 유지. SW 프리캐시에 tabbar/citations/parallels 추가.

## 테스트
- 유닛 578 통과(키보드·스크롤 순수함수 `tabbar.test.js` 12케이스 포함), tsc 0(app+worker).
- e2e `test_tabbar.py` 갱신(분리 검색·모핑·스크롤 축소·홈 펼치기) — 로컬 전용(ADR-013).
- dev 배포 + iOS PWA 실기기 확인 완료.

## 후속(별도)
- 오디오 미니 모션 추가 다듬기, 데스크탑 사이드바(≥~1024px).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 모바일 내비·검색·스크롤·키보드(iOS visualViewport) 전면 교체로 회귀 가능성이 크고, 제거된 검색 시트 경로와 라우트/Esc 레이어 순서도 함께 검증이 필요합니다.
> 
> **Overview**
> 모바일(≤768px) 하단 내비를 **ADR-030 모핑 탭 바**로 바꿉니다. **탭 라벨을 없애 아이콘만** 쓰고, 검색은 탭에서 빼 **우측 원형 버튼**으로 두며 `#tab-dock`이 탭 pill·검색·(축소 시) 오디오를 한 줄에 맞춥니다. **frosted glass**는 `::before` 대신 각 요소에 직접 적용하고, 탭·검색·오디오를 **60px floating glass** 스타일로 통일합니다.
> 
> **검색**은 원형 → 입력 pill 모핑(`js/app/tabbar.js`)이 단일 경로입니다. Enter는 `commitTopSearch` → `/search`, 모핑 중 상단 검색 바는 숨깁니다. **옛 모바일 검색 바텀 시트**(`#search-sheet` 등)와 관련 JS·CSS·e2e는 제거됩니다. 키보드는 `visualViewport`로 dock을 올리고, focus/blur로 X·홈 표시를 제어합니다.
> 
> **스크롤 축소**는 오디오북 설정 ON이고 **읽기 화면(chapter/prologue)**일 때만: 아래로 스크롤하면 홈 원형만 남기고, 재생 중이면 오디오 바가 홈·검색 사이 미니로 이동합니다. 축소 상태의 홈 탭은 `/`가 아니라 **펼치기**입니다.
> 
> 문서·`index.html`·`sw.js`(dev/localhost **shell network-first**, 프리캐시에 `tabbar.js` 등)·유닛(`tabbar.test.js`)·e2e(`test_tabbar.py`)를 함께 갱신합니다. 데스크탑(≥769px) 동작은 유지합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 23acd7f2f341397d3227cc95f138329f08325d2c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
