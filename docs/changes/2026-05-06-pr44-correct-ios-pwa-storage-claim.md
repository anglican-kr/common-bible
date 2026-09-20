---
date: 2026-05-06
pr: 44
branch: fix/correct-ios-pwa-storage-claim
title: "docs: iOS 7일 ITP 적용 범위 정정 — 홈 화면 PWA는 면제"
---

# docs: iOS 7일 ITP 적용 범위 정정 — 홈 화면 PWA는 면제

## Summary

ADR-011 §맥락(line 26-27)은 이미 "홈 화면 PWA로 설치하면 ITP 적용이 제외되어 안전하지만, 미설치 사용자는 여전히 취약하다"고 정확히 기록하고 있었으나, Phase 2g 트레이드오프 노트와 README \"알려진 한계\" 섹션은 그 사실과 어긋나 **PWA 일반에 7일 ITP가 적용되는 것처럼 잘못 기술**되어 있었습니다.

## 실제 동작

| 환경 | 7일 ITP storage cap |
|------|---------------------|
| Safari 탭에서 bible.anglican.kr 직접 열기 | 적용 — 7일 미사용 시 storage 정리 |
| **홈 화면에 설치한 PWA (iOS 17+ HSWA)** | **면제** — storage 영속 |

따라서 Phase 2g silent 재인증 실패의 실제 사유는:
1. **Google 자체 세션 만료** — 서버 측에서 약 2주 비활성 시 만료, silent → \`login_required\`
2. **외부 revoke** — 사용자가 Google 계정 설정에서 권한 해제, silent → \`consent_required\`

## 변경 파일

- \`README.md\` \"알려진 한계\" 섹션 — 7일 ITP는 Safari 탭 한정, PWA 영속 명시 + Google 자체 세션 만료 항목 분리
- \`docs/decisions/011-bookmark-sync.md\` Phase 2g 트레이드오프 — 동일 정정 + ADR §맥락 cross-reference

## Test plan
- [x] 본문 맥락 확인 (ADR-011 §맥락 line 26-27의 기존 기술과 정합)
- [x] 1.4.4 릴리스 노트(이미 발행)는 \"오랜 기간(약 2주) Google 측 세션 만료\"로 이미 정정 발행됨

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation-only updates clarifying iOS storage persistence and silent reauth failure causes; no runtime code changes.
> 
> **Overview**
> Updates the iOS Drive sync documentation to clarify that **Safari’s 7-day ITP storage purge applies to users opening the site in a Safari tab**, while **home-screen installed PWAs (iOS 17+ HSWA) keep persistent storage and aren’t subject to that ITP behavior**.
> 
> Also documents **Google’s own OAuth session expiry (~2 weeks inactivity)** as a distinct reason silent re-auth (`prompt=none`) can fail, and aligns ADR-011 tradeoff notes (including error codes like `login_required`/`consent_required`) with this corrected explanation.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 25df6ae4974caba0649438586d2c473d76a201d8. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
