---
date: 2026-10-23
branch: docs/prose-adr-batch13
title: "docs: ADR 036의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 열셋째 PR이다. ADR-036(교회력 데이터 모델)을 고쳤다. 이 ADR은 개정 블록 없이 결정과 「검토한 대안」으로 정리되어 있어, 낱말과 이음표만 고쳤다.

- 「기각」 30곳을 「채택 안 함」으로 바꿨다(`docs/writing.md` 「용어」).
- 굵은 글씨 제목 뒤의 줄표를 쌍점으로, 낱말 사이 가운뎃점을 쉼표로 바꿨다(pitfalls §37). 코드 이름, 「」 인용, 표, 제목 줄, 「채택 안 함 날짜 · 이유 · 재검토」 형식, 「미결 사항」 절은 그대로 두었다.
- 기간을 잇던 물결표를 「부터 … 까지」와 하이픈으로 바꿨다(pitfalls §32). 표 칸 하나에 물결표가 둘이던 두 칸(백색 기간, 공현과 모든성인의 이동 범위)은 마크다운이 그 사이를 취소선으로 읽을 수 있어 함께 고쳤다.

## 확정 · 근거

- 사실은 바꾸지 않았다.
- **「미결 사항」 절은 손대지 않았다.** `tests/unit/docs-crossref.test.js`가 그 항목마다 「 — 닫힘 · 」이나 「→ 설계서 미결n」을 찾는다. 기계 정리가 「닫힘 · 」의 가운뎃점을 쉼표로 바꿔 테스트가 실패해, 그 절을 main 그대로 되돌리고 정리 스크립트가 그 절을 건너뛰게 했다.

## 검증

- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE`에서 사라진 토큰과 새 토큰이 모두 0이다.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/036-*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`는 31개가 모두 통과했다.

## 갱신한 문서

- `docs/decisions/036-liturgical-calendar-data-model.md`: 낱말과 이음표 정리.
