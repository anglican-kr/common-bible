---
date: 2026-06-08
pr: 233
branch: refactor/bookmark-verse-spec
title: "refactor: 절-스펙 유틸을 verse-spec.js로 분리 (bookmark.js, ADR-034 후속)"
---

# refactor: 절-스펙 유틸을 verse-spec.js로 분리 (bookmark.js, ADR-034 후속)

## 무엇을

`bookmark.js`(3,578줄)의 **`VERSE_SPEC` + `VERSE_SERIALIZE` 블록**(parseVerseSpec·selectedVersesToSpec·mergeVerseSpecs·collapse\*·serializeVerseRange)을 `js/app/verse-spec.js`(leaf, 의존 0)로 분리. bookmark 전용이 아니라 **views(복사)·routing(parsePath 절 딥링크)도 쓰는 범용 유틸**이라 별도 모듈이 맞음.

- `bookmark.js` **3,578 → 3,364줄**
- bookmark은 save/copy 경로용으로 **명시 import**. 외부 호출자용 `window.{parseVerseSpec,…}` facade는 verse-spec.js가 소유.

## bookmark.js core/ui 분리 1단계
ADR-034 후속(`bookmark.js` 분할)의 첫 단계. 조사 결과 "순수 로직"으로 분류한 마커 중 `VERSE_SPEC`의 DOM 사용은 **결합이 아니라 인자(`article`)/자족적 변환**이라 DOM 분리 선행 없이 추출 가능했음(known-issues 검토). 다음 단계: `bookmark-core.js`(QUERY/SORT/HREF/ACTIVE).

## 발견·수정한 버그
추출 후 bookmark.js의 `export {}`·`appBookmark` aggregate에 옮긴 함수가 남아 있었음 → `export {parseVerseSpec}`이 **모듈-로컬 바인딩이 없어 ESM 인스턴스화 실패 → 앱 전체 로드 깨짐**(e2e 12건 전부 타임아웃). **tsc는 types.d.ts 전역 선언 때문에 못 잡는 사각지대** → playwright 로드 검사로 발견·수정.

## 검증
- ✅ tsc main·worker 0
- ✅ 유닛 678
- ✅ e2e `test_navigation` 12 (절 딥링크 `test_verse_url` 포함) + playwright 로드 검사 **pageerror 0**

## 곁다리
ADR-034의 "미스노머" → "이름이 실제 내용과 안 맞음"으로 정리.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 앱 부트스트랩·ESM export와 `window` facade 소유권이 바뀌어 로드 순서나 잘못된 re-export 시 전체 SPA 로드가 깨질 수 있습니다. 동작은 기존과 동일한 이동이라 회귀는 테스트·e2e로 잡히는 편입니다.
> 
> **Overview**
> **ADR-034 후속 1단계:** `bookmark.js`에 있던 `VERSE_SPEC`·`VERSE_SERIALIZE` 마커 블록을 leaf 모듈 **`js/app/verse-spec.js`** 로 옮깁니다. 절 스펙 파싱·병합·복사용 DOM 직렬화는 북마크뿐 아니라 `views`·`routing`에서도 쓰이므로 공용 모듈로 분리합니다.
> 
> `bookmark.js`는 저장/복사 경로용으로 **ESM import**만 쓰고, `window.{parseVerseSpec,…}` facade와 `export`는 **`verse-spec.js`가 담당**합니다. 부트스트랩은 `index.html`에 `verse-spec.js`를 `bookmark.js` 앞에 추가하고, `sw.js` 셸 프리캐시·`bookmark.test.js`의 마커 slice 경로를 새 파일에 맞게 갱신합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit b4b5e1735bb2947ab22cc4518b6206e3131bf3c0. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
