---
date: 2026-05-30
pr: 153
branch: style/toggle-navy-refresh
title: "설정 토글 다듬기 + 네이비 테마 재선정"
---

# 설정 토글 다듬기 + 네이비 테마 재선정

## Summary

**토글 재단장**
- 데스크탑(`os-desktop` 신규 감지): 얇은 outline·균등 thumb·미세한 그림자.
- Android(`os-android`): M3 Expressive(Android 16 QPR1) 스타일 1.5px outline + 22px 원형 thumb + 스프링 슬라이드.
- OFF 트랙 회색을 데스크탑·Android 양쪽 동일 토큰(`--switch-desktop-off-track`)으로 통일.
- 터치스크린 Windows 노트북도 `(pointer: fine)` 만으로 desktop 분류 (기존엔 `maxTouchPoints === 0` 게이트 때문에 Android 로 오분류).
- `prefers-reduced-motion` 가 `.os-android`/`.os-desktop` thumb transition 도 정지하도록 selector specificity 보정.

**테마 색상 재정비**
- Navy accent 를 앱 아이콘 (`#1a1a2e`) 계열로 재선정. 본문 텍스트와의 동일색 충돌 방지 위해 살짝 lift 한 `#22244a` 채택. accent-light·verse-num·paragraph-mark·설정 swatch 도 같은 인디고 계열로 동기화.
- 버건디(`terracotta`) 를 교회력 적색(`red`, light `#a01828` / dark `#e08090`) 으로 교체. 기존 사용자는 `loadColorScheme()` 마이그레이션 한 줄로 자동 전환.
- 다크 모드 `--bg` 를 `#1a1a2e` → `#1f1f36` 으로 얕게 lift (아이콘 family 유지, 묵직함 감소). theme-color 메타·런타임 override·`privacy.html` 인라인까지 동기화.

**기타**
- 설정 팝오버 배경을 본 화면 배경(`var(--bg-card)` → `var(--bg)`)에 맞춰 통일.
- `CLAUDE.md` 에 main 브랜치 보호·PR 작업 흐름 안내 추가 (2026-05-29 적용).
- 미사용 CSS 변수 `--switch-m3-off-track` 제거.

## Test plan

- [x] 유닛 테스트 536 케이스 통과 (`node --test tests/unit/*.test.js`) — terracotta→red 마이그레이션 케이스 +1
- [x] 타입 체크 통과 (`npx tsc -p tsconfig.json --noEmit`)
- [x] dev.anglican.kr 에 배포해 데스크탑 Chrome 토글·테마 색 시각 확인
- [x] Pixel 7 디바이스 에뮬레이션으로 Android M3E 룩 확인 (OFF 트랙 회색 통일·원형 thumb·스프링 모션)
- [ ] 실기기(iOS UISwitch / Android Material / 터치 노트북) 한 번씩 더 확인
- [ ] 다크 모드 `--bg` lift 가 OLED 가 아닌 디스플레이에서 체감 개선 효과 있는지 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Visual and preference-storage changes only; terracotta→red migration is defensive across localStorage, Drive restore, and privacy.html with unit test coverage.
> 
> **Overview**
> This PR polishes **settings toggles** and **theme colors**, and documents the protected **`main`** workflow in `CLAUDE.md`.
> 
> **Settings toggles** add a **`os-desktop`** path (via `(pointer: fine)` so touch Windows laptops are not treated as Android), with dedicated CSS for thin-outline desktop switches. **Android** toggles move toward Material 3 Expressive (22px thumb, spring slide); OFF-track grays are unified via **`--switch-desktop-off-track`**. **`prefers-reduced-motion`** now disables thumb transitions on Android/desktop too.
> 
> **Theme**: default navy accent shifts to **`#22244a`** (icon-family indigo); dark **`--bg`** lifts to **`#1f1f36`** with **`theme-color`** and critical CSS aligned (splash/html background stays **`#1a1a2e`**). The **`terracotta`** scheme becomes **`red`** with **`loadColorScheme`**, **`applyColorScheme`**, and **`privacy.html`** mirroring migration for legacy stored values and Drive restore. The settings popover uses **`var(--bg)`**; dark mode adds a faint ring on color swatches.
> 
> Tests/types/docs: **`ColorSchemeId`** and unit tests updated for **`red`** + migration case.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 0be8cf3a8e21a498ac7b2a7aa45e1e25a1be004d. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
