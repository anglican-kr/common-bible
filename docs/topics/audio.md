# 오디오

소유 코드: `js/app/audio-player.js`, `js/audio-cache.js`

장마다 mp3를 재생하는 플레이어와 오디오 캐시를 다룬다. mp3는 `common-bible-audio` 저장소(Git LFS)에 있다.

## 지금 동작

- **장마다 mp3를 재생하고, 재생한 파일을 캐시에 둔다.** Phase 1(2026-05)에 완성됐다. 캐시는 300 MB까지 두고 오래 재생하지 않은 것부터 지운다(ADR-016).

## 결정

- ADR-016 「오디오 캐시 LRU 관리」

## 함정

### pitfalls §15 — Cache API ↔ IDB sidecar 불일치 + Content-Length 의존

Cache API는 access-time / byte-size 메타데이터를 노출하지 않으므로 LRU·쿼터 추적은 IndexedDB sidecar에 별도 보관하는 패턴이 자연스럽다 (ADR-016). 그러나 두 store가 독립 존재이므로 한쪽만 갱신·소실되면 추적이 영구 어긋난다. 또 Content-Length 헤더에 의존해 byteSize를 기록하면 chunked transfer / gzip / Range 응답에서 0이 들어가 LRU cap이 사실상 무력화된다.

**사례 (2차 보안 감사 — `docs/archive/audit/2026-05-08-second-comprehensive.md` H1·H2·H3):**

- **H1** — `sw.js:139` `byteSize = cl ? Number(cl) : 0`. Content-Length 누락 시 0 기록 → totalSize 합산에서 빠짐 → HARD_CAP 도달 신호 못 받음 → Cache API 무한 누적 → origin-단위 quota 초과 시 DATA_CACHE까지 evict.
- **H2** — `_putAudioAndEnforceCap`이 두 fetch에서 동시 진행되면 `pickEvictions` 결과가 방금 put된 url을 evict 대상에 포함시켜 재생 중 mp3 삭제.
- **H3** — `cache.put` 성공 후 `recordEntry` 실패하면 Cache에 mp3는 있고 IDB 메타는 없는 상태로 영구 누적. DevTools에서 한쪽만 비워도 같은 결과.

**규칙:**

- **byteSize는 Content-Length를 우선하되 무효 시 `response.clone().blob().size`로 폴백한다.** 추가 read 1회 비용을 받아들이는 것이 LRU 정확성 손실보다 항상 낫다. clone()은 `cache.put` 전에 (body 소비 전에) 해야 한다.
- **동시 in-flight URL 추적**: 모듈 레벨 `Set`에 진입 시 add, 종료 시 finally에서 delete. eviction은 이 Set을 filter out — 진행 중 항목이 다른 호출의 cap 정리에 휘말리지 않게.
- **양 store reconcile**: SW `activate` 핸들러에서 `cache.keys()`와 IDB entries 양방향 비교. (a) Cache에 있고 IDB에 없는 항목 → recordEntry로 채움 (byteSize는 blob.size로). (b) IDB에 있고 Cache에 없는 항목 → orphan removeEntries. 비용은 mismatch 수에 비례하며 healthy 상태에선 microsecond.
- **회귀 방어**: 단순 throughput 테스트 외에 (i) Content-Length 누락 응답 (ii) 동시 cap 초과 fetch (iii) IDB·Cache 한쪽 비움 시나리오를 명시적으로 다루는 테스트 케이스 필요.

## 남은 일

없음
