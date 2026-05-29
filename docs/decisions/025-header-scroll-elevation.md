# ADR-025: 읽기 헤더 스크롤 elevation 그림자

- 일시: 2026-05-30
- 상태: 승인됨 — 구현 완료 (2026-05-30)
- 관련 ADR: ADR-024(헤더 내비 재설계 · sticky 그룹 구조)

## 맥락

본 앱은 하단/오버레이 표면 — 오디오 바, 검색 시트, 북마크 드로어, 인용 바텀 시트 — 에 일관된 **frosted glass**(`backdrop-filter: blur(12px)` + 반투명 배경) 처리를 적용한다. 헤더(`#sticky-group` + `#app-header`)만 솔리드 `var(--bg)` 로 남아 시각적으로 분리돼 있었고, 사용자가 "헤더와 하단 컴포넌트가 안 어울린다" 고 느꼈다.

자연스러운 첫 가설은 "헤더에도 글래스를 적용한다" 였으나 iOS 26 / Android / PWA 환경 조사 결과 다음 제약이 발견됐다:

1. **iOS 26 Safari toolbar tinting 자동 추출** — `theme-color` meta 가 무시되고, viewport edge 근처 fixed/sticky 요소의 `background-color` 가 status bar 색을 결정한다. 헤더가 반투명이 되면 Safari 가 흰/검 fallback 으로 떨어져 status bar 와 본문 색이 어긋난다.
2. **PWA standalone 모드의 status bar 비동기** — `apple-mobile-web-app-status-bar-style` meta 가 세 정적 값만 받고, install/launch 시점에 캡처되므로 라이트↔다크 토글 시 status bar 가 본문을 따라오지 않는다. 사용자 경험으로 확인됨.
3. **스크롤 인지 글래스** — scroll-top 솔리드 + 스크롤 시 글래스 전환 패턴(Apple Mail/Notes) 도 검토했으나, 글래스 발동 순간 status bar 와의 경계가 부자연스러워질 위험을 두 OS × 라이트/다크 × 색구성 4종 × scroll 상태 = 16+ 조합으로 실측 검증해야 해서 비용 과다.

핵심 통찰은 사용자 진단에서 나왔다: 원래 목표는 *frosted glass* 자체가 아니라 *통일감*. iOS HIG 패턴 — 상단(헤더=정체성) / 하단(오버레이) — 은 의도적으로 다른 처리를 한다. 표면 통일을 강제하지 않고 **다른 축에서 통일감을 만든다**.

가장 약한 고리는 헤더의 **elevation 신호 부재**였다. 글래스 표면은 "콘텐츠 위에 떠 있다" 를 자체적으로 표현하지만, 솔리드 헤더는 평면적이었다. 표면이 아니라 **그림자로 같은 메타포를 전달**한다.

## 결정

### 1. 헤더 하단 미세 elevation 그림자 — 스크롤 트리거

`#sticky-group` 에 `.scrolled` 클래스가 있을 때만 헤더 하단에 연한 그림자를 표시한다. scroll-top 에서는 그림자 없음(평면), 콘텐츠가 헤더 밑으로 흐르기 시작하면 elevation 발현 — Apple Mail/Notes 의 large title 패턴.

그림자 값:

- 라이트: `box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04)`
- 다크: `box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25)`

다크에서 알파가 큰 이유: 어두운 배경 위에서는 옅은 그림자가 거의 보이지 않으므로 같은 정도의 elevation 신호를 위해 보강이 필요하다.

`transition: box-shadow 0.18s ease` 정도로 부드럽게 페이드 인. `prefers-reduced-motion: reduce` 분기에서는 transition 제거하고 즉시 토글.

### 2. 스크롤 감지 — IntersectionObserver sentinel

`#sticky-group` 바로 위에 0 픽셀 sentinel 요소(예: `#scroll-sentinel`)를 두고 `IntersectionObserver` 로 viewport 진입/이탈을 감지한다. scroll listener 보다 비용이 낮고 throttle 불필요.

- sentinel 가 viewport 안에 있음 → 페이지 최상단 → `.scrolled` 제거
- sentinel 가 vienport 밖으로 나감 → 스크롤됨 → `.scrolled` 추가

라우트 전환 시(`route()`) 스크롤이 최상단으로 리셋되면 sentinel 도 다시 보이게 되므로 자동 처리됨.

### 3. 기존 헤더 하단 경계 신호 정리

현재 헤더 하단에는 두 개의 경계 신호가 있다.

- `#app-header::after` — 1px gradient hairline ([css/style.css:188-194](../../css/style.css#L188-L194))
- `#sticky-group::after` — 0.25rem `var(--bg)` → transparent 페이드 ([css/style.css:168-177](../../css/style.css#L168-L177))

그림자를 추가하면 3중 신호가 되어 시각 잡음. **hairline 을 제거하고 fade gradient 와 그림자 두 가지만** 유지한다. fade gradient 와 그림자는 둘 다 부드러운 vertical falloff 라 자연 결합. ADR-024 가 책 목록 페이지(division-tabs 슬롯 있을 때) hairline 을 조건부 숨김 처리한 의도와도 정합 — 사실상 모든 페이지에서 hairline 을 제거하는 일반화.

> **개정 (2026-05-30):** dev 검증 결과 hairline 제거 후 그림자만으로는 scroll-top 정적 상태의 헤더 경계 인지가 약했다. hairline 을 복구하고 역할을 분리한다 — **hairline = always-on 경계**, **fade + shadow = 스크롤 elevation 신호**. 3중 신호라도 hairline 은 정적·미세하고 shadow 는 동적이라 시각 잡음으로 인지되지 않는다. 책 목록 페이지의 조건부 숨김(`#sticky-group:has(#division-tabs-slot:not(:empty))`)은 ADR-024 그대로 유지.

### 4. frosted glass 미적용 — iOS 26 / PWA 함정 회피

본 결정은 헤더에 `backdrop-filter` 를 일체 적용하지 않는다. 결과적으로 다음 제약을 **모두 회피**한다:

- iOS 26 toolbar tinting 자동 추출과의 충돌 없음 (배경이 솔리드 `var(--bg)`)
- PWA standalone 의 status bar 비동기는 본 결정 범위 밖 (선재 이슈로 별도 관리)
- `prefers-reduced-transparency: reduce` 미디어쿼리 불필요 (투명도 효과 미사용)
- backdrop-filter 성능 부담 0

## 대안

- **헤더 전체 시간 frosted glass** — iOS 26 toolbar tinting 자동 추출이 헤더의 반투명 `background-color` 를 흰/검 fallback 으로 해석해 status bar 와 본문 색이 어긋난다. PWA standalone 에서는 `apple-mobile-web-app-status-bar-style` 을 `black-translucent` 로 바꾸지 않는 한 status bar 흰 띠가 글래스 헤더 위에 남는다. `black-translucent` 채택 시 status bar 글자색이 흰색 고정 → 라이트 모드 헤더를 짙은 톤으로 재설계 필요 → 디자인 정체성 비용. 기각.
- **스크롤 인지 글래스 (scroll-top 솔리드, 스크롤 시 글래스)** — Apple 앱 패턴이고 scroll-top 에서 iOS 26 자동 추출이 솔리드 색을 정상 추출하지만, 글래스 발동 순간 status bar 와의 경계가 부자연스러워질 위험이 있다. 글래스 베이스를 `var(--bg)` 로 가볍게 잡으면 통제 가능하다는 분석이 있었으나, "통제됨" 의 검증을 두 OS × 라이트/다크 × 색구성 4종 × scroll 상태 = 16+ 조합 실측해야 해서 본 단계에서 비용 과다. 기각.
- **항상 표시 그림자** — 구현은 가장 단순하지만 scroll-top 에서 "그림자가 떠 있을 콘텐츠가 없는데 왜 그림자가" 의 부자연스러움. 본문이 평면적인 정적 상태에서는 elevation 신호가 의미 없다. 기각.
- **헤더 정체성 강화의 다른 축 — 타이포그래피 / 기능 추가** — 책 이름 weight 강화, 장 진행 micro-bar, 위치 표시 등은 본 ADR 의 elevation 결정과 양립하나 별도 가치 제안이라 ADR 분리. 본 ADR 범위 밖.

## 영향

- **변경**:
  - `css/style.css` — `#sticky-group.scrolled` box-shadow 추가, `#app-header::after` 1px hairline 제거, `prefers-reduced-motion` 분기 추가
  - `js/app/views-routing.js` 또는 부트스트랩 위치 — IntersectionObserver 설치(`#sticky-group` 위 sentinel)
  - `index.html` — `#scroll-sentinel` 요소 추가 (sticky-group 바로 앞)
- **유닛 테스트**: IntersectionObserver 콜백은 DOM 의존 → e2e 또는 수동 검증으로 위임. 유닛 추가 없음.
- **e2e 회귀**: 스크롤 후 헤더 그림자 발현 / scroll-top 복귀 시 그림자 제거 시나리오 추가 권장 (tests/e2e/).
- **데이터·서비스워커·라우트·접근성 토큰** 모두 불변.
- **iOS 26 / PWA 함정 회피**는 본 결정의 *부수 효과*가 아니라 *선택 이유*임을 명시 — 후속 디자인 작업이 헤더에 backdrop-filter 를 재도입하려 할 때 본 ADR 의 맥락을 다시 검토해야 한다.

## 참고

- §10 디자인 대안 검토 + 사용자 결정 기록 — 본 ADR 작성 입력 자료는 별도 조사 문서로 보관 (`docs/design/` 후보).
- iOS 26 Safari toolbar tinting 동작 — 본 프로젝트 실측 결과는 [Ben Nasedkin](https://nasedk.in/blog/ios26-safari-toolbar-colors/) · [1ar.io](https://www.1ar.io/updates/safari-26-liquid-glass-web/) 와 일치.
- `prefers-reduced-motion` 처리는 ADR-024 슬라이드 인디케이터와 동일한 패턴.
