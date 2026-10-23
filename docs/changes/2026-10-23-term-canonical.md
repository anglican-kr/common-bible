---
date: 2026-10-23
branch: docs/term-canonical
title: "docs: 「정본」을 쉬운 말로 바꿈"
---

## 요약

「전사」(#375)에 이어 「정본(正本)」을 사용자가 정한 말로 바꿨다. 교회력 문서를 중심으로 약 290곳이다.

| 쓰임 | 바꾼 말 | 곳 |
| --- | --- | --- |
| 규칙이 적힌 곳을 가리키는 칸 | 「기준:」 | 186곳 |
| 사실을 적는 단 한 곳이라는 서술(「이 파일이 정본이다」, 「§1.4 정본 지도」) | 기준(「이 파일이 기준이다」, 「§1.4 기준 지도」) | 약 90곳 |
| `R-6.4-ember-color` 같은 표지 | 규칙 마커 | 12곳 |

- **대상**: 교회력 설계서와 검토 문서, ADR-036 · 037 · 038, 교회력 주제 문서, 픽스처 셋과 그 README, 테스트 다섯과 `docs-anchors.js`, 엔진 주석 하나, 문서 검사 스크립트, `engine-data.yml` 주석, `architecture.md`, `README.md`, `index.md`, `known-issues.md`. 25개 파일이다.
- **문서 검사 테스트.** 설계서 §9의 열린 질문은 「정본:」 칸을 갖춰야 했고, `tests/unit/docs-crossref.test.js`가 이를 확인했다. 칸 이름이 「기준:」으로 바뀌어 테스트도 함께 고쳤다. 「규칙 마커 R-는 문서 전체에서 정확히 1회 정의된다」처럼 테스트 이름도 바뀌었다.
- **다듬은 곳.** 기계적으로 바꾸면 어색해지는 두 곳은 손으로 고쳤다. 「규칙 하나의 기준 문장」은 「규칙 하나를 정한 문장」으로, 테스트 주석의 「기준이 기준답게」는 「픽스처 자체가 제대로」로 썼다.
- **고치지 않은 곳.** ADR-037의 「개정본」 둘은 다른 낱말이다. 머지된 원장과 보관 문서(`docs/archive/`)는 #375와 같은 원칙으로 두었다.

## 확정 · 근거

- **사용자 결정(2026-10-23).** 사용자가 「"정본"은 무슨 뜻?」이라고 묻고, 뜻을 들은 뒤 「이 단어도 수정하는 게 좋겠다」라고 했다. Claude가 쓰임을 셋으로 나눠 보이고 바꿀 말을 물었고, 사용자는 「기준」, 「규칙 마커」, #375 머지 뒤 따로 PR로 고치기를 골랐다.
- **학술 한자어를 쓰지 않는다.** 작업 중에 사용자가 「네가 학습한 한국어 자료가 어느 시대의 것인지 참 궁금하다... 정본... 전사...」라고 했다. 「정본」, 「전사」, 「저본」은 성서학과 문헌학에서 쓰는 학술 용어다. 성서와 기도서를 다루는 문서라 그 문체로 기울기 쉬우므로, 낱말 하나씩이 아니라 경향을 `writing.md` 「용어」에 규칙으로 적었다.
- **바뀐 인용과 칸 목록.** ADR-037의 「무엇이 일회성 원료(archive 행)이고 무엇이 영구 정본(잔존)인가」는 누구의 말이 아니라 문서가 질문을 「」로 묶은 것이라 「영구 기준」으로 바꿨다. 설계서 §1.4와 §9의 칸 이름 목록(인라인 코드)도 「기준」으로 바뀌었다.

## 검증

- `node --test tests/unit/*.test.js` 1365개 가운데 1364개 통과, 실데이터 1개 skip. `npm run typecheck` 통과.
- 교회력 사실 토큰 비교(`docs_facts_snapshot.py --diff main WORKTREE`, 기본): 사라진 토큰 0, 새 토큰 0.
- 일반 사실 토큰 비교(`--docs 'docs/**/*.md' --docs 'docs/*.md' --docs README.md --kinds general --strict-counts`)에서 바뀐 것은 셋이다. 위의 ADR-037 인용과 설계서의 칸 이름 목록 둘이다. 줄어든 토큰 하나(§9.2 칸 목록)는 손대지 않은 보관 문서에 옛 표기가 남아 있어서다.
- `git grep 정본`으로 보면 남은 것은 「개정본」, 보관 문서, `writing.md` 「용어」 표뿐이다.

## 갱신한 문서

- `docs/design/liturgical-engine.md`, `docs/design/liturgical-engine-review.md`: 「기준」, 「규칙 마커」.
- `docs/decisions/036-liturgical-calendar-data-model.md`, `037-eucharist-lectionary-data-and-engine.md`, `038-calendar-lectionary-ui.md`: 같은 바꾸기.
- `docs/topics/liturgical.md`, `docs/architecture.md`, `docs/index.md`, `docs/known-issues.md`, `README.md`: 같은 바꾸기.
- `tests/README.md`, `tests/fixtures/liturgical/README.md`: 같은 바꾸기.
- `docs/writing.md` 「용어」: 「정본」 줄과 학술 한자어 규칙.
