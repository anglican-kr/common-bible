# ADR-017: OAuth `/token` 요청을 nginx BFF 프록시로 격리

- 일시: 2026-05-08
- 상태: 승인됨 — 적용 완료 (2026-05-08, 채택한 날 적용)
- 관련: [ADR-001](001-spa-architecture.md), [ADR-011](011-bookmark-sync.md), [ADR-020](020-monorepo-split.md), [`docs/archive/design/pkce-migration.md`](../archive/design/pkce-migration.md)

## 맥락

ADR-011 Phase 2h는 Drive 동기화의 인증을 OAuth 2.0 Authorization Code + PKCE + refresh token 한 가지 경로로 모았다. 그 직후 개발 환경에서 시험해 보니 `oauth2.googleapis.com/token` 요청이 다음 응답과 함께 실패했다.

```json
{
  "error": "invalid_request",
  "error_description": "client_secret is missing."
}
```

Phase 2h는 「PKCE를 쓰면 `client_secret`이 필요 없다(RFC 7636)」는 보안 가정을 전제로 했다. 그런데 이 가정이 Google의 「Web application」 클라이언트 타입에는 맞지 않았다. Google의 토큰 엔드포인트(token endpoint)는 클라이언트 타입에 따라 다르게 동작한다.

- **Web application** (우리가 쓰는 타입): PKCE를 써도 `client_secret`을 요구한다. RFC 7636과 다르게 동작하는 것이다.
- **iOS / Android / Desktop app**: PKCE만으로 충분하고 `client_secret`이 필요 없다.

이 동작은 [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) 문서에는 적혀 있지 않다. 그러나 여러 라이브러리(`angular-oauth2-oidc` 등)의 이슈 트래커와 커뮤니티 블로그(예: ktaka.blog 2025-07)가 같은 동작을 보고한다.

## 결정

`/oauth/token` 요청을 같은 출처(same-origin)의 nginx 프록시로 따로 처리한다. 브라우저는 자기 도메인의 `/oauth/token`으로 POST를 보낸다. nginx는 `proxy_set_body`로 `client_secret`을 서버 쪽에서 본문에 넣은 뒤 `https://oauth2.googleapis.com/token`으로 전달한다. 이처럼 브라우저 앱 대신 서버가 비밀값을 붙여 요청을 넘겨 주는 구조를 BFF(Backend for Frontend)라고 부른다.

```
브라우저 → POST https://{host}/oauth/token
              body: grant_type, code, code_verifier, client_id, redirect_uri

nginx   → POST https://oauth2.googleapis.com/token
              body: 위 + &client_secret={server-only-value}
```

가상 호스트(vhost)마다(`bible.anglican.kr`, `dev.anglican.kr`) 자기 OAuth 클라이언트의 비밀값을 별도 파일(`/etc/nginx/snippets/oauth-secret-{bible,dev}.conf`)에 두고, 사이트 설정 파일이 그 파일을 불러온다(`include`). 비밀값 파일은 root만 읽을 수 있다(2026-07-28부터). SPA 번들, git 이력, CDN 어디에도 비밀값이 없다.

`proxy_pass`는 Google 주소를 변수(`$google_oauth`)로 받고, nginx가 요청 때 DNS 서버(`resolver`)에 물어 주소를 찾는다. 설정을 읽을 때 DNS가 응답하지 않아도 nginx가 시작된다(2026-07-28부터, 아래 대안 E).

요청 빈도 제한(rate limit, M5)도 둔다. nginx의 `limit_req` 디렉티브(`limit_req zone=oauth_token`)가 `/oauth/token` 요청 수를 제한한다(아래 「구현 노트」). 2026-06-09에 njs 검사(M6)를 지울 때도 M5는 그대로 두었다.

nginx 설정 예시는 `common-bible-server` 저장소의 `nginx/oauth-proxy.example.conf`에, 비밀값 파일의 예시는 같은 폴더의 `oauth-secret.example.conf`에 있다(비공개 저장소라 링크하지 않는다). 처음에는 이 저장소에 있던 nginx 설정 예시 파일들(`oauth-proxy.example.conf`, `oauth-bff-shared.example.conf`, `oauth-bff-guard.example.js`, `security-headers.example.conf`)을 ADR-020의 저장소 분할 때(2026-05-11) `common-bible-server/nginx/`로 옮겼다. BFF 구조는 그대로다. 그 가운데 `oauth-bff-guard.example.js`는 아래 대안 D(M6)를 채택하지 않으면서(2026-06-09) 없어졌다.

## 검토한 대안

### A. SPA에 `client_secret`을 넣는다

`js/drive-sync.js`에 호스트별 비밀값 상수를 둔다(`client_id`처럼).

**채택하지 않은 이유:**
1. **GitHub의 비밀값 자동 감지(secret scanner)가 비밀값을 무효화한다**: `GOCSPX-` 패턴이 커밋되면 GitHub이 Google에 알리고, Google은 비밀값을 자동으로 끈다. 운영 중인 동기화가 바로 멈추는 사고가 된다.
2. **git 이력에 영원히 남는다**: 한 번 커밋하면 이력을 다시 쓰지 않는 한 지울 수 없다. 나중에 비밀값을 바꿔도 옛 값은 인터넷에 계속 드러나 있다.
3. **OAuth 2.1과 RFC 8252의 취지에 어긋난다**: 공개 클라이언트(public client)인 SPA에는 비밀값이 있으면 안 된다는 표준 권고와 정면으로 어긋난다.
4. **공격 표면이 넓어진다**: 다른 도메인에서 OAuth 흐름을 몰래 시작하려는 공격자가 우리 `client_id`와 비밀값을 그대로 쓸 수 있다. 출처 검증이 1차 방어이긴 하지만, 여러 겹으로 막는 방어(defense-in-depth)가 약해진다.

### B. 클라이언트 타입을 「Desktop app」으로 바꾼다

Google이 발급하는 OAuth 클라이언트 가운데 「Desktop app」이나 「Installed app」 타입은 비밀값 없이 PKCE만으로 동작한다.

**채택하지 않은 이유:**
1. **리디렉션 URI가 제한된다**: Desktop app 타입은 `http://127.0.0.1:port`나 `urn:ietf:wg:oauth:2.0:oob`(사용 중단 대상)만 허용한다. HTTPS 도메인을 등록할 수 없어 SPA에 맞지 않는다.
2. **검수 결과를 이어받는지 알 수 없다**: 새 클라이언트 ID를 만들면 기존 `drive.appdata` 권한 범위의 OAuth 검수 결과를 그대로 이어받는지 분명하지 않다. 다시 제출해야 할 수도 있고, 그동안 동기화가 멈출 위험이 있다.
3. **타입은 나중에 바꿀 수 없다**: Cloud Console에서 클라이언트 타입은 만든 뒤 바꿀 수 없다. 새로 만들어야 하는 큰 변경이다.

### C. 별도 백엔드 서버로 BFF를 만든다 (Node.js나 Python)

전용 백엔드 서버를 두고 OAuth 흐름 전체를 서버가 맡는다.

**채택하지 않은 이유:**
- ADR-001(SPA 결정)의 「백엔드 운영 인력·예산 0」 제약과 정면으로 어긋난다.
- OAuth `/token` 요청 하나를 위해 백엔드 전체를 두는 것은 지나치다.
- nginx만으로 충분한 일에 컨테이너, 런타임, 로그 인프라까지 갖춰야 한다.

### D. njs로 요청 본문을 검사한다 (M6, 2026-06-09까지)

- 채택한 뒤 `/oauth/token`에 보안 강화를 둘 더했다(그때 ADR 본문에는 적지 않았다). 하나는 요청 빈도 제한(M5, `limit_req zone=oauth_token`)으로, 지금도 쓴다(위 「결정」). 다른 하나가 njs 본문 검사(M6)다. `js_content`(njs)로 요청 본문을 읽어, 클라이언트가 `client_secret=`을 넣은 요청을 400으로 미리 거절했다. 파라미터가 겹치므로 RFC 6749 §3.2를 어기는 요청이다. 구조는 `location = /oauth/token`(검사)과 내부 `@oauth_token_upstream`(프록시)의 2단이었다.
- 채택 안 함(2026-06-09). 이유: 이 njs 검사가 **`libnginx-mod-http-js` 0.8.2에서 세그폴트(SIGSEGV)를 일으켰다**. `/oauth/token`으로 오는 **모든 POST**에서 `js_content` 핸들러가 워커를 죽였고(`worker exited on signal 11`), 연결은 `ERR_CONNECTION_RESET`으로 끊겼다. 이 기록은 커널과 journald에만 남고 접근 로그와 오류 로그에는 남지 않았다. 그 결과 운영 서버와 개발 서버 모두에서 조용한 토큰 갱신(silent refresh)과 새 로그인이 전부 실패해 **Drive 동기화가 완전히 멈췄다**. 앱 코드 `transport.js`는 1.5.12 이후 바뀌지 않아 원인과 무관했다.
  - 조치: njs 검사(M6)와 `@oauth_token_upstream` 블록을 지우고, 비밀값을 넣어 Google로 바로 전달하는 일을 **`location = /oauth/token` 하나**로 되돌렸다. 처음 「구현 노트」의 형태에 `limit_req`를 더한 것이다. 이때 `proxy_pass`에는 `https://oauth2.googleapis.com/token`을 그대로 적었다. 2026-07-28에 변수로 바꿨다(대안 E). 서버 쪽 변경은 `common-bible-server` 저장소(`nginx/oauth-proxy.example.conf` 등, 커밋 `2f4cbac`)에 있다.
  - 보안 영향은 없다. M6는 방어를 하나 더 둔 것이었다. 클라이언트가 본문에 `client_secret`을 넣어도 nginx가 서버 쪽 비밀값을 더 붙이므로 파라미터가 겹치고, Google이 RFC 6749 §3.2 위반으로 400을 돌려준다. 그래서 응답으로 비밀값을 알아낼 수 없다. 비밀값은 서버 쪽에서 넣으므로 클라이언트에 드러나지 않는다.
  - 다시 검토할 조건: njs를 다시 들이려면 그 버전에서 세그폴트가 고쳐졌는지 먼저 확인한다.

### E. `proxy_pass`에 Google 주소를 그대로 적는다 (2026-07-28까지)

- 주소를 그대로 적으면 nginx는 설정을 읽을 때 `oauth2.googleapis.com`의 IP 주소를 찾는다. 2026-05-29의 「invalid URL prefix」 오류(변수로 적은 `proxy_pass`와 `rewrite ... break`를 함께 쓴 순서 문제)를 겪은 뒤 이 방식을 썼다.
- 채택 안 함(2026-07-28). 이유: 서버의 DNS 서비스(`systemd-resolved`)가 다시 시작되는 사이에 설정 검사(`nginx -t`)가 이 주소를 찾지 못했고, nginx 전체가 시작되지 않았다.
  - 조치: 주소를 변수로 적고 `resolver`로 DNS 서버를 지정해, 요청 때 주소를 찾게 했다. `rewrite`는 쓰지 않고 `proxy_pass`에 경로(`/token`)를 직접 적으므로 5월의 오류는 생기지 않는다.
  - 다시 검토할 조건: 서버가 외부 DNS 서버를 쓸 수 없는 환경으로 옮기면, 이 방식은 토큰 요청마다 실패한다. 그때는 주소를 그대로 적는 방식과 서버 안의 DNS 서비스를 다시 비교한다.

## 채택 근거

1. **비밀값을 격리한다**: 브라우저, git, CDN 어디에도 `client_secret`이 없다. 서버의 비밀값 파일(`/etc/nginx/snippets/oauth-secret-{bible,dev}.conf`, 파일 권한 0600, 소유자 root:root)에만 있다. 사이트 설정 파일(`/etc/nginx/sites-available/{bible,dev}`, 파일 권한 0644)에는 비밀값이 없다. nginx는 설정을 root 권한으로 읽으므로 비밀값 파일을 읽을 수 있고, 요청을 처리하는 nginx 작업 프로세스(`www-data` 사용자)는 읽지 못한다.
2. **인프라 비용이 들지 않는다**: 이미 nginx로 정적 파일을 제공하고 있어 `location` 블록 하나를 더하면 된다. 새 서버나 런타임이 필요 없다.
3. **운영이 단순하다**: 비밀값을 바꿀 때는 비밀값 파일을 고치고 `nginx -s reload` 한 줄이면 된다. 코드 빌드나 배포와 상관없다.
4. **검수에 영향이 없다**: 클라이언트 ID가 그대로이므로 `drive.appdata` 검수 결과도 그대로 유효하다.
5. **공격 표면이 작다**: `/oauth/token`은 누구나 호출할 수 있지만, Google은 유효한 `code`와 `code_verifier`, 또는 `refresh_token`이 없으면 아무 권한도 주지 않는다. nginx는 요청을 전달하기만 하고 스스로 권한을 줄 수 없다.

## 보안 모델

### 1. 위협 시나리오와 방어

| 시나리오 | 방어 |
|---------|-----|
| 공격자가 `/oauth/token`에 아무 요청이나 보낸다 | Google이 invalid_grant, invalid_client 등으로 거절한다. nginx는 전달만 하고 스스로 권한을 줄 수 없다 |
| 공격자가 우리 `client_id`를 자기 도메인에서 쓴다 | Google이 Authorized JavaScript origins와 Redirect URIs를 검증해 거절한다. 이 ADR과 상관없는 1차 방어다 |
| 사용자 PC의 악성 프록시가 같은 호스트의 `/oauth/token`을 가로챈다 | 비밀값은 nginx가 내보낼 때 이미 합쳐지므로 가로채도 얻을 것이 없다. 가로챈 응답이 사용자 브라우저에 전달돼도 PKCE `code_verifier`가 `sessionStorage`에만 있어 다시 쓸 수 없다 |
| nginx 설정 파일이 유출된다 | 서버 관리자(root) 권한을 빼앗긴 경우다. 그때는 비밀값 말고도 모든 데이터가 위험하다. 이 ADR이 지키는 범위 밖이다 |
| GitHub 저장소가 공개된다 | nginx 설정 예시(`nginx/oauth-proxy.example.conf`)는 자리 표시 값(placeholder)만 담고, 실제 비밀값은 `.gitignore`된 서버 쪽 설정에만 있다. 예시 파일도 지금은 비공개 `common-bible-server` 저장소에 있다(ADR-020) |

### 2. 추가 검사

- **POST만 받는다**: `if ($request_method != POST) { return 405; }`로 스크래퍼와 사전 요청(preflight)을 막는다.
- **브라우저 헤더를 비운다**: nginx가 `Cookie`, `Authorization` 헤더를 비우고 Google 서버로 보낸다. 우리 도메인의 쿠키가 Google로 전달되지 않는다.
- **SNI를 적는다**: `proxy_ssl_server_name on; proxy_ssl_name oauth2.googleapis.com;`로 TLS 핸드셰이크에서 올바른 서버 인증서를 검증한다.
- **Cache API를 거치지 않는다**: 서비스 워커는 GET이 아닌 요청을 그냥 통과시킨다(`method !== "GET"` 검사). POST 응답을 캐시에 넣으려다(`cache.put`) `TypeError`가 나던 회귀도 함께 막는다.

## 받아들인 트레이드오프

- **비밀값은 서버에서만 바꿀 수 있다**: 비밀값이 nginx 설정에 있으므로 코드만 고쳐서는 바꿀 수 없다. 운영 자동화 스크립트가 필요할 수 있다(지금은 손으로 한다).
- **서비스 워커가 캐시할 수 없다**: `/oauth/token`은 POST이고 서비스 워커가 GET이 아닌 요청을 통과시키므로 오프라인 캐시가 안 된다. OAuth 자체가 온라인에서만 되므로 영향은 없다.
- **요청이 nginx를 거친다**: 모든 토큰 교환과 조용한 토큰 갱신이 nginx를 지난다. 사용자 행동 빈도(분 단위 동기화)에서는 무시할 만하다.
- **장애 지점이 하나다**: nginx가 멈추면 새 access token을 받을 수 없다. 정적 콘텐츠도 같은 nginx가 제공하므로 멈추는 범위는 같다.
- **토큰 요청이 외부 DNS 서버에 의존한다**: nginx는 요청 때 지정한 DNS 서버에 Google 주소를 묻고, 찾은 주소를 5분 동안 다시 쓴다(`valid=300s`). DNS 서버가 모두 응답하지 않으면 토큰 요청만 실패하고, 정적 콘텐츠는 그대로 제공된다(대안 E).

## 구현 노트

### 핵심 nginx 디렉티브

```nginx
location = /oauth/token {
    if ($request_method != POST) { return 405; }
    limit_req zone=oauth_token burst=100 nodelay;   # M5 rate limit (2026-06-09 대안 D 참조)
    client_body_buffer_size 4k;
    client_max_body_size 4k;

    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_set_header Content-Type "application/x-www-form-urlencoded";
    proxy_set_header Host oauth2.googleapis.com;

    include snippets/oauth-secret-bible.conf;       # dev는 oauth-secret-dev.conf

    proxy_ssl_server_name on;
    proxy_ssl_name oauth2.googleapis.com;

    resolver 1.1.1.1 8.8.8.8 valid=300s ipv6=off;    # 요청 때 주소를 찾는다 (대안 E)
    resolver_timeout 5s;
    set $google_oauth "oauth2.googleapis.com";
    proxy_pass https://$google_oauth/token;
}
```

비밀값 파일(`snippets/oauth-secret-bible.conf`, 권한 0600)에는 주석을 빼면 지시문 하나만 있다.

```nginx
proxy_set_body "$request_body&client_secret=<CLIENT_SECRET>";
```

요청 빈도 제한(M5)은 `limit_req zone=oauth_token`으로 분당 60회, `burst` 100을 둔다.

### SPA 쪽 변경

- `js/sync/transport.js`: `_OAUTH_TOKEN_URL = "/oauth/token"`(전에는 `https://oauth2.googleapis.com/token`).
- `exchangeCodeForToken`과 `refreshAccessToken`의 요청 본문에서 `client_secret`을 뺐다(서버가 넣는다).
- `js/drive-sync.js`: `_CLIENT_SECRET` 상수가 없다. `window._syncClientSecret`도 들이지 않았다.

### 회귀 방어

- `tests/unit/transport.test.js`(당시 `transport-pkce.test.js`): 요청 URL이 `/oauth/token`인지 확인하고, 본문에 `client_secret`이 없는지 `assert.doesNotMatch(body, /client_secret/)`로 확인한다.
- 동작 확인: `curl -X POST https://{host}/oauth/token -d "grant_type=refresh_token&refresh_token=invalid&client_id=..."`에 `400 invalid_grant` 응답이 오면 정상이다. `client_secret_missing`이 오면 nginx 설정이 빠진 것이다.

## 향후 고려

- **비밀값 교체 자동화**: 지금은 손으로 한다. Cloud Console에서 새 비밀값을 발급하고, 비밀값 파일을 고친 뒤, 설정을 다시 읽게 한다(reload). 분기마다 또는 사고가 났을 때 자동으로 바꾸려면 따로 스크립트와 비밀값 관리 도구가 필요하다.
- **OAuth 검수를 통과한 뒤 다시 본다**: Google이 검수를 통과한 클라이언트에 PKCE만으로 되는 경로를 열 수도 있다. 그런 발표가 나오면 BFF를 거치지 않는 단순한 구조를 검토한다.
