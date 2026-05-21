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

common-bible-data is a private repo, so its commits are listed as plain text
(no links — they would 404 for the public).

Usage:
    python scripts/changelog.py <from-ref> [<to-ref>]

    <from-ref>  previous release tag, e.g. 1.4.14
    <to-ref>    current release tag (default: HEAD)

Pass the new tag as <to-ref> when cutting a release so the Full Changelog
link resolves publicly. Prints a markdown section to stdout for inclusion in
the GitHub release body. Requires `gh` authenticated with read access to
common-bible-data.
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
    """True for app commits that should not appear in a changelog."""
    return bool(RELEASE_COMMIT_RE.match(subject))


def is_data_noise(subject: str) -> bool:
    """True for data-repo commits that should not appear in a changelog."""
    return SKIP_CI_MARKER in subject


def subjects_from_log(text: str) -> list[str]:
    """Split `git log --format=%s` output into non-empty subject lines."""
    return [line for line in text.splitlines() if line.strip()]


def filter_subjects(subjects: list[str], is_noise) -> list[str]:
    return [s for s in subjects if not is_noise(s)]


def subjects_from_compare(payload: dict) -> list[str]:
    """First line of each commit message in a GitHub compare API response."""
    out = []
    for entry in payload.get("commits", []):
        message = entry.get("commit", {}).get("message", "")
        subject = message.splitlines()[0] if message else ""
        if subject:
            out.append(subject)
    return out


def format_section(heading: str, items: list[str]) -> str:
    return "\n".join([heading, *(f"- {s}" for s in items)])


def render(app_items: list[str], data_items: list[str], compare_url: str) -> str:
    blocks = ["## 변경 사항"]
    if app_items:
        blocks.append(format_section("### 앱", app_items))
    if data_items:
        blocks.append(format_section("### 본문 데이터", data_items))
    if not app_items and not data_items:
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


def app_subjects(from_ref: str, to_ref: str) -> list[str]:
    log = git("log", "--no-merges", "--format=%s", f"{from_ref}..{to_ref}")
    return filter_subjects(subjects_from_log(log), is_app_noise)


def data_subjects(from_sha: str, to_sha: str, slug: str) -> list[str]:
    if from_sha == to_sha:
        return []
    raw = subprocess.run(
        ["gh", "api", f"repos/{slug}/compare/{from_sha}...{to_sha}"],
        check=True, capture_output=True, text=True,
    ).stdout
    return filter_subjects(subjects_from_compare(json.loads(raw)), is_data_noise)


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

    app_items = app_subjects(from_ref, to_ref)
    data_items = data_subjects(
        submodule_sha(from_ref), submodule_sha(to_ref), data_slug
    )

    compare_url = f"https://github.com/{app_slug}/compare/{from_ref}...{to_ref}"
    print(render(app_items, data_items, compare_url), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
