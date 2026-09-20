---
date: 2026-06-11
pr: 285
branch: fix/e2e-headless-robustness
title: "test: e2e 헤드리스 견고성 보강 — 대기·SW·설치 너지·앱 동작 맞춤"
---

# test: e2e 헤드리스 견고성 보강 — 대기·SW·설치 너지·앱 동작 맞춤

헤드리스 chromium 에서 멈추거나 실패하던 e2e 묶음을 원인별로 해소. 모두 앱 코드
회귀가 아니라 테스트 환경·상호작용 문제다. (베이스: `release/1.6.4`)

세 커밋, 성격별 분리:

1. **헤드리스 대기·SW 간섭** (`462534c`)
   - `wait_app_ready`: `#search-input` 가시 → attached 대기 (모바일은 헤더가
     `display:none` 이라 가시 대기가 무한 타임아웃).
   - tabbar 모핑: 모핑 후 `#tab-search` 가 숨으므로 `aria-current` 검사를 attached 로.
   - 캐시 비우기: `service_workers="block"` + reload 센티넬 대기 (SW unregister 가
     헤드리스에서 resolve 안 돼 멈추던 문제).

2. **앱 실제 동작에 맞춤** (`eafdcfe`) — 헤드리스 무관, headed 로도 동일 실패
   - settings 책순서: 토글이 `route()` 로 팝오버를 닫는 실제 동작에 맞춰 재오픈 후 검증.
   - folder 토글: 행 중심이 액션 버튼에 가려 center-click 이 토글에 안 닿음 →
     `.bm-folder-name` 클릭으로 변경.

3. **설치 권유 너지 억제** (`564d5a2`) — 탭바 실패의 진짜 원인
   - `maybeShowInstallNudge` 기본 상태(`{visits:0, nextShow:1}`)가 첫 방문에 발동 →
     `#install-scrim` 이 탭바를 덮어 `#tab-search` 클릭을 가로채 8건 타임아웃.
   - `CLEAR_APP_STORAGE` 에 `neverShow` 너지 상태를 심어 억제. 일부 북마크 테스트가
     파일별로 직접 심던 우회를 중앙화(그 우회들은 중복·무해, 후속 정리 대상).

## 검증 (로컬, http://localhost:8080)
- `test_tabbar.py` 11 통과 (이전 8건 타임아웃 30s+ → 전체 22s)
- `test_install_guide.py` 19 통과 (너지 표시 테스트는 자체 init 사용, 영향 없음)
- `test_settings.py`·`test_bookmark_folders.py`·`test_search.py` 통과
- 유닛/tsc 는 본 변경(e2e 전용)과 무관 — CI Unit tests 로 확인

> 발견 기록: 처음엔 `aria-current` 변경이 tabbar 모핑 실패를 고친다고 봤으나,
> 실제 원인은 클릭을 가로막던 설치 너지 오버레이였다. `aria-current` 변경은 클릭
> 성공 이후 단계라 단독으론 부족했고(커밋 3에 상세), 너지 억제와 함께여야 통과한다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Changes are confined to Playwright e2e tests and fixtures; production behavior is unchanged.
> 
> **Overview**
> E2E-only hardening for headless Chromium and flaky interactions—no application code changes.
> 
> **Centralized install nudge suppression:** `CLEAR_APP_STORAGE` now seeds `bible-install-nudge` with `neverShow: true` after wiping keys, so the first-visit `#install-scrim` no longer blocks tab-bar clicks. Per-file `_PIN_NUDGE` / `SUPPRESS_INSTALL_NUDGE` init scripts were removed from bookmark tests.
> 
> **Wait semantics:** `wait_app_ready` waits for `#search-input` with `state="attached"` (mobile hides the header search bar). Tab-bar search morphing asserts `#tab-search[aria-current='page']` as attached when the control is hidden during morph.
> 
> **Settings & cache:** 외경 toggles re-open settings after `route()` closes the popover and use `wait_for_function` on `localStorage`. Cache-clear uses `service_workers="block"` and a reload sentinel instead of `expect_navigation()`.
> 
> **Interaction fixes:** Folder expand/collapse tests click `.bm-folder-name` instead of `.bm-folder-row` so Playwright does not hit overlay action buttons.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 9848cee364c6d5f6d7a5f37e039326ce8c5420ae. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
