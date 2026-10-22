---
date: 2026-10-22
branch: chore/docs-lint-tools
title: "chore: 문서 검사 도구 추가"
---

## 요약

docs 재구성 시리즈의 둘째 PR이다. 다음 PR부터 정리 층 문서(status, known-issues, coding-pitfalls)를 영역 문서로 옮기는데, 그 전에 옮긴 결과를 기계로 검증할 도구를 갖춘다. 문서 내용은 옮기지 않았다.

- **사실 토큰 비교 도구를 넓혔다**(`scripts/docs_facts_snapshot.py`). 지금까지는 교회력 설계 문서 다섯과 보관 문서, 픽스처만 볼 수 있었다. 옵션 넷을 더했다. 옵션이 없으면 동작은 그대로다.
  - `--docs GLOB`: 대상 문서를 리비전마다 glob으로 펼친다. 양쪽을 같은 glob으로 보므로 파일 사이로 옮긴 토큰은 사라짐으로 잡히지 않는다.
  - `--kinds general`: 날짜, PR 번호, 건수에 ADR 번호, 옛 번호 참조(「pitfalls §N」), 파일 경로, 인라인 코드, 「」 인용, 사용자 확정 날짜를 더해 센다. 문장을 고쳐 써도 이것들은 그대로여야 한다.
  - `--strict-counts`: 토큰 수가 줄어도 실패로 본다. 여러 파일로 나눠 옮길 때 흔한 토큰이 한 곳에만 남아도 「사라짐 0」이 되는 맹점을 막는다.
  - `--from GLOB --into GLOB`: 옛 파일의 줄이 새 파일들에 개수까지 모두 있는지 본다. 글자 그대로 옮기는 커밋의 검증이다. 제목은 `#`과 앞 번호를, 목록 줄은 앞에 붙인 옛 번호 표지를 떼고 견준다. 일부러 뺀 줄은 `--drop-file`로 받는다.
- **저장소 문서의 참조 검사를 더했다**(`tests/unit/docs-wiki.test.js`, 4건).
  - 「pitfalls §N」 「known-issues §N」 참조가 지금 문서의 절로 풀린다.
  - 본문의 `docs/…` 경로가 실재한다. `liturgical-engine-*.md`나 `{1,2,3,4}` 같은 패턴은 맞는 파일이 하나라도 있으면 된다.
  - 마크다운 상대 링크가 실재하는 파일을 가리킨다.
  - `docs/index.md`가 인용한 파일과 ADR이 실재한다.
  - 범위는 git이 아는 텍스트 파일에서 머지된 원장, archive, data, 픽스처를 뺀 것이다. 일부러 지운 파일의 이력 언급(`docs/worklog.md`, `docs/prd.md`)은 테스트의 `RETIRED` 목록으로 허용한다.
- **docs-crossref가 「known-issues §7」을 설계서 §7로 잘못 풀던 것을 고쳤다.** `known-issues`를 외부 한정어로 본다.
- **깨진 경로 셋을 고쳤다.** 새 검사가 찾았다.
  - `js/types.d.ts` 주석이 archive로 옮긴 `app-modularization.md`를 옛 경로로 가리켰다.
  - ADR-011은 저장소에 들어온 적 없는 `2026-05-11-sync-perf.md`를 가리켰다. git 이력에도 없다.
  - ADR-017은 server 저장소의 `nginx/oauth-proxy.example.conf`를 앱 저장소 상대 경로로 링크했다.

## 확정 · 근거

- 계획(사용자 승인 2026-10-22)의 PR 2다. 줄 비교와 토큰 수 검사는 계획을 검토한 서브에이전트가 짚은 맹점에서 나왔다. 토큰이 「어딘가 하나 남아 있는지」만 보면, 셋으로 나눠 옮길 때 흔한 토큰이 빠져도 걸리지 않는다.
- 새 검사는 교회력 설계 문서 다섯의 참조를 다시 보지 않는다. 그 다섯은 docs-crossref가 맡는다.

## 검증

- 옵션 없는 동작이 그대로다. 옛 스크립트와 새 스크립트를 네 구간(`f358691~3→f358691`, `6a9a678→main`, `0c0a0a0→main`, `main→WORKTREE`)에서 돌려 출력과 종료 코드가 같음을 확인했다.
- 새 옵션을 시험했다.
  - PR #368 구간을 `--kinds general`로 비교하면 지운 문서의 토큰이 사라짐으로 나온다.
  - 바뀐 것이 없는 구간은 줄 비교와 `--strict-counts` 모두 0이다.
  - PR #368이 고친 pitfalls의 두 줄은 빠진 줄로 정확히 나오고, `--drop-file`에 한 줄을 적으면 하나만 남는다.
  - glob 오타는 멈춘다.
- 새 검사가 실제로 잡는지 확인했다. 없는 절 번호 둘, 없는 경로, 깨진 링크를 담은 임시 파일을 만들어 넷 모두 걸리는 것을 본 뒤 지웠다. 맞는 링크는 걸리지 않았다.
- `npm test` 1362개(통과 1361, 실데이터 1 skip), `npm run typecheck` 통과.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE`: 사라진 토큰 0, 새 토큰 0.

## 갱신한 문서

- `tests/README.md`: `docs-wiki.test.js` 행, 파일 수와 건수, 문서를 읽는 테스트 예외의 설명.
- `CLAUDE.md`: 유닛 건수, `docs_facts_snapshot.py`의 새 옵션.
- `README.md`: 스크립트 목록의 `docs_facts_snapshot.py` 설명.
- ADR-011, ADR-017: 깨진 경로가 있던 줄만 고쳤다. 옛 개정 블록의 정리는 known-issues §24다.
