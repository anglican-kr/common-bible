---
date: 2026-05-09
pr: 77
branch: feat/nginx-bff-hardening
title: "feat: nginx BFF 보강 — Permissions-Policy 확장 + rate limit + njs body 가드 (L11+M5+M6)"
---

# feat: nginx BFF 보강 — Permissions-Policy 확장 + rate limit + njs body 가드 (L11+M5+M6)

## Summary

2차 보안 감사 백로그의 L11 + M5 + M6 처리. 서버 적용 완료, 검증 통과. 저장소엔 예시 파일·문서만.

| # | 항목 | 적용 |
|---|------|------|
| L11 | Permissions-Policy 5개 directive 추가 (clipboard-read·fullscreen·display-capture·interest-cohort·browsing-topics) | 두 vhost snippet |
| M5 | /oauth/token rate limit 60r/m + burst 100 | conf.d (zone) + location (limit_req) |
| M6 | njs body 가드 — client-supplied client_secret 검출 시 400 reject | js_content + named location 분리 |

## 전제 조건

서버에 `libnginx-mod-http-js` 설치(이미 완료). `njs` CLI 패키지(이미 설치됐던)와는 별개.

## 설계 노트

**M5 — 60r/m + burst 100 선택 근거**: 사용자가 NAT 뒤 단체(교회·학교) 시나리오 우려 제기. 50명 이상 동시 시작 시 같은 public IP라 한 버킷. 60r/m + burst 100은 단체 동시 시작 100명까지 즉시 통과 + 1.7r/s 지속. Google /token이 valid code/refresh_token 없이 어떤 권한도 발급 안 하므로 abuse 측면도 충분.

**M6 — njs로 구현한 이유**: stock nginx의 `if ($request_body ~ ...)`는 REWRITE 단계 평가라 body buffering 전 시점일 수 있음 → 신뢰 불가 (no-op guard 위험). njs `js_content`는 body buffered 후 호출 보장.

**named location의 proxy_pass URI 제약**: `location @name`은 `proxy_pass https://host/path`를 못 가짐. `rewrite ^ /token break` + URI 없는 `proxy_pass https://host`로 우회.

## 검증 결과

```
$ curl -sSI https://dev.anglican.kr/ | grep -i permissions-policy
Permissions-Policy: ...12 directives...

$ # 정상 body — Google에 forward되어 invalid_grant 응답
$ curl -X POST .../oauth/token -d "grant_type=refresh_token&refresh_token=invalid&client_id=test"
{"error":"invalid_grant","error_description":"Bad Request"} HTTP 400

$ # body에 client_secret=fake — Google 도달 전 njs 가드가 차단
$ curl -X POST .../oauth/token -d "grant_type=refresh_token&client_secret=fake&..."
{"error":"invalid_request","error_description":"client_secret must not be sent by client"} HTTP 400

$ # 150 병렬 → burst 100 + 약간 sustain → 102 통과(401) + 48 × 503
$ seq 1 150 | xargs -n1 -P150 -I{} curl ... | sort | uniq -c
    102 401
     48 503
```

## Test plan
- [x] curl로 세 항목 검증 (위 참조)
- [x] `nginx -t` 통과, reload 성공
- [ ] 정상 사용자 첫 연결 + silent refresh 흐름이 깨지지 않는지 SPA 시운전
- [ ] 사용자가 의도적으로 body에 `client_secret=` 보내는 케이스 (테스트 외엔 없음) → 400

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches the `/oauth/token` proxy path and adds request rejection/rate limiting, which could block legitimate auth flows if misconfigured or tuned too aggressively.
> 
> **Overview**
> Hardens the nginx OAuth token BFF by adding IP-based rate limiting for `/oauth/token` and splitting the proxy into an external entry location plus an internal upstream location that injects `client_secret`.
> 
> Introduces an njs `js_content` guard that inspects the buffered form body (with proper URL-decoding of keys) and returns `400` if a client-supplied `client_secret` is present, preventing parameter pollution before forwarding to Google.
> 
> Expands the `Permissions-Policy` header to explicitly disable additional browser capabilities (`clipboard-read`, `fullscreen`, `display-capture`, `interest-cohort`, `browsing-topics`).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 1cf4bea2d3c677c16ccc1d51d60151b4c061cc98. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
