# 유닛 테스트 보고서: 검색 — 최근 검색어 패널

**날짜:** 2026-05-11
**범위:** `js/app/search.js`의 `createSearchHistoryController` — 검색창 옆에 펼쳐지는 최근 검색어 목록 패널의 모든 동작
**관련 PR:** (작성 중)

## 한 줄 요약

검색창 옆에 최근에 찾았던 검색어 목록이 펼쳐지는 패널 — 키보드로 이동·선택하고, 일부만 보거나 더 보기, 하나씩 지우거나 모두 지우기, 바깥 클릭으로 닫기까지 — 이 모두 의도대로 동작하는지 자동으로 확인하기 시작했다.

## 이 변경으로 무엇이 더 안전해졌는가

자동 검증 케이스 수가 **440건 → 473건**으로 늘었다 (+33). 검색 모듈 단독으로는 36 → 69.

이번에 자동으로 점검하게 된 동작:

### 패널 열기/닫기

검색창 옆 ▾ 버튼이나 키보드로 패널을 펼치고 접는 흐름:

- 최근 검색어가 하나도 없으면 패널이 절대 열리지 않음 (▾ 버튼도 자동으로 숨김)
- 최근 검색어가 하나라도 있으면 ▾ 버튼이 자동으로 나타나고, 누르면 패널이 펼쳐짐
- 펼쳐진 상태에서 ▾ 버튼을 다시 누르면 깔끔히 접힘 + 입력창에 자동 포커스
- 화면 낭독기 사용자에게 펼침/접힘 상태가 정확히 안내됨 (`aria-expanded`)
- 패널이 접힐 때 키보드 포커스 표시도 깔끔히 정리됨 (활성 항목 표시 제거)

### 표시 항목 수 조절

검색어가 많이 쌓여도 한눈에 부담스럽지 않게:

- 처음에는 최근 10개만 표시
- 더 많이 있으면 "더 보기 (N개)" 버튼이 나타남
- 더 보기를 누르면 최대 30개까지 펼쳐짐
- 3개 이상 있을 때만 "모두 지우기" 버튼 표시 (1-2개일 땐 굳이 안 보여줘서 화면이 깔끔)

### 키보드 조작 (마우스 없이도 완전히 사용 가능)

- 입력창에서 ↓ 키를 누르면 패널이 자동으로 열리면서 첫 항목 활성
- 패널이 열려 있을 때 ↓ ↑ 로 항목 사이 이동
- 첫 항목에서 ↑ 키를 누르면 마지막 항목으로 자동 순환
- 보이지 않는 항목까지 ↓ 로 내려가면 자동으로 "더 보기" 펼침
- Esc 키 누르면 즉시 패널 닫힘 (다른 컴포넌트에 키 이벤트가 전파되지 않도록 안전하게 차단)
- 패널이 닫혀 있을 때 ↑ 키는 아무 동작 안 함 (실수로 입력창에 영향 가는 일 없음)

### 항목별 동작

- 검색어 항목을 누르면: 검색창에 그 단어가 채워지고, 지우기 (×) 버튼이 자동 활성화되며, 패널이 닫히고, 검색 실행 (onSelect 호출)
- 각 항목 옆 × 버튼을 누르면 그 항목만 삭제되고 나머지는 그대로 유지
- 마지막 하나를 삭제하면 패널이 자동으로 닫힘
- "더 보기" 누르면 숨겨졌던 항목까지 모두 펼침
- "모두 지우기" 누르면 전체 검색 이력 삭제

### 바깥 클릭으로 자동 닫기

- 화면의 다른 곳을 누르면 패널이 자동으로 닫힘
- 다만 패널 안쪽이나 ▾ 버튼, 입력창 위를 누른 건 닫지 않음 (조작 중인 영역이므로 거기서 우연히 닫히면 곤란)

### Enter 키 가로채기

- 패널이 열려 있고 어떤 항목을 활성으로 골라둔 상태에서 Enter를 누르면 → 그 항목 선택 (검색 실행은 패널이 처리)
- 패널이 닫혀 있거나 아무 항목도 활성이 아니면 Enter를 가로채지 않음 (입력창에 직접 친 새 검색어가 그대로 실행되도록)

## 발견된 이슈

없음. 위 모든 동작이 의도한 대로 동작함을 확인.

## 다음 의제

이번 PR로 검색 모듈의 **이력 패널은 완전히 자동 점검 대상**. 검색 모듈 남은 영역:

- **검색 시트 (모바일 하단 시트)** — 드래그·키보드 조정·검색어 입력
- **결과 렌더링** (`renderSearchResultList` — 검색 결과 목록 그리기)
- **시트 드래그 핸들** (시트를 끌어올리기/내리기)

이들은 DOM-anchor 헤비 또는 터치 제스처 의존이라 jsdom 도입 후 검토.

다른 모듈 미커버:
- **외관 설정 화면** (`settings-ui.js`) — Canvas 아이콘 채색 등 필요해 jsdom 의제
- 각 모듈의 모달/팝오버 UI 렌더 (의도적 영구 스킵)

## app 레이어 유닛 테스트 확장 1차 마무리

`project_unit_test_expansion` 의제의 no-jsdom 영역은 본 PR로 거의 마무리. 누적 변화:

| PR | 추가 케이스 | 합계 |
| --- | --- | --- |
| #106 storage 비-search-history | +64 | 309 |
| #108 helpers 전체 | +31 | 340 |
| #109 views-routing popover/initCompactHeader | +26 | 366 |
| #110 install INSTALL_STATE/NUDGE | +40 | 406 |
| #112 bookmark HREF/ACTIVE/IMPORT_EXPORT | +34 | 440 |
| **#113 search HISTORY_CONTROLLER** | **+33** | **473** |

전체 245 → 473 (**93% 증가**). 회귀 0.

---

## 부록: 개발자용 세부

| 항목 | 값 |
| --- | --- |
| 테스트 러너 | Node 24 자체 `node --test` |
| 격리 | `node:vm` per-test 컨텍스트, ADR-013 |
| 명령어 | `node --test tests/unit/search.test.js` |
| 단독 실행 | 69 통과 / 139ms |
| 전체 회귀 | 473 통과 / 32s |

신규 BEGIN/END 마커 영역 (`js/app/search.js`): `HISTORY_CONTROLLER` — `createSearchHistoryController` 팩토리 함수.

테스트 패턴:
- 기존 `StubElement`에 `querySelectorAll` / `contains` / `closest` / `focus` / `scrollIntoView` / `id` getter / `_dispatch` 추가 — HISTORY_CONTROLLER 전용 의존 표면을 흉내. 기존 PURE/WORKER/IS_MOBILE/AUTO_NAVIGATE 테스트와 호환.
- `loadHistoryController(initialHistory)` 로더: storage 함수 3종(load/remove/clear) + EL_SHIM/CLEAR_NODE_SHIM + document 스텁(addEventListener 가로채기) 모두 vm context에 주입. `makeFixture()`로 input/toggle/panel/wrap/clearBtn 자동 생성, `panel.hidden = true`로 시작(`<div hidden>` 초기 상태 미러).
- 이벤트 디스패치: `c.input._dispatch("keydown", keyEvent("ArrowDown"))` 형태. document 외부 클릭은 `h.fireDocumentPointerdown({target: outside})`.
- jsdom 미도입 (ADR-013 dual-track 기조 유지).

DOM 헤비 영역(시트 드래그·결과 렌더·키보드 키보드 조정) 의도적 스킵.
