---
date: 2026-06-10
pr: 264
branch: docs/adr-status-sync
title: "docs: ADR 상태 필드를 실제 구현 상태에 맞춰 동기화"
---

# docs: ADR 상태 필드를 실제 구현 상태에 맞춰 동기화

## 배경

상태 필드에 미완으로 표기된 ADR을 실제 구현 상태(git·`docs/status.md`·코드)와 대조한 결과, **머지 시 상태 갱신(ADR 워크플로우 §3)이 누락된** 낡은 표기 4건을 확인.

## 정정 내역

| ADR | 기존 | 정정 | 근거 |
|---|---|---|---|
| 020 | 진행 중 (Phase A 착수) | 완료 | 4분할·서브모듈 가동, status.md "완료 2026-05-11" |
| 021 | Phase 3(webhook) 후속 | Phase 3 완료, Phase 4만 대기 | `sync-data.yml` 가동 중(5/30~) |
| 030 | main 머지 대기 | 머지 완료 | #188·#191·#200 머지됨 |
| 035 | 구현 중 | 구현 완료 | #255 + 후속 머지, 본문 개정 반영됨 |

실제로 미완인 항목(021 Phase 4 실배포 검증, 022 Phase 3 콘텐츠, 027 콘텐츠 마크업, 034 PR5c·PR6 보류, 030/029 데스크탑 사이드바)은 그대로 유지.

docs 전용 변경.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 문서·ADR 메타데이터만 변경하며 런타임·배포·인증 로직에는 영향 없습니다.
> 
> **Overview**
> **문서만** ADR·구현 현황의 **상태 필드**를 실제 진행 상황과 맞춥니다. 머지 시 ADR 워크플로우 §3 갱신이 빠져 남아 있던 표기를 정리합니다.
> 
> **ADR-020** 상태를 「진행 중 (Phase A 착수)」→ **「완료」**(4분할·서브모듈 마운트 가동). **ADR-021**은 Phase 3 **`sync-data.yml` webhook 완료**로 반영하고, Phase 4(실배포·DevTools 검증)만 대기로 명시. **ADR-030**은 main 머지·dev 배포 완료(#188·#191·#200), **ADR-035**는 구현 완료(#255 + 후속)로 갱신하며, 데스크탑·콘텐츠 등 **미완 후속 항목은 그대로** 둡니다.
> 
> `docs/status.md`의 북마크 모아 읽기 항목을 **「구현 중」→「완료」**로 동일하게 맞춥니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit bea01e67b73053df1d5dcfa56c658c7bf7a5aa7b. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
