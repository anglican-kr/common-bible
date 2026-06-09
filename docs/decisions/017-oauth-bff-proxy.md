# ADR-017: OAuth `/token` 요청을 nginx BFF 프록시로 격리

**상태**: 채택됨 (2026-05-08)
**개정**: 2026-05-11 (ADR-020 분할에 따라 nginx 설정 파일들(`oauth-proxy.example.conf`·`oauth-bff-shared.example.conf`·`oauth-bff-guard.example.js`·`security-headers.example.conf`)은 `common-bible-server/nginx/`로 이전. BFF 패턴 자체는 그대로 유지.)
**개정**: 2026-06-09 (채택 후 추가됐던 njs body 가드(M6)가 njs 0.8.2 세그폴트를 일으켜 `/oauth/token` POST 전부 다운 → 가드 제거하고 단일 location 직접 proxy로 환원. `limit_req` rate limit(M5)은 유지. 상세는 아래 개정 블록.)
**관련**: [ADR-001](001-spa-architecture.md), [ADR-011](011-bookmark-sync.md), [ADR-020](020-monorepo-split.md), [`docs/archive/design/pkce-migration.md`](../archive/design/pkce-migration.md)

> **개정 (2026-06-09): njs body 가드 제거 — njs 0.8.2 세그폴트**
>
> 본 ADR 채택 후 `/oauth/token`에 두 가지 하드닝이 추가됐었다 (당시 ADR 본문엔 미반영):
> - **M5 — rate limit**: `limit_req zone=oauth_token` (아래 "향후 고려"의 rate limiting 항목 실행).
> - **M6 — njs body 가드**: `js_content`(njs)로 요청 body를 검사해, 클라이언트가
>   `client_secret=`을 끼워 넣은 RFC 6749 §3.2 위반(파라미터 중복) 트래픽을 400으로 early
>   reject. 구조는 `location = /oauth/token`(가드) + 내부 `@oauth_token_upstream`(proxy) 2단.
>
> 2026-06-09, 이 njs 가드가 **`libnginx-mod-http-js` 0.8.2에서 세그폴트(SIGSEGV)**를 일으키는
> 것이 확인됐다. `/oauth/token`으로 오는 **모든 POST**가 `js_content` 핸들러에서 워커를 죽여
> (`worker exited on signal 11` — kernel/journald에만 기록, access·error 로그엔 무기록) 연결이
> `ERR_CONNECTION_RESET`으로 끊겼다. 결과적으로 prod·dev 양쪽에서 silent refresh·신규 로그인이
> 전부 실패 → **Drive 동기화 전면 중단**. (앱 코드 `transport.js`는 1.5.12 이후 무변경이라 무관.)
>
> **조치**: njs 가드(M6)와 `@oauth_token_upstream` 블록을 제거하고, secret 주입 + Google 직접
> proxy를 **단일 `location = /oauth/token`**으로 환원했다 (= 본 ADR "구현 노트"의 원래 형태 +
> `limit_req`). `proxy_pass`는 literal `https://oauth2.googleapis.com/token`.
>
> **보안 영향 없음**: M6는 방어적 부가장치였다. 클라이언트가 body에 `client_secret`을 끼워
> 넣어도 nginx가 server-side secret을 추가해 파라미터가 중복되며 Google이 RFC 6749 §3.2 위반으로
> 400 거부한다(secret oracle 불가). secret은 server-side 주입이라 클라이언트로 절대 노출되지
> 않는다. M5(rate limit)는 유지.
>
> njs를 재도입하려면 세그폴트가 고쳐진 njs 버전인지 먼저 확인할 것. 서버 측 변경은
> `common-bible-server` 저장소(`nginx/oauth-proxy.example.conf` 등, commit `2f4cbac`)에 반영됨.

## 맥락

ADR-011 Phase 2h가 Drive 동기화 인증을 OAuth 2.0 Authorization Code + PKCE + refresh token 단일 경로로 통일한 직후, dev 환경 시운전에서 `oauth2.googleapis.com/token` 요청이 다음 응답으로 실패:

```json
{
  "error": "invalid_request",
  "error_description": "client_secret is missing."
}
```

원래 Phase 2h의 보안 가정 — "PKCE 채택 → `client_secret` 불요 (RFC 7636)" — 이 Google "Web application" 클라이언트 타입에는 적용되지 않음을 발견. Google의 token endpoint는 클라이언트 타입을 보고 다음과 같이 분기:

- **Web application** (우리 사용 타입): PKCE를 써도 `client_secret` 강제 (RFC 7636 일탈)
- **iOS / Android / Desktop app**: PKCE만으로 충분, `client_secret` 불요

이 동작은 [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) 문서에는 명시 안 됐지만 다수 라이브러리(`angular-oauth2-oidc` 등) issue tracker와 커뮤니티 블로그(예: ktaka.blog 2025-07)에서 일관되게 보고됨.

## 결정

`/oauth/token`을 same-origin nginx 프록시로 분리. 브라우저는 자기 도메인의 `/oauth/token`에 POST하고, nginx가 `proxy_set_body`로 `client_secret`을 server-side에서 body에 주입한 뒤 `https://oauth2.googleapis.com/token`으로 forward한다.

```
브라우저 → POST https://{host}/oauth/token
              body: grant_type, code, code_verifier, client_id, redirect_uri

nginx   → POST https://oauth2.googleapis.com/token
              body: 위 + &client_secret={server-only-value}
```

각 vhost(`bible.anglican.kr`, `dev.anglican.kr`)가 자기 OAuth 클라이언트의 secret을 nginx 설정에 보관. SPA 번들·git 이력·CDN 어디에도 secret 노출 없음.

예시 설정: [`nginx/oauth-proxy.example.conf`](../../nginx/oauth-proxy.example.conf).

## 검토한 대안

### A. SPA에 `client_secret` 임베드

`js/drive-sync.js`에 호스트별 secret 상수를 두는 방식 (`client_id`처럼).

**거부 사유:**
1. **GitHub secret scanner 자동 무효화**: `GOCSPX-` 패턴이 commit되면 GitHub이 Google에 통보 → secret 자동 비활성화. 운영 동기화 즉시 중단되는 운영 사고.
2. **git 이력 영구 잔존**: 한번 commit 하면 history rewrite 없이는 제거 불가. 향후 secret 로테이션해도 옛 값이 인터넷에 영구 노출.
3. **OAuth 2.1 / RFC 8252 정신 위배**: Public client(SPA)에 secret이 있어선 안 된다는 표준 권장에 정면 충돌.
4. **공격 표면 확대**: 다른 도메인에서 OAuth flow를 부정 시작하려는 공격자가 우리 client_id + secret 조합을 그대로 쓸 수 있음 (origin 검증이 1차 방어이긴 하지만, defense-in-depth 약화).

### B. 클라이언트 타입을 "Desktop app"으로 전환

Google이 발급하는 OAuth 클라이언트 중 "Desktop app" 또는 "Installed app" 타입은 PKCE만으로 secret 없이 동작.

**거부 사유:**
1. **Redirect URI 제약**: Desktop app 타입은 `http://127.0.0.1:port` 또는 `urn:ietf:wg:oauth:2.0:oob`(deprecated)만 허용. HTTPS 도메인 등록 불가 → SPA에 부적합.
2. **검수 결과 승계 불확실**: 새 클라이언트 ID를 만들면 기존 `drive.appdata` scope OAuth 검수가 자동 승계되는지 불명. 재제출이 필요할 수도 있고, 그 동안 동기화 중단 위험.
3. **타입 변경 후행**: Cloud Console에서 클라이언트 타입은 생성 후 변경 불가 — 새로 만들어야 하는 큰 변경.

### C. 풀 백엔드 BFF (Node.js / Python 서버)

전용 백엔드 서버를 두고 OAuth flow 전체를 server-mediated로 처리.

**거부 사유:**
- ADR-001(SPA 결정)의 "백엔드 운영 인력·예산 0" 제약과 정면 충돌.
- 단일 OAuth `/token` 요청을 위한 풀 백엔드는 과잉.
- nginx 만으로 충분한 일을 컨테이너·런타임·로깅 인프라까지 끌고 옴.

## 채택 근거

1. **secret 격리**: 브라우저·git·CDN 어디에도 `client_secret`이 없음. nginx 설정 파일(`/etc/nginx/sites-available/{bible,dev}`, mode 0644 root:root)에만 존재.
2. **인프라 비용 0**: 이미 nginx로 정적 호스팅을 하고 있어 location 블록 추가만으로 됨. 새 서버·런타임 도입 없음.
3. **운영 단순함**: secret 로테이션은 nginx 설정 수정 + `nginx -s reload` 한 줄. 코드 빌드·배포 사이클 무관.
4. **검수 영향 0**: 클라이언트 ID 자체는 변경 없음. `drive.appdata` 검수 결과 그대로 유효.
5. **공격 표면 최소**: `/oauth/token` 엔드포인트가 익명에게 열려 있지만, Google은 유효한 `code` + `code_verifier` 또는 `refresh_token` 없이는 어떤 권한도 발급하지 않음. nginx는 단순 relay이고 자체 권한 부여 불가.

## 보안 모델

### 1. 위협 시나리오와 방어 매트릭스

| 시나리오 | 방어 |
|---------|-----|
| 공격자가 `/oauth/token`에 임의 요청 | Google이 invalid_grant / invalid_client 등으로 거부. nginx는 단순 relay, 자체 권한 부여 불가 |
| 공격자가 우리 `client_id`를 자기 도메인에서 사용 | Google의 Authorized JavaScript origins / Redirect URIs 검증으로 거부. 본 ADR과 무관한 1차 방어 |
| 사용자 PC 악성 프록시가 같은 호스트로 `/oauth/token` 가로채기 | nginx 출력 시점에 secret이 이미 합쳐졌으므로 의미 있는 가로채기 불가능. 가로챈 응답이 사용자 브라우저에 도달해도 PKCE `code_verifier`가 sessionStorage에만 있어 재사용 불가 |
| nginx 설정 파일 유출 | 서버 root 권한 침해 시나리오. 그 시점이면 secret 외에도 모든 데이터가 위험. 본 ADR의 보호 범위 밖 |
| GitHub 저장소 공개 | `nginx/oauth-proxy.example.conf`는 placeholder만 담고 실제 secret은 `.gitignore`된 server-side 설정에만 존재 |

### 2. 추가 가드

- **POST 메서드만 허용**: `if ($request_method != POST) { return 405; }` — 스크래퍼/preflight 노이즈 차단.
- **브라우저 헤더 strip**: nginx가 `Cookie`, `Authorization` 헤더를 비워 upstream 전송. 우리 도메인의 쿠키가 Google로 새지 않음.
- **SNI 명시**: `proxy_ssl_server_name on; proxy_ssl_name oauth2.googleapis.com;` — TLS handshake에서 올바른 서버 인증서 검증.
- **Cache API 우회**: SW가 비-GET 요청을 통과시키도록 `method !== "GET"` 가드 (기존 cache.put POST TypeError 회귀 방어 겸).

## 받아들인 트레이드오프

- **운영 의존**: secret이 nginx 설정에 있으므로 server-side rotation 없이 코드 변경만으로는 secret 갱신 불가. 운영 자동화 스크립트가 필요할 수 있음 (현재 수동).
- **Service Worker 캐싱 불가**: `/oauth/token`은 POST이고 SW가 비-GET을 우회하므로 오프라인 캐싱 불가. OAuth 자체가 온라인 필수라 영향 없음.
- **요청량 부담**: 모든 token 교환 + silent refresh가 nginx를 거침. 사용자 행동 빈도(분 단위 sync)에서는 무시 가능.
- **단일 장애점**: nginx 장애 시 새 access token 발급 불가. 정적 콘텐츠 서빙도 같은 nginx에 의존하므로 장애 도메인이 동일.

## 구현 노트

### 핵심 nginx 디렉티브

```nginx
location = /oauth/token {
    if ($request_method != POST) { return 405; }
    limit_req zone=oauth_token burst=100 nodelay;   # M5 rate limit (개정 2026-06-09 참조)
    client_body_buffer_size 4k;
    client_max_body_size 4k;

    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_set_header Content-Type "application/x-www-form-urlencoded";
    proxy_set_header Host oauth2.googleapis.com;

    proxy_set_body "$request_body&client_secret=<CLIENT_SECRET>";

    proxy_ssl_server_name on;
    proxy_ssl_name oauth2.googleapis.com;

    proxy_pass https://oauth2.googleapis.com/token;
}
```

### SPA 측 변경

- `js/sync/transport.js`: `_OAUTH_TOKEN_URL = "/oauth/token"` (was `https://oauth2.googleapis.com/token`)
- `exchangeCodeForToken` / `refreshAccessToken` 요청 body에서 `client_secret` 제거 (server에서 주입)
- `js/drive-sync.js`: `_CLIENT_SECRET` 상수 없음. `window._syncClientSecret` 도입 안 함.

### 회귀 방어

- `tests/unit/transport.test.js`(당시 `transport-pkce.test.js`): URL 단언을 `/oauth/token`로, body의 `client_secret` 부재를 `assert.doesNotMatch(body, /client_secret/)`로 명시 검증.
- 동작 검증: `curl -X POST https://{host}/oauth/token -d "grant_type=refresh_token&refresh_token=invalid&client_id=..."` → `400 invalid_grant` 응답이 와야 정상. `client_secret_missing`이 뜨면 nginx 적용 누락.

## 향후 고려

- **secret 로테이션 자동화**: 현재 수동(Cloud Console에서 새 secret 발급 → nginx 설정 수정 → reload). 분기별 또는 incident 시 자동화하려면 별도 스크립트 + 시크릿 매니지먼트.
- ~~**Rate limiting**~~ → 구현됨(M5): `limit_req zone=oauth_token` (분당 60회 + burst 100). 개정(2026-06-09) 참조. (참고: 같이 추가됐던 njs body 가드(M6)는 세그폴트로 철회.)
- **OAuth 검수 통과 후 재검토**: Google이 검수 통과한 클라이언트에 한해 PKCE-only를 허용하는 경로를 향후 발표할 가능성. 발표되면 BFF 우회로 단순화 검토.
