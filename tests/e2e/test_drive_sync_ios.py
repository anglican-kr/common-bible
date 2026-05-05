"""iOS Drive sync e2e tests (Phase 2f — full-page redirect flow).

Safari does not support FedCM and PWA standalone mode blocks popups even from
user gestures. iOS therefore bypasses GIS Token Client entirely and uses OAuth
implicit flow via window.location.href. These tests simulate Google's auth
endpoint by intercepting the navigation and redirecting back to the app with
the access_token and state nonce in the URL hash.

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

        # Block the real GIS client library from loading; iOS path doesn't use
        # it, but drive-sync.js still emits the <script src> tag.
        if "gsi/client" in url:
            route.fulfill(status=200, content_type="application/javascript", body="")
            return

        route.continue_()


# ── OAuth endpoint simulator ──────────────────────────────────────────────────

class FakeOAuth:
    """Intercepts navigation to accounts.google.com/o/oauth2/v2/auth.

    Default behavior: redirect back to redirect_uri with a fresh access_token
    and the supplied state. Configurable per-test via attributes:
      • mode = "ok" | "error" | "tampered_state"
      • error_code = e.g. "access_denied"
    """

    def __init__(self):
        self.mode = "ok"
        self.error_code = "access_denied"
        self.token_value = "mock-redirect-token"
        self.calls = 0

    def reset(self):
        self.mode = "ok"
        self.error_code = "access_denied"
        self.calls = 0

    def handle(self, route: Route):
        self.calls += 1
        url = route.request.url
        parsed = urllib.parse.urlparse(url)
        qs = urllib.parse.parse_qs(parsed.query)
        state = qs.get("state", [""])[0]
        redirect_uri = qs.get("redirect_uri", [BASE_URL + "/"])[0]

        if self.mode == "error":
            callback = f"{redirect_uri}#error={self.error_code}&state={state}"
        elif self.mode == "tampered_state":
            callback = (
                f"{redirect_uri}#access_token={self.token_value}"
                f"&state=TAMPERED&expires_in=3599&token_type=Bearer"
            )
        else:
            callback = (
                f"{redirect_uri}#access_token={self.token_value}"
                f"&state={state}&expires_in=3599&token_type=Bearer"
            )

        # 302 redirect — browser follows automatically.
        route.fulfill(status=302, headers={"Location": callback})


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
    page.route("**/*googleapis.com/**", fake_drive.handle)
    page.route("**/accounts.google.com/gsi/**", fake_drive.handle)
    page.route("**/accounts.google.com/o/oauth2/**", fake_oauth.handle)
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
    """signIn() → redirect to OAuth → callback with token → IDLE."""
    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        # Page navigates to accounts.google.com → 302 → back to /#access_token=...
        # Wait for the app to be reloaded after the redirect.
        page.wait_for_function(
            "() => window.driveSync?.isAuthenticated() === true", timeout=15_000,
        )
        _wait_idle(page)

        assert fake_oauth.calls == 1, "OAuth endpoint should be called exactly once"
        assert page.evaluate("location.hash") == "", "hash should be cleared"
        assert page.evaluate("window.driveSync.getStatus()") == "IDLE"
    finally:
        page.context.close()


def test_ios_callback_state_mismatch_rejected(browser, fake_drive, fake_oauth):
    """Tampered state in callback hash → token rejected, error logged."""
    fake_drive.reset()
    fake_oauth.mode = "tampered_state"
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        # Wait for the post-redirect load to settle.
        page.wait_for_function(
            "() => location.hash === ''", timeout=15_000,
        )
        # Auth should NOT have succeeded.
        assert page.evaluate("window.driveSync.isAuthenticated()") is False
        assert page.evaluate("window.__pendingRedirectError") == "state_mismatch"
    finally:
        page.context.close()


def test_ios_callback_error_param_rejected(browser, fake_drive, fake_oauth):
    """error=access_denied in callback hash → token rejected, no auth."""
    fake_drive.reset()
    fake_oauth.mode = "error"
    fake_oauth.error_code = "access_denied"
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => location.hash === ''", timeout=15_000,
        )
        assert page.evaluate("window.driveSync.isAuthenticated()") is False
        assert page.evaluate("window.__pendingRedirectError") == "access_denied"
    finally:
        page.context.close()


def test_ios_signin_clears_attempt_counter(browser, fake_drive, fake_oauth):
    """signIn() resets the attempt counter so user-initiated reconnects always
    have a full cap window. Successful round-trip leaves it at 0."""
    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        # Pre-seed a high counter as if previous auto-redirects had failed.
        page.evaluate(
            "localStorage.setItem('bible-drive-redirect-attempts', '99')"
        )
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => window.driveSync?.isAuthenticated() === true", timeout=15_000,
        )
        # Successful callback should reset to 0.
        assert page.evaluate(
            "localStorage.getItem('bible-drive-redirect-attempts')"
        ) == "0"
    finally:
        page.context.close()


def test_ios_returnto_preserved_through_redirect(browser, fake_drive, fake_oauth):
    """Original pathname is restored after the redirect round-trip."""
    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        # Navigate to a chapter route before initiating sign-in.
        page.evaluate("history.pushState(null, '', '/gen/1')")
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => window.driveSync?.isAuthenticated() === true", timeout=15_000,
        )
        path = page.evaluate("location.pathname")
        assert path == "/gen/1", f"Expected /gen/1 after callback, got {path}"
        assert page.evaluate("location.hash") == ""
    finally:
        page.context.close()


def _force_401_on_drive(page: Page):
    """Make the next upload (PATCH /upload/.../files/sync-file-id) return 401.

    findSyncFileId swallows 401s, so the only paths that surface a 401 to the
    state machine are downloadSyncFile (GET /files/{id}?alt=media) and
    uploadSyncFile (PATCH /upload/.../files/{id}?uploadType=media). We 401 the
    PATCH upload since the test scenarios trigger scheduleUpload after IDLE.
    """
    page.route(
        "**/www.googleapis.com/upload/drive/v3/files/**",
        lambda route: route.fulfill(status=401),
        times=1,
    )


def test_ios_active_reading_defers_401_redirect(browser, fake_drive, fake_oauth):
    """401 while user is actively reading → snackbar, no auto-redirect."""
    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => window.driveSync?.isAuthenticated() === true", timeout=15_000,
        )
        _wait_idle(page)

        # Stage a remote bookmark so the next sync needs to PATCH-upload.
        page.evaluate("""
            (() => {
                const id = 'bm-active-1';
                const list = window.syncStoreV2.loadBookmarks();
                list.push({ id, type: 'bookmark', name: 'Active-Reading',
                            bookId: 'gen', chapter: 1, vref: 'gen 1:1', verseSpec: '1' });
                window.syncStoreV2.saveBookmarks(list);
            })()
        """)

        # Simulate active reading: recent interaction timestamp + focus.
        page.evaluate("window.__driveSyncInteractionTs = () => Date.now()")
        page.evaluate(
            "Object.defineProperty(document, 'hasFocus', "
            "{ configurable: true, value: () => true })"
        )

        oauth_calls_before = fake_oauth.calls
        _force_401_on_drive(page)
        page.evaluate("window.driveSync.scheduleUpload()")
        page.wait_for_timeout(1500)

        assert fake_oauth.calls == oauth_calls_before, \
            "OAuth endpoint must NOT be hit while user is actively reading"
        status = page.evaluate("window.driveSync.getStatus()")
        assert status == "NEEDS_CONSENT", \
            f"Expected NEEDS_CONSENT after deferred 401, got {status}"
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
        # Plant a legitimate-looking saved state, simulating an in-flight
        # OAuth round-trip that we never finished.
        page.evaluate("""
            sessionStorage.setItem('bible-drive-redirect-state', JSON.stringify({
                nonce: 'real-nonce-xyz',
                returnTo: '/',
                ts: Date.now(),
                flow: 'implicit-v1',
            }));
        """)

        # Simulate an attacker-crafted error URL with a wrong state.
        result = page.evaluate("""
            (() => {
                history.replaceState(null, '', '/#error=access_denied&state=ATTACKER');
                return window.syncTransport.consumeRedirectCallback();
            })()
        """)
        assert result == {"ok": False, "reason": "state_mismatch"}, \
            f"Expected state_mismatch, got {result}"

        # The legitimate state must still be intact for the real callback.
        saved = page.evaluate(
            "sessionStorage.getItem('bible-drive-redirect-state')"
        )
        assert saved is not None, "sessionStorage state was clobbered"
        import json as _json
        parsed = _json.loads(saved)
        assert parsed["nonce"] == "real-nonce-xyz"
    finally:
        page.context.close()


def test_ios_redirect_loop_hits_cap(browser, fake_drive, fake_oauth):
    """Counter at MAX_REDIRECT_ATTEMPTS → next 401 in idle state must NOT
    redirect; machine transitions to ERROR. Validates that the IIFE/
    acceptRedirectToken no longer reset the counter and the loop is bounded.
    """
    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => window.driveSync?.isAuthenticated() === true", timeout=15_000,
        )
        _wait_idle(page)

        page.evaluate("""
            (() => {
                const id = 'bm-cap-1';
                const list = window.syncStoreV2.loadBookmarks();
                list.push({ id, type: 'bookmark', name: 'Cap-Test',
                            bookId: 'gen', chapter: 1, vref: 'gen 1:1', verseSpec: '1' });
                window.syncStoreV2.saveBookmarks(list);
            })()
        """)

        # Counter at the cap — next _beginRedirect call must reject.
        page.evaluate(
            "localStorage.setItem('bible-drive-redirect-attempts', '3')"
        )
        page.evaluate("window.__driveSyncInteractionTs = () => 0")  # idle

        oauth_calls_before = fake_oauth.calls
        _force_401_on_drive(page)
        page.evaluate("window.driveSync.scheduleUpload()")
        page.wait_for_timeout(1500)

        assert fake_oauth.calls == oauth_calls_before, \
            "OAuth must NOT be called when counter is already at cap"
        status = page.evaluate("window.driveSync.getStatus()")
        assert status == "ERROR", \
            f"Expected ERROR after cap exceeded, got {status}"
    finally:
        page.context.close()


def test_ios_idle_401_triggers_auto_redirect(browser, fake_drive, fake_oauth):
    """401 while user is idle → automatic full-page redirect."""
    import time

    fake_drive.reset()
    page = _make_ios_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => window.driveSync?.isAuthenticated() === true", timeout=15_000,
        )
        _wait_idle(page)

        page.evaluate("""
            (() => {
                const id = 'bm-idle-1';
                const list = window.syncStoreV2.loadBookmarks();
                list.push({ id, type: 'bookmark', name: 'Idle-User',
                            bookId: 'gen', chapter: 1, vref: 'gen 1:1', verseSpec: '1' });
                window.syncStoreV2.saveBookmarks(list);
            })()
        """)

        # Force "idle" — interaction timestamp far in the past.
        page.evaluate("window.__driveSyncInteractionTs = () => 0")

        oauth_calls_before = fake_oauth.calls
        _force_401_on_drive(page)
        page.evaluate("window.driveSync.scheduleUpload()")

        # Poll for the secondary OAuth call (auto-redirect). Cannot rely on
        # isAuthenticated since it stays true throughout (initial token until
        # the 401 fires; token injected immediately on callback).
        deadline = time.time() + 10.0
        while time.time() < deadline:
            if fake_oauth.calls > oauth_calls_before:
                break
            page.wait_for_timeout(200)
        else:
            assert False, "Idle 401 should have triggered an automatic redirect"

        assert fake_oauth.calls > oauth_calls_before
    finally:
        page.context.close()
