#!/usr/bin/env bash
# 원장 파일에서 PR 본문을 만든다. frontmatter와 맨 앞의 `# 제목` 줄을 빼고 나머지를 그대로 낸다.
# PR 제목은 frontmatter의 title:이 맡으므로 본문에 다시 쓰지 않는다(사용자 교정 2026-10-22, coding-pitfalls §30).
# `gh pr create --body-file <원장>`은 원장 게이트(.claude/hooks/pre-pr-ledger.sh)가 요구하는 대로 파일을 그대로
# 올린다. 그래서 PR을 만든 직후와 원장을 고칠 때마다 이 출력으로 본문을 다시 맞춘다:
#   bash scripts/pr_body.sh docs/changes/<원장>.md | gh api -X PATCH repos/anglican-kr/common-bible/pulls/<N> -F body=@-
set -eu
f=${1:?원장 파일 경로가 필요합니다}
[ -f "$f" ] || { echo "원장 파일이 없습니다: $f" >&2; exit 1; }

awk '
  NR == 1 && /^---$/ { fm = 1; next }          # frontmatter 시작
  fm { if (/^---$/) fm = 0; next }             # frontmatter 끝까지 건너뛴다
  !body && /^[[:space:]]*$/ { next }           # 본문 앞의 빈 줄
  !body && !h1 && /^# / { h1 = 1; next }       # 제목 줄 — PR 제목이 맡는다
  { body = 1; print }
' "$f"
