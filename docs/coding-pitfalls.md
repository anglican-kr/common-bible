# 코딩 실수 패턴 (Coding Pitfalls)

이 문서는 본 프로젝트의 git 커밋 이력에서 추출한 **반복 발생하는 실수 패턴**을 카테고리별로 정리한 것이다.
ADR이 "왜 이 결정을 했는가"를 다룬다면, 이 문서는 **"무엇을 조심해야 하는가"** 에 초점을 맞춘다.

## 사용법

- 새 기능을 구현하기 전에 관련 카테고리의 체크리스트를 훑어본다.
- 코드 리뷰 시 동일 패턴이 재발하지 않는지 확인한다.
- 새로운 실수 유형이 발견되면 카테고리를 추가하거나 기존 카테고리에 사례를 덧붙인다 (살아있는 문서).

기준 시점: 2026-05-03 (총 99개 커밋, 그중 fix 38개 = 38.4%).

---

## 1. 비동기 타이밍 경합 — 가장 빈번

여러 비동기 작업이 동시에 진행될 때, 늦게 도착한 stale 콜백이 최신 상태를 덮어쓰는 패턴.

**사례:**
- `21540a0` — `updateAppIcons`: 테마를 빠르게 바꾸면 이전 컬러스킴의 `requestIdleCallback` + `loadOrigIcon` 체인이 뒤늦게 실행되어 새 navy 아이콘을 덮어씀.
- `5c41797` — 북마크 드로어 `open→close→open` 반복 시, 닫힘 애니메이션의 `finalize` 콜백이 새로 열린 드로어를 숨김.
- `fc6d374` — Drive 동기화에서 여러 요청이 동시에 401을 받으면 각자 `_silentSignIn()`을 호출, 재인증 콜백이 다중 실행되어 `_downloadAndMerge` → `_upload`가 중복되며 마지막 요청이 이전 기록을 덮어씀. `_isRefreshing` 플래그로 단일 진행 보장.

**방어 전략 (상황에 따라 선택):**

| 전략 | 적용 상황 | 구현 |
|------|----------|------|
| Generation 카운터 | 장기 비동기 체인 (이미지 디코드, 파일 페치) | 시작 시 `_gen` 캡처 → 완료 시 `_gen === currentGen` 일 때만 적용 |
| Sequence 번호 + clearTimeout | 타이머 기반 애니메이션 | 새 작업 시작 시 sequence 증가 + 이전 `setTimeout` 명시적 취소 |
| Singleton 플래그 | 토큰 갱신·재인증·일회성 동기화 | `_isRefreshing` 같은 플래그로 진행 중 재진입 차단 |
| Promise.race + timeout | 네트워크/폰트 로드 | `Promise.race([fetch(...), timeout(1500)])` 로 무한 대기 차단 |

**규칙:** 같은 작업이 여러 번 트리거될 수 있으면 "최신 호출만 유효" 또는 "동시에 하나만 유효" 패턴을 처음부터 설계한다.

---

## 2. SPA 경로 해석 오류 — 2회 반복 재발

상대 경로(`./data/...` 또는 `data/...`)는 현재 URL을 기준으로 해석되므로, History API 라우팅으로 하위 URL(`/bible/john/3`)에서 새로고침하면 자원 로드가 깨진다.

**사례 (같은 버그 형태가 2번 반복):**
- `45eba01` — `index.html`의 상대 경로를 절대 경로로 수정.
- `730aafe` — 같은 버그가 `js/app.js`의 `DATA_DIR` 및 fetch 경로에 또 있어 별도 커밋으로 수정.

**규칙:**
- 모든 자원 경로는 `/`로 시작 (예: `/data/books.json`, `/assets/icons/...`).
- 데이터 페치는 상수화된 `DATA_DIR`을 통해서만 접근한다.
- 검증: 개발 서버에서 `/bible/john/3` 같은 하위 URL에 직접 진입했을 때 모든 자원이 200 OK인지 확인.

관련 ADR: `009-history-api-routing.md`.

---

## 3. 상태 갱신 누락 — UI 불일치

CRUD 작업 후 의존하는 UI 컴포넌트의 갱신 함수를 호출하지 않아, 데이터는 바뀌었으나 화면에 반영되지 않는 패턴.

**사례:**
- `03d7884` — 북마크 저장/수정/병합/삭제 후 헤더 북마크 버튼의 `has-bookmark` 상태가 갱신되지 않음. 모든 작업점에서 `refreshBookmarkHeaderBtn()` 호출 추가.
- `8762b3c` — long-press로 북마크 저장 시 헤더 아이콘 미갱신. (`03d7884`에서 클릭 경로는 고쳤으나 long-press 경로 누락)
- `ff39997` — division 뷰에서 `updatePageMeta()` 빈 호출이 `setTitleWithDivisionPicker()`가 설정한 제목을 덮어씀.
- `3303176` — 검색 자동 이동에서 내부·외부 `route()`가 둘 다 메타를 설정해 충돌.
- `7808c89` — 장 이동 시 절 선택 모드가 종료되지 않고 inert 셀렉터도 갱신되지 않아, 다음 장에서 비활성 요소가 잔류.

**규칙:**
- CRUD 함수마다 갱신 호출을 명시적으로 작성한다 (중앙 이벤트 시스템이 없는 이상 자동 동기화에 의존하지 말 것).
- **모든 진입점**(클릭, long-press, import, drop 등)에서 동일한 갱신 호출을 한다. 새 진입점을 추가할 때는 기존 진입점의 후처리를 그대로 따라간다.
- 라우팅이 중첩될 수 있으면 메타 설정 책임을 한 레이어로 한정한다.
- **페이지/뷰 전환 시 정리할 모드성 상태를 체크리스트로 관리**: 절 선택 모드, 모달, inert 속성, 임시 이벤트 리스너 등.

---

## 4. 조건문 논리 오류

방향성 역전, 분기별 검증 누락, 체크 위치 오류처럼 한눈에 보이지 않는 논리 결함.

**사례:**
- `16b70ae` — 폴더 드롭 순환 참조 검사에서 `_isDescendant`의 인자 순서가 반대였음. 실제로는 "드래그 대상이 드롭 위치의 조상인가"를 봐야 하는데 반대로 검사.
- `f154a56` — 같은 순환 참조 검사가 `position === "into"` 분기에만 있고 `before`/`after` 분기에는 누락. 폴더를 자기 조상의 형제로 드롭하면 통과.
- `3b9727f` — 단일 절 범위 초과 체크가 `hlVerseEnd != null` 블록 **내부**에만 있어, 정작 필요한 케이스에서 작동 안 함. 블록 밖으로 이동.

**규칙:**
- 부모-자식 관계 검사 헬퍼는 인자 순서가 헷갈리지 않게 시그니처 위에 한 줄 주석:
  `// _isDescendant(ancestor, candidateId) — candidate가 ancestor의 후손인가?`
- 분기로 갈라진 동일 의도 검증이 있는지 확인. "이 검증이 다른 분기에도 필요한가?"를 한 번 더 묻는다.
- 가드 절은 가능한 한 **분기 시작 시점**에 두고, 분기 내부에 두면 의도하지 않은 패스가 생기지 않는지 확인.

---

## 5. 모달/접근성 보일러플레이트 누락

모달 생성 시 포커스 트랩 누락, 드래그 시 포인터 이벤트 리스너 위치 오류처럼 "한 번 익히면 반복 적용해야 하는" 보일러플레이트를 빠뜨리는 패턴.

**사례:**
- `9b8a638` — 병합 다이얼로그가 표시되지만 `trapFocus()` 호출이 누락되어 키보드 사용자가 모달 외부로 빠져나갈 수 있었음.
- `5c41797`, `f154a56` — 드래그용 `pointermove`/`pointerup`/`pointercancel`을 행(row) 요소에 붙였더니, 드래그 중 포인터가 행 밖으로 이탈하면 이벤트를 놓쳐 ghost가 잔류. `document` 레벨로 이동, `pointerId` 필터링 추가.

**모달 생성 4단계 체크리스트:**

```
□ 표시 전 hidden=true (또는 .hidden 클래스 부여)
□ 표시 직후 trapFocus(modal) 호출, 반환값을 cleanup용으로 보관
□ requestAnimationFrame 안에서 첫 액션 버튼에 .focus()
□ 닫을 때: 트랩 해제 + 임시 이벤트 리스너 제거 + 상태 초기화
```

**드래그 핸들러 규칙:** 포인터 추적은 항상 `document` 레벨. 멀티터치 구분이 필요하면 `pointerId`로 필터링.

---

## 6. 복합 객체 비교 / 범위 병합

복합 객체를 참조 동등성으로 비교하거나, 범위를 정규화 없이 병합해 중복·누락이 발생하는 패턴.

**사례:**
- `85baf40` — 선택된 절 범위 clamping에서 `clamped[i].end !== hlSegments[i].end` 식으로 비교. 객체가 다른 참조면 내용이 같아도 불일치로 판정. 직렬화 문자열(`"3a,3b,5-7"`) 기반 비교로 교체.
- `fa83d94`, `3b9727f` — 운문 절 병합에서 정수 ref(`3`)와 파트 ref(`3a`, `3b`) 중복 제거 누락. 정수 ref가 이미 커버하는 파트 ref를 별도로 보관.

**규칙:**
- 복합 객체/세그먼트 비교는 **정규화된 직렬 형식**을 거쳐서 비교한다.
- 범위 병합은 (정렬 → 병합 → 중복 제거) 3단계를 명확히 분리하고, 정수 ref와 파트 ref처럼 **포함 관계가 있는 표현**이 섞여 있으면 우선순위를 명시.
- JSON 파싱은 항상 try-catch로 감싸 사용자가 만든 깨진 데이터에 대비.

---

## 7. PWA 캐시 버전 bump 누락

오프라인 셸/데이터/오디오에 포함되는 파일을 변경한 뒤 해당 캐시 식별자를 올리지 않으면 사용자 기기에 옛 캐시가 남는다.

`sw.js`는 3개의 독립된 캐시를 둔다. 어떤 파일이 바뀌었는지에 따라 올려야 할 식별자가 다르다.

| 변경 대상 | bump 대상 | release.py 호출 |
|-----------|-----------|-----------------|
| 셸 (JS/CSS/HTML/icons + `books.json`·`search-meta.json`) | `SHELL_CACHE` | `release.py patch` (기본) |
| 본문 (`/data/bible/*`) 또는 검색 인덱스 (`search-{ot,nt,dc}.json`) 포맷 | `DATA_CACHE` | `release.py patch --bump-data` |
| 오디오 mp3 인코딩/소스 | `AUDIO_CACHE` | `release.py patch --bump-audio` |

**사례:**
- worklog 2026-04-30 — `privacy.html` 추가 시 `SHELL_FILES` 등록 + navigation 예외 처리 + `shell-37 → shell-38` bump가 한 묶음으로 진행되어야 했음.

**SW 변경 체크리스트:**

```
□ 새 파일을 SHELL_FILES 에 추가했는가
□ navigation 요청 처리에서 예외가 필요한 페이지인가 (standalonePages 등)
□ 어느 캐시(shell/data/audio)에 속하는지 sw.js cacheNameFor 라우팅이 맞는가
□ release.py 로 해당 캐시 식별자를 bump 했는가 (필요 시 --bump-data / --bump-audio)
```

스크립트 `scripts/release.py`가 세 캐시 식별자를 한 곳에서 다루므로 수동 편집보다 스크립트 사용 권장.

---

## 8. 폰트/렌더링 특성 오해 — 회귀 사례

브라우저 폰트 로딩 동작을 잘못 이해해, 캐시 무효화 직후 첫 실행에서만 회귀가 보이는 까다로운 패턴.

**사례:**
- `351deef` — `font-display: optional`은 폰트가 100ms 안에 도착하지 않으면 그 세션 동안 시스템 폰트로 락인됨. 캐시 미적중 직후 첫 실행에서 의도한 폰트가 보이지 않다가 앱 재시작 후에야 나타나는 회귀. `swap`으로 변경 (런치 스크린이 FOUT 구간을 가림).
- `d61f879` — `media="print" onload` 트릭으로 @font-face를 동적 삽입하면 first paint 이후에 로드되어 FOUT 발생. blocking `preload as="style"`로 변경.

**규칙:**
- 폰트 규칙은 **first paint 전에 DOM에 있어야** FOUT이 없다.
- 폰트 전략은 **(빠른 네트워크 / 느린 네트워크) × (캐시 적중 / 미적중)** 4가지 조합으로 검증한다. DevTools의 throttling + "캐시 비우고 강력 새로고침"으로 재현.
- 관련 ADR: `007-launch-screen-optimization.md` (개정 블록 참고).

---

## 9. 글로벌 이벤트 핸들러 협력 부족

전역 인터셉터(예: `document.addEventListener("click", ...)`)가 하위 요소의 자체 핸들러가 이미 처리한 이벤트를 **다시 처리**해 의도치 않은 동작이 발생하는 패턴.

**사례:**
- `d25b8da` — 전역 클릭 인터셉터가 SPA 라우팅을 위해 `<a href>` 클릭을 가로챘는데, `buildSheetPagination`의 `href="#"` 링크는 자체 핸들러에서 `e.preventDefault()`를 이미 호출함. 인터셉터가 `e.defaultPrevented` 미체크로 `route()`를 또 호출.

**규칙:**
- 글로벌 이벤트 핸들러는 가장 먼저 `if (e.defaultPrevented) return;` 으로 협력 게이트를 둔다.
- 자체 처리하는 하위 핸들러는 **반드시** `e.preventDefault()` (필요 시 `stopPropagation()`)를 호출해 의도를 표현한다.
- 가능하면 글로벌 인터셉터 스코프를 좁힌다 (예: `closest("a[href]:not([data-internal])")` 같이 명시적 마커).

---

## 10. 플랫폼별 quirk 무시

웹 표준대로 작성했지만 iOS Safari, Android, 사용자 환경 설정(예: `prefers-reduced-motion`) 때문에 회귀하는 패턴.

**사례:**
- `f043f78` — 모달 열림 시 `body { overflow: hidden }` 만으로는 iOS Safari의 배경 스크롤이 막히지 않음. `position: fixed` + 현재 스크롤 위치 보존 + 닫을 때 복원 패턴 필요.
- `da21f11` — 드로어 슬라이드 애니메이션이 `prefers-reduced-motion: reduce` 환경에서도 그대로 재생됨. 미디어 쿼리로 비활성화.

**규칙:**
- iOS Safari, Android Chrome 둘 다에서 직접 검증한다 (특히 모달·바텀시트·키보드 노출 동작).
- 모션을 사용할 때는 항상 `@media (prefers-reduced-motion: reduce)` 분기를 함께 작성한다.
- 스크롤 락 같은 전형 패턴은 **검증된 헬퍼 함수**로 추출해 매번 같은 구현을 쓰게 한다 (구현 노하우가 휘발되지 않도록).

---

## 11. 비동기 race 가드 — 단일 체크포인트의 함정

`async` 함수가 여러 `await` 지점을 거치면, 각 await 사이마다 외부 상태(사용자 의도, 다른 흐름의 결과 등)가 바뀔 수 있다. race 가드를 함수 진입 시점이나 첫 번째 await 직후에만 두면, 그 다음 await가 끝난 시점에 이미 stale한 결정에 따라 상태를 덮어쓰는 패턴.

**사례 (Phase 2h PKCE 마이그레이션 — Bugbot PR #54·#57):**

- `c4d0c72` — `_attemptSilentRefresh`가 `_state` 기반 race 가드만 가짐. 사용자가 silent refresh 진행 중 `signOut()`/`disable()`을 호출하면 `_state`는 그대로(혹은 정상 진행 중인 값)이지만 `localStorage["bible-drive-sync"]`는 `"0"`으로 바뀜 → state 가드만 통과시켜 IDLE/NEEDS_CONSENT로 전이하면 사용자가 끊은 sync를 다시 살림. 해결: `localStorage.getItem(SYNC_ENABLED_KEY) === "0"` 검사 추가.
- `f090c83` — 같은 함수에 race 가드를 진입 시점에만 둠. 그러나 `await refreshAccessToken(...)` 직후 race 가드를 통과한 뒤에도 `await refreshStore.saveRefreshToken(...)` (rotation) 또는 `await refreshStore.clearRefreshToken()` (invalid_grant) 같은 IDB await가 남아있음. 그 IDB await 동안 사용자가 `disable()`을 호출하면 후속 `_transition(IDLE/NEEDS_CONSENT)`이 다시 `SYNC_ENABLED_KEY = "1"`로 덮어씀. 해결: 매 `await` 직후마다 race 가드를 다시 검사. 단계 4 후 `enable()`이 동기적으로 DISABLED를 빠져나가지 않으므로 state-based 가드만으로 cold-start 경로 보호 불가능 — flag-based 가드가 필수.

**규칙:**

- 비동기 함수에서 race 가드는 **모든 await 직후에 재검사**한다. 진입 시점 한 번만으로 충분하다고 가정하지 말 것.
- 사용자 의도를 신뢰성 있게 신호하는 단일 출처(여기서는 `localStorage["bible-drive-sync"]`)를 정해 모든 race 가드가 같은 출처를 참조하게 한다.
- state machine을 단순화하면서 동기 dispatch가 사라졌다면, 기존 state-based race 가드가 더 이상 작동하지 않는지 의심하라. flag-based 가드로 대체하거나 보강해야 할 수 있다.
- 회귀 방어 테스트: 외부 제어 가능한 `Promise`로 await를 hold한 채 `disable()`을 끼워 넣어, 각 await 시점의 race window를 명시적으로 시뮬레이션한다 (`tests/unit/state-machine.test.js` 26a/b/c 참고).

---

## 12. 콜백 URL 데이터 leak — flow별 transport 격차

OAuth callback이 query string(`?code=...`)으로 오느냐 fragment(`#access_token=...`)으로 오느냐는 flow마다 다르다. URL을 strip하는 코드가 한 flow의 가정 위에 작성됐다면, flow 전환 시점에 새 flow의 callback이 URL bar / 브라우저 히스토리 / 로그에 leak될 수 있다.

**사례 (Phase 2h PKCE 마이그레이션 — Bugbot PR #54-2):**

- `3a7c8ab` — Implicit Flow 시절 IIFE는 `bad_state` / `no_state` / `state_mismatch` fallback에서 `history.replaceState(null, "", location.pathname + location.search)`로 search를 보존했음. Implicit callback은 fragment에 오므로 search는 안전했음. PKCE 도입 후 callback은 query string(`?code=...&state=...`)으로 오므로 같은 fallback이 auth code를 URL bar에 leak.

**규칙:**

- 새 flow로 전환할 때, 기존의 URL strip 로직이 새 flow의 callback shape을 반영하는지 명시적으로 검증한다.
- 기본 원칙: 본인 앱이 query 또는 fragment 기반 라우팅을 안 쓴다면, OAuth fallback에서 `location.pathname`만 남기고 search/hash를 둘 다 폐기하는 게 가장 안전.
- 회귀 방어: callback URL의 `?code=`, `#access_token=` 등이 IIFE 종료 후 `location.search`/`location.hash`에 잔존하지 않는지 e2e 테스트로 직접 검증.

---

## 13. 마이그레이션 시점의 sessionStorage / localStorage 키 격리

기존 흐름과 새 흐름이 같은 storage 키를 공유하면, 마이그레이션 PR 머지 시점에 진행 중이던 callback이 잘못된 흐름으로 라우팅되거나 완전히 떨어진다. flow별로 별도 키를 사용해 절대 교차 처리되지 않게 격리해야 한다.

**사례 (Phase 2h PKCE 마이그레이션):**

- 단계 2~4 — Implicit Flow는 `bible-drive-redirect-state`, PKCE는 `bible-drive-redirect-state-pkce`로 분리. 단계 4 머지 시점에 진행 중이던 PKCE callback은 새 코드도 같은 `-pkce` 키로 매칭되어 정상 처리됐고, 진행 중이던 Implicit callback은 신코드가 안 봐서 자연 만료(sessionStorage 휘발).
- 단계 4의 함수 rename(`beginRedirectAuthPKCE` → `beginRedirectAuth`)에서 **변수명만 canonical로 인계하고 storage 키 값은 의도적으로 `-pkce` 접미사 유지** — 변수명과 키 값을 동시에 바꾸면 in-flight callback이 떨어짐.

**규칙:**

- 서로 다른 인증 / 라우팅 flow에는 처음부터 다른 storage 키를 부여한다.
- 키 이름을 바꾸는 마이그레이션은 두 단계로: (1) 새 키 사용 시작, 옛 키는 read-only로 유지 → (2) 옛 키 cleanup. 한 PR에 같이 넣지 말 것.
- localStorage 폐기 키는 단계 5처럼 별도 정리 단계에서 `localStorage.removeItem(...)`을 IIFE에 추가해 기존 사용자 디바이스에서 청소한다 (몇 릴리스 후 cleanup 코드 자체도 제거).

---

## 14. CSS `display` 속성이 `[hidden]` 무력화

`<button hidden>` 같은 HTML5 `hidden` 속성은 user-agent 스타일시트에서 `[hidden] { display: none }`로 처리된다. 그런데 author CSS에서 ID 셀렉터로 `display: flex`(또는 block, grid 등)를 명시하면 specificity가 더 높아 `[hidden]` 규칙을 덮어쓴다 — JS에서 `el.hidden = true`로 설정해도 시각적으로 안 사라지는 회귀.

**사례 (Phase 2h 단계 6):**

- 검색 액션 버튼(`#search-clear`, `#search-history-toggle`)에 `display: flex`가 적용돼 있어, JS의 `$searchClear.hidden = true`가 무력화. 빈 입력 상태에서도 X 버튼이 계속 보였고, 동시에 `dataset.clearHidden="true"` 트리거 규칙이 history toggle을 clear의 위치로 옮겨 두 버튼이 정확히 같은 좌표에 스택. DOM 순서상 clear가 후순위라 사용자에겐 X만 보이고 ▾는 X 뒤에 가려져 "버튼 모양이 이상"한 외양.
- 수정: `#search-clear[hidden], #search-history-toggle[hidden] { display: none; }` 명시 규칙 추가. specificity 동률 이상으로 끌어올려 `[hidden]` 의도 복구.

**규칙:**

- ID 또는 specificity 높은 셀렉터로 `display: ...`를 설정한 요소가 `hidden` 속성을 통해 가려질 수 있다면, **반드시 같은 셀렉터에 `[hidden] { display: none }` 규칙을 명시**한다.
- 점검: `el.hidden = true` 후 DevTools에서 `getComputedStyle(el).display`를 확인해 `none`이 나오는지 검증.
- 전역 회귀 방지가 필요하면 `:where([hidden]) { display: none !important; }` 같은 광역 규칙도 가능하지만 `!important`는 다른 의도된 override를 깨뜨릴 수 있어 피하는 게 좋음. 셀렉터별 `[hidden]` 보강이 더 안전.

---

## 15. Cache API ↔ IDB sidecar 불일치 + Content-Length 의존

Cache API는 access-time / byte-size 메타데이터를 노출하지 않으므로 LRU·쿼터 추적은 IndexedDB sidecar에 별도 보관하는 패턴이 자연스럽다 (ADR-016). 그러나 두 store가 독립 존재이므로 한쪽만 갱신·소실되면 추적이 영구 어긋난다. 또 Content-Length 헤더에 의존해 byteSize를 기록하면 chunked transfer / gzip / Range 응답에서 0이 들어가 LRU cap이 사실상 무력화된다.

**사례 (2차 보안 감사 — `docs/audit/2026-05-08-second-comprehensive.md` H1·H2·H3):**

- **H1** — `sw.js:139` `byteSize = cl ? Number(cl) : 0`. Content-Length 누락 시 0 기록 → totalSize 합산에서 빠짐 → HARD_CAP 도달 신호 못 받음 → Cache API 무한 누적 → origin-단위 quota 초과 시 DATA_CACHE까지 evict.
- **H2** — `_putAudioAndEnforceCap`이 두 fetch에서 동시 진행되면 `pickEvictions` 결과가 방금 put된 url을 evict 대상에 포함시켜 재생 중 mp3 삭제.
- **H3** — `cache.put` 성공 후 `recordEntry` 실패하면 Cache에 mp3는 있고 IDB 메타는 없는 상태로 영구 누적. DevTools에서 한쪽만 비워도 같은 결과.

**규칙:**

- **byteSize는 Content-Length를 우선하되 무효 시 `response.clone().blob().size`로 폴백한다.** 추가 read 1회 비용을 받아들이는 것이 LRU 정확성 손실보다 항상 낫다. clone()은 `cache.put` 전에 (body 소비 전에) 해야 한다.
- **동시 in-flight URL 추적**: 모듈 레벨 `Set`에 진입 시 add, 종료 시 finally에서 delete. eviction은 이 Set을 filter out — 진행 중 항목이 다른 호출의 cap 정리에 휘말리지 않게.
- **양 store reconcile**: SW `activate` 핸들러에서 `cache.keys()`와 IDB entries 양방향 비교. (a) Cache에 있고 IDB에 없는 항목 → recordEntry로 채움 (byteSize는 blob.size로). (b) IDB에 있고 Cache에 없는 항목 → orphan removeEntries. 비용은 mismatch 수에 비례하며 healthy 상태에선 microsecond.
- **회귀 방어**: 단순 throughput 테스트 외에 (i) Content-Length 누락 응답 (ii) 동시 cap 초과 fetch (iii) IDB·Cache 한쪽 비움 시나리오를 명시적으로 다루는 테스트 케이스 필요.

---

## 부록 A: 변수명 섀도잉

DOM 쿼리 결과에 `el`, `node` 같은 짧은 이름을 쓰면 외부 스코프나 인접 코드의 동명 변수와 컨텍스트가 섞인다.

**사례:**
- `4526614` — `_updateDragIndicators`에서 `elementFromPoint` 결과를 `el`로 받았는데, 인접 코드의 다른 `el`과 섞여 잘못된 요소 조회. `hitEl`로 이름 변경.

**규칙:** DOM 쿼리 결과는 컨텍스트가 드러나는 이름을 쓴다 — `hitEl`, `targetRow`, `draggedItem`, `dropZone` 등.

---

## 부록 B: 같은 시각 효과를 여러 곳에 적용할 때

CSS의 시각 효과(모서리 라운드 평탄화, 강조 색 등)를 인접 요소 사이에 적용할 때, 적용 대상의 **레이아웃 모드**를 가정한 채 작성하면 다른 모드에서 깨진다.

**사례:**
- `b030aa6` — 검색·딥링크 강조에서 연속 절의 모서리를 평탄화하는 규칙이 인라인 본문에는 잘 동작했으나, 시 구절(block) 레이아웃에서는 잘못 평탄화되어 모서리가 부자연스럽게 잘림.

**규칙:** 인라인 / 블록 / flex / grid 등 레이아웃 모드별로 시각 효과를 한 번씩 시각 검증한다. 가능하면 셀렉터에 레이아웃 컨텍스트(`.poetry-block` 등)를 명시.

---

## 패턴 추가 가이드

새로운 실수 유형을 발견하면 다음 형식으로 추가:

```markdown
## N. 카테고리명 — 짧은 부제 (선택)

한 문단의 패턴 설명.

**사례:**
- `<커밋해시>` — 한 줄 요약.

**규칙:**
- 액션 가능한 규칙 1.
- 액션 가능한 규칙 2.
```

가능하면 실제 커밋 해시를 첨부해 검증 가능하게 한다.
