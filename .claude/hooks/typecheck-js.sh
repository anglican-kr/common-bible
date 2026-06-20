#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit) hook.
# If the just-edited file is under common-bible/js/ (a .js or .ts file), run the
# project type-check (tsc x2 via `npm run typecheck`). On failure, print the
# errors to stderr and exit 2 so Claude Code feeds them straight back to the
# model to fix immediately. Non-js/ edits are a no-op. Type discipline: ADR-012.
#
# Reads the hook input JSON on stdin; uses tool_input.file_path.
set -u
# Project root: Claude Code passes $CLAUDE_PROJECT_DIR when invoking hooks; fall
# back to deriving it from this script's location (PROJECT/.claude/hooks/x.sh) so
# the hook works in any clone path, not just the one it was authored in.
PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

f=$(jq -r '.tool_input.file_path // empty')
case "$f" in
  "$PROJECT"/js/*.js | "$PROJECT"/js/*.ts) ;;   # under js/, fall through
  *) exit 0 ;;                                   # anything else: skip
esac

o=$(cd "$PROJECT" && npm run typecheck 2>&1) || {
  printf '%s\n' "$o" | tail -n 30 >&2
  exit 2
}
exit 0
