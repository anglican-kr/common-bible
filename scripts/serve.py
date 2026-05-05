#!/usr/bin/env python3
"""SPA-aware dev server — replaces `python -m http.server`.

Falls back to /index.html for any path that is not a real file,
mirroring the nginx `try_files $uri $uri/ /index.html` rule used in
production.  This means Ctrl+Shift+R (hard reload, SW bypassed) works
the same way locally as it does on the live server.

By default, all responses are sent with cache-disabling headers so that
edits to JS/CSS/JSON show up on a plain reload.  Pass --cache to keep
the browser's default caching behavior (useful when verifying
production-like cache flow).

Usage:
    python3 scripts/serve.py                # port 8080, no-cache (default)
    python3 scripts/serve.py 8090           # port 8090, no-cache
    python3 scripts/serve.py --cache        # port 8080, caching enabled
    python3 scripts/serve.py 8090 --cache   # port 8090, caching enabled
"""

import argparse
import http.server
import pathlib


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    no_cache: bool = True

    def do_GET(self) -> None:
        # Strip query string to locate the file on disk.
        path_only = self.path.split("?", 1)[0].split("#", 1)[0]
        candidate = pathlib.Path(self.directory) / path_only.lstrip("/")  # type: ignore[attr-defined]

        if not candidate.exists() or candidate.is_dir() and not (candidate / "index.html").exists():
            # Non-existent path → serve index.html (SPA fallback).
            self.path = "/index.html"

        super().do_GET()

    def end_headers(self) -> None:
        if self.no_cache:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:  # noqa: D102
        super().log_message(fmt, *args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("port", nargs="?", type=int, default=8080)
    parser.add_argument(
        "--cache",
        action="store_true",
        help="Allow normal browser caching (default: disabled for dev).",
    )
    args = parser.parse_args()

    SPAHandler.no_cache = not args.cache
    SPAHandler.directory = str(pathlib.Path(__file__).parent.parent)  # type: ignore[attr-defined]

    server = http.server.ThreadingHTTPServer(("", args.port), SPAHandler)
    cache_state = "cached" if args.cache else "no-cache"
    print(f"Serving at http://localhost:{args.port}  (SPA fallback, {cache_state})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
