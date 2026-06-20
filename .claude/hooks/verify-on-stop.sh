#!/usr/bin/env bash
# Stop hook (configured async + asyncRewake).
# When the working tree has uncommitted .js changes under js/ or tests/unit/,
# run the type-check then the full unit suite. On failure -> exit 2, which (with
# asyncRewake) re-wakes the model with the output so it can fix. On success ->
# silent. The unit suite is ~32s, so this MUST run async (non-blocking); only a
# failure pulls anyone back. Clean tree / docs-only change -> no-op.
set -u
# Project root: $CLAUDE_PROJECT_DIR when set by Claude Code, else derived from
# this script's location so the hook is portable across clone paths.
PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$PROJECT" || exit 0

# Gate: only when there are uncommitted .js files under js/ or tests/unit/.
git status --porcelain -- js tests/unit 2>/dev/null | grep -qE '\.js$' || exit 0

o=$(npm run typecheck 2>&1 && npm test 2>&1) || {
  printf '%s\n' "$o" | tail -n 40 >&2
  exit 2
}
exit 0
