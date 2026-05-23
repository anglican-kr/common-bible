#!/usr/bin/env python3
"""Unit tests for scripts/changelog.py — pure-function helpers only.

The git/gh boundary (`git`, `submodule_sha`, `compare_payload`, `app_entries`,
`data_entries`, `main`) is not covered here; exercise it via
`python scripts/changelog.py <from-tag> <to-tag>` after each change.

Run: python -m unittest scripts/test_changelog.py
"""

import unittest

import changelog


class SlugFromUrlTest(unittest.TestCase):
    def test_ssh_url(self):
        self.assertEqual(
            changelog.slug_from_url("git@github.com:anglican-kr/common-bible-data.git"),
            "anglican-kr/common-bible-data",
        )

    def test_https_url(self):
        self.assertEqual(
            changelog.slug_from_url("https://github.com/anglican-kr/common-bible.git"),
            "anglican-kr/common-bible",
        )

    def test_https_url_without_suffix(self):
        self.assertEqual(
            changelog.slug_from_url("https://github.com/anglican-kr/common-bible"),
            "anglican-kr/common-bible",
        )

    def test_trailing_whitespace_tolerated(self):
        self.assertEqual(
            changelog.slug_from_url("git@github.com:a/b.git\n"),
            "a/b",
        )

    def test_unparseable_raises(self):
        with self.assertRaises(ValueError):
            changelog.slug_from_url("not-a-url")


class NoiseFilterTest(unittest.TestCase):
    def test_release_commit_is_app_noise(self):
        self.assertTrue(changelog.is_app_noise("chore: 1.4.17 릴리스"))

    def test_release_commit_with_suffix_is_app_noise(self):
        self.assertTrue(
            changelog.is_app_noise("chore: 1.4.12 릴리스 — version.json bump")
        )

    def test_feature_commit_is_not_app_noise(self):
        self.assertFalse(changelog.is_app_noise("feat: 칠십인역 단독 절 표기 렌더링"))

    def test_chore_non_release_is_not_app_noise(self):
        self.assertFalse(changelog.is_app_noise("chore: 의존성 정리"))

    def test_skip_ci_is_data_noise(self):
        self.assertTrue(changelog.is_data_noise("build: 파이프라인 자동 빌드 [skip ci]"))

    def test_data_commit_is_not_data_noise(self):
        self.assertFalse(changelog.is_data_noise("data: 예레미야 2-17장 리포맷"))


class EntriesFromCompareTest(unittest.TestCase):
    def test_extracts_subject_and_login(self):
        payload = {
            "commits": [
                {
                    "commit": {"message": "data: 예레미야 2-17장 리포맷"},
                    "author": {"login": "joshua-h"},
                },
                {
                    "commit": {"message": "fix: 운문 형식 통일"},
                    "author": {"login": "x6a6f73687561"},
                },
            ]
        }
        self.assertEqual(
            changelog.entries_from_compare(payload),
            [
                ("data: 예레미야 2-17장 리포맷", "joshua-h"),
                ("fix: 운문 형식 통일", "x6a6f73687561"),
            ],
        )

    def test_uses_only_first_line_of_message(self):
        payload = {
            "commits": [
                {
                    "commit": {"message": "feat: 제목\n\n본문 설명\n"},
                    "author": {"login": "user"},
                }
            ]
        }
        self.assertEqual(
            changelog.entries_from_compare(payload), [("feat: 제목", "user")]
        )

    def test_no_commits_key(self):
        self.assertEqual(changelog.entries_from_compare({}), [])

    def test_skips_empty_message(self):
        payload = {
            "commits": [
                {"commit": {"message": ""}, "author": {"login": "a"}},
                {"commit": {}, "author": {"login": "b"}},
            ]
        }
        self.assertEqual(changelog.entries_from_compare(payload), [])

    def test_author_null_yields_empty_login(self):
        """GitHub returns null author when email can't be mapped to a user."""
        payload = {
            "commits": [
                {"commit": {"message": "data: 익명 푸시"}, "author": None},
            ]
        }
        self.assertEqual(
            changelog.entries_from_compare(payload), [("data: 익명 푸시", "")]
        )

    def test_author_missing_yields_empty_login(self):
        payload = {"commits": [{"commit": {"message": "fix: foo"}}]}
        self.assertEqual(
            changelog.entries_from_compare(payload), [("fix: foo", "")]
        )


class FilterEntriesTest(unittest.TestCase):
    def test_filters_app_release_commits(self):
        entries = [
            ("feat: a", "u1"),
            ("chore: 1.4.17 릴리스", "u2"),
            ("fix: b", "u3"),
        ]
        self.assertEqual(
            changelog.filter_entries(entries, changelog.is_app_noise),
            [("feat: a", "u1"), ("fix: b", "u3")],
        )

    def test_filters_data_skip_ci_commits(self):
        entries = [
            ("data: a", "u1"),
            ("build: 자동 빌드 [skip ci]", "github-actions[bot]"),
            ("fix: b", "u2"),
        ]
        self.assertEqual(
            changelog.filter_entries(entries, changelog.is_data_noise),
            [("data: a", "u1"), ("fix: b", "u2")],
        )


class FormatEntryTest(unittest.TestCase):
    def test_with_login(self):
        self.assertEqual(changelog.format_entry("feat: a", "joshua"), "- feat: a (@joshua)")

    def test_without_login(self):
        self.assertEqual(changelog.format_entry("feat: a", ""), "- feat: a")


class FormatSectionTest(unittest.TestCase):
    def test_heading_and_bullets(self):
        self.assertEqual(
            changelog.format_section(
                "### 앱", [("feat: a", "joshua"), ("fix: b", "")]
            ),
            "### 앱\n- feat: a (@joshua)\n- fix: b",
        )

    def test_heading_only_when_no_items(self):
        self.assertEqual(changelog.format_section("### 앱", []), "### 앱")


class RenderTest(unittest.TestCase):
    URL = "https://github.com/anglican-kr/common-bible/compare/1.4.14...1.4.17"

    def test_both_sections(self):
        out = changelog.render(
            [("feat: a", "u1")], [("data: b", "u2")], self.URL
        )
        self.assertIn("## 변경 사항", out)
        self.assertIn("### 앱\n- feat: a (@u1)", out)
        self.assertIn("### 본문 데이터\n- data: b (@u2)", out)
        self.assertIn(f"**Full Changelog**: {self.URL}", out)

    def test_app_section_omitted_when_empty(self):
        out = changelog.render([], [("data: b", "u")], self.URL)
        self.assertNotIn("### 앱", out)
        self.assertIn("### 본문 데이터", out)

    def test_data_section_omitted_when_empty(self):
        out = changelog.render([("feat: a", "u")], [], self.URL)
        self.assertIn("### 앱", out)
        self.assertNotIn("### 본문 데이터", out)

    def test_message_when_both_empty(self):
        out = changelog.render([], [], self.URL)
        self.assertIn("기록된 변경 사항이 없습니다", out)

    def test_trailing_newline(self):
        self.assertTrue(
            changelog.render([("feat: a", "u")], [], self.URL).endswith("\n")
        )


if __name__ == "__main__":
    unittest.main()
