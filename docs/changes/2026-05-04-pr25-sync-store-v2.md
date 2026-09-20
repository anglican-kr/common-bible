---
date: 2026-05-04
pr: 25
branch: feat/sync-store-v2
title: "feat: Drive 동기화 v2 스키마 — per-record LWW + 마이그레이션 (PR 2/4)"
---

# feat: Drive 동기화 v2 스키마 — per-record LWW + 마이그레이션 (PR 2/4)

## Summary

PR 1의 FSM 위에 **항목 단위 데이터 모델(v2)** 을 도입합니다.

### 핵심 변경

| 파일 | 내용 |
|------|------|
| `js/sync/store-v2.js` (신규) | flat-map 북마크 + per-record `_u` + tombstone + `mergeDocs` + 마이그레이션 |
| `js/sync/state-machine.js` | v1 인라인 로직 제거, syncStoreV2 기반 `_syncCycle` |
| `js/app.js` | `loadBookmarks`/`saveBookmarks`/`save*` → v2 store 동시 기록, 시작 시 마이그레이션 |
| `index.html` | `store-v2.js` 스크립트 태그 추가 |
| `sw.js` | sync 모듈 4개 SHELL_FILES 추가, rev-41 |
| `js/sync/transport.js` | `downloadSyncFile` 성공 경로 `status` 누락 수정 |

### 데이터 모델 변경

- **v1**: 문서 단위 `updatedAt` LWW → 동시 편집 시 한쪽 손실
- **v2**: 항목 단위 `_u` (mtime) + tombstone → 양쪽 변경 모두 보존

### 마이그레이션

기존 사용자(v0 bare array / v1 래퍼) → 앱 시작 시 `migrateLegacyIfNeeded()` 자동 실행. 기존 `bible-bookmarks` 키는 하위 호환용으로 유지.

### PR #24 bugbot 3건 해소

| 버그 | 해소 방법 |
|------|----------|
| 초기 동기화 후 로컬 변경 미업로드 | `maxU` 비교로 업로드 필요 여부 결정 — `else if` 구조적 제거 |
| `downloadSyncFile` `status` 누락 | 성공 경로에 `status: res.status` 추가 |
| SW 프리캐시 sync 모듈 누락 | `SHELL_FILES`에 4개 추가 |

## Test plan

- [ ] Hard refresh → 기존 북마크가 그대로 표시됨 (v0→v2 마이그레이션)
- [ ] `localStorage.getItem("bible-bookmarks-v2")` 콘솔 확인 — flat-map 구조
- [ ] 북마크 추가 → Drive 업로드 (`[sync] UPLOAD_UPDATE` 로그)
- [ ] 다른 기기에서 다른 북마크 추가 → 두 기기 모두 두 북마크 보존
- [ ] 한 기기 삭제 + 다른 기기 수정 → tombstone 우선 (삭제 시각 > 수정 시각)
- [ ] 오프라인 변경 → Drive 재연결 시 업로드

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches bookmark/settings persistence and Drive sync merge/upload logic, including automatic localStorage migration, so mistakes could cause data loss or inconsistent cross-device state despite being scoped to client-side storage.
> 
> **Overview**
> Introduces a new Drive sync **v2 data model** (`syncStoreV2`) that stores bookmarks/settings/last-read as per-record LWW entries with `_u` timestamps plus tombstones, and auto-migrates legacy `localStorage` data on startup.
> 
> Reworks the sync FSM `_syncCycle` to use v2 merge semantics (merge local+remote, apply merged doc back to legacy keys/UI, and decide uploads based on merged max `_u`/record counts) and fixes `downloadSyncFile` to always return `status`.
> 
> Wires app writes (`saveBookmarks`, `save*` settings, `saveReadingPosition`) to also persist into `syncStoreV2`, adds `store-v2.js` to `index.html`, and updates the service worker precache/revision to ship the new sync modules offline.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit a6b81e546fb69bb8e2a9e57ff4710457519ea69c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
