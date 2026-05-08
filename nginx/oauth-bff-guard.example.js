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

    // form-urlencoded 파라미터 키는 `&` 또는 body 시작 위치 다음에 옴.
    // `=`로 끝나는 키 매칭으로 prefix 충돌(예: `my_client_secret_extra`) 회피.
    if (/(?:^|&)client_secret=/i.test(body)) {
        r.return(400, JSON.stringify({
            error: "invalid_request",
            error_description: "client_secret must not be sent by client"
        }) + "\n");
        return;
    }

    r.internalRedirect("@oauth_token_upstream");
}

export default { guardAndForward };
