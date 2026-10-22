---
date: 2026-10-23
branch: docs/term-transcription
title: "docs: 「전사」를 쉬운 말로 바꿈"
---

## 요약

저장소에 쓰인 「전사(轉寫)」를 사용자가 정한 쉬운 말로 바꿨다. 「전사」는 잘 쓰이지 않는 낱말이라 읽기 어려웠다. 쓰인 뜻은 셋이었고, 뜻마다 다른 말로 바꿨다.

| 뜻 | 바꾼 말 | 곳 |
| --- | --- | --- |
| 기도서 원문을 옮겨 적은 문서(`docs/reference/liturgical-calendar-rules.md`)의 이름 | 기도서 원문 | 약 40곳 |
| 옮겨 적다가 생긴 잘못 | 옮겨 적기 오류 | 약 10곳 |
| 옮겨 적는 일 | 옮겨 적기, 옮겨 적은 문서 | 몇 곳 |

- **대상**: 교회력 설계서와 검토 문서, ADR-036과 037, 교회력 주제 문서, 엔진 코드 주석 둘, 테스트 픽스처의 `source` 둘, 테스트 주석, 문서 검사 스크립트, `README.md`, `docs/index.md`. 15개 파일이다.
- **문서 검사 테스트.** `tests/unit/docs-crossref.test.js`는 절 번호 바로 앞의 「전사」를 기도서 원문을 가리키는 말로 알아보고, 그 절 번호를 설계서의 절로 풀지 않았다. 이제 「기도서 원문 §N」의 「원문」을 알아본다.
- **행 번호의 뜻.** 교회력 문서는 「기도서 원문 139행」처럼 행 번호를 적는다. 이 번호는 인쇄본이 아니라 `reference/liturgical-calendar-rules.md` 파일의 줄 번호다. 이 점을 `index.md`와 설계서 머리에 한 번씩 적었다.
- **고치지 않은 곳.** 머지된 원장 둘은 고칠 수 없다. 보관 문서 `docs/archive/design/liturgical-engine-booklet-comparison-2026-09.md`의 두 줄은 이 시리즈의 원칙대로 보관 문서라 두었다. `writing.md` 「용어」 표에는 쓰지 않는 말로 남아 있다.

## 확정 · 근거

- **사용자 결정(2026-10-23).** 사용자가 「전사(轉寫), 또는 전사로 서술된 부분을 찾아봐. 이 단어가 잘 쓰이는 단어가 아니라서 이해하기 어렵네」라고 했다. Claude가 뜻을 셋으로 나눠 보이고 바꿀 말을 물었고, 사용자는 「기도서 원문」, 「옮겨 적기 오류」, 따로 PR로 고치기를 골랐다. 결정은 #374에서 `writing.md` 「용어」에 올렸다.
- **바꾼 인용 하나.** ADR-037의 「스크랩에 전사 오류가 있다」는 누구의 말을 옮긴 인용이 아니라, 문서가 `corrections`가 있는 이유를 「」로 묶어 적은 것이다. 그래서 「스크랩에 옮겨 적기 오류가 있다」로 바꿨다. 사실 토큰 비교에서 사라진 인용 하나로 나오는 것은 이 때문이다.
- **같은 줄에서 함께 고친 것.** `index.md`의 「알고리즘 분쟁의 최종 심급」은 법률 용어를 빌린 비유라 「알고리즘을 두고 판단이 갈릴 때 마지막 기준」으로 고쳤다(`writing.md` 「용어」의 다른 분야 한자어 규칙). 픽스처 README의 「§5.11~5.13」은 하이픈으로 바꿨다(pitfalls §32).

## 검증

- `node --test tests/unit/*.test.js` 1365개 가운데 1364개 통과, 실데이터 1개 skip. `npm run typecheck` 통과.
- 교회력 사실 토큰 비교(`docs_facts_snapshot.py --diff main WORKTREE`, 기본): 사라진 토큰 0, 새 토큰 0.
- 일반 사실 토큰 비교(`--docs 'docs/**/*.md' --docs 'docs/*.md' --docs README.md --kinds general --strict-counts`): 사라진 토큰은 위 ADR-037 인용 하나뿐이고, 줄어든 토큰은 0이다.
- `git grep 전사`로 보면 남은 것은 위 「고치지 않은 곳」뿐이다.

## 갱신한 문서

- `docs/design/liturgical-engine.md`, `docs/design/liturgical-engine-review.md`: 「기도서 원문」, 「옮겨 적기 오류」. 설계서 머리에 행 번호의 뜻.
- `docs/decisions/036-liturgical-calendar-data-model.md`, `docs/decisions/037-eucharist-lectionary-data-and-engine.md`: 같은 바꾸기.
- `docs/topics/liturgical.md`: 같은 바꾸기.
- `docs/index.md`, `README.md`: `reference/`의 설명.
- `tests/README.md`, `tests/fixtures/liturgical/README.md`: 「옮겨 적기 오류」.
