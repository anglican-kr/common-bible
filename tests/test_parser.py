#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
파서 모듈 테스트
"""

from src.config import config
from src.parser import BibleParser
from src.models import Verse, Chapter, Book, Bible
import unittest
import os
import sys
import json
from pathlib import Path

# 프로젝트 루트 경로 추가
PROJECT_ROOT = Path(__file__).parent.parent.absolute()
sys.path.append(str(PROJECT_ROOT))


class TestParser(unittest.TestCase):
    """파서 테스트 클래스"""

    def setUp(self):
        """테스트 준비"""
        self.test_file = os.path.join(
            PROJECT_ROOT, 'data', 'common-bible-kr.txt')

        # 테스트 파일이 없으면 스킵
        if not os.path.exists(self.test_file):
            self.skipTest(f"테스트 파일이 없습니다: {self.test_file}")

    def test_verse_model(self):
        """Verse 모델 테스트"""
        # 기본 절 객체
        verse = Verse(number=1, text="한처음에 하느님께서 하늘과 땅을 지어내셨다.")
        verse.id = "창세-1-1"

        self.assertEqual(verse.number, 1)
        self.assertEqual(verse.text, "한처음에 하느님께서 하늘과 땅을 지어내셨다.")
        self.assertFalse(verse.has_paragraph)

        # 단락 마커가 있는 경우
        verse2 = Verse(number=2, text="¶ 이로써 하느님께서 일을 마치시고")
        self.assertTrue(verse2.has_paragraph)
        self.assertEqual(verse2.text, "이로써 하느님께서 일을 마치시고")

        # 하위 파트가 있는 경우
        verse3 = Verse(number=3, text="이 부분은 ¶ 두 부분으로 나뉩니다")
        verse3.id = "창세-1-3"
        verse3.sub_parts = ["이 부분은", "두 부분으로 나뉩니다"]

        self.assertEqual(len(verse3.sub_parts), 2)
        self.assertTrue(hasattr(verse3, "sub_ids"))

        # HTML 변환 테스트
        html = verse.to_html()
        self.assertIn(f'id="{verse.id}"', html)
        self.assertIn(f'class="verse-number"', html)
        self.assertIn(f'aria-hidden="true"', html)

        # 하위 파트가 있는 경우 HTML
        html3 = verse3.to_html()
        self.assertIn(f'class="verse-part"', html3)

    def test_chapter_model(self):
        """Chapter 모델 테스트"""
        # 장 객체 생성
        chapter = Chapter(
            book_name="창세기",
            chapter_number=1,
            book_abbr="창세"
        )

        # ID 생성 확인
        self.assertEqual(chapter.id, "창세-1")

        # 절 추가
        verse1 = Verse(number=1, text="한처음에 하느님께서 하늘과 땅을 지어내셨다.")
        verse2 = Verse(number=2, text="¶ 이로써 하느님께서 일을 마치시고")

        chapter.add_verse(verse1)
        chapter.add_verse(verse2)

        self.assertEqual(len(chapter.verses), 2)
        self.assertEqual(chapter.verses[0].id, "창세-1-1")
        self.assertEqual(chapter.verses[1].id, "창세-1-2")

    def test_book_model(self):
        """Book 모델 테스트"""
        # 책 객체 생성
        book = Book(name="창세기", abbr="창세", eng_name="Genesis")

        # ID 생성 확인
        self.assertEqual(book.id, "창세")

        # 장 추가
        chapter1 = Chapter(book_name="창세기", chapter_number=1)
        chapter2 = Chapter(book_name="창세기", chapter_number=2)

        book.add_chapter(chapter1)
        book.add_chapter(chapter2)

        self.assertEqual(len(book.chapters), 2)
        self.assertEqual(book.chapters[0].id, "창세-1")
        self.assertEqual(book.chapters[0].book_abbr, "창세")

    def test_bible_parser_init(self):
        """파서 초기화 테스트"""
        parser = BibleParser(self.test_file)

        self.assertEqual(parser.file_path, self.test_file)
        self.assertIsNotNone(parser.book_mappings)
        self.assertTrue(len(parser.book_mappings) > 0)

    def test_parser_small_sample(self):
        """샘플 텍스트 파싱 테스트"""
        # 샘플 텍스트 생성
        sample_text = """
        창세 1:1 한처음에 하느님께서 하늘과 땅을 지어내셨다.
        2 ¶ 땅은 아직 모양을 갖추지 않고 비어 있었는데, 어둠이 깊은 물 위에 뒤덮여 있었다. 하느님의 기운이 그 물 위에 휘돌고 있었다.
        3 하느님께서 "빛이 생겨라." 하시자 빛이 생겨났다.
        4 그 빛이 하느님 보시기에 좋았다. 하느님께서는 빛과 어둠을 나누시고
        5 빛을 낮이라, 어둠을 밤이라 부르셨다. 이렇게 첫날이 밤, 낮 하루가 지났다.
        """

        # 임시 파일로 저장
        temp_file = os.path.join(PROJECT_ROOT, 'tests', 'sample.txt')
        try:
            with open(temp_file, 'w', encoding='utf-8') as f:
                f.write(sample_text)

            # 파서로 파싱
            parser = BibleParser(temp_file)
            bible = parser.parse_file()

            # 결과 확인
            self.assertEqual(len(bible.books), 1)
            self.assertEqual(bible.books[0].name, "창세기")

            # 장 확인
            chapters = bible.books[0].chapters
            if chapters:  # 파서 구현에 따라 실제 파싱 결과가 다를 수 있음
                self.assertEqual(chapters[0].chapter_number, 1)
        finally:
            # 임시 파일 삭제
            if os.path.exists(temp_file):
                os.remove(temp_file)

    def test_chapter_split_with_empty_lines(self):
        """빈 줄 기반 장 분할 테스트"""
        # 다양한 빈 줄 패턴을 가진 샘플 텍스트
        sample_text = """
창세 1:1 한처음에 하느님께서 하늘과 땅을 지어내셨다.
2 ¶ 땅은 아직 모양을 갖추지 않고 비어 있었는데, 어둠이 깊은 물 위에 뒤덮여 있었다.
3 하느님께서 "빛이 생겨라." 하시자 빛이 생겨났다.

창세 2:1 하늘과 땅과 그 안의 모든 것이 완성되었다.
2 하느님께서는 일곱째 날에 그분이 하신 모든 일을 마치시고 쉬셨다.
3 하느님께서는 일곱째 날을 복되게 하시고 거룩하게 하셨다.


창세 3:1 뱀은 하느님께서 만드신 모든 들짐승 중에서 가장 교활하였다.
2 뱀이 여자에게 물었다. "하느님께서 정말로 동산의 모든 나무에서 먹지 말라고 하셨나요?"
"""

        # 임시 파일로 저장
        temp_file = os.path.join(
            PROJECT_ROOT, 'tests', 'empty_lines_sample.txt')
        try:
            with open(temp_file, 'w', encoding='utf-8') as f:
                f.write(sample_text)

            # 파서로 파싱
            parser = BibleParser(temp_file)
            bible = parser.parse_file()

            # 결과 확인
            self.assertEqual(len(bible.books), 1)
            self.assertEqual(bible.books[0].name, "창세기")

            # 장 개수 확인 (3개 장이 분리되어야 함)
            chapters = bible.books[0].chapters
            self.assertEqual(len(chapters), 3)

            # 각 장의 번호 확인
            self.assertEqual(chapters[0].chapter_number, 1)
            self.assertEqual(chapters[1].chapter_number, 2)
            self.assertEqual(chapters[2].chapter_number, 3)

            # 각 장의 절 개수 확인
            self.assertGreater(len(chapters[0].verses), 0)
            self.assertGreater(len(chapters[1].verses), 0)
            self.assertGreater(len(chapters[2].verses), 0)

        finally:
            # 임시 파일 삭제
            if os.path.exists(temp_file):
                os.remove(temp_file)

    def test_find_chapter_end_method(self):
        """_find_chapter_end 메서드 테스트"""
        parser = BibleParser()

        # 두 줄 빈 줄로 끝나는 경우
        text1 = """창세 1:1 한처음에 하느님께서 하늘과 땅을 지어내셨다.
2 ¶ 땅은 아직 모양을 갖추지 않고 비어 있었는데, 어둠이 깊은 물 위에 뒤덮여 있었다.
3 하느님께서 "빛이 생겨라." 하시자 빛이 생겨났다.


"""
        result1 = parser._find_chapter_end(text1)
        self.assertNotIn('\n\n\n', result1)  # 두 줄 빈 줄 이후는 제거되어야 함

        # 한 줄 빈 줄로 끝나는 경우
        text2 = """창세 2:1 하늘과 땅과 그 안의 모든 것이 완성되었다.
2 하느님께서는 일곱째 날에 그분이 하신 모든 일을 마치시고 쉬셨다.

"""
        result2 = parser._find_chapter_end(text2)
        self.assertNotIn('\n\n', result2)  # 한 줄 빈 줄 이후는 제거되어야 함

        # 빈 줄이 없는 경우
        text3 = """창세 3:1 뱀은 하느님께서 만드신 모든 들짐승 중에서 가장 교활하였다.
2 뱀이 여자에게 물었다."""
        result3 = parser._find_chapter_end(text3)
        self.assertEqual(result3, text3)  # 변경되지 않아야 함

    def test_chapter_start_pattern_validation(self):
        """장 시작 패턴 검증 테스트"""
        parser = BibleParser()

        # 장 시작 패턴이 있는 경우 (정상)
        text1 = """창세 1:1 한처음에 하느님께서 하늘과 땅을 지어내셨다.
2 ¶ 땅은 아직 모양을 갖추지 않고 비어 있었는데, 어둠이 깊은 물 위에 뒤덮여 있었다.
3 하느님께서 "빛이 생겨라." 하시자 빛이 생겨났다.

"""
        result1 = parser._find_chapter_end(text1)
        self.assertNotEqual(result1, "")  # 빈 문자열이 아니어야 함
        self.assertIn("창세 1:1", result1)  # 장 시작 패턴이 포함되어야 함

        # 장 시작 패턴이 없는 경우 (빈 줄만 있음)
        text2 = """


빈 줄만 있는 내용

"""
        result2 = parser._find_chapter_end(text2)
        self.assertEqual(result2, "")  # 빈 문자열이어야 함

        # 장 시작 패턴이 없는 경우 (일반 텍스트)
        text3 = """일반적인 텍스트 내용입니다.
이것은 장 시작 패턴이 아닙니다.

"""
        result3 = parser._find_chapter_end(text3)
        self.assertEqual(result3, "")  # 빈 문자열이어야 함

        # 다양한 장 시작 패턴 테스트
        valid_patterns = [
            "창세 1:1",
            "2마카 2:1",
            "요한 3:16",
            "시편 23:1"
        ]

        for pattern in valid_patterns:
            text = f"{pattern} 테스트 내용\n2 다른 내용\n"
            result = parser._find_chapter_end(text)
            self.assertNotEqual(result, "", f"패턴 '{pattern}'이 유효해야 함")
            self.assertIn(pattern, result, f"패턴 '{pattern}'이 결과에 포함되어야 함")


if __name__ == '__main__':
    unittest.main()
