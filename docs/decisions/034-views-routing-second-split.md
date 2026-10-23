# ADR-034: 뷰·라우팅·북마크 2차 분할 (modularization round 2)

- 일시: 2026-06-08
- 상태: 승인됨 — views-routing 분할은 PR1-5b 완료, PR5c 보류. **bookmark.js 분할 완료**: 모달, core, verse-spec, read(2026-06-08), 그다음 gestures, select, verse-select, menu, tree(2026-06-11). bookmark.js는 2,432줄에서 589줄로 줄었다(−76%). 자세한 것은 아래 「bookmark.js 분할」.
- 관련: ADR-018(1차 분할), ADR-019(ESM), ADR-032(오버레이 컨트롤러), ADR-016(오디오 캐시), ADR-013(유닛 테스트 하네스)

## 결정

ADR-018의 1차 분할이 남긴 두 큰 모듈을 응집도를 기준으로 다시 나눈다.

- `js/app/views-routing.js`(2,389줄)를 관심사별로 나눈다. 이름이 「뷰+라우팅」인 것 자체가, ADR-018 Phase 7에서 관심사 7개를 한 덩어리로 내려놓은 임시 묶음이라는 표시다.
- `js/app/bookmark.js`(3,578줄)를 나눈다(뒤의 라운드). 처음에는 순수 로직 `bookmark-core.js`와 UI `bookmark-ui.js`의 두 층으로 그렸고, 실제로는 아홉 모듈로 나눴다(아래 「bookmark.js 분할」).

분할은 **파일 경계만 긋는 데서 멈추지 않는다.** 동시에 모듈 사이의 결합을 다음 원칙으로 낮춘다.

1. **순환하지 않는 연결은 전역 facade(`window.X`)를 명시적 ESM `import`/`export`로 바꾼다.** 전역 네임스페이스를 거치는 것은 드러나지 않는 강한 결합이라(ADR-019 「ESM ReferenceError 함정」의 뿌리), 파일만 쪼개도 논리적 결합이 남는다.
2. **순환하는 호출은 등록(registry)으로 뒤집는다.** `route()`가 다른 모듈의 뷰(`renderSearchView`·`renderBookmarksView`·`renderSettingsView`)를 부르고, 그쪽이 다시 `route`/`navigate`/`parsePath`를 부르는 양방향 의존은 명시 import로 강제하면 import 순환이 된다. 그래서 라우터가 각 뷰를 직접 가져오는 대신, 각 뷰 모듈이 자기 렌더러를 라우터에 등록(`registerView(name, fn)`)해 의존을 한 방향(`views → router`)으로 뒤집는다.
3. **분할 범위 밖의 바깥 호출자를 위해 facade를 잠시 남긴다.** 한 PR이 건드리지 않는 모듈(settings, search, bookmark, app, sync 등)이 맨 `window.X`로 부르는 이름은 그대로 둔다. 그 모듈을 손대는 뒤의 라운드에서 import로 바꾼다.

## 맥락 — 왜 지금, 무엇이 문제인가

ADR-018은 6,082줄 `app.js`를 PR 8개로 나누면서, Phase 7에서 「Routing + Views + Audio + PTR + Compact header」를 한 모듈로 묶어 내려놓았다(파일 이름 `views-routing.js`가 그 묶음을 인정한다). 1년 사이 검색 옵션, 탭 히스토리, 모핑 탭 바 등이 얹히며 다시 커졌다.

`views-routing.js`의 실제 관심사(직접 셈):

| 영역 | 라인 | 규모 | 비고 |
|---|---|---|---|
| 탭 바 활성/미끄러지는 인디케이터 | 44–163 | 약 120 | `tabbar.js`와 짝 |
| Pull-to-refresh 제스처 | 164–342 | 약 180 | 독립 |
| 데이터 받기(`loadBooks/Version/Chapter/Prologue`) | 343–396 | 약 55 | leaf, 의존 0 |
| 렌더 도우미(title, chapter picker, division, book-list, compact, elevation) | 398–931 | 약 530 | |
| Views(`renderChapter` 하나만 약 470줄 포함) | 932–1713 | 약 780 | data에 의존 |
| Routing(`parsePath`·`navigate`·`route`) | 1714–2131 | 약 420 | 모든 것을 부르는 조정자 |
| 오디오 플레이어 | 2132–2324 | 약 190 | 가장 혼자 서 있다 |

의존 방향은 **`routing → views → data`의 한 방향**이고, view는 `route()`를 부르지 않는다(직접 확인). 곧 한 파일 안에 숨어 있을 뿐 경계는 이미 깔끔하다. 분할은 그 한 방향성을 import 그래프로 **보여 주고**, 반대 방향의 결합이 새로 생기는 것을 컴파일 단계에서 막는다.

### 결합도로 본 목표 모양

- `data-fetch`: 밖으로의 의존이 0이고 많은 모듈이 기대는, 안정된 leaf다(들어오는 의존↑/나가는 의존 0). 이상적이다.
- `audio-player`: helpers, storage, audio-cache에만 의존하고, 들어오는 길은 `showAudioPlayer`/`hideAudioBar` 몇 개다. 결합이 낮다.
- `routing`: 여러 뷰를 가져오는 조정자다(나가는 의존↑). 한 방향이고 명시적이면 건강한 결합이다(군더더기가 아니라 책임이다).

## 검토한 대안

| 방식 | 응집 | 결합 | 채택 |
|---|---|---|---|
| 그대로 두기 | 낮음(관심사 7종) | 전역 facade로 드러나지 않는 강한 결합 | ❌ |
| 파일만 나누고 facade 유지 | 높아짐 | 논리적 결합 그대로(절반만 이룸) | ❌ |
| **파일 분할 + 순환 없는 연결은 import로 + 순환은 registry로 뒤집기** | 높음 | 한 방향, 명시적 | ✅ |
| 라우터가 모든 뷰를 직접 import | 높음 | routing↔view 순환 | ❌ — ESM이 함수 호출 순환은 받아들이지만 설계상 좋지 않고 TDZ 위험이 있다 |

- **bookmark.js를 두 층으로만 나누기 (2026-06-08 계획)**: 처음 「목표 구조」는 bookmark.js를 「순수 로직 `bookmark-core.js` / UI `bookmark-ui.js`」 두 층으로만 그렸다. 채택 안 함 2026-06-08 · 이유: 실제로 나눠 보니 모달과 트리, 선택, 제스처, 메뉴가 서로 다른 결합을 가져, 하는 일마다 모듈을 나누고 양방향 결합은 의존성 주입으로 끊는 편이 맞았다(아래 「bookmark.js 분할」).

## 목표 구조와 PR 순서 (views-routing)

의존 방향을 따라 위험이 낮은 leaf부터 PR 하나에 모듈 하나씩 뺀다. 기능 PR과 절대 섞지 않는다(아래 「테스트 하네스의 제약」).

| PR | 작업 | 뺄 영역 → 대상 파일 | 결합 처리 |
|---|---|---|---|
| 1 | **오디오 플레이어** | 2132–2324와 오디오 상태 → `js/app/audio-player.js` | `route` 쪽 호출을 명시 import로. 바깥 호출자(search, settings, bookmark, app, sync)를 위한 `window.{hideAudioBar,applyAudioShow,getCurrentAudio}` facade 유지. `applyAudioShow→parsePath` 위로 가는 엣지는 `window.parsePath`로 잠시 거침(PR5에서 해결) |
| 2 | **데이터 받기** ✅ | `loadBooks/Version/Chapter/Prologue`와 `booksCache`/`appVersion`/`DATA_DIR`/`getBooksCache` → `js/app/data-fetch.js` | leaf(의존 0). views-routing 안의 호출(loadBooks/Chapter/Prologue)은 명시 import, 바깥 소비자(search, app, bookmark, settings)의 facade는 data-fetch가 맡는다. `DATA_FETCHING` 마커와 유닛 테스트 슬라이스 경로를 함께 옮긴다 |
| 3 | **탭 인디케이터** ✅ | `syncTabBarActive`·`positionTabIndicator`·미끄러지는 인디케이터 상태·리사이즈/transitionend 리스너 → `js/app/tabbar.js`에 합침(탭 바 로직을 한곳에) | route()의 `window.syncTabBarActive?.()` facade 유지(tabbar↔views-routing 순환). tabbar의 `$searchBtn`·`exitSearch` 다시 쓰기, `$tabBar` 신규. 탭 인디케이터에는 마커 테스트가 없어 테스트 변경 0 |
| 4 | **Pull-to-refresh 제거(폐기)** | 164–342 `setupPullToRefresh` IIFE와 CSS `#pull-refresh-*` 삭제 | 사용자 결정(2026-06-08): 모바일의 「당겨서 새로 고침」은 Drive 동기화를 손으로 부르는 것이므로 없앤다. `driveSync.requestSync` API, 상태 기계, visibilitychange 자동 동기화, 편집할 때 자동 올리기 등 **백그라운드 동기화 로직은 모두 남긴다**(`requestSync`는 다른 경로도 부른다) |
| 5a | **라우팅 파일 분리** ✅ | parsePath·navigate·route·updatePageMeta·trackPageView·startScrollTracking과 링크 클릭/popstate 리스너 → `js/app/routing.js` | route()가 부르는 view 렌더러 8개(renderBookList/ChapterList/Chapter/Prologue/Loading/Error·divisionOrder·DIVISION_LABELS)는 views-routing에서 **명시 import**(routing→views 한 방향, 확인). search/bookmark/settings/citations 뷰와 오버레이는 facade 유지(순환). app.js와 search 등의 `window.route/navigate/parsePath`는 남는다 |
| 5b | **closeAllOverlays** ✅ | route()의 오버레이 정리 14개(`closeIfOpen` 12개와 settings/chapter popover)를 `js/app/overlay.js`의 `closeAllOverlays()` 하나로 줄인다. createOverlay가 모든 인스턴스를 registry에 등록하고, closeAllOverlays가 열린 것만 닫고 떨어진 패널을 걸러 낸다 | 안전 확인: 모든 close 함수가 순수한 `overlay.close()` 감싸기였다(추가 정리는 `onClose`라 controller.close()가 저절로 부른다). routing이 모듈 6개의 close 함수에 박혀 있던 의존을 없앴다 |
| 5c | registerView 뒤집기(보류 권장) | route()에서 바깥 뷰(search/bookmark/settings)로 가는 호출을 registry로 뒤집기 | **비용이 효용보다 크다.** 얕게 하면 이득이 작고(window facade를 registry 조회로 바꿀 뿐, route가 여전히 meta와 대체 경로를 조정한다), 깊게 하면 위험이 크다(검색 분기가 복잡하다. query/autoNav/filter, 모듈 셋에 흩어진다). 오디오 `applyAudioShow→window.parsePath` 엣지(parsePath가 division과 books에 얽혀 아래로 내리기가 깔끔하지 않다. applyAudioShow가 route 맥락을 인자로 받게)도 함께 검토한다. known-issues §2.1(`docs/known-issues.md`) |
| → | 남은 것을 `views.js`로 이름 바꿈 ✅ | 렌더 도우미와 Views. 라우팅, 오디오, 데이터, 탭이 모두 빠져 `views-routing`이라는 이름이 실제 내용(렌더와 Views)과 맞지 않아 `js/app/views.js`로 바꿨다(테스트도 `views.test.js`, ESM import, index.html, sw.js, 타입, 주석 참조를 한꺼번에 고쳤다) | |

PR5까지 마치면 남은 `views.js`는 약 1,300줄이다. 써 본 뒤 선택으로 PR6에서 내비 뷰(`views-list.js`)와 본문 뷰(`views-chapter.js`, `renderChapter` 470줄)를 더 나눌 수 있지만, 지나친 분할은 import 그래프만 키우므로 **PR5까지가 1차 목표이고 PR6는 보류**다.

## 테스트 하네스의 제약 (강한 결합)

`tests/unit/views-routing.test.js`·`bookmark.test.js`는 소스 파일 전체를 읽어 `// ── BEGIN X ──/END X ──` 마커로 **문자열을 잘라 vm으로 실행**한다(ADR-013). 잘라 낸 조각은 안쪽 stub으로 혼자 서므로 주변 코드와 상관없지만, **마커 블록을 새 파일로 옮기면 그 테스트 로더의 경로 상수(`VIEWS_PATH`)도 새 파일로 함께 고쳐야** 한다. 그래서:

- 분할 PR은 **소스와 테스트 파일을 한 묶음으로** 바꾼다.
- 오디오 영역에는 마커 테스트 블록이 없다(views-routing.test.js 머리: 「Audio Player remain out of scope」). PR1은 테스트를 바꾸지 않는다.
- 마커가 곧 추출 단위라 경계가 이미 분명하다(분할이 쉬운 쪽인 근거).

## 검증 (PR마다)

- `tsc -p tsconfig.json --noEmit`과 `tsconfig.worker.json` 0 error
- `node --test tests/unit/*.test.js` 모두 통과(옮긴 마커 블록의 로더 경로 갱신 포함)
- `index.html` 스크립트 태그 추가와 `sw.js` 셸 캐시 목록 항목 추가
- 로컬 SPA에서 콘솔 오류 0. 분할은 불러오는 순서나 ReferenceError 누락이 바로 실행 오류로 드러난다(ADR-018 §검증).
- PR5 머지 뒤 e2e를 한꺼번에 돌린다.

## 결과

- ADR-018에 이어 응집을 높이고 결합을 낮췄다. `window.X` facade는 분할 범위 밖의 호출자에게만 남았다가 뒤의 라운드에서 사라진다.
- `docs/architecture.md` 부록 A 인덱스와 부록 B 빠른 참조를 고쳤다.
- 처음에는 각 PR을 머지할 때 `docs/status.md`(구현 현황)에 한 줄을 적었다(status는 2026-06-08에 CLAUDE.md에서 떼어 냈다). status.md는 2026-10-23(#371)에 주제 문서의 「지금 동작」으로 나뉘어 들어가고 지워졌다.

## bookmark.js 분할

### 1라운드 — 모달, core, verse-spec (2026-06-08)

실제 구현은 **모듈 넷**으로 나뉘었고, 모달의 양방향 결합을 **의존성 주입**으로 끊는 방식이 핵심이 되었다.

**결과 모듈 (3,578 → bookmark.js 2,198줄, −38%):**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark.js` | 북마크 UI — 트리 렌더, 끌어 놓기, 선택 모드, 드로어, export | 약 2,200 |
| `js/app/bookmark-modals.js` | 모달 7종과 렌더 콜백 DI, 하나의 Escape 스택 | 약 1,010 |
| `js/app/bookmark-core.js` | DOM 없는 로직(QUERY, HREF/SHARE, SORT, ACTIVE) | 약 360 |
| `js/app/verse-spec.js` | 절 스펙 해석, 비교, 직렬화, 합치기(leaf) | 약 240 |

**핵심 결정 — 모달과 렌더의 순환을 의존성 주입으로 끊는다.** 모달은 확정할 때 트리와 헤더를 다시 그려야 한다(`bookmark.js → 모달 열기`, `모달 → 렌더 갱신`의 양방향 고리). 순환 import는 ADR-019 「ESM 평가 시점 ReferenceError 함정」의 부류라 tsc가 잡지 못하는 실행 오류 위험이 있다. 세 후보(① 의존성 주입 ② 순환 import 허용 ③ 이벤트 버스) 가운데 **①**을 골랐다. bookmark.js가 시작할 때 `initBookmarkModals({ rerenderActiveBookmarkTree, refreshBookmarkHeaderBtn, exitVerseSelectMode })`로 콜백을 넣어 주고, 모달은 bookmark.js를 가져오지 않아 고리가 구조적으로 끊긴다(약속은 tsc가 검증한다).

**Escape 스택.** 모달 7개가 우선순위의 맨 위에 이어진 블록이라, `bookmark-modals.js`의 `closeTopmostModal(e)` 하나가 z 순서대로 맡고, bookmark.js 라우터는 맡기기만 한다(`if (closeTopmostModal(e)) return;`).

**move는 선택 모드 UI라 인자로 일반화했다.** move 모달은 `_bmSelected`·`_bmAncestorSelected` 같은 선택 상태를 직접 읽어 범용 모달이 아니다. 계속 쓰는 DI로 select 내부를 `_deps`에 넣으면 약속이 지저분해지므로, **호출 인자**(`openMoveModal({ excludeFolder, onPick })`)로 일반화했다. select 로직은 bookmark.js에 남고 picker는 순수 UI다. 「select를 통째로 `bookmark-select.js`로 나누기」는 트리 렌더와 select의 양방향 결합 때문에 이때는 미뤘고, 2026-06-11에 했다(아래).

**PR 순서:** 5a confirm·chapter-delete → 5b 폴더 콤보박스·새 폴더 → 5c save·merge(서로 결합) → 5d import → 5e move(인자로 일반화) → 죽은 facade와 쓰지 않는 import 정리. 각 PR은 표준 검증 묶음(tsc main과 worker, 유닛, **playwright 로드 검사**(facade나 DI가 깨진 것을 잡는다), e2e)을 거쳤고, 단계마다 쓰지 않는 import를 정리했다.

**정리 PR:** 모달을 나눈 뒤 아무도 부르지 않게 된 `window.close*Modal` facade 7종과 bookmark-core QUERY facade 7종(types.d.ts의 Window와 전역 선언 포함), 쓰지 않는 core import를, 저장소 전체 grep과 로드 검사로 아무도 부르지 않음을 확인한 뒤 지웠다.

`bookmark-core.js`의 QUERY 도우미는 ADR-019 원칙(순환하지 않는 연결은 명시 import)대로 **window facade 없이 ESM import로만** 쓴다. PR3에서 옛 전역 이름 약속 때문에 잠시 facade를 두었다가, 정리 PR에서 아무도 부르지 않음을 확인하고 지웠다. 그 뒤 폴더 모아 읽기(`bookmark-read.js`, ADR-035)도 따로 나눴다.

### 2라운드 — bookmark-gestures.js (2026-06-11)

모달 라운드 뒤에도 bookmark.js는 폴더 모아 읽기(`bookmark-read.js`)를 나누고서도 다시 2,432줄까지 커졌다. 남은 라운드(트리, 메뉴, 선택, 제스처)의 **첫 모듈로 제스처 엔진을 나눈다.** 가장 혼자 서 있고 이미 마커 테스트가 잡고 있어 위험이 가장 낮다(오디오 플레이어가 views-routing 분할의 첫 후보였던 것과 같은 역할이다).

**결과 (2,432 → bookmark.js 1,952줄, −20%):**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark-gestures.js` | 제스처 엔진 — 끌어서 순서 바꾸기(DRAG_CORE와 인디케이터), 모바일 스와이프 동작 상태(SWIPED_ROW), 스와이프를 놓을 때의 계산(SWIPE_GESTURE), 통합 포인터 핸들러(`_setupDragHandle`) | 541 |

**핵심 결정 — 조정자 쪽으로 가는 반대 방향 의존 둘을 의존성 주입으로 끊는다.** 제스처 핸들러는 (a) 순서를 바꾼 뒤 붙어 있는 북마크 화면 다시 그리기, (b) 선택 모드인지 읽기가 필요하다. 둘 다 bookmark.js(조정자)가 맡는다. bookmark.js가 `_setupDragHandle`을 import하므로, 제스처가 bookmark.js를 되받아 가져오면 순환이 된다. 모달 라운드의 `initBookmarkModals` 선례대로 `initBookmarkGestures({ rerenderTree, isSelectMode })`로 두 고리를 시작할 때 넣어 준다. 제스처는 leaf로 남고(의존: appStorage, bookmark-core뿐), 고리가 구조적으로 끊긴다.

**select 상태(`_bmSelectMode`/`_bmSelected`)는 이때 bookmark.js에 남겼다.** SWIPED_ROW 마커 안에 끼어 있었지만 실제로는 선택 모드의 상태다(제스처는 읽기만 하고, 쓰기는 enter/exit가 한다). 다음 라운드(`bookmark-select.js`)가 맡을 예정이라, 이번에는 조정자에 두고 `isSelectMode` 게터로만 내놓았다.

**테스트 하네스.** DRAG_CORE / SWIPED_ROW / SWIPE_GESTURE 마커 셋이 새 파일로 옮겨 갔다. `bookmark.test.js`의 세 로더가 `BOOKMARK_GESTURES_SOURCE`에서 잘라 내게 고쳤다. DRAG_CORE prelude의 `_rerenderActiveBookmarkTree` stub은 넣어 주는 고리 이름 `_rerenderTree`로 바꿨다. 표준 검증 묶음(tsc, 유닛 728, playwright 로드 스모크, e2e dnd와 swipe 14)을 통과했다.

**뒤에 드러난 회귀 (#276):** 이 라운드에서 `_isDescendant`(순수 트리 도우미)를 gestures로 옮기며 export를 빠뜨려, bookmark.js의 `_moveSelectedToFolder`가 그 이름을 맨이름으로 참조했다. 그래서 선택 모드에서 **폴더를 폴더로 옮기면** `ReferenceError`가 났다. 폴더 분기(`type==="folder"`)에서만 불려, tsc, 유닛, 로드 스모크, 기존 move e2e(북마크만 옮김)가 모두 잡지 못했다. export를 더하고 폴더 이동 회귀 e2e(`test_move_folder_into_folder`)를 더해 고쳤다. 배운 것: 함수를 뺄 때 **내보내지 않는 안쪽 도우미까지** 원래 파일의 남은 코드에서 grep으로 찾고, 조건 분기 뒤의 참조는 그 경로를 돌리는 e2e로 지킨다(pitfalls §39).

남은 라운드: 선택 삭제 모드(`bookmark-select.js`. 트리 렌더와 select의 양방향 결합이 관문이다. 위 move 일반화 참조), 절 선택 모드(`bookmark-verse-select.js`), 트리 렌더와 ⋯ 메뉴.

### 3라운드 — bookmark-select.js (2026-06-11)

모달 라운드에서 「select를 통째로 나누는 것은 트리 렌더와 select의 양방향 결합 때문에 보류」라고 적었던 그 라운드를, 제스처와 모달과 같은 방식으로 결합을 끊어 진행한다.

**결과 (1,952 → bookmark.js 1,652줄, −15%):**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark-select.js` | 선택 삭제 모드 — 상태(`_bmSelectMode`/`_bmSelected`), 하위까지 따라가는 계산(BOOKMARK_SELECT, 테스트), 수명과 토글과 chrome, 삭제·공유·이동 동작, `#bm-select-bar` dock 참조와 리스너 | 362 |

**핵심 결정 — 트리 렌더와 select의 양방향을 import(한 방향)와 주입(반대 방향)으로 나눈다.**
- **조정자 → select (명시 import):** bookmark.js가 `_bmSelectMode`(ESM **live binding**. 트리 빌더, keydown, 헤더 갱신이 읽는다)와 부를 핸들러(`_toggleBmSelect`·`enter/exitBookmarkSelectMode`·`_bmToggleSelectAll`·`_syncBmSelectChrome`)를 가져온다.
- **select → 조정자 (의존성 주입):** 삭제와 이동 뒤의 다시 그리기와 헤더 갱신을 `initBookmarkSelect({ rerenderTree, refreshHeaderBtn })`로 넣어 준다. select는 bookmark.js를 가져오지 않아 고리가 끊긴다.

그래서 제스처 라운드에서 bookmark.js에 남겼던 `_bmSelectMode`가 이 라운드에서 select로 옮겨 갔다. gestures의 `isSelectMode` 고리는 bookmark.js가 **import한 live binding**을 그대로 읽어 바뀌지 않았다. select의 chrome 조작(`_syncBmSelectChrome`/exit)은 모두 셀렉터 기반(`.bm-select-circle`, `#bookmarks-view-tree`)이라 DOM 참조를 넣어 주지 않아도 혼자 선다.

**정리.** 옮기면서 아무도 부르지 않게 된 bookmark.js의 bookmark-core import 4종(`_descendantIds`·`_selectAllState`·`_bmSelectCountLabel`·`_buildSharePayload`)과, gestures의 `_isDescendant` import(#276에서 더했으나 쓰는 쪽이 select로 옮겨 갔다)를 지웠다.

**테스트 하네스.** BOOKMARK_SELECT 마커가 새 파일로 옮겨 갔다. `bookmark.test.js` 로더가 `BOOKMARK_SELECT_SOURCE`에서 잘라 낸다. 표준 검증 묶음(tsc main과 worker, 유닛 728, 로드 스모크, e2e: select-delete 전체와 dnd와 swipe 26)을 통과했다(전부터 실패: `test_bookmark_folders.py` 폴더 토글 2건, base와 같고 headless 포인터 계열).

남은 라운드: 절 선택 모드(`bookmark-verse-select.js`), 트리 렌더와 ⋯ 메뉴. `_isDescendant`를 본래 자리인 bookmark-core로 옮기는 정리도 그때 함께 한다.

### 4라운드 — bookmark-verse-select.js (2026-06-11)

읽기 화면의 절 선택 모드(절을 누르면 강조하고 북마크나 복사)를 나눈다. 앞의 두 라운드와 달리 **조정자를 다시 부르지 않는 거의 leaf**라 가장 단순하다.

**결과 (1,652 → bookmark.js 1,546줄, −6%):**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark-verse-select.js` | 절 선택 모드 — enter/exit, `#verse-select-bar` dock(spec 표시, 북마크, 복사), 붙어 있는 선택의 모서리 합치기(`updateVerseSelectionBoundaries`), 인용을 포함한 복사(`copySelectedVerses`)와 dock 리스너 | 144 |

**핵심 — DI가 없다.** 함수 다섯 개 가운데 어느 것도 북마크 트리나 조정자를 부르지 않는다(절 선택은 읽기 화면 DOM과 `readingContext`만 다룬다). 의존은 모두 아래로 간다. verse-spec(spec 만들기와 직렬화, import), bookmark-modals(`openSaveModal("verses")`, import), `window.{readingContext, getBooksCache, _showSyncSnackbar, announce}`다. 그래서 넣어 주는 고리 없이 export만으로 충분하다. bookmark.js는 enter/exit와 bar/boundary 갱신 함수 4개를 import해, 드로어 버튼, keydown, 모달 주입(`initBookmarkModals({ exitVerseSelectMode })`), window facade에 잇는다.

**테스트 하네스.** 마커 블록이 없다(절 선택은 DOM에 묶여 유닛으로 잘라 낼 대상이 아니었다). 그래서 `bookmark.test.js`는 바뀌지 않았다. 표준 검증(tsc main과 worker, 유닛 728, 로드 스모크, e2e: copy, features, a11y-keyboard, bookmark 23)을 통과했다.

남은 라운드: 트리 렌더와 ⋯ 메뉴(가장 큰 덩어리이고, 상태와 제스처에 강하게 묶여 있다). 나눈 뒤 bookmark.js는 드로어와 헤더의 조정자로 모인다. `_isDescendant`를 bookmark-core로 옮기는 정리도 그때 한다.

### 5라운드 — bookmark-menu.js (마지막 라운드 1/2, 2026-06-11)

마지막 덩어리(트리 렌더와 ⋯ 메뉴, 약 930줄)는 한 PR로 빼기에는 결합과 리뷰 범위가 커서 **PR 둘로 나눴다.** 혼자 서는 ⋯ 메뉴를 먼저, 가장 깊은 트리 렌더를 다음에 했다. 이 라운드는 메뉴다.

**결과 (1,546 → bookmark.js 1,145줄, −26%):**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark-menu.js` | 탭 뷰 제목줄 동작 — ⋯ 더 보기 메뉴(새 폴더, 내보내기, 가져오기, 선택)와 정렬 기준·오름내림 radio 묶음, 🛈 안내 팝오버, 전체 선택 토글(`buildBmViewActions`), `exportBookmarks`(plain JSON 내려받기) | 442 |

**핵심 — 넣어 주는 고리 하나로 충분하다.** 메뉴가 조정자에게서 필요한 것은 정렬을 바꾸거나 새 폴더를 만든 뒤의 트리 다시 그리기(`_rerenderActiveBookmarkTree`)뿐이다. 그래서 `initBookmarkMenu({ rerenderTree })` 하나를 넣어 준다. 나머지는 모두 아래로 가져온다. bookmark-core(정렬 설정), bookmark-modals(새 폴더, 가져오기), bookmark-select(선택 진입, 전체 선택)다. `renderBookmarksView`(이때는 bookmark.js)가 `buildBmViewActions()`를 가져와 제목줄에 붙인다.

**`exportBookmarks`는 menu로 옮겼다.** 메뉴의 내보내기와 드로어의 `#bm-export-btn` 양쪽이 쓰는 leaf 도구다(조정자 의존 0). menu가 맡고, bookmark.js가 `#bm-export-btn` 리스너를 위해 거꾸로 가져온다(한 방향, 순환 없음).

**`BOOKMARK_ADD_HELP`는 bookmark-core로 옮겼다.** 빈 상태 자리 표시(트리, 이때는 bookmark.js)와 메뉴의 🛈 팝오버가 함께 쓰는 DOM 없는 문자열 상수라, 중립 leaf인 core가 맡고 양쪽이 가져온다(다음 트리 라운드와도 맞는다). 정리하면서 아무도 부르지 않게 된 core import 3종(`setBookmarkSort`·`getBookmarkSortDir`·`setBookmarkSortDir`)과 select의 `_bmToggleSelectAll`을 지웠다.

**테스트.** 마커 블록이 없어 `bookmark.test.js`는 바뀌지 않았다. tsc(main과 worker), 유닛 728, 로드 스모크(⋯와 🛈 그리기), e2e(select-delete의 ⋯ 진입, add-help 🛈, export-import, bookmark, folders. 전부터 실패한 2건 빼고 모두)를 통과했다.

남은 라운드(2/2): 트리 렌더(`bookmark-tree.js`). 빌더와 `renderBookmarkTree`/`_rerenderActiveBookmarkTree`(주입의 중심), 키보드 내비다. `_isDescendant`를 core로 옮기는 정리도 그때 한다.

### 6라운드 — bookmark-tree.js (마지막 라운드 2/2, 2026-06-11) — 분할 완료

마지막 덩어리이고 결합이 가장 깊다. 트리 렌더 전부를 나눠, bookmark.js를 드로어와 헤더의 조정자로 모은다.

**결과 (1,145 → bookmark.js 589줄, −49%). 전체 분할 합계: 2,432 → 589줄 (−76%).**

| 파일 | 역할 | 라인 |
|---|---|---|
| `js/app/bookmark-tree.js` | 행마다의 빌더(bookmark/folder item, swipe action, drag handle, select circle, folder read btn, empty state)와 `renderBookmarkTree`(드로어 body 또는 #bookmarks-view-tree), `_rerenderActiveBookmarkTree`(다시 그리기의 중심), `renderBookmarksView`, 드로어 body 키보드 내비(roving tabindex, 방향키, Enter), swipe-outside pointerdown | 628 |

**핵심 — 반대 방향 셋만 넣어 주고, 나머지는 모두 아래로 가져온다.** 트리 렌더러가 조정자에게서 필요한 것은 `closeBookmarkDrawer`(링크나 폴더 읽기를 누르면 드로어 닫기), `refreshBookmarkHeaderBtn`(읽기 헤더 갱신), `_setBookmarkBtnIcon`(빈 상태 glyph, 헤더 버튼과 함께 쓴다)의 셋뿐이다. 그래서 `initBookmarkTree()`로 넣어 준다. **넣어 주는 고리를 빌더가 부르던 원래 이름 그대로 `let`으로 선언해**, 옮긴 본문은 한 줄도 고치지 않았다. `$bookmarkDrawerBody`(그리는 대상이자 내비의 뿌리)는 트리 전용이라 tree가 맡는다. `_rerenderActiveBookmarkTree`가 tree로 가면서, gesture/select/menu의 `rerenderTree` 주입은 bookmark.js가 가져와 그대로 넘긴다(여전히 순환이라 주입을 남긴다).

**정리.** 트리가 가져가면서 아무도 부르지 않게 된 bookmark.js의 import를 많이 지웠다. bookmark-core는 `findExistingChapterBookmarks` 하나만 남겼다(나머지 13종). 그 밖에 select의 `_toggleBmSelect`/`_syncBmSelectChrome`, menu의 `buildBmViewActions`, appHelpers의 `clearNode`/`chUnit`/`emptyState`를 지웠다.

**검증에서 배운 것 (중요).** 처음 tree.js에서 **import 8개를 통째로 빠뜨렸는데**(`setRenderPathname`·`saveBookmarks`·`openSaveModal`·`openConfirmModal`·core 4종) **tsc와 worker tsc가 모두 통과했다.** checkJs가 선언되지 않은 이름을 전역으로 보고 넘어가는 사각지대다(ADR-019 계열). **로드 스모크가 렌더 경로(`setRenderPathname`)를, 동작 e2e가 모달 경로(`openSaveModal` 등)를** 잡았다. 대상 모듈의 _모든_ export를 본문에서 한꺼번에 grep으로 찾아 import를 끌어내야 한다. 처음에는 `docs/known-issues.md`에서 추적하기로 했고, 지금 이 함정은 pitfalls §39(`docs/topics/platform.md`)에 있다.

**테스트.** 마커 블록이 없어 `bookmark.test.js`는 바뀌지 않았다. tsc(main과 worker), 유닛 728, 로드 스모크(드로어와 전체 뷰 트리 그리기), e2e 78 통과(bookmark, edit, swipe, dnd, select-delete, add-help, export-import, copy와 folders. 전부터 실패한 2건 제외).

### 뒤의 정리 (2026-06-11): `_isDescendant`를 bookmark-core로

순수 트리 술어 `_isDescendant`(폴더가 그 id를 하위에 품는지)를 `bookmark-gestures.js`의 DRAG_CORE 블록에서 본래 자리인 `bookmark-core.js`의 BOOKMARK_QUERY 블록으로 옮겼다. gestures(moveBookmarkItem)와 select(_moveSelectedToFolder)가 함께 쓰는 도우미라 core가 맞는 자리다. gestures와 select가 core에서 가져오고, gestures의 export에서는 뺐다. 테스트: QUERY 블록에 들어가, DRAG_CORE 로더(QUERY를 먼저 붙인다)가 moveBookmarkItem 호출을 그대로 해결한다. `_isDescendant` 단위 테스트는 QUERY 로더로 옮겼다. tsc, 유닛 728, 로드 스모크, e2e 8(folder-move 회귀, folder-exclude, dnd)을 통과했다.
