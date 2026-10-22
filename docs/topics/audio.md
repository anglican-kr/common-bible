# 오디오

소유 코드: `js/app/audio-player.js`, `js/audio-cache.js`

장마다 mp3를 재생하는 플레이어와 오디오 캐시를 다룬다. mp3는 `common-bible-audio` 저장소(Git LFS)에 있다.

## 지금 동작

- **장마다 mp3를 재생하고, 재생한 파일을 캐시에 둔다.** Phase 1(2026-05)에 완성됐다. 캐시는 300 MB까지 두고 오래 재생하지 않은 것부터 지운다(ADR-016).

## 결정

- ADR-016 「오디오 캐시 LRU 관리」

## 함정

### pitfalls §15 — Cache API와 IDB 사이드카가 어긋나고, 크기를 Content-Length에 기댄다

Cache API는 접근 시각과 바이트 크기를 알려 주지 않는다. 그래서 LRU와 쿼터 추적은 IndexedDB 사이드카에 따로 둔다(ADR-016). 그런데 두 저장소가 따로 있어서, 한쪽만 갱신되거나 사라지면 추적이 영영 어긋난다. 또 byteSize를 Content-Length 헤더로 적으면 chunked 전송, gzip, Range 응답에서 0이 들어가 LRU 상한이 사실상 듣지 않는다.

**사례**(2차 보안 감사 `docs/archive/audit/2026-05-08-second-comprehensive.md`의 H1, H2, H3):

- **H1**: `sw.js:139`가 `byteSize = cl ? Number(cl) : 0`로 적었다. Content-Length가 없으면 0을 적어 totalSize 합에서 빠진다. 그러면 HARD_CAP에 닿았다는 신호를 받지 못해 Cache API에 끝없이 쌓이고, origin 단위 쿼터를 넘으면 DATA_CACHE까지 밀려난다.
- **H2**: `_putAudioAndEnforceCap`이 두 fetch에서 동시에 돌면, `pickEvictions`가 방금 넣은 url을 지울 대상에 넣어 재생 중인 mp3를 지운다.
- **H3**: `cache.put`이 성공한 뒤 `recordEntry`가 실패하면, Cache에는 mp3가 있고 IDB에는 메타가 없는 항목이 영영 쌓인다. DevTools에서 한쪽만 비워도 같다.

**규칙:**

- **byteSize는 Content-Length를 먼저 쓰고, 값이 없거나 잘못되면 `response.clone().blob().size`로 대신한다.** 1회 더 읽는 비용이 LRU가 틀리는 손실보다 언제나 작다. clone()은 본문을 읽기 전, 곧 `cache.put` 전에 한다.
- **받고 있는 URL을 추적한다.** 모듈 수준의 `Set`에 시작할 때 넣고, 끝날 때 finally에서 뺀다. 지울 대상을 고를 때 이 Set에 든 것은 뺀다. 받고 있는 항목이 다른 호출의 상한 정리에 휘말리지 않게 하려는 것이다.
- **두 저장소를 맞춘다.** SW `activate` 핸들러에서 `cache.keys()`와 IDB 항목을 양쪽으로 견준다. Cache에 있고 IDB에 없는 항목은 recordEntry로 채운다(byteSize는 blob.size). IDB에 있고 Cache에 없는 항목은 남은 기록이므로 removeEntries로 지운다. 비용은 어긋난 수에 비례하고, 어긋남이 없으면 마이크로초 수준이다.
- **회귀를 막는 테스트**: 처리량 테스트만으로는 부족하다. (i) Content-Length가 없는 응답, (ii) 상한을 넘는 fetch가 동시에 도는 경우, (iii) IDB와 Cache 가운데 한쪽을 비운 경우를 따로 다루는 케이스가 필요하다.

## 남은 일

없음
