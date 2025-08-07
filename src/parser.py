"""
공동번역성서 텍스트 파일 파서
텍스트 파일을 읽어 장(Chapter) 단위로 분리하고 구조화된 데이터로 변환
"""

import re
import json
import os
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict


@dataclass
class Verse:
    """절 데이터"""
    number: int
    text: str
    has_paragraph: bool = False


@dataclass
class Chapter:
    """장 데이터"""
    book_name: str
    book_abbr: str
    chapter_number: int
    verses: List[Verse]


class BibleParser:
    """성경 텍스트 파서"""

    def __init__(self, book_mappings_path: str):
        self.book_mappings = self._load_book_mappings(book_mappings_path)
        self.chapter_pattern = re.compile(r'([가-힣0-9]+)\s+(\d+):(\d+)')

    def _load_book_mappings(self, book_mappings_path: str) -> Dict[str, Dict]:
        """책 이름 매핑 데이터를 로드하고 딕셔너리로 변환"""
        with open(book_mappings_path, 'r', encoding='utf-8') as f:
            mappings_list = json.load(f)

        # 리스트를 딕셔너리로 변환하여 빠른 검색 가능
        mappings_dict = {}
        for book in mappings_list:
            mappings_dict[book['약칭']] = {
                'full_name': book['전체 이름'],
                'english_name': book['영문 이름'],
                '구분': book.get('구분', '구약')  # 기본값은 구약
            }

        return mappings_dict

    def _get_full_book_name(self, abbr: str) -> str:
        """약칭으로 전체 이름 반환"""
        if abbr in self.book_mappings:
            return self.book_mappings[abbr]['full_name']
        else:
            # 매핑이 없으면 약칭 그대로 반환 (에러 방지)
            return abbr

    def _get_english_book_name(self, abbr: str) -> str:
        """약칭으로 영문 이름 반환"""
        if abbr in self.book_mappings:
            return self.book_mappings[abbr]['english_name']
        else:
            return abbr

    def parse_file(self, file_path: str) -> List[Chapter]:
        """텍스트 파일을 파싱하여 장 리스트 반환"""
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        chapters = []
        current_chapter = None
        current_verses = []

        for line in content.split('\n'):
            # 장 시작 확인
            match = self.chapter_pattern.match(line)
            if match:
                # 이전 장 저장
                if current_chapter:
                    current_chapter.verses = current_verses
                    chapters.append(current_chapter)

                # 새 장 시작
                book_abbr = match.group(1)
                chapter_num = int(match.group(2))
                book_name = self._get_full_book_name(book_abbr)

                current_chapter = Chapter(
                    book_name=book_name,
                    book_abbr=book_abbr,
                    chapter_number=chapter_num,
                    verses=[]
                )
                current_verses = []

                # 장 시작 라인에서 첫 번째 절 내용 추출
                first_verse = self._extract_first_verse_from_chapter_line(line)
                if first_verse:
                    current_verses.append(first_verse)

            # 절 파싱
            elif current_chapter and line.strip():
                verse = self._parse_verse_line(line)
                if verse:
                    current_verses.append(verse)

        # 마지막 장 저장
        if current_chapter:
            current_chapter.verses = current_verses
            chapters.append(current_chapter)

        return chapters

    def _parse_verse_line(self, line: str) -> Optional[Verse]:
        """절 라인 파싱"""
        # 절 번호와 텍스트 분리
        parts = line.strip().split(' ', 1)
        if len(parts) < 2 or not parts[0].isdigit():
            return None

        verse_num = int(parts[0])
        text = parts[1]

        # 단락 구분 기호 확인 (원본 텍스트 보존)
        has_paragraph = '¶' in text
        # ¶ 기호는 제거하지 않고 보존 (HTML 변환 시 접근성 처리)

        return Verse(
            number=verse_num,
            text=text,
            has_paragraph=has_paragraph
        )

    def _extract_first_verse_from_chapter_line(self, line: str) -> Optional[Verse]:
        """장 시작 라인에서 첫 번째 절 내용을 추출"""
        # 패턴: "창세 1:1 ¶ 한처음에 하느님께서..."
        # 장:절 번호 이후의 내용을 첫 번째 절로 추출

        # 장:절 패턴 이후의 텍스트 찾기
        match = self.chapter_pattern.match(line)
        if not match:
            return None

        # 매치된 부분 이후의 텍스트 추출
        full_match = match.group(0)  # 전체 매치 (예: "창세 1:1")
        remaining_text = line[len(full_match):].strip()

        if not remaining_text:
            return None

        # 단락 구분 기호 확인 (원본 텍스트 보존)
        has_paragraph = '¶' in remaining_text
        # ¶ 기호는 제거하지 않고 보존 (HTML 변환 시 접근성 처리)

        # 첫 번째 절은 항상 절 번호 1
        return Verse(
            number=1,
            text=remaining_text,
            has_paragraph=has_paragraph
        )

    def save_to_json(self, chapters: List[Chapter], output_path: str) -> None:
        """파싱된 데이터를 JSON 파일로 저장"""
        # 디렉토리가 없으면 생성
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # dataclass를 딕셔너리로 변환
        data = [asdict(chapter) for chapter in chapters]

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"파싱 결과를 {output_path}에 저장했습니다.")

    def load_from_json(self, json_path: str) -> List[Chapter]:
        """JSON 파일에서 파싱 데이터 로드"""
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        chapters = []
        for chapter_data in data:
            verses = [
                Verse(
                    number=verse_data['number'],
                    text=verse_data['text'],
                    has_paragraph=verse_data['has_paragraph']
                )
                for verse_data in chapter_data['verses']
            ]

            chapter = Chapter(
                book_name=chapter_data['book_name'],
                book_abbr=chapter_data['book_abbr'],
                chapter_number=chapter_data['chapter_number'],
                verses=verses
            )
            chapters.append(chapter)

        print(f"{json_path}에서 {len(chapters)}개 장을 로드했습니다.")
        return chapters

    def parse_file_with_cache(self, file_path: str, cache_path: str = "output/parsed_bible.json") -> List[Chapter]:
        """캐시 파일이 있으면 로드, 없으면 파싱 후 캐시 저장"""
        # 캐시 파일이 존재하고 원본보다 최신이면 캐시 사용
        if os.path.exists(cache_path) and os.path.exists(file_path):
            cache_mtime = os.path.getmtime(cache_path)
            source_mtime = os.path.getmtime(file_path)

            if cache_mtime > source_mtime:
                print(f"캐시 파일 {cache_path}를 사용합니다.")
                return self.load_from_json(cache_path)

        # 캐시가 없거나 구버전이면 새로 파싱
        print(f"텍스트 파일 {file_path}를 파싱합니다...")
        chapters = self.parse_file(file_path)

        # 파싱 결과를 캐시에 저장
        self.save_to_json(chapters, cache_path)

        return chapters


def main():
    """테스트를 위한 메인 함수"""
    import sys

    if len(sys.argv) < 2:
        print(
            "사용법: python parser.py <bible_text_file> [--save-json output_path] [--use-cache]")
        print("예시:")
        print("  python parser.py data/common-bible-kr.txt")
        print("  python parser.py data/common-bible-kr.txt --save-json output/bible.json")
        print("  python parser.py data/common-bible-kr.txt --use-cache")
        sys.exit(1)

    text_file = sys.argv[1]
    save_json = False
    use_cache = False
    output_path = "output/parsed_bible.json"

    # 명령행 인수 처리
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--save-json" and i + 1 < len(sys.argv):
            save_json = True
            output_path = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--use-cache":
            use_cache = True
            i += 1
        else:
            i += 1

    # 파서 초기화
    parser = BibleParser('data/book_mappings.json')

    # 파일 파싱 (캐시 사용 여부에 따라)
    if use_cache:
        chapters = parser.parse_file_with_cache(text_file, output_path)
    else:
        chapters = parser.parse_file(text_file)
        if save_json:
            parser.save_to_json(chapters, output_path)

    # 결과 출력
    print(f"\n총 {len(chapters)}개의 장을 파싱했습니다.")

    # 처음 몇 개 장의 정보 출력
    for i, chapter in enumerate(chapters[:3]):
        print(f"\n[{i+1}] {chapter.book_name} {chapter.chapter_number}장")
        print(f"    약칭: {chapter.book_abbr}")
        print(f"    절 수: {len(chapter.verses)}")
        if chapter.verses:
            print(
                f"    첫 절: {chapter.verses[0].number}. {chapter.verses[0].text[:50]}...")

    print(f"\n✅ 파싱 완료! 다른 프로그램에서 재사용하려면:")
    if save_json or use_cache:
        print(f"   parser.load_from_json('{output_path}') 사용")


if __name__ == "__main__":
    main()
