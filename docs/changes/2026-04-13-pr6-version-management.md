---
date: 2026-04-13
pr: 6
branch: feat/version-management
title: "chore: version.json 단일 소스 버전 관리 체계 도입"
---

# chore: version.json 단일 소스 버전 관리 체계 도입

## Summary

- `version.json` 추가 — 앱 버전의 단일 소스
- `app.js` — 런타임에 `version.json` fetch, About 팝오버에 동적 표시
- `scripts/release.py` — semver 범프(`patch`/`minor`/`major`) + `sw.js` CACHE_NAME rev 자동 갱신
- `sw.js` — SHELL_FILES에 `/version.json` 추가, CACHE_NAME rev-15 갱신
- `scripts/build-deploy.sh` — 배포 zip에 `version.json` 포함

## 릴리즈 방법

```bash
python scripts/release.py patch   # 1.0.13 → 1.0.14
```

## Test plan

- [ ] 앱 로드 후 설정 팝오버 열기 → About에 버전 번호 표시 확인
- [ ] `scripts/release.py patch` 실행 → `version.json` 버전 증가, `sw.js` rev 증가 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches service-worker caching (new shell asset + cache name bump) and adds a startup fetch for `version.json`, which could affect offline/update behavior if misconfigured, but changes are small and well-scoped.
> 
> **Overview**
> Introduces `version.json` as the single source of truth for the app version and surfaces it in the Settings *About* link by fetching/caching it at runtime.
> 
> Updates deployment and offline caching to include `version.json` (adds it to the deploy zip and `sw.js` `SHELL_FILES`, and bumps `CACHE_NAME`). Adds `scripts/release.py` to bump the semver in `version.json` and automatically increment the service worker cache revision in one step.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6e000c17d8ce69e7a5c63069ac36dc352828d2cf. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
