---
date: 2026-05-09
pr: 78
branch: style/remove-experimental-label
title: "style: 백업 & 동기화 '실험' 라벨 제거"
---

# style: 백업 & 동기화 '실험' 라벨 제거

## Summary

설정의 "백업 & 동기화 (실험)" 라벨과 안내 문구의 "(이 기능은 아직 실험 단계입니다)." 표현 제거.

## Why

Phase 2h 단계 1~6 + 2차 보안 감사(`docs/audit/2026-05-08-second-comprehensive.md`, 0 Critical/High 잔여) 완료 후 충분한 안정화 기간을 거침. 동기화는 데스크탑·Android·iOS 단일 PKCE 경로 + nginx BFF + visibility-trigger sync로 정착, 보안 헤더 통합 + rate limit + body 가드까지 적용된 상태. 사용자에게 "실험" 신호를 계속 보낼 이유 없음.

## Test plan
- [x] Drive 동기화 흐름 자체엔 변화 없음 (텍스트만)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk because changes are text-only in the settings UI and do not modify any Drive sync logic or data handling.
> 
> **Overview**
> Removes the *experimental* messaging from the settings entry for Google Drive `백업 & 동기화` by updating the label and info description copy (drops `(실험)` and the “still experimental” sentence).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit a4173dae5fdb6afe8690caa04f2a0a02a746878e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
