---
date: 2026-05-08
pr: 64
branch: feat/dev-anglican-host
title: "feat: PKCE 단계 6 — dev 환경 분리 + nginx BFF + visibility sync (1.4.6)"
---

# feat: PKCE 단계 6 — dev 환경 분리 + nginx BFF + visibility sync (1.4.6)

## Summary
**dev.anglican.kr 환경 정식 도입 + OAuth 보안 모델 재설계.**:

**1. OAuth 호스트 분기 inversion** (`3290e9a`·`a09c7f0`)
[js/drive-sync.js](js/drive-sync.js#L18-L25)·[js/sync/debug-log.js](js/sync/debug-log.js#L22)의 호스트 체크 inversion. 소스에서 `localhost` 문자열 제거. prod 도메인(`bible.anglican.kr`)만 명시되고, 그 외 모든 호스트(dev·로컬·포크)는 dev Client ID로 fallback. 테스트 잔재(GIS/Implicit Flow 시절 표현)도 정리.

**2. deploy.sh dev/prod/promote 분기** (`0a9498c`)
같은 서버에서 nginx 가상 호스트로 dev·prod 분리하는 구조에 맞춰 서브커맨드 도입. `bible-{version}-{shortsha}` 명명으로 dev 반복 배포 시 덮어쓰기 방지, promote 시 dev에서 검증한 정확한 디렉터리를 prod가 가리킬 수 있음. `.gitignore`에서 `scripts/deploy.sh` 제거.

**3. nginx BFF로 client_secret server-side 주입** (`d41dba1`)
Google "웹 애플리케이션" OAuth 클라이언트는 PKCE를 써도 `/token` 요청에 `client_secret`을 강제(RFC 7636 일탈). SPA 임베드는 (a) git 이력 영구 잔존, (b) GitHub 자동 secret 스캔이 `GOCSPX-` 패턴 감지 시 Google이 secret 자동 무효화 → 운영 동기화 즉시 중단, (c) OAuth 2.1 / RFC 8252 public client 정신 위배 — 위험을 모두 회피하려고 same-origin nginx 프록시 BFF로 전환. secret은 nginx 설정에만 존재.

**4. sw.js POST cache.put 회귀 수정** (`6c5320d`)
BFF 도입 후 same-origin POST `/oauth/token`을 SW가 cache-first 로직으로 처리하면서 `cache.put(POST)` TypeError. 토큰 교환 자체는 정상 동작했지만 콘솔 노이즈. `method !== "GET"` 가드를 fetch 핸들러 최상단에 추가.

## Why (보안)
이전엔 dev Client ID origin이 `http://localhost:8080`까지 허용했기 때문에, 사용자 PC에 악성 프록시가 같은 포트로 바인딩될 경우 등록된 origin·redirect URI를 그대로 만족시켜 PKCE 흐름을 탈취당할 여지가 있었음. 코드에서 `localhost` 의존을 끊고 Cloud Console에서 localhost 등록 제거 + BFF로 client_secret을 server로 분리 = 이 공격 표면이 모두 닫힘.

## ✅ 인프라 적용 완료
- [x] dev/prod Client ID `Authorized JavaScript origins`에서 `http://localhost:8080` 제거
- [x] dev/prod Client ID `Authorized redirect URIs`에서 `http://localhost:8080/` 제거
- [x] dev·prod 두 vhost에 `location = /oauth/token` 블록 적용 (`nginx -t` OK, reload 완료)

## Test plan
- [x] `node --test tests/unit/state-machine.test.js tests/unit/transport-pkce.test.js` — 52/52 통과
- [x] `bash -n scripts/deploy.sh` syntax OK + 인자 없을 때 usage 출력
- [x] `curl https://dev.anglican.kr/oauth/token` + 가짜 token → `400 invalid_grant` (BFF 정상)
- [x] `curl https://bible.anglican.kr/oauth/token` + 가짜 token → `400 invalid_grant` (BFF 정상)
- [x] `./scripts/deploy.sh dev` → `https://dev.anglican.kr` 시운전: cold start silent refresh + Drive 동기화 + 자동 머지·업로드 정상, 에러 0건
- [x] 머지 후 `./scripts/deploy.sh promote`로 prod 승격 → `https://bible.anglican.kr` 동일 검증

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **High Risk**
> High risk because it changes OAuth token exchange/refresh plumbing (client → `/oauth/token` via nginx secret injection) and updates service worker fetch handling; misconfig or caching mistakes can break sign-in/sync across clients.
> 
> **Overview**
> Introduces a formal **dev/prod split** (`dev.anglican.kr` + `bible.anglican.kr`) and a new `scripts/deploy.sh` workflow (`dev`/`prod`/`promote`) that deploys versioned build directories and atomically swaps `/var/www/{dev,bible}` symlinks.
> 
> Switches PKCE token exchange/refresh from Google’s public `/token` endpoint to a same-origin **nginx BFF** at `/oauth/token` (new ADR-017 + example nginx config), removing any need to embed `client_secret` in the SPA and updating unit/e2e tests accordingly.
> 
> Adds **tab-visibility auto-sync** (`visibilitychange` → `driveSync.requestSync()` when visible) and fixes regressions caused by the new endpoint: SW now bypasses non-GET requests, search action buttons correctly respect `[hidden]`, and mobile search clear refocus no longer collapses the sheet.
> 
> Bumps release version to `1.4.6` (including `sw.js` shell cache).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 78567a66b194228cffe2bcdfdca3c3fb35d3a228. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
