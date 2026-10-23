---
date: 2026-10-23
branch: docs/prose-platform
title: "docs: 플랫폼 문서의 문장 정리"
---

## 요약

주제 문서 문장 정리의 넷째 PR이다. 플랫폼(`platform.md`)을 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37(완결된 문장, 간결, 그 분야의 용어)과 pitfalls §40(개발을 모르는 독자도 읽을 수 있게)이다.

- **「지금 동작」.** 2차 모듈 분할 항목은 한 줄이 약 4,000자였다. PR별 하위 목록으로 나누고, facade와 registry 역전처럼 처음 나오는 말에는 무엇인지 한 번 덧붙였다. 나머지 항목도 하위 목록과 완결된 문장으로 풀었다.
- **함정.** pitfalls §16(모듈을 싣는 순서 때문에 `window.X`가 아직 없다)과 §27(일부 파일의 타입 검사가 조용히 꺼져 있었다)은 그 코드가 무엇을 하는지부터 설명했다. §39는 문장만 다듬었다.
- **남은 일.** known-issues §2.1(PR5c)은 `registerView`가 무엇인지부터 적고, 낯선 말(투기성 PR, premature, 트리거)을 풀었다. §7.1, §12.1, §12.4, §12.5, §13.5도 같은 기준으로 고쳤다.

남은 주제 문서는 교회력(`liturgical.md`) 하나다.

## 확정 · 근거

- **낡은 곳 셋을 고쳤다.**
  - 「ADR-013 유닛 537 케이스」: 지금은 1365개다. 자주 바뀌는 숫자라 빼고 `tests/README.md`를 가리켰다(#372에서 CLAUDE.md의 테스트 건수를 뺀 것과 같은 이유).
  - 2차 모듈 분할의 「상세 `docs/known-issues.md`」: PR5c의 검토 내용은 #371에서 이 문서의 known-issues §2.1로 옮겼다. 그래서 「아래 「남은 일」의 known-issues §2.1」로 바꿨다.
  - known-issues §12.1의 「옛 개정 블록을 본문에 녹여야」: 「녹이다」는 사용자가 비유라고 교정한 말이다(pitfalls §37). 「옛 개정 블록의 내용을 본문에 반영하고 블록을 삭제해야」로 고쳤다.
- **맞춘 말 둘.** 「창 객체」는 사용자가 정한 「네임스페이스 객체」로(`writing.md` 「용어」), 「평행 본문」은 다른 문서와 ADR-027이 쓰는 「병행 본문」으로 맞췄다.
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/topics/*.md' --kinds general --strict-counts`에서 사라진 토큰은 셋이고, 줄어든 토큰은 0이다.
  - `docs/known-issues.md`(코드와 경로) 둘은 위의 고친 가리킴이다.
  - 나머지 하나는 비교 도구가 겹 역따옴표로 감싼 코드(`` `/${effectiveDivision(book)}` ``)를 잘못 끊어 읽은 것이다. 그 코드와 문장은 그대로 있다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 문서에 「꼴」과 물결표가 없다.

## 갱신한 문서

- `docs/topics/platform.md`: 문장 정리와 낡은 곳 셋.
