---
date: 2026-10-23
branch: docs/prose-adr-batch10
title: "docs: ADR 040의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 열째 PR이다. ADR-040(북마크 가져오기의 항목 검사)을 고쳐 썼다. 이 ADR은 2026-10-18에 지금 규칙으로 쓰여 개정 블록이 없다. 그래서 문장과 낱말만 고쳤다.

- 「결정」의 긴 목록을 「올바른 항목」, 「빼는 단위」, 「크기 검사」, 「보이는 안내」, 「구현」의 소절로 나눴다.
- 가운뎃점과 줄표로 이은 명사를 쉼표와 조사로 풀었다(pitfalls §37).
- 「기각」을 「채택 안 함」으로, 「걷다」를 「떼다」와 「닫히다」로, 「판」을 「버전」으로, 「못박았다」를 「정해 두었다」로 바꿨다(`docs/writing.md` 「용어」).

## 확정 · 근거

- **사용자의 말을 요약했다.** 「검토한 대안」에 그대로 옮겨 있던 사용자의 말 둘(파일 전체 거절을 처음 고른 까닭, 옛 표기를 받기로 한 답)을 뜻으로 요약했다. 규칙 문서와 원장에는 사용자의 말을 그대로 옮기지 않는다(`docs/writing.md` pitfalls §37, 2026-10-23).
- 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/040-*.md' --kinds general --strict-counts`에서 줄어든 토큰은 0이고, 사라진 토큰은 위에서 요약한 인용 둘뿐이다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 「꼴」이 없고, 영어 단어를 술어로 쓴 곳이 없다.

## 갱신한 문서

- `docs/decisions/040-bookmark-import-items.md`: 문장 정리.
