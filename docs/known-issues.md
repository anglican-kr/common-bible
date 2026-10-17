# 알려진 이슈 / 후속 과제

ADR-034(뷰·라우팅 2차 분할) 작업 중 발견·확인한 항목 모음. "나중에 대응" 대상.
최초 작성 2026-06-08.

---

## 1. e2e 사전 실패 — 전수 진단·해소 (2026-06-22)

> **해소됨 (2026-06-22).** 아래 §1a/1b/1c 묶음은 **옛 headless chromium 버전 아티팩트**였고, playwright/chromium 업그레이드(Chrome Headless Shell 148)로 **전부 통과**로 바뀌었다. 진단 중 전체 스위트를 돌려 드러난 **다른 12건은 모두 코드 변경을 e2e가 못 따라간 낡은 테스트**(앱 버그 0)였고 현행 동작에 맞게 수정했다. 당시 전체 e2e **215 통과 / 0 실패**. **2026-09-05 재실측: 232 중 225 통과 / 0 실패 / 7 미실행** — 26파일 225건 전부 통과, `test_a11y_axe.py` 7건은 선택적 의존성 `axe_playwright_python` 미설치라 모듈 단위 skip 1건으로 빠진다(`importorskip`). 하드 import 였던 것을 #319 에서 고쳤다: 그 상태에선 수집 오류로 스위트 **전체가 중단**됐다. 상세 보고서: [`archive/qa/2026-06-22-e2e-stale-refresh.md`](archive/qa/2026-06-22-e2e-stale-refresh.md).

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
- ~~**`bookmark.js` 분할**~~ **완료 (2026-06-11)** — 3,578 → **589줄**(−84%). 모듈별 점진 분리. 완료: 순수 로직 `bookmark-core.js`(query/href/sort/active) · 절 스펙 `verse-spec.js` · 모달 `bookmark-modals.js` · 폴더 모아 읽기 `bookmark-read.js` · 제스처 엔진 `bookmark-gestures.js`(드래그 reorder + 스와이프 액션 + 포인터 핸들러) · 선택 삭제 모드 `bookmark-select.js`(상태 + 캐스케이드 수학 + 삭제·공유·이동 액션 + #bm-select-bar dock — 트리렌더↔select 양방향은 import(상태/핸들러)+주입(재렌더/헤더)으로 차단) · **절 선택 모드 `bookmark-verse-select.js`(in-reading 절 선택 → 북마크/복사 + #verse-select-bar dock, near-leaf라 DI 불필요) · **⋯ 메뉴 `bookmark-menu.js`(탭 뷰 title-row 액션: 정렬·새 폴더·내보내기·가져오기·선택 + 🛈 안내 + 전체 선택 + exportBookmarks) · **트리 렌더링 `bookmark-tree.js`(per-row 빌더 + renderBookmarkTree + _rerenderActiveBookmarkTree 허브 + renderBookmarksView + 드로어 키보드 내비, ADR-034 후속, 마지막 라운드 — 드로어/헤더 콜백 3개 주입)**. **분할 완료**: bookmark.js 2,432→589줄(−76%), 드로어/헤더 오케스트레이터로 수렴(헤더 버튼·드로어 lifecycle·init 배선·facade·keydown).

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

### 3.1 전례시편 본문 편집

> **부분 해소 (2026-07-12 · 2026-08-29 재판정).** 150편 전편 편집 완료. 51~77편(`55d8d65`) → 78~103편(`e0138d8`) → 104~148편(`2b36905`)을 차례로 편집해 절을 채우고 교정했고, 마지막에 병합 절 표기를 정규화하며 절 누락 3곳을 보완했다(`cb06fd7`). 확인 시점(2026-08-08) `liturgical/psalter/*.md` 150편에 곧은 따옴표는 0곳이다. 아래 "재확인 필요"로 적어 둔 여섯 편(**81 · 87 · 89 · 91 · 124 · 132**)도 모두 이후 편집 범위(78~103 · 104~148)에 들어갔다.
>
> **다만 그 편집이 인쇄본 대조였는지는 커밋 기록만으로 단정할 수 없다.** 원래 미결 조건은 「편집 범위에 포함」이 아니라 **인쇄본 대조**였으므로, 그 증거가 없는 채로 완전 해소로 닫지 않는다. 따옴표 정규화는 끝났고(곧은 따옴표 0곳), **여섯 편의 인쇄본 대조만 남은 작업으로 유지한다.**

원래 문제:

1~50편은 편집 완료(2026-07-10)였고, **51편부터는 편집 과정에서 따옴표·본문 오류를 함께 잡기로** 했다.

편집 전에 따옴표 짝만 먼저 맞춰 둔 편이 있었다 — **81 · 87 · 89 · 91 · 124 · 132**. 인쇄본과 본문을 대조한 것은 아니어서 편집 시 재확인 대상으로 남겼다. 특히:

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

---

## 4. 전례 글리프가 본문 복사에 포함된다 (2026-08-01) — 해소 (2026-10-13)

> **해소됨 (2026-10-13, 사용자 결정 — #346).** 포함이 맞다: 「전례 시편에서는 복사하면 ◯와 ¶ 표지, 부 번호 소제목 모두 표시하는 게 활용도가 높을 것」. 세 표기를 남기고 꼴만 다듬었다 — ¶ 뒤에 한 칸, 「(N)」은 제 줄(아래 관찰의 「(2)그 옛날」 → 「(2)」 다음 줄 「그 옛날」), 부의 첫 절부터 고르면 그 「(N)」도 싣는다(`serializeVerseRange`). 같은 결정으로 전례시편 · 송가 복사의 출처를 「(대한성공회 기도서)」로 적는다. 정본은 ADR-038 §3 「구현」 · pitfalls §21, 아래는 당시 기록.

ADR-038 §3 렌더 기반이 복원하는 전례 표기 — 계응 ◯(`.responsory-mark`), 무번호 구절 ¶(`.versicle-mark`), 부 소제목 "(N)"(`.psalm-section`) — 는 실제 DOM 텍스트라서 본문 선택 복사와 절 선택 복사에 함께 실린다. 복사 경로 `serializeVerseRange`(verse-spec.js)는 절 번호·인용 칩·문단 ¶(`.pilcrow`)은 걸러내지만 이 세 표기는 아직 모른다. (PR #310 리뷰 중 인지)

**판단 필요**: 인쇄본에도 있는 표기라 포함이 결함인지부터 제품 판단이 필요하다 — 주보 제작 등 전례 용도 복사라면 ◯ 가 오히려 필요할 수 있다. 제외하기로 결정되면 `serializeVerseRange` 의 제거 목록에 세 클래스를 더하면 된다(한 줄).

**추가 관찰 (2026-10-13, #346 자체 리뷰)**: 전례독서 뷰에서 시편을 통째로 복사하면 부 소제목이 절 앞에 붙어 절 번호처럼 읽힌다 — 대림 4주일(2026-12-20) 시편 89:1-4, 19-27 이 「…왕노릇하게 하리라.”\n\n(2)그 옛날, 당신께서…」가 된다(선택이 「(1)」 앞에서 시작하면 「(1)」은 안 실려 앞뒤도 맞지 않는다). 세 표기 모두 화면에서는 `user-select: none` 이고 ◯ · ¶ 는 `aria-hidden` 이다. 같은 자리의 ※ 병행 표지(`.parallel-anchor`)는 읽기 보조라 이번에 뺐다(이형 주석 ※ 와 같은 몫).

---

## 5. PR #346 자체 리뷰에서 넘긴 후속 (2026-10-13)

#346(전례독서 뷰)을 서브에이전트 넷으로 자체 리뷰하며 찾았지만 그 PR 범위 밖이라 넘긴 것.

- ~~데이터 — 연중 12주 토요일 짝수해 독서 레코드가 없다~~ — **해소됨 (2026-10-13).** 사용자가 기사(5872)를 찾아 주어 data#31 이 `fetch.py EXTRA_ARTICLES` 로 채웠고(data#30 과 같은 종류 — 수집 태그 누락), #346 이 포인터를 올리며 실데이터 테스트의 알려진 결손 표(`KNOWN_GRID_GAPS`)를 지웠다 — 이제 격자 빈 칸이 하나라도 생기면 테스트가 멈춘다. 2026-06-27 의 초기 독서는 키릴 공통 독서가 아니라 그날 평일 독서다(설계서 미결25).
- **북마크 복사 버튼 — 번호가 같은 다른 절을 한 묶음으로 본다**(main 부터). `collapseFullVerseRefs` 가 `parseInt` 로 묶어 다니 3 의 그리스어 (26)~(33) ∧ 히브리 26~33, 에스델 4:17 의 추가 본문, 이사 40 의 41:6-7 에서 인용이 줄 글자로 터지거나 다른 절을 가리킨다. 본문 선택 복사(장 본문 · 전례독서)는 #346 에서 이 함수를 쓰지 않게 됐다. 고치려면 span 에 절 인스턴스 키를 달고 그것으로 묶는다. 같은 뿌리로 절 선택 막대는 옮겨 실린 절 · 그리스어 절 번호도 출처에 넣는다(이사 40:19-20 을 고르면 「40:6a,6b,7,19-20」 — main 부터; 머지 전 검토 2026-10-14 가 본문 선택 복사 쪽만 고쳤다).
- **스킵 링크 「본문 바로가기」(`#app`)를 전역 `<a>` 가로채기가 먹는다**(main 부터) — 포커스가 본문으로 가지 않는다.

---

## 6. PR #346 머지 전 검토에서 넘긴 후속 (2026-10-14)

머지 전에 서브에이전트 둘(기존 앱 회귀 · 자체 리뷰 이후 변경)이 다시 본 뒤, 고친 것을 빼고 남긴 것.

- **반절이 절 전체로 보이는 47곳**(데이터의 반절 참조 59곳 가운데 — 절이 한 줄 33곳 · 세 줄 이상 14곳). 정확히 두 줄인 절만 그 줄을 고르고 나머지는 절 전체를 그린다(ADR-038 §3 「구현」). 예: 「집회 51:12하-20상」의 끝 20상은 서울교구 게시글이 20절의 앞 두 줄에서 끝나는데 뷰는 네 줄을 다 그린다. 데이터 저장소의 게시글 캐시(`liturgical/html/`)가 반절의 실제 줄을 싣고 있어, 그것으로 반절마다 줄(또는 글자 위치)을 정해 데이터에 두면 정확해진다.
- **전례독서 · 캘린더 모듈을 모든 화면에서 내려받는다** — `index.html` 의 `<script type="module">` 이고 `routing.js` 가 정적으로 import 해서 성서만 읽는 사람도 `lectionary.js`(약 70KB)와 A2 의 `calendar.js`(약 20KB)를 받는다. 교회력 데이터는 `/calendar` · `/lectionary` 를 열 때만 받는다. 두 모듈을 함께 라우트에서 동적 `import()` 로 바꿀 수 있다 — A2 뒤 별도 PR(사용자 승인 2026-10-15, coding-pitfalls §24).
- **서비스 워커 설치와 오프라인 동작은 확인하지 못했다** — 헤드리스 Chromium 에서는 동시에 10개 넘게 받는 설치가 멈춰(main 의 `sw.js` 도 같다) 브라우저로 볼 수 없었다. `SHELL_FILES` 54개가 모두 200 으로 응답하는 것만 curl 로 확인했다. 배포 전 실기기에서 한 번 확인한다.

---

## 7. A2(캘린더 탭) 작업 중 찾은 후속 (2026-10-15)

- **앱 모듈 22개가 실제로는 타입 검사를 받지 않는다**(오래된 결함 — main 부터). 첫 줄이 `"use strict";` 이고 둘째 줄이 `// @ts-check` 인 파일은 지시문이 파일 머리 주석이 아니게 되어 tsc 가 그 파일을 건너뛴다(`tsconfig.json` 은 `checkJs: false`). 일부러 넣은 타입 오류를 `npm run typecheck` 가 잡지 못하는 것으로 확인했다 — `js/app.js` 와 `js/app/` 의 21개(audio-player · bookmark 계열 9 · citations · data-fetch · install · overlay · parallels · reading-context · routing · search · settings-ui · verse-spec · views). 두 줄의 순서를 바꾸면 오류 **203건**이 드러난다(2026-10-17 실측 — bookmark-modals 50 · views 48 · search 22 · bookmark-read 16 · routing 13 · bookmark-tree 11 · bookmark 11 · citations 9 · app.js 6 · 나머지 17). `docs/status.md` 의 「모든 클라이언트 JS 에 `// @ts-check` … 0 error」는 이 파일들에서는 사실이 아니다. 같은 결함을 #346 이 `lectionary.js` 에서 고쳤다(975줄이 검사 밖이었다 — 원장 `docs/changes/2026-10-12-lectionary-view.md` 3회차 ①). A2 의 새 `calendar.js` 는 첫 줄이 `// @ts-check` 이고 일부러 넣은 오류가 잡히는 것을 확인했다. **고치는 법**: 파일마다 두 줄의 순서를 바꾸고 드러난 오류를 고친다 — 파일이 많고 오류가 실제 결함일 수도 있어 별도 PR(파일 묶음별)로.

---

## 8. PR #348 리뷰에서 넘긴 후속 (2026-10-15) — 해소 (2026-10-17)

> **해소됨 (2026-10-17) — 본문을 지웠다.** #348(캘린더 탭 1단계) 리뷰가 넘긴 셋을 모두 고쳤기 때문이다 — ① 캘린더가 고유명 평일을 엔진 좌표로 가려내던 것 → 엔진이 격자 관측일에 단 표지 `properWeekday` 를 읽는다 ② 헤더 아이콘 SVG 생성이 셋으로 복제돼 있던 것 → `helpers.js headerIcon` 하나(쓰이지 않던 `buildBackBtn` 은 삭제) ③ 전례독서 화면이 다시 그린 뒤 포커스를 잃던 것 → 캘린더와 공용 `helpers.js createFocusMemory`(누른 컨트롤 · 같은 화면 위치로). 이 문서는 남은 것만 싣는다. 고친 내용과 검증은 원장 `docs/changes/2026-10-17-known-issues-8.md`, 넘길 때의 기록은 `docs/changes/2026-10-15-calendar-tab.md` 「리뷰 반영」 ⑥ · ⑦ · ⑫. §9 를 당겨 번호를 메우지 않는다 — 머지된 원장 · 메모가 「§8」 · 「§9」를 번호로 가리켜, 당기면 그 참조가 다른 절을 가리키게 된다.

---

## 9. PR #349 리뷰에서 넘긴 후속 (2026-10-16)

#349(저녁 전례)의 `/code-review` 가 범위 밖으로 짚은 것. 지적 15건은 모두 그 PR 에서 고쳤다 — 조치는 원장 `docs/changes/2026-10-15-liturgical-engine-evening.md` 「리뷰 반영」.

- **배포 목록에 `data/lectionary/` 가 없다 — 다음 릴리스를 막는다**(이 저장소 밖 — `common-bible-server`). `scripts/deploy-manifest.txt` 의 정적 자산 줄에 `data/bible/` · 검색 색인만 있고 교회력 · 전례독서 묶음(`data/lectionary/*.json`)이 없다(2026-10-16 확인). 이대로 배포하면 `deploy.zip` 에 묶음이 빠져 dev · 운영의 `/calendar` · `/lectionary` 가 「교회력 자료를 불러오지 못했습니다」 화면이 된다. 서버 저장소 PR 로 그 줄을 더하고 `deploy.sh verify` 가 묶음 하나의 200 을 보게 한다(메모의 「배포 목록 갱신 망각」 함정 — 목록 → 트리 방향만 검사된다).

---

## 10. PR #350 리뷰에서 넘긴 후속 (2026-10-17)

#350(§8 셋)을 `/code-review` 로 본 것 가운데 그 PR 에서 고치지 않고 넘긴 것. 고친 것과 각 건의 조치는 원장 `docs/changes/2026-10-17-known-issues-8.md` 「리뷰 반영」. 넘긴 일곱 가운데 셋(계산 범위 판정 하나로 · 날짜 이동 줄 하나로 · 인용 시트 꺾쇠)은 2026-10-17 에 고쳐 지웠다 — 원장 `docs/changes/2026-10-17-known-issues-10-part1.md`.

- **성서 목록의 구분 탭 · 검색의 「← 이전 · 다음 →」도 다시 그린 뒤 포커스를 잃는다**(main 부터 — WCAG 2.4.3, pitfalls §5 「다시 그리는 화면의 포커스 규칙」). Enter 를 누르면 포커스가 body 로 빠진다. 뷰마다 `createFocusMemory` 를 다는 지금 방식은 구분 탭을 덮지 못한다 — 탭이 뷰 루트 밖(`#division-tabs-slot`, `route()` 가 비운다)이고, 목록이 `route()` 의 `await loadBooks()` 뒤에 그려져 `take()` 가 await 뒤에 돈다. 라우터 수준 — 전역 `<a>` 인터셉터가 누른 자리를 남기고, `route()` 가 시작에서 꺼내 `finally`(`onRouteEnd` 옆)에서 돌려주며, 뷰는 `data-focus-key` 만 단다 — 이 더 넓게 덮는다. ADR-038 2단계(주간 · 목록, 화면을 건너는 월간|주간|목록 세그먼트)에 앞서 한다 — **라우터 수준으로 하기로 했다**(사용자 결정 2026-10-17, 다음 PR). 검색의 「다음 →」 · 「← 이전」도 같은 규칙으로 **누른 컨트롤 그대로**(사용자 결정 2026-10-17 — 결과 목록 맨 위로 보내는 안 대신; 마지막 페이지라 「다음 →」이 없으면 「← 이전」). 같은 PR 에서 §5 의 「본문 바로가기」(전역 `<a>` 인터셉터) 도 함께 본다.
- **`createFocusMemory` 를 쓰는 화면마다 네 걸음을 손으로 잇는다**(만들기 · 커밋마다 루트에 `remember` · 렌더 시작에 `take` · 커밋 뒤 `restore` — 대체 키는 언제나 「오늘」). 리스너를 빠뜨리거나 다른 요소에 달아도 오류 없이 포커스만 잃는다. `mount(root, spot)` 하나로 묶을지는 위 라우터 수준 안과 함께 정한다.
- **iOS 18.4 미만에서는 탭한 뒤 다시 그린 화면에 포커스 링이 남을 수 있다 — 기기 확인 대기.** WebKit 은 탭으로 링크에 포커스를 주지 않아, 복원의 스크립트 포커스를 `:focus-visible` 로 쳐 링을 그린다(WebKit 소스 · 성서 목록 책 카드의 같은 일 `43db624`). #350 리뷰에서 포인터로 누른 복원은 `focus({ focusVisible: false })` 로 링 없이 두게 했는데, 그 옵션은 Safari 18.4 부터다. 실제 아이폰(18.4 이상 · 미만)에서 전례독서의 칩 · 세그먼트 · 카드 · ‹ › 와 캘린더의 달 이동을 눌러 보고, 18.4 미만이 의미 있으면 책 카드처럼 표지로 막는다(키보드 · VoiceOver 의 포커스 복원은 남긴다).
- **Safari 26 이하 데스크톱 — 다시 그린 뒤 위치의 남은 경우.** 머리가 접힌 채 위로 되돌아온 자리(스크롤 10 ~ 60px — 이력 구간)에서 새 장을 받는 다시 그리기를 누르면, 돌아온 뒤에도 머리의 검색 줄이 펼친 채 남아 누른 컨트롤이 그 줄 높이(약 46px)만큼 아래에 선다. 스크롤 고정(scroll anchoring)이 있는 브라우저(Chrome · Edge · Firefox · Safari 27+)는 화면 위치 그대로다(`helpers.js createFocusMemory`). 근본은 같은 뷰를 다시 그릴 때 스켈레톤이 문서를 줄여 스크롤을 누르지 않게 하는 것(라우터)이지만, **고치지 않고 기록만 둔다**(사용자 결정 2026-10-17 — Safari 27(2026-09) 보급으로 줄어드는 좁은 경우라 스켈레톤 동작을 바꾸는 비용 · 위험에 못 미친다).
