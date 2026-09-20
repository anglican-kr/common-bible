---
date: 2026-06-08
pr: 232
branch: refactor/rename-views
title: "refactor: views-routing.js → views.js 개명 (이름·역할 불일치 해소, ADR-034)"
---

# refactor: views-routing.js → views.js 개명 (이름·역할 불일치 해소, ADR-034)

## 무엇을

ADR-034로 라우팅(`routing.js`)·오디오(`audio-player.js`)·데이터 페칭(`data-fetch.js`)·탭 인디케이터(`tabbar.js`)가 모두 빠져나가, `views-routing.js`에는 **렌더 헬퍼 + Views만** 남았습니다. 라우팅 잔여 0(확인: `route`/`navigate`/`parsePath` 언급은 전부 주석)이라 **이름이 실제 내용과 안 맞아** → `js/app/views.js`로 개명.

## 변경
- `git mv` (히스토리 보존): `views-routing.js` → `views.js`, `views-routing.test.js` → `views.test.js` (ADR-013 `<소스-basename>.test.js` 컨벤션)
- 기능 참조: `routing.js`의 ESM import, `index.html` 스크립트 태그, `sw.js` 매니페스트, 테스트 `VIEWS_PATH` → 갱신
- 코드·타입·주석의 `views-routing` 참조 일괄 갱신 (잔여 0 검증)
- 살아있는 문서: `architecture.md` §4 모듈표·부록 B → `views.js`, **라우팅 동작 서술(§5·§11)은 `routing.js`로 정정**(PR5a 이후 stale였던 부분). ADR-034 §결과 개명 완료 표시.
- 과거 ADR·worklog 서술은 시점 기록이라 보존

## 검증
- ✅ `tsc` main·worker — 0 error
- ✅ 유닛 `node --test` — **678** (`views.test.js`가 새 경로에서 슬라이스)
- ✅ e2e `test_navigation` + `test_audio` — **18** (앱이 `views.js`로 정상 로드)

> 1Password 서명 불가로 미서명.
