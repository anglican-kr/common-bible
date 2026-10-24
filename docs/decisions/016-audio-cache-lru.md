# ADR-016: 오디오 캐시 LRU 관리 (300 MB 상한, 재생 시점 기준)

- 일시: 2026-05-07
- 상태: 승인됨 — 적용 완료 (`js/audio-cache.js`가 IDB sidecar와 LRU를 운영한다)
- 관련 ADR: ADR-001(SPA와 캐시 분리), ADR-015(클라이언트 스토리지 전략), ADR-021(콘텐츠 해시 매니페스트)

## 결정

오디오 캐시(`AUDIO_CACHE`, ADR-001)에 **300 MB 상한을 두고, 마지막으로 재생한 때가 가장 오래된 파일부터 지운다**. 가장 오래 쓰지 않은 것부터 지우는 이 방식을 LRU(Least Recently Used)라고 부른다.

파일마다 메타(`{url, byteSize, lastPlayedAt, addedAt}`)를 IndexedDB에 따로 적는다. `<audio>` 요소에서 `play` 이벤트가 일어나면 `lastPlayedAt`을 그때로 고친다. 캐시가 상한을 넘으면 `lastPlayedAt`이 가장 오래된 파일부터 지운다. 한 번도 재생하지 않아 값이 null인 파일을 먼저 지운다.

캐시 이름은 `"audio"`로 고정한다(2026-05-13, ADR-021). mp3 내용이 바뀌면 캐시 이름을 올리지 않고, 데이터 저장소 CI가 만드는 `audio-manifest.json`을 `js/manifest-sync.js`가 직전 스냅샷과 견줘 바뀐 파일만 지운다. 이때 `js/manifest-sync.js`는 캐시에서 지운 파일의 메타 행도 `ac.removeEntries(urls)`로 함께 지운다. 그러지 않으면 메타에 남은 크기가 합계(totalSize)에 계속 들어가 실제 캐시 크기와 어긋난다. 메타 스키마(`{url, byteSize, addedAt, lastPlayedAt}`)는 바뀌지 않았다.

## 맥락

ADR-001의 캐시 분리(2026-05-07)로 서비스 워커 캐시가 셸, 데이터, 오디오, 폰트의 넷으로 나뉘었다. 그래서 셸을 릴리스할 때마다 사용자가 모아 둔 오디오가 통째로 지워지던 문제는 해결됐다. 그러나 나누기만 해서는 아래 세 문제가 남는다.

### 1. 오디오가 끝없이 쌓인다

73권 × 1328장 × 평균 4.89 MB ≈ **6.5 GB**다. 사용자가 들은 장을 모두 계속 남겨 두면, 브라우저가 이 사이트에 허락한 저장 공간(origin quota)을 오디오가 차지해 간다.

| 환경 | origin quota (대략) | 6.5 GB가 차지하는 비율 |
| --- | --- | --- |
| Chrome / Edge | 디스크의 ~60%, 보통 수십 GB | 여유 |
| Firefox | origin당 10 GB 상한 | 65% |
| Safari (macOS) | 처음 ~1 GB, 넘으면 사용자에게 묻는 창 | 묻는 창이 자주 뜬다 |
| **iOS Safari (브라우저)** | **~1 GB, 7일 쓰지 않으면 브라우저가 캐시를 비움** | **담을 수 없다** |
| iOS PWA (홈 화면) + persist | ~1 GB, 브라우저가 캐시를 비우지 않음 | 그래도 quota를 넘는다 |

iOS가 가장 빠듯한 환경이다.

### 2. 브라우저가 캐시를 비울 때 본문도 함께 잃을 수 있다

저장 공간이 모자라면 브라우저는 사이트 저장소를 origin 단위로 비운다. 오디오만 골라 지우지 않는다. 오디오가 quota를 채우면 본문 JSON 캐시(`DATA_CACHE`)까지 함께 지워질 수 있다. 그러면 오프라인 사용자가 갑자기 본문도 볼 수 없게 된다.

### 3. 「잠시 두는 것」과 「계속 두는 것」을 구분해 다루지 않았다

오디오는 한 번 들은 뒤 다시 들을 가능성이 낮아 잠시 두는 것에 가깝다. 본문 JSON은 내용이 바뀔 때까지 계속 두는 것이 자연스럽다. ADR-001은 이 차이를 수명 분리(릴리스 때 따로 올리기)로만 다뤘고, 오디오가 스스로 정리하는 정책은 없었다.

## 검토한 대안

### A. 상한 후보값

평균 파일 크기 4.89 MB를 기준으로 했다.

| 상한 | 장 수 | 무엇이 들어가나 | 채택 여부 |
| --- | --- | --- | --- |
| 100 MB | ~20 | 한 권의 절반 | 너무 빠듯하다 |
| **300 MB** | **~61** | **단권 책 1-2개** | **채택** |
| 500 MB | ~102 | 4복음서 전체 | iOS quota의 50%를 차지한다 |
| 1 GB | ~204 | 신약 절반 | iOS quota 전체를 차지한다 |

300 MB는 iOS quota(약 1 GB)의 30% 수준이다. DATA_CACHE(약 6 MB), 셸, 폰트, Drive 동기화 IDB를 더해도 quota에 여유가 있다. 미사 낭독이나 매일 시편 같은 흔한 사용은 상한 안에 들어간다. 4복음서 전체나 신약 통독처럼 큰 묶음은 LRU로 오래된 파일을 지우고 새 파일을 받으며 처리한다.

### B. LRU의 기준 시각

| 선택지 | 뜻 | 채택 여부 |
| --- | --- | --- |
| 받은 때 (cache put) | 캐시에 처음 들어간 순간 | 채택 안 함 |
| **재생한 때 (`<audio>` play)** | **사용자가 실제로 들은 순간** | **채택** |
| 마지막으로 읽은 때 (cache match) | 미리 받기(preload)를 포함한 모든 읽기 | 채택 안 함 |

받은 때를 기준으로 하면, 미리 받기(prefetch)를 더했을 때 미리 받은 파일이 모두 「최근」으로 찍혀 LRU가 제 역할을 못 한다. 모든 cache match를 기준으로 하면, `<audio preload="metadata">`처럼 재생할 뜻이 없는 읽기까지 섞여 신호가 흐려진다. 재생한 때는 「사용자가 일부러 들은 장」을 정확히 나타낸다.

### C. 메타를 둘 곳

| 선택지 | 채택 여부 |
| --- | --- |
| Cache API 자체 | 채택 안 함 — 마지막으로 읽은 때를 알려 주지 않는다 |
| `localStorage` | 채택 안 함 — 동기 I/O이고, 5-10 MB 한도가 있으며, 서비스 워커에서 접근할 수 없다 |
| **IndexedDB** | **채택** |

### D. 받았지만 듣지 않은 파일의 순서

| 선택지 | 뜻 | 채택 여부 |
| --- | --- | --- |
| **`lastPlayedAt = null`인 파일을 가장 먼저 지운다** | 받았지만 듣지 않은 파일을 먼저 버린다 | **채택** |
| 받은 때를 임시 `lastPlayedAt`으로 쓴다 | 최근에 받은 파일은 남는다 | 채택 안 함 — 미리 받기가 신호를 흐리는 문제가 다시 생긴다 |

prefetch나 preload로 들어왔지만 실제로 듣지 않은 파일은 남겨 둘 가치가 가장 낮다. 이 정책 덕분에 미리 받기를 적극적으로 더해도 실제로 들은 장은 보호된다.

### E. 정리하는 때

| 선택지 | 장단점 |
| --- | --- |
| 캐시에 넣을 때마다 서비스 워커가 정리 | fetch 핸들러 안에서 IDB 트랜잭션이 돌아 첫 재생이 늦어질 수 있다 |
| **페이지가 한가할 때 클라이언트가 정리 (두 단계 상한)** | 상한을 조금 넘는 것을 허용하고, 한가할 때 한꺼번에 정리한다 |

**채택**: 정리 목표인 상한(soft cap)은 300 MB, 바로 정리하는 상한(hard cap)은 360 MB로 둔다. 서비스 워커의 fetch 핸들러는 360 MB만 확인한다. 300 MB 아래로 줄이는 정리는 `requestIdleCallback`이 호출할 때나 `visibilitychange`('hidden') 때 한꺼번에 하기로 했다. 지금 구현은 페이지가 가려질 때(`visibilitychange`가 'hidden'일 때)만 정리한다(`js/app.js`의 `_enforceAudioSoftCap`).

### F. `navigator.storage.persist()`를 호출하는 때

origin 전체에 persist를 얻으면 브라우저가 저장소를 비우지 않는다. 특히 iOS의 7일 규칙을 피할 수 있다. 다만 사용자에게 묻는 창이 뜰 수 있어 호출하는 때가 중요하다.

| 호출하는 때 | 채택 여부 |
| --- | --- |
| 앱을 처음 열 때 바로 | 채택 안 함 — 사용자가 앱의 쓸모를 알기 전이다 |
| **북마크 추가, Drive 첫 로그인, 첫 오프라인 재생** | **채택** |
| 호출하지 않는다 | 채택 안 함 — iOS가 7일 뒤 캐시를 비우는 데 그대로 노출된다 |

쓸모를 느낀 때에 호출하면 사용자가 허락할 가능성이 높다. 거부돼도 LRU는 그대로 작동한다. 지금 구현은 처음 재생할 때와 북마크를 저장할 때 한 번만 요청한다(`js/app/storage.js`의 `_maybeRequestPersist`). Drive 첫 로그인에서는 호출하지 않는다.

### G. 캐시 이름을 올려 오디오를 무효화 (2026-05-13까지)

- 처음에는 캐시 이름을 `"audio-1"`로 두고, mp3를 다시 인코딩하면 이름을 올려 캐시 전체를 비웠다.
- 채택 안 함 2026-05-13 · 이유: ADR-021이 콘텐츠 해시 매니페스트로 바뀐 파일만 지우도록 바꿨다. 이름을 올리면 사용자가 들은 장까지 모두 지워진다.

## 결정 상세

### D1. 메타 스키마

IndexedDB DB 이름은 `bible-audio-cache`(`bible-*` 컨벤션)이고, object store는 `entries` 하나다.

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `url` (key) | `string` | `/data/audio/{book_id}-{chapter}.mp3` |
| `byteSize` | `number` | `Response.headers.get("content-length")` 또는 `Blob.size` |
| `lastPlayedAt` | `number \| null` | epoch ms. 재생하지 않았으면 null |
| `addedAt` | `number` | epoch ms. 캐시에 들어간 때. 디버그와 통계에 쓰고, 지울 순서에서는 재생하지 않은 파일끼리 순서를 정할 때만 쓴다 |

`lastPlayedAt`에 인덱스를 두기로 했지만, 구현은 인덱스 없이 정리할 때 모든 행을 읽어 정렬한다(`pickEvictions`). 순서는 null이 먼저이고, 그다음 `lastPlayedAt` 오름차순이다.

### D2. 상수

```js
const AUDIO_CACHE_SOFT_CAP = 300 * 1024 * 1024; // 300 MB
const AUDIO_CACHE_HARD_CAP = 360 * 1024 * 1024; // 360 MB
```

`js/audio-cache.js`에서는 `SOFT_CAP`과 `HARD_CAP`이라는 이름으로 내놓는다.

### D3. 수명

1. **받기**: 서비스 워커가 `/data/audio/*.mp3`를 받으면 `AUDIO_CACHE`에 넣고, `entries`에 `{url, byteSize, lastPlayedAt: null, addedAt: now}`를 넣거나 고친다. byteSize는 응답 헤더나 blob에서 얻는다.
2. **재생**: 메인 스레드의 `<audio>`에서 `play` 이벤트가 일어나면 핸들러가 `entries`의 `lastPlayedAt`을 `Date.now()`로 고친다.
3. **300 MB 정리**: `requestIdleCallback`(없으면 `setTimeout(_, 1000)`)이 호출할 때나 `visibilitychange`('hidden') 때, 클라이언트가 `byteSize`를 모두 더한다. `> 300 MB`이면 `lastPlayedAt` 오름차순(null 먼저)으로 지워 `≤ 300 MB`까지 줄인다. 지금 구현은 'hidden' 때만 정리한다(위 E).
4. **360 MB 차단**: 서비스 워커의 fetch 핸들러가 새 오디오를 넣은 뒤 합계를 낸다. `> 360 MB`이면 같은 순서로 바로 정리한다(트랜잭션 1회).
5. **persist 요청**: 북마크 추가, Drive 첫 로그인, 첫 오프라인 재생 가운데 가장 이른 때에 `navigator.storage.persist()`를 호출한다. 결과는 디버그 로그에만 적고, 오류는 무시한다. 지금 구현이 호출하는 때는 위 F에 적었다.

### D4. 지운 장을 오프라인에서 재생할 때

LRU로 지운 장을 오프라인에서 재생하려 하면 받기가 실패한다. 기존 오디오 오류 핸들러가 처리하되, 「이 장은 오프라인 캐시에서 정리되었습니다. 온라인 상태에서 다시 들으면 자동 저장됩니다.」 같은 안내를 더하기로 했다. 이 안내는 아직 넣지 않았다(known-issues §26). 지금은 재생이 실패하면 사유와 상관없이 「오디오 파일을 준비 중입니다.」를 보인다(`js/app/audio-player.js`의 `showAudioUnavailable`).

### D5. 디버그

`debug-log.js` ring buffer에 `audio-evict` 이벤트를 적는다. 지운 url 수, 사유(soft 또는 hard), 정리 뒤의 총 크기를 담기로 했다. 지금 구현은 페이지의 300 MB 정리만 적고, 담는 값은 지운 개수, 사유, 정리 전의 총 크기다. 서비스 워커의 360 MB 정리는 적지 않는다. 설정 화면에 「오디오 캐시 X / 300 MB」 통계를 보이는 일은 v2(필요할 때)로 미룬다.

## 근거

1. **300 MB 상한**: iOS Safari quota(약 1 GB)의 30%다. 다른 캐시(데이터 6 MB, 셸, 폰트, Drive IDB)를 더해도 quota에 여유가 있다. 평균 4.89 MB × 61장으로 단권 책 1-2개를 자주 쓰는 캐시로 둘 수 있다.
2. **재생 시점 LRU**: prefetch, preload, `preload="metadata"` 같은 자동 트래픽이 LRU 신호를 흐리지 않는다. 「들은 장을 보호한다」는 뜻에 맞다.
3. **두 단계 상한**: 서비스 워커의 fetch 핸들러를 가볍게 둔다(360 MB만 확인한다). 평소 정리는 페이지가 한가할 때 한꺼번에 한다.
4. **null `lastPlayedAt`을 먼저 지운다**: prefetch를 적극적으로 더해도 LRU가 안전하다.
5. **IDB에 메타를 따로 둔다**: Cache API는 마지막으로 읽은 때를 알려 주지 않으므로 바깥에 메타가 있어야 한다. 서비스 워커와 페이지가 모두 접근할 수 있다.
6. **쓸모를 느낀 때 persist를 호출한다**: 처음 열 때 묻는 창은 거부되기 쉽다. 사용자가 앱의 쓸모를 느낀 때에 허락할 가능성이 가장 높다.

## 영향 범위

적용할 때(2026-05-07) 바꾼 파일이다.

| 파일 | 변경 |
| --- | --- |
| `sw.js` | `/data/audio/*` fetch 핸들러에서 360 MB를 확인하고 메타를 IDB에 넣는다 |
| `js/app.js` | `<audio>` `play` 이벤트에서 `lastPlayedAt`을 고치고, 한가할 때 300 MB로 정리하고, persist를 호출한다 |
| `js/audio-cache.js` (신규) | IDB 열기, 넣기, 지울 파일 고르기, 훑기. 서비스 워커와 페이지가 함께 쓴다 |
| `js/types.d.ts` | `AudioCacheEntry` 타입 추가 |
| `tests/unit/audio-cache.test.js` (신규) | LRU 정렬, null 먼저, 두 상한, 크기 합산의 회귀 테스트 |
| `docs/decisions/001-spa-architecture.md` | 「오디오 — `AUDIO_CACHE`」 절에서 ADR-016을 가리킨다 |

그 뒤 모듈 분할(ADR-018)로 재생 기록은 `js/app/audio-player.js`, persist 요청은 `js/app/storage.js`로 옮겨 갔다. 300 MB 정리는 `js/app.js`에 남아 있다.

## 참고

- ADR-001 SPA 아키텍처 (캐시 분리, 2026-05-07)
- ADR-013 클라이언트 JS 유닛 테스트 (vm 하네스 방식)
- W3C Storage API: `navigator.storage.persist()` / `estimate()`
- WebKit 「Storage Quota Limits」 (iOS 7일 규칙)
