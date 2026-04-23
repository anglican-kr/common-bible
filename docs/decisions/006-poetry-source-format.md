# ADR-006: 운문 소스 포맷 및 segments 데이터 모델

## 개정 이력

| 버전 | 일시       | 내용                                                           |
| ---- | ---------- | -------------------------------------------------------------- |
| v1   | 2026-03-31 | 운문 반행·스탠자 포맷 규칙 최초 작성                           |
| v1.1 | 2026-03-31 | 절 내부 스탠자 구분, 산문·운문 혼합 처리 추가                  |
| v1.2 | 2026-04-01 | 단일 반행(monocolon) 처리, 절 내 산문+운문 혼합 포맷 규칙 추가 |
| v2   | 2026-04-06 | `.md` 블록인용(`>`) 통일, `segments` 데이터 모델, `.txt` 파서 제거 |
| v2.1 | 2026-04-24 | 단락 구분 플래그를 절 레벨(`has_paragraph`)에서 세그먼트 레벨(`paragraph_break`)로 이동 |

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
| 단락 구분 | `¶` 또는 절 앞 빈 줄 | 해당 segment에 `paragraph_break: true` |

---

## 맥락

### v1~v1.2의 `.txt` 포맷 한계

초기에는 `.txt` 형식에서 2칸 들여쓰기로 운문 반행을 표현했다. 그러나 이 방식에는 근본적 한계가 있었다:

1. **한 절 안에서 산문/운문을 구별할 수 없다** — `text: str` 단일 필드로는 "이 부분은 산문, 이 부분은 운문"을 표현 불가
2. **렌더러가 `\n` 포함 여부로 운문을 추측** — `inPoetryStanza` 휴리스틱이 취약하고 엣지 케이스 다수
3. **4칸 들여쓰기와 블록인용 혼재** — 시편은 4칸 들여쓰기, 창세기는 `>` 블록인용으로 표기 불일치

### v2.1 전환 동기 — 단락 구분 플래그 이동

v2까지 단락 구분은 절 레벨 `has_paragraph: bool` 필드로 관리했다. 그런데 이 설계에는 구조적 결함이 있었다.

**버그 사례 (요한 5:8–9):**
```
[8] 예수께서 "일어나 요를 걷어들고 걸어가거라." 하시자
[9] 그 사람은 어느새 병이 나아서 요를 걷어들고 걸어갔다.
¶ 그 날은 마침 안식일이었다.
```

9절 본문 뒤에 오는 continuation 줄(`¶ 그 날은...`)의 `¶`를 파서가 감지하여 9절 자체에 `has_paragraph: true`를 설정했다. 렌더러는 이를 "9절 앞에 단락 간격"으로 해석하여 8절과 9절 사이에 불필요한 gap을 삽입했다.

**근본 원인:** `has_paragraph`가 두 가지 의미를 혼용했다.
- "이 절이 새 단락을 시작함" (절 앞에 gap)
- "이 절 내부에서 단락 전환이 일어남" (특정 segment 앞에 gap)

**해결:** 단락 구분 정보를 `Verse.has_paragraph`(절 레벨)에서 `Segment.paragraph_break`(세그먼트 레벨)로 이동. 모든 단락 구분(`¶`, 빈 줄)이 동일한 방식으로 처리되며, gap이 삽입될 정확한 위치(segment)에 플래그가 붙는다.

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
    type: str              # "prose" 또는 "poetry"
    text: str              # 산문: 한 줄, 운문: \n으로 반행 구분, \n\n으로 스탠자 구분
    paragraph_break: bool = False  # 이 segment 앞에 단락 간격 삽입
```

`paragraph_break`가 설정되는 세 가지 경우:
1. **절 줄 자체에 `¶`** — `[N] ¶ text` 형태, 첫 번째 segment에 설정
2. **절 앞 빈 줄** — `pending_blank` 상태에서 산문 절이 시작될 때, 첫 번째 segment에 설정
3. **continuation 줄에 `¶`** — 절 번호 없는 연속 줄에 `¶`가 포함된 경우, 해당 segment에 설정

### Verse 데이터클래스

```python
@dataclass
class Verse:
    number: int
    segments: List[Segment]               # 산문/운문 명시적 구분
    stanza_break: bool = False             # 이 절 앞 스탠자 구분
    chapter_ref: Optional[int] = None
    range_end: Optional[int] = None
    part: Optional[str] = None
    alt_ref: Optional[int] = None
```

### JSON 출력 예시

**단락 시작 산문 절 (`¶` in verse line):**
```json
{"number": 1, "segments": [{"type": "prose", "text": "¶ 한처음에 하느님께서...", "paragraph_break": true}]}
```

**순수 운문 절:**
```json
{"number": 1, "segments": [{"type": "poetry", "text": "복되어라.\n악을 꾸미는 자리에...\n죄인들의 길을..."}]}
```

**혼합 절 — continuation에 `¶` (단락이 절 중간에서 전환):**
```json
{
  "number": 9,
  "segments": [
    {"type": "prose", "text": "그 사람은 어느새 병이 나아서 요를 걷어들고 걸어갔다."},
    {"type": "prose", "text": "¶ 그 날은 마침 안식일이었다.", "paragraph_break": true}
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
| * | * (첫 segment에 `paragraph_break: true`) | `paragraph-break` |
| * | * (`stanza_break`) | `stanza-break` (큰 여백) |
| * | prose (첫 segment에 `paragraph_break` 없음) | break 없음 (같은 단락) |

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
pending_paragraph: bool           # 다음 segment에 paragraph_break 설정 대기
pending_stanza_in_bq: bool        # 블록인용 내 빈 > 행 후 스탠자 대기
```

### 핵심 전이 규칙

| 라인 패턴 | 동작 |
|---|---|
| `# N장` | 현재 절/장 마무리, 새 Chapter 생성 |
| `[N] text` (블록인용 외) | 현재 절 마무리, 새 Verse 생성, prose segment; `¶` 포함 시 첫 segment에 `paragraph_break: true`; `pending_blank`이면 첫 segment에 `paragraph_break: true` (또는 segment 없으면 `pending_paragraph = True`) |
| `> [N] text` (블록인용 내) | 현재 절 flush, 새 Verse 생성, poetry 축적 시작; `pending_blank`이면 `stanza_break: true` |
| `> text` (절 마커 없음) | poetry_lines에 추가 |
| `>` (빈 블록인용) | `pending_stanza_in_bq = True` (블록인용 유지) |
| 빈 줄 (`>` 없음) | 블록인용 종료, poetry flush, `pending_blank = True` |
| 기타 텍스트 | 현재 절에 prose segment 추가; `¶` 포함 또는 `pending_paragraph`이면 `paragraph_break: true` |

---

## 대상 범위

v1에서는 시편·잠언 등 6권만 대상이었으나, v2에서는 **모든 운문 포함 책**이 대상이다. `.md` 소스 73권 전체가 동일한 파서(`parse_md_file`)로 처리된다.

운문이 포함된 주요 책:
- 전체 운문: 시편, 잠언, 전도서, 아가, 애가
- 혼합: 욥기, 이사야, 예레미야, 창세기, 출애굽기 등 다수

---

## 관련 ADR

- ADR-003: 원본 텍스트 절 표기 처리 방식 — 절 번호 패턴, `chapter_ref` 등
