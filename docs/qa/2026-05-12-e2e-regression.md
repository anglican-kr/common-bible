# E2E 테스트 보고서: 2026-05-12 회귀 점검

**날짜:** 2026-05-12
**범위:** 전체 e2e 173건 재실행 + 모듈 분할·기능 추가 이후 누적된 깨진 테스트 수선
**작성자:** Joshua Huh

## 1. 한눈 요약

- **결과:** 173건 전수 통과 (실패 0, 스킵 0), 약 6분 33초 소요
- **수선 대상:** 시작 시점 18건 실패 (a11y 3, 모달 a11y/키보드 3, 북마크 1, 내보내기 5, PKCE 4, 오디오 1, 검색 1) + 재실행 중 드러난 오디오 플레이어 회귀 5건
- **원인 분포:**
  - **테스트가 옛 전역 함수 이름을 호출 (8건)** — `app.js` 9개 모듈 분할(ADR-018) 이후 `openSaveModal` / `exportBookmarks` / `_currentBookId` 같은 이름이 모듈 내부로 들어갔다. 새 진입점(버튼 클릭, `window.readingContext`) 으로 갈아끼움
  - **테스트가 비동기 전이 완료 전에 상태를 읽음 (4건)** — PKCE 콜백 실패 → 상태머신 `NEEDS_CONSENT` 정착은 마이크로태스크 한 단계 뒤. URL 정리 시점이 아니라 상태 자체를 폴링하도록 변경
  - **테스트가 오디오 에러 리스너에 휘말림 (6건)** — 빈 바디 응답이 chromium 에서 `error` 이벤트를 즉시 발화 → `_teardownAudio()` 가 컨트롤을 통째로 떼어 버려 후속 단언이 timeout. `HTMLAudioElement.addEventListener('error', …)` 등록을 init script 에서 차단해 바를 살린다
  - **테스트가 비동기 렌더링 끝 전에 단언 (1건)** — `runSheetSearch` 가 onPartial 콜백으로 결과를 증분 렌더링. 첫 항목이 보이자마자 단언하면 뒤따라 오는 최종 렌더가 cleanup 을 덮어쓴다. 로딩 사라짐 + a11y announce 발화까지 대기 추가
  - **실제 a11y 회귀 1건 (앱 코드 수정)** — `#search-input` / `#search-sheet-input` 에 `aria-autocomplete` / `aria-controls` / `aria-expanded` 만 있고 `role="combobox"` 가 없어 axe-core critical 발화. 검색 히스토리 기능(ADR-014) 도입 시 빠진 속성을 보충

## 2. 실행 환경

| 항목 | 값 |
|------|----|
| Python | 3.12.12 |
| pytest | 9.0.2 |
| pytest-playwright | 0.7.2 |
| Chromium | 145.0.7632.6 |
| axe-playwright-python | 0.1.7 |
| 개발 서버 | `python3 scripts/serve.py 8080` |

## 3. 실행 결과

| 단계 | 통과 | 실패 | 비고 |
|------|------|------|------|
| 시작 시점 | 155 | 18 | 모듈 분할 + 기능 추가 누적 |
| 수선 1차 후 | 168 | 5 | 오디오 컨트롤 race 드러남 |
| 수선 2차 후 | **173** | **0** | 전수 통과 |

총 소요 시간: 약 393초.

## 4. 카테고리별 수선 내역

### 4.1 모듈 분할로 사라진 전역 (테스트 8건)

ADR-018 분할 이후 `app.js` 내부 함수들은 `js/app/*.js` 모듈 안에 갇혔다. 테스트가 `window.openSaveModal()` 처럼 직접 호출하는 패턴은 모두 깨진다.

| 테스트 | 옛 호출 | 새 트리거 |
|--------|---------|----------|
| `test_a11y_axe.py::test_a11y_bm_save_modal` | `page.evaluate("openSaveModal('chapter')")` | `#bm-save-chapter-btn` 클릭 |
| `test_a11y_keyboard.py::test_escape_closes_bm_save_modal` | 동일 | 동일 |
| `test_a11y_keyboard.py::test_focus_trap_in_bm_save_modal` | 동일 | 동일 |
| `test_bookmark.py::test_select_verses_button_preserves_chapter_after_drawer_close` | `_currentBookId` / `_currentChapter` / `_verseSelectMode` | `window.readingContext.{bookId,chapter,verseSelectMode}` |
| `test_bookmark_export_import.py` 내보내기 5건 | `exportBookmarks()` | `#bm-overflow-btn` 열고 `#bm-export-btn` 클릭 (오버플로 메뉴로 이전됨) |

내보내기 인터셉트 헬퍼는 Blob 생성자 후킹은 그대로 두되, 호출 트리거만 버튼 클릭으로 바꿔 행위(=다운로드 동작) 그대로 검증한다.

### 4.2 비동기 PKCE 전이 race (테스트 4건)

`test_pkce_callback_state_mismatch_rejected` / `_error_param_rejected` (desktop + iOS 변종, 합 4건).

옛 코드:
```python
page.wait_for_function("() => location.search === ''")
assert page.evaluate("window.driveSync.getStatus()") == "NEEDS_CONSENT"
```

콜백 IIFE 가 URL 을 정리하는 시점과 상태머신이 `DISABLED → NEEDS_CONSENT` 로 전이하는 시점이 다르다. 후자는 `_machine.enable() → _attemptSilentRefresh() → (no refresh token) → _transition(NEEDS_CONSENT)` 의 async 체인으로 약 100ms 뒤에 정착한다. URL 정리만 기다리면 9 / 10 회 race 패배.

새 코드:
```python
page.wait_for_function("() => location.search === ''")
page.wait_for_function(
    "() => window.driveSync.getStatus() === 'NEEDS_CONSENT'",
    timeout=5_000,
)
```

### 4.3 오디오 에러 리스너로 인한 컨트롤 소실 (테스트 6건)

`test_audio_controls.py` 6 중 5 건. `_open(browser)` 가 `**/data/audio/**` 를 200 + 빈 바디로 응답시킨다. chromium 은 디코드 실패로 `error` 이벤트를 발화하고, `views-routing.js` 의 핸들러가 `_teardownAudio() → showAudioUnavailable()` 로 컨트롤을 모두 떼어 낸다. 테스트가 `.audio-speed-btn`, `.audio-play-btn`, `.audio-progress` 를 찾으려 하면 30초 timeout.

수선: init script 에서 `HTMLAudioElement.prototype.addEventListener` 를 후킹해 `'error'` 등록을 차단한다. `error` → unavailable 전이 자체를 검증하는 테스트는 `test_audio.py` 로 분리돼 있으므로 이쪽만 적용해도 커버리지 손실 없음.

```js
const origAdd = HTMLAudioElement.prototype.addEventListener;
HTMLAudioElement.prototype.addEventListener = function(type, listener, opts) {
    if (type === 'error') return;
    return origAdd.call(this, type, listener, opts);
};
```

(이전에는 1차 실행에서 race 가 잠재해 5건이 우연히 통과하던 상태였다. 수선 1차 후 재실행에서 한꺼번에 드러나 일관성 있게 잡혔다.)

### 4.4 검색 증분 렌더링 race (테스트 1건)

`test_search.py::test_mobile_focus_in_expanded_reverts_to_compact`.

`runSheetSearch` 는 비동기로 `onPartial` 콜백을 여러 번 호출해 결과를 증분 렌더링한 뒤 마지막에 `renderSearchResultList` 로 최종 결과를 채운다. 첫 항목이 등장하자마자 input.focus() 를 호출하면, 포커스 핸들러의 `clearNode($searchSheetResults)` 는 잘 동작하지만 그 직후 await 가 풀린 본체가 결과를 다시 채워 단언이 5건을 발견한다.

수선: 로딩 placeholder 가 detach 되고 `a11y-announce` 에 "검색 결과 N건" 문구가 뜨는 시점까지 대기 후 포커스.

### 4.5 실제 a11y 회귀 (앱 코드 1건)

`test_a11y_axe.py::test_a11y_home_books_list` / `_chapter_text` / `_search_results` 3건이 `axe-core critical: aria-allowed-attr` 로 실패.

원인: ADR-014 검색 히스토리 기능을 도입할 때 `<input type="search">` 에 `aria-autocomplete="list"`, `aria-controls="search-history"`, `aria-expanded="false"` 를 추가했지만, 이 속성들은 `combobox` role 에서만 허용된다. 입력 요소의 native role 인 `searchbox` 에서는 위반.

수선 (`index.html` 117, 154행, 헤더 + 모바일 시트 양쪽):

```html
<input id="search-input" type="search"
       role="combobox" aria-autocomplete="list"
       aria-controls="search-history" aria-expanded="false" ...>
```

ARIA 1.2 combobox 패턴에 맞게 정정. axe-core 4.11 critical 위반 0건으로 복귀.

## 5. 카테고리별 결과 매트릭스

| 카테고리 | 시작 실패 | 수선 후 | 비고 |
|----------|----------|--------|------|
| a11y axe-core | 3 | 0 | combobox role 보충 |
| a11y axe-core (modal) | 1 | 0 | 버튼 클릭으로 전환 |
| a11y keyboard (modal) | 2 | 0 | 버튼 클릭으로 전환 |
| 북마크 verse-select | 1 | 0 | readingContext 전환 |
| 북마크 export | 5 | 0 | 버튼 클릭으로 전환 |
| PKCE state mismatch / error | 4 | 0 | 상태 폴링 추가 |
| 오디오 컨트롤 race | 1+5 | 0 | error 리스너 차단 |
| 검색 모바일 포커스 race | 1 | 0 | 검색 완료 대기 |

## 6. 수정된 앱 코드

| # | 파일 | 변경 | 사유 |
|---|------|------|------|
| 1 | `index.html` (117행) | `<input id="search-input">` 에 `role="combobox"` 추가 | ARIA 1.2 — `aria-autocomplete`/`aria-controls`/`aria-expanded` 는 combobox 한정 |
| 2 | `index.html` (154행) | `<input id="search-sheet-input">` 동일 | 동일 (모바일 시트) |

## 7. 수정된 테스트 코드

| 파일 | 변경 골자 |
|------|-----------|
| `tests/e2e/test_a11y_axe.py` | save modal 트리거를 `#bm-save-chapter-btn` 클릭으로 |
| `tests/e2e/test_a11y_keyboard.py` | 동일 (escape·focus trap 2건) |
| `tests/e2e/test_bookmark.py` | `_currentBookId` 등 → `window.readingContext.*` |
| `tests/e2e/test_bookmark_export_import.py` | `exportBookmarks()` 호출 → 오버플로 메뉴 → 내보내기 버튼 클릭 |
| `tests/e2e/test_drive_sync.py` | PKCE 실패 → `NEEDS_CONSENT` 폴링 (2건) |
| `tests/e2e/test_drive_sync_ios.py` | 동일 (2건) |
| `tests/e2e/test_audio_controls.py` | `_open` 에 `_SUPPRESS_AUDIO_ERROR` init script 추가 |
| `tests/e2e/test_search.py` | 검색 완료 대기 후 포커스로 변경 |

## 8. 운영 관찰

- **데이터 서브모듈 부재 환경:** worktree clone 직후 `data/` 가 비어 있을 때 모든 테스트가 즉시 fail 하므로, e2e 실행 전 `git submodule update --init --recursive` 가 필수다. SSH 키가 없으면 메인 체크아웃의 데이터로 보조하는 우회가 필요하다 (이번에는 worktree 안에 메인 데이터 파일을 개별 심볼릭 링크해 dev 서버를 worktree 디렉터리로 띄웠다).
- **오디오 race 의 잠재성:** 이번 1차 실행과 2차 실행에서 5건의 audio_controls 테스트가 들쭉날쭉했다. error 리스너 차단을 `_open` 공통화한 이후 일관되게 통과. 다음 회귀 점검 때 빠진 케이스가 다시 떠오르면 같은 패턴으로 처리.
- **PKCE race 의 가능성:** 상태머신이 더 많은 비동기 단계로 확장될 경우, 이번처럼 "URL 정리"가 아닌 "최종 상태 폴링"이 디폴트 단언 패턴이 돼야 한다.

## 9. 비고

- 데스크톱 Chromium 단일 브라우저 (iOS/Android 는 UA + viewport 시뮬레이션)
- 모바일 핀치 / 실제 IME 동작은 자동화 한계 — 수동 QA 영역
- e2e 는 로컬 전용 (CI 미포함, CLAUDE.md 정책 유지)
- 데이터 서브모듈 포인터는 `378f05bb…` 시점 (변경 없음)
