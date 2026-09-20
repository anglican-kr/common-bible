#!/usr/bin/env bash
# 머지된 변경 원장(docs/changes/)을 로컬에서 읽기 전용으로 잠근다.
# 대상: base(origin/main, 없으면 main)에 이미 있는 docs/changes/**.md — README.md 는 제외.
# 로컬 보조 수단일 뿐이다 — 손으로 고치는 것(편집기 · sed -i · 리디렉션)만 막는다. git 은 읽기 전용
# 파일을 지웠다 다시 만들므로 checkout · merge · apply · stash pop 은 잠금을 조용히 풀고 644 로
# 되돌린다. git 이 실행 비트만 저장하는 탓에 클론에서도 사라진다 — 그때마다 다시 돌려야 한다.
# `npm test` 앞(package.json pretest)과 `gh pr create` 뒤(post-pr-ledger.sh)에 자동으로 돈다.
# 진짜 게이트는 .claude/hooks/pre-commit-ledger.sh(커밋 단계)와 .github/workflows/ledger.yml(CI).
# 사용: scripts/lock_merged_ledgers.sh            # chmod a-w
#       scripts/lock_merged_ledgers.sh --unlock   # chmod u+w 로 되돌린다
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 0

mode=a-w
[ "${1:-}" = "--unlock" ] && mode=u+w

base=
if git rev-parse -q --verify origin/main >/dev/null 2>&1; then base=origin/main
elif git rev-parse -q --verify main >/dev/null 2>&1; then base=main
else exit 0; fi

# -r 로 재귀 — 훅·CI 의 'docs/changes/*.md' 패스스펙은 하위 디렉터리까지 잡으므로 잠금도 범위를 맞춘다.
git ls-tree -r --name-only "$base" -- docs/changes/ 2>/dev/null | while IFS= read -r f; do
  case "$f" in *.md) ;; *) continue ;; esac
  case "$f" in */README.md) continue ;; esac
  [ -f "$f" ] && chmod "$mode" "$f"
done
exit 0
