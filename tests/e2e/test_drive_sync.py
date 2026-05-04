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
            doc_part = parts[-1].rsplit(b"\r\n", 1)[0] if len(parts) > 1 else parts[-1]
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


# ── GIS stub injected into every page ────────────────────────────────────────

GIS_STUB = """
window.__gisCallbacks = {};
window.google = {
  accounts: {
    id: { initialize: () => {}, prompt: () => {} },
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
    """Enable Drive sync and wait for IDLE state."""
    page.evaluate("window.driveSync.signIn()")
    page.wait_for_function(
        "() => window.driveSync?.getStatus() === 'IDLE'",
        timeout=5_000,
    )


def _add_bookmark(page: Page, name: str) -> str:
    """Add a bookmark via the store and return its id."""
    return page.evaluate(f"""
        (() => {{
            const id = 'bm-' + Math.random().toString(36).slice(2);
            const store = window.loadBookmarks ? window.loadBookmarks() : [];
            store.push({{ id, type: 'bookmark', name: {json.dumps(name)},
                          bookId: 'gen', chapter: 1, vref: 'gen 1:1',
                          verseSpec: '1' }});
            if (window.saveBookmarks) window.saveBookmarks(store);
            return id;
        }})()
    """)


def _bookmark_names(page: Page) -> list[str]:
    return page.evaluate("""
        (() => {
            const bms = window.loadBookmarks ? window.loadBookmarks() : [];
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
        page_a.evaluate("window.driveSync.scheduleUpload()")
        _wait_idle(page_a)

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
        page_a.evaluate("window.driveSync.scheduleUpload()")
        _wait_idle(page_a)

        # B starts with a clean slate, adds its own bookmark and syncs
        _load(page_b)
        _enable_sync(page_b)
        _wait_idle(page_b)  # initial download
        _add_bookmark(page_b, "Bookmark-B")
        page_b.evaluate("window.driveSync.scheduleUpload()")
        _wait_idle(page_b)

        # A re-syncs to pick up B's addition
        page_a.evaluate("window.driveSync.scheduleUpload()")
        _wait_idle(page_a)

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
        page.evaluate("window.driveSync.scheduleUpload()")

        # Machine should retry after 412 and eventually reach IDLE again.
        _wait_idle(page, timeout=8_000)

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
