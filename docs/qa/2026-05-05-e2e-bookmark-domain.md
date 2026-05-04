# E2E 테스트 보고서: Phase 2 — 북마크 도메인

**날짜:** 2026-05-05
**범위:** Phase 2 — 폴더 CRUD, 드래그&드롭 재정렬, 항목 편집
**작성자:** Joshua Huh

## 1. 실행 환경

| 항목 | 값 |
|------|----|
| Python | 3.12.12 |
| pytest | 9.0.2 |
| pytest-playwright | 0.7.2 |
| Chromium | 145.0.7632.6 |
| 개발 서버 | `python3 scripts/serve.py 8080` |

## 2. 실행 결과

| 항목 | 값 |
|------|----|
| 신규 테스트 | 16건 (폴더 7 + DnD 5 + 편집 4) |
| 전체 e2e 테스트 | 100건 |
| 통과 | 100건 |
| 실패 | 0건 |
| 소요 시간 | 약 206초 |

```
======================= 100 passed in 206.11s (0:03:26) ========================
```

## 3. 신규 시나리오

### 3-1. `tests/e2e/test_bookmark_folders.py` (7건)

| 테스트 | 검증 내용 |
|--------|---------|
| `test_create_folder_via_button` | `#bm-add-folder-btn` → 이름 입력 → "추가" 클릭 → syncStoreV2에 폴더 생성 |
| `test_create_folder_via_enter_key` | Enter 키로 폴더 이름 확정 |
| `test_create_folder_empty_name_does_nothing` | 빈 이름 입력 + Enter → 폴더 미생성 |
| `test_folder_toggle_expand_collapse` | 폴더 row 클릭 → `aria-expanded` false↔true 토글 |
| `test_expanded_folder_shows_children` | `expanded: true` 폴더 렌더링 시 자식 북마크 표시 |
| `test_folder_rename_via_prompt` | 수정 버튼 → `window.prompt` 응답 → 이름 변경 |
| `test_folder_delete` | 삭제 버튼 → `window.confirm` 승인 → 폴더+자식 제거 |

### 3-2. `tests/e2e/test_bookmark_dnd.py` (5건)

| 테스트 | 검증 내용 |
|--------|---------|
| `test_move_bookmark_before` | `moveBookmarkItem(b, a, "before")` → B가 A 앞으로 |
| `test_move_bookmark_after` | `moveBookmarkItem(a, b, "after")` → A가 B 뒤로 |
| `test_move_bookmark_into_folder` | `moveBookmarkItem(a, folder, "into")` → A가 폴더 자식 |
| `test_move_three_items_reorder` | [A,B,C] → C를 A 앞으로 → [C,A,B] |
| `test_move_into_own_descendant_ignored` | 폴더를 자기 자식에 into → 이동 안 됨 (순환 방지) |

**구현 노트:** 실제 drag 이벤트 시뮬레이션 대신 `moveBookmarkItem()` JS 직접 호출로 테스트. 드래그 인터랙션 자체보다 재정렬 결과 데이터 정합성을 보장하는 데 초점.

### 3-3. `tests/e2e/test_bookmark_edit.py` (4건)

| 테스트 | 검증 내용 |
|--------|---------|
| `test_edit_bookmark_label` | 수정 버튼 → `#bm-label-input` 변경 → 저장 → syncStoreV2 반영 |
| `test_edit_bookmark_empty_label_falls_back_to_default` | 빈 레이블 → 기본 레이블로 저장됨 |
| `test_edit_bookmark_add_note` | `#bm-note-input` 입력 → `note` 필드 저장 |
| `test_edit_bookmark_cancel_discards_changes` | 취소 → 기존 레이블 유지 |

## 4. 발견된 이슈 / 중요 발견

| # | 위치 | 내용 |
|---|------|------|
| 1 | `CLEAR_APP_STORAGE` | `bible-bookmarks-v2`, `bible-sync-meta` 키 누락 → 테스트 간 데이터 누출. conftest에 추가 수정. |
| 2 | `_buildFolderItem()` ([js/app.js:4153](js/app.js#L4153)) | 폴더 초기 `aria-expanded`를 `folder.expanded`가 아닌 `_hasActiveDescendant(folder)`(현재 URL 매칭 여부)로 결정. 같은 페이지의 북마크가 자식에 있으면 항상 expanded. 테스트에서 비활성 URL 사용으로 우회. |
| 3 | 삭제 버튼 중복 | `li.bm-folder .bm-delete-btn`이 폴더 자체 + 자식 북마크 버튼 2개에 매칭. `.first` 사용으로 해결. |
| 4 | 빈 레이블 동작 | 빈 레이블 저장 시 거부(modal 유지)가 아닌 defaultLabel로 폴백. 앱 동작에 맞게 테스트 기대값 수정. |

## 5. 비고

- 폴더 펼침/접음 상태는 `bible-bookmarks-v2`에 `expanded` 필드로 저장되지만 렌더링 시에는 `_hasActiveDescendant`가 우선하므로 상태 영속성은 현재 비테스트 영역.
- DnD 드래그 인터랙션(drag-over 클래스 표시) 자체는 타이밍 민감도로 인해 미커버. `moveBookmarkItem` 결과 검증으로 대체.
