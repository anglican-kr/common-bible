"""Shared fixtures and helpers for e2e tests.

Prerequisites: a dev server must be running at BASE_URL.
    python3 -m http.server 8080   (or npx serve .)
"""

import pytest

BASE_URL = "http://localhost:8080"


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL


def wait_app_ready(page) -> None:
    """Block until the SPA shell has rendered at least one child element."""
    page.wait_for_selector("#search-input")
    page.wait_for_function(
        "() => !!document.getElementById('app') && "
        "document.getElementById('app').children.length > 0"
    )
