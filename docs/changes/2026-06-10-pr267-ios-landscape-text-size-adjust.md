---
date: 2026-06-10
pr: 267
branch: fix/ios-landscape-text-size-adjust
title: "fix: iOS 가로 모드 자동 텍스트 확대 차단 (ADR-028)"
---

# fix: iOS 가로 모드 자동 텍스트 확대 차단 (ADR-028)

## 무엇을

`html` 에 `text-size-adjust: 100%`(+`-webkit-` 접두)를 추가해 iOS Safari 의 가로 모드 자동 텍스트 확대를 끈다.

## 왜

iOS Safari 는 기본값(`auto`)에서 가로 모드일 때 본문 덩어리만 자동으로 부풀린다. 그런데 절 번호(`rem` 기반)와 인라인 마커(인용 칩·※ 앵커, `em` 기반)는 따라오지 않아:
- 본문과 절 번호·주석 기호의 **크기가 어긋나고**,
- 본문이 **한눈에 안 들어올 만큼 비대**해졌다(사용자 보고).

ADR-028 은 원래 "글자 크기 설정이 루트 폰트를 바꾸면 타이포 전체가 함께 스케일"하도록 rem 기반으로 설계했는데, 자동 확대가 그 의도를 거스르고 있었다.

## 어떻게

- `100%` 로 고정 → 타이포 스케일이 **rem 앵커(루트 폰트 + 글자 크기 설정) 하나로만** 움직인다. 세로/가로 모드가 일관된다.
- `none` 이 아닌 `100%` 라 사용자 핀치 줌은 유지된다(WCAG 2.1 AA · 1.4.4).
- 가로 모드의 "공짜 확대" 시인성은 사라지지만, 글자 크기 설정으로 대체되며 그때는 본문·절 번호·마커가 비례를 유지한 채 함께 커진다.

## 검증

- 실기기(iPhone) 가로/세로 확인 완료 — 본문 비대화 해소, 절 번호·마커가 본문과 비례 유지, 핀치 줌 정상.
- 유닛 721건 통과(CSS 무관, 회귀 없음).

## 문서

- ADR-028 §10 개정 블록 추가 (2026-06-10).
- DESIGN.md §3 rem 앵커 규약에 자동 확대 차단 항목 명문화.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS-only change on `html`; no JS, auth, or data. Landscape loses Safari’s free text boost; users rely on in-app font size and pinch zoom.
> 
> **Overview**
> iOS Safari 가로 모드에서 본문만 자동으로 키우던 동작을 막기 위해 `html`에 `-webkit-text-size-adjust` / `text-size-adjust: 100%`를 추가한다. **rem** 절 번호와 **em** 인라인 마커(인용 칩·※ 앵커)가 본문과 어긋나던 문제와 본문 과대화를 줄이고, 타이포 스케일을 루트 폰트·글자 크기 설정(rem 앵커) 하나로만 맞춘다.
> 
> `none`이 아닌 `100%`를 써서 핀치 줌은 유지한다(WCAG 1.4.4). **DESIGN.md** §3 규약과 **ADR-028** §10 개정에 근거·트레이드오프를 명문화했다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit c26e64e6cd11722d1d5fa642ddc55cd594ad0b59. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
