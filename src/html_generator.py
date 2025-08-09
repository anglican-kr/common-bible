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

    def generate_chapter_html(
        self,
        chapter: Chapter,
        audio_base_url: str = "data/audio",
        static_base: str = "../static",
        audio_check_base: str | None = None,
        css_href: Optional[str] = None,
        js_src: Optional[str] = None,
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
        alias_data_script = '<script>window.BIBLE_ALIAS = ' + \
            _json.dumps(alias_payload, ensure_ascii=False) + ';</script>'

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
        )

        # 오디오 파일 존재 여부에 따라 CSS 스타일 조정
        if audio_exists:
            html = html.replace('id="audio-unavailable"',
                                'id="audio-unavailable" style="display: none;"')
        else:
            html = html.replace('id="audio-container"',
                                'id="audio-container" style="display: none;"')

        return html

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
        if '¶' in verse_text:
            # ¶ 기호를 접근성 고려 마크업으로 교체
            verse_text = verse_text.replace(
                '¶',
                '<span class="paragraph-marker" aria-hidden="true">¶</span>'
            ).strip()

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
    chapters = bible_parser.load_from_json(json_path)

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
            html = generator.generate_chapter_html(
                chapter,
                audio_base_url=audio_base,
                static_base=static_base,
                audio_check_base=(os.path.join(output_abs, audio_base) if not urlparse(
                    audio_base).scheme else audio_base),
                css_href=css_href,
                js_src=js_src,
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

    print(f"\n✅ HTML 생성 완료! 파일 위치: {output_dir}")


if __name__ == "__main__":
    main()
