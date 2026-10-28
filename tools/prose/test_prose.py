#!/usr/bin/env python3
"""Unit tests for tools/prose/prose.py.

Run: python3 -m unittest tools/prose/test_prose.py
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prose  # noqa: E402


def comments(path, src):
    return [src[a:b] for a, b in prose.comment_spans(path, src)]


def checks(text, kind="md", path="a.md"):
    return [cid for cid, _ in prose.check_line(text, kind, path)]


class CommentExtractionTest(unittest.TestCase):
    def test_js_string_with_slashes_is_code(self):
        self.assertEqual(comments("a.js", 'const u = "http://x"; // 주석\n'), ["// 주석"])

    def test_js_regex_literal_is_code(self):
        self.assertEqual(comments("a.js", "const r = /\\/\\//g; // c\n"), ["// c"])

    def test_js_division_is_not_a_regex(self):
        self.assertEqual(comments("a.js", "const x = a / b; // c / d\n"), ["// c / d"])

    def test_js_template_literal_with_nested_string(self):
        self.assertEqual(comments("a.js", 'const t = `a ${"//"} b`; /* 블록 */\n'), ["/* 블록 */"])

    def test_css_only_block_comments(self):
        self.assertEqual(comments("a.css", 'a { b: "/*x*/"; } /* 주석 */ // not a comment\n'), ["/* 주석 */"])

    def test_yaml_hash_comment_outside_quotes(self):
        src = 'run: echo "#x" # 주석\nother: ${#var}\n'
        self.assertEqual(comments("a.yml", src), ["# 주석"])

    def test_python_comment_and_docstring(self):
        src = 'def f():\n    """설명."""\n    return 1  # 주석\n'
        self.assertEqual(sorted(comments("a.py", src)), ['"""설명."""', "# 주석"])

    def test_md_skips_fences_and_frontmatter(self):
        src = "---\ntitle: x\n---\n본문\n```\n코드 을\n```\n끝\n"
        self.assertEqual([t for _, t, _ in prose.md_segments(src)], ["본문", "끝"])


class CheckLineTest(unittest.TestCase):
    def test_spaced_particle_after_code_name(self):
        self.assertIn("particle", checks("`sync.json` 을 읽는다"))

    def test_attached_particle_is_fine(self):
        self.assertNotIn("particle", checks("`sync.json`을 읽는다"))

    def test_noun_after_english_keeps_its_space(self):
        self.assertEqual(checks("HTTP 실패와 `x` 함수"), [])

    def test_quotation_is_not_checked(self):
        self.assertNotIn("particle", checks("예: 「`sync.json` 을」"))

    def test_ambiguous_particle_needs_judgement(self):
        found = checks("(`storage` 이벤트) 이 탭도 멈춘다")
        self.assertIn("particle?", found)
        self.assertNotIn("particle", found)

    def test_tilde_range(self):
        self.assertIn("tilde", checks("값은 1~2px이다"))
        self.assertNotIn("tilde", checks("값은 `1~2px`이다"))

    def test_banned_term_except_in_the_rule_book(self):
        self.assertIn("term", checks("센티널을 지킨다"))
        self.assertNotIn("term", checks("센티널을 지킨다", path="docs/writing.md"))

    def test_kkol(self):
        self.assertIn("term", checks("같은 꼴로 쓴다"))
        self.assertNotIn("term", checks("꼴찌가 아니다"))

    def test_chrome_means_ui_but_not_the_browser(self):
        self.assertIn("term", checks("하단 chrome을 숨긴다"))
        self.assertNotIn("term", checks("Android Chrome과 chromium에서 확인한다"))

    def test_winning_needs_judgement(self):
        self.assertIn("term?", checks("다른 기기의 수정이 병합에서 이긴다"))
        self.assertNotIn("term?", checks("줄이기는 채택하지 않았다"))
        self.assertNotIn("term?", checks("1차 방어이긴 하지만"))
        self.assertIn("term?", checks("두 사본은 병합이 원격 쪽을 고를 수 있다"))

    def test_borrowed_verb(self):
        self.assertIn("verb?", checks("시크릿에 닿지 못한다"))

    def test_english_word_in_korean_sentence(self):
        self.assertIn("english?", checks("pill을 누르면 열린다"))
        self.assertNotIn("english?", checks("`pill`을 누르면 열린다"))
        self.assertNotIn("english?", checks("Chrome에서 쌓임 맥락(stacking context)을 만든다"))

    def test_english_comment_is_not_checked(self):
        self.assertNotIn("english?", checks("// returns the id of the 축일", kind="comment", path="a.js"))


class SameCodeTest(unittest.TestCase):
    def test_js_comment_change_is_same_code(self):
        a = "const x = 1; // 옛 주석\n/* 블록 */ f(x);\n"
        b = "const x = 1; // 새 주석\n/* 고친 블록 */ f(x);\n"
        self.assertEqual(prose.strip_comments("a.js", a), prose.strip_comments("a.js", b))

    def test_js_code_change_is_caught(self):
        self.assertNotEqual(prose.strip_comments("a.js", "f(1); // c\n"), prose.strip_comments("a.js", "f(2); // c\n"))

    def test_js_string_change_is_caught(self):
        self.assertNotEqual(prose.strip_comments("a.js", 'test("옛 이름");\n'), prose.strip_comments("a.js", 'test("새 이름");\n'))

    def test_python_docstring_change_is_same_code(self):
        a = 'def f():\n    """옛 설명."""\n    return 1  # c\n'
        b = 'def f():\n    """새 설명."""\n    return 1  # d\n'
        self.assertEqual(prose.strip_comments("a.py", a), prose.strip_comments("a.py", b))

    def test_yaml_comment_change_is_same_code(self):
        a = "on:\n  # 옛 주석\n  push:\n"
        b = "on:\n  # 새 주석\n  # 한 줄 더\n  push:\n"
        self.assertEqual(prose.strip_comments("a.yml", a), prose.strip_comments("a.yml", b))

    def test_markdown_may_change(self):
        self.assertIsNone(prose.strip_comments("a.md", "아무 글"))


class AllowTest(unittest.TestCase):
    def test_folder_prefix(self):
        self.assertTrue(prose.allowed("tools/prose/prose.py", ["tools/prose/"]))
        self.assertTrue(prose.allowed("tools/prose/prose.py", ["tools/prose"]))

    def test_exact_file_and_lookalike(self):
        self.assertTrue(prose.allowed("tools/prose/prose.py", ["tools/prose/prose.py"]))
        self.assertFalse(prose.allowed("tools/prose-old/x.py", ["tools/prose"]))
        self.assertFalse(prose.allowed("js/app.js", []))


class GithubEscapeTest(unittest.TestCase):
    def test_file_name_cannot_start_another_command(self):
        self.assertEqual(prose.gh_prop("a,b::c\n::x"), "a%2Cb%3A%3Ac%0A%3A%3Ax")
        self.assertEqual(prose.gh_data("50% 끝\n::x"), "50%25 끝%0A::x")


if __name__ == "__main__":
    unittest.main()
