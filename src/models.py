#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
데이터 모델 모듈

성경 데이터 객체를 정의합니다.
- Bible: 성경 전체를 표현하는 최상위 클래스
- Book: 성경의 한 권(예: 창세기)
- Chapter: 각 책의 장(예: 창세기 1장)
- Verse: 각 장의 절(예: 창세기 1장 1절)
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any


@dataclass
class Verse:
    """
    성경의 절(verse)을 나타내는 클래스
    
    Attributes:
        number: 절 번호
        text: 절 본문 내용
        has_paragraph: 단락 시작 여부(¶ 기호 포함)
        sub_parts: 단독 ¶로 분할된 경우의 하위 파트들
        id: 고유 식별자(예: "창세-1-1", "창세-1-4a")
    """
    number: int
    text: str
    has_paragraph: bool = False
    sub_parts: List[str] = field(default_factory=list)
    id: str = ""
    
    def __post_init__(self):
        """초기화 후 추가 처리"""
        # 텍스트에서 단락 표시(¶) 처리
        if "¶" in self.text:
            self.has_paragraph = True
            self.text = self.text.replace("¶", "").strip()
        
        # 하위 파트가 있지만 id가 설정되지 않은 경우
        if self.sub_parts and not self.id.endswith(('a', 'b', 'c', 'd')):
            self._assign_sub_part_ids()
    
    def _assign_sub_part_ids(self):
        """하위 파트에 ID 할당 (a, b, c, ...)"""
        base_id = self.id
        sub_ids = [f"{base_id}{chr(97 + i)}" for i in range(len(self.sub_parts))]
        
        # sub_parts 리스트는 그대로 두고, 별도로 sub_ids 속성 추가
        self.sub_ids = sub_ids
    
    def to_dict(self) -> Dict[str, Any]:
        """객체를 사전 형태로 변환"""
        result = {
            "number": self.number,
            "text": self.text,
            "has_paragraph": self.has_paragraph,
            "id": self.id
        }
        
        if self.sub_parts:
            result["sub_parts"] = self.sub_parts
            if hasattr(self, 'sub_ids'):
                result["sub_ids"] = self.sub_ids
        
        return result
    
    def to_html(self) -> str:
        """
        절을 HTML 형태로 변환
        
        Returns:
            HTML 형식의 절 표현
        """
        # 기본 템플릿
        if not self.sub_parts:
            return f'<span class="verse" id="{self.id}">' \
                   f'<span class="verse-number" aria-hidden="true">{self.number}</span>' \
                   f'{self.text}' \
                   f'{"<span class=\"paragraph-marker\" aria-hidden=\"true\">¶</span>" if self.has_paragraph else ""}' \
                   f'</span>'
        
        # 하위 파트가 있는 경우
        parts_html = []
        for i, part in enumerate(self.sub_parts):
            sub_id = getattr(self, 'sub_ids', [f"{self.id}{chr(97 + i)}"])[i]
            part_marker = f'<span class="paragraph-marker" aria-hidden="true">¶</span>' if i > 0 else ''
            parts_html.append(
                f'<span class="verse-part" id="{sub_id}">' \
                f'{part_marker}{part}' \
                f'</span>'
            )
        
        return f'<span class="verse" id="{self.id}">' \
               f'<span class="verse-number" aria-hidden="true">{self.number}</span>' \
               f'{"".join(parts_html)}' \
               f'</span>'


@dataclass
class Chapter:
    """
    성경의 장(chapter)을 나타내는 클래스
    
    Attributes:
        book_name: 책 이름(예: "창세기")
        chapter_number: 장 번호
        verses: 절 객체 리스트
        id: 고유 식별자(예: "창세-1")
    """
    book_name: str
    chapter_number: int
    verses: List[Verse] = field(default_factory=list)
    id: str = ""
    book_abbr: str = ""
    
    def __post_init__(self):
        """초기화 후 추가 처리"""
        # ID가 설정되지 않은 경우 생성
        if not self.id and self.book_abbr:
            self.id = f"{self.book_abbr}-{self.chapter_number}"
        
        # 절 객체에 ID 할당
        for verse in self.verses:
            if not verse.id:
                verse.id = f"{self.id}-{verse.number}"
    
    def add_verse(self, verse: Verse) -> None:
        """
        절 추가
        
        Args:
            verse: 추가할 절 객체
        """
        if not verse.id:
            verse.id = f"{self.id}-{verse.number}"
        self.verses.append(verse)
    
    def to_dict(self) -> Dict[str, Any]:
        """객체를 사전 형태로 변환"""
        return {
            "book_name": self.book_name,
            "book_abbr": self.book_abbr,
            "chapter_number": self.chapter_number,
            "id": self.id,
            "verses": [verse.to_dict() for verse in self.verses]
        }


@dataclass
class Book:
    """
    성경의 한 권(book)을 나타내는 클래스
    
    Attributes:
        name: 책 이름(예: "창세기")
        abbr: 책 약칭(예: "창세")
        eng_name: 영어 이름(예: "Genesis")
        chapters: 장 객체 리스트
        id: 고유 식별자
    """
    name: str
    abbr: str
    chapters: List[Chapter] = field(default_factory=list)
    eng_name: str = ""
    id: str = ""
    
    def __post_init__(self):
        """초기화 후 추가 처리"""
        # ID가 설정되지 않은 경우 생성
        if not self.id:
            self.id = self.abbr
        
        # 장 객체에 책 약칭 할당
        for chapter in self.chapters:
            if not chapter.book_abbr:
                chapter.book_abbr = self.abbr
            
            # 장 ID 재설정
            if not chapter.id:
                chapter.id = f"{self.abbr}-{chapter.chapter_number}"
            
            # 각 절의 ID 재설정
            for verse in chapter.verses:
                if not verse.id:
                    verse.id = f"{chapter.id}-{verse.number}"
    
    def add_chapter(self, chapter: Chapter) -> None:
        """
        장 추가
        
        Args:
            chapter: 추가할 장 객체
        """
        chapter.book_abbr = self.abbr
        if not chapter.id:
            chapter.id = f"{self.abbr}-{chapter.chapter_number}"
        self.chapters.append(chapter)
    
    def to_dict(self) -> Dict[str, Any]:
        """객체를 사전 형태로 변환"""
        return {
            "name": self.name,
            "abbr": self.abbr,
            "eng_name": self.eng_name,
            "id": self.id,
            "chapters": [chapter.to_dict() for chapter in self.chapters]
        }


@dataclass
class Bible:
    """
    성경 전체를 나타내는 클래스
    
    Attributes:
        title: 성경 제목(예: "공동번역성서")
        books: 책 객체 리스트
        language: 언어(예: "ko")
    """
    title: str
    books: List[Book] = field(default_factory=list)
    language: str = "ko"
    
    def add_book(self, book: Book) -> None:
        """
        책 추가
        
        Args:
            book: 추가할 책 객체
        """
        self.books.append(book)
    
    def get_book(self, book_name: str) -> Optional[Book]:
        """
        책 이름으로 책 객체 찾기
        
        Args:
            book_name: 책 이름 또는 약칭
        
        Returns:
            찾은 책 객체 또는 None
        """
        for book in self.books:
            if book.name == book_name or book.abbr == book_name:
                return book
        return None
    
    def to_dict(self) -> Dict[str, Any]:
        """객체를 사전 형태로 변환"""
        return {
            "title": self.title,
            "language": self.language,
            "books": [book.to_dict() for book in self.books]
        }
