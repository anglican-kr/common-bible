---
date: 2026-06-07
pr: 218
branch: docs/condense-claude-md
title: "docs: CLAUDE.md '현재 상태' 절 ADR 포인터로 압축"
---

# docs: CLAUDE.md "현재 상태" 절 ADR 포인터로 압축

## 무엇을

`CLAUDE.md`의 **"현재 상태"** 절을 절 머리말이 규정한 *"한두 줄로"* 기준으로 압축했다.

이 절은 파일 전체의 **65%(12,320 / 18,993자)** 를 차지하며 ADR 내용(토큰명·함수명·DOM id·개정 이력)을 그대로 중복하고 있었다. 9개 항목을 ADR 포인터 한두 줄로 수렴.

| | Before | After |
|---|---|---|
| 파일 전체 | 18,993자 | 10,053자 (**−47%**) |
| "현재 상태" 절 | 12,320자 | 3,380자 (**−73%**) |

## 안전성 — 유일본을 날린 게 아니라 중복 제거

삭제한 상세가 ADR에 보존돼 있는지 사전 검증함:

- **개정 이력**: ADR-010·028·029·030에 개정 블록 18·9·10·20개 존재
- **식별자**: `createOverlay`·`scrollMemory`·`_buildSharePayload`·`positionTabIndicator` 등 전부 해당 ADR 본문에서 확인

압축 대상: ADR-022·024·025·027·028·029·030·031·032 (이미 한 줄이던 하단 항목은 그대로 둠). 개요 절 2줄 → 1줄도 함께 정리.

## ⚠️ in-flight 브랜치와의 겹침

이 PR은 `origin/main` 기준이라 line 180(ADR-029)을 **main의 현재 내용**(다중 선택 삭제)으로 압축했다. 미머지 브랜치 `feat/bookmark-select-delete`는 같은 줄을 멀티-액션 선택 모드(공유·이동·삭제)로 다시 쓴다 — 그 브랜치 머지 시 line 180에서 충돌이 날 수 있다. 그때 압축 스타일을 유지하며 새 기능 한 줄만 반영하면 된다(오히려 새 컨벤션을 강제하는 셈).

## 효과

앞으로 새 ADR 작업 시 "현재 상태"엔 한 줄 포인터만 추가하고 상세는 ADR에 쌓으면, 이번 같은 정리가 다시 필요 없다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 문서만 변경하며 런타임·배포·인증 로직에는 영향 없다. 다만 ADR-029 북마크 한 줄은 진행 중 기능 브랜치와 머지 시 수동 정렬이 필요할 수 있다.
> 
> **Overview**
> **`CLAUDE.md`의 “현재 상태” 절을 ADR·`DESIGN.md`로 위임하는 짧은 포인터 형식으로 대폭 줄였다.** 디자인 시스템·모바일 탭 바·모핑 탭 바·탭 히스토리·오버레이 모듈화·헤더/목록·인용·병행 본문 등 9개 완료 항목에서 토큰명·DOM id·개정 이력·e2e/유닛 나열 같은 ADR 중복 서술을 제거하고, 각 항목당 한두 줄 + “상세는 ADR-0xx”로 정리했다.
> 
> **프로젝트 개요**도 두 문단을 한 문장으로 합쳤다. 이미 짧았던 Phase 1·테스트·북마크 동기화 등 하단 불릿은 내용 유지. 앞으로 이 절은 “무엇이 동작하는가”만 남기고 상세는 ADR 워크플로우대로 ADR에 쌓는 컨벤션을 강화한다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit d4a8a3bf2f38a38cd657161480a3d3ec51942153. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
