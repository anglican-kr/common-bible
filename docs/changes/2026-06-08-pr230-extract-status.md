---
date: 2026-06-08
pr: 230
branch: docs/extract-status
title: "docs: 구현 현황을 CLAUDE.md에서 docs/status.md로 분리"
---

# docs: 구현 현황을 CLAUDE.md에서 docs/status.md로 분리

CLAUDE.md의 "현재 상태" 섹션(19개 불릿, 매 PR마다 누적되던 부분)을 **`docs/status.md`** 로 분리합니다. CLAUDE.md는 안정적 작업 가이드(컨벤션·워크플로우·구조 포인터)만 남기고 한 줄 포인터만.

## 왜
프로젝트 상태를 CLAUDE.md에 계속 기록하면 가이드 문서가 changelog처럼 비대해짐. "지금 무엇이 동작하는가" 스냅샷은 별도 문서가 적절.

## 문서 역할 분리
| 문서 | 역할 |
|---|---|
| `docs/status.md` (신설) | 현재 동작 스냅샷 ("무엇이 동작하나") |
| `docs/worklog.md` (기존) | 날짜별 작업 히스토리 |
| `docs/known-issues.md` (기존) | 미해결 이슈·후속 백로그 |
| `docs/architecture.md` (기존) | 구조 + ADR 인덱스 |
| `CLAUDE.md` | 안정적 작업 가이드만 |

## 변경
- `docs/status.md` 신설 — 19개 현황 불릿 이관 (verbatim)
- `CLAUDE.md` — 현재 상태 섹션 → 포인터, ADR 워크플로우 §3 참조, 프로젝트 구조 docs 목록 갱신 (195→175줄)
- ADR-034 프로세스 노트 참조 갱신. worklog·완료 ADR 등 **히스토리 기록은 당시 그대로 보존**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 문서·워크플로우 참조만 변경하며 런타임·빌드·배포 코드는 건드리지 않습니다.
> 
> **Overview**
> **구현 현황**을 `CLAUDE.md`의 긴 「현재 상태」 불릿(19개)에서 신설 **`docs/status.md`** 로 이전하고, `CLAUDE.md`는 해당 문서·`worklog`·`known-issues`·ADR 인덱스를 가리키는 **짧은 포인터**만 남깁니다.
> 
> **ADR 워크플로우 §3**과 **ADR-034**의 머지 시 갱신 대상을 `CLAUDE.md` → **`docs/status.md`** 로 바꿨고, `docs/` 구조 설명에 `status.md`·`known-issues.md` 역할을 반영했습니다.
> 
> 별도로 **`docs/known-issues.md`** 에 ADR-034의 `applyAudioShow` → `window.parsePath` facade 항목을 **「조사 완료, 현 설계 유지」** 로 정리하고 §2.2에 사이클·stale `readingContext`·동기화 호출자 등 **유지 근거**를 추가했습니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit d9abeb6b14b00ffb600ff2a39888b7968d793d8f. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
