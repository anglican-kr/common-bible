# ADR-016: 오디오 캐시 LRU 관리 (300 MB cap, 재생 시점 기준)

- 일시: 2026-05-07
- 상태: 승인됨 — 적용 완료 (`js/audio-cache.js`, IDB sidecar + LRU 운영 중)
- 관련 ADR: ADR-001(SPA + 캐시 분리), ADR-015(클라이언트 스토리지 전략)

## 결정

`AUDIO_CACHE`(ADR-001)에 **300 MB hard cap + 마지막 재생 시점 기준 LRU**를 도입한다.

오디오 메타(`{url, byteSize, lastPlayedAt, addedAt}`)는 IndexedDB에 별도 저장하고, `<audio>` 요소의 `play` 이벤트에서 `lastPlayedAt`을 갱신한다. 캐시가 cap을 초과하면 `lastPlayedAt`이 가장 오래된 (null 우선) 항목부터 evict한다.

## 맥락

ADR-001 2026-05-07 개정으로 SW 캐시가 셸/데이터/오디오/폰트 4개로 분리되어, 셸 릴리스마다 사용자 누적 오디오가 통째로 삭제되던 문제는 해결됐다. 그러나 분리만으로는 다음이 남아 있다.

### 1. 오디오는 사실상 무제한 누적

73권 × 1328장 × 평균 4.89 MB ≈ **6.5 GB**. 사용자가 들은 장이 모두 영구 보존되면 origin quota를 잠식한다.

| 환경 | origin quota (대략) | 6.5 GB가 차지 |
| --- | --- | --- |
| Chrome / Edge | 디스크의 ~60%, 보통 수십 GB | 여유 |
| Firefox | origin당 10 GB cap | 65% |
| Safari (macOS) | 초기 ~1 GB, 초과 시 사용자 prompt | prompt 빈발 |
| **iOS Safari (브라우저)** | **~1 GB, 7일 미사용 시 evict** | **불가** |
| iOS PWA (홈 화면) + persist | ~1 GB, evict 면제 | 여전히 quota 초과 |

iOS가 가장 빡빡한 bottleneck.

### 2. 브라우저 evict는 텍스트도 함께 잃을 수 있음

quota 압박 시 브라우저 evict는 origin 단위로 동작하며, AUDIO만 골라 비우지 않는다. 오디오로 quota를 채우면 본문 JSON 캐시(`DATA_CACHE`)까지 함께 evict될 수 있어, 오프라인 사용자가 갑자기 본문도 못 보는 상황이 발생한다.

### 3. "임시 vs 영구"의 구현 부재

오디오는 한 번 들은 후 다시 들을 가능성이 떨어지는 휘발성에 가깝고, 본문 JSON은 콘텐츠가 바뀔 때까지 유지하는 게 자연스럽다. ADR-001은 이 차이를 라이프사이클 분리(릴리스 bump 독립)로만 표현했고, 오디오 측 자체 정리(self-eviction) 정책은 없었다.

## 검토한 대안

### A. cap 후보값

평균 파일 크기 4.89 MB 기준:

| cap | 장 수 | 무엇이 들어가나 | 채택? |
| --- | --- | --- | --- |
| 100 MB | ~20 | 한 권의 절반 | 빡빡 |
| **300 MB** | **~61** | **단권 책 1-2개** | **채택** |
| 500 MB | ~102 | 4복음서 통째 | iOS quota 50% 부담 |
| 1 GB | ~204 | 신약 절반 | iOS quota 전체 |

300 MB는 iOS quota(~1 GB)의 30% 수준. DATA_CACHE(~6 MB) + 셸 + 폰트 + Drive sync IDB와 합쳐도 quota에 여유. 미사 낭독·매일 시편 같은 대표 사용 시나리오는 cap 안에 들어오고, 4복음서 전체나 신약 1독 같은 큰 묶음은 LRU churn으로 처리한다.

### B. LRU 기준 시각

| 옵션 | 의미 | 채택? |
| --- | --- | --- |
| fetch 시점 (cache put) | 캐시에 처음 들어간 순간 | 미채택 |
| **재생 시점 (`<audio>` play)** | **사용자가 실제로 들은 순간** | **채택** |
| 마지막 접근 (cache match) | preload 포함 모든 read | 미채택 |

fetch 시점은 prefetch가 들어오면 모든 prefetch가 "최근"으로 찍혀 LRU 신호가 망가진다. 모든 cache match는 `<audio preload="metadata">`처럼 실제 재생 의도가 없는 접근까지 포함해 노이즈가 크다. 재생 시점은 "사용자가 의도적으로 들은 장"을 정확히 표현한다.

### C. 메타 저장소

| 옵션 | 채택? |
| --- | --- |
| Cache API 자체 | 미채택 — access time 노출 안 됨 |
| `localStorage` | 미채택 — 동기 I/O, 5-10 MB 한도, SW에서 접근 불가 |
| **IndexedDB** | **채택** |

### D. fetch는 됐지만 안 들은 파일의 우선순위

| 옵션 | 의미 | 채택? |
| --- | --- | --- |
| **`lastPlayedAt = null`을 가장 먼저 evict** | "받았지만 안 들은 건 최우선 폐기" | **채택** |
| fetch 시점을 임시 `lastPlayedAt`으로 사용 | 최근 fetch면 살아남음 | 미채택 — prefetch 노이즈 재발 |

prefetch나 preload로 들어왔지만 실제로 듣지 않은 파일은 LRU 측면에서 가치가 가장 낮다. 이 정책은 prefetch를 적극 추가해도 진짜 들은 장을 보호한다.

### E. 정리 트리거

| 옵션 | 장단점 |
| --- | --- |
| 매 cache put 직후 SW 정리 | fetch 핸들러에서 IDB 트랜잭션 — 첫 재생 지연 가능 |
| **idle 시점 클라이언트 정리 (soft + hard cap)** | cap 살짝 초과 허용, 페이지 idle에 일괄 |

**채택**: soft cap 300 MB / hard cap 360 MB. SW fetch 핸들러는 hard cap만 검사하고, soft cap 미만으로 줄이는 정리는 `requestIdleCallback` 또는 `visibilitychange`('hidden') 시점에 일괄 수행한다.

### F. `navigator.storage.persist()` 호출 시점

origin 전체 persist는 brower evict를 면제(특히 iOS 7일 룰 회피). 단, prompt가 뜰 수 있어 시점 선택이 중요.

| 시점 | 채택? |
| --- | --- |
| 앱 첫 로드 시 즉시 | 미채택 — 가치 인식 전 |
| **북마크 추가 / Drive 첫 로그인 / 첫 오프라인 재생** | **채택** |
| 호출 안 함 | 미채택 — iOS 7일 evict 노출 |

가치 시점에 호출하면 prompt 수락률이 높고, 거부돼도 LRU 자체는 동작한다.

## 결정 상세

### D1. 메타 스키마

IndexedDB DB 이름 `bible-audio-cache` (`bible-*` 컨벤션 일치), 단일 object store `entries`:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `url` (key) | `string` | `/data/audio/{book_id}-{chapter}.mp3` |
| `byteSize` | `number` | `Response.headers.get("content-length")` 또는 `Blob.size` |
| `lastPlayedAt` | `number \| null` | epoch ms. 미재생이면 null |
| `addedAt` | `number` | epoch ms. 캐시 진입 시각 (디버그·통계용, evict 결정엔 미사용) |

인덱스: `lastPlayedAt`. evict 시 null 우선 → 그 다음 오름차순 스캔.

### D2. 상수

```js
const AUDIO_CACHE_SOFT_CAP = 300 * 1024 * 1024; // 300 MB
const AUDIO_CACHE_HARD_CAP = 360 * 1024 * 1024; // 360 MB
```

### D3. 라이프사이클

1. **fetch**: SW가 `/data/audio/*.mp3`를 받으면 `AUDIO_CACHE`에 put + `entries`에 `{url, byteSize, lastPlayedAt: null, addedAt: now}` upsert. byteSize는 응답 헤더 또는 blob에서 추출.
2. **재생**: 메인 스레드 `<audio>`의 `play` 이벤트 핸들러가 `entries`의 `lastPlayedAt`을 `Date.now()`로 갱신.
3. **soft cap 정리**: `requestIdleCallback`(없으면 `setTimeout(_, 1000)`) 또는 `visibilitychange`('hidden') 시점에 클라이언트가 총 `byteSize` 합산. `> 300 MB`이면 `lastPlayedAt` 오름차순(null 우선)으로 정리해 `≤ 300 MB`까지 줄인다.
4. **hard cap 차단**: SW fetch 핸들러에서 새 오디오 put 후 합산. `> 360 MB`이면 같은 정렬 기준으로 즉시 정리 (트랜잭션 1회).
5. **persist 시도**: 북마크 추가, Drive 첫 로그인, 첫 오프라인 재생 중 가장 빠른 시점에 `navigator.storage.persist()` 호출. 결과는 디버그 로그에만 기록(에러 무시).

### D4. evicted 후 오프라인 재생

사용자가 LRU로 evict된 장을 오프라인에서 재생하려 하면 fetch가 실패한다. 기존 오디오 에러 핸들러가 처리하되, 메시지에 "이 장은 오프라인 캐시에서 정리되었습니다. 온라인 상태에서 다시 들으면 자동 저장됩니다." 류 안내를 추가한다.

### D5. 디버그

`debug-log.js` ring buffer에 `audio-evict` 이벤트(삭제된 url 수, 사유: soft/hard, 정리 후 총 크기)를 기록한다. 사용자 설정 페이지의 "오디오 캐시 X / 300 MB" 통계 UI는 v2(필요 시)로 미룬다.

## 근거

1. **300 MB hard cap**: iOS Safari quota(~1 GB)의 30%, 다른 캐시(데이터 6 MB·셸·폰트·Drive IDB)와 합쳐 quota에 여유. 평균 4.89 MB × 61장 = 단권 책 1-2개를 핫 캐시로 보존.
2. **재생 시점 LRU**: prefetch·preload·`preload="metadata"` 같은 자동 트래픽이 LRU 신호를 오염시키지 않음. "들은 장을 보호한다"는 의도와 일치.
3. **soft/hard cap 분리**: SW fetch 핸들러를 가볍게 유지(hard cap만 검사). 평소 정리는 페이지 idle에 일괄.
4. **null `lastPlayedAt` 우선 evict**: prefetch를 적극 추가해도 LRU 안전성 유지.
5. **IDB 별도 메타**: Cache API는 access time을 노출하지 않으므로 외부 메타 필수. SW·페이지 양쪽 접근 가능.
6. **persist 가치 시점 호출**: 첫 로드 prompt는 거부율이 높음. 사용자가 앱에 가치를 느낀 시점이 수락률 최고.

## 영향 범위

| 파일 | 변경 |
| --- | --- |
| `sw.js` | `/data/audio/*` fetch 핸들러에서 hard cap 검사 + 메타 IDB upsert |
| `js/app.js` | `<audio>` `play` 이벤트에서 `lastPlayedAt` 갱신, idle 시 soft cap 정리, persist 호출 시점 |
| `js/audio-cache.js` (신규) | IDB open/upsert/evict/scan 모듈, SW·페이지 공용 |
| `js/types.d.ts` | `AudioCacheEntry` 타입 추가 |
| `tests/unit/audio-cache.test.js` (신규) | LRU 정렬, null 우선, hard/soft cap, byte 합산 회귀 |
| `docs/decisions/001-spa-architecture.md` | "오디오 — `AUDIO_CACHE`" 섹션에 ADR-016 cross-reference |

## 참고

- ADR-001 SPA 아키텍처 (캐시 분리, 2026-05-07 개정)
- ADR-013 클라이언트 JS 유닛 테스트 (vm 하네스 패턴)
- W3C Storage API: `navigator.storage.persist()` / `estimate()`
- WebKit "Storage Quota Limits" (iOS 7일 evict)
