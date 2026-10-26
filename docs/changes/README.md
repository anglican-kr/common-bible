# docs/changes — 변경 원장

**변경 하나에 파일 하나.** 이 디렉터리는 지식 베이스의 **원자료 층**이다 — 여기서 추려 낸 정리 층이 주제 문서 `topics/`(지금 동작하는 것 · 남은 것 · 그 주제의 함정) · `decisions/`(왜 그렇게 정했나) · `known-issues.md`(이슈 번호 대장) · `coding-pitfalls.md`(공통 함정) · `index.md`(무엇을 먼저 읽나)다.

PR 본문은 여기 파일에서 파생한다. frontmatter를 뺀 나머지가 본문이다(`scripts/pr_body.sh`). 같은 글을 두 번 쓰지 않고, 원본은 항상 저장소 안에 남는다. 흐름을 보려면 GitHub 가 아니라 이 디렉터리를 `ls`·`grep` 한다.

## 파일 이름

`YYYY-MM-DD-<slug>.md` — 날짜는 작성일(머지일 아님), slug 는 브랜치 이름에서 타입 접두어를 뗀 것. PR 번호는 생성 직후 훅이 frontmatter 에 적는다.

- **slug에는 무엇을 바꿨는지 담는다**(사용자 결정, 2026-10-24). 다른 문서가 원장을 파일 이름으로 가리키고, 머지된 원장은 이름을 바꿀 수 없다. 그래서 파일을 열지 않고도 내용을 알 수 있게, 브랜치 이름의 타입 접두어 뒤를 내용을 담은 영어 낱말로 짓는다(예: `engine-open-items`). 순번만으로 짓지 않는다(`s6a`, `batch7`).

- 이 디렉터리의 원장은 2026-09-20부터다. 그 전의 기록은 여기 없다. PR 본문은 GitHub에, 옛 `docs/worklog.md`는 git 이력에 있다(`git show 243bf83^:docs/worklog.md`). #331이 이 둘을 소급해 들여왔던 사본 340개(`…-worklog[-N].md`, `…-prNNN-<slug>.md`)는 2026-10-22에 지웠다(사용자 결정, coding-pitfalls §17). `2026-10-10-pr339-review-followup.md`는 이름이 비슷하지만 이 형식으로 쓴 원장이다.

## 형식

```markdown
---
date: 2026-09-20
branch: feat/xxx
title: "feat: 짧은 문구 제목 (커밋 메시지 규칙과 동일)"
---

## 요약

무엇을 왜 바꿨는지 몇 줄로. 관련 ADR과 설계서 절 번호를 적는다.

## 확정 · 근거

(선택) 바꾼 것마다 그 이유. 사용자의 결정과 교정(뜻을 요약하고 날짜를 단다), 책자와 기도서 대조 결과, 리뷰에서 뒤집힌 판단, 일부러 바꾸지 않은 것과 그 이유를 적는다. 맞았던 사실은 하나하나 적지 않고 「검증」에 한 줄로 줄인다.

## 검증

돌린 명령과 결과(유닛, 데이터, e2e, 사실 토큰 비교)와 손으로 확인한 것. 돌리지 않은 검사가 있으면 그 이유.

## 갱신한 문서

코드(`js/` `css/` `index.html` `sw.js`)가 바뀐 PR은 이 절이 **필수**다(훅과 CI가 검사한다). 정리 층 문서(주제 문서, ADR, known-issues, coding-pitfalls, writing.md, workflow.md, index.md) 가운데 손댄 것을 한 줄씩 적는다. 코드와 테스트 파일은 적지 않는다(git diff에 있다). 갱신할 것이 없으면 `- 없음 — 이유` 한 줄.

## 리뷰 반영

(선택) N회차 — 리뷰 스레드별 조치. PR 이 열린 뒤 덧붙인다.
```

## 규칙

- **다른 곳에서 볼 수 있는 것은 다시 적지 않는다**(사용자 결정, 2026-10-24). 바뀐 파일 목록과 곳곳에서 바꾼 문구는 git diff에, 커밋 순서는 커밋 기록에, 새 규칙의 본문은 그 정리 층 문서에 있다. 원장에는 그곳에 없는 것만 쓴다. 왜 바꿨는지, 사용자가 정한 것, 일부러 바꾸지 않은 것, 검증한 명령과 결과다.
- **제목(`title:` — 곧 PR 제목)은 짧고 간결하게** — 무엇을 고쳤는지 한 줄만. 절 번호 · 건수 · 「무엇이 어떻게」 같은 세부는 본문(「요약」 이하)에 채운다(사용자 교정 2026-10-17 — 「PR 제목은 길지 않고 간결하게」 · 「세부 내용은 PR 본문에 채우면 되니까」). 문장이 아니라 문구로 쓴다(「docs: 사용하지 않는 기록 정리」). 사용자 교정 2026-10-22, coding-pitfalls §30.
- **문장 교정 PR의 원장은 `## 먼저 보실 곳`을 맨 앞에 둔다**(2026-10-26). 사용자가 뜻이 달라질 수 있는 고침부터 검토하게 하려는 것이다. 틀은 `.claude/skills/prose-batch/SKILL.md` 「5. 커밋, 원장, PR」에 있다.
- **PR 본문에는 frontmatter와 제목을 넣지 않는다**(사용자 교정 2026-10-22). 그래서 원장에도 `# 제목` 줄을 두지 않는다. 본문은 `scripts/pr_body.sh <원장>`이 frontmatter를 빼고 만든다.
- **머지는 squash**(사용자 결정 2026-10-17 — CLAUDE.md 「브랜치 보호」). 그래서 `title:`이 그대로 main의 커밋 제목이 된다(`<제목> (#N)`) — 타입 접두어와 짧은 제목이 곧 main 이력이다. 항목별 커밋은 계속 의미가 있다 — 그 메시지 목록이 squash 커밋의 본문이 된다. 원장에 적는 커밋 SHA(리뷰 반영의 묶음별 커밋 등)는 main에 남지 않고 PR 페이지(Commits 탭)에만 남는다 — rebase 머지도 SHA를 새로 써서 같은 처지였다.
- 작성 시점은 **PR 을 열기 직전**. 이 파일을 커밋한 뒤 `gh pr create --body-file` 로 연다. 이 명령은 파일을 frontmatter째 올리므로, 만든 직후 아래 줄의 명령으로 본문을 맞춘다. `.claude/hooks/pre-pr-ledger.sh` 가 파일 없는 PR 생성을 막고, `.github/workflows/ledger.yml` 이 PR diff 에 새 원장 파일이 있는지 CI 에서 다시 검사한다(`sync/` 자동 PR 은 면제).
- PR이 열린 뒤 내용이 바뀌면(리뷰 반영, 범위 변경) 원장 파일을 고치고 PR 본문을 REST로 다시 맞춘다 — `bash scripts/pr_body.sh <파일> | gh api -X PATCH repos/anglican-kr/common-bible/pulls/<N> -F body=@-`. GraphQL을 쓰는 `gh pr edit --body-file`은 projectCards 오류로 실패한 적이 있다(2026-09).
- 머지 후에는 고치지 않는다. 사실이 바뀌면 새 변경의 원장에 적고, 정리 층 문서를 갱신한다.
- **머지된 PR을 되돌릴 때도 원장은 남긴다.** `git revert`는 그 PR의 원장까지 지우므로 아래 게이트에 걸린다 — 되돌림 커밋에서 원장 파일을 제외하고(`git revert -n <sha>` — 그 PR의 squash 커밋 하나 — 뒤 `git restore --staged --worktree -- docs/changes/`), 무엇을 왜 되돌렸는지 **새 원장**에 적는다. 되돌렸다는 사실도 기록이다.
- 위 규칙은 세 장치가 강제한다 — CI `.github/workflows/ledger.yml` 이 base 에 이미 있는 원장을 PR 이 건드리면(추가 `A`·복사 `C` 를 뺀 모든 상태 — 수정·삭제·이름변경은 물론 심볼릭 링크로 바꿔치기까지) 실패시키고, `.claude/hooks/pre-commit-ledger.sh` 가 `git commit` 단계에서 같은 판정으로 deny 하며, `scripts/lock_merged_ledgers.sh` 가 로컬에서 머지된 원장을 읽기 전용(`chmod a-w`)으로 잠근다. 잠금은 손으로 고치는 것만 막는 보조 수단이다 — `npm test` 앞(`pretest`)과 `gh pr create` 뒤(`post-pr-ledger.sh`)에 자동으로 돌지만, git 이 파일 모드를 저장하지 않으므로 클론마다 사라지고 `git checkout`·`merge`·`apply` 는 잠금을 조용히 푼다(`--unlock` 으로도 푼다). 이 `README.md` 자체는 세 장치 모두 예외라 계속 고칠 수 있다.
