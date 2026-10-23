---
date: 2026-10-23
branch: docs/prose-adr-batch12
title: "docs: ADR 011의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 열두째 PR이다. ADR-011(북마크 기기 사이 동기화, 924줄)을 고쳤다. 이 ADR은 Phase 2a부터 2j까지의 기록이 차례로 쌓인 문서라, 구조는 두고 다음을 바꿨다.

- **머리의 「개정:」 줄 14개를 「진행」 목록으로 옮겼다.** 날짜와 내용은 그대로이고, 2026-08-01과 2026-10-22의 두 절도 목록에 더했다.
- **「결정」 절을 지금 동작에 맞췄다.** 처음 결정은 플랫폼별 로그인 UX(Android GIS 무음, iOS FedCM, One Tap)와 메모리 토큰이었는데, Phase 2h(2026-05-08)에서 PKCE 리디렉션과 IndexedDB에 암호화한 refresh token, nginx BFF로 바뀌었다. 지금 결론을 「결정」에 적고, 바뀌기 전의 선택은 「검토한 대안」의 해당 표 아래에 「채택 안 함 날짜 · 이유」나 설명으로 덧붙였다.
- **Phase마다 있던 개정 블록(`> **개정 (날짜):**`)을 그 Phase 절의 첫 문단으로 풀었다.** 각 절이 곧 그 Phase의 기록이므로, 날짜를 앞에 둔 보통 문단으로 둔다.
- 낱말과 이음표: 「기각」을 「채택 안 함」으로, 「옛 판」을 「옛 버전」으로 바꿨다. 굵은 글씨 제목 뒤의 줄표를 쌍점으로, 낱말 사이 가운뎃점을 쉼표로 바꿨다(코드, 인용, 표는 그대로). 숫자 구간과 근삿값의 물결표를 하이픈과 「약」으로 바꿨다. 영어 술어(surface하면, write하는)를 한국어로 바꿨다.

## 확정 · 근거

- **비어 있던 PR 번호를 채웠다.** Phase 2h 「단계 3 결과 (PR #__)」와 「단계 5 결과 (PR #__)」는 커밋 `7c22ab8`과 `180cc11`의 PR을 GitHub에서 찾아 #54와 #58로 적었다.
- **자기 줄 번호 참조를 고쳤다.** Phase 2h 머리의 「본 ADR 상단 line 51 "OAuth Flow" 결정표」를 「이 ADR 「검토한 대안」의 "OAuth Flow" 결정표」로 바꿨다.
- 그 밖의 사실은 바꾸지 않았다. Phase 2b-2g 절의 GIS, FedCM, One Tap 설명은 그때의 기록으로 남는다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/011-*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다(날짜를 한 줄로 합쳤던 진행 목록은 날짜마다 다시 나눴다).
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.

## 갱신한 문서

- `docs/decisions/011-bookmark-sync.md`: 진행 목록, 결정 갱신, 개정 블록 풀기, 낱말과 이음표 정리.
