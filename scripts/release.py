#!/usr/bin/env python3
"""
Release helper: bumps version.json and sw.js CACHE_NAME in one step.

Usage:
    python scripts/release.py patch        # 1.0.13 → 1.0.14
    python scripts/release.py minor        # 1.0.13 → 1.1.0
    python scripts/release.py major        # 1.0.13 → 2.0.0
    python scripts/release.py 1.2.0        # set explicit version
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def bump_semver(version: str, part: str) -> str:
    major, minor, patch = map(int, version.split("."))
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    if part == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError(f"Unknown bump part: {part}")


def bump_cache_rev(sw_text: str) -> tuple[str, int]:
    """Increment the numeric rev in CACHE_NAME = "rev-N"."""
    match = re.search(r'const CACHE_NAME = "rev-(\d+)"', sw_text)
    if not match:
        raise ValueError("CACHE_NAME pattern not found in sw.js")
    old_rev = int(match.group(1))
    new_rev = old_rev + 1
    new_text = sw_text.replace(
        f'const CACHE_NAME = "rev-{old_rev}"',
        f'const CACHE_NAME = "rev-{new_rev}"',
    )
    return new_text, new_rev


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)

    arg = sys.argv[1]

    version_path = ROOT / "version.json"
    sw_path = ROOT / "sw.js"

    # Read current version
    current = json.loads(version_path.read_text())["version"]

    # Determine new version
    if arg in ("major", "minor", "patch"):
        new_version = bump_semver(current, arg)
    elif re.match(r"^\d+\.\d+\.\d+$", arg):
        new_version = arg
    else:
        print(f"Error: argument must be major/minor/patch or a semver string like 1.2.3")
        sys.exit(1)

    # Update version.json
    version_path.write_text(json.dumps({"version": new_version}) + "\n")

    # Update sw.js CACHE_NAME
    sw_text = sw_path.read_text()
    new_sw_text, new_rev = bump_cache_rev(sw_text)
    sw_path.write_text(new_sw_text)

    print(f"version.json : {current} → {new_version}")
    print(f"sw.js        : CACHE_NAME rev bumped to rev-{new_rev}")


if __name__ == "__main__":
    main()
