---
date: 2026-06-09
pr: 253
branch: fix/search-in-operator-absorb
title: "fix: 검색 in:<별칭> 연산자가 책 필터 칩으로 흡수되지 않던 회귀 수정"
---

# fix: 검색 in:<별칭> 연산자가 책 필터 칩으로 흡수되지 않던 회귀 수정

## 증상

검색창에 `사랑 in:요한` 을 입력해도 `in:요한` 이 **요한 책 필터 칩으로 전환되지 않고** raw 텍스트로 남았다(ADR-033 의도와 어긋남). 또 창세 칩이 이미 있는 상태에서 입력하면, in: 가 칩 없이 검색 범위만 넓혀 **칩(창세)과 실제 범위(창세+요한 union)가 어긋나** 혼란스러웠다.

## 원인 (로드 순서 race)

흡수에 쓰는 `_aliasMap` 을 부팅 시 `ensureAliasMap()` 으로 한 번 예열하는데, `window.loadBooks`(data-fetch.js)는 search.js 보다 **뒤에** 로드되는 모듈이라(index.html 스크립트 순서) 예열 시점엔 `undefined`. `if (typeof window.loadBooks !== "function") return` 으로 즉시 bail 하고 재시도가 없어 `_aliasMap` 이 영구 null 로 남아 `commitTopSearch` 의 흡수 가드가 항상 실패했다.

`#246`(동기 흡수 리팩터)이 commit 시점의 `await ensureAliasMap()` 을 부팅 예열로 옮기며 로드 순서 가정을 깬 회귀.

## 수정

- `ensureAliasMap` 이 한 번 bail 하지 않고 `loadBooks` 가 정의될 때까지 짧게 대기하도록 변경. commit 경로는 그대로 동기 유지(#246 의 설계 의도 보존).
- `docs/coding-pitfalls.md` §16 에 "모듈 init 시점 window facade 미정의 — 로드 순서 race" 함정 기록.

## 효과 (브라우저 스모크 검증)

| 시나리오 | 결과 |
|---|---|
| `사랑 in:요한` | `q=사랑` + `요한` 칩, 입력창에서 연산자 제거 |
| 창세 칩 + `사랑 in:요한` | `창세`·`요한` 두 칩 + union 검색(50건 = 11+39), 칩과 범위 일치 |

`in:` + 기존 칩 = **union**(더하기)으로 확정.

## 테스트

- tsc 통과, 유닛 684건 통과.
- 이 회귀는 vm 유닛 하네스가 `window.loadBooks` 를 미리 스텁해서 **유닛으로는 잡히지 않는다** — 실제 모듈 순서로 로드하는 브라우저 스모크로 검증.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 검색 부팅 예열 타이밍만 조정하며 인증·데이터·라우팅 핵심 경로는 건드리지 않습니다.
> 
> **Overview**
> **`in:<별칭>` 검색 연산자가 책 필터 칩으로 흡수되지 않던 회귀**를 고칩니다. 부팅 시 `ensureAliasMap()` 이 `window.loadBooks` 가 아직 없을 때 한 번만 빠져나가 `_aliasMap` 이 영구적으로 비어 `commitTopSearch` 의 동기 흡수가 항상 실패했습니다 (`search.js` 가 `data-fetch.js` 보다 먼저 로드됨).
> 
> `ensureAliasMap` 은 `loadBooks` 가 정의될 때까지 최대 약 1.5초(60×25ms) 짧게 대기한 뒤 맵을 채웁니다. **커밋 경로는 여전히 동기**이며, 부팅 예열만 로드 순서에 맞게 동작합니다.
> 
> `docs/coding-pitfalls.md` **§16** 에 init 시점 `window.X` facade 미정의·로드 순서 race 패턴과 vm 유닛으로는 잡히지 않는다는 검증 주의를 추가했습니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 85ef2cabf31fecdde31ef06efc680b8bc9b33238. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
