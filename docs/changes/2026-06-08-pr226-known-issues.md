---
date: 2026-06-08
pr: 226
branch: docs/known-issues
title: "docs: 발견된 이슈·후속 과제 추적 문서"
---

# docs: 발견된 이슈·후속 과제 추적 문서

ADR-034(뷰·라우팅 2차 분할) 작업 중 발견·확인한 항목을 한 곳에 모은 추적 문서(`docs/known-issues.md`). "나중에 대응" 대상.

## 담긴 내용

1. **사전 존재 e2e 실패** (headless, baseline main에도 동일 — 회귀 아님)
   - `test_tabbar.py` 모핑 검색 ~7–8건 (`#search-input` 미가시 타임아웃)
   - `test_settings.py` 3건 (책 순서 vulgate/canonical 토글, 캐시 비우기 reload)
   - 각 증상·영향 케이스·추정 원인·대응 후보 기록
2. **ADR-034 남은 작업** — PR5b(registry 역전 + closeAllOverlays), audio `applyAudioShow→parsePath` edge 해소, `bookmark.js` 분할
3. **환경/도구** — 1Password 헤드리스 서명 실패(`--no-gpg-sign`), conftest `base_url` 8080 고정

> 1Password 서명 불가로 커밋 미서명.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation-only change with no application or test code modifications.
> 
> **Overview**
> Adds **`docs/known-issues.md`**, a single tracking doc for ADR-034 follow-ups and items found during the views/routing split—not fixes in this PR.
> 
> It records **pre-existing headless e2e failures** (tab bar search morphing in `test_tabbar.py`, settings popover/cache reload in `test_settings.py`) with symptoms, affected tests, suspected causes, and mitigation ideas, noting they match main baseline and are not regressions.
> 
> It also lists **remaining ADR-034 work** (PR5b registry/`closeAllOverlays`, audio `applyAudioShow` vs `parsePath`, `bookmark.js` split) and **tooling notes** (1Password GPG signing in headless, hardcoded `base_url` in `tests/e2e/conftest.py`).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 19d4c5f1425baa5a5488c05a6827e709a9dc1587. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
