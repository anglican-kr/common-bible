# ADR-007: 런치 스크린 최적화 전략

- 일시: 2026-04-18
- 상태: 승인됨

## 맥락

공동번역성서 PWA는 iOS 홈 화면 아이콘으로 자주 실행되며, 특히 성무일과 같은 단시간 열람 유스케이스에서 "앱을 연 순간의 첫인상"이 전체 사용 경험을 지배한다. 초기 구현(`a416e47`) 당시에는 단순한 스플래시 오버레이로 충분했으나, 사용 과정에서 다음 네 가지 문제가 순차적으로 드러났다.

1. **홈 화면 아이콘 탭 ~ 첫 배경색 적용** 사이의 흰 플래시 (특히 다크 모드 사용자에게 두드러짐)
2. **CSS·폰트 로드 대기**로 인한 초기 렌더 블로킹
3. **body 파싱 타이밍**: launch-screen 마크업이 도달하기 전 헤더·메인이 부분 렌더되는 순간 흰 플래시
4. **차가운 부팅** (캐시 없는 첫 방문, 서비스 워커 미활성 상태)에서 `books.json` 페칭이 앱 코드 로드에 종속되어 LCP 지연

iOS 홈 화면에서 실행된 PWA는 브라우저 UI가 없기 때문에, 이 구간의 플래시가 네이티브 앱 대비 품질 차이로 직접 체감된다. 따라서 "정적 스플래시 이미지 + JS 제어 페이드아웃"이라는 전통적 스플래시 패턴만으로는 부족하고, **HTML 파싱 ~ 첫 유의미 페인트**의 모든 타임라인 구간을 방어해야 한다.

## 검토한 대안

### A안: iOS `apple-touch-startup-image`만 사용

- 장점: 구현 단순, OS가 직접 스플래시 이미지 표시
- 단점:
  - 안드로이드/데스크톱 PWA는 스플래시 없음
  - 디바이스별 13개 해상도 PNG 관리 필요
  - OS 스플래시가 사라진 직후 웹뷰 초기화 구간이 여전히 흰 화면
  - 런치 스크린 → 앱 UI 전환 시점 제어 불가

### B안: 단일 `#launch-screen` 오버레이 + JS 페이드아웃 (초기 구현)

- 장점: 전환 타이밍 제어 가능, 모든 플랫폼 동작
- 단점:
  - launch-screen 마크업이 파싱될 때까지 흰 배경 노출
  - 외부 CSS 로드 대기 시 배경·레이아웃 미적용
  - 폰트 다운로드 중 FOUC

### C안: 인라인 critical CSS + 다중 방어 레이어 (채택)

- 장점:
  - HTML 파싱 즉시 배경색 적용 (네트워크 요청 0건)
  - launch-screen 마크업 도달 전 `body::before` 안전 오버레이로 공백 구간 방어
  - 외부 스타일시트·폰트·스크립트를 모두 비동기화해 첫 페인트 지연 제거
  - 앱 코드 로드와 병렬로 데이터 페칭 시작 가능
- 단점:
  - 방어 레이어가 여러 개(HTML 배경, `body::before`, `#launch-screen`, 앱 UI)라 mental model 복잡
  - 인라인 `<style>` 수정 시 CSP 해시 재계산 필요

## 결정

**C안 채택**: "1픽셀 흰 플래시도 보이지 않는다"를 목표로, 아래 계층을 모두 도입한다.

### 1. HTML 배경 다크 기본값

```css
html { background: #1a1a2e; }
html.launch-done { background: var(--bg); }
```

라이트 모드 사용자도 **스플래시 단계 내내 다크 배경**을 본다. 런치 스크린 SVG가 밝은색이므로 다크 배경이 대비상 자연스럽고, 전환 시점(`.launch-done`) 이전의 모든 플래시를 제거한다(`48f8e23`).

### 2. `body::before` 안전 오버레이

```css
html:not(.launch-done) body::before {
  content: ""; position: fixed; inset: 0; z-index: 9998;
  background: #1a1a2e;
}
```

HTML 파싱이 `<body>` 태그까지 진행됐지만 `<div id="launch-screen">` 마크업에는 아직 도달하지 못한 찰나의 구간에서, 헤더·메인이 부분 렌더되며 흰 플래시가 발생하는 문제를 덮는다. `launch-done` 클래스가 붙으면 자동 소멸(`48f8e23`).

### 3. launch-screen을 body 첫 자식으로 배치

```html
<body>
  <div id="launch-screen" aria-hidden="true">...</div>
  <header>...</header>
  <main>...</main>
</body>
```

헤더·메인보다 먼저 파싱되어 `body::before`의 대기 시간을 최소화한다. SVG 로고는 인라인으로 포함해 추가 네트워크 요청 없이 즉시 표시된다.

### 4. Critical CSS 인라인

`css/pre-paint.css` 별도 파일 → `index.html` `<style>` 블록으로 통합(`1988b90`). 서비스 워커 캐시 여부·네트워크 상태와 무관하게 HTML 파싱 즉시 배경·레이아웃이 적용된다.

포함 범위:
- 디자인 토큰 변수(`:root`, `[data-theme="dark"]`)
- HTML·body 배경·색상·폰트 스택
- `#app-header`, `#app` 기본 레이아웃
- `body::before` 안전 오버레이
- `#launch-screen` 기본 스타일

### 5. 렌더 블로킹 리소스 비동기화

- Google Fonts stylesheet: `media="print" onload="this.media='all'"` 패턴으로 비차단 로드(`3b8b6a2`)
- `app.js`, `gtag-init.js`: `defer` 속성
- `js/pre-fetch.js`: `<head>`에서 동기 로드하되 단 3줄 스크립트로 `books.json` 페칭을 앱 코드 로드와 병렬화(`7d1b204`)

### 6. 조기 해제 + 부드러운 전환

`dismissLaunchScreen()` 호출 시점을 **라우트별 렌더 직전**으로 옮긴다(`36efc6c`, `7d1b204`). 장 목록·책 목록 같은 가벼운 뷰는 렌더 직후가 아닌 렌더 직전에 호출해 첫 페인트를 앞당긴다.

전환 애니메이션:
- `requestAnimationFrame`으로 페이드아웃 클래스 부착을 렌더 프레임과 분리(`7d1b204`)
- `.launch-done` 배경 교체는 50ms 지연해 애니메이션 커밋 이후 실행
- 0.8s → 2s cubic-bezier로 완화해 급작스러운 전환감 제거
- `prefers-reduced-motion` 시 애니메이션 비활성

### 7. SVG 경량화

인라인 로고 SVG는 `svgo --multipass --precision=2`로 좌표 정밀도를 2자리로 양자화(`07eeda6`). `index.html` 37KB → 15KB. 25vmin 표시 사이즈에서 sub-pixel 차이라 시각적 회귀 없음.

### 8. iOS 네이티브 스플래시 병행

13개 디바이스별 `apple-touch-startup-image`(`2f0e7d3`)와 `manifest.webmanifest`의 `background_color: #1a1a2e`로 OS 레벨 스플래시도 동일 톤으로 통일. C안과 충돌하지 않고 **OS 스플래시 → 웹뷰 초기화 구간 → #launch-screen → 앱 UI**의 전 구간이 끊김 없이 다크 톤으로 이어진다.

## 타임라인 요약

```
T=0    홈 화면 아이콘 탭
       ├─ OS 스플래시 (iOS: apple-touch-startup-image, Android: manifest)
T≈100  HTML 파싱 시작
       ├─ <html> 태그: 인라인 CSS의 html { background: #1a1a2e } 적용
       ├─ <body> 파싱 도중: body::before 다크 오버레이 활성
T≈150  launch-screen 마크업 도달, SVG 즉시 표시
T≈200  Google Fonts 비동기 로드 시작 (폰트 swap)
       app.js 파싱 (defer)
       pre-fetch.js가 books.json 페칭 병렬 시작
T≈400  DOMContentLoaded → route() 실행
       뷰 렌더 직전 dismissLaunchScreen() 호출
       ├─ rAF: .fade-out 클래스 → 2s 페이드아웃 시작
       ├─ +50ms: .launch-done → body::before·html 배경 전환
T≈500  첫 유의미 페인트 (책 목록 / 장 목록 등)
T≈2500 launch-screen DOM 제거 (animationend)
```

## 트레이드오프 및 주의 사항

1. **방어 레이어 중복**: HTML 배경, `body::before`, `#launch-screen`의 세 겹이 동일한 다크 배경을 그린다. 한 레이어 수정 시 나머지와 색상이 어긋나지 않도록 `#1a1a2e` 상수를 동기화해야 한다. 향후 디자인 토큰화 여부는 별도 검토.
2. **인라인 CSS 수정 시 CSP 해시 갱신 필수**: `index.html`의 `<style>` 블록을 수정하면 `style-src` sha256 해시를 재계산해야 한다(`4a57a15`). 외부 `css/style.css` 수정은 해시 갱신 불필요.
3. **`requestAnimationFrame + setTimeout(50ms)` 조합**: 애니메이션 커밋과 배경 전환의 타이밍이 어긋나면 재깜빡임 가능. 50ms는 실측으로 안정점.
4. **pre-fetch.js의 동기 스크립트**: `<head>` 내 동기 스크립트지만 3줄·fetch 호출뿐이라 파싱 블로킹 영향이 무시 가능. 커지면 `defer`로 전환 검토.
5. **launch-done 미도달 위험**: 라우트 렌더 실패 시 런치 스크린이 영구 표시될 수 있어 `route()`의 `catch`와 safety fallback에서 `dismissLaunchScreen()`을 중복 호출한다(멱등).

## 관련 커밋

| 커밋 | 변경 |
|------|------|
| `a416e47` | 런치 스크린 초기 구현 |
| `6ddba2f` | pre-paint.css 도입, theme-color media 분리 (1.0.14) |
| `2f0e7d3` | iOS 스플래시 13개 디바이스, manifest 배경 다크화 |
| `1988b90` | pre-paint.css → 인라인 critical CSS로 통합 (1.0.16) |
| `36efc6c` | books.json preload, 조기 해제, 지연 초기화 (1.0.17) |
| `3b8b6a2` | 폰트·스크립트 비차단화, fade-out 5s → 0.8s |
| `07eeda6` | 인라인 SVG svgo 양자화 (37KB → 15KB) |
| `48f8e23` | launch-screen 마크업 body 첫 자식 배치, body::before 방어 |
| `7d1b204` | pre-fetch.js, rAF-decoupled dismiss, fade 2s 완화 (1.0.21) |

## 향후 재검토 조건

- LCP가 iOS 저사양 기기(아이폰 SE 2nd 수준)에서 2s를 상회하는 경우 → books.json 응답 직렬화 포맷(예: MessagePack) 검토
- critical CSS가 15KB를 넘기면 → 디자인 토큰만 남기고 레이아웃 규칙 외부화
- prefers-reduced-motion 외 접근성 피드백 도달 시 → fade 기간·이징 재튜닝

## 참고

- `index.html` — 인라인 critical CSS, launch-screen 마크업, pre-fetch.js
- `js/app.js` `dismissLaunchScreen` — 해제 로직
- `css/style.css` `#launch-screen` — 페이드아웃 애니메이션
- `js/pre-fetch.js` — books.json 조기 페칭
- `sw.js` SHELL_FILES — critical 리소스 프리캐시 목록
