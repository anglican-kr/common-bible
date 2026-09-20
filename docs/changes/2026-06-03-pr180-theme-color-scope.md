---
date: 2026-06-03
pr: 180
branch: style/theme-color-scope
title: "style: 테마색 적용 범위를 절 번호·단락 기호·FAB·오디오 플레이어로 한정 (ADR-028 개정)"
---

# style: 테마색 적용 범위를 절 번호·단락 기호·FAB·오디오 플레이어로 한정 (ADR-028 개정)

## 배경

색상 스킴(네이비·빨강·초록·보라)을 바꾸면 `--accent`를 쓰는 chrome 전반(버튼·링크·포커스 링·토글·활성 상태 등 ~100곳)이 함께 물들었다. 테마색을 **읽기 화면의 절제된 시그니처 강조**로 좁혀, chrome은 브랜드 없는 중립 톤으로 일관되게 두고 스킴 선택이 본문 읽기 경험에만 영향을 주도록 한다.

## 변경

테마색이 칠해지는 곳을 **절 번호·단락 기호·FAB·오디오 플레이어 네 곳으로 한정**한다.

- **`--theme`** 신규 토큰 — 스킴을 따르는 유일한 강조색. 진한 채도로 통일. 위 네 곳만 참조. 기존 `--accent`의 스킴별 값(네이비/빨강/초록/보라 × 라이트/다크)을 그대로 물려받음.
- **`--accent` / `--accent-light`** — 고정 중립 차콜/회색으로 동결 (라이트 `#3a3a42` / 다크 `#b8b8c2`). `[data-color-scheme]` 블록에서 오버라이드를 제거해 어떤 테마색을 골라도 chrome 톤 불변, 라이트/다크 전환만 따름.
- 기존 `--verse-num` · `--paragraph-mark`(스킴별 muted 변형) 토큰 제거 → `--theme`로 통일 (절 번호·단락 기호가 더 또렷해짐).

구현은 `--accent` 사용처(~100곳)를 건드리지 않고 자동 동결시키고, 네 곳만 `--theme`로 재지정해 회귀를 최소화했다.

## 문서

- `DESIGN.md` §2 토큰 표 · 스킴 절 갱신
- `docs/decisions/028-design-system.md` 개정 블록 추가
- `CLAUDE.md` 현재 상태 갱신

## 검증

- CSS 중괄호 균형 0, 제거한 토큰의 잔존 `var()` 참조 0건.
- 단위 테스트는 CSS 미커버 — 영향 없음. 브라우저 시각 확인(스킴 4종 × 라이트/다크)은 머지 전 로컬 권장.

## 후속 (이 PR 범위 밖)

이중 번호(alt-ref, 칠십인역/불가타 병기 번호)는 절 번호 옆이지만 보수적으로 `--accent-light`(고정 차콜) 유지. 절 번호가 테마색일 때 함께 묶을지는 별도 판단.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS·문서만 변경하며 로직·데이터·테스트 미포함; 시각 회귀는 스킴×라이트/다크 수동 확인이 권장된다.
> 
> **Overview**
> 색상 스킴(네이비·빨강·초록·보라)이 더 이상 chrome 전반을 물들이지 않고, **읽기 화면의 절제된 강조**만 바꾸도록 토큰 역할을 나눈다.
> 
> **`--theme`**(신규)만 `[data-color-scheme]`을 따르며, 적용처는 **절 번호·단락 기호(¶)·모바일 검색 FAB·오디오 플레이어**(재생 버튼·진행 바·속도 버튼) 네 영역으로 한정한다. **`--accent` / `--accent-light`**는 고정 중립 차콜로 두어 버튼·링크·토글·호버 등 기존 `--accent` 사용처는 스킴과 무관하게 동일 톤을 유지한다. 제거된 **`--verse-num`·`--paragraph-mark`**는 **`--theme`**으로 통일한다.
> 
> **대비:** accent 채움 위 텍스트를 여러 chrome 컨트롤에서 **`#fff` → `var(--bg)`**로 바꿔 다크 모드에서 밝은 고정 accent 위 가독성을 맞춘다(파괴 동작 빨강 버튼 등 일부 예외는 유지).
> 
> **문서:** `DESIGN.md` §2, ADR-028 개정(2026-06-03), `CLAUDE.md` 현재 상태를 위 결정과 맞게 갱신한다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 949853c22ee4b4aa2aaa94666a2da2a5892f7b0e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
