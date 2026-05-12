#!/usr/bin/env python3
"""
Release helper: bumps version.json and sw-version.js together.

Both files carry the same semver. sw-version.js is importScripts'd by sw.js
to derive SHELL_CACHE = "shell-<version>" — bumping it changes the SW's
byte-diff, which is how the SW update algorithm detects a new release.

DATA_CACHE and AUDIO_CACHE no longer have rev identifiers; per-file
invalidation is driven by content-hash manifests in the data submodule
(bible-manifest.json, audio-manifest.json) and applied by
js/manifest-sync.js on the client. See ADR-021.

Usage:
    python scripts/release.py patch        # 1.4.12 -> 1.4.13
    python scripts/release.py minor        # 1.4.12 -> 1.5.0
    python scripts/release.py major        # 1.4.12 -> 2.0.0
    python scripts/release.py 1.2.0        # set explicit version

The script stages version.json, sw-version.js, and the data submodule
pointer, then commits with the conventional message. It does not push —
that step stays manual.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
VERSION_PATH = ROOT / "version.json"
SW_VERSION_PATH = ROOT / "sw-version.js"

SW_VERSION_RE = re.compile(r'(self\.APP_VERSION\s*=\s*")[^"]*(";)')


def bump_semver(version: str, part: str) -> str:
    major, minor, patch = map(int, version.split("."))
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError(f"Unknown bump part: {part}")


def write_sw_version(text: str, new_version: str) -> str:
    if not SW_VERSION_RE.search(text):
        raise ValueError("self.APP_VERSION assignment not found in sw-version.js")
    return SW_VERSION_RE.sub(rf'\g<1>{new_version}\g<2>', text)


def stage_and_commit(new_version: str) -> None:
    paths = ["version.json", "sw-version.js", "data"]
    subprocess.run(["git", "add", *paths], cwd=ROOT, check=True)
    # Only the actually-modified files end up in the commit; `git add data`
    # is harmless when the submodule pointer is unchanged.
    has_changes = subprocess.run(
        ["git", "diff", "--cached", "--quiet"], cwd=ROOT
    ).returncode != 0
    if not has_changes:
        print("no staged changes after add — aborting commit", file=sys.stderr)
        sys.exit(1)
    message = f"chore: {new_version} 릴리스"
    subprocess.run(["git", "commit", "-m", message], cwd=ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "version",
        help="major | minor | patch | X.Y.Z",
    )
    args = parser.parse_args()

    current = json.loads(VERSION_PATH.read_text())["version"]
    if args.version in ("major", "minor", "patch"):
        new_version = bump_semver(current, args.version)
    elif re.match(r"^\d+\.\d+\.\d+$", args.version):
        new_version = args.version
    else:
        print("Error: version must be major/minor/patch or a semver like 1.2.3",
              file=sys.stderr)
        return 1

    VERSION_PATH.write_text(json.dumps({"version": new_version}) + "\n")
    sw_text = SW_VERSION_PATH.read_text()
    SW_VERSION_PATH.write_text(write_sw_version(sw_text, new_version))

    print(f"version.json   : {current} -> {new_version}")
    print(f"sw-version.js  : APP_VERSION -> {new_version}")

    stage_and_commit(new_version)
    print(f"committed: chore: {new_version} 릴리스")
    return 0


if __name__ == "__main__":
    sys.exit(main())
