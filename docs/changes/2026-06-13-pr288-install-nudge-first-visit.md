---
date: 2026-06-13
pr: 288
branch: fix/install-nudge-first-visit
title: "fix: 설치 너지 첫 방문 표시 차단 (침입형 인터스티셜·크롤러 렌더 개선)"
---

# fix: 설치 너지 첫 방문 표시 차단 (침입형 인터스티셜·크롤러 렌더 개선)

## 배경

GSC URL 검사의 라이브 테스트(구글봇 스마트폰 렌더)에서 **설치 안내 모달("앱으로 설치")이 본문을 덮은 채** 렌더되는 것을 확인했다. 너지 기본 상태가 `{visits:0, nextShow:1}`이라 **첫 방문 즉시** 모달이 뜨는데, 이는:

- 검색에서 들어온 모바일 사용자에게 **침입형 인터스티셜**(본문을 가리는 모달)이 되고,
- **상태가 없는 검색 크롤러**는 매 크롤이 `visit 1`이라 렌더 스크린샷마다 이 모달을 본다.

## 변경

- `storage.js`: 너지 기본 `nextShow` **1 → 2**. 첫 방문에는 너지가 뜨지 않고, **2번째 방문** 독자부터 정상 표시. 크롤러(항상 visit 1)는 UA 분기 없이 자연히 제외된다. 이유는 코드 주석으로 남김.
- `storage.test.js`: 기본값 단언 2곳(`_loadNudgeState` no-storage·malformed-JSON) 동반 갱신.
- `tests/e2e/conftest.py`: 주석만 정확화(동작 변경 없음 — 너지는 계속 `neverShow`로 억제).

## 범위 메모

이 변경은 **UX·랭킹 품질·크롤 렌더 깨끗함** 개선이다. 구글의 "크롤됨–색인 안 됨"(0 색인)은 렌더링이 아니라 콘텐츠 가치·도메인 권위 문제로 진단됐으므로, 이 PR이 색인 0을 직접 해소하지는 않는다(별도 트랙).

## 검증

- 유닛 **728개 전부 통과** (`node --test tests/unit/*.test.js`).
- e2e는 conftest가 너지를 `neverShow`로 억제하므로 영향 없음.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Small default-state tweak for a promotional overlay; no auth, sync, or data-path changes.
> 
> **Overview**
> The install promo no longer appears on a user’s **first** session. Default nudge state in `_loadNudgeState` changes **`nextShow` from 1 to 2**, with comments explaining that this avoids a content-covering interstitial for search landings and keeps stateless crawlers (always “visit 1”) from rendering the modal in live tests.
> 
> Unit expectations in `storage.test.js` for empty and malformed nudge storage now assert `nextShow: 2`. E2E `conftest.py` only updates comments: tests still force `neverShow`, but the note now reflects that the new default already skips visit one while multi-boot tests still need suppression.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 48f6a7a1dd297f95c1a4892cfd3ed4c3c3363cf7. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
