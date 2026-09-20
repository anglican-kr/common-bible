---
date: 2026-06-08
pr: 247
branch: style/tabbar-indicator-spacing
title: "style: 탭바 활성 인디케이터 중립색 + 탭바·선택 pill 너비 정리"
---

# style: 탭바 활성 인디케이터 중립색 + 탭바·선택 pill 너비 정리

하단 플로팅 dock 크롬(탭바·절/북마크 선택 pill)의 스타일을 다듬습니다. 모두 `css/style.css` 한 파일, 순수 CSS 변경입니다.

## 변경 내용

1. **탭바 활성 인디케이터 중립색화** — 슬라이딩 인디케이터 pill 배경을 색상 스킴을 따라가던 `--theme`(빨강·초록·보라 등)에서 중립 크롬색 `--accent`로 교체. 라이트/다크는 `--accent`가 자동 구분. 활성 탭 **아이콘** 색은 `--theme` 그대로 유지(스킴 추종).

2. **탭바 너비를 아이콘에 맞춤** — `flex: 1` 풀너비 스트레치(`space-between`로 아이콘이 검색 버튼까지 벌어짐)에서 `flex: 0 0 auto`로 바꿔 아이콘 4슬롯(4×60px)만큼만 차지하도록. 검색 원형과의 사이 여백은 비움.

3. **절 선택 pill을 snug으로 통일** — `#verse-select-bar`(북마크·복사·노트)가 `flex: 1`로 full-width 스트레치되던 걸, 이미 `#bm-select-bar`에만 있던 snug(3×60px) override를 두 바가 공유하는 base로 끌어올려 통일. 중복 제거(순 −1줄)이며, `index.html`에 적혀 있던 "pill 은 내용 폭(snug)" 의도와 실제 구현이 이제 일치.

## 검증

- 유닛 테스트 678개 통과 (`node --test tests/unit/*.test.js`)
- Playwright 시각 확인 (390px 모바일):
  - 탭바 — idle hug(242px) / 탭 전환 시 인디케이터 정확히 슬라이드 / 검색 모핑·스크롤 축소 정상
  - 선택 pill — 절·북마크 두 바 모두 snug 180px + 취소 우측, 삭제 파괴색 유지(회귀 없음)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 모바일 하단 dock의 순수 CSS 레이아웃·색상 조정이며 인증·데이터 로직은 건드리지 않습니다.
> 
> **Overview**
> **하단 플로팅 dock** 크롬을 `css/style.css`에서만 다듬습니다.
> 
> **탭 바**는 `flex: 1` + `space-between`에서 **`flex: 0 0 auto` + `center`**로 바꿔 아이콘 **4×60px** 슬롯만 차지하고, 검색 원형은 `#tab-search-dock`의 `margin-left: auto`로 우측에 둡니다. **슬라이딩 활성 인디케이터** 배경은 색상 스킴 `--theme` 틴트 대신 중립 **`--accent` 14%**로 바꿉니다(활성 아이콘 색은 `--theme` 유지).
> 
> **절/북마크 선택 pill**은 `#bm-select-bar`에만 있던 **3×60px 명시 폭**·고정 슬롯 버튼 스타일을 **`.verse-action-pill` / `.verse-action-btn` base**로 올려 `#verse-select-bar`와 통일하고, 중복 `#bm-select-bar` override와 긴 주석을 정리합니다(WebKit intrinsic 폭 버그 회피 주석은 base에 유지).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit d5e6778e5f04ebb8f2007d68f29387bffeb77c00. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
