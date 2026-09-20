---
date: 2026-06-08
pr: 245
branch: data/submodule-bump-prose-paragraph
title: "data: 서브모듈 포인터 bump — 산문 단락 구분 외 누적 데이터"
---

# data: 서브모듈 포인터 bump — 산문 단락 구분 외 누적 데이터

## 내용

앱의 `data` 서브모듈 포인터를 data 저장소 main(`d24d3dd`)으로 올린다. 앱이 보던 포인터가 뒤처져 있어 그동안 쌓인 데이터 변경을 한 번에 따라잡는다.

`ad09a6b..d24d3dd`:
- **fix:** 산문 연속 줄 앞 빈 줄 → `paragraph_break` (ADR-006 §4, data#5) — 대화체·인용문이 한 단락으로 뭉치지 않고 줄바꿈됨
- data: 1역대 2:51 각주 인명 표기 통일 (갈랩→갈렙)
- data: 1역대·1열왕 인용·각주 마크업 (ADR-022)
- fix: parallel pending 장 경계 누출 버그 수정

## 왜 수동 bump 인가

산문 수정 PR(data#5)에서 빌드 산출물(`bible/`·`search-*`·manifest)을 직접 커밋해 drift 체크를 초록으로 맞췄다. 그 결과 머지 후 `build.yml`이 재빌드해도 차이가 없어 **no-op** → 앱 `sync-data.yml` 자동 디스패치가 발화하지 않았다. 그래서 포인터를 수동으로 올린다.

## 영향

- nested audio 서브모듈 포인터: 변화 없음
- 라우트(책·장) 추가·삭제 없음 → `sitemap.xml` 변화 없음
- JS 변경 없음 (서브모듈 포인터만)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 앱 코드 변경 없이 서브모듈 포인터만 갱신하며, 표시·검색에 쓰이는 성경 텍스트/마크업이 바뀌는 수준의 데이터 동기화이다.
> 
> **Overview**
> 앱 저장소의 **`data` 서브모듈 포인터**를 `common-bible-data` main **`d24d3dd`**(`ad09a6b` 이후)로 올려, 자동 `sync-data`가 발화하지 않은 동안 쌓인 데이터 변경을 한 번에 반영한다. 앱 **JS·라우트·audio 서브모듈·sitemap 구조**는 건드리지 않는다.
> 
> 포인터가 가리키는 실제 데이터 차이는 대략 다음이다: 산문 연속 줄 앞 빈 줄을 **`paragraph_break`**로 처리(대화·인용 단락 분리), 1역대 2:51 각주 인명(갈렙) 통일, 1역대·1열왕 인용·각주 마크업, parallel pending **장 경계 누출** 수정. 수동 bump 이유는 data#5에서 빌드 산출물을 data repo에 직접 커밋해 재빌드가 no-op이 되었기 때문이다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 2f6e7c73f01d0f28241dd673eba00a988cb61d9f. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
