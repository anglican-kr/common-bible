#!/usr/bin/env python3
"""Unit tests for scripts/changelog.py — pure-function helpers only.

The git/gh boundary (`git`, `submodule_sha`, `app_subjects`, `data_subjects`,
`main`) is not covered here; exercise it via
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


class SubjectsFromLogTest(unittest.TestCase):
    def test_splits_lines(self):
        self.assertEqual(
            changelog.subjects_from_log("feat: a\nfix: b\n"),
            ["feat: a", "fix: b"],
        )

    def test_drops_blank_lines(self):
        self.assertEqual(
            changelog.subjects_from_log("feat: a\n\n  \nfix: b\n"),
            ["feat: a", "fix: b"],
        )

    def test_empty_input(self):
        self.assertEqual(changelog.subjects_from_log(""), [])


class FilterSubjectsTest(unittest.TestCase):
    def test_filters_app_release_commits(self):
        subjects = ["feat: a", "chore: 1.4.17 릴리스", "fix: b"]
        self.assertEqual(
            changelog.filter_subjects(subjects, changelog.is_app_noise),
            ["feat: a", "fix: b"],
        )

    def test_filters_data_skip_ci_commits(self):
        subjects = ["data: a", "build: 자동 빌드 [skip ci]", "fix: b"]
        self.assertEqual(
            changelog.filter_subjects(subjects, changelog.is_data_noise),
            ["data: a", "fix: b"],
        )


class SubjectsFromCompareTest(unittest.TestCase):
    def test_extracts_subjects(self):
        payload = {
            "commits": [
                {"commit": {"message": "data: 예레미야 2-17장 리포맷"}},
                {"commit": {"message": "fix: 운문 형식 통일"}},
            ]
        }
        self.assertEqual(
            changelog.subjects_from_compare(payload),
            ["data: 예레미야 2-17장 리포맷", "fix: 운문 형식 통일"],
        )

    def test_uses_only_first_line_of_message(self):
        payload = {"commits": [{"commit": {"message": "feat: 제목\n\n본문 설명\n"}}]}
        self.assertEqual(changelog.subjects_from_compare(payload), ["feat: 제목"])

    def test_no_commits_key(self):
        self.assertEqual(changelog.subjects_from_compare({}), [])

    def test_skips_empty_message(self):
        payload = {"commits": [{"commit": {"message": ""}}, {"commit": {}}]}
        self.assertEqual(changelog.subjects_from_compare(payload), [])


class FormatSectionTest(unittest.TestCase):
    def test_heading_and_bullets(self):
        self.assertEqual(
            changelog.format_section("### 앱", ["feat: a", "fix: b"]),
            "### 앱\n- feat: a\n- fix: b",
        )

    def test_heading_only_when_no_items(self):
        self.assertEqual(changelog.format_section("### 앱", []), "### 앱")


class RenderTest(unittest.TestCase):
    URL = "https://github.com/anglican-kr/common-bible/compare/1.4.14...1.4.17"

    def test_both_sections(self):
        out = changelog.render(["feat: a"], ["data: b"], self.URL)
        self.assertIn("## 변경 사항", out)
        self.assertIn("### 앱\n- feat: a", out)
        self.assertIn("### 본문 데이터\n- data: b", out)
        self.assertIn(f"**Full Changelog**: {self.URL}", out)

    def test_app_section_omitted_when_empty(self):
        out = changelog.render([], ["data: b"], self.URL)
        self.assertNotIn("### 앱", out)
        self.assertIn("### 본문 데이터", out)

    def test_data_section_omitted_when_empty(self):
        out = changelog.render(["feat: a"], [], self.URL)
        self.assertIn("### 앱", out)
        self.assertNotIn("### 본문 데이터", out)

    def test_message_when_both_empty(self):
        out = changelog.render([], [], self.URL)
        self.assertIn("기록된 변경 사항이 없습니다", out)

    def test_trailing_newline(self):
        self.assertTrue(changelog.render(["feat: a"], [], self.URL).endswith("\n"))


if __name__ == "__main__":
    unittest.main()
