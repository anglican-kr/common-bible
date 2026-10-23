---
pr: 377
date: 2026-10-23
branch: docs/prose-sync-routing
title: "docs: 동기화와 라우팅 문서의 문장 정리"
---

## 요약

주제 문서 문장 정리의 셋째 PR이다. 동기화(`sync.md`)와 라우팅(`routing.md`)을 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37(완결된 문장, 간결, 그 분야의 용어)과 pitfalls §40(개발을 모르는 독자도 읽을 수 있게)이다.

- **동기화.** 「지금 동작」을 하위 목록으로 나눴다. pitfalls §12와 §13은 영어 낱말(leak, strip, flow, canonical, in-flight)이 섞인 문장을 풀었다. 로그인을 마치면 인증 정보가 주소 어디에 붙어 오는지부터 설명했다. pitfalls §28의 사례 여섯은 각 함수가 무엇을 하는지와 사용자에게 어떤 일이 생겼는지를 먼저 적었다. known-issues §15.2는 「기본 속성 이름의 id」가 무엇인지(`toString` 같은 이름) 풀어 썼다.
- **라우팅.** 「지금 동작」의 여섯 항목이 각각 한 줄에 가운뎃점과 줄표로 이어져 있었다. 하위 목록과 완결된 문장으로 풀었다. pitfalls §2, §33, §34와 known-issues §10.1, §10.2, §13.1도 같은 기준으로 고쳤다.
- **함께 고친 것.** 「판」은 「버전」으로(`writing.md` 「용어」), 물결표 구간은 하이픈으로(pitfalls §32) 바꿨다.

남은 주제 문서는 둘이다(platform, liturgical).

## 확정 · 근거

- 새로 덧붙인 설명은 근거를 확인했다.
  - known-issues §13.1의 「같은 PR에서 범위를 좁혀 두었다」는 #355로 적었다. `git log -S '전체 화면 실패' -- DESIGN.md`가 그 PR(`8b94742`)만 낸다.
  - known-issues §15.2의 「이 PR의 가져오기 검사」는 #359로 적었다. known-issues §15가 #359 리뷰에서 넘긴 후속이다.
  - 모핑 탭 바가 스크롤하면 줄어든다는 설명은 ADR-030의 결정 2(「본문을 읽어 내려갈 때 탭 바가 홈 원형으로 접히고, 오디오 재생 중이면 오디오 플레이어가 홈·검색 사이로 축소·이동」)를 따랐다.
  - Google OAuth 검수 뒤 refresh token의 유효 기간이 영구가 됐다는 것은 원문 「refresh token TTL 영구」를 풀어 쓴 것이다.
- 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/topics/*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 두 문서에 「꼴」과 물결표가 없다.

## 갱신한 문서

- `docs/topics/sync.md`, `docs/topics/routing.md`: 문장 정리.
