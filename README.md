# 공동번역성서 프로젝트

대한성공회 서울교구 홈페이지에 공동번역성서를 게시하는 작업을 위한 프로젝트입니다. 공동번역성서 개정판 원본 텍스트를 HTML로 변환하고, 워드프레스를 통해 접근성 친화적으로 자동 게시하고자 합니다.

이 프로젝트는 바이브코딩으로 얼마나 코딩이 가능한지 검증하는 사심 가득한 프로젝트로, 모든 문서와 코드는 바이브코딩으로 생성했습니다. 실제 공동번역성서 개정판의 저작권은 대한성서공회에 있으며, 이 프로젝트는 비상업적 용도로만 사용됩니다. 공동번역성서 개정판 텍스트를 요구하지 말아주세요.

## 🎯 프로젝트 목표

- 성경 텍스트를 장/절 단위로 파싱하여 구조화된 HTML로 변환
- 시각 장애인을 위한 웹 접근성 준수 (WCAG 2.1 AA)
- 워드프레스 REST API를 통한 자동 게시 (https://seoul.anglican.kr)
- 각 장별 오디오 파일 통합 및 접근성 강화된 오디오 플레이어 제공
- 절 번호 및 단어/문구 기반 검색 기능 제공

## 📋 주요 기능

### ✨ 텍스트 처리

- 공동번역성서 텍스트 파일 자동 파싱 (첫 번째 절 특수 처리 포함)
- 성경 책 이름 매핑 데이터 활용 (약칭 → 전체 이름, 구분 정보 포함)
- 장/절 단위 구조 분석 및 JSON 저장/로드 지원
- `¶` 기호 원본 보존 및 접근성 고려 HTML 변환
- 캐시 시스템으로 빠른 재실행 지원

### ♿️ 웹 접근성

- **이중 접근성**: 시각 사용자는 절 번호와 `¶` 기호를 보고, 스크린리더 사용자는 본문만 들음
- 절 번호와 단락 기호에 `aria-hidden="true"` 적용
- 각 절별 고유 ID를 통한 직접 링크 (`#창세-1-3`)
- 시맨틱 HTML 구조 (`<article>`, `<section>`)
- 키보드 네비게이션 지원
- 접근성 강화된 오디오 플레이어 (`aria-label`, 키보드 조작 지원)

### 🔊 오디오 통합

- 각 장별 오디오 파일 제공 (`data/audio/{book-name}-{chapter}.mp3`)
- 접근성을 갖춘 HTML5 오디오 플레이어
- 스크린리더를 통한 오디오 플레이어 접근 및 조작 지원
- 오디오 파일 미지원 시 대체 텍스트 및 다운로드 링크 제공

### 🔍 검색 기능

- 절 ID 기반 빠른 이동 (`창세 1:3`)
- 단어/문구 검색 지원 (검색 결과 목록화)
- URL 해시를 통한 직접 접근 (`#창세-1-3`)
- 하이라이트 효과로 시각적 피드백
- 스크린리더 사용자를 위한 검색 결과 접근성 지원
- 전역 검색(다른 문서 포함): Web Worker 기반, 책→장→절 정렬, 페이지네이션(기본 50건)
  - 인덱스 자동 생성(기본 활성화, 비활성화: `--no-emit-search-index`)
  - 경로가 다르면 설정 주입으로 지정 가능:
    ```html
    <script>
      window.BIBLE_SEARCH_CONFIG = {
        workerUrl: "/wp-content/themes/child/assets/search-worker.js",
        searchIndexUrl:
          "/wp-content/uploads/common-bible/search/search-index.json",
      };
    </script>
    ```

### 🚀 자동 게시 (설계/CLI 스켈레톤 완료)

- 워드프레스 REST API 연동 (https://seoul.anglican.kr)
- **자동 카테고리/태그 생성**: 없는 카테고리나 태그 자동 생성 후 ID 획득
- **3단계 태그 체계**: `공동번역성서` → `구약/외경/신약` → `책이름`
- 메타데이터 자동 설정 (제목, 슬러그, 태그, 카테고리)
- 비공개 상태 초기 업로드, 준비 완료 후 일괄/예약 공개 가능
- 오류 처리 및 재시도 로직, 미디어 업로드 중복 방지(SHA-256 기반)

## 🏗️ 프로젝트 구조

```
common-bible/
├── docs/                       # 📚 문서
│   ├── requirements.md         # 요구사항 명세
│   ├── design-specification.md # 상세 설계서
│   └── parser-usage-guide.md   # 파서 사용 가이드
├── src/                        # 💻 소스코드
│   ├── __init__.py             # 패키지 초기화
│   ├── parser.py               # ✅ 텍스트 파싱 엔진 (구현 완료)
│   ├── config.py               # ✅ 설정 관리 (구현 완료)
│   ├── html_generator.py       # 🚧 HTML 생성기 (구현 중)
│   ├── wordpress_api.py        # 🚧 워드프레스 API (구현 중)
│   └── main.py                 # 🚧 메인 실행 파일 (설계 완료)
├── templates/                  # 🎨 HTML 템플릿
│   └── chapter.html            # 기본 장 템플릿
├── static/                     # 🎨 정적 자원
│   ├── verse-style.css         # 스타일시트
│   ├── verse-navigator.js      # 검색/네비게이션 스크립트(전역 검색 패널 포함)
│   └── search-worker.js        # 전역 검색 Web Worker
├── data/                       # 📊 데이터 파일
│   ├── common-bible-kr.txt     # 원본 텍스트 (5.6MB)
│   ├── book_mappings.json      # 성경 책 이름 매핑 (73권)
│   ├── audio/                  # 오디오 파일 저장소
│   └── output/                 # 생성된 JSON/HTML
├── output/                     # 📁 파싱 결과 저장소
├── tests/                      # 🧪 테스트 (설계 완료)
├── logs/                       # 📋 로그 파일
├── env.example                 # ⚙️ 환경변수 예제
├── requirements.txt            # 📦 Python 의존성
└── README.md                   # 📖 프로젝트 가이드
```

전역 검색 인덱스(JSON)는 빌드 시 기본으로 생성되며, 기본 경로는 `output/html/static/search/search-index.json` 입니다.

## 📊 데이터 구조

### 성경 책 이름 매핑

프로젝트는 `data/book_mappings.json` 파일로 성경 책의 약칭을 전체 이름으로 변환하고 구분 정보를 관리합니다:

```json
{
  "약칭": "창세",
  "전체 이름": "창세기",
  "영문 이름": "Genesis",
  "구분": "구약"
}
```

**주요 특징:**

- 총 73권의 성경 책 매핑 데이터
- 구분 정보: `구약`, `외경`, `신약`
- 워드프레스 태그 자동 생성에 활용
- 변환 예시: `"창세 1:1"` → `"창세기 1장"`, `"2마카 2:1"` → `"마카베오하 2장"`

### 파싱된 데이터 구조

```json
{
  "book_name": "창세기",
  "book_abbr": "창세",
  "chapter_number": 1,
  "verses": [
    {
      "number": 1,
      "text": "¶ 한처음에 하느님께서 하늘과 땅을 지어내셨다.",
      "has_paragraph": true
    }
  ]
}
```

## 🚀 빠른 시작

### 1. 환경 설정

```bash
# 프로젝트 클론
git clone https://github.com/joshua-in-boots/common-bible.git
cd common-bible

# 가상환경 생성 및 활성화
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# 의존성 설치
pip install -r requirements.txt
```

### 2. 환경변수 설정 (선택사항)

```bash
# 환경변수 파일 생성 (워드프레스 게시용)
cp env.example .env

# .env 파일 편집 (필요시)
nano .env
```

환경변수 예시:

```env
# 워드프레스 설정
WP_SITE_URL=https://seoul.anglican.kr
WP_USERNAME=your_username
WP_PASSWORD=your_application_password
WP_BASE_CATEGORY=공동번역성서
WP_BASE_TAG=공동번역성서
WP_DEFAULT_STATUS=private
WP_TIMEOUT=30
```

### 3. 실행

```bash
# 📖 텍스트 파싱 (기본)
python src/parser.py data/common-bible-kr.txt

# 💾 JSON 저장
python src/parser.py data/common-bible-kr.txt --save-json output/bible_data.json

# ⚡ 캐시 사용 (빠른 재실행)
python src/parser.py data/common-bible-kr.txt --use-cache

# 📊 파싱 결과 확인
# 총 1382개 장, 31102개 절 파싱됨
# 창세기 1장: 31절 (첫 절 포함)
```

## 📖 사용법

### 파서 사용법

```python
from src.parser import BibleParser

# 1. 파서 초기화 (책 매핑 파일 로드)
parser = BibleParser('data/book_mappings.json')

# 2. 텍스트 파싱
chapters = parser.parse_file('data/common-bible-kr.txt')
print(f"총 {len(chapters)}개 장 파싱 완료")

# 3. JSON 저장
parser.save_to_json(chapters, 'output/parsed_bible.json')

# 4. JSON 로드 (재사용)
chapters = parser.load_from_json('output/parsed_bible.json')

# 5. 캐시 사용 (자동 관리)
chapters = parser.parse_file_with_cache(
    'data/common-bible-kr.txt',
    'output/bible_cache.json'
)

# 6. 데이터 탐색
first_chapter = chapters[0]
print(f"{first_chapter.book_name} {first_chapter.chapter_number}장")
for verse in first_chapter.verses[:3]:
    print(f"  {verse.number}. {verse.text[:50]}...")
```

### 워드프레스 게시 (CLI 스켈레톤 제공)

```python
from src.wordpress_api import Publisher, WordPressClient, AssetRegistry
from src.config import Config

# 설정 로드
config = Config()

registry = AssetRegistry(index_path=Path("output/wp_asset_index.json"))
registry.load()
client = WordPressClient(config)
publisher = Publisher(config, registry, client)

# 예) 상태 일괄 변경(드라이런)
result = publisher.bulk_update_status(target_status="publish", division_tag="구약", dry_run=True)
print(result)
```

**자동 생성되는 태그:**

- `공동번역성서` (기본)
- `구약`/`외경`/`신약` (구분별)
- `창세기`, `마태오의 복음서` 등 (책별)

## 🧪 테스트 (설계 완료)

```bash
# 전체 테스트 실행
python -m pytest tests/

# 특정 모듈 테스트
python -m pytest tests/test_parser.py -v
python -m pytest tests/test_html_generator.py -v
python -m pytest tests/test_wordpress_api.py -v

# 커버리지 포함 테스트
python -m pytest --cov=src tests/

# 통합 테스트
python -m pytest tests/test_integration.py -v
```

**테스트 범위:**

- 파서: 장/절 파싱, 첫 절 처리, 단락 구분, JSON 저장/로드
- HTML 생성기: 접근성 마크업, 템플릿 렌더링, 오디오 처리
- WordPress API: 인증, 카테고리/태그 자동 생성, 게시물 생성
- 통합: 전체 워크플로우 검증

## 📝 HTML 출력 예시

```html
<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>창세기 1장</title>
    <!-- 권장: 차일드 테마 enqueue로 CSS 로드 (본문 링크 생략) -->
    <link rel="stylesheet" href="audio-player.css" />
  </head>
  <body>
    <!-- 검색 UI -->
    <div class="search-container">
      <form id="verse-search-form" role="search" aria-label="성경 구절 검색">
        <label for="verse-search" class="screen-reader-text">검색</label>
        <input
          type="text"
          id="verse-search"
          placeholder="절 ID 또는 단어 검색 (예: 창세 1:3, 하느님)"
          aria-describedby="search-help"
        />
        <button id="verse-search-btn" type="submit">이동</button>
      </form>
      <p id="search-help" class="search-help-text">
        "책 장:절" 형식으로 검색하거나 단어를 입력하세요. 예: '창세 1:1' 또는
        '하느님'
      </p>
    </div>

    <!-- 오디오 플레이어 (접근성 고려) -->
    <div class="audio-player-container">
      <h2 class="screen-reader-text">성경 오디오</h2>
      <audio controls class="bible-audio" aria-label="창세기 1장 오디오">
        <source src="data/audio/genesis-1.mp3" type="audio/mpeg" />
        <p>
          브라우저가 오디오 재생을 지원하지 않습니다.
          <a href="data/audio/genesis-1.mp3">오디오 파일 다운로드</a>
        </p>
      </audio>
    </div>

    <article id="창세-1">
      <h1>창세기 1장</h1>

      <p>
        <span id="창세-1-1">
          <span aria-hidden="true" class="verse-number">1</span>
          <span class="paragraph-marker" aria-hidden="true">¶</span>
          한처음에 하느님께서 하늘과 땅을 지어내셨다.
        </span>
        <span id="창세-1-2">
          <span aria-hidden="true" class="verse-number">2</span>
          땅은 아직 모양을 갖추지 않고 아무것도 생기지 않았는데, 어둠이 깊은 물
          위에...
        </span>
      </p>

      <p>
        <span id="창세-1-3">
          <span aria-hidden="true" class="verse-number">3</span>
          <span class="paragraph-marker" aria-hidden="true">¶</span>
          하느님께서 "빛이 생겨라!" 하시자 빛이 생겨났다.
        </span>
        <span id="창세-1-4">
          <span aria-hidden="true" class="verse-number">4</span>
          그 빛이 하느님 보시기에 좋았다. 하느님께서는 빛과 어둠을 나누시고...
        </span>
      </p>
    </article>

    <!-- 권장: 차일드 테마 enqueue로 JS 로드 (본문 스크립트 생략) -->
  </body>
</html>
```

## 🔒 보안 고려사항

- 모든 인증 정보는 환경변수로 관리
- HTTPS 통신만 허용
- 입력 데이터 새니타이징
- API 레이트 리미팅

## 📚 문서

- [📋 요구사항 명세서](docs/requirements.md) - 프로젝트 요구사항 및 접근성 가이드
- [🎨 상세 설계서](docs/design-specification.md) - 시스템 아키텍처 및 모듈 설계
- [📖 파서 사용 가이드](docs/parser-usage-guide.md) - parser.py 모듈 상세 사용법

## 📊 현재 진행 상황

### ✅ 완료된 기능

- **텍스트 파서**: 1382개 장, 31102개 절 파싱 지원
- **JSON 저장/로드**: 파싱 결과 영속화 및 캐시 시스템
- **책 매핑**: 73권 성경 책 이름 변환 및 구분 정보
- **접근성 설계**: 이중 접근성 고려한 마크업 설계
- **WordPress API 설계**: 자동 카테고리/태그 생성 설계

### 🚧 구현 예정

- HTML 생성기 구현 (설계 완료)
- WordPress API 클라이언트 구현 (설계 완료)
- 메인 실행 파일 구현 (설계 완료)
- 단위 테스트 구현 (설계 완료)

## 🤝 기여하기

1. 이슈 등록 또는 기능 제안
2. Fork 및 브랜치 생성
3. 코드 작성 및 테스트
4. Pull Request 제출

### 개발 가이드라인

- **코딩 스타일**: PEP 8 준수
- **타입 힌트**: 모든 함수와 메서드에 타입 힌트 작성
- **테스트**: pytest를 사용한 단위 테스트 작성
- **접근성**: WCAG 2.1 AA 가이드라인 준수
- **보안**: 환경변수를 통한 민감정보 관리

## 📄 라이선스

이 프로젝트는 [MIT 라이선스](LICENSE) 하에 배포됩니다.

## 🙏 감사의 말

- 공동번역성서 개정판을 제공해주신 모든 분들께 감사드립니다.
- 웹 접근성 개선에 기여하는 모든 개발자들께 감사드립니다.

---

## 📞 문의

프로젝트 관련 문의사항이나 버그 리포트는 [이슈 페이지](../../issues)를 이용해 주세요.
