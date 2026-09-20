---
date: 2026-06-08
pr: 220
branch: feat/bookmark-select-delete
title: "feat: 북마크 멀티-액션 선택 모드(공유·이동·삭제) + 관리 UX 폴리시"
---

# feat: 북마크 멀티-액션 선택 모드(공유·이동·삭제) + 관리 UX 폴리시

## 요약
북마크 삭제/관리 UX를 전면 개선. 별도 체크박스 모달을 들어내고, ⋯ 메뉴 **"선택"**으로 들어가는 **화면 내 멀티-액션 선택 모드(공유·이동·삭제)**로 전환(iOS 파일·메일·사진식). 관련 폴더 삭제·드래그·아이콘·간격 폴리시와 디자인 토큰 정리 포함. 모바일 전용(데스크탑 `/bookmarks`는 책목록+드로어 폴백이라 회귀 0).

## 주요 변경
### 선택 모드 (공유·이동·삭제)
- ⋯ 메뉴 "선택" → 행 선행 선택 원(○→✓, 타입 아이콘 유지), 하단 `#bm-select-bar`(공유·이동·삭제 pill + 취소 원형 + 부유 카운트 칩), 제목줄 "전체 선택" 토글. 폴더 체크는 하위 cascade.
- **공유**: `SITE_BASE`(bible.anglican.kr) 절대 링크 → `navigator.share`(+클립보드 폴백). 도메인 단일 상수(통합 bok.* 대비). 공유시트 "복사"=링크.
- **이동**: 폴더 목록 모달(최상위·폴더들 + 상위 폴더 지정 가능한 새 폴더). 선택 폴더·하위는 목적지 제외.
- **삭제**: 공유 확인(`bm-confirm`) → `removeItemById`+`_forgetViewed` cascade.
- **폴더 삭제는 폴더+내용물 cascade 로 통일**(스와이프·행·드로어·선택 모드 동일, 확인창에 개수 명시).

### 버그/폴리시
- 행 삭제 확인 취소 시 행이 제자리로 닫힘(회귀 수정).
- 드래그 **드롭 위치 지시자 가시화** — 모바일에서 불투명 콘텐츠(z-index 1)에 가려지던 삽입선을 콘텐츠 위 3px accent 선 + 폴더 into 하이라이트로.
- 빈 목록에선 🛈 숨김 + 안내 팝오버 굵기 해소(h1 상속 700→400) + 🛈 색 완화(`--text-tertiary`).
- 선택 캡슐 너비 명시(WebKit intrinsic flex 버그).

### 디자인 시스템
- 토큰 신설: `--dock-control`(60px)·`--dock-icon`(1.7rem, 탭바 기준)·`--bm-row-icon`(1.6rem)·`--list-row-h`(3.5rem, 목록 행 높이 표준 — 후속 목록 공유).
- `corner-shape: superellipse(2)`(=정원, squircle 아님) 선언 전량 제거 → `--radius-pill` 반원 끝, squircle 미사용 명문화(시각 변화 0).
- 행 아이콘 20px 고정 → `--bm-row-icon`(슬롯 채움, rem 스케일). 행 높이 79px→63px.

## 테스트
- **유닛 660 통과**(공유 payload·북마크 leaf 수집·cascade·dissolve·count 헬퍼 신규)
- **e2e** `test_bookmark_select_delete.py`(공유 stub·이동·cascade·전체 선택 등) + folders/swipe/dnd/add-help 회귀 — 북마크 e2e 전부 통과
- **tsc 0** (app + worker)
- dev 서버 수동 확인 완료

문서: ADR-010/029/030 개정, CLAUDE.md 현재 상태, DESIGN.md 토큰 사다리, QA 보고서(`docs/qa/2026-06-07-unit-bookmark-select-delete.md`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 북마크 트리 삭제·이동·공유 경로와 localStorage 저장 구조를 바꾸는 큰 UX 변경이지만 모바일 `/bookmarks`에 한정되고 유닛·e2e로 커버됩니다.
> 
> **Overview**
> **모바일 북마크 전체뷰**에서 ⋯ **일괄 삭제용 체크박스 모달**을 없애고, ⋯ **「선택」**으로 들어가는 **화면 내 멀티-액션 선택 모드**로 바꿉니다. 트리 위에서 행 앞 **선택 원**으로 고르고, 탭 바 자리에 **`#bm-select-bar`**(공유·이동·삭제 pill + 취소)와 제목줄 **전체 선택**이 뜹니다. **공유**는 `SITE_BASE` 절대 링크와 Web Share(클립보드 폴백), **이동**은 탭 즉시 반영되는 폴더 picker(`#bm-move-modal`)와 **상위 폴더를 고를 수 있는 새 폴더** 흐름, **삭제**는 기존 확인 후 cascade입니다. 폴더 선택·삭제 의미는 **내용물까지 cascade**로 맞춥니다.
> 
> 함께 **스와이프 삭제 확인 취소 시 행이 열린 채 남던 버그**를 고치고, **드래그 드롭 지시자**를 모바일에서 보이게 하며, 빈 목록에서 **🛈 숨김·약화 색** 등 관리 UX를 다듬습니다. **디자인 토큰**(`--dock-control`, `--list-row-h`, `--text-tertiary` 등)으로 dock·행 크기를 통일하고 `corner-shape: superellipse` 선언을 제거합니다. `#bm-bulk-delete-*` DOM/JS/e2e는 제거하고 선택 모드용 유닛·e2e·ADR/QA 문서를 추가합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 61458a206b1f7b84f37895af1d0e2dd10771ad64. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
