---
pr: 334
date: 2026-09-20
branch: chore/drop-cursor-config
title: "chore: 쓰지 않는 Cursor IDE 설정 제거 (.cursor/rules · .cursorignore)"
---

# chore: 쓰지 않는 Cursor IDE 설정 제거 (.cursor/rules · .cursorignore)

## 요약

Cursor IDE 를 더 이상 쓰지 않으므로 그 설정 파일 두 개를 지운다.

- `.cursor/rules/project-rules.mdc`(94행) — `alwaysApply: true` 로 걸려 있던 범용 규칙 문서(SOLID · Python 가이드 등). 이 저장소의 작업 규약은 `CLAUDE.md` 와 `docs/index.md` 가 정본이고, 이 파일은 그 이전에 만들어져 갱신이 멈춘 채 두 번째 정본처럼 남아 있었다 — 「한 사실은 한 곳에」에 어긋난다.
- `.cursorignore`(1행) — 내용이 주석 한 줄뿐인 빈 템플릿.

지우고 나면 추적 중인 Cursor 관련 파일은 남지 않는다.

## 확정·근거

- 사용자 확인(2026-09-20): 「이제 사용하지 않는 Cursor IDE 관련 파일들이야.」
- 원장 「변경 하나에 파일 하나」 규칙에 따라 진행 중이던 다른 브랜치(`docs/engine-canon-1-fixtures`, PR #333)에서 떼어내 별도 PR 로 연다. #333 은 「사실 변경 0」을 스냅샷으로 증명하는 PR 이라 무관한 삭제가 섞이면 증명이 흐려진다.

## 검증

- `grep -rn '\.cursorignore\|\.cursor/'` 를 `*.md`·`*.json`·`*.yml` 전체에 돌려 참조 0 확인(`docs/changes/` 의 과거 원장 제외 — 원자료 층은 고치지 않는다).
- `.gitignore`·`CLAUDE.md` 에 `cursor` 언급 없음.
- `git ls-files | grep -i cursor` → 삭제 후 결과 없음.
- `npm run typecheck` 통과 · `node --test tests/unit/*.test.js` 878 통과(설정 파일만 지웠으므로 영향 없음을 확인하는 대조군).

## 갱신한 문서

- 없음 — 코드(`js/` `css/` `index.html` `sw.js`) 변경이 없고, 정리 층 어느 문서도 이 파일들을 가리키지 않는다.
