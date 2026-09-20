---
date: 2026-05-06
pr: 49
branch: feat/update-toast-release-link
title: "feat: 업데이트 토스트 버전 링크를 해당 태그 릴리스 페이지로 연결"
---

# feat: 업데이트 토스트 버전 링크를 해당 태그 릴리스 페이지로 연결

## Summary
- 서비스 워커 업데이트 토스트의 버전 링크가 일반 릴리스 목록 대신 해당 버전의 태그 페이지(`/releases/tag/{VERSION}`)로 직접 이동
- 버전을 가져오지 못한 경우(`fetchWaitingVersion` 타임아웃/실패) 기존처럼 일반 릴리스 목록으로 폴백

## Test plan
- [ ] 새 버전이 대기 중일 때 토스트의 버전 링크 클릭 → 해당 태그 페이지가 새 탭에서 열림
- [ ] 버전 정보가 비어 있을 때(`최신 버전` 표시) 일반 릴리스 목록으로 이동

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Small UI-only change to an external URL in the update toast; no changes to service worker lifecycle or data handling.
> 
> **Overview**
> Service worker update toast now links the displayed version directly to the corresponding GitHub tag release page (`/releases/tag/{version}`), instead of always sending users to the general releases list.
> 
> If the waiting service worker’s version cannot be fetched, the link continues to fall back to the main releases page.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit a8d3e74cfa8cffb04386215261597970e7bdc1a9. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
