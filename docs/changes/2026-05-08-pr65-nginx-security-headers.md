---
date: 2026-05-08
pr: 65
branch: feat/nginx-security-headers
title: "feat: nginx 보안 헤더 통합 + Permissions-Policy/COOP 도입"
---

# feat: nginx 보안 헤더 통합 + Permissions-Policy/COOP 도입

## Summary

보안 헤더 백로그(`project_security_headers_backlog.md`) #2 처리. 작업 도중 latent 버그도 함께 수정.

**Latent 버그**: 두 vhost(bible/dev)에 같은 regex location이 두 번씩 선언돼 있어 nginx의 first-match에 따라 아래쪽 "# 보안 헤더" 블록이 dead code였음. 결과적으로 prod·dev **모든 응답에 보안 헤더 0개**로 서빙되고 있었음 (`curl -sSI`로 확인).

**수정 (nginx 서버 측, 이미 적용 완료):**
- `/etc/nginx/snippets/security-headers.conf` 단일 출처로 6개 헤더 통합
- 두 vhost server level + add_header 있는 location들에 일관 include (nginx add_header inheritance 함정 우회)
- 새 헤더 도입: `Permissions-Policy` (camera·microphone·geolocation·payment·USB·motion sensors 명시 거부), `Cross-Origin-Opener-Policy: same-origin`
- dead code였던 두 번째 regex 블록 삭제

**저장소 변경 (이 PR):**
- [nginx/security-headers.example.conf](nginx/security-headers.example.conf) 신규 — 서버 snippet 미러 + 배포·검증 절차
- [docs/architecture.md](docs/architecture.md) §9 보안 모델에 "브라우저 측면" 절 신규
- [docs/worklog.md](docs/worklog.md) 2026-05-08에 본 작업 항목 추가
- [CLAUDE.md](CLAUDE.md) 현재 상태 + 프로젝트 구조 갱신

**SPA 코드 변경 0** → 버전 bump 없음, 배포 사이클 무관.

## 검증 결과 (`curl -sSI`)

| 경로 | 변경 전 | 변경 후 |
|-----|--------|--------|
| `bible.anglican.kr/` | 0 보안 헤더 | 6개 모두 |
| `bible.anglican.kr/gen/1` (HTML5 fallback) | 0 | 6개 |
| `bible.anglican.kr/css/style.css` | 0 | 6개 |
| `bible.anglican.kr/index.html` | 0 | 6개 |
| `dev.anglican.kr/` | 0 | 6개 |
| `dev.anglican.kr/oauth/token` (POST) | Google upstream의 일부 | upstream + 우리 6개 |

## Test plan
- [x] `curl -sSI`로 6개 헤더 모두 prod·dev에 적용됨 검증
- [x] `nginx -t` 통과, reload 성공
- [x] HTML5 라우팅 fallback (`/gen/1` 등)도 보안 헤더 적용 확인 (이전 latent 버그가 닫힘)
- [x] OAuth /token POST 응답도 보안 헤더 적용 확인 (Google upstream 헤더와 일부 중복되지만 동일 값/무해)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Docs-only changes plus an nginx snippet example; no runtime JS/data logic changes, so risk is low aside from potential operator misconfiguration when applying the snippet in production.
> 
> **Overview**
> Adds a reusable nginx security-headers snippet example (`nginx/security-headers.example.conf`) that standardizes **6 response headers** (including new `Permissions-Policy` and `Cross-Origin-Opener-Policy`) and documents how to apply it safely given nginx `add_header` inheritance pitfalls.
> 
> Updates documentation (`docs/architecture.md`, `docs/worklog.md`, `CLAUDE.md`) to record the security-header rollout, the discovered issue where prior header blocks were effectively dead due to regex location ordering, and the recommended server-level+location-level include pattern.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 10857402892badeb87bcd39036695d05af57646f. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
