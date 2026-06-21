#!/usr/bin/env bash
# Stop hook (sync, non-blocking; just prints a systemMessage).
# If behavior code changed (js/ / css/ / index.html) but no e2e test under
# tests/e2e/ was touched, nudge to update the affected e2e. e2e is local-only
# (not in CI), so feature changes silently drift the suite out of date — this
# reminder is what catches that before merge. Self-suppressing: the moment you
# touch any tests/e2e/ file, this goes quiet. Rationale: feedback_test_after_feature
# (2026-06-22, after PR #299 refreshed 12 stale e2e tests).
set -u
# Project root: $CLAUDE_PROJECT_DIR when set by Claude Code, else derived from
# this script's location so the hook is portable across clone paths.
PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT" || exit 0

# Final path column of each porcelain line (handles renames: "R old -> new").
p=$(git status --porcelain 2>/dev/null | awk '{print $NF}')

# Behavior code changed? (the surfaces e2e exercises — not unit tests, not docs).
# Mirrors doc-reminder.sh's set, incl. sw.js (cache/offline/install flows e2e covers).
printf '%s\n' "$p" | grep -qE '^(js/|css/|index\.html|sw\.js)' || exit 0
# e2e already being updated alongside? -> stay quiet.
printf '%s\n' "$p" | grep -qE '^tests/e2e/' && exit 0

jq -cn '{systemMessage:"🧪 동작 코드가 바뀌었는데 tests/e2e/ 는 그대로입니다. 영향받는 e2e가 있는지 확인하고 함께 갱신하세요 (e2e는 CI 미실행이라 조용히 낡습니다)."}'
exit 0
