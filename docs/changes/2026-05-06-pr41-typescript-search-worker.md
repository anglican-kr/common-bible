---
date: 2026-05-06
pr: 41
branch: chore/typescript-search-worker
title: "chore: js/search-worker.js TypeScript 점진 도입 + 워커 tsconfig"
---

# chore: js/search-worker.js TypeScript 점진 도입 + 워커 tsconfig

## Summary

PR #39 후속 단계. `js/search-worker.js` (~263줄)에 `// @ts-check` + JSDoc 타입 주석 추가.

## 왜 별도 tsconfig?

Web Worker는 DOM `Window`가 아닌 `DedicatedWorkerGlobalScope` 컨텍스트라 메인 tsconfig의 `lib: ["DOM"]` 그대로 쓰면 `onmessage` / `postMessage` / `self` 타입이 충돌. 해결:

- 신규 `tsconfig.worker.json` — `lib: ["WebWorker", "ES2022"]`, `include: ["js/search-worker.js"]`
- 메인 `tsconfig.json` — `exclude`에 search-worker.js 추가

## 메시지 프로토콜·데이터 타이핑

inline JSDoc `@typedef`로 worker 자족적 타입 정의 (메인 스레드 측 미타이핑 상태라 cross-file 공유 불요):

- `IncomingMessage = InitMessage | SearchMessage` (디스크리미네이티드 유니온)
- `SearchMeta`, `LoadedChunk`, `RawChunkPayload`, `ChunkConfig`
- `VerseRef`, `ParsedQuery`, `MatchedRow`, `PaginatedResult`

## 마이그레이션 중 정리한 것

- **`err.message` 직접 접근 → `err instanceof Error` narrowing** (init/search 양쪽 catch)
- **`loadedChunks[name]` truthiness 체크 → `name in loadedChunks` 연산자 사용** — 인덱스 시그니처 반환 타입이 비-옵셔널이라 `if (loadedChunks[name])`이 항상 true로 narrow되는 문제. `in` 연산자가 의도("키 존재?")에 더 가깝고 TS도 만족.
- **`meta` non-null narrowing** — `parseQuery`/`tryVerseRef`/`paginate`는 `loadMeta()` 이후만 호출되는 호출 컨벤션이라 호출 측 단언으로 처리.

## 검증

- ✅ `tsc --noEmit -p tsconfig.json` 0 errors
- ✅ `tsc --noEmit -p tsconfig.worker.json` 0 errors
- ✅ e2e 16/16 통과 (`tests/e2e/test_search.py`)

## 추후 단계 (별도 PR)

- CI 연동: `.github/workflows/test.yml`에 두 tsconfig 모두 검사 (이때 `package.json` 신설)
- `js/app.js` (5,200줄) — 분할 리팩터링과 함께 별도 의제

## Test plan

- [ ] CI 통과 확인
- [ ] 로컬에서 키워드 검색·`in:<별칭>` 연산자·구절 참조(\`창세 1:3\`) 정상 작동 확인
- [ ] 청크 부분 결과 표시(NT 먼저, OT 후) 정상 작동

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk: changes are primarily type-annotation and TypeScript configuration, with only minor runtime tweaks to worker error payloads and chunk-cache existence checks.
> 
> **Overview**
> Adds `// @ts-check` and comprehensive JSDoc typedefs to `js/search-worker.js`, tightening message shapes (`init`/`search`) and internal data structures for safer gradual typing.
> 
> Separates TypeScript checking for the Web Worker by introducing `tsconfig.worker.json` (using `WebWorker` libs) and excluding `js/search-worker.js` from the main `tsconfig.json` to avoid DOM vs worker global type conflicts.
> 
> Includes small behavior cleanups: init-path worker errors no longer include a nonexistent `searchId`, `catch` blocks safely stringify non-`Error` throwables, and chunk cache checks use `name in loadedChunks/loadingPromises` to match intended semantics under stricter typing.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 90a2194fdd5800b0c14904bd574548d9a137189c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
