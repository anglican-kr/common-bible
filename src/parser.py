#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
텍스트 파싱 엔진

공동번역성서 텍스트 파일을 파싱하여 구조화된 데이터로 변환합니다.
- 성경 책 식별
- 장/절 분리
- 단락 구분 처리
- 텍스트 정규화
"""

import re
import json
import logging
import os
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any
import argparse

from src.models import Bible, Book, Chapter, Verse
from src.config import config


class BibleParser:
    """공동번역성서 텍스트 파서 클래스"""

    def __init__(self, file_path: Optional[str] = None):
        """
        파서 초기화

        Args:
            file_path: 텍스트 파일 경로 (기본값: config에서 설정된 경로)
        """
        self.logger = logging.getLogger(__name__)

        # 설정 로드
        self.book_mappings = config.load_book_mappings()

        # 파일 경로 설정
        if file_path is None:
            data_dir = config.paths['data_dir']
            file_path = os.path.join(data_dir, 'common-bible-kr.txt')
        self.file_path = file_path

        # 결과 저장용 객체
        self.bible = Bible(title="공동번역성서")
        self.current_book = None
        self.current_chapter = None

        self.logger.info(f"파서 초기화: {file_path}")

    def parse_file(self) -> Bible:
        """
        전체 파일을 파싱하여 Bible 객체 반환

        Returns:
            파싱된 Bible 객체
        """
        self.logger.info(f"파일 파싱 시작: {self.file_path}")

        # 텍스트 파일 불러오기
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            self.logger.error(f"파일 읽기 실패: {e}")
            return self.bible

        # 파일 내용 정규화
        content = self._normalize_text(content)

        # 장 단위로 분할
        chapters_text = self._split_chapters(content)

        # 각 장 파싱
        for chapter_text in chapters_text:
            self._parse_chapter(chapter_text)

        self.logger.info(f"파싱 완료: {len(self.bible.books)}권 파싱됨")
        return self.bible

    def _normalize_text(self, text: str) -> str:
        """
        텍스트 정규화 (공백, 개행 등 처리)

        Args:
            text: 원본 텍스트

        Returns:
            정규화된 텍스트
        """
        # 불필요한 공백 제거
        text = re.sub(r'\s+', ' ', text)

        # Windows 개행 문자 처리
        text = text.replace('\r\n', '\n')

        return text.strip()

    def _split_chapters(self, content: str) -> List[str]:
        """
        텍스트를 장 단위로 분할

        Args:
            content: 원본 텍스트

        Returns:
            장 텍스트 리스트
        """
        # 장 시작 패턴: "책명 장번호:절번호" 형태
        # 예: "창세 1:1", "2마카 2:1"
        chapter_pattern = r'([가-힣0-9]+)\s+([0-9]+):([0-9]+)'

        # 장 시작 위치 찾기
        chapter_matches = list(re.finditer(chapter_pattern, content))

        # 장 텍스트 추출 (빈 줄 기반 분할)
        chapters = []
        for i in range(len(chapter_matches)):
            start_pos = chapter_matches[i].start()

            # 다음 장 시작 위치 찾기
            if i < len(chapter_matches) - 1:
                next_start = chapter_matches[i+1].start()
                chapter_content = content[start_pos:next_start]
            else:
                chapter_content = content[start_pos:]

            # 빈 줄을 기준으로 장 끝 찾기 (유연한 처리)
            chapter_text = self._find_chapter_end(chapter_content)

            # 장 시작 패턴이 있는 경우만 추가
            if chapter_text.strip():
                chapters.append(chapter_text.strip())

        self.logger.info(f"장 분할: {len(chapters)}개 장 발견")
        return chapters

    def _find_chapter_end(self, chapter_content: str) -> str:
        """
        장 내용에서 실제 장 끝 위치를 찾기 (빈 줄 기반)

        Args:
            chapter_content: 장 내용

        Returns:
            장 끝까지의 텍스트
        """
        lines = chapter_content.split('\n')

        # 장 시작 패턴 확인 (첫 번째 비어있지 않은 줄이 장 시작 패턴인지 확인)
        chapter_start_pattern = r'^([가-힣0-9]+)\s+([0-9]+):([0-9]+)'

        # 첫 번째 비어있지 않은 줄 찾기
        first_content_line = None
        for line in lines:
            if line.strip():
                first_content_line = line.strip()
                break

        # 장 시작 패턴이 없으면 빈 문자열 반환 (장으로 인식하지 않음)
        if not first_content_line or not re.match(chapter_start_pattern, first_content_line):
            self.logger.warning(f"장 시작 패턴이 없음: {first_content_line}")
            return ""

        # 뒤에서부터 빈 줄 패턴 찾기
        # 요구사항: 두 줄의 빈 줄 또는 한 줄의 빈 줄도 장의 끝으로 인식
        empty_line_count = 0
        chapter_end_index = len(lines)

        for i in range(len(lines) - 1, -1, -1):
            line = lines[i].strip()

            if line == '':
                empty_line_count += 1
            else:
                # 빈 줄이 아닌 내용을 만났을 때
                if empty_line_count >= 1:  # 한 줄 이상의 빈 줄이 있었으면 장의 끝
                    chapter_end_index = i + empty_line_count + 1
                    break
                empty_line_count = 0

        # 장 끝까지의 텍스트 반환
        return '\n'.join(lines[:chapter_end_index])

    def _parse_chapter(self, chapter_text: str) -> None:
        """
        장 텍스트 파싱

        Args:
            chapter_text: 장 텍스트
        """
        # 장 제목 추출 (예: "창세 1:1")
        title_match = re.match(
            r'([가-힣0-9]+)\s+([0-9]+):([0-9]+)', chapter_text)
        if not title_match:
            self.logger.warning(f"장 제목 파싱 실패: {chapter_text[:50]}...")
            return

        book_abbr, chapter_num, first_verse_num = title_match.groups()

        # 책 식별 및 생성
        book_info = self._identify_book(book_abbr)
        if not book_info:
            self.logger.warning(f"알 수 없는 성경 책: {book_abbr}")
            return

        book_name = book_info['전체 이름']
        book_eng = book_info.get('영문 이름', '')

        # 현재 처리 중인 책이 바뀐 경우 새로운 Book 객체 생성
        if not self.current_book or self.current_book.name != book_name:
            book = Book(name=book_name, abbr=book_abbr, eng_name=book_eng)
            self.bible.add_book(book)
            self.current_book = book
            self.logger.info(f"새 책 처리 시작: {book_name}")

        # 장 객체 생성
        chapter = Chapter(
            book_name=book_name,
            chapter_number=int(chapter_num),
            book_abbr=book_abbr
        )

        # 절 파싱
        verses = self._parse_verses(chapter_text)
        for verse in verses:
            chapter.add_verse(verse)

        # 책에 장 추가
        self.current_book.add_chapter(chapter)
        self.current_chapter = chapter

        self.logger.debug(
            f"장 파싱 완료: {book_name} {chapter_num}장, {len(verses)}절")

    def _parse_verses(self, chapter_text: str) -> List[Verse]:
        """
        장 텍스트에서 절 파싱

        Args:
            chapter_text: 장 텍스트

        Returns:
            파싱된 절 리스트
        """
        verses = []

        # 책 약칭과 장 번호 추출
        title_match = re.match(
            r'([가-힣0-9]+)\s+([0-9]+):([0-9]+)', chapter_text)
        if not title_match:
            self.logger.warning(f"장 제목 파싱 실패: {chapter_text[:50]}...")
            return []

        book_abbr, chapter_num, _ = title_match.groups()

        # 절 패턴: "절번호 본문"
        verse_pattern = r'([0-9]+)\s+([^0-9]+?)(?=\s+[0-9]+\s+|$)'
        verse_matches = re.finditer(verse_pattern, chapter_text)

        for match in verse_matches:
            verse_num, verse_text = match.groups()
            verse_num = int(verse_num)
            verse_text = verse_text.strip()

            # _parse_verse 메서드를 사용하여 단락 시작 여부 처리
            verse = self._parse_verse(
                verse_text, book_abbr, chapter_num, verse_num)
            verses.append(verse)

        return verses

    def _split_verse_by_paragraph(self, verse_text: str) -> List[str]:
        """
        단독 ¶ 기호로 절 분할

        Args:
            verse_text: 절 텍스트

        Returns:
            분할된 하위 파트 리스트 (없으면 빈 리스트)
        """
        # 단독 ¶로 분할
        if " ¶ " in verse_text:
            return [part.strip() for part in verse_text.split(" ¶ ")]
        return []

    def _identify_book(self, abbr: str) -> Optional[Dict[str, str]]:
        """
        약칭으로 성경 책 찾기

        Args:
            abbr: 책 약칭

        Returns:
            책 정보 사전 또는 None
        """
        for book in self.book_mappings:
            if book['약칭'] == abbr:
                return book
        return None

    def save_to_json(self, output_path: Optional[str] = None) -> None:
        """
        파싱 결과를 JSON으로 저장

        Args:
            output_path: 출력 파일 경로 (기본값: data/output/bible.json)
        """
        if output_path is None:
            output_path = os.path.join(
                config.paths['output_dir'], 'bible.json')

        # 출력 디렉토리 확인 및 생성
        output_dir = os.path.dirname(output_path)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # JSON 저장
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(self.bible.to_dict(), f,
                          ensure_ascii=False, indent=2)
            self.logger.info(f"JSON 저장 완료: {output_path}")
        except Exception as e:
            self.logger.error(f"JSON 저장 실패: {e}")

    def save_chapters_json(self, output_dir: Optional[str] = None) -> None:
        """
        각 장을 개별 JSON 파일로 저장

        Args:
            output_dir: 출력 디렉토리 경로 (기본값: data/output/chapters)
        """
        if output_dir is None:
            output_dir = os.path.join(config.paths['output_dir'], 'chapters')

        # 출력 디렉토리 확인 및 생성
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

        # 각 책과 장에 대해 JSON 파일 생성
        for book in self.bible.books:
            book_dir = os.path.join(output_dir, book.abbr)
            if not os.path.exists(book_dir):
                os.makedirs(book_dir)

            for chapter in book.chapters:
                file_path = os.path.join(book_dir, f"{chapter.id}.json")

                try:
                    with open(file_path, 'w', encoding='utf-8') as f:
                        json.dump(chapter.to_dict(), f,
                                  ensure_ascii=False, indent=2)
                except Exception as e:
                    self.logger.error(f"장 JSON 저장 실패: {file_path} - {e}")

        self.logger.info(f"모든 장 JSON 저장 완료: {output_dir}")

    def _parse_verse(self, text, book_abbr, chapter_num, verse_num):
        """
        개별 절 파싱

        단락 시작 여부를 식별하여 verse.has_paragraph에 설정
        """
        # 단락 마커 존재 여부 확인
        has_paragraph = "¶" in text

        # 단락 마커는 내부 처리용이므로 출력 텍스트에서 제거
        if has_paragraph:
            text = text.replace("¶", "").strip()

        verse_id = f"{book_abbr}-{chapter_num}-{verse_num}"

        return Verse(
            number=int(verse_num),
            text=text,
            has_paragraph=has_paragraph,
            id=verse_id
        )


def main():
    """CLI 진입점"""
    parser = argparse.ArgumentParser(description='성경 텍스트 파싱 도구')
    parser.add_argument('--input', '-i', help='입력 파일 경로')
    parser.add_argument('--output', '-o', help='출력 JSON 파일 경로')
    parser.add_argument('--split-chapters', '-s',
                        action='store_true', help='장별로 분할하여 저장')
    args = parser.parse_args()

    # 파서 초기화 및 실행
    bible_parser = BibleParser(args.input)
    bible = bible_parser.parse_file()

    # 결과 저장
    if args.output:
        bible_parser.save_to_json(args.output)
    else:
        bible_parser.save_to_json()

    # 장별 저장
    if args.split_chapters:
        bible_parser.save_chapters_json()

    print(
        f"파싱 완료: {len(bible.books)}권, 총 {sum(len(book.chapters) for book in bible.books)}장")


if __name__ == "__main__":
    main()
