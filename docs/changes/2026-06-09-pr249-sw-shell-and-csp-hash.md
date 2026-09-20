---
date: 2026-06-09
pr: 249
branch: fix/sw-shell-and-csp-hash
title: "fix: SW 셸 precache 보완(refresh-store) + CSP 인라인 스타일 해시 갱신"
---

# fix: SW 셸 precache 보완(refresh-store) + CSP 인라인 스타일 해시 갱신

프로덕션 Drive 동기화 장애를 조사하던 중 발견한 **앱 측 위생 수정 2건**입니다. (실제 장애 원인은 서버 측 njs BFF 세그폴트였고 서버 저장소에서 별도 수리했습니다 — 아래 두 건과는 무관.)

## 1. SHELL_FILES에 `refresh-store.js` 추가 (+ 검증 테스트)
- `index.html`은 `/js/sync/refresh-store.js`를 로드하지만 `sw.js`의 `SHELL_FILES` precache 목록에서 빠져 있었음 → prod(cache-first)에서 **오프라인 콜드 로드 시 이 모듈을 못 가져오는 틈**.
- `tests/unit/sw.test.js` 신규: `SHELL_FILES`를 정적 분석해 ①디스크 존재 ②`index.html`이 로드하는 로컬 script/style과의 패리티를 검증. 이번 누락을 앞으로 자동으로 잡음. (`/data/*`는 서브모듈이라 CI 미체크아웃 → 존재 검사 제외)

## 2. CSP `style-src` 해시 갱신
- critical pre-paint 인라인 `<style>` 블록이 수정됐는데 CSP 해시는 묵은 값 2개로 남아, 브라우저가 인라인 스타일을 차단(콘솔 `Applying inline style violates ... style-src`) → pre-paint CSS 미적용으로 잠깐 FOUC.
- 실제 블록 해시(`sha256-+2eN…`)로 교체, 죽은 해시 2개 제거. (서버는 CSP 헤더 미발신 → meta 태그가 유일한 CSP)

## 검증
- `node --test tests/unit/*.test.js` → **682/682 통과** (신규 4 포함)
- CSP 해시가 현재 `<style>` 블록과 일치함을 sha256로 확인

## 후속 (이 PR 범위 밖)
- ADR-017(OAuth BFF) — 서버 njs 제거 반영 개정 필요

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Small hygiene fixes to precache list, CSP meta tag, and static tests; no auth or sync logic changes.
> 
> **Overview**
> **Service worker offline shell** — `sw.js` now precaches `/js/sync/refresh-store.js`, which `index.html` already loads for Drive sync but was missing from `SHELL_FILES`. In production cache-first mode that gap could break a cold offline load.
> 
> **Regression guard** — New `tests/unit/sw.test.js` statically checks that `SHELL_FILES` entries exist on disk (except `/data/*`) and that every local script/stylesheet in `index.html` is in the precache list.
> 
> **CSP** — The meta `Content-Security-Policy` `style-src` hash list is updated to match the current critical inline `<style>` block (stale hashes removed), so pre-paint styles are not blocked and FOUC from CSP violations is avoided.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 454cddace21773da386dbde5a390ce6deac90cf2. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
