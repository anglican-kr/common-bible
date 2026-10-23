---
pr: 395
date: 2026-10-23
branch: docs/prose-adr-batch14
title: "docs: ADR 037의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 열넷째 PR이다. ADR-037(감사성찬례 전례독서 데이터와 엔진)을 고쳤다. 이 ADR은 개정 블록이 없어 낱말과 이음표만 고쳤다. ADR-036(#394)과 같은 방식이다.

- 「기각」 9곳을 「채택 안 함」으로 바꿨다.
- 굵은 글씨 제목 뒤의 줄표를 쌍점으로, 낱말 사이 가운뎃점을 쉼표로 바꿨다. 코드 이름, 「」 인용, 표, 제목 줄, 「채택 안 함 날짜 · 이유 · 재검토」 형식, 「미결 사항」 절의 「— 닫힘 · 」 형식은 그대로 두었다.
- 물결표를 하이픈으로 바꿨다(「A2~A4」, 「1900~2100년」, 표의 「1~9주」·「6~34주」).

## 확정 · 근거

- 사실은 바꾸지 않았다.

## 검증

- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE`에서 사라진 토큰과 새 토큰이 모두 0이다.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/037-*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`는 31개가 모두 통과했다.

## 갱신한 문서

- `docs/decisions/037-eucharist-lectionary-data-and-engine.md`: 낱말과 이음표 정리.
