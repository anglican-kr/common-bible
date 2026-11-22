---
date: 2026-11-22
branch: chore/dev-branch
title: "chore: dev 브랜치를 두고 main은 운영에만 쓰기"
---

## 요약

작업은 `dev` 브랜치에 모으고, `main`은 운영(bible.anglican.kr)에 낸 코드만 담도록 브랜치 운영을 바꾼다(ADR-051). 이 PR은 규칙 문서, CI, 원장 훅과 스크립트를 dev 기준으로 바꾼다. 앱 코드는 바꾸지 않는다.

- 작업 PR의 대상, 원장의 기준 브랜치, 데이터 자동 PR(`sync-data.yml`)의 대상, 머지 뒤 검사(`test.yml`, `engine-data.yml`)의 대상을 dev로 바꿨다.
- 운영에 낼 때는 dev에서 main으로 PR을 열어 검사를 통과시키고 main을 그 커밋으로 앞당긴다. CLAUDE.md 「데이터 수정과 릴리스」 4에 순서를 적었다.
- 이 PR은 dev가 아직 없어 main으로 연다. 머지한 뒤 그 커밋으로 dev를 만든다.

## 확정 · 근거

- 사용자가 dev 브랜치를 두고 main은 운영에 배포할 때만 쓰기로 정했다(2026-11-22).
- dev에서 main으로 반영하는 방법으로 머지 커밋 대신 앞당기기를 골랐다(2026-11-22). main과 dev의 커밋이 같아야 dev.anglican.kr에서 확인한 빌드를 promote가 그대로 운영에 낸다. 머지 커밋은 저장소 설정을 다시 열어야 한다.
- 배포 스크립트에도 브랜치 확인을 넣기로 했다(2026-11-22). 서버 저장소의 별도 PR이다.
- 급한 수정도 dev를 거친다(ADR-051 §5). main에서 따면 dev와 갈라져 다음에 앞당길 수 없다. 사용자가 고른 것이 아니라 앞당기기를 고른 데서 따라 나온 규칙이라, 다르게 하려면 PR 리뷰에서 정한다.
- 데이터와 서버 저장소에는 dev를 두지 않는다(ADR-051 「검토한 대안」 4). 데이터 저장소는 앱 dev로 동기화를 요청하는 한 줄만 바꾼다.
- 운영 반영 PR(dev에서 main으로)은 원장을 쓰지 않는다. `Change ledger`는 이 저장소의 dev에서 main으로 가는 PR에 새 원장을 요구하지 않는다. 데이터 자동 PR만 모아 운영에 낼 때는 새 원장이 하나도 없어, 요구하면 main을 앞당길 수 없다. 머지된 원장을 고쳤는지는 그 PR에서도 본다. 원장 훅은 그 PR을 막으므로 REST로 연다.
- `sync-data.yml`은 체크아웃과 PR 대상을 모두 dev로 고정했다. 데이터 저장소가 옛 ref(main)로 실행을 요청해도 dev를 기준으로 본다.
- 원장 훅과 `lock_merged_ledgers.sh`는 `origin/dev`가 없는 클론에서 `origin/main`, 그다음 `main`을 기준으로 본다. 이 PR을 만드는 동안처럼 dev가 아직 없을 때도 동작한다.
- 지난 일을 적은 문장(「main부터」, 「main `f358691`」, 옛 PR의 서사)은 그때의 사실이라 바꾸지 않았다.

## 검증

- 원장 훅 둘을 임시 저장소에서 실행했다. dev와 main에서 PR 생성 명령은 막히고, 토픽 브랜치에서는 `origin/dev`에 이미 있는 원장을 본문으로 쓰면 막히며, `origin/dev`에 있는 원장을 고친 커밋도 막혔다. `origin/dev`가 없으면 `origin/main`을 기준으로 보는 것도 확인했다.
- 훅과 스크립트를 `bash -n`, `docs_facts_snapshot.py`를 `ast.parse`로 구문 검사했다.
- `node --test tests/unit/*.test.js`: 1,973건 중 통과 1,736, 실패 0, 건너뜀 237(이 작업 폴더에 데이터 서브모듈을 받지 못해 실데이터 테스트가 건너뛰었다). `npm run typecheck`: 통과. 문서와 CI만 바꾼 PR이라 e2e는 돌리지 않았다.
- 서버 저장소의 배포 확인은 가짜 앱 저장소와 가짜 `ssh`로 열한 경우를 돌렸다. dev 배포(dev 끝 커밋, main 커밋)와 prod 배포(main), promote(빌드 커밋이 main)는 통과하고, prod 배포(dev 끝 커밋), dev 배포(올리지 않은 커밋, 커밋하지 않은 변경), promote(빌드 커밋이 dev 끝, `-dirty` 빌드, dev 링크 없음), 받기 실패는 멈췄다.
- 워크플로 변경(dev push, dev로 가는 PR, 앞당기기 push)은 dev를 만든 뒤 첫 실행에서 확인한다.

## 갱신한 문서

- `docs/decisions/051-dev-and-main-branches.md`: 새 ADR
- `CLAUDE.md`: 「브랜치 보호와 작업 흐름」, 「작업 표준 흐름」, 「데이터 수정과 릴리스」
- `docs/workflow.md`: 「커밋과 PR」, 「릴리스」, 「도구와 훅」, 「작업 중 함정」
- `docs/architecture.md`: 데이터 자동화, CI, 배포 확인, 릴리스 순서, 부록 A의 ADR 인덱스
- `docs/changes/README.md`: squash 커밋 제목이 dev의 이력이 되는 것
- `docs/writing.md`: 사실 토큰 비교의 기준 리비전
- `.claude/skills/prose-batch/SKILL.md`, `.claude/commands/security-audit.md`, `tools/prose/README.md`: 기준 브랜치를 dev로
