---
date: 2026-06-22
pr: 299
branch: test/e2e-refresh-stale-after-design-changes
title: "test: e2e 사전 실패 전수 진단 — 낡은 테스트 12건 현행화"
---

# test: e2e 사전 실패 전수 진단 — 낡은 테스트 12건 현행화

## 배경

백로그 "e2e headless 실패 3종 진단" 후속. 이제 playwright가 설치돼 실브라우저로 재현·진단했다.

## 진단 결과

### ① 의뢰 3묶음 — 옛 chromium 아티팩트, 해소
탭바 모핑(`test_tabbar.py`)·설정(`test_settings.py`)·북마크 폴더(`test_bookmark_folders.py`)는 옛 headless chromium에서 클릭/모핑이 안 되던 문제. **새 chromium(Headless Shell 148)에서 전부 통과** (탭바 11/11·설정 3/3·폴더 2/2). 앱 버그 아님.

### ② 전체 스위트에서 드러난 12건 — 전부 낡은 테스트 (앱 버그 0)
실브라우저로 하나씩 실동작을 확인한 결과, 모두 **설계가 바뀌었는데 e2e가 못 따라간 것**:

| 묶음 | 의도된 변경 (실측 근거) |
| --- | --- |
| `test_book_name_swap` 4 | 복음서도 모바일 짧은명 추가 (`NT_MOBILE_NAME`: 마태오 등) · 터치는 `.compact` 아닌 `pointer:coarse` 미디어쿼리 전환 · 반응형 책 그리드가 폰트 따라 칼럼 확대 → 32px 미초과(좁은 창서 측정) |
| `test_features` 롱프레스 1 | 절 선택 진입 임계값 300→**500ms** (`ENTER_SELECT_MS`, 커밋 a506958) |
| `test_install_guide` 7 | 첫 방문 너지 제거 (기본 `nextShow: 2` — 검색 유입·크롤러 배려, 2번째 방문 노출) |

각 묶음을 현행 동작에 맞게 수정 + 양성 케이스 2건 추가(복음서 전환·첫 방문 미노출).

## 검증

- 영향 파일 재실행: book_name_swap 8/8, long_press 1/1, install_guide 20/20
- **전체 e2e 215 통과 / 0 실패** (`test_a11y_axe.py` 는 선택 의존성 `axe_playwright_python` 미설치 시 수집 제외)
- 단위 테스트·앱 코드 변경 없음 (e2e + 문서만)

## 문서

- `docs/known-issues.md §1` 해소 반영 + 교훈(e2e CI 미실행→드리프트)
- `docs/archive/qa/2026-06-22-e2e-stale-refresh.md` 비기술 보고서

> 참고: e2e는 CI 미실행이라 PR의 `Unit tests` 체크는 유닛만 돈다. e2e는 로컬 215/0 확인.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Test and documentation updates only; assertions were aligned to already-shipped product behavior with no app logic changes.
> 
> **Overview**
> Brings the Playwright e2e suite back in line with **current app behavior** and records that earlier “headless-only” failures are resolved. **No production code changes**—only `tests/e2e/*` and docs.
> 
> Three previously failing groups (tab bar search morph, settings popover/cache, bookmark folder toggle) are documented as passing after **Chrome Headless Shell 148**; twelve additional failures were **stale assertions** fixed here:
> 
> **Book name swap** (`test_book_name_swap.py`): expects gospels to use mobile short names (`NT_MOBILE_NAME`), touch swap via `pointer:coarse` (not `.compact`), and desktop overflow checks in a **narrow viewport** with adjusted font size; adds gospel chapter-header swap coverage and narrows the “no swap” case to Acts.
> 
> **Long-press verse select** (`test_features.py`): hold duration **350ms → 650ms** to match **`ENTER_SELECT_MS = 500`**.
> 
> **Install nudge** (`test_install_guide.py`): auto-nudge scenarios seed **`{visits: 1, nextShow: 2}`** (second visit) instead of first visit; adds an explicit **first-visit hidden** test.
> 
> `docs/known-issues.md` §1 is updated to “resolved” with **215/0** pass count (axe module optional); adds `docs/archive/qa/2026-06-22-e2e-stale-refresh.md`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 084986dec954e6f7dbe83e3f3c4280d03e8c2872. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
