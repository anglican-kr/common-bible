#!/usr/bin/env python3
"""Unit tests for scripts/release.py — pure-function helpers only.

`stage_and_commit` is not covered here (it calls git on the repo); manually
exercise it via `python scripts/release.py patch` after each rewrite.

Run: python -m unittest scripts/test_release.py
"""

import unittest

import release


class BumpSemverTest(unittest.TestCase):
    def test_patch(self):
        self.assertEqual(release.bump_semver("1.4.12", "patch"), "1.4.13")

    def test_minor(self):
        self.assertEqual(release.bump_semver("1.4.12", "minor"), "1.5.0")

    def test_major(self):
        self.assertEqual(release.bump_semver("1.4.12", "major"), "2.0.0")

    def test_minor_resets_patch(self):
        self.assertEqual(release.bump_semver("1.4.7", "minor"), "1.5.0")

    def test_major_resets_minor_and_patch(self):
        self.assertEqual(release.bump_semver("3.2.9", "major"), "4.0.0")

    def test_unknown_part_raises(self):
        with self.assertRaises(ValueError):
            release.bump_semver("1.0.0", "unknown")


class WriteSwVersionTest(unittest.TestCase):
    def test_replaces_existing_value(self):
        text = '// comment\nself.APP_VERSION = "1.4.12";\n// trailer\n'
        out = release.write_sw_version(text, "1.4.13")
        self.assertIn('self.APP_VERSION = "1.4.13";', out)
        self.assertNotIn("1.4.12", out)

    def test_preserves_surrounding_content(self):
        text = ("// header\n"
                'self.APP_VERSION = "0.0.1";\n'
                "// footer with self.APP_VERSION reference\n")
        out = release.write_sw_version(text, "2.0.0")
        self.assertIn("// header", out)
        self.assertIn("// footer with self.APP_VERSION reference", out)

    def test_tolerates_extra_whitespace(self):
        text = 'self.APP_VERSION   =   "1.0.0";\n'
        out = release.write_sw_version(text, "1.0.1")
        self.assertIn("1.0.1", out)

    def test_raises_when_assignment_missing(self):
        with self.assertRaises(ValueError):
            release.write_sw_version("// no version here\n", "1.0.0")


if __name__ == "__main__":
    unittest.main()
