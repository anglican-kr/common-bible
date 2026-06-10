# ADR-034: 뷰·라우팅·북마크 2차 분할 (modularization round 2)

- 일시: 2026-06-08
- 상태: 승인됨 — views-routing 분할 PR1~5b 완료·PR5c 보류 / **bookmark.js 분할 PR5a~5e + 죽은 코드 정리 완료** (2026-06-08, 아래 개정 참조)
- 관련: ADR-018(1차 분할), ADR-019(ESM), ADR-032(오버레이 컨트롤러), ADR-016(오디오 캐시), ADR-013(유닛 테스트 하네스)

## 결정

ADR-018 1차 분할이 남긴 두 비대 모듈을 응집도 기준으로 다시 가른다.

- `js/app/views-routing.js`(2,389줄) → 관심사별로 분리. 이름이 "뷰+라우팅"인 것 자체가 ADR-018 Phase 7에서 7개 관심사를 한 덩어리로 착지시킨 임시 번들의 표식이다.
- `js/app/bookmark.js`(3,578줄) → 순수 로직 / UI 두 층으로 분리(후속 라운드).

분할은 **파일 경계만 긋는 데서 멈추지 않는다.** 동시에 모듈 간 결합을 다음 원칙으로 낮춘다.

1. **비순환 seam은 전역 facade(`window.X`) → 명시 ESM `import`/`export`로 전환.** 전역 네임스페이스 경유는 암묵적·고결합 방식이라(ADR-019 "ESM ReferenceError 함정"의 근원) 파일만 쪼개도 논리적 결합이 남는다.
2. **순환 dispatch는 등록(registry)으로 역전.** `route()`가 다른 모듈의 뷰(`renderSearchView`·`renderBookmarksView`·`renderSettingsView`)를 부르고 그쪽이 다시 `route`/`navigate`/`parsePath`를 되부르는 양방향 의존은 명시 import로 강제하면 import 사이클이 된다. 라우터가 각 뷰를 직접 import하는 대신, 각 뷰 모듈이 자기 렌더러를 라우터에 등록(`registerView(name, fn)`)해 의존을 단방향(`views → router`)으로 뒤집는다.
3. **분할 범위 밖 외부 호출자는 facade를 임시 유지.** 한 PR이 건드리지 않는 모듈(settings·search·bookmark·app·sync 등)이 bare `window.X`로 부르는 심볼은 그대로 둔다. 해당 모듈을 손대는 후속 라운드에서 import로 전환한다.

## 맥락 — 왜 지금, 무엇이 문제인가

ADR-018은 6,082줄 `app.js`를 8 PR로 가르며, Phase 7에서 "Routing + Views + Audio + PTR + Compact header"를 한 모듈로 묶어 착지시켰다(파일명 `views-routing.js`가 그 번들을 인정). 1년 새 검색 옵션·탭 히스토리·모핑 탭 바 등이 얹히며 다시 비대해졌다.

`views-routing.js`의 실제 관심사(실측):

| 영역 | 라인 | 규모 | 비고 |
|---|---|---|---|
| 탭바 활성/슬라이드 인디케이터 | 44–163 | ~120 | `tabbar.js` 짝 |
| Pull-to-refresh 제스처 | 164–342 | ~180 | 독립 |
| 데이터 페칭 (`loadBooks/Version/Chapter/Prologue`) | 343–396 | ~55 | leaf, 의존 0 |
| 렌더 헬퍼 (title·chapter picker·division·book-list·compact·elevation) | 398–931 | ~530 | |
| Views (`renderChapter` 단독 ~470줄 포함) | 932–1713 | ~780 | data 의존 |
| Routing (`parsePath`·`navigate`·`route`) | 1714–2131 | ~420 | 모든 걸 호출하는 오케스트레이터 |
| 오디오 플레이어 | 2132–2324 | ~190 | 가장 자족적 |

의존 방향은 **`routing → views → data`로 단방향**이고 view는 `route()`를 호출하지 않는다(실측 확인). 즉 한 파일 안에 숨어 있을 뿐 경계는 이미 깔끔하다 — 분할이 그 단방향성을 import 그래프로 **증명**하고, 역방향 결합이 새로 생기는 것을 컴파일 단계에서 막는다.

### 결합도 측면에서 본 목표 형태

- `data-fetch` — 밖으로 의존 0, 다수가 의존받는 안정적 leaf (afferent↑/efferent 0). 이상적.
- `audio-player` — helpers·storage·audio-cache만 의존, 진입점은 `showAudioPlayer`/`hideAudioBar` 소수. 낮은 결합.
- `routing` — 여러 뷰를 import하는 오케스트레이터(efferent↑). 단방향·명시적이면 건강한 결합(책임이지 군더더기가 아님).

## 검토한 대안

| 방식 | 응집 | 결합 | 채택 |
|---|---|---|---|
| 그대로 유지 | 낮음(관심사 7종) | 전역 facade로 암묵 고결합 | ❌ |
| 파일만 분할, facade 유지 | 높아짐 | 논리적 결합 그대로(절반만 달성) | ❌ |
| **파일 분할 + 비순환 import 전환 + 순환은 registry 역전** | 높음 | 단방향·명시 | ✅ |
| 라우터가 모든 뷰를 직접 import | 높음 | routing↔view 사이클 | ❌ — ESM이 함수 호출 사이클은 용인하나 설계 악취·TDZ 위험 |

## 목표 구조 + PR 순서

의존 방향을 따라 위험 낮은 leaf부터 1 PR = 1 모듈. 기능 PR과 절대 혼합하지 않는다(아래 §테스트 하네스 제약).

| PR | 작업 | 빼낼 영역 → 대상 파일 | 결합 처리 |
|---|---|---|---|
| 1 | **오디오 플레이어** | 2132–2324 + 오디오 상태 → `js/app/audio-player.js` | `route`측 호출을 명시 import로. 외부 호출자(search·settings·bookmark·app·sync)용 `window.{hideAudioBar,applyAudioShow,getCurrentAudio}` facade 유지. `applyAudioShow→parsePath` 상향 엣지는 `window.parsePath` 임시 경유(PR5에서 해소) |
| 2 | **데이터 페칭** ✅ | `loadBooks/Version/Chapter/Prologue` + `booksCache`/`appVersion`/`DATA_DIR`/`getBooksCache` → `js/app/data-fetch.js` | leaf(의존 0). views-routing 내부 호출(loadBooks/Chapter/Prologue)은 명시 import, 외부 소비자(search·app·bookmark·settings) facade는 data-fetch가 소유. `DATA_FETCHING` 마커 + 유닛 테스트 슬라이스 경로 동반 이동 |
| 3 | **탭 인디케이터** ✅ | `syncTabBarActive`·`positionTabIndicator`·슬라이딩 인디케이터 상태·리사이즈/transitionend 리스너 → `js/app/tabbar.js` 병합(탭 바 로직 일원화) | route()→`window.syncTabBarActive?.()` facade 유지(tabbar↔views-routing 순환). tabbar의 `$searchBtn`·`exitSearch` 재사용, `$tabBar` 신규. 탭 인디케이터엔 마커 테스트 없어 테스트 변경 0 |
| 4 | **Pull-to-refresh 제거(폐기)** | 164–342 `setupPullToRefresh` IIFE + CSS `#pull-refresh-*` 삭제 | 사용자 결정(2026-06-08): 모바일 "당겨서 새로고침"=수동 Drive 동기화 트리거이므로 제거. `driveSync.requestSync` API·상태기계·visibilitychange 자동 동기화·편집 시 자동 업로드 등 **백그라운드 동기화 로직은 전부 유지**(`requestSync`는 다른 경로도 호출) |
| 5a | **라우팅 파일 분리** ✅ | parsePath·navigate·route·updatePageMeta·trackPageView·startScrollTracking + 링크클릭/popstate 리스너 → `js/app/routing.js` | route()가 부르는 view 렌더러 8개(renderBookList/ChapterList/Chapter/Prologue/Loading/Error·divisionOrder·DIVISION_LABELS)는 views-routing에서 **명시 import**(routing→views 단방향, 검증). search/bookmark/settings/citations 뷰·오버레이는 facade 유지(순환). app.js·search 등의 `window.route/navigate/parsePath` 잔존 |
| 5b | **closeAllOverlays** ✅ | route()의 14개 오버레이 teardown(12 `closeIfOpen` + settings/chapter popover)을 `js/app/overlay.js` 의 `closeAllOverlays()` 하나로 축약. createOverlay가 모든 인스턴스를 registry에 등록, closeAllOverlays가 열린 것만 close + detached panel prune | 안전 확인: 모든 close 함수가 순수 `overlay.close()` 래퍼(추가 정리는 `onClose`라 controller.close()가 자동 실행). routing→6개 모듈 close fn 하드코딩 의존 제거 |
| 5c | registerView 역전 (보류 권장) | route()→외부 뷰 dispatch(search/bookmark/settings)를 registry로 역전 | **비용>효용**: 얕게 하면 marginal(window facade→registry lookup, route가 여전히 meta·fallback 오케스트레이션), 깊게 하면 high-risk(검색 분기 복잡—query/autoNav/filter, 3모듈 분산). audio `applyAudioShow→window.parsePath` edge(parsePath가 division+books에 얽혀 하향이 깔끔치 않음 → applyAudioShow가 route 컨텍스트를 인자로 받게)도 함께 검토. [[docs/known-issues.md]] |
| → | 잔여 = `views.js`로 개명 ✅ | 렌더 헬퍼 + Views. 라우팅·오디오·데이터·탭이 모두 빠져 `views-routing` 이름이 실제 내용(렌더+Views)과 안 맞음 → `js/app/views.js` 개명(테스트도 `views.test.js`, ESM import·index.html·sw.js·타입·주석 참조 일괄 갱신) | |

PR5까지 끝나면 잔여 `views.js`는 ~1,300줄. 체감 후 선택적 PR6로 내비 뷰(`views-list.js`)와 본문 뷰(`views-chapter.js`, `renderChapter` 470줄)를 더 가를 수 있으나, 과분할은 import 그래프만 키우므로 **PR5까지가 1차 목표, PR6는 보류**.

bookmark.js는 별도 후속 라운드(순수 로직 `bookmark-core.js` / UI `bookmark-ui.js`).

## 테스트 하네스 제약 (하드 결합)

`tests/unit/views-routing.test.js`·`bookmark.test.js`는 소스 파일 전체를 읽어 `// ── BEGIN X ──/END X ──` 마커로 **문자열 slice 후 vm 실행**(ADR-013)한다. slice는 내부 stub로 자족적이라 주변 코드와 무관하지만, **마커 블록을 새 파일로 옮기면 그 테스트 로더의 경로 상수(`VIEWS_PATH`)를 새 파일로 함께 갱신**해야 한다. 따라서:

- 분할 PR은 **소스 + 테스트 파일을 한 묶음으로** 바꾼다.
- 오디오 영역엔 마커 테스트 블록이 없다(views-routing.test.js 헤더: "Audio Player remain out of scope"). PR1은 테스트 변경 없음.
- 마커 = 추출 단위라 경계는 이미 명확하다(분할이 쉬운 쪽 근거).

## 검증 (PR마다)

- `tsc -p tsconfig.json --noEmit` + `tsconfig.worker.json` 0 error
- `node --test tests/unit/*.test.js` 전부 통과 (이동한 마커 블록의 로더 경로 갱신 포함)
- `index.html` 스크립트 태그 추가 + `sw.js` 셸 캐시 매니페스트 항목 추가
- 로컬 SPA에서 콘솔 0 오류 — 분할은 로드 순서/ReferenceError 누락이 즉시 런타임 깨짐으로 드러남(ADR-018 §검증)
- PR5 머지 후 e2e 일괄

## 결과

- ADR-018 후속으로 응집↑·결합↓ 동시 달성. `window.X` facade는 분할 범위 밖 호출자에만 잔존하다 후속 라운드에서 소멸.
- `docs/architecture.md` 부록 A 인덱스 + 부록 B 빠른 참조 갱신.
- 각 PR 머지 시 `docs/status.md`(구현 현황)에 한 줄. (status는 2026-06-08 CLAUDE.md에서 분리)

## 개정 (2026-06-08): bookmark.js 분할 완료

위 §목표 구조는 bookmark.js를 "순수 로직 `bookmark-core.js` / UI `bookmark-ui.js`" 2층으로만 스케치했다. 실제 구현은 **4개 모듈**로 갈렸고, 모달의 양방향 결합을 **의존성 주입**으로 끊는 패턴이 핵심으로 자리잡았다.

**결과 모듈 (3,578 → bookmark.js 2,198줄, −38%):**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark.js` | 북마크 UI — 트리 렌더·드래그&드롭·셀렉션 모드·드로어·export | ~2,200 |
| `js/app/bookmark-modals.js` | 모달 7종 + 렌더 콜백 DI + 단일 Escape 스택 | ~1,010 |
| `js/app/bookmark-core.js` | DOM-free 로직 (QUERY·HREF/SHARE·SORT·ACTIVE) | ~360 |
| `js/app/verse-spec.js` | 절 스펙 파싱/비교/직렬화/병합 (leaf) | ~240 |

**핵심 결정 — 모달→렌더 순환을 의존성 주입으로 차단.** 모달이 확정 시 트리/헤더를 다시 그려야 하는데(`bookmark.js → 모달 열기`, `모달 → 렌더 갱신`의 양방향 고리), 순환 import는 ADR-019 "ESM 평가시점 ReferenceError 함정"의 부류라 tsc가 못 잡는 런타임 깨짐 위험이 있다. 세 후보(① 의존성 주입 ② 순환 import 허용 ③ 이벤트 버스) 중 **①**을 택했다 — bookmark.js가 시작 시 `initBookmarkModals({ rerenderActiveBookmarkTree, refreshBookmarkHeaderBtn, exitVerseSelectMode })`로 콜백을 주입, 모달은 bookmark.js를 import하지 않아 고리가 구조적으로 차단된다(계약을 tsc가 검증).

**Escape 스택.** 7개 모달이 우선순위 최상단 연속 블록이라 `bookmark-modals.js`의 `closeTopmostModal(e)` 하나가 z-순서대로 소유하고, bookmark.js 라우터는 위임만 한다(`if (closeTopmostModal(e)) return;`).

**move = select-mode UI → 파라미터화로 이동.** move 모달은 `_bmSelected`·`_bmAncestorSelected` 같은 select 상태를 직접 읽어 범용 모달이 아니다. 지속 DI로 select 내부를 `_deps`에 주입하면 계약이 오염되므로, **호출 인자**(`openMoveModal({ excludeFolder, onPick })`)로 일반화 — select 로직은 bookmark.js에 남고 picker는 순수 UI. (대안 "select 통째 분리 `bookmark-select.js`"는 트리렌더↔select 양방향 결합 탓에 보류.)

**PR 순서:** 5a confirm·chapter-delete → 5b 폴더 콤보박스·새 폴더 → 5c save·merge(상호결합) → 5d import → 5e move(파라미터화) → 죽은 facade·미사용 import 정리. 각 PR은 표준 검증 묶음(tsc main·worker + 유닛 + **playwright 로드 검사**(facade/DI 깨짐 포착) + e2e)을 거쳤고, 단계마다 미사용 import를 정리했다.

**정리 PR:** 모달 분리 후 무참조가 된 `window.close*Modal` facade 7종 + bookmark-core QUERY facade 7종(types.d.ts Window·전역 선언 포함) + 미사용 core import를 전 저장소 grep + 로드 검사로 무참조 확증 후 제거.

> `bookmark-core.js`의 QUERY 헬퍼는 ADR-019 원칙(비순환 seam은 명시 import)대로 **window facade 없이 ESM import 전용**이다. PR3에서 legacy bare-global 계약으로 잠시 facade를 보존했다가 정리 PR에서 무참조 확인 후 제거.

## 개정 (2026-06-11): bookmark-gestures.js 분할

위 모달 라운드 이후에도 bookmark.js는 폴더 모아 읽기(`bookmark-read.js`) 분리를 거쳐 다시 2,432줄까지 자랐다. 남은 후속 라운드(트리·메뉴·선택·제스처)의 **첫 모듈로 제스처 엔진을 분리**한다 — 가장 자족적이고 이미 마커 테스트가 잡고 있어 리스크가 가장 낮다(오디오 플레이어가 views-routing 분할의 첫 후보였던 것과 같은 역할).

**결과 (2,432 → bookmark.js 1,952줄, −20%):**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark-gestures.js` | 제스처 엔진 — 드래그 reorder(DRAG_CORE + 인디케이터) · 모바일 스와이프 액션 상태(SWIPED_ROW) · 스와이프 릴리스 수학(SWIPE_GESTURE) · 통합 포인터 핸들러(`_setupDragHandle`) | 541 |

**핵심 결정 — 오케스트레이터로의 역방향 의존 2개를 의존성 주입으로 차단.** 제스처 핸들러는 (a) reorder 후 마운트된 북마크 화면 재렌더, (b) 선택 모드 활성 여부 읽기 — 둘 다 bookmark.js(오케스트레이터)가 소유한다. bookmark.js가 `_setupDragHandle`을 import하므로 제스처가 bookmark.js를 되받아 import하면 순환이 된다. 모달 라운드의 `initBookmarkModals` 선례대로 `initBookmarkGestures({ rerenderTree, isSelectMode })`로 두 훅을 시작 시 주입 — 제스처는 leaf로 남고(의존: appStorage·bookmark-core만), 고리가 구조적으로 차단된다.

**select 상태(`_bmSelectMode`/`_bmSelected`)는 bookmark.js에 잔류.** SWIPED_ROW 마커 안에 끼어 있었으나 실제론 선택 모드 상태다(제스처는 읽기만, 쓰기는 enter/exit). 다음 라운드(`bookmark-select.js`)가 소유 예정이라 이번엔 오케스트레이터에 두고 `isSelectMode` 게터로만 노출한다.

**테스트 하네스.** DRAG_CORE / SWIPED_ROW / SWIPE_GESTURE 마커 3개가 새 파일로 이동 — `bookmark.test.js`의 세 로더가 `BOOKMARK_GESTURES_SOURCE`에서 슬라이스하도록 갱신. DRAG_CORE prelude의 `_rerenderActiveBookmarkTree` stub은 주입 훅 이름 `_rerenderTree`로 교체. 표준 검증 묶음(tsc·유닛 728·playwright 로드 스모크·e2e dnd+swipe 14) 통과.

**남은 라운드:** 선택 삭제 모드(`bookmark-select.js`, 트리렌더↔select 양방향 결합이 관문 — 위 move 파라미터화 노트 참조) → 절 선택 모드(`bookmark-verse-select.js`) → 트리 렌더링·⋯ 메뉴.

> **후속 회귀 (#276):** 이 라운드에서 `_isDescendant`(순수 트리 헬퍼)를 gestures로 옮기며 export를 빠뜨려, bookmark.js의 `_moveSelectedToFolder`가 bare 참조 → 선택 모드에서 **폴더를 폴더로 이동** 시 `ReferenceError`. 폴더 분기(`type==="folder"`)에서만 호출돼 tsc·유닛·로드 스모크·기존 move e2e(북마크만 이동) 전부 못 잡음. export 추가 + 폴더-이동 회귀 e2e(`test_move_folder_into_folder`)로 수리. 교훈: 함수 추출 시 **비-export internal 헬퍼까지** 원본 잔여 코드에 grep하고, 조건 분기 뒤 참조는 그 경로를 구동하는 e2e로 가드.

## 개정 (2026-06-11): bookmark-select.js 분할

모달 라운드에서 "select 통째 분리는 트리렌더↔select 양방향 결합 탓에 보류"라 적었던 그 라운드를, 제스처/모달과 같은 패턴으로 결합을 끊어 진행한다.

**결과 (1,952 → bookmark.js 1,652줄, −15%):**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark-select.js` | 선택 삭제 모드 — 상태(`_bmSelectMode`/`_bmSelected`) · 캐스케이드 수학(BOOKMARK_SELECT, 테스트) · 생명주기/토글/chrome · 삭제·공유·이동 액션 · `#bm-select-bar` dock 참조+리스너 | 362 |

**핵심 결정 — 트리렌더↔select 양방향을 import(한 방향) + 주입(반대 방향)으로 분해.**
- **오케스트레이터 → select (명시 import):** bookmark.js가 `_bmSelectMode`(ESM **live binding**, 트리 빌더·keydown·헤더 refresh의 read 사이트) + 호출 핸들러(`_toggleBmSelect`·`enter/exitBookmarkSelectMode`·`_bmToggleSelectAll`·`_syncBmSelectChrome`)를 import.
- **select → 오케스트레이터 (의존성 주입):** 삭제/이동 후 재렌더 + 헤더 refresh를 `initBookmarkSelect({ rerenderTree, refreshHeaderBtn })`로 주입 — select는 bookmark.js를 import하지 않아 고리 차단.

→ `_bmSelectMode` 잔류(제스처 라운드)가 이 라운드에서 select로 이동, gestures의 `isSelectMode` 훅은 bookmark.js가 **import한 live binding**을 그대로 읽어 무변경. select의 chrome 조작(`_syncBmSelectChrome`/exit)은 전부 셀렉터 기반(`.bm-select-circle`, `#bookmarks-view-tree`)이라 DOM ref 주입 없이 자족.

**정리.** 이동으로 무참조가 된 bookmark.js의 bookmark-core import 4종(`_descendantIds`·`_selectAllState`·`_bmSelectCountLabel`·`_buildSharePayload`) + gestures의 `_isDescendant` import(#276에서 추가했으나 소비자가 select로 이동) 제거.

**테스트 하네스.** BOOKMARK_SELECT 마커가 새 파일로 이동 — `bookmark.test.js` 로더가 `BOOKMARK_SELECT_SOURCE`에서 슬라이스. 표준 검증 묶음(tsc main·worker·유닛 728·로드 스모크·e2e: select-delete 전체+dnd+swipe 26) 통과. (사전 실패: `test_bookmark_folders.py` 폴더 토글 2건 — base 동일, headless 포인터 계열.)

**남은 라운드:** 절 선택 모드(`bookmark-verse-select.js`) → 트리 렌더링·⋯ 메뉴. `_isDescendant`를 본래 자리 bookmark-core로 옮기는 정리도 그때 함께.
