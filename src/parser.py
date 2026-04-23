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
class Segment:
    """절 내부의 산문/운문 구분 단위"""
    type: str   # "prose" or "poetry"
    text: str   # prose: single text, poetry: \n for hemistich, \n\n for stanza break
    paragraph_break: bool = False  # visual gap before this segment (¶ or blank line)


@dataclass
class Verse:
    """절 데이터"""
    number: int
    segments: List[Segment]
    stanza_break: bool = False         # stanza break precedes this verse (ADR-006)
    chapter_ref: Optional[int] = None  # set when verse physically appears in a different chapter
    range_end: Optional[int] = None    # set for merged verse ranges (e.g. 17-18)
    part: Optional[str] = None         # set for split verses relocated by scholars (e.g. "a", "b")
    alt_ref: Optional[int] = None      # secondary verse number from a different manuscript tradition


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

    # --- Markdown (.md) parser ---

    _MD_CHAPTER = re.compile(r'^# (\d+)(장|편)\s*$')
    _MD_VERSE   = re.compile(r'^\[(?:(\d+):)?(\d+)(?:-(\d+))?(?:([a-z]))?(?:_(\d+))?\]\s*(.*)')
    _MD_BQ      = re.compile(r'^>\s?(.*)')

    def _resolve_book_by_id(self, book_id: str) -> Dict[str, str]:
        """book_id (e.g. 'gen') 로 책 메타 해석."""
        by_id = self.book_mappings['by_id']
        meta = by_id.get(book_id)
        if not meta:
            return {'id': book_id, 'name_ko': book_id, 'name_en': book_id,
                    'division_ko': '', 'division_en': '', 'book_order': -1}
        return {
            'id': book_id,
            'name_ko': meta['names'].get('ko', ''),
            'name_en': meta['names'].get('en', ''),
            'division_ko': meta['division'].get('ko', ''),
            'division_en': meta['division'].get('en', ''),
            'book_order': meta.get('book_order', -1),
        }

    def parse_md_file(self, file_path: str) -> List[Chapter]:
        """마크다운 소스 파일을 파싱하여 장 리스트 반환.

        Poetry is identified by blockquote syntax (>).
        All other text is treated as prose.
        """
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        book_id = os.path.splitext(os.path.basename(file_path))[0]
        resolved = self._resolve_book_by_id(book_id)

        chapters: List[Chapter] = []
        current_chapter: Optional[Chapter] = None
        current_verses: List[Verse] = []
        current_verse: Optional[Verse] = None
        poetry_lines: List[str] = []       # accumulated poetry lines in blockquote
        in_blockquote = False
        pending_blank = False
        pending_paragraph = False  # next segment added should have paragraph_break=True
        pending_stanza_in_bq = False

        def flush_poetry():
            """Flush accumulated poetry lines as a poetry segment on current_verse."""
            nonlocal poetry_lines
            if poetry_lines and current_verse is not None:
                current_verse.segments.append(
                    Segment(type="poetry", text='\n'.join(poetry_lines))
                )
            poetry_lines = []

        def finalize_verse():
            """Finalize current_verse: flush poetry, append to current_verses."""
            nonlocal current_verse
            if current_verse is not None:
                flush_poetry()
                current_verses.append(current_verse)
                current_verse = None

        def finalize_chapter():
            """Finalize current chapter: finalize verse, append to chapters."""
            nonlocal current_chapter, current_verses, in_blockquote
            finalize_verse()
            if current_chapter is not None:
                current_chapter.verses = current_verses
                chapters.append(current_chapter)
                current_chapter = None
                current_verses = []
            in_blockquote = False

        def make_verse_from_match(m: re.Match, text: str, is_poetry: bool = False) -> Verse:
            """Create a Verse from a verse marker regex match.

            Groups: (1) chapter_ref?, (2) number, (3) range_end?, (4) part?, (5) alt_ref?, (6) text
            """
            chapter_ref = int(m.group(1)) if m.group(1) else None
            number = int(m.group(2))
            range_end = int(m.group(3)) if m.group(3) else None
            part = m.group(4) if m.group(4) else None
            alt_ref = int(m.group(5)) if m.group(5) else None
            segments: List[Segment] = []
            if text:
                seg = Segment(type="poetry" if is_poetry else "prose", text=text)
                if '¶' in text:
                    seg.paragraph_break = True
                segments.append(seg)
            return Verse(
                number=number, segments=segments,
                chapter_ref=chapter_ref, range_end=range_end, part=part, alt_ref=alt_ref,
            )

        for line in content.split('\n'):
            # --- Chapter header ---
            ch_match = self._MD_CHAPTER.match(line)
            if ch_match:
                finalize_chapter()
                pending_blank = False
                current_chapter = Chapter(
                    book_id=resolved['id'],
                    book_name_ko=resolved['name_ko'] or book_id,
                    book_name_en=resolved['name_en'] or book_id,
                    book_abbr=book_id,
                    division_ko=resolved['division_ko'],
                    division_en=resolved['division_en'],
                    chapter_number=int(ch_match.group(1)),
                    verses=[]
                )
                current_verses = []
                continue

            if current_chapter is None:
                continue

            # --- Blockquote line ---
            bq_match = self._MD_BQ.match(line)
            if bq_match:
                bq_content = bq_match.group(1).strip()

                # Empty blockquote = stanza break within blockquote
                if not bq_content:
                    pending_stanza_in_bq = True
                    continue

                # Check for verse marker inside blockquote: > [N] text
                verse_in_bq = self._MD_VERSE.match(bq_content)
                if verse_in_bq:
                    # Finalize previous verse (flush its poetry)
                    finalize_verse()
                    text_after = verse_in_bq.group(6).strip() if verse_in_bq.group(6) else ''
                    current_verse = make_verse_from_match(verse_in_bq, '', is_poetry=True)
                    if pending_stanza_in_bq:
                        current_verse.stanza_break = True
                        pending_stanza_in_bq = False
                    # Start accumulating poetry lines
                    if text_after:
                        poetry_lines = [text_after]
                    in_blockquote = True
                    pending_blank = False
                    continue

                # Regular blockquote content (no verse marker)
                if not in_blockquote:
                    in_blockquote = True

                if pending_stanza_in_bq:
                    # Insert mid-verse stanza break
                    if poetry_lines:
                        poetry_lines.append('')  # empty string → \n\n when joined
                        poetry_lines.append(bq_content)
                    else:
                        poetry_lines.append(bq_content)
                    pending_stanza_in_bq = False
                else:
                    poetry_lines.append(bq_content)

                pending_blank = False
                continue

            # --- Blank line ---
            if not line.strip():
                if in_blockquote:
                    # End blockquote: flush poetry to current verse
                    flush_poetry()
                    in_blockquote = False
                pending_blank = True
                continue

            # --- Verse marker outside blockquote ---
            verse_match = self._MD_VERSE.match(line)
            if verse_match:
                finalize_verse()
                text_after = verse_match.group(6).strip() if verse_match.group(6) else ''
                current_verse = make_verse_from_match(verse_match, text_after, is_poetry=False)
                if pending_blank:
                    if current_verse.segments and current_verse.segments[0].type == "poetry":
                        current_verse.stanza_break = True
                    elif current_verse.segments:
                        current_verse.segments[0].paragraph_break = True
                    else:
                        pending_paragraph = True
                pending_blank = False
                continue

            # --- Prose continuation (plain text, no verse marker, not blockquote) ---
            if current_verse is not None:
                text = line.strip()
                seg = Segment(type="prose", text=text)
                if '¶' in text or pending_paragraph:
                    seg.paragraph_break = True
                pending_paragraph = False
                current_verse.segments.append(seg)
                pending_blank = False

        # Finalize remaining
        finalize_chapter()

        return chapters

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
            verses = []
            for verse_data in chapter_data['verses']:
                segments = [
                    Segment(type=s['type'], text=s['text'],
                            paragraph_break=s.get('paragraph_break', False))
                    for s in verse_data['segments']
                ]
                verses.append(Verse(
                    number=verse_data['number'],
                    segments=segments,
                    stanza_break=verse_data.get('stanza_break', False),
                    chapter_ref=verse_data.get('chapter_ref'),
                    range_end=verse_data.get('range_end'),
                    part=verse_data.get('part'),
                    alt_ref=verse_data.get('alt_ref'),
                ))

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



def main():
    """CLI: .md 소스 파일을 파싱하여 JSON으로 저장"""
    import sys
    import glob as glob_mod

    if len(sys.argv) < 2:
        print("사용법: python parser.py <source.md | source_dir/> [--save-json output_path]")
        print("예시:")
        print("  python parser.py data/source/gen.md")
        print("  python parser.py data/source/ --save-json output/parsed_bible.json")
        sys.exit(1)

    source = sys.argv[1]
    output_path = None
    for i, arg in enumerate(sys.argv[2:], 2):
        if arg == "--save-json" and i + 1 < len(sys.argv):
            output_path = sys.argv[i + 1]

    parser = BibleParser('data/book_mappings.json')

    # Collect .md files
    if os.path.isdir(source):
        md_files = sorted(glob_mod.glob(os.path.join(source, '*.md')))
    else:
        md_files = [source]

    all_chapters = []
    for md_path in md_files:
        chapters = parser.parse_md_file(md_path)
        total_v = sum(len(ch.verses) for ch in chapters)
        book = os.path.splitext(os.path.basename(md_path))[0]
        print(f"  {book}: {len(chapters)}장, {total_v}절")
        all_chapters.extend(chapters)

    print(f"\n총 {len(all_chapters)}개 장 파싱 완료")

    if output_path:
        parser.save_to_json(all_chapters, output_path)


if __name__ == "__main__":
    main()
