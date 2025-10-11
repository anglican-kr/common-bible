"""
HTML 생성기 모듈
파싱된 성경 데이터를 접근성을 고려한 HTML로 변환
"""

import os
import re
import shutil
import hashlib
from urllib.parse import urlparse
import argparse
from string import Template
from typing import Optional
import json
from src.parser import Chapter, Verse


class HtmlGenerator:
    """HTML 생성기 - 접근성을 고려한 HTML 생성"""

    def __init__(self, template_path: str):
        """
        HTML 생성기 초기화

        Args:
            template_path: HTML 템플릿 파일 경로
        """
        with open(template_path, 'r', encoding='utf-8') as f:
            self.template = Template(f.read())

    @staticmethod
    def get_book_order_index(book_abbr: str) -> int:
        """공동번역 약칭/외경 포함 순서를 `data/book_mappings.json`의 나열 순서로 정의한다."""
        try:
            with open('data/book_mappings.json', 'r', encoding='utf-8') as f:
                books = json.load(f)
            for idx, b in enumerate(books):
                if b.get('약칭') == book_abbr:
                    return idx
        except Exception:
            pass
        return 10_000

    @staticmethod
    def read_version() -> str:
        """VERSION 파일에서 버전 정보를 읽어옴"""
        try:
            with open('VERSION', 'r', encoding='utf-8') as f:
                return f.read().strip()
        except Exception:
            return "0.0.0"

    def generate_chapter_html(
        self,
        chapter: Chapter,
        audio_base_url: str = "data/audio",
        static_base: str = "../static",
        audio_check_base: str | None = None,
        css_href: Optional[str] = None,
        js_src: Optional[str] = None,
        books_meta: Optional[list[dict]] = None,
        prev_button_html: str = "",
        next_button_html: str = "",
    ) -> str:
        """
        장을 HTML로 변환

        Args:
            chapter: 변환할 장 데이터
            audio_base_url: 오디오 파일 기본 URL

        Returns:
            생성된 HTML 문자열
        """
        # 절 HTML 생성 (오디오 슬러그 계산 전, 본문부터 생성)
        verses_html = self._generate_verses_html(chapter)

        # 별칭/슬러그 매핑 주입 데이터 구성 (공동번역 약칭/외경 포함)
        alias_to_abbr = {}
        abbr_to_slug = {}
        try:
            # parser의 매핑 사용 (약칭 키)
            from src.parser import BibleParser  # type: ignore
            # 안전: 생성기에서는 외부 주입이 없으므로 로컬 파일에서 읽음
            with open('data/book_mappings.json', 'r', encoding='utf-8') as f:
                import json
                books = json.load(f)
            for b in books:
                abbr = b.get('약칭')
                full = b.get('전체 이름')
                eng = b.get('영문 이름')
                aliases = b.get('aliases', [])
                if not abbr:
                    continue
                # 약칭→슬러그: 영문 이름 기반으로 ASCII 슬러그 생성 (없으면 보조 규칙)
                if isinstance(eng, str) and eng:
                    slug = re.sub(r'[^a-z0-9]+', '', eng.lower())
                else:
                    slug = re.sub(r'[^a-z0-9]+', '', str(abbr).lower())
                if not slug:
                    slug = self._get_book_slug(abbr)
                abbr_to_slug[abbr] = slug
                # 모든 별칭→약칭
                for name in set([abbr, full, *aliases]):
                    if name:
                        alias_to_abbr[name] = abbr
        except Exception:
            # 실패 시 빈 매핑 주입
            alias_to_abbr = {}
            abbr_to_slug = {}

        import json as _json
        import re as _re
        alias_payload = {
            'aliasToAbbr': alias_to_abbr,
            'abbrToSlug': abbr_to_slug,
        }
        # 별칭/슬러그 + 브레드크럼 메타 주입
        script_parts = [
            'window.BIBLE_ALIAS = ' +
            _json.dumps(alias_payload, ensure_ascii=False) + ';'
        ]
        if books_meta:
            script_parts.append('window.BIBLE_BOOKS = ' +
                                _json.dumps(books_meta, ensure_ascii=False) + ';')
        alias_data_script = '<script>' + ''.join(script_parts) + '</script>'

        # 오디오 파일 슬러그 계산: 매핑 우선, 없으면 영문 이름 기반
        # abbr_to_english 맵 구성
        abbr_to_english = {}
        try:
            with open('data/book_mappings.json', 'r', encoding='utf-8') as _f:
                _books = _json.load(_f)
            for _b in _books:
                _abbr = _b.get('약칭')
                _eng = _b.get('영문 이름') or ''
                if _abbr and _eng:
                    _slug = _re.sub(r'[^a-z0-9]+', '', _eng.lower())
                    abbr_to_english[_abbr] = _slug
        except Exception:
            pass

        audio_slug = abbr_to_slug.get(chapter.book_abbr) or abbr_to_english.get(
            chapter.book_abbr) or self._get_book_slug(chapter.book_abbr)
        # 최종 보정: 비ASCII면 영어명으로 강제 대체
        if not audio_slug.isascii():
            audio_slug = abbr_to_english.get(chapter.book_abbr, audio_slug)
        audio_filename = f"{audio_slug}-{chapter.chapter_number}.mp3"
        audio_path = f"{audio_base_url}/{audio_filename}"

        # 파일 존재 여부는 파일시스템 기준 경로로 확인(원격 URL이면 존재한다고 가정)
        check_base = audio_check_base if audio_check_base is not None else audio_base_url
        parsed = urlparse(check_base)
        if parsed.scheme in ("http", "https"):
            audio_exists = True
        else:
            fs_path = os.path.join(check_base, audio_filename)
            audio_exists = self._check_audio_exists(fs_path)

        # 템플릿 렌더링
        # CSS/JS 태그 구성 (차일드 테마에서 로드하는 경우 None로 두어 템플릿에서 비움)
        css_link_tag = (
            f'<link rel="stylesheet" href="{css_href}">' if css_href else ""
        )
        js_script_tag = (
            f'<script src="{js_src}"></script>' if js_src else ""
        )

        html = self.template.substitute(
            book_name=chapter.book_name,
            chapter_number=chapter.chapter_number,
            chapter_id=f"{chapter.book_abbr}-{chapter.chapter_number}",
            verses_content=verses_html,
            audio_path=audio_path if audio_exists else "#",
            audio_title=f"{chapter.book_name} {chapter.chapter_number}장 오디오",
            static_base=static_base,
            alias_data_script=alias_data_script,
            css_link_tag=css_link_tag,
            js_script_tag=js_script_tag,
            prev_button_html=prev_button_html,
            next_button_html=next_button_html,
            version=self.read_version(),
        )

        # 오디오 파일 존재 여부에 따라 CSS 클래스 조정
        if audio_exists:
            html = html.replace('class="audio-unavailable-notice"',
                                'class="audio-unavailable-notice hidden"')
        else:
            html = html.replace('class="audio-player-container"',
                                'class="audio-player-container hidden"')

        return html

    def generate_index_html(
        self,
        chapters: list[Chapter],
        static_base: str,
        title: str = "공동번역 성서 - 목차",
        books_meta: Optional[list[dict]] = None,
    ) -> str:
        """생성된 장 목록을 기반으로 간단한 목차(index.html) 생성

        - 동일 책의 가장 이른 장으로 링크한다
        - 책 정렬 순서는 `data/book_mappings.json`의 나열 순서를 따른다
        """
        # 책별로 가장 작은 장 번호만 취득
        by_book: dict[str, tuple[str, int]] = {}
        for ch in chapters:
            key = ch.book_abbr
            if key not in by_book or ch.chapter_number < by_book[key][1]:
                by_book[key] = (ch.book_name, ch.chapter_number)

        # 정렬 함수: 공동번역 책 순서
        def order_key(item: tuple[str, tuple[str, int]]) -> int:
            book_abbr, _ = item
            return HtmlGenerator.get_book_order_index(book_abbr)

        # 신약 약칭 집합 (fallback 분류용)
        new_testament_abbrs = {
            "마태", "마가", "누가", "요한", "사도", "로마", "고전", "고후", "갈라", "에베",
            "빌립", "골로", "살전", "살후", "딤전", "딤후", "디도", "빌레", "히브", "야고",
            "베전", "베후", "요일", "요이", "요삼", "유다", "계시"
        }

        # 책 약칭 → 구분 매핑 구성 (구약/신약/외경)
        abbr_to_div: dict[str, str] = {}
        if books_meta:
            for b in books_meta:
                abbr = b.get("약칭")
                div = b.get("구분")
                if abbr and isinstance(div, str):
                    abbr_to_div[abbr] = div

        # 그룹핑: 구약(외경 포함), 신약
        ot_items: list[tuple[str, tuple[str, int]]] = []
        nt_items: list[tuple[str, tuple[str, int]]] = []
        for item in by_book.items():
            abbr = item[0]
            div = abbr_to_div.get(abbr)
            if div:
                norm = str(div)
                # 외경은 구약으로 포함
                if "신약" in norm:
                    nt_items.append(item)
                else:
                    ot_items.append(item)
            else:
                # 메타가 없으면 약칭 기반 fallback
                if abbr in new_testament_abbrs:
                    nt_items.append(item)
                else:
                    ot_items.append(item)

        ot_items.sort(key=order_key)
        nt_items.sort(key=order_key)

        # 링크 파일명 계산: 이미 main에서 사용하는 규칙과 동일하게 slug는 외부에서 계산하도록 함
        # 여기서는 파일명만 비워두고, 호출하는 쪽에서 치환한다.
        css_link_tag = f'<link rel="stylesheet" href="{static_base}/verse-style.css">' if static_base else ""

        # 본문: 구약/신약 두 섹션으로 나눠 렌더링
        html_parts: list[str] = [
            "<!doctype html>",
            '<html lang="ko">',
            "<head>",
            '<meta charset="utf-8"/>',
            f"<title>{title}</title>",
            css_link_tag,
            "</head>",
            "<body>",
            f"<h1>{title}</h1>",
        ]

        # 구약 섹션
        html_parts.append('<section class="testament-section ot-section">')
        html_parts.append('<h2 class="section-title">구약</h2>')
        html_parts.append('<ul class="book-index ot">')
        for book_abbr, (book_name, first_chapter) in ot_items:
            base_slug = self._get_book_slug(book_abbr)
            filename = f"{base_slug}-{first_chapter}.html"
            html_parts.append(f'<li><a href="{filename}">{book_name}</a></li>')
        html_parts.append('</ul>')
        html_parts.append('</section>')

        # 신약 섹션
        html_parts.append('<section class="testament-section nt-section">')
        html_parts.append('<h2 class="section-title">신약</h2>')
        html_parts.append('<ul class="book-index nt">')
        for book_abbr, (book_name, first_chapter) in nt_items:
            base_slug = self._get_book_slug(book_abbr)
            filename = f"{base_slug}-{first_chapter}.html"
            html_parts.append(f'<li><a href="{filename}">{book_name}</a></li>')
        html_parts.append('</ul>')
        html_parts.append('</section>')

        html_parts.extend(["</body>", "</html>"])
        return "\n".join(html_parts)

    def _generate_verses_html(self, chapter: Chapter) -> str:
        """
        절들을 HTML로 변환 (단락 구분 고려)

        Args:
            chapter: 장 데이터

        Returns:
            절들의 HTML 문자열
        """
        paragraphs = []
        current_paragraph = []

        for verse in chapter.verses:
            verse_html = self._generate_verse_span(chapter, verse)

            if verse.has_paragraph and current_paragraph:
                # 새 단락 시작 - CSS 클래스로 공백 유지
                paragraphs.append(
                    f'<p class="scripture-paragraph">{" ".join(current_paragraph)}</p>')
                current_paragraph = [verse_html]
            else:
                current_paragraph.append(verse_html)

        # 마지막 단락 추가 - CSS 클래스로 공백 유지
        if current_paragraph:
            paragraphs.append(
                f'<p class="scripture-paragraph">{" ".join(current_paragraph)}</p>')

        return '\n    '.join(paragraphs)

    def _generate_verse_span(self, chapter: Chapter, verse: Verse) -> str:
        """
        절을 span 요소로 변환 (접근성 고려)

        Args:
            chapter: 장 데이터
            verse: 절 데이터

        Returns:
            절의 HTML span 요소
        """
        verse_id = f"{chapter.book_abbr}-{chapter.chapter_number}-{verse.number}"

        # 접근성을 고려한 텍스트 처리
        # 1. 원본 텍스트에서 ¶ 기호를 분리
        # 2. ¶ 기호는 시각적으로만 표시 (스크린리더에서 숨김)
        # 3. 절 번호도 스크린리더에서 숨김

        verse_text = verse.text
        # 1절이 문단 기호로 시작하면 절 번호(1)를 생략
        trimmed = verse_text.lstrip()
        starts_with_paragraph_marker = trimmed.startswith(
            '¶') or trimmed.startswith('\u00B6')
        omit_verse_number = (
            verse.number == 1 and starts_with_paragraph_marker)

        if '¶' in verse_text:
            # ¶ 기호를 접근성 고려 마크업으로 교체
            verse_text = verse_text.replace(
                '¶',
                '<span class="paragraph-marker" aria-hidden="true">¶</span>'
            ).strip()

        if omit_verse_number:
            # 숫자 1을 시각적으로 생략
            return (
                f'<span id="{verse_id}">'  # 번호 없음
                f'{verse_text}'
                f'</span>'
            )
        else:
            return (
                f'<span id="{verse_id}">'
                f'<span aria-hidden="true" class="verse-number">{verse.number}</span> '
                f'{verse_text}'
                f'</span>'
            )

    def _get_audio_filename(self, chapter: Chapter) -> str:
        """
        오디오 파일명 생성

        Args:
            chapter: 장 데이터

        Returns:
            오디오 파일명
        """
        slug = self._get_book_slug(chapter.book_abbr)
        return f"{slug}-{chapter.chapter_number}.mp3"

    def _get_book_slug(self, book_abbr: str) -> str:
        """책 약칭을 영문 슬러그로 변환 (파일명/오디오 공통 사용)"""
        mapping = {
            "창세": "genesis",
            "출애": "exodus",
            "레위": "leviticus",
            "민수": "numbers",
            "신명": "deuteronomy",
            "여호": "joshua",
            "판관": "judges",
            "룻기": "ruth",
            "사무상": "1samuel",
            "사무하": "2samuel",
            "열왕상": "1kings",
            "열왕하": "2kings",
            "역상": "1chronicles",
            "역하": "2chronicles",
            "에스": "ezra",
            "느헤": "nehemiah",
            "에스더": "esther",
            "욥기": "job",
            "시편": "psalms",
            "잠언": "proverbs",
            "전도": "ecclesiastes",
            "아가": "song",
            "이사": "isaiah",
            "예레": "jeremiah",
            "애가": "lamentations",
            "에제": "ezekiel",
            "다니": "daniel",
            "호세": "hosea",
            "요엘": "joel",
            "아모": "amos",
            "오바": "obadiah",
            "요나": "jonah",
            "미가": "micah",
            "나훔": "nahum",
            "하바": "habakkuk",
            "스바": "zephaniah",
            "학개": "haggai",
            "스가": "zechariah",
            "말라": "malachi",
            "마태": "matthew",
            "마가": "mark",
            "누가": "luke",
            "요한": "john",
            "사도": "acts",
            "로마": "romans",
            "고전": "1corinthians",
            "고후": "2corinthians",
            "갈라": "galatians",
            "에베": "ephesians",
            "빌립": "philippians",
            "골로": "colossians",
            "살전": "1thessalonians",
            "살후": "2thessalonians",
            "딤전": "1timothy",
            "딤후": "2timothy",
            "디도": "titus",
            "빌레": "philemon",
            "히브": "hebrews",
            "야고": "james",
            "베전": "1peter",
            "베후": "2peter",
            "요일": "1john",
            "요이": "2john",
            "요삼": "3john",
            "유다": "jude",
            "계시": "revelation",
        }
        return mapping.get(book_abbr, book_abbr.lower())

    def _check_audio_exists(self, audio_path: str) -> bool:
        """
        오디오 파일 존재 여부 확인

        Args:
            audio_path: 오디오 파일 경로

        Returns:
            파일 존재 여부
        """
        return os.path.exists(audio_path)


def _sha256_of_file(file_path: str) -> str:
    """파일의 SHA-256 해시를 계산하여 반환"""
    hash_obj = hashlib.sha256()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            hash_obj.update(chunk)
    return hash_obj.hexdigest()


def _copy_dir_dedup(src_dir: str, dst_dir: str) -> None:
    """디렉터리를 복사하되, 동일한 파일은 건너뛰고 다른 내용이면 덮어쓴다.

    - 디렉터리 구조는 유지한다
    - 대상에 기존 파일이 있어도 제거하지 않으며, 소스에 없는 대상 파일은 남겨둔다
    """
    os.makedirs(dst_dir, exist_ok=True)
    for root, dirs, files in os.walk(src_dir):
        rel = os.path.relpath(root, src_dir)
        target_root = dst_dir if rel == '.' else os.path.join(dst_dir, rel)
        os.makedirs(target_root, exist_ok=True)

        for d in dirs:
            os.makedirs(os.path.join(target_root, d), exist_ok=True)

        for fname in files:
            src_file = os.path.join(root, fname)
            dst_file = os.path.join(target_root, fname)
            if os.path.exists(dst_file):
                try:
                    if _sha256_of_file(src_file) == _sha256_of_file(dst_file):
                        # 동일 파일 → 복사 생략
                        continue
                except Exception:
                    # 해시 실패 시 안전하게 덮어쓰기
                    pass
            # 신규 또는 다른 내용 → 덮어쓰기
            shutil.copy2(src_file, dst_file)


def main():
    """CLI: 파서 출력(JSON)에서 HTML 파일 생성"""
    from src.parser import BibleParser

    parser = argparse.ArgumentParser(
        description="파서 출력(JSON)으로부터 성경 장 HTML 생성"
    )

    parser.add_argument(
        "template",
        help="HTML 템플릿 파일 경로 예) templates/chapter.html",
    )
    parser.add_argument(
        "output_dir",
        nargs="?",
        default="output/html/",
        help="생성 HTML 출력 디렉토리 (기본: output/html/)",
    )
    parser.add_argument(
        "--json",
        dest="json_path",
        default="output/parsed_bible.json",
        help="파서 결과 JSON 경로 (기본: output/parsed_bible.json)",
    )
    parser.add_argument(
        "--book",
        dest="book_abbr",
        help="특정 책 약칭만 생성 (예: 창세, 마태)",
    )
    parser.add_argument(
        "--chapters",
        dest="chapters",
        help="생성할 장 번호 목록/구간 (예: 1,2,5-7)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="생성할 최대 장 수 제한 (디버그용)",
    )
    parser.add_argument(
        "--audio-base",
        dest="audio_base",
        default="data/audio",
        help="오디오 파일 기본 경로/URL (기본: data/audio, 출력 디렉터리 기준 상대 경로로 자동 보정)",
    )
    parser.add_argument(
        "--static-base",
        dest="static_base",
        default="__AUTO__",
        help="정적 리소스(CSS/JS) 기본 경로/URL (기본: 출력 디렉터리 기준 'static'으로 자동 보정)",
    )
    parser.add_argument(
        "--css-href",
        dest="css_href",
        default=None,
        help="본문에 삽입할 CSS 링크 URL (차일드 테마에서 자동 로드하면 지정하지 않음)",
    )
    parser.add_argument(
        "--js-src",
        dest="js_src",
        default=None,
        help="본문에 삽입할 JS 스크립트 URL (차일드 테마에서 자동 로드하면 지정하지 않음)",
    )
    parser.add_argument(
        "--copy-static",
        action="store_true",
        help="생성된 출력 디렉터리에 static/ 디렉터리를 복사",
    )
    parser.add_argument(
        "--copy-audio",
        action="store_true",
        help="생성된 출력 디렉터리에 data/audio/ 디렉터리를 복사",
    )
    # 기본: 전역 검색 인덱스 생성 활성화
    parser.add_argument(
        "--emit-search-index",
        action="store_true",
        default=True,
        help="전역 검색용 단일 인덱스(JSON) 생성 (기본: 활성화)",
    )
    # 명시적 비활성화 옵션
    parser.add_argument(
        "--no-emit-search-index",
        action="store_true",
        help="전역 검색 인덱스 생성을 비활성화",
    )
    parser.add_argument(
        "--search-index-out",
        dest="search_index_out",
        default=None,
        help="검색 인덱스 출력 경로 (기본: <output_dir>/static/search/search-index.json)",
    )
    parser.add_argument(
        "--no-index",
        action="store_true",
        help="index.html 생성을 비활성화 (기본: 생성)",
    )

    args = parser.parse_args()

    template_path: str = args.template
    output_dir: str = args.output_dir
    json_path: str = args.json_path
    book_filter: str | None = args.book_abbr
    chapters_filter: str | None = args.chapters
    limit: int | None = args.limit
    audio_base: str = args.audio_base
    static_base_arg: str = args.static_base
    copy_static: bool = args.copy_static
    copy_audio: bool = args.copy_audio
    # 기본 활성화, --no-emit-search-index로 비활성화
    emit_search_index: bool = not args.no_emit_search_index
    search_index_out: Optional[str] = args.search_index_out
    css_href: Optional[str] = args.css_href
    js_src: Optional[str] = args.js_src
    emit_index: bool = not args.no_index

    if not os.path.exists(json_path):
        print(f"❌ 파서 결과 JSON이 없습니다: {json_path}")
        print("   parser.py를 먼저 실행하여 JSON을 생성하세요. 예:")
        print("   python src/parser.py data/common-bible-kr.txt --save-json output/parsed_bible.json")
        raise SystemExit(1)

    os.makedirs(output_dir, exist_ok=True)

    # 출력 디렉터리 기준 상대 경로 자동 보정
    output_abs = os.path.abspath(output_dir)
    project_static_abs = os.path.abspath("static")
    project_audio_abs = os.path.abspath("data/audio")

    # static_base 자동
    if static_base_arg == "__AUTO__":
        static_base = os.path.relpath(project_static_abs, start=output_abs)
    else:
        static_base = static_base_arg

    # audio_base 자동 (사용자가 명시하지 않은 기본값일 때만 보정)
    if audio_base == "data/audio":
        audio_base = os.path.relpath(project_audio_abs, start=output_abs)

    # 파서 JSON 로드
    bible_parser = BibleParser('data/book_mappings.json')
    all_chapters = bible_parser.load_from_json(json_path)
    chapters = list(all_chapters)

    # 필터링: 책 약칭
    if book_filter:
        chapters = [c for c in chapters if c.book_abbr == book_filter]

    # 필터링: 장 번호 목록/구간
    if chapters_filter:
        wanted_numbers: set[int] = set()
        for token in chapters_filter.split(','):
            token = token.strip()
            if not token:
                continue
            if '-' in token:
                a, b = token.split('-', 1)
                try:
                    start = int(a)
                    end = int(b)
                    for n in range(min(start, end), max(start, end) + 1):
                        wanted_numbers.add(n)
                except ValueError:
                    pass
            else:
                try:
                    wanted_numbers.add(int(token))
                except ValueError:
                    pass
        chapters = [c for c in chapters if c.chapter_number in wanted_numbers]

    # 제한
    if limit is not None and limit >= 0:
        chapters = chapters[:limit]

    if not chapters:
        print("⚠️ 생성할 장이 없습니다. 필터 조건을 확인하세요.")
        raise SystemExit(0)

    # 필요 시 정적/오디오 복사
    if copy_static:
        dst = os.path.join(output_abs, "static")
        _copy_dir_dedup(project_static_abs, dst)
        # 복사했으면 HTML에서 로컬 static 경로 사용
        static_base = "static"
    if copy_audio:
        src_audio = project_audio_abs
        dst_audio = os.path.join(output_abs, "audio")
        _copy_dir_dedup(src_audio, dst_audio)
        # 복사했으면 HTML에서 로컬 audio 경로 사용
        audio_base = "audio"

    # HTML 생성기
    generator = HtmlGenerator(template_path)

    def compute_slug(book_abbr: str) -> str:
        slug = generator._get_book_slug(book_abbr)
        # 비ASCII(예: 한글)인 경우 영어 이름 기반으로 보정
        if not slug.isascii() or re.search(r"[가-힣]", slug):
            info = bible_parser.book_mappings.get(book_abbr)
            if info and info.get('english_name'):
                fallback = info['english_name'].lower()
                # 공백/구두점 제거, 숫자/영문만 유지
                fallback = re.sub(r"[^a-z0-9]+", "", fallback)
                if fallback:
                    return fallback
        return slug

    print(f"HTML 생성 시작... ({len(chapters)}개 장)")

    # 전역 검색 인덱스: 전체 절을 하나의 JSON으로 직렬화
    search_entries: list[dict] = []
    for i, chapter in enumerate(chapters, start=1):
        try:
            # 브레드크럼 메타: 책 목록 그대로 주입 (구분/약칭/전체 이름/영문 이름/aliases)
            books_meta: list[dict] | None = None
            try:
                with open('data/book_mappings.json', 'r', encoding='utf-8') as _bmf:
                    books_meta = json.load(_bmf)
            except Exception:
                books_meta = None

            # 이전/다음 장 링크 계산
            # 책 순서 목록과 각 책의 장 수 계산 (전체 본문 기준)
            book_list: list[dict] = books_meta or []
            # 별칭 → 표준 약칭(books_meta의 "약칭") 매핑
            alias_to_canonical: dict[str, str] = {}
            for b in book_list:
                can = b.get('약칭')
                if isinstance(can, str) and can:
                    alias_to_canonical[can] = can
                    full = b.get('전체 이름')
                    if isinstance(full, str) and full:
                        alias_to_canonical[full] = can
                    for al in (b.get('aliases') or []):
                        if isinstance(al, str) and al:
                            alias_to_canonical[al] = can

            # 표준 약칭 순서 (메타 순서 그대로)
            abbr_sequence: list[str] = []
            for b in book_list:
                can = b.get('약칭')
                if isinstance(can, str) and can:
                    abbr_sequence.append(can)

            # 각 책의 총 장 수 계산 (전체 장 컬렉션 기준, 표준 약칭 키)
            chapters_by_book: dict[str, set[int]] = {}
            canonical_to_actual_abbr: dict[str, str] = {}
            for ch2 in all_chapters:
                canonical = alias_to_canonical.get(
                    ch2.book_abbr, ch2.book_abbr)
                chapters_by_book.setdefault(
                    canonical, set()).add(ch2.chapter_number)
                # 대표 약칭(실제 파일명 슬러그 계산 시 사용)을 기록
                canonical_to_actual_abbr.setdefault(canonical, ch2.book_abbr)

            def get_total_chapters(abbr: str) -> int:
                nums = chapters_by_book.get(abbr)
                if not nums:
                    return 0
                return max(nums)

            def compute_prev_next(current_abbr: str, current_ch: int) -> tuple[tuple[str, int] | None, tuple[str, int] | None]:
                # 이전
                prev_target: tuple[str, int] | None = None
                next_target: tuple[str, int] | None = None

                if current_abbr in abbr_sequence:
                    idx = abbr_sequence.index(current_abbr)
                else:
                    idx = 0

                # 이전 장
                if current_ch > 1:
                    prev_target = (current_abbr, current_ch - 1)
                else:
                    # 이전 책 마지막 장으로
                    if idx > 0:
                        prev_abbr = abbr_sequence[idx - 1]
                        prev_total = get_total_chapters(prev_abbr)
                        if prev_total > 0:
                            prev_target = (prev_abbr, prev_total)

                # 다음 장
                total_current = get_total_chapters(current_abbr)
                if total_current and current_ch < total_current:
                    next_target = (current_abbr, current_ch + 1)
                else:
                    # 다음 책 1장
                    if idx < len(abbr_sequence) - 1:
                        next_abbr = abbr_sequence[idx + 1]
                        if get_total_chapters(next_abbr) > 0:
                            next_target = (next_abbr, 1)

                return prev_target, next_target

            current_canonical = alias_to_canonical.get(
                chapter.book_abbr, chapter.book_abbr)
            prev_target, next_target = compute_prev_next(
                current_canonical, chapter.chapter_number)

            def btn_svg(direction: str) -> str:
                if direction == 'left':
                    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>'
                else:
                    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>'

            def build_nav_button(target: tuple[str, int] | None, is_prev: bool) -> str:
                if not target:
                    # 비활성 버튼
                    return f'<span class="nav-btn disabled" aria-disabled="true">{btn_svg("left" if is_prev else "right")}</span>'
                t_canonical, t_ch = target
                # 실제 생성 파일의 약칭(로컬 약칭)으로 매핑
                t_actual_abbr = canonical_to_actual_abbr.get(
                    t_canonical, t_canonical)
                t_slug = compute_slug(t_actual_abbr)
                href = f"{t_slug}-{t_ch}.html"
                aria_label = ("이전 장" if is_prev else "다음 장")
                return f'<a class="nav-btn" href="{href}" aria-label="{aria_label}">{btn_svg("left" if is_prev else "right")}</a>'

            prev_btn_html = build_nav_button(prev_target, True)
            next_btn_html = build_nav_button(next_target, False)

            html = generator.generate_chapter_html(
                chapter,
                audio_base_url=audio_base,
                static_base=static_base,
                audio_check_base=(os.path.join(output_abs, audio_base) if not urlparse(
                    audio_base).scheme else audio_base),
                css_href=css_href,
                js_src=js_src,
                books_meta=books_meta,
                prev_button_html=prev_btn_html,
                next_button_html=next_btn_html,
            )
            slug = compute_slug(chapter.book_abbr)
            filename = f"{slug}-{chapter.chapter_number}.html"
            filepath = os.path.join(output_dir, filename)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(html)
            print(
                f"[{i}/{len(chapters)}] {chapter.book_name} {chapter.chapter_number}장 → {filename}")

            # 검색 인덱스 엔트리 적재
            if emit_search_index:
                for verse in chapter.verses:
                    verse_id = f"{chapter.book_abbr}-{chapter.chapter_number}-{verse.number}"
                    href = f"{slug}-{chapter.chapter_number}.html#{verse_id}"
                    # 텍스트에서 접근성 기호는 검색 품질을 위해 제거/단순화
                    verse_text = verse.text.replace(
                        '\u00B6', ' ').replace('¶', ' ').strip()
                    search_entries.append({
                        "i": verse_id,
                        "t": verse_text,
                        "h": href,
                        "b": chapter.book_abbr,
                        "c": chapter.chapter_number,
                        "v": verse.number,
                        "bo": HtmlGenerator.get_book_order_index(chapter.book_abbr),
                    })
        except Exception as e:
            print(
                f"❌ 생성 실패: {chapter.book_name} {chapter.chapter_number}장 - {e}")

    # 검색 인덱스 파일 저장
    if emit_search_index:
        # 기본 경로: <output_dir>/static/search/search-index.json
        if not search_index_out:
            search_index_out = os.path.join(
                output_dir, 'static', 'search', 'search-index.json')
        # 출력 디렉터리 생성
        os.makedirs(os.path.dirname(search_index_out), exist_ok=True)
        try:
            with open(search_index_out, 'w', encoding='utf-8') as f:
                json.dump(search_entries, f, ensure_ascii=False,
                          separators=(',', ':'))
            print(
                f"🗂️  전역 검색 인덱스 생성: {search_index_out} (엔트리 {len(search_entries)}개)")
        except Exception as e:
            print(f"❌ 검색 인덱스 생성 실패: {e}")

    # index.html 생성 (창세기 1장을 index.html로 복사)
    if emit_index:
        try:
            # 창세기 1장 파일을 index.html로 복사
            genesis_1_path = os.path.join(output_dir, "genesis-1.html")
            index_path = os.path.join(output_dir, "index.html")

            if os.path.exists(genesis_1_path):
                import shutil
                shutil.copy2(genesis_1_path, index_path)
                print("📄 index.html 생성 완료 (창세기 1장)")
            else:
                print("⚠️ genesis-1.html 파일이 없어 index.html을 생성할 수 없습니다.")
        except Exception as e:
            print(f"❌ index.html 생성 실패: {e}")

    print(f"\n✅ HTML 생성 완료! 파일 위치: {output_dir}")


if __name__ == "__main__":
    main()
