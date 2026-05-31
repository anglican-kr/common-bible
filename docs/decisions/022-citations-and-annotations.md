# ADR-022: 본문 인용·주석 표현과 단일 토글 렌더

- 일시: 2026-05-23
- 상태: 승인됨 — **Phase 1·Phase 2 완료** (2026-05-25 1.5.x 릴리스 라인). Phase 3(주해 저작)은 콘텐츠 작업으로 장기 진행
- 관련 ADR: ADR-006(운문 segments 포맷, data 저장소), ADR-009(History API 라우팅), ADR-018(`js/app/views-routing.js` 본문 렌더 위치), ADR-020(저장소 4분할 — 본 결정은 app·data 두 저장소를 모두 손댐), ADR-027(source markup DSL 위치 잡기 + 단락 단위 `<parallel>` element — 본 ADR 의 절-단위 `<cite>` 모델로 다룰 수 없는 사무엘/열왕기/역대 간 단락 단위 병행 narrative 표현 도입)

> **현재 상태 (2026-05-27 기준).** Phase 1 데이터 파이프라인 — `common-bible-data/src/parser.py` 가 `<cite>` segment 와 `[^id]` 주석을 추출해 절 JSON 의 `segments`·`notes` 필드에 보존. Phase 2 앱 UI — `js/app/citations.js` (~940줄) 가 인용 칩을 중복되지 않게 렌더, 인용 본문 바텀 시트 (`이 장 전체 보기` 확장 + 인용 절 강조, 드래그 핸들로 리사이즈·닫기, 다중 ref / parallels / 다중 장 지원), 주석 ※ 위첨자 + 클릭 툴팁(인쇄 시 하단 footnote), 첫 진입 코치마크를 모두 담당. 설정에서 칩·주석 각각 토글 (`bible-cite-show` / `bible-note-show` localStorage, 기본 ON). GitHub 이슈 #134/#135/#136 으로 Phase 1/2/3 진행 추적. 유닛 테스트는 `tests/unit/citations.test.js` 20 케이스 + 보고서 `docs/qa/2026-05-23-unit-citations.md`. Phase 3 는 사목·신학 자문으로 NT 전 본문에 `<cite>` + 주석을 수기로 다는 콘텐츠 작업이라 별도 일정.

> **개정 (2026-05-29): 인용 칩 줄바꿈.** 인용 칩을 native `<button>` 대신 `<span role="button" tabindex="0">` 로 렌더한다. 브라우저가 `<button>` 을 `display:inline-block` 으로 강제해 칩 라벨(tradition + src + parallels 다수)이 길어지면 행 중간에서 줄바꿈되지 못하고 한 덩어리로 다음 줄에 떨어지는 문제가 있었다. span 은 주변 본문처럼 인라인으로 흘러 긴 라벨이 `·` 구분자 지점에서 자연스럽게 줄바꿈된다. 이미 주석 anchor(`_wrapAnchor`)가 같은 사유로 span 을 쓰던 선례를 따른 것. span 은 Enter/Space 기본 활성화가 없으므로 `initCiteSheet` 의 keydown 핸들러에서 칩 활성화를 수기로 처리한다.

> **개정 (2026-05-31): per-parallel tradition.** 초기 §2 는 "tradition 은 primary 에만 적용 — parallels 의 사본 전통은 표기하지 않는다" 로 의도적 제약을 두었으나, NT-OT 인용 마크업이 진행되며 src 와 parallels 가 서로 다른 사본 전통(예: NT 본문은 칠십인역 우선, 그 OT 평행은 마소라 본문) 인 케이스가 빈번해 표기 자리 자체가 없는 게 문제였다. parallels 각 항목 끝에 인라인 `[전통]` 접미사를 허용한다 — 예: `parallels="시편 16:8 [칠십인역]; 사도 2:25"`. JSON 스키마는 `parallels: string[]` → `parallels: {ref: string, tradition?: string}[]` 로 승격. tradition 자체는 여전히 **display-only label** — 앱이 공동번역 한 본문만 제공한다는 ADR-022 원칙은 그대로(라우팅·텍스트 소스 전환 없음). 칩 라벨은 각 ref 앞에 prefix 로 그 ref 의 tradition 을 붙인다(`(이사 40:3 · 신명 5:17 · 칠십인역 시편 16:8)`). dedup 키는 `(src, src_tradition, [...(parallel ref, parallel tradition)])` 로 확장 — bare ref 가 같아도 parallel 의 tradition 라벨이 다르면 그룹을 끊는다.

## 맥락

공동번역성서 본문에는 두 종류의 보조 정보가 자연스럽게 따라온다.

1. **인용**: 한 구절이 다른 구절(주로 신약이 구약을, 외경이 구약을)을 그대로 인용하는 경우. 인쇄 성경에서는 보통 인용 끝 괄호로 출처를 표기(`사 53:5`).
2. **주석**: 번역자 주(原文 의미·이문·문화 배경 등). 인쇄본에서는 어절 옆 위첨자 마커 + 장 끝 각주.

현재 데이터 파이프라인(parser.py → split_bible.py)에는 두 정보를 담을 자리가 없다. `source/*.md` 도 평문 + 운문 블록인용(`>`)만 표현하고(ADR-006), 본문 외 메타정보는 0건이다.

PWA 가 Phase 1(읽기 앱)으로 완성된 지금, 이 두 정보를 **독서 몰입을 해치지 않으면서** 데이터·UI 양쪽에 깔끔하게 얹는 결정이 필요하다.

## 결정

### 1. 마크다운 표현 — 의미별 최적 표기

두 정보가 길이·앵커 단위·확장성에서 성격이 다르므로, "전부 HTML 태그로 통일" 하지 않고 각자의 모양에 가장 잘 맞는 표기를 쓴다.

**인용 — HTML5 `<cite>` 요소**

```markdown
그가 찔림은 우리의 허물 때문이요 <cite src="이사 53:5">그가 상함은 우리의 죄악 때문이라</cite>
```

- `<cite>` 가 HTML5 시맨틱 인용 요소라 의미 매칭 정확.
- 마크다운이 raw HTML 통과 → 기존 parser 대규모 손질 없음.
- GitHub PR diff 에서 원문이 그대로 보임 → 비기술 검토자(사목·신학 자문) 도 읽을 수 있음.

**주석 — 마크다운 footnote 문법**

```markdown
…그는 갈릴래아[^1-3]로 떠나셨다.

[^1-3]: 갈릴래아는 당시 로마의 직할령이 아닌 분봉왕 헤로데 안티파스의 통치 구역이었다.
```

- 표준 GFM/Pandoc 문법, 의미 매칭(footnote = annotation) 정확.
- 정의를 장 끝(또는 단락 끝)에 모아둬 본문 흐름이 깨지지 않음, diff 가 깔끔.

**Anchor 지정 — 자동 감지 (기본) vs 명시 (옵션)**:

기본은 **자동 감지** — `[^id]` 마커 직전 어절(공백으로 구분된 한 단어) 을 anchor 로 인식. 가장 흔한 케이스.

다중 어절을 anchor 로 잡으려면 **`<note>...</note>` 래퍼로 명시**:

```markdown
'<note>주님이신 너희 하느님</note>[^4-1]을 경배하고 그분만을 섬겨라.'

[^4-1]: 신명 6:13 에서 인용된 표현.
```

- `<note>` 가 wrap 한 텍스트 전체가 anchor 가 됨. 직전 어절 자동 감지를 override.
- 미사용 시 기존 자동 감지 그대로 작동 — backward compatible.
- `<note>` 가 닫히지 않으면 parser 가 명시 에러 (조용한 데이터 손실 방지). cite 와 같은 정책.

- ID 컨벤션 (2-layer):
  - **source 마크다운**: `<장>-<번호>` (예: `1-3`). 책 단위 파일 내 unique 보장 + 표준 마크다운 footnote 의 파일 내 ID 유일성 요구 충족. `[^...]` 자체가 footnote 신호라 안의 prefix 는 단순 `<장>-<n>` 으로 충분.
  - **장 JSON 출력**: 장 단위 파일이라 chapter prefix 까지 떼고 `<번호>` 만 string 으로 보존 (예: `"3"`).
  - 번호는 **장 안에서만 순차** — 장이 넘어가면 1 부터 다시. 인쇄 성경 footnote 관습과 일치.

### 2. `<cite>` 속성 스펙

**`src` (필수)** — 인용 출처 위치. 다음 형식 허용:

| 형식 | 예시 | 의미 |
|---|---|---|
| `<short_name_ko> <chap>:<verse>` | `이사 53:5` | 단일 절 |
| `<short_name_ko> <chap>:<v>-<v>` | `이사 53:5-7` | 같은 장 내 절 범위 |
| `<short_name_ko> <chap>:<v>,<v>[,<v>...]` | `판관 13:5, 7` | 같은 장 내 비연속 다중 절 (콤마 뒤 공백 허용) |
| `<short_name_ko> <chap>:<v>-<v>,<v>` | `이사 53:5-7, 9` | 범위 + 콤마 혼합 (같은 장) |
| `<short_name_ko> <chap>:<v>,<chap>:<v>[...]` | `다니 9:27, 11:31, 12:11` | 같은 책 내 다중 장 콤마 — 각 콤마 part 가 옵션으로 `<chap>:` prefix 허용 |
| `<short_name_ko> <chap>:<v>-<chap>:<v>` | `이사 8:23-9:1` | 장 경계 가로지르는 범위 |

- `short_name_ko` 는 `books.json` 의 기존 필드를 그대로 사용(예: `창세`, `이사`, `마태`). 별도 약어 사전 불필요.
- 다중 장 콤마는 각 part 가 독립적으로 `<chap>:<v>` 또는 `<v>` (직전 part 의 chap 가 아닌, top-level start chap 을 inherit). 예: `판관 13:5, 7` → 둘 다 13장. `다니 9:27, 11:31` → 9장 27절, 11장 31절.
- cross-chapter range 와 다중 장 콤마 혼합(`이사 8:23-9:1, 10:5` 같은) 같은 exotic 케이스는 1차 미지원 — 필요 시 두 개의 `<cite>` 로 분리.
- navigate 는 항상 첫 절 기준 (예: `다니 9:27, 11:31, 12:11` → `/dan/9#v27`).
- ADR-003 cross-chapter relocation 절(호세 13:14, 잠언 6:22, 이사 41:6, 1역대 9:33, 욥 26:5, 욥 27)을 인용할 때 `src` 는 학문적 출처 그대로 표기한다(예: `호세 13:14`). 데이터 검증과 navigate 은 해당 절 파일에 절이 없으면 같은 책의 다른 장 파일에서 `chapter_ref == <장>` 인 절을 추가로 찾는다 — 공동번역 인쇄본의 물리적 배치(예: 13:14 가 hos-14 안 5절과 6절 사이)와 학문적 표기가 동시에 호환된다.

**`parallels` (옵션)** — 같은 내용이 OT 두 곳 이상에 거의 같은 표현으로 등장하는 경우의 병행 참조(parallel reference). 인쇄 가톨릭·성공회 성경의 `출애 20:13(신명 5:17)` 표기와 같음 — primary 가 `src`, 그 다음에 등장하는 동등 출처들이 `parallels`.

형식: `src` 와 같은 형식의 인용 위치 한 개 이상, **세미콜론(`;`)** 으로 분리. 콤마는 같은 책 내 다중 절을 의미하므로(`판관 13:5, 7`) parallels 사이 구분자는 `;` 로 명확화. 각 항목 끝에 옵션 `[전통]` 인라인 접미사를 붙여 그 parallel 의 사본 전통 라벨을 지정할 수 있다(2026-05-31 개정).

```markdown
<cite src="출애 20:13" parallels="신명 5:17">"살인하지 못한다."</cite>
<cite src="출애 20:13" parallels="신명 5:17; 마르 12:29">…</cite>  <!-- 다중 -->
<cite src="시편 16:8" parallels="시편 16:8 [칠십인역]; 사도 2:25">…</cite>  <!-- per-parallel tradition -->
```

렌더:
- 칩: `(출애 20:13 · 신명 5:17)` (구분자 `·`, Phase 2 시각 확정). per-parallel tradition 이 있으면 해당 ref 앞에 prefix — `(시편 16:8 · 칠십인역 시편 16:8 · 사도 2:25)`
- 시트: 헤더에 primary 출처, 본문에 primary + parallel 본문들을 시각 구분선으로 분리해 모두 표시 — 사용자가 OT 두 곳 비교 즉시 가능. 각 ref 헤더에 그 ref 자체의 tradition 라벨이 표시됨

검증: `parallels` 의 각 항목도 `src` 와 같은 형식·약어·장·절 범위 규칙을 따른다(`[전통]` 접미사는 ref 와 분리해 검증). primary 의 `tradition` 속성과 parallel 의 인라인 `[전통]` 은 **독립적** — 한 cite 가 src 는 마소라, 일부 parallel 은 칠십인역인 혼합 표기를 자연스럽게 담는다.

**`tradition` (옵션)** — 인용된 사본 전통. 생략 시 default = 히브리 본문(마소라).

| 권장 어휘 | 의미 |
|---|---|
| `칠십인역` | LXX (그리스어 구약, 신약 인용 다수의 출처) |
| `마소라` | MT (히브리 본문, default 와 동일 — 명시할 때만 사용) |
| `불가타` | Vulgate (라틴어 구약) |
| 그 외 | 저자 재량 자유 문자열 (`사해사본` 등) |

예시:
```markdown
<cite src="이사 40:3" tradition="칠십인역">"광야에서 외치는 이의 소리…"</cite>
```

용도는 **display-only metadata** — 렌더 시 칩에 부가 표기로 노출 (`(이사 40:3 · 칠십인역)`). URL navigate 은 항상 본 앱의 공동번역 본문 한 종류만 가리키므로 tradition 은 라우팅에 영향 없음.

> 본 ADR 초안에서는 tradition 을 YAGNI 로 잘랐으나, 실제 NT-OT 인용 마크업을 시작하면서 LXX 우선 인용(특히 로마서·히브리서) 이 빈번해 사용자에게 "이 NT 인용이 우리 공동번역과 다른 사본 전통" 임을 알려야 한다는 필요가 드러났다. 절 번호 차이 매핑 책임은 여전히 데이터 측이지만, display label 목적의 tradition 은 인용 태그가 짊어지는 게 자연스럽다. "검토한 대안" 표의 해당 항목도 함께 갱신.

### 3. 절 경계 규칙 — 단일 `<cite>` 는 한 절 안에 닫혀야 함

`<cite>` 태그는 한 절 마커(`[N]`) 시작 이후 다음 절 마커 이전 사이에서 열리고 닫혀야 한다. 한 인용이 여러 절에 걸친 경우 저자가 절마다 별도의 `<cite>` 를 작성하고 같은 `src` 값을 반복한다.

**이유**: parser 가 line-by-line state machine 으로 절을 먼저 분리하므로 절 경계를 가로지르는 단일 `<cite>` 는 segment 단위 후처리에서 정규식 매칭이 깨진다. 닫히지 않은 `<cite>` 가 source 에 발견되면 `parser.py` 가 명시적 에러로 실패해 조용한 데이터 손실을 막는다.

**예시** — 마태 4:15-16 가 이사 8:23-9:1 한 단위를 인용하는 경우:

```markdown
> [15] <cite src="이사 8:23-9:1">"즈불룬과 납달리, 호수로 가는 길,
> 요르단 강 건너편, 이방인의 갈릴래아.</cite>
> [16] <cite src="이사 8:23-9:1">"어둠 속에 앉은 백성이 큰 빛을 보겠고
> 죽음의 그늘진 땅에 사는 사람들에게
> 빛이 비치리라."</cite>
```

두 절에 같은 `src` 가 명시. 렌더 dedup 규칙(§6) 으로 칩은 마지막 절(v16) 에 한 번만 노출.

**원자 단위 매핑이 불가능한 경우**: NT 인용이 OT 한 절에 정확 대응하지 않고 paraphrase 인 경우, 저자는 가장 가까운 OT 위치를 단일 src 로 명시하고 절마다 같은 src 를 반복한다. 정확한 cross-reference 매핑은 데이터 부담을 키우지 않는다.

주석은 정의상 어절 단위 앵커라 절 경계를 가로지를 일이 없음. 별도 규칙 불요.

### 4. JSON 스키마 확장

**인용 — segment 레벨 `cite` 필드**

기존 `segments[i]` 에 옵션 필드 추가:

```json
{
  "type": "prose",
  "text": "그가 상함은 우리의 죄악 때문이라",
  "cite": "이사 53:5"
}
```

`<cite>` 가 segment 일부만 차지하면 split 해서 cite 가 있는 segment 와 없는 segment 로 쪼갠다. 운문(`type: "poetry"`) 의 한 행이 인용인 경우도 동일.

**주석 — verse 레벨 `notes` 배열**

verse 객체에 옵션 필드:

```json
{
  "number": 23,
  "segments": [...],
  "notes": [
    {
      "id": "3",
      "anchor": "갈릴래아",
      "anchor_occurrence": 1,
      "body": "갈릴래아는 당시 로마의 직할령이 아닌…"
    }
  ]
}
```

`anchor_occurrence` 는 같은 어절이 절 안에 여러 번 나올 때 N번째 발견을 가리킴(1-indexed, 기본 1). 렌더에서 우선 무시해도 동작 — 첫 occurrence 에 매핑.

`body` 는 평문 문자열. 마크다운 inline 서식(강조·링크 등) 은 1차 버전에서 지원 안 함.

### 5. 동시 발생 처리

같은 절에 인용·주석이 동시 발생하는 케이스는 데이터상 가능하지만 현재 콘텐츠에는 없음. 발생 시 렌더 순서 규칙만 박아둠:

- 인용 칩이 본문 끝에 먼저, 그 아래 줄에 주석 단락.
- 둘 다 같은 토글로 켜고 끔.

### 6. UI 렌더 정책 (Phase 2)

- 단일 토글 **"인용 본문·주석"** 로 인용·주석을 함께 제어. localStorage 키 `bible-cite-show` (기본값 `"1"` = 표시).
- **기본값 ON** (Phase 2 확정, 초기 ADR 의 "off 기본" 결정 뒤집음). 사유: 콘텐츠 저작 노력의 발견율 + 칩 클릭이 페이지 이동 아닌 바텀 시트라 비침습적. 사용자가 의도적으로 끌 수 있음.
- 토글 off → 본문에 어떤 시각적 marker 도 없음. WCAG 2.1 AA + 읽기 몰입 (절 번호 aria-hidden 결정과 같은 결).
- 토글 on (기본):
  - 인용: cite segment 끝에 옅은 회색 칩 `(이사 53:5)`. **칩 클릭 시 바텀 시트가 열려 인용된 절들을 시트 안에서 보여준다.** 페이지 이동 없음 — 사용자가 시트를 닫으면 읽던 위치 그대로. 본문 글자에는 링크 스타일(밑줄·색) 적용 안 함.
    - **운문(`type: "poetry"`) 인용 예외**: 인라인 칩은 시(詩) 의 행 구조를 시각적으로 깨므로, 운문 끝에 줄바꿈 후 별도 줄로 칩을 표시한다. 들여쓰기는 운문 본문과 동일 또는 한 단계 더 들여 정렬 (Phase 2 시각 확정).
    - **dedup**: 연속 절들이 모두 같은 `(src, tradition, parallels)` cite 를 가지면, 렌더는 그 연속 그룹의 **마지막 절에만 칩을 1회** 표시한다. 같은 인용이 절 경계로 쪼개진 경우(§3) 시각적으로 한 단위로 묶기 위함. `parallels` 비교는 각 항목의 `(ref, tradition)` 튜플 순서까지 포함 — bare ref 가 같아도 per-parallel tradition 라벨이 다르면 그룹을 끊는다(2026-05-31 개정).
    - **tradition 표기**: `tradition` 속성이 있으면 칩의 primary src 앞에 prefix. parallels 의 각 항목에 인라인 `[전통]` 이 있으면 그 ref 앞에 동일 형식 prefix(2026-05-31 개정). 권장 layout `(칠십인역 이사 40:3 · 신명 5:17 · 칠십인역 시편 16:8)` — 구분자 `·` 는 ref 사이에만, tradition-ref 결합은 공백 한 칸. 생략 시 그 ref 는 prefix 없이 노출(라벨 자체가 표기 안 됨).

  - **인용 바텀 시트 (cite sheet)**: 칩 클릭 시 열리는 모달 시트. 페이지 이동 없이 인용된 본문을 시트 안에서 표시 — 독서 흐름 유지 (절 번호 aria-hidden 결정과 같은 결).
    - **헤더**: 출처 표기(`이사 53:5` + tradition 있으면 `· 칠십인역`) + 닫기 버튼
    - **기본 본문**: 인용된 절(들)만 슬라이스해 노출. 절 번호·운문/산문 등 본 앱 본문 렌더와 동일 양식 재사용
    - **확장**: 하단에 `이 장 전체 보기` 액션 — 클릭 시 같은 시트 안에서 본문 전체로 확장 (페이지 이동 여전히 없음). 사용자가 인용 주변 더 넓은 맥락을 볼 수 있음
    - **cross-chapter range** (`이사 8:23-9:1`): 시트에 두 장 모두를 시각 구분선으로 분리해 한꺼번에 표시. 페이지 이동 없이 양쪽 컨텍스트 모두 노출 — navigate 대비 우월
    - **comma 다중 절** (`판관 13:5, 7`): 같은 장 안 비연속 절들을 시트에서 모아 표시 (사이 `…` 또는 절 번호 간격으로 구분)
    - **모바일/데스크탑**: 기존 검색 결과 시트 패턴 재사용. 모바일은 화면 하단에서 끌어올림, 데스크탑은 동일 시트가 적당한 폭으로 표시 (별도 popover 컴포넌트 불필요)
    - **접근성**: `role="dialog"` + `aria-modal="true"`, ESC 닫기, focus trap, 닫을 때 원래 칩으로 focus 복귀, 본 본문은 `inert` 처리
    - **시트 내 본문은 칩·주석 비렌더**: 시트가 보여주는 인용 본문은 항상 "출처·주석 토글 off" 상태로 렌더한다 — 중첩 시트 회피 + 깨끗한 원문 우선. 사용자가 더 깊이 탐색하려면 시트 닫고 메인 navigate 후 거기서 칩 클릭(드문 케이스, 의도적 부담)
  - 주석: anchor 어절에 옅은 점선 밑줄 표시. **클릭 시 그 자리 근처에 작은 툴팁 팝오버로 주석 본문 표시** — 인쇄 footnote 의 "본문 → 하단 → 본문" 왕복 부담을 없애고 읽던 위치에서 즉시 확인. 툴팁은 ESC·바깥 클릭으로 닫힘. 모바일은 화면 폭에 맞춰 자동 정렬, 위/아래 공간 부족 시 반대편으로 뒤집힘.
    > **개정 (2026-05-24, dev 검토):** 초기 디자인은 anchor 에 윗첨자 ref 번호 + 장 끝 "주석" 섹션 (인쇄 학술 footnote 양식) 이었으나, dev 검증 시 본문 끝까지 스크롤하고 다시 돌아오는 흐름이 디지털에서 부자연스럽다는 판단으로 툴팁 양식으로 전환. 윗첨자 번호 + 하단 섹션 둘 다 제거.
- 첫 진입 코치마크 1회 — 인용 칩을 가리키며 "회색 인용 버튼을 누르면 인용 원문이 시트로 열립니다" 안내 (토글 기본 ON 이라 칩 자체가 발견 매개).

> **개정 (2026-05-31): 복사 시 칩·주석 마커 제외.** 절 복사(시스템 Cmd/Ctrl+C 드래그 선택 + 절 선택바 `복사` 버튼)는 인용 칩과 ※ 변형 주석 마커를 본문에서 제외한다. 두 경로가 공유하는 직렬화기 `serializeVerseRange`(`js/app/bookmark.js`, VERSE_SERIALIZE 블록)가 클론된 range 에서 `.cite-chip` 과 `.note-anchor--variant` 를 제거한다 — 이들은 읽기 보조 UI 일 뿐 성서 본문이 아니다. 반면 어절을 감싸는 텍스트 앵커 주석(`.note-anchor`, 비변형)은 실제 본문 단어를 감싸므로 그 textContent 는 그대로 남긴다. e2e 회귀: `tests/e2e/test_copy.py::test_copy_excludes_citation_chip_and_note_marker`.

절 단위 앵커 네비게이션(`/isa/53#v5`) 이 라우터에 없으면 Phase 2 에 함께 추가. 범위 인용은 시작 절 스크롤 + 끝 절까지 일시 하이라이트.

### 7. 데이터 검증 테스트 (Phase 1)

`common-bible-data/tests/` 에 추가:

- `<cite src>` 가 `<short_name_ko> <chapter>:<verse>(-<verse>)?` 형식인지 정규식 검증.
- `src` 의 약어가 `books.json` 의 `short_name_ko` 에 실재하는지.
- `src` 의 장·절이 실제로 그 책에 존재하는지(`chapter_count` + 해당 장의 verse 수 검사).
- footnote ID 형식: source 의 `[^<장>-<n>]` 가 형식에 맞고, chapter prefix 가 실제 anchor 위치의 장과 일치.
- footnote ID 정합성: 본문 anchor `[^id]` 가 모두 정의를 가짐(orphan 0), 정의된 ID 가 모두 본문에서 참조됨(unused 0).
- footnote 번호 순차성: 같은 장 안 ID 가 1, 2, 3… 빈 번호 없이 연속.
- footnote anchor 어절이 실제로 같은 절 본문에 존재.

## 검토한 대안

| 대안 | 보류 이유 |
|---|---|
| 인용·주석 둘 다 HTML 태그(`<cite>` + `<note>`)로 통일 | 주석이 한 단락 분량이면 본문 한 줄이 매우 길어짐. 마크다운 소스 가독성·diff 모두 나빠짐. |
| 인용·주석 둘 다 footnote 문법으로 통일 | 인용은 짧은 메타데이터(`사 53:5`)라 footnote 정의를 따로 두는 게 과함. `<cite>` 가 의미 더 정확. |
| `src` 에 OSIS book_id(`isa`) 사용 | source/*.md 가독성 ↓. 비기술 검토자(사목·신학 자문) 가 즉시 못 읽음. `short_name_ko` 가 이미 books.json 에 있으므로 추가 매핑 부담 0. |
| ~~`tradition`/`lxx`/`mt` 속성으로 사본 전통 표현~~ (개정: tradition 복원) | 초기엔 YAGNI 로 잘랐으나 실제 NT-OT 마크업 시작 시 LXX 인용에 "이 NT 구절은 칠십인역 본문 인용임" 을 사용자에게 알릴 필요가 드러남. **§2 로 tradition 옵션 속성 복원** — display label 목적 한정, 절 번호 차이 매핑은 여전히 데이터 측 책임. |
| 인용 칩에 본문 글자도 함께 링크 스타일 적용(밑줄·색) | 본문 인용 텍스트의 시각 무게 ↑ → 몰입 ↓. 절 번호 aria-hidden 결정과 결 불일치. |
| 주석 토글 / 인용 토글 분리 | UX 복잡도 ↑. 별도 가치는 있지만 1차 버전엔 단일 토글이 충분. 추후 사용자 피드백으로 분리 검토. |
| 마커(별표·위첨자) 를 토글 off 에도 노출해 발견율 ↑ | "off = 완전 비표시" 원칙 위반. 토글 위치는 코치마크 1회로 보강. |
| 주석 정의에 마크다운 inline 서식 허용 | 1차 버전 단순화 우선. 필요 시 후속 ADR. |

## 영향

### ADR-006 (운문 segments 포맷, data 저장소)
- segment 객체에 옵션 필드 `cite` 추가. 운문 한 행이 인용인 경우도 같은 메커니즘.
- ADR-006 본문(데이터 저장소)에 "segments 옵션 필드" 절 보강 필요.

### ADR-004 (데이터 파이프라인 테스트 전략)
- Level 1 완전성 검증에 cite/footnote 정합성 검증 항목 5종 추가. ADR-004 본문 갱신.

### ADR-009 (History API 라우팅)
- 절 단위 앵커(`#v5`) 지원이 라우터에 없으면 Phase 2 에 추가. 추가 시 ADR-009 개정.

### ADR-021 (콘텐츠 해시 매니페스트)
- 영향 없음. cite/notes 는 기존 bible/*.json 안에 들어가므로 매니페스트가 자동으로 해시 변화 감지.

### 저장소별 작업 분담 (ADR-020)
- `common-bible-data`: parser.py·split_bible.py 확장, 검증 테스트, ADR-006 갱신, 픽스처 재생성. PR 머지 먼저.
- `common-bible`: 본 ADR, Phase 2 UI(`js/app/views-routing.js` 렌더 분기 + `js/app/settings-ui.js` 토글 + CSS), 라우터 절 앵커, 유닛·e2e 테스트, 서브모듈 포인터 bump. 데이터 PR 머지 후.

## Phase

- **Phase 1** (데이터 파이프라인, `common-bible-data`):
  - parser.py — `<cite>` 추출(span + src), `[^id]` 추출(앵커 어절 + occurrence index + 본문).
  - split_bible.py — 절 단위 JSON 에 `cite` segment 필드 + verse `notes` 배열 보존, 절 경계 분리 규칙 구현.
  - 검증 테스트 5종.
  - ADR-006 갱신.
  - 시범 적용: 마태 1-2장 또는 OT 인용 밀집 구간 1~2장에 수기로 `<cite>` + 주석 한두 개 달아 파이프라인 통과 확인.
- **Phase 2** (앱 UI, `common-bible`):
  - 토글 위젯(`js/app/settings-ui.js`) + localStorage 영속화.
  - 본문 렌더 분기(`js/app/views-routing.js`) — cite 칩 + 주석 단락.
  - CSS — 옅은 회색 톤·indent, 링크 스타일은 칩에만.
  - 라우터 절 앵커(필요 시 ADR-009 개정).
  - 첫 진입 코치마크 1회.
  - 토글 명칭 확정.
  - 유닛 테스트 + e2e.
- **Phase 3** (주해 저작, 장기):
  - 사목·신학 자문 협업으로 NT 전체에 `<cite>` + 주석 수기 작성.
  - 마크업 작업이 아니라 콘텐츠 저작 — 별도 일정·검토 프로세스.

## 검증

Phase 1:
- 파이프라인 단위 테스트(시범 적용 장에서 cite/notes 정상 추출).
- Level 1 검증 5종 통과.
- `data/bible/*.json` schema 가 ADR-018 모듈 분할 후 클라이언트 렌더 코드 가정에 부합하는지(추가 필드는 옵션 → 기존 코드 무해).

Phase 2:
- 유닛 — 토글 상태 영속화, 칩·주석 렌더 분기, 링크 생성(약어 → URL).
- e2e — 토글 on/off 시 시각 변화, 칩 클릭 시 출처 페이지로 이동, 절 앵커 스크롤.
- 접근성 — 토글 off 시 본문에 스크린리더가 읽을 추가 콘텐츠 없음. 토글 on 시 칩·주석에 적절한 role/aria 라벨.
