---
pr: 373
date: 2026-10-23
branch: docs/prose-small-topics
title: "docs: 작은 주제 문서 넷의 문장 정리"
---

## 요약

주제 문서의 문장을 `docs/writing.md`의 규칙(pitfalls §37)에 맞게 고쳐 쓰는 시리즈의 첫 PR이다. 가장 짧은 네 문서를 골랐다. 검색(`search.md`), 오디오(`audio.md`), 설치와 접근성(`install-a11y.md`), 캐시와 릴리스(`cache-release.md`)다. #370과 #371에서 글자 그대로 옮긴 글이라 옛 문체가 남아 있었다.

- 옛 status 줄은 명사를 가운뎃점과 줄표로 이어 붙인 한 줄이었다. 이것을 완결된 문장으로 풀고, 긴 항목은 하위 목록으로 나눴다.
- 함정 절(pitfalls §7, §15)의 제목과 본문도 문장으로 고쳤다. 영어를 섞어 쓴 말(sidecar, evict, in-flight, reconcile 등)은 한국어로 옮겼다.
- 사용자 교정에 따라 함정 절의 사례와 규칙, 검색 옵션 줄, 캐시 무효화 설명을 개발을 모르는 독자도 읽을 수 있게 다시 썼다. 코드 이름 앞에 그 코드가 무엇을 하는지 먼저 적고, 결과는 사용자가 겪는 일로 적었다. 이 교정은 새 번호 pitfalls §40으로 `writing.md`에 적었다.
- 사실은 바꾸지 않았다. 낡은 문장 하나만 근거를 확인해 고쳤다(아래 「확정 · 근거」).

남은 주제 문서 여섯(sync, design-system, bible-text, routing, platform, liturgical)은 크기에 따라 하나나 둘씩 묶어 이어 간다.

## 확정 · 근거

- **사용자 교정(2026-10-23), pitfalls §40.** PR을 연 뒤 사용자가 오디오 문서를 읽고 두 가지를 짚었다.
  - 「LRU 상한이 사실상 듣지 않는다」에 「"듣지 않는다." 이해하기 어렵네. LRU 상한선이 무력화된다는 의미?」라고 했다. 「상한이 작동하지 않는다」로 고쳤다.
  - 사례 H1-H3에 「기술을 모르는 독자가 이해할 수 있게 무슨 용도인지 기술 바람」, 「네가 볼 문서지만, 나도 좀 이해할 수 있으면 좋겠다」라고 했다. 사례마다 그 코드가 무엇을 하는지와 사용자가 겪는 결과를 먼저 적고, 코드 이름은 괄호에 두었다. 같은 기준으로 캐시와 릴리스의 pitfalls §7, known-issues §6.1과 검색 옵션 줄도 고쳤다.
  - 캐시 무효화 설명의 「판 번호」를 사용자가 「버전」으로 고쳤다. `writing.md` 「용어」에 「듣지 않는다」와 함께 올렸다.
  - 매 세션 지킬 규칙이라 CLAUDE.md 「컨벤션」에도 한 줄을 더했다.
- **새로 적은 사실은 코드로 확인했다.** 오디오 상한은 360 MB(HARD_CAP)를 넘으면 300 MB(SOFT_CAP)로 줄인다(`js/audio-cache.js`, `sw.js` `_putAudioAndEnforceCap`). H1-H3의 수정은 모두 지금 `sw.js`에 있다. 크기를 직접 재는 대체 경로, 받고 있는 주소 목록 `_inflightAudioUrls`, `activate`의 `_reconcileAudioCache`다. 콘텐츠 매니페스트는 앱이 시작할 때 지난번 목록과 견줘 지문이 바뀐 항목만 지운다(`js/manifest-sync.js` 머리 주석). `privacy.html`은 `sw.js`의 `standalonePages` 예외로 따로 열린다.
- **캐시와 릴리스의 낡은 문장.** 「Phase 3 webhook 자동화 후속」은 Phase 3이 아직 남은 것처럼 읽혔다. ADR-021 상태 줄은 「Phase 1·2·3 구현 완료」이고, Phase 4(실배포 검증과 DevTools 캐시 동작 확인)는 「대기」다. 그래서 「Phase 3까지 끝났고, 남은 것은 Phase 4(dev 배포 뒤 DevTools로 캐시 동작 확인)」로 고쳤다.
- **대장의 옛 제목은 그대로 둔다.** `coding-pitfalls.md`의 §7과 §15 대장 줄은 옮기기 전의 절 제목을 유지한다(#371에서 정한 대장 형식). 옛 참조는 번호로 풀리고, 옛 제목을 기억하는 사람도 grep으로 찾을 수 있다. 주제 문서 쪽 제목만 고쳤다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/topics/*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다.
- 같은 비교를 `docs/*.md`와 CLAUDE.md까지 넓혀도 사라진 토큰과 줄어든 토큰이 0이다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다. pitfalls §40의 대장과 정의가 짝을 이룬다.
- 네 문서에 「꼴」과 물결표가 없다.

## 갱신한 문서

- `docs/topics/search.md`, `audio.md`, `install-a11y.md`, `cache-release.md`: 문장 정리, 개발을 모르는 독자를 위한 설명.
- `docs/writing.md`: pitfalls §40, 「용어」 두 줄(듣지 않는다, 판 번호).
- `docs/coding-pitfalls.md`: §40 대장 줄, 다음 번호를 §41로.
- `CLAUDE.md` 「컨벤션」: pitfalls §40 요약 한 줄.
