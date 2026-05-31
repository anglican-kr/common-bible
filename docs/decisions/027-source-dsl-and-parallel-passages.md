# ADR-027: Source markup DSL 위치 잡기 + `<parallel>` element 도입

- 일시: 2026-05-31
- 상태: 승인됨 — **구현 완료** (2026-05-31, 1.5.x 트랙). 시각은 footnote anchor 패턴 (UI 렌더 §2 개정 2026-05-31 — 초기 배너 안 dev 검증 후 전환). 콘텐츠 단계 — 실제 source/*.md 에 `<parallel>` 마커를 다는 작업 — 은 콘텐츠 자문과 묶여 별도 진행
- 관련 ADR: ADR-006(운문 segments 포맷), ADR-018(`js/app/views-routing.js` 본문 렌더 위치), ADR-022(인용·주석 + per-parallel tradition), ADR-020(저장소 4분할 — 본 결정도 app·data 두 저장소를 모두 손댐)

> **현재 상태.** 본 ADR 두 결정을 한 묶음으로 다룬다 — (1) `source/*.md` 마크업의 위치 잡기를 markdown + 자체 도메인 DSL 의 혼합으로 명문화, (2) 그 DSL 에 `<parallel>` element 신설. 구현은 후속 단계 — parser.py 의 block 마커 인식 + JSON 스키마 확장 + `js/app/parallels.js`(가칭) 의 단락 배너 렌더 + 데이터 검증 테스트 + 유닛 테스트. Phase 별 일정은 별도 이슈로 분리.

## 맥락

### 1. 비표준 element 이야기

ADR-022 가 도입한 `<cite>`·`<note>` 마크업을 운용하며 한 가지 의문이 자연스럽게 떠올랐다:

- `<cite>`는 HTML5 표준 엘리먼트지만 우리가 쓰는 속성(`src`·`parallels`·`tradition`)은 HTML5 정의를 벗어남
- `<note>`는 HTML5 스펙에 아예 없음 (DocBook·TEI 의 element)
- ADR-022 §2 개정 (2026-05-31, per-parallel tradition) 까지 더하며 cite 태그 속성 표면이 더 넓어짐

이 위에 새 `<parallel>` 엘리먼트까지 더할지 고민하던 차에 "HTML 표준이 아닌데?" 라는 질문이 다시 제기됐다.

### 2. 그러나 source 는 브라우저가 렌더하지 않음

`source/*.md` 의 마크업이 브라우저에 직접 노출되는 경로는 0 이다:

```
source/*.md   (작성 시점)
  → Python parser.py (도메인 토큰 인식)
  → output/parsed_bible.json
  → split_bible.py
  → data/bible/{book_id}-{chapter}.json   (런타임 입력)
  → JS app (DOM 빌드)
  → 브라우저
```

즉 `<note>`·`<cite src="...">`·`<parallel>` 같은 토큰은 한 번도 HTML 엘리먼트로 사용된 적이 없다. 항상 파서가 보는 마크업 토큰이고, 출력 DOM은 별개로 빌드된다 (현재 `<note>X</note>[^id]`는 `<button class="note-anchor">X</button>`로 렌더).

### 3. 디지털 성서 인코딩의 관행

디지털 성서·학술 텍스트 인코딩 표준은 모두 도메인 특화 마크업을 채택한다 — HTML 표준에 매이지 않는다:

- **USFM** (SIL/UBS) — Bible 저자 사실상 표준. `\v 1 본문 \f + 각주 \f*`, `\xt 마르 12:29`, `\r section reference` 등 백슬래시 마커.
- **USX** — USFM 의 XML 변형. `<note caller="+">…</note>`, `<char style="xt">마르 12:29</char>`.
- **OSIS** (SBL) — 성서 XML 표준. `<reference>`, `<note>`, `<milestone>`.
- **TEI** (Text Encoding Initiative) — 학술 텍스트 표준. `<note>`, `<seg>`, `<linkGrp>`.
- **JATS**, **DocBook** — 학술 출판. 모두 application-specific element.

본 프로젝트의 패턴 — 마크다운 (CommonMark 호환) + 자체 도메인 DSL — 은 이 라인업과 같다. 도메인 DSL의 엘리먼트 명명은 시맨틱을 가장 잘 드러내는 이름을 직관적으로 골라도 무방하다.

### 4. 표현 한계 — 절 단위 `<cite>` 와 단락 단위 병행 본문의 mismatch

ADR-022 의 `<cite>`는 절 단위 인용 마커다 (§3 절 경계를 가로지를 수 없음). 그런데 사무엘상하·열왕기상하·역대상하 사이에는 같은 사건을 두 번 서술하는 **단락 단위 병행 narrative**가 다수 존재한다:

- 1역대 11:1-9 ∥ 2사무 5:1-10 (다윗의 왕 즉위)
- 1역대 13 ∥ 2사무 6 (법궤 이동)
- 1역대 17 ∥ 2사무 7 (다윗 언약)
- 그 외 수십 건

이를 현재 `<cite>` 로 표현하면:
- 9 절짜리 병행은 `<cite parallels="2사무 5:1-10">…</cite>` 를 9 번 반복해야 함 (dedup 으로 칩은 1 회만 뜨지만 마크업 부담은 그대로)
- 시맨틱 부정확: 병행 narrative 는 quotation 이 아님 — 두 책이 각자 독립 서술한 같은 사건
- 적용 범위를 데이터로 표현할 자리가 없음 — 칩이 "여기부터 어디까지" 가 병행인지 알 수 없음

ADR-022 의 `<cite>` 모델은 NT-OT 짧은 인용에는 잘 맞지만 OT 역사서 사이의 긴 병행 narrative 에는 부족하다. 별도 element 가 필요하다.

## 결정

### 1. Source DSL 위치 잡기 (명문화)

`source/*.md` 마크업은 **markdown (CommonMark) + 본 프로젝트 자체 정의 XML-style 도메인 DSL** 혼합 포맷이다.

- 파이프라인: source → Python parser → JSON → JS DOM. 브라우저는 source 의 마크업 토큰을 직접 렌더하지 않음.
- DSL element 의 "HTML 표준 준수" 여부는 설계 제약이 아니다. USFM·USX·OSIS·TEI 등 디지털 성서·학술 텍스트 인코딩 표준의 관행을 따라 시맨틱을 가장 잘 드러내는 이름을 선택한다.
- 현재 정의된 DSL element:
  - `<cite src="..." parallels="..." tradition="...">…</cite>` — 절 안 inline quotation 마커 (ADR-022)
  - `<note>X</note>[^id]` — 절 안 inline 명시적 anchor wrapper (ADR-022 §1)
  - `<parallel src="..." range="..." [tradition="..."]/>` — 절 사이 block-level 병행 본문 마커 (본 ADR)
- 향후 추가 element 는 별도 ADR 또는 ADR-022/027 의 개정으로 등록한다.
- **새 element 도입 절차** — 발명에 들어가기 전 USFM 마커 카탈로그, USX/OSIS element list 를 한 번 훑어 같은 시맨틱이 이미 표준에 존재하는지 확인한다. 존재하면 (a) 이름·속성을 그 표준에서 빌려와 학습 path 를 짧게 하고 (b) 해당 ADR 의 §"선례" 에 OSIS/USFM 대응을 명시한다. 우리만의 발명은 표준에 정확한 매칭이 없을 때 한정.

`<cite>` 가 HTML5 표준 element 이름과 겹치는 점은 의도된 우연이다 — 시맨틱이 인용 표현과 자연스럽게 맞고 표준 element 명을 재사용하는 게 학습 부담을 낮춘다. 다만 우리 속성 (`src`·`parallels`·`tradition`) 은 HTML5 정의를 넘어선 application-specific 확장임을 명시한다.

### 2. `<parallel>` element — 단락 단위 병행 본문 마커

#### 마크다운 표현

```markdown
<parallel src="2사무 5:1-10" range="11:1-9"/>
[1] 온 이스라엘이 헤브론에 모여서 다윗을 찾아와 말하였다…
[2] …
[9] …본문 끝
[10] 다른 단락 시작 (병행 끝)
```

- **자기-닫힘 단일 토큰** (`<parallel ... />`). 절 사이 빈 줄 또는 직전 한 줄에 배치, **다음 절 마커 `[N]` 직전** 에 등장하면 그 절부터 `range` 까지가 병행 단락으로 간주됨.
- 본 마커는 wrap 하지 않음 — 단락 boundary 표시 + 메타데이터 carrier 역할만. 본문 자체는 그 아래 일반 절 마커 (`[N]`) 로 그대로 서술.

#### 선례 — OSIS·USFM 매핑

본 element 는 새로 발명한 게 아니라 두 표준의 정확한 대응물을 우리 마크업 컨벤션으로 옮긴 것이다:

- **USFM `\r` (section reference / parallel reference)** — 단락 헤더 뒤에 병행 본문 출처를 한 줄로 표시하는 마커. 가장 직접적인 대응. USFM 의 `\r` 가 *"이 단락이 어느 본문과 병행인지"* 를 표현하는 자리고, 우리 `<parallel>` 도 같은 역할.
- **OSIS `<reference type="parallel">`** — `<div type="section">` 안에 둘 수 있는 cross-reference 의 한 타입. OSIS 는 cross-reference 종류를 `quotation`·`crossReference`·`parallel`·`commentary` 등으로 카탈로그화 — 우리 ADR-022 (`<cite>`) 와 ADR-027 (`<parallel>`) 의 분리도 이와 같은 시맨틱 축을 따른다.

이 선례 덕분에 element 이름·속성을 따로 발명할 필요가 없었다 — `<parallel>` 은 OSIS 의 type 명 그대로이고, `src`/`range` 속성도 USFM 의 `\r` content 와 같은 정보 단위.

#### 속성

| 속성 | 필수 | 의미 |
|---|---|---|
| `src` | ✓ | 병행 출처. `<cite src>` 와 동일 형식·문법 (`약어 장:절-절` / `약어 장:절-장:절`). 다중 출처는 세미콜론(`;`) 분리: `src="2사무 5:1-10; 1역대 11:1-9"`. |
| `range` | ✓ | 현 책·현 장 내 적용 범위. `장:절-절` 또는 `장:절-장:절` (cross-chapter). 현 장 내라면 `장` prefix 도 명시 (예: `range="11:1-9"`). 단일 장 전체는 `range="11"`. |
| `tradition` | △ | 옵션. `<cite tradition>` 과 동일 시맨틱 (display-only label). per-parallel tradition 은 src 항목 끝에 인라인 `[전통]` 으로 (ADR-022 §2 개정 2026-05-31 과 동일). |

#### 검증 규칙

- `range` 의 시작 절은 마커 직후 등장하는 첫 `[N]` 과 일치해야 함 (cross-check). 어긋나면 parser ValueError.
- `range` 끝 절은 같은 장 안에 실재해야 함 (chapter_count 검증).
- `src` 의 각 항목은 `<cite src>` 와 동일하게 책 약어·장·절 범위 실재 검증.
- 단락 안에 다시 `<parallel>` 를 두는 nesting 은 금지 (첫 단계만).
- 한 절이 두 `<parallel>` 단락에 동시 속하는 overlap 은 금지 (validator 가 적발).

#### JSON 스키마

병행 마커는 본문 절 데이터 안이 아니라 **chapter 레벨 메타데이터** 로 분리한다 — 단락 범위 단위 정보이지 절·세그먼트 단위가 아니기 때문.

`data/bible/{book_id}-{chapter}.json` 에 옵션 필드:

```json
{
  "book_id": "1chr",
  "chapter": 11,
  "verses": [ ... ],
  "parallels": [
    {
      "src": ["2사무 5:1-10"],
      "range": "11:1-9"
    },
    {
      "src": ["2사무 23:8-39"],
      "range": "11:10-47"
    }
  ]
}
```

- `parallels` 는 옵션 (없으면 키 자체 생략). 한 장에 여러 병행 단락 가능.
- `src` 는 항상 배열 — 단일 출처도 `["..."]`. per-source tradition 이 있으면 `[{ref, tradition}]` 형태로 ADR-022 §2 개정과 동일.
- `range` 는 문자열, 위 마크다운의 `range` 값 그대로.

#### UI 렌더

> **개정 (2026-05-31, dev 검토):** 초기 디자인은 `<aside class="parallel-banner">` 단락 헤더 배너였으나, dev 검증 후 (a) 한 장에 여러 병행이 있을 때 어느 절들이 그 병행 단락인지 시각 구분이 약하고 (b) 배너 자체가 본문 사이에 끼어들어 reading flow 를 끊는다는 판단으로 **footnote anchor 패턴** 으로 전환. 변형 주석(`<note></note>[^id]`)이 이미 사용하는 `※` 글리프를 그대로 재사용 — 사용자가 학습할 기호가 늘지 않는다.

- **Anchor**: `range` 시작 절의 직전에 작은 `※` 글리프 (`.parallel-anchor`, superscript) 삽입. 변형 주석(`.note-anchor--variant`) 과 같은 글리프이라 의도된 시각 통일 — "이 자리에 보조 정보가 있다" 시그널을 한 종류로 통합.
- **Tooltip**: anchor 클릭 → `note-tooltip` 재사용. 헤더는 `range` (예: `5:1-10`), 본문은 `<sourceLink> 참조` 형태 (예: `1역대 11:1-9 참조`). 다중 src 는 `<link1> · <link2> 참조` 로 join. tradition 라벨은 link 텍스트 prefix (`(칠십인역 시편 16:8)`).
- **본문 내 source link 클릭**: 그 ref 의 cite-sheet 가 열리고 tooltip 은 닫힘 (이중 floating UI 회피). 다중 src 인 경우 사용자가 보고 싶은 ref 를 골라 시트에 띄움 — 한 anchor 에서 여러 병행 본문을 비교할 수 있음.
- **시각 범위 구분자 미사용**: 초기 검토에선 range 안 절들에 좌측 띠를 도입하는 안이 있었으나, anchor 가 시작 위치를 표시하고 tooltip 텍스트 (`5:1-10`) 가 끝 위치를 명시하므로 추가 시각 marker 가 잉여라 판단해 생략.
- **토글**: 인용 칩·주석과 같은 `bible-cite-show` localStorage 토글로 함께 제어. 별도 설정 항목 추가 없음.
- **데스크탑/모바일 공통**: anchor 는 inline superscript 이라 어느 화면 크기에서도 같은 양식. tooltip 은 기존 note-tooltip 의 anchor-follow 위치 로직 그대로 (위쪽 우선, 자리 부족 시 아래로 뒤집힘).
- **접근성**: anchor 는 `<button class="parallel-anchor">` (네이티브 button — Enter/Space 활성화 자동). `aria-label`: `"5:1-10 병행 본문 안내"`. tooltip 본문 link 도 `<button class="parallel-tooltip-ref">` + `aria-label`: `"<ref> 본문 보기"`.

#### `<cite>` 와의 관계

- `<cite>` 와 `<parallel>` 은 의미 영역이 일부 겹치지만 (둘 다 다른 본문 위치를 가리킴) 명확히 다른 layer 에서 작동:
  - `<cite>` — 한 절 안의 quote 한 조각 → segment 레벨, inline 칩
  - `<parallel>` — 한 단락 전체의 narrative 병행 → chapter 레벨, block 배너
- 한 chapter 안에 둘 다 공존 가능. 병행 단락 안의 절들이 자체 `<cite>` 를 가지면 그 칩은 정상 렌더 — `<parallel>` 배너와 cite 칩이 한 단락 안에 둘 다 보일 수 있음 (둘이 가리키는 게 다름).
- 데이터 스키마도 분리: `<cite>` 는 `segment.cite`·`segment.parallels`·`segment.tradition`, `<parallel>` 은 `chapter.parallels`. 호환성 충돌 없음.

### 3. Parser 전략

- `parser.py` 가 line-by-line state machine 으로 절 분리할 때, `<parallel ... />` 만 있는 줄을 **block 마커** 로 인식 — 직후 첫 절 마커 `[N]` 의 시작 절 번호와 `range` 시작이 일치하는지 검증 후 chapter 레벨 metadata 에 저장.
- `<parallel>` 자체는 어떤 절 안에도 들어가지 않음 (절 외부 줄에만 등장).
- 절 안에 `<parallel>` 가 발견되면 ValueError (구문 위반).
- `split_bible.py` 가 chapter JSON 작성 시 `parallels` 필드를 그대로 옮김.

### 4. 데이터 검증

`common-bible-data/tests/test_parallels.py` (신규):
- `<parallel>` 의 src 각 항목·range 가 ADR-022 §2 의 src 형식 grammar 를 따른다
- src 의 약어가 books.json 에 실재한다
- src·range 의 모든 장·절이 실제 책 범위 안에 있다
- range 시작 절이 마커 직후 첫 절과 일치한다 (cross-check)
- 같은 장 안 parallels 사이 overlap 없음
- tradition 인라인 표기 검증 (ADR-022 §2 개정과 동일)

`tests/test_citations.py` 의 `<cite>` 검증은 그대로 — `<cite>` 와 `<parallel>` 은 독립.

### 5. 앱 유닛 테스트

`tests/unit/parallels.test.js` (신규, 가칭):
- chapter 의 `parallels` 메타 파싱 → 배너 DOM 생성
- 배너 위치 (range 시작 절 직전) 정확성
- 배너 라벨 (단일·다중 src·per-source tradition) 포맷
- 클릭 → openCiteSheet 호출 (mock 으로 위임 검증)
- 토글 off 시 배너 미렌더

## 검토한 대안

| 대안 | 결정 사유 |
|---|---|
| `<aside class="parallel">` (표준 HTML element 우회) | source markdown 이 브라우저 렌더 경로에 없으므로 표준 HTML 준수는 설계 제약 아님 (§ 결정 1). DSL 통일성 우선 → `<parallel>` 직접. |
| 기존 `<cite>` 에 `range` 속성 추가 (재사용) | cite 의 시맨틱(quotation)과 parallel narrative 의 시맨틱이 다름 — 한 element 가 둘을 짊어지면 의도가 흐려짐. JSON 스키마도 verse-segment vs chapter-level 로 layer 가 달라 자연스러운 분리 가능. |
| Markdown heading 컨벤션 (`#### 병행: 2사무 5:1-10`) | source 본문에 heading 이 섞여 reading flow 깨짐. 운문/산문 안에 배치 어색. 파서 패턴 인식도 fragile (`####` 가 의미 있는 prefix 인지 일반 heading 인지 휘파람). |
| HTML 주석 (`<!-- parallel: ... -->`) | comment 라 IDE/뷰어에서 안 보임. 작성자가 의미 있는 데이터인 줄 모르고 지울 위험. silent failure mode. |
| 절-안 wrap (`<parallel>[1] 본문 [2] 본문 ... </parallel>`) | `<cite>` 의 절 경계 규칙(ADR-022 §3) 과 충돌. 파서가 line-by-line 인데 multi-line wrap 은 state machine 부담 큼. self-closing 단일 토큰이 더 깔끔. |

## 결과

- ADR-022 의 `<cite>` 모델이 다루지 못하던 단락 단위 병행 narrative 표현 가능.
- 1sam·1kgs·2kgs·1chr·2chr 의 수십 건 cross-book 병행을 마커 하나로 표기.
- DSL 위치 잡기가 명문화되어 향후 element 추가 시 "표준 HTML 인가" 논쟁 재발 없음.
- `<cite>` 와 `<parallel>` 의 시맨틱 분리로 마크업 의도가 데이터·UI 양쪽에 일관되게 흐름.
- 콘텐츠 작업(2cor.md·mark.md·역사서 등) 은 본 ADR 머지 + 파이프라인 구현 완료 후 별도 진행.
