---
date: 2026-05-30
pr: 154
branch: feat/header-frosted-glass
title: "feat: 읽기 헤더 스크롤 elevation 그림자 (ADR-025)"
---

# feat: 읽기 헤더 스크롤 elevation 그림자 (ADR-025)

## Summary

- `#sticky-group` 아래 `#scroll-sentinel` IntersectionObserver(`initScrollElevation`)가 페이지 최상단 이탈을 감지해 `.scrolled` 토글, 라이트 `0 4px 16px rgba(0,0,0,0.04)` / 다크 `0 4px 20px rgba(0,0,0,0.25)` 미세 그림자가 0.18s 페이드 인.
- `#app-header::after` 1px hairline 제거 → fade gradient + shadow 두 신호만 유지 (ADR-024 가 책 목록 페이지에 적용했던 hairline 숨김을 모든 페이지로 일반화).
- iOS 26 toolbar tinting 자동 추출 충돌 / PWA standalone status bar 비동기 회피를 위해 frosted glass(`backdrop-filter`)는 의도적 미적용 — 표면이 아닌 그림자 축으로 하단 오버레이와의 통일감 확보.

## Test plan

- [x] `node --test tests/unit/*.test.js` — 536/536 pass
- [x] `npx tsc -p tsconfig.json --noEmit` / `tsconfig.worker.json` — 0 error
- [ ] 라이트 모드 / 다크 모드 각각 scroll-top 평면 → 스크롤 시 그림자 페이드 인 → 다시 최상단 복귀 시 그림자 제거
- [ ] 라우트 전환(`route()`) 시 sentinel 이 viewport 로 복귀해 `.scrolled` 자동 해제
- [ ] 책 목록 / 장 목록 / 본문 / 머리말 네 화면 모두 hairline 없이 헤더 하단 여백이 자연스러운지 확인
- [ ] `prefers-reduced-motion: reduce` 환경에서 그림자가 페이드 없이 즉시 토글되는지 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS·DOM·비동기 초기화만 변경하며 라우팅·동기화·데이터·SW는 그대로입니다. 시각 회귀는 수동/e2e 확인이 권장됩니다.
> 
> **Overview**
> **ADR-025**로 읽기 헤더에 스크롤 연동 elevation을 넣고, 헤더에 frosted glass는 의도적으로 쓰지 않습니다.
> 
> `#scroll-sentinel`과 `initScrollElevation()`(IntersectionObserver)가 최상단 이탈 시 `#sticky-group`에 `.scrolled`를 붙여 라이트/다크 각각 미세 `box-shadow`가 0.18s로 페이드 인합니다. `#app-header::after` 1px hairline은 제거해 기존 fade gradient와 그림자만 남깁니다. `prefers-reduced-motion`에서는 전환을 끕니다.
> 
> `index.html`에 sentinel 마크업, `js/app.js` idle 체인에서 초기화, `types.d.ts`·`docs/architecture.md`·`CLAUDE.md` 현재 상태·신규 ADR 문서를 함께 반영합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 3ed1fbdada655113a89943210dee4a53d5ca34fe. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
