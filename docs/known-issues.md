# 알려진 이슈 / 후속 과제

ADR-034(뷰·라우팅 2차 분할) 작업 중 발견·확인한 항목 모음. "나중에 대응" 대상.
최초 작성 2026-06-08.

---

## 1. e2e 사전 실패 — 전수 진단·해소 (2026-06-22)

> **해소됨 (2026-06-22).** 아래 §1a/1b/1c 묶음은 **옛 headless chromium 버전 아티팩트**였고, playwright/chromium 업그레이드(Chrome Headless Shell 148)로 **전부 통과**로 바뀌었다. 진단 중 전체 스위트를 돌려 드러난 **다른 12건은 모두 코드 변경을 e2e가 못 따라간 낡은 테스트**(앱 버그 0)였고 현행 동작에 맞게 수정했다. 현재 전체 e2e **215 통과 / 0 실패**(`test_a11y_axe.py` 는 선택적 의존성 `axe_playwright_python` 미설치 시 수집 제외). 상세 보고서: [`archive/qa/2026-06-22-e2e-stale-refresh.md`](archive/qa/2026-06-22-e2e-stale-refresh.md).

원래 묶음(현재 통과):

- **1a. `test_tabbar.py` 모핑 검색** — `#search-input` 모핑이 옛 headless에서 안 펼쳐지던 문제. 새 chromium에서 11/11 통과.
- **1b. `test_settings.py`** — `.settings-popover` 토글·`location.reload()` 타이밍. 3/3 통과.
- **1c. `test_bookmark_folders.py`** — 데스크탑 드로어 `.bm-folder-row` 토글. 2/2 통과.

진단 중 발견·수정한 **낡은 테스트 12건**(설계가 바뀌었는데 e2e 미갱신 — e2e가 CI 미실행이라 드리프트가 조용히 쌓임):

- **`test_book_name_swap.py` 4건** — 복음서(마태오/마르코/루가/요한)에도 모바일 짧은 명칭이 추가(`NT_MOBILE_NAME`)됐는데 테스트는 "복음서는 정식명 유지" 옛 규칙을 단언. + 터치 기기는 `.compact` 클래스가 아니라 `pointer:coarse` 미디어쿼리로 전환 + 반응형 책 그리드가 폰트 따라 칼럼을 넓혀 32px로는 더 이상 안 넘침(좁은 창에서 측정). 모두 현행 동작에 맞게 수정 + 복음서 전환 양성 케이스 추가.
- **`test_features.py` 롱프레스 1건** — 절 선택 진입 임계값 300→**500ms** 변경(커밋 a506958)인데 테스트는 350ms만 눌러 진입 실패. 650ms로 수정.
- **`test_install_guide.py` 7건** — 첫 방문 너지 노출이 **의도적으로 제거**(기본 `nextShow` 2 — 검색 유입·크롤러 배려, 돌아온 2번째 방문 노출)됐는데 테스트는 첫 방문 노출을 기대. 2번째 방문 상태(`{visits:1, nextShow:2}`)로 수정 + 첫 방문 미노출 양성 케이스 추가.

> **교훈**: e2e가 CI 미실행이라 코드 변경 시 e2e가 조용히 드리프트한다. 기능 변경 후 영향 e2e를 함께 갱신할 것. axe a11y 테스트를 돌리려면 `pip install axe-playwright-python` 필요.

---

## 2. ADR-034 남은 작업

상세는 [`docs/decisions/034-views-routing-second-split.md`](decisions/034-views-routing-second-split.md).

- **PR5b `closeAllOverlays` ✅ 완료** — `route()` 의 14개 오버레이 teardown(12 `closeIfOpen` + settings/chapter popover)을 `overlay.js` 의 `closeAllOverlays()` 하나로 축약. createOverlay가 모든 인스턴스를 registry에 등록, closeAllOverlays가 열린 것만 close + detached panel prune. routing→6개 모듈 close fn 하드코딩 의존 제거.
- **PR5c `registerView` dispatch 역전 (보류 — 상세 §2.1)** — 단독 PR로는 보류, Phase 2 라우트 추가 또는 설정 화면 재구성에 얹어서.
- ~~audio `applyAudioShow` → `window.parsePath` facade edge~~ **조사 완료 → 현 설계 유지 (§2.2)** — 없애려던 항목이나 검토 결과 facade가 정답(명시 import는 사이클, readingContext는 stale, state-machine 호출자는 컨텍스트 못 줌). 조치 없음.
- **`bookmark.js` 분할 (진행 중)** — 3,578줄에서 모듈별로 점진 분리. 완료: 순수 로직 `bookmark-core.js`(query/href/sort/active) · 절 스펙 `verse-spec.js` · 모달 `bookmark-modals.js` · 폴더 모아 읽기 `bookmark-read.js` · 제스처 엔진 `bookmark-gestures.js`(드래그 reorder + 스와이프 액션 + 포인터 핸들러) · 선택 삭제 모드 `bookmark-select.js`(상태 + 캐스케이드 수학 + 삭제·공유·이동 액션 + #bm-select-bar dock — 트리렌더↔select 양방향은 import(상태/핸들러)+주입(재렌더/헤더)으로 차단) · **절 선택 모드 `bookmark-verse-select.js`(in-reading 절 선택 → 북마크/복사 + #verse-select-bar dock, near-leaf라 DI 불필요) · **⋯ 메뉴 `bookmark-menu.js`(탭 뷰 title-row 액션: 정렬·새 폴더·내보내기·가져오기·선택 + 🛈 안내 + 전체 선택 + exportBookmarks) · **트리 렌더링 `bookmark-tree.js`(per-row 빌더 + renderBookmarkTree + _rerenderActiveBookmarkTree 허브 + renderBookmarksView + 드로어 키보드 내비, ADR-034 후속, 마지막 라운드 — 드로어/헤더 콜백 3개 주입)**. **분할 완료**: bookmark.js 2,432→590줄(−76%), 드로어/헤더 오케스트레이터로 수렴(헤더 버튼·드로어 lifecycle·init 배선·facade·keydown).

### 2.1 PR5c — `registerView` dispatch 역전 트레이드오프 (2026-06-08 검토)

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

### 2.2 audio `applyAudioShow` → `window.parsePath` (2026-06-08 검토 → 현 설계 유지)

`applyAudioShow`(오디오 설정 라이브 토글)가 현재 라우트를 알려고 `window.parsePath()`를 facade로 호출하는 부분. PR1 이후 "audio→routing 임시 edge"로 적어뒀으나, 검토 결과 **그대로 두는 게 맞다.** 억지로 없애면 셋 중 하나를 감수해야 함:

1. **명시 import → import 사이클.** 의존이 `routing → views-routing → audio-player` 인데, audio-player가 `import { parsePath } from "./routing.js"` 하면 `routing → views-routing → audio-player → routing` 3-모듈 순환. 현 `window.parsePath` facade가 바로 이 사이클을 피하는 장치.
2. **`readingContext`는 stale.** `readingContext.bookId/chapter`는 `renderChapter`에서만 set되고 non-chapter 뷰에서 null 리셋이 없음("마지막 본 장" ≠ "현재 장"). 뷰 무관하게 불리는 `applyAudioShow`가 홈에서 stale 장으로 오작동. 쓰려면 모든 non-chapter 리셋 + prologue=0 set 추가 → bookmark `!readingContext.chapter` 등 다운스트림 리스크.
3. **호출자가 컨텍스트를 못 준다.** `state-machine.js`가 synced `audioShow` 값을 적용할 때(동기화 레이어) 라우트 컨텍스트가 없어 인자로 못 넘김 → 내부에서 현재 뷰를 다시 알아내야 함(=parsePath).

`parsePath`는 route()/navigate() 같은 오케스트레이션이 아니라 **순수 URL 파싱 유틸**이라, audio가 facade로 읽는 건 양성(benign) 의존. **조치 없음.**

---

## 3. 곱슬 따옴표 전환 — 남은 작업 (2026-07-10)

`common-bible-data` 의 마크다운 본문 인용부호를 곧은 따옴표(`"`)에서 곱슬 따옴표(`“`·`”`)로 옮기는 작업. **`liturgical/` 은 완료**, `source/`(성서 본문 73권)는 미착수.

**적용한 규칙** — 앞 글자가 줄머리·공백·여는 괄호·붙임표·다른 여는 따옴표면 **여는 부호**, 그 외(글자·마침표·물음표·닫는 괄호)면 **닫는 부호**. 코드 펜스·인라인 코드·HTML 태그 내부는 건드리지 않는다. 예외 셋: `<cite src="…">` 직후는 여는 자리, `</cite>` 직전은 닫는 자리, 인용블록 마커 `>` 직후는 줄머리로 본다. 변환 스크립트는 일회성이라 저장소에 두지 않았다 — 위 규칙만으로 재현된다.

한 줄 안에서 여닫이를 번갈아 매기는 방식도, 문서 전체에서 번갈아 매기는 방식도 **쓰면 안 된다.** 인용이 줄을 넘나들고(`source/` 는 따옴표가 있는 7,901줄 중 4,438줄이 홀수 개), 원본에 짝 없는 따옴표가 하나라도 있으면 그 뒤로 파일 끝까지 위상이 뒤집힌다.

### 3.1 전례시편 51편 이후 편집 (85편)

1~50편은 편집 완료(2026-07-10). **51편부터는 편집 과정에서 따옴표·본문 오류를 함께 잡는다.**

편집 전에 따옴표 짝만 먼저 맞춰 둔 편이 있다 — **81 · 87 · 89 · 91 · 124 · 132**. 인쇄본과 본문을 대조한 것은 아니므로 편집 시 재확인이 필요하다. 특히:

- **91편** — 14절 본문이 6절·13절 뒤에 중복으로 붙어 있었다. 군더더기 4줄과 붙이다 만 ` 14“` 흔적을 지우고 진짜 14절을 `“` 로 열었다.
- **132편** — 잉여 닫는 따옴표 2개(10행·34행)와 줄 끝 `]` 를 제거했다. 인용은 3~5절, 14~18절이 각각 한 덩어리라는 판단.
- **89 · 124편** — 편 끝까지 이어지는 화자의 말에 닫는 따옴표가 없어 마지막 행에 `”` 를 붙였다.

### 3.2 앱 코드가 곧은 따옴표를 하드코딩한다

> **해소됨 (2026-07-10, PR #302).** 판정을 [`js/app/helpers.js`](../js/app/helpers.js) 의 순수 함수 `hangingQuoteClass()` 한 곳으로 모으고, 곧은·곱슬, 여는·닫는 6종을 모두 인식하도록 넓혔다. 곱슬 겹따옴표는 곧은 것보다 넓어(Noto Serif KR 기준 0.444em 대 0.389em) `.hanging-quote--curly` 전용 오프셋을 신설했다. 브라우저에서 `/1chr/16` 의 JSON 응답을 곱슬 따옴표로 바꿔치기해 확인 — 수정 전 내어쓰기 0개, 수정 후 3개, 첫 글자와 운문 기준선 차이 +0.02px(오프셋 신설 전이라면 +0.79px). 유닛 798 · e2e 215 통과. ADR-006 은 데이터 저장소에서 v2.4 로 갱신했다.

원래 문제:

`views.js` 와 `citations.js` 가 각자 `line[0] === '"'` 로 운문 행의 내어쓰기(hanging punctuation, ADR-006) 클래스를 판정해 `“` 나 `‘` 로 시작하는 행을 못 알아봤다.

- **ADR-039 시편 렌더링이 붙는 시점**: 전례시편 본문은 이미 `“` 로 시작하므로 그때 바로 이 판정이 실패했을 것이다.
- **`source/` 전환 시**: 데이터만 바꾸면 운문 첫 행 따옴표 내어쓰기가 전부 사라졌을 것이다.

> **교훈**: 데이터 표기를 바꾸기 전에, 그 표기를 문자 단위로 읽는 코드가 있는지 먼저 찾는다. 이 결합은 `tsc` 도 유닛 테스트도 못 잡았고 — 해당 코드는 유닛 테스트 사각지대였다 — 브라우저에서 바뀐 데이터로 실제 렌더해 봐야 드러났다.

### 3.3 `source/` 성서 본문 73권 미전환

변환 대상은 코드·HTML 을 뺀 **11,766곳**. 위 규칙으로 97.6% 가 고확신 판정이고, 나머지도 규칙 자체는 결정적이다. 다만 착수 전에 다음을 알고 있어야 한다.

**(a) 사람이 판단해야 하는 17곳** — 알고리즘 한계가 아니라 원본 전사(轉寫) 자체에 짝 없는 따옴표가 있다. 인쇄본 대조가 필요하다.

| 파일 | 위치 |
|---|---|
| 짝 없는 닫는 따옴표 | `1chr.md:690` · `2cor.md:142` · `gen.md:905` · `job.md:1863` · `luke.md:187` · `luke.md:250` · `rev.md:122` · `tob.md:309` |
| 닫히지 않은 여는 따옴표 | `1pet.md`(2) · `2pet.md` · `exod.md` · `ezek.md` · `gen.md` · `jdt.md` · `matt.md` · `ps.md` · `rev.md` |

**(b) `<cite src="…">` · `<note>` 속성 따옴표 510개는 반드시 보호** — 곱슬로 바꾸면 ADR-022 인용·주석 파서가 태그를 못 읽는다.

**(c) 홑따옴표도 함께 해야 한다** — `source/` 에 `'` 가 2,271개, 그중 549건이 `"… '…' …"` 중첩 인용이다. 겹따옴표만 바꾸면 `“… '…' …”` 처럼 섞여 오히려 어색해진다. 아포스트로피(단어 사이의 `'`)는 제외할 것.

**(d) 검색이 따옴표를 정규화하지 않는다** — `common-bible-data/src/search_indexer.py` 는 ¶ 와 공백만 처리하고 [`js/search-worker.js`](../js/search-worker.js) 는 소문자화만 한다. 전환 후에는 사용자가 `"` 를 입력해 검색하면 매치되지 않는다. 인덱싱·질의 양쪽에서 따옴표를 정규화할지 결정이 필요하다.

**(e) 파급 범위** — 73권 JSON + 검색 인덱스 4종이 재생성되고 `tests/test_snapshots.py` 픽스처가 통째로 갱신된다. `source/` 만 커밋하고 산출물은 `build.yml` 이 자동 커밋백하도록 둘 것 — 산출물을 직접 커밋하면 빌드가 no-op 이 되어 앱 저장소 자동 동기화가 끊긴다.

앱 쪽 준비는 끝나 있다(§3.2). 내어쓰기는 곧은·곱슬을 모두 인식하고 ADR-006 도 v2.4 로 갱신됐으므로, `source/` 전환은 데이터 저장소 안에서 독립적으로 진행할 수 있다.
