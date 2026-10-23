---
date: 2026-10-23
branch: docs/prose-adr-batch15
title: "docs: ADR 038의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 열다섯째이자 ADR의 마지막 PR이다. ADR-038(캘린더와 전례독서 화면)을 고쳤다. 이 ADR은 개정 블록이 없어 낱말과 이음표만 고쳤다. ADR-036(#394), ADR-037(#395)과 같은 방식이다.

- 「기각」과 「기각(잠정)」을 「채택 안 함」과 「채택 안 함(잠정)」으로, 「기각한 안」을 「채택하지 않은 안」으로 바꿨다.
- 굵은 글씨 제목 뒤의 줄표를 쌍점으로, 낱말 사이 가운뎃점을 쉼표로 바꿨다. 코드 이름, 「」 인용, 표, 제목 줄, 「채택 안 함 날짜 · 이유 · 재검토」 형식, 「미결 사항」 절은 그대로 두었다.
- 물결표를 「부터 … 까지」와 하이픈으로 바꿨다(「2026-10-12 ~ 10-15」, 「2024 ~ 2026 책자」 등).
- 영어 술어 「승격 export해」를 「올려 내보내고(export)」로 바꿨다.

ADR이 모두 끝나 known-issues §24 항목(`docs/topics/platform.md`)에 진행 상황을 적었다. 남은 것은 교회력 설계서 둘이고, 시작하기 전에 계획을 사용자에게 먼저 보인다.

## 확정 · 근거

- 사실은 바꾸지 않았다.

## 검증

- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE`에서 사라진 토큰과 새 토큰이 모두 0이다.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/038-*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`는 31개가 모두 통과했다.

## 갱신한 문서

- `docs/decisions/038-calendar-lectionary-ui.md`: 낱말과 이음표 정리.
- `docs/topics/platform.md` known-issues §24: ADR 정리를 마쳤다는 진행 기록.
