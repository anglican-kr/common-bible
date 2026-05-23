#!/usr/bin/env python3
"""
Release-notes changelog generator.

GitHub's `--generate-notes` "What's Changed" lists merged pull requests only —
commits pushed straight to main never appear, and it has no visibility into the
common-bible-data submodule at all. This script builds a complete changelog
from git history instead:

  - 앱        every commit in <from>..<to> of this repo (PR or direct push),
              minus release-bump commits.
  - 본문 데이터  commits in the common-bible-data submodule between the pointer
              recorded at <from> and the one at <to>, minus CI build commits.

Each entry carries the committer's GitHub login (`@user`). GitHub renders bare
`@mentions` in release body text as user links automatically, so no explicit
markdown links are emitted. Commits whose author email cannot be mapped to a
GitHub account are listed without a login.

common-bible-data is a private repo, so its commits are listed as plain text
(no compare-URL links — they would 404 for the public).

Usage:
    python scripts/changelog.py <from-ref> [<to-ref>]

    <from-ref>  previous release tag, e.g. 1.4.14
    <to-ref>    current release tag (default: HEAD)

Pass the new tag as <to-ref> when cutting a release so the Full Changelog
link resolves publicly. Prints a markdown section to stdout for inclusion in
the GitHub release body. Requires `gh` authenticated with read access to
common-bible-data (and to common-bible for the app compare).
"""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
GITMODULES = ROOT / ".gitmodules"

# Commit-subject patterns dropped as noise.
RELEASE_COMMIT_RE = re.compile(r"^chore: \d+\.\d+\.\d+ 릴리스")
SYNC_COMMIT_RE = re.compile(r"^data: 서브모듈 포인터 \+ sitemap 갱신$")
SKIP_CI_MARKER = "[skip ci]"

SLUG_RE = re.compile(r"[:/]([^/:]+)/([^/]+?)(?:\.git)?$")


# ── pure helpers (unit-tested in test_changelog.py) ──────────────────────────

def slug_from_url(url: str) -> str:
    """Extract 'owner/repo' from an SSH or HTTPS GitHub remote URL."""
    m = SLUG_RE.search(url.strip())
    if not m:
        raise ValueError(f"cannot parse owner/repo from URL: {url}")
    return f"{m.group(1)}/{m.group(2)}"


def is_app_noise(subject: str) -> bool:
    """True for app commits that should not appear in a changelog.

    Filters: release-bump commits and webhook-synthesized data-sync commits.
    Hand-authored `data:` commits (e.g. manual submodule bump messages) pass
    through — only the exact webhook signature matches.
    """
    return bool(
        RELEASE_COMMIT_RE.match(subject) or SYNC_COMMIT_RE.match(subject)
    )


def is_data_noise(subject: str) -> bool:
    """True for data-repo commits that should not appear in a changelog."""
    return SKIP_CI_MARKER in subject


def entries_from_compare(payload: dict) -> list[tuple[str, str]]:
    """(subject, login) per commit in a GitHub compare API response.

    `login` is empty when GitHub can't map the commit author to a user
    (unmatched email, deleted account, …).
    """
    out: list[tuple[str, str]] = []
    for entry in payload.get("commits", []):
        message = entry.get("commit", {}).get("message", "")
        subject = message.splitlines()[0] if message else ""
        if not subject:
            continue
        author = entry.get("author") or {}
        login = author.get("login", "") if isinstance(author, dict) else ""
        out.append((subject, login))
    return out


def filter_entries(
    entries: list[tuple[str, str]], is_noise
) -> list[tuple[str, str]]:
    return [(s, l) for s, l in entries if not is_noise(s)]


def format_entry(subject: str, login: str) -> str:
    return f"- {subject} (@{login})" if login else f"- {subject}"


def format_section(heading: str, entries: list[tuple[str, str]]) -> str:
    return "\n".join([heading, *(format_entry(s, l) for s, l in entries)])


def render(
    app_entries: list[tuple[str, str]],
    data_entries: list[tuple[str, str]],
    compare_url: str,
) -> str:
    blocks = ["## 변경 사항"]
    if app_entries:
        blocks.append(format_section("### 앱", app_entries))
    if data_entries:
        blocks.append(format_section("### 본문 데이터", data_entries))
    if not app_entries and not data_entries:
        blocks.append("이 릴리스에는 기록된 변경 사항이 없습니다.")
    blocks.append(f"**Full Changelog**: {compare_url}")
    return "\n\n".join(blocks) + "\n"


# ── git / gh boundary ────────────────────────────────────────────────────────

def git(*args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=True, capture_output=True, text=True,
    ).stdout


def submodule_sha(ref: str, path: str = "data") -> str:
    """The gitlink SHA recorded for a submodule at the given ref."""
    fields = git("ls-tree", ref, path).split()
    # `160000 commit <sha>\t<path>`
    if len(fields) < 3:
        raise ValueError(f"no submodule '{path}' recorded at {ref}")
    return fields[2]


def compare_payload(slug: str, from_ref: str, to_ref: str) -> dict:
    raw = subprocess.run(
        ["gh", "api", f"repos/{slug}/compare/{from_ref}...{to_ref}"],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(raw)


def app_entries(slug: str, from_ref: str, to_ref: str) -> list[tuple[str, str]]:
    return filter_entries(
        entries_from_compare(compare_payload(slug, from_ref, to_ref)),
        is_app_noise,
    )


def data_entries(
    from_sha: str, to_sha: str, slug: str
) -> list[tuple[str, str]]:
    if from_sha == to_sha:
        return []
    return filter_entries(
        entries_from_compare(compare_payload(slug, from_sha, to_sha)),
        is_data_noise,
    )


def main(argv: list[str]) -> int:
    if not 1 <= len(argv) <= 2:
        print(__doc__, file=sys.stderr)
        return 2
    from_ref = argv[0]
    to_ref = argv[1] if len(argv) == 2 else "HEAD"

    app_slug = slug_from_url(git("config", "remote.origin.url"))
    data_slug = slug_from_url(
        git("config", "-f", str(GITMODULES), "submodule.data.url")
    )

    app_items = app_entries(app_slug, from_ref, to_ref)
    data_items = data_entries(
        submodule_sha(from_ref), submodule_sha(to_ref), data_slug
    )

    compare_url = f"https://github.com/{app_slug}/compare/{from_ref}...{to_ref}"
    print(render(app_items, data_items, compare_url), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
