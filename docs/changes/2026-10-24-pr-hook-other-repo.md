---
pr: 401
date: 2026-10-24
branch: chore/pr-hook-other-repo
title: "chore: 다른 저장소에 여는 PR은 원장 훅이 검사하지 않음"
---

## 요약

PR을 열기 전에 원장을 검사하는 훅(`.claude/hooks/pre-pr-ledger.sh`)이 저장소를 가리지 않고 PR 생성 명령을 모두 막았다. 그래서 data 저장소(`anglican-kr/common-bible-data`)에 PR을 열 수 없었다. data 저장소에는 원장 규칙이 없다(`docs/workflow.md`). 명령이 `--repo`나 `-R`로 이 저장소가 아닌 곳을 가리키면 훅이 검사하지 않고 넘어가게 했다.

## 확정 · 근거

- 사용자가 훅을 고치는 쪽을 골랐다(2026-10-24). 다른 길은 이번만 API로 열거나 사용자가 직접 여는 것이었다.
- `--repo anglican-kr/common-bible`처럼 이 저장소를 직접 가리키면 지금처럼 검사한다.
- 짝 훅 `post-pr-ledger.sh`는 원장 파일이 없으면 아무것도 하지 않으므로 고치지 않았다.
- 알아 둘 점: 훅은 명령 문자열에 PR 생성 명령 글자가 들어 있기만 해도 걸린다. 다른 명령의 인자나 문자열에 그 글자가 있으면 그 명령도 막힌다. 이번에는 고치지 않았다.

## 검증

- 훅에 네 가지 명령을 넣어 보았다.
  - data 저장소, `--repo`: 검사하지 않고 통과
  - data 저장소, `-R`: 검사하지 않고 통과
  - 저장소 지정 없음, 원장 없음: 막힘
  - `--repo anglican-kr/common-bible`, 원장 없음: 막힘
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.

## 갱신한 문서

- `docs/workflow.md`: 「훅」 목록의 PR 원장 훅 설명에 다른 저장소의 PR은 검사하지 않는다는 것을 더했다.
