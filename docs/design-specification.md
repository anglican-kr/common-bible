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
│   ├── parser.py           # 텍스트 파일 파싱 및 JSON 저장/로드, 캐시 지원
│   ├── html_generator.py   # HTML 생성 (접근성/오디오/정적자원 경로 주입, CLI 포함)
│   ├── wordpress_api.py    # WordPress REST API 클라이언트
│   ├── main.py             # 메인 실행 파일
│   └── config.py           # 설정 관리(환경변수 로드) - 선택적 사용
├── templates/
│   └── chapter.html        # HTML 템플릿 (String Template 변수 사용)
├── static/
│   ├── verse-style.css     # 스타일시트 (기본 글꼴 Pretendard)
│   └── verse-navigator.js  # 검색/하이라이트/오디오 초기화 스크립트
├── data/
│   ├── common-bible-kr.txt # 원본 텍스트
│   ├── audio/              # 오디오 파일 디렉토리 (*.mp3)
│   └── book_mappings.json  # 성경 책 이름/별칭 매핑
├── output/                 # 파서/생성기 출력 디렉터리
├── logs/                   # 로그 파일 (필요 시)
├── .env.example            # 환경변수 예제 (선택)
├── requirements.txt        # Python 패키지 목록
└── README.md               # 프로젝트 설명서
```

---

## 🔧 핵심 모듈 설계

### 1. 텍스트 파서 (parser.py)

요구사항([requirements.md](./requirements.md))에 맞춘 파서 설계입니다. 장 식별, 첫 절 포함 라인 처리, 단락(`¶`) 인식, JSON 캐시, CLI를 포함합니다.

#### 1.1 입력 포맷 규칙 요약

- 장 시작 패턴: `([가-힣0-9]+)\s+([0-9]+):([0-9]+)\s*(.*)?`
  - 예: `창세 1:1 ¶ 한처음에...` (첫 절 내용이 같은 줄에 등장)
- 두 번째 줄부터: `^([0-9]+)\s+(.*)$`
- 단락 구분: `¶`가 새 단락 시작을 의미

#### 1.2 데이터 모델

- `Verse { number: int, text: str, has_paragraph: bool }`
- `Chapter { book_name: str, book_abbr: str, chapter_number: int, verses: List[Verse] }`
- 확장 계획(옵션): `VersePart`(a/b 분절) 지원. 현재는 HTML 단계에서 단락 시각 처리를 수행하며, 미래 확장에서 `창세-1-4a/4b` 고유 ID 분절까지 지원할 수 있도록 스키마 확장 가능.

#### 1.3 파싱 알고리즘

1. 파일을 줄 단위로 순회
2. 장 시작 정규식 매칭 시 현재 장을 종료/저장하고 새 장을 시작
   - 같은 줄의 첫 절 텍스트가 존재하면 `number=1`로 생성하고 `has_paragraph`는 텍스트 내 `¶` 여부로 설정
3. 일반 절 라인은 숫자+공백 패턴으로 파싱
4. 파일 종료 시 마지막 장을 저장

에지 케이스

- 빈 줄은 무시 (장 구분은 오직 패턴으로 수행)
- 잘못된 라인은 스킵 (로그로 보고)
- 책 약칭 매핑이 없으면 원문 약칭 그대로 사용

#### 1.4 정규식

- 장: `r"^([가-힣0-9]+)\s+([0-9]+):([0-9]+)\s*(.*)?$"`
- 절: `r"^([0-9]+)\s+(.*)$"`

#### 1.5 JSON 캐시/스키마

- 출력: `output/parsed_bible.json`
- 스키마(요약):
  - `chapters[]` 배열, 각 원소는 `Chapter` 직렬화
  - 파일 크기 최적화를 위해 책 매핑(약칭→전체/영문)은 별도 `data/book_mappings.json` 활용

#### 1.6 인터페이스(요약)

```python
class BibleParser:
    def __init__(self, book_mappings_path: str): ...
    def parse_file(self, file_path: str) -> list[Chapter]: ...
    def save_to_json(self, chapters: list[Chapter], path: str) -> None: ...
    def load_from_json(self, path: str) -> list[Chapter]: ...
    # 내부 유틸: _load_book_mappings, _get_full_book_name, _get_english_book_name, _parse_verse_line
```

#### 1.7 CLI

```bash
python src/parser.py data/common-bible-kr.txt \
  --save-json output/parsed_bible.json \
  --book-mappings data/book_mappings.json
```

옵션: `--save-json`, `--book-filter`, `--chapter-range`, `--strict`(형식 오류 시 실패), `--log-level` 등 확장 가능.

#### 1.8 테스트 항목(요약)

- 장 식별/첫 절 동일 라인 파싱
- 절 번호/본문 분리, `¶` 인식
- 장 종료 처리(파일 끝 포함)
- 매핑 누락 시 폴백 동작
- JSON 저장/로드 일관성

### 2. HTML 생성기 (html_generator.py)

접근성/검색/오디오/정적 리소스 처리를 포함한 HTML 변환기 설계입니다.

#### 2.1 동작

- 절 ID/접근성 마크업 생성(절번호/¶ 시각 표시, 스크린리더 숨김)
- 단락 그룹화(¶ 기준) 및 시맨틱 `<p>` 구성
- 오디오 파일 경로 생성 및 존재 여부에 따른 UI 토글
- 책 별칭/슬러그 데이터 `window.BIBLE_ALIAS` 주입
- 약칭/정렬은 `data/book_mappings.json`의 순서를 단일 기준으로 사용(외경 포함)
- CSS/JS 링크 주입(옵션) 또는 차일드 테마 enqueue 연동
- 전역 검색 인덱스 생성 지원: 기본 활성화(비활성화는 `--no-emit-search-index`). 전체 절 텍스트/앵커/정렬 메타를 단일 JSON으로 출력

#### 2.2 인터페이스(요약)

```python
class HtmlGenerator:
    def __init__(self, template_path: str): ...
    def generate_chapter_html(
        self,
        chapter: Chapter,
        audio_base_url: str = "data/audio",
        static_base: str = "../static",
        audio_check_base: Optional[str] = None,
        css_href: Optional[str] = None,
        js_src: Optional[str] = None,
    ) -> str: ...
    # 내부 유틸: _generate_verses_html, _generate_verse_span, _get_book_slug, _check_audio_exists
```

#### 2.3 템플릿 변수

- `${book_name}`, `${chapter_number}`, `${chapter_id}`
- `${verses_content}`: 본문
- `${audio_path}`, `${audio_title}`
- `${alias_data_script}`: 별칭 주입 스크립트
- `${css_link_tag}`, `${js_script_tag}`: 선택적 링크/스크립트 삽입 슬롯

#### 2.4 오디오 처리

- 파일명 규칙: `{english_slug}-{chapter}.mp3`
- 존재 확인: `audio_check_base`가 파일시스템 경로면 실존 확인, URL이면 존재로 간주
- UI 토글: 존재 시 `#audio-unavailable` 숨김, 부재 시 `#audio-container` 숨김

#### 2.5 단락/ID 규칙

- 절 ID: `{약칭}-{장}-{절}` (예: `창세-1-3`)
- 단락 시작(`has_paragraph=True`) 시 이전 절 묶음을 종료하고 새 `<p>`를 시작
- 미래 확장: 단일 절 내 `¶`에 의한 a/b 분절 ID(`-4a`, `-4b`) 지원 가능(현 버전은 시각 표시만)

#### 2.6 CSS/JS 주입 모드

- 테마 모드(권장, 기본): 차일드 테마 `functions.php`에서 enqueue → `css_href/js_src` 미지정
- 링크 주입 모드: CLI로 `--css-href`, `--js-src` 지정하여 본문에 직접 삽입
  - 로컬 미리보기: `--copy-static`과 함께 `./static/...` 상대 경로 사용
  - 워드프레스 게시: 절대 URL 또는 사이트 루트 경로 권장

#### 2.7 CLI(요약)

```bash
python src/html_generator.py templates/chapter.html output/html/ \
  --json output/parsed_bible.json \
  --book 창세 --chapters 1,2,3 --limit 50 \
  --audio-base data/audio --static-base ../static \
  --copy-static --copy-audio \
  --css-href ./static/verse-style.css --js-src ./static/verse-navigator.js
  # 전역 검색 인덱스는 기본 생성됨
  # 비활성화하려면 --no-emit-search-index 사용
  --search-index-out output/html/static/search/search-index.json
```

#### 2.8 테스트 항목(요약)

- 절 span 생성(접근성 속성 포함)
- 단락 그룹화(`<p>` 개수/경계)
- 오디오 파일명/존재 여부에 따른 토글
- CSS/JS 링크 주입 유무 및 값 검증

### 3. WordPress 게시 모듈 (wordpress_api.py)

요구사항([requirements.md](./requirements.md))을 충족하는 게시 모듈을 설계합니다. 책임은 다음과 같습니다.

- 정책 리소스 업로드(CSS, mp3)와 중복 방지
- 게시용 HTML 업로드(비공개 상태, 태그/카테고리 부여)
- 이미 업로드된 리소스를 HTML에서 참조하도록 링크 재작성
- 모든 API 호출의 타임아웃/재시도/로깅

#### 3.1 아키텍처 개요

- `WordPressClient`: REST API 호출 래퍼(인증/재시도/오류 처리)
- `AssetRegistry`: 로컬 파일 ↔️ WP 미디어 매핑 인덱스(JSON)
- `Publisher`: 리소스 보장(ensure) + HTML 게시 오케스트레이션
- 데이터 모델
  - `AssetRecord`: `{ slug, sha256, wp_media_id, source_url, mime_type, uploaded_at }`
  - `ChapterPostMeta`: `{ book_name, book_abbr, english_name, division, chapter_number }`

파일 배치:

- `src/wordpress_api.py`: 위 클래스/함수 구현
- `output/wp_asset_index.json`: 자산 인덱스 파일(자동 생성/갱신)

#### 3.2 리소스 업로드 정책(CSS, mp3)

- 대상
  - CSS: `static/verse-style.css`
  - 오디오: `data/audio/{english_book_slug}-{chapter}.mp3`
- 식별자
  - 콘텐츠 기반 식별: `sha256(file)`
  - 파일 슬러그 규칙
    - CSS: `verse-style-{hash8}.css` (캐시 무효화 목적, 내용 변경 시 파일명 변경)
    - mp3: `{english_book_slug}-{chapter}.mp3`
- 업로드 결정 로직
  1. `AssetRegistry`에 레코드가 있고 `sha256` 동일하며, `wp_media_id`가 유효하고 `source_url`이 200이면 업로드 생략
  2. 레코드가 없거나 `sha256` 변경
     - CSS: 새 파일명 `verse-style-{hash8}.css`로 업로드
     - mp3: 동일 슬러그가 이미 존재하고 내용이 다르면 새 파일명 `{slug}-{hash8}.mp3`로 업로드(기존 보존)
  3. 서버 측 중복 확인: `GET /wp-json/wp/v2/media?search={slug}&per_page=100`로 슬러그 후보 조회 후 정확 슬러그 일치 항목을 선택
- 업로드 구현
  - `POST /wp-json/wp/v2/media` (multipart/form-data, 헤더 `Content-Disposition: attachment; filename="{filename}"`)
  - 응답의 `id`, `source_url`, `mime_type`로 `AssetRegistry` 갱신
- 메타 저장
  - 별도 서버 설정 없이 동작하도록, 파일 해시는 `description`(또는 `caption`)에 접두어로 저장: `cb:sha256={hex}`
  - 검색성은 낮지만 인덱스 복구 시 참고 가능

#### 3.3 HTML 업로드(게시물 생성/갱신)

- 입력: 장별 HTML 문자열 또는 파일 경로, `ChapterPostMeta`
- 사전 처리(링크 재작성)
  - `<link rel="stylesheet" href="...verse-style.css">` → 업로드된 CSS의 `source_url`
  - `<audio>`/`<source>`의 `src` → 해당 장 mp3 `source_url`(없으면 대체 블록 유지)
- 게시물 필드
  - 제목: `{책이름} {장}장` (예: `창세기 1장`)
  - 슬러그: `{english_book_slug}-{chapter}` (예: `genesis-1`)
  - 상태: `private` (초기 비공개)
  - 카테고리: `공동번역성서` 1개
  - 태그: 3단계 태그 체계
    - 기본: `공동번역성서`
    - 구분: `구약`/`외경`/`신약`
    - 책 이름: 전체 이름(예: `창세기`)
- 용어 보장(존재하면 재사용, 없으면 생성)
  - `GET/POST /wp-json/wp/v2/categories`
  - `GET/POST /wp-json/wp/v2/tags`
- 게시물 생성/갱신(idempotent)
  - 동일 슬러그 게시물이 존재하면 `PUT /wp-json/wp/v2/posts/{id}`로 콘텐츠/카테고리/태그 갱신
  - 없으면 `POST /wp-json/wp/v2/posts`

#### 3.4 클래스/메서드 인터페이스(요약)

```python
class WordPressClient:
    def upload_media_from_path(self, file_path: str, desired_slug: str, mime_hint: str) -> AssetRecord: ...
    def find_media_by_slug(self, slug: str) -> Optional[AssetRecord]: ...
    def ensure_category(self, name: str) -> int: ...  # returns term_id
    def ensure_tag(self, name: str) -> int: ...
    def create_or_update_post(self, slug: str, title: str, content_html: str,
                              status: str, category_ids: list[int], tag_ids: list[int]) -> int: ...
    def update_post_status(self, post_id: int, status: str, scheduled_iso: Optional[str] = None) -> int: ...
    def list_posts(self, status: str, category_id: Optional[int] = None,
                   tag_ids: Optional[list[int]] = None, slug_prefix: Optional[str] = None,
                   per_page: int = 100, page: int = 1) -> list[dict]: ...

class AssetRegistry:
    def load(self, path: str = "output/wp_asset_index.json") -> None: ...
    def save(self) -> None: ...
    def get(self, local_path: str) -> Optional[AssetRecord]: ...
    def upsert(self, local_path: str, record: AssetRecord) -> None: ...

class Publisher:
    def ensure_policy_assets(self, css_path: str) -> AssetRecord: ...
    def ensure_audio_asset(self, english_book_slug: str, chapter: int, local_audio_path: str) -> Optional[AssetRecord]: ...
    def render_and_publish_chapter(self, html_path: str, meta: ChapterPostMeta) -> int: ...
    def bulk_update_status(self, target_status: str, *,
                           category: str = "공동번역성서",
                           division_tag: Optional[str] = None,
                           slug_prefix: Optional[str] = None,
                           scheduled_iso: Optional[str] = None,
                           dry_run: bool = False,
                           per_page: int = 100) -> dict: ...
```

구현 세부(요약)

- 인증: Application Password(HTTPS Basic) 사용
- 타임아웃: 5초, 재시도: 최대 3회(지수 백오프 0.5s, 1s, 2s), 4xx는 즉시 실패, 429/5xx는 재시도
- 로깅: 요청 메서드/URL/상태코드/소요시간 및 요약 응답(JSON), 인증정보 마스킹
- 입력 검증: 파일 존재/크기/확장자, HTML UTF-8 보장, 태그/카테고리 이름 유효성

#### 3.5 파일명/슬러그 규칙

- CSS: `verse-style-{hash8}.css` → 여러 버전 공존 가능, 최신 버전을 HTML에 연결
- mp3: 기본 `genesis-1.mp3` 등 고정 슬러그. 내용 변경 시 보존을 위해 `genesis-1-{hash8}.mp3` 새 업로드, HTML은 최신으로 갱신
- 정확한 매칭을 위해 업로드 전 슬러그 충돌 검사 및 필요 시 해시 접미어 부여

#### 3.6 보안/구성(.env)

- `WP_SITE_URL`, `WP_USERNAME`, `WP_PASSWORD`, `WP_DEFAULT_STATUS=private`
- 요청은 반드시 HTTPS
- 비밀정보는 절대 로그/레포지토리에 노출 금지

#### 3.7 게시물 상태 변경(공개/예약 공개)

- 목적: 초기 `private`로 생성된 장별 게시물을 일괄 `publish`(또는 지정 상태)로 전환
- 엔드포인트: `PUT /wp-json/wp/v2/posts/{id}` with body `{ status: "publish" }`
- 예약 공개: `date`(로컬) 또는 `date_gmt`(UTC ISO8601) 지정 시 워드프레스 예약 발행 동작 이용
- 검색/대상 선택 기준
  - 카테고리: `공동번역성서`
  - 태그: 선택적 `구분` 태그(`구약`/`외경`/`신약`)
  - 슬러그 접두사: 예) `genesis-`, `matthew-`
  - 현재 상태: 기본 `private`
- 처리 로직(일괄)
  1. 페이징으로 대상 수집(`list_posts`)
  2. 각 항목에 대해 `update_post_status` 호출
  3. 429/5xx 재시도, 4xx 즉시 실패 기록
  4. 드라이런(`dry_run=True`) 시 변경 없이 요약 보고서 반환
- 출력: `{ total, succeeded, failed, skipped, details: [...] }`

#### 3.8 테스트 항목(요약)

- 리소스 업로드: 최초 업로드/재실행 시 스킵/내용 변경 시 새 파일명 처리
- 미디어 조회 실패/네트워크 오류/타임아웃 재시도
- 태그/카테고리 ensure 로직(존재/미존재)
- 게시물 생성 vs 갱신(동일 슬러그)
- HTML 링크 재작성(CSS/audio) 및 오디오 미존재 시 대체 블록 유지
- 게시물 상태 변경(공개/예약 공개)

### 4. CLI 실행 (parser, html_generator)

별도 `main.py` 대신 각 모듈이 CLI를 제공합니다.

```bash
# 파서: 텍스트 → JSON (캐시/저장 지원)
python src/parser.py data/common-bible-kr.txt --save-json output/parsed_bible.json

# HTML 생성기: JSON → 장별 HTML (정적/오디오 경로 자동 보정, 복사 옵션)
python src/html_generator.py templates/chapter.html output/html/ \
  --json output/parsed_bible.json \
  --copy-static --copy-audio
```

#### 4.1 WordPress Publisher CLI (wordpress_api.py)

`src/wordpress_api.py`는 게시 오케스트레이션용 CLI를 제공합니다.

사용법 개요:

```bash
python src/wordpress_api.py <command> [options]
```

명령 목록:

- `ensure-assets`: 정책 리소스(CSS, mp3) 업로드/스킵 결정 및 인덱스 갱신
  - 옵션:
    - `--css static/verse-style.css` (필수)
    - `--audio-dir data/audio` (선택)
    - `--index output/wp_asset_index.json` (기본값 동일)
    - `--update-only` (이미 등록된 파일만 확인)
- `publish-chapter`: 단일 장 HTML 게시(없으면 생성, 있으면 갱신)
  - 옵션:
    - `--html output/html/genesis-1.html`
    - 메타 직접 지정: `--book-name 창세기 --book-abbr 창세 --english-name Genesis --division 구약 --chapter 1`
    - 혹은 메타 JSON: `--meta-json path/to/meta.json` (키: book_name, book_abbr, english_name, division, chapter_number)
    - `--status private` (기본)
    - `--index output/wp_asset_index.json`
    - `--dry-run`
- `publish-batch`: 디렉터리 내 모든 HTML 일괄 게시
  - 옵션:
    - `--html-dir output/html`
    - 필터: `--book-abbr 창세` `--from-chapter 1` `--to-chapter 50`
    - `--status private` (기본)
    - `--concurrency 3`
    - `--index output/wp_asset_index.json`
    - `--dry-run`
- `bulk-status`: 조건에 맞는 게시물 상태 일괄 변경(공개/비공개/초안/예약)
  - 옵션:
    - `--to publish|private|draft|pending`
    - `--category 공동번역성서` (기본값)
    - `--division-tag 구약|외경|신약` (선택)
    - `--slug-prefix genesis-` (선택)
    - `--schedule 2025-12-24T09:00:00Z` (선택, 예약 공개)
    - `--dry-run`
- `list-posts`: 조건에 맞는 게시물 나열(디버그용)
  - 옵션: `--status private --category 공동번역성서 --division-tag 구약 --slug-prefix genesis-`

예시:

```bash
# 1) 정책 리소스 보장(CSS/오디오 업로드 또는 스킵)
python src/wordpress_api.py ensure-assets --css static/verse-style.css --audio-dir data/audio

# 2) 단일 장 게시(비공개)
python src/wordpress_api.py publish-chapter \
  --html output/html/genesis-1.html \
  --book-name 창세기 --book-abbr 창세 --english-name Genesis --division 구약 --chapter 1

# 3) 일괄 게시(창세기 1~5장만)
python src/wordpress_api.py publish-batch --html-dir output/html --book-abbr 창세 --from-chapter 1 --to-chapter 5

# 4) 공개 전환(구약만, 드라이런)
python src/wordpress_api.py bulk-status --to publish --division-tag 구약 --dry-run

# 5) 12월 24일 09:00(UTC) 예약 공개
python src/wordpress_api.py bulk-status --to publish --schedule 2025-12-24T09:00:00Z
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

## 🔍 전역 검색 설계(단일 인덱스 + Web Worker)

### 개요

- 정적/워드프레스 공통으로 사용할 수 있는 전역 텍스트 검색
- 단일 인덱스 JSON을 Web Worker가 최초 쿼리 시 지연 로드하여 메인 스레드 부하 최소화

### 산출물

- `static/search-worker.js`: 인덱스 로드 및 검색 수행(Worker)
- `static/verse-navigator.js`: 검색 UI/로컬 검색 + 전역 검색 패널, Worker와 메시지 연동
- 인덱스 JSON(기본): `<output_dir>/static/search/search-index.json`
  - 포맷: `[{ "i": "창세-1-1", "t": "…", "h": "genesis-1.html#창세-1-1", "b": "창세", "c": 1, "v": 1, "bo": 0 }, ...]`

### 동작

1. 페이지 로드 시 `verse-navigator.js`가 Worker를 초기화(`init`)
2. Worker `ready` → `config`로 인덱스 URL 전달(자동 추정 또는 설정 주입)
3. 사용자가 단어 검색 제출 시
   - 현재 문서 내 로컬 검색 수행(기존)
   - 동시에 Worker에 `{ type: 'query', q, limit: 50 }` 전송
4. Worker는 최초 쿼리에서 인덱스를 fetch 후 선형 스캔 → 책/장/절 기준 정렬 → 요청 페이지 분량만 슬라이스하여 반환
5. 결과 패널에 스니펫을 하이라이트하여 표시. 하단에 이전/다음 버튼과 페이지 정보. 항목 클릭 시 `h`로 이동(해시 포함)

### 설정 주입(워드프레스/절대 경로 사용 시)

```html
<script>
  window.BIBLE_SEARCH_CONFIG = {
    workerUrl: "/wp-content/themes/child/assets/search-worker.js",
    searchIndexUrl: "/wp-content/uploads/common-bible/search/search-index.json",
  };
</script>
```

### 성능/모바일 고려

- 인덱스는 최초 쿼리 때만 로드(초기 다운로드 최소화)
- 검색/정렬/페이지네이션은 Worker에서 수행 → 메인 스레드는 결과 렌더만 담당
- 기본 50건/페이지, 스니펫 길이 제한(±40자)로 페인트 비용 절감

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

### 3. WordPress API 테스트

현재 저장소에는 WordPress 클라이언트가 포함되어 있지 않습니다. 게시 자동화 테스트는 별도 모듈이 추가된 이후에 구성하세요.

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

    def test_full_workflow(self, full_setup):
        """전체 워크플로우 테스트 (파싱 → HTML 생성)"""
        # 1. 파싱
        parser = BibleParser(full_setup['mappings_path'])
        chapters = parser.parse_file(full_setup['text_path'])

        # 2. HTML 생성
        html_generator = HtmlGenerator(full_setup['template_path'])
        html_content = html_generator.generate_chapter_html(chapters[0], static_base="../static")

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

- [ ] 텍스트 파일 파싱 (장/절/단락 구분)
- [ ] 접근성 HTML 생성 (aria-hidden, 고유 ID)
- [ ] 오디오 파일 통합 및 조건부 표시
- [ ] WordPress REST API 연동
- [ ] 카테고리/태그 자동 생성 및 관리
- [ ] 비공개 게시물로 생성
- [ ] 로깅 및 오류 처리
- [ ] 3단계 태그 시스템 (공동번역성서, 구분, 책이름)

---

이 설계는 요구사항에 충실하면서도 심플하고 실용적인 구조를 유지합니다. 필요에 따라 기능을 추가하거나 수정할 수 있는 유연성도 갖추고 있습니다.
