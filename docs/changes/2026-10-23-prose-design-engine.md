---
date: 2026-10-23
branch: docs/prose-design-engine
title: "docs: 교회력 설계서의 낱말과 이음표 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)에서 설계서 단계의 첫 PR이다. 교회력 설계서 `docs/design/liturgical-engine.md`(1,118줄)의 낱말과 이음표를 가볍게 정리했다. ADR 036-038과 같은 방식이다. 사용자가 설계서 둘은 이 가벼운 정리를 먼저 하고(2026-10-23), 그다음 절마다 문장을 고쳐 쓰면서 내용 오류도 검증하기로 정했다. 그 순서를 known-issues §24(`docs/topics/platform.md`)에 적었다.

- 「기각」을 「채택 안 함」으로 바꿨다.
- 굵은 글씨 제목 뒤의 줄표를 쌍점으로, 낱말 사이 가운뎃점을 쉼표로 바꿨다(pitfalls §37).
- 물결표 구간을 하이픈과 「부터 … 까지」로 바꿨다(pitfalls §32). 성주간과 보호 기간, 성탄 8일의 날짜 범위, 후보 출처 번호(①-④, ①-⑤) 등이다.

건드리지 않은 것:
- 코드 이름, 「」 인용, 큰따옴표 인용, 표, 제목 줄, 코드 블록.
- §9 「미결」 절. `tests/unit/docs-crossref.test.js`가 그 항목의 형식을 읽는다.
- 테스트가 정확히 한 번 있는지 세는 표지 문자열 둘(「lectionarypage.net 2025~2027」, 「규칙일 유지 · 고정일 이동」). 처음 정리 때 이 둘을 바꿔 테스트가 실패해, 원래대로 되돌리고 정리 스크립트가 건드리지 않게 했다.
- 코드 이름 사이에 놓인 물결표(예: 「`x`~`y`」)와 §9 안의 물결표. 다음 단계에서 문장을 고쳐 쓸 때 함께 본다.

## 확정 · 근거

- 사실은 바꾸지 않았다. 내용 검증은 다음 단계에서 한다.

## 검증

- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE`에서 사라진 토큰과 새 토큰이 모두 0이다.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/design/liturgical-engine.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`는 31개가 모두 통과했다.

## 갱신한 문서

- `docs/design/liturgical-engine.md`: 낱말과 이음표 정리.
- `docs/topics/platform.md` known-issues §24: 설계서 둘의 순서(가벼운 정리, 그다음 절마다 고쳐 쓰며 내용 검증).
