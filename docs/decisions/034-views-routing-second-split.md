# ADR-034: 뷰·라우팅·북마크 2차 분할 (modularization round 2)

- 일시: 2026-06-08
- 상태: 승인됨 — 구현 진행 중 (PR1 오디오 플레이어 분리 완료, 2026-06-08)
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
| 2 | **데이터 페칭** | 343–396 + `booksCache`/`appVersion` → `js/app/data-fetch.js` | leaf. 소비자 다수라 import 전환은 모듈 손댈 때 점진 |
| 3 | **탭 인디케이터** | 44–163 → 기존 `js/app/tabbar.js` 병합 | |
| 4 | **Pull-to-refresh 제거(폐기)** | 164–342 `setupPullToRefresh` IIFE + CSS `#pull-refresh-*` 삭제 | 사용자 결정(2026-06-08): 모바일 "당겨서 새로고침"=수동 Drive 동기화 트리거이므로 제거. `driveSync.requestSync` API·상태기계·visibilitychange 자동 동기화·편집 시 자동 업로드 등 **백그라운드 동기화 로직은 전부 유지**(`requestSync`는 다른 경로도 호출) |
| 5 | **라우팅** | 1714–2131 → `js/app/routing.js` | `parsePath`를 하위 모듈로 내려 audio의 상향 엣지를 하향 import로 정리. route()→외부 뷰 dispatch를 `registerView` registry로 역전. route()의 12개 `closeX` 모달 클로저 호출을 ADR-032 오버레이의 `closeAllOverlays()` 하나로 축약 |
| → | 잔여 = `views.js`로 개명 | 렌더 헬퍼 + Views (398–1713) | |

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
- 각 PR 머지 시 CLAUDE.md "현재 상태"에 한 줄.
