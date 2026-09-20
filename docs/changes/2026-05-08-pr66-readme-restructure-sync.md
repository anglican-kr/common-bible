---
date: 2026-05-08
pr: 66
branch: docs/readme-restructure-sync
title: "docs: README 재구성 — Drive 동기화를 top-level로 분리"
---

# docs: README 재구성 — Drive 동기화를 top-level로 분리

## Summary

Phase 2h 단계 4에서 GIS / Implicit Flow / FedCM이 제거되며 Drive 동기화가 데스크탑·Android·iOS 동일 코드 경로로 통일됐는데, README는 여전히 동기화를 `## 플랫폼별 동작 차이` 섹션 아래 두고 있어 의미 어긋남. 섹션 분리.

**Before:**
- `## 플랫폼별 동작 차이`
  - `### 앱 설치` (플랫폼별 다름)
  - `### Google Drive 동기화` (실제로는 통일됨, 위치 부적절)
  - `### 알려진 한계` (iOS-specific + sync-specific 혼재)

**After:**
- `## 플랫폼별 동작 차이` (좁아짐)
  - `### 앱 설치` (여전히 플랫폼별)
  - `### iOS 고유 제약` (7일 ITP + WebKit 래퍼)
- `## Google Drive 동기화` (top-level 신규)
  - 시나리오 표 + BFF + 운영 가드
  - `### 알려진 한계` (sync-specific만: OAuth 검수, 외부 권한 회수)

ITP는 동기화에만 영향이 아니라 모든 로컬 상태(북마크·설정 포함)에 영향을 주므로 의도적으로 iOS 고유 제약 쪽에 두고, Drive 동기화 절은 그쪽으로 cross-link만 둠.

코드 변경 0, 문서만.

## Test plan
- [x] README의 새 섹션 구조가 일관되는지 — `^## ` `^### ` 헤더 grep으로 확인
- [x] 내부 링크(`#ios-고유-제약`)가 자동 생성된 anchor와 매칭되는지 — GitHub Markdown은 한국어 헤더도 anchor로 변환됨

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk: documentation-only restructuring with no runtime code changes; main risk is broken anchors or reader confusion if links drift.
> 
> **Overview**
> Moves Google Drive sync documentation out of `플랫폼별 동작 차이` into a new top-level `## Google Drive 동기화` section, explicitly stating the unified OAuth2 Authorization Code + PKCE + refresh-token path (and that prior GIS/Implicit/FedCM branching is gone).
> 
> Narrows `플랫폼별 동작 차이` to installation guidance plus a new `iOS 고유 제약` subsection (7-day ITP storage purge, WebKit-wrapper browser limitations), and cross-links from sync limitations back to that iOS section. Updates `docs/worklog.md` with the rationale and notes this PR is docs-only.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 20dab3d86fe00bf7229e2982bb097998b0365e86. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
