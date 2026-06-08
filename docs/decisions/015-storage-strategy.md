# ADR-015: 클라이언트 스토리지 전략

- 일시: 2026-05-07
- 상태: 승인됨 — 모든 키 운영 중 (`js/app/storage.js` + `js/sync/refresh-store.js` + `js/audio-cache.js` 시점 적용)
- 관련 ADR: ADR-010(북마크), ADR-011(북마크 동기화 / Phase 2h PKCE), ADR-014(검색 히스토리)

## 결정

브라우저가 제공하는 스토리지 메커니즘을 **목적별로 분리해 사용**한다. 메커니즘마다 두는 데이터 종류와 두지 않는 데이터 종류를 명문화하고, 모든 키는 `bible-*` 접두사 컨벤션을 따른다.

| 메커니즘 | 용도 | 두지 않는 것 |
| --- | --- | --- |
| **localStorage** | 사용자 설정, 동기화 메타·세션 플래그, 동기 접근이 필요한 작은 KV (북마크 v2 doc 포함) | 자격 증명(access/refresh token), 암호 키, 대용량 바이너리 |
| **sessionStorage** | OAuth PKCE 콜백의 일회성 상태 (탭 수명 + 단일 사용 후 즉시 폐기) | 영구 데이터, 설정, 사용자 콘텐츠 |
| **IndexedDB** | 비공개 자격 증명과 그 암호 키 (`extractable: false` AES-GCM CryptoKey + 암호화된 OAuth refresh token) | 사용자 설정, 북마크, 검색 히스토리 같은 평범한 KV |
| **Cache API (Service Worker)** | 정적 자산·콘텐츠 (앱 셸, 성경 JSON, 오디오, 폰트). `shell-*` / `data-*` / `audio-*` / `fonts-*` 4개 캐시로 분리, 식별자별 독립 bump | 사용자 데이터·자격 증명 |
| **Cookies** | 사용 안 함 | — |

## 맥락

Phase 1에서는 모든 클라이언트 상태를 `localStorage`에만 두었다. ADR-010(북마크 v1)·ADR-014(검색 히스토리)가 그 가정 위에서 결정되었고, 사용자 콘텐츠·설정·UI 플래그가 모두 같은 KV에 섞여 있었다.

Phase 2 진행 중 두 번 그 가정이 깨졌다.

1. **Phase 2c**: 북마크를 per-record mtime + tombstone 머지 모델(`store-v2.js`)로 옮기면서 단일 키(`bible-bookmarks-v2`)에 도큐먼트 형태(JSON blob)를 통째로 직렬화. 양은 늘었지만 여전히 동기 접근이 필요해 `localStorage` 안에 머물렀다.
2. **Phase 2h (PKCE 마이그레이션)**: refresh token을 디스크에 영구 저장해야 cold-start silent refresh가 가능한데, 평문 KV(localStorage)에 두는 것은 받아들일 수 없다. AES-GCM `CryptoKey`(`extractable: false`)는 직렬화 자체가 불가능하므로 KV에 둘 수도 없다. 결과적으로 `js/sync/refresh-store.js`가 IndexedDB(`bible-drive-sync` DB, `keys`/`tokens` store)를 도입했다 — 이 프로젝트 최초의 IDB 사용처.

이 시점에서 우리가 사용하는 클라이언트 스토리지 메커니즘이 **4종 + 쿠키 미사용**으로 늘었지만, 어떤 데이터를 어디에 둘지에 대한 단일 기준 문서가 없었다. 새로운 키를 추가할 때마다 임의 결정이 누적되면 (a) 보안 등급이 다른 데이터가 같은 메커니즘에 섞이고, (b) 같은 데이터가 두 곳에 중복 저장되는 회귀가 생긴다. 이 ADR은 이미 내려진 결정을 사후 명문화하면서 앞으로의 추가에 적용할 분류 기준을 정한다.

## 검토한 대안

### A. 모두 localStorage로 통일 (기각)

- 장점: 단일 동기 API, 추가 의존성 없음
- 단점:
  - **OAuth refresh token을 평문으로 두게 됨.** 임의 스크립트(서드파티 분석 도구, 향후 추가될 라이브러리, 또는 XSS 시) `localStorage.getItem('bible-drive-refresh')` 한 줄로 추출 가능. 침해 시 토큰을 무효화할 방법은 사용자가 Google에서 직접 revoke하는 것뿐
  - **AES-GCM `CryptoKey`(`extractable: false`)는 직렬화 자체가 불가능**. localStorage는 string KV이므로 키를 풀어 평문화하지 않는 한 저장할 수 없는데, 그건 위 문제의 정의를 부정하는 것
  - 5–10 MB origin 한도. 향후 절 노트·하이라이트가 늘면 한도 부족

### B. 모두 IndexedDB로 통일 (기각)

- 장점: 트랜잭션, 인덱스, 한도 큼, 구조화 클론으로 `CryptoKey`까지 자연 저장
- 단점:
  - **모든 접근이 비동기**. 현재 `app.js`는 첫 페인트 직전에 `getLastRead()`/`getStartupBehavior()`/색상 스킴 등을 동기적으로 읽어 라우팅·테마를 결정한다. IDB로 옮기면 이 경로가 모두 비동기화되어 첫 페인트가 한 틱 늦어지거나, 비동기 hydrate를 위한 로딩 스플래시 단계가 새로 필요해진다 — ADR-007(스플래시) 가정 변경
  - **ADR-013 vm 하네스 부담 증가**. `localStorage` 모킹은 `Map` 한 줄이면 끝나지만, IDB를 vm에서 모킹하려면 `fake-indexeddb` 같은 패키지 의존성이 필요해 ADR-013의 "의존성 0" 원칙과 충돌
  - 작은 KV(`bible-startup`, `bible-font-size`)에는 과도한 복잡도

### C. 메커니즘별 책임 분리 (채택)

- 보안 등급(자격 증명 vs 일반)과 접근 패턴(동기 KV vs 비동기 구조화)을 축으로 분리
- 이미 Phase 2h에서 사실상 이 형태로 정착했으므로 새 코드 변경은 없고 기준만 명문화

### 보조 결정 — 쿠키 미사용

- OAuth는 **PKCE redirect + 토큰 응답 본문**으로 끝나며 서드파티 쿠키에 의존하지 않는다 (Phase 2h 단계 4 결정).
- 자체 백엔드가 없어 세션 쿠키도 불필요.
- 즉, `document.cookie` 사용은 ADR-015 위반으로 간주한다.

## 결정 상세

### D1. localStorage 카탈로그

키 네이밍: `bible-*` 접두사 필수. 같은 origin에 다른 PWA가 등장해도 충돌 없게.

**그룹 1 — 설정 (Drive 동기화 대상, `syncStoreV2.saveSetting` 경유)**

| 키 | 형식 | 정의 위치 |
| --- | --- | --- |
| `bible-startup` | `"resume" \| "home"` | ADR-010, `js/app.js` |
| `bible-font-size` | `"1"`–`"7"` | `js/app.js` |
| `bible-color-scheme` | `"light" \| "dark" \| "auto"` | `js/app.js` |
| `bible-theme` | 테마 이름 string | `js/app.js` |
| `bible-book-order` | JSON `string[]` | `js/app.js` |

**그룹 2 — 로컬 전용 사용자 콘텐츠/플래그 (Drive 미동기화)**

| 키 | 형식 | 비고 |
| --- | --- | --- |
| `bible-last-read` | JSON `{bookId, chapter, articleId}` | 이어읽기 배너 (디바이스별 행동) |
| `bible-audio-pos` | JSON `{bookId, chapter, time}` | 오디오 재생 위치 (디바이스별·휘발성) |
| `bible-search-history` | JSON `string[]` (LRU 30) | ADR-014 — 행동 데이터 프라이버시 |
| `bible-install-nudge` | JSON `{dismissed?, timestamp?}` | PWA 설치 안내 (디바이스별) |

**그룹 3 — 북마크 v2 도큐먼트**

| 키 | 형식 | 비고 |
| --- | --- | --- |
| `bible-bookmarks-v2` | JSON `SyncDoc` (per-record mtime + tombstone) | ADR-011 Phase 2c. 동기 접근 필요(드로어 첫 렌더), 머지 단위로 직렬화 |
| `bible-bookmarks` | (legacy v1) | ADR-010 시점 키. `store-v2.js`가 v1 → v2 일회 마이그레이션 후 그대로 둠 (롤백 안전망) |

**그룹 4 — 동기화 메타·세션 플래그**

| 키 | 형식 | 비고 |
| --- | --- | --- |
| `bible-sync-meta` | JSON `{schemaVersion, deviceId}` | store-v2 충돌 해소용 |
| `bible-drive-sync` | `"1" \| "0"` | 동기화 켜짐 플래그 |
| `bible-drive-sync-email` | string | OAuth `login_hint` 힌트 (이메일) |
| `bible-drive-redirect-attempts` | `"0"`–`"3"` | 리디렉션 루프 차단 카운터 |

> **주의 — `bible-drive-silent-blocked` 정리**
> Phase 2g(Implicit Flow) 시기의 silent-redirect 차단 플래그. Phase 2h 단계 4에서 silent reauth 자체가 IDB refresh token으로 대체되어 의미 없음. Phase 2h 단계 5에서 부팅 시 1회 `localStorage.removeItem` 클린업 추가. 새 코드는 이 키를 읽거나 쓰지 않는다.

### D2. sessionStorage 카탈로그

| 키 | 형식 | 비고 |
| --- | --- | --- |
| `bible-drive-redirect-state-pkce` | JSON `{nonce, verifier, returnTo, ts, flow: "pkce-v1"}` | OAuth 리디렉션 콜백 검증용. `beginRedirectAuth`에서 set, `consumeRedirectCallback`에서 nonce 검증 + 즉시 삭제. 10분 TTL. **단일 사용**(검증 성공·실패 상관없이 폐기)

sessionStorage를 쓰는 이유: 탭 수명 동안만 살아 있으면 충분하고, 다른 탭/창에 새는 것을 원하지 않는 짧은 일회성 상태이기 때문. `localStorage`였다면 동시 OAuth가 진행 중인 다른 탭이 nonce를 덮어써 race가 발생할 수 있다.

### D3. IndexedDB 카탈로그

| DB 이름 | 버전 | Object Store | 내용 | 정의 위치 |
| --- | --- | --- | --- | --- |
| `bible-drive-sync` | 1 | `keys` | AES-GCM 256-bit `CryptoKey`, **`extractable: false`** | `js/sync/refresh-store.js` |
| | | `tokens` | `{id: "refresh", iv: Uint8Array(12), ciphertext: ArrayBuffer}` | |

**원칙**:

- IDB는 **자격 증명·암호 키 전용**으로 한정. 새로운 일반 데이터(예: 노트, 하이라이트)가 추가되더라도 우선 localStorage(또는 store-v2 안에 통합)을 검토하고, 5 MB 한도에 닿거나 트랜잭션이 필요해질 때만 IDB로 승격한다. 승격 시 새 DB(`bible-bookmarks-store` 등)로 분리하고 `bible-drive-sync` DB는 자격 증명 전용을 유지한다.
- 키는 `extractable: false`로 생성해 `crypto.subtle.exportKey()`나 구조화 클론 추출을 막는다. 따라서 다른 origin·다른 IDB로 옮길 수 없고, 이 origin이 데이터 삭제되면 함께 사라진다 — 그 경우 PKCE 리디렉션으로 새 토큰을 받는 것이 정상 복구 경로다.
- 복호 실패 시 `tokens.refresh` 레코드를 자동 삭제해 stale ciphertext가 영구 잔존하지 않도록 한다 (Phase 2h 단계 1 결정).

### D4. Cache API (Service Worker)

`sw.js`의 4개 캐시를 **콘텐츠 종류별로 분리**해 독립 bump한다 (`scripts/release.py`).

| 캐시 이름 (현재) | 내용 | bump 트리거 |
| --- | --- | --- |
| `shell-49` | `index.html`, `js/`, `css/`, 아이콘, 매니페스트 | UI/로직 변경 |
| `data-1` | `data/bible/*.json`, `data/search-*.json` | 데이터 포맷 변경 |
| `audio-1` | `data/audio/*.mp3` | 재인코딩 |
| `fonts-v1` | Google Font 콘텐츠 어드레스 파일 | 사실상 영구 (해시 주소) |

전략(요약): 폰트·data·audio는 cache-first, shell은 navigate 시 network-first 폴백. 활성화 시 `KNOWN_CACHES`에 없는 캐시는 삭제. 자세한 동작은 `sw.js` 본문 및 `docs/architecture.md`의 오프라인 절 참조.

### D5. 키 네이밍 컨벤션

- **접두사**: 모든 origin 스토리지 키와 IDB DB 이름은 `bible-`로 시작.
- **단어 구분**: 케밥 케이스 (`bible-color-scheme`).
- **버저닝**: 스키마가 호환 깨짐으로 바뀌면 키에 `-v2`, `-v3`을 붙이고 마이그레이션 코드를 같은 모듈에 둔다 (예: `bible-bookmarks` → `bible-bookmarks-v2`).
- **세션 한정**: 일회성 OAuth 상태는 sessionStorage에 두고 키 이름에 `redirect-state-pkce`처럼 흐름 정체성을 포함한다.

### D6. 새 데이터 추가 시 결정 트리

```
저장할 데이터를 분류한다.
├─ 자격 증명/암호 키인가?
│   └─ 예 → IndexedDB (`bible-drive-sync` 또는 새 자격 증명 DB)
│           CryptoKey는 extractable:false, 토큰은 AES-GCM 암호화
├─ 일회성 OAuth/리디렉션 상태인가?
│   └─ 예 → sessionStorage, 단일 사용 후 즉시 삭제
├─ 정적 자산(앱 셸·콘텐츠·미디어)인가?
│   └─ 예 → Cache API, sw.js의 적절한 캐시 카테고리에 추가
├─ 사용자 콘텐츠/설정/플래그인가?
│   ├─ 5 MB로 충분하고 동기 접근이 자연스러운가?
│   │   └─ 예 → localStorage. 설정이면 `syncStoreV2.saveSetting` 경로로 Drive 동기화
│   └─ 한도 초과 또는 트랜잭션 필요 → IndexedDB (자격 증명과 분리된 새 DB)
```

## 근거

1. **보안 등급 분리**: refresh token은 침해 시 사용자 Drive `appDataFolder`에 대한 지속적 접근을 의미한다. 평문 KV에 두지 않는다는 결정은 협상 불가능하며, 이는 자연스럽게 IDB + AES-GCM + non-extractable 키로 귀결된다.
2. **동기 vs 비동기 접근 패턴**: 첫 페인트 경로의 결정(테마, 라우트, 시작 동작)은 동기 KV로 읽혀야 ADR-007(스플래시) 가정과 일관된다. 이 동기성을 위해 작은 설정·플래그는 localStorage에 둔다.
3. **메커니즘별 격리는 사후 명문화**: 이미 코드가 이 형태로 자리잡았다. ADR-015는 새 코드 작성을 강제하지 않고, 앞으로의 추가가 같은 분류 안에 들어오도록 기준만 박는다.
4. **쿠키 미사용은 단순화 효과**: 자체 백엔드가 없어 세션 쿠키 불필요, OAuth가 PKCE 본문 응답으로 완결되어 서드파티 쿠키 의존 없음, CSP가 `accounts.google.com` 자체를 허용하지 않는 Phase 2h 단계 4 결정과 정합.
5. **Cache API 카테고리 분리**: `shell-*` / `data-*` / `audio-*` / `fonts-*` 독립 bump가 가능해 UI 변경이 250 MB 분량 오디오를 무효화하지 않는다 — 모바일 데이터 절약.

## 영향 범위

ADR-015는 **사후 명문화**라 신규 코드 변경 없음. 다만 다음을 동반한다.

| 항목 | 변경 |
| --- | --- |
| `docs/decisions/015-storage-strategy.md` | 본 ADR 신규 |
| `docs/architecture.md` | "스토리지" 절에서 본 ADR을 인덱스 추가 (다음 사이클) |
| `CLAUDE.md` | "ADR-015"를 ADR 인덱스 라인에 추가 (다음 사이클) |
| 신규 키 추가 PR | D6 결정 트리에 따라 메커니즘 선택했음을 PR 설명에 1줄 명시 |

## 미결 사항

- **북마크 v2 → IDB 승격 시점**: `bible-bookmarks-v2`가 단일 KV에 JSON blob으로 직렬화되어 있어, 사용자 북마크 수가 늘면 매 변경마다 전체 doc을 다시 직렬화·기록한다. 수천 건 규모에서 한도/성능 문제가 보이면 IDB로 승격(자격 증명 DB와 분리). 현재는 동기 접근 단순함 + ADR-013 테스트 가벼움이 더 큰 가치라 미루어둠.
- **Storage Persistence API**: `navigator.storage.persist()`로 IDB의 refresh token이 저장 압박 시 evict되지 않도록 요청하는 것을 검토. 현재는 미신청 — 사용자 Drive 재인증으로 항상 복구 가능하므로 priority 낮음.
- **Quota 모니터링**: `navigator.storage.estimate()`로 한도 근접 알림. data·audio 캐시가 합쳐 250 MB+가 되면 의미 있어짐. 현재는 미구현.

## 참고

- ADR-010 북마크 (localStorage 채택 근거)
- ADR-011 북마크 동기화 (Phase 2c store-v2, Phase 2h PKCE + IDB 도입)
- ADR-014 검색 히스토리 (로컬 전용 행동 데이터)
- `docs/archive/audit/2026-05-07-pkce-refresh-token.md` — refresh token 암호화 모델 보안 감사
- `docs/archive/design/pkce-migration.md` — Phase 2h 살아있는 설계 문서
- MDN: Web Crypto API `CryptoKey.extractable`, IndexedDB structured clone
