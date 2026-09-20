---
date: 2026-08-01
pr: 309
branch: fix/sync-unknown-setting-keys
title: "fix: 동기화 병합이 모르는 설정 키를 떨어뜨리던 문제"
---

# fix: 동기화 병합이 모르는 설정 키를 떨어뜨리던 문제

## 문제

`mergeDocs` 가 설정을 병합할 때 `_emptyDoc()` 의 키 목록만 돌았다(`store-v2.js:324`). 그래서 **이 빌드가 모르는 설정 키는 병합 결과에서 사라진다.**

깨지는 흐름:
1. 새 빌드 기기 A 가 설정 키 `bible-liturgical-parish` 를 쓴다 → Drive 업로드
2. 구 빌드 기기 B 가 그 문서를 내려받아 병합 → 모르는 키라 결과에서 탈락
3. B 가 업로드 → **A 의 설정이 삭제된 것처럼 사라진다**

## 수정

로컬·원격 키의 **합집합**을 돌아 모르는 키도 LWW(`_u` 큰 쪽)로 그대로 옮긴다. `types.d.ts` 의 `SyncSettings` 에 인덱스 시그니처를 더해 보존이 타입으로도 성립하게 했다 — 덕분에 store-v2 의 캐스트 3개가 없어졌다.

`applyToLegacyKeys` 는 그대로 둔다(아는 키만 localStorage 에 반영). 모르는 키를 어느 localStorage 키에 써야 할지 이 빌드는 모르므로, 문서에 보존되기만 하면 된다.

## 왜 지금인가

교회력 기능(ADR-036/038)이 설정 키 4종을 추가한다 — 본당·교구·세례명·전례독서 트랙. **구 빌드가 소진되기 전에 키를 늘리면 그 기기가 동기화할 때마다 새 설정이 사라진다.** 그래서 키 추가(A3·B2) 전에 이 수정을 먼저 배포한다.

## 검증

`tests/unit/store-v2.test.js` 14건 신설 — store-v2 의 첫 유닛 커버리지다(지금까지 하네스에서 스텁으로만 대체돼 있었다). 설정 LWW·모르는 키 보존(원격만·로컬만·양쪽 LWW·재병합 왕복)·저장 왕복·업로드 페이로드·삭제 표식·`_u` 동률 deviceId 처리·`maxU`.

하네스의 `stripEsmMarker`·`makeLocalStorage` 를 export 해 재사용했다(복제 회피).

유닛 812건 통과 · `tsc --noEmit` 통과.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Changes core sync merge behavior that can delete or preserve user settings across devices; scope is narrow and covered by new unit tests.
> 
> **Overview**
> **Fixes silent deletion of settings written by newer app builds** when an older client merges a Drive sync document and uploads again.
> 
> `mergeDocs` now runs per-key LWW over the **union** of local and remote `settings` keys (not only keys from `_emptyDoc()`). Unknown keys are carried through with the same `_u` rules as known settings. `SyncSettings` in `types.d.ts` adds a string index signature so that preservation is reflected in types.
> 
> Adds **`tests/unit/store-v2.test.js`** (first direct unit coverage of `store-v2`) for setting LWW, unknown-key preservation, bookmark/tombstone merge, `maxU`, save/load, upload payload, and `applyToLegacyKeys` (still only maps known keys to legacy `localStorage`). Exports **`stripEsmMarker`** and **`makeLocalStorage`** from the test harness for reuse.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 77b5bff94a031a929193175d55d1b8cab6f9998c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
