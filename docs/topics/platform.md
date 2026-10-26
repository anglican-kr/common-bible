# 앱 뼈대, 모듈, 타입, 테스트, 저장소 구성

소유 코드: `js/app.js`, `js/app/helpers.js`, `js/app/storage.js`, `js/types.d.ts`, `js/gtag-init.js`, `js/pre-fetch.js`

부팅과 모듈 구조(ESM), 여러 주제가 함께 쓰는 도우미와 저장소 모듈, 타입 검사, 유닛과 e2e 테스트, 네 저장소의 구성, 보안 헤더를 다룬다.

## 지금 동작

- **Phase 1**: 성경 읽기 PWA를 완성했다. 73권, 오프라인, 검색, 오디오, 접근성이 들어 있고, 검색 UI 재설계도 포함한다(ADR-005).
- **테스트 체계**.
  - 데이터 파이프라인 테스트(ADR-004, Level 1-3)는 data 저장소에서 돈다.
  - 브라우저로 화면을 직접 눌러 보는 e2e 테스트가 있다. DOM을 많이 다루는 부분은 e2e가 맡는다.
  - 유닛 테스트(ADR-013)는 Node의 vm과 손으로 만든 스텁으로 돌아, 따로 설치할 의존성이 없다. 건수는 `tests/README.md`에 있다.
- **TypeScript 점진 도입** (ADR-012). 앱 모듈은 모두 검사하고, `sw.js`만 남았다.
  - 코드에 JSDoc으로 타입을 적고 `tsc --noEmit`으로 검사한다. `js/`의 모든 클라이언트 JS를 검사한다(`checkJs: true`, 2026-10-17).
  - CI의 필수 「Unit tests」 잡이 `npm run typecheck`(앱 설정과 워커 설정 둘)를 돌리고, 오류가 없어야 머지된다.
  - 예전에 파일마다 지시문으로 검사를 켜던 때, 지시문이 둘째 줄에 있어 검사 밖이던 파일이 22개 있었다. 2026-10-17 묶음 ① 16개, 2026-10-18 묶음 ② 2개(`views`, `search`)와 묶음 ③ 4개(bookmark 계열)로 모두 검사에 넣었다. `// @ts-nocheck`로 빠진 파일은 없다.
  - 서비스 워커 `sw.js`만 아직 어느 설정에도 들지 않는다(`known-issues.md` §7, 아래 「남은 일」의 known-issues §7.1).
- **app.js 모듈 분할** (2026-05-10, ADR-018). `js/app.js`를 6,082줄에서 283줄로 줄이고 아홉 개 도메인 모듈로 나눴다. 모듈은 ESM이다(ADR-019). 자세한 내용은 `docs/archive/design/app-modularization.md`에 있다.
- **2차 모듈 분할** (2026-06-08부터 06-11까지, ADR-034, PR5c는 보류).
  - ADR-018 뒤에도 너무 컸던 모듈(`views-routing.js` 2,389줄, `bookmark.js` 3,578줄)을 하는 일별로 다시 나눴다. 서로 돌지 않는 facade(`window.X`로 함수를 내놓아 다른 모듈이 호출하게 하던 것)는 명시적 import로 바꿨다. 서로 호출하는 관계는 registry 역전으로 해결했다. 호출하는 쪽이 상대를 아는 대신, 호출되는 쪽이 목록에 자신을 등록하는 방식이다.
  - PR1: 오디오 플레이어를 `js/app/audio-player.js`로 떼어 냈다(views-routing 2,389→2,195줄). `route` 쪽 호출은 명시적 import로 바꾸고, 바깥 호출자를 위한 `window.{hideAudioBar,applyAudioShow,getCurrentAudio}` facade는 남겼다.
  - PR4: 모바일의 "당겨서 새로고침"(손으로 Drive 동기화를 시작하던 동작)을 **없앴다**. 백그라운드 동기화(자동 확인, 편집 뒤 업로드, 화면이 다시 보일 때의 visibilitychange)는 그대로다. views-routing 2,195→2,011줄.
  - PR2: 데이터를 받는 함수(loadBooks, Version, Chapter, Prologue)와 booksCache, appVersion 캐시를 `js/app/data-fetch.js`로 떼어 냈다. 다른 모듈에 의존하지 않는 모듈(leaf)이다. 내부 호출은 명시적 import로 바꾸고, 바깥 호출자를 위한 facade는 남겼다. views-routing 2,011→1,942줄.
  - PR3: 탭의 활성 상태와 미끄러지는 표시(`syncTabBarActive`, `positionTabIndicator`)를 `js/app/tabbar.js`로 합쳐 탭 바 코드를 한곳에 모았다. route()는 `window.syncTabBarActive` facade로 호출한다. tabbar와 views가 서로를 호출하기 때문이다. views-routing 1,942→1,831줄.
  - PR5a: 라우팅(parsePath, navigate, route, 페이지 메타, 스크롤 추적, 링크 클릭과 popstate 리스너)을 `js/app/routing.js`로 떼어 냈다. route()가 호출하는 화면 그리기 함수 여덟은 views-routing에서 명시적으로 import한다(한 방향). search, bookmark, settings, citations는 서로 부르므로 facade를 남겼다. views-routing 1,831→1,354줄(2,389에서 −43%).
  - PR5b: route()가 오버레이 열네 개를 닫던 코드(12 `closeIfOpen`과 설정, 장 팝오버)를 `js/app/overlay.js`의 `closeAllOverlays()` 하나로 줄였다. createOverlay가 만든 오버레이를 목록(registry)에 올려 두고, 열린 것만 닫으며 화면에서 떨어진 것은 목록에서 지운다. 그래서 routing이 여섯 모듈의 닫기 함수를 직접 알 필요가 없어졌다.
  - 남은 PR5c(registerView 역전)는 **비용이 효용보다 커서 보류를 권한다**. 자세한 것은 아래 「남은 일」의 known-issues §2.1에 있다.
  - **bookmark.js 분할(따로 진행, 완료)**: 3,578줄을 네 모듈로 나눴다.
    - 모달 7종(확인, 장 삭제, 새 폴더, 콤보박스, 저장과 편집, 합치기, 가져오기, 이동 picker)을 `bookmark-modals.js`로 옮겼다. 그리기 함수를 밖에서 넘겨받게 해(의존성 주입) 모달과 그리기가 서로를 호출하지 않게 했다. Escape는 `closeTopmostModal` 하나가 맨 위 모달부터 닫는다.
    - DOM을 쓰지 않는 로직은 `bookmark-core.js`로, 절 표기는 `verse-spec.js`(다른 모듈에 의존하지 않는 모듈)로 옮겼다. 그래서 `bookmark.js`는 **2,198줄(−38%)**이 됐다.
    - 이동 모달은 선택 상태(`_bmSelected`)를 직접 읽던 것을 `openMoveModal({excludeFolder,onPick})`처럼 값을 넘겨받게 바꿨다. 선택 로직은 원래 자리에 남겼다.
    - 마지막으로, 아무도 호출하지 않게 된 `window.close*Modal`과 QUERY facade, 쓰지 않는 import를 grep과 로드 검사로 확인한 뒤 지웠다.
  - **2라운드(2026-06-11)에서 마저 나눴다.** 제스처, 선택 삭제, 절 선택, ⋯ 메뉴, 트리 그리기를 `bookmark-{gestures,select,verse-select,menu,tree}.js`로 떼어 냈다. 그래서 `bookmark.js`가 **589줄**(처음 3,578줄보다 −84%)이 되고, 드로어와 헤더를 조율하는 일만 남았다. 이 과정에서 `views-routing.js`는 없어지고 `routing.js`, `views.js` 등으로 나뉘었다.
  - 남은 것은 PR5c 하나이고, 그것만 따로 진행하는 것은 보류한다. 자세한 것은 [ADR-034](../decisions/034-views-routing-second-split.md)의 개정에 있다.
- **보안 헤더 6종 통합** (2026-05-08). nginx의 server 수준 설정 조각(snippet)으로, dev와 prod 두 vhost에 모두 적용했다. `common-bible-server/nginx/security-headers.example.conf`를 본다.
- **모노레포 4분할** (2026-05-11, ADR-020). 앱, 데이터, 오디오, 서버의 네 저장소로 나눴다. data는 본 저장소의 `data/`에 서브모듈로 붙고, audio는 data 안에 다시 서브모듈로 붙는다(nested). server는 따로 clone한다.

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

### pitfalls §16 — 모듈이 처음 실행될 때 쓰는 `window.X`가 아직 없을 수 있다, 모듈을 싣는 순서 때문이다

index.html은 모듈(`<script type="module">`)을 적힌 순서대로 실행한다. 어떤 모듈이 **처음 실행될 때(init, 최상위 코드)** 다른 모듈이 `window.X`로 내놓는 함수를 쓴다고 하자. 그 함수를 정의하는 모듈이 **뒤에** 실린다면, 그때는 아직 `undefined`다. 한 번 확인하고 바로 그만두면(bail), 나중에 함수가 정의돼도 다시 시도하지 않아 그 상태가 영영 비어 있게 된다.

**사례:**
- `53cb24d` (#246) — search.js는 부팅할 때 `ensureAliasMap()`으로 `_aliasMap`을 미리 만든다. 검색창에 친 `in:<별칭>`을 책 칩으로 바꿀 때 쓰는 표다. 그런데 이때 쓰는 `window.loadBooks`(data-fetch.js)는 search.js보다 *뒤*에 실리는 모듈이라, 미리 만드는 시점에는 undefined였다. `if (typeof window.loadBooks !== "function") return`으로 바로 그만두어 `_aliasMap`이 영영 null로 남았다. 그래서 `사랑 in:요한`을 쳐도 책 칩으로 바뀌지 않고 글자 그대로 남았다. 원인은 이렇다. 별칭을 칩으로 바꾸는 처리를 동기로 고치면서, 입력을 확정할 때 하던 `await ensureAliasMap()`을 부팅 때 미리 만드는 쪽으로 옮겼고, 그때 모듈 순서에 대한 가정이 깨졌다.

**규칙:**
- 처음 실행될 때 쓰는 `window.X`가 **뒤에 실리는 모듈**의 것인지 확인한다. 그렇다면 한 번 확인하고 그만두지 말고, 정의될 때까지 잠깐 기다렸다가 진행하거나, 실제로 쓰는 때(이벤트나 확정 처리)로 미룬다.
- 이런 순서 문제는 **유닛 테스트로 잡히지 않는다.** 유닛 하네스(vm)가 `window.X`를 미리 스텁해 두기 때문이다. 실제 모듈 순서로 싣는 브라우저 스모크로 확인한다.

### pitfalls §27 — 일부 파일의 타입 검사가 조용히 꺼져 있었다, `// @ts-check`가 문 뒤에 있어서다 (2026-10-17)

타입 검사(TypeScript)는 코드에 선언한 자료의 모양(타입)과 실제 쓰임이 맞는지 미리 확인한다. 예전에는 검사를 파일마다 `// @ts-check`로 켰다(`checkJs: false`). 그런데 그 지시문 앞에 `"use strict";` 같은 문(statement)이 있으면, TypeScript가 지시문을 읽지 않고 그 파일을 **오류 없이** 검사에서 뺐다. 앞에 주석만 있는 것은 괜찮았다. 그래서 `npm run typecheck`가 0이어도 그 파일은 검사받지 않은 것이었고, CI는 타입 검사를 돌리지도 않았다. 검사 밖에서는 `js/types.d.ts`의 선언이 실제 데이터나 코드와 어긋나도 아무도 모른다. 2026-10-17(PR #353 리뷰)부터는 `checkJs: true`로 `js/` 전체를 기본으로 검사하고, 필수 CI 「Unit tests」 잡이 타입 검사를 돌린다(ADR-012).

**사례:**
- `lectionary.js`(#346): 975줄이 검사 밖이었다(원장 `docs/changes/2026-10-12-lectionary-view.md` 3회차 ①).
- 22개 파일(2026-10-15 발견, `known-issues.md` §7): 묶음 ① 16개를 켜자 오류가 44건(원장 `docs/changes/2026-10-17-typecheck-batch-1.md`) 나왔다.
  - `BookEntry.division`에 데이터의 `"liturgical"`(전례시편, 송가)이 없었다.
  - `BibleVerse.chapter_ref`는 데이터가 정수인데 선언은 `string`이었다.
  - `AppStorage`에 `loadCiteShow`와 `saveCiteShow`가, Window에 네임스페이스 객체 다섯이 빠져 있었다.
  - `parsePath()`의 전역 선언은 `any`였다.
  - 그 자체로 실행 결함은 아니었지만, 선언을 믿고 짠 새 코드가 틀릴 자리였다.
- 같은 묶음: JSDoc 블록과 함수 사이에 `const` 하나가 끼어, 매개변수 타입이 함수에 붙지 않았다(citations.js `wrapNoteAnchorsInArticle`). 또 `@param {T} [이름] — 설명`처럼 대괄호 이름 바로 뒤에 줄표를 쓰면, TS가 「Invalid character」(TS1127)로 읽었다.
- 같은 묶음의 리뷰: `division` 타입에 `"liturgical"`을 넣어 선언은 바로잡았다. 하지만 그 값으로 경로를 만드는 곳(`` `/${effectiveDivision(book)}` ``, 헤더의 집 단추와 탭 바의 홈)은 그대로라, 전례시편과 송가에서는 없는 주소 `/liturgical`로 갔다(main부터). 타입 검사는 문자열을 이어 붙이는 것을 막지 않는다.
- 묶음 ②(`views`, `search`, 2026-10-18, 원장 `docs/changes/2026-10-18-typecheck-batch-2.md`): `appendVerses`가 `chapter`를 null 기본값으로 받아 `findParallelsStartingAt(…, chapter)`에 넘겼다. 받는 쪽은 `currentChapter`가 `undefined`일 때만 장 비교를 건너뛴다. 그래서 null이 오면 모든 범위가 장 비교에 걸려 ※(병행 본문) 표시가 모두 빠진다. 병행 본문을 넘기는 호출부(장 화면)는 장 번호를 늘 함께 넘겨서 아직 이 문제를 밟지 않았다. `number | null`을 `number | undefined` 자리에 넘긴다는 타입 오류가 이 어긋남을 드러냈다.
- 묶음 ③(북마크 모듈 넷, 2026-10-18, 원장 `docs/changes/2026-10-18-typecheck-batch-3.md`): 함수와 떨어진 JSDoc이 둘 더 나왔다.
  - `openMergeDialog`의 블록 아래에 `const mergeOverlay`가 끼어, 블록이 오버레이 선언에 붙었다. 그래서 `fallbackContext = null`이 `null` 타입이 되어, `{ bookId, chapter }`를 넘기는 호출이 걸렸다.
  - `renderBookmarkTree`의 블록은 다른 함수(`_buildEmptyState`) 위에 있어 TS8024(「`target`이라는 매개변수가 없다」)로 드러났다.
  - 객체 리터럴로 만든 네임스페이스 객체 `window.appBookmark`의 선언(`AppBookmark`)은, verse-spec.js로 옮겨 간 함수 넷을 그대로 들고 실제 멤버 스물 가운데 열셋을 빠뜨린 채였다. 읽는 곳이 없어 아무도 몰랐다.

**규칙:**
- 검사에서 빼는 파일은 첫 줄(어떤 문보다 앞)에 `// @ts-nocheck`를 두고, 같은 줄에 이유와 고칠 곳을 적는다. 고치는 PR이 그 줄을 지운다. 그 줄을 문 뒤에 두면 무시되어 파일이 검사되고 오류로 드러난다. 그래서 빼는 쪽의 실수는 조용히 지나가지 않는다(ADR-012 「파일 헤더」).
- 검사 장치는 「켜는 쪽」이 아니라 「빼는 쪽」을 명시하게 두고, 필수 CI에서 돌린다. 꺼진 줄 모르는 검사가 가장 비싸다. 설정이나 네임스페이스 객체의 반환 타입을 바꿀 때는 타입 오류를 일부러 하나 넣어, 그 파일에서 잡히는지 본다.
- `window`에 거는 네임스페이스 객체(`window.appX = (() => { … })()`)의 IIFE에는 `@returns {AppX}`를 단다. 그러면 인터페이스에 없는 멤버가 받는 쪽이 아니라 정의한 자리에서 걸린다. 객체 리터럴로 만든 네임스페이스 객체(`const appX = { … }`)에는 `@type {AppX}`를 단다.
- JSDoc 블록과 그 함수 사이에 다른 선언을 두지 않는다. 블록은 바로 다음 선언에 붙는다. 매개변수 이름이 맞지 않으면 TS8024로 드러나지만, 이름이 우연히 같거나 다음 선언이 `const`면 조용히 엉뚱한 곳에 붙는다(묶음 ①과 ③에서 세 번).
- 데이터 모양의 타입을 고칠 때는 파이프라인(`data/src/parser.py` 등)의 필드 타입과 실제 JSON을 함께 대조한다. 타입을 넓혔으면(새 값), 그 값을 **쓰는 곳**이 새 값을 다루는지 `grep`으로 함께 본다. 경로, 화면에 보이는 문자열, 표의 색인이 그런 곳이다.
- 선택 매개변수(`@param {T} [x]`)는 `undefined`만 「없음」으로 받는다. 넘기는 쪽이 null을 「없음」으로 쓰면, `!== undefined`로 가르는 받는 쪽과 조용히 어긋난다. 넘기는 쪽의 null 기본값을 없애거나 받는 쪽을 `!= null`로 맞추고, 두 쪽의 타입을 그대로 적어 검사가 잡게 한다.

### pitfalls §39 — 함수를 다른 모듈로 옮기면 facade, 네임스페이스 객체, export 세 곳과 숨은 참조를 함께 정리한다 (2026-06-08 · 06-11)

`js/app/` 모듈에서 함수를 다른 파일로 옮길 때, 그 이름은 보통 세 곳에 나온다. `window.X = X` facade, `appX` 네임스페이스 객체(`const appBookmark = { X, … }`), ESM `export { X, … }` 블록이다. 셋을 모두 옮기거나 지워야 한다. 2026-06의 기록이다. 그 뒤 타입 검사를 모든 js 파일에 기본으로 켰지만(pitfalls §27, #353), 같은 사각지대가 지금도 있는지는 확인하지 않았다.

**사례:**
- 2026-06-08 verse-spec 분리: 옮긴 함수가 `export {}`에 남았다. 그 이름이 `types.d.ts`에 전역으로 선언돼 있어 tsc는 통과했다. 하지만 브라우저의 ESM은 `export {name}`에 모듈 안의 바인딩을 요구해서, `Uncaught SyntaxError: Export 'name' is not defined in module`로 모듈을 만들지 못했다. 앱 전체가 뜨지 않았고, e2e는 모두 시간 초과로만 보여 원인이 드러나지 않았다.
- 2026-06-11 bookmark-tree 분리(PR5): 새 모듈에서 import 8개(`setRenderPathname`, `saveBookmarks`, `openSaveModal` 등)를 통째로 빠뜨렸는데, tsc와 worker tsc가 모두 통과했다. 이 이름들이 전역으로 선언돼 있어 tsc는 전역으로 읽었지만, 실행하면 `ReferenceError`가 났다.
- 2026-06-11 bookmark-gestures 분리(#275, #276에서 고침): 옮긴 모듈에서 export하지 않은 헬퍼(`_isDescendant`)를 원래 파일의 `_moveSelectedToFolder`가 그대로 호출했다. tsc, 유닛, 로드 스모크 모두 잡지 못했다. 폴더를 폴더로 옮기는 경로가 실행되지 않았기 때문이다.

**규칙:**
- tsc 통과는 import가 빠짐없다는 뜻이 아니다. 모듈을 나누는 PR은 두 가지로 검증한다. 하나는 playwright 로드 스모크다. 페이지를 연 뒤 `pageerror`를 모으고 `#app`이 그려졌는지 확인한다. 다른 하나는 조건 경로를 실제로 밟는 상호작용 e2e(편집, 삭제, 모달, 폴더 이동)다.
- 의존 관계는 정해 둔 후보 목록으로 찾지 않는다. 옮기는 모듈의 export 전체를 그 본문에서 grep해 찾는다.
- 공개 이름뿐 아니라 옮기는 파일의 모든 정의(특히 `_`로 시작하는 내부 헬퍼)를 원래 파일의 남은 코드에서 grep해, 남은 참조가 없는지 본다.

## 남은 일

### known-issues §2.1 — PR5c, 화면 등록 방식(`registerView`)으로 바꿀지 (2026-06-08 검토)

`registerView`는 라우터가 화면 모듈을 직접 호출하는 대신, 각 화면 모듈이 자기 화면을 그리는 함수를 라우터의 목록(registry)에 등록하게 하는 방식이다. 호출하는 방향이 뒤집히므로 dispatch 역전이라고 불렀다.

결론: **그것만 하는 PR로는 하지 않는다. Phase 2 라우트를 더하거나 설정 화면을 다시 짤 때 함께 한다.**

**전제 (실측)**
- PR5a 이후 routing.js는 search, bookmark, settings를 ESM import하지 않고 `window` facade로 호출한다. 그래서 **모듈끼리 import가 도는 문제(사이클)는 이미 없다.** registerView가 고칠 구조 문제(순환 import, 로드 순서, tsc 오류)는 없고, 남은 것은 전역 이름을 거치는 *논리적* 결합뿐이다.
- routing이 다른 모듈을 호출하는 곳은 9개다. 화면을 그리는 함수 3-4개(`renderSearchResults`, `renderSearchView`, `renderBookmarksView`, `renderSettingsView`)와 흐름을 조율하는 도우미 5개(`consumeSearchAutoNavigate`, `isMobile`, `openBookmarkDrawer`, `exitVerseSelectMode`, `exitBookmarkSelectMode`)다. registry는 화면을 그리는 함수만 대상이고, 도우미와 분기 로직은 그대로 남는다.
- 반대 방향 호출은 **search→routing 21회**, bookmark 5, settings 3이다. 결과를 누르면 `navigate()`, 다시 그릴 때 `route()`, 확인할 때 `parsePath`/`routeSeq`를 호출하는 것이라 없앨 수 없다.

**핵심 반론: registerView는 순환을 끊지 못한다.** routing→search 한 방향만 뒤집을 뿐이다. search→routing 21회는 검색의 본질(결과가 라우팅을 일으킨다)이라 그대로 남는다. 그래서 「순환을 끊는다」는 이유가 서지 않는다.

**두 가지 방식**
- **얕은 방식**(`window.renderXView()`를 `registry[view]()`로 바꾸기): 비용은 낮지만 효용이 거의 없다. facade를 registry 조회로 바꿀 뿐이고, 도우미와 분기, 반대 방향 호출은 그대로다. → **하지 않는다.**
- **깊은 방식**(각 화면 모듈이 route 처리 전체를 등록하고, route는 `await registry[view](parsed, ctx)`만 한다): 비용이 크다. 검색 분기(검색어가 있을 때와 없을 때, 자동 이동, 필터, 데스크톱과 모바일, `_routeSeq` 검사, recordPath)를 옮겨야 한다. 함께 쓰는 `context` 객체를 설계하고, 성경 본문 화면을 처리하고, 메타와 런치 스크린과 분석 호출을 여러 곳으로 나눠야 한다. 위험도 높다. 가운데서 조율하던 일이 흩어져, 일관성과 검색 자동 이동 흐름이 약해진다. 효용은 **로드맵 확장성**이다. Phase 2-4의 새 라우트가 스스로 등록하면 route()를 고치지 않아도 된다. 다만 앞으로 생길 화면이 단순한 처리 함수일 때만 효용이 크다. 지금 화면들은 단순하지 않으므로, 지금의 세 화면만 보고 추상화를 정하는 것은 이르다(YAGNI, 지금 필요하지 않은 것은 만들지 않는다).

**권고 (언제, 어떻게)**
1. 얕은 registry는 하지 않는다(효용이 없다).
2. 깊은 registry만 하는 PR은 보류한다. 지금 세 화면에는 이르고, 위험이 효용보다 크다.
3. **계기에 묶는다.** (a) **Phase 2(기도서) 라우트를 더할 때**: 네 번째 화면이 추상화를 정당화하는 자연스러운 계기다. (b) **설정 화면을 다시 짤 때**: settings 분기가 어차피 바뀌므로, 그 PR에서 settings부터 registry 처리로 조금씩 들인다.
4. **위험이 없는 사전 작업(지금 할 수 있고, registerView와 무관)**: route()의 분기마다 되풀이되는 `dismissLaunchScreen()`, `updatePageMeta()`, `trackPageView()` 호출을 route() 안의 마무리 도우미 하나로 모은다. 각 분기는 `{title, description}`만 돌려준다. 모듈 경계가 바뀌지 않아 위험이 없고, 깊은 registry에서 쓸 context 설계의 바탕이 된다.

- **known-issues §7.1** **서비스 워커 `sw.js`는 어느 타입 검사 설정(tsconfig)에도 들지 않는다**(2026-10-17 발견, main부터).
  - `tsconfig.json`의 `include`는 `js/**`이고 `tsconfig.worker.json`은 `js/search-worker.js` 하나라서, 루트의 `sw.js`(396줄)는 검사 밖이다. `checkJs: true`도 `include` 밖의 파일에는 닿지 않는다.
  - WebWorker lib 설정으로 다시 검사해 보면 오류가 40건, 셋으로 나뉜다.
    - 이벤트가 `FetchEvent`, `ExtendableEvent`, `ExtendableMessageEvent`가 아니라 `Event`로 잡히는 것 23(`request`, `waitUntil`, `respondWith`, `data`, `ports`)
    - `self`가 `ServiceWorkerGlobalScope`가 아니라 `WorkerGlobalScope`로 잡히는 것 6(`skipWaiting`, `clients`, `importScripts`로 실은 `APP_VERSION`, `bibleAudioCache`)
    - 매개변수 타입 11
  - **고치는 법**: 서비스 워커 전용 설정(`include: ["sw.js"]`, WebWorker lib)을 두어 `npm run typecheck`에 한 줄을 더하고, `self`와 리스너 이벤트의 타입을 JSDoc으로 적는다. 서비스 워커는 캐시와 업데이트의 중심이므로, known-issues §6의 실기기 오프라인 확인과 함께 본다.
- **known-issues §12.1** **ADR에 낡은 사실이 남아 있다**(문서).
  - ADR-022 머리(7행)가 주석을 「※ 위첨자」, 인쇄 footnote, 칩과 주석을 따로 켜고 끄는 설정(`bible-note-show`)으로 적던 것은 2026-10-23에 고쳤다. 지금은 주석이 붙은 어절의 툴팁(어절이 없으면 ※)이고, 인쇄 전용 표현이 없으며, 설정은 하나(`bible-cite-show`)다(ADR-022 「지금 상태」).
  - ADR-036 13행은 「B1 남음」이지만 상태 줄은 완료다.
  - ADR-013 상태의 「473 케이스」는 2026-10-23에 고쳤다. 그때의 건수임을 밝히고, 지금 건수는 `tests/README.md`를 가리킨다.
  - **고치는 법**: ADR을 손대면 옛 개정 블록의 내용을 본문에 반영하고 블록을 삭제해야 하므로(CLAUDE.md 「ADR 워크플로우」 2항), 그 ADR을 다른 이유로 손댈 때 함께 고친다.
- **known-issues §12.4** **pitfalls §31(영어 뒤 조사 붙여 쓰기) 전에 쓴 문서에 띄어 쓴 곳이 많다**(문서). #354는 그 PR에서 쓰거나 고친 줄만 고쳤다. 머지된 원장은 고칠 수 없으므로, 나머지(정리 층 문서와 코드 주석)를 따로 한꺼번에 정리할지 정한다.
- **known-issues §12.5** **`architecture.md` §4.3 아래쪽 그림**(상태 머신, 전송, 저장 상자)의 테두리가 한글 폭 때문에 어긋나 있다. 내용은 맞다. 오래된 일이다.
- **known-issues §13.5** **WebKit이 `books.json`을 두 번 받는다**(main부터). `index.html`의 `<link rel="preload" … as="fetch" crossorigin>`으로 미리 받은 것을 `pre-fetch.js`의 `fetch()`가 쓰지 못해, 「preloaded but not used」 경고가 난다. **고치는 법**: preload 링크의 요청 방식(credentials 등)을 `fetch()`와 맞추거나, 둘 중 하나만 둔다. WebKit과 Chromium 둘 다에서 요청 수로 확인한다.

### known-issues §30 — `coding-pitfalls.md`와 주제 문서의 긴 사례 고쳐 쓰기 (2026-10-24)

- **한 줄에 여러 문제를 몰아 쓴 사례를 나누고, 개발을 모르는 독자도 읽을 수 있게 고쳐 쓴다.** 사용자가 `coding-pitfalls.md` §5의 2026-10-17 사례(한 줄 559자)를 보고 정했다(2026-10-24).
  - 사례 하나에 문제가 여럿이면 하위 항목으로 나누고 항목마다 굵은 이름을 단다(pitfalls §37). 코드 이름 앞에 그 코드가 하는 일을 쓰고, 「(main부터)」 같은 개발자끼리의 말은 풀어 쓴다(pitfalls §40).
  - **범위**: 300자를 넘는 줄이 `coding-pitfalls.md`에 16개, 주제 문서에 41개 있다(2026-10-24). 이 줄들을 먼저 보고, 문제가 하나뿐인 줄은 그대로 둔다. 「(main부터)」는 정리 층 문서에 23번 나온다.
  - **순서**: 교회력 설계서와 검토 문서의 고쳐 쓰기(known-issues §24)가 끝난 뒤에 한다. 그 일은 2026-10-26에 끝났다.
  - **검증**: 사실 토큰 비교(`scripts/docs_facts_snapshot.py --kinds general --strict-counts`)에서 사라진 토큰이 0이어야 한다. 문장과 구조만 고치고 사실은 바꾸지 않는다.
