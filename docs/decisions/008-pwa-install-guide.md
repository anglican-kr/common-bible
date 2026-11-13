# ADR-008: PWA 설치 가이드 전략

- 일시: 2026-04-18
- 상태: 승인됨

## 맥락

공동번역성서 PWA는 홈 화면에 설치되면 웹 고유의 제약에서 크게 벗어난다. ITP의 스토리지 삭제, 주소창이 차지하는 공간, 앱을 처음 열 때의 지연이 그런 제약이다(특히 iOS 16.4+에서는 독립 저장소를 받는다). 그러나 처음 구현은 "사용자가 알아서 홈 화면에 추가하겠지"를 전제했다. 북마크나 오디오 오프라인 재생 같은 뒤의 기능이 제대로 느껴지려면 **설치를 이끄는 흐름**이 먼저 필요하다.

설치할 수 있는지와 그 방법은 플랫폼마다 크게 다르다.

| 플랫폼 | 프로그래매틱 설치 | 수동 설치 경로 |
|--------|------------------|----------------|
| Android Chromium | `beforeinstallprompt.prompt()` | 메뉴 → 앱 설치 |
| Desktop Chromium | `beforeinstallprompt.prompt()` | 주소창 설치 아이콘 |
| iOS Safari | 불가 | 공유 → 홈 화면에 추가 |
| iOS Chrome/Firefox/기타 | 불가 (WebKit 래퍼) | 공유 → 홈 화면에 추가(iOS 17+), iOS 16 이하는 Safari로 열어야 함 |
| Desktop Safari/Firefox | 불가 | 지원 없음 |
| 인앱브라우저(카카오톡, 네이버, 인스타그램 등) | 불가 | 없음. 기기의 브라우저에서 다시 열어야 한다 |

네이티브 앱 스토어의 설치 안내처럼 **한 화면에서 내 기기에 맞는 경로만** 보여 주지 않으면 사용자는 금방 떠난다.

## 검토한 대안

### A안: 배너 자동 노출 (첫 방문 즉시)

- 장점: 가장 많이 노출되고, 설치로 이어지는 비율이 높다.
- 단점:
  - 첫 방문에서는 앱의 가치가 아직 드러나지 않아 「닫기」를 누르기 쉽다.
  - 성무일과처럼 잠깐 열어 보는 경우에는 방해가 된다.
  - iOS에는 `beforeinstallprompt`가 없어, 배너를 닫아도 다음에 또 뜨는 일이 되풀이될 위험이 있다.

### B안: 외부 도움말 페이지로 링크

- 장점: 구현이 단순하다.
- 단점: 사용자가 떠나고, PWA 밖으로 나가며, 플랫폼을 감지할 수 없다.

### C안: 설정 메뉴 안의 「앱 설치」 항목 + 플랫폼별 모달 (채택)

- 장점:
  - 사용자가 원할 때만 연다. 방해가 적다.
  - 플랫폼과 설치 상태를 감지해 **내 기기에 맞는 경로만** 보여 준다.
  - 이미 설치한 사용자에게는 진입점 자체를 숨긴다.
  - 첫 방문 자동 팝업이 없으므로 ITP와 저장소 정책의 영향을 받지 않는다.
- 단점:
  - 「설치할 수 있다」는 사실 자체를 사용자가 찾아야 한다. 설정 아이콘이 얼마나 눈에 띄느냐가 관건이다.
  - 설치로 이어지는 비율을 높이려면 온보딩이나 재방문 트리거를 따로 설계해야 한다.

### iOS 비Safari는 모두 「Safari에서 열어 주세요」 (2026-05-11까지)

- iOS의 Chrome, Firefox, Edge, Opera 등은 모두 `ios-other`로 묶어 「Safari에서 열어 주세요」와 주소 복사 버튼만 보였다.
- 채택 안 함(2026-05-11). 이유: iOS 17부터 Chrome, Firefox, Edge, Opera 등의 공유 시트에도 「홈 화면에 추가」가 보이고, 그렇게 추가한 아이콘은 독립 실행(standalone) 모드의 WebKit 컨테이너에서 실행된다. 「iOS는 Safari에서만 설치할 수 있다」는 전제가 더 이상 사실이 아니다. 그래서 iOS 버전으로 나눴다(아래 「1. 플랫폼과 설치 상태 감지」).

### 인앱브라우저에서는 설치 안내에서만 브라우저로 내보내기

- 인앱브라우저에서도 본문은 그대로 읽게 두고, 사용자가 설치 안내를 열었을 때만 「브라우저에서 열기」 단추를 보이는 방법이다. 공유받은 구절만 읽으려는 사람을 다른 앱으로 보내지 않는다.
- 채택 안 함(2026-11-13, 사용자 결정). 이유: 공유된 링크로 들어온 사람은 대부분 인앱브라우저에서 처음 만나는데, 거기서는 설치할 수 없고 저장한 북마크도 브라우저로 넘어가지 않는다. 설치 안내를 스스로 찾아 여는 사람은 적으므로 들어오면 곧바로 브라우저로 옮긴다(아래 「7. 인앱브라우저」).
- 재검토 조건: 자동 전환 때문에 읽기가 끊긴다는 사용자 의견이 나오거나, 주요 앱이 전환 주소를 막아 빈 화면이나 오류 화면이 생길 때.

## 결정

**C안 채택**. 설정 팝오버에 「앱 설치 → 안내」 행을 더하고, 누르면 플랫폼별 내용을 그리는 모달을 연다.

### 1. 플랫폼과 설치 상태 감지

`js/app.js`의 즉시 실행 함수(`install` IIFE, `2074`행부터)가 다음 상태를 알려 준다. 2026-05-10 모듈 분할 뒤에는 `js/app/install.js`에 있다(ADR-018).

```
installed   / 이미 standalone으로 실행 중
in-app      / 다른 앱 안의 브라우저(카카오톡, 라인, 네이버, 인스타그램, 페이스북, 그 밖의 웹뷰)
ios-safari  / iPhone·iPad Safari
ios-other   / iOS Chrome/Firefox/Edge/OPiOS/GSA
android     / Android Chromium
desktop     / 데스크톱 Chromium
unsupported / Firefox/Safari 데스크톱 등
```

2026-05-11부터 iOS의 비Safari 브라우저는 버전에 따라 둘로 나눈다.
- `ios-other`: iOS 17+의 비Safari(CriOS/FxiOS/EdgiOS/OPiOS). 공유 메뉴에서 「홈 화면에 추가」를 고르는 텍스트 안내를 보인다. **자동 안내 대상에 넣는다**.
- `ios-legacy`: iOS 16 이하의 비Safari. 기존의 「Safari로 열어 주세요」와 주소 복사 메시지를 그대로 보인다. 자동 안내 대상이 아니다.
- 이 분기는 `tests/unit/install.test.js`와 `tests/e2e/test_install_guide.py`가 확인한다.

핵심 판정:

- `matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`면 `installed`다.
- `/iPad|iPhone|iPod/`와 iPadOS 13+ 판정법(`MacIntel` + `maxTouchPoints > 1`)으로 iOS 계열을 구별한다.
- iOS에서 `CriOS|FxiOS|EdgiOS|OPiOS|GSA`가 들어 있는지로 Safari와 다른 브라우저를 구별한다.
- iOS의 메이저 버전은 `OS X_Y` 토큰을 먼저 본다. iPad가 데스크톱급 UA로 가릴 때(`MacIntel + maxTouchPoints>1`)는 `Version/X.Y`를 보거나, 없으면 17로 가정한다(`getIOSMajor()`).
- 나머지는 UA에 `Android` 토큰이 있으면 `android`, 없으면 Chromium 데스크톱인지 판정한다.

`beforeinstallprompt` 이벤트는 받아서 저장해 두고, 사용자가 CTA를 누를 때 `prompt()`를 호출한다. `appinstalled`와 `display-mode` 변경은 구독자에게 다시 알린다.

### 2. 플랫폼별 모달 내용

| 플랫폼 | 내용 |
|--------|------|
| `ios-safari` (iPhone) | 공유 버튼 SVG 안내 + 3단계 안내 |
| `ios-safari` (iPad)   | 주소창 오른쪽의 공유 버튼 위치를 강조한 SVG |
| `ios-other`           | iOS 17+: 3단계 텍스트 안내 + 감지한 브라우저 이름(「Chrome / Firefox / Edge / Opera / 브라우저」) |
| `ios-legacy`          | 「Safari에서 열어 주세요」 + 주소 복사 버튼 |
| `android`/`desktop`   | 플랫폼에 맞는 CTA 버튼 → `beforeinstallprompt.prompt()` |
| `unsupported`         | 지원 브라우저 안내 |
| `in-app`              | 「이 안에서는 설치할 수 없습니다」 + 「브라우저에서 열기」 단추(전환 주소를 아는 앱만) + 주소 복사 단추 |

`ios-other`는 스크린샷 대신 텍스트로 안내한다. 브라우저마다 공유 버튼 위치가 달라 스크린샷 하나로는 정확하지 않기 때문이다(2026-05-11).

설치 단추(CTA)는 `install.subscribe()`로 `canPrompt` 상태의 변화를 받아 비활성과 활성이 저절로 바뀐다. 이벤트가 늦게 오는 데스크톱 Chrome에서도, 사용자가 모달을 연 상태에서 단추가 활성화된다.

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

SHELL_FILES에는 넣지 **않는다**. 안내 이미지는 설치를 처음 안내할 때만 요청되고, 전역 stale-while-revalidate 핸들러(`sw.js`)가 처음 요청받을 때 캐시에 저장한다. 모든 사용자에게 미리 캐시를 강제할 이유가 없다.

### 7. 인앱브라우저 (2026-11-13)

메신저나 SNS 앱에서 링크를 누르면 그 앱 안의 브라우저(인앱브라우저)로 열린다. 여기에는 「홈 화면에 추가」가 없고 `beforeinstallprompt` 이벤트도 오지 않아 설치할 수 없다. 저장소도 기기의 브라우저와 분리되어 있다. 그래서 인앱브라우저를 알아보고 **첫 화면을 그린 직후 기기의 브라우저로 옮긴다**.

**감지.** UA 문자열의 앱 토큰으로 구별한다(`detectInAppBrowser()`). 독립 실행 판정이 먼저다.

| 앱 | UA 토큰 |
|----|---------|
| 카카오톡 | `KAKAOTALK` |
| 라인 | `Line/` |
| 네이버 | `NAVER(inapp` |
| 인스타그램 | `Instagram` |
| 페이스북 | `FBAN`, `FBAV`, `FB_IAB` |
| 그 밖의 웹뷰 | Android는 `; wv)`, iOS는 `Safari/` 토큰도 다른 브라우저의 토큰(`CriOS` 등)도 없는 UA |

**전환 주소.** 보고 있던 주소(경로와 쿼리)를 그대로 넘긴다(`externalBrowserUrl()`).

| 환경 | 방법 |
|------|------|
| 카카오톡(iOS, Android) | `kakaotalk://web/openExternal?url=<주소>` |
| 라인(iOS, Android) | 주소에 `openExternalBrowser=1` 쿼리를 붙여 다시 연다. 브라우저에 도착하면 이 쿼리를 주소에서 지운다(`dropHandOffQuery()`) |
| Android의 네이버, 인스타그램, 페이스북 | `intent://<호스트><경로>#Intent;scheme=https;S.browser_fallback_url=<주소>;end`. 기본 브라우저가 연다. 받을 브라우저가 없으면 웹뷰가 대비 주소(`S.browser_fallback_url`)로 같은 쪽을 다시 연다. `intent://`를 아예 처리하지 않는 웹뷰에는 대비 주소도 소용이 없으므로 실기기에서 확인해야 한다 |
| iOS 17+의 네이버, 인스타그램, 페이스북 | `x-safari-https://<호스트><경로>`. Apple이 문서로 밝히지 않은 주소 형식이라 실기기에서 확인해야 한다 |
| iOS 16 이하의 위 세 앱, 그 밖의 웹뷰 | 전환 주소 없음. 자동 전환을 하지 않는다. iOS 버전은 설치 안내와 같은 함수(`getIOSMajor()`)로 읽는다 |

**자동 전환.** 첫 화면을 그린 뒤, 시작할 때의 나머지 일(서비스 워커 등록 등)을 모두 시작하고 나서 전환 주소로 이동한다(`maybeLeaveInAppBrowser()`, `js/app.js`의 시작 코드가 맨 끝에 부른다). 문서를 다 읽기(`load` 이벤트) 전이면 그때까지 기다린다. 문서를 읽는 도중에 이동을 시작하면 Chromium은 남은 스크립트를 실행하지 않고 `load`도 끝내지 않아, 전환이 실패했을 때 빈 화면이나 계속 읽는 중인 화면이 남는다(2026-11-13 확인). 화면을 먼저 그려 두면 전환이 실패하거나 사용자가 인앱브라우저로 돌아와도 본문이 보인다.

**기다리는 시간의 한도.** `load`를 3초까지만 기다린다(2026-11-14). 느린 망에서는 `load`가 한참 뒤에 끝나는데, 그때 전환하면 이미 읽고 있는 사람을 예고 없이 다른 앱으로 보낸다. 3초를 넘기면 그 방문에서는 전환하지 않고 설치 안내 모달을 연다.

**한 번만 시도한다.** 탭 세션에서 한 번만 시도한다(`sessionStorage`의 `bible-inapp-left`). 기록은 실제로 이동하는 순간에 남긴다. 전환이 실패했거나 사용자가 인앱브라우저로 돌아와 새로 고칠 때 다시 다른 앱으로 넘어가지 않게 하려는 것이다. 기록을 남길 수 없으면 전환하지 않는다. 라인은 쿼리가 이미 붙어 있으면 다시 시도하지 않는다.

**이름을 모르는 웹뷰는 자동 전환하지 않는다.** `intent://`를 처리하지 않는 Android 웹뷰는 본문 대신 오류 화면(`ERR_UNKNOWN_URL_SCHEME`)을 보인다. 전환 주소를 처리한다고 알려진 앱만 목록에 둔다.

**전환이 안 됐을 때.** 인앱브라우저에 남은 사용자는 본문을 그대로 읽을 수 있고, 설치 안내 모달이 「브라우저에서 열기」와 「주소 복사」를 보인다(2026-11-14). 모달은 다음 세 경우에 저절로 열린다. 「다시 열지 않음」을 고른 사용자에게는 열지 않는다.

- 전환을 시도하고 2.5초가 지나도 화면이 가려지지 않았을 때. 전환에 성공하면 다른 앱이 앞에 나와 문서가 가려지므로(`visibilitychange` 이벤트), 가려지지 않았으면 실패로 본다.
- `load`를 3초 넘게 기다려 전환을 그만뒀을 때.
- 전환 주소가 없는 인앱브라우저(이름을 모르는 웹뷰, iOS 16 이하)의 첫 방문. 다른 플랫폼의 자동 안내는 두 번째 방문부터 뜨지만, 공유 링크는 대개 첫 방문이고 인앱브라우저는 저장소를 자주 비워 두 번째 방문이 세어지지 않을 수 있다.

전환을 시도하는 방문에서는 방문 횟수에 따른 자동 안내를 열지 않는다. 전환에 성공했는데 뒤에 남은 화면에서 모달이 열리는 일을 막는다.

**「주소 복사」.** 클립보드 API(`navigator.clipboard`)를 쓸 수 없는 웹뷰가 많다. 실패하면 옛 방식(`document.execCommand("copy")`)으로 다시 시도하고, 그것도 안 되면 주소를 글상자에 보여 사용자가 길게 눌러 복사하게 한다(`_buildCopyButton()`, iOS 16 이하 안내와 함께 쓴다).

## 트레이드오프와 주의 사항

1. **iOS 버전마다 공유 시트 UI가 다르다**: iOS 13-14와 15+는 주소창 위치(위와 아래)가 다르다. 스크린샷 하나로 일반화하고 "iOS 버전에 따라 메뉴 위치가 조금 다를 수 있습니다"라는 안내로 보완한다. 버전마다 나누는 것은 비용에 비해 효용이 작다.
2. **iPadOS 13+ UA 판정법**: `navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1`이 지금 유일한 판정 수단이다. 앞으로 `navigator.userAgentData`가 안정되면 바꾼다.
3. **Android 말고 다른 모바일 Chromium**: Samsung Internet 등은 UA에 `Android` 토큰이 있어 `android`로 분류된다. 설치 메뉴 위치는 다르지만 `beforeinstallprompt` 경로는 같아서, 안내문이 정확히 맞지 않을 수 있다. 감지를 고치는 것은 나중에 검토한다.
4. **`beforeinstallprompt`는 1회 쓰면 다시 뜨지 않는다**: 사용자가 한 번 거부하면 Chromium은 같은 세션에서 다시 띄우지 않는다. 지금 모달은 첫 프롬프트의 결과에 따라 버튼을 비활성으로 둔다. 다시 방문하면 새로 뜨므로 실제 영향은 작다.
5. **인앱브라우저 목록은 손으로 관리한다**: 목록에 없는 앱은 「그 밖의 웹뷰」로 분류되어 주소 복사 안내만 받는다. iOS의 `SFSafariViewController`를 쓰는 앱은 UA가 Safari와 같아 구별할 수 없다. 앱이 UA 토큰이나 전환 주소를 바꾸면 전환이 조용히 실패하고, 그때는 모달의 안내로 넘어간다.
6. **첫 방문에는 저절로 열지 않는다**: 설치 안내는 설정의 「앱 설치」로 열고, 두 번째 방문부터 정해진 간격으로 저절로 열린다(`maybeShowInstallNudge()`). 검색으로 들어온 사람의 첫 화면을 가리지 않으려는 것이다. 인앱브라우저만 예외다. 요청 없이 기기의 브라우저로 옮기고, 옮기지 못하면 첫 방문에도 안내를 연다(§7).

## 관련 파일

- `js/app.js` `install` 즉시 실행 함수: 플랫폼 감지, 이벤트 수신(지금은 `js/app/install.js`의 `getIOSMajor()`, `detectPlatform()`)
- `js/app.js` `buildInstallBody` / `openInstallModal`: 모달 렌더, 포커스 트랩(`buildInstallBody`의 `ios-other`, `ios-legacy` 분기)
- `js/app.js` `initSettings` 안의 「앱 설치」 행: 진입점
- `index.html` `#install-scrim`, `#install-modal`: 모달 마크업
- `css/style.css` `#install-scrim`, `#install-modal`: 모달 스타일
- `assets/install-guide/ios-iphone-share.svg`, `ios-ipad-share.svg`: 안내 SVG(플레이스홀더)
- `tests/e2e/test_install_guide.py` — 플랫폼별 UA override 검증(iOS 17 Chrome, iOS 16 Chrome 분기 포함)
- `tests/unit/install.test.js` — iOS 16과 iPad 마스킹 경우 4건, nudge의 `ios-other` 재분류, 인앱브라우저 감지와 전환 주소, 자동 전환을 한 번만 하는지
- `js/app/install.js` `detectInAppBrowser()`, `externalBrowserUrl()`, `maybeLeaveInAppBrowser()`: 인앱브라우저 감지, 전환 주소, 자동 전환

## 다시 검토할 조건

- 설치율이 낮게 측정되면 재방문 N회 뒤 1회 배너(닫기 기억) 도입을 검토한다.
- 실기기 스크린샷을 확보하면 SVG 플레이스홀더를 사진 기반 안내로 바꾼다.
- iOS 18+에서 `apple-app-site-association`이나 Smart App Banner 정책이 PWA까지 넓어지면 별도 분기를 더한다.
- 인앱브라우저의 전환 주소(특히 `x-safari-https://`)가 실기기에서 동작하지 않으면 그 앱을 자동 전환 목록에서 빼고 안내만 보인다.
- `navigator.userAgentData`의 브라우저 보급률이 충분해지면 UA 문자열 파싱을 UA-CH로 바꾼다.
