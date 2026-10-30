---
date: 2026-10-29
branch: docs/pitfall-heading-words
title: "docs: 함정 제목의 영어 낱말과 동기 전이 정리"
---

## 요약

#450의 「결정 대기」에 남은 둘을 사용자가 권장안대로 정했다(2026-10-29).

- **함정 대장의 제목**: 주제 문서로 옮긴 절은 `coding-pitfalls.md`의 대장 제목을 주제 문서의 「### pitfalls §N — 」 제목과 같게 썼다. 주제 문서의 제목은 #444에서 고쳐 쓰고 머지한 것이라, 대장 제목에 남은 영어 낱말(bump, leak, transport, sidecar, init, facade, race)과 비유 동사(「풀린다」, 「길」)가 함께 없어졌다.
  - 주제 문서의 제목에도 남은 세 말은 두 곳을 함께 고쳤다. §7의 「셸 bump」와 「두 길」, §23의 「닿는 곳」, §38의 「옛 판」(「용어」 표는 「옛 버전」)이다. §7은 `cache-release.md`의 본문이 이미 「버전을 올리면(셸 bump)」으로 풀어 쓰고 있어 「셸 버전 올리기」로 썼다.
  - 이 문서에 본문이 있는 세 절(§5, §10, §35)은 권장안의 말로 썼다. §5 본문의 「보일러플레이트」는 「한 번 익히면 반복 적용해야 하는」이라는 풀이가 붙어 있어 두었다.
  - `architecture.md` 4.3의 「Drive appdata」는 본문과 같게 「Drive 앱 전용 폴더」로 썼다.
  - 바꾸기 전 제목을 가리키는 곳은 ADR-011 721-723행의 목록 하나였다. 그때 새로 만든 함정 절의 이름을 옮겨 적은 것이라 지금 제목으로 맞췄다. #451도 ADR-011을 고쳤지만 바꾼 줄이 겹치지 않아, 머지된 main 위로 충돌 없이 옮겼다(#452의 「제목 줄」 절차).
- **동기 dispatch**: `coding-pitfalls.md` 196행을 「동기 전이」로 썼다. 같은 절의 181, 183행이 「동기적으로 … 전이한다」를 쓴다. ADR-011 579행의 같은 말은 그 파일의 교정 차례에 고치도록 `writing.md` 「용어」 표에 한 줄을 더했다. 부록 A의 ADR 요약에서 코드 개념의 이름으로 쓴 dispatch는 #450에서 두기로 정했으므로, 표에 그 예외를 함께 적었다.

## 검증

2026-10-31에 main(#451과 #453이 머지된 `1a60e76`) 위로 옮긴 뒤 다시 돌렸다. 문서별 비교만 2026-10-29의 결과다.

- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`: 31개 가운데 30개 통과, 실패 0, 건너뜀 1(데이터 서브모듈이 없어 `facts` 블록 검사).
- `python3 scripts/docs_facts_snapshot.py --diff origin/main WORKTREE --strict-counts`: 사라진 토큰 0, 줄어든 토큰 0, 새 토큰 0. 고친 일곱 문서를 `--kinds general --strict-counts --docs`로 하나씩 비교해도 사라진 토큰과 줄어든 토큰이 0이었다(2026-10-29).
- `python3 tools/prose/prose.py lint --changed origin/main`(CI와 같은 검사): 종료 코드 0.
- 바꾸기 전 제목의 문구로 저장소를 `git grep`해 남은 인용이 없는지 확인했다. 머지된 원장과 `docs/archive/`는 고치지 않는다.

## 갱신한 문서

- `docs/coding-pitfalls.md`: 대장 제목과 196행
- 주제 문서 `docs/topics/cache-release.md`, `liturgical.md`, `bookmark.md`: 함정 제목
- `docs/writing.md` 「용어」: 동기 dispatch
- `docs/architecture.md` 4.3 제목, ADR-011의 함정 제목 목록
