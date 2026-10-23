---
pr: 384
date: 2026-10-23
branch: docs/prose-adr-batch3
title: "docs: ADR 016-020의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 셋째 PR이다. ADR 016, 017, 018, 019, 020을 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37과 §40, 그리고 「용어」와 「학술 · 법률 문체 낱말」 목록이다. 옛 개정 블록과 머리의 「개정:」 줄은 본문의 해당 자리에 반영하고 지웠다. 바뀌기 전의 선택은 「검토한 대안」에 「채택하지 않음 날짜 · 이유」로 남겼다.

| ADR | 본문에 반영한 것 | 「검토한 대안」으로 옮긴 것 |
| --- | --- | --- |
| 016 | 캐시 이름을 `"audio"`로 고정하고 매니페스트로 바뀐 파일만 지우는 방식, 그때 메타 행도 함께 지우는 일(ADR-021, 2026-05-13) | 캐시 이름 `"audio-1"`을 올려 전체를 비우기 |
| 017 | 설정 예시 파일을 server 저장소로 옮긴 일(2026-05-11), 요청 빈도 제한 M5 | njs로 요청 본문을 검사하는 가드 M6(2026-06-09에 채택하지 않음) |
| 018 | ESM으로 바뀐 모듈 방식(2026-05-09), Phase 1-8의 결과(2026-05-10) | IIFE + `<script defer>` + `window.appXxx`와 module-vs-script 예외 |
| 019 | 일괄 전환의 결과(2026-05-10) | 없음 |
| 020 | ADR-021의 배포 자동화(2026-05-13) | 사람이 두 번 손대던 배포 흐름 |

이 밖에 squash 머지 메시지에서 Co-Authored-By 줄을 빼는 작업 방식을 `CLAUDE.md`의 머지 명령과 `docs/workflow.md`에 적었다. 기본 메시지는 브랜치 커밋 메시지를 이어 붙여 그 줄이 여러 번 쌓인다. 사용자가 2026-10-23에 squash 메시지에는 넣지 않기로 정했다. 브랜치의 각 커밋에는 그대로 붙인다.

## 확정 · 근거

- **낡은 사실을 지금에 맞췄다.** 모두 저장소에서 확인했다.
  - ADR-016의 300 MB 정리 시점: `requestIdleCallback`이나 `visibilitychange`로 정했지만, 지금 구현은 페이지가 가려질 때만 정리한다(`js/app.js`의 `_enforceAudioSoftCap`).
  - ADR-016의 persist 요청 시점: 북마크 추가, Drive 첫 로그인, 첫 오프라인 재생으로 정했지만, 지금은 처음 재생할 때와 북마크를 저장할 때 한 번 요청한다(`js/app/storage.js`의 `_maybeRequestPersist`).
  - ADR-016의 메타 인덱스: `lastPlayedAt` 인덱스를 두기로 했지만 `js/audio-cache.js`는 인덱스 없이 모든 행을 읽어 정렬한다. `addedAt`은 재생하지 않은 파일끼리 순서를 정할 때 쓴다.
  - ADR-016의 디버그 로그: 지금은 페이지의 300 MB 정리만 `audio-evict`로 적고, 담는 값은 정리 전의 총 크기다. 서비스 워커의 정리는 적지 않는다.
  - ADR-016 D4의 오프라인 안내: 정한 안내 문구가 코드에 없다. 지금은 재생이 실패하면 사유와 상관없이 「오디오 파일을 준비 중입니다.」를 보인다(`js/app/audio-player.js`). ADR에는 「아직 넣지 않았다」로 적었다.
  - ADR-016의 영향 범위: 재생 기록은 `js/app/audio-player.js`, persist 요청은 `js/app/storage.js`로 옮겨 갔다(ADR-018).
  - ADR-017의 설정 예시: `oauth-bff-guard.example.js`는 지금 server 저장소에 없다. M6를 채택하지 않을 때 없어졌다.
  - ADR-018의 공유 상태 모듈: 계획은 `state.js`였지만 실제는 `js/app/reading-context.js`다(2026-05-10, 사용자 검토). `app-main.js`는 만들지 않고 부트스트랩을 `js/app.js`에 남겼다. 근거는 `docs/archive/design/app-modularization.md`의 진행 일지다.
  - ADR-018의 「ADR-012에 `> 개정` 블록 추가」: ADR-012는 묶음 2(#383)에서 본문으로 옮겼으므로 그렇게 적었다. 옛 절 이름 「module-vs-script 예외」는 코드 주석(`js/app/storage.js`, `js/sync/store-v2.js`)이 가리키므로 새 절 제목에 남겼다.
  - ADR-019의 예외: ADR-021이 더한 `js/manifest-sync.js`도 classic `<script defer>`이고, `sw.js`가 불러오지 않는다(`index.html`, `sw.js`).
  - ADR-020의 앱 서브모듈 자동 갱신: 옛 개정 블록은 repository_dispatch라고 적었지만, data 저장소의 `build.yml`은 `gh api`로 `sync-data.yml`의 workflow_dispatch를 부른다. ADR-021도 workflow_dispatch를 골랐다. `sync-data.yml`은 PR을 만들어 자동으로 머지한다.
  - ADR-020의 `release.py`: 지금은 `version.json`과 `sw-version.js`를 함께 올린다. `GEMINI.md`는 #368에서 지웠다. 실행 계획 파일 `giggly-wibbling-lampson.md`는 지금 없다.
- **공개 저장소라 서버 정보는 더하지 않았다.** ADR-017의 2026-06-09 장애 기록은 이미 있던 내용만 옮겼다.
- 영어 단어를 술어로 쓴 곳(clone한다, push하면, reload한다 등)은 한국어 술어로 바꾸고 영어는 괄호에 넣었다(pitfalls §40).
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/01[6-9]-*.md' --docs 'docs/decisions/020-*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다. 개정 블록을 합치며 덜 적은 것(「60회」, `limit_req`, 2026-06-09, `window.app<X>`, `defer`, `window.X`)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 다섯 ADR에 「꼴」이 없다. 물결표는 표에서 칸마다 하나씩 쓴 근삿값뿐이고, 본문의 근삿값은 「약」으로 바꿨다.

## 갱신한 문서

- `docs/decisions/016-audio-cache-lru.md`, `017-oauth-bff-proxy.md`, `018-app-modularization.md`, `019-esm-module-system.md`, `020-monorepo-split.md`: 문장 정리와 개정 블록 반영.
- `CLAUDE.md` 「브랜치 보호 / 작업 흐름」의 머지 명령, `docs/workflow.md` 「커밋과 PR」: squash 머지 메시지에서 Co-Authored-By 줄을 뺀다.
