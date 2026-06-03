# 공동번역성서 디자인 시스템

> 이 문서는 공동번역성서 PWA 의 **디자인 단일 권위 출처(single source of truth)** 다.
> 색·간격·타이포·반경·elevation·모션·컨트롤 크기의 토큰 사다리와 컴포넌트 규약을
> 정의한다. 실제 토큰 값은 `css/style.css` 상단 `:root` 에 있고, 이 문서는 그 토큰을
> **언제·어떻게 쓰는지**를 설명한다. 새 UI 를 만들 때는 하드코딩 값을 두지 말고 반드시
> 토큰을 참조한다.
>
> 결정 근거·대안 검토는 [ADR-028](docs/decisions/028-design-system.md). 개별 화면
> 결정은 ADR-005·007·008·022·023·024·025·027 을 교차 참조한다.

---

## 1. 디자인 원칙

본 앱은 **Apple Human Interface Guidelines(HIG)** 를 chrome UI(헤더·버튼·시트·설정·
내비게이션)의 기준으로 삼는다. 단, 성경 **본문**은 전례·가독성 전통을 위해 의도적으로
HIG 와 다른 선택(Serif·넉넉한 행간)을 유지한다 (§3, §11).

HIG 3대 테마를 본 앱 맥락으로 옮기면:

- **명료성(Clarity)** — 본문이 주인공. chrome 은 절제하고 콘텐츠에 자리를 양보한다.
  텍스트 대비는 WCAG 2.1 AA 이상, 터치 타깃은 최소 44pt.
- **경의(Deference)** — 장식이 콘텐츠를 가리지 않는다. 그림자·테두리는 깊이를 암시하는
  최소한으로. 하단/오버레이 표면(오디오 바·절 선택 바·검색 스크림)에는 frosted glass
  (`backdrop-filter: blur`)를 쓰지만, **헤더만** 솔리드로 두고 elevation 그림자로 깊이를
  표현한다 — iOS toolbar tinting / PWA status bar 비동기 문제 회피 (ADR-025).
- **깊이(Depth)** — elevation(그림자 사다리)과 시트/팝오버의 레이어로 위계를 표현.
  스크롤 시에만 헤더가 그림자를 얻어 "떠 있음"을 알린다 (ADR-025).

추가로 본 앱이 지키는 원칙:

- **오프라인 우선** — 모든 UI 는 네트워크 없이 동작. 로딩 상태도 디자인 대상.
- **접근성 우선** — skip-link, focus trap, `aria-live`, `prefers-reduced-motion`,
  `sr-only` 를 표준으로 채택 (§10).
- **Dynamic Type 존중** — 사용자의 글자 크기 설정이 루트 폰트를 바꾸면 타이포·아이콘이
  함께 스케일한다. 그래서 **타이포는 rem, 레이아웃 간격은 px** 로 분리한다 (§3·§4).

---

## 2. 색상 & 테마

색상은 세 겹의 `data-*` 속성으로 분리된다 — `css/style.css` 의
`:root` / `[data-theme="dark"]` / `[data-color-scheme]`.

### 토큰

| 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|
| `--bg` | `#faf8f5` | `#1f1f36` | 페이지 배경(따뜻한 크림 / 깊은 네이비) |
| `--bg-card` | `#ffffff` | `#252540` | 카드·팝오버·시트 표면 |
| `--text` | `#2a2520` | `#e0dcd6` | 본문·1차 텍스트 |
| `--text-secondary` | `#5a554d` | `#a0a0a0` | 보조 텍스트·라벨 |
| `--accent` | `#3a3a42` | `#b8b8c2` | chrome 강조(버튼·링크·활성·포커스) — **고정 중립 차콜, 스킴 불변** |
| `--accent-light` | `#56565f` | `#cecdd7` | 강조 변형(고정) |
| `--border` | `#e0dcd6` | `#3a3a55` | 구분선·테두리 |
| `--theme` | `#22244a` | `#8ab4d8` | **테마색(스킴 추종)** — 절 번호·단락 기호·FAB·오디오 플레이어 전용 |

### 색상 스킴 (테마색 4종)

`[data-color-scheme="red|green|purple"]` 는 **`--theme` 하나만** 교체한다 (기본 네이비 포함
4종, 각 라이트/다크 변형). 테마색이 칠해지는 곳은 **절 번호·단락 기호·FAB·오디오 플레이어
네 곳으로 한정**한다 (ADR-028 개정 2026-06-03). 진한 채도로 통일한다.

나머지 chrome(버튼·토글·포커스 링·링크·활성 상태 등)은 `--accent`(고정 중립 차콜)를 쓰며
**스킴을 따르지 않는다** — 어떤 테마색을 골라도 chrome 톤은 동일하게 유지된다. 컴포넌트에
색을 하드코딩하지 않는 원칙은 그대로다(`--accent` 또는 `--theme` 중 역할에 맞는 토큰 참조).

테마색 4종 라이트/다크 (`--theme`): 네이비 `#22244a`/`#8ab4d8` · 빨강 `#a01828`/`#e08090` ·
초록 `#1a6b50`/`#5ab896` · 보라 `#5a2d82`/`#c09ad8`.

### 규약

- **포커스 링·은은한 강조 배경**은 `color-mix(in srgb, var(--accent) N%, transparent)`
  관용구를 쓴다 (예: 포커스링 15%, 선택 셀 링 55%). 별도 토큰화하지 않고 이 패턴을 표준으로
  한다. 테마색이 칠해지는 4곳의 보조 표현(오디오 thumb 링 등)은 `--theme` 로 같은 관용구를 쓴다.
- **accent 채움 위 텍스트는 `var(--bg)`** — 라이트에서 크림(`#faf8f5`), 다크에서 네이비
  (`#1f1f36`)로 자동 뒤집혀 양쪽 모두 대비를 확보한다. `--accent` 가 고정 중립 차콜이 되며
  (다크에서는 밝은 회색) `#fff` 하드코딩은 다크에서 흰 글자가 묻히므로 `var(--bg)` 로 통일했다
  (ADR-028 개정 2026-06-03). 빨강 파괴 동작 버튼(삭제·캐시 비우기 등)만 예외로 `#fff` 유지.
- 다크 모드는 `prefers-color-scheme` 자동 감지가 아니라 **명시 토글**(`[data-theme]`).
  설정에서 사용자가 직접 전환하므로 토큰이 즉시 바뀌어야 한다.

---

## 3. 타이포그래피

핵심 결정: **본문(성경 텍스트)은 Serif 유지, chrome UI 만 시스템 산세리프.**

| 영역 | 폰트 스택 | line-height |
|---|---|---|
| 본문(성경) | `"Noto Serif KR", "Batang", serif` | `--leading-relaxed` (1.8) |
| 운문 | 동일 Serif | `--leading-loose` (2) |
| UI(헤더·버튼·시트·설정) | `-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif` | `--leading-snug`~`--leading-normal` |

iOS/macOS 에서 `-apple-system` 은 SF Pro 로 해석되어 HIG 네이티브 느낌을 준다. 본문 Serif
는 가독성과 전례 전통을 위한 **의도적 HIG 이탈** (§11 표 참조).

### 타입 스케일 (rem — 폰트 크기 설정과 함께 스케일)

루트 폰트는 `html { font-size: 18px }` 이고, 설정의 글자 크기가 이 값을 바꾼다. 그래서
타이포는 **rem** 으로 두어 전체가 함께 커진다(Dynamic Type).

| 토큰 | 값 | 대략 용도 |
|---|---|---|
| `--font-2xs` | `0.7rem` | 절 번호, 미세 라벨 |
| `--font-xs` | `0.78rem` | 주석·캡션·도움말 |
| `--font-sm` | `0.85rem` | 보조 텍스트·검색 입력·시트 본문 |
| `--font-base` | `0.92rem` | UI 기본(탭·설정 라벨) |
| `--font-md` | `1rem` | 본문·헤드라인 |
| `--font-lg` | `1.15rem` | 페이지 제목 |
| `--font-xl` | `1.4rem` | 큰 제목 |
| `--font-2xl` | `1.6rem` | 최상위 제목 |

### line-height 토큰

`--leading-tight` 1.3 · `--leading-snug` 1.5 · `--leading-normal` 1.6 ·
`--leading-relaxed` 1.8(본문) · `--leading-loose` 2(운문).

### 규약

- 절 번호 등 숫자 정렬에는 `font-variant-numeric: tabular-nums`.
- 한국어 줄바꿈은 책 목록 등에서 `word-break: keep-all` 로 단어 보존.
- 헤더 행 아이콘은 **rem** 으로 크기를 잡아 텍스트와 함께 스케일한다 — SVG 에 px
  `width/height` 속성을 박지 말 것(큰 폰트에서 아이콘만 어긋난다).

---

## 4. 간격 & 레이아웃

핵심 결정: **간격은 px 기반 8pt 그리드.** Apple HIG 정합이며, 레이아웃(간격)을
콘텐츠(폰트)와 분리해 글자 크기를 키워도 패딩이 일정하게 유지된다.

### 간격 스케일 (8pt 그리드)

| 토큰 | 값 | | 토큰 | 값 |
|---|---|---|---|---|
| `--space-0_5` | `2px` | | `--space-5` | `20px` |
| `--space-1` | `4px` | | `--space-6` | `24px` |
| `--space-2` | `8px` | | `--space-8` | `32px` |
| `--space-3` | `12px` | | `--space-10` | `40px` |
| `--space-4` | `16px` | | `--space-12` | `48px` |

기본 리듬은 8px(`--space-2`)·16px(`--space-4`). 조밀한 컨트롤 내부에만 4px·12px 를 쓴다.

### 레이아웃

- `--max-width: 720px` — 읽기 칼럼 폭. 본문·헤더·시트 데스크탑 폭의 상한.
- safe-area: 고정/스티키 요소는 `env(safe-area-inset-*)` 로 노치·홈 인디케이터를 피한다
  (헤더 `top`, 시트·탭바 `padding-bottom`).
- 스크롤바는 전역 숨김(`scrollbar-width: none`).

---

## 5. 반경(Radius) & Elevation

### 반경 사다리 (HIG 곡률)

| 토큰 | 값 | 용도 |
|---|---|---|
| `--radius-xs` | `4px` | 칩·작은 배지 |
| `--radius-sm` | `6px` | 보조 컨트롤 |
| `--radius` | `8px` | **기본** — 버튼·카드(하위호환 유지) |
| `--radius-md` | `10px` | 중간 카드 |
| `--radius-lg` | `12px` | 팝오버 |
| `--radius-modal` | `14px` | 중앙 모달 다이얼로그 |
| `--radius-xl` | `16px` | 바텀 시트 상단 모서리 |
| `--radius-pill` | `999px` | 알약·토글·FAB |

### Elevation 사다리 (그림자)

HIG 의 절제된 깊이 표현. 라이트 기준 값이며, **다크에서는 `[data-theme="dark"]` 가
같은 토큰을 더 무거운 alpha 로 자동 치환**(옅은 그림자가 어두운 배경에 묻히는 것을 방지).

| 토큰 | 라이트 | 용도 |
|---|---|---|
| `--shadow-1` (=`--shadow`) | `0 1px 3px /.08` | 기본 카드·은은한 떠 있음 |
| `--shadow-2` | `0 4px 12px /.12` | 팝오버·작은 부유 요소 |
| `--shadow-3` | `0 4px 16px /.12` | **헤더 스크롤 elevation** (ADR-025) |
| `--shadow-sheet` | `0 -4px 24px /.18` | 바텀 시트(위로 뜨는 그림자) |
| `--shadow-4` | `0 12px 32px /.25` | 모달 다이얼로그 |

### 규약

- **스크롤 elevation**(ADR-025): 페이지 최상단에서 헤더는 평평(그림자 없음). 스크롤하면
  `#sticky-group.scrolled` 가 `--shadow-3` 를 0.18s 페이드 인. `#app-header::after`
  1px hairline 은 always-on 경계로 별도 유지. 책 목록(탭 스트립) 화면에서는 그림자 생략.
- **frosted glass — 하단/오버레이만, 헤더는 솔리드**: 오디오 바·절 선택 바·검색 스크림
  등 하단/오버레이 표면에는 `backdrop-filter: blur` 를 적용한다. 단 **헤더**는 iOS 26
  toolbar tinting / PWA status bar 비동기 문제로 frosted glass 를 피하고, 불투명 표면 +
  스크롤 elevation(`--shadow-3`)으로 깊이를 표현한다 (ADR-025). iOS HIG 의 상단(정체성)
  / 하단(오버레이) 의도적 차등 처리와 일치.

---

## 6. 컴포넌트 카탈로그

각 컴포넌트는 위 토큰을 조합한다. 클래스명은 하이픈 구분(BEM 유사), 기능 모듈별 접두사
(`bm-` 북마크, `ptr-` 당겨 새로고침, `cite-`/`note-`/`parallel-` 인용·주석).

| 컴포넌트 | 대표 클래스 | 토큰/규약 | ADR |
|---|---|---|---|
| 1차 버튼 | `.bm-btn-primary` | `background:--accent`·`#fff`·`--radius` | — |
| 2차 버튼 | `.bm-btn-secondary` | `1px --border`·`--text-secondary` | — |
| 아이콘 버튼 | `.title-back-btn`·`.title-bookmark-btn`·`.settings-btn` | 투명·`--accent`·**≥44px 탭 영역** | ADR-024 |
| 구분 탭 | `.division-tab`·`.division-tab-indicator` | 슬라이드 인디케이터(트랙 동색 칩 + elevation) | ADR-024 |
| 챕터 팝오버 | `.chapter-popover`·`.popover-grid`·`.popover-item` | `--radius-lg`·격자 카드 | ADR-024 |
| 바텀 시트 | `.search-sheet`·`.cite-sheet`·`.bm-drawer` | `--radius-xl` 상단·`--shadow-sheet`·그래버 핸들·safe-area | ADR-022 |
| 모달 | install/disconnect/bookmark 다이얼로그 | 중앙 정렬·`--radius-modal`·`--shadow-4`·scrim `rgba(0,0,0,.45)` | ADR-008 |
| 툴팁(주석) | `.note-tooltip`·`.note-anchor`(※) | 클릭 트리거·footnote 패턴 | ADR-022·027 |
| 인용 칩 | `.cite-chip` | 옅은 회색 칩·클릭 시 인용 시트 | ADR-022 |
| 토글 스위치 | `.settings` 토글 | iOS/Material/desktop 변형·ON=`--accent` | ADR-023 |
| 검색 | `#search-bar`(데스크탑)·`#search-fab`+`#search-sheet`(모바일) | 반응형 전환 | ADR-005 |
| 북마크 | `.bm-*` 트리·모달·스와이프 | 드로어(모바일 시트/데스크탑 패널) | ADR-011 |
| 절 선택 바 | `.verse-select-bar` | 스티키 하단 바·복사/북마크 | — |
| 오디오 바 | `.audio-player`·`.audio-play-btn` | 스티키 플레이어·≥44px play | — |

### 시트 vs 모달 (HIG)

- **바텀 시트** — 콘텐츠 연장(검색·인용·북마크). 상단 **그래버 핸들** + 드래그 리사이즈 +
  safe-area 하단 패딩. 데스크탑에서는 우측 사이드 패널로 전환.
- **모달** — 결정 강제(설치 안내·연결 해제·북마크 저장). 중앙 정렬 + scrim + focus trap.

---

## 7. 적응형 내비게이션 (계획 — 후속 구현)

> **상태: 결정됨 — 구현 대기.** 아래는 향후 내비게이션 재편의 스펙이다. 이번 디자인 시스템
> PR 은 토큰 예약 + 본 스펙 문서화까지만 하고, 실제 탭바/사이드바 렌더·라우팅 재편과
> **노트(새 기능)** 는 별도 PR 로 진행한다. (ADR-028 §적응형 내비)

HIG 의 적응형 내비 패턴을 따른다 — **좁은 화면은 하단 탭 바(UITabBar), 넓은 화면은
사이드바.**

### 모바일 (≤768px) — 하단 탭 바

- 5개 탭, 좌→우: **홈 · 검색 · 북마크 · 노트 · 설정**.
- 높이 `--tabbar-h` (49px, HIG 표준) + `padding-bottom: env(safe-area-inset-bottom)`
  로 홈 인디케이터 회피.
- 아이콘 `--tabbar-icon` (24px) + 라벨. 활성 탭은 `--accent`(아이콘+라벨), 비활성은
  `--text-secondary`. 각 탭은 ≥`--touch-target`(44px) 탭 영역.
- `z-index: --nav-z` (30) — 스티키 헤더(20) 위.
- `prefers-reduced-motion` 시 탭 전환 애니메이션 생략.

### 데스크탑 (≥769px) — 사이드바

- 좌측 고정 사이드바, 폭 `--sidebar-w` (260px). 동일한 5개 목적지를 세로 목록으로.
- 하단 탭 바는 데스크탑에서 숨김(모바일 전용).

### 현행 → 신규 매핑

| 현재(상단 헤더) | 신규 목적지 |
|---|---|
| 홈 버튼 (`buildHomeBtn`) | **홈** 탭 |
| 검색 FAB / 검색 바 | **검색** 탭 |
| 북마크 버튼 (`.title-bookmark-btn`) | **북마크** 탭 |
| — (신규) | **노트** 탭 |
| 설정 버튼 (`.settings-btn`) | **설정** 탭 |

> 따라서 현행 상단 헤더의 아이콘 버튼들은 후속 PR 에서 탭바/사이드바로 이전된다. 이번
> PR 은 이 영역에 44pt 터치타깃·토큰화 같은 무난한 정리만 적용하고 구조는 건드리지 않는다.

---

## 8. 터치 타깃 & 인터랙션

- **HIG 44pt 최소 탭 영역.** 아이콘 버튼은 시각 크기가 작아도 hit-area 를 ≥44px 로 확보
  (`--touch-target`). **rem 기반 헤더 아이콘**은 `--icon-btn-touch`(2.45rem)로 박스를
  잡아 기본 폰트(18px)에서 ≈44px 에 도달하고 큰 폰트에서는 rem 으로 함께 커진다
  (`.title-back-btn`·`.title-bookmark-btn`·`#cite-sheet-back`·`#cite-sheet-close` 공유).
  고정 크기 컨트롤(오디오 재생 등)은 `min-width/min-height: var(--touch-target)` 로 바닥을 깐다.
- **포인터 분기**: `@media (hover: none) and (pointer: coarse)` 로 터치 기기에서 hover
  의존 UI 를 회피(예: 제목 모바일 약식 표기 강제).
- **활성 피드백**: 투명 아이콘 버튼은 `:active { opacity }`, 채워진 버튼은 미세
  `transform`/그림자.

---

## 9. 모션

| 토큰 | 값 | 용도 |
|---|---|---|
| `--duration-instant` | `0.1s` | press/active 피드백 (가장 짧음) |
| `--duration-fast` | `0.15s` | **기본 미세 전환** (hover·색·작은 transform) — 실사용 dominant |
| `--duration-base` | `0.25s` | 시트·팝오버 등장·중간 전환 |
| `--duration-slow` | `0.4s` | 큰 전환 |
| `--ease-out` | `cubic-bezier(0, 0, 0.58, 1)` | 감속 곡선 — 빠르게 시작해 천천히 멈춤. 진입/이동 UI. CSS `ease`(양끝 느림)와 구분 |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Material 표준 곡선 — 슬라이드 인디케이터 등 위치 이동 |

> 듀레이션은 실사용에 맞춰 조정됨(UI 리팩토링): `--duration-fast` 가 0.18→**0.15s**,
> `--duration-instant`(0.1)·`--ease-standard` 신규. CSS 기본 `ease`(감속+가속) 는 의도적
> 기본 곡선으로 유지하며 `--ease-out`/`--ease-standard` 와 구분한다.

**`prefers-reduced-motion: reduce`** 시 비필수 트랜지션/애니메이션을 끈다(헤더 그림자 전환
등). 모든 신규 모션은 이 분기를 반드시 동반한다.

---

## 10. 접근성 (WCAG 2.1 AA)

- **skip-link** (`.skip-link` "본문 바로가기") — 키보드 포커스 시 노출.
- **focus trap** — 모달·팝오버·시트는 `trapFocus` 로 포커스를 가둔다.
- **라이브 리전** — `#a11y-announce`(`aria-live="polite"`) 로 화면 전환·검색 결과를 안내.
- **`sr-only`** — 시각 비표시·스크린리더 전용 텍스트.
- **대비** — 본문/배경 토큰은 AA 이상. accent 위 텍스트는 `#fff`.
- **`aria-expanded` / `role`** — 탭·팝오버·토글에 상태 노출.

---

## 11. HIG 적용 / 의도적 이탈

| 항목 | 적용/이탈 | 근거 |
|---|---|---|
| 시스템 폰트(SF) — UI | ✅ 적용 | `-apple-system` 스택으로 네이티브 느낌 |
| 44pt 최소 탭 영역 | ✅ 적용 | `--touch-target`, 아이콘 버튼 floor |
| safe-area inset | ✅ 적용 | 노치·홈 인디케이터 회피 |
| 시트 그래버 핸들 + 드래그 | ✅ 적용 | HIG sheet 관용 |
| 적응형 내비(탭바/사이드바) | ✅ 적용(계획) | §7 |
| 절제된 elevation 사다리 | ✅ 적용 | §5 |
| 다크 모드 | ✅ 적용 | 명시 토글 |
| frosted glass — 하단/오버레이 | ✅ 적용 | 오디오 바·절 선택 바·검색 스크림에 `backdrop-filter: blur` |
| **본문 Serif(Noto Serif KR)** | ⛔ 이탈 | 성경 가독성·전례 전통. HIG 본문 산세리프 대신 |
| **frosted glass — 헤더** | ⛔ 이탈 | 헤더만 솔리드 유지. iOS toolbar tinting / PWA status bar 비동기 문제 (ADR-025) |
| **px 간격(폰트와 비연동)** | ◑ 부분 | HIG 8pt 그리드 정합. 단 타이포는 Dynamic Type 위해 rem 유지 |

---

## 부록 — 토큰 빠른 참조

값의 권위 출처는 `css/style.css` 의 `:root`(+`[data-theme="dark"]`). 카테고리:

- **색상** `--bg · --bg-card · --text · --text-secondary · --accent(고정 차콜) · --accent-light
  · --border · --theme(스킴 추종 — 절 번호·단락 기호·FAB·오디오 전용)` (+ 스킴/다크 변형)
- **반경** `--radius-xs/sm/(8) /md/lg/modal/xl/pill`
- **elevation** `--shadow-1/2/3/sheet/4` (`--shadow` = `--shadow-1`)
- **간격(8pt px)** `--space-0_5/1/2/3/4/5/6/8/10/12`
- **타이포(rem)** `--font-2xs/xs/sm/base/md/lg/xl/2xl`, `--leading-tight/snug/normal/relaxed/loose`
- **컨트롤** `--touch-target(44px 고정) · --control-h(36) · --control-h-sm(28) · --icon-btn(40) · --icon-btn-touch(2.45rem, rem 스케일 헤더 아이콘)`
- **모션** `--duration-instant(0.1)/fast(0.15)/base(0.25)/slow(0.4) · --ease-out · --ease-standard`
- **내비(예약)** `--tabbar-h(49) · --tabbar-icon(24) · --sidebar-w(260) · --nav-z(30)`
