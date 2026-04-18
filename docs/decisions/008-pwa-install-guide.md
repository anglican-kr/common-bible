# ADR-008: PWA 설치 가이드 전략

- 일시: 2026-04-18
- 상태: 승인됨

## 맥락

공동번역성서 PWA는 홈 화면에 설치됐을 때 ITP 스토리지 삭제·주소창 공간·콜드 부팅 지연 같은 웹 고유 제약에서 크게 해방된다(특히 iOS 16.4+에서 독립 저장소 부여). 그러나 현 구현은 "사용자가 알아서 홈 화면에 추가하겠지"를 전제하고 있어, 북마크·오디오 오프라인 재생 같은 후속 기능이 체감되려면 **설치 유도 플로우**가 먼저 필요하다.

설치 가능 여부·방법은 플랫폼별로 차이가 크다.

| 플랫폼 | 프로그래매틱 설치 | 수동 설치 경로 |
|--------|------------------|----------------|
| Android Chromium | `beforeinstallprompt.prompt()` | 메뉴 → 앱 설치 |
| Desktop Chromium | `beforeinstallprompt.prompt()` | 주소창 설치 아이콘 |
| iOS Safari | 불가 | 공유 → 홈 화면에 추가 |
| iOS Chrome/Firefox/기타 | 불가 (WebKit 래퍼) | Safari로 열어야 함 |
| Desktop Safari/Firefox | 불가 | 지원 없음 |

네이티브 앱 스토어 설치 안내처럼 **한 화면에서 내 기기에 맞는 경로만** 보여주지 않으면 사용자는 빠르게 이탈한다.

## 검토한 대안

### A안: 배너 자동 노출 (첫 방문 즉시)

- 장점: 노출량 극대화, 전환율 높음
- 단점:
  - 첫 방문에서 앱 가치가 입증되기 전이라 "닫기" 관성이 큼
  - 성무일과처럼 짧은 열람 유스케이스에서는 방해 요소
  - iOS에서는 `beforeinstallprompt`가 없어 배너를 닫아도 다음에 또 노출되는 UX 루프 위험

### B안: 외부 도움말 페이지로 링크

- 장점: 구현 단순
- 단점: 이탈 발생, PWA 외부로 나감, 플랫폼 감지 불가

### C안: 설정 메뉴 내 "앱 설치" 항목 + 플랫폼 분기 모달 (채택)

- 장점:
  - 사용자가 스스로 원할 때만 열어봄 → 방해도 낮음
  - 플랫폼·설치 상태를 감지해 **내 기기에 해당하는 경로만** 표시
  - 이미 설치된 사용자에게는 진입점 자체가 숨겨짐
  - 첫 방문 자동 팝업이 없으므로 ITP·저장소 정책과 독립
- 단점:
  - "설치할 수 있다"는 사실 자체를 발견해야 함 → 설정 아이콘 노출도가 핵심
  - 전환율 최적화를 위해 추후 온보딩/재방문 트리거를 별도 설계 필요

## 결정

**C안 채택**. 설정 팝오버에 "앱 설치 → 안내" 행을 추가하고, 클릭 시 플랫폼별 콘텐츠를 렌더하는 모달을 연다.

### 1. 플랫폼·설치 상태 감지

`js/app.js`의 `install` IIFE(`2036`~)가 다음 상태를 노출한다.

```
installed   / 이미 standalone으로 실행 중
ios-safari  / iPhone·iPad Safari
ios-other   / iOS Chrome/Firefox/Edge/OPiOS/GSA
android     / Android Chromium
desktop     / 데스크톱 Chromium
unsupported / Firefox/Safari 데스크톱 등
```

핵심 판정:

- `matchMedia('(display-mode: standalone)').matches || navigator.standalone === true` → `installed`
- `/iPad|iPhone|iPod/` + iPadOS 13+ 트릭(`MacIntel` + `maxTouchPoints > 1`) → iOS 계열
- iOS에서 `CriOS|FxiOS|EdgiOS|OPiOS|GSA` 포함 여부 → Safari vs 타 브라우저 분기
- 그 외는 UA에 `Android` 토큰이 있으면 `android`, 아니면 Chromium 데스크톱 여부 판정

`beforeinstallprompt` 이벤트는 캡처·저장하고, 사용자가 CTA를 누를 때 `prompt()`를 호출한다. `appinstalled`와 `display-mode` 변경은 구독자에게 재통지된다.

### 2. 플랫폼별 모달 콘텐츠

| 플랫폼 | 내용 |
|--------|------|
| `ios-safari` (iPhone) | 공유 버튼 SVG 가이드 + 3단계 안내 |
| `ios-safari` (iPad)   | 주소창 우측 공유 버튼 위치 강조 SVG |
| `ios-other`           | "Safari에서 열어 주세요" + 주소 복사 버튼 |
| `android`/`desktop`   | 플랫폼에 맞는 CTA 버튼 → `beforeinstallprompt.prompt()` |
| `unsupported`         | 지원 브라우저 안내 |

CTA는 `install.subscribe()`로 `canPrompt` 상태 변화를 반영해 disabled/enabled가 자동 토글된다. 이벤트가 늦게 도착하는 데스크톱 Chrome에서도 사용자가 모달을 연 상태에서 활성화된다.

### 3. 진입점 배치

설정 팝오버의 "캐시 초기화" 바로 위에 "앱 설치 → 안내" 행을 추가한다. `install.detectPlatform() === 'installed'`일 때는 행 자체가 렌더되지 않는다. 팝오버가 매 오픈 시 재빌드되므로 설치 이후 다시 열면 항목이 사라진다.

### 4. 접근성

- 모달은 `role="dialog"` + `aria-modal="true"` + `aria-labelledby`
- 기존 `trapFocus()` 재사용, ESC 키·스크림 클릭·닫기 버튼 모두 닫기
- 이전 포커스 요소로 복귀 (`installModalLastFocus.focus()`)
- `install-guide` SVG에 `role="img"` + `aria-label`

### 5. 이미지 자산

`assets/install-guide/ios-iphone-share.svg`, `assets/install-guide/ios-ipad-share.svg`는 초기 단계에서 **SVG 플레이스홀더**로 시작한다. 스크린샷 촬영·편집 작업이 별도 사이클이 되므로, SVG는 빨간 하이라이트로 공유 버튼 위치만 명시한다.

추후 실기기 스크린샷으로 교체할 때는 동일 경로에 PNG/WebP로 덮어쓰거나 SVG에 `<image>`로 삽입하면 된다. 다크모드 대응이 SVG는 자동이지만 래스터 이미지는 별도 파일이 필요해질 수 있다.

### 6. 캐시 전략

SHELL_FILES에는 추가하지 **않는다**. 안내 이미지는 최초 설치 유도 시점에만 요청되며, 전역 stale-while-revalidate 핸들러(`sw.js`)가 첫 접근에서 캐시에 저장한다. 모든 사용자에게 선제 캐시를 강제할 이유가 없다.

## 트레이드오프 및 주의 사항

1. **iOS 버전별 공유 시트 UI 차이**: iOS 13~14와 15+는 주소창 위치(상단↔하단)가 다르다. 단일 스크린샷으로 일반화하고 "iOS 버전에 따라 메뉴 위치가 조금 다를 수 있습니다" 안내로 커버. 버전별 분기는 비용 대비 효용 낮음.
2. **iPadOS 13+ UA 트릭**: `navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1` 이 현재 유일한 판정 수단. 향후 `navigator.userAgentData`가 안정화되면 교체.
3. **Android 외 모바일 Chromium**: Samsung Internet 등은 `Android` UA 토큰이 있어 `android` 분기로 들어간다. 설치 메뉴 위치가 다르지만 `beforeinstallprompt` 경로는 동일하므로 안내문이 정확히 맞지는 않을 수 있다 — 추후 감지 개선 검토.
4. **`beforeinstallprompt` 1회 소모**: 사용자가 한 번 거부하면 Chromium은 같은 세션에서 다시 발생시키지 않는다. 현재 모달은 첫 프롬프트 결과에 따라 버튼을 disabled 처리한다. 재방문 시 새로 발생하므로 실질 영향은 적음.
5. **첫 방문 자동 노출 없음**: 전환율이 필요하면 N회 재방문 후 토스트 등 별도 트리거를 후속 ADR에서 도입. 이 ADR은 "요청 시에만 노출"에 한정.

## 관련 파일

- `js/app.js` `install` IIFE — 플랫폼 감지·이벤트 수신
- `js/app.js` `buildInstallBody` / `openInstallModal` — 모달 렌더·포커스 트랩
- `js/app.js` `initSettings` 내 "앱 설치" 행 — 진입점
- `index.html` `#install-scrim`, `#install-modal` — 모달 마크업
- `css/style.css` `#install-scrim`, `#install-modal` — 모달 스타일
- `assets/install-guide/ios-iphone-share.svg`, `ios-ipad-share.svg` — 안내 SVG (플레이스홀더)
- `tests/verify_install_guide.py` — 플랫폼별 UA override 검증

## 향후 재검토 조건

- 설치율이 낮게 측정되면 → 재방문 N회 후 1회 배너(닫기 기억) 도입 검토
- 실기기 스크린샷 확보 시 → SVG 플레이스홀더를 사진 기반 가이드로 교체
- iOS 18+에서 `apple-app-site-association`/Smart App Banner 정책이 PWA까지 확장되면 → 별도 분기 추가
- `navigator.userAgentData` 브라우저 보급률이 충분해지면 → UA 문자열 파싱 → UA-CH 전환
