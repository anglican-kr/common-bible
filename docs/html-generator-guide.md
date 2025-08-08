# HTML 생성기 사용 가이드

공동번역성서 프로젝트의 HTML 생성기 모듈에 대한 완전한 사용 설명서입니다.

## 📋 목차

1. [개요](#개요)
2. [모듈 구조](#모듈-구조)
3. [데이터 구조](#데이터-구조)
4. [사용법](#사용법)
5. [템플릿 시스템](#템플릿-시스템)
6. [접근성 기능](#접근성-기능)
7. [정적 자원](#정적-자원)
8. [실제 사용 예시](#실제-사용-예시)
9. [고급 사용법](#고급-사용법)
10. [문제 해결](#문제-해결)

## 📖 개요

HTML 생성기(`src/html_generator.py`)는 파서에서 생성된 구조화된 성경 데이터를 웹에서 읽기 쉽고 접근성이 뛰어난 HTML 문서로 변환하는 모듈입니다.

### 🎯 주요 목표

-   **접근성 우선**: 시각 장애인과 비장애인 모두 사용 가능
-   **검색 가능**: 절 ID 및 텍스트 검색 지원
-   **오디오 통합**: 음성 성경 재생 기능
-   **반응형 디자인**: 모든 기기에서 최적화된 표시
-   **텍스트 충실성**: 연속된 공백 문자 등 원본 서식 유지

## 🏗️ 모듈 구조

### HtmlGenerator 클래스

```python
class HtmlGenerator:
    def __init__(self, template_path: str)
    def generate_chapter_html(
        self,
        chapter: Chapter,
        audio_base_url: str = "data/audio",
        static_base: str = "../static",
        audio_check_base: Optional[str] = None,
    ) -> str
    def _generate_verses_html(self, chapter: Chapter) -> str
    def _generate_verse_span(self, chapter: Chapter, verse: Verse) -> str
    def _get_audio_filename(self, chapter: Chapter) -> str
    def _check_audio_exists(self, audio_path: str) -> bool
```

### 주요 메서드 설명

#### `__init__(template_path: str)`

HTML 템플릿 파일을 로드하여 생성기를 초기화합니다.

```python
generator = HtmlGenerator('templates/chapter.html')
```

#### `generate_chapter_html(chapter: Chapter, audio_base_url: str = "data/audio", static_base: str = "../static", audio_check_base: Optional[str] = None) -> str`

장 데이터를 완전한 HTML 문서로 변환합니다.

**매개변수:**

-   `chapter`: 변환할 장 데이터 (Chapter 객체)
-   `audio_base_url`: 오디오 파일 기본 경로/URL. CLI 기본값은 출력 디렉터리를 기준으로 자동 보정됨
-   `static_base`: 정적 리소스(CSS/JS) 기본 경로/URL. CLI 기본값은 출력 디렉터리를 기준으로 자동 보정됨
-   `audio_check_base`: 오디오 존재 여부 확인 시 사용할 파일시스템 기준 경로(원격 URL일 때는 생략)

**반환값:**

-   완전한 HTML 문서 문자열

## 📊 데이터 구조

### 입력 데이터

HTML 생성기는 `parser.py`에서 생성된 다음 구조를 사용합니다:

```python
@dataclass
class Verse:
    number: int           # 절 번호
    text: str            # 절 텍스트 (¶ 기호 포함)
    has_paragraph: bool  # 단락 시작 여부

@dataclass
class Chapter:
    book_name: str       # 책 이름 (예: "창세기")
    book_abbr: str       # 책 약칭 (예: "창세")
    chapter_number: int  # 장 번호
    verses: List[Verse]  # 절 목록
```

### 출력 데이터

생성되는 HTML의 핵심 구조:

```html
<article id="창세-1">
    <h1>창세기 1장</h1>
    <p>
        <span id="창세-1-1">
            <span aria-hidden="true" class="verse-number">1</span>
            <span class="paragraph-marker" aria-hidden="true">¶</span>
            한처음에 하느님께서 하늘과 땅을 지어내셨다.
        </span>
    </p>
</article>
```

## 🚀 사용법

### 1. 기본 사용법

```python
from src.html_generator import HtmlGenerator
from src.parser import BibleParser

# 1. 파서로 데이터 로드
parser = BibleParser('data/book_mappings.json')
chapters = parser.parse_file_with_cache('data/common-bible-kr.txt')

# 2. HTML 생성기 초기화
generator = HtmlGenerator('templates/chapter.html')

# 3. HTML 생성 (영문 파일명으로 저장)
for chapter in chapters[:5]:  # 처음 5개 장만
    html_content = generator.generate_chapter_html(chapter)

    # 파일 저장 (예: genesis-1.html)
    slug = generator._get_book_slug(chapter.book_abbr)
    filename = f"{slug}-{chapter.chapter_number}.html"
    with open(f"output/html/{filename}", 'w', encoding='utf-8') as f:
        f.write(html_content)
```

### 2. 명령줄 사용법

사전 준비: 먼저 파서로 JSON 파일을 생성합니다.

```bash
# 파서 실행 → JSON 생성
python src/parser.py data/common-bible-kr.txt --save-json output/parsed_bible.json
```

이후, 생성된 JSON을 입력으로 HTML을 만듭니다. (기본 JSON 경로는 `output/parsed_bible.json`)

```bash
# 전체 생성 (모든 책의 모든 장)
python src/html_generator.py templates/chapter.html output/html/

# 특정 책만 생성 (예: 창세)
python src/html_generator.py templates/chapter.html output/html/ --book 창세

# 특정 장만 생성 (콤마/구간 혼합 가능: 1,2,5-7)
python src/html_generator.py templates/chapter.html output/html/ --chapters 1,2,5-7

# 최대 생성 개수 제한 (디버깅/부분 생성)
python src/html_generator.py templates/chapter.html output/html/ --limit 20

# 오디오 기본 경로(또는 CDN) 변경
python src/html_generator.py templates/chapter.html output/html/ --audio-base https://cdn.example.com/audio

# JSON 경로를 직접 지정 (기본: output/parsed_bible.json)
python src/html_generator.py templates/chapter.html output/html/ --json output/parsed_bible.json

# 정적 리소스(CSS/JS) 기본 경로 지정 (기본: 자동 보정)
python src/html_generator.py templates/chapter.html output/html/ --static-base ../static

# 정적/오디오 자원을 출력 디렉터리에도 복사(로컬 번들 시 편리)
python src/html_generator.py templates/chapter.html output/html/ --copy-static --copy-audio
```

지원 옵션 요약:

-   `--json`: 파서 출력 JSON 경로 (기본: `output/parsed_bible.json`)
-   `--book`: 특정 책 약칭만 생성 (미지정 시 모든 책 대상)
-   `--chapters`: 생성할 장 번호 목록/구간 (예: `1,3,5-7`)
-   `--limit`: 최종 생성할 장 수 상한
-   `--audio-base`: 오디오 파일 기본 경로/URL (미지정 시 출력 디렉터리 기준 자동 보정)
-   `--static-base`: 정적 리소스(CSS/JS) 기본 경로/URL (템플릿의 `${static_base}`로 주입, 미지정 시 자동 보정)
-   `--copy-static`: `static/` 디렉터리를 출력 디렉터리로 복사
-   `--copy-audio`: `data/audio/` 디렉터리를 출력 디렉터리로 복사

### 3. 커스텀 오디오 경로

```python
# 다른 오디오 경로 사용
html_content = generator.generate_chapter_html(
    chapter,
    audio_base_url="https://example.com/audio"
)
```

## 🎨 템플릿 시스템

### 템플릿 변수

HTML 템플릿(`templates/chapter.html`)에서 사용되는 변수들:

| 변수명                 | 설명                             | 예시                                    |
| ---------------------- | -------------------------------- | --------------------------------------- |
| `${book_name}`         | 책 이름                          | "창세기"                                |
| `${chapter_number}`    | 장 번호                          | 1                                       |
| `${chapter_id}`        | 장 고유 ID                       | "창세-1"                                |
| `${verses_content}`    | 절 HTML 내용                     | `<p><span id="창세-1-1">...</span></p>` |
| `${audio_path}`        | 오디오 파일 경로                 | "data/audio/genesis-1.mp3"              |
| `${audio_title}`       | 오디오 접근성 제목               | "창세기 1장 오디오"                     |
| `${static_base}`       | 정적 리소스 기본 경로            | "../static" 또는 절대 URL               |
| `${alias_data_script}` | 별칭/슬러그 데이터 주입 스크립트 | `<script>window.BIBLE_ALIAS=...`        |

### 템플릿 커스터마이징

기본 템플릿을 복사하여 수정할 수 있습니다:

```bash
cp templates/chapter.html templates/custom-chapter.html
# custom-chapter.html 편집 후

python src/html_generator.py templates/custom-chapter.html output/
```

## ♿️ 접근성 기능

### 1. ARIA 속성

```html
<!-- 절 번호 - 스크린리더에서 숨김 -->
<span aria-hidden="true" class="verse-number">1</span>

<!-- 단락 기호 - 스크린리더에서 숨김 -->
<span class="paragraph-marker" aria-hidden="true">¶</span>

<!-- 검색 폼 - 역할 명시 -->
<form role="search" aria-label="성경 구절 검색"></form>
```

### 2. 고유 ID 시스템

각 절은 고유한 ID를 가집니다:

-   형식: `{책약칭}-{장번호}-{절번호}`
-   예시: `창세-1-1`, `마태-5-3`

### 3. 스크린리더 최적화

-   절 번호와 단락 기호는 시각적으로만 표시
-   스크린리더는 순수한 텍스트만 읽음
-   적절한 heading 구조 (h1, h2)

## 🎵 정적 자원

### CSS 스타일시트 (`static/verse-style.css`)

주요 기능:

-   **반응형 디자인**: 모바일/데스크톱 대응
-   **접근성 스타일**: 고대비, 포커스 표시
-   **인쇄 최적화**: 불필요한 요소 숨김
-   **검색 하이라이트**: 검색 결과 강조
-   **텍스트 서식 유지**: 연속 공백 문자 보존

```css
/* 절 하이라이트 */
.verse-highlight {
    background-color: #fff3cd !important;
    border-left: 4px solid #ffc107;
}

/* 텍스트 검색 하이라이트 */
.text-highlight {
    background-color: #ffeb3b;
    font-weight: bold;
}

/* 성경 본문 단락 - 연속 공백 문자 유지 */
.scripture-paragraph {
    white-space: pre-wrap;
    margin: 1.5em 0;
    text-align: justify;
    line-height: 1.8;
}
```

### JavaScript (`static/verse-navigator.js`)

주요 기능:

-   **절 검색**: `창세 1:3` 형식 검색(교차 책/장 이동 지원)
-   **별칭 지원**: `data/book_mappings.json`의 `aliases`를 HTML에 주입하여 다양한 호칭 인식
-   **텍스트 검색**: 단어/구문 검색
-   **하이라이트**: 검색 결과 강조
-   **키보드 네비게이션**: ESC로 하이라이트 해제

```javascript
// 전역 API
window.BibleNavigator = {
    highlightVerse: function(verseId),
    clearHighlight: function(),
    searchByText: function(query)
};
```

## 💡 실제 사용 예시

### 예시 1: 단일 장 HTML 생성

```python
from src.html_generator import HtmlGenerator
from src.parser import BibleParser

# 설정
parser = BibleParser('data/book_mappings.json')
generator = HtmlGenerator('templates/chapter.html')

# 특정 장 찾기
chapters = parser.load_from_json('output/parsed_bible.json')
genesis_1 = None
for chapter in chapters:
    if chapter.book_abbr == "창세" and chapter.chapter_number == 1:
        genesis_1 = chapter
        break

# HTML 생성
if genesis_1:
    html = generator.generate_chapter_html(genesis_1, static_base="../static")
    with open('genesis-1.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("창세기 1장 HTML 생성 완료!")

# 결과: <p class="scripture-paragraph">으로 감싸진 본문에서
#       연속된 공백이 그대로 유지됨
```

### 예시 2: 특정 책 전체 생성

```python
import os
from src.html_generator import HtmlGenerator
from src.parser import BibleParser

def generate_book_html(book_abbr, output_dir):
    parser = BibleParser('data/book_mappings.json')
    generator = HtmlGenerator('templates/chapter.html')
    chapters = parser.load_from_json('output/parsed_bible.json')

# 출력 디렉토리 생성
slug = generator._get_book_slug(book_abbr)
book_dir = os.path.join(output_dir, slug)
os.makedirs(book_dir, exist_ok=True)

    # 해당 책의 모든 장 생성
    book_chapters = [c for c in chapters if c.book_abbr == book_abbr]

    for chapter in book_chapters:
        html = generator.generate_chapter_html(chapter, static_base="../static")
        slug = generator._get_book_slug(chapter.book_abbr)
        filename = f"{slug}-{chapter.chapter_number}.html"
        filepath = os.path.join(book_dir, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(html)

        print(f"생성됨: {chapter.book_name} {chapter.chapter_number}장")

# 사용
generate_book_html("창세", "output/html")
generate_book_html("마태", "output/html")
```

### 예시 3: 배치 생성 스크립트

```python
import os
import time
from src.html_generator import HtmlGenerator
from src.parser import BibleParser

def batch_generate_html(start_index=0, batch_size=50):
    """배치 단위로 HTML 생성"""
    parser = BibleParser('data/book_mappings.json')
    generator = HtmlGenerator('templates/chapter.html')
    chapters = parser.load_from_json('output/parsed_bible.json')

    total_chapters = len(chapters)
    end_index = min(start_index + batch_size, total_chapters)

    print(f"HTML 배치 생성: {start_index+1}~{end_index}/{total_chapters}")

    for i in range(start_index, end_index):
        chapter = chapters[i]

        try:
            html = generator.generate_chapter_html(chapter, static_base="../static")
            slug = generator._get_book_slug(chapter.book_abbr)
            filename = f"{slug}-{chapter.chapter_number}.html"
            filepath = os.path.join("output/html", filename)

            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(html)

            print(f"[{i+1:4d}/{total_chapters}] {chapter.book_name} {chapter.chapter_number}장")

        except Exception as e:
            print(f"❌ 오류: {chapter.book_name} {chapter.chapter_number}장 - {e}")

        # CPU 부하 방지
        time.sleep(0.01)

# 사용
batch_generate_html(0, 100)    # 처음 100개 장
batch_generate_html(100, 100)  # 다음 100개 장
```

## 🔧 고급 사용법

### 1. 커스텀 오디오 파일명 매핑

기본 오디오 파일명 규칙을 변경하려면:

```python
class CustomHtmlGenerator(HtmlGenerator):
    def _get_audio_filename(self, chapter: Chapter) -> str:
        # 커스텀 파일명 규칙
        book_code = self._get_book_code(chapter.book_abbr)
        return f"bible-{book_code}-ch{chapter.chapter_number:02d}.mp3"

    def _get_book_code(self, book_abbr: str) -> str:
        # 커스텀 책 코드 매핑
        codes = {
            "창세": "GEN",
            "출애": "EXO",
            "마태": "MAT",
            # ... 추가 매핑
        }
        return codes.get(book_abbr, book_abbr.upper())
```

### 2. 다국어 템플릿

영문 템플릿 예시:

```html
<!-- templates/chapter-en.html -->
<title>${book_name} Chapter ${chapter_number}</title>
<h1>${book_name} Chapter ${chapter_number}</h1>
<input placeholder="Search verse (e.g., ${book_name} ${chapter_number}:3)" />
```

### 3. 배포용 최적화

```python
def generate_production_html(chapter: Chapter) -> str:
    """배포용 최적화된 HTML 생성"""
    generator = HtmlGenerator('templates/chapter-min.html')

    # CDN 경로 사용
    html = generator.generate_chapter_html(
        chapter,
        audio_base_url="https://cdn.example.com/audio"
    )

    # 불필요한 공백 제거
    import re
    html = re.sub(r'\s+', ' ', html)
    html = re.sub(r'>\s+<', '><', html)

    return html
```

## 🛠️ 문제 해결

### 자주 발생하는 문제들

#### 1. 템플릿 오류

```
Error: Invalid placeholder in string: line 21, col 76
```

**원인**: 템플릿에 Python String Template 형식에 맞지 않는 `$` 문자
**해결**: `$` 문자를 `$$`로 이스케이프하거나 제거

#### 2. 파일 경로 오류

```
FileNotFoundError: [Errno 2] No such file or directory: 'templates/chapter.html'
```

**원인**: 템플릿 파일 경로가 잘못됨
**해결**:

```python
import os
template_path = os.path.abspath('templates/chapter.html')
generator = HtmlGenerator(template_path)
```

#### 3. 인코딩 문제

```
UnicodeEncodeError: 'ascii' codec can't encode characters
```

**원인**: 한글 텍스트 인코딩 문제
**해결**:

```python
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(html)
```

#### 4. 메모리 부족

대량의 장을 한 번에 처리할 때 메모리 부족 발생

**해결**:

```python
# 배치 처리 사용
for i in range(0, len(chapters), 100):
    batch = chapters[i:i+100]
    process_batch(batch)
    # 메모리 정리
    del batch
```

### 디버깅 팁

#### 1. 생성된 HTML 검증

```python
from html.parser import HTMLParser

class HTMLValidator(HTMLParser):
    def error(self, message):
        print(f"HTML 오류: {message}")

# 사용
validator = HTMLValidator()
validator.feed(html_content)
```

#### 2. 템플릿 변수 확인

```python
def debug_template_vars(chapter: Chapter):
    print(f"책 이름: {chapter.book_name}")
    print(f"장 번호: {chapter.chapter_number}")
    print(f"절 개수: {len(chapter.verses)}")
    print(f"첫 절: {chapter.verses[0].text[:50]}...")
```

#### 3. 로깅 활성화

```python
import logging

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# HtmlGenerator 클래스에 로깅 추가
def generate_chapter_html(self, chapter: Chapter, audio_base_url: str = "data/audio") -> str:
    logger.debug(f"HTML 생성 시작: {chapter.book_name} {chapter.chapter_number}장")
    # ... 기존 코드
    logger.debug(f"HTML 생성 완료: {len(html)} 문자")
    return html
```

## 📚 관련 문서

-   [파서 사용 가이드](parser-usage-guide.md) - 입력 데이터 준비
-   [설계 명세서](design-specification.md) - 전체 시스템 구조
-   [요구사항 문서](requirements.md) - 프로젝트 요구사항

## 🤝 기여하기

HTML 생성기 개선에 기여하고 싶다면:

1. **새로운 템플릿 기능** 제안
2. **접근성 개선사항** 제안
3. **성능 최적화** 제안
4. **버그 리포트** 및 수정

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.
