---
date: 2026-06-22
pr: 300
branch: chore/e2e-reminder-hook
title: "chore: e2e 갱신 리마인더 Stop 훅 추가"
---

# chore: e2e 갱신 리마인더 Stop 훅 추가

## 배경

사용자 요청 — 기능 변경 후 영향 e2e도 함께 갱신하도록 자동 리마인더. PR #299에서 복음서 짧은명·롱프레스 500ms·첫방문 너지 제거 변경이 e2e 12건을 조용히 낡게 만든 걸 겪음(e2e는 CI 미실행 → 드리프트가 안 잡힘).

## 변경

- `.claude/hooks/e2e-reminder.sh` 신규 — Stop 훅(sync). `git status` porcelain으로 js/·css/·index.html 변경 감지 시, tests/e2e/ 미수정이면 "영향 e2e 갱신 확인" systemMessage. e2e 손대면 자동 침묵. 기존 `doc-reminder.sh`와 동형.
- `.claude/settings.json` Stop 배열에 등록.

리마인더만 — 어떤 e2e가 영향받는지 판단·수정은 모델 몫(훅은 deterministic 셸이라 자동 재작성 불가).

## 검증

3케이스 실측:
- js만 변경(e2e 미변경) → 리마인더 출력 ✓
- js + tests/e2e 동반 변경 → 침묵 ✓
- 문서만 변경 → 침묵 ✓
- `settings.json` 유효 JSON ✓

> 참고: 새 settings.json 발효는 `/hooks` 한 번 열거나 재시작 필요할 수 있음.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Developer-only Claude Code hook configuration; no runtime app, auth, or production behavior changes.
> 
> **Overview**
> Adds a **sync Stop hook** that nudges developers when **behavior surfaces** (`js/`, `css/`, `index.html`, `sw.js`) change in the working tree but **`tests/e2e/`** was not touched—because e2e runs locally only and can drift without CI.
> 
> The new `e2e-reminder.sh` follows the same porcelain-path pattern as `doc-reminder.sh`: it exits quietly if no behavior paths changed, or if any `tests/e2e/` file was edited alongside. Otherwise it emits a Korean `systemMessage` via `jq`.
> 
> **`.claude/settings.json`** registers the hook in the existing Stop array after `doc-reminder.sh`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 41ba0275db15241d23770be598556087cea62d53. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
