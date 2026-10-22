# 앱 뼈대, 모듈, 타입, 테스트, 저장소 구성

소유 코드: `js/app.js`, `js/app/helpers.js`, `js/app/storage.js`, `js/types.d.ts`, `js/gtag-init.js`, `js/pre-fetch.js`

부팅과 모듈 구조(ESM), 여러 주제가 함께 쓰는 도우미와 저장소 모듈, 타입 검사, 유닛과 e2e 테스트, 네 저장소의 구성, 보안 헤더를 다룬다.

## 지금 동작

- **Phase 1 완료** — 성경 읽기 PWA: 73권, 오프라인, 검색, 오디오, 접근성. 검색 UI 재설계도 포함(ADR-005)
- **테스트 체계 완료** — ADR-004 데이터 파이프라인(Level 1-3, data 저장소) + e2e + ADR-013 유닛 537 케이스. 유닛은 vm + 수동 스텁(0 의존성), DOM-heavy 영역은 e2e가 책임
- **TypeScript 점진 도입 — 앱 모듈은 모두 검사, `sw.js`만 남음** — ADR-012. JSDoc + `tsc --noEmit`, `js/`의 모든 클라이언트 JS를 검사한다(`checkJs: true`, 2026-10-17) — CI의 필수 「Unit tests」 잡이 `npm run typecheck`(앱 · 워커 설정 둘)를 돌려 0 error가 머지 전제다. 파일마다 지시문으로 켜던 때 지시문이 둘째 줄이라 검사 밖이던 22개는 2026-10-17 묶음 ① 16개, 2026-10-18 묶음 ② 2개(`views` · `search`) · 묶음 ③ 4개(bookmark 계열)로 모두 들였고, `// @ts-nocheck`로 빠진 파일은 없다. 서비스 워커 `sw.js`는 아직 어느 설정에도 들지 않는다 — `known-issues.md` §7
- **app.js 모듈 분할 완료** — ADR-018, 2026-05-10. `js/app.js` 6,082 → 283줄, 9개 도메인 모듈, ESM(ADR-019). 상세는 `docs/archive/design/app-modularization.md`
- **2차 모듈 분할 완료 (PR5c 보류)** — ADR-034, 2026-06-08 ~ 06-11. ADR-018이 남긴 비대 모듈(`views-routing.js` 2,389줄·`bookmark.js` 3,578줄)을 관심사별로 재분할 + 비순환 facade를 명시 import로 전환(순환 dispatch는 registry 역전). PR1: 오디오 플레이어를 `js/app/audio-player.js`로 분리(views-routing 2,389→2,195줄), `route`측 호출은 명시 import, 외부 호출자용 `window.{hideAudioBar,applyAudioShow,getCurrentAudio}` facade 유지. PR4: 모바일 "당겨서 새로고침"(수동 Drive 동기화 트리거) **제거**(폐기) — 백그라운드 동기화(자동 폴·편집 업로드·visibilitychange)는 유지, views-routing 2,195→2,011줄. PR2: 데이터 페칭(loadBooks/Version/Chapter/Prologue + booksCache/appVersion 캐시)을 `js/app/data-fetch.js`(leaf)로 분리, 내부 호출은 명시 import·외부 소비자 facade 유지, views-routing 2,011→1,942줄. PR3: 탭 활성 상태+슬라이딩 인디케이터(`syncTabBarActive`·`positionTabIndicator`)를 `js/app/tabbar.js`로 병합(탭 바 로직 일원화), route()→`window.syncTabBarActive` facade(tabbar↔views 순환), views-routing 1,942→1,831줄. PR5a: 라우팅(parsePath·navigate·route·page meta·스크롤 추적·링크클릭/popstate 리스너)을 `js/app/routing.js`로 분리 — route()가 부르는 view 렌더러 8개는 views-routing에서 명시 import(단방향), search/bookmark/settings/citations는 facade 유지(순환), views-routing 1,831→1,354줄(2,389→1,354, −43%). PR5b: route()의 14개 오버레이 teardown(12 `closeIfOpen` + settings/chapter popover)을 `js/app/overlay.js`의 `closeAllOverlays()` 하나로 축약(createOverlay가 인스턴스를 registry 등록, 열린 것만 close + detached prune), routing→6모듈 close fn 하드코딩 의존 제거. 남은 PR5c(registerView 역전)는 **비용>효용으로 보류 권장** — 상세 `docs/known-issues.md`. **bookmark.js 분할(별도 라운드, 완료)**: 3,578줄을 4모듈로 — 모달 7종(confirm·chapter-delete·새 폴더·콤보박스·save/edit·merge·import·move picker)을 `bookmark-modals.js`로(렌더 콜백 **의존성 주입**으로 모달↔렌더 순환 차단, 단일 `closeTopmostModal` Escape 스택), DOM-free 로직을 `bookmark-core.js`로, 절 스펙을 `verse-spec.js`(leaf)로 분리 → `bookmark.js` **2,198줄(−38%)**. move 모달은 select 상태(`_bmSelected`)를 읽어 `openMoveModal({excludeFolder,onPick})`로 파라미터화(select 로직은 잔류). 마무리로 무참조가 된 `window.close*Modal`·QUERY facade·미사용 import를 grep+로드검사 확증 후 제거. **2라운드(2026-06-11)에서 마저 갈랐다** — 제스처·선택 삭제·절 선택·⋯ 메뉴·트리 렌더를 `bookmark-{gestures,select,verse-select,menu,tree}.js` 로 떼어 `bookmark.js` 가 **589줄**(최초 3,578 대비 −84%)이 되고 드로어/헤더 오케스트레이터로 수렴했다. `views-routing.js` 는 이 과정에서 사라졌다 — `routing.js`·`views.js` 등으로 분해됐다. 남은 것은 PR5c 하나이고 단독 진행은 보류다. 상세는 [ADR-034](../decisions/034-views-routing-second-split.md) 개정.
- **보안 헤더 6종 통합 완료** — 2026-05-08. nginx server-level snippet, 두 vhost(dev/prod) 모두 적용. `common-bible-server/nginx/security-headers.example.conf` 참조
- **모노레포 4분할 완료** — ADR-020, 2026-05-11. 앱·데이터·오디오·서버 4개 저장소. data는 본 저장소 `data/`에 직접 서브모듈, audio는 data 안에 nested 서브모듈, server는 별도 clone

## 결정

- ADR-001 「SPA 아키텍처 선택」
- ADR-018 「app.js 모듈 분할」
- ADR-019 「ESM 모듈 시스템 채택」
- ADR-034 「뷰·라우팅·북마크 2차 분할」
- ADR-012 「TypeScript 점진 도입」
- ADR-013 「클라이언트 JS 유닛 테스트 전략」
- ADR-004 「데이터 파이프라인 테스트 전략」
- ADR-015 「클라이언트 스토리지 전략」
- ADR-020 「모노레포 4분할」
- 모듈 지도는 `architecture.md` §4와 부록 B, 테스트 규약은 `tests/README.md`에 있다.

## 함정

### pitfalls §16 — 모듈 init 시점 `window.X` facade 미정의 — 로드 순서 race

`<script type="module">` 들은 index.html 의 나열 순서대로 평가된다. 어떤 모듈이 **init(top-level) 코드에서** 다른 모듈이 `window.X` 로 노출하는 함수를 소비하면, 그 함수를 정의하는 모듈이 **뒤에** 실려 있을 때 init 시점엔 `undefined` 다. 한 번 검사하고 즉시 bail 하면 이후 그 함수가 정의돼도 재시도가 없어 상태가 영구히 비어버린다.

**사례:**
- `53cb24d` (#246) — search.js 가 부팅 시 `ensureAliasMap()` 으로 `in:<별칭>` 흡수용 `_aliasMap` 을 예열하는데, `window.loadBooks`(data-fetch.js)는 search.js *뒤*에 로드되는 모듈이라 예열 시점엔 undefined. `if (typeof window.loadBooks !== "function") return` 로 즉시 bail → `_aliasMap` 영구 null → `사랑 in:요한` 입력이 책 칩으로 흡수되지 않고 raw 텍스트로 남는 회귀. 동기 흡수 리팩터가 commit 시점의 `await ensureAliasMap()` 을 부팅 예열로 옮기며 로드 순서 가정을 깬 것이 원인.

**규칙:**
- init 에서 소비하는 `window.X` 가 **뒤에 로드되는 모듈** 소속인지 확인한다. 그렇다면 한 번 bail 하지 말고 정의될 때까지 짧게 대기 후 진행하거나, 소비 시점(이벤트·커밋 핸들러)으로 미룬다.
- 이런 로드 순서 race 는 vm 유닛 하네스가 `window.X` 를 미리 스텁하므로 **유닛 테스트로 안 잡힌다.** 실제 모듈 순서로 로드하는 브라우저 스모크로 검증한다.

### pitfalls §27 — 타입 검사가 조용히 꺼져 있었다 — `// @ts-check` 가 문 뒤에 있던 파일들, 선언이 데이터 · 코드와 어긋난 채 쌓였다 (2026-10-17)

검사를 파일마다 `// @ts-check` 로 켜던 때(`checkJs: false`)에는 지시문 앞에 `"use strict";` 같은 문(statement)이 있으면 TypeScript 가 지시문을 읽지 않고 그 파일을 **오류 없이** 뺐다 — `npm run typecheck` 가 0 이어도 그 파일은 검사받지 않은 것이었고(앞에 주석만 있는 것은 괜찮다), CI 는 타입 검사를 돌리지 않았다. 검사 밖에서는 `js/types.d.ts` 의 선언이 실제 데이터 · 코드와 어긋나도 아무도 모른다. 2026-10-17(PR #353 리뷰)부터 `checkJs: true` 로 `js/` 전체를 기본으로 검사하고, 필수 CI 「Unit tests」 잡이 타입 검사를 돌린다(ADR-012).

**사례:**
- `lectionary.js`(#346) — 975줄이 검사 밖이었다(원장 `docs/changes/2026-10-12-lectionary-view.md` 3회차 ①).
- 22개 파일(2026-10-15 발견 — `known-issues.md` §7) — 묶음 ① 16개를 켜자 44건(원장 `docs/changes/2026-10-17-typecheck-batch-1.md`): `BookEntry.division` 에 데이터의 `"liturgical"`(전례시편 · 송가)이 없었고, `BibleVerse.chapter_ref` 는 데이터가 정수인데 `string` 이었고, `AppStorage` 에 `loadCiteShow` · `saveCiteShow` 가, Window 에 창 객체 다섯이 빠져 있었고, `parsePath()` 의 전역 선언은 `any` 였다. 그 자체로 실행 결함은 아니었지만 선언을 믿고 짠 새 코드가 틀릴 자리였다.
- 같은 묶음 — JSDoc 블록과 함수 사이에 `const` 하나가 끼어 매개변수 타입이 함수에 붙지 않았고(citations.js `wrapNoteAnchorsInArticle`), `@param {T} [이름] — 설명`(대괄호 이름 바로 뒤 줄표)은 TS 가 「Invalid character」(TS1127)로 읽었다.
- 같은 묶음의 리뷰 — `division` 타입에 `"liturgical"` 을 넣어 선언은 바로잡았지만, 그 값으로 경로를 만드는 곳(`` `/${effectiveDivision(book)}` `` — 헤더 집 단추 · 탭 바 홈)은 그대로라 전례시편 · 송가에서 없는 `/liturgical` 로 갔다(main 부터). 타입은 문자열 이어 붙이기를 막지 않는다.
- 묶음 ②(`views` · `search`, 2026-10-18 — 원장 `docs/changes/2026-10-18-typecheck-batch-2.md`) — `appendVerses`가 `chapter`를 null 기본값으로 받아 `findParallelsStartingAt(…, chapter)`에 넘겼는데, 받는 쪽은 `currentChapter`가 `undefined`일 때만 장 비교를 건너뛴다. null이 오면 모든 범위가 장 비교에 걸려 ※(평행 본문) 표시가 모두 빠진다. 평행 본문을 넘기는 호출부(장 화면)는 장 번호를 늘 함께 넘겨 아직 밟지 않았다 — `number | null`을 `number | undefined` 자리에 넘긴다는 타입 오류가 그 어긋남을 드러냈다.
- 묶음 ③(북마크 모듈 넷, 2026-10-18 — 원장 `docs/changes/2026-10-18-typecheck-batch-3.md`) — 함수와 떨어진 JSDoc이 둘 더 나왔다. `openMergeDialog`의 블록 아래에 `const mergeOverlay`가 끼어 블록이 오버레이 선언에 붙었고(그래서 `fallbackContext = null`이 `null` 타입이 되어 `{ bookId, chapter }`를 넘기는 호출이 걸렸다), `renderBookmarkTree`의 블록은 다른 함수(`_buildEmptyState`) 위에 있어 TS8024(「`target`이라는 매개변수가 없다」)로 드러났다. 객체 리터럴로 만든 네임스페이스 객체 `window.appBookmark`의 선언(`AppBookmark`)은 verse-spec.js로 옮겨 간 함수 넷을 들고 실제 멤버 스물 가운데 열셋을 빠뜨린 채였다 — 읽는 곳이 없어 아무도 몰랐다.

**규칙:**
- 검사에서 빼는 파일은 첫 줄 `// @ts-nocheck`(어떤 문보다 앞) + 같은 줄에 이유와 고칠 곳. 고치는 PR 이 그 줄을 지운다. 그 줄을 문 뒤에 두면 무시돼 파일이 검사되고 오류로 드러난다 — 빼는 쪽의 실수가 조용하지 않다(ADR-012 「파일 헤더」).
- 검사 장치는 「켜는 쪽」이 아니라 「빼는 쪽」을 명시하게 두고, 필수 CI 에서 돌린다 — 꺼진 줄 모르는 검사가 가장 비싸다. 설정이나 네임스페이스 객체의 반환 타입을 바꿀 때는 타입 오류를 일부러 하나 넣어 그 파일에서 잡히는지 본다.
- `window`에 거는 네임스페이스 객체(`window.appX = (() => { … })()`)의 IIFE에는 `@returns {AppX}`를 단다 — 인터페이스에 없는 멤버가 받는 쪽이 아니라 정의한 자리에서 걸린다. 객체 리터럴로 만든 네임스페이스 객체(`const appX = { … }`)에는 `@type {AppX}`를 단다.
- JSDoc 블록과 그 함수 사이에 다른 선언을 두지 않는다 — 블록은 바로 다음 선언에 붙는다. 매개변수 이름이 맞지 않으면 TS8024로 드러나지만, 이름이 우연히 같거나 다음 선언이 `const`면 조용히 엉뚱한 곳에 붙는다(묶음 ① · ③에서 세 번).
- 데이터 모양의 타입을 고칠 때는 파이프라인(`data/src/parser.py` 등)의 필드 타입과 실제 JSON 을 함께 대조하고, 타입을 넓혔으면(새 값) 그 값을 **쓰는 곳**이 새 값을 다루는지 `grep` 으로 함께 본다 — 경로 · 표시 문자열 · 표 색인.
- 선택 매개변수(`@param {T} [x]`)는 `undefined`만 「없음」으로 받는다. 넘기는 쪽이 null을 「없음」으로 쓰면 `!== undefined`로 가르는 받는 쪽과 조용히 갈린다 — 넘기는 쪽의 null 기본값을 없애거나 받는 쪽을 `!= null`로 맞추고, 두 쪽의 타입을 그대로 적어 검사가 잡게 한다.

### pitfalls §39 — 함수를 다른 모듈로 옮기면 facade, 네임스페이스 객체, export 세 곳과 숨은 참조를 함께 정리한다 (2026-06-08 · 06-11)

`js/app/` 모듈에서 함수를 다른 파일로 옮길 때, 그 이름은 보통 세 곳에 나온다. `window.X = X` facade, `appX` 네임스페이스 객체(`const appBookmark = { X, … }`), ESM `export { X, … }` 블록이다. 셋을 모두 옮기거나 지워야 한다. 2026-06의 기록이다. 그 뒤 타입 검사를 모든 js 파일에 기본으로 켰지만(pitfalls §27, #353), 같은 사각지대가 지금도 있는지는 확인하지 않았다.

**사례:**
- 2026-06-08 verse-spec 분리: 옮긴 함수가 `export {}`에 남았다. 그 이름이 `types.d.ts`에 전역으로 선언돼 있어 tsc는 통과했지만, 브라우저 ESM은 `export {name}`에 모듈 안의 바인딩을 요구해 `Uncaught SyntaxError: Export 'name' is not defined in module`로 모듈을 만들지 못했다. 앱 전체가 뜨지 않았고, e2e는 모두 시간 초과로만 보여 원인이 드러나지 않았다.
- 2026-06-11 bookmark-tree 분리(PR5): 새 모듈에서 import 8개(`setRenderPathname`, `saveBookmarks`, `openSaveModal` 등)를 통째로 빠뜨렸는데 tsc와 worker tsc가 모두 통과했다. 이 이름들이 전역으로 선언돼 있어 tsc는 전역으로 읽었지만, 런타임에는 `ReferenceError`가 났다.
- 2026-06-11 bookmark-gestures 분리(#275, #276에서 고침): 옮긴 모듈의 export하지 않은 헬퍼(`_isDescendant`)를 원래 파일의 `_moveSelectedToFolder`가 그대로 불렀다. tsc, 유닛, 로드 스모크 모두 잡지 못했다. 폴더를 폴더로 옮기는 경로가 실행되지 않았기 때문이다.

**규칙:**
- tsc 통과는 import가 빠짐없다는 뜻이 아니다. 모듈을 나누는 PR은 playwright 로드 스모크(페이지를 연 뒤 `pageerror`를 모으고 `#app`이 그려졌는지 확인)와, 조건 경로를 실제로 밟는 상호작용 e2e(편집, 삭제, 모달, 폴더 이동)로 검증한다.
- 의존 관계는 정해 둔 후보 목록으로 찾지 않는다. 옮기는 모듈의 export 전체를 그 본문에 grep해서 찾는다.
- 공개 이름뿐 아니라 옮기는 파일의 모든 정의(특히 `_`로 시작하는 내부 헬퍼)를 원래 파일의 남은 코드에 grep해, 남은 참조가 없는지 본다.

## 남은 일

### known-issues §2.1 — PR5c — `registerView` dispatch 역전 트레이드오프 (2026-06-08 검토)

결론: **단독 투기성 PR로는 하지 말고, Phase 2 라우트 추가 또는 설정 화면 재구성에 얹어서 진행.**

**전제 (실측)**
- PR5a 이후 routing.js는 search/bookmark/settings를 ESM import하지 않고 `window` facade로 호출 → **구조적 import 사이클은 이미 없다.** registerView가 고칠 구조적 문제(순환 import·로드 순서·tsc 에러)는 없고, 남은 건 전역 네임스페이스 경유의 *논리적* 결합뿐.
- routing→타모듈 호출 9개 = 뷰 렌더러 3~4(`renderSearchResults`·`renderSearchView`·`renderBookmarksView`·`renderSettingsView`) + 오케스트레이션 헬퍼 5(`consumeSearchAutoNavigate`·`isMobile`·`openBookmarkDrawer`·`exitVerseSelectMode`·`exitBookmarkSelectMode`). registry는 렌더러만 대상; 헬퍼·분기 로직은 잔존.
- 역방향: **search→routing 21회**, bookmark 5, settings 3 — 결과 클릭→`navigate()`, 재렌더→`route()`, 가드→`parsePath`/`routeSeq`처럼 본질적.

**핵심 반론 — registerView는 사이클을 못 끊는다.** routing→search 한 방향만 뒤집을 뿐, search→routing 21회는 검색의 본질(결과가 라우팅을 일으킴)이라 잔존. "순환 끊기" 명분이 성립 안 함.

**두 변형**
- **얕은** (`window.renderXView()` → `registry[view]()` 치환): 비용 낮음 / 효용 거의 0 (facade→registry lookup뿐; 헬퍼·분기·역방향 그대로). → **하지 말 것.**
- **깊은** (각 뷰 모듈이 route 핸들러 전체 등록, route는 `await registry[view](parsed, ctx)`): 비용 큼 — 검색 분기(query/빈쿼리/autoNav/filter/desktop·mobile + `_routeSeq` 가드 + recordPath) 이관 + 공유 `context` 객체 설계 + bible 코어 뷰 처리 + meta/launch/analytics 분산. 위험 높음(중앙 오케스트레이션 분산 → 일관성·검색 auto-nav 흐름 취약). 효용 = **로드맵 확장성**(Phase 2~4 새 라우트가 self-register → route() 불변), 단 미래 뷰가 단순 핸들러일 때만 큼. 현재 뷰는 안 단순 → 지금 3표본으로 추상화 확정은 YAGNI.

**권고 (언제·어떻게)**
1. 얕은 registry 금지(효용 없음).
2. 깊은 registry 단독 PR 보류(현 3뷰엔 premature, 위험>효용).
3. **트리거에 묶기**: (a) **Phase 2(기도서) 라우트 추가 시** — 4번째 뷰가 추상화를 정당화하는 자연 트리거; (b) **설정 화면 재구성 시** — settings 분기가 어차피 바뀌니 그 PR에서 settings를 registry 핸들러로 점진 도입.
4. **0-위험 사전 작업(지금 가능, registerView와 무관)**: route() 각 분기의 `dismissLaunchScreen()`·`updatePageMeta()`·`trackPageView()` 보일러플레이트를 route() 내부 finalize 헬퍼로 추출(각 분기는 `{title, description}`만 반환). 모듈 경계 불변 = 0 위험, 깊은 registry의 context 설계 토대.

- **known-issues §7.1** **`sw.js`(서비스 워커)는 어느 tsconfig 에도 들지 않는다**(2026-10-17 발견 — main 부터). `tsconfig.json` 의 `include` 는 `js/**` 이고 `tsconfig.worker.json` 은 `js/search-worker.js` 하나라, 루트의 `sw.js`(396줄)는 검사 밖이다(`checkJs: true` 도 `include` 밖의 파일에는 닿지 않는다). WebWorker lib 설정으로 재 보면 40건 — 이벤트가 `FetchEvent` · `ExtendableEvent` · `ExtendableMessageEvent` 가 아니라 `Event` 로 잡히는 것 23(`request` · `waitUntil` · `respondWith` · `data` · `ports`), `self` 가 `ServiceWorkerGlobalScope` 가 아니라 `WorkerGlobalScope` 로 잡히는 것 6(`skipWaiting` · `clients` · `importScripts` 로 실은 `APP_VERSION` · `bibleAudioCache`), 매개변수 타입 11. **고치는 법**: 서비스 워커 전용 설정(`include: ["sw.js"]`, WebWorker lib)을 두어 `npm run typecheck` 에 한 줄을 더하고, `self` 와 리스너 이벤트의 타입을 JSDoc 으로 적는다 — 캐시 · 업데이트의 중심이라 known-issues §6 의 실기기 오프라인 확인과 함께 본다.
- **known-issues §12.1** **ADR에 낡은 사실이 남아 있다**(문서). ADR-022 머리(7행)는 주석을 「※ 위첨자」 · 인쇄 footnote · 칩과 주석의 따로 토글(`bible-note-show`)로 적는다 — 지금은 anchor 어절의 툴팁(어절이 없으면 ※), 인쇄 전용 표현 없음, 토글 하나(`bible-cite-show`)다. ADR-013 상태는 「473 케이스」, ADR-036 13행은 「B1 남음」이지만 상태 줄은 완료다. **고치는 법**: ADR은 손대면 옛 개정 블록을 본문에 녹여야 하므로(CLAUDE.md 「ADR 워크플로우」 2항) 그 ADR을 다른 이유로 손댈 때 함께 고친다.
- **known-issues §12.4** **pitfalls §31(영어 뒤 조사 붙여 쓰기) 전에 쓴 문서에 띄어 쓴 곳이 많다**(문서). #354는 그 PR에서 쓰거나 고친 줄만 붙였다. 머지된 원장은 고칠 수 없으므로 나머지(정리 층 문서 · 코드 주석)는 따로 일괄 정리할지 정한다.
- **known-issues §12.5** **`architecture.md` §4.3 아래쪽 그림**(상태 머신 · 전송 · 저장 상자)의 테두리가 한글 폭 때문에 어긋나 있다(내용은 맞다 — 오래된 것).
- **known-issues §13.5** **WebKit이 `books.json`을 두 번 받는다**(main부터). `index.html`의 `<link rel="preload" … as="fetch" crossorigin>`을 `pre-fetch.js`의 `fetch()`가 쓰지 못해 「preloaded but not used」 경고가 난다. **고치는 법**: preload 링크의 요청 방식(credentials 등)을 `fetch()`와 맞추거나 둘 중 하나만 둔다 — WebKit · Chromium 둘 다에서 요청 수로 확인.

### known-issues §24 — ADR과 설계서 문체 정리 (2026-10-22)

- **ADR 001-040과 교회력 설계서 둘을 한국어답게 고쳐 쓴다.** 2026-10-21에 사용자가 정리 층 문서 전체를 고쳐 쓰기로 했다(coding-pitfalls §37). 2026-10-22에 시작한 docs 재구성 작업이 나머지 문서를 맡고, 이 둘이 남는다. ADR 001-035의 옛 개정 블록은 문장을 고쳐 쓰면서 그 내용을 본문의 해당 자리에 반영하고 블록을 삭제한다(사용자 결정 2026-10-21). 버린 선택지는 「검토한 대안」에 날짜, 이유, 재검토 조건과 함께 남긴다. 블록이 긴 곳은 ADR-021, 033, 024, 028, 011, 030, 013, 009다. **검증**: `scripts/docs_facts_snapshot.py`의 사실 토큰 비교에서 사라진 토큰이 0이어야 한다. 사실을 바꾸지 않고 문장만 고친다.
