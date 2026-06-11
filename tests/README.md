# 테스트 안내

이 저장소의 자동 시험은 **세 겹(+데이터 한 겹)** 으로 나뉩니다. 각 겹이 잡는 문제가 다르므로, "무엇이 어디서 검증되는가"를 여기 정리해 둡니다. 코드를 직접 읽지 않아도 어떤 시험이 무엇을 보장하는지 파악할 수 있도록 한 것입니다.

> 권위 있는 "지금 무엇이 동작하는가"는 [`docs/status.md`](../docs/status.md), 결정 배경은 각 ADR([`docs/decisions/`](../docs/decisions/)) 참조.

## 한눈에 보기

| 겹 | 도구 | 무엇을 보나 | 어디서 도나 | 규모 |
|---|---|---|---|---|
| **유닛** | `node --test` (의존성 0) | 순수 로직 — 함수 입출력·상태 계산 | **CI 자동** (PR마다) | 19파일 · 728케이스 |
| **타입 검사** | `tsc --noEmit` (`@ts-check`+JSDoc) | 타입 불일치·오타 | 로컬 훅 + 수동 | 설정 2종(앱·워커) |
| **E2E** | Playwright (실제 브라우저) | 화면·상호작용·모듈 간 배선 | **로컬 전용**(수동) | 26파일 · 208케이스 |
| **데이터** | pytest (`common-bible-data` 서브모듈) | 성경 본문·검색 인덱스 정합성 | 그 저장소 CI | 별도 저장소 |

### 각 겹이 "혼자만 잡는" 것 — 왜 셋 다 필요한가

- **유닛**: 정렬·절 범위 계산 같은 순수 로직의 정확성. 빠르고 CI 자동이지만 **화면·브라우저 동작은 못 본다**.
- **타입 검사(tsc)**: JSDoc 타입 오류·오타. 단, **모듈에서 import을 빠뜨려도 통과**하는 사각지대가 있다(미선언 식별자를 전역으로 간주). 그래서 "tsc 통과 = 안전"이 아니다 — 자세한 사례는 [`docs/known-issues.md`](../docs/known-issues.md) 및 ADR-019 참조.
- **E2E**: 위 사각지대(주입 콜백·모듈 간 import 누락)와 실제 클릭·내비게이션을 **유일하게 잡는 안전망**. 단 로컬에서 수동으로 돌려야 한다(CI 아님).

---

## 1. 유닛 테스트 — `tests/unit/`

순수 JS 로직을 Node 자체 테스트 러너 + 자체 `vm` 하네스로 검증한다. 의존성 0, CI가 PR마다 자동 실행. 한 모듈 = 한 테스트 파일(`<소스이름>.test.js`). 상세 규약은 [ADR-013](../docs/decisions/013-client-js-unit-tests.md).

```bash
node --test tests/unit/*.test.js          # 전체 (CI와 동일)
node --test tests/unit/storage.test.js    # 개별 파일
```

| 파일 | 검증 대상 | 케이스 |
|---|---|---|
| `bookmark.test.js` | 북마크 핵심 로직 — 절 스펙 파싱, 트리 질의(`_isDescendant` 등), 드래그 이동, 스와이프 제스처 수학, 선택 캐스케이드, 정렬 | 169 |
| `storage.test.js` | 로컬 저장소 — 북마크 v1→v2 마이그레이션, 읽음 표시, 설정 영속화 | 99 |
| `search.test.js` | 검색 파이프라인 — 토큰화, 절 검색, 결과 랭킹/필터 | 77 |
| `views.test.js` | 본문 렌더 — 절 span, 운문/산문, 인용 마크업 | 54 |
| `state-machine.test.js` | Drive 동기화 상태기계 — 전이·충돌·재시도 | 46 |
| `install.test.js` | 설치 안내 — 플랫폼 분기, 넛지 타이밍 | 46 |
| `helpers.test.js` | 공용 헬퍼 — DOM 빌더(`el`), 빈 상태, 단위 변환 | 42 |
| `overlay.test.js` | 오버레이 컨트롤러(ADR-032) — 포커스 트랩, 닫기 스택 | 27 |
| `parallels.test.js` | 평행 본문(인용·각주) 해석 | 26 |
| `bookmark-read.test.js` | 폴더 모아 읽기(ADR-035) — 범위 해석, 연속 구절 병합 | 25 |
| `transport.test.js` | 동기화 전송 계층 — 요청/응답·에러 매핑 | 25 |
| `citations.test.js` | 인용 표시 — 참조 파싱, 시트 데이터 | 22 |
| `audio-cache.test.js` | 오디오 캐시 — 장별 mp3 캐싱·정리 | 14 |
| `manifest-sync.test.js` | 콘텐츠 해시 매니페스트 동기화(ADR-021) | 14 |
| `refresh-store.test.js` | 백그라운드 새로고침 상태 | 13 |
| `tabbar.test.js` | 모바일 탭 바 — 활성 표시·인디케이터 | 12 |
| `tab-history.test.js` | 탭별 히스토리 복원(ADR-031) | 11 |
| `sw.test.js` | 서비스 워커 `SHELL_FILES` 정적 검증 | 4 |
| `csp.test.js` | `index.html` CSP 인라인 해시 일관성 | 2 |

## 2. 타입 검사 — `tsc`

순수 JS에 `// @ts-check` + JSDoc 주석으로 타입을 달고, `tsc --noEmit`으로 **출력 없이 타입만** 검사한다(ADR-012). "컴파일"이 아니라 타입 검사 용도. `tsc`는 TypeScript Compiler의 약자.

```bash
npx tsc -p tsconfig.json --noEmit          # 앱 코드
npx tsc -p tsconfig.worker.json --noEmit   # 서비스 워커(다른 전역 환경)
```

- 잡는 것: 잘못된 타입 사용, 존재하지 않는 속성 접근, 함수 인자 불일치, 오타.
- **사각지대**: 모듈에서 `import`을 통째로 빠뜨려도, 그 이름이 전역으로 선언돼 있으면 통과시킨다 → 런타임에서야 깨진다. 이 부류는 **로드 스모크/E2E로만** 잡힌다([`docs/known-issues.md`](../docs/known-issues.md)).

## 3. E2E 테스트 — `tests/e2e/`

실제 크롬(Playwright)을 띄워 화면 렌더·클릭·내비게이션·모듈 간 배선을 검증한다. **CI에서는 돌지 않으며**, 기능 개발 후 로컬에서 수동 확인한다.

```bash
# 1. 의존성(최초 1회)
pip install pytest-playwright && playwright install chromium

# 2. 개발 서버(별도 터미널) — SPA-aware 서버여야 History API 경로가 동작
python3 scripts/serve.py 8080

# 3. 실행
pytest tests/e2e/ -v
pytest tests/e2e/test_bookmark_sort.py -q   # 개별 파일
```

> 서버가 `http://localhost:8080`에 떠 있어야 한다. `conftest.py`의 `base_url`이 8080을 하드코딩하므로 다른 포트는 안 된다.

### 북마크 (이 영역이 가장 촘촘하다 — 9개 파일)

| 파일 | 검증 대상 | 케이스 |
|---|---|---|
| `test_bookmark.py` | 드로어 열기·장 저장·목록 갱신, **북마크 링크 클릭→내비+드로어 닫힘**, **트리 키보드 내비** | 8 |
| `test_bookmark_export_import.py` | 내보내기/가져오기(JSON) — 다운로드·병합·덮어쓰기·오류 처리·드로어 ⋯ 패널 | 24 |
| `test_bookmark_select_delete.py` | 선택 모드 — 진입·삭제·캐스케이드·공유·이동(폴더 포함) | 12 |
| `test_bookmark_folders.py` | 폴더 CRUD — 생성·이름변경·삭제·펼침/접음 | 8 |
| `test_bookmark_swipe.py` | 모바일 스와이프/롱프레스 — 삭제·수정 노출, 드래그 진입 | 8 |
| `test_bookmark_dnd.py` | 드래그&드롭 재정렬 — before/after/into·순환 방지 | 6 |
| `test_bookmark_add_help.py` | 전체뷰 🛈 안내 팝오버 — 위치·열고닫기·포커스 | 5 |
| `test_bookmark_edit.py` | 항목 편집 — 레이블·메모·빈 레이블 거부 | 4 |
| `test_bookmark_sort.py` | ⋯ 메뉴 정렬 — 기준(제목/날짜)+순서(오름/내림) 변경→재렌더 | 2 |
| `test_bookmark_read.py` | 폴더 "모아 읽기" 버튼→`/read/<id>` 읽기 화면(ADR-035) | 1 |

### 읽기·내비·검색·본문

| 파일 | 검증 대상 | 케이스 |
|---|---|---|
| `test_search.py` | 검색 흐름 — 입력·결과·필터·딥링크 | 12 |
| `test_navigation.py` | 절 단위 딥링크 URL 라우팅 | 5 |
| `test_copy.py` | 절 선택→클립보드 복사 — 절 경계 확장·인용 포함 | 7 |
| `test_cite_sheet.py` | 인용 바텀 시트 — 열기/닫기·Escape·포커스 | 4 |
| `test_book_name_swap.py` | 책 이름 전체/짧은 명칭 뷰포트별 교체 | 7 |

### 오디오·동기화·설정·셸

| 파일 | 검증 대상 | 케이스 |
|---|---|---|
| `test_drive_sync.py` | Google Drive 동기화 — 연결·업로드·충돌 | 13 |
| `test_drive_sync_ios.py` | iOS Drive 동기화(OAuth BFF 경유) | 8 |
| `test_audio.py` / `test_audio_controls.py` | 오디오 플레이어 — 표시·해제·에러 / 재생·배속·seek·위치복원 | 6 / 6 |
| `test_settings.py` | 설정 팝오버 — 시작화면·책순서·글자크기·테마·색상·캐시 | 13 |
| `test_install_guide.py` | 설치 안내 모달 — 플랫폼별 콘텐츠·진입점 | 15 |
| `test_tabbar.py` | 모바일 모핑 탭 바(ADR-029/030) | 11 |
| `test_update_toast.py` | SW 업데이트 토스트 | 6 |

### 접근성

| 파일 | 검증 대상 | 케이스 |
|---|---|---|
| `test_a11y_axe.py` | axe-core 자동 스캔(WCAG 2.1 AA) | 7 |
| `test_a11y_keyboard.py` | 키보드 인터랙션 | 7 |

> **알려진 사전 실패**: `test_bookmark_folders.py`의 폴더 토글 2건 등 일부는 headless 환경 의존으로 실패한다(앱 버그 아님). 목록·원인은 [`docs/known-issues.md`](../docs/known-issues.md) §1.

## 4. 데이터 파이프라인 테스트 (서브모듈)

성경 본문(마크다운→JSON)과 검색 인덱스의 정합성 검증은 `common-bible-data` 저장소에 있다(ADR-004). 본 저장소 CI는 실행하지 않으며, 그 저장소의 `validate.yml`이 push마다 자동 실행한다. 로컬에서 보려면:

```bash
cd data && pytest tests/   # 서브모듈 디렉터리
```
