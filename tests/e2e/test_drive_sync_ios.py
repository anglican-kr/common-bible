"""iOS Drive sync e2e tests.

Phase 2h 단계 4 이후 — 인증 흐름이 데스크탑/Android/iOS 동일하게 PKCE
Authorization Code + refresh token로 통일됐다. iOS 전용으로 따로 검증할 만한
지점은 다음 두 가지뿐:
  1. iOS UA 감지가 여전히 동작 (다른 기능에서 분기를 위해 유지)
  2. PKCE redirect round-trip이 iPhone Safari UA에서도 정상 동작
  3. PKCE 콜백 보안 회귀 (state_mismatch 등)도 iOS UA에서 동일하게 동작

기존 active-reading 401 defer / FedCM / silent-blocked / silent prompt=none
재시도 / cap loop redirect 등의 시나리오는 모두 단계 4에서 흐름 자체가
사라졌으므로 제거됐다 (refresh token이 모든 silent 갱신을 담당).

Run with the dev server active:
    python3 scripts/serve.py 8080
    pytest tests/e2e/test_drive_sync_ios.py -v
"""

import json
import threading
import urllib.parse
import pytest
from playwright.sync_api import Page, BrowserContext, Route


BASE_URL = "http://localhost:8080"

IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 "
    "Mobile/15E148 Safari/604.1"
)


# ── Fake Drive (subset of test_drive_sync.py FakeDrive) ───────────────────────

class FakeDrive:
    def __init__(self):
        self._lock = threading.Lock()
        self._file: dict | None = None
        self._etag = "etag-0"
        self._etag_n = 0

    def reset(self):
        with self._lock:
            self._file = None
            self._etag = "etag-0"
            self._etag_n = 0

    def handle(self, route: Route):
        req = route.request
        url = req.url

        if "spaces=appDataFolder" in url and "fields=files" in url:
            with self._lock:
                files = [{"id": "sync-file-id"}] if self._file is not None else []
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"files": files}))
            return

        if "sync-file-id?alt=media" in url:
            with self._lock:
                if self._file is None:
                    route.fulfill(status=404)
                    return
                route.fulfill(
                    status=200, content_type="application/json",
                    headers={"ETag": self._etag},
                    body=json.dumps(self._file),
                )
            return

        if "uploadType=media" in url and "sync-file-id" in url:
            if_match = req.headers.get("if-match")
            with self._lock:
                if if_match and if_match != self._etag:
                    route.fulfill(status=412)
                    return
                self._etag_n += 1
                self._etag = f"etag-{self._etag_n}"
                self._file = json.loads(req.post_data)
                route.fulfill(status=200, headers={"ETag": self._etag})
            return

        if "uploadType=multipart" in url:
            raw = req.post_data_buffer
            parts = raw.split(b"\r\n\r\n")
            doc_part = parts[-1].split(b"\r\n--")[0] if len(parts) > 1 else parts[-1]
            with self._lock:
                try:
                    self._file = json.loads(doc_part)
                except Exception:
                    self._file = {}
                self._etag_n += 1
                self._etag = f"etag-{self._etag_n}"
                route.fulfill(status=200, headers={"ETag": self._etag})
            return

        if "userinfo" in url:
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"email": "ios-user@example.com"}))
            return

        route.continue_()


# ── PKCE OAuth endpoint simulator ─────────────────────────────────────────────

class FakeOAuth:
    """Intercepts /auth (302 to ?code=…&state=…) and /token (returns tokens)."""

    def __init__(self):
        self.mode = "ok"
        self.error_code = "access_denied"
        self.code_value = "ios-mock-code"
        self.calls_auth = 0
        self.calls_token = 0

    def reset(self):
        self.mode = "ok"
        self.error_code = "access_denied"
        self.calls_auth = 0
        self.calls_token = 0

    def handle_auth(self, route: Route):
        self.calls_auth += 1
        url = route.request.url
        parsed = urllib.parse.urlparse(url)
        qs = urllib.parse.parse_qs(parsed.query)
        state = qs.get("state", [""])[0]
        redirect_uri = qs.get("redirect_uri", [BASE_URL + "/"])[0]

        if self.mode == "error":
            callback = f"{redirect_uri}?error={self.error_code}&state={state}"
        elif self.mode == "tampered_state":
            callback = f"{redirect_uri}?code={self.code_value}&state=TAMPERED"
        else:
            callback = f"{redirect_uri}?code={self.code_value}&state={state}"

        route.fulfill(status=302, headers={"Location": callback})

    def handle_token(self, route: Route):
        self.calls_token += 1
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({
                "access_token": "ios-mock-access-token",
                "refresh_token": "ios-mock-refresh-token",
                "expires_in": 3600,
                "scope": "https://www.googleapis.com/auth/drive.appdata email",
                "token_type": "Bearer",
            }),
        )


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def fake_drive():
    drive = FakeDrive()
    yield drive
    drive.reset()


@pytest.fixture
def fake_oauth():
    oauth = FakeOAuth()
    yield oauth
    oauth.reset()


def _make_ios_page(browser, fake_drive, fake_oauth) -> Page:
    """Page with iPhone UA; touch enabled so isIOS() returns true."""
    ctx: BrowserContext = browser.new_context(
        user_agent=IPHONE_UA,
        viewport={"width": 390, "height": 844},
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
    )
    page = ctx.new_page()
    page.route("**/*googleapis.com/drive/**", fake_drive.handle)
    page.route("**/*googleapis.com/upload/**", fake_drive.handle)
    page.route("**/*googleapis.com/oauth2/v3/userinfo", fake_drive.handle)
    # SPA POSTs to same-origin /oauth/token (BFF, ADR-017). See test_drive_sync.py.
    page.route("**/oauth/token", fake_oauth.handle_token)
    page.route("**/accounts.google.com/o/oauth2/**", fake_oauth.handle_auth)
    return page


def _load(page: Page):
    page.goto(BASE_URL)
    # Mobile viewport hides the desktop search input, so wait for the
    # drive-sync module to publish itself instead.
    page.wait_for_function(
        "() => window.driveSync && window.syncTransport", timeout=10_000,
    )


def _wait_idle(page: Page, timeout=10_000):
    page.wait_for_function(
        "() => window.driveSync?.getStatus() === 'IDLE'", timeout=timeout,
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_ios_detected_by_user_agent(browser, fake_drive, fake_oauth):
    """isIOS() returns true under iPhone UA."""
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        assert page.evaluate("window.syncTransport.isIOS()") is True
    finally:
        page.context.close()


def test_ios_signin_redirect_round_trip(browser, fake_drive, fake_oauth):
    """signIn() → /auth redirect → callback → /token exchange → IDLE."""
    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => window.driveSync?.isAuthenticated() === true", timeout=15_000,
        )
        _wait_idle(page)

        assert fake_oauth.calls_auth == 1, "OAuth /auth should be called exactly once"
        assert fake_oauth.calls_token >= 1, "OAuth /token should be called at least once"
        assert "code=" not in page.evaluate("location.search"), "code stripped from URL"
        assert page.evaluate("window.driveSync.getStatus()") == "IDLE"
    finally:
        page.context.close()


def test_ios_callback_state_mismatch_rejected(browser, fake_drive, fake_oauth):
    """Tampered state in callback → token rejected, no auth, NEEDS_CONSENT."""
    fake_drive.reset()
    fake_oauth.mode = "tampered_state"
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        # Wait for the post-redirect load to settle.
        page.wait_for_function(
            "() => location.search === ''", timeout=15_000,
        )
        # ENABLE → _attemptSilentRefresh is async; poll for NEEDS_CONSENT.
        page.wait_for_function(
            "() => window.driveSync.getStatus() === 'NEEDS_CONSENT'",
            timeout=5_000,
        )
        assert page.evaluate("window.driveSync.isAuthenticated()") is False
    finally:
        page.context.close()


def test_ios_callback_error_param_rejected(browser, fake_drive, fake_oauth):
    """error=access_denied in callback → token rejected, NEEDS_CONSENT."""
    fake_drive.reset()
    fake_oauth.mode = "error"
    fake_oauth.error_code = "access_denied"
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => location.search === ''", timeout=15_000,
        )
        page.wait_for_function(
            "() => window.driveSync.getStatus() === 'NEEDS_CONSENT'",
            timeout=5_000,
        )
        assert page.evaluate("window.driveSync.isAuthenticated()") is False
    finally:
        page.context.close()


def test_ios_returnto_preserved_through_redirect(browser, fake_drive, fake_oauth):
    """Original pathname is restored after the redirect round-trip."""
    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("history.pushState(null, '', '/gen/1')")
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => window.driveSync?.isAuthenticated() === true", timeout=15_000,
        )
        path = page.evaluate("location.pathname")
        assert path == "/gen/1", f"Expected /gen/1 after callback, got {path}"
        assert page.evaluate("location.search") == ""
    finally:
        page.context.close()


def test_ios_state_mismatch_preserves_session_storage(browser, fake_drive, fake_oauth):
    """A bogus callback with mismatched state must NOT consume the legitimate
    sessionStorage state — otherwise an attacker-crafted error URL clobbers
    an in-flight OAuth round-trip and the real callback fails with no_state.
    """
    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        # Plant a legitimate-looking saved PKCE state.
        page.evaluate("""
            sessionStorage.setItem('bible-drive-redirect-state-pkce', JSON.stringify({
                nonce: 'real-nonce-xyz',
                verifier: 'v'.repeat(43),
                returnTo: '/',
                ts: Date.now(),
                flow: 'pkce-v1',
            }));
        """)

        # Simulate an attacker-crafted error URL with a wrong state.
        result = page.evaluate("""
            (() => {
                history.replaceState(null, '', '/?error=access_denied&state=ATTACKER');
                return window.syncTransport.consumeRedirectCallback();
            })()
        """)
        assert result == {"ok": False, "reason": "state_mismatch"}, \
            f"Expected state_mismatch, got {result}"

        # The legitimate state must still be intact for the real callback.
        saved = page.evaluate(
            "sessionStorage.getItem('bible-drive-redirect-state-pkce')"
        )
        assert saved is not None, "sessionStorage state was clobbered"
        parsed = json.loads(saved)
        assert parsed["nonce"] == "real-nonce-xyz"
    finally:
        page.context.close()


def test_ios_callback_error_preserves_returnto(browser, fake_drive, fake_oauth):
    """Error/expired callbacks must surface the saved returnTo so the user
    lands back on the chapter they were reading."""
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        # Plant a saved state with a specific returnTo path.
        page.evaluate("""
            sessionStorage.setItem('bible-drive-redirect-state-pkce', JSON.stringify({
                nonce: 'preserve-rt-nonce',
                verifier: 'v'.repeat(43),
                returnTo: '/gen/3',
                ts: Date.now(),
                flow: 'pkce-v1',
            }));
        """)
        # Simulate Google denying consent — error response with matching state.
        result = page.evaluate("""
            (() => {
                history.replaceState(null, '', '/?error=access_denied&state=preserve-rt-nonce');
                return window.syncTransport.consumeRedirectCallback();
            })()
        """)
        assert result == {
            "ok": False, "reason": "access_denied", "returnTo": "/gen/3",
        }, f"Error response missing returnTo: {result}"
    finally:
        page.context.close()


def test_ios_disabled_enable_parks_in_needs_consent(browser, fake_drive, fake_oauth):
    """Cold-start iOS sync (no refresh token in IDB) must park in NEEDS_CONSENT
    immediately so the user can click "연결" to redirect."""
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        # Pre-enable sync without any pending token (simulates a previously
        # connected user opening the app fresh after losing the in-memory
        # token AND with empty refresh-store IDB).
        page.add_init_script(
            "localStorage.setItem('bible-drive-sync', '1');"
        )
        _load(page)
        page.wait_for_function(
            "() => window.driveSync.getStatus() === 'NEEDS_CONSENT'",
            timeout=5000,
        )
    finally:
        page.context.close()
