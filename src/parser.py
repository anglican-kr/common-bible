"""
공동번역성서 텍스트 파일 파서
텍스트 파일을 읽어 장(Chapter) 단위로 분리하고 구조화된 데이터로 변환
"""

import re
import json
import os
from typing import List, Dict, Optional, Any
from dataclasses import dataclass, asdict


@dataclass
class Verse:
    """절 데이터"""
    number: int
    text: str
    has_paragraph: bool = False
    chapter_ref: Optional[int] = None  # set when verse physically appears in a different chapter


@dataclass
class Chapter:
    """장 데이터"""
    book_id: str
    book_name_ko: str
    book_name_en: str
    book_abbr: str
    division_ko: str
    division_en: str
    chapter_number: int
    verses: List[Verse]


class BibleParser:
    """성경 텍스트 파서"""

    def __init__(self, book_mappings_path: str):
        self.book_mappings = self._load_book_mappings(book_mappings_path)
        self.chapter_pattern = re.compile(r'([가-힣0-9]+)\s+(\d+):(\d+)')

    def _load_book_mappings(self, book_mappings_path: str) -> Dict[str, Any]:
        """책 메타데이터 로드"""
        with open(book_mappings_path, 'r', encoding='utf-8') as f:
            items = json.load(f)

        def get_english_abbr(english_name: str) -> str:
            name = (english_name or '').lower()
            if ' ' in name:
                parts = name.split()
                if parts[0].isdigit():
                    return f"{parts[0]}-{parts[1][:3]}"
                else:
                    return parts[0][:4]
            return name[:4]

        by_id: Dict[str, Any] = {}
        ko_alias_to_id: Dict[str, str] = {}

        for raw in items:
            if 'id' in raw and 'names' in raw:
                bid = raw['id']
                names = raw.get('names', {})
                division = raw.get('division', {})
                aliases = raw.get('aliases', {})
                book_order = raw.get('book_order', -1)
                by_id[bid] = {
                    'names': {'ko': names.get('ko', ''), 'en': names.get('en', '')},
                    'division': {'ko': division.get('ko', ''), 'en': division.get('en', '')},
                    'aliases': {'ko': aliases.get('ko', []), 'en': aliases.get('en', [])},
                    'book_order': book_order,
                }
                for a in set([names.get('ko', '')] + aliases.get('ko', [])):
                    if a:
                        ko_alias_to_id[a] = bid
            else:
                abbr = raw.get('abbr') or raw.get('약칭')
                ko = raw.get('korean_name') or raw.get('전체 이름') or ''
                en = raw.get('english_name') or raw.get('영문 이름') or ''
                div = raw.get('division') or raw.get('구분') or ''
                _DIV_KO = {'old_testament': '구약', 'deuterocanon': '외경', 'new_testament': '신약'}
                aliases = raw.get('aliases_ko') or []
                bid = raw.get('id') or (get_english_abbr(en) if en else (abbr or ko))
                by_id[bid] = {
                    'names': {'ko': ko, 'en': en},
                    'division': {'ko': _DIV_KO.get(div, div), 'en': div},
                    'aliases': {'ko': list({abbr, ko, *aliases} - {None, ''}), 'en': [bid, en] if en else [bid]},
                    'book_order': -1,
                }
                for a in by_id[bid]['aliases']['ko'] + ([ko] if ko else []):
                    if a:
                        ko_alias_to_id[a] = bid

        return {'by_id': by_id, 'ko_alias_to_id': ko_alias_to_id}

    def _resolve_book(self, token_ko: str) -> Dict[str, str]:
        """한국어 약칭/이름으로 책 메타 해석."""
        by_id = self.book_mappings['by_id']
        ko_map = self.book_mappings['ko_alias_to_id']
        bid = ko_map.get(token_ko)
        if not bid:
            return {'id': token_ko, 'name_ko': token_ko, 'name_en': token_ko, 'division_ko': '', 'division_en': ''}
        meta = by_id[bid]
        return {
            'id': bid,
            'name_ko': meta['names'].get('ko', ''),
            'name_en': meta['names'].get('en', ''),
            'division_ko': meta['division'].get('ko', ''),
            'division_en': meta['division'].get('en', ''),
        }

    def _get_english_book_name(self, abbr: str) -> str:
        """약칭으로 영문 이름 반환"""
        if abbr in self.book_mappings:
            return self.book_mappings[abbr]['english_name']
        else:
            return abbr

    def parse_file(self, file_path: str) -> List[Chapter]:
        """텍스트 파일을 파싱하여 장 리스트 반환.

        Chapter boundary rule (physical-chapter approach, ADR-002):
        A new chapter starts only when verse number == 1 AND that
        (book_abbr, chapter_num) pair has not been seen before, OR when
        the book changes.  Mid-chapter verse references (e.g. '아모 6:9'
        inside amos-6) and cross-chapter scholarly relocations (e.g.
        '이사 41:6' inside isa-40) are kept in the physically enclosing
        chapter with a chapter_ref annotation.
        """
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        chapters = []
        current_chapter = None
        current_verses = []
        opened_chapter_keys: set = set()  # (book_abbr, chapter_num) pairs seen so far

        for line in content.split('\n'):
            match = self.chapter_pattern.match(line)
            if match:
                book_abbr = match.group(1)
                chapter_num = int(match.group(2))
                verse_num = int(match.group(3))
                key = (book_abbr, chapter_num)

                is_new_chapter = (
                    current_chapter is None
                    or book_abbr != current_chapter.book_abbr
                    or (key not in opened_chapter_keys and verse_num == 1)
                )

                if is_new_chapter:
                    if current_chapter:
                        current_chapter.verses = current_verses
                        chapters.append(current_chapter)

                    resolved = self._resolve_book(book_abbr)
                    current_chapter = Chapter(
                        book_id=resolved['id'],
                        book_name_ko=resolved['name_ko'] or book_abbr,
                        book_name_en=resolved['name_en'] or resolved['id'],
                        book_abbr=book_abbr,
                        division_ko=resolved['division_ko'],
                        division_en=resolved['division_en'],
                        chapter_number=chapter_num,
                        verses=[]
                    )
                    current_verses = []
                    opened_chapter_keys.add(key)

                    verse = self._extract_verse_from_chapter_line(line, match, None)
                    if verse:
                        current_verses.append(verse)
                else:
                    # Same-chapter continuation or cross-chapter scholarly relocation
                    verse = self._extract_verse_from_chapter_line(
                        line, match, current_chapter.chapter_number
                    )
                    if verse:
                        current_verses.append(verse)

            elif current_chapter and line.strip():
                verse = self._parse_verse_line(line)
                if verse:
                    current_verses.append(verse)
                elif current_verses and line.strip().startswith('¶'):
                    # Continuation of the previous verse (scholarly paragraph break mid-verse)
                    current_verses[-1].text += '\n' + line.strip()
                    current_verses[-1].has_paragraph = True

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

    def _extract_verse_from_chapter_line(
        self, line: str, match: re.Match, current_chapter_num: Optional[int]
    ) -> Optional[Verse]:
        """Extract a verse from a line that begins with the book+chapter:verse pattern.

        current_chapter_num: the chapter number of the enclosing chapter object.
            Pass None when this verse IS the chapter opener (no cross-chapter annotation needed).
        """
        chapter_num = int(match.group(2))
        verse_num = int(match.group(3))
        remaining_text = line[len(match.group(0)):].strip()

        if not remaining_text:
            return None

        has_paragraph = '¶' in remaining_text
        chapter_ref = (
            chapter_num
            if current_chapter_num is not None and chapter_num != current_chapter_num
            else None
        )

        return Verse(
            number=verse_num,
            text=remaining_text,
            has_paragraph=has_paragraph,
            chapter_ref=chapter_ref,
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
                    has_paragraph=verse_data['has_paragraph'],
                    chapter_ref=verse_data.get('chapter_ref'),
                )
                for verse_data in chapter_data['verses']
            ]

            if 'book_id' in chapter_data:
                chapter = Chapter(
                    book_id=chapter_data.get('book_id', ''),
                    book_name_ko=chapter_data.get('book_name_ko', ''),
                    book_name_en=chapter_data.get('book_name_en', ''),
                    book_abbr=chapter_data.get('book_abbr', ''),
                    division_ko=chapter_data.get('division_ko', ''),
                    division_en=chapter_data.get('division_en', ''),
                    chapter_number=chapter_data['chapter_number'],
                    verses=verses
                )
            else:
                chapter = Chapter(
                    book_id='',
                    book_name_ko=chapter_data.get('book_name', ''),
                    book_name_en=chapter_data.get('english_name', ''),
                    book_abbr=chapter_data.get('book_abbr', ''),
                    division_ko=chapter_data.get('division_ko', ''),
                    division_en=chapter_data.get('division_en', ''),
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
        print(
            f"\n[{i+1}] {chapter.book_name_ko} {chapter.chapter_number}장 (id={chapter.book_id})")
        print(
            f"    약칭: {chapter.book_abbr} / 구분: {chapter.division_ko or '-'}")
        print(f"    절 수: {len(chapter.verses)}")
        if chapter.verses:
            print(
                f"    첫 절: {chapter.verses[0].number}. {chapter.verses[0].text[:50]}...")

    print(f"\n✅ 파싱 완료! 다른 프로그램에서 재사용하려면:")
    if save_json or use_cache:
        print(f"   parser.load_from_json('{output_path}') 사용")


if __name__ == "__main__":
    main()
