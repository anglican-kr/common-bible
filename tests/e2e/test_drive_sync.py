"""Drive sync e2e tests.

Uses an in-memory fake Drive server (page.route) so no real OAuth or Drive
calls are made. GIS is replaced by a window-level stub that grants tokens
immediately. Two independent BrowserContext instances simulate two devices.

Run with the dev server active:
    python3 scripts/serve.py 8080
    pytest tests/e2e/test_drive_sync.py -v
"""

import json
import threading
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

        # Block the real GIS client library so the stub is not overwritten
        if "gsi/client" in url:
            route.fulfill(status=200, content_type="application/javascript", body="")
            return

        # userinfo
        if "userinfo" in url:
            route.fulfill(status=200, content_type="application/json",
                          body=json.dumps({"email": "test@example.com"}))
            return

        route.continue_()


# ── GIS stub injected into every page ────────────────────────────────────────

GIS_STUB = """
window.__gisCallbacks = {};
// Mock JWT for test@example.com — header.payload.signature, payload decodes
// to {"email":"test@example.com"}. Signature verification happens in GIS in
// production, but the stub bypasses it.
window.__mockCredential =
  "eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.sig";
window.google = {
  accounts: {
    id: {
      initialize: (cfg) => { window.__gisIdCallback = cfg.callback; },
      prompt: (momentCallback) => {
        // Allow tests to simulate FedCM unavailability (iOS 16↓ first run).
        if (window.__gisForceIdentityFail) {
          window.__gisForceIdentityFail = null;
          if (momentCallback) momentCallback({
            isNotDisplayed: () => true,
            isSkippedMoment: () => false,
            isDismissedMoment: () => false,
            getNotDisplayedReason: () => "browser_not_supported",
          });
          return;
        }
        setTimeout(() => {
          if (window.__gisIdCallback) {
            window.__gisIdCallback({ credential: window.__mockCredential });
          }
          if (momentCallback) momentCallback({
            isNotDisplayed: () => false,
            isSkippedMoment: () => false,
            isDismissedMoment: () => false,
          });
        }, 0);
      },
      cancel: () => {},
    },
    oauth2: {
      initTokenClient: (cfg) => {
        window.__gisCallbacks[cfg.client_id] = cfg.callback;
        return {
          requestAccessToken: (opts) => {
            // Always grant immediately unless window.__gisForceError is set.
            const error = window.__gisForceError;
            if (error) {
              window.__gisForceError = null;
              cfg.callback({ error });
              return;
            }
            cfg.callback({ access_token: "mock-token-abc123" });
          }
        };
      },
      revoke: (token, cb) => { if (cb) cb(); }
    }
  }
};
"""


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def fake_drive():
    drive = FakeDrive()
    yield drive
    drive.reset()


def _make_page(browser, fake_drive) -> Page:
    """Create a fresh BrowserContext + Page with GIS stub and Drive mock."""
    ctx: BrowserContext = browser.new_context()
    page = ctx.new_page()
    page.add_init_script(GIS_STUB)
    page.route("**/*googleapis.com/**", fake_drive.handle)
    page.route("**/accounts.google.com/**", fake_drive.handle)
    return page


def _load(page: Page):
    page.goto(BASE_URL)
    page.wait_for_selector("#search-input", timeout=10_000)


def _enable_sync(page: Page):
    """Enable Drive sync and wait until the token is set."""
    page.evaluate("window.driveSync.signIn()")
    page.wait_for_function(
        "() => window.driveSync?.isAuthenticated()",
        timeout=10_000,
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

def test_upload_then_download(browser, fake_drive):
    """Device A uploads a bookmark; Device B downloads it."""
    fake_drive.reset()

    page_a = _make_page(browser, fake_drive)
    page_b = _make_page(browser, fake_drive)
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


def test_concurrent_adds_both_preserved(browser, fake_drive):
    """Devices A and B each add a different bookmark; both survive after sync."""
    fake_drive.reset()

    page_a = _make_page(browser, fake_drive)
    page_b = _make_page(browser, fake_drive)
    try:
        # A syncs first (uploads its bookmark)
        _load(page_a)
        _enable_sync(page_a)
        _add_bookmark(page_a, "Bookmark-A")
        _sync_now(page_a)

        # B starts with a clean slate, adds its own bookmark and syncs
        _load(page_b)
        _enable_sync(page_b)
        _wait_idle(page_b)  # initial download
        _add_bookmark(page_b, "Bookmark-B")
        _sync_now(page_b)

        # A re-syncs to pick up B's addition
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


def test_412_triggers_remerge(browser, fake_drive):
    """A 412 response causes the machine to re-download, re-merge, and retry."""
    fake_drive.reset()

    page = _make_page(browser, fake_drive)
    try:
        _load(page)
        _enable_sync(page)

        # Force the next upload to get a 412 by advancing the Drive etag externally.
        with fake_drive._lock:
            fake_drive._etag_n += 1
            fake_drive._etag = f"etag-{fake_drive._etag_n}"

        _add_bookmark(page, "After-412")
        # Machine should retry after 412 and eventually reach IDLE again.
        _sync_now(page, timeout=8_000)

        # Sync state should be healthy (not ERROR/OFFLINE).
        status = page.evaluate("window.driveSync.getStatus()")
        assert status == "IDLE", f"Expected IDLE after 412 recovery, got {status}"
    finally:
        page.context.close()


def test_sign_out_clears_sync(browser, fake_drive):
    """Signing out disables sync; subsequent changes don't upload."""
    fake_drive.reset()

    page = _make_page(browser, fake_drive)
    try:
        _load(page)
        _enable_sync(page)
        page.evaluate("window.driveSync.signOut()")

        status = page.evaluate("window.driveSync.getStatus()")
        assert status == "DISABLED", f"Expected DISABLED after sign-out, got {status}"

        _add_bookmark(page, "After-Sign-Out")
        page.evaluate("window.driveSync.scheduleUpload()")
        page.wait_for_timeout(500)

        # Drive should still have no file (or only the pre-signout content).
        with fake_drive._lock:
            file = fake_drive._file
        if file:
            items = list(file.get("bookmarks", {}).get("items", {}).values())
            names = [it.get("name") for it in items]
            assert "After-Sign-Out" not in names, "Bookmark uploaded after sign-out"
    finally:
        page.context.close()


def test_v0_migration_syncs_correctly(browser, fake_drive):
    """Legacy v0 (bare array) localStorage is migrated and synced to Drive."""
    fake_drive.reset()

    page = _make_page(browser, fake_drive)
    try:
        # Inject legacy v0 bookmark data before app loads.
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

        # Drive should have received the migrated data.
        with fake_drive._lock:
            assert fake_drive._file is not None, "Nothing uploaded to Drive"
            items = fake_drive._file.get("bookmarks", {}).get("items", {})
            drive_names = [v.get("name") for v in items.values()]
        assert "Legacy BM" in drive_names, f"Legacy bookmark not on Drive: {drive_names}"
    finally:
        page.context.close()


# ── v1.3.0: Drive 연결 해제 모달 ─────────────────────────────────────────────

def test_drive_disconnect_keep_file(browser, fake_drive):
    """'파일 유지' 경로: 동기화만 해제하고 Drive 파일은 보존된다."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive)
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


def test_drive_disconnect_delete_file(browser, fake_drive):
    """'파일도 삭제' 경로: 동기화 해제 후 Drive 파일도 삭제된다."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive)
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

def test_drive_diag_copy_shows_feedback(browser, fake_drive):
    """진단 복사 버튼 클릭 시 '복사됨 ✓' 또는 fallback textarea가 표시된다."""
    fake_drive.reset()
    page = _make_page(browser, fake_drive)
    try:
        _load(page)
        _enable_sync(page)

        # Settings popover → Drive info row
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
