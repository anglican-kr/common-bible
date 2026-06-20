#!/usr/bin/env bash
# Stop hook (sync, non-blocking; just prints a systemMessage).
# If source code changed but the docs that track "what currently works"
# (CLAUDE.md / anything under docs/) were NOT touched, nudge to update them
# before merge. Self-suppressing: the moment you edit CLAUDE.md or a docs/ file,
# this goes quiet. Rationale: feedback_documentation.
set -u
PROJECT="/home/joshua/projects/common-bible"
cd "$PROJECT" || exit 0

# Final path column of each porcelain line (handles renames: "R old -> new").
p=$(git status --porcelain 2>/dev/null | awk '{print $NF}')

# Code changed?
printf '%s\n' "$p" | grep -qE '^(js/|css/|index\.html|sw\.js)' || exit 0
# Docs already being updated alongside? -> stay quiet.
printf '%s\n' "$p" | grep -qE '^(CLAUDE\.md|docs/)' && exit 0

jq -cn '{systemMessage:"📝 코드가 바뀌었는데 CLAUDE.md \"현재 상태\"·docs/worklog.md·관련 ADR은 아직 그대로입니다. 머지 전 갱신을 확인하세요."}'
exit 0
