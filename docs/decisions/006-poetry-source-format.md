# ADR-006: 운문 소스 포맷 및 segments 데이터 모델

## 개정 이력

| 버전 | 일시       | 내용                                                           |
| ---- | ---------- | -------------------------------------------------------------- |
| v1   | 2026-03-31 | 운문 반행·스탠자 포맷 규칙 최초 작성                           |
| v1.1 | 2026-03-31 | 절 내부 스탠자 구분, 산문·운문 혼합 처리 추가                  |
| v1.2 | 2026-04-01 | 단일 반행(monocolon) 처리, 절 내 산문+운문 혼합 포맷 규칙 추가 |
| v2   | 2026-04-06 | `.md` 블록인용(`>`) 통일, `segments` 데이터 모델, `.txt` 파서 제거 |

- 상태: 승인됨

---

## 결정 요약

운문(시) 본문을 `.md` 소스 파일에서 블록인용(`>`)으로 표기하고, 파서가 이를 `segments` 배열로 변환하여 산문/운문을 명시적으로 구분한다.

| 요소 | 소스 형식 | 파서 출력 |
|------|-----------|-----------|
| 산문 | `[N] text` (블록인용 없음) | `{"type": "prose", "text": "..."}` |
| 운문 | `> text` (블록인용) | `{"type": "poetry", "text": "행1\n행2"}` |
| 스탠자 구분 (절 간) | 빈 `>` 행 + 다음 `> [N]` | 다음 절에 `stanza_break: true` |
| 스탠자 구분 (절 내) | 빈 `>` 행 + 다음 `> text` | 같은 segment 텍스트에 `\n\n` 삽입 |
| 장 헤더 | `# N장` / `# N편` | Chapter 경계 |
| 단락 구분 | `¶` (기존 규칙 유지) | `has_paragraph: true` |

---

## 맥락

### v1~v1.2의 `.txt` 포맷 한계

초기에는 `.txt` 형식에서 2칸 들여쓰기로 운문 반행을 표현했다. 그러나 이 방식에는 근본적 한계가 있었다:

1. **한 절 안에서 산문/운문을 구별할 수 없다** — `text: str` 단일 필드로는 "이 부분은 산문, 이 부분은 운문"을 표현 불가
2. **렌더러가 `\n` 포함 여부로 운문을 추측** — `inPoetryStanza` 휴리스틱이 취약하고 엣지 케이스 다수
3. **4칸 들여쓰기와 블록인용 혼재** — 시편은 4칸 들여쓰기, 창세기는 `>` 블록인용으로 표기 불일치

### v2 전환 동기

- `.md` 소스 포맷으로 전면 전환 (73권 `.txt` → `.md` 변환 완료)
- `>` 블록인용으로 운문 표기 통일 — 파서 규칙 단순화
- `Segment` 데이터클래스 도입 — 산문/운문 명시적 구분
- `.txt` 파서 완전 제거 — 코드 복잡도 감소

---

## 소스 포맷 규칙 (`.md`)

### 규칙 1: 운문은 블록인용(`>`)으로 표기

```markdown
> [2] 야곱의 아들들아 모여와 들어라.
> 너희의 아비 이스라엘의 말을 들어라.
> [3] 르우벤아 너는 내 맏아들,
> 내 힘, 내 정력의 첫 열매라, 너무 우쭐하고 세차구나.
```

- `>`로 시작하면 운문, 아니면 산문. 예외 없음.
- 절 마커 `[N]`은 블록인용 안팎 모두 가능: `> [N] text` (운문 절), `[N] text` (산문 절)

### 규칙 2: 스탠자 구분

**절 간 스탠자** — 빈 `>` 행 뒤에 `> [N]`이 오는 경우:

```markdown
> [4] 터져 나오는 물줄기 같아,
> 제 아비의 침상에 기어들어 그 소실마저 범한 녀석!
>
> [5] 시므온과 레위는 단짝이라,
> 칼만 잡으면 사나워져
```

→ 5절에 `stanza_break: true`

**절 내 스탠자** — 빈 `>` 행 뒤에 `>` 내용행(절 마커 없음)이 오는 경우:

```markdown
> [12] 자칫하면 불붙는 그의 분노,
> 금시라도 터지면 살아 남지 못하리라.
>
> 그분께 몸을 피하는 자 모두 다 복되어라.
```

→ 12절 poetry segment에 `"...못하리라.\n\n그분께...복되어라."` (`\n\n`으로 구분)

**빈 줄(`>` 없음)은 블록인용을 종료한다:**

```markdown
> "드디어 나타났구나!
> 지어미라고 부르리라!"

[24] ¶ 이리하여 남자는 어버이를 떠나...
```

→ `>`가 없는 빈 줄 = 블록인용 종료, 운문 segment flush

### 규칙 3: 산문·운문 혼합 (절 내)

한 절 안에서 산문과 운문이 공존하는 경우, 별도의 segment로 분리된다.

**산문 → 운문** (창세 3:14):

```markdown
[14] 야훼 하느님께서 뱀에게 말씀하셨다.

>"네가 이런 일을 저질렀으니
> 온갖 집짐승과 들짐승 가운데서 너는 저주를 받아,
```

→ v14.segments = `[prose("야훼...말씀하셨다."), poetry("\"네가...\n온갖...")]`

**산문 → 산문 (인용)** (창세 3:17):

```markdown
[17] ¶ 그리고 아담에게는 이렇게 말씀하셨다.

"너는 아내의 말에 넘어가... 먹고 살리라.
```

→ v17.segments = `[prose("¶ 그리고..."), prose("\"너는...")]`

### 규칙 4: 장 헤더

```markdown
# 1장

[1] ¶ 한처음에 하느님께서...
```

- `# N장` 또는 `# N편` (시편)으로 장 경계 결정
- 장 헤더 뒤 빈 줄 1개

---

## 데이터 모델

### Segment 데이터클래스

```python
@dataclass
class Segment:
    type: str   # "prose" 또는 "poetry"
    text: str   # 산문: 한 줄, 운문: \n으로 반행 구분, \n\n으로 스탠자 구분
```

### Verse 데이터클래스

```python
@dataclass
class Verse:
    number: int
    segments: List[Segment]               # 산문/운문 명시적 구분
    has_paragraph: bool = False            # ¶ 포함 여부
    stanza_break: bool = False             # 이 절 앞 스탠자 구분
    chapter_ref: Optional[int] = None
    range_end: Optional[int] = None
    part: Optional[str] = None
    alt_ref: Optional[int] = None
```

### JSON 출력 예시

**산문 절:**
```json
{"number": 1, "has_paragraph": true, "segments": [{"type": "prose", "text": "¶ 한처음에 하느님께서..."}]}
```

**순수 운문 절:**
```json
{"number": 1, "segments": [{"type": "poetry", "text": "복되어라.\n악을 꾸미는 자리에...\n죄인들의 길을..."}]}
```

**혼합 절 (산문 + 운문):**
```json
{
  "number": 14,
  "segments": [
    {"type": "prose", "text": "야훼 하느님께서 뱀에게 말씀하셨다."},
    {"type": "poetry", "text": "\"네가 이런 일을 저질렀으니\n온갖 집짐승과..."}
  ]
}
```

---

## 렌더러 규칙

### 절 간 break

| 이전 절 끝 타입 | 현재 절 시작 타입 | break |
|---|---|---|
| poetry | poetry | `hemistich-break` (여백 없음, 스탠자 내 연결) |
| prose | poetry | `paragraph-break` (여백, 단락 전환) |
| * | * (`¶` 있음) | `paragraph-break` |
| * | * (`stanza_break`) | `stanza-break` (큰 여백) |
| * | prose (`¶` 없음) | break 없음 (같은 단락) |

### 절 내 segment 간 break

| 이전 segment | 현재 segment | break |
|---|---|---|
| prose | poetry | `paragraph-break` |
| poetry | prose | `paragraph-break` |
| poetry | poetry (같은 segment 내 `\n`) | `hemistich-break` |
| poetry | poetry (같은 segment 내 `\n\n`) | `stanza-break` |

### Hanging punctuation

운문 행이 `"` 또는 `'`로 시작하면 따옴표를 왼쪽으로 내어쓰기하여, 따옴표 뒤 첫 글자가 들여쓰기 기준선에 정렬된다.

```css
.verse.verse-poetry .hanging-quote { margin-left: -0.4em; }
```

---

## 파서 상태 머신 (`parse_md_file`)

### 상태 변수

```python
current_verse: Optional[Verse]
poetry_lines: List[str]           # 블록인용 내 축적 중인 운문 행
in_blockquote: bool               # 블록인용 컨텍스트 내부 여부
pending_blank: bool               # 직전에 빈 줄이 있었는지
pending_stanza_in_bq: bool        # 블록인용 내 빈 > 행 후 스탠자 대기
```

### 핵심 전이 규칙

| 라인 패턴 | 동작 |
|---|---|
| `# N장` | 현재 절/장 마무리, 새 Chapter 생성 |
| `[N] text` (블록인용 외) | 현재 절 마무리, 새 Verse 생성, prose segment |
| `> [N] text` (블록인용 내) | 현재 절 flush, 새 Verse 생성, poetry 축적 시작 |
| `> text` (절 마커 없음) | poetry_lines에 추가 |
| `>` (빈 블록인용) | `pending_stanza_in_bq = True` (블록인용 유지) |
| 빈 줄 (`>` 없음) | 블록인용 종료, poetry flush, `pending_blank = True` |
| 기타 텍스트 | 현재 절에 prose segment 추가 |

---

## 대상 범위

v1에서는 시편·잠언 등 6권만 대상이었으나, v2에서는 **모든 운문 포함 책**이 대상이다. `.md` 소스 73권 전체가 동일한 파서(`parse_md_file`)로 처리된다.

운문이 포함된 주요 책:
- 전체 운문: 시편, 잠언, 전도서, 아가, 애가
- 혼합: 욥기, 이사야, 예레미야, 창세기, 출애굽기 등 다수

---

## 관련 ADR

- ADR-003: 원본 텍스트 절 표기 처리 방식 — 절 번호 패턴, `chapter_ref` 등
