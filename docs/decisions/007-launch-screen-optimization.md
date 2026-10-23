# ADR-007: 런치 스크린 최적화 전략

- 일시: 2026-04-18
- 상태: 승인됨

## 맥락

공동번역성서 PWA는 iOS 홈 화면 아이콘으로 자주 실행된다. 특히 성무일과처럼 잠깐 열어 보는 경우에는 "앱을 연 순간의 첫인상"이 전체 사용 경험을 좌우한다. 초기 구현(`a416e47`) 때는 단순한 스플래시 오버레이로 충분했으나, 쓰다 보니 다음 네 문제가 차례로 드러났다.

1. **홈 화면 아이콘을 누른 뒤 첫 배경색이 적용되기까지** 흰 화면이 번쩍인다(특히 다크 모드 사용자에게 눈에 띈다).
2. **CSS와 폰트를 받는 동안** 첫 렌더가 막힌다.
3. **body 파싱 시점**: launch-screen 마크업에 닿기 전에 헤더와 메인이 일부 그려지는 순간 흰 화면이 번쩍인다.
4. **차가운 부팅**(캐시 없는 첫 방문, 서비스 워커가 아직 활성화되지 않은 상태)에서는 `books.json`을 받는 일이 앱 코드 로드를 기다려 LCP가 늦어진다.

iOS 홈 화면에서 실행된 PWA에는 브라우저 UI가 없어서, 이 구간의 번쩍임이 네이티브 앱과의 품질 차이로 바로 느껴진다. 그래서 "정적 스플래시 이미지 + JS로 페이드아웃"이라는 전통적인 스플래시 방식만으로는 부족하고, **HTML 파싱부터 첫 유의미 페인트까지**의 모든 구간을 막아야 한다.

## 검토한 대안

### A안: iOS `apple-touch-startup-image`만 사용

- 장점: 구현이 단순하고, OS가 직접 스플래시 이미지를 보인다.
- 단점:
  - 안드로이드와 데스크톱 PWA에는 스플래시가 없다.
  - 기기별로 13가지 해상도의 PNG를 관리해야 한다.
  - OS 스플래시가 사라진 직후 웹뷰를 초기화하는 구간은 여전히 흰 화면이다.
  - 런치 스크린에서 앱 UI로 넘어가는 시점을 제어할 수 없다.

### B안: 단일 `#launch-screen` 오버레이 + JS 페이드아웃 (초기 구현)

- 장점: 전환 시점을 제어할 수 있고, 모든 플랫폼에서 돈다.
- 단점:
  - launch-screen 마크업이 파싱될 때까지 흰 배경이 보인다.
  - 외부 CSS를 받는 동안 배경과 레이아웃이 적용되지 않는다.
  - 폰트를 받는 동안 FOUC가 생긴다.

### C안: 인라인 critical CSS + 여러 겹의 방어 (채택)

- 장점:
  - HTML 파싱 즉시 배경색이 적용된다(네트워크 요청 0건).
  - launch-screen 마크업에 닿기 전에는 `body::before` 안전 오버레이가 빈 구간을 막는다.
  - 외부 스타일시트, 폰트, 스크립트를 모두 비동기로 받아 첫 페인트 지연을 없앤다.
  - 앱 코드 로드와 나란히 데이터를 받기 시작할 수 있다.
- 단점:
  - 방어 레이어가 여럿(HTML 배경, `body::before`, `#launch-screen`, 앱 UI)이라 머릿속 그림이 복잡하다.
  - 인라인 `<style>`을 고치면 CSP 해시를 다시 계산해야 한다.

### 폰트 `display=optional` (`3d5dfc3`, 2026-05-01에 되돌림)

- 폰트가 늦게 오면 그리지 않는 `display=optional`을 잠시 썼다.
- 채택 안 함 2026-05-01 · 이유: 캐시에 폰트가 없을 때 다운로드가 100ms를 넘으면, 그 세션 동안 시스템 폰트로 굳었다. 사용자가 앱을 종료하고 다시 실행해야 지정 폰트가 보였다. launch-screen이 이미 폰트를 받는 구간을 가리므로 `display=swap`으로도 FOUT이 보이지 않고, 캐시를 비운 직후에도 폰트가 오는 즉시 적용된다.

## 결정

**C안 채택**: "흰 화면이 1픽셀도 번쩍이지 않는다"를 목표로, 아래 계층을 모두 도입한다.

### 1. HTML 배경 다크 기본값

```css
html { background: #1a1a2e; }
html.launch-done { background: var(--bg); }
```

라이트 모드 사용자도 **스플래시 단계 내내 다크 배경**을 본다. 런치 스크린 SVG가 밝은색이므로 다크 배경이 대비상 자연스럽고, 전환 시점(`.launch-done`) 전의 번쩍임을 모두 없앤다(`48f8e23`).

### 2. `body::before` 안전 오버레이

```css
html:not(.launch-done) body::before {
  content: ""; position: fixed; inset: 0; z-index: 9998;
  background: #1a1a2e;
}
```

HTML 파싱이 `<body>` 태그까지 왔지만 `<div id="launch-screen">` 마크업에는 아직 닿지 않은 아주 짧은 구간이 있다. 이때 헤더와 메인이 일부 그려지며 흰 화면이 번쩍이는데, 이 오버레이가 그것을 덮는다. `launch-done` 클래스가 붙으면 저절로 사라진다(`48f8e23`).

### 3. launch-screen을 body 첫 자식으로 배치

```html
<body>
  <div id="launch-screen" aria-hidden="true">...</div>
  <header>...</header>
  <main>...</main>
</body>
```

헤더와 메인보다 먼저 파싱되어 `body::before`가 기다리는 시간을 줄인다. SVG 로고는 인라인으로 넣어 추가 네트워크 요청 없이 바로 보인다.

### 4. Critical CSS 인라인

별도 파일이던 `css/pre-paint.css`를 `index.html`의 `<style>` 블록으로 합쳤다(`1988b90`). 서비스 워커 캐시 여부나 네트워크 상태와 상관없이, HTML 파싱 즉시 배경과 레이아웃이 적용된다.

포함 범위:
- 디자인 토큰 변수(`:root`, `[data-theme="dark"]`)
- HTML과 body의 배경, 색상, 폰트 스택
- `#app-header`, `#app` 기본 레이아웃
- `body::before` 안전 오버레이
- `#launch-screen` 기본 스타일

### 5. 렌더를 막는 리소스를 비동기로

- Google Fonts 스타일시트: `preload as="style"`과 일반 stylesheet 링크로 `@font-face` 규칙을 first paint 전에 확보한다(`d61f879`). `display=swap`을 써서 폰트를 다 받는 즉시 본문에 적용한다. launch-screen 오버레이가 다운로드 구간을 가려 FOUT은 보이지 않는다(2026-05-01, `display=optional`을 되돌림. 「검토한 대안」).
- 폰트가 도착하기를 기다려 런치 스크린을 닫는다(2026-05-01). 페이드아웃 시간(2.4s)은 보통 네트워크에서는 폰트 다운로드를 충분히 덮는다. 그러나 느린 LTE나 3G의 콜드 캐시에서 폰트가 페이드아웃이 끝난 뒤에 오면, 본문이 다 보인 상태에서 swap이 일어나 FOUT(레이아웃 시프트 포함)이 보일 수 있다. 그래서 `dismissLaunchScreen()`을 `Promise.race([document.fonts.ready, timeout(1500ms)])`의 결과를 기다린 뒤 부른다(`js/app.js`).
  - 캐시에 있으면 `document.fonts.ready`가 바로 끝나 지연이 없다.
  - 콜드 캐시에서는 폰트가 올 때까지 launch-screen이 본문을 가린 채 기다리다가 페이드아웃을 시작한다.
  - 1.5s 타임아웃은 아주 느린 네트워크에서 끝없이 기다리지 않게 하는 안전망이다. 이 경우에는 swap이 본문에 보이지만, 기존 동작과 같은 정도의 회귀로 그친다.
- `app.js`, `gtag-init.js`: `defer` 속성을 단다.
- `js/pre-fetch.js`: `<head>`에서 동기로 불러오되, 세 줄짜리 스크립트로 `books.json` 받기를 앱 코드 로드와 나란히 시작한다(`7d1b204`).

### 6. 런치 스크린을 일찍 닫고 부드럽게 전환하기

`dismissLaunchScreen()`을 부르는 시점을 **라우트마다 렌더하기 직전**으로 옮긴다(`36efc6c`, `7d1b204`). 장 목록이나 책 목록 같은 가벼운 뷰는 렌더한 뒤가 아니라 렌더하기 직전에 불러 첫 페인트를 앞당긴다.

전환 애니메이션:
- `requestAnimationFrame`으로 페이드아웃 클래스를 붙이는 일을 렌더 프레임과 떼어 놓는다(`7d1b204`).
- `.launch-done` 배경 교체는 50ms 늦춰, 애니메이션이 반영된 뒤에 한다.
- 0.8s에서 2s cubic-bezier로 늦춰 갑작스러운 전환감을 없앤다.
- `prefers-reduced-motion`이면 애니메이션을 끈다.

### 7. SVG 경량화

인라인 로고 SVG는 `svgo --multipass --precision=2`로 좌표 정밀도를 두 자리로 줄였다(`07eeda6`). `index.html`이 37KB에서 15KB가 됐다. 25vmin 표시 크기에서는 픽셀보다 작은 차이라 눈에 보이는 회귀가 없다.

### 8. iOS 네이티브 스플래시 병행

기기별 `apple-touch-startup-image` 13개(`2f0e7d3`)와 `manifest.webmanifest`의 `background_color: #1a1a2e`로 OS 수준 스플래시도 같은 색조로 맞췄다. C안과 부딪치지 않고, **OS 스플래시 → 웹뷰 초기화 구간 → #launch-screen → 앱 UI**의 모든 구간이 끊김 없이 다크 색조로 이어진다.

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

## 트레이드오프와 주의 사항

1. **방어 레이어가 겹친다**: HTML 배경, `body::before`, `#launch-screen`의 세 겹이 같은 다크 배경을 그린다. 한 레이어를 고칠 때 나머지와 색이 어긋나지 않게 `#1a1a2e` 상수를 함께 맞춰야 한다. 디자인 토큰으로 만들지는 따로 검토한다.
2. **인라인 CSS를 고치면 CSP 해시를 꼭 갱신한다**: `index.html`의 `<style>` 블록을 고치면 `style-src` sha256 해시를 다시 계산해야 한다(`4a57a15`). 외부 `css/style.css`를 고칠 때는 해시를 갱신하지 않아도 된다.
3. **`requestAnimationFrame + setTimeout(50ms)` 조합**: 애니메이션 반영과 배경 전환의 시점이 어긋나면 다시 깜박일 수 있다. 50ms는 실측으로 찾은 안정점이다.
4. **pre-fetch.js는 동기 스크립트다**: `<head>` 안의 동기 스크립트지만, 세 줄짜리 fetch 호출뿐이라 파싱을 막는 영향은 무시할 만하다. 커지면 `defer`로 바꾸는 것을 검토한다.
5. **launch-done에 닿지 못할 위험**: 라우트 렌더가 실패하면 런치 스크린이 계속 남을 수 있다. 그래서 `route()`의 `catch`와 safety fallback에서 `dismissLaunchScreen()`을 거듭 부른다(멱등).

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

## 다시 검토할 조건

- iOS 저사양 기기(아이폰 SE 2세대 수준)에서 LCP가 2s를 넘으면 → books.json 응답의 직렬화 형식(예: MessagePack)을 검토한다.
- critical CSS가 15KB를 넘으면 → 디자인 토큰만 남기고 레이아웃 규칙을 밖으로 뺀다.
- prefers-reduced-motion 말고도 접근성 의견이 오면 → fade 시간과 이징을 다시 맞춘다.

## 참고

- `index.html` — 인라인 critical CSS, launch-screen 마크업, pre-fetch.js
- `js/app.js` `dismissLaunchScreen` — 런치 스크린을 닫는 로직
- `css/style.css` `#launch-screen` — 페이드아웃 애니메이션
- `js/pre-fetch.js` — books.json 조기 받기
- `sw.js` SHELL_FILES — critical 리소스 프리캐시 목록
