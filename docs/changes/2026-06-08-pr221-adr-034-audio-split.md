---
date: 2026-06-08
pr: 221
branch: refactor/adr-034-audio-split
title: "refactor: 오디오 플레이어 모듈 분리 + 뷰·라우팅 2차 분할 계획 (ADR-034)"
---

# refactor: 오디오 플레이어 모듈 분리 + 뷰·라우팅 2차 분할 계획 (ADR-034)

## 무엇을

`js/app/views-routing.js`가 이름과 달리 ~7개 관심사로 비대해진 문제(2,389줄)를 다루는 **2차 모듈 분할(ADR-018 후속)의 시작**입니다.

- **ADR-034** 채택 — 분할 목표 구조·PR 순서·결합도 감소 전략을 문서로 고정.
- **PR1 구현** — 오디오 플레이어를 `js/app/audio-player.js`로 추출 (views-routing 2,389 → 2,195줄).

## 왜 (응집 ↑ · 결합 ↓)

파일만 쪼개면 `window.X` 전역 facade 경유라 논리적 결합이 남습니다. 그래서 ADR-034는 분할과 **결합도 감소를 함께** 합니다:

1. 비순환 seam은 `window.X` → 명시 ESM `import`/`export` 전환
2. 순환 dispatch(`route()` ↔ search/bookmark/settings 뷰)는 `registerView` registry로 역전
3. `route()`의 12개 `closeX` 모달 클로저 호출은 ADR-032 `closeAllOverlays()`로 축약

이번 PR1은 그 첫 적용 — 오디오의 `route`측 호출을 명시 import로 잇고, 외부 호출자(search·settings·bookmark·app·sync)용 facade만 `audio-player.js`가 소유합니다. `applyAudioShow→parsePath` 상향 엣지 하나만 `window.parsePath`로 임시 경유(PR5에서 해소).

## 변경 파일

- `js/app/audio-player.js` (신규, +239) — 오디오 UI·재생 상태·`#audio-bar` 생명주기
- `js/app/views-routing.js` (−216 net) — 오디오 영역 제거 + 명시 import + facade 트림
- `index.html` / `sw.js` — 스크립트 태그 + 셸 캐시 매니페스트 항목
- `docs/decisions/034-...md`, `docs/architecture.md`, `CLAUDE.md` — ADR + 인덱스 + 현재 상태

## 검증

- ✅ `tsc -p tsconfig.json` / `tsconfig.worker.json` — 0 error
- ✅ 유닛 `node --test` — **674/674 통과**
- ✅ 오디오 e2e (`test_audio.py` + `test_audio_controls.py`) — **12/12 통과** (챕터 로드·내비·에러 상태·속도/재생/일시정지/탐색·위치 저장)
- ⚠️ `test_tabbar.py` 8건 실패 — `#search-input` 모핑 타임아웃. **baseline `main`에서도 동일하게 재현되는 사전 존재 문제**(모핑 검색 영역, 본 PR 미변경 코드). 별도 추적 필요. tabbar.js는 내가 옮긴 심볼을 참조하지 않음(`appStorage.loadAudioShow`만, 미변경).

## 후속 PR (ADR-034)

데이터 페칭 → 탭 인디케이터(→tabbar) → PTR → 라우팅(→잔여 views.js) → (후속) bookmark.js core/ui 분리.

> 참고: 이 환경에서 1Password 서명 불가로 커밋이 **서명되지 않았습니다**. 필요 시 머지 전 amend 재서명 가능.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Refactor-only with behavior preserved; main risk is script load order or missing SW shell entry causing runtime ReferenceError on audio routes.
> 
> **Overview**
> **ADR-034** documents the second split of `views-routing.js` and `bookmark.js` (facade → ESM imports, `registerView` for circular dispatch). **PR1** implements the first slice: chapter MP3 UI and `#audio-bar` logic move from `views-routing.js` into new **`js/app/audio-player.js`**, shrinking that file by ~190 lines.
> 
> `views-routing.js` now **imports** `showAudioPlayer` / `hideAudioBar` for chapter/prologue/list routes instead of defining them locally; audio-related `window` exports are removed from `appViewsRouting` and assigned only in `audio-player.js` (`hideAudioBar`, `applyAudioShow`, `getCurrentAudio`) for untouched callers (settings, search, bookmark, `app.js`, sync). `applyAudioShow` still uses **`window.parsePath`** to avoid an import cycle until routing is extracted (PR5).
> 
> **`index.html`** loads `audio-player.js` before `views-routing.js`; **`sw.js`** adds the module to the shell cache. Docs: new ADR-034, architecture appendix, CLAUDE.md status line.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 759c9e4600a64c8adc02828c637f1f36a7db5cbe. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
