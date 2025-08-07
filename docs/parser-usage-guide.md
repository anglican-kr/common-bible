# 📖 Parser.py 사용 설명서

`parser.py`는 공동번역성서 텍스트 파일을 구조화된 데이터로 변환하는 핵심 모듈입니다.

---

## 🎯 주요 기능

- ✅ **텍스트 파싱**: 원본 텍스트를 장(Chapter)과 절(Verse) 단위로 분리
- ✅ **JSON 저장/로드**: 파싱 결과를 JSON 파일로 저장하고 재사용
- ✅ **캐시 시스템**: 자동 캐싱으로 반복 실행 시 성능 향상
- ✅ **단락 처리**: `¶` 기호를 인식하여 단락 구분 정보 보존
- ✅ **책 이름 매핑**: 약칭을 전체 이름으로 자동 변환

---

## 📂 데이터 구조

### Chapter (장)
```python
@dataclass
class Chapter:
    book_name: str        # 전체 책 이름 (예: "창세기")
    book_abbr: str        # 약칭 (예: "창세")
    chapter_number: int   # 장 번호 (예: 1)
    verses: List[Verse]   # 해당 장의 절들
```

### Verse (절)
```python
@dataclass
class Verse:
    number: int           # 절 번호 (예: 1)
    text: str            # 절 본문 (예: "¶ 태초에 하나님이..." - 원본 텍스트 보존)
    has_paragraph: bool  # 단락 시작 여부 (¶ 기호 포함 여부)
```

**중요**: `text` 필드는 원본 텍스트를 보존합니다. `¶` 기호가 있으면 그대로 유지되며, HTML 변환 시 접근성을 고려한 마크업으로 처리됩니다.

---

## 🚀 사용 방법

### 1. 기본 사용법

#### 명령행에서 실행
```bash
# 기본 파싱 (메모리에만 저장)
python src/parser.py data/common-bible-kr.txt

# JSON 파일로 저장
python src/parser.py data/common-bible-kr.txt --save-json output/bible.json

# 캐시 사용 (빠른 재실행)
python src/parser.py data/common-bible-kr.txt --use-cache
```

#### Python 코드에서 사용
```python
from src.parser import BibleParser

# 파서 초기화
parser = BibleParser('data/book_mappings.json')

# 텍스트 파일 파싱
chapters = parser.parse_file('data/common-bible-kr.txt')

print(f"총 {len(chapters)}개 장 파싱 완료")
```

### 2. JSON 저장 및 로드

#### 저장
```python
# 파싱 후 JSON으로 저장
chapters = parser.parse_file('data/common-bible-kr.txt')
parser.save_to_json(chapters, 'output/bible_data.json')
```

#### 로드
```python
# 기존 JSON 파일에서 로드
chapters = parser.load_from_json('output/bible_data.json')

# 이제 chapters를 바로 사용 가능
for chapter in chapters[:3]:
    print(f"{chapter.book_name} {chapter.chapter_number}장")
```

### 3. 캐시 기능 활용

```python
# 캐시 자동 관리 (권장)
chapters = parser.parse_file_with_cache(
    file_path='data/common-bible-kr.txt',
    cache_path='output/bible_cache.json'
)

# 첫 실행: 텍스트 파싱 후 캐시 저장
# 재실행: 캐시 파일에서 빠르게 로드
```

---

## 📋 명령행 옵션

### 기본 구문
```bash
python src/parser.py <텍스트파일> [옵션]
```

### 옵션 목록

| 옵션 | 설명 | 예시 |
|------|------|------|
| `--save-json <경로>` | 파싱 결과를 JSON 파일로 저장 | `--save-json output/data.json` |
| `--use-cache` | 캐시 파일 자동 관리 | `--use-cache` |

### 사용 예시

```bash
# 1. 기본 파싱만
python src/parser.py data/common-bible-kr.txt

# 2. 특정 경로에 JSON 저장
python src/parser.py data/common-bible-kr.txt --save-json backup/bible_20241201.json

# 3. 캐시 사용 (개발 시 권장)
python src/parser.py data/common-bible-kr.txt --use-cache

# 4. 도움말 확인
python src/parser.py
```

---

## 📊 출력 예시

### 명령행 출력
```
$ python src/parser.py data/common-bible-kr.txt --save-json output/bible.json

파싱 결과를 output/bible.json에 저장했습니다.

총 1189개의 장을 파싱했습니다.

[1] 창세기 1장
    약칭: 창세
    절 수: 31
    첫 절: 1. 태초에 하나님이 천지를 창조하시니라...

[2] 창세기 2장
    약칭: 창세
    절 수: 25
    첫 절: 1. 천지와 만물이 다 이루어지니라...

[3] 창세기 3장
    약칭: 창세
    절 수: 24
    첫 절: 1. 여호와 하나님이 지으신 들짐승 중에 뱀이 가장 간교하더라...

✅ 파싱 완료! 다른 프로그램에서 재사용하려면:
   parser.load_from_json('output/bible.json') 사용
```

### JSON 파일 구조
```json
[
  {
    "book_name": "창세기",
    "book_abbr": "창세",
    "chapter_number": 1,
    "verses": [
      {
        "number": 1,
        "text": "태초에 하나님이 천지를 창조하시니라",
        "has_paragraph": false
      },
      {
        "number": 2,
        "text": "땅이 혼돈하고 공허하며 흑암이 깊음 위에 있고",
        "has_paragraph": true
      }
    ]
  }
]
```

---

## 🔧 고급 사용법

### 1. 특정 책만 필터링
```python
parser = BibleParser('data/book_mappings.json')
chapters = parser.parse_file('data/common-bible-kr.txt')

# 창세기만 필터링
genesis_chapters = [ch for ch in chapters if ch.book_abbr == "창세"]
print(f"창세기 총 {len(genesis_chapters)}장")
```

### 2. 단락 구분 활용
```python
for chapter in chapters:
    for verse in chapter.verses:
        if verse.has_paragraph:
            print(f"새 단락 시작: {verse.text}")
```

### 3. 책 구분별 통계
```python
parser = BibleParser('data/book_mappings.json')
chapters = parser.parse_file('data/common-bible-kr.txt')

# 구약/신약 통계
old_testament = []
new_testament = []

for chapter in chapters:
    book_info = parser.book_mappings.get(chapter.book_abbr, {})
    testament = book_info.get('구분', '구약')
    
    if testament == '구약':
        old_testament.append(chapter)
    elif testament == '신약':
        new_testament.append(chapter)

print(f"구약: {len(old_testament)}장, 신약: {len(new_testament)}장")
```

### 4. 데이터 검증
```python
def validate_parsing_result(chapters):
    """파싱 결과 검증"""
    total_chapters = len(chapters)
    total_verses = sum(len(ch.verses) for ch in chapters)
    
    print(f"검증 결과:")
    print(f"  총 장 수: {total_chapters}")
    print(f"  총 절 수: {total_verses}")
    
    # 빈 장 확인
    empty_chapters = [ch for ch in chapters if not ch.verses]
    if empty_chapters:
        print(f"  ⚠️  빈 장: {len(empty_chapters)}개")
    else:
        print(f"  ✅ 모든 장에 절이 있음")

chapters = parser.parse_file('data/common-bible-kr.txt')
validate_parsing_result(chapters)
```

---

## 🎨 다양한 활용 사례

### 1. 웹 API 개발
```python
from flask import Flask, jsonify
from src.parser import BibleParser

app = Flask(__name__)
parser = BibleParser('data/book_mappings.json')

# 한 번만 로드
chapters = parser.load_from_json('output/bible_cache.json')

@app.route('/api/chapter/<book>/<int:chapter_num>')
def get_chapter(book, chapter_num):
    chapter = next((ch for ch in chapters 
                   if ch.book_abbr == book and ch.chapter_number == chapter_num), None)
    if chapter:
        return jsonify(asdict(chapter))
    return jsonify({"error": "Chapter not found"}), 404
```

### 2. 검색 기능
```python
def search_verses(chapters, keyword):
    """키워드로 절 검색"""
    results = []
    for chapter in chapters:
        for verse in chapter.verses:
            if keyword in verse.text:
                results.append({
                    'book': chapter.book_name,
                    'chapter': chapter.chapter_number,
                    'verse': verse.number,
                    'text': verse.text
                })
    return results

# 사용 예
results = search_verses(chapters, "사랑")
for result in results[:5]:
    print(f"{result['book']} {result['chapter']}:{result['verse']} - {result['text'][:50]}...")
```

### 3. 통계 분석
```python
def analyze_bible_stats(chapters):
    """성경 통계 분석"""
    stats = {
        'total_chapters': len(chapters),
        'total_verses': sum(len(ch.verses) for ch in chapters),
        'books': set(ch.book_name for ch in chapters),
        'paragraphs': sum(1 for ch in chapters for v in ch.verses if v.has_paragraph)
    }
    
    print(f"📊 성경 통계:")
    print(f"   책 수: {len(stats['books'])}")
    print(f"   장 수: {stats['total_chapters']}")
    print(f"   절 수: {stats['total_verses']}")
    print(f"   단락 수: {stats['paragraphs']}")
    
    return stats

stats = analyze_bible_stats(chapters)
```

---

## 🐛 문제 해결

### 일반적인 문제들

#### 1. `FileNotFoundError`
```
FileNotFoundError: [Errno 2] No such file or directory: 'data/book_mappings.json'
```
**해결방법**: `book_mappings.json` 파일이 올바른 위치에 있는지 확인

#### 2. 인코딩 오류
```
UnicodeDecodeError: 'utf-8' codec can't decode
```
**해결방법**: 텍스트 파일이 UTF-8 인코딩인지 확인

#### 3. 메모리 부족
```
MemoryError: Unable to allocate array
```
**해결방법**: 큰 파일의 경우 청크 단위로 처리하거나 더 많은 메모리 할당

#### 4. JSON 저장 실패
```
PermissionError: [Errno 13] Permission denied
```
**해결방법**: 출력 디렉토리에 쓰기 권한이 있는지 확인

### 디버깅 팁

#### 1. 상세한 로깅 활성화
```python
import logging
logging.basicConfig(level=logging.DEBUG)

parser = BibleParser('data/book_mappings.json')
chapters = parser.parse_file('data/common-bible-kr.txt')
```

#### 2. 부분 파싱 테스트
```python
# 작은 샘플 파일로 테스트
with open('sample.txt', 'w', encoding='utf-8') as f:
    f.write("창세 1:1\n1 태초에 하나님이 천지를 창조하시니라\n")

chapters = parser.parse_file('sample.txt')
print(f"테스트 결과: {len(chapters)}장 파싱됨")
```

---

## 📚 관련 문서

- [design-specification.md](design-specification.md) - 전체 시스템 설계
- [requirements.md](requirements.md) - 프로젝트 요구사항
- [book_mappings.json](../data/book_mappings.json) - 책 이름 매핑 데이터

---

## 🤝 기여하기

버그 발견이나 개선 사항이 있으시면:

1. 이슈 등록
2. 테스트 케이스 작성
3. 풀 리퀘스트 제출

---

*이 가이드는 parser.py v1.0 기준으로 작성되었습니다.*
