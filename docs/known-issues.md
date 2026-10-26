# 알려진 이슈 — 번호 대장

열린 이슈의 본문은 그 주제 문서(`docs/topics/`)의 「남은 일」에 있다. 이 파일은 번호마다 어디로 옮겼는지, 언제 해소했는지를 적는 대장이다. 코드 주석과 머지된 원장이 「known-issues §N」으로 가리키므로 번호는 다시 쓰지도 당기지도 않는다(pitfalls §26).

- 새 이슈는 다음 번호(§34부터)를 받고, 이슈 하나에 번호 하나를 준다. 본문은 주제 문서에 쓰고, 여기에는 절 제목과 대장 줄만 둔다.
- 절마다 남은 소개 문단과 해소 기록은 그 번호의 이력이다. 이 파일은 2026-06-08에 ADR-034(뷰·라우팅 2차 분할) 작업 중 찾은 항목 모음으로 시작했고, 2026-10-23에 열린 이슈를 주제 문서로 옮겼다.

---

## 1. e2e 사전 실패 — 전수 진단·해소 (2026-06-22)

> **해소됨 (2026-06-22).** 아래 §1a/1b/1c 묶음은 **옛 headless chromium 버전 아티팩트**였고, playwright/chromium 업그레이드(Chrome Headless Shell 148)로 **전부 통과**로 바뀌었다. 진단 중 전체 스위트를 돌려 드러난 **다른 12건은 모두 코드 변경을 e2e가 못 따라간 낡은 테스트**(앱 버그 0)였고 현행 동작에 맞게 수정했다. 당시 전체 e2e **215 통과 / 0 실패**. **2026-09-05 재실측: 232 중 225 통과 / 0 실패 / 7 미실행** — 26파일 225건 전부 통과, `test_a11y_axe.py` 7건은 선택적 의존성 `axe_playwright_python` 미설치라 모듈 단위 skip 1건으로 빠진다(`importorskip`). 하드 import 였던 것을 #319 에서 고쳤다: 그 상태에선 수집 오류로 스위트 **전체가 중단**됐다. 상세 보고서는 PR #299에 있었다(보고서 파일은 2026-10-22 삭제, git 이력에 있다).

원래 묶음(현재 통과):

- **1a. `test_tabbar.py` 모핑 검색** — `#search-input` 모핑이 옛 headless에서 안 펼쳐지던 문제. 새 chromium에서 11/11 통과.
- **1b. `test_settings.py`** — `.settings-popover` 토글·`location.reload()` 타이밍. 3/3 통과.
- **1c. `test_bookmark_folders.py`** — 데스크탑 드로어 `.bm-folder-row` 토글. 2/2 통과.

진단 중 발견·수정한 **낡은 테스트 12건**(설계가 바뀌었는데 e2e 미갱신 — e2e가 CI 미실행이라 드리프트가 조용히 쌓임):

- **`test_book_name_swap.py` 4건** — 복음서(마태오/마르코/루가/요한)에도 모바일 짧은 명칭이 추가(`NT_MOBILE_NAME`)됐는데 테스트는 "복음서는 정식명 유지" 옛 규칙을 그대로 확인하고 있었다. + 터치 기기는 `.compact` 클래스가 아니라 `pointer:coarse` 미디어쿼리로 전환 + 반응형 책 그리드가 폰트 따라 칼럼을 넓혀 32px로는 더 이상 안 넘침(좁은 창에서 측정). 모두 현행 동작에 맞게 수정 + 복음서 전환 양성 케이스 추가.
- **`test_features.py` 롱프레스 1건** — 절 선택 진입 임계값 300→**500ms** 변경(커밋 a506958)인데 테스트는 350ms만 눌러 진입 실패. 650ms로 수정.
- **`test_install_guide.py` 7건** — 첫 방문 너지 노출이 **의도적으로 제거**(기본 `nextShow` 2 — 검색 유입·크롤러 배려, 돌아온 2번째 방문 노출)됐는데 테스트는 첫 방문 노출을 기대. 2번째 방문 상태(`{visits:1, nextShow:2}`)로 수정 + 첫 방문 미노출 양성 케이스 추가.

> **교훈**: e2e가 CI 미실행이라 코드 변경 시 e2e가 조용히 드리프트한다. 기능 변경 후 영향 e2e를 함께 갱신할 것. axe a11y 테스트를 돌리려면 `pip install axe-playwright-python` 필요.

---

## 2. ADR-034 남은 작업

상세는 [`docs/decisions/034-views-routing-second-split.md`](decisions/034-views-routing-second-split.md).

- **PR5b `closeAllOverlays` ✅ 완료** — `route()` 의 14개 오버레이 teardown(12 `closeIfOpen` + settings/chapter popover)을 `overlay.js` 의 `closeAllOverlays()` 하나로 축약. createOverlay가 모든 인스턴스를 registry에 등록, closeAllOverlays가 열린 것만 close + detached panel prune. routing→6개 모듈 close fn 하드코딩 의존 제거.
- **PR5c `registerView` dispatch 역전 (보류 — 상세 §2.1)** — 단독 PR로는 보류, Phase 2 라우트 추가 또는 설정 화면 재구성에 얹어서.
- ~~audio `applyAudioShow` → `window.parsePath` facade edge~~ **조사 완료 → 현 설계 유지 (§2.2)** — 없애려던 항목이나 검토 결과 facade가 정답(명시 import는 사이클, readingContext는 stale, state-machine 호출자는 컨텍스트 못 줌). 조치 없음.
- ~~**`bookmark.js` 분할**~~ **완료 (2026-06-11)** — 3,578 → **589줄**(−84%). 모듈별 점진 분리. 완료: 순수 로직 `bookmark-core.js`(query/href/sort/active) · 절 스펙 `verse-spec.js` · 모달 `bookmark-modals.js` · 폴더 모아 읽기 `bookmark-read.js` · 제스처 엔진 `bookmark-gestures.js`(드래그 reorder + 스와이프 액션 + 포인터 핸들러) · 선택 삭제 모드 `bookmark-select.js`(상태 + 캐스케이드 수학 + 삭제·공유·이동 액션 + #bm-select-bar dock — 트리렌더↔select 양방향은 import(상태/핸들러)+주입(재렌더/헤더)으로 차단) · **절 선택 모드 `bookmark-verse-select.js`(in-reading 절 선택 → 북마크/복사 + #verse-select-bar dock. 조정 모듈을 다시 호출하지 않아 의존성 주입(DI)이 필요 없다) · **⋯ 메뉴 `bookmark-menu.js`(탭 뷰 title-row 액션: 정렬·새 폴더·내보내기·가져오기·선택 + 🛈 안내 + 전체 선택 + exportBookmarks) · **트리 렌더링 `bookmark-tree.js`(per-row 빌더 + renderBookmarkTree + _rerenderActiveBookmarkTree 허브 + renderBookmarksView + 드로어 키보드 내비, ADR-034 후속, 마지막 라운드 — 드로어/헤더 콜백 3개 주입)**. **분할 완료**: bookmark.js 2,432→589줄(−76%), 드로어/헤더 오케스트레이터만 남았다(헤더 버튼·드로어 lifecycle·init 배선·facade·keydown).

- §2.1 → [topics/platform.md](topics/platform.md)

### 2.2 audio `applyAudioShow` → `window.parsePath` (2026-06-08 검토 → 현 설계 유지)

`applyAudioShow`(오디오 설정 라이브 토글)가 현재 라우트를 알려고 `window.parsePath()`를 facade로 호출하는 부분. PR1 이후 "audio→routing 임시 edge"로 적어뒀으나, 검토 결과 **그대로 두는 게 맞다.** 억지로 없애면 셋 중 하나를 감수해야 함:

1. **명시 import → import 사이클.** 의존이 `routing → views-routing → audio-player` 인데, audio-player가 `import { parsePath } from "./routing.js"` 하면 `routing → views-routing → audio-player → routing` 3-모듈 순환. 현 `window.parsePath` facade가 바로 이 사이클을 피하는 장치.
2. **`readingContext`는 stale.** `readingContext.bookId/chapter`는 `renderChapter`에서만 set되고 non-chapter 뷰에서 null 리셋이 없음("마지막 본 장" ≠ "현재 장"). 뷰 무관하게 호출되는 `applyAudioShow`가 홈에서 stale 장으로 오작동. 쓰려면 모든 non-chapter 리셋 + prologue=0 set 추가 → bookmark `!readingContext.chapter` 등 다운스트림 리스크.
3. **호출자가 컨텍스트를 못 준다.** `state-machine.js`가 synced `audioShow` 값을 적용할 때(동기화 레이어) 라우트 컨텍스트가 없어 인자로 못 넘김 → 내부에서 현재 뷰를 다시 알아내야 함(=parsePath).

`parsePath`는 route()/navigate() 같은 오케스트레이션이 아니라 **순수 URL 파싱 유틸**이라, audio가 facade로 읽는 건 양성(benign) 의존. **조치 없음.**

---

## 3. 곱슬 따옴표 전환 — 남은 작업 (2026-07-10)

`common-bible-data` 의 마크다운 본문 인용부호를 곧은 따옴표(`"`)에서 곱슬 따옴표(`“`·`”`)로 옮기는 작업. **`liturgical/` 은 완료**, `source/`(성서 본문 73권)는 미착수.

변환 규칙과 남은 작업은 주제 문서로 옮겼다(2026-10-23).

- §3.1 → [topics/bible-text.md](topics/bible-text.md)

- §3.2 → [topics/bible-text.md](topics/bible-text.md)

- §3.3 → [topics/bible-text.md](topics/bible-text.md)

---

## 4. 전례 글리프가 본문 복사에 포함된다 (2026-08-01) — 해소 (2026-10-13)

> **해소됨 (2026-10-13, 사용자 결정 — #346).** 포함이 맞다: 「전례 시편에서는 복사하면 ◯와 ¶ 표지, 부 번호 소제목 모두 표시하는 게 활용도가 높을 것」. 세 표기를 남기고 모양만 다듬었다 — ¶ 뒤에 한 칸, 「(N)」은 제 줄(아래 관찰의 「(2)그 옛날」 → 「(2)」 다음 줄 「그 옛날」), 부의 첫 절부터 고르면 그 「(N)」도 싣는다(`serializeVerseRange`). 같은 결정으로 전례시편 · 송가 복사의 출처를 「(대한성공회 기도서)」로 적는다. 기준은 ADR-038 §3 「구현」 · pitfalls §21, 아래는 당시 기록.

ADR-038 §3 렌더 기반이 복원하는 전례 표기 — 계응 ◯(`.responsory-mark`), 무번호 구절 ¶(`.versicle-mark`), 부 소제목 "(N)"(`.psalm-section`) — 는 실제 DOM 텍스트라서 본문 선택 복사와 절 선택 복사에 함께 실린다. 복사 경로 `serializeVerseRange`(verse-spec.js)는 절 번호·인용 칩·문단 ¶(`.pilcrow`)은 걸러내지만 이 세 표기는 아직 모른다. (PR #310 리뷰 중 인지)

**판단 필요**: 인쇄본에도 있는 표기라 포함이 결함인지부터 제품 판단이 필요하다 — 주보 제작 등 전례 용도 복사라면 ◯ 가 오히려 필요할 수 있다. 제외하기로 결정되면 `serializeVerseRange` 의 제거 목록에 세 클래스를 더하면 된다(한 줄).

**추가 관찰 (2026-10-13, #346 자체 리뷰)**: 전례독서 뷰에서 시편을 통째로 복사하면 부 소제목이 절 앞에 붙어 절 번호처럼 읽힌다 — 대림 4주일(2026-12-20) 시편 89:1-4, 19-27 이 「…왕노릇하게 하리라.”\n\n(2)그 옛날, 당신께서…」가 된다(선택이 「(1)」 앞에서 시작하면 「(1)」은 안 실려 앞뒤도 맞지 않는다). 세 표기 모두 화면에서는 `user-select: none` 이고 ◯ · ¶ 는 `aria-hidden` 이다. 같은 자리의 ※ 병행 표지(`.parallel-anchor`)는 읽기 보조라 이번에 뺐다(이형 주석 ※ 와 같은 몫).

---

## 5. PR #346 자체 리뷰에서 넘긴 후속 (2026-10-13) — 해소 (2026-10-21)

> **해소됨 (2026-10-21) — 본문을 지웠다.** 항목은 둘이었다.
>
> 「연중 12주 토요일 짝수해 독서 레코드가 없다」는 2026-10-13에 data#31이 채웠다(사용자가 기사 5872를 찾아 주었다).
>
> 「북마크 복사 버튼이 번호가 같은 다른 절을 한 묶음으로 본다」의 원인은 절 선택이 절 번호(`data-vref`)로 묶여 있던 것이었다. 이사 40장의 41:6을 누르면 40:6도, 에스 4:17의 추가 본문 하나를 누르면 25개 절이 선택됐다. 출처도 틀려서, 이사 40:19-20은 「40:6a,6b,7,19-20」, 에스 4:17의 추가 본문은 「4:17a」였다. 이제 줄마다 고유한 키(`data-vkey`)로 선택하고, 출처에 넣을 절은 장 본문 복사와 같은 규칙으로 고른다. 옮겨 실린 절만 고르면 본래 장으로 적는다(「41:6-7」, 사용자 결정 2026-10-21). 북마크는 번호 단위 저장 그대로다.
>
> 결정은 ADR-010 「세그먼트와 저장 표기」와 ADR-038 §3, 변경과 검증은 원장 `docs/changes/2026-10-21-bookmark-copy-verse-instances.md`, 처음 넘길 때의 기록은 `docs/changes/2026-10-12-lectionary-view.md`에 있다. 작업 중 찾은 후속은 §16에 적었다.

---

## 6. PR #346 머지 전 검토에서 넘긴 후속 (2026-10-14)

머지 전에 서브에이전트 둘(기존 앱 회귀 · 자체 리뷰 이후 변경)이 다시 본 뒤, 고친 것을 빼고 남긴 것. 「전례독서 · 캘린더 모듈을 모든 화면에서 내려받는다」는 2026-10-17에 고쳐 지웠다 — 세 모듈(엔진 포함)을 그 화면에 처음 갈 때 불러온다(원장 `docs/changes/2026-10-17-lazy-liturgical-modules.md`). 「반절이 절 전체로 보이는 47곳」은 2026-10-22에 고쳐 지웠다. 데이터의 경계 표대로 반절을 그린다(ADR-038 §3 「구현」, 원장 `docs/changes/2026-10-22-lectionary-half-verses.md`).

- §6.1 → [topics/cache-release.md](topics/cache-release.md)
- §6.2 → [topics/liturgical.md](topics/liturgical.md)

---

## 7. A2(캘린더 탭) 작업 중 찾은 후속 (2026-10-15)

- §7.1 → [topics/platform.md](topics/platform.md)

---

## 8. PR #348 리뷰에서 넘긴 후속 (2026-10-15) — 해소 (2026-10-17)

> **해소됨 (2026-10-17) — 본문을 지웠다.** #348(캘린더 탭 1단계) 리뷰가 넘긴 셋을 모두 고쳤기 때문이다 — ① 캘린더가 고유명 평일을 엔진의 절기 위치로 가려내던 것 → 엔진이 격자 전례일에 단 표지 `properWeekday` 를 읽는다 ② 헤더 아이콘 SVG 생성이 셋으로 복제돼 있던 것 → `helpers.js headerIcon` 하나(쓰이지 않던 `buildBackBtn` 은 삭제) ③ 전례독서 화면이 다시 그린 뒤 포커스를 잃던 것 → 캘린더와 공용 `helpers.js createFocusMemory`(누른 컨트롤 · 같은 화면 위치로). 이 문서는 남은 것만 싣는다. 고친 내용과 검증은 원장 `docs/changes/2026-10-17-known-issues-8.md`, 넘길 때의 기록은 `docs/changes/2026-10-15-calendar-tab.md` 「리뷰 반영」 ⑥ · ⑦ · ⑫. §9 를 당겨 번호를 메우지 않는다 — 머지된 원장 · 메모가 「§8」 · 「§9」를 번호로 가리켜, 당기면 그 참조가 다른 절을 가리키게 된다.

---

## 9. PR #349 리뷰에서 넘긴 후속 (2026-10-16) — 해소 (2026-10-18)

> **해소됨 (2026-10-18) — 본문을 지웠다.** 하나 남았던 「배포 목록에 `data/lectionary/`가 없다 — 다음 릴리스를 막는다」를 서버 저장소가 고쳤다(`common-bible-server` `2b28813` — 배포 목록에 `data/lectionary/`를 더하고, `deploy.sh verify`가 교회력 · 전례독서 묶음에서 한 파일씩 200을 본다). 2026-10-18 dev 배포(`bible-1.6.4-64f132f`)에서 검증 9종이 통과했고, 사용자가 dev의 캘린더를 확인했다(이상 없음). 넘길 때의 기록은 원장 `docs/changes/2026-10-15-liturgical-engine-evening.md` 「리뷰 반영」, 지운 기록은 원장 `docs/changes/2026-10-18-typecheck-batch-2.md`. §10을 당겨 번호를 메우지 않는다 — 머지된 원장 · 메모가 절을 번호로 가리킨다.

---

## 10. PR #350 리뷰에서 넘긴 후속 (2026-10-17)

#350(§8 셋)을 `/code-review` 로 본 것 가운데 그 PR 에서 고치지 않고 넘긴 것. 고친 것과 각 건의 조치는 원장 `docs/changes/2026-10-17-known-issues-8.md` 「리뷰 반영」. 넘긴 일곱 가운데 셋(계산 범위 판정 하나로 · 날짜 이동 줄 하나로 · 인용 시트 꺾쇠)은 2026-10-17 에 고쳐 지웠다 — 원장 `docs/changes/2026-10-17-known-issues-10-part1.md`. 둘(라우터 수준 포커스 복원 · 화면마다 잇던 네 걸음)도 같은 날 고쳐 지웠다 — 원장 `docs/changes/2026-10-17-router-focus-restore.md`. 남은 둘은 기기 확인 대기와 기록만 두기로 한 것이다.

- §10.1 · §10.2 → [topics/routing.md](topics/routing.md)

---

## 11. 타입 검사 묶음 ①(PR #353) 작업 · 리뷰 중 찾은 후속 (2026-10-17)

#353의 e2e 검증 · 리뷰에서 찾았지만 그 PR 범위 밖이라 넘긴 것. 첫 항목이던 「로그아웃 직후, 진행 중이던 동기화가 토큰 없이 업로드를 한 번 더 보낸다」(e2e `test_sign_out_clears_sync`가 가끔 실패한 원인)는 2026-10-17에 고쳐 지웠다 — 사이클이 대기마다 상태가 아직 SYNCING 인지 본다(원장 `docs/changes/2026-10-17-sync-signout-inflight.md`).

- §11.1 · §11.2 → [topics/bible-text.md](topics/bible-text.md)

---

## 12. Drive 동기화 PR(#354)의 문서 현행화 중 찾은 후속 (2026-10-17)

#354에서 `architecture.md` · README와 data 저장소 README를 현행화하며 찾았지만 그 PR 범위 밖이라 넘긴 것. 고친 것은 원장 `docs/changes/2026-10-17-sync-signout-inflight.md` 「갱신한 문서」와 data 저장소 PR #33.

- §12.1 · §12.4 · §12.5 → [topics/platform.md](topics/platform.md)
- §12.2 → [topics/bible-text.md](topics/bible-text.md)
- §12.3 → [topics/liturgical.md](topics/liturgical.md)

---

## 13. PR #355(지연 로드) 리뷰에서 넘긴 후속 (2026-10-18)

- §13.1 → [topics/routing.md](topics/routing.md)
- §13.2 · §13.3 · §13.4 → [topics/liturgical.md](topics/liturgical.md)
- §13.5 → [topics/platform.md](topics/platform.md)

---

## 14. 타입 검사 묶음 ③(북마크 모듈) 작업 중 찾은 후속 (2026-10-18) — 해소 (2026-10-18)

> **해소됨 (2026-10-18) — 본문을 지웠다.** 하나였던 「북마크 가져오기가 항목을 검사하지 않는다」를 고쳤다 — 사용자 결정(2026-10-18, 파일 전체 거절과 견준 뒤)대로 어긋난 항목만 빼고 들이고, 뺀 개수는 병합 · 덮어쓰기 전에 확인 대화상자가 알린다(들일 항목이 없으면 스낵바). 결정과 버린 선택지는 ADR-040, 고친 내용과 검증은 원장 `docs/changes/2026-10-18-bookmark-import-items.md`, 넘길 때의 기록은 `docs/changes/2026-10-18-typecheck-batch-3.md`. 머지된 원장 · 메모가 절을 번호로 가리키므로 번호는 그대로 둔다.

---

## 15. PR #359(북마크 가져오기 검사) 리뷰에서 넘긴 후속 (2026-10-19)

2회차 리뷰(Copilot 2회차 + 자체 리뷰어 셋)가 찾은 것 가운데 이 PR 전부터 있었거나 가져오기와 상관없는 것들이다. 가져오기 검사가 막는 것은 그 PR에서 고쳤다(ADR-040). 첫 항목이던 「공유 링크의 절 범위가 앱을 멈춘다」는 2026-10-21에 고쳐 지웠다 — 주소의 여러 구간도 가져오기 검사와 같은 표기만 강조하고(앞뒤 쉼표는 걷고 본다), 나머지는 장만 연다(ADR-040 · 원장 `docs/changes/2026-10-21-verse-range-link.md`). 그 항목이 예로 든 `/john/3/1-4294967296`은 구간이 하나라 펼치지 않아 멀쩡했다(장의 마지막 절로 잘린다). 멈춘 것은 `1-4294967296,5`처럼 구간이 둘 이상인 주소였다.

- §15.1 · §15.3 · §15.4 · §15.6 · §15.7 · §15.8 → [topics/bookmark.md](topics/bookmark.md)
- §15.2 · §15.5 → [topics/sync.md](topics/sync.md)

---

## 16. 절 선택 복사 수정(§5) 중 찾은 후속 (2026-10-21)

- §16.1 · §16.2 → [topics/bookmark.md](topics/bookmark.md)

---

## 17. PR #364(반절 표기 정리) 리뷰에서 넘긴 후속 (2026-10-22)

첫 항목이던 「여러 줄로 된 병합 절은 북마크에 첫 번호로 저장된다」는 2026-10-22에 고쳐 지웠다. 병합 절은 범위(「7-8」)로 저장하고 앞뒤 절과 잇는다(ADR-010 「북마크 저장」, 원장 `docs/changes/2026-10-22-bookmark-legacy-spec.md`). 이미 저장된 첫 번호(「7」)는 그대로 둔다(사용자 결정 2026-10-22).

- §17.1 → [topics/bookmark.md](topics/bookmark.md)

---

## 18. PR #365(전례독서 반절)에서 넘긴 후속 (2026-10-22)

첫 항목이던 「이전 버전 북마크와의 하위 호환성」은 2026-10-22에 고쳐 지웠다. 옛 판이 저장한 줄 글자를 앱을 시작할 때, 가져올 때, 동기화 결과를 적용할 때 지금 표기로 옮긴다(ADR-010 「옛 저장값」, coding-pitfalls §38, 원장 `docs/changes/2026-10-22-bookmark-legacy-spec.md`).

- §18.1 → [topics/liturgical.md](topics/liturgical.md)

---

## 19. 옛 북마크 하위 호환성 작업 중 찾은 후속 (2026-10-22)

- §19.1 → [topics/bookmark.md](topics/bookmark.md)

---

## 20. 노트 탭(ADR-026) 재개 (2026-10-22)

- §20 → [topics/routing.md](topics/routing.md)

---

## 21. 모바일 북마크 드로어의 바텀시트 코드 정리 (2026-10-22)

- §21 → [topics/bookmark.md](topics/bookmark.md)

---

## 22. 디자인 시스템 아티팩트 (2026-10-22)

- §22 → [topics/design-system.md](topics/design-system.md)

---

## 23. 디자인 시스템 초안에서 찾은 CSS 어긋남 셋 (2026-10-18)

- §23 → [topics/design-system.md](topics/design-system.md)

---

## 24. ADR과 설계서 문체 정리 (2026-10-22) — 해소 (2026-10-26)

> **해소됨 (2026-10-26) — 본문을 지웠다.** ADR 001-040(#382-#396), 교회력 설계서 본문(#397, #399, #405-#408, #412-#415), 검토 문서(#398, #416, #419, #420, #431)를 고쳐 쓰며 내용을 검증했다. 그 뒤 정한 말로 비유 용어와 음차 용어를 바꿨다(data#46, #432, #434, 기준은 `docs/writing.md` 「용어」). 검토 문서는 나누지 않는다(사용자 결정 2026-10-26). 과정의 사용자 결정은 각 PR의 원장에 있다. 머지된 원장과 메모가 절을 번호로 가리키므로 번호는 그대로 둔다.

---

## 25. 2027 책자 대조에서 넘긴 데이터 절 번호 의심 (2026-10-13)

- §25 → [topics/liturgical.md](topics/liturgical.md)

---

## 26. 캐시에서 지운 장을 오프라인에서 재생할 때의 안내 (2026-10-23)

- §26 → [topics/audio.md](topics/audio.md)

---

## 27. 제목 헤더의 설정 버튼이 어느 화면 폭에서도 보이지 않는다 (2026-10-23)

- §27 → [topics/routing.md](topics/routing.md)

---

## 28. `DESIGN.md` §2의 테마색 범위가 코드와 다르다 (2026-10-23)

- §28 → [topics/design-system.md](topics/design-system.md)

---

## 29. 같은 절에서 시작하는 병행 표시 둘을 앱은 그리지만 parser가 막는다 (2026-10-23)

- §29 → [topics/bible-text.md](topics/bible-text.md)

---

## 30. `coding-pitfalls.md`와 주제 문서의 긴 사례 고쳐 쓰기 (2026-10-24)

- §30 → [topics/platform.md](topics/platform.md)

---

## 31. 추수감사주일을 지킬 수 있는 날로 고친다 (2026-10-25) — 해소 (2026-10-25)

> **해소됨 (2026-10-25) — 본문을 지웠다.** 데이터가 추수감사주일의 등급을 맥추감사주일처럼 비웠다(data#45). 엔진은 추수감사주일을 그날 고를 수 있는 후보로 낸다. 11월 셋째 주일의 지정 전례일은 연중 33주일이고, 왕이신 그리스도 주일과 겹치면 그 주일이다. 결정과 버린 선택지는 ADR-036 §6과 「검토한 대안 — 추수감사주일의 등급」, 고친 내용과 검증은 원장 `docs/changes/2026-10-25-thanksgiving-keepable-day.md`. 머지된 원장과 메모가 절을 번호로 가리키므로 번호는 그대로 둔다.

---

## 33. 동기화 자료가 커질 때 넘을 수 있는 한도 (2026-10-26)

- §33 → [topics/sync.md](topics/sync.md)
