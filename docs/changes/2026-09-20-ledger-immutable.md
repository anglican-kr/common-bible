---
pr: 332
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

## 리뷰 반영 (2026-09-20, 1회차)

Copilot 이 아니라 세션 내 리뷰. 세 장치를 샌드박스 저장소에서 직접 돌려 7건을 재현하고 전부 반영했다(`7109a4f`).

- **typechange(`T`) 가 세 장치를 모두 통과했다.** 머지된 원장을 지우고 같은 이름의 심볼릭 링크로 바꾸면 CI 가 「머지된 원장 수정 없음」을 찍고 exit 0 하고, 훅도 통과했다. 판정을 「`M`/`D`/`R` 열거」에서 「`A`(추가)·`C`(복사)가 **아니면** 위반」으로 뒤집었다 — 열거하면 빠진 글자가 곧 구멍이고, 이렇게 두면 git 이 새 상태 문자를 내도 기본이 「막음」이다. `C` 는 원본을 건드리지 않으므로 제외(복사 탐지가 켜진 설정에서 원본을 오탐하지 않게).
- **CI 가 엉뚱한 오류를 냈다.** 머지된 원장을 지우면서 새 원장을 추가하면 rename 탐지가 둘을 `R054` 한 줄로 합쳐 `--diff-filter=A` 가 비고, 「원장 파일이 없습니다」가 먼저 나갔다. 불변 검사를 「원장 추가」 검사보다 앞으로 옮겨 맞는 메시지가 나가게 했다(다른 동작은 그대로).
- **전역 옵션이 낀 커밋이 훅을 통과했다.** `git -c user.email=… commit` · `git -C <path> commit` · `git --no-pager commit` 은 인접 문자열 `"git commit"` 이 사라진다. 매칭을 `*git*commit*` 으로 넓혔다 — 실제 deny 는 스테이지 내용으로만 결정되므로 넓혀도 부작용이 없고, deny 이유가 안내하는 `git restore --staged` · `git checkout --` 에는 `commit` 이라는 낱말이 없어 탈출구는 막히지 않는다.
- **`-a` 탐지가 커밋 메시지 본문에 걸렸다.** `git commit -m "fix -a flag"` · `-m "support --all"` 이 오탐으로 deny 되고(`--all` 가지에 앵커가 없었다), `git commit -am"msg"` 는 미탐이었다. 옵션을 찾기 전에 따옴표로 감싼 인자를 지우고 `--all` 을 `( |$)` 로 앵커했다.
- **잠금만 범위가 달랐다.** `git ls-tree` 가 비재귀라 `docs/changes/sub/…md` 를 잠그지 않는데, 훅·CI 의 `docs/changes/*.md` 패스스펙은 하위 디렉터리를 잡는다. `-r` 을 붙여 셋을 맞췄다.
- **잠금 머리 주석 정정.** 「클론마다 사라진다」만으로는 부족했다 — `git checkout`(내용이 다른 브랜치로) · `git merge` · `git apply` 가 모두 잠긴 파일을 조용히 덮어쓰고 644 로 되돌리는 것을 확인했다. 손으로 고치는 것만 막는 보조 수단임을 주석과 `README.md` 에 분명히 적었다.
- **되돌리기 규칙이 없었다.** 머지된 PR 을 `git revert` 하면 그 PR 의 원장까지 지워져 훅·CI 가 둘 다 거부하는데 탈출구가 문서에 없었다. `docs/changes/README.md`「규칙」에 「원장은 남기고 되돌림을 새 원장에 적는다」를 추가하고 CI 오류 메시지에도 같은 안내를 넣었다.

검증(변이 검사 — 옛 버전과 새 버전을 같은 시나리오에 나란히 돌려 갈리는 지점을 확인):

- 훅 19건 전부 기대대로. 옛↔새가 갈린 8건: `T` 심볼릭 링크(pass→DENY) · `git -c`/`git -C`/`git --no-pager`(pass→DENY) · `-am"msg"`(pass→DENY) · `-m "fix -a flag"`/`-m "support --all"`/작은따옴표판(DENY→pass). 나머지 11건(스테이지된 `M` · `-a` 로 unstaged 포함 · unstaged 만 · `D` · `R` · 새 원장 `A` · `README.md` · 하위 디렉터리 원장 · `git status` · `ls` · 탈출구 `git restore`)은 옛·새 동일.
- CI 10건 전부 기대대로. 갈린 3건: `T`(rc=0→rc=1) · 「기존 원장 삭제 + 새 원장 추가」와 「원장을 `docs/` 밖으로 이동」(오류 메시지가 「원장 파일이 없습니다」→「머지된 원장은 고치지 않습니다」). `sync/` 면제 · 원장 없는 PR · 형식 미달 · 코드 변경 시 「갱신한 문서」 검사는 그대로.
- 잠금: 하위 디렉터리 원장이 새로 잠기고 `.txt`·`README.md` 는 제외, 멱등 재실행·`--unlock`·저장소 밖 호출 모두 rc=0. 실제 저장소에서 `npm run pretest` → 341/343 잠김(`README.md` 와 이 PR 의 원장 제외), `git status` 에 모드 변경 안 잡힘, 0.5초.
- `npm run typecheck` 통과 · `node --test tests/unit/*.test.js` **878 통과**.
