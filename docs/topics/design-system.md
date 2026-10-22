# 설정, 디자인 시스템, CSS

소유 코드: `js/app/settings-ui.js`

설정 화면과, 화면 전체의 토큰 · 글꼴 · 색 · 간격 규칙을 다룬다. 디자인의 권위는 루트의 `DESIGN.md`와 `css/style.css`다.

## 지금 동작

- **디자인 시스템 완료** — ADR-028, 2026-06-02. 단일 권위 출처 `DESIGN.md`(루트) + `css/style.css` `:root` 토큰 사다리(색상·반경·elevation·간격 8pt·타이포 rem·컨트롤·모션)에 ad-hoc 값 전면 스냅. 본문 Serif·frosted glass 적용 범위는 의도적 HIG 이탈로 명문화. 테마색(`--theme`)은 절 번호·단락 기호·내비 시그니처(활성 탭/검색 인디케이터)로 한정, 나머지 chrome 은 중립 차콜 동결. 상세·개정 이력은 ADR-028 §7·§9.
- **읽기 헤더 스크롤 elevation 그림자 완료** — ADR-025, 2026-05-30. `#scroll-sentinel` IntersectionObserver 가 최상단 이탈을 감지해 `#sticky-group` 그림자 페이드 인 + 1px hairline 경계 유지. frosted glass 는 iOS 26 status bar 회피로 의도적 미적용. 상세는 ADR-025.

## 결정

- ADR-028 「디자인 시스템 — 토큰 사다리 + HIG 정렬」
- ADR-023 「설정 패널 상위 4개 옵션」
- ADR-025 「읽기 헤더 스크롤 elevation 그림자」

## 함정

### pitfalls §8 — 폰트/렌더링 특성 오해 — 회귀 사례

브라우저 폰트 로딩 동작을 잘못 이해해, 캐시 무효화 직후 첫 실행에서만 회귀가 보이는 까다로운 패턴.

**사례:**
- `351deef` — `font-display: optional`은 폰트가 100ms 안에 도착하지 않으면 그 세션 동안 시스템 폰트로 락인됨. 캐시 미적중 직후 첫 실행에서 의도한 폰트가 보이지 않다가 앱 재시작 후에야 나타나는 회귀. `swap`으로 변경 (런치 스크린이 FOUT 구간을 가림).
- `d61f879` — `media="print" onload` 트릭으로 @font-face를 동적 삽입하면 first paint 이후에 로드되어 FOUT 발생. blocking `preload as="style"`로 변경.

**규칙:**
- 폰트 규칙은 **first paint 전에 DOM에 있어야** FOUT이 없다.
- 폰트 전략은 **(빠른 네트워크 / 느린 네트워크) × (캐시 적중 / 미적중)** 4가지 조합으로 검증한다. DevTools의 throttling + "캐시 비우고 강력 새로고침"으로 재현.
- 관련 ADR: `007-launch-screen-optimization.md` (개정 블록 참고).

### pitfalls §14 — CSS `display` 속성이 `[hidden]` 무력화

`<button hidden>` 같은 HTML5 `hidden` 속성은 user-agent 스타일시트에서 `[hidden] { display: none }`로 처리된다. 그런데 author CSS에서 ID 셀렉터로 `display: flex`(또는 block, grid 등)를 명시하면 specificity가 더 높아 `[hidden]` 규칙을 덮어쓴다 — JS에서 `el.hidden = true`로 설정해도 시각적으로 안 사라지는 회귀.

**사례 (Phase 2h 단계 6):**

- 검색 액션 버튼(`#search-clear`, `#search-history-toggle`)에 `display: flex`가 적용돼 있어, JS의 `$searchClear.hidden = true`가 무력화. 빈 입력 상태에서도 X 버튼이 계속 보였고, 동시에 `dataset.clearHidden="true"` 트리거 규칙이 history toggle을 clear의 위치로 옮겨 두 버튼이 정확히 같은 좌표에 스택. DOM 순서상 clear가 후순위라 사용자에겐 X만 보이고 ▾는 X 뒤에 가려져 "버튼 모양이 이상"한 외양.
- 수정: `#search-clear[hidden], #search-history-toggle[hidden] { display: none; }` 명시 규칙 추가. specificity 동률 이상으로 끌어올려 `[hidden]` 의도 복구.

**규칙:**

- ID 또는 specificity 높은 셀렉터로 `display: ...`를 설정한 요소가 `hidden` 속성을 통해 가려질 수 있다면, **반드시 같은 셀렉터에 `[hidden] { display: none }` 규칙을 명시**한다.
- 점검: `el.hidden = true` 후 DevTools에서 `getComputedStyle(el).display`를 확인해 `none`이 나오는지 검증.
- 전역 회귀 방지가 필요하면 `:where([hidden]) { display: none !important; }` 같은 광역 규칙도 가능하지만 `!important`는 다른 의도된 override를 깨뜨릴 수 있어 피하는 게 좋음. 셀렉터별 `[hidden]` 보강이 더 안전.

## 남은 일

### known-issues §22 — 디자인 시스템 아티팩트 (2026-10-22)

2026-10-18에 지금 앱 모양으로 디자인 시스템 아티팩트(Claude Design의 「Design System」, 비공개)를 만들었다. 토큰, 컴포넌트 34개, 브랜드 README를 담았다. 권위는 저장소의 `DESIGN.md`와 `css/style.css`이고 아티팩트는 사본이다. 아티팩트 주소와 도구는 Claude의 비공개 메모에 있다. 사용자가 2026-10-22에 이 작업을 계속하기로 했다.

- **초안 검토**: 사용자가 아직 초안을 보지 않았다. 검토 의견을 반영해 다듬는다.
- **캘린더 2단계를 디자인부터**: 주간과 목록 보기(ADR-038 §2)를 코드보다 먼저 이 시스템으로 그려 본다.

### known-issues §23 — 디자인 시스템 초안에서 찾은 CSS 어긋남 셋 (2026-10-18)

- **동기화 스낵바가 토큰 대신 리터럴을 쓴다.** `js/drive-sync.js` `_showSyncSnackbar`가 그림자(rgba .15), 글자 크기 14px, 반경 8px를 인라인 스타일로 적는다.
- **`.settings-about`이 일반 `sans-serif`를 쓴다**(`css/style.css`). DESIGN.md의 Sans 스택이 아니다.
- **`.bm-select-allbtn`에 글꼴 지정이 없다**(`css/style.css`). 단추라 브라우저 기본 글꼴로 보인다.
- **고치는 법**: 셋 모두 DESIGN.md의 토큰과 글꼴 스택으로 바꾼다. 아티팩트에는 어긋난 그대로 옮기고 컴포넌트 설명에 적어 두었으므로, 고친 뒤 아티팩트도 맞춘다.
