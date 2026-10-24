# ADR-023: 설정 패널 상위 4개 옵션 — OS별 네이티브 토글 스위치

- 일시: 2026-05-29
- 상태: 승인됨 — 구현 완료
- 관련 ADR: ADR-005(설정 UI에 세그먼트 컨트롤을 들인 맥락), ADR-018(`js/app/settings-ui.js` 위치), ADR-022(인용·주석 표시 토글), ADR-029(모바일 설정 탭 화면)

## 맥락

설정 패널 상위 4개 옵션(시작 화면, 외경 배치, 인용·주석 표시, 오디오북)은 양쪽 상태를 모두 보여 주는 **2분할 세그먼트 컨트롤**(`.btn-group` + `.toolbar-btn[aria-pressed]`)로 그리고 있었다(예: `읽던 곳 | 첫 페이지`).

이 네 항목은 모두 켜고 끄는 **boolean 설정**이다. 세그먼트 컨트롤은 선택지가 셋 이상일 때(테마 `라이트 | 시스템 | 다크`, 글자 크기 `A- | A | A+`) 알맞다. 둘 중 하나를 고르는 boolean에는 토글 스위치가 모바일 OS 관행에 더 맞고, 상태를 한눈에 읽기도 쉽다. 패널을 주로 쓰는 환경이 iOS/Android PWA이므로, OS마다 그 OS의 네이티브 모양(iOS UISwitch / Android Material 3 Switch)으로 그린다.

선택지가 셋 이상인 아래쪽 항목(글자 크기, 테마, 색상)과 동작 행(앱 설치, 백업&동기화, 업데이트, 캐시)은 **바꾸지 않는다**.

## 결정

### 1. 다시 쓰는 컴포넌트 — `makeToggleRow`

`js/app/settings-ui.js`에 라벨, 캡션, 상태를 인자로 받는 팩토리 하나 `makeToggleRow({ labelText, checked, onToggle, getCaption? })`를 두고, 네 옵션이 이것을 호출한다. 돌려주는 구조는 다음과 같다.

```
<div class="settings-row settings-toggle-row">
  <label class="settings-toggle-label">       ← 행 전체가 탭 타깃
    <div class="settings-toggle-text">
      <span class="settings-label">…</span>
      <span class="settings-toggle-caption" id="…">…</span>  ← getCaption 있을 때만
    </div>
    <span class="switch">
      <input type="checkbox" role="switch" aria-label="…" aria-describedby="…">
      <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
    </span>
  </label>
</div>
```

- 토글은 상태를 **제자리에서** 고친다. 세그먼트 컨트롤처럼 `rebuild()`로 전체를 다시 그리지 않으므로 포커스가 스위치에 남는다. 외경 토글만 본문을 다시 그려야 해서 `route()`를 그대로 호출하지만, 팝오버는 다시 만들지 않는다.
- 모바일에서는 설정 탭 화면(ADR-029)도 같은 행을 그린다(`renderSettingsView`).

### 2. 라벨과 상태의 대응 (하위 호환)

기존 localStorage 키와 값을 **그대로 다시 쓰고**, 토글의 ON/OFF를 그 값에 대응시키기만 한다.

| 라벨(신규)        | 키                  | ON          | OFF        | 캡션                       |
| ----------------- | ------------------- | ----------- | ---------- | -------------------------- |
| 읽던 페이지에서 시작 | `bible-startup`     | `resume`    | `home`     | 없음                       |
| 외경           | `bible-book-order`  | `vulgate`   | `canonical`| **상태에 따라 바뀜**: 구약에 포함 / 별도 섹션에 표시 |
| 인용·주석 표시    | `bible-cite-show`   | `1`(true)   | `0`(false) | 없음                       |
| 오디오북          | `bible-audio-show`  | `1`(true)   | `0`(false) | 없음                       |

기본값은 storage.js의 기존 로더가 그대로 정한다(시작=resume, 외경=canonical, 인용=ON, 오디오=ON). 라벨 텍스트는 다듬었지만(외경 배치는 「외경」, 시작 화면은 「읽던 페이지에서 시작」, 인용 본문·주석은 「인용·주석 표시」) 저장 값은 그대로다.

외경 캡션은 **늘 보이고**, 상태에 따라 문구만 바꾼다. 두 문구 모두 한 줄에 들어가고 `min-height: 1.3em`으로 한 줄 높이를 고정해, 토글할 때 레이아웃이 밀리지 않는다(layout shift 없음).

### 3. OS 감지와 네이티브 스타일

`detectOS()`가 `navigator`로 OS를 셋으로 나누고, `<html>`에 `.os-ios` / `.os-android` / `.os-desktop` 클래스를 붙인다. CSS가 이 클래스로 모양을 나눈다.

- iOS: iPhone/iPad/iPod이거나, iPad인데 Mac으로 보이는 경우(`platform === "MacIntel" && maxTouchPoints > 1`)다.
- 데스크톱: 마우스처럼 정밀한 포인터가 있는 경우(`(pointer: fine)`)다. 터치 화면이 달린 노트북도 마우스가 있으므로 데스크톱으로 나눈다.
- Android: 그 밖의 경우다(Material 기본값).

install.js의 `detectPlatform()`과는 따로 둔다. 그쪽은 standalone일 때 `"installed"`를 돌려주지만, 토글 모양은 설치 여부와 상관없이 실제 OS를 따라야 하기 때문이다.

- **iOS (UISwitch)**: 51×31 알약 트랙, 27px 흰 썸과 그림자, 20px 이동.
- **Android (Material 3 Expressive)**: 52×32 트랙에 1.5px 윤곽선, 두 상태 모두 22px 원형 썸, 살짝 튀는 스프링 같은 이동. ON이면 썸이 흰색이 된다.
- **데스크톱**: 52×32 트랙에 얇은 윤곽선, 두 상태 모두 같은 크기(20px)의 썸, 옅은 그림자. ON이면 트랙을 `--accent`로 채운다.

### 4. 색상과 테마

ON 상태는 새 색을 만들지 않고 기존 `--accent`(색상 스킴 4종과 라이트/다크에서 만든 색)를 그대로 쓴다. OFF 상태의 색만 새 변수로 뺀다: `--switch-off-track`(iOS), `--switch-desktop-off-track`·`--switch-desktop-outline`(Android와 데스크톱의 OFF 트랙과 데스크톱 윤곽선), `--switch-m3-outline`·`--switch-m3-off-thumb`(Material 윤곽선과 OFF 썸). 다크 모드에서 OFF 트랙이 `--bg-card`에 묻히지 않도록 패널보다 밝은 값을 쓴다.

### 5. 접근성

- `<input type="checkbox" role="switch">`: checked가 aria-checked로 저절로 이어진다.
- 명시적 `aria-label`(라벨 텍스트)로 접근 이름을 고정하고, 캡션은 `aria-describedby`로 잇는다(캡션이 이름에 섞이지 않게).
- `<label>`이 텍스트와 스위치를 함께 감싸 **행 전체가 탭 타깃**이다.
- 키보드: 포커스를 받을 수 있고, Space(네이티브)와 Enter(`keydown` 핸들러로 더함, switch role의 관행)로 바꾼다.
- 포커스 링은 `:focus-visible + .switch-track`으로 트랙에 그린다.
- `prefers-reduced-motion: reduce`에서는 트랜지션을 없앤다.

## 대안

- **세그먼트 컨트롤 유지**: boolean에는 토글이 더 직관적이고 모바일 관행에 맞는다.
- **OS와 상관없는 토글 모양 하나**: 네이티브 모양이 사용자에게 더 익숙해 따로 익힐 것이 적다. CSS를 나누는 비용은 작다.
- **`role="switch"` div(직접 만든 것)**: 네이티브 checkbox가 Space, label 연결, 폼 의미를 그냥 주므로 채택 안 함.
- **처음의 OS 둘 구분과 Material 3 썸 크기 변화 (2026-05-30까지)**: 처음에는 iOS와 그 밖(Material)의 둘로만 나눴다. Material은 52×32 윤곽선 트랙에 OFF 16px 작은 썸이 ON 24px 큰 흰 썸으로 커지며 트랙을 채웠다. OFF 트랙 색은 `--switch-m3-off-track`(Material)으로 따로 두었다. 채택 안 함 2026-05-30(#153) · 이유: 설정 토글을 다시 다듬으면서, 마우스를 쓰는 환경에 맞는 데스크톱 모양을 따로 두고(`.os-desktop`), Android는 Material 3 Expressive(Android 16 QPR1, 2025-09)를 따라 썸 크기를 고정했다. OFF 트랙 회색은 `--switch-desktop-off-track` 하나로 모으고, 쓰지 않게 된 `--switch-m3-off-track`은 지웠다.

## 구현

- `js/app/settings-ui.js`: `detectOS()`, `makeToggleRow()`, 섹션 1의 네 행을 토글로 바꿈.
- `css/style.css`: `--switch-*` 변수(라이트/다크)와 `.settings-toggle-*` / `.switch*` / `.os-ios` / `.os-android` 스타일. 2026-05-30에 `.os-desktop`을 더했다.
- `tests/e2e/test_settings.py`: 시작 화면과 외경 테스트를 `role="switch"`와 `is_checked()`로 확인하게 고침(로컬 전용).

바닐라 JS/CSS이고 빌드 단계 0이다(ADR-019). 셸 자산(js/css)이 바뀌므로 다음 릴리스에서 `release.py`가 SHELL_CACHE를 자동으로 무효화한다(ADR-021).
