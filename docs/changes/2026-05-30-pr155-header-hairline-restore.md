---
date: 2026-05-30
pr: 155
branch: fix/header-hairline-restore
title: "style: 읽기 헤더 hairline 복구 (ADR-025 개정)"
---

# style: 읽기 헤더 hairline 복구 (ADR-025 개정)

## Summary

- ADR-025(#154) dev 검증 결과 그림자만으로는 scroll-top 정적 상태의 헤더 경계 인지가 약함이 확인됨.
- `#app-header::after` 1px gradient hairline 을 복구하고 역할 분리: **hairline = always-on 경계**, **fade + shadow = 스크롤 elevation 신호**.
- 책 목록 페이지(division tabs 슬롯)의 조건부 숨김은 ADR-024 그대로 유지.
- ADR-025 §3 에 개정 노트 추가, CLAUDE.md 현재 상태 한 줄 갱신.

## Test plan

- [x] `node --test tests/unit/*.test.js` — 536/536 pass
- [ ] 라이트/다크 scroll-top 에서 헤더 하단 hairline 가시성 확인
- [ ] 책 목록 페이지(division tabs 있음)에서 hairline 자동 숨김 유지
- [ ] 스크롤 시 그림자 + fade gradient + hairline 3중 신호가 잡음 없이 자연 결합되는지 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS and documentation only; no routing, auth, or data changes.
> 
> **Overview**
> ADR-025 dev 검증 반영으로, 읽기 헤더 하단 **1px gradient hairline**(`#app-header::after`)을 다시 넣고 역할을 나눕니다. **hairline**은 스크롤 최상단에서도 보이는 고정 경계, **fade + `.scrolled` 그림자**는 스크롤 elevation 신호로 유지합니다.
> 
> `#app-header` 패딩을 하단 0으로 조정해 hairline `margin-top`과 맞추고, 책 목록(division tabs 슬롯이 채워진 경우)에서는 ADR-024대로 hairline을 숨기는 `:has` 규칙을 추가합니다. ADR-025 §3에 개정 노트를 달고 `CLAUDE.md` 현재 상태 한 줄을 갱신합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 7ff22137714f7833622c33e0d8da01d482d36f0c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
