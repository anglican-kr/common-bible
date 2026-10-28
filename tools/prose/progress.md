# 문장 교정 진행 목록

문장 교정 반복 실행(`.claude/skills/prose-batch/SKILL.md`)이 이 목록의 위에서부터 묶음을 고른다. 상태는 「대기」이거나, 그 파일을 고친 교정 PR의 번호(「#N」)다. 한 파일을 나눠 고치면 끝낸 범위와 PR 번호를 이어 적고(「§1-§4 #N, §5-§7 #M」), 마지막 범위까지 끝내면 맨 끝에 「(끝)」을 붙인다.

「한글 줄」은 문장 검사(`prose.py`)가 보는 줄, 곧 문서의 본문과 코드의 주석 가운데 한글이 든 줄의 수다. 2026-10-26에 셌다. 대상과 빼는 파일은 `tools/prose/README.md` 「검사하는 것」과 같다.

## 1. 주제 문서

| 파일 | 한글 줄 | 상태 |
| --- | --- | --- |
| `docs/topics/README.md` | 25 | #444 |
| `docs/topics/audio.md` | 27 | #444 |
| `docs/topics/bible-text.md` | 75 | #444 |
| `docs/topics/bookmark.md` | 80 | #444 |
| `docs/topics/cache-release.md` | 31 | #444 |
| `docs/topics/design-system.md` | 64 | #444 |
| `docs/topics/install-a11y.md` | 10 | #444 |
| `docs/topics/liturgical.md` | 398 | #444 |
| `docs/topics/platform.md` | 124 | #444 |
| `docs/topics/routing.md` | 99 | #444 |
| `docs/topics/search.md` | 19 | #444 |
| `docs/topics/sync.md` | 78 | #444 |

## 2. 루트 문서와 `docs/`의 나머지

| 파일 | 한글 줄 | 상태 |
| --- | --- | --- |
| `.claude/commands/security-audit.md` | 70 | #447 |
| `CLAUDE.md` | 75 | #447 |
| `DESIGN.md` | 453 | #448 |
| `README.md` | 82 | #447 |
| `docs/architecture.md` | 322 | #450 |
| `docs/changes/README.md` | 18 | #447 |
| `docs/coding-pitfalls.md` | 197 | #450 |
| `docs/index.md` | 30 | #447 |
| `docs/known-issues.md` | 82 | #447 |
| `docs/workflow.md` | 87 | #447 |
| `docs/writing.md` | 197 | 대기 |
| `tests/README.md` | 99 | 대기 |
| `tests/fixtures/liturgical/README.md` | 54 | 대기 |
| `tools/booklet/README.md` | 12 | 대기 |
| `tools/csp/README.md` | 5 | 대기 |
| `tools/prose/README.md` | 36 | 대기 |

## 3. ADR

| 파일 | 한글 줄 | 상태 |
| --- | --- | --- |
| `docs/decisions/001-spa-architecture.md` | 66 | 대기 |
| `docs/decisions/002-sirach-prologue-handling.md` | 5 | 대기 |
| `docs/decisions/003-physical-chapter-ordering.md` | 4 | 대기 |
| `docs/decisions/004-data-pipeline-test-strategy.md` | 42 | 대기 |
| `docs/decisions/005-search-indexing-strategy.md` | 95 | 대기 |
| `docs/decisions/006-poetry-source-format.md` | 4 | 대기 |
| `docs/decisions/007-launch-screen-optimization.md` | 99 | 대기 |
| `docs/decisions/008-pwa-install-guide.md` | 92 | 대기 |
| `docs/decisions/009-history-api-routing.md` | 59 | 대기 |
| `docs/decisions/010-bookmark-feature.md` | 291 | 대기 |
| `docs/decisions/011-bookmark-sync.md` | 583 | 대기 |
| `docs/decisions/012-typescript-incremental-adoption.md` | 72 | 대기 |
| `docs/decisions/013-client-js-unit-tests.md` | 82 | 대기 |
| `docs/decisions/014-search-history.md` | 100 | 대기 |
| `docs/decisions/015-storage-strategy.md` | 117 | 대기 |
| `docs/decisions/016-audio-cache-lru.md` | 104 | 대기 |
| `docs/decisions/017-oauth-bff-proxy.md` | 78 | 대기 |
| `docs/decisions/018-app-modularization.md` | 70 | 대기 |
| `docs/decisions/019-esm-module-system.md` | 65 | 대기 |
| `docs/decisions/020-monorepo-split.md` | 62 | 대기 |
| `docs/decisions/021-pwa-versioning-content-hash.md` | 98 | 대기 |
| `docs/decisions/022-citations-and-annotations.md` | 182 | 대기 |
| `docs/decisions/023-settings-toggle-switches.md` | 50 | 대기 |
| `docs/decisions/024-book-list-tabs-and-header-nav.md` | 55 | 대기 |
| `docs/decisions/025-header-scroll-elevation.md` | 59 | 대기 |
| `docs/decisions/027-source-dsl-and-parallel-passages.md` | 128 | 대기 |
| `docs/decisions/028-design-system.md` | 93 | 대기 |
| `docs/decisions/029-mobile-tab-bar.md` | 89 | 대기 |
| `docs/decisions/030-morphing-tab-bar.md` | 121 | 대기 |
| `docs/decisions/031-tab-history-restore.md` | 54 | 대기 |
| `docs/decisions/032-component-view-layer.md` | 69 | 대기 |
| `docs/decisions/033-search-options.md` | 77 | 대기 |
| `docs/decisions/034-views-routing-second-split.md` | 128 | 대기 |
| `docs/decisions/035-bookmark-reading-view.md` | 89 | 대기 |
| `docs/decisions/036-liturgical-calendar-data-model.md` | 271 | 대기 |
| `docs/decisions/037-eucharist-lectionary-data-and-engine.md` | 129 | 대기 |
| `docs/decisions/038-calendar-lectionary-ui.md` | 190 | 대기 |
| `docs/decisions/040-bookmark-import-items.md` | 88 | 대기 |

## 4. 설계서

| 파일 | 한글 줄 | 상태 |
| --- | --- | --- |
| `docs/design/liturgical-engine-review.md` | 1263 | 대기 |
| `docs/design/liturgical-engine.md` | 35 | 대기 |
| `docs/design/liturgical-engine/01-overview.md` | 76 | 대기 |
| `docs/design/liturgical-engine/02-data-reality.md` | 43 | 대기 |
| `docs/design/liturgical-engine/03-placement-layers.md` | 42 | 대기 |
| `docs/design/liturgical-engine/04-compute-layer.md` | 136 | 대기 |
| `docs/design/liturgical-engine/05-lookup-layer.md` | 205 | 대기 |
| `docs/design/liturgical-engine/06-rank-transfer-color.md` | 275 | 대기 |
| `docs/design/liturgical-engine/07-test-plan.md` | 109 | 대기 |
| `docs/design/liturgical-engine/08-phases.md` | 12 | 대기 |
| `docs/design/liturgical-engine/09-open-items.md` | 74 | 대기 |

## 5. 앱 코드와 스크립트의 주석

| 파일 | 한글 줄 | 상태 |
| --- | --- | --- |
| `.claude/hooks/post-pr-ledger.sh` | 7 | 대기 |
| `.claude/hooks/pre-commit-ledger.sh` | 24 | 대기 |
| `.claude/hooks/pre-pr-ledger.sh` | 15 | 대기 |
| `.github/workflows/engine-data.yml` | 23 | 대기 |
| `.github/workflows/ledger.yml` | 18 | 대기 |
| `.github/workflows/prose.yml` | 3 | 대기 |
| `.github/workflows/sync-data.yml` | 58 | 대기 |
| `.github/workflows/test.yml` | 4 | 대기 |
| `css/style.css` | 468 | 대기 |
| `index.html` | 41 | 대기 |
| `js/app.js` | 5 | 대기 |
| `js/app/bookmark-core.js` | 9 | 대기 |
| `js/app/bookmark-gestures.js` | 20 | 대기 |
| `js/app/bookmark-menu.js` | 35 | 대기 |
| `js/app/bookmark-modals.js` | 32 | 대기 |
| `js/app/bookmark-read.js` | 8 | 대기 |
| `js/app/bookmark-select.js` | 14 | 대기 |
| `js/app/bookmark-tree.js` | 15 | 대기 |
| `js/app/bookmark-verse-select.js` | 6 | 대기 |
| `js/app/bookmark.js` | 29 | 대기 |
| `js/app/calendar.js` | 65 | 대기 |
| `js/app/citations.js` | 18 | 대기 |
| `js/app/helpers.js` | 3 | 대기 |
| `js/app/lectionary.js` | 224 | 대기 |
| `js/app/liturgical-engine.js` | 465 | 대기 |
| `js/app/overlay.js` | 3 | 대기 |
| `js/app/parallels.js` | 7 | 대기 |
| `js/app/routing.js` | 63 | 대기 |
| `js/app/search.js` | 34 | 대기 |
| `js/app/settings-ui.js` | 5 | 대기 |
| `js/app/storage.js` | 7 | 대기 |
| `js/app/tab-history.js` | 53 | 대기 |
| `js/app/tabbar.js` | 182 | 대기 |
| `js/app/verse-spec.js` | 35 | 대기 |
| `js/app/views.js` | 78 | 대기 |
| `js/drive-sync.js` | 9 | 대기 |
| `js/pre-fetch.js` | 1 | 대기 |
| `js/search-worker.js` | 2 | 대기 |
| `js/sync/state-machine.js` | 18 | 대기 |
| `js/sync/store-v2.js` | 3 | 대기 |
| `js/sync/transport.js` | 5 | 대기 |
| `scripts/build_sitemap.py` | 1 | 대기 |
| `scripts/changelog.py` | 4 | 대기 |
| `scripts/csp_hashes.py` | 17 | 대기 |
| `scripts/docs_facts_snapshot.py` | 74 | 대기 |
| `scripts/lock_merged_ledgers.sh` | 10 | 대기 |
| `scripts/pr_body.sh` | 9 | 대기 |
| `scripts/test_changelog.py` | 1 | 대기 |
| `sw.js` | 21 | 대기 |
| `tools/booklet/compare.py` | 47 | 대기 |
| `tools/booklet/engine-dump.mjs` | 8 | 대기 |
| `tools/booklet/extract.py` | 1 | 대기 |
| `tools/booklet/parse_booklet_2027.py` | 16 | 대기 |
| `tools/csp/csp_sweep.py` | 21 | 대기 |
| `tools/prose/prose.py` | 4 | 대기 |

## 6. 테스트 코드의 주석

| 파일 | 한글 줄 | 상태 |
| --- | --- | --- |
| `tests/e2e/test_a11y_axe.py` | 20 | 대기 |
| `tests/e2e/test_a11y_keyboard.py` | 31 | 대기 |
| `tests/e2e/test_audio_controls.py` | 16 | 대기 |
| `tests/e2e/test_book_name_swap.py` | 3 | 대기 |
| `tests/e2e/test_bookmark.py` | 17 | 대기 |
| `tests/e2e/test_bookmark_add_help.py` | 15 | 대기 |
| `tests/e2e/test_bookmark_dnd.py` | 13 | 대기 |
| `tests/e2e/test_bookmark_edit.py` | 6 | 대기 |
| `tests/e2e/test_bookmark_export_import.py` | 98 | 대기 |
| `tests/e2e/test_bookmark_folders.py` | 27 | 대기 |
| `tests/e2e/test_bookmark_read.py` | 15 | 대기 |
| `tests/e2e/test_bookmark_select_delete.py` | 38 | 대기 |
| `tests/e2e/test_bookmark_sort.py` | 14 | 대기 |
| `tests/e2e/test_bookmark_swipe.py` | 33 | 대기 |
| `tests/e2e/test_calendar_view.py` | 51 | 대기 |
| `tests/e2e/test_cite_sheet.py` | 17 | 대기 |
| `tests/e2e/test_copy.py` | 51 | 대기 |
| `tests/e2e/test_drive_sync.py` | 16 | 대기 |
| `tests/e2e/test_drive_sync_ios.py` | 10 | 대기 |
| `tests/e2e/test_features.py` | 1 | 대기 |
| `tests/e2e/test_install_guide.py` | 22 | 대기 |
| `tests/e2e/test_lectionary_view.py` | 191 | 대기 |
| `tests/e2e/test_liturgical_lazy_load.py` | 55 | 대기 |
| `tests/e2e/test_liturgical_render.py` | 30 | 대기 |
| `tests/e2e/test_navigation.py` | 23 | 대기 |
| `tests/e2e/test_search.py` | 12 | 대기 |
| `tests/e2e/test_settings.py` | 34 | 대기 |
| `tests/e2e/test_tabbar.py` | 47 | 대기 |
| `tests/e2e/test_update_toast.py` | 21 | 대기 |
| `tests/unit/bookmark.test.js` | 37 | 대기 |
| `tests/unit/calendar.data.test.js` | 22 | 대기 |
| `tests/unit/calendar.test.js` | 33 | 대기 |
| `tests/unit/citations.data.test.js` | 8 | 대기 |
| `tests/unit/citations.test.js` | 8 | 대기 |
| `tests/unit/csp.test.js` | 14 | 대기 |
| `tests/unit/debug-log.test.js` | 2 | 대기 |
| `tests/unit/docs-anchors.js` | 27 | 대기 |
| `tests/unit/docs-crossref.test.js` | 77 | 대기 |
| `tests/unit/docs-data-consistency.test.js` | 24 | 대기 |
| `tests/unit/docs-wiki.test.js` | 28 | 대기 |
| `tests/unit/helpers.test.js` | 14 | 대기 |
| `tests/unit/lectionary.data.test.js` | 56 | 대기 |
| `tests/unit/lectionary.test.js` | 76 | 대기 |
| `tests/unit/liturgical-engine.data.test.js` | 98 | 대기 |
| `tests/unit/liturgical-engine.test.js` | 365 | 대기 |
| `tests/unit/liturgical-fixtures.data.test.js` | 14 | 대기 |
| `tests/unit/liturgical-fixtures.test.js` | 35 | 대기 |
| `tests/unit/overlay.test.js` | 1 | 대기 |
| `tests/unit/parallels.test.js` | 4 | 대기 |
| `tests/unit/refresh-store.test.js` | 6 | 대기 |
| `tests/unit/routing.test.js` | 20 | 대기 |
| `tests/unit/search-worker.test.js` | 3 | 대기 |
| `tests/unit/search.test.js` | 6 | 대기 |
| `tests/unit/state-machine.test.js` | 153 | 대기 |
| `tests/unit/storage.test.js` | 8 | 대기 |
| `tests/unit/store-v2.test.js` | 38 | 대기 |
| `tests/unit/sw.test.js` | 42 | 대기 |
| `tests/unit/tab-history.test.js` | 4 | 대기 |
| `tests/unit/tabbar.test.js` | 15 | 대기 |
| `tests/unit/transport.test.js` | 28 | 대기 |
| `tests/unit/verse-spec.test.js` | 44 | 대기 |
| `tests/unit/views.test.js` | 11 | 대기 |
