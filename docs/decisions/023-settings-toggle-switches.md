# ADR-023: 설정 패널 상위 4개 옵션 — OS별 네이티브 토글 스위치

- 일시: 2026-05-29
- 상태: 승인됨 — 구현 완료
- 관련 ADR: ADR-005(설정 UI 세그먼트 컨트롤 도입 맥락), ADR-018(`js/app/settings-ui.js` 위치), ADR-022(인용·주석 표시 토글)

## 맥락

설정 패널 상위 4개 옵션(시작 화면 · 외경 배치 · 인용·주석 표시 · 오디오북)은
각각 양쪽 상태를 모두 명시하는 **2분할 세그먼트 컨트롤**(`.btn-group` +
`.toolbar-btn[aria-pressed]`)로 렌더되고 있었다(예: `읽던 곳 | 첫 페이지`).

이 네 항목은 모두 **boolean 설정**(켜짐/꺼짐)이다. 세그먼트 컨트롤은 세 개 이상의
선택지(테마 `라이트 | 시스템 | 다크`, 글자 크기 `A- | A | A+`)에는 적합하지만,
2분할 boolean 에는 토글 스위치가 모바일 OS 관행에 더 부합하고 한 눈에 상태를
읽기 쉽다. 패널을 사용하는 주 환경이 iOS/Android PWA 인 점을 고려해, 각 OS의
네이티브 룩(iOS UISwitch / Android Material 3 Switch)으로 렌더한다.

세 개 이상 선택지인 하위 항목(글자 크기 · 테마 · 색상)과 액션 행(앱 설치 ·
백업&동기화 · 업데이트 · 캐시)은 **변경하지 않는다**.

## 결정

### 1. 재사용 컴포넌트 — `makeToggleRow`

`js/app/settings-ui.js` 에 라벨·캡션·상태키를 인자로 받는 단일 팩토리
`makeToggleRow({ labelText, checked, onToggle, getCaption? })` 를 두고, 네 옵션이
이를 호출한다. 반환 구조:

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

- 토글은 상태를 **제자리에서** 갱신한다 — 세그먼트 컨트롤이 하던 `rebuild()`
  전체 재렌더를 호출하지 않으므로 포커스가 스위치에 유지된다. (외경 토글만
  본문 재렌더가 필요해 `route()` 는 그대로 호출하되 팝오버는 재구축하지 않음.)

### 2. 라벨·상태 매핑 (하위호환)

기존 localStorage 키·값을 **그대로 재사용**하고 토글 ON/OFF ↔ 값만 매핑한다.

| 라벨(신규)        | 키                  | ON          | OFF        | 캡션                       |
| ----------------- | ------------------- | ----------- | ---------- | -------------------------- |
| 읽던 페이지에서 시작 | `bible-startup`     | `resume`    | `home`     | 없음                       |
| 외경           | `bible-book-order`  | `vulgate`   | `canonical`| **동적**: 구약에 포함 / 별도 섹션에 표시 |
| 인용·주석 표시    | `bible-cite-show`   | `1`(true)   | `0`(false) | 없음                       |
| 오디오북          | `bible-audio-show`  | `1`(true)   | `0`(false) | 없음                       |

기본값은 storage.js 의 기존 로더가 그대로 결정(시작=resume, 외경=canonical,
인용=ON, 오디오=ON). 라벨 텍스트는 외경→"외경", 시작 화면→"읽던 페이지에서
시작", 인용 본문·주석→"인용·주석 표시" 로 다듬었으나 저장 값은 불변.

외경 캡션은 **항상 표시**하고 상태에 따라 문구만 교체한다. 두 문구 모두 한 줄
글꼴에 들어가고 `min-height: 1.3em` 으로 한 줄 높이를 고정해 토글 시 layout shift 가
없다.

### 3. OS 감지 + 네이티브 스타일

`detectOS()` 가 `navigator` 로 iOS(iPhone/iPad/iPod 또는 iPadOS 위장:
`platform === "MacIntel" && maxTouchPoints > 1`) 와 그 외(Material 기본값)를
구분해 `<html>` 에 `.os-ios` / `.os-android` 클래스를 부여하고, CSS 가 분기한다.
install.js 의 `detectPlatform()` 과 별도 — 그쪽은 standalone 일 때 `"installed"`
를 반환하지만 토글 룩은 설치 여부와 무관하게 네이티브 OS 를 따라야 하기 때문.

- **iOS (UISwitch)**: 51×31 알약 트랙, 27px 흰 썸 + 그림자, 20px 슬라이드.
- **Android (Material 3)**: 52×32 윤곽선 트랙, OFF 16px 작은 썸 → ON 24px 큰
  흰 썸 + 채워진 트랙, 썸 크기·위치 트랜지션.

### 4. 색상·테마 연동

ON 상태 채움은 새 색을 만들지 않고 기존 `--accent`(색상 스킴 4종 + 라이트/다크
파생)를 그대로 쓴다. OFF 트랙 색만 신규 변수로 분리:
`--switch-off-track`(iOS), `--switch-m3-off-track`·`--switch-m3-outline`·
`--switch-m3-off-thumb`(Material). 다크에서 OFF 트랙이 `--bg-card` 에 묻히지
않도록 패널보다 밝은 값을 사용.

### 5. 접근성

- `<input type="checkbox" role="switch">` — checked ↔ aria-checked 자동 매핑.
- 명시적 `aria-label`(라벨 텍스트)로 접근 이름을 고정하고, 캡션은
  `aria-describedby` 로 연결(캡션이 이름에 섞이지 않도록).
- `<label>` 이 텍스트·스위치를 모두 감싸 **행 전체가 탭 타깃**.
- 키보드: 포커스 가능 + Space(네이티브) + Enter(`keydown` 핸들러로 보강,
  switch role 관행).
- 포커스 링은 `:focus-visible + .switch-track` 로 트랙에 그린다.
- `prefers-reduced-motion: reduce` 에서 트랜지션 제거.

## 대안

- **세그먼트 컨트롤 유지**: boolean 에는 토글이 더 직관적이고 모바일 관행에 부합.
- **단일 OS-중립 토글 룩**: 네이티브 룩이 사용자에게 더 익숙하고 학습 비용이 낮음.
  CSS 분기 비용은 작음.
- **`role="switch"` div(커스텀)**: 네이티브 checkbox 가 Space·label 연결·폼
  시맨틱을 무료로 제공하므로 채택하지 않음.

## 구현

- `js/app/settings-ui.js` — `detectOS()`, `makeToggleRow()`, 섹션 1 네 행을
  토글로 교체.
- `css/style.css` — `--switch-*` 변수(라이트/다크) + `.settings-toggle-*` /
  `.switch*` / `.os-ios` / `.os-android` 스타일.
- `tests/e2e/test_settings.py` — 시작 화면·외경 테스트를 `role="switch"` +
  `is_checked()` 기반으로 갱신(로컬 전용).

바닐라 JS/CSS, 빌드 단계 0(ADR-019). 셸 자산(js/css) 변경이므로 다음 릴리스
`release.py` 가 SHELL_CACHE 를 자동 무효화(ADR-021).
