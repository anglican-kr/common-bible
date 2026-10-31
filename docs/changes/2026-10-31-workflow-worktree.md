---
date: 2026-10-31
branch: docs/workflow-worktree
title: "docs: 작업 폴더 흐름 변경 및 초안 PR 함정 기록"
---

## 요약

작업 흐름을 작업 폴더(git worktree) 기준으로 바꾼다. 머지할 때 만난 초안 PR 거절을 함정으로 적고, 문장 검사에 「가르다」를 더한다. 셋 모두 사용자 결정 2026-10-31이다.

## 확정 · 근거

- **작업은 늘 작업 폴더에서 한다.** 작업 폴더는 저장소 안이 아니라 `~/projects/worktrees/<이름>`에 만들고, PR을 머지하면 바로 그 폴더와 로컬 브랜치를 지운다. 지우기 전에 커밋하지 않은 변경과 git이 무시하는 파일 가운데 남길 것이 있는지 본다.
  - 이전 「작업 표준 흐름」은 원래 폴더에서 브랜치를 따고, 머지 뒤 그 폴더의 main을 받는 순서였다. 원래 폴더의 main은 다른 세션이 쓸 수 있으므로 받는 단계를 뺐다. 그래서 머지 메시지의 커밋 목록과 squash 확인은 `main` 대신 `origin/main`과 비교한다.
  - squash 메시지의 커밋 목록에서 main을 합친 커밋을 뺀다(`git log --no-merges`). 문장 교정 PR(#455)처럼 main을 합친 브랜치를 그렇게 머지했다.
  - 문장 교정 스킬이 만드는 작업 폴더도 `.claude/worktrees/prose`에서 `~/projects/worktrees/prose`로 옮겼다.
- **작업 폴더를 지울 때 `--force`는 확인한 뒤에만 붙인다.** git은 서브모듈을 받은 작업 폴더를 강제 옵션 없이 지우지 않는다(임시 저장소로 확인했다. 「working trees containing submodules cannot be moved or removed」). 그래서 명령은 강제 옵션 없이 적고, `git status --short --ignored`로 남길 것이 없음을 본 뒤에 붙이라고 주석에 적었다.
- **작업 폴더에서 e2e를 돌리는 요령을 저장소로 옮겼다.** 서브모듈을 원래 폴더의 것을 참조해 받는 법, 다른 포트에 Python 3.14로 서버를 띄우는 법, e2e 사본의 포트를 바꾸는 법이다. 그동안 저장소 밖 메모에만 있었다.
- **초안 PR은 머지되지 않는다.** 클라우드 정기 실행이 연 #455가 초안이라, 머지 API가 「Pull Request is still a draft」(405)로 거절했다. PR 타임라인을 보면 사용자 계정이 검토할 수 있는 상태로 바꾸고 8초 뒤에 머지했다. #448, #450, #453도 초안이었다.
  - 스킬(`.claude/skills/prose-batch/SKILL.md`)의 PR 여는 명령에는 `--draft`가 없고, 스킬은 머지하지 않는다고 적혀 있다. 그래서 스킬의 PR 단계는 고치지 않았다. 초안으로 열린 까닭은 확인하지 못했다. 클라우드에서 쓰는 GitHub 도구의 PR 생성에는 `draft` 인자가 있다.
- **「가르다」를 판단이 필요한 낱말 목록(`term?`)에 더했다.** 「용어」 표에 이미 있는 낱말이다(사용자 교정 2026-10-31, #457). 정규식은 「가르치다」, 「갈라지다」, 「갈라티아」, 「갈라디아」를 잡지 않는다. 「갈래」, 「가리다」, 「가려내다」는 처음부터 맞지 않는다.
  - 저장소 전체에서 새로 잡히는 곳은 49건이다. 문서가 10건(`docs/design/liturgical-engine/09-open-items.md` 3건, ADR-036 2건, `docs/index.md`, `docs/coding-pitfalls.md` 등), 코드 주석과 테스트가 39건이다. #457이 고친 낱말 가운데 「갈려」, 「갈렸」, 「갈릴」 같은 활용과 코드 주석이 남은 것이다. 문서 10곳(낱말 11곳)은 이 PR에서 고쳤다. #457에서 문서의 「가르다」는 그 PR에서 모두 고치기로 했는데(사용자 결정) 이 활용형을 놓쳤기 때문이다. 고친 줄의 띄어 쓴 조사 6곳과 「상이」 하나도 함께 고쳤다. 코드 주석과 테스트 39건은 문서가 아니라서, 문장 교정 반복 실행이 파일 차례에 본다.

## 검증

- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`: 31개 모두 통과(데이터 서브모듈을 받아 설계서 `facts` 블록 검사 포함).
- `python3 scripts/docs_facts_snapshot.py --diff origin/main WORKTREE --strict-counts`: 사라지거나 줄어든 토큰 0, 새 토큰 0.
- `python3 -m unittest tools/prose/test_prose.py`: 31개 모두 통과(「가르다」 테스트 하나를 더했다).
- `python3 tools/prose/prose.py lint`(고친 파일): `particle`, `tilde`, `term` 0건. 0건을 맞추려고 `docs/workflow.md` pitfalls §17 사례의 사용자 인용을 큰따옴표에서 낫표로 바꿨다. 인용한 글자는 그대로다.
- `python3 tools/prose/prose.py same-code origin/main --allow tools/prose/`: 주석과 문서 말고 바뀐 파일 0개.
- 새로 잡히는 건수는 `prose.py lint --json`의 결과를 목록을 더하기 전과 뒤로 견줘 셌다. 사라진 것은 0건이다.

## 갱신한 문서

- `CLAUDE.md` 「브랜치 보호와 작업 흐름」: 작업 폴더 규칙과 「작업 표준 흐름」. 「테스트」: 작업 폴더의 e2e는 다른 포트로
- `docs/workflow.md` 「커밋과 PR」: 초안 PR. 「작업 중 함정」: 작업 폴더와 e2e 요령
- `.claude/skills/prose-batch/SKILL.md` 「0. 시작」: 작업 폴더의 자리
- 「가르다」의 활용형: `docs/coding-pitfalls.md`, ADR-036, `docs/design/liturgical-engine-review.md`, `docs/design/liturgical-engine/04-compute-layer.md`, `05-lookup-layer.md`, `09-open-items.md`, `docs/index.md`
