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

from .conftest import FULL_STORAGE, fill_storage


BASE_URL = "http://localhost:8080"


# ── Fake Drive server ─────────────────────────────────────────────────────────

class FakeDrive:
    """Thread-safe in-memory Drive appDataFolder with ETag support.

    Like the real API it answers 401 to a request without a token (`Bearer null` — what the app
    sends once sign-out has cleared it). `requests` logs every (method, url) it receives.
    `hold_list = True` / `hold_create = True` keep the next files.list / multipart create pending
    until `release_held()` serves them — a sync cycle parked on that await. `fail_list = <status>`
    answers every files.list with that status.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._file: dict | None = None
        self._etag = "etag-0"
        self._etag_n = 0
        self.requests: list[tuple[str, str]] = []
        self.hold_list = False
        self.hold_create = False
        self.fail_list: int | None = None
        self.held: list[Route] = []

    def reset(self):
        with self._lock:
            self._file = None
            self._etag = "etag-0"
            self._etag_n = 0
        self.requests = []
        self.hold_list = False
        self.hold_create = False
        self.fail_list = None
        self.held = []

    def release_held(self):
        """Serve the held requests now — the list answers with the file list as it is at this point."""
        held, self.held = self.held, []
        for route in held:
            self._serve(route)

    def handle(self, route: Route):
        req = route.request
        url = req.url
        self.requests.append((req.method, url))

        if req.headers.get("authorization", "") in ("", "Bearer null", "Bearer undefined"):
            route.fulfill(status=401)
            return
        is_list = "spaces=appDataFolder" in url and "fields=files" in url
        if (is_list and self.hold_list) or ("uploadType=multipart" in url and self.hold_create):
            if is_list:
                self.hold_list = False
            else:
                self.hold_create = False
            self.held.append(route)
            return
        self._serve(route)

    def _serve(self, route: Route):
        req = route.request
        url = req.url

        # List files
        if "spaces=appDataFolder" in url and "fields=files" in url:
            if self.fail_list is not None:
                route.fulfill(status=self.fail_list)
                return
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
                # Like the API, the create answers with the new file's metadata (its id).
                route.fulfill(status=200, headers={"ETag": self._etag}, content_type="application/json",
                              body=json.dumps({"kind": "drive#file", "id": "sync-file-id", "name": "sync.json"}))
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


def _wire(page: Page, fake_drive, fake_oauth) -> Page:
    """Route a page's Drive · OAuth requests to the fakes."""
    page.route("**/*googleapis.com/drive/**", fake_drive.handle)
    page.route("**/*googleapis.com/upload/**", fake_drive.handle)
    page.route("**/*googleapis.com/oauth2/v3/userinfo", fake_drive.handle)
    # SPA POSTs to same-origin /oauth/token (BFF, ADR-017). In production nginx
    # forwards to oauth2.googleapis.com/token with server-side client_secret;
    # in tests we intercept the same-origin request directly.
    page.route("**/oauth/token", fake_oauth.handle_token)
    page.route("**/accounts.google.com/o/oauth2/**", fake_oauth.handle_auth)
    return page


def _make_page(browser, fake_drive, fake_oauth, **context_opts) -> Page:
    """Create a fresh BrowserContext + Page wired to fakes (context_opts — e.g. a viewport)."""
    ctx: BrowserContext = browser.new_context(**context_opts)
    return _wire(ctx.new_page(), fake_drive, fake_oauth)


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
    """Signing out disables sync; a later edit + scheduleUpload sends nothing to Drive.

    Settles the first sync before signing out — a cycle still in flight at sign-out is
    test_sign_out_mid_cycle_sends_nothing_after. Checks the request log, not only the stored file:
    the fake Drive answers a tokenless request with 401 and stores nothing, so a file-content check
    alone would pass even if a request went out (code review 14).
    """
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        _wait_idle(page)
        sent_before = len(fake_drive.requests)
        page.evaluate("window.driveSync.signOut()")

        status = page.evaluate("window.driveSync.getStatus()")
        assert status == "DISABLED", f"Expected DISABLED after sign-out, got {status}"

        _add_bookmark(page, "After-Sign-Out")
        page.evaluate("window.driveSync.scheduleUpload()")
        page.wait_for_timeout(500)

        assert fake_drive.requests[sent_before:] == [], f"Drive requests after sign-out: {fake_drive.requests[sent_before:]}"
        with fake_drive._lock:
            file = fake_drive._file
        if file:
            items = list(file.get("bookmarks", {}).get("items", {}).values())
            names = [it.get("name") for it in items]
            assert "After-Sign-Out" not in names, "Bookmark uploaded after sign-out"
    finally:
        page.context.close()


def test_sign_out_mid_cycle_sends_nothing_after(browser, fake_drive, fake_oauth):
    """A cycle already waiting on Drive when the user signs out stops there (known-issues §11).

    The first cycle after sign-in is parked on files.list; sign-out and a new bookmark land
    while it waits, then the list answers "no file yet" — the branch that used to build the
    upload after the await (so it carried the new bookmark) and send it with the cleared token.
    Nothing may reach Drive after sign-out.
    """
    fake_drive.reset()
    fake_drive.hold_list = True
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        for _ in range(100):
            if fake_drive.held:
                break
            page.wait_for_timeout(50)
        assert fake_drive.held, "first sync cycle never asked for the file list"
        assert page.evaluate("window.driveSync.getStatus()") == "SYNCING"

        # Counted before sign-out: nothing from the sign-out call on (the call itself, the new
        # bookmark, the released cycle) may reach Drive.
        sent_before = len(fake_drive.requests)
        page.evaluate("window.driveSync.signOut()")
        assert page.evaluate("window.driveSync.getStatus()") == "DISABLED"
        _add_bookmark(page, "After-Sign-Out")
        fake_drive.release_held()
        page.wait_for_timeout(500)

        after = fake_drive.requests[sent_before:]
        assert after == [], f"Drive requests after sign-out: {after}"
        assert page.evaluate("window.driveSync.getStatus()") == "DISABLED"
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


def _drive_names(fake_drive) -> list[str]:
    with fake_drive._lock:
        items = (fake_drive._file or {}).get("bookmarks", {}).get("items", {})
        return sorted(v.get("name") for v in items.values())


def test_merge_refused_by_full_storage_keeps_drive_as_it_was(browser, fake_drive, fake_oauth):
    """저장 공간이 차 다른 기기의 변경을 저장하지 못하면 알리고, 드라이브의 파일을 기기에 남은 옛 문서로 덮어쓰지 않는다.

    known-issues §15.4: 올릴 자료는 기기에 저장된 문서에서 만든다. 병합 결과를 저장하지 못했는데 올리면, 다른 기기가
    올린 북마크가 드라이브에서 사라진다. 저장 공간이 다시 생기면 다음 동기화가 병합해 올린다.
    """
    fake_drive.reset()
    page_a = _make_page(browser, fake_drive, fake_oauth)
    page_b = _make_page(browser, fake_drive, fake_oauth)
    page_b.context.add_init_script(FULL_STORAGE)
    try:
        _load(page_b)
        _enable_sync(page_b)
        _add_bookmark(page_b, "Bookmark-B")
        _sync_now(page_b)

        _load(page_a)
        _enable_sync(page_a)
        _wait_idle(page_a)
        _add_bookmark(page_a, "Bookmark-A")
        _sync_now(page_a)
        assert _drive_names(fake_drive) == ["Bookmark-A", "Bookmark-B"]

        _add_bookmark(page_b, "Bookmark-B2")            # saved on B, not uploaded yet
        fill_storage(page_b, ["bible-bookmarks-v2"], grow_only=True)
        _sync_now(page_b)

        page_b.locator(
            "body > div:not(#a11y-announce)",
            has_text="저장 공간이 부족합니다. 불필요한 북마크를 지워야 동기화할 수 있습니다.",
        ).wait_for(state="visible")
        _wait_idle(page_b)                               # the cycle has ended — an upload would have landed by now
        assert _drive_names(fake_drive) == ["Bookmark-A", "Bookmark-B"], "B's old doc must not overwrite Drive"
        assert sorted(_bookmark_names(page_b)) == ["Bookmark-B", "Bookmark-B2"]
        assert page_b.evaluate("window.driveSync.getStatus()") == "IDLE"

        fill_storage(page_b, [])                         # room again
        _sync_now(page_b)
        assert sorted(_bookmark_names(page_b)) == ["Bookmark-A", "Bookmark-B", "Bookmark-B2"]
        assert _drive_names(fake_drive) == ["Bookmark-A", "Bookmark-B", "Bookmark-B2"]
    finally:
        page_a.context.close()
        page_b.context.close()


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


def _wait_held(page: Page, fake_drive: "FakeDrive"):
    for _ in range(100):
        if fake_drive.held:
            return
        page.wait_for_timeout(50)
    raise AssertionError("no request was held — the sync cycle never got that far")


def test_drive_disconnect_delete_waits_for_inflight_create(browser, fake_drive, fake_oauth):
    """'파일도 삭제' while the first cycle's create is still in flight — the file must not come back.

    The create is parked; the delete path stops sync, then waits for that cycle before it looks the
    file up. It used to look up at once (no file yet), delete nothing, and let the create land after.
    """
    fake_drive.reset()
    fake_drive.hold_create = True
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        _wait_held(page, fake_drive)

        page.evaluate("openDriveDisconnectModal()")
        page.wait_for_selector("#drive-disconnect-modal:not([hidden])")
        page.click("#drive-disconnect-delete")
        page.wait_for_timeout(300)
        assert page.evaluate("window.driveSync.getStatus()") == "DISABLED", "sync stops before the delete"
        fake_drive.release_held()   # the create lands
        page.wait_for_timeout(800)

        with fake_drive._lock:
            assert fake_drive._file is None, "the in-flight create re-made the deleted file"
        assert page.evaluate("window.driveSync.getStatus()") == "DISABLED"
    finally:
        page.context.close()


def test_drive_disconnect_delete_failure_says_so(browser, fake_drive, fake_oauth):
    """'파일도 삭제' when the file can't be looked up: the disconnect still happens, and a snackbar says
    the file stayed on Drive (it used to say nothing)."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        _add_bookmark(page, "Stays-on-Drive")
        _sync_now(page)
        fake_drive.fail_list = 503

        page.evaluate("openDriveDisconnectModal()")
        page.wait_for_selector("#drive-disconnect-modal:not([hidden])")
        page.click("#drive-disconnect-delete")
        # The snackbar (a plain div) for sighted users, and the same text in the live region for screen
        # readers (Copilot review 1 — the snackbar alone was never announced).
        page.wait_for_function(
            "() => [...document.body.children].some((n) => n.id !== 'a11y-announce'"
            " && n.textContent.includes('동기화 파일은 삭제하지 못했습니다'))",
            timeout=5_000,
        )
        page.wait_for_function(
            "() => document.getElementById('a11y-announce').textContent.includes('동기화 파일은 삭제하지 못했습니다')",
            timeout=5_000,
        )
        assert page.evaluate("window.driveSync.getStatus()") == "DISABLED", "the disconnect still happens"
        with fake_drive._lock:
            assert fake_drive._file is not None, "the file is still on Drive"

        # The snackbar is gone in seconds — settings keeps saying so, also after a reload (WCAG 2.2.1).
        note = ".settings-popover .settings-drive-note"
        page.locator("#settings-anchor .settings-btn").click()
        page.wait_for_selector(note, state="visible", timeout=5_000)
        assert "남아 있을 수 있습니다" in page.inner_text(note)
        page.reload()
        page.wait_for_function("() => window.driveSync", timeout=10_000)
        page.locator("#settings-anchor .settings-btn").click()
        page.wait_for_selector(note, state="visible", timeout=5_000)
    finally:
        page.context.close()


def test_drive_sign_out_in_one_tab_stops_the_other(browser, fake_drive, fake_oauth):
    """Two tabs of the same browser, both connected: '파일도 삭제' in one stops the other too (the sign-in
    flag is shared, the machine is per tab) — the other tab's next edit used to find no cached file and
    re-create sync.json with every bookmark (code review 10)."""
    fake_drive.reset()
    ctx: BrowserContext = browser.new_context()
    try:
        tab_a = _wire(ctx.new_page(), fake_drive, fake_oauth)
        _load(tab_a)
        _enable_sync(tab_a)
        _add_bookmark(tab_a, "From-A")
        _sync_now(tab_a)
        tab_b = _wire(ctx.new_page(), fake_drive, fake_oauth)
        _load(tab_b)   # the shared refresh token signs this tab in silently
        tab_b.wait_for_function("() => window.driveSync.getStatus() === 'IDLE'", timeout=10_000)

        tab_a.evaluate("openDriveDisconnectModal()")
        tab_a.wait_for_selector("#drive-disconnect-modal:not([hidden])")
        tab_a.click("#drive-disconnect-delete")
        for _ in range(100):   # until the fake Drive has seen the delete
            with fake_drive._lock:
                if fake_drive._file is None:
                    break
            tab_a.wait_for_timeout(50)
        with fake_drive._lock:
            assert fake_drive._file is None, "deleted from tab A"

        tab_b.wait_for_function("() => window.driveSync.getStatus() === 'DISABLED'", timeout=5_000)
        _add_bookmark(tab_b, "From-B-after-A-signed-out")
        tab_b.evaluate("window.driveSync.scheduleUpload()")
        tab_b.wait_for_timeout(800)
        with fake_drive._lock:
            assert fake_drive._file is None, "tab B re-created the deleted file"
    finally:
        ctx.close()


def test_drive_mobile_settings_view_redraws_after_delete(browser, fake_drive, fake_oauth):
    """Mobile full-screen settings (/settings at 390px): after '파일도 삭제' the view redraws to '연결'. It
    used to keep '해제' (only the desktop popover was redrawn), and a second '파일도 삭제' then claimed the
    already-deleted file could not be deleted (code review 4)."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth, viewport={"width": 390, "height": 844})
    try:
        _load(page)
        _enable_sync(page)
        _add_bookmark(page, "Mobile")
        _sync_now(page)
        page.goto(BASE_URL + "/settings")
        page.wait_for_function("() => window.driveSync?.getStatus() === 'IDLE'", timeout=10_000)
        page.click('.settings-view [aria-label="Google Drive 연결 해제"]')
        page.wait_for_selector("#drive-disconnect-modal:not([hidden])")
        page.click("#drive-disconnect-delete")
        page.wait_for_selector('.settings-view [aria-label="Google Drive 연결"]', timeout=5_000)
        assert page.locator('.settings-view [aria-label="Google Drive 연결 해제"]').count() == 0
        with fake_drive._lock:
            assert fake_drive._file is None
        assert not page.evaluate(
            "() => [...document.body.children].some((n) => n.textContent.includes('삭제하지 못했습니다'))"
        ), "no failure notice after a delete that worked"
    finally:
        page.context.close()


def test_drive_settings_reopened_during_delete_updates_after_sign_out(browser, fake_drive, fake_oauth):
    """Settings reopened while '파일도 삭제' is still deleting shows '연결' at once — the delete takes the
    token out of the machine before it waits (it used to hold it, so settings drew '해제' and, after the
    sign-out, kept showing it: Copilot review 1). It stays '연결' after the delete lands."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive, fake_oauth)
    try:
        _load(page)
        _enable_sync(page)
        _add_bookmark(page, "Delete-me")
        _sync_now(page)
        fake_drive.hold_list = True   # the delete path's lookup waits (cycles use the cached fileId)

        page.evaluate("openDriveDisconnectModal()")
        page.wait_for_selector("#drive-disconnect-modal:not([hidden])")
        page.click("#drive-disconnect-delete")
        _wait_held(page, fake_drive)

        page.locator("#settings-anchor .settings-btn").click()
        page.wait_for_selector(".settings-popover", state="visible")
        page.wait_for_selector('.settings-popover [aria-label="Google Drive 연결"]', timeout=5_000)
        assert page.locator('.settings-popover [aria-label="Google Drive 연결 해제"]').count() == 0, \
            "'해제' while the delete is still running"
        fake_drive.release_held()
        page.wait_for_function("() => window.driveSync.isDeletePending() === false", timeout=5_000)
        assert page.locator('.settings-popover [aria-label="Google Drive 연결"]').count() == 1
        with fake_drive._lock:
            assert fake_drive._file is None, "the file was deleted"
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
