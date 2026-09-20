---
date: 2026-05-26
pr: 138
branch: claude/iphone-bottomsheet-clipping-IIwD7
title: "style: cite·search 바텀시트 UX 개선 (클리핑·헤더·확장 뷰·드래그·너비 통일)"
---

# style: cite·search 바텀시트 UX 개선 (클리핑·헤더·확장 뷰·드래그·너비 통일)

cite (인용) + search (검색) 바텀시트의 시각·정보 구조를 정리하고, ref 별 확장 뷰 / 드래그 리사이즈 / 두 시트 간 너비 통일을 추가하는 6건의 커밋.

## 1. cite-sheet 디스플레이 곡률 클리핑 해결 (commit 1)

iPhone 17 (디스플레이 모서리 반지름 약 55~62pt) 에서 floating 시트 (`bottom/left/right: 0.75rem` + 사방 `border-radius: 16px`) 의 **하단 둥근 모서리** 가 디스플레이 곡선에 잘려 보이는 문제. 12px 바깥 마진은 iPhone 의 큰 곡률을 비껴갈 수 없음.

iOS 네이티브 시트 패턴 (Apple Maps, Safari Tab Group) 처럼 **edge-to-edge** 로 변경:

- `bottom/left/right: 0` — 시트가 뷰포트 하단 모서리에 밀착
- `border-radius: 16px 16px 0 0` — 상단 두 모서리만 둥글게
- `box-shadow: 0 -4px 24px rgba(0,0,0,0.18)` — 상방향 그림자
- `padding-bottom: env(safe-area-inset-bottom)` 그대로 유지 — 홈 인디케이터 영역 비킴
- `max-width: var(--max-width)` + `margin-inline: auto` 유지 — 데스크톱에서는 720px 중앙 정렬

디스플레이의 둥근 모서리가 시트 하단을 자연스럽게 마스킹하므로 기기별 곡률 차이 (iPhone X+ 39~62pt, recent Pixels ~26dp 등) 를 코드에서 신경 쓸 필요 없음.

## 2. cite-sheet 헤더·ref-title·chapter-label 정리 (commit 2)

- **시트 헤더 (`#cite-sheet-title`)**: 동적 장/절 문자열 → **"인용된 구절"** 고정. 헤더는 시트 정체성, 구체적 출처는 본문 ref-title 이 담당하도록 책임 분리.
- **본문 ref-title (`.cite-sheet-ref-title`)**: `"이사 7:14 · 칠십인역"` → `"칠십인역 이사 7:14"`. 구분점 (`·`) 없이 공백으로 연결해 한국어 관용 어순 ("칠십인역 ○○서 ○장 ○절") 에 맞춤.
- **chapter-label (`이사야 7장`) 제거**: ref-title 만으로 출처가 충분히 식별 가능하므로 중복 표기 제거. `_renderVerses` 의 `bookNameKo`/`chapter` 인자와 사용처 없는 CSS 규칙도 정리.

## 3. chip 텍스트의 tradition 어순 통일 (commit 3)

본문 인라인 chip 도 시트 ref-title 과 같은 어순으로 맞춤:
- 이전: `(이사 40:3 · 칠십인역 · 마르 1:3)` — tradition 이 parallels 와 같은 ` · ` 구분자를 공유해 인용 절처럼 보이는 시각적 혼선
- 이후: `(칠십인역 이사 40:3 · 마르 1:3)` — tradition 을 primary src 에 공백으로 fuse, 구분자는 인용 절 사이에서만 사용

`chipText` 함수 갱신 + 관련 유닛 테스트 어서션 3건 (`chipText` 2건 + `buildCiteChip` poetry 케이스 1건) 갱신.

## 4. cite-sheet — ref 별 "더 보기" 버튼 · 확장 뷰 · 뒤로가기 (commit 4)

- 단일 "이 장 전체 보기" 버튼 (시트 하단) 을 **ref 별 "› 더 보기" 텍스트 버튼** (각 헤더 옆) 으로 대체. 이전에는 버튼 한 개가 src + 모든 parallels 를 동시에 확장했는데, 이제 각 ref 를 독립적으로 확장할 수 있음.
  - 헤더는 flex 컨테이너 (`.cite-sheet-ref-header`) — 제목은 ellipsis, 버튼은 `flex-shrink: 0` 으로 긴 ref-title 에 가려지지 않음
- 확장 뷰는 선택된 ref 하나만 full chapter 로 렌더하고, 첫 `.verse-highlight` 를 `scrollIntoView({ block: "center" })` 로 본문 중앙에 위치시켜 **인용 절 앞/뒤 절이 컨텍스트로 보이게** 함
- 확장 뷰에서는 시트 헤더 좌측에 **뒤로가기 버튼 (`‹`)** 표시. 클릭 시 compact 뷰로 복귀. ESC 키도 단계적 처리 (확장 뷰면 먼저 compact 로, 한 번 더 누르면 시트 닫힘)
- 상태 모델: `expanded: boolean` → `expandedRefIndex: number | null`

## 5. cite-sheet — 핸들 드래그-리사이즈 (commit 5)

시트 상단 핸들이 시각적 어포던스만 있고 동작이 없었음. `search-sheet` / `bookmark-drawer` 와 동일한 pointer-capture 패턴으로 드래그-리사이즈 추가:

- 높이 범위: **30vh ~ 90vh**
  - max 90vh — 상단에 ~10vh 여백을 남겨 본문이 살짝 비치므로 "모달 위에 있음" 시각 단서 유지
  - min 30vh — 헤더 + 첫 절 정도가 보이는 최소 의미 있는 크기
- 닫기 임계: **<20vh** 까지 끌어내리면 스냅-닫기
- `closeCiteSheet` 에서 inline `style.height` 리셋 → 다음 open 은 CSS 기본 65vh 로 시작 (사용자 리사이즈가 다른 ref 시트로 누설되지 않게)
- 핸들 영역: `cursor: ns-resize` + `touch-action: none` + 패딩 0.6rem 으로 ~24px 터치 타깃 확보

## 6. search-sheet expanded 상태 edge-to-edge + cite-sheet 와 너비 통일 (commit 6)

검색 결과 시트 (`data-state="expanded"`, 키보드 dismissed) 도 동일한 iOS-native 패턴으로 전환. 결정 근거:
- 키보드가 사라진 결과 뷰는 "키보드 위 떠 있는 작은 카드" 가 아니라 "본문 위에 펼쳐진 콘텐츠 패널" 이라 edge-to-edge 가 더 자연스러움
- 결과 텍스트 가용 폭도 12px 만큼 확보됨

변경 사항:
- **base `#search-sheet`** = edge-to-edge (bottom/left/right 0, border-radius `16px 16px 0 0`, 상방향 그림자, `max-width: var(--max-width)` + `margin-inline: auto`)
- **`[data-state="compact"]`** = 기존 floating 카드 (0.75rem 마진 + 사방 border-radius + 옴니 그림자) — 키보드 up 상태는 그대로 보존
- compact ↔ expanded **부드러운 220ms morphing** — transition 목록에 `border-radius` 추가, `height/bottom/left/right/box-shadow` 는 기존부터 보간되어 있음. 결과적으로 키보드 dismiss 시 floating 카드가 edge-to-edge 시트로 자연스럽게 펼쳐짐
- cite-sheet 와 동일하게 데스크톱 720px 중앙 정렬되어 두 시트의 너비가 일치함

## 검토 대상 (별도 PR)

기존에 미적용된 search-sheet 의 keyboard-up 상태 (`compact`) 는 의도된 floating 디자인을 유지함 — 키보드 레이아웃과의 시각적 조화 때문.

## Test plan

### 자동
- [x] 유닛 테스트 529 케이스 통과 (`node --test tests/unit/*.test.js`)
- [x] TypeScript 타입 체크 통과 (`npx tsc -p tsconfig.json --noEmit`)

### 수동
#### cite-sheet
- [ ] iPhone 17 에서 cite chip 탭 → 시트 하단 모서리가 디스플레이 곡률에 잘리지 않는지 확인
- [ ] iPhone 13/14 (~39pt 곡률) 등 다른 iPhone 모델에서도 정상 표시 확인
- [ ] 홈 인디케이터 영역과 시트 하단 컨텐츠가 겹치지 않는지 확인
- [ ] 데스크톱 (>720px) 에서 시트가 720px 폭으로 중앙 정렬되어 표시되는지 확인
- [ ] 시트 헤더가 항상 "인용된 구절" 로 표시되는지 확인
- [ ] 본문 인라인 chip 이 `(칠십인역 이사 40:3 · 마르 1:3)` 형태로 표시되는지 확인
- [ ] 시트 본문 ref-title 이 `칠십인역 이사 7:14` 표시되는지 확인
- [ ] 각 ref 헤더 옆 "› 더 보기" 버튼이 보이는지 확인
- [ ] 긴 ref-title 에서 ellipsis 처리되고 "더 보기" 버튼이 가려지지 않는지 확인
- [ ] "더 보기" 클릭 시 그 ref 만 full chapter 로 표시되고, 인용 절이 시트 중앙에 위치하는지 확인
- [ ] 확장 뷰 헤더 좌측의 "‹" 뒤로가기 버튼 → compact 뷰로 복귀 확인
- [ ] ESC 키 동작 확인 (확장 뷰 → compact → 닫기 순서)
- [ ] parallels 가 있는 인용에서 각 parallel 도 독립적으로 "더 보기" 확장 가능한지 확인
- [ ] 핸들 드래그로 높이가 부드럽게 조절되는지 확인 (30vh~90vh)
- [ ] 핸들을 화면 아래로 충분히 끌어내리면 시트가 닫히는지 확인 (<20vh)
- [ ] 시트를 닫고 다시 열면 기본 65vh 로 초기화되는지 확인
- [ ] 데스크톱에서 핸들 위 마우스 커서가 ns-resize 모양으로 바뀌는지 확인

#### search-sheet
- [ ] FAB 탭 → compact 시트가 floating 카드로 표시되고 키보드 위에 떠 있는지 확인
- [ ] 검색 후 키보드 dismiss → compact → expanded 전환이 부드럽게 morphing 되는지 확인 (좌우 마진이 동시에 사라지면서 하단 모서리가 평탄해지는 220ms 애니메이션)
- [ ] iPhone 17 에서 expanded 시트의 하단 모서리가 디스플레이 곡률에 잘리지 않는지 확인
- [ ] 데스크톱 (>720px) 에서 expanded 시트가 720px 폭으로 중앙 정렬되어 cite-sheet 와 동일한 너비인지 확인
- [ ] expanded 상태에서 결과 텍스트가 좌우 12px 더 넓게 표시되는지 확인

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Mostly presentation and cite-sheet client UX in `citations.js`/`style.css` with added unit tests; no auth, sync, or data-pipeline changes.
> 
> **Overview**
> **cite** and **search** mobile bottom sheets are reworked for iOS-style **edge-to-edge** layout when expanded (flush bottom, top-only `border-radius`, upward shadow, shared `max-width: var(--max-width)`), while **search** `data-state="compact"` keeps the floating card above the keyboard with **220ms** transitions between geometries.
> 
> The **cite sheet** gains clearer information hierarchy: fixed title **"인용된 구절"**, ref headers with per-reference **"› 더 보기"** (replacing one sheet-wide expand control), **back** + staged **Esc** navigation, expanded view that scrolls the first **`.verse-highlight`** to center, and **handle drag-resize** with close/snap/stay thresholds via **`_dragReleaseAction`** (unit-tested). Redundant **chapter labels** in the sheet body are removed.
> 
> **Inline cite chips** and sheet ref titles now prefix **tradition** onto the primary reference (e.g. `(칠십인역 이사 40:3 · …)`) instead of treating tradition as another `·`-separated ref.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 037c1480727890668dc84163a70ccd888a9d30b5. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
