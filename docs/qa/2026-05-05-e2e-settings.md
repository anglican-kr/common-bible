# E2E 테스트 보고서: Phase 3 — 설정 도메인

**날짜:** 2026-05-05
**범위:** Phase 3 — 시작 화면, 책 순서, 글자 크기, 테마, 색상 스킴, 캐시 초기화, 영속성
**작성자:** Joshua Huh

## 1. 실행 환경

| 항목 | 값 |
|------|----|
| Python | 3.12.12 |
| pytest | 9.0.2 |
| pytest-playwright | 0.7.2 |
| Chromium | 145.0.7632.6 |

## 2. 실행 결과

| 항목 | 값 |
|------|----|
| 신규 테스트 | 13건 |
| 전체 e2e 테스트 | 114건 |
| 통과 | 114건 |
| 실패 | 0건 |
| 소요 시간 | 약 236초 |

```
114 passed in 236.01s (0:03:56)
```

## 3. 신규 시나리오 (`tests/e2e/test_settings.py`)

| 테스트 | 검증 내용 |
|--------|---------|
| `test_startup_home` | "첫 페이지" 클릭 → `bible-startup=home`, `aria-pressed` 업데이트 |
| `test_startup_resume` | "읽던 곳" 클릭 → `bible-startup=resume` |
| `test_book_order_vulgate` | "구약에 포함" 클릭 → `bible-book-order=vulgate`, `aria-pressed` 업데이트 |
| `test_book_order_canonical` | vulgate → 분리 전환 → `bible-book-order=canonical` |
| `test_font_size_increase` | A+ 클릭 → `bible-font-size=20`, `fontSize=20px` |
| `test_font_size_decrease` | A- 클릭 → `bible-font-size=16` |
| `test_font_size_reset` | A 클릭 → 기본값(18px) 복원, 초기화 버튼 비활성화 |
| `test_theme_dark` | "다크" 클릭 → `bible-theme=dark`, `html[data-theme=dark]` |
| `test_theme_light` | "라이트" 클릭 → `bible-theme=light`, `html[data-theme=light]` |
| `test_color_scheme_green` | 초록 swatch 클릭 → `bible-color-scheme=green`, `html[data-color-scheme=green]` |
| `test_color_scheme_navy_removes_attribute` | 네이비(기본) 선택 시 `data-color-scheme` 속성 자체 제거 |
| `test_cache_clear_removes_caches` | 캐시 비우기 클릭 → reload 후 `e2e-test` 캐시 삭제 확인 |
| `test_settings_persist_after_reload` | 다크+20px 저장 → reload → `data-theme=dark`, `fontSize=20px` |

## 4. 발견된 이슈 / 중요 발견

| # | 위치 | 내용 |
|---|------|------|
| 1 | `clearAllCaches()` ([js/app.js:210](js/app.js#L210)) | `navigator.onLine` 체크 + `confirm()` 대화상자 + `location.reload()`를 포함. 테스트에서 `window.confirm = () => true` 패치, `expect_navigation()` 컨텍스트 매니저로 reload 완료를 기다림. |
| 2 | `service_workers="block"` | 해당 모드에서 `navigator.serviceWorker.getRegistration()`이 예외를 던져 catch block → alert → reload 없음. 캐시 초기화 테스트는 SW 허용 context에서 진행. |
| 3 | `add_init_script` reload 재실행 | init_script는 `page.reload()` 시에도 재실행됨 → 영속성 테스트에서 `evaluate(CLEAR_APP_STORAGE)` 방식으로 초기화해 reload 시 재초기화 방지. |

## 5. 비고

- `get_by_role("button", name=...)` 호출 시 scope를 `open_settings(page)` 반환 locator로 제한해 전역 버튼과 충돌 방지.
- 캐시 비우기 시 SW가 자신의 캐시(rev-43, fonts-v1)를 reload 후 재생성하지만, e2e-test 캐시는 재생성되지 않아 검증 가능.
