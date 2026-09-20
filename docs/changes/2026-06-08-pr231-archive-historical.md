---
date: 2026-06-08
pr: 231
branch: docs/archive-historical
title: "docs: 완료·점-시점 문서를 docs/archive/로 이동 (design·audit·qa)"
---

# docs: 완료·점-시점 문서를 docs/archive/로 이동 (design·audit·qa)

더 이상 갱신되지 않는 기록(완료된 설계 변천·보안 감사·테스트 회귀 보고서)을 `docs/archive/`로 옮겨 docs 루트를 살아있는 가이드만 남깁니다.

## 이동 (git mv — 히스토리 보존)
- `docs/design/` (4) → `docs/archive/design/` — 설계 변천 narrative (모듈분할·TS·PKCE·검색이력)
- `docs/audit/` (5) → `docs/archive/audit/` — 보안 감사
- `docs/qa/` (23) → `docs/archive/qa/` — e2e·유닛 회귀 보고서
- `docs/archive/README.md` 안내 신설

## 참조 갱신 (잔여 0 검증)
- `docs/{design,qa,audit}/` 경로 멘션 → `docs/archive/...` (ADR 12개·architecture·status·worklog·prd·README·helpers.js)
- ADR-017 상대링크 `../design/` → `../archive/design/`
- archive로 내려간 `pkce-migration.md`의 `../decisions/` 링크 깊이 +1 보정 (`../../decisions/`)
- CLAUDE.md·README·prd 디렉터리 트리 표기 archive 반영

## 살아있는 문서 (루트 유지)
`architecture.md`·`status.md`·`known-issues.md`·`coding-pitfalls.md`·`prd.md`·`worklog.md`(append 저널) + `decisions/`(ADR).

> **스택 PR** — base가 #230(`docs/extract-status`). #230(현황을 status.md로 분리) 머지 후 자동 retarget. 1Password 서명 불가로 미서명.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 문서 이동과 링크·트리 설명 갱신만이며 런타임·인증·데이터 경로는 건드리지 않습니다.
> 
> **Overview**
> **`docs/archive/`로 완료·점-시점 문서를 모아** `docs/` 루트는 살아있는 가이드(`architecture.md`, `status.md`, `known-issues.md`, `decisions/`, `coding-pitfalls.md`, `prd.md`, `worklog.md`)만 두도록 정리합니다.
> 
> `docs/design/`(4), `docs/audit/`(5), `docs/qa/`(23)는 **`git mv`로 `docs/archive/` 하위로 이동**하고, `docs/archive/README.md`로 보관 목적·성격을 설명합니다. 앱 동작·빌드·배포 코드는 변경 없습니다.
> 
> **참조는 저장소 전반에서 `docs/archive/...`로 맞춥니다** — `CLAUDE.md`, `README.md`, `docs/architecture.md`, `status.md`, `worklog.md`, `prd.md`, ADR 다수, `js/app/helpers.js` 주석, `coding-pitfalls.md` 등. `pkce-migration.md`처럼 archive 깊이가 바뀐 문서는 ADR 상대 링크(`../../decisions/`)도 보정했습니다.
> 
> 문서 트리 표기도 **루트 `design`/`audit`/`qa` 대신 `archive/`** 를 반영합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 75a4a8d3ddeae7f7a17fab5ea4a6b610c0b2b058. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
