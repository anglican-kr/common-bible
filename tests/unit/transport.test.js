// ── Unit tests for js/sync/transport.js ─────────────────────────────────────
// Run with: node --test tests/unit/transport.test.js
//
// Currently exercises the PKCE primitives + `/token` endpoint helpers.
// Drive REST helpers (findSyncFileId / downloadSyncFile / uploadSyncFile /
// deleteSyncFile) are not yet covered; future cases will land here under
// additional `// ── <영역> ──` sections (per ADR-013 2026-05-09 naming
// convention: one test file per source module).
//
// Loads transport.js into a vm context with location/sessionStorage/fetch
// stubs and Node's real Web Crypto. The RFC 7636 §4.2 verifier→challenge
// test vector is exercised end-to-end, plus all happy/error paths for the
// /token endpoint helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTransport } from "./harness.js";

// Objects returned from the vm context carry that context's Object prototype,
// which makes deepStrictEqual reject them as "structurally equal but not
// reference-equal". JSON round-trip strips the prototype back to the test
// realm's plain Object.
const norm = (v) => JSON.parse(JSON.stringify(v));

// ── PKCE primitives ──────────────────────────────────────────────────────────

test("1. generatePKCEPair: verifier는 43자 base64url 문자만", async () => {
  const { transport } = loadTransport();
  const { verifier, challenge } = await transport.generatePKCEPair();
  // RFC 7636 §4.1: verifier 길이 43-128, character set [A-Z][a-z][0-9]-._~
  assert.equal(verifier.length, 43, "32바이트 base64url-no-padding은 43자");
  assert.match(verifier, /^[A-Za-z0-9_-]+$/, "base64url 문자셋만");
  assert.match(challenge, /^[A-Za-z0-9_-]+$/, "challenge도 base64url 문자셋");
  assert.equal(challenge.length, 43, "SHA-256(32바이트) → 32바이트 → base64url 43자");
});

test("2. generatePKCEPair: 두 번 호출하면 매번 다른 verifier", async () => {
  const { transport } = loadTransport();
  const a = await transport.generatePKCEPair();
  const b = await transport.generatePKCEPair();
  assert.notEqual(a.verifier, b.verifier);
  assert.notEqual(a.challenge, b.challenge);
});

test("3. RFC 7636 §4.2 부록 B 테스트 벡터 일치", async () => {
  // RFC 7636 Appendix B: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  // → SHA-256 → base64url → "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
  // 이 검증이 깨지면 Google이 모든 token 교환을 invalid_grant로 거절한다.
  const { transport, ctx } = loadTransport();
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  // Use the internal _sha256Base64Url path indirectly: we generate a pair,
  // but to test the exact vector we re-derive challenge from a fixed verifier.
  // transport.js doesn't export _sha256Base64Url directly — so call subtle.digest
  // the same way generatePKCEPair does, then compare.
  const buf = await ctx.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  const challenge = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(
    challenge,
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    "RFC 7636 부록 B 벡터와 정확히 일치해야 Google이 검증 통과",
  );
});

// ── beginRedirectAuth ────────────────────────────────────────────────────

test("4. beginRedirectAuth: location.href에 올바른 OAuth URL 설정", async () => {
  const { transport, location, sessionStorage } = loadTransport({
    location: { pathname: "/gen/3", search: "" },
  });
  await transport.beginRedirectAuth("client-id-x", "scope-x", { prompt: "consent" });

  assert.equal(location._hrefAssignments.length, 1);
  const url = new URL(location._hrefAssignments[0]);
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-id-x");
  assert.equal(url.searchParams.get("scope"), "scope-x");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:8080/");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.match(url.searchParams.get("code_challenge") ?? "", /^[A-Za-z0-9_-]+$/);
  assert.match(url.searchParams.get("state") ?? "", /^[a-f0-9]{64}$/, "32바이트 hex nonce");

  // sessionStorage에 verifier+nonce+returnTo+flow 저장
  const saved = JSON.parse(sessionStorage.getItem("bible-drive-redirect-state-pkce"));
  assert.equal(saved.flow, "pkce-v1");
  assert.equal(saved.returnTo, "/gen/3");
  assert.equal(typeof saved.verifier, "string");
  assert.equal(saved.verifier.length, 43);
  assert.equal(saved.nonce, url.searchParams.get("state"));

  // 별도 키에 history.length snapshot 저장 — 콜백 단발 소비와 분리해서
  // state-machine의 back-nav guard가 점프 거리를 계산하는 데 사용.
  const backNav = JSON.parse(sessionStorage.getItem("bible-drive-back-nav-context"));
  assert.equal(backNav.historyLengthAtRedirect, 1);
  assert.equal(typeof backNav.ts, "number");
});

test("5. beginRedirectAuth: prompt 옵션이 없으면 URL에 prompt 파라미터 미포함", async () => {
  // Phase 2h 단계 4 이후 prompt=none silent re-auth는 더 이상 사용하지 않음
  // (refresh token으로 갱신). prompt 옵션을 안 주면 URL에도 안 들어가야 함.
  const { transport, location } = loadTransport();
  await transport.beginRedirectAuth("c", "s");
  const url = new URL(location._hrefAssignments[0]);
  assert.equal(url.searchParams.get("prompt"), null);
});

test("6. beginRedirectAuth: 저장된 email이 있으면 login_hint 추가", async () => {
  const { transport, location } = loadTransport({
    localStorageInit: { "bible-drive-sync-email": "user@example.com" },
  });
  await transport.beginRedirectAuth("c", "s");
  const url = new URL(location._hrefAssignments[0]);
  assert.equal(url.searchParams.get("login_hint"), "user@example.com");
});

test("7. beginRedirectAuth: code_challenge가 verifier의 SHA-256 base64url과 일치", async () => {
  const { transport, location, sessionStorage, ctx } = loadTransport();
  await transport.beginRedirectAuth("c", "s");
  const url = new URL(location._hrefAssignments[0]);
  const saved = JSON.parse(sessionStorage.getItem("bible-drive-redirect-state-pkce"));

  const buf = await ctx.crypto.subtle.digest("SHA-256", new TextEncoder().encode(saved.verifier));
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  const expected = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(url.searchParams.get("code_challenge"), expected);
});

// ── consumeRedirectCallback ──────────────────────────────────────────────

test("8. consumeRedirectCallback: callback 없으면 null", () => {
  const { transport } = loadTransport({ location: { search: "" } });
  assert.equal(transport.consumeRedirectCallback(), null);
});

test("9. consumeRedirectCallback: 정상 callback → {ok:true, code, verifier}", async () => {
  // 먼저 begin으로 state 만들고, 같은 nonce로 callback URL 시뮬레이션
  const { transport, sessionStorage } = loadTransport();
  await transport.beginRedirectAuth("c", "s");
  const saved = JSON.parse(sessionStorage.getItem("bible-drive-redirect-state-pkce"));

  // location.search를 callback URL로 교체하고 다시 transport 인스턴스 만듦
  // (transport는 vm scope의 location 객체를 그대로 참조)
  const { transport: t2, sessionStorage: ss2 } = loadTransport({
    location: { search: `?code=auth-code-xyz&state=${saved.nonce}` },
    sessionStorageInit: { "bible-drive-redirect-state-pkce": JSON.stringify(saved) },
  });
  const result = t2.consumeRedirectCallback();

  assert.deepEqual(norm(result), {
    ok: true,
    code: "auth-code-xyz",
    verifier: saved.verifier,
    returnTo: saved.returnTo || "/",
  });
  // single-use: state should be cleared
  assert.equal(ss2.getItem("bible-drive-redirect-state-pkce"), null);
});

test("10. consumeRedirectCallback: nonce 불일치 → state_mismatch (state 보존)", () => {
  const saved = JSON.stringify({
    nonce: "real-nonce", verifier: "v".repeat(43), returnTo: "/",
    ts: Date.now(), flow: "pkce-v1", silent: false,
  });
  const { transport, sessionStorage } = loadTransport({
    location: { search: "?code=c&state=ATTACKER" },
    sessionStorageInit: { "bible-drive-redirect-state-pkce": saved },
  });
  const result = transport.consumeRedirectCallback();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "state_mismatch");
  // state_mismatch는 sessionStorage 보존 (진짜 callback이 늦게 도착할 수 있음)
  assert.equal(sessionStorage.getItem("bible-drive-redirect-state-pkce"), saved);
});

test("11. consumeRedirectCallback: 다른 flow 버전의 state면 null (forward-compat)", () => {
  // 향후 새 flow 버전(예: pkce-v2)을 도입하더라도 v1 consumer가 그 state를
  // 잘못 소비하지 않도록 차단. flow 필드 검사 자체의 회귀 방어.
  const futureFlowState = JSON.stringify({
    nonce: "n", returnTo: "/", ts: Date.now(), flow: "pkce-v2", silent: false,
  });
  const { transport } = loadTransport({
    location: { search: "?code=c&state=n" },
    sessionStorageInit: { "bible-drive-redirect-state-pkce": futureFlowState },
  });
  assert.equal(transport.consumeRedirectCallback(), null);
});

test("12. consumeRedirectCallback: state 만료 (>10분) → state_expired", () => {
  const expired = JSON.stringify({
    nonce: "n", verifier: "v".repeat(43), returnTo: "/foo",
    ts: Date.now() - 11 * 60 * 1000, flow: "pkce-v1", silent: false,
  });
  const { transport } = loadTransport({
    location: { search: "?code=c&state=n" },
    sessionStorageInit: { "bible-drive-redirect-state-pkce": expired },
  });
  const result = transport.consumeRedirectCallback();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "state_expired");
  assert.equal(result.returnTo, "/foo");
});

test("13. consumeRedirectCallback: error param → 해당 reason + returnTo 보존", () => {
  const saved = JSON.stringify({
    nonce: "n", verifier: "v".repeat(43), returnTo: "/gen/5",
    ts: Date.now(), flow: "pkce-v1",
  });
  const { transport } = loadTransport({
    location: { search: "?error=access_denied&state=n" },
    sessionStorageInit: { "bible-drive-redirect-state-pkce": saved },
  });
  const result = transport.consumeRedirectCallback();
  assert.deepEqual(norm(result), {
    ok: false,
    reason: "access_denied",
    returnTo: "/gen/5",
  });
});

test("14. consumeRedirectCallback: state 없음 → no_state", () => {
  const { transport } = loadTransport({
    location: { search: "?code=c&state=anything" },
  });
  const result = transport.consumeRedirectCallback();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_state");
});

test("14b. beginRedirectAuth: 별도 키에 back-nav snapshot도 함께 저장", async () => {
  // history.length를 일부러 다르게 두고 snapshot에 그대로 반영되는지 확인.
  // state-machine의 back-nav guard가 점프 거리를 계산할 때 이 값을 쓴다.
  const { transport, history, sessionStorage } = loadTransport();
  history.length = 5;
  await transport.beginRedirectAuth("c", "s");
  const backNav = JSON.parse(sessionStorage.getItem("bible-drive-back-nav-context"));
  assert.equal(backNav.historyLengthAtRedirect, 5);
  assert.equal(typeof backNav.ts, "number");
});

test("14c. beginRedirectAuth: back-nav snapshot은 redirect-state 소비와 무관하게 유지", async () => {
  // consumeRedirectCallback이 redirect-state-pkce 키를 소비해도 back-nav 키는
  // 그대로 살아남아야 한다 (state-machine이 콜백 한참 뒤에 읽기 때문).
  const { transport, sessionStorage } = loadTransport();
  await transport.beginRedirectAuth("c", "s");
  const saved = JSON.parse(sessionStorage.getItem("bible-drive-redirect-state-pkce"));

  const { transport: t2, sessionStorage: ss2 } = loadTransport({
    location: { search: `?code=x&state=${saved.nonce}` },
    sessionStorageInit: {
      "bible-drive-redirect-state-pkce": JSON.stringify(saved),
      "bible-drive-back-nav-context": JSON.stringify({
        historyLengthAtRedirect: 3,
        ts: Date.now(),
      }),
    },
  });
  t2.consumeRedirectCallback();
  // redirect-state는 소비됐어도 back-nav 컨텍스트는 살아있음.
  assert.equal(ss2.getItem("bible-drive-redirect-state-pkce"), null);
  const backNav = JSON.parse(ss2.getItem("bible-drive-back-nav-context"));
  assert.equal(backNav.historyLengthAtRedirect, 3);
});

// ── exchangeCodeForToken ─────────────────────────────────────────────────────

test("15. exchangeCodeForToken: 성공 시 access+refresh+expires 반환", async () => {
  const { transport, fetchCalls } = loadTransport({
    fetch: async (_url, init) => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({
        access_token: "at-1", refresh_token: "rt-1",
        expires_in: 3599, scope: "drive.appdata email", token_type: "Bearer",
      }),
    }),
  });
  const result = await transport.exchangeCodeForToken("code-x", "verifier-y", "client-z");
  assert.deepEqual(norm(result), {
    ok: true,
    access_token: "at-1",
    refresh_token: "rt-1",
    expires_in: 3599,
    scope: "drive.appdata email",
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/oauth/token");
  assert.equal(fetchCalls[0].init.method, "POST");
  assert.equal(fetchCalls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  // body는 URLSearchParams 인스턴스 — string으로 변환해서 검증
  const body = fetchCalls[0].init.body.toString();
  assert.match(body, /grant_type=authorization_code/);
  assert.match(body, /code=code-x/);
  assert.match(body, /code_verifier=verifier-y/);
  assert.match(body, /client_id=client-z/);
  assert.match(body, /redirect_uri=http%3A%2F%2Flocalhost%3A8080%2F/);
  // client_secret은 nginx 프록시가 server-side에서 주입 — body에 없어야 함
  assert.doesNotMatch(body, /client_secret/);
});

test("16. exchangeCodeForToken: HTTP 400 + invalid_grant → 구조화된 실패", async () => {
  const { transport } = loadTransport({
    fetch: async () => ({
      ok: false, status: 400,
      headers: { get: () => null },
      json: async () => ({ error: "invalid_grant", error_description: "..." }),
    }),
  });
  const result = await transport.exchangeCodeForToken("c", "v", "id");
  assert.deepEqual(norm(result), { ok: false, status: 400, error: "invalid_grant" });
});

test("17. exchangeCodeForToken: 네트워크 실패 → {ok:false, status:0, error:'network'}", async () => {
  const { transport } = loadTransport({
    fetch: async () => { throw new Error("network down"); },
  });
  const result = await transport.exchangeCodeForToken("c", "v", "id");
  assert.deepEqual(norm(result), { ok: false, status: 0, error: "network" });
});

test("18. exchangeCodeForToken: 응답 JSON 파싱 실패해도 throw 안 함", async () => {
  const { transport } = loadTransport({
    fetch: async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => { throw new Error("not json"); },
    }),
  });
  const result = await transport.exchangeCodeForToken("c", "v", "id");
  // ok:true이지만 빈 응답으로 처리
  assert.equal(result.ok, true);
  assert.equal(result.access_token, "");
  assert.equal(result.refresh_token, "");
});

// ── refreshAccessToken ───────────────────────────────────────────────────────

test("19. refreshAccessToken: 정상 갱신 (rotation 없음) → refresh_token=null", async () => {
  const { transport, fetchCalls } = loadTransport({
    fetch: async (_url, _init) => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ access_token: "at-2", expires_in: 3600 }),
    }),
  });
  const result = await transport.refreshAccessToken("rt-stored", "client-z");
  assert.deepEqual(norm(result), {
    ok: true,
    access_token: "at-2",
    refresh_token: null, // ← 응답에 없으면 null, 호출자는 기존 값 보존
    expires_in: 3600,
  });
  const body = fetchCalls[0].init.body.toString();
  assert.match(body, /grant_type=refresh_token/);
  assert.match(body, /refresh_token=rt-stored/);
  assert.match(body, /client_id=client-z/);
  // client_secret은 nginx 프록시가 server-side에서 주입 — body에 없어야 함
  assert.doesNotMatch(body, /client_secret/);
});

test("20. refreshAccessToken: rotation 있음 → 새 refresh_token 반환", async () => {
  const { transport } = loadTransport({
    fetch: async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({
        access_token: "at-3",
        refresh_token: "rt-rotated",
        expires_in: 3600,
      }),
    }),
  });
  const result = await transport.refreshAccessToken("rt-old", "client");
  assert.equal(result.ok, true);
  assert.equal(result.refresh_token, "rt-rotated");
});

test("21. refreshAccessToken: invalid_grant (refresh token 만료) → 구조화된 실패", async () => {
  const { transport } = loadTransport({
    fetch: async () => ({
      ok: false, status: 400,
      headers: { get: () => null },
      json: async () => ({ error: "invalid_grant" }),
    }),
  });
  const result = await transport.refreshAccessToken("rt-expired", "client");
  assert.deepEqual(norm(result), { ok: false, status: 400, error: "invalid_grant" });
});

test("22. refreshAccessToken: 네트워크 실패 → {ok:false, status:0, error:'network'}", async () => {
  const { transport } = loadTransport({
    fetch: async () => { throw new Error("offline"); },
  });
  const result = await transport.refreshAccessToken("rt", "id");
  assert.deepEqual(norm(result), { ok: false, status: 0, error: "network" });
});

test("23. refreshAccessToken: refresh_token이 빈 문자열로 와도 null로 정규화", async () => {
  const { transport } = loadTransport({
    fetch: async () => ({
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ access_token: "at", refresh_token: "", expires_in: 3600 }),
    }),
  });
  const result = await transport.refreshAccessToken("rt", "id");
  // 빈 문자열은 "rotation 없음"과 동일하게 처리 — 호출자는 기존 값 유지
  assert.equal(result.refresh_token, null);
});
