"""Drive sync e2e tests.

Phase 2h 단계 4 이후 — 인증은 PKCE Authorization Code 단일 경로로 통일.
GIS Token Client / Implicit Flow 의존이 사라졌으므로 GIS_STUB도 제거됐다.

Uses an in-memory fake Drive server (page.route) and a fake OAuth endpoint
that:
  • intercepts navigation to `accounts.google.com/o/oauth2/v2/auth` and
    redirects back with `?code=...&state=...`,
  • answers POSTs to the same-origin `/oauth/token` BFF (ADR-017) — in
    production nginx forwards this to oauth2.googleapis.com/token after
    injecting client_secret, but for tests we intercept directly.

Two independent BrowserContext instances simulate two devices.

Run with the dev server active:
    python3 scripts/serve.py 8080
    pytest tests/e2e/test_drive_sync.py -v
"""

import json
import threading
import urllib.parse
import pytest
from playwright.sync_api import Page, BrowserContext, Route


BASE_URL = "http://localhost:8080"


# ── Fake Drive server ─────────────────────────────────────────────────────────

class FakeDrive:
    """Thread-safe in-memory Drive appDataFolder with ETag support."""

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

        # List files
        if "spaces=appDataFolder" in url and "fields=files" in url:
            with self._lock:
                files = [{"id": "sync-file-id"}] if self._file is not None else []
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"files": files}))
            return

        # Download file
        if "sync-file-id?alt=media" in url:
            with self._lock:
                if self._file is None:
                    route.fulfill(status=404)
                    return
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    headers={"ETag": self._etag},
                    body=json.dumps(self._file),
                )
            return

        # Upload (PATCH — update)
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

        # Upload (POST — create)
        if "uploadType=multipart" in url:
            # Multipart body — extract JSON part (second part after boundary)
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

        # Delete file
        if "sync-file-id" in url and req.method == "DELETE":
            with self._lock:
                self._file = None
                self._etag = "etag-0"
                self._etag_n = 0
            route.fulfill(status=204)
            return

        # userinfo
        if "userinfo" in url:
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"email": "test@example.com"}))
            return

        route.continue_()


# ── Fake OAuth endpoint (PKCE) ────────────────────────────────────────────────

class FakeOAuth:
    """Intercepts `accounts.google.com/o/oauth2/v2/auth` and same-origin `/oauth/token`.

    Default behavior:
      • /auth: 302 to `redirect_uri?code=AUTH_CODE&state={state}`
      • /token: 200 with access_token + refresh_token

    Configurable via attributes:
      • mode = "ok" | "error" | "tampered_state"
      • token_response: dict to override /token response body
      • token_status: HTTP status for /token (default 200)
    """

    def __init__(self):
        self.mode = "ok"
        self.error_code = "access_denied"
        self.code_value = "mock-auth-code"
        self.calls_auth = 0
        self.calls_token = 0
        self.token_response = None  # None → defaults
        self.token_status = 200

    def reset(self):
        self.mode = "ok"
        self.error_code = "access_denied"
        self.calls_auth = 0
        self.calls_token = 0
        self.token_response = None
        self.token_status = 200

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
        if self.token_status != 200:
            route.fulfill(
                status=self.token_status,
                content_type="application/json",
                body=json.dumps({"error": "invalid_grant"}),
            )
            return
        body = self.token_response or {
            "access_token": "mock-access-token",
            "refresh_token": "mock-refresh-token",
            "expires_in": 3600,
            "scope": "https://www.googleapis.com/auth/drive.appdata email",
            "token_type": "Bearer",
        }
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(body),
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


def _make_page(browser, fake_drive, fake_oauth) -> Page:
    """Create a fresh BrowserContext + Page wired to fakes."""
    ctx: BrowserContext = browser.new_context()
    page = ctx.new_page()
    page.route("**/*googleapis.com/drive/**", fake_drive.handle)
    page.route("**/*googleapis.com/upload/**", fake_drive.handle)
    page.route("**/*googleapis.com/oauth2/v3/userinfo", fake_drive.handle)
    # SPA POSTs to same-origin /oauth/token (BFF, ADR-017). In production nginx
    # forwards to oauth2.googleapis.com/token with server-side client_secret;
    # in tests we intercept the same-origin request directly.
    page.route("**/oauth/token", fake_oauth.handle_token)
    page.route("**/accounts.google.com/o/oauth2/**", fake_oauth.handle_auth)
    return page


def _load(page: Page):
    page.goto(BASE_URL)
    page.wait_for_function(
        "() => window.driveSync && window.syncTransport", timeout=10_000,
    )


def _enable_sync(page: Page):
    """Trigger PKCE sign-in: signIn() → redirect → callback → token exchange → IDLE.

    The redirect is a real page navigation (302 chain through our fake OAuth)
    so we can't just await isAuthenticated synchronously — we wait for the
    re-loaded page to resolve auth.
    """
    page.evaluate("window.driveSync.signIn()")
    page.wait_for_function(
        "() => window.driveSync?.isAuthenticated() === true",
        timeout=15_000,
    )


def _add_bookmark(page: Page, name: str) -> str:
    """Add a bookmark via the store and return its id."""
    return page.evaluate(f"""
        (() => {{
            const id = 'bm-' + Math.random().toString(36).slice(2);
            const store = window.syncStoreV2.loadBookmarks();
            store.push({{ id, type: 'bookmark', name: {json.dumps(name)},
                          bookId: 'gen', chapter: 1, vref: 'gen 1:1',
                          verseSpec: '1' }});
            window.syncStoreV2.saveBookmarks(store);
            return id;
        }})()
    """)


def _bookmark_names(page: Page) -> list[str]:
    return page.evaluate("""
        (() => {
            const bms = window.syncStoreV2.loadBookmarks();
            const names = [];
            function walk(items) {
                for (const it of items) {
                    if (it.type === 'bookmark') names.push(it.name);
                    if (it.children) walk(it.children);
                }
            }
            walk(bms);
            return names;
        })()
    """)


def _wait_idle(page: Page, timeout=5_000):
    page.wait_for_function(
        "() => window.driveSync?.getStatus() === 'IDLE'",
        timeout=timeout,
    )


def _sync_now(page: Page, timeout=10_000):
    """Trigger a sync upload and wait for the cycle to complete.

    scheduleUpload() has a 300ms debounce, so we add a short pause before
    waiting for IDLE to avoid racing past the debounce window.
    """
    page.evaluate("window.driveSync.scheduleUpload()")
    page.wait_for_timeout(350)  # debounce fires at ~300ms
    _wait_idle(page, timeout=timeout)


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_pkce_round_trip_reaches_idle(browser, fake_drive, fake_oauth):
    """signIn() → /auth redirect → callback → /token exchange → IDLE."""
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        _wait_idle(page)
        assert fake_oauth.calls_auth == 1, "OAuth /auth should be hit once"
        assert fake_oauth.calls_token >= 1, "OAuth /token should be hit at least once"
        assert page.evaluate("window.driveSync.getStatus()") == "IDLE"
        # Callback URL stripped — no ?code= residue.
        assert "code=" not in page.evaluate("location.search")
    finally:
        page.context.close()


def test_upload_then_download(browser, fake_drive, fake_oauth):
    """Device A uploads a bookmark; Device B downloads it."""
    fake_drive.reset()
    page_a = _make_page(browser, fake_drive, fake_oauth)
    page_b = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page_a)
        _enable_sync(page_a)
        _add_bookmark(page_a, "Genesis 1")
        _sync_now(page_a)

        _load(page_b)
        _enable_sync(page_b)
        _wait_idle(page_b)

        names = _bookmark_names(page_b)
        assert "Genesis 1" in names, f"Expected bookmark on device B, got: {names}"
    finally:
        page_a.context.close()
        page_b.context.close()


def test_concurrent_adds_both_preserved(browser, fake_drive, fake_oauth):
    """Devices A and B each add a different bookmark; both survive after sync."""
    fake_drive.reset()
    page_a = _make_page(browser, fake_drive, fake_oauth)
    page_b = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page_a)
        _enable_sync(page_a)
        _add_bookmark(page_a, "Bookmark-A")
        _sync_now(page_a)

        _load(page_b)
        _enable_sync(page_b)
        _wait_idle(page_b)
        _add_bookmark(page_b, "Bookmark-B")
        _sync_now(page_b)

        _sync_now(page_a)

        names_a = _bookmark_names(page_a)
        names_b = _bookmark_names(page_b)
        assert "Bookmark-A" in names_a and "Bookmark-B" in names_a, \
            f"Device A missing bookmarks: {names_a}"
        assert "Bookmark-A" in names_b and "Bookmark-B" in names_b, \
            f"Device B missing bookmarks: {names_b}"
    finally:
        page_a.context.close()
        page_b.context.close()


def test_412_triggers_remerge(browser, fake_drive, fake_oauth):
    """A 412 response causes the machine to re-download, re-merge, and retry."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)

        with fake_drive._lock:
            fake_drive._etag_n += 1
            fake_drive._etag = f"etag-{fake_drive._etag_n}"

        _add_bookmark(page, "After-412")
        _sync_now(page, timeout=8_000)

        status = page.evaluate("window.driveSync.getStatus()")
        assert status == "IDLE", f"Expected IDLE after 412 recovery, got {status}"
    finally:
        page.context.close()


def test_sign_out_clears_sync(browser, fake_drive, fake_oauth):
    """Signing out disables sync; subsequent changes don't upload."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        page.evaluate("window.driveSync.signOut()")

        status = page.evaluate("window.driveSync.getStatus()")
        assert status == "DISABLED", f"Expected DISABLED after sign-out, got {status}"

        _add_bookmark(page, "After-Sign-Out")
        page.evaluate("window.driveSync.scheduleUpload()")
        page.wait_for_timeout(500)

        with fake_drive._lock:
            file = fake_drive._file
        if file:
            items = list(file.get("bookmarks", {}).get("items", {}).values())
            names = [it.get("name") for it in items]
            assert "After-Sign-Out" not in names, "Bookmark uploaded after sign-out"
    finally:
        page.context.close()


def test_v0_migration_syncs_correctly(browser, fake_drive, fake_oauth):
    """Legacy v0 (bare array) localStorage is migrated and synced to Drive."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        page.add_init_script("""
            const bms = [{ id: 'legacy-1', type: 'bookmark', name: 'Legacy BM',
                           bookId: 'gen', chapter: 1, vref: 'gen 1:1', verseSpec: '1' }];
            localStorage.setItem('bible-bookmarks', JSON.stringify(bms));
        """)
        _load(page)
        _enable_sync(page)
        _wait_idle(page)

        names = _bookmark_names(page)
        assert "Legacy BM" in names, f"Legacy bookmark missing after migration: {names}"

        with fake_drive._lock:
            assert fake_drive._file is not None, "Nothing uploaded to Drive"
            items = fake_drive._file.get("bookmarks", {}).get("items", {})
            drive_names = [v.get("name") for v in items.values()]
        assert "Legacy BM" in drive_names, f"Legacy bookmark not on Drive: {drive_names}"
    finally:
        page.context.close()


# ── v1.3.0: Drive 연결 해제 모달 ─────────────────────────────────────────────

def test_drive_disconnect_keep_file(browser, fake_drive, fake_oauth):
    """'파일 유지' 경로: 동기화만 해제하고 Drive 파일은 보존된다."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        _add_bookmark(page, "Keep-me")
        _sync_now(page)

        page.evaluate("openDriveDisconnectModal()")
        page.wait_for_selector("#drive-disconnect-modal:not([hidden])")
        page.click("#drive-disconnect-keep")
        page.wait_for_timeout(400)

        assert page.evaluate("window.driveSync.getStatus()") == "DISABLED", \
            "Sync should be DISABLED after disconnect"
        with fake_drive._lock:
            assert fake_drive._file is not None, "Drive file should be preserved"
    finally:
        page.context.close()


def test_drive_disconnect_delete_file(browser, fake_drive, fake_oauth):
    """'파일도 삭제' 경로: 동기화 해제 후 Drive 파일도 삭제된다."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        _add_bookmark(page, "Delete-me")
        _sync_now(page)

        page.evaluate("openDriveDisconnectModal()")
        page.wait_for_selector("#drive-disconnect-modal:not([hidden])")
        page.click("#drive-disconnect-delete")
        page.wait_for_timeout(800)  # deleteRemoteFile is async

        assert page.evaluate("window.driveSync.getStatus()") == "DISABLED", \
            "Sync should be DISABLED after disconnect"
        with fake_drive._lock:
            assert fake_drive._file is None, "Drive file should have been deleted"
    finally:
        page.context.close()


# ── v1.3.0: 동기화 진단 정보 복사 ────────────────────────────────────────────

def test_drive_diag_copy_shows_feedback(browser, fake_drive, fake_oauth):
    """진단 복사 버튼 클릭 시 '복사됨 ✓' 또는 fallback textarea가 표시된다."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)

        page.locator("#settings-anchor .settings-btn").click()
        page.wait_for_selector(".settings-popover", state="visible")
        page.locator(".settings-drive-info-btn").click()
        page.wait_for_timeout(200)

        page.locator(".settings-drive-diag-btn").click()
        page.wait_for_timeout(500)

        diag_btn = page.locator(".settings-drive-diag-btn")
        info_row = page.locator(".settings-drive-info-row")
        has_feedback = (
            diag_btn.text_content() == "복사됨 ✓"
            or info_row.locator("textarea").count() > 0
        )
        assert has_feedback, "Expected '복사됨 ✓' text or fallback textarea after click"
    finally:
        page.context.close()


# ── Phase 2h 단계 4: PKCE 콜백 보안 회귀 ────────────────────────────────────

def test_pkce_callback_state_mismatch_rejected(browser, fake_drive, fake_oauth):
    """Tampered state in callback → token rejected, error logged, no auth."""
    fake_oauth.mode = "tampered_state"
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        # Wait for the post-redirect load to settle (callback consumed by IIFE).
        page.wait_for_function(
            "() => location.search === '' || location.search === undefined",
            timeout=15_000,
        )
        # initDriveSync → _machine.enable() fires _attemptSilentRefresh
        # asynchronously; it returns false (no refresh token) and the machine
        # parks in NEEDS_CONSENT. Poll for that terminal state rather than
        # sampling immediately, which races with the async transition.
        page.wait_for_function(
            "() => window.driveSync.getStatus() === 'NEEDS_CONSENT'",
            timeout=5_000,
        )
        assert page.evaluate("window.driveSync.isAuthenticated()") is False
    finally:
        page.context.close()


def test_pkce_callback_error_param_rejected(browser, fake_drive, fake_oauth):
    """error=access_denied in callback → token rejected, no auth."""
    fake_oauth.mode = "error"
    fake_oauth.error_code = "access_denied"
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("window.driveSync.signIn()")
        page.wait_for_function(
            "() => location.search === '' || location.search === undefined",
            timeout=15_000,
        )
        page.wait_for_function(
            "() => window.driveSync.getStatus() === 'NEEDS_CONSENT'",
            timeout=5_000,
        )
        assert page.evaluate("window.driveSync.isAuthenticated()") is False
    finally:
        page.context.close()


def test_pkce_signin_clears_attempt_counter(browser, fake_drive, fake_oauth):
    """signIn() resets the attempt counter so user-initiated reconnects always
    have a full cap window. Successful round-trip leaves it at 0 (SYNC_DONE)."""
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate(
            "localStorage.setItem('bible-drive-redirect-attempts', '99')"
        )
        _enable_sync(page)
        _wait_idle(page)
        assert page.evaluate(
            "localStorage.getItem('bible-drive-redirect-attempts')"
        ) == "0"
    finally:
        page.context.close()


def test_pkce_returnto_preserved_through_redirect(browser, fake_drive, fake_oauth):
    """Original pathname is restored after the redirect round-trip."""
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        page.evaluate("history.pushState(null, '', '/gen/1')")
        _enable_sync(page)
        path = page.evaluate("location.pathname")
        assert path == "/gen/1", f"Expected /gen/1 after callback, got {path}"
        assert page.evaluate("location.search") == ""
    finally:
        page.context.close()
