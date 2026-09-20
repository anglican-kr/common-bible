---
date: 2026-06-05
pr: 190
branch: feat/header-bookmark-save-modal
title: "feat: 모바일 읽기 헤더 북마크 = 이 장 저장 모달 + 우측 끝 정렬"
---

# feat: 모바일 읽기 헤더 북마크 = 이 장 저장 모달 + 우측 끝 정렬

모바일 읽기 화면의 헤더 북마크 버튼을, 드로어 대신 **'이 장 저장' 모달**로 바로 진입하게 바꾸고 헤더 **우측 끝에 정렬**한다. (드로어 자체 제거는 데스크탑 사이드바 단계에서 — 본 PR은 모바일 읽기 헤더 한정.)

## 변경
- **클릭 동작(읽기 화면 모바일 한정)**: `buildBookmarkHeaderBtn` 클릭이 `_isMobileViewport() && 장 맥락`이면 `openSaveModal("chapter")`(이미 존재하는 모달, readingContext 사용 + 머지 체크 포함). 데스크탑·비읽기(책목록·장선택, 장 맥락 없음)는 기존 `openBookmarkDrawer` 유지.
- **우측 끝 정렬**: `.title-bookmark-btn { right: 0 }`. 모바일 설정 기어가 탭 바로 이전(ADR-029)돼 비어 있던 `2.4rem` 인셋 제거. 데스크탑 redundant override 정리.
- **절 선택**은 본문 절 롱프레스로 유지(드로어 없이도 진입 가능), 북마크 조회/관리는 북마크 탭.

## 범위 밖(후속)
- 드로어 완전 제거 + 데스크탑 /bookmarks 전체 뷰 전환 → 데스크탑 사이드바 단계.

## 테스트
- 유닛 578·tsc 0(app+worker). e2e: 모바일 읽기 헤더 → 저장 모달(드로어 미표시) 케이스 추가. 기존 폴더 CRUD e2e는 데스크탑 컨텍스트라 드로어 경로 유지(영향 없음).
- dev 검증: 읽기(/matt/2) → 모달·우측정렬, 장선택(/matt) → 드로어(장 맥락 없음).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Bookmark UX and CSS alignment only; desktop and non-reading flows unchanged; save modal reuses existing logic with new e2e coverage.
> 
> **Overview**
> **모바일 읽기 화면**에서 헤더 북마크 탭 동작과 위치를 ADR-030 후속에 맞춘다.
> 
> `buildBookmarkHeaderBtn` 클릭 시 **모바일 뷰포트이고 장 맥락(`bookId`·`chapter`)이 있으면** `openSaveModal("chapter")`로 바로 **「이 장 저장」** 모달을 연다. 데스크탑·장 맥락 없는 화면(책/장 선택 등)은 기존처럼 `openBookmarkDrawer`를 유지한다.
> 
> `.title-bookmark-btn`을 **`right: 0`** 으로 통일해 타이틀 행 **우측 끝**에 붙이고, 데스크탑 전용 `@media` 오버라이드는 제거한다.
> 
> 검색 입력 **placeholder**에서 `검색` 접두어를 빼 **`예: 사랑, …`** 형태로 맞춘다(`#tab-search-input`, in-page 검색 바).
> 
> **e2e**: 모바일 `/gen/1`에서 헤더 북마크 → 저장 모달 표시, 드로어는 닫힌 상태를 검증한다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ed7bae30a59b753113157c8c202390c9d855afd6. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
