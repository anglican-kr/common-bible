---
date: 2026-06-07
pr: 211
branch: feat/bookmark-add-help-popover
title: "feat: 북마크 전체뷰 🛈 추가 방법 안내 팝오버 + ⋯ 메뉴·드래그 HIG 폴리시"
---

# feat: 북마크 전체뷰 🛈 추가 방법 안내 팝오버 + ⋯ 메뉴·드래그 HIG 폴리시

## 요약

`/bookmarks` 전체뷰(모바일) 폴리시. 추가는 읽기 화면 전용(ADR-029)이라 전체뷰엔 '추가' 버튼이 없어, 기존 북마크가 있는 사용자는 추가 방법 단서를 못 본다. 이를 메우는 **🛈 안내 팝오버**를 더하고, HIG 검토 과정에서 발견한 몇 가지 정합성도 함께 다듬었다.

## 변경

- **🛈 추가 방법 안내 팝오버** — 제목줄 ⋯ 왼쪽 정보 버튼(중립 차콜, `--accent`). 탭하면 빈 상태와 **같은 문구**(`BOOKMARK_ADD_HELP` 단일 출처)의 작은 팝오버(`.title-action-popover`, `role=dialog`). HIG "팝오버는 트리거를 덮지 말 것" 권고에 맞춰 ⋯ 메뉴와 달리 **버튼 아래**로 떨어짐. ⋯ 메뉴와 상호배타.
- **⋯ 메뉴 삭제 항목을 맨 끝으로** — 애플 메뉴 관례(가장 위험한 액션은 맨 아래, 뒤에 비파괴 항목 두지 않음). 헤어라인 분리·파괴색 유지.
- **목록 상단 마진 축소** — `#app` 상단 패딩(32px)이 제목 아래 과한 공백을 만들어 bookmarks 뷰에서 제거(표준 12px 간격만 유지).
- **드래그 ghost 코너 윤곽선 수정** — `overflow:hidden` 으로 둥근 border-box 에 내용 클립(사각 내용이 코너를 덮어 outline 이 각져 보이던 문제).
- **롱프레스 부분 회색 박스 제거** — `-webkit-tap-highlight-color: transparent`.
- **DESIGN.md** — "지침 없으면 애플 HIG 기본" fallback 규칙 명문화(§1).

## 색·디자인 결정 (HIG 대비)

- 🛈 색은 ⓘ를 틴트하는 HIG 관례 대신 **중립 차콜** — ADR-028이 chrome 을 중립 고정, `--theme` 를 내비 시그니처로 한정하므로 의도적 비추종(말없는 일탈 아님: 본 PR/ADR 에 명문화).
- 아이폰(compact)에서 애플 기본은 팝오버를 시트로 적응하지만, 한 문장 도움말엔 시트가 과해 팝오버 유지 + 트리거 비가림으로 절충.

## 테스트

- `node --test` **650 pass / 0 fail**, `tsc --noEmit` **0 error**
- e2e **9 pass**: `test_bookmark_add_help.py`(신규 4) + `test_bookmark_bulk_delete.py`(5, 모바일 뷰포트로 보정해 실제 실행 가능해짐)

## 후속 (별도 PR 예정)

- ≡ 재정렬 핸들(manual 정렬 모드 한정)
- 행 스와이프 방향을 iOS 관례로 교체(← 삭제 / → 수정)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 북마크 관리 UI·스타일·문서·e2e만 변경하며 인증·동기화 스키마·데이터 처리에는 손대지 않는다.
> 
> **Overview**
> 모바일 **`/bookmarks` 전체뷰**에서 추가는 읽기 화면 전용이라 목록이 비어 있지 않으면 안내가 없던 공백을 메운다. 제목줄 **⋯ 왼쪽 🛈 버튼**이 `BOOKMARK_ADD_HELP` 단일 문구를 **`.title-action-popover`**로 보여 주며(빈 상태와 동일 카피), ⋯ 메뉴와 **상호배타**·트리거 **아래 배치**(HIG 비가림)이다.
> 
> 같은 맥락의 HIG 정합: **⋯ 메뉴 파괴적 「삭제」를 정렬 그룹 아래 맨 끝**으로 재배치, **`DESIGN.md` §1**에 “지침 없으면 HIG” fallback 명문화. 레이아웃·제스처 폴리시로 북마크 뷰 **`#app` 상단 패딩 제거**, 드래그 고스트 **`overflow: hidden`**, 행 **`tap-highlight` 제거**. e2e는 **`test_bookmark_add_help.py` 신규** 및 일괄 삭제 테스트를 모바일 뷰포트·`더 보기` 셀렉터에 맞게 수정.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit f5226d091a9522e16a6c8592a822f2790b6ee5b0. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
