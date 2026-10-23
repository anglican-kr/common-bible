---
pr: 398
date: 2026-10-23
branch: docs/prose-design-review
title: "docs: 교회력 검토 문서의 낱말과 이음표 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)에서 설계서 단계의 둘째 PR이다. 교회력 검토 문서 `docs/design/liturgical-engine-review.md`의 낱말과 이음표를 가볍게 정리했다. 설계서(#397)와 같은 방식이다.

- 「기각」을 「채택 안 함」으로, 「다른 기각 갈래」를 「채택하지 않은 다른 갈래」로 바꿨다.
- 굵은 글씨 제목 뒤의 줄표를 쌍점으로, 낱말 사이 가운뎃점을 쉼표로 바꿨다(pitfalls §37).
- 물결표 구간을 하이픈과 「부터 … 까지」로 바꿨다(pitfalls §32). 책자의 날짜 범위, 성주간의 요일 범위, 보호 기간 등이다.
- **표 칸의 물결표가 취소선으로 보이던 곳을 고쳤다.** 표 칸 하나에 숫자 사이 물결표가 둘 이상 있으면 GitHub가 그 사이를 취소선으로 그린다. GitHub 마크다운 변환(`gh api markdown`)으로 확인하니 검토 문서에 넷, 설계서 `docs/design/liturgical-engine.md`에 넷이 있었다. 두 문서의 표에서 숫자 사이 물결표를 모두 하이픈으로 바꿨고, 다시 변환해 취소선이 없음을 확인했다.

건드리지 않은 것:
- 코드 이름, 「」 인용, 큰따옴표 인용, 제목 줄, 코드 블록.
- §6 「미결」 표와 질문지 절. `tests/unit/docs-crossref.test.js`가 그 형식을 읽는다.
- 코드 이름 사이에 놓인 물결표(「`01-07`~`01-13`」, 「`Q1`~`Q14`」)와 제목 줄의 물결표(「5.14 불변식 1900~2100」). 다음 단계에서 문장을 고쳐 쓸 때 함께 본다.

## 확정 · 근거

- 사실은 바꾸지 않았다. 내용 검증은 다음 단계에서 한다.
- **「I-1~I-8」은 「불변식(I-1-I-8)」으로 적었다.** 「I-1부터 I-8까지」로 쓰면 사실 토큰 비교가 한글이 바로 붙은 검사 번호를 읽지 못해 I-1과 I-8의 수가 줄었다.

## 검증

- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --strict-counts`에서 사라진 토큰, 줄어든 토큰, 새 토큰이 모두 0이다.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/design/liturgical-engine*.md' --kinds general --strict-counts`에서 줄어든 토큰은 0이고, 사라진 토큰 둘은 일부러 바꾼 인용이다. 검토 문서가 버린 판정을 「기각」으로 적는다고 설명하던 인용(「기각」, 「기각 — 날짜 · 이유 · 재검토 조건」)을 「채택 안 함」으로 바꿨다.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`는 31개가 모두 통과했다.

## 갱신한 문서

- `docs/design/liturgical-engine-review.md`: 낱말과 이음표 정리.
- `docs/design/liturgical-engine.md`: 표 칸의 숫자 구간 물결표를 하이픈으로 바꿈.
