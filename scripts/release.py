#!/usr/bin/env python3
"""
Release helper: bumps version.json and sw.js cache identifiers.

sw.js maintains three independent cache names:
    SHELL_CACHE = "shell-N"   -- app shell, bumped on every release
    DATA_CACHE  = "data-N"    -- bible/search JSON, bumped only when format changes
    AUDIO_CACHE = "audio-N"   -- mp3 files, bumped only when sources are re-encoded

Usage:
    python scripts/release.py patch                        # 1.0.13 -> 1.0.14, shell bump
    python scripts/release.py minor                        # 1.0.13 -> 1.1.0, shell bump
    python scripts/release.py major                        # 1.0.13 -> 2.0.0, shell bump
    python scripts/release.py 1.2.0                        # set explicit version, shell bump
    python scripts/release.py patch --bump-data            # also bump DATA_CACHE
    python scripts/release.py patch --bump-audio           # also bump AUDIO_CACHE
    python scripts/release.py patch --bump-data --bump-audio
    python scripts/release.py --bump-data                  # data bump only, no version change
    python scripts/release.py --bump-audio                 # audio bump only, no version change
"""

import argparse
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


def bump_cache_rev(sw_text: str, const_name: str, prefix: str) -> tuple[str, int]:
    """Increment the numeric rev in `const <const_name> = "<prefix>-N"`."""
    pattern = rf'const {const_name} = "{re.escape(prefix)}-(\d+)"'
    match = re.search(pattern, sw_text)
    if not match:
        raise ValueError(f"{const_name} pattern not found in sw.js")
    old_rev = int(match.group(1))
    new_rev = old_rev + 1
    new_text = sw_text.replace(
        f'const {const_name} = "{prefix}-{old_rev}"',
        f'const {const_name} = "{prefix}-{new_rev}"',
    )
    return new_text, new_rev


def main():
    parser = argparse.ArgumentParser(
        description="Bump version.json and sw.js cache identifiers.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "version",
        nargs="?",
        help="major | minor | patch | X.Y.Z (omit to skip version + shell bump)",
    )
    parser.add_argument("--bump-data", action="store_true", help="bump DATA_CACHE rev")
    parser.add_argument("--bump-audio", action="store_true", help="bump AUDIO_CACHE rev")
    args = parser.parse_args()

    if not args.version and not args.bump_data and not args.bump_audio:
        parser.print_help()
        sys.exit(1)

    version_path = ROOT / "version.json"
    sw_path = ROOT / "sw.js"
    sw_text = sw_path.read_text()

    # Version + shell bump
    if args.version:
        current = json.loads(version_path.read_text())["version"]
        if args.version in ("major", "minor", "patch"):
            new_version = bump_semver(current, args.version)
        elif re.match(r"^\d+\.\d+\.\d+$", args.version):
            new_version = args.version
        else:
            print("Error: version must be major/minor/patch or a semver string like 1.2.3")
            sys.exit(1)

        version_path.write_text(json.dumps({"version": new_version}) + "\n")
        sw_text, new_shell_rev = bump_cache_rev(sw_text, "SHELL_CACHE", "shell")
        print(f"version.json : {current} -> {new_version}")
        print(f"sw.js        : SHELL_CACHE bumped to shell-{new_shell_rev}")

    if args.bump_data:
        sw_text, new_data_rev = bump_cache_rev(sw_text, "DATA_CACHE", "data")
        print(f"sw.js        : DATA_CACHE bumped to data-{new_data_rev}")

    if args.bump_audio:
        sw_text, new_audio_rev = bump_cache_rev(sw_text, "AUDIO_CACHE", "audio")
        print(f"sw.js        : AUDIO_CACHE bumped to audio-{new_audio_rev}")

    sw_path.write_text(sw_text)


if __name__ == "__main__":
    main()
