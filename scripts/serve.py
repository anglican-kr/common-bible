#!/usr/bin/env python3
"""SPA-aware dev server — replaces `python -m http.server`.

Falls back to /index.html for any path that is not a real file,
mirroring the nginx `try_files $uri $uri/ /index.html` rule used in
production.  This means Ctrl+Shift+R (hard reload, SW bypassed) works
the same way locally as it does on the live server.

Usage:
    python3 scripts/serve.py           # default: port 8080
    python3 scripts/serve.py 8090
"""

import http.server
import pathlib
import sys


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        # Strip query string to locate the file on disk.
        path_only = self.path.split("?", 1)[0].split("#", 1)[0]
        candidate = pathlib.Path(self.directory) / path_only.lstrip("/")  # type: ignore[attr-defined]

        if not candidate.exists() or candidate.is_dir() and not (candidate / "index.html").exists():
            # Non-existent path → serve index.html (SPA fallback).
            self.path = "/index.html"

        super().do_GET()

    def log_message(self, fmt: str, *args: object) -> None:  # noqa: D102
        super().log_message(fmt, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = http.server.ThreadingHTTPServer(("", port), SPAHandler)
    server.RequestHandlerClass.directory = str(pathlib.Path(__file__).parent.parent)  # type: ignore[attr-defined]
    print(f"Serving at http://localhost:{port}  (SPA fallback enabled)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
