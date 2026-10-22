---
pr: 374
date: 2026-10-23
branch: docs/prose-design-bible
title: "docs: 디자인 시스템과 본문 데이터 문서의 문장 정리"
---

## 요약

주제 문서 문장 정리의 둘째 PR이다. 디자인 시스템(`design-system.md`)과 본문 데이터(`bible-text.md`)를 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37(완결된 문장, 간결, 그 분야의 용어)과 pitfalls §40(개발을 모르는 독자도 읽을 수 있게)이다.

- **디자인 시스템.** 「지금 동작」의 두 항목을 하위 목록으로 나눴다. 토큰 사다리, elevation, frosted glass, IntersectionObserver처럼 처음 나오는 용어에는 무엇인지 한 번 덧붙였다. pitfalls §8(글꼴 불러오기)과 §14(`display`가 `[hidden]`을 덮어씀)의 사례와 규칙은 코드 이름 앞에 그 코드가 무엇을 하는지, 사용자에게 어떻게 보였는지를 먼저 적었다.
- **본문 데이터.** 「지금 동작」의 두 항목을 하위 목록으로 나눴다. known-issues §3.1은 남은 일(여섯 편의 인쇄본 대조)을 맨 앞에 두었다. 해소된 §3.2는 원래 문제, 고친 방법, 확인, 교훈으로 나눴다. §11.1, §11.2, §12.2의 긴 한 줄은 하위 목록으로 나눴다. 숫자 구간의 물결표는 하이픈으로 바꿨다(pitfalls §32).
- **변환 규칙을 §3.3으로 옮겼다.** `known-issues.md` §3 머리에 곱슬 따옴표 변환 규칙이 남아 있었다. §3.3은 「위 규칙으로 97.6% 가 고확신 판정」이라며 그 규칙을 가리키는데, #371이 §3.1-3.3만 주제 문서로 옮겨서 주제 문서만 읽으면 규칙을 찾을 수 없었다. 규칙 두 문단을 §3.3의 「적용한 규칙」으로 옮기고, 대장에는 옮겼다는 한 줄을 남겼다.

남은 주제 문서는 넷이다(sync, routing, platform, liturgical).

## 확정 · 근거

- 새로 덧붙인 설명은 ADR과 코드로 확인했다.
  - frosted glass를 쓰는 곳: ADR-025의 2026-06-21 개정과 `DESIGN.md`가 아래쪽에 떠 있는 막대(floating chrome)와 검색 스크림을 적는다. 헤더에는 쓰지 않는다.
  - 글자 크기를 rem으로 잡은 이유: ADR-028 §1이 「설정의 글자 크기가 루트 폰트를 바꾸면 타이포가 함께 스케일해야」라고 적는다.
  - 테마색은 설정에서 고른다(`js/app/settings-ui.js` `saveColorScheme`).
  - ADR-022 Phase 3은 신약 전체 본문에 `<cite>`와 주석을 손으로 다는 콘텐츠 작업이다(ADR-022 머리의 「현재 상태」).
  - GITHUB_TOKEN으로 push한 커밋은 다른 워크플로를 돌리지 않는다. 원문 「GITHUB_TOKEN push — 실행 0건」을 풀어 쓴 것이다.
- 사실은 바꾸지 않았다. §3.2의 「유닛 798 · e2e 215」처럼 그때의 기록은 그대로 두었다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/topics/*.md' --docs 'docs/*.md' --docs CLAUDE.md --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다. 변환 규칙을 `known-issues.md`에서 주제 문서로 옮겼으므로 두 곳을 함께 비교했다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 두 문서에 「꼴」과 물결표가 없다.

## 갱신한 문서

- `docs/topics/design-system.md`, `docs/topics/bible-text.md`: 문장 정리.
- `docs/known-issues.md` §3: 변환 규칙을 주제 문서로 옮기고 한 줄을 남겼다.
