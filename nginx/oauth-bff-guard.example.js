// OAuth /token BFF guard (njs).
//
// 배포 절차:
//   1. 이 파일 내용을 서버의 /etc/nginx/njs/oauth-bff-guard.js로 복사
//   2. /etc/nginx/conf.d/oauth-bff-shared.conf의 `js_path` + `js_import`가
//      이 파일을 로드 (오타 시 nginx -t 단계에서 잡힘)
//   3. nginx -t → systemctl reload nginx
//
// 동작:
//   `location = /oauth/token`이 `js_content oauth_bff_guard.guardAndForward`로
//   이 함수에 진입. body가 buffered된 상태에서 호출되므로 `r.requestText`
//   접근 가능. body에 클라이언트가 보낸 `client_secret=`가 있으면 400 반환,
//   없으면 내부 named location `@oauth_token_upstream`으로 redirect → 거기서
//   `proxy_set_body "$request_body&client_secret=<SECRET>"` + Google forward.
//
// Why 별도 njs?
//   nginx stock의 `if ($request_body ~ "...")`는 REWRITE phase에 평가되는데
//   body buffering은 CONTENT phase에서 일어나므로 if 시점엔 빈 문자열일 가능성
//   → no-op guard가 됨. njs `js_content`는 body buffered 후 호출이 보장되므로
//   r.requestText에 실제 body가 들어와 검사 가능.
//
// 위협 모델:
//   - RFC 6749 §3.2가 token endpoint 파라미터 중복을 금지. 클라이언트가
//     `client_secret=fake&...` 보내면 nginx가 `&client_secret=<real>` 추가 →
//     duplicate. Google이 마지막 값(real) 채택해 secret oracle은 안 되지만
//     표준 위배 트래픽은 early reject가 정도.
//   - guard 미통과 시 body는 server-side에서 그대로 폐기 (nginx context 종료).

function guardAndForward(r) {
    const body = r.requestText || "";

    // application/x-www-form-urlencoded는 키도 percent-encoding/+ 인코딩을
    // 허용하므로 raw 문자열 regex 매칭은 우회 가능 (예: `client%5Fsecret=fake`,
    // `client+secret=fake`). Google의 form 파서는 디코드 후 매칭하므로
    // `client%5Fsecret=fake&...&client_secret=<our>`처럼 RFC §3.2 위배 중복이
    // 만들어진다. 각 파라미터 키를 명시적으로 디코드한 뒤 비교해 차단.
    const params = body.split("&");
    for (var i = 0; i < params.length; i++) {
        var p = params[i];
        if (!p) continue;
        var eq = p.indexOf("=");
        var rawKey = eq >= 0 ? p.substring(0, eq) : p;
        var key;
        try {
            // form-urlencoded는 `+`를 공백으로 디코드하므로 먼저 치환,
            // 그다음 percent-decode.
            key = decodeURIComponent(rawKey.replace(/\+/g, "%20")).toLowerCase();
        } catch (_) {
            // 잘못된 percent-encoding은 nginx/Google이 어떻게 처리하든 보내고
            // 거기서 거부받게 둠. 우리 가드 역할이 아님.
            continue;
        }
        if (key === "client_secret") {
            r.return(400, JSON.stringify({
                error: "invalid_request",
                error_description: "client_secret must not be sent by client"
            }) + "\n");
            return;
        }
    }

    r.internalRedirect("@oauth_token_upstream");
}

export default { guardAndForward };
