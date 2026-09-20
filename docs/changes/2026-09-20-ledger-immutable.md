---
date: 2026-09-20
branch: chore/ledger-immutable
title: "chore: 원장 불변 게이트 — 머지된 docs/changes 원장의 수정·삭제를 CI·커밋 훅·로컬 잠금으로 막는다"
---

# chore: 원장 불변 게이트 — 머지된 docs/changes 원장의 수정·삭제를 CI·커밋 훅·로컬 잠금으로 막는다

## 요약

`docs/changes/README.md`「규칙」의 「머지 후에는 고치지 않는다」는 규약 문장으로만 있었다 — `.github/workflows/ledger.yml` 은 이 PR 이 원장 파일을 **추가**했는지만 검사하고, `.claude/hooks/pre-pr-ledger.sh` 는 `gh pr create` 만 가로챈다. git 은 실행 비트만 저장하므로 `chmod 444` 는 클론마다 사라진다. 이 PR 은 규약을 세 장치로 강제한다. 교회력 설계 문서 리팩토링 계획(PR ⓪~④, 2026-09-20 승인)의 PR ⓪ — 정리 층을 원장 위에서 다시 쓰는 후속 PR ①~④ 의 전제다(원자료 층이 불변이어야 그 위의 정리가 안전하다).

- **CI `ledger.yml`** — 기존 검사 뒤에 「base 에 이미 있는 `docs/changes/*.md`(README.md 제외)가 이 PR 에서 수정(M)·삭제(D)·이름변경(R) 되면 실패」 검사를 추가. `git diff --name-status "$base...HEAD"` 기준이라 이 PR 이 추가한 원장에 훅이 `pr: N` 을 적는 후속 커밋은 A 로 잡혀 걸리지 않는다. R 행은 old 경로(base 쪽)로 판정. `sync/*` 면제는 먼저 `exit 0` 하므로 새 검사에도 그대로 적용.
- **`.claude/hooks/pre-commit-ledger.sh`(신설, PreToolUse Bash)** — `git commit` 을 가로채 스테이지된(`-a`/`--all`/`-am` 류면 unstaged 도 합쳐) 원장 변경 중 base(`origin/main`, 없으면 `main`)에 있는 파일의 M/D/R 이 있으면 deny — 이유에 파일명과 규칙 문장. 한계: `git commit -- <path>` 패스스펙 커밋은 스테이지를 거치지 않아 못 잡는다(CI 가 잡는다). `.claude/settings.json` PreToolUse Bash 매처에 `pre-pr-ledger.sh` 뒤로 등록.
- **`scripts/lock_merged_ledgers.sh`(신설)** — base 에 있는 원장을 `git ls-tree` 로 나열해 `chmod a-w`(`--unlock` 이면 `u+w`). 로컬 보조 수단 — `npm test` 앞(`package.json` `pretest`)과 `gh pr create` 뒤(`post-pr-ledger.sh` 끝)에 자동으로 돈다. CI `test.yml` 은 `node --test` 를 직접 부르므로 영향 없음. `verify-on-stop.sh` 가 `npm test` 를 부르므로 Stop 시에도 돈다(멱등이라 무해).

## 확정·근거

- 사용자 결정(2026-09-20): 444 잠금은 **로컬 보조로만** 채택 — git 이 파일 모드(444)를 저장하지 않으므로 클론마다 사라지고, 진짜 게이트는 훅(커밋 단계)과 CI(PR diff)여야 한다.
- `README.md` 는 세 장치 모두 예외 — 규약 자체는 계속 고칠 수 있어야 한다.

## 검증

워크트리에서 `CLAUDE_PROJECT_DIR` 를 명시하고 stdin JSON 으로 훅을 직접 호출.

- `pre-commit-ledger.sh` — `bash -n` 통과. `git status`(무관 명령) no-op · 깨끗한 인덱스 + `git commit -m x` no-op · 머지된 원장(`2026-09-20-pr330-data-2026-09-20.md`)을 수정·스테이지한 뒤 `git commit -m x` / `-am x` 둘 다 deny JSON(파일명·규칙 문장 포함) · `git restore --staged` 로 unstaged 만 남기면 `-m` 은 통과하고 `-am` 은 deny · `git checkout` 으로 되돌린 뒤 통과 · 새 원장 파일(A) 스테이지는 통과 · unstaged `README.md` 수정은 `-am` 에서도 면제 · `git rm`(D) deny · `git mv`(R100) deny — 이유에 **old 경로**.
- `ledger.yml` — `run:` 블록을 추출해 `bash -n` 통과. 새 awk 파이프라인을 R100 이 스테이지된 워크트리에 대해 `git diff --name-status origin/main` 으로 돌려 old 경로가 잡히는 것 확인. 커밋 뒤 같은 블록을 `HEAD_REF=chore/ledger-immutable BASE_REF=main` 으로 로컬 실행 → 원장 후보 OK + 「머지된 원장 수정 없음」 exit 0(이 PR 의 원장 diff 는 A 하나 + `README.md` M). 실제 CI 통과는 이 PR 로 확인.
- `lock_merged_ledgers.sh` — 실행 후 `ls -l docs/changes/2026-09-20-pr330-data-2026-09-20.md` → `-r--r--r--`, 잠긴 파일 341개(342 − README.md), `README.md` 는 `-rw-r--r--` 유지. `--unlock` 뒤 잠긴 파일 0. `npm run pretest` 로도 같은 결과. 모드 변경은 `git status` 에 잡히지 않음(git 은 실행 비트만 추적).
- `post-pr-ledger.sh` — 가짜 PR URL(#999)·임시 원장으로 호출: `pr: 999` 삽입 + systemMessage 출력 + 머지된 원장 341개 잠김, 임시 원장(base 에 없음)은 `-rw-r--r--` 유지.
- `.claude/settings.json` `jq .` 유효, PreToolUse Bash 훅 순서 `pre-pr-ledger.sh` → `pre-commit-ledger.sh`.
- 시험 후 워크트리 원복(`git status` 에 의도한 변경만).

## 갱신한 문서

- `docs/changes/README.md` — 「규칙」 절에 세 장치 불릿 추가(README.md 예외 명시).
- `CLAUDE.md` — 「프로젝트 구조」의 `.claude/hooks/`·`scripts/`·`ledger.yml` 행, 「지식 베이스 루프」 2번 끝 문장.
- `docs/status.md` — 없음 — 코드 변경 없음.
