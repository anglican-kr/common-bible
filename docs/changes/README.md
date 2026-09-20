# docs/changes — 변경 원장

**변경 하나에 파일 하나.** 이 디렉터리는 지식 베이스의 **원자료 층**이다 — 여기서 추려 낸 정리 층이 `status.md`(지금 동작하는 것) · `decisions/`(왜 그렇게 정했나) · `known-issues.md`(남은 것) · `coding-pitfalls.md`(조심할 것) · `index.md`(무엇을 먼저 읽나)다.

PR 본문은 여기 파일에서 파생한다 (`gh pr create --body-file docs/changes/<파일>`). 같은 글을 두 번 쓰지 않고, 원본은 항상 저장소 안에 남는다. 흐름을 보려면 GitHub 가 아니라 이 디렉터리를 `ls`·`grep` 한다.

## 파일 이름

`YYYY-MM-DD-<slug>.md` — 날짜는 작성일(머지일 아님), slug 는 브랜치 이름에서 타입 접두어를 뗀 것. PR 번호는 생성 직후 훅이 frontmatter 에 적는다.

- 소급 기록(2026-09-20 에 빠져 있던 과거 기록을 한꺼번에 채워 넣은 것) 파일은 예외 — `…-worklog[-N].md` 는 옛 `docs/worklog.md` 를 날짜 블록별로 그대로 옮긴 것(`source: worklog`), `…-prNNN-<slug>.md` 는 머지된 PR 본문을 GitHub 에서 받아 저장한 것(날짜 = KST 머지일). 내용은 손대지 않았다.

## 형식

```markdown
---
date: 2026-09-20
branch: feat/xxx
title: "feat: 한 줄 제목 (커밋 메시지 규칙과 동일)"
---

# feat: 한 줄 제목

## 요약

무엇을 왜 바꿨는지. 관련 ADR·설계서 절 번호를 적는다.

## 확정·근거

(선택) 사용자가 확인해 준 사실, 책자·기도서 대조 결과, 리뷰에서 뒤집힌 판단. 나중에 정리 층으로 올라갈 후보라 근거(날짜·출처)를 남긴다.

## 검증

유닛·데이터·e2e 결과, 수동 확인 항목.

## 갱신한 문서

코드(`js/` `css/` `index.html` `sw.js`)가 바뀐 PR 은 이 절이 **필수**(훅·CI 가 검사). status.md · ADR · known-issues · coding-pitfalls · index.md 중 손댄 것을 적고, 갱신할 것이 없으면 `- 없음 — 이유` 한 줄.

## 리뷰 반영

(선택) N회차 — 리뷰 스레드별 조치. PR 이 열린 뒤 덧붙인다.
```

## 규칙

- 작성 시점은 **PR 을 열기 직전**. 이 파일을 커밋한 뒤 `gh pr create --body-file` 로 연다. `.claude/hooks/pre-pr-ledger.sh` 가 파일 없는 PR 생성을 막고, `.github/workflows/ledger.yml` 이 PR diff 에 새 원장 파일이 있는지 CI 에서 다시 검사한다(`sync/` 자동 PR 은 면제).
- PR 이 열린 뒤 내용이 바뀌면(리뷰 반영, 범위 변경) 원장 파일을 고치고 `gh pr edit --body-file` 로 본문을 다시 맞춘다.
- 머지 후에는 고치지 않는다. 사실이 바뀌면 새 변경의 원장에 적고, 정리 층 문서를 갱신한다.
- **머지된 PR 을 되돌릴 때도 원장은 남긴다.** `git revert` 는 그 PR 의 원장까지 지우므로 아래 게이트에 걸린다 — 되돌림 커밋에서 원장 파일을 제외하고(`git revert -n <sha>` 뒤 `git restore --staged --worktree -- docs/changes/`), 무엇을 왜 되돌렸는지 **새 원장**에 적는다. 되돌렸다는 사실도 기록이다.
- 위 규칙은 세 장치가 강제한다 — CI `.github/workflows/ledger.yml` 이 base 에 이미 있는 원장을 PR 이 건드리면(추가 `A`·복사 `C` 를 뺀 모든 상태 — 수정·삭제·이름변경은 물론 심볼릭 링크로 바꿔치기까지) 실패시키고, `.claude/hooks/pre-commit-ledger.sh` 가 `git commit` 단계에서 같은 판정으로 deny 하며, `scripts/lock_merged_ledgers.sh` 가 로컬에서 머지된 원장을 읽기 전용(`chmod a-w`)으로 잠근다. 잠금은 손으로 고치는 것만 막는 보조 수단이다 — `npm test` 앞(`pretest`)과 `gh pr create` 뒤(`post-pr-ledger.sh`)에 자동으로 돌지만, git 이 파일 모드를 저장하지 않으므로 클론마다 사라지고 `git checkout`·`merge`·`apply` 는 잠금을 조용히 푼다(`--unlock` 으로도 푼다). 이 `README.md` 자체는 세 장치 모두 예외라 계속 고칠 수 있다.
