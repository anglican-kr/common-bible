---
date: 2026-06-20
pr: 292
branch: chore/import-claude-hooks
title: "chore: Claude Code 훅 3종 가져오기"
---

# chore: Claude Code 훅 3종 가져오기

## 개요

`project-claude/hooks` 의 세 스크립트를 이 저장소의 `.claude/` 로 가져오고 `.claude/settings.json` 에 연결한다. 그동안 로컬 체크아웃에만 존재하던 검증 훅을 버전관리·공유 대상으로 올린다.

## 훅 3종

| 이벤트 | 스크립트 | 동작 |
|---|---|---|
| PostToolUse(Edit\|Write\|MultiEdit) | `typecheck-js.sh` | `js/*.{js,ts}` 편집 시 `npm run typecheck`, 실패 시 exit 2 로 모델에 오류 피드백 |
| Stop (asyncRewake) | `verify-on-stop.sh` | 미커밋 `.js` 변경 있을 때만 백그라운드로 typecheck + 유닛 스위트(~32s), 실패만 모델 재기상 |
| Stop | `doc-reminder.sh` | 코드만 바뀌고 CLAUDE.md·docs/ 안 바뀌면 갱신 리마인더(systemMessage) |

## 가져오면서 고친 것

원본 스크립트의 `PROJECT` 경로가 대문자 `Projects` 로 박혀 있어 이 체크아웃(소문자 `projects`)에선 `cd`·`jq` 매칭이 빗나가 무동작 — 소문자로 교정.

## 검증

- `jq -e` 스키마 검증 통과
- 세 훅 합성 stdin 파이프 테스트: typecheck 비-js no-op / 실제 `js/app.js` typecheck 통과, doc-reminder·verify-on-stop 게이트 정상

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Only adds local Claude Code hook scripts and config; no production app, auth, or data-path changes.
> 
> **Overview**
> Adds version-controlled **Claude Code automation** under `.claude/`: three bash hooks plus `settings.json` so the whole team gets the same agent-time checks.
> 
> After edits to `js/*.{js,ts}`, **PostToolUse** runs `npm run typecheck` and returns failures to the model (exit 2). On **Stop**, an async hook runs typecheck and the full unit suite when there are uncommitted `.js` changes under `js/` or `tests/unit/` (failures re-wake the session); a sync hook nudges updating `CLAUDE.md` / `docs/` when app code changed but those docs did not.
> 
> Hooks resolve the project root via `$CLAUDE_PROJECT_DIR` or the script path so they work across clone locations (fixing a hard-coded path issue from the imported scripts).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 454f284b7307b1f9155e48159abd210a819efc49. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
