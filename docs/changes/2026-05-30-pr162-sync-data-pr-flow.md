---
date: 2026-05-30
pr: 162
branch: chore/sync-data-pr-flow
title: "chore: sync-data 워크플로를 PR + auto-merge 흐름으로 전환"
---

# chore: sync-data 워크플로를 PR + auto-merge 흐름으로 전환

## 요약

- 브랜치 보호(2026-05-29) 적용 후 sync-data.yml 의 main 직접 push 가 `Required status check "Unit tests" is expected` 로 거부되며 webhook 자동화가 깨졌다 (오늘 두 차례 sync 실패로 노출).
- 토픽 브랜치 push → `gh pr create` → `gh pr merge --auto --squash --delete-branch` 흐름으로 전환. Unit tests 통과 시 자동 머지.
- PAT 분리: 기존 `SUBMODULE_AND_DISPATCH_PAT` 권한 최소화 의도 유지, common-bible Contents:Write + Pull requests:Write 만 가진 신규 `SYNC_DATA_PR_PAT` 추가.
- repo 설정 `allow_auto_merge: true` 활성화 (이미 적용).
- ADR-021 개정 동봉.

## 머지 후 후속 작업

1. **(사용자 작업)** `SYNC_DATA_PR_PAT` Fine-grained PAT 발급 + secret 등록
   - Repository: `anglican-kr/common-bible` 만
   - Permissions: Contents R/W + Pull requests R/W (+ Metadata R 자동)
   - `gh secret set SYNC_DATA_PR_PAT --repo anglican-kr/common-bible`
2. 실패한 두 sync workflow 재실행 (workflow_dispatch) → 자동 PR 생성·머지 확인
3. dev 배포로 진행

## Test plan

- [ ] PR CI (Unit tests) 통과
- [ ] 머지 후 sync-data.yml workflow_dispatch 수동 트리거
- [ ] 새 PR 생성 + Unit tests 통과 + auto-merge 동작 확인
- [ ] `data` 서브모듈 포인터가 origin/main 의 최신 commit 으로 이동했는지 확인

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Changes CI/CD automation and introduces a new PAT with Contents/PR write on common-bible; misconfiguration could block data sync or weaken least-privilege if the secret is over-scoped.
> 
> **Overview**
> **Branch protection** on `main` (required **Unit tests**) blocked the data sync workflow’s direct pushes; this PR routes updates through **PR + auto-merge** instead.
> 
> `sync-data.yml` now checks out with **`SYNC_DATA_PR_PAT`**, updates the `data` submodule and regenerates `sitemap.xml`, and **exits early** when nothing changed. When there are changes, it pushes to **`sync/data-<run_id>`**, opens a PR with `gh pr create`, and enables **`gh pr merge --auto --squash`** so **Unit tests** can run and merge without human action. Submodule cloning still uses **`SUBMODULE_AND_DISPATCH_PAT`**; PR write/push uses the new PAT because **`GITHUB_TOKEN`** PRs do not fire `pull_request` CI. Workflow permissions drop to **`contents: read`** on the job token; the workflow name drops the obsolete “and release” suffix.
> 
> **ADR-021** adds a 2026-05-30 revision documenting this flow, PAT split, `allow_auto_merge`, and the rename.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit dc6b05addcb9d40904c55ebde5df7ce84b2696d9. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
