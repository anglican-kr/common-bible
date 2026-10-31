---
pr: 457
date: 2026-10-31
branch: docs/sync-clock-research
title: "docs: 동기화 조사 기록을 보관하고 「가르다」를 정리함"
---

## 요약

PR #456을 만들기 전에 한 조사(기기 시계에 기대지 않는 동기화, 2026-10-30)의 보고서와 노트 다섯을 `docs/archive/research/2026-10-device-clock-sync/`에 보관한다. 그동안 git이 무시하는 `.claude/research/`에만 있어, 작업 폴더를 지울 때 사라질 뻔했다. 앞으로 동기화를 다시 정할 때 근거 자료로 쓰려는 것이다(사용자 지시 2026-10-31). 영어로 쓴 노트 하나는 한국어로 옮겼고, 그 과정에서 받은 교정(「가르다」)을 저장소의 다른 문서에도 적용했다.

## 확정 · 근거

- **자리는 `docs/archive/research/`다.** `archive/`는 특정 시점의 기록을 두는 곳이고, 이 조사도 그 시점의 기록이라 갱신하지 않는다. `reference/`는 외부 원문을 옮겨 적는 곳이라 맞지 않는다. 문장 검사도 `archive/`를 보지 않아, 조사할 때의 낱말을 그대로 둘 수 있다.
- **내용은 고치지 않았다.** 파일 이름은 저장소의 관례대로 영어로 바꿨다(원래는 공백이 든 한글 이름). 영어로 쓴 노트 하나(`base-copy-merge.md`)는 한국어로 옮겼다(사용자 지시 2026-10-31). 출처의 인용문도 한국어로 옮겨 낫표로 묶었다. 원문은 각 링크에 있다(사용자 지시). 옮긴 뒤 원본과 비교해 링크 59개가 그대로인 것을 확인했다. 다른 노트 넷은 인용문을 원문 그대로 둔다.
- **폴더의 `README.md`에 그 뒤에 정한 것과의 차이를 적었다.** 보고서가 2단계로 권한 서버 시각 보정은 정하지 않았고, 시각이 같을 때 드라이브의 사본을 남기는 규칙은 보고서에 없이 리뷰에서 더했다.
- **공개 저장소라 올리기 전에 찾아보았다.** 비밀값 형식(토큰, 클라이언트 비밀, 전자 우편 주소, IP 주소), 서버 설정, 로컬 경로는 없었다. 개발 서버 주소는 이미 공개 문서(ADR-011, ADR-017, `architecture.md`)에 나온다.

- **「가르다」를 쓰지 않는다**(`docs/writing.md` 「용어」, 사용자 교정 2026-10-31). 옮긴 노트의 「지운 파일을 가를 수 없다」가 어색하다는 교정이다. 노트에서 14곳을 고쳤고, 문서 수정을 이 PR에서 함께 하기로 해(사용자 결정) 다른 문서 20개에서 같은 쓰임 114곳을 고쳤다. 뜻에 따라 구별하거나 판단하는 뜻은 「구별한다」, 「판단한다」, 「정한다」로, 나누는 뜻은 「나눈다」, 「나뉜다」로, 서로 다르다는 뜻의 「갈린다」는 「달라진다」, 「다르다」로 썼다. 덮는다는 뜻의 「가리다」, 「가려내다」, 「갈라지다」, 성경 이름 「갈라티아서」, 인용과 규칙 문장, 옛 기록(`docs/archive/`)과 머지된 원장은 그대로 두었다. `tests/README.md`의 한 곳은 PR #455가 같은 줄을 이미 다른 말로 고쳐 여기서 건드리지 않았다.

## 검증

- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`: 31개 모두 통과(데이터 서브모듈의 사실 블록 검사 포함).
- `python3 scripts/docs_facts_snapshot.py --diff origin/main WORKTREE --strict-counts`: 사라지거나 줄어든 토큰 0, 새 토큰 0.
- `python3 tools/prose/prose.py same-code origin/main`: 주석과 문서 말고 바뀐 파일 0개.

## 갱신한 문서

- `docs/archive/README.md`: `research/`
- `docs/index.md`: Drive 동기화 줄의 「더 볼 곳」, `archive/`의 한 줄
- ADR-011 「검토한 대안 — 수정 시각」: 조사 보고서의 자리
- `docs/writing.md` 「용어」: 「가르다」
- 「가르다」를 고친 문서: `docs/architecture.md`, `docs/coding-pitfalls.md`, `docs/decisions/008-pwa-install-guide.md`, `docs/decisions/010-bookmark-feature.md`, `docs/decisions/012-typescript-incremental-adoption.md`, `docs/decisions/031-tab-history-restore.md`, `docs/decisions/036-liturgical-calendar-data-model.md`, `docs/decisions/037-eucharist-lectionary-data-and-engine.md`, `docs/decisions/038-calendar-lectionary-ui.md`, `docs/design/liturgical-engine-review.md`, `docs/design/liturgical-engine/02-data-reality.md`, `docs/design/liturgical-engine/04-compute-layer.md`, `docs/design/liturgical-engine/05-lookup-layer.md`, `docs/design/liturgical-engine/06-rank-transfer-color.md`, `docs/design/liturgical-engine/07-test-plan.md`, `docs/design/liturgical-engine/09-open-items.md`, `docs/topics/bookmark.md`, `docs/topics/liturgical.md`, `docs/topics/sync.md`, `tools/csp/README.md`
