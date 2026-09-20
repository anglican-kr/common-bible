#!/usr/bin/env bash
# PostToolUse(Bash) hook — `gh pr create` 가 성공하면 만들어진 PR 번호를
# --body-file 로 넘긴 원장 파일 frontmatter 에 `pr: N` 으로 적는다.
# 파일은 수정만 하고 커밋은 하지 않는다 — systemMessage 로 커밋·push 를 알린다.
# 짝: pre-pr-ledger.sh (생성 전 게이트). 형식: docs/changes/README.md
set -u
PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
case "$cmd" in
  *"gh pr create"*) ;;
  *) exit 0 ;;
esac
cd "$PROJECT" || exit 0

out=$(printf '%s' "$input" | jq -r '(.tool_response.stdout // .tool_response // "") | tostring')
num=$(printf '%s' "$out" | grep -oE 'github\.com/[^ ]+/pull/[0-9]+' | head -1 | grep -oE '[0-9]+$')
[ -n "$num" ] || exit 0

f=$(printf '%s' "$cmd" | grep -oE -- '--body-file(=| +)"?docs/changes/[^ "]+' | head -1 | sed -E 's/^--body-file(=| +)"?//')
[ -n "$f" ] && [ -f "$f" ] || exit 0

if grep -qE '^pr: ' "$f"; then
  sed -i -E "s/^pr: .*/pr: $num/" "$f"
else
  # frontmatter 의 date: 줄 바로 뒤에 넣는다.
  sed -i -E "0,/^date: /s//pr: $num\ndate: /" "$f"
fi
jq -cn --arg m "📒 원장 $f 에 pr: $num 기록 — 'docs: 원장에 PR #$num 기록' 으로 커밋·push 하세요." '{systemMessage:$m}'
exit 0
