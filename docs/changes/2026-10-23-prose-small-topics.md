---
date: 2026-10-23
branch: docs/prose-small-topics
title: "docs: 작은 주제 문서 넷의 문장 정리"
---

## 요약

주제 문서의 문장을 `docs/writing.md`의 규칙(pitfalls §37)에 맞게 고쳐 쓰는 시리즈의 첫 PR이다. 가장 짧은 네 문서를 골랐다. 검색(`search.md`), 오디오(`audio.md`), 설치와 접근성(`install-a11y.md`), 캐시와 릴리스(`cache-release.md`)다. #370과 #371에서 글자 그대로 옮긴 글이라 옛 문체가 남아 있었다.

- 옛 status 줄은 명사를 가운뎃점과 줄표로 이어 붙인 한 줄이었다. 이것을 완결된 문장으로 풀고, 긴 항목은 하위 목록으로 나눴다.
- 함정 절(pitfalls §7, §15)의 제목과 본문도 문장으로 고쳤다. 영어를 섞어 쓴 말(sidecar, evict, in-flight, reconcile 등)은 한국어로 옮겼다.
- 사실은 바꾸지 않았다. 낡은 문장 하나만 근거를 확인해 고쳤다(아래 「확정 · 근거」).

남은 주제 문서 여섯(sync, design-system, bible-text, routing, platform, liturgical)은 크기에 따라 하나나 둘씩 묶어 이어 간다.

## 확정 · 근거

- **캐시와 릴리스의 낡은 문장.** 「Phase 3 webhook 자동화 후속」은 Phase 3이 아직 남은 것처럼 읽혔다. ADR-021 상태 줄은 「Phase 1·2·3 구현 완료」이고, Phase 4(실배포 검증과 DevTools 캐시 동작 확인)는 「대기」다. 그래서 「Phase 3까지 끝났고, 남은 것은 Phase 4(dev 배포 뒤 DevTools로 캐시 동작 확인)」로 고쳤다.
- **대장의 옛 제목은 그대로 둔다.** `coding-pitfalls.md`의 §7과 §15 대장 줄은 옮기기 전의 절 제목을 유지한다(#371에서 정한 대장 형식). 옛 참조는 번호로 풀리고, 옛 제목을 기억하는 사람도 grep으로 찾을 수 있다. 주제 문서 쪽 제목만 고쳤다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/topics/*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 네 문서에 「꼴」과 물결표가 없다.

## 갱신한 문서

- `docs/topics/search.md`, `audio.md`, `install-a11y.md`, `cache-release.md`: 문장 정리.
