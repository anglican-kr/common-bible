# 공동번역성서 프로젝트 API 문서

## 📖 개요

이 문서는 현재 저장소에 포함된 주요 모듈들의 공개 API를 설명합니다.

---

## 🔧 BibleParser (src/parser.py)

### 초기화

```python
from src.parser import BibleParser
parser = BibleParser(book_mappings_path: str)
```

**매개변수:**

- `book_mappings_path`: `data/book_mappings.json` 경로

### 메서드

#### 공개 메서드

- `parse_file(file_path: str) -> List[Chapter]`
- `parse_file_with_cache(file_path: str, cache_path: str = "output/parsed_bible.json") -> List[Chapter]`
- `save_to_json(chapters: List[Chapter], output_path: str) -> None`
- `load_from_json(json_path: str) -> List[Chapter]`

---

## 🎨 HtmlGenerator (src/html_generator.py)

### 초기화

```python
from src.html_generator import HtmlGenerator
generator = HtmlGenerator(template_path: str)
```

### 메서드

#### 공개 메서드

- `generate_chapter_html(chapter: Chapter, audio_base_url: str = "data/audio", static_base: str = "../static", audio_check_base: Optional[str] = None, css_href: Optional[str] = None, js_src: Optional[str] = None) -> str`
  - 장을 HTML로 변환. 오디오 경로/존재 여부 및 정적 리소스 경로를 주입
  - css_href/js_src 지정 시 본문에 링크/스크립트 태그를 삽입(차일드 테마 enqueue 시 생략)

- `generate_index_html(chapters: List[Chapter], static_base: str = "../static", css_href: Optional[str] = None, js_src: Optional[str] = None) -> str`
  - 전체 성경 목차 HTML 생성

#### 정적 메서드

- `@staticmethod get_book_order_index(book_abbr: str) -> int`
  - 공동번역 약칭/외경 포함 순서를 `data/book_mappings.json`의 나열 순서로 정의

- `@staticmethod compute_slug(book_abbr: str) -> str`
  - 책 약칭으로부터 URL 슬러그 생성

#### 보조 메서드(내부)

- `_generate_verses_html(chapter: Chapter) -> str`
- `_generate_verse_span(chapter: Chapter, verse: Verse) -> str`
- `_get_audio_filename(chapter: Chapter) -> str`
- `_check_audio_exists(audio_path: str) -> bool`
- `_get_book_slug(book_abbr: str) -> str`

---

## 🚀 WordPress Publisher (src/wordpress_api.py)

워드프레스 게시 오케스트레이션을 위한 공개 API입니다. 현재 기본 구현은 안전한 DRY 로그 중심이며, 실제 HTTP 호출은 교체/확장 가능합니다.

### 클래스

#### WordPressClient

- `upload_media_from_path(file_path: str, desired_slug: str, mime_hint: str) -> AssetRecord`
- `find_media_by_slug(slug: str) -> Optional[AssetRecord]`
- `ensure_category(name: str) -> int`
- `ensure_tag(name: str) -> int`
- `create_or_update_post(slug: str, title: str, content_html: str, status: str, category_ids: List[int], tag_ids: List[int]) -> int`
- `update_post_status(post_id: int, status: str, scheduled_iso: Optional[str] = None) -> int`
- `list_posts(status: str, category_id: Optional[int] = None, tag_ids: Optional[List[int]] = None, slug_prefix: Optional[str] = None, per_page: int = 100, page: int = 1) -> List[Dict[str, Any]]`

#### AssetRegistry

- `load() -> None`
- `save() -> None`
- `get(local_path: Path) -> Optional[AssetRecord]`
- `upsert(local_path: Path, record: AssetRecord) -> None`

#### Publisher

- `ensure_policy_assets(css_path: Path, audio_dir: Optional[Path] = None) -> Dict[str, Any]`
- `render_and_publish_chapter(html_path: Path, meta: ChapterPostMeta, status: Optional[str] = None, dry_run: bool = True) -> int`
- `bulk_update_status(target_status: str, *, category: str = "공동번역성서", division_tag: Optional[str] = None, slug_prefix: Optional[str] = None, scheduled_iso: Optional[str] = None, dry_run: bool = False, per_page: int = 100) -> Dict[str, Any]`

---

## 📊 데이터 모델

### Chapter 클래스

```python
@dataclass
class Chapter:
    book_name: str          # 책 이름 (예: "창세기")
    book_abbr: str
    chapter_number: int
    verses: List[Verse]
```

### Verse 클래스

### AssetRecord (wordpress_api)

```python
@dataclass
class AssetRecord:
    slug: str
    sha256: str
    wp_media_id: Optional[int]
    source_url: Optional[str]
    mime_type: Optional[str]
    uploaded_at: Optional[str]
```

### ChapterPostMeta (wordpress_api)

```python
@dataclass
class ChapterPostMeta:
    book_name: str
    book_abbr: str
    english_name: str
    division: str
    chapter_number: int
```

```python
@dataclass
class Verse:
    number: int             # 절 번호 (예: 1)
    text: str
    has_paragraph: bool
```

---

## 🌐 JavaScript API (static/verse-navigator.js)

### 함수

전역 API:

- `highlightVerse(verseId: string): boolean`
- `clearHighlight(): void`
- `searchByText(query: string): void`

별칭/슬러그 데이터는 `window.BIBLE_ALIAS`로 주입됩니다.

---

> 참고: 보안/예외 유틸리티는 별도 명세에서 다룹니다. 현재 저장소에는 `SecurityManager`, 전용 예외 클래스는 포함되어 있지 않습니다.

---

## 🔎 Web Worker 메시지 규약 (static/search-worker.js)

### 요청 메시지

- `init`: `{ type: 'init' }` — 워커 준비 신호
- `config`: `{ type: 'config', indexUrl: string }` — 인덱스 URL 설정
- `query`: `{ type: 'query', q: string, limit?: number, page?: number }` — 전역 검색 실행
- `check`: `{ type: 'check', id: string }` — 절 ID 존재 여부 확인
- `chapters` (신규): `{ type: 'chapters', book: string }` — 특정 책의 실제 장 번호 목록 요청

### 응답 메시지

- `ready`: `{ type: 'ready' }`
- `results`: `{ type: 'results', q, results, page, total, pageSize }`
- `checkResult`: `{ type: 'checkResult', id, ok: boolean, href?: string|null }`
- `chapters` (신규): `{ type: 'chapters', book: string, chapters: number[] }`
- `error`: `{ type: 'error', message: string }`

### 동작 상세

- 인덱스를 최초 한 번만 지연 로드하여 메모리에 유지한다.
- `chapters` 요청 시, 인덱스 항목의 `{ b: 약칭, c: 장 }`를 수집·정렬하여 반환한다.
- 동일 책의 장 목록은 내부 메모이제이션 캐시에 보관하여 반복 요청 비용을 줄인다.

## 📋 사용 예시

### 기본 파이프라인

```python
# 1. 파싱
parser = BibleParser('data/book_mappings.json')
chapters = parser.parse_file_with_cache('data/common-bible-kr.txt', 'output/parsed_bible.json')

# 2. HTML 생성
generator = HtmlGenerator('templates/chapter.html')
html_content = generator.generate_chapter_html(chapters[0])

# (선택) Publisher를 사용해 게시/상태 변경 수행
```

### JavaScript 검색

```javascript
// 전역 API 사용 예시
BibleNavigator.searchByText("한처음에");
BibleNavigator.highlightVerse("창세-1-3");
```
