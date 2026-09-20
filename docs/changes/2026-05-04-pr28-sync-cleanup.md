---
date: 2026-05-04
pr: 28
branch: feat/sync-cleanup
title: "feat: tombstone GC + ADR-011 Phase 2c 정리 (PR 4/5)"
---

# feat: tombstone GC + ADR-011 Phase 2c 정리 (PR 4/5)

## Summary

Drive 동기화 재설계 5개 PR 시리즈의 마지막 PR.

### 변경 내용

| 파일 | 내용 |
|------|------|
| `js/sync/store-v2.js` | `sweepTombstones(ageDays=30)` 추가 |
| `js/app.js` | 앱 시작 시 `sweepTombstones()` 호출 |
| `docs/decisions/011-bookmark-sync.md` | Phase 2c 개정 블록 + 미결 사항 갱신 |

### tombstone GC

삭제된 북마크는 tombstone(`{ [id]: deletedAt }`)으로 보관해 다른 기기에 삭제 사실을 전파합니다. 하지만 tombstone이 무한 누적되면 `sync.json`이 계속 커집니다. 30일 이상 경과한 tombstone은 모든 기기가 동기화 완료했다고 볼 수 있으므로 제거합니다.

```js
sweepTombstones(ageDays = 30)  // 앱 시작 시 자동 실행
```

### ADR-011 Phase 2c 정리

PR #24~27에서 구현한 내용을 ADR에 반영:
- 미결 사항 라인 276 (재시도 전략) ✓
- 미결 사항 라인 279 (항목 단위 병합) ✓

## Test plan

- [ ] 북마크 삭제 후 `localStorage.getItem("bible-bookmarks-v2")` 확인 — tombstone 존재
- [ ] 30일 경과 tombstone은 다음 앱 시작 시 제거됨 (Date 조작으로 테스트 가능)
- [ ] ADR-011 미결 사항 체크 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Automatically deleting tombstones changes sync semantics for devices that have been offline >30 days and could reintroduce deleted items if assumptions are wrong. Otherwise the code change is small and localized to v2 sync storage.
> 
> **Overview**
> Adds `syncStoreV2.sweepTombstones(ageDays=30)` to garbage-collect bookmark tombstones older than 30 days, and calls it during app startup right after `migrateLegacyIfNeeded()`.
> 
> Updates `docs/decisions/011-bookmark-sync.md` to mark **Phase 2c** complete and refresh the ADR’s checklist to reflect the finalized engine redesign items (including tombstone GC).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit b230389e89763ecf69129988273e9edaeea4a323. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
