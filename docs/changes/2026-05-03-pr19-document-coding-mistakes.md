---
date: 2026-05-03
pr: 19
branch: claude/document-coding-mistakes-McGBH
title: "feat: Google Drive 동기화 기능 추가"
---

# feat: Google Drive 동기화 기능 추가

북마크·설정·마지막 읽기 위치를 Google Drive appDataFolder에 저장해
여러 기기 간 자동 동기화를 지원한다.

- drive-sync.js: GIS token flow 기반 인증, 업로드/다운로드/머지 구현
- 토큰 만료 시 silent re-auth 자동 시도, 실패 시 스낵바 알림
- initDriveSync 무한 재시도 방지 (최대 20회)
- hostname 기반 dev/prod Client ID 자동 분기
- 설정 팝오버에 연결·해제·계정 정보 UI 추가
- CSP에 Google OAuth·Drive API 출처 추가
- SW에서 googleapis.com 요청 캐시 바이패스
- 캐시 초기화 시 폰트 캐시 보존

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Introduces new OAuth-based Drive sync plus CSP and service worker routing changes, which can affect authentication flows and offline caching behavior. Risk is moderated by appData-only scope and memory-only token handling, but regressions could impact data consistency or offline availability.
> 
> **Overview**
> Adds **Google Drive-based cross-device sync** for bookmarks, selected user settings, and last-read position by introducing `js/drive-sync.js` (GIS token auth + upload/download + updatedAt conflict resolution) and wiring it into state-saving paths.
> 
> Updates the UI to manage sync from the settings popover (connect/disconnect + connected-account info) and refreshes this section on auth changes; also expands CSP and SW behavior to allow Google OAuth/Drive endpoints and to keep those requests network-only.
> 
> Adjusts cache management to **preserve font caches** when clearing caches, and updates the app shell cache list to include the new sync script. Documentation is added for a security audit and common coding pitfalls.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6ac5130b62812ce06689b63d8f7561a1c75fb862. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
