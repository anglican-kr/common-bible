# ADR-025: 읽기 헤더 스크롤 elevation 그림자

- 일시: 2026-05-30
- 상태: 승인됨 — 구현 완료 (2026-05-30)
- 관련 ADR: ADR-024(헤더 내비 재설계와 sticky 그룹 구조)

## 맥락

이 앱은 아래쪽이나 위에 겹쳐 뜨는 표면(오디오 바, 검색 시트, 북마크 드로어, 인용 바텀 시트)에 같은 **frosted glass**(`backdrop-filter: blur(12px)`와 반투명 배경)를 쓰고 있었다. 헤더(`#sticky-group` + `#app-header`)만 솔리드 `var(--bg)`로 남아 눈에 띄게 따로 놀았고, 사용자는 헤더와 아래쪽 컴포넌트가 어울리지 않는다고 느꼈다.

위의 표면 목록은 이 ADR을 쓴 때(2026-05-30)의 상태다. 그 뒤 검색 시트, 북마크 드로어, 인용 바텀 시트는 **솔리드 `var(--bg)`로 바뀌었다**(2026-06-21에 코드와 맞춰 확인: `#cite-sheet`·`#bookmark-drawer`·`.book-filter-sheet` 모두 `background: var(--bg)`이고 backdrop-filter가 없다). 지금 **frosted glass는 떠 있는 dock(탭 바, 오디오 미니바, 검색 원형 버튼, 절/북마크 선택 바)과 검색 스크림에만** 쓴다(`DESIGN.md` §1·§5). 이 ADR의 결정(헤더는 솔리드로 두고 스크롤하면 그림자로 띄운다)과, 표면이 아니라 다른 축에서 통일감을 만든다는 생각은 그대로 유효하다. 솔리드 헤더와 글래스로 된 떠 있는 chrome의 대비는 지금도 있다.

자연스러운 첫 가설은 「헤더에도 글래스를 쓴다」였다. 그러나 iOS 26, Android, PWA 환경을 조사해 보니 다음 제약이 있었다.

1. **iOS 26 Safari가 툴바 색을 스스로 뽑는다(toolbar tinting)** — `theme-color` meta를 무시하고, 화면 가장자리 가까이의 fixed/sticky 요소의 `background-color`로 status bar 색을 정한다. 헤더가 반투명이 되면 Safari가 흰색이나 검은색 기본값으로 떨어져, status bar와 본문 색이 어긋난다.
2. **PWA standalone 모드에서 status bar가 따라오지 않는다** — `apple-mobile-web-app-status-bar-style` meta는 정해진 값 셋만 받고, 설치하거나 실행할 때 한 번 정해진다. 그래서 라이트와 다크를 바꿔도 status bar가 본문을 따라오지 않는다. 사용자가 실제로 겪어 확인했다.
3. **스크롤에 따라 바뀌는 글래스** — 맨 위에서는 솔리드였다가 스크롤하면 글래스로 바뀌는 방식(Apple Mail/Notes)도 검토했다. 그러나 글래스로 바뀌는 순간 status bar와의 경계가 어색해질 위험이 있어, 두 OS × 라이트/다크 × 색 구성 4종 × 스크롤 상태, 곧 16가지가 넘는 경우를 실제로 재 봐야 했다. 비용이 너무 컸다.

핵심은 사용자의 진단에서 나왔다. 원래 목표는 *frosted glass* 자체가 아니라 *통일감*이었다. iOS HIG는 위쪽(헤더, 정체성)과 아래쪽(겹쳐 뜨는 표면)을 일부러 다르게 다룬다. 표면을 억지로 맞추지 않고 **다른 축에서 통일감을 만든다**.

가장 약한 곳은 헤더에 **떠 있다는 신호(elevation)가 없다**는 점이었다. 글래스 표면은 「콘텐츠 위에 떠 있다」를 스스로 보여 주지만, 솔리드 헤더는 평평했다. 그래서 표면 대신 **그림자로 같은 뜻을 전한다**.

## 결정

### 1. 스크롤하면 헤더 아래에 옅은 그림자

`#sticky-group`에 `.scrolled` 클래스가 있을 때만 헤더 아래에 연한 그림자를 보인다. 맨 위에서는 그림자가 없고(평평함), 콘텐츠가 헤더 밑으로 흐르기 시작하면 그림자가 나타난다. Apple Mail/Notes의 큰 제목(large title) 방식이다.

그림자 값은 다음과 같다. 지금은 `--shadow-3` 토큰으로 두고, 다크 테마에서는 토큰이 다크 값으로 바뀐다.

- 라이트: `box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12)`
- 다크: `box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25)`

다크의 알파가 큰 이유는, 어두운 배경에서는 옅은 그림자가 거의 보이지 않아 같은 정도의 신호를 주려면 더 진해야 하기 때문이다. 라이트도 처음의 알파 `0.04`에서 `0.12`로 올렸다(2026-05-30). 실제로 보니 `0.04`는 흰 배경에서 거의 보이지 않아 신호 구실을 못 했다. 다크와 비슷한 정도로 느껴지게 올렸다.

`transition: box-shadow 0.18s ease` 정도로 부드럽게 나타나게 한다(지금은 `--duration-fast` 토큰). `prefers-reduced-motion: reduce`에서는 transition을 없애고 바로 바꾼다.

### 2. 스크롤 감지 — IntersectionObserver sentinel

`#sticky-group` 바로 위에 높이 0인 표시 요소(sentinel, `#scroll-sentinel`)를 두고, `IntersectionObserver`로 이 요소가 화면(viewport)에 들어오고 나가는 것을 본다. scroll listener보다 비용이 적고 throttle이 필요 없다.

- sentinel이 화면 안에 있으면 페이지 맨 위이므로 `.scrolled`를 뗀다.
- sentinel이 화면 밖으로 나가면 스크롤한 것이므로 `.scrolled`를 붙인다.

라우트를 바꿀 때(`route()`) 스크롤이 맨 위로 돌아가면 sentinel도 다시 보이므로 저절로 처리된다.

### 3. 헤더 아래 경계 신호 정리

이 ADR을 쓸 때 헤더 아래에는 경계 신호가 둘 있었다.

- `#app-header::after`: 1px 그러데이션 hairline(`css/style.css`)
- `#sticky-group::after`: 0.25rem `var(--bg)`에서 투명으로 옅어지는 fade(`css/style.css`)

지금은 **hairline(늘 보임)과 그림자(스크롤할 때)** 둘로 정리했다. 역할이 다르다. **hairline은 늘 보이는 경계**이고, **그림자는 스크롤했다는 신호**다. 셋이 겹쳐도 hairline은 움직이지 않고 가늘며 그림자는 움직이므로, 눈에 거슬리는 잡음으로 느껴지지 않는다. 책 목록 화면에서 hairline을 숨기는 조건(`#sticky-group:has(#division-tabs-slot:not(:empty))`)은 ADR-024 그대로다.

- fade(`#sticky-group::after`)는 지웠다(2026-05-30). `top: 100%`에 놓인 0.25rem 솔리드 `var(--bg)` fade가 그림자가 떨어지는 자리를 덮어, 헤더와 그림자 사이에 빈 틈이 있는 것처럼 보였다(불투명한 첫 구간이 그림자 위쪽을 가렸다). fade를 지워 그림자가 헤더 아래 경계에서 바로 시작하게 했다.

**책 목록 화면도 다른 화면처럼 스크롤하면 그림자를 보인다(2026-06-09).** 고정 영역(`#sticky-group`)에 아래 여백(`padding-bottom: --space-4`)을 두어, 탭과 스크롤되는 콘텐츠 사이에 늘 16px `var(--bg)` 띠가 남게 했다. 전에는 `#app`의 위 여백이 그 역할을 해서 스크롤하면 사라졌다. 이제 그림자는 탭이 아니라 그 여백 아래 콘텐츠 경계에서 나타나므로, 책 목록 헤더도 `.scrolled`일 때 `--shadow-3`을 쓴다. 위로 스크롤할 때 책 카드가 탭에 바로 빨려 들어가 답답해 보이던 증상도 함께 사라졌다.

### 4. frosted glass를 쓰지 않는다 — iOS 26과 PWA의 함정 피하기

이 결정은 헤더에 `backdrop-filter`를 전혀 쓰지 않는다. 그래서 다음 제약을 **모두 피한다**.

- iOS 26 툴바 색 자동 추출과 부딪히지 않는다(배경이 솔리드 `var(--bg)`).
- PWA standalone의 status bar가 따라오지 않는 문제는 이 결정의 범위 밖이다(전부터 있던 이슈로 따로 관리한다).
- `prefers-reduced-transparency: reduce` 미디어 쿼리가 필요 없다(투명 효과를 쓰지 않는다).
- backdrop-filter의 성능 부담이 없다.

## 대안

- **헤더를 늘 frosted glass로** — iOS 26의 툴바 색 자동 추출이 헤더의 반투명 `background-color`를 흰색이나 검은색 기본값으로 읽어, status bar와 본문 색이 어긋난다. PWA standalone에서는 `apple-mobile-web-app-status-bar-style`을 `black-translucent`로 바꾸지 않는 한 글래스 헤더 위에 status bar의 흰 띠가 남는다. `black-translucent`를 쓰면 status bar 글자색이 흰색으로 고정되어, 라이트 모드 헤더를 짙은 색으로 다시 설계해야 한다. 디자인 정체성을 잃는 비용이다. 채택 안 함.
- **스크롤에 따라 바뀌는 글래스 (맨 위에서는 솔리드, 스크롤하면 글래스)** — Apple 앱의 방식이고, 맨 위에서는 iOS 26 자동 추출이 솔리드 색을 제대로 뽑는다. 그러나 글래스로 바뀌는 순간 status bar와의 경계가 어색해질 위험이 있다. 글래스 바탕을 `var(--bg)`로 가볍게 잡으면 다룰 수 있다는 분석도 있었지만, 그것을 확인하려면 두 OS × 라이트/다크 × 색 구성 4종 × 스크롤 상태, 곧 16가지가 넘는 경우를 실제로 재야 해서 이 단계에서는 비용이 너무 컸다. 채택 안 함.
- **그림자를 늘 보이기** — 구현은 가장 단순하지만, 맨 위에서는 그림자 아래로 지나갈 콘텐츠가 없는데 그림자가 있어 어색하다. 본문이 움직이지 않는 상태에서는 떠 있다는 신호가 뜻이 없다. 채택 안 함.
- **헤더 정체성을 다른 축으로 강화 — 타이포그래피나 기능 더하기** — 책 이름을 굵게 하거나, 장 진행 막대나 위치 표시를 더하는 일은 이 ADR의 그림자 결정과 함께 할 수 있지만, 따로 따져야 할 가치라 ADR을 나눈다. 이 ADR의 범위 밖이다.
- **hairline을 지우고 fade와 그림자만 두기 (2026-05-30, 같은 날까지)** — 처음에는 그림자를 더하면 경계 신호가 셋이 되어 잡음이라고 보고, hairline을 지우기로 했다. 그러면 사실상 모든 화면에서 hairline이 없어지는데, ADR-024가 책 목록 화면에서만 hairline을 숨긴 뜻을 넓히는 것이었다. 채택 안 함 2026-05-30 · 이유: dev에서 확인해 보니 hairline이 없으면 맨 위의 멈춘 상태에서 헤더 경계가 잘 보이지 않았다. hairline을 되살리고 역할을 나눴다(위 3).
- **책 목록 화면에서는 그림자를 생략 (2026-06-09까지)** — 그림자가 탭 줄에 바로 닿아 잡음으로 보인다는 이유로 책 목록 화면에서는 그림자를 뺐다. 채택 안 함 2026-06-09 · 이유: 그 잡음은 탭 줄과 스크롤 콘텐츠가 여백 없이 맞붙어 있었기 때문이었다. 고정 영역에 아래 여백을 두어 그 원인을 없앴다(위 3).

## 영향

- **변경**:
  - `css/style.css`: `#sticky-group.scrolled` box-shadow 추가, `#app-header::after` 1px hairline 제거(뒤에 되살림, 위 3), `prefers-reduced-motion` 분기 추가.
  - `js/app/views-routing.js` 또는 부트스트랩 위치: IntersectionObserver 설치(`#sticky-group` 위 sentinel). 지금은 `js/app/views.js`에 있다(ADR-034).
  - `index.html`: `#scroll-sentinel` 요소 추가(sticky-group 바로 앞).
- **유닛 테스트**: IntersectionObserver 콜백은 DOM에 기대므로 e2e나 수동 검증에 맡긴다. 유닛은 더하지 않는다.
- **e2e 회귀**: 스크롤한 뒤 헤더 그림자가 나타나는지, 맨 위로 돌아오면 그림자가 사라지는지를 확인하는 시나리오를 더하기를 권한다(tests/e2e/).
- **데이터, 서비스 워커, 라우트, 접근성 토큰**은 모두 바뀌지 않는다.
- iOS 26과 PWA의 함정을 피하는 것은 이 결정의 *부수 효과*가 아니라 *선택한 이유*다. 뒤의 디자인 작업에서 헤더에 backdrop-filter를 다시 들이려 하면 이 ADR의 맥락을 다시 봐야 한다.

## 참고

- §10 디자인 대안 검토와 사용자 결정 기록: 이 ADR을 쓸 때 쓴 자료는 따로 조사 문서로 보관한다(`docs/archive/design/` 후보).
- iOS 26 Safari 툴바 색 동작: 이 프로젝트에서 실제로 잰 결과는 [Ben Nasedkin](https://nasedk.in/blog/ios26-safari-toolbar-colors/) · [1ar.io](https://www.1ar.io/updates/safari-26-liquid-glass-web/)와 일치한다.
- `prefers-reduced-motion` 처리는 ADR-024 슬라이드 인디케이터와 같은 방식이다.
