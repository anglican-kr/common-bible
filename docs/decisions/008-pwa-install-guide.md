# ADR-008: PWA 설치 가이드 전략

- 일시: 2026-04-18
- 상태: 승인됨

## 맥락

공동번역성서 PWA는 홈 화면에 설치되면 웹 고유의 제약에서 크게 벗어난다. ITP의 스토리지 삭제, 주소창이 차지하는 공간, 콜드 부팅 지연이 그런 제약이다(특히 iOS 16.4+에서는 독립 저장소를 받는다). 그러나 처음 구현은 "사용자가 알아서 홈 화면에 추가하겠지"를 전제했다. 북마크나 오디오 오프라인 재생 같은 뒤의 기능이 제대로 느껴지려면 **설치를 이끄는 흐름**이 먼저 필요하다.

설치할 수 있는지와 그 방법은 플랫폼마다 크게 다르다.

| 플랫폼 | 프로그래매틱 설치 | 수동 설치 경로 |
|--------|------------------|----------------|
| Android Chromium | `beforeinstallprompt.prompt()` | 메뉴 → 앱 설치 |
| Desktop Chromium | `beforeinstallprompt.prompt()` | 주소창 설치 아이콘 |
| iOS Safari | 불가 | 공유 → 홈 화면에 추가 |
| iOS Chrome/Firefox/기타 | 불가 (WebKit 래퍼) | 공유 → 홈 화면에 추가(iOS 17+), iOS 16 이하는 Safari로 열어야 함 |
| Desktop Safari/Firefox | 불가 | 지원 없음 |

네이티브 앱 스토어의 설치 안내처럼 **한 화면에서 내 기기에 맞는 경로만** 보여 주지 않으면 사용자는 금방 떠난다.

## 검토한 대안

### A안: 배너 자동 노출 (첫 방문 즉시)

- 장점: 가장 많이 노출되고, 설치로 이어지는 비율이 높다.
- 단점:
  - 첫 방문에서는 앱의 가치가 아직 드러나지 않아 「닫기」를 누르기 쉽다.
  - 성무일과처럼 잠깐 열어 보는 경우에는 방해가 된다.
  - iOS에는 `beforeinstallprompt`가 없어, 배너를 닫아도 다음에 또 뜨는 되풀이에 빠질 위험이 있다.

### B안: 외부 도움말 페이지로 링크

- 장점: 구현이 단순하다.
- 단점: 사용자가 떠나고, PWA 밖으로 나가며, 플랫폼을 감지할 수 없다.

### C안: 설정 메뉴 안의 「앱 설치」 항목 + 플랫폼별 모달 (채택)

- 장점:
  - 사용자가 원할 때만 연다. 방해가 적다.
  - 플랫폼과 설치 상태를 감지해 **내 기기에 맞는 경로만** 보여 준다.
  - 이미 설치한 사용자에게는 진입점 자체를 숨긴다.
  - 첫 방문 자동 팝업이 없으므로 ITP와 저장소 정책에 영향받지 않는다.
- 단점:
  - 「설치할 수 있다」는 사실 자체를 사용자가 찾아야 한다. 설정 아이콘이 얼마나 눈에 띄느냐가 관건이다.
  - 설치로 이어지는 비율을 높이려면 온보딩이나 재방문 트리거를 따로 설계해야 한다.

### iOS 비Safari는 모두 「Safari에서 열어 주세요」 (2026-05-11까지)

- iOS의 Chrome, Firefox, Edge, Opera 등은 모두 `ios-other`로 묶어 「Safari에서 열어 주세요」와 주소 복사 버튼만 보였다.
- 채택하지 않음 2026-05-11 · 이유: iOS 17부터 Chrome, Firefox, Edge, Opera 등의 공유 시트에도 「홈 화면에 추가」가 보이고, 그렇게 추가한 아이콘은 standalone WebKit 컨테이너에서 실행된다. 「iOS는 Safari에서만 설치할 수 있다」는 전제가 더 이상 사실이 아니다. 그래서 iOS 버전으로 나눴다(아래 「1. 플랫폼과 설치 상태 감지」).

## 결정

**C안 채택**. 설정 팝오버에 「앱 설치 → 안내」 행을 더하고, 누르면 플랫폼별 내용을 그리는 모달을 연다.

### 1. 플랫폼과 설치 상태 감지

`js/app.js`의 `install` IIFE(`2074`행부터)가 다음 상태를 알려 준다. 2026-05-10 모듈 분할 뒤에는 `js/app/install.js`에 있다(ADR-018).

```
installed   / 이미 standalone으로 실행 중
ios-safari  / iPhone·iPad Safari
ios-other   / iOS Chrome/Firefox/Edge/OPiOS/GSA
android     / Android Chromium
desktop     / 데스크톱 Chromium
unsupported / Firefox/Safari 데스크톱 등
```

2026-05-11부터 iOS의 비Safari 브라우저는 버전에 따라 둘로 나눈다.
- `ios-other`: iOS 17+의 비Safari(CriOS/FxiOS/EdgiOS/OPiOS). 공유 메뉴에서 「홈 화면에 추가」를 고르는 텍스트 안내를 보인다. **자동 nudge 대상에 넣는다**.
- `ios-legacy`: iOS 16 이하의 비Safari. 기존의 「Safari로 열어 주세요」와 주소 복사 메시지를 그대로 보인다. nudge 대상이 아니다.
- 이 분기는 `tests/unit/install.test.js`와 `tests/e2e/test_install_guide.py`가 확인한다.

핵심 판정:

- `matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`면 `installed`다.
- `/iPad|iPhone|iPod/`와 iPadOS 13+ 판정법(`MacIntel` + `maxTouchPoints > 1`)으로 iOS 계열을 가른다.
- iOS에서 `CriOS|FxiOS|EdgiOS|OPiOS|GSA`가 들어 있는지로 Safari와 다른 브라우저를 가른다.
- iOS의 메이저 버전은 `OS X_Y` 토큰을 먼저 본다. iPad가 데스크톱급 UA로 가릴 때(`MacIntel + maxTouchPoints>1`)는 `Version/X.Y`를 보거나, 없으면 17로 가정한다(`getIOSMajor()`).
- 나머지는 UA에 `Android` 토큰이 있으면 `android`, 없으면 Chromium 데스크톱인지 판정한다.

`beforeinstallprompt` 이벤트는 받아서 저장해 두고, 사용자가 CTA를 누를 때 `prompt()`를 부른다. `appinstalled`와 `display-mode` 변경은 구독자에게 다시 알린다.

### 2. 플랫폼별 모달 내용

| 플랫폼 | 내용 |
|--------|------|
| `ios-safari` (iPhone) | 공유 버튼 SVG 안내 + 3단계 안내 |
| `ios-safari` (iPad)   | 주소창 오른쪽의 공유 버튼 위치를 강조한 SVG |
| `ios-other`           | iOS 17+: 3단계 텍스트 안내 + 감지한 브라우저 이름(「Chrome / Firefox / Edge / Opera / 브라우저」) |
| `ios-legacy`          | 「Safari에서 열어 주세요」 + 주소 복사 버튼 |
| `android`/`desktop`   | 플랫폼에 맞는 CTA 버튼 → `beforeinstallprompt.prompt()` |
| `unsupported`         | 지원 브라우저 안내 |

`ios-other`는 스크린샷 대신 텍스트로 안내한다. 브라우저마다 공유 버튼 위치가 달라 스크린샷 하나로는 정확하지 않기 때문이다(2026-05-11).

CTA는 `install.subscribe()`로 `canPrompt` 상태의 변화를 받아 disabled와 enabled가 저절로 바뀐다. 이벤트가 늦게 오는 데스크톱 Chrome에서도, 사용자가 모달을 연 상태에서 활성화된다.

### 3. 진입점 배치

설정 팝오버의 「캐시 초기화」 바로 위에 「앱 설치 → 안내」 행을 더한다. `install.detectPlatform() === 'installed'`이면 행 자체를 그리지 않는다. 팝오버는 열 때마다 다시 만들므로, 설치한 뒤에 다시 열면 항목이 사라진다.

### 4. 접근성

- 모달은 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
- 기존 `trapFocus()`를 다시 쓴다. ESC 키, 스크림 클릭, 닫기 버튼 모두 모달을 닫는다.
- 닫으면 이전 포커스 요소로 돌아간다(`installModalLastFocus.focus()`).
- `install-guide` SVG에 `role="img"` + `aria-label`

### 5. 이미지 자산

`assets/install-guide/ios-iphone-share.svg`, `assets/install-guide/ios-ipad-share.svg`는 처음에 **SVG 플레이스홀더**로 시작한다. 스크린샷을 찍고 편집하는 일은 따로 해야 하므로, SVG는 빨간 강조로 공유 버튼 위치만 보인다.

나중에 실기기 스크린샷으로 바꿀 때는 같은 경로에 PNG나 WebP로 덮어쓰거나, SVG에 `<image>`로 넣으면 된다. SVG는 다크 모드를 저절로 따르지만, 래스터 이미지는 다크 모드용 파일이 따로 필요해질 수 있다.

### 6. 캐시 전략

SHELL_FILES에는 넣지 **않는다**. 안내 이미지는 설치를 처음 안내할 때만 요청되고, 전역 stale-while-revalidate 핸들러(`sw.js`)가 처음 접근할 때 캐시에 저장한다. 모든 사용자에게 미리 캐시를 강제할 이유가 없다.

## 트레이드오프와 주의 사항

1. **iOS 버전마다 공유 시트 UI가 다르다**: iOS 13-14와 15+는 주소창 위치(위와 아래)가 다르다. 스크린샷 하나로 일반화하고 "iOS 버전에 따라 메뉴 위치가 조금 다를 수 있습니다"라는 안내로 메운다. 버전마다 나누는 것은 비용에 비해 효용이 작다.
2. **iPadOS 13+ UA 판정법**: `navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1`이 지금 유일한 판정 수단이다. 앞으로 `navigator.userAgentData`가 안정되면 바꾼다.
3. **Android 말고 다른 모바일 Chromium**: Samsung Internet 등은 UA에 `Android` 토큰이 있어 `android`로 분류된다. 설치 메뉴 위치는 다르지만 `beforeinstallprompt` 경로는 같아서, 안내문이 정확히 맞지 않을 수 있다. 감지를 고치는 것은 나중에 검토한다.
4. **`beforeinstallprompt`는 1회 쓰면 다시 뜨지 않는다**: 사용자가 한 번 거부하면 Chromium은 같은 세션에서 다시 띄우지 않는다. 지금 모달은 첫 프롬프트의 결과에 따라 버튼을 disabled로 둔다. 다시 방문하면 새로 뜨므로 실제 영향은 작다.
5. **첫 방문 자동 노출 없음**: 설치로 이어지는 비율이 필요하면, N회 재방문 뒤의 토스트 같은 별도 트리거를 뒤의 ADR에서 도입한다. 이 ADR은 「요청할 때만 보인다」로 한정한다.

## 관련 파일

- `js/app.js` `install` IIFE — 플랫폼 감지, 이벤트 수신(지금은 `js/app/install.js`의 `getIOSMajor()`, `detectPlatform()`)
- `js/app.js` `buildInstallBody` / `openInstallModal` — 모달 렌더, 포커스 트랩(`buildInstallBody`의 `ios-other`, `ios-legacy` 분기)
- `js/app.js` `initSettings` 안의 「앱 설치」 행 — 진입점
- `index.html` `#install-scrim`, `#install-modal` — 모달 마크업
- `css/style.css` `#install-scrim`, `#install-modal` — 모달 스타일
- `assets/install-guide/ios-iphone-share.svg`, `ios-ipad-share.svg` — 안내 SVG(플레이스홀더)
- `tests/e2e/test_install_guide.py` — 플랫폼별 UA override 검증(iOS 17 Chrome, iOS 16 Chrome 분기 포함)
- `tests/unit/install.test.js` — iOS 16과 iPad 마스킹 경우 4건, nudge의 `ios-other` 재분류

## 다시 검토할 조건

- 설치율이 낮게 측정되면 → 재방문 N회 뒤 1회 배너(닫기 기억) 도입을 검토한다.
- 실기기 스크린샷을 확보하면 → SVG 플레이스홀더를 사진 기반 안내로 바꾼다.
- iOS 18+에서 `apple-app-site-association`이나 Smart App Banner 정책이 PWA까지 넓어지면 → 별도 분기를 더한다.
- `navigator.userAgentData`의 브라우저 보급률이 충분해지면 → UA 문자열 파싱을 UA-CH로 바꾼다.
