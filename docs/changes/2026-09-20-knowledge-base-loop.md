---
date: 2026-09-20
branch: chore/knowledge-base-loop
title: "chore: worklog 은퇴 · 변경 원장(docs/changes)·진입점(docs/index) 도입 · doc-reminder 훅 제거"
---

# chore: worklog 은퇴 · 변경 원장(docs/changes)·진입점(docs/index) 도입 · doc-reminder 훅 제거

## 요약

`docs/` 를 작업을 거듭할수록 쌓이는 지식 베이스로 돌리기 위한 첫 PR. 문서 종류를 늘리지 않고 **읽기·쓰기·정리 세 루프**를 붙인다(CLAUDE.md「지식 베이스 루프」).

- **`docs/worklog.md` 은퇴.** 2026-05-29 브랜치 보호(PR 필수) 이후 역할이 PR 본문으로 옮겨 가 4개월간 갱신되지 않았다(`coding-pitfalls.md` §17). 32개 날짜 블록을 `docs/changes/*-worklog[-N].md` 로 내용 그대로 옮겼다.
- **`docs/changes/` 변경 원장 신설** — 변경 하나에 파일 하나. PR 본문은 이 파일에서 `--body-file` 로 파생하므로 원본이 항상 저장소 안에 있고, 흐름은 GitHub 가 아니라 `ls`·`grep` 으로 본다. 형식·규칙은 `docs/changes/README.md`.
- **백필** — GitHub 에만 있던 머지 PR 본문 308건(2025-08-17 ~ 2026-09-20)을 `…-prNNN-<slug>.md` 로 저장(날짜 = KST 머지일, 내용 무수정, 하단 attribution 줄만 제거).
- **`docs/index.md` 진입점** — 작업 유형 → 먼저 읽을 문서 표 + 페이지별 한 줄 훅. 60줄 상한.
- **강제 수단 두 겹** — `.claude/hooks/pre-pr-ledger.sh`(PreToolUse: `gh pr create` 가 커밋된 원장을 `--body-file` 로 넘기지 않으면 deny) + `.github/workflows/ledger.yml`(CI `Change ledger`: PR diff 에 새 원장 파일 필수, 코드 변경 시 `## 갱신한 문서` 절 필수, `sync/` 자동 PR 면제). `post-pr-ledger.sh` 는 생성된 PR 번호를 원장 frontmatter 에 적는다.
- **`doc-reminder.sh` Stop 훅 제거** — 매 Stop 마다 worklog 갱신을 재촉하던 소음. `e2e-reminder.sh` 의 주석 참조도 정리.
- `coding-pitfalls.md` 는 코드 실수 외에 **사용자 교정·도메인 확정**도 받는 곳으로 역할을 넓혔다(§사용법, §17 신설).

## 확정·근거

사용자 확정(2026-09-20 대화):

- worklog 는 되살리지 않는다 — 기록 습관이 아니라 역할 이동의 문제.
- 기록의 원본은 PR 본문이 아니라 **로컬 파일**이어야 한다("PR 은 내가 찾아보기 어렵다").
- 강제 수단은 **항상 적용**되게 한다 → 훅(Claude Code 안) + CI(어디서 만든 PR 이든).
- 과거 공백(worklog 분할 + PR 본문 백필)까지 메운다.

## 검증

- `pre-pr-ledger.sh` 를 stdin JSON 으로 직접 호출해 deny 경로 4종 확인: `--body-file` 없음 · 파일 없음 · 미커밋 원장 · 무관한 명령(no-op). 이 PR 자체가 통과 경로 검증.
- `post-pr-ledger.sh` 를 가짜 PR URL 로 호출해 `pr: N` 이 frontmatter 첫 줄에 삽입되고 systemMessage 가 나오는 것 확인.
- `ledger.yml` 은 로컬 실행 불가 — 이 PR 의 CI 결과로 확인. 통과 후 브랜치 보호 필수 검사에 `Change ledger` 추가 필요.
- 코드(`js/` `css/` `index.html` `sw.js`) 변경 없음 — 유닛 테스트 대상 아님.
- `worklog` 잔여 참조 0건(`grep -rn worklog` — `docs/changes/` 제외).

## 갱신한 문서

- `CLAUDE.md` — `docs/` 구조 줄, 커밋 타입 표, 작업 표준 흐름(`--body-file`), 「지식 베이스 루프」절 신설, 훅·CI 파일 목록, 「현재 상태」의 worklog 참조.
- `docs/index.md` 신설 · `docs/changes/README.md` 신설.
- `docs/status.md` · `README.md` · `docs/prd.md` · `docs/coding-pitfalls.md` — worklog 참조를 `docs/changes/` 로 교체.
- `docs/coding-pitfalls.md` §17 신설(작업 방식 교정).
