# 공동번역성서 프로젝트 설계서

## 📋 개요

공동번역성서 텍스트 파일(`common-bible-kr.txt`)을 장 단위로 파싱하여 접근성을 지원하는 HTML로 변환하고, WordPress REST API를 통해 대한성공회 서울교구 홈페이지에 자동으로 게시하는 시스템입니다.

---

## 🎯 프로젝트 목표

1. **텍스트 파싱**: 원본 텍스트를 장 단위로 분리
2. **HTML 변환**: 접근성을 고려한 HTML 생성 (오디오 파일 포함)
3. **WordPress 게시**: REST API를 통한 자동 게시

---

## 🏗️ 시스템 아키텍처

```
┌───────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  텍스트 파일 (Input)  │ --> │    파서 & 변환기    │ --> │  WordPress API      │
│ common-bible-kr.txt   │     │  (Python Script)    │     │ (seoul.anglican.kr) │
└───────────────────────┘     └─────────────────────┘     └─────────────────────┘
                                     │
                                     v
                              ┌─────────────────────┐
                              │  오디오 파일 매핑   │
                              │ (data/audio/*.mp3)  │
                              └─────────────────────┘
```

---

## 📂 프로젝트 구조

```
common-bible/
├── src/
│   ├── __init__.py
│   ├── parser.py           # 텍스트 파일 파싱
│   ├── html_generator.py   # HTML 생성 (접근성 포함)
│   ├── wordpress_api.py    # WordPress REST API 클라이언트
│   ├── config.py           # 설정 관리
│   └── main.py             # 메인 실행 파일
├── templates/
│   └── chapter.html        # HTML 템플릿
├── static/
│   ├── verse-style.css     # 스타일시트
│   └── verse-navigator.js  # 검색 기능 JavaScript
├── data/
│   ├── common-bible-kr.txt # 원본 텍스트
│   ├── audio/              # 오디오 파일 디렉토리
│   │   └── *.mp3
│   └── book_mappings.json  # 성경 책 이름 매핑
├── output/                 # 생성된 HTML 파일 (임시)
├── logs/                   # 로그 파일
├── tests/                  # 테스트 파일
├── .env.example            # 환경변수 예제
├── requirements.txt        # Python 패키지 목록
└── README.md               # 프로젝트 설명서
```

---

## 🔧 핵심 모듈 설계

### 1. 텍스트 파서 (parser.py)

```python
import re
import json
from typing import List, Dict, Optional
from dataclasses import dataclass

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

        # 단락 구분 기호 확인
        has_paragraph = '¶' in text
        if has_paragraph:
            text = text.replace('¶', '').strip()

        return Verse(
            number=verse_num,
            text=text,
            has_paragraph=has_paragraph
        )
```

### 2. HTML 생성기 (html_generator.py)

```python
import os
from string import Template
from typing import Optional

class HtmlGenerator:
    """HTML 생성기"""

    def __init__(self, template_path: str):
        with open(template_path, 'r', encoding='utf-8') as f:
            self.template = Template(f.read())

    def generate_chapter_html(self, chapter: Chapter, audio_base_url: str = "data/audio") -> str:
        """장을 HTML로 변환"""
        # 오디오 파일 경로 생성
        audio_filename = self._get_audio_filename(chapter)
        audio_path = f"{audio_base_url}/{audio_filename}"
        audio_exists = self._check_audio_exists(audio_path)

        # 절 HTML 생성
        verses_html = self._generate_verses_html(chapter)

        # 템플릿 렌더링
        return self.template.substitute(
            book_name=chapter.book_name,
            chapter_number=chapter.chapter_number,
            chapter_id=f"{chapter.book_abbr}-{chapter.chapter_number}",
            verses_content=verses_html,
            audio_path=audio_path if audio_exists else "",
            audio_title=f"{chapter.book_name} {chapter.chapter_number}장 오디오"
        )

    def _generate_verses_html(self, chapter: Chapter) -> str:
        """절들을 HTML로 변환"""
        paragraphs = []
        current_paragraph = []

        for verse in chapter.verses:
            verse_html = self._generate_verse_span(chapter, verse)

            if verse.has_paragraph and current_paragraph:
                # 새 단락 시작
                paragraphs.append(f'<p>{" ".join(current_paragraph)}</p>')
                current_paragraph = [verse_html]
            else:
                current_paragraph.append(verse_html)

        # 마지막 단락 추가
        if current_paragraph:
            paragraphs.append(f'<p>{" ".join(current_paragraph)}</p>')

        return '\n'.join(paragraphs)

    def _generate_verse_span(self, chapter: Chapter, verse: Verse) -> str:
        """절을 span 요소로 변환"""
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
                '<span class="paragraph-marker" aria-hidden="true">¶</span> '
            ).strip()

        return (
            f'<span id="{verse_id}">'
            f'<span aria-hidden="true" class="verse-number">{verse.number}</span> '
            f'{verse_text}'
            f'</span>'
        )

    def _get_audio_filename(self, chapter: Chapter) -> str:
        """오디오 파일명 생성"""
        book_slug = chapter.book_abbr.lower()
        # 영문 매핑이 필요한 경우 처리
        book_slug_map = {
            "창세": "genesis",
            "출애": "exodus",
            # ... 추가 매핑
        }
        book_slug = book_slug_map.get(chapter.book_abbr, book_slug)
        return f"{book_slug}-{chapter.chapter_number}.mp3"

    def _check_audio_exists(self, audio_path: str) -> bool:
        """오디오 파일 존재 여부 확인"""
        import os
        return os.path.exists(audio_path)
```

### 3. WordPress API 클라이언트 (wordpress_api.py)

```python
import requests
from requests.auth import HTTPBasicAuth
from typing import Dict, Any, Optional, List
import time
import logging

class WordPressAPI:
    """WordPress REST API 클라이언트 - 카테고리/태그 자동 생성 지원"""

    def __init__(self, site_url: str, username: str, password: str, book_mappings: Dict[str, Dict] = None):
        self.site_url = site_url.rstrip('/')
        self.auth = HTTPBasicAuth(username, password)
        self.api_url = f"{self.site_url}/wp-json/wp/v2"
        self.book_mappings = book_mappings or {}
        self.logger = logging.getLogger(__name__)

        # 캐시 - API 호출 최소화
        self._category_cache = {}
        self._tag_cache = {}

    def get_or_create_category(self, category_name: str) -> int:
        """카테고리가 있으면 ID 반환, 없으면 생성 후 ID 반환"""
        # 캐시 확인
        if category_name in self._category_cache:
            return self._category_cache[category_name]

        self.logger.info(f"카테고리 확인 중: {category_name}")

        # 1. 기존 카테고리 검색
        response = requests.get(
            f"{self.api_url}/categories",
            params={'search': category_name, 'per_page': 100},
            auth=self.auth,
            timeout=30
        )

        if response.status_code == 200:
            categories = response.json()
            for category in categories:
                if category['name'] == category_name:
                    self._category_cache[category_name] = category['id']
                    self.logger.info(f"기존 카테고리 발견: {category_name} (ID: {category['id']})")
                    return category['id']

        # 2. 카테고리가 없으면 생성
        self.logger.info(f"카테고리 생성 중: {category_name}")
        create_response = requests.post(
            f"{self.api_url}/categories",
            json={
                'name': category_name,
                'description': f'{category_name} 관련 게시물'
            },
            auth=self.auth,
            timeout=30
        )

        if create_response.status_code == 201:
            category_id = create_response.json()['id']
            self._category_cache[category_name] = category_id
            self.logger.info(f"카테고리 생성 완료: {category_name} (ID: {category_id})")
            return category_id
        else:
            raise Exception(f"카테고리 생성 실패: {create_response.status_code} - {create_response.text}")

    def get_or_create_tag(self, tag_name: str) -> int:
        """태그가 있으면 ID 반환, 없으면 생성 후 ID 반환"""
        # 캐시 확인
        if tag_name in self._tag_cache:
            return self._tag_cache[tag_name]

        self.logger.debug(f"태그 확인 중: {tag_name}")

        # 1. 기존 태그 검색
        response = requests.get(
            f"{self.api_url}/tags",
            params={'search': tag_name, 'per_page': 100},
            auth=self.auth,
            timeout=30
        )

        if response.status_code == 200:
            tags = response.json()
            for tag in tags:
                if tag['name'] == tag_name:
                    self._tag_cache[tag_name] = tag['id']
                    self.logger.debug(f"기존 태그 발견: {tag_name} (ID: {tag['id']})")
                    return tag['id']

        # 2. 태그가 없으면 생성
        self.logger.debug(f"태그 생성 중: {tag_name}")
        create_response = requests.post(
            f"{self.api_url}/tags",
            json={
                'name': tag_name,
                'description': f'{tag_name} 관련 게시물'
            },
            auth=self.auth,
            timeout=30
        )

        if create_response.status_code == 201:
            tag_id = create_response.json()['id']
            self._tag_cache[tag_name] = tag_id
            self.logger.debug(f"태그 생성 완료: {tag_name} (ID: {tag_id})")
            return tag_id
        else:
            raise Exception(f"태그 생성 실패: {create_response.status_code} - {create_response.text}")

    def generate_post_tags(self, chapter) -> List[int]:
        """Chapter 정보로 태그 ID 리스트 생성"""
        # book_mappings에서 구분 정보 가져오기
        book_info = self.book_mappings.get(chapter.book_abbr, {})
        testament = book_info.get('구분', '구약')

        # 필요한 태그 이름들
        tag_names = [
            "공동번역성서",           # 기본 태그
            testament,               # 구분 태그 (구약/외경/신약)
            chapter.book_name        # 책 이름 태그
        ]

        self.logger.info(f"태그 생성 중: {tag_names}")

        # 각 태그에 대해 ID 확인/생성
        tag_ids = []
        for tag_name in tag_names:
            try:
                tag_id = self.get_or_create_tag(tag_name)
                tag_ids.append(tag_id)
                # API 호출 제한 고려 - 짧은 지연
                time.sleep(0.1)
            except Exception as e:
                self.logger.error(f"태그 처리 실패: {tag_name} - {e}")
                # 태그 하나 실패해도 계속 진행

        self.logger.info(f"태그 ID 목록: {tag_ids}")
        return tag_ids

    def create_post_with_auto_taxonomy(
        self,
        chapter,
        content: str,
        status: str = 'private',
        base_category: str = "공동번역성서"
    ) -> Dict[str, Any]:
        """카테고리/태그 자동 관리하며 게시물 생성"""

        # 1. 카테고리 확인/생성
        category_id = self.get_or_create_category(base_category)

        # 2. 태그들 확인/생성
        tag_ids = self.generate_post_tags(chapter)

        # 3. 게시물 생성
        title = f"{chapter.book_name} {chapter.chapter_number}장"
        slug = f"{chapter.book_abbr}-{chapter.chapter_number}"

        return self.create_post(
            title=title,
            content=content,
            slug=slug,
            status=status,
            categories=[category_id],
            tags=tag_ids,
            meta={
                'bible_book': chapter.book_name,
                'bible_chapter': chapter.chapter_number,
                'bible_book_abbr': chapter.book_abbr
            }
        )

    def create_post(
        self,
        title: str,
        content: str,
        slug: str,
        status: str = 'private',
        categories: List[int] = None,
        tags: List[int] = None,
        meta: Dict[str, Any] = None
    ) -> Dict[str, Any]:
        """포스트 생성"""
        post_data = {
            'title': title,
            'content': content,
            'slug': slug,
            'status': status,
            'categories': categories or [],
            'tags': tags or [],
            'meta': meta or {}
        }

        self.logger.info(f"게시물 생성 중: {title}")

        response = requests.post(
            f"{self.api_url}/posts",
            json=post_data,
            auth=self.auth,
            headers={'Content-Type': 'application/json'},
            timeout=30
        )

        if response.status_code not in [200, 201]:
            raise Exception(f"WordPress API Error: {response.status_code} - {response.text}")

        result = response.json()
        self.logger.info(f"게시물 생성 완료: {title} (ID: {result['id']})")
        return result

    def update_post_status(self, post_id: int, status: str) -> Dict[str, Any]:
        """포스트 상태 업데이트"""
        response = requests.post(
            f"{self.api_url}/posts/{post_id}",
            json={'status': status},
            auth=self.auth,
            timeout=30
        )

        if response.status_code != 200:
            raise Exception(f"WordPress API Error: {response.status_code}")

        return response.json()

    def validate_auth(self) -> bool:
        """인증 상태 확인"""
        try:
            response = requests.get(
                f"{self.api_url}/users/me",
                auth=self.auth,
                timeout=10
            )
            return response.status_code == 200
        except Exception as e:
            self.logger.error(f"인증 확인 실패: {e}")
            return False
```

### 4. 메인 실행 파일 (main.py)

```python
#!/usr/bin/env python3
import os
import sys
import logging
from pathlib import Path
from config import Config

def setup_logging():
    """로깅 설정"""
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler('logs/bible_converter.log'),
            logging.StreamHandler(sys.stdout)
        ]
    )

def main():
    """메인 실행 함수"""
    setup_logging()
    logger = logging.getLogger(__name__)

    # 설정 로드
    config = Config()

    # 1. 텍스트 파싱
    logger.info("성경 텍스트 파싱 시작...")
    parser = BibleParser(config.book_mappings_path)
    chapters = parser.parse_file(config.bible_text_path)
    logger.info(f"{len(chapters)}개 장 파싱 완료")

    # 2. HTML 생성
    logger.info("HTML 생성 시작...")
    html_generator = HtmlGenerator(config.template_path)

    # 3. WordPress API 연결 (book_mappings 전달)
    wp_api = WordPressAPI(
        site_url=config.wp_site_url,
        username=config.wp_username,
        password=config.wp_password,
        book_mappings=parser.book_mappings
    )

    # 인증 확인
    if not wp_api.validate_auth():
        logger.error("WordPress 인증 실패. 설정을 확인하세요.")
        return

    # 4. 각 장 처리
    for chapter in chapters:
        try:
            # HTML 생성
            html_content = html_generator.generate_chapter_html(chapter)

            # WordPress 게시 (카테고리/태그 자동 생성)
            result = wp_api.create_post_with_auto_taxonomy(
                chapter=chapter,
                content=html_content,
                status=config.wp_default_status,
                base_category=config.wp_base_category
            )

            logger.info(f"게시 완료: {chapter.book_name} {chapter.chapter_number}장 (ID: {result['id']})")

        except Exception as e:
            logger.error(f"게시 실패: {chapter.book_name} {chapter.chapter_number}장 - {e}")

    logger.info("모든 작업 완료!")

if __name__ == "__main__":
    main()
```

### 5. 설정 파일 (config.py)

```python
import os
from dotenv import load_dotenv

class Config:
    """프로젝트 설정"""

    def __init__(self):
        load_dotenv()

        # 파일 경로
        self.bible_text_path = "data/common-bible-kr.txt"
        self.book_mappings_path = "data/book_mappings.json"
        self.template_path = "templates/chapter.html"

        # WordPress 설정
        self.wp_site_url = os.getenv('WP_SITE_URL', 'https://seoul.anglican.kr')
        self.wp_username = os.getenv('WP_USERNAME')
        self.wp_password = os.getenv('WP_PASSWORD')
        self.wp_default_status = os.getenv('WP_DEFAULT_STATUS', 'private')

        # 카테고리/태그 자동 생성 설정
        self.wp_base_category = os.getenv('WP_BASE_CATEGORY', '공동번역성서')
        self.wp_base_tag = os.getenv('WP_BASE_TAG', '공동번역성서')

        # 검증
        if not self.wp_username or not self.wp_password:
            raise ValueError("WordPress 인증 정보가 설정되지 않았습니다. .env 파일을 확인하세요.")
```

### 6. HTML 템플릿 (templates/chapter.html)

```html
<!-- 검색 UI -->
<div class="search-container">
    <form id="verse-search-form" role="search" aria-label="성경 구절 검색">
        <label for="verse-search" class="screen-reader-text">검색</label>
        <input
            type="text"
            id="verse-search"
            placeholder="절 ID 또는 단어 검색 (예: ${book_name} ${chapter_number}:3)"
        />
        <button type="submit">검색</button>
    </form>
</div>

<!-- 오디오 플레이어 (오디오 파일이 있는 경우) -->
$audio_path and '''
<div class="audio-player-container">
    <h2 class="screen-reader-text">성경 오디오</h2>
    <audio controls class="bible-audio" aria-label="${audio_title}">
        <source src="${audio_path}" type="audio/mpeg" />
        <p>
            브라우저가 오디오 재생을 지원하지 않습니다.
            <a href="${audio_path}">오디오 파일 다운로드</a>
        </p>
    </audio>
</div>
''' or '''
<div class="audio-unavailable-notice">
    <p class="notice-text" aria-live="polite">
        <span class="icon" aria-hidden="true">🎵</span>
        이 장의 오디오는 현재 준비 중입니다.
    </p>
</div>
'''

<!-- 성경 본문 -->
<article id="${chapter_id}">
    <h1>${book_name} ${chapter_number}장</h1>
    ${verses_content}
</article>

<script src="/static/verse-navigator.js"></script>
```

---

## 🚀 실행 방법

### 1. 환경 설정

```bash
# 가상환경 생성
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 패키지 설치
pip install -r requirements.txt

# 환경변수 설정
cp .env.example .env
# .env 파일을 편집하여 WordPress 인증 정보 입력
```

### 2. 실행

```bash
# 전체 프로세스 실행
python src/main.py

# 테스트 실행
python -m pytest tests/
```

---

## 🧪 단위 테스트 설계

### 1. 텍스트 파서 테스트 (tests/test_parser.py)

```python
import pytest
import json
import tempfile
import os
from src.parser import BibleParser, Chapter, Verse

class TestBibleParser:
    """텍스트 파서 테스트"""

    @pytest.fixture
    def sample_book_mappings(self):
        """테스트용 책 매핑 데이터"""
        return [
            {
                "약칭": "창세",
                "전체 이름": "창세기",
                "영문 이름": "Genesis",
                "구분": "구약"
            },
            {
                "약칭": "마태",
                "전체 이름": "마태복음",
                "영문 이름": "Matthew",
                "구분": "신약"
            }
        ]

    @pytest.fixture
    def sample_text_content(self):
        """테스트용 성경 텍스트"""
        return """창세 1:1
1 태초에 하나님이 천지를 창조하시니라
2 ¶땅이 혼돈하고 공허하며 흑암이 깊음 위에 있고 하나님의 영은 수면 위에 운행하시니라

마태 1:1
1 아브라함과 다윗의 후손 예수 그리스도의 계보라
2 아브라함이 이삭을 낳고 이삭이 야곱을 낳고"""

    @pytest.fixture
    def parser_with_temp_mappings(self, sample_book_mappings):
        """임시 매핑 파일로 파서 생성"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(sample_book_mappings, f, ensure_ascii=False)
            temp_path = f.name

        parser = BibleParser(temp_path)
        yield parser

        # 정리
        os.unlink(temp_path)

    def test_load_book_mappings(self, parser_with_temp_mappings):
        """책 매핑 로드 테스트"""
        parser = parser_with_temp_mappings

        assert "창세" in parser.book_mappings
        assert parser.book_mappings["창세"]["full_name"] == "창세기"
        assert parser.book_mappings["창세"]["구분"] == "구약"
        assert parser.book_mappings["마태"]["구분"] == "신약"

    def test_get_full_book_name(self, parser_with_temp_mappings):
        """책 이름 변환 테스트"""
        parser = parser_with_temp_mappings

        assert parser._get_full_book_name("창세") == "창세기"
        assert parser._get_full_book_name("마태") == "마태복음"
        assert parser._get_full_book_name("없는책") == "없는책"  # 매핑 없을 때

    def test_parse_verse_line(self, parser_with_temp_mappings):
        """절 파싱 테스트"""
        parser = parser_with_temp_mappings

        # 일반 절
        verse = parser._parse_verse_line("1 태초에 하나님이 천지를 창조하시니라")
        assert verse.number == 1
        assert verse.text == "태초에 하나님이 천지를 창조하시니라"
        assert verse.has_paragraph == False

        # 단락 표시가 있는 절
        verse_with_para = parser._parse_verse_line("2 ¶땅이 혼돈하고 공허하며")
        assert verse_with_para.number == 2
        assert verse_with_para.text == "땅이 혼돈하고 공허하며"
        assert verse_with_para.has_paragraph == True

        # 잘못된 형식
        invalid_verse = parser._parse_verse_line("잘못된 형식")
        assert invalid_verse is None

    def test_parse_file(self, parser_with_temp_mappings, sample_text_content):
        """파일 파싱 테스트"""
        parser = parser_with_temp_mappings

        # 임시 텍스트 파일 생성
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write(sample_text_content)
            temp_path = f.name

        try:
            chapters = parser.parse_file(temp_path)

            # 2개 장이 파싱되어야 함
            assert len(chapters) == 2

            # 첫 번째 장 (창세기 1장)
            genesis_chapter = chapters[0]
            assert genesis_chapter.book_name == "창세기"
            assert genesis_chapter.book_abbr == "창세"
            assert genesis_chapter.chapter_number == 1
            assert len(genesis_chapter.verses) == 2

            # 두 번째 절에 단락 표시 있음
            assert genesis_chapter.verses[1].has_paragraph == True

            # 두 번째 장 (마태복음 1장)
            matthew_chapter = chapters[1]
            assert matthew_chapter.book_name == "마태복음"
            assert matthew_chapter.book_abbr == "마태"
            assert matthew_chapter.chapter_number == 1

        finally:
            os.unlink(temp_path)
```

### 2. HTML 생성기 테스트 (tests/test_html_generator.py)

```python
import pytest
import tempfile
import os
from src.html_generator import HtmlGenerator
from src.parser import Chapter, Verse

class TestHtmlGenerator:
    """HTML 생성기 테스트"""

    @pytest.fixture
    def sample_template(self):
        """테스트용 HTML 템플릿"""
        return """<!DOCTYPE html>
<html>
<head>
    <title>${book_name} ${chapter_number}장</title>
</head>
<body>
    <article id="${chapter_id}">
        <h1>${book_name} ${chapter_number}장</h1>
        ${verses_content}
        ${audio_path and f'<audio src="{audio_path}"></audio>' or ''}
    </article>
</body>
</html>"""

    @pytest.fixture
    def html_generator(self, sample_template):
        """HTML 생성기 인스턴스"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as f:
            f.write(sample_template)
            temp_path = f.name

        generator = HtmlGenerator(temp_path)
        yield generator

        os.unlink(temp_path)

    @pytest.fixture
    def sample_chapter(self):
        """테스트용 장 데이터"""
        verses = [
            Verse(number=1, text="태초에 하나님이 천지를 창조하시니라", has_paragraph=False),
            Verse(number=2, text="땅이 혼돈하고 공허하며", has_paragraph=True),
            Verse(number=3, text="하나님이 이르시되 빛이 있으라", has_paragraph=False)
        ]
        return Chapter(
            book_name="창세기",
            book_abbr="창세",
            chapter_number=1,
            verses=verses
        )

    def test_generate_verse_span(self, html_generator, sample_chapter):
        """절 HTML 생성 테스트"""
        verse = sample_chapter.verses[0]
        html = html_generator._generate_verse_span(sample_chapter, verse)

        assert 'id="창세-1-1"' in html
        assert 'class="verse-number"' in html
        assert '태초에 하나님이 천지를 창조하시니라' in html
        assert 'aria-hidden="true"' in html

    def test_generate_verse_with_paragraph(self, html_generator, sample_chapter):
        """단락 표시가 있는 절 HTML 생성 테스트"""
        verse_with_para = sample_chapter.verses[1]
        html = html_generator._generate_verse_span(sample_chapter, verse_with_para)

        assert 'class="paragraph-marker"' in html
        assert '¶' in html
        assert '땅이 혼돈하고 공허하며' in html

    def test_generate_verses_html(self, html_generator, sample_chapter):
        """절들 HTML 생성 테스트"""
        verses_html = html_generator._generate_verses_html(sample_chapter)

        # 단락 구분으로 2개의 <p> 태그가 생성되어야 함
        assert verses_html.count('<p>') == 2
        assert verses_html.count('</p>') == 2

        # 모든 절이 포함되어야 함
        assert '태초에 하나님이' in verses_html
        assert '땅이 혼돈하고' in verses_html
        assert '빛이 있으라' in verses_html

    def test_audio_filename_generation(self, html_generator, sample_chapter):
        """오디오 파일명 생성 테스트"""
        filename = html_generator._get_audio_filename(sample_chapter)
        assert filename == "창세-1.mp3"

    def test_check_audio_exists(self, html_generator):
        """오디오 파일 존재 확인 테스트"""
        # 존재하지 않는 파일
        assert html_generator._check_audio_exists("nonexistent.mp3") == False

        # 임시 파일 생성해서 테스트
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
            temp_path = f.name

        try:
            assert html_generator._check_audio_exists(temp_path) == True
        finally:
            os.unlink(temp_path)
```

### 3. WordPress API 테스트 (tests/test_wordpress_api.py)

```python
import pytest
import responses
from src.wordpress_api import WordPressAPI
from src.parser import Chapter, Verse

class TestWordPressAPI:
    """WordPress API 클라이언트 테스트"""

    @pytest.fixture
    def wp_api(self):
        """WordPress API 인스턴스"""
        book_mappings = {
            "창세": {
                "full_name": "창세기",
                "english_name": "Genesis",
                "구분": "구약"
            }
        }
        return WordPressAPI(
            site_url="https://test.example.com",
            username="testuser",
            password="testpass",
            book_mappings=book_mappings
        )

    @pytest.fixture
    def sample_chapter(self):
        """테스트용 장 데이터"""
        verses = [Verse(number=1, text="테스트 절", has_paragraph=False)]
        return Chapter(
            book_name="창세기",
            book_abbr="창세",
            chapter_number=1,
            verses=verses
        )

    @responses.activate
    def test_validate_auth_success(self, wp_api):
        """인증 확인 성공 테스트"""
        responses.add(
            responses.GET,
            "https://test.example.com/wp-json/wp/v2/users/me",
            json={"id": 1, "name": "testuser"},
            status=200
        )

        assert wp_api.validate_auth() == True

    @responses.activate
    def test_validate_auth_failure(self, wp_api):
        """인증 확인 실패 테스트"""
        responses.add(
            responses.GET,
            "https://test.example.com/wp-json/wp/v2/users/me",
            json={"code": "rest_forbidden"},
            status=403
        )

        assert wp_api.validate_auth() == False

    @responses.activate
    def test_get_or_create_category_existing(self, wp_api):
        """기존 카테고리 조회 테스트"""
        responses.add(
            responses.GET,
            "https://test.example.com/wp-json/wp/v2/categories",
            json=[{"id": 5, "name": "공동번역성서"}],
            status=200
        )

        category_id = wp_api.get_or_create_category("공동번역성서")
        assert category_id == 5
        assert "공동번역성서" in wp_api._category_cache

    @responses.activate
    def test_get_or_create_category_new(self, wp_api):
        """새 카테고리 생성 테스트"""
        # 검색 결과 없음
        responses.add(
            responses.GET,
            "https://test.example.com/wp-json/wp/v2/categories",
            json=[],
            status=200
        )

        # 카테고리 생성
        responses.add(
            responses.POST,
            "https://test.example.com/wp-json/wp/v2/categories",
            json={"id": 10, "name": "공동번역성서"},
            status=201
        )

        category_id = wp_api.get_or_create_category("공동번역성서")
        assert category_id == 10

    @responses.activate
    def test_get_or_create_tag(self, wp_api):
        """태그 생성/조회 테스트"""
        # 검색 결과 없음
        responses.add(
            responses.GET,
            "https://test.example.com/wp-json/wp/v2/tags",
            json=[],
            status=200
        )

        # 태그 생성
        responses.add(
            responses.POST,
            "https://test.example.com/wp-json/wp/v2/tags",
            json={"id": 15, "name": "구약"},
            status=201
        )

        tag_id = wp_api.get_or_create_tag("구약")
        assert tag_id == 15

    def test_generate_post_tags(self, wp_api, sample_chapter):
        """게시물 태그 생성 테스트"""
        # Mock the get_or_create_tag method
        wp_api.get_or_create_tag = lambda name: {"공동번역성서": 1, "구약": 2, "창세기": 3}[name]

        tag_ids = wp_api.generate_post_tags(sample_chapter)

        assert len(tag_ids) == 3
        assert 1 in tag_ids  # 공동번역성서
        assert 2 in tag_ids  # 구약
        assert 3 in tag_ids  # 창세기

    @responses.activate
    def test_create_post(self, wp_api):
        """게시물 생성 테스트"""
        responses.add(
            responses.POST,
            "https://test.example.com/wp-json/wp/v2/posts",
            json={"id": 100, "title": {"rendered": "창세기 1장"}},
            status=201
        )

        result = wp_api.create_post(
            title="창세기 1장",
            content="<p>테스트 내용</p>",
            slug="genesis-1",
            categories=[5],
            tags=[1, 2, 3]
        )

        assert result["id"] == 100
```

### 4. 설정 테스트 (tests/test_config.py)

```python
import pytest
import os
import tempfile
from src.config import Config

class TestConfig:
    """설정 클래스 테스트"""

    def test_config_with_env_vars(self, monkeypatch):
        """환경변수 설정 테스트"""
        monkeypatch.setenv("WP_SITE_URL", "https://custom.site.com")
        monkeypatch.setenv("WP_USERNAME", "customuser")
        monkeypatch.setenv("WP_PASSWORD", "custompass")
        monkeypatch.setenv("WP_BASE_CATEGORY", "custom_category")

        config = Config()

        assert config.wp_site_url == "https://custom.site.com"
        assert config.wp_username == "customuser"
        assert config.wp_password == "custompass"
        assert config.wp_base_category == "custom_category"

    def test_config_defaults(self):
        """기본값 테스트"""
        # 환경변수 없는 상태에서 테스트
        config = Config()

        assert config.wp_site_url == "https://seoul.anglican.kr"
        assert config.wp_base_category == "공동번역성서"
        assert config.wp_default_status == "private"

    def test_config_missing_auth_raises_error(self):
        """인증 정보 누락 시 에러 테스트"""
        # 인증 정보 없이 Config 생성하면 ValueError 발생해야 함
        with pytest.raises(ValueError, match="WordPress 인증 정보가 설정되지 않았습니다"):
            Config()
```

### 5. 통합 테스트 (tests/test_integration.py)

```python
import pytest
import responses
import tempfile
import json
import os
from src.parser import BibleParser
from src.html_generator import HtmlGenerator
from src.wordpress_api import WordPressAPI

class TestIntegration:
    """통합 테스트"""

    @pytest.fixture
    def full_setup(self):
        """전체 시스템 설정"""
        # 책 매핑 파일
        book_mappings = [{"약칭": "창세", "전체 이름": "창세기", "영문 이름": "Genesis", "구분": "구약"}]
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(book_mappings, f, ensure_ascii=False)
            mappings_path = f.name

        # 텍스트 파일
        text_content = "창세 1:1\n1 태초에 하나님이 천지를 창조하시니라\n"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write(text_content)
            text_path = f.name

        # HTML 템플릿
        template_content = "<h1>${book_name} ${chapter_number}장</h1>${verses_content}"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as f:
            f.write(template_content)
            template_path = f.name

        yield {
            'mappings_path': mappings_path,
            'text_path': text_path,
            'template_path': template_path
        }

        # 정리
        os.unlink(mappings_path)
        os.unlink(text_path)
        os.unlink(template_path)

    @responses.activate
    def test_full_workflow(self, full_setup):
        """전체 워크플로우 테스트"""
        # WordPress API Mock 설정
        responses.add(responses.GET, "https://test.example.com/wp-json/wp/v2/users/me", json={"id": 1}, status=200)
        responses.add(responses.GET, "https://test.example.com/wp-json/wp/v2/categories", json=[], status=200)
        responses.add(responses.POST, "https://test.example.com/wp-json/wp/v2/categories", json={"id": 5}, status=201)
        responses.add(responses.GET, "https://test.example.com/wp-json/wp/v2/tags", json=[], status=200)
        responses.add(responses.POST, "https://test.example.com/wp-json/wp/v2/tags", json={"id": 10}, status=201)
        responses.add(responses.POST, "https://test.example.com/wp-json/wp/v2/posts", json={"id": 100}, status=201)

        # 1. 파싱
        parser = BibleParser(full_setup['mappings_path'])
        chapters = parser.parse_file(full_setup['text_path'])

        # 2. HTML 생성
        html_generator = HtmlGenerator(full_setup['template_path'])
        html_content = html_generator.generate_chapter_html(chapters[0])

        # 3. WordPress 게시
        wp_api = WordPressAPI(
            site_url="https://test.example.com",
            username="test",
            password="test",
            book_mappings=parser.book_mappings
        )

        result = wp_api.create_post_with_auto_taxonomy(
            chapter=chapters[0],
            content=html_content,
            status="private"
        )

        assert result["id"] == 100
        assert len(chapters) == 1
        assert "창세기 1장" in html_content
```

### 6. 테스트 실행 설정 (pytest.ini)

```ini
[tool:pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -v --tb=short --strict-markers
markers =
    unit: 단위 테스트
    integration: 통합 테스트
    slow: 느린 테스트
```

---

## 📋 requirements.txt

```
requests==2.31.0
python-dotenv==1.0.0
beautifulsoup4==4.12.2
pytest==7.4.3
pytest-responses==0.5.1
```

---

## 🔒 보안 사항

1. **인증 정보**: `.env` 파일에 저장, 절대 커밋하지 않음
2. **HTTPS 통신**: WordPress API는 항상 HTTPS 사용
3. **입력 검증**: HTML 생성 시 텍스트 이스케이프 처리

---

## ✅ 체크리스트

-   [ ] 텍스트 파일 파싱 (장/절/단락 구분)
-   [ ] 접근성 HTML 생성 (aria-hidden, 고유 ID)
-   [ ] 오디오 파일 통합 및 조건부 표시
-   [ ] WordPress REST API 연동
-   [ ] 카테고리/태그 자동 생성 및 관리
-   [ ] 비공개 게시물로 생성
-   [ ] 로깅 및 오류 처리
-   [ ] 3단계 태그 시스템 (공동번역성서, 구분, 책이름)

---

이 설계는 요구사항에 충실하면서도 심플하고 실용적인 구조를 유지합니다. 필요에 따라 기능을 추가하거나 수정할 수 있는 유연성도 갖추고 있습니다.
