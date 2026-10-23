---
date: 2026-10-23
branch: docs/prose-adr-batch1
title: "docs: ADR 001-009의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 첫 PR이다. ADR 38개를 PR 열다섯으로 나눴고, 이 PR은 001, 004, 005, 007, 008, 009를 고쳐 썼다. 데이터 저장소로 옮겨 간 002, 003, 006은 옮긴 곳을 알리는 몇 줄뿐이라 이 작업에서 뺐다.

- **문장.** `docs/writing.md`의 pitfalls §37(완결된 문장, 간결, 그 분야의 용어)과 §40(개발을 모르는 독자도 읽을 수 있게), 「용어」와 「학술 · 법률 문체 낱말」 목록을 따랐다.
- **옛 개정 블록.** 개정 블록(「> **개정 (날짜):**」)과 머리의 「개정:」 줄을 본문의 해당 자리에 반영하고 지웠다. 바뀌기 전의 선택은 「검토한 대안」에 「채택하지 않음 날짜 · 이유」로 남겼다(CLAUDE.md 「ADR 워크플로우」 2, 사용자 결정 2026-10-21).

| ADR | 본문에 반영한 것 | 「검토한 대안」으로 옮긴 것 |
| --- | --- | --- |
| 001 | 단순성의 범위(2026-05-09), 저장소 토폴로지(2026-05-11), 캐시 이름을 버전에서 만들기(ADR-021) | 단일 `CACHE_NAME`(2026-05-07까지), 캐시 이름의 rev와 `--bump-data` 플래그(2026-05-13까지) |
| 004 | 검증 테스트의 데이터 저장소 이전(2026-05-11) | 없음 |
| 005 | 청크 분할과 컬럼형 형식(2026-04-11), `in:` 연산자(2026-05-05) | 단일 `search-index.json`(2026-04-11까지) |
| 007 | 폰트 도착을 기다려 런치 스크린 걷기(2026-05-01) | `display=optional`(2026-05-01에 되돌림) |
| 008 | iOS 17+ 비Safari의 `ios-other`, iOS 16 이하의 `ios-legacy`(2026-05-11) | iOS 비Safari는 모두 「Safari에서 열어 주세요」(2026-05-11까지) |
| 009 | sitemap 생성 스크립트와 장 단위 lastmod(2026-05-23) | 모든 URL에 같은 lastmod(2026-05-23 1차) |

- **함께 고친 가리킴 둘.** 디자인 시스템 주제 문서의 pitfalls §8은 「ADR-007의 개정 블록 참고」였는데, 블록이 없어져 「결정 5와 「검토한 대안」의 `display=optional`」로 고쳤다. ADR-001의 새 절 이름은 ADR-020이 가리키는 「저장소 토폴로지」에 맞췄다. 다른 ADR이 날짜로 가리키는 개정(「ADR-005 2026-05-05 개정」 등)은 지금도 뜻이 통해, 그 ADR을 고치는 묶음에서 다듬는다.

## 확정 · 근거

- **ADR-001의 캐시 식별자 운영.** 본문은 `DATA_CACHE`와 `AUDIO_CACHE`의 rev를 `--bump-data`, `--bump-audio`로 올린다고 적고 있었다. ADR-021(2026-05-13)이 콘텐츠 해시 매니페스트로 바꿔, 두 캐시의 이름은 고정되고 플래그는 없어졌다(캐시와 릴리스 주제 문서의 pitfalls §7과 같다). 본문을 지금 결론으로 고치고, 옛 방식은 「검토한 대안」으로 옮겼다.
- **ADR-009의 GSC 후속.** 「GSC URL 검사로 핵심 URL 5~10개 수동 시드」는 하지 않기로 한 사용자 결정(2026-10-22, 원장 `docs/changes/2026-10-22-cleanup-unused-records.md` 「Google Search Console 수동 크롤링 요청은 지운다」)을 함께 적었다.
- **ADR-008의 파일 위치.** 「`js/app.js`의 `install` IIFE」는 2026-05-10 모듈 분할(ADR-018) 뒤 `js/app/install.js`로 옮겨 갔다. 옛 개정 블록이 적은 위치를 본문에 반영했다.
- 그 밖의 사실은 바꾸지 않았다. 커밋 해시, 날짜, 건수, 인라인 코드, 「」 인용을 모두 그대로 두었다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/*.md' --docs 'docs/topics/*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다. 개정 블록을 합치며 한 번씩 덜 적은 이름(「ADR-001」, `DATA_CACHE`, 테스트 파일 이름, 「1회」)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 여섯 ADR에 「꼴」, 물결표, 우선순위를 뜻하는 「이긴다」, 「진다」가 없다.

## 갱신한 문서

- `docs/decisions/001-spa-architecture.md`, `004-data-pipeline-test-strategy.md`, `005-search-indexing-strategy.md`, `007-launch-screen-optimization.md`, `008-pwa-install-guide.md`, `009-history-api-routing.md`: 문장 정리와 개정 블록 반영.
- `docs/topics/design-system.md`: pitfalls §8의 ADR-007 가리킴.
