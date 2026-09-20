---
date: 2026-05-12
pr: 125
branch: feat/copy-snackbar
title: "feat: 절 복사 후 스낵바 알림 + 스낵바 색상 톤 다운"
---

# feat: 절 복사 후 스낵바 알림 + 스낵바 색상 톤 다운

## Summary
- 절 복사 성공/실패 시 "복사했습니다." 스낵바를 띄워 시각 피드백 추가. 그동안은 액션 바만 닫혀서 동작 여부를 알기 어려웠음
- 스낵바 배경을 페이지 색 완전 반전(`--text`)에서 `--bg-card` + `--border` + 부드러운 그림자로 변경 → 배경과 어울리는 톤
- 동기화 알림에도 동일하게 적용 (`_showSyncSnackbar` 공용)

## Test plan
- [ ] 절 선택 → 복사 버튼 → "복사했습니다." 스낵바가 잠시 떴다 사라지는지 확인
- [ ] 스낵바 색이 페이지 배경과 어울리는지 (라이트/다크 모드 둘 다)
- [ ] 클립보드에 절 본문 + 인용 표기가 정상 들어갔는지
- [ ] 동기화 오류 스낵바도 새 톤으로 자연스럽게 보이는지

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk UI-only changes: adds optional toast notifications and tweaks styling/positioning without affecting sync logic or data handling.
> 
> **Overview**
> Shows a visual snackbar toast when copying selected verses succeeds or fails by calling the shared `window._showSyncSnackbar` from `copySelectedVerses`.
> 
> Rethemes `_showSyncSnackbar` to use `--bg-card`/`--border`, a softer shadow, and safe-area-aware bottom positioning, making sync (and now copy) toasts less visually jarring across themes.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 5d025e63bc9eee1b9be9db234a1fad38ba51d60b. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
