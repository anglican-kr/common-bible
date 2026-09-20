---
date: 2026-06-04
pr: 183
branch: feat/mobile-tab-bar
title: "feat: 모바일 하단 탭 바 — 적응형 내비 Phase 1 (ADR-029)"
---

# feat: 모바일 하단 탭 바 — 적응형 내비 Phase 1 (ADR-029)

## 배경
흩어진 내비게이션(헤더 홈/설정 버튼·검색 FAB·북마크 드로어·설정 팝오버)을 **모바일(≤768px) 하단 탭 바**로 통합. ADR-028 §7 "적응형 내비 — 구현 대기"의 모바일 1단계. 상세·근거: [ADR-029](docs/decisions/029-mobile-tab-bar.md).

## 무엇이 바뀌나 (모바일 ≤768px)
- **4탭 탭 바**: 홈·검색·북마크·설정 (`노트`는 후속 슬롯 예약). 각 탭 = **전체화면 라우트 뷰**(`/`·`/search`·`/bookmarks`·`/settings`), 기존 빌더 재사용.
- **iOS 2026 Liquid Glass**: 플로팅 캡슐, frosted glass(`::before` 레이어로 Safari home-indicator 틴팅 회피), `corner-shape:squircle` + `border-radius:26px` 폴백, **상시 표시**(스크롤 축소 미채택 — iOS 27 회귀 반영), 검색=일반 탭. 활성 탭=`--accent`(chrome 중립). iOS idiom 아이콘.
- **헤더 정리**: 홈·설정 버튼 숨김, **검색 FAB 전면 제거**(요소·CSS·fab-lift 옵저버 일체). 읽기 뒤로·챕터 북마크 추가는 보존.
- **하단 공존**: 오디오 미니플레이어를 탭 바 위 플로팅 둥근 바로 스택, 절 선택 모드 시 탭 바 숨김, `--tabbar-reserve`로 콘텐츠 하단 패딩.
- **북마크 전체뷰**: 읽기-문맥 액션(이 장 저장·절 선택) 제외, 전역 관리(새 폴더 "+"·내보내기/가져오기 "⋯")만.

**데스크탑(≥769px)**: 탭 바 미표시 — 기존 헤더·인라인 검색·드로어·팝오버 **그대로**. 사이드바는 콘텐츠(720)+사이드바(260) 공존에 ≥~1024px 신설이 필요해 별도 단계.

## 단계별 (커밋)
P1 탭 바 DOM+CSS → P2 전체화면 뷰+라우트+북마크 액션 → P3 SPA 배선(기존 `<a>` 인터셉터 활용)+활성 동기화+헤더 정리+FAB 제거 → P4 하단 공존+패딩 → P5 문서+e2e. 각 단계 dev 배포로 시각 확인.

## 검증
- **tsc 0** (양쪽 config), **유닛 566 통과**(라우팅/내비는 e2e 책임 — ADR-013).
- 신규 `tests/e2e/test_tabbar.py`(로컬). FAB/시트 클릭 구식 모바일 검색 e2e 5건은 skip(전체화면 플로 재작성 후속).
- 단계별 dev 배포 + iOS/데스크탑 육안 확인.

## 문서
ADR-029 신규, DESIGN.md §7 / ADR-028 §7 상태, CLAUDE.md 현재 상태, architecture.md ADR 인덱스.

## 후속 (범위 밖)
데스크탑 사이드바(≥~1024px), `노트` 기능 본체, 북마크 뷰 "+"·"⋯" 배열 다듬기, 오디오 스택 위치 최종 튜닝, 인앱 reduce-transparency 토글, 모바일 검색 e2e 전체화면 재작성.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 라우팅·오버레이 해제·북마크/설정 UI 분기가 넓어 회귀 가능성이 있으나 데스크탑 경로는 폴백으로 유지되고 e2e로 탭 바를 커버한다.
> 
> **Overview**
> **모바일(≤768px) 내비를 하단 탭 바로 통합**하고, 검색 FAB·모바일 헤더 홈/설정 진입점을 제거한다. **홈·검색·북마크·설정 4탭**은 각각 `/`, `/search`, `/bookmarks`, `/settings` **전체화면 라우트 뷰**로 동작하며, 기존 `renderBookList`·검색·북마크 트리·설정 섹션 빌더를 재사용한다(`buildSettingsSections`로 팝오버와 설정 전체뷰 공유).
> 
> `index.html`에 Liquid Glass 스타일 `#tab-bar`를 추가하고, `css/style.css`에 탭 바·`--tabbar-reserve`·전체뷰·북마크 헤더 액션 스타일을 넣는다. 오디오 미니플레이어는 탭 바 위 플로팅 바로 스택하고, 절 선택 모드에서는 탭 바를 숨긴다. `views-routing.js`는 `syncTabBarActive()`, `/bookmarks`·`/settings` 파싱, 탭 전환 시 오버레이·스크롤 락 해제, 모바일 `/search` 인페이지 검색(시트 자동 오픈 제거)을 담당한다. 데스크탑(≥769px)은 탭 바 숨김·기존 헤더/드로어/팝오버 유지, 딥링크는 책 목록+드로어/기어 폴백.
> 
> 북마크 전체뷰는 읽기 전용 액션 없이 **"+" / "⋯"(보내기·가져오기)** 만 제공하고, `_rerenderActiveBookmarkTree`로 드로어·전체뷰 동기화를 맞춘다. **ADR-029**·문서 갱신, 신규 `tests/e2e/test_tabbar.py`, FAB/시트 기반 모바일 검색 e2e는 skip 처리.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 7e1685ade7c2c71af1fa04f654ad2396fd3a51d5. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
