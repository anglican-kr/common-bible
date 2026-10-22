#!/usr/bin/env bash
# PreToolUse(Bash) hook — 머지된 변경 원장(docs/changes/) 불변 게이트.
# `git commit` 을 가로채, base(origin/main, 없으면 main)에 이미 있는 원장 파일(README.md 제외)에
# 손댄 채 커밋되려 하면 permissionDecision=deny 로 막는다. 그 외 명령은 no-op.
# 규약(docs/changes/README.md「규칙」): 머지 후에는 고치지 않는다 — 사실이 바뀌면 새 변경의 원장에 적는다.
# 짝: .github/workflows/ledger.yml 의 같은 검사(PR diff 기준 — 터미널에서 만든 커밋·PR 까지 잡는다).
#     scripts/lock_merged_ledgers.sh 는 로컬 읽기 전용 잠금(보조 수단).
#
# 판정: --name-status 상태가 A(추가)·C(복사 — 원본은 건드리지 않는다)가 **아니면** 전부 위반으로 본다.
#       M/D/R 뿐 아니라 T(원장을 심볼릭 링크로 바꿔치기)·U(충돌)도 잡히고, git 이 앞으로 새 상태
#       문자를 내더라도 기본값이 「막음」이다. 목록으로 열거하면 빠진 글자가 곧 구멍이 된다.
# 명령 매칭이 넓은 이유: `git -c user.email=… commit`·`git -C <path> commit`·`git --no-pager commit`
#       처럼 전역 옵션이 끼면 "git commit" 이라는 인접 문자열이 사라진다. 넓게 잡아도 부작용은 없다 —
#       실제 deny 는 스테이지 내용으로만 결정되고, deny 이유가 안내하는 `git restore --staged` ·
#       `git checkout --` 에는 commit 이라는 낱말이 없어 탈출구까지 막히지는 않는다.
# 한계: 스테이지된 변경(-a/--all 이면 unstaged 도 포함)을 기준으로 본다 —
#       `git commit -- <path>` 패스스펙 커밋과, 이미 브랜치의 커밋에 들어간 변경(`--amend` 로 고쳐도
#       --cached 에는 안 보인다)은 못 잡는다. 그 경우는 CI 가 잡는다.
set -u
PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

cmd=$(jq -r '.tool_input.command // empty')
case "$cmd" in
  *git*commit*) ;;
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
# 옵션을 찾기 전에 따옴표로 감싼 인자(커밋 메시지)를 지운다 — `-m "fix -a flag"` 나
# `-m "support --all"` 의 본문을 옵션으로 오인해 엉뚱하게 deny 하지 않기 위해서다.
changes=$(git diff --cached --name-status -- 'docs/changes/*.md')
opts=$(printf '%s' "$cmd" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")
if printf '%s' "$opts" | grep -qE -- '(^| )(-[a-zA-Z]*a[a-zA-Z]*|--all)( |$)'; then
  changes=$(printf '%s\n%s' "$changes" "$(git diff --name-status -- 'docs/changes/*.md')")
fi

# 행 형식: "M<TAB>path" / "D<TAB>path" / "T<TAB>path" / "R100<TAB>old<TAB>new" — R 은 old 경로로 판정.
while IFS=$'\t' read -r st old _new; do
  [ -n "$st" ] || continue
  case "$st" in A*|C*) continue ;; esac      # 추가·복사는 base 쪽 파일을 그대로 둔다
  case "$old" in */README.md) continue ;; esac
  git cat-file -e "$base:$old" 2>/dev/null || continue   # base 에 없으면 이 PR 이 추가한 원장 — 고쳐도 된다
  deny "머지된 원장은 고치지 않습니다: $old — 사실이 바뀌면 새 변경의 원장에 적고 정리 층 문서를 갱신하세요(docs/changes/README.md 규칙). 커밋에서 빼려면: git restore --staged -- $old && git checkout -- $old"
done <<CHANGES
$changes
CHANGES
exit 0
