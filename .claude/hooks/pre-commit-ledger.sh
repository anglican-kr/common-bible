#!/usr/bin/env bash
# PreToolUse(Bash) hook — 머지된 변경 원장(docs/changes/) 불변 게이트.
# `git commit` 을 가로채, base(origin/main, 없으면 main)에 이미 있는 원장 파일(README.md 제외)이
# 수정(M)·삭제(D)·이름변경(R) 된 채 커밋되려 하면 permissionDecision=deny 로 막는다. 그 외 명령은 no-op.
# 규약(docs/changes/README.md「규칙」): 머지 후에는 고치지 않는다 — 사실이 바뀌면 새 변경의 원장에 적는다.
# 짝: .github/workflows/ledger.yml 의 같은 검사(PR diff 기준 — 터미널에서 만든 커밋·PR 까지 잡는다).
#     scripts/lock_merged_ledgers.sh 는 로컬 읽기 전용 잠금(보조 수단).
# 한계: 스테이지된 변경(-a/--all 이면 unstaged 도 포함)을 기준으로 본다 —
#       `git commit -- <path>` 패스스펙 커밋은 스테이지를 거치지 않으므로 못 잡는다. 그 경우는 CI 가 잡는다.
set -u
PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

cmd=$(jq -r '.tool_input.command // empty')
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac
cd "$PROJECT" || exit 0

deny() {
  jq -cn --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# base: origin/main 이 있으면 그것, 없으면 main. 둘 다 없으면 판정할 기준이 없다 — 통과.
base=
if git rev-parse -q --verify origin/main >/dev/null 2>&1; then base=origin/main
elif git rev-parse -q --verify main >/dev/null 2>&1; then base=main
else exit 0; fi

# 스테이지된 변경. -a/--all/-am 류가 있으면 unstaged 변경도 함께 커밋되므로 합친다.
changes=$(git diff --cached --name-status -- 'docs/changes/*.md')
if printf '%s' "$cmd" | grep -qE -- '(^| )-[a-zA-Z]*a[a-zA-Z]*( |$)|--all'; then
  changes=$(printf '%s\n%s' "$changes" "$(git diff --name-status -- 'docs/changes/*.md')")
fi

# 행 형식: "M<TAB>path" / "D<TAB>path" / "R100<TAB>old<TAB>new" — R 은 old 경로(base 에 있던 쪽)로 판정.
while IFS=$'\t' read -r st old _new; do
  [ -n "$st" ] || continue
  case "$st" in M|D|R*) ;; *) continue ;; esac
  case "$old" in */README.md) continue ;; esac
  git cat-file -e "$base:$old" 2>/dev/null || continue   # base 에 없으면 이 PR 이 추가한 원장 — 고쳐도 된다
  deny "머지된 원장은 고치지 않습니다: $old — 사실이 바뀌면 새 변경의 원장에 적고 정리 층 문서를 갱신하세요(docs/changes/README.md 규칙). 커밋에서 빼려면: git restore --staged -- $old && git checkout -- $old"
done <<CHANGES
$changes
CHANGES
exit 0
