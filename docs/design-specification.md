# 공동번역성서 프로젝트 설계서

## 📋 개요

공동번역성서 텍스트 파일(`common-bible-kr.txt`)을 장 단위로 파싱하여 접근성을 지원하는 HTML로 변환하고, 웹 서버나 사용자 단말에서 실행할 수 있는 PWA(Progressive Web App)를 구축하는 시스템입니다.

---

## 🎯 프로젝트 목표

1. **텍스트 파싱**: 원본 텍스트를 장 단위로 분리
2. **HTML 변환**: 접근성을 고려한 HTML 생성 (오디오 파일 포함)
3. **PWA 구축**: 정적 파일 기반 Progressive Web App 생성
4. **목차 생성**: 전체 성경 목차 페이지 자동 생성
5. **오프라인 지원**: 서비스 워커를 통한 오프라인 접근 지원

---

## 📅 개발 계획 (Phase별 로드맵)

### **Phase 1: 국제화/현지화 최소 기반 확보** (4-6주)

#### 목표

- 현재 공동번역성서 기반 PWA에 기본 다국어 인터페이스 구축
- 향후 확장을 위한 아키텍처 기반 마련

#### 주요 기능

- **UI 다국어화 시스템**: `static/i18n/` 디렉토리 구조 및 언어 로더
- **메타데이터 다국어 확장**: `book_mappings.json`의 `names` 객체 구조 개선
- **언어 선택 UI**: 헤더 언어 스위처, 브라우저 언어 감지, localStorage 설정
- **다국어 PWA 매니페스트**: 언어별 앱 이름 및 설명

#### 지원 언어

- **UI 언어**: 한국어(기본) + 영어
- **본문 언어**: 한국어 공동번역성서만
- **검색**: 한영 혼용 책 이름 검색 지원

#### 성공 기준

- [ ] 영어 사용자가 인터페이스 완전 이해 가능
- [ ] 언어 전환 시 새로 고침 없이 즉시 반영
- [ ] 오프라인에서도 언어 설정 유지
- [ ] "Genesis" 검색으로 창세기 매칭 동작

### **Phase 2: 멀티 에디션 & 다국어 성서 지원** (8-12주)

#### 목표

- 한국어: 공동번역 + 새번역 + 개역개정 지원
- 영어: ESV, NIV 등 주요 번역본 지원
- 에디션별 독립적 관리 시스템 구축

#### 주요 기능

- **멀티 에디션 아키텍처**: `data/editions/` 디렉토리 구조
- **에디션 선택 시스템**: 에디션 피커 UI, 에디션별 설정 저장
- **통합 검색 시스템**: 에디션 간 구절 매핑, 다국어 검색 인덱스
- **고급 PWA 기능**: 에디션별 오프라인 캐싱, 선택적 다운로드

#### 데이터 구조

```
data/editions/
├── korean-common/      # 공동번역성서
├── korean-new/         # 새번역
├── korean-revised/     # 개역개정
├── english-esv/        # ESV
└── english-niv/        # NIV
```

#### 성공 기준

- [ ] 에디션 간 구절 동기화 (창세기 1:1 = Genesis 1:1)
- [ ] 5개 이상 주요 번역본 지원
- [ ] 에디션별 독립적 오프라인 저장
- [ ] 검색 결과에서 번역본 차이 시각화

### **Phase 3: 고급 기능 & 커뮤니티** (12-16주)

#### 목표

- 성경 연구 도구 통합
- 사용자 콘텐츠 & 커뮤니티 기능
- AI 기반 기능 실험

#### 주요 기능

- **연구 도구**: 구절 간 상호참조, 주석/해설 통합, 성경 지도 연동
- **개인화 기능**: 북마크 & 하이라이트, 개인 노트, 읽기 계획 추적
- **커뮤니티 기능**: 구절 공유(SNS 연동), 큐레이션된 읽기 계획
- **AI 실험 기능**: 구절 의미 검색(시맨틱), 주제별 구절 추천

#### 기술 스택 확장

- **백엔드**: Firebase/Supabase (사용자 데이터)
- **AI**: OpenAI API, 로컬 임베딩 모델
- **분석**: Google Analytics, 사용자 행동 추적
- **CDN**: 글로벌 콘텐츠 배포

#### 핵심 가치

- **Phase 1**: "글로벌 접근성" - 언어 장벽 해소
- **Phase 2**: "선택의 자유" - 다양한 번역본 비교
- **Phase 3**: "깊이 있는 연구" - 종합적 성경 연구 플랫폼

---

## 🏗️ 시스템 아키텍처

```
┌───────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  텍스트 파일 (Input)  │ --> │    파서 & 변환기    │ --> │  PWA 빌드 도구      │
│ common-bible-kr.txt   │     │  (Python Script)    │     │ (Static Files)      │
└───────────────────────┘     └─────────────────────┘     └─────────────────────┘
                                     │                              │
                                     v                              v
                              ┌─────────────────────┐     ┌─────────────────────┐
                              │  오디오 파일 매핑   │     │  PWA 출력 구조      │
                              │ (data/audio/*.mp3)  │     │ ├─ index.html       │
                              └─────────────────────┘     │ ├─ manifest.json    │
                                                          │ ├─ sw.js            │
                                                          │ └─ {book}-{ch}.html │
                                                          └─────────────────────┘
```

---

## 📂 프로젝트 구조

```
common-bible/
├── src/
│   ├── __init__.py
│   ├── parser.py           # 텍스트 파일 파싱 및 JSON 저장/로드, 캐시 지원, CLI 포함
│   ├── html_generator.py   # HTML 생성 (접근성/오디오/정적자원 경로 주입, CLI 포함)
│   ├── pwa_builder.py      # PWA 빌드 도구 (매니페스트, 서비스 워커, 목차 생성, CLI 포함)
│   └── config.py           # 설정 관리(환경변수 로드 + i18n 설정)
├── templates/
│   ├── chapter.html        # HTML 템플릿 (다국어 플레이스홀더 포함)
│   ├── index.html          # 목차 페이지 템플릿 (다국어 지원)
│   ├── manifest.json       # PWA 매니페스트 템플릿 (다국어 locales 포함)
│   └── sw.js               # 서비스 워커 템플릿 (기본 오프라인 캐싱)
├── static/
│   ├── verse-style.css     # 스타일시트 (기본 글꼴 Pretendard, 다국어 폰트 지원)
│   ├── verse-navigator.js  # 기본 검색/하이라이트/오디오/네비게이션 스크립트
│   ├── book-search.js      # 책 이름 검색 모듈 (한영 혼용 지원)
│   ├── i18n/               # 다국어 지원 파일들 (Phase 1 핵심)
│   │   ├── ko.json         # 한국어 UI 텍스트
│   │   ├── en.json         # 영어 UI 텍스트
│   │   ├── i18n-loader.js  # 언어 파일 로더
│   │   └── language-detector.js  # 브라우저 언어 감지
│   └── icons/              # PWA 아이콘 파일들
│       ├── icon-192x192.png
│       ├── icon-512x512.png
│       └── favicon.ico
├── data/
│   ├── common-bible-kr.txt # 원본 텍스트 (공동번역성서)
│   ├── audio/              # 오디오 파일 디렉토리 (*.mp3)
│   └── book_mappings.json  # 성경 책 메타데이터 (다국어 names, division 객체 포함)
├── output/                 # 파서/생성기 출력 디렉터리
│   ├── parsed_bible.json   # 파싱된 중간 데이터 (JSON 캐시)
│   └── pwa/                # PWA 빌드 출력 (배포 준비 완료)
│       ├── index.html      # 목차 페이지 (다국어 지원)
│       ├── manifest.json   # PWA 매니페스트 (다국어 locales)
│       ├── sw.js           # 서비스 워커 (기본 오프라인 캐싱)
│       ├── static/         # CSS, JS, 아이콘, i18n 파일들
│       │   └── i18n/       # 다국어 파일들 복사본
│       └── *.html          # 각 장별 HTML 파일 (다국어 UI)
├── logs/                   # 로그 파일 (필요 시)
├── .env.example            # 환경변수 예제 (i18n 설정 포함)
├── requirements.txt        # Python 패키지 목록
├── setup.py                # 패키지 설정
└── README.md               # 프로젝트 설명서

# Phase 2/3 예정 파일들 (현재 미구현)
# ├── static/
# │   ├── search-worker.js    # 전역 검색 Web Worker (Phase 2)
# │   └── lectionary.js       # 전례독서 시스템 (Phase 3)
# ├── data/
# │   ├── editions/           # 멀티 에디션 지원 (Phase 2)
# │   └── lectionary/         # 전례독서 데이터 (Phase 3)
```

---

## 📊 데이터 모델

### 핵심 데이터 구조

#### Chapter 클래스 (파싱 결과)

```python
from dataclasses import dataclass
from typing import List

@dataclass
class Chapter:
    """성경 장 데이터 모델"""
    book_name: str          # 한국어 책 이름 (예: "창세기")
    book_abbr: str          # 한국어 약칭 (예: "창세")
    english_name: str       # 영어 책 이름 (예: "Genesis")
    division_ko: str        # 한국어 구분 (예: "구약")
    division_en: str        # 영어 구분 (예: "Old Testament")
    chapter_number: int     # 장 번호 (예: 1)
    verses: List[Verse]     # 절 목록

    # 파생 속성 (계산됨)
    @property
    def chapter_id(self) -> str:
        """장 고유 ID (영어 기반)"""
        return f"{self.english_slug}-{self.chapter_number}"

    @property
    def english_slug(self) -> str:
        """영어 기반 URL 슬러그"""
        return get_english_abbr(self.english_name)
```

#### Verse 클래스 (절 데이터)

```python
@dataclass
class Verse:
    """성경 절 데이터 모델"""
    number: int             # 절 번호 (예: 1)
    text: str              # 절 내용 (¶ 제거됨)
    has_paragraph: bool    # 단락 시작 여부 (¶ 존재했는지)

    # 파생 속성
    @property
    def verse_id(self) -> str:
        """절 고유 ID (부모 Chapter와 조합)"""
        # 사용법: f"{chapter.english_slug}-{chapter.chapter_number}-{verse.number}"
        return f"{self.number}"

    @property
    def clean_text(self) -> str:
        """정제된 텍스트 (HTML 이스케이프 적용)"""
        import html
        return html.escape(self.text.strip())
```

#### BookMapping 클래스 (메타데이터)

```python
@dataclass
class BookMapping:
    """책 메타데이터 모델 (book_mappings.json 구조)"""
    abbr: str              # 한국어 약칭 (예: "창세")
    korean_name: str       # 한국어 전체 이름 (예: "창세기")
    english_name: str      # 영어 이름 (예: "Genesis")
    division: str          # 구분 (예: "구약")
    aliases: List[str]     # 검색 별칭 (예: ["창세", "창세기", "창"])

    @property
    def english_abbr(self) -> str:
        """영어 약칭 (ID 생성용)"""
        return get_english_abbr(self.english_name)
```

### 검색 인덱스 구조

#### SearchIndexEntry 클래스

```python
@dataclass
class SearchIndexEntry:
    """검색 인덱스 항목 (JSON 압축을 위해 단축키 사용)"""
    i: str    # id: 절 ID (예: "gen-1-1")
    t: str    # text: 절 내용
    h: str    # href: HTML 파일 경로 (예: "genesis-1.html#gen-1-1")
    b: str    # book: 영어 약칭 (예: "gen")
    c: int    # chapter: 장 번호
    v: int    # verse: 절 번호
    bo: int   # book_order: 책 순서 (정렬용)

    def to_dict(self) -> dict:
        """JSON 직렬화용 딕셔너리 변환"""
        return {
            "i": self.i,
            "t": self.t,
            "h": self.h,
            "b": self.b,
            "c": self.c,
            "v": self.v,
            "bo": self.bo
        }
```

### PWA 빌드 설정

#### PWAConfig 클래스

```python
@dataclass
class PWAConfig:
    """PWA 빌드 설정"""
    app_name: str = "공동번역성서"
    short_name: str = "공동번역성서"
    start_url: str = "index.html"
    display: str = "standalone"
    theme_color: str = "#4CAF50"
    background_color: str = "#FFFFFF"
    icons: List[dict] = None

    # 보안 설정
    enable_sri: bool = True
    csp_policy: str = "strict"  # "strict", "moderate", "development"

    # 다국어 설정
    default_language: str = "ko"
    supported_languages: List[str] = None

    def __post_init__(self):
        if self.icons is None:
            self.icons = [
                {
                    "src": "static/icons/icon-192x192.png",
                    "sizes": "192x192",
                    "type": "image/png",
                    "purpose": "maskable any"
                },
                {
                    "src": "static/icons/icon-512x512.png",
                    "sizes": "512x512",
                    "type": "image/png",
                    "purpose": "maskable any"
                }
            ]

        if self.supported_languages is None:
            self.supported_languages = ["ko", "en"]
```

### 유틸리티 함수

#### 영어 약칭 생성

```python
def get_english_abbr(english_name: str) -> str:
    """영어 책 이름에서 약칭 추출 (일관성 있는 ID 생성용)"""
    name = english_name.lower()
    if ' ' in name:
        parts = name.split()
        if parts[0].isdigit():
            # "1 Kings" → "1-kin"
            return f"{parts[0]}-{parts[1][:3]}"
        else:
            # "Song of Songs" → "song"
            return parts[0][:4]
    else:
        # "Genesis" → "gene" (4글자로 통일)
        return name[:4]
```

### 데이터 플로우 요약

```mermaid
flowchart TD
    A[book_mappings.json] --> B[List&lt;BookMapping&gt;]
    C[common-bible-kr.txt] --> D[parser.py]
    B --> D
    D --> E[List&lt;Chapter&gt;]
    E --> F[parsed_bible.json<br/>캐시]
    F --> G[html_generator.py]
    G --> H[HTML 파일들<br/>*.html]
    E --> I[검색 인덱스 생성]
    I --> J[List&lt;SearchIndexEntry&gt;]
    J --> K[search-index.json]
    H --> L[pwa_builder.py]
    K --> L
    L --> M[output/pwa/<br/>배포 준비]

    %% 스타일링
    classDef inputFile fill:#e1f5fe
    classDef process fill:#f3e5f5
    classDef dataModel fill:#fff3e0
    classDef output fill:#e8f5e8
    classDef cache fill:#fff8e1

    class A,C inputFile
    class D,G,I,L process
    class B,E,J dataModel
    class F cache
    class H,K,M output
```

---

## 🔧 핵심 모듈 설계

### 1. 파서 & 변환기

#### 1.1 텍스트 파서 (parser.py)

요구사항([requirements.md](./requirements.md))에 맞춘 파서 설계입니다. 장 식별, 첫 절 포함 라인 처리, 단락(`¶`) 인식, JSON 캐시, CLI를 포함합니다.

##### 1.1.1 입력 포맷 규칙 요약

- 장 시작 패턴: `([가-힣0-9]+)\s+([0-9]+):([0-9]+)\s*(.*)?`
  - 예: `창세 1:1 ¶ 한처음에...` (첫 절 내용이 같은 줄에 등장)
- 두 번째 줄부터: `^([0-9]+)\s+(.*)$`
- 단락 구분: `¶`가 새 단락 시작을 의미

##### 1.1.2 입력 파일 예시 (`data/common-bible-kr.txt`)

**구약 (창세기) 예시:**

```
창세 1:1 ¶ 한처음에 하느님께서 하늘과 땅을 지어내셨다.
2 땅은 아직 모양을 갖추지 않고 아무것도 생기지 않았는데, 어둠이 깊은 물 위에 뒤덮여 있었고 그 물 위에 하느님의 기운이 휘돌고 있었다.
3 ¶ 하느님께서 "빛이 생겨라!" 하시자 빛이 생겨났다.
4 그 빛이 하느님 보시기에 좋았다. 하느님께서는 빛과 어둠을 나누시고
5 빛을 낮이라, 어둠을 밤이라 부르셨다. 이렇게 첫날이 밤, 낮 하루가 지났다.

창세 2:1 ¶ 이리하여 하늘과 땅과 그 가운데 있는 모든 것이 다 이루어졌다.
2 하느님께서는 엿샛날까지 하시던 일을 다 마치시고, 이렛날에는 모든 일에서 손을 떼고 쉬셨다.
```

**외경 (토비트) 예시:**

```
토비 1:1 ¶ 이 책은 토비트에 관한 이야기를 적은 것이다. 토비트는 납달리 지파의 아시엘 집안에 속한 사람으로서...
토비 2:1 ¶ 에살하똔 왕 때에 나는 집으로 돌아와 내 아내 안나와 아들 토비아를 되찾게 되었다.
```

**신약 (마태복음) 예시:**

```
마태 1:1 ¶ 아브라함의 후손이요, 다윗의 자손인 예수 그리스도의 족보는 다음과 같다.
2 아브라함은 이사악을 낳고, 이사악은 야곱을 낳고, 야곱은 유다와 그의 형제들을 낳았다.
3 유다는 다말에게서 베레스와 세라를 낳고, 베레스는 헤스론을 낳고, 헤스론은 람을 낳았다.

마태 2:1 ¶ 예수께서 헤로데 왕 때에 유다 베들레헴에서 나셨는데 그 때에 동방에서 박사들이 예루살렘에 와서
2 "유다인의 왕으로 나신 분이 어디 계십니까? 우리는 동방에서 그분의 별을 보고 그분께 경배하러 왔습니다." 하고 물었다.
```

**파싱 패턴 분석:**

1. **장 시작 라인**: `{책명} {장}:{첫절번호} [¶] {첫절내용}`

   - `창세 1:1 ¶ 한처음에...` → 책명="창세", 장=1, 절=1, 첫절내용="¶ 한처음에..."
   - `토비 2:1 ¶ 에살하똔 왕...` → 책명="토비", 장=2, 절=1, 첫절내용="¶ 에살하똔 왕..."

2. **일반 절 라인**: `{절번호} [¶] {절내용}`

   - `2 땅은 아직 모양을...` → 절=2, 내용="땅은 아직 모양을..."
   - `3 ¶ 하느님께서...` → 절=3, 내용="¶ 하느님께서..." (단락 시작)

3. **단락 표시**: `¶` 기호가 절 내용 앞에 나타남
   - 새로운 단락의 시작을 의미
   - HTML 생성 시 `<p>` 태그 구분에 활용

##### 1.1.3 데이터 모델

**추상 데이터 구조:**

- `Verse { number: int, text: str, has_paragraph: bool }`
- `Chapter { book_name: str, book_abbr: str, chapter_number: int, verses: List[Verse] }`
- **Phase 1 확장**: `{ english_name: str, division_ko: str, division_en: str }` 필드 추가

**`parsed_bible.json` 파일 구조 예시:**

앞서 본 `common-bible-kr.txt` 입력이 `parser.py`로 처리되면 `output/parsed_bible.json`에 다음과 같은 구조로 저장됩니다:

```json
{
  "book_name": "창세기",
  "book_abbr": "창세",
  "chapter_number": 1,
  "verses": [
    {
      "number": 1,
      "text": "한처음에 하느님께서 하늘과 땅을 지어내셨다.",
      "has_paragraph": true
    },
    {
      "number": 2,
      "text": "땅은 아직 모양을 갖추지 않고 아무것도 생기지 않았는데, 어둠이 깊은 물 위에 뒤덮여 있었고 그 물 위에 하느님의 기운이 휘돌고 있었다.",
      "has_paragraph": false
    },
    {
      "number": 3,
      "text": "하느님께서 \"빛이 생겨라!\" 하시자 빛이 생겨났다.",
      "has_paragraph": true
    },
    {
      "number": 4,
      "text": "그 빛이 하느님 보시기에 좋았다. 하느님께서는 빛과 어둠을 나누시고",
      "has_paragraph": false
    },
    {
      "number": 5,
      "text": "빛을 낮이라, 어둠을 밤이라 부르셨다. 이렇게 첫날이 밤, 낮 하루가 지났다.",
      "has_paragraph": false
    }
  ]
}
```

**다국어 메타데이터 확장 (Phase 1):**

`parser.py`가 `parsed_bible.json` 생성 시, `book_mappings.json`의 `"division": "구약"` 구조를 다국어 필드로 확장합니다:

```json
{
  "book_name": "창세기",           // 한국어 전체 이름 (book_mappings.json의 names.ko)
  "book_abbr": "창세",            // 원본 텍스트의 약칭
  "english_name": "Genesis",      // 영어 이름 (book_mappings.json의 names.en)
  "division_ko": "구약",          // 한국어 구분 (book_mappings.json의 division 값)
  "division_en": "Old Testament", // 영어 구분 (파싱 시 추가)
  "chapter_number": 1,
  "verses": [...]
}
```

**데이터 예시:**

```json
{
  "book_name": "토비트",
  "book_abbr": "토비",
  "english_name": "Tobit",
  "division_ko": "외경",
  "division_en": "Apocrypha",
  "chapter_number": 1,
  "verses": [
    {
      "number": 1,
      "text": "이 책은 토비트에 관한 이야기를 적은 것이다. 토비트는 납달리 지파의 아시엘 집안에 속한 사람으로서 그의 아버지는 토비엘, 할아버지는 하나니엘, 증조부는 아두엘, 고조부는 가바엘이었다. 가바엘의 아버지는 라파엘이었고 할아버지는 라구엘이었다.",
      "has_paragraph": true
    }
  ]
}
```

**특수 케이스 처리:**

1. **¶ 기호 처리**: `text` 필드에서는 ¶ 기호가 제거되고 `has_paragraph` 필드로 분리(HTML 생성 시 표시됨)

   - 원본: `"¶ 한처음에 하느님께서..."`
   - `parsed_bible.json` 파싱 후: `text: "한처음에 하느님께서..."`, `has_paragraph: true`
   - HTML 생성 후: `<span class="paragraph-marker">¶</span>한처음에 하느님께서...`

2. **인용부호 이스케이핑**: JSON 저장을 위해 따옴표 이스케이프 처리

   - 원본: `하느님께서 "빛이 생겨라!" 하시자`
   - 파싱 후: `하느님께서 \"빛이 생겨라!\" 하시자`

3. **긴 절 처리**: 절 내용이 길어도 단일 문자열로 저장
   - 줄바꿈 없이 연속된 텍스트로 보존

**키 명명 규칙 정리:**

- **`book_mappings.json` 파일**: `"division": "구약"` (현재 Phase 1)
- **`parsed_bible.json`의 Chapter 객체**: `"division_ko": "구약", "division_en": "Old Testament"` (다국어 확장)
- **Phase 2+ 계획**: `"division": { "ko": "구약", "en": "Old Testament" }` (중첩 객체)

**데이터 플로우 요약:**

1. **입력**: `data/common-bible-kr.txt` + `data/book_mappings.json`
2. **파싱**: `parser.py` 실행 → 텍스트 구조화 + 메타데이터 확장
3. **출력**: `output/parsed_bible.json` (중간 캐시 파일)
4. **이후 단계**: HTML 생성기 → PWA 빌드 → 최종 배포

##### 1.1.4 파싱 알고리즘

1. 파일을 줄 단위로 순회
2. 장 시작 정규식 매칭 시 현재 장을 종료/저장하고 새 장을 시작
   - 같은 줄의 첫 절 텍스트가 존재하면 `number=1`로 생성하고 `has_paragraph`는 텍스트 내 `¶` 여부로 설정
3. 일반 절 라인은 숫자+공백 패턴으로 파싱
4. 파일 종료 시 마지막 장을 저장

**에지 케이스**

- 빈 줄은 무시 (장 구분은 오직 패턴으로 수행)
- 잘못된 라인은 스킵 (로그로 보고)
- 책 약칭 매핑이 없으면 원문 약칭 그대로 사용

##### 1.1.5 정규식

텍스트 본문에서 장과 절 패턴을 식별해 구조화하여 JSON으로 저장할 때 사용합니다.

**장 시작 패턴**: `r"^([가-힣0-9]+)\s+([0-9]+):([0-9]+)\s*(.*)?$"`

구성 요소 설명:

- `^` : 라인 시작
- `([가-힣0-9]+)` : **그룹 1** - 책 이름 (한글 + 숫자, 1자 이상)
  - 예: `창세`, `2마카`, `1열왕`
- `\s+` : 공백 문자 1개 이상
- `([0-9]+)` : **그룹 2** - 장 번호 (숫자, 1자 이상)
- `:` : 콜론 문자 (리터럴)
- `([0-9]+)` : **그룹 3** - 절 번호 (숫자, 1자 이상)
- `\s*` : 공백 문자 0개 이상 (선택적)
- `(.*)?` : **그룹 4** - 첫 절 본문 (임의 문자, 선택적)
- `$` : 라인 끝

**매칭 예시**:

```python
# 예시 1: 첫 절 본문이 포함된 경우
input: "창세 1:1 ¶ 한처음에 하느님께서 하늘과 땅을 지어내셨다."
groups: ("창세", "1", "1", "¶ 한처음에 하느님께서 하늘과 땅을 지어내셨다.")

# 예시 2: 첫 절 본문이 없는 경우
input: "2마카 2:1"
groups: ("2마카", "2", "1", "")

# 예시 3: 외경 책명
input: "1마카 3:5 전쟁이 일어났다."
groups: ("1마카", "3", "5", "전쟁이 일어났다.")
```

**절 내용 패턴**: `r"^([0-9]+)\s+(.*)$"`

구성 요소 설명:

- `^` : 라인 시작
- `([0-9]+)` : **그룹 1** - 절 번호 (숫자, 1자 이상)
- `\s+` : 공백 문자 1개 이상 (절 번호와 본문 구분)
- `(.*)` : **그룹 2** - 절 본문 (임의 문자, 개행 제외)
- `$` : 라인 끝

**매칭 예시**:

```python
# 예시 1: 일반 절
input: "2 땅은 아직 모양을 갖추지 않고 아무것도 생기지 않았는데..."
groups: ("2", "땅은 아직 모양을 갖추지 않고 아무것도 생기지 않았는데...")

# 예시 2: 단락 표시가 있는 절
input: "3 ¶ 하느님께서 '빛이 생겨라!' 하시자 빛이 생겨났다."
groups: ("3", "¶ 하느님께서 '빛이 생겨라!' 하시자 빛이 생겨났다.")

# 예시 3: 높은 절 번호
input: "27 그들이 예수께 말하였다."
groups: ("27", "그들이 예수께 말하였다.")
```

**특수 케이스 처리**:

- **빈 줄**: 두 정규식 모두 매칭 실패 → 무시
- **잘못된 형식**: 매칭 실패 시 로그로 기록 후 스킵
- **공백 변형**: `\s+`로 탭, 스페이스 등 다양한 공백 허용
- **외경 책명**: 숫자가 앞에 오는 `1마카`, `2마카` 등 자동 처리

##### 1.1.6 JSON 캐시/스키마

파싱 결과를 저장하고 재사용하기 위해 JSON 파일로 저장합니다.

**출력 파일**: `output/parsed_bible.json`

**역할과 위치**:

- 원본 텍스트 파일과 최종 HTML 생성 사이의 **중간 데이터 형태**
- 파싱 결과를 구조화된 형태로 저장하여 HTML 생성기의 **콘텐츠 소스** 역할
- 시스템 아키텍처에서 "파서 & 변환기" 단계의 **핵심 출력물**

**주요 이점**:

1. **성능 최적화**: 파싱을 한 번만 수행하고 결과를 재사용
2. **개발 효율성**: HTML 템플릿 수정 시 파싱 과정 없이 즉시 테스트 가능
3. **디버깅 지원**: JSON 형태로 파싱 결과를 직접 확인 및 검증
4. **모듈 분리**: 파싱 로직과 HTML 생성 로직의 독립적 실행
5. **확장성**: PWA 빌드, 검색 인덱스 생성 등 다양한 용도로 활용

**스키마 구조**:

```json
{
  "chapters": [
    {
      "book_name": "창세기",
      "book_abbr": "창세",
      "chapter_number": 1,
      "verses": [
        {
          "number": 1,
          "text": "한처음에 하느님께서 하늘과 땅을 지어내셨다.",
          "has_paragraph": true
        }
      ]
    }
  ]
}
```

**최적화 전략**:

- 파일 크기 최적화를 위해 책 매핑(약칭→전체/영문)은 별도 `data/book_mappings.json` 활용
- 불필요한 메타데이터 제거로 파일 크기 최소화
- UTF-8 인코딩으로 한글 텍스트 안전한 저장

**책 매핑 파일 구조** (`data/book_mappings.json`):

매핑 파일에서 쓰이는 약칭은 공동번역성서 기준으로 사용합니다.

```json
[
  {
    "abbr": "창세",
    "korean_name": "창세기",
    "english_name": "Genesis",
    "division": "구약",
    "aliases": ["창세", "창세기", "창"]
  },
  {
    "abbr": "출애",
    "korean_name": "출애굽기",
    "english_name": "Exodus",
    "division": "구약",
    "aliases": ["출애", "출애굽기", "출"]
  },
  {
    "abbr": "토비",
    "korean_name": "토비트",
    "english_name": "Tobit",
    "division": "외경",
    "aliases": ["토비", "토비트", "토빗기", "토"]
  },
  {
    "abbr": "1마카",
    "korean_name": "마카베오 상권",
    "english_name": "1 Maccabees",
    "division": "외경",
    "aliases": ["1마카", "마카베오상", "카상"]
  },
  {
    "abbr": "마태",
    "korean_name": "마태오의 복음서",
    "english_name": "Matthew",
    "division": "신약",
    "aliases": ["마태", "마태복음", "마태오복음", "마태오의 복음서", "마"]
  },
  {
    "abbr": "묵시",
    "korean_name": "요한 묵시록",
    "english_name": "Revelation",
    "division": "신약",
    "aliases": ["묵시", "요한의 묵시록", "요한계시록", "계"]
  }
]
```

**매핑 활용 방식**:

- **abbr**: 원본 텍스트 파싱 시 책 식별자로 사용
- **korean_name**: HTML 제목 및 PWA 목차에서 표시
- **english_name**: 파일명 생성 시 슬러그로 변환 (`genesis-1.html`)
- **division**: PWA 목차에서 구약/외경/신약 분류 및 태그 생성
- **aliases**: 검색 및 사용자 입력 시 다양한 책 이름 인식용 (공동번역, 개신교 표기 포함)

**외경 포함 정책**: 공동번역성서 기준으로 73권 전체 지원

- 구약: 46권 (개신교 39권 + 외경 7권 통합)
- 외경: 토비트, 유딧, 마카베오상하, 지혜서, 집회서, 바룩
- 신약: 27권

##### 1.1.7 인터페이스(요약)

```python
class BibleParser:
    def __init__(self, book_mappings_path: str): ...
    def parse_file(self, file_path: str) -> list[Chapter]: ...
    def save_to_json(self, chapters: list[Chapter], path: str) -> None: ...
    def load_from_json(self, path: str) -> list[Chapter]: ...
    # 내부 유틸: _load_book_mappings, _get_full_book_name, _get_english_book_name, _parse_verse_line
```

##### 1.1.8 CLI

```bash
python src/parser.py data/common-bible-kr.txt \
  --save-json output/parsed_bible.json \
  --book-mappings data/book_mappings.json
```

옵션: `--save-json`, `--book-filter`, `--chapter-range`, `--strict`(형식 오류 시 실패), `--log-level` 등 확장 가능.

##### 1.1.9 테스트 항목(요약)

- 장 식별/첫 절 동일 라인 파싱
- 절 번호/본문 분리, `¶` 인식
- 장 종료 처리(파일 끝 포함)
- 매핑 누락 시 폴백 동작
- JSON 저장/로드 일관성

#### 1.2 HTML 생성기 (html_generator.py)

접근성/검색/오디오/정적 리소스 처리를 포함한 HTML 변환기 설계입니다.

##### 1.2.1 동작

- 절 ID/접근성 마크업 생성(절번호/¶ 시각 표시, 스크린리더 숨김)
- 단락 그룹화(`¶` 기준) 및 시맨틱 `<p>` 구성
- 오디오 파일 경로 생성 및 존재 여부에 따른 UI 토글. 오디오 파일은 한국어 버전에서만 제공할 예정
- 책 별칭/슬러그 데이터 `window.BIBLE_ALIAS` 주입

**오디오 파일 정책 (Phase 1):**

- **한국어만 지원**: 제작 비용과 리소스 제약으로 한국어 오디오만 제공
- **스크린리더와의 역할 분담**:
  - 스크린리더: 모든 언어 즉시 지원, 사용자 맞춤 설정 가능
  - 오디오 파일: 한국어 특화 콘텐츠, 일관된 발음과 성우 경험
- **접근성 보완**: 다른 언어 사용자는 스크린리더 활용 권장
- 약칭/정렬은 `data/book_mappings.json`의 순서를 단일 기준으로 사용(외경 포함)
- CSS/JS 링크 자동 삽입 및 정적 자원 복사
- 전역 검색 인덱스 생성: 전체 절 텍스트/앵커/정렬 메타를 단일 JSON으로 출력

##### 1.2.2 인터페이스(요약)

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

##### 1.2.3 템플릿 변수

- `${book_name}`, `${chapter_number}`, `${chapter_id}`
- `${verses_content}`: 본문
- `${audio_path}`, `${audio_title}`
- `${alias_data_script}`: 별칭 주입 스크립트
- `${css_link_tag}`, `${js_script_tag}`: 선택적 링크/스크립트 삽입 슬롯

##### 1.2.4 오디오 처리

- 파일명 규칙: `{english_slug}-{chapter}.mp3`
- 파일 유무 확인: `audio_check_base`가 파일시스템 경로면 파일 유무 확인, URL이면 존재로 간주
- **지연 로딩 UI**: JavaScript로 동적 상태 관리 (다운로드 안함/중/완료/재생 중/오프라인)
- **오프라인 감지**: `navigator.onLine` 및 fetch 실패 시 오프라인 안내 표시

##### 1.2.5 단락/ID 규칙

- **절 ID**: `{약칭}-{장}-{절}` (예: `gen-1-3`, `exod-20-1`)
  - **언어 중립적**: `book_mappings.json`의 `english_name`에서 **영어** 약칭 추출(국제화/현지화를 고려해야 함)
- 단락 시작(`has_paragraph=True`) 시 이전 절 묶음을 종료하고 새 `<p>`를 시작
- 미래 확장: 단일 절 내 `¶`에 의한 a/b 분절 ID(`-4a`, `-4b`) 지원 가능(현 버전은 시각 표시만)

**약칭 추출 규칙:**

```python
def get_english_abbr(english_name: str) -> str:
    """영어 책 이름에서 약칭 추출"""
    # 간단한 규칙: 첫 3-4글자 + 숫자 처리
    name = english_name.lower()
    if ' ' in name:
        # "1 Kings" → "1-kings", "Song of Songs" → "song"
        parts = name.split()
        if parts[0].isdigit():
            return f"{parts[0]}-{parts[1][:3]}"  # "1-kin"
        else:
            return parts[0][:4]  # "song"
    else:
        return name[:4]  # "genesis" → "gen"
```

##### 1.2.6 정적 자원 처리

**로컬 파일만 허용 (보안 정책):**

- **로컬 파일 링크**: `--css-href`, `--js-src`는 로컬 파일 경로만 허용
  - 허용: `./static/style.css`, `../shared/common.js`
  - 차단: `https://cdn.example.com/lib.js` (외부 URL 금지)
- **자동 복사 및 경로 변환**: `--copy-static` 필수, 모든 리소스를 PWA 내부로 복사
  - 빌드 타임: 로컬 파일을 `output/pwa/static/`로 복사
  - HTML 생성: 복사된 파일을 상대 경로로 참조 (`./static/style.css`)

**보안 검증:**

- **경로 검증**: `../` 경로 순회 공격 방지 (상위 디렉토리 제한)
- **파일 확장자 화이트리스트**: `.css`, `.js`만 허용
- **Content Security Policy**: 인라인 스크립트 금지, 로컬 리소스만 허용

##### 1.2.7 CLI(요약)

```bash
python src/html_generator.py templates/chapter.html output/html/ \
  --json output/parsed_bible.json \
  --book 창세 --chapters 1,2,3 --limit 50 \
  --audio-base data/audio --static-base ../static \
  --copy-static --copy-audio \
  --css-href ./static/verse-style.css --js-src ./static/verse-navigator.js
  # 전역 검색 인덱스 자동 생성
  --search-index-out output/html/static/search/search-index.json
```

##### 1.2.8 테스트 항목(요약)

- 절 span 생성(접근성 속성 포함)
- 단락 그룹화(`<p>` 개수/경계)
- 오디오 파일명/존재 여부에 따른 토글
- CSS/JS 링크 주입 유무 및 값 검증

### 2. PWA 빌드 도구

요구사항([requirements.md](./requirements.md))을 충족하는 PWA 빌드 모듈을 설계합니다. 책임은 다음과 같습니다.

- 목차 페이지(`index.html`) 자동 생성
- PWA 매니페스트 및 서비스 워커 생성
- 정적 자원 복사 및 최적화
- 오프라인 캐싱 설정 및 파일 구조 조직화

#### 2.1 아키텍처 개요

- `PWABuilder`: PWA 빌드 프로세스 오케스트레이션
- `IndexGenerator`: 목차 페이지 자동 생성
- `ManifestGenerator`: PWA 매니페스트 생성
- `ServiceWorkerGenerator`: 서비스 워커 및 캐싱 전략 구성
- 데이터 모델
  - `PWAConfig`: `{ app_name, theme_color, start_url, display_mode, icons }`
  - `IndexStructure`: `{ divisions: [구약, 외경, 신약], books: [...], chapters_count }`

파일 배치:

- `src/pwa_builder.py`: 위 클래스/함수 구현
- `output/pwa/`: PWA 빌드 출력 디렉토리

#### 2.2 정적 자원 최적화 정책

- **대상 파일**
  - CSS: `static/verse-style.css` → `output/pwa/static/`
  - JS: `static/*.js` → `output/pwa/static/`
  - 오디오: `data/audio/*.mp3` → `output/pwa/audio/`
  - 아이콘: `static/icons/*` → `output/pwa/`
- **최적화 과정**
  1. CSS/JS 파일 압축 및 번들링
  2. 이미지 최적화 (아이콘 리사이징)
  3. 캐시 무효화를 위한 파일명 해시 추가 (선택사항)
  4. 오디오 파일 존재 여부 확인 및 조건부 복사
- **파일 구조 생성**
  - 각 장별 HTML 파일을 적절한 디렉토리에 배치
  - 상대 경로 기반 링크로 리소스 참조 설정
  - PWA 필수 파일들을 루트에 배치

#### 2.3 목차 페이지 생성

- **입력 데이터**: 파싱된 성경 구조 (`output/parsed_bible.json` - 책별 장 목록)
- **템플릿**: `templates/index.html`
- **출력**: `output/pwa/index.html`
- **구조 생성**
  - 3단 구성: 구약(39책) / 외경(7책) / 신약(27책)
  - 각 책별 장 개수 및 링크 생성
  - 검색 기능 UI 포함
- **PWA 기능**
  - 매니페스트 링크: `<link rel="manifest" href="manifest.json">`
  - 서비스 워커 등록 스크립트 포함
  - "홈 화면에 추가" 프롬프트 제공
- **접근성**
  - 시맨틱 HTML 구조 (nav, section, article)
  - 키보드 네비게이션 지원
  - 스크린리더 친화적 라벨링

#### 2.4 클래스/메서드 인터페이스(요약)

```python
class PWABuilder:
    def __init__(self, config: PWAConfig): ...
    def build_pwa(self, chapters: list[Chapter], output_dir: str) -> None: ...
    def copy_static_assets(self, output_dir: str) -> None: ...
    def optimize_assets(self, output_dir: str) -> None: ...

class IndexGenerator:
    def generate_index_page(self, chapters: list[Chapter], template_path: str) -> str: ...
    def group_by_division(self, chapters: list[Chapter]) -> dict[str, list[Chapter]]: ...
    def get_chapter_counts(self, chapters: list[Chapter]) -> dict[str, int]: ...

class ManifestGenerator:
    def generate_manifest(self, config: PWAConfig) -> str: ...
    def validate_icons(self, icon_dir: str) -> list[dict]: ...

class ServiceWorkerGenerator:
    def generate_service_worker(self, config: PWAConfig) -> str: ...
    def get_cache_files(self, output_dir: str) -> list[str]: ...
    def create_cache_strategy(self, file_types: dict) -> dict: ...

class PWAConfig:
    app_name: str = "공동번역성서"
    short_name: str = "공동번역성서"
    start_url: str = "index.html"
    display: str = "standalone"
    theme_color: str = "#4CAF50"
    background_color: str = "#FFFFFF"
    icons: list[dict] = None
```

구현 세부(요약)

- 파일 처리: 정적 자원 복사 및 최적화, 상대 경로 기반 링크 생성
- 캐싱 전략: Cache First (정적 자원, 검색 인덱스 포함)
- 로깅: 빌드 과정, 파일 처리, 오류 상황에 대한 상세 로그
- 입력 검증: 파일 존재/크기/확장자, HTML UTF-8 보장, PWA 필수 요소 검증

#### 2.5 파일명 규칙

- **HTML**: `{english_book_slug}-{chapter}.html` (예: `genesis-1.html`)
- **CSS**: `static/verse-style.css` (버전 관리 시 해시 추가 가능)
- **JavaScript**: `static/verse-navigator.js`, `static/search-worker.js`
- **오디오**: `audio/{english_book_slug}-{chapter}.mp3`
- **아이콘**: `icon-{size}.png` (예: `icon-192x192.png`)
- **PWA 파일**: `manifest.json`, `sw.js` (루트에 배치)

#### 2.6 PWA 구성

- **환경변수(.env)**:
  - `PWA_APP_NAME="공동번역성서"`
  - `PWA_THEME_COLOR="#4CAF50"`
  - `PWA_START_URL="index.html"`
  - `BUILD_OUTPUT_DIR="output/pwa"`
- **보안 설정**:
  - 정적 파일 서빙 시 적절한 MIME 타입 설정
  - HTTPS 권장 (PWA 필수 요구사항)
  - 콘텐츠 이스케이프 처리로 XSS 방지

#### 2.7 PWA 빌드 옵션

- **선택적 빌드**:
  - 특정 책만 빌드: `--books 창세,출애`
  - 장 범위 지정: `--chapters 1-10`
  - 외경 포함/제외: `--include-apocrypha` / `--exclude-apocrypha`
- **최적화 옵션**:
  - 파일 압축: `--minify-css`, `--minify-js`
  - 이미지 최적화: `--optimize-images`
  - 캐시 버스팅: `--cache-bust`
- **빌드 보고서**:
  - 생성된 파일 목록과 크기
  - 최적화 결과 (압축률, 처리 시간)
  - 누락된 오디오 파일 목록
  - PWA 필수 요소 검증 결과

#### 2.8 테스트 항목(요약)

- **정적 자원 처리**: 파일 복사, 경로 해결, 최적화 결과 검증
- **목차 페이지 생성**: 책별 분류, 장 링크, 검색 UI 포함 여부
- **PWA 매니페스트**: 필수 속성, 아이콘 경로, 시작 URL 검증
- **서비스 워커**: 캐시 등록, 오프라인 동작, 업데이트 전략 테스트
- **HTML 구조**: 상대 경로 링크, 접근성 마크업, 오디오 조건부 표시
- **빌드 프로세스**: 선택적 빌드, 오류 처리, 보고서 생성

### 3. 오디오 파일 처리 (data/audio/\*.mp3)

시스템 아키텍처에서 별도로 표시된 오디오 파일 매핑 및 처리 과정입니다.

**Phase 1 정책**: 한국어 공동번역성서만 오디오 지원, 다른 언어는 스크린리더 활용

#### 3.1 오디오 파일 명명 규칙

- **파일명 형식**: `{english_book_slug}-{chapter}.mp3`
- **예시**: `genesis-1.mp3`, `matthew-5.mp3`, `1-maccabees-2.mp3`
- **경로**: `data/audio/` 디렉토리에 배치

#### 3.2 오디오 파일 매핑 로직

- **존재 확인**: HTML 생성 시 파일 존재 여부 자동 검사
- **조건부 UI**:
  - 존재하면 오디오 플레이어 표시
  - 없으면 "준비 중" 메시지 (한국어) 또는 "스크린리더 사용 권장" (다른 언어)
- **언어별 처리**:
  - **한국어**: 오디오 파일 제공 (자연스러운 사람 음성)
  - **영어/기타**: 스크린리더 TTS 활용 안내

**스크린리더 vs 오디오 파일:**

| 특징            | 스크린리더 (TTS)    | 오디오 파일        |
| --------------- | ------------------- | ------------------ |
| **가용성**      | 모든 언어/텍스트    | 한국어만           |
| **제작 비용**   | 없음                | 높음               |
| **사용자 제어** | 속도/음성 조절 가능 | 고정               |
| **즉시성**      | 즉시 이용           | 파일 다운로드 필요 |
| **유지보수**    | 자동 업데이트       | 수동 재녹음 필요   |

#### 3.3 오디오 파일 지연 로딩 시스템 (권장)

**Phase 1 구현 옵션:**

**A. 지연 로딩 방식 (권장)**

**초기 설치:**

- **PWA 크기**: ~100MB (HTML + CSS + JS + 아이콘만)
- **설치 시간**: 30초-2분 (기존 30분-2시간 대비 대폭 단축)
- **즉시 사용**: 텍스트 읽기, 검색, 네비게이션 바로 가능

**오디오 다운로드 플로우:**

```javascript
// 의사코드: 오디오 플레이 요청 시
async function playAudio(book, chapter) {
  const audioUrl = `${AUDIO_SERVER}/audio/${book}-${chapter}.mp3`;
  const cacheKey = `audio-${book}-${chapter}`;

  // 1. 캐시 확인
  let audioBlob = await getFromCache(cacheKey);

  if (!audioBlob) {
    // 2. 다운로드 시작 (진행률 표시)
    showDownloadProgress(book, chapter);
    audioBlob = await downloadWithProgress(audioUrl);

    // 3. 캐시에 저장
    await saveToCache(cacheKey, audioBlob);
  }

  // 4. 재생
  playAudioBlob(audioBlob);
}
```

**사용자 경험:**

- **첫 재생**: "다운로드 중... (진행률 표시)" → 재생
- **재재생**: 즉시 재생 (캐시된 파일 사용)
- **오프라인**: 다운로드한 장만 재생 가능, 나머지는 "온라인 필요" 안내

**추가 기능:**

- **일괄 다운로드**: "이 책의 모든 장 다운로드" 버튼
- **저장소 관리**: 설정에서 다운로드한 오디오 목록 및 삭제 기능
- **스마트 캐싱**: 자주 듣는 장 우선 보관, 용량 초과 시 LRU 삭제
- **다운로드 우선순위**: 사용자가 다음에 들을 가능성이 높은 장 백그라운드 다운로드

**장점:**

- ✅ **초기 설치 시간 98% 단축** (30분 → 30초)
- ✅ **네트워크 데이터 절약** (사용자가 선택한 장만)
- ✅ **저장 공간 효율** (10GB → 사용자 선택적)
- ✅ **점진적 향상** (오디오 없어도 완전한 성경 앱)

**B. 전체 사전 다운로드 방식 (현재)**

- **복사 정책**: 존재하는 오디오 파일만 `output/pwa/audio/`로 복사
- **경로 업데이트**: HTML 내 오디오 경로를 PWA 구조에 맞게 자동 조정
- **캐시 전략**: 서비스 워커에서 오디오 파일을 Cache First 전략으로 처리

**Phase 2/3 확장 계획:**

- **다국어 오디오**: 영어 성경 오디오 파일 추가 고려
- **AI 음성 합성**: 고품질 TTS로 다국어 오디오 자동 생성
- **사용자 업로드**: 커뮤니티 기여 오디오 파일 시스템

### 4. CLI 실행 (parser, html_generator, pwa_builder)

별도 `main.py` 대신 각 모듈이 CLI를 제공합니다.

```bash
# 파서: 텍스트 → JSON (캐시/저장 지원)
python src/parser.py data/common-bible-kr.txt --save-json output/parsed_bible.json

# HTML 생성기: JSON → 장별 HTML (정적/오디오 경로 자동 보정, 복사 옵션)
python src/html_generator.py templates/chapter.html output/html/ \
  --json output/parsed_bible.json \
  --copy-static --copy-audio

# PWA 빌드: HTML → 완전한 PWA (매니페스트, 서비스 워커, 목차 포함)
python src/pwa_builder.py output/html/ output/pwa/ \
  --json output/parsed_bible.json \
  --manifest --service-worker --index
```

#### 4.1 PWA Builder CLI (pwa_builder.py)

`src/pwa_builder.py`는 PWA 빌드 오케스트레이션용 CLI를 제공합니다.

사용법 개요:

```bash
python src/pwa_builder.py <command> [options]
```

명령 목록:

- `build`: 완전한 PWA 빌드 실행
  - 옵션:
    - `--input-dir output/html` (HTML 파일들 위치)
    - `--output-dir output/pwa` (PWA 출력 위치)
    - `--json output/parsed_bible.json` (파싱 데이터)
    - `--template-dir templates` (템플릿 위치)
    - `--include-manifest` (매니페스트 생성)
    - `--include-service-worker` (서비스 워커 생성)
    - `--include-index` (목차 페이지 생성)
- `manifest`: PWA 매니페스트만 생성
  - 옵션:
    - `--output-file output/pwa/manifest.json`
    - `--app-name "공동번역성서"`
    - `--theme-color "#4CAF50"`
    - `--icon-dir static/icons`
- `service-worker`: 서비스 워커만 생성
  - 옵션:
    - `--output-file output/pwa/sw.js`
    - `--cache-strategy cache-first|network-first`
    - `--precache-files` (미리 캐시할 파일 목록)
- `index`: 목차 페이지만 생성
  - 옵션:
    - `--json output/parsed_bible.json` (필수)
    - `--template templates/index.html`
    - `--output output/pwa/index.html`
- `optimize`: 정적 자원 최적화
  - 옵션:
    - `--minify-css` (CSS 압축)
    - `--minify-js` (JavaScript 압축)
    - `--optimize-images` (이미지 최적화)
    - `--cache-bust` (캐시 버스팅 해시 추가)

예시:

```bash
# 1) 완전한 PWA 빌드 (모든 구성 요소 포함)
python src/pwa_builder.py build \
  --input-dir output/html --output-dir output/pwa \
  --json output/parsed_bible.json \
  --include-manifest --include-service-worker --include-index

# 2) 매니페스트만 생성
python src/pwa_builder.py manifest \
  --output-file output/pwa/manifest.json \
  --app-name "공동번역성서" --theme-color "#4CAF50"

# 3) 목차 페이지만 생성
python src/pwa_builder.py index \
  --json output/parsed_bible.json \
  --template templates/index.html \
  --output output/pwa/index.html

# 4) 정적 자원 최적화
python src/pwa_builder.py optimize \
  --minify-css --minify-js --optimize-images --cache-bust

# 5) 서비스 워커 생성 (캐시 우선 전략)
python src/pwa_builder.py service-worker \
  --output-file output/pwa/sw.js --cache-strategy cache-first
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
        self.chapter_template_path = "templates/chapter.html"
        self.index_template_path = "templates/index.html"
        self.manifest_template_path = "templates/manifest.json"
        self.sw_template_path = "templates/sw.js"

        # PWA 설정
        self.pwa_app_name = os.getenv('PWA_APP_NAME', '공동번역성서')
        self.pwa_short_name = os.getenv('PWA_SHORT_NAME', '공동번역성서')
        self.pwa_theme_color = os.getenv('PWA_THEME_COLOR', '#4CAF50')
        self.pwa_background_color = os.getenv('PWA_BACKGROUND_COLOR', '#FFFFFF')
        self.pwa_start_url = os.getenv('PWA_START_URL', 'index.html')
        self.pwa_display = os.getenv('PWA_DISPLAY', 'standalone')

        # 빌드 설정
        self.build_output_dir = os.getenv('BUILD_OUTPUT_DIR', 'output/pwa')
        self.enable_minification = os.getenv('ENABLE_MINIFICATION', 'false').lower() == 'true'
        self.cache_bust_enabled = os.getenv('CACHE_BUST_ENABLED', 'false').lower() == 'true'

        # 정적 자원 경로
        self.static_dir = "static"
        self.audio_dir = "data/audio"
        self.icons_dir = "static/icons"
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

<!-- 지연 로딩 오디오 플레이어 (권장 방식) -->
<div
  class="audio-player-container"
  data-book="${book_abbr}"
  data-chapter="${chapter_number}"
>
  <h2 class="screen-reader-text">성경 오디오</h2>

  <!-- 오디오 플레이어 (캐시된 경우) -->
  <audio class="bible-audio" aria-label="${audio_title}" style="display: none;">
    <p>브라우저가 오디오 재생을 지원하지 않습니다.</p>
  </audio>

  <!-- 다운로드 안함 상태 -->
  <div class="audio-not-downloaded">
    <button class="audio-play-btn" data-i18n="audio.playButton">
      <span aria-hidden="true">▶️</span> 오디오 재생
    </button>
    <p class="audio-notice" data-i18n="audio.downloadNotice">
      재생 시 오디오 파일을 다운로드합니다
    </p>
  </div>

  <!-- 다운로드 중 상태 -->
  <div class="audio-downloading" style="display: none;">
    <div class="download-progress">
      <span data-i18n="audio.downloading">다운로드 중...</span>
      <div class="progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <span class="progress-text">0%</span>
    </div>
    <button class="audio-cancel-btn" data-i18n="audio.cancel">취소</button>
  </div>

  <!-- 오프라인 안내 -->
  <div class="audio-offline-notice" style="display: none;">
    <p class="notice-text" aria-live="polite">
      <span class="icon" aria-hidden="true">📶</span>
      <span data-i18n="audio.offlineRequired"
        >오디오 재생을 위해 인터넷 연결이 필요합니다</span
      >
    </p>
    <p
      class="screen-reader-suggestion"
      data-i18n="audio.screenReaderSuggestion"
    >
      스크린리더를 사용하여 텍스트를 음성으로 들으실 수 있습니다
    </p>
  </div>

  <!-- 일괄 다운로드 옵션 -->
  <div class="bulk-download-option">
    <button class="bulk-download-btn" data-i18n="audio.downloadAllChapters">
      <span aria-hidden="true">📥</span> 이 책의 모든 장 다운로드
    </button>
  </div>
</div>

<!-- 성경 본문 -->
<article id="${chapter_id}">
  <h1>${book_name} ${chapter_number}장</h1>
  ${verses_content}
</article>

<script src="/static/verse-navigator.js"></script>
```

---

## 🔍 기본 검색 기능 (Phase 1)

### 개요

- **전역 검색 인덱스**: 전체 성경 텍스트 검색 지원 (기본 활성화)
- **페이지 내 검색**: 현재 장 내 실시간 하이라이트
- **책 이름 검색**: 한영 혼용 검색 (`book_mappings.json`의 `aliases` 활용)
- **검색 UI**: 다국어 지원 및 기본 자동완성

### 핵심 기능

#### 1. 페이지 내 검색

- **현재 장 내 텍스트 검색**: 실시간 하이라이트
- **절 번호 검색**: "창세 1:3" 형태 직접 이동
- **단어 검색**: 절 내용에서 키워드 찾기

#### 2. 전역 텍스트 검색

- **전체 성경 검색**: 모든 책/장/절에서 키워드 검색
- **검색 결과**: 매칭된 구절 목록 + 컨텍스트 미리보기
- **성능 최적화**: JSON 인덱스 기반 빠른 검색
- **하이라이트**: 검색어 강조 표시

#### 3. 책 이름 다국어 검색

- **한글 검색**: "창세기", "창세", "창" → 창세기
- **영문 검색**: "Genesis" → 창세기
- **별칭 지원**: `aliases` 배열 활용한 유연한 매칭
- **자동완성**: 입력 시 책 이름 제안

#### 4. 검색 UI 컴포넌트

- **검색 입력창**: 통합 검색 인터페이스
- **결과 표시**: 매칭된 구절 또는 책 링크
- **다국어 플레이스홀더**: 언어별 안내 텍스트

### 구현 파일

- `static/verse-navigator.js`: 전역 검색 로직 및 UI
- `static/book-search.js`: 책 이름 검색 전용 모듈 (새로 추가)
- `output/html/static/search/search-index.json`: 전체 성경 검색 인덱스 파일

**검색 인덱스 구조:**

```json
[
  {
    "i": "gen-1-1", // id: 구절 고유 식별자 (영어약칭-장-절, 언어 중립)
    "t": "한처음에 하느님께서 하늘과 땅을 지어내셨다.", // text: 절 본문 텍스트 (언어별)
    "h": "genesis-1.html#gen-1-1", // href: HTML 파일 경로 + 앵커 링크 (언어 중립 앵커)
    "b": "gen", // book: 책 약칭 (영어 기반, 언어 중립)
    "c": 1, // chapter: 장 번호 (정렬/필터링용)
    "v": 1, // verse: 절 번호 (정렬/필터링용)
    "bo": 0 // book_order: 책 순서 인덱스 (성경 순서 정렬용)
  }
]
```

**키 설명:**

- `i` (id): 구절의 고유 식별자, 검색 결과 중복 제거용
- `t` (text): 실제 검색 대상이 되는 절 본문 내용
- `h` (href): 검색 결과 클릭 시 이동할 링크 (파일 + 앵커)
- `b` (book): 책별 필터링 및 검색 범위 지정용
- `c` (chapter): 장별 정렬 및 컨텍스트 표시용
- `v` (verse): 절별 정렬 및 정확한 위치 표시용
- `bo` (book_order): 성경 순서대로 검색 결과 정렬용 (창세기=0, 출애굽기=1...)

### 🌐 국제화/현지화 고려사항

**Phase 1 언어 중립화:**

```json
[
  {
    "i": "gen-1-1", // 영어 약칭 기반 ID (언어 중립)
    "t": "한처음에 하느님께서 하늘과 땅을 지어내셨다.", // 한국어 텍스트
    "h": "genesis-1.html#gen-1-1", // 언어 중립 앵커
    "b": "gen", // 영어 약칭 (언어 중립, book_mappings.json의 english_name 기반)
    "c": 1,
    "v": 1,
    "bo": 0
  }
]
```

**Phase 2+ 다국어 검색 인덱스 구조:**

```json
// search-index-ko.json (한국어)
[
  {
    "i": "gen-1-1",
    "t": "한처음에 하느님께서 하늘과 땅을 지어내셨다.",
    "h": "ko/genesis-1.html#gen-1-1",
    "b": "gen",
    "c": 1, "v": 1, "bo": 0
  }
]

// search-index-en.json (영어)
[
  {
    "i": "gen-1-1",
    "t": "In the beginning God created the heavens and the earth.",
    "h": "en/genesis-1.html#gen-1-1",
    "b": "gen",
    "c": 1, "v": 1, "bo": 0
  }
]
```

**언어 중립 키 사용의 장점:**

- ✅ **ID 일관성**: 모든 언어에서 동일한 구절 ID
- ✅ **크로스 링크**: 언어 간 구절 매핑 용이
- ✅ **URL 안정성**: 언어 변경 시에도 앵커 링크 유지
- ✅ **API 호환성**: 다국어 검색 API에서 일관된 식별자

- **Web Worker 지원**: 대용량 검색에서 UI 블록킹 방지 (Phase 2+ 확장)

### 향후 확장 준비

- 검색 인터페이스 표준화로 Phase 2 전역 검색 연동 용이
- `book_mappings.json` 구조 확장 지원
- Web Worker 아키텍처 도입 준비

---

## 🧭 기본 네비게이션 (Phase 1)

### 개요

- 상단에 기본적인 네비게이션 제공: 목차 링크 + 현재 위치 표시
- 브레드크럼 형태로 "목차 > 구분 > 책 > 장" 표시
- 다국어 지원 (구분명, 버튼 텍스트 등)

### 기본 구성 요소

#### 1. 목차 링크

- **"목차" 버튼**: `index.html`로 이동
- **아이콘**: 홈 아이콘 또는 책 아이콘
- **다국어**: "목차"(한국어) / "Contents"(영어)

#### 2. 현재 위치 표시

- **구분**: "구약" / "Old Testament" (읽기 전용)
- **책 이름**: "창세기" / "Genesis" (읽기 전용)
- **장 번호**: "1장" / "Chapter 1" (읽기 전용)
- **분리자**: " > " 또는 " / "

#### 3. 간단한 이동 링크

- **이전/다음 장**: 순차 네비게이션
- **같은 책 내 장 목록**: 간단한 드롭다운 (정적)

### 레이아웃

- `.page-wrap` 내부 상단 고정
- 모바일에서도 한 줄로 표시 (필요시 텍스트 축약)
- 검색창과 본문 사이에 배치

### Phase 1 범위

- 정적 데이터 기반 네비게이션
- 다국어 텍스트 지원
- 기본적인 접근성 (키보드 네비게이션)

### 향후 확장 준비

- 동적 드롭다운 인터페이스 준비
- 모바일 바텀시트 UI 확장 가능
- API 연동 구조 마련

---

## 🌍 UI 다국어화 시스템 (Phase 1)

### 개요

- 한국어 공동번역성서 본문은 유지하면서 인터페이스만 다국어 지원
- 초기 지원 언어: 한국어(기본) + 영어
- 확장 가능한 구조로 설계하여 향후 다른 언어 추가 용이

### 파일 구조

```
static/i18n/
├── ko.json          # 한국어 UI 텍스트
├── en.json          # 영어 UI 텍스트
├── i18n-loader.js   # 언어 로더 스크립트
└── language-detector.js  # 브라우저 언어 감지
```

### 다국어 텍스트 분류

#### 1. 네비게이션 & 버튼

**한국어 버전 (`static/i18n/ko.json`):**

```json
{
  "nav": {
    "contents": "목차",
    "search": "검색",
    "settings": "설정",
    "language": "언어"
  },
  "buttons": {
    "play": "재생",
    "pause": "일시 정지",
    "download": "다운로드",
    "bookmark": "즐겨찾기"
  }
}
```

**영어 버전 (`static/i18n/en.json`):**

```json
{
  "nav": {
    "contents": "Contents",
    "search": "Search",
    "settings": "Settings",
    "language": "Language"
  },
  "buttons": {
    "play": "Play",
    "pause": "Pause",
    "download": "Download",
    "bookmark": "Bookmark"
  }
}
```

#### 2. 검색 관련

**한국어 버전 (`static/i18n/ko.json`):**

```json
{
  "search": {
    "placeholder": "구절 검색 (예: 창세 1:1)",
    "noResults": "검색 결과가 없습니다.",
    "searching": "검색 중...",
    "bookSearch": "책 이름으로 검색"
  }
}
```

**영어 버전 (`static/i18n/en.json`):**

```json
{
  "search": {
    "placeholder": "Search verses (e.g., Genesis 1:1)",
    "noResults": "No search results found.",
    "searching": "Searching...",
    "bookSearch": "Search by book name"
  }
}
```

#### 3. 상태 메시지 & 오디오

**한국어 버전 (`static/i18n/ko.json`):**

```json
{
  "status": {
    "audioLoading": "오디오 로딩 중...",
    "audioUnavailable": "오디오를 준비하고 있습니다.",
    "offline": "오프라인 모드",
    "syncing": "동기화 중..."
  },
  "audio": {
    "playButton": "오디오 재생",
    "downloadNotice": "재생 시 오디오 파일을 다운로드합니다.",
    "downloading": "다운로드 중...",
    "cancel": "취소",
    "offlineRequired": "오디오 재생을 위해 인터넷 연결이 필요합니다.",
    "downloadAllChapters": "이 책의 모든 장 다운로드",
    "downloadComplete": "다운로드 완료",
    "downloadFailed": "다운로드 실패",
    "storageManagement": "저장소 관리",
    "screenReaderSuggestion": "스크린리더를 사용하여 텍스트를 음성으로 들으실 수 있습니다.",
    "unavailable": "이 장의 오디오는 준비 중입니다."
  }
}
```

**영어 버전 (`static/i18n/en.json`):**

```json
{
  "status": {
    "audioLoading": "Loading audio...",
    "audioUnavailable": "Audio is being prepared.",
    "offline": "Offline mode",
    "syncing": "Syncing..."
  },
  "audio": {
    "playButton": "Play Audio",
    "downloadNotice": "Audio will be downloaded when you play.",
    "downloading": "Downloading...",
    "cancel": "Cancel",
    "offlineRequired": "Internet connection required for audio playback.",
    "downloadAllChapters": "Download All Chapters",
    "downloadComplete": "Download Complete",
    "downloadFailed": "Download Failed",
    "storageManagement": "Storage Management",
    "screenReaderSuggestion": "You can use a screen reader to listen to the text.",
    "unavailable": "Audio for this chapter is not available."
  }
}
```

#### 4. 브레드크럼 & 네비게이션

**한국어 버전 (`static/i18n/ko.json`):**

```json
{
  "breadcrumb": {
    "home": "목차",
    "oldTestament": "구약",
    "newTestament": "신약",
    "apocrypha": "외경",
    "chapter": "장"
  },
  "navigation": {
    "previousChapter": "이전",
    "nextChapter": "다음",
    "backToContents": "목차로 돌아가기"
  }
}
```

**영어 버전 (`static/i18n/en.json`):**

```json
{
  "breadcrumb": {
    "home": "Contents",
    "oldTestament": "Old Testament",
    "newTestament": "New Testament",
    "apocrypha": "Apocrypha",
    "chapter": "Chapter"
  },
  "navigation": {
    "previousChapter": "Previous",
    "nextChapter": "Next",
    "backToContents": "Back to Contents"
  }
}
```

### 메타데이터 다국어화

#### book_mappings.json 확장 (Phase 2+ 계획)

```json
{
  "abbr": "창세",
  "names": {
    "ko": "창세기",
    "en": "Genesis"
  },
  "division": {
    "ko": "구약",
    "en": "Old Testament"
  },
  "aliases": ["창세", "창세기", "창", "Genesis"]
}
```

**참고**: 현재 Phase 1에서는 `book_mappings.json`에서 `"division": "구약"` 형태를 사용하고, `parser.py`가 `parsed_bible.json` 생성 시 `"division_ko": "구약", "division_en": "Old Testament"` 형태로 Chapter 객체에 확장 저장합니다.

### 언어 선택 시스템

#### 1. 언어 감지

- **브라우저 언어 감지**: `navigator.language` 활용
- **기본값**: 한국어 (`ko`)
- **저장소**: `localStorage.getItem('bible-language')`

#### 2. 언어 선택 UI

- **위치**: 헤더 우상단
- **형태**: 드롭다운 또는 토글 버튼
- **표시**: 국기 아이콘 + 언어명 ("한국어", "English")

#### 3. 언어 전환 로직

```javascript
// 의사코드
function switchLanguage(langCode) {
  // 1. 언어 파일 로드
  const i18nData = await loadLanguage(langCode);

  // 2. UI 텍스트 업데이트
  updateUITexts(i18nData);

  // 3. 메타데이터 업데이트
  updateBookNames(langCode);

  // 4. 설정 저장
  localStorage.setItem('bible-language', langCode);
}
```

### PWA 매니페스트 다국어화

#### manifest.json 구조

```json
{
  "name": "공동번역성서",
  "short_name": "공동번역성서",
  "lang": "ko",
  "dir": "ltr",
  "locales": {
    "en": {
      "name": "Korean Common Bible",
      "short_name": "Korean Bible"
    }
  }
}
```

### 구현 우선순위

#### Week 1-2: 기본 구조

- [ ] i18n 파일 구조 생성
- [ ] 언어 로더 스크립트 구현
- [ ] 기본 UI 텍스트 추출 (한국어)

#### Week 3-4: 영어 지원

- [ ] 영어 번역 파일 작성
- [ ] 언어 선택 UI 구현
- [ ] book_mappings.json 확장

#### Week 5-6: 통합 & 최적화

- [ ] 검색 다국어 연동
- [ ] PWA 매니페스트 다국어화
- [ ] 성능 최적화 및 테스트

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
# .env 파일을 편집하여 PWA 설정 정보 입력
```

### 2. 실행

```bash
# 각 모듈별 실행
# 1. 텍스트 파싱
python src/parser.py data/common-bible-kr.txt --save-json output/parsed_bible.json

# 2. HTML 생성
python src/html_generator.py templates/chapter.html output/html/

# 3. PWA 빌드
python src/pwa_builder.py build --input-dir output/html --output-dir output/pwa --json output/parsed_bible.json --include-manifest --include-service-worker --include-index

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
                "abbr": "창세",
                "korean_name": "창세기",
                "english_name": "Genesis",
                "division": "구약",
                "aliases": ["창세", "창세기", "창"]
            },
            {
                "abbr": "마태",
                "korean_name": "마태복음",
                "english_name": "Matthew",
                "division": "신약",
                "aliases": ["마태", "마태복음", "마태오복음", "마"]
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
        assert parser.book_mappings["창세"]["korean_name"] == "창세기"
        assert parser.book_mappings["창세"]["division"] == "구약"
        assert parser.book_mappings["마태"]["division"] == "신약"

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

### 3. PWA 빌드 테스트 (tests/test_pwa_builder.py)

```python
import pytest
import tempfile
import json
import os
from src.pwa_builder import PWABuilder, IndexGenerator, ManifestGenerator
from src.parser import Chapter, Verse

class TestPWABuilder:
    """PWA 빌드 도구 테스트"""

    @pytest.fixture
    def sample_chapters(self):
        """테스트용 장 데이터"""
        return [
            Chapter(book_name="창세기", book_abbr="창세", chapter_number=1,
                   verses=[Verse(1, "태초에 하나님이 천지를 창조하시니라", False)]),
            Chapter(book_name="마태복음", book_abbr="마태", chapter_number=1,
                   verses=[Verse(1, "아브라함과 다윗의 후손", False)])
        ]

    def test_index_generation(self, sample_chapters):
        """목차 페이지 생성 테스트"""
        generator = IndexGenerator()
        divisions = generator.group_by_division(sample_chapters)

        assert "구약" in divisions
        assert "신약" in divisions
        assert len(divisions["구약"]) == 1
        assert len(divisions["신약"]) == 1

    def test_manifest_generation(self):
        """PWA 매니페스트 생성 테스트"""
        from src.pwa_builder import PWAConfig
        config = PWAConfig()
        generator = ManifestGenerator()
        manifest_json = generator.generate_manifest(config)

        manifest = json.loads(manifest_json)
        assert manifest["name"] == "공동번역성서"
        assert manifest["start_url"] == "index.html"
        assert manifest["display"] == "standalone"
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
        monkeypatch.setenv("PWA_APP_NAME", "테스트 성경")
        monkeypatch.setenv("PWA_THEME_COLOR", "#FF0000")
        monkeypatch.setenv("BUILD_OUTPUT_DIR", "custom/output")
        monkeypatch.setenv("ENABLE_MINIFICATION", "true")

        config = Config()

        assert config.pwa_app_name == "테스트 성경"
        assert config.pwa_theme_color == "#FF0000"
        assert config.build_output_dir == "custom/output"
        assert config.enable_minification == True

    def test_config_defaults(self):
        """기본값 테스트"""
        config = Config()

        assert config.pwa_app_name == "공동번역성서"
        assert config.pwa_theme_color == "#4CAF50"
        assert config.build_output_dir == "output/pwa"
        assert config.pwa_display == "standalone"
        assert config.enable_minification == False

    def test_config_file_paths(self):
        """파일 경로 설정 테스트"""
        config = Config()

        assert config.chapter_template_path == "templates/chapter.html"
        assert config.index_template_path == "templates/index.html"
        assert config.manifest_template_path == "templates/manifest.json"
        assert config.static_dir == "static"
```

### 5. 통합 테스트 (tests/test_integration.py)

```python
import pytest
import tempfile
import json
import os
import shutil
from src.parser import BibleParser
from src.html_generator import HtmlGenerator
from src.pwa_builder import PWABuilder, PWAConfig

class TestIntegration:
    """통합 테스트"""

    @pytest.fixture
    def full_setup(self):
        """전체 시스템 설정"""
        # 책 매핑 파일
        book_mappings = [{"abbr": "창세", "korean_name": "창세기", "english_name": "Genesis", "division": "구약", "aliases": ["창세", "창세기", "창"]}]
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(book_mappings, f, ensure_ascii=False)
            mappings_path = f.name

        # 텍스트 파일
        text_content = "창세 1:1\n1 태초에 하나님이 천지를 창조하시니라\n"
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write(text_content)
            text_path = f.name

        # 템플릿 파일들
        chapter_template = "<h1>${book_name} ${chapter_number}장</h1>${verses_content}"
        index_template = "<html><body><h1>성경 목차</h1></body></html>"

        # 임시 디렉토리 생성
        temp_dir = tempfile.mkdtemp()

        with open(os.path.join(temp_dir, 'chapter.html'), 'w', encoding='utf-8') as f:
            f.write(chapter_template)
        with open(os.path.join(temp_dir, 'index.html'), 'w', encoding='utf-8') as f:
            f.write(index_template)

        yield {
            'mappings_path': mappings_path,
            'text_path': text_path,
            'template_dir': temp_dir
        }

        # 정리
        os.unlink(mappings_path)
        os.unlink(text_path)
        shutil.rmtree(temp_dir)

    def test_full_pwa_workflow(self, full_setup):
        """전체 PWA 워크플로우 테스트 (파싱 → HTML 생성 → PWA 빌드)"""
        # 1. 파싱
        parser = BibleParser(full_setup['mappings_path'])
        chapters = parser.parse_file(full_setup['text_path'])

        # 2. HTML 생성
        html_generator = HtmlGenerator(os.path.join(full_setup['template_dir'], 'chapter.html'))
        html_content = html_generator.generate_chapter_html(chapters[0])

        # 3. PWA 빌드
        config = PWAConfig()
        pwa_builder = PWABuilder(config)

        # 임시 출력 디렉토리
        output_dir = tempfile.mkdtemp()
        try:
            pwa_builder.build_pwa(chapters, output_dir)

            # PWA 필수 파일들 생성 확인
            assert os.path.exists(os.path.join(output_dir, 'index.html'))
            assert os.path.exists(os.path.join(output_dir, 'manifest.json'))
            assert os.path.exists(os.path.join(output_dir, 'sw.js'))

        finally:
            shutil.rmtree(output_dir)

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

### 1. Content Security Policy (CSP)

**HTML 템플릿에 필수 강화된 CSP 헤더 포함:**

```html
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'self';
  script-src 'self' 'sha384-[SCRIPT_HASH_1]' 'sha384-[SCRIPT_HASH_2]';
  style-src 'self' 'sha384-[STYLE_HASH_1]' 'sha384-[STYLE_HASH_2]';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self';
  media-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  require-sri-for script style;
  upgrade-insecure-requests;
  block-all-mixed-content;
"
/>
```

**개발 환경용 CSP (덜 엄격):**

```html
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' ws: wss:;
  media-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
"
/>
```

**강화된 CSP 정책 설명:**

**기본 보안 지시어:**

- `default-src 'self'`: 모든 리소스는 동일 출처만 허용
- `script-src 'self' 'sha384-[HASH]'`: 해시 검증된 스크립트만 허용 (XSS 완전 차단)
- `style-src 'self' 'sha384-[HASH]'`: 해시 검증된 스타일시트만 허용 (인라인 CSS 차단)
- `connect-src 'self'`: 오디오 파일 등 fetch 요청을 동일 출처로 제한
- `font-src 'self'`: 폰트는 로컬만 허용 (CDN 차단)

**고급 보안 지시어:**

- `require-sri-for script style`: SRI 해시 없는 스크립트/스타일 로드 차단
- `upgrade-insecure-requests`: HTTP 요청을 자동으로 HTTPS로 변환
- `block-all-mixed-content`: HTTPS 페이지에서 HTTP 리소스 완전 차단
- `object-src 'none'`: Flash, 플러그인 등 오브젝트 완전 차단
- `base-uri 'self'`: base 태그의 href를 동일 출처로 제한
- `form-action 'self'`: 폼 제출을 동일 출처로 제한
- `frame-ancestors 'none'`: 다른 사이트에서 iframe 삽입 차단

### 서브리소스 무결성 (SRI) 구현

**빌드 시 SRI 해시 자동 생성:**

```python
import hashlib
import base64
import re

def generate_sri_hash(file_path):
    """파일의 SRI 해시 생성"""
    with open(file_path, 'rb') as f:
        content = f.read()

    hash_digest = hashlib.sha384(content).digest()
    hash_b64 = base64.b64encode(hash_digest).decode('utf-8')
    return f"sha384-{hash_b64}"

def update_html_with_sri(html_content, sri_hashes):
    """HTML 템플릿에 SRI 해시 주입"""
    # CSS 파일에 SRI 추가
    css_pattern = r'<link([^>]*?)href="([^"]*\.css)"([^>]*?)>'
    css_replacement = lambda m: f'<link{m.group(1)}href="{m.group(2)}" integrity="{sri_hashes.get(m.group(2), "")}" crossorigin="anonymous"{m.group(3)}>'
    html_content = re.sub(css_pattern, css_replacement, html_content)

    # JS 파일에 SRI 추가
    js_pattern = r'<script([^>]*?)src="([^"]*\.js)"([^>]*?)>'
    js_replacement = lambda m: f'<script{m.group(1)}src="{m.group(2)}" integrity="{sri_hashes.get(m.group(2), "")}" crossorigin="anonymous"{m.group(3)}>'
    html_content = re.sub(js_pattern, js_replacement, html_content)

    return html_content

# 빌드 프로세스 예시
def build_with_sri():
    # 1. SRI 해시 생성
    sri_hashes = {
        './static/verse-style.css': generate_sri_hash('static/verse-style.css'),
        './static/verse-navigator.js': generate_sri_hash('static/verse-navigator.js'),
        './static/book-search.js': generate_sri_hash('static/book-search.js')
    }

    # 2. CSP 헤더에 해시 추가
    csp_script_hashes = " ".join([f"'{hash}'" for hash in sri_hashes.values() if 'js' in hash])
    csp_style_hashes = " ".join([f"'{hash}'" for hash in sri_hashes.values() if 'css' in hash])

    # 3. HTML 템플릿 업데이트
    with open('templates/chapter.html', 'r') as f:
        html_content = f.read()

    html_content = update_html_with_sri(html_content, sri_hashes)

    # 4. CSP 헤더 업데이트
    csp_content = f"""
    default-src 'self';
    script-src 'self' {csp_script_hashes};
    style-src 'self' {csp_style_hashes};
    require-sri-for script style;
    upgrade-insecure-requests;
    """

    return html_content, csp_content
```

**HTML 템플릿 예시 (SRI 적용):**

```html
<!-- CSS with SRI -->
<link
  rel="stylesheet"
  href="./static/verse-style.css"
  integrity="sha384-ABC123..."
  crossorigin="anonymous"
/>

<!-- JavaScript with SRI -->
<script
  src="./static/verse-navigator.js"
  integrity="sha384-DEF456..."
  crossorigin="anonymous"
></script>

<script
  src="./static/book-search.js"
  integrity="sha384-GHI789..."
  crossorigin="anonymous"
></script>
```

**폰트 정책 (보안 vs 실용성):**

**Option A: 최고 보안 (권장)**

```html
<!-- 로컬 폰트만 사용 -->
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'self';
  font-src 'self';
  ...
"
/>
```

**Option B: 신뢰할 수 있는 폰트 CDN 허용**

```html
<!-- Pretendard CDN 허용 (제한적) -->
<meta
  http-equiv="Content-Security-Policy"
  content="
  default-src 'self';
  font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  ...
"
/>
```

### Pretendard 폰트 구현 방법

#### **방법 1: 로컬 폰트 (권장 - 최고 보안 + 완전한 오프라인)**

**빌드 시 폰트 다운로드:**

```bash
# 폰트 다운로드 스크립트
mkdir -p static/fonts
wget -O static/fonts/Pretendard-Regular.woff2 \
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.8/dist/web/static/woff2/Pretendard-Regular.woff2"
```

**CSS 파일 (`static/fonts.css`):**

```css
@font-face {
  font-family: "Pretendard";
  src: url("./fonts/Pretendard-Regular.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}

body {
  font-family: "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, Roboto,
    "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic",
    "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", sans-serif;
}
```

#### **방법 2: CDN 폰트 (실용적 - 네트워크 의존)**

**HTML 템플릿:**

```html
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.8/dist/web/static/pretendard.css"
/>
```

**폰트 CDN 보안 고려사항:**

| 측면         | 로컬 폰트 (Option A)       | CDN 폰트 (Option B)              |
| ------------ | -------------------------- | -------------------------------- |
| **보안**     | ✅ 최고 (외부 의존성 없음) | ⚠️ 제한적 (신뢰할 수 있는 CDN만) |
| **오프라인** | ✅ 완전 지원               | ❌ 첫 로딩 시 네트워크 필요      |
| **성능**     | ✅ 즉시 로딩               | ⚠️ CDN 지연 가능                 |
| **용량**     | ❌ PWA 크기 증가 (~2-3MB)  | ✅ 초기 PWA 경량화               |
| **캐싱**     | ✅ 서비스 워커 캐싱        | ✅ 브라우저 캐싱 (CDN)           |
| **업데이트** | ❌ 수동 업데이트           | ✅ 자동 업데이트                 |

#### **Phase 1 권장사항: 하이브리드 접근**

```css
/* 로컬 폰트 + CDN fallback */
@font-face {
  font-family: "Pretendard";
  src: url("./fonts/Pretendard-Regular.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}

/* CDN이 실패해도 시스템 폰트로 대체 */
body {
  font-family: "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, "Apple SD Gothic Neo",
    "Noto Sans KR", sans-serif;
}
```

**빌드 프로세스에 폰트 다운로드 포함:**

```python
def download_fonts():
    """빌드 시 Pretendard 폰트 자동 다운로드"""
    font_files = [
        "Pretendard-Regular.woff2",
        "Pretendard-Medium.woff2",
        "Pretendard-Bold.woff2"
    ]

    for font in font_files:
        url = f"https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.8/dist/web/static/woff2/{font}"
        download_to_static(url, f"fonts/{font}")
```

**최종 권장**: **로컬 폰트 (Option A)** - PWA의 완전한 오프라인 지원과 보안을 위해

### 2. 정적 자원 보안

**로컬 파일만 허용:**

```python
def validate_resource_path(path: str) -> bool:
    """보안 검증: 로컬 파일 경로만 허용"""
    # 외부 URL 차단
    if path.startswith(('http://', 'https://', '//')):
        raise SecurityError("외부 URL은 허용되지 않습니다")

    # 경로 순회 공격 방지
    if '..' in path or path.startswith('/'):
        raise SecurityError("상위 디렉토리 접근이 감지되었습니다")

    # 허용된 확장자만
    allowed_extensions = {'.css', '.js', '.mp3', '.png', '.jpg', '.webp'}
    if not any(path.endswith(ext) for ext in allowed_extensions):
        raise SecurityError("허용되지 않은 파일 형식입니다")

    return True
```

### 3. 오디오 파일 지연 로딩 보안

**HTTPS 필수 및 동일 출처 정책:**

```javascript
// 보안 강화된 오디오 다운로드
async function downloadAudioSecurely(book, chapter) {
  // 1. HTTPS 확인
  if (location.protocol !== "https:") {
    throw new Error("오디오 다운로드는 HTTPS에서만 가능합니다");
  }

  // 2. 동일 출처 URL만 허용
  const audioUrl = `./audio/${book}-${chapter}.mp3`; // 상대 경로만

  // 3. 검증된 fetch 요청
  const response = await fetch(audioUrl, {
    method: "GET",
    credentials: "same-origin", // 쿠키 등 인증 정보 제한
    cache: "default",
  });

  // 4. 응답 타입 검증
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("audio/")
  ) {
    throw new Error("유효하지 않은 오디오 파일입니다");
  }

  return response.blob();
}
```

### 4. 서비스 워커 보안

**캐시 보안 및 업데이트 정책:**

```javascript
// sw.js 보안 설정
const CACHE_NAME = "bible-pwa-v1";
const ALLOWED_ORIGINS = [self.location.origin];

self.addEventListener("fetch", (event) => {
  // 1. 동일 출처만 캐싱
  if (!ALLOWED_ORIGINS.includes(new URL(event.request.url).origin)) {
    return; // 외부 요청은 처리하지 않음
  }

  // 2. 민감한 API 엔드포인트 캐싱 방지
  if (
    event.request.url.includes("/api/") ||
    event.request.url.includes("/admin/")
  ) {
    return fetch(event.request); // 캐시 없이 직접 요청
  }

  // 3. 안전한 캐시 전략
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
```

### 5. 입력 검증 및 XSS 방지

**사용자 입력 검증:**

```javascript
function sanitizeSearchQuery(query) {
  // HTML 태그 제거
  const sanitized = query
    .replace(/<[^>]*>/g, "") // HTML 태그 제거
    .replace(/[<>"'&]/g, (match) => {
      // 특수문자 이스케이프
      const entities = {
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#x27;",
        "&": "&amp;",
      };
      return entities[match];
    })
    .trim()
    .substring(0, 100); // 길이 제한

  return sanitized;
}
```

### 6. PWA 필수 보안 요구사항

1. **HTTPS 필수**: PWA는 HTTPS 환경에서만 완전 동작 (서비스 워커 제약)
2. **매니페스트 검증**: start_url, scope가 동일 출처인지 확인
3. **아이콘 보안**: 신뢰할 수 있는 출처의 아이콘만 사용
4. **업데이트 보안**: 서비스 워커 업데이트 시 무결성 검증

### 7. 런타임 보안 검증

**빌드 시 보안 체크:**

```python
def security_audit():
    """빌드 시 보안 검증"""
    checks = [
        validate_no_external_resources(),
        validate_csp_headers(),
        validate_sri_implementation(),   # SRI 구현 검증 추가
        validate_font_policy(),
        validate_file_permissions(),
        validate_manifest_security(),
        scan_for_vulnerabilities()
    ]

    if not all(checks):
        raise SecurityError("보안 검증 실패")

def validate_font_policy():
    """폰트 정책 검증"""
    # 1. 로컬 폰트 파일 존재 확인
    required_fonts = [
        "static/fonts/Pretendard-Regular.woff2",
        "static/fonts/Pretendard-Medium.woff2",
        "static/fonts/Pretendard-Bold.woff2"
    ]

    for font_path in required_fonts:
        if not os.path.exists(font_path):
            raise SecurityError(f"필수 폰트 파일이 없습니다: {font_path}")

    # 2. CSS에서 외부 폰트 URL 검사
    css_files = glob.glob("static/**/*.css", recursive=True)
    for css_file in css_files:
        with open(css_file, 'r', encoding='utf-8') as f:
            content = f.read()
            if re.search(r'@import.*url\(["\']?https?://', content):
                raise SecurityError(f"외부 폰트 import 발견: {css_file}")

    return True

def validate_sri_implementation():
    """서브리소스 무결성 (SRI) 구현 검증"""
    import glob
    import re

    # 1. HTML 파일에서 SRI 속성 확인
    html_files = glob.glob("output/**/*.html", recursive=True)
    for html_file in html_files:
        with open(html_file, 'r', encoding='utf-8') as f:
            content = f.read()

        # CSS 링크에 integrity 속성 확인
        css_links = re.findall(r'<link[^>]*?href="[^"]*\.css"[^>]*?>', content)
        for link in css_links:
            if 'integrity=' not in link:
                raise SecurityError(f"CSS 파일에 SRI 해시가 없습니다: {html_file}")

        # 스크립트에 integrity 속성 확인
        script_tags = re.findall(r'<script[^>]*?src="[^"]*\.js"[^>]*?>', content)
        for script in script_tags:
            if 'integrity=' not in script:
                raise SecurityError(f"JavaScript 파일에 SRI 해시가 없습니다: {html_file}")

    # 2. CSP 헤더에 require-sri-for 지시어 확인
    for html_file in html_files:
        with open(html_file, 'r', encoding='utf-8') as f:
            content = f.read()

        if 'require-sri-for script style' not in content:
            raise SecurityError(f"CSP에 require-sri-for 지시어가 없습니다: {html_file}")

    # 3. SRI 해시 형식 검증
    sri_pattern = r'integrity="sha384-[A-Za-z0-9+/]{64}"'
    for html_file in html_files:
        with open(html_file, 'r', encoding='utf-8') as f:
            content = f.read()

        integrity_attrs = re.findall(r'integrity="([^"]*)"', content)
        for attr in integrity_attrs:
            if not re.match(r'sha384-[A-Za-z0-9+/]{64}', attr):
                raise SecurityError(f"잘못된 SRI 해시 형식: {attr} in {html_file}")

    return True
```

---

## 🛠️ 빌드 & 배포 개요

### 빌드 프로세스 플로우

```
Input Data → Parser → JSON Cache → PWA Builder → Static Output
    ↓           ↓         ↓            ↓            ↓
원본 텍스트   구조화    검색인덱스   HTML/CSS/JS   배포 준비
```

**주요 단계:**

1. **파싱 단계**: `parser.py` → `output/parsed_bible.json`
2. **인덱스 생성**: 검색 인덱스 및 메타데이터 생성
3. **PWA 빌드**: HTML 페이지, 매니페스트, 서비스워커 생성
4. **보안 검증**: SRI 해시, CSP 헤더, 취약점 스캔
5. **최적화**: 압축, 캐싱 전략 적용
6. **배포**: 정적 파일 호스팅 환경으로 업로드

### 환경별 빌드 구성

| 환경         | CSP 정책    | SRI     | 압축 | 디버깅 |
| ------------ | ----------- | ------- | ---- | ------ |
| **개발**     | 관대한 정책 | 선택적  | ❌   | ✅     |
| **스테이징** | 중간 정책   | ✅      | ✅   | 제한적 |
| **프로덕션** | 엄격 정책   | ✅ 필수 | ✅   | ❌     |

### 보안 빌드 체크포인트

✅ **빌드 단계별 보안 검증** (이미 구현됨)

```python
def security_audit():
    checks = [
        validate_sri_implementation(),
        validate_csp_headers(),
        validate_font_policy(),
        # ... 기타 보안 검사
    ]
```

**상세한 빌드/배포 절차는 → [deployment.md](deployment.md) 참조**

---

## ✅ Phase 1 체크리스트

### 핵심 기능

- [ ] 텍스트 파일 파싱 (장/절/단락 구분)
- [ ] 접근성 HTML 생성 (aria-hidden, 고유 ID)
- [ ] **오디오 지연 로딩 시스템** (한국어만, 다른 언어는 스크린리더 안내)
  - [ ] 동적 다운로드 및 Cache API 저장
  - [ ] 다운로드 진행률 표시 UI
  - [ ] 오프라인 상태 감지 및 안내
  - [ ] 일괄 다운로드 기능
- [ ] PWA 매니페스트 생성 (기본)
- [ ] 서비스 워커 구현 (기본 오프라인 캐싱)
- [ ] 목차 페이지 자동 생성

### 다국어화 (Phase 1 핵심)

- [ ] UI 다국어화 시스템 구축 (`static/i18n/`)
- [ ] **한국어/영어 UI 텍스트 파일 작성** - 네비게이션, 검색, 오디오, 브레드크럼 등 모든 UI 요소
- [ ] 언어 선택 UI 구현 (헤더 드롭다운)
- [ ] 브라우저 언어 감지 및 localStorage 연동
- [ ] `book_mappings.json` 메타데이터 확장 (`names`, `division` 객체)
- [ ] 다국어 PWA 매니페스트

### 기본 검색

- [ ] **전역 검색 인덱스 생성** (전체 성경 텍스트)
- [ ] **언어 중립적 ID 시스템** - 영어 약칭 기반 구절 ID 생성 (`gen-1-1`)
- [ ] 페이지 내 검색 (현재 장)
- [ ] 한영 혼용 책 이름 검색 (`aliases` 활용)
- [ ] 검색 UI 다국어화
- [ ] 기본 자동완성 (책 이름)
- [ ] 검색 결과 하이라이트 및 컨텍스트 미리보기

### 기본 네비게이션

- [ ] 브레드크럼 (목차 > 구분 > 책 > 장)
- [ ] 네비게이션 텍스트 다국어화
- [ ] 이전/다음 장 링크
- [ ] 모바일 반응형 레이아웃

### 품질 보증

- [ ] 정적 자원 최적화 및 복사
- [ ] **Pretendard 폰트 로컬 다운로드** - 빌드 시 자동 다운로드
- [ ] 기본 반응형 디자인
- [ ] 로깅 및 오류 처리
- [ ] PWA 필수 요소 검증
- [ ] 크로스 브라우저 테스트 (한/영)

### 보안 검증

- [ ] **강화된 Content Security Policy (CSP) 구현**
  - [ ] 해시 기반 script-src, style-src 설정 (`'sha384-[HASH]'`)
  - [ ] `require-sri-for script style` 지시어 추가
  - [ ] `upgrade-insecure-requests` 및 `block-all-mixed-content` 설정
  - [ ] 개발/프로덕션 환경별 CSP 정책 분리
- [ ] **서브리소스 무결성 (SRI) 구현**
  - [ ] 빌드 시 자동 SRI 해시 생성 스크립트
  - [ ] HTML 템플릿에 integrity 속성 자동 삽입
  - [ ] CSS/JS 파일 변경 시 해시 자동 업데이트
  - [ ] CSP 헤더와 SRI 해시 동기화
- [ ] **폰트 정책 검증** - 로컬 Pretendard 폰트 사용, CDN 의존성 제거
- [ ] **언어 중립적 ID 검증** - 영어 약칭 기반 ID, 다국어 호환성 확인
- [ ] **정적 자원 보안 검증** - 로컬 파일만 허용, 경로 순회 방지
- [ ] **오디오 다운로드 보안** - HTTPS 필수, 동일 출처 정책
- [ ] **사용자 입력 검증** - XSS 방지, HTML 태그 필터링
- [ ] **서비스 워커 보안** - 캐시 정책, 외부 요청 제한
- [ ] **PWA 매니페스트 보안** - start_url, scope 검증
- [ ] **빌드 시 보안 감사** - 취약점 스캔, 무결성 검증

---

## 🚀 향후 확장 계획 (Phase 2/3)

### Phase 2: 멀티 에디션 & 다국어 성서 지원

#### 에디션 시스템 확장

- **다양한 번역본 지원**: 새번역, 개역개정, ESV, NIV 등
- **에디션별 독립 관리**: `data/editions/` 구조 도입
- **에디션 선택 UI**: 사용자가 원하는 번역본 선택 및 비교
- **구절 동기화**: 번역본 간 동일 구절 매핑 시스템

#### 고급 검색 기능

- **에디션 간 검색**: 여러 번역본에서 동시 검색 및 비교
- **Web Worker 검색**: 대용량 인덱스에서 UI 블록킹 없는 검색
- **의미 기반 검색**: 키워드가 아닌 의미로 구절 찾기
- **상호참조 시스템**: 관련 구절 자동 연결
- **실시간 자동완성**: 타이핑과 동시에 구절 제안
- **고급 필터링**: 책별, 구약/신약별, 날짜별 검색 범위 지정
- **검색 히스토리**: 최근 검색어 및 북마크 기능

### Phase 3: 전례독서 지원

#### 고급 네비게이션 & UI

- **동적 브레드크럼**: 드롭다운 기반 3단 네비게이션 (구분 → 책 → 장)
- **실시간 장 목록**: Web Worker 연동으로 존재하는 장만 표시
- **모바일 바텀시트**: 터치 최적화된 네비게이션 패널
- **스마트 네비게이션**: 읽기 패턴 기반 추천 구절
- **키보드 단축키**: 고급 사용자용 빠른 이동

#### 연구 도구

- **주석 시스템**: 구절별 해설 및 주석 통합
- **원문 연결**: 히브리어/그리스어 원문 참조
- **성경 지도**: 지명과 지도 연동
- **시대순 읽기**: 역사적 순서로 성경 읽기

#### 개인화 & 커뮤니티

- **개인 노트**: 구절별 개인 메모 작성
- **북마크 시스템**: 중요 구절 저장 및 관리
- **읽기 계획**: 체계적 성경 읽기 가이드
- **공유 기능**: SNS 연동 구절 공유

#### 전례독서 시스템

- **교회력 연동**: 성공회 Common Worship 기준 전례독서
- **매일 독서**: 아침기도, 저녁기도 지정 구절 자동 표시
- **주일 독서**: 구약, 시편, 서신, 복음서 4개 지정 구절
- **절기별 독서**: 대림절, 사순절, 부활절 등 특별 절기 구절
- **독서 달력**: 연간 전례독서 캘린더 및 미리보기
- **기도서 연동**: 해당 구절과 관련된 기도문 연결
- **다년 주기**: Year A, B, C 3년 주기 전례독서 지원
- **알림 시스템**: 매일 전례독서 푸시 알림 (선택사항)

#### AI 기반 기능

- **시맨틱 검색**: 의미 기반 구절 검색
- **주제별 추천**: 관련 구절 자동 추천
- **읽기 패턴 분석**: 개인 맞춤 추천

#### 백엔드 확장

- **사용자 계정**: 클라우드 동기화
- **데이터 분석**: 사용 패턴 분석
- **API 서비스**: 외부 서비스 연동

---

이 설계는 Phase 1에 집중하면서도 향후 확장 가능한 유연한 구조를 유지합니다. Phase 1 완료 후 사용자 피드백을 바탕으로 Phase 2/3의 우선순위를 조정할 수 있습니다.
