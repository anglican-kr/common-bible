---
pr: 682
date: 2026-11-28
branch: chore/pre-release-commit-type
title: "chore: 버전을 올리는 커밋의 타입을 pre-release로"
---

## 요약

- `scripts/release.py`가 버전을 올리며 만드는 커밋(릴리스 PR의 제목)을 `release: X.Y.Z 릴리스`에서 `pre-release: X.Y.Z`로 바꾼다.
- `scripts/changelog.py`는 새 제목도 변경 목록에서 뺀다. 옛 제목(`release:`, `chore:`)도 그대로 뺀다.

## 확정 · 근거

- 사용자 결정(2026-11-28): 버전을 올리는 PR은 `release`가 아니라 `pre-release`를 식별자로 쓴다. 이 PR은 dev에 머지되어 pre-release(`X.Y.Z-<앱 커밋>`)로 먼저 나가고, 운영에는 그 뒤 main을 앞당겨 낸다. 그래서 PR 자체는 운영 릴리스가 아니다.
- 제목은 `pre-release: X.Y.Z`로 버전 번호만 둔다(사용자 결정 2026-11-28). 같은 버전에 수정을 더해도 버전을 다시 올리지 않는다. pre-release 이름의 앱 커밋이 바뀌어 새 pre-release가 된다(ADR-052 §4). 이번 결정으로 버전을 바꾸지 않으며, 지금 dev는 그대로 2.2.9다.
- 변경 목록에서 빼는 제목은 버전 번호 뒤에 PR 번호만 붙은 것이다. 버전 번호 뒤에 다른 글이 있는 `pre-release:` 커밋은 실제 변경으로 본다.

## 검증

- `scripts/test_release.py`, `scripts/test_changelog.py` 45건 통과. 새 제목과 PR 번호가 붙은 제목을 빼는지, 뒤에 글이 있는 제목은 남기는지를 더했다.

## 갱신한 문서

- `CLAUDE.md` 「커밋 메시지 규칙」: 타입 표와 릴리스 커밋의 제목
- `docs/workflow.md` 「릴리스」: 릴리스 PR의 제목
- `docs/decisions/051-dev-and-main-branches.md`: 운영에 내는 순서의 1
- `docs/decisions/021-pwa-versioning-content-hash.md`: `release.py`가 만드는 커밋
