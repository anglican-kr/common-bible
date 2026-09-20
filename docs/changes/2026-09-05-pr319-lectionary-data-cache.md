---
date: 2026-09-05
pr: 319
branch: fix/lectionary-data-cache
title: "fix: 전례 데이터가 콘텐츠 해시를 무효화하지 못 하는 문제 (ADR-037 §7 미이행)"
---

# fix: 전례 데이터가 콘텐츠 해시를 무효화하지 못 하는 문제 (ADR-037 §7 미이행)

설계서 §8 의 **PR0**. 「한 줄」로 적혀 있던 항목인데, 열어 보니 실제로 동작하는 결함이었다.

## 문제

`sw.js` 의 `cacheNameFor` 에 `/data/lectionary/` 분기가 없어 전례 JSON 11건이 `SHELL_CACHE` 로 떨어진다. 그런데 `manifest-sync.js` 는 낡은 항목을 **DATA_CACHE 에서만** 지운다.

```js
_invalidateCache(DATA_CACHE, stale)   // manifest-sync.js
```

그래서 데이터 저장소가 해시를 바꿔도 `SHELL_CACHE` 에 앉은 바이트는 살아남는다. 다음 릴리스가 셸을 통째로 갈 때까지 **낡은 전례 데이터가 그대로 남는다** — ADR-021 무효화 기제가 이 11건에만 적용되지 않고 있었다.

데이터 쪽은 진작 끝나 있었다. `bible-manifest.json` 이 이미 `lectionary/*.json` 11건을 해시로 추적한다(`canticles` · `commons` · `eucharist-collects` · `eucharist-readings` · `kasi-lunar` · `local-observances` · `ordinal-weeks` · `periods` · `sanctoral` · `search-lectionary` · `temporal-feasts`). 앱 라우팅 한 줄만 빠졌다.

## 한 줄로 끝내지 않은 이유

같은 결함이 **조용히 재발하는 구조**다 — 데이터 저장소가 새 디렉터리를 매니페스트에 넣어도, 앱이 `cacheNameFor` 를 안 고치면 아무도 모른다. 캐시에 잘못 들어가는 것은 화면에 아무 증상도 내지 않는다.

그래서 경로를 나열해 확인하는 대신 **매니페스트가 추적하는 접두사 전부**가 `DATA_CACHE` 로 가는지 대조한다.

```
✔ cacheNameFor: 오디오·성서·전례 데이터가 각 캐시로 간다
✔ bible-manifest 가 추적하는 모든 접두사가 DATA_CACHE 로 라우팅된다
```

`cacheNameFor` 를 `CACHE_ROUTING` 마커 블록으로 감싸 ADR-013 하네스(vm)로 평가한다 — `sw.js` 는 top-level `importScripts` 때문에 통째로는 못 돌린다. 매니페스트 대조는 `data/` 가 비공개 서브모듈이라 공개 CI 에서 skip 되지만, **이유를 남기고** skip 한다(로컬·`sync-data.yml` 에서는 실제로 돈다).

**가드가 실제로 잡는지 확인했다** — 그 한 줄을 빼고 돌리면 `lectionary/` 를 지목하며 실패한다.

```
AssertionError: 매니페스트가 추적하는데 DATA_CACHE 로 안 가는 경로 —
해시가 바뀌어도 무효화되지 않는다: lectionary/
```

## 함께 정리한 것

- **ADR-037 §7** 에 이행 표시 + 경위
- **`docs/status.md` ADR-034 항목이 낡아 있었다** — 「2차 모듈 분할 **진행 중**」으로 적혀 있는데 실제로는 `bookmark.js` 3,578 → **589줄**(−84%)이고 `views-routing.js` 는 사라졌다(`routing.js`·`views.js` 등으로 분해). PR5c 보류만 남았다. status.md 가 「지금 무엇이 동작하는가」의 권위 출처라 고쳤다.

## 리뷰 중 발견해 함께 고친 것 — 같은 종류의 구멍이 하나 더 있었다

`bookmark.js` 가 ESM `import` 로 끌어오는 `bookmark-{tree,gestures,select,menu,verse-select}.js` 5개가 **`SHELL_FILES` 에 없었다.** 2026-06-11 2라운드 분할 때 `index.html` 에 태그를 안 달았고(import 로 충분하니) `sw.js` 도 같이 빠뜨렸다. 기존 패리티 가드는 `index.html` 의 `<script>` 태그만 대조하므로 태그 없는 모듈은 애초에 안 보였다.

증상이 잘 안 보여서 몰랐다. 하지만 **첫 방문에서는 그 import 가 SW 등록보다 먼저 로드돼 아무도 캐시하지 않는다** — 설치 직후 오프라인으로 열면 `bookmark.js` 는 캐시에서 오고 그 import 는 실패해 모듈 그래프째 깨진다(Copilot 지적으로 정확해진 부분). 두 번째 온라인 방문에서야 fetch 가 SW 를 거쳐 채워진다.

`SHELL_FILES` 에 넣고, `<script>` 태그에서 출발해 정적 import 닫힘 전체를 대조하는 불변식을 더했다.

```
✔ index.html 에서 ESM import 로 닿는 모든 모듈이 SHELL_FILES 에 있다
```

**이것도 빼고 돌려 확인했다** — 정확히 그 5개를 지목하며 실패한다.

## 검증

유닛 **830 통과**(신설 3), `npx tsc` 두 설정 모두 0 error. e2e **225 통과 / 0 실패**(2026-09-05 Playwright 실측, 5분 52초 — `test_a11y_axe.py` 7건은 선택적 의존성 미설치로 skip).
