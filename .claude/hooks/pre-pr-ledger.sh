#!/usr/bin/env bash
# PreToolUse(Bash) hook — 변경 원장(docs/changes/) 게이트.
# `gh pr create` 를 가로채, PR 본문이 커밋된 원장 파일에서 파생되는지 확인한다.
# 어긋나면 permissionDecision=deny 로 명령을 막고 이유를 돌려준다. 그 외 명령은 no-op.
# 같은 검사를 CI(.github/workflows/ledger.yml)가 PR diff 에 대해 한 번 더 한다 —
# 이 훅은 Claude Code 안에서만 돌고, CI 는 어디서 만든 PR 이든 잡는다.
# 형식·규칙: docs/changes/README.md
set -u
PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

cmd=$(jq -r '.tool_input.command // empty')
case "$cmd" in
  *"gh pr create"*) ;;
  *) exit 0 ;;
esac
cd "$PROJECT" || exit 0

deny() {
  jq -cn --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

branch=$(git branch --show-current)
[ -n "$branch" ] && [ "$branch" != "main" ] || deny "main 에서는 PR 을 만들 수 없습니다. 토픽 브랜치로 옮기세요."

# base: origin/main 이 있으면 그것, 없으면 main.
base=main; git rev-parse -q --verify origin/main >/dev/null 2>&1 && base=origin/main

# 1. --body-file 이 docs/changes/ 파일을 가리켜야 한다.
f=$(printf '%s' "$cmd" | grep -oE -- '--body-file(=| +)"?docs/changes/[^ "]+' | head -1 | sed -E 's/^--body-file(=| +)"?//')
[ -n "$f" ] || deny "PR 본문은 원장 파일에서 파생합니다. docs/changes/<YYYY-MM-DD>-<slug>.md 를 쓰고(형식: docs/changes/README.md) 커밋한 뒤 'gh pr create --body-file <그 파일>' 로 여세요."
[ -f "$f" ] || deny "원장 파일이 없습니다: $f"

# 2. 커밋돼 있고(=PR diff 에 포함) main 에는 없어야 한다.
git cat-file -e "HEAD:$f" 2>/dev/null || deny "원장 파일이 아직 커밋되지 않았습니다: $f — 커밋해야 PR diff 에 들어가고 CI 가 통과합니다."
[ -z "$(git status --porcelain -- "$f")" ] || deny "원장 파일에 커밋되지 않은 수정이 있습니다: $f"
! git cat-file -e "$base:$f" 2>/dev/null || deny "원장 파일이 이미 main 에 있습니다: $f — 변경 하나에 새 파일 하나입니다."

# 3. 최소 구조: frontmatter title + '## 요약'.
grep -qE '^title: ' "$f" || deny "원장 frontmatter 에 title: 이 없습니다: $f"
grep -qE '^## 요약' "$f" || deny "원장에 '## 요약' 절이 없습니다: $f"

# 4. 코드가 바뀐 PR 이면 '## 갱신한 문서' 절에 항목이 하나 이상 있어야 한다.
if git diff --name-only "$base...HEAD" | grep -qE '^(js/|css/|index\.html|sw\.js)'; then
  awk '/^## 갱신한 문서/{s=1;next} /^## /{s=0} s && /^- /{found=1} END{exit !found}' "$f" \
    || deny "코드가 바뀐 PR 입니다. 원장 '## 갱신한 문서' 절에 갱신한 문서(status.md · ADR · known-issues · coding-pitfalls · index.md)를 적거나 '- 없음 — 이유' 를 적으세요: $f"
fi
exit 0
