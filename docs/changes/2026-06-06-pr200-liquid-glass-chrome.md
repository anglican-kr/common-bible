---
date: 2026-06-06
pr: 200
branch: claude/liquid-glass-chrome-uItSg
title: "style: 리퀴드 글라스 floating chrome (ADR-030 후속⁵·⁶)"
---

# style: 리퀴드 글라스 floating chrome (ADR-030 후속⁵·⁶)

하단 floating chrome 의 리퀴드 글라스 다듬기 두 단계.

## 후속⁵ — 절제된 리퀴드 글라스
- 평평하던 하단 chrome 에 저강도 입체 질감(`--glass-sheen` 광택 + `--glass-inset` 두께감) 공통 적용
- 활성 인디케이터를 per-tab 배경 → 공유 슬라이딩 요소(`positionTabIndicator`, transform 만, 60fps)로 전환

## 후속⁶ — 글래스 레시피를 오디오 바로 통일
- 탭바·검색·모핑 입력창·키보드 닫기 버튼이 오디오 바와 다른 글래스 값(틴트 `--bg 62%`/`--bg-card 72%`, `blur(16px) saturate(180%)`)을 쓰던 것을 **오디오 바 레시피로 단일화** — 틴트 `--bg 50%`(라이트·다크 공통), `blur(12px)`(saturate 제거)
- 후속⁵ 의 sheen/inset·테두리·`.active` 테마 틴트는 그대로 유지(베이스 틴트만 교체)

## 문서
- ADR-030 §1 에 후속⁵·후속⁶ 개정 블록
- CLAUDE.md "현재 상태" 모핑 탭 바 절 갱신

CSS·문서 전용 변경. 시각 검토는 dev 에서.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 모바일 하단 UI·CSS·경량 JS 배치만 변경하며 인증·데이터·라우팅 핵심 로직은 건드리지 않는다. 시각·모핑 회귀는 dev에서 수동 확인이 권장된다.
> 
> **Overview**
> **하단 floating chrome**에 ADR-030 후속⁵·⁶을 반영해 **절제된 liquid-glass** 질감과 **활성 탭 표시**를 다듬는다.
> 
> `:root`에 **`--glass-sheen`**(상단 광택)과 **`--glass-inset`**(입체 베벨)을 두고, 탭 pill·검색 원형·모핑 입력·키보드 닫기·오디오 바·슬라이딩 인디케이터에 공통 적용한다. **후속⁶**으로 탭/검색 계열의 frosted glass를 **오디오 바와 동일 레시피**(`--bg 50%`, `blur(12px)`, saturate 제거)로 맞춘다.
> 
> 활성 **56px 정원 인디케이터**는 탭마다 배경을 두지 않고, `#tab-bar` 안 **공유 `.tab-indicator`**가 `positionTabIndicator`(`views-routing.js`, `syncTabBarActive` 연동)로 **`transform`만** 슬라이드한다. 검색·스크롤 축소 모핑 중에는 CSS로 숨기고, `tabbar.js`의 `syncTabIndicator`·`transitionend`로 위치를 맞춘다. `prefers-reduced-transparency` / `prefers-reduced-motion` 폴백을 유지한다.
> 
> `DESIGN.md`, ADR-030, `CLAUDE.md` 현재 상태를 같은 결정으로 갱신한다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 27a558070f76de924037510e60ef518757f0ed81. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
