---
date: 2026-06-09
pr: 252
branch: style/booklist-tab-gap-elevation
title: "style: 성서 목록 탭 아래 고정 여백 + 스크롤 elevation 통일"
---

# style: 성서 목록 탭 아래 고정 여백 + 스크롤 elevation 통일

## 문제

성서 목록(책 목록) 화면을 위로 스크롤할 때, 책 카드가 상단에 고정된 분류 탭(구약/외경/신약)에 **여백 없이 바로 붙어** 답답해 보였다.

원인은 탭 아래 16px 여백이 고정 영역이 아니라 **스크롤되는 본문**(`#app` top padding)에 있어서, 스크롤하면 사라졌기 때문. 게다가 이 화면은 스크롤 elevation 그림자를 일부러 끄고 있어(ADR-025) 분리 신호도 없었다.

## 변경 (A + C)

**A — 고정 영역 하단 여백**
- `#sticky-group:has(#division-tabs-slot:not(:empty))` 에 `padding-bottom: --space-4`(16px) 추가 → 여백이 고정 영역에 살아 스크롤해도 탭과 콘텐츠 사이 16px 띠가 유지된다.
- 중복 방지로 `#app:has(.division-panel)` 의 `padding-top` 을 `--space-4` → `0` 으로 이전(여백을 본문에서 고정 영역으로 옮김). 정적 상태는 픽셀 동일.

**C — 스크롤 elevation 통일**
- 책 목록만의 `box-shadow: none` 특례 제거 → 다른 화면과 동일하게 `.scrolled` 시 `--shadow-3` 발현. A 의 여백 덕분에 그림자가 탭이 아니라 여백 아래 콘텐츠 경계에서 떨어져, ADR-025 가 그림자를 생략했던 "탭 위 잡음" 우려가 해소됨.

**문서 동기화**
- `DESIGN.md` §5 elevation 항목 갱신, `ADR-025` 개정 블록(2026-06-09) 추가 — 특례 철회 근거 기록.

## 검증

- 라이트·다크 모두 스크롤 상태에서 책 카드가 16px 띠 아래로 자연스럽게 tuck-under + 은은한 elevation 확인(브라우저 스모크).
- 계산된 스타일: sticky `padding-bottom: 16px`, `#app padding-top: 0`, 스크롤 시 `--shadow-3`.
- JS 무변경(CSS·문서만) → 유닛 테스트·CSP 인라인 해시 영향 없음.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS·문서만 변경하는 레이아웃/시각 조정이며 인증·데이터·JS 로직에는 영향이 없다.
> 
> **Overview**
> **성서 목록** 화면에서 스크롤 시 책 카드가 분류 탭에 붙어 보이던 문제를, 탭 아래 **16px 여백을 스크롤되는 `#app`이 아니라 고정 `#sticky-group`에 두는 방식**으로 고친다. 그에 맞춰 `#app:has(.division-panel)` 상단 패딩은 `0`으로 옮긴다.
> 
> 책 목록만 쓰던 **스크롤 elevation(`--shadow-3`) 생략**을 없애 다른 화면과 동일하게 `.scrolled` 시 그림자가 나오게 한다. 여백 덕분에 그림자는 탭이 아니라 그 아래 콘텐츠 경계에 떨어진다. `DESIGN.md` §5와 **ADR-025**(2026-06-09 개정)에 동일 내용을 반영했다. **JS 변경 없음.**
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 0664ab72fb1ea621e6ca15188220dfc08fa9ae6d. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
