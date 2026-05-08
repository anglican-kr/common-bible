# 2차 통합 보안 감사 (2026-05-08)

1.4.6 prod 배포 직후 통합 감사. 1차 감사들(`2026-05-02-171111.md` Implicit 시점, `2026-05-07-pkce-refresh-token.md` PKCE 시점)이 명시적으로 다루지 않았던 영역 — Python 데이터 파이프라인, 오디오 처리, 최근 JS 추가분(검색 이력·visibility sync·audio cache LRU), 의존성·빌드 파이프라인·정적 호스팅 노출면 — 을 중심으로 sweep. 동시에 OAuth/PKCE/refresh token은 BFF·visibility sync·dev 환경 분리가 추가됨에 따라 re-verify.

## 요약

| 영역 | Critical | High | Medium | Low/Info |
|-----|---------|------|--------|---------|
| Python 파이프라인 | 0 | 0 | 2 | 4 |
| 오디오 처리 | 0 | 3 | 2 | 2 |
| 검색 이력·visibility sync·BFF·헤더 | 0 | 0 | 2 | 5 |
| 의존성·빌드·노출면 | 0 | 1 | 3 | 4 |
| **합계** | **0** | **4** | **9** | **15** |

**Critical 0건, High 4건** — 모두 즉시 처리 가능한 작업량. Medium 9건은 백로그.

## High 발견 (즉시 처리 권장)

### H1. 오디오 캐시 quota 폭발 — `sw.js:139`

```js
const cl = response.headers.get("content-length");
const byteSize = cl ? Number(cl) : 0;
```

`Content-Length` 헤더가 없는 응답(chunked transfer / gzip)은 `byteSize=0`으로 IDB sidecar에 기록 → `totalSize()` 합산에서 빠짐 → LRU cap이 `HARD_CAP`(300 MB) 도달 신호를 못 받음 → Cache API 실제 사용량은 무제한 누적 → 브라우저 quota 초과 시 origin 단위 evict → DATA_CACHE(1328장 본문) + AUDIO_CACHE 둘 다 손실.

**영향:** 사용자 디바이스의 storage 폭발 + 본문 캐시 무효화. 우리 현재 인프라는 nginx + Let's Encrypt에서 Content-Length를 항상 보내지만, CDN·proxy 추가 또는 Range 요청 등으로 누락될 미래 가능성.

**수정:** `byteSize === 0`이면 `await response.clone().blob()` → `blob.size`로 폴백. 비용 1회 추가 read이지만 각 mp3당 한 번뿐.

### H2. 오디오 eviction race — `sw.js:133-147`

`_putAudioAndEnforceCap`이 `event.waitUntil` 안에서 비동기 진행. 두 동시 fetch가 같은 시점에 hard cap 초과를 감지하면 `pickEvictions(SOFT_CAP)`이 둘 다 같은 url 집합을 반환. 더 큰 문제: **방금 put된 새 파일이 다른 fetch의 evict 대상에 포함**되어 사용자가 막 다운로드 받은 mp3가 즉시 삭제되고 재생이 끊김.

**영향:** 재생 중 mp3가 사라지는 사용자 경험 회귀. 빈도는 낮지만 LRU cap 근처에서 재현.

**수정:** in-flight URL set으로 진행 중 다운로드 보호. 또는 IDB 단일 트랜잭션에서 read-evict-write를 atomic하게.

### H3. IDB ↔ Cache API 불일치 — `audio-cache.js:14`, `sw.js:135`

세 시나리오:
- (a) `cache.put` 성공 → `recordEntry` 실패(IDB 풀 등) → Cache에 mp3는 있는데 IDB 메타 없음 → LRU 추적 누락(영구 누적)
- (b) DevTools나 브라우저 설정에서 한쪽만 비움 → 무한 fetch(IDB 메타 살아있고 Cache는 비어있음) 또는 stale 메타
- (c) `audio-cache.js:14` `importScripts` 실패 시 `bibleAudioCache=undefined`인데 caching은 계속 → 메타 없이 Cache API 무한 누적

**수정:** SW `activate` 핸들러에 `cache.keys()` ↔ IDB entries 양방향 reconcile 추가. 첫 install 후 한 번 + 주기적(예: 24h마다 한 번).

### H4. 작업 트리에 평문 `client_secret` 두 개 존재 (운영 위생)

```
dev_client_secret_359209354241-esbmeba2ku58depo9fgg08v52crfthot.apps.googleusercontent.com.json
prod_client_secret_359209354241-do8kgvtcbnfvrge01f5hj29fee9cg195.apps.googleusercontent.com.json
```

`git log --all -p -S 'GOCSPX'` 0 hits → **git history 노출 없음**. `.gitignore:121 *_client_secret_*.json`이 잡고 있음. `build-deploy.sh` zip 화이트리스트에도 미포함 → 배포 zip 검증 0 hits. **그러나 디스크 평문 보관 + 디렉터리 listing 사고 + 백업 동기화 시 유출 위험**이 남는다. 두 secret이 이미 nginx 설정 파일에 안전히 들어갔으므로 디스크의 JSON은 더 이상 필요 없음.

**수정:** 두 파일 삭제. 향후 secret 로테이션 시엔 1Password 등 외부 저장소에서 직접 nginx로.

## Medium 발견 (백로그)

### M1. `requirements.txt` 의존성 핀 부재
`pytest>=7.4.0` 등 lower-bound만. `cairosvg`·`Pillow` 누락(`generate_splash.py`가 사용). dev-only라 영향 제한적이나 빌드 재현성·CVE 추적 불가. 권장: pip-compile lock 또는 최소한 `Pillow>=10.3.0` (CVE-2023-50447 방어) 명시.

### M2. `split_bible.py:67` 빈 텍스트 IndexError 가능
`text.split('\n')[1].startswith('¶')` — 정확히 1개 줄바꿈 + 두 번째 줄 비어있으면 OOB. 현재 입력은 안 타지만 `split('\n', 1)` + 길이 체크로 defense-in-depth.

### M3. 오디오 캐시 무결성 검증 부재 — `sw.js:181-187`
HTTPS origin 동일 출처로 MITM은 TLS로 막히지만, 일단 캐시되면 릴리스 bump까지 영구. 권장: mp3 매니페스트 hash 비교 (별도 ADR 필요).

### M4. 재생 위치 `bible-audio-pos` 검증 — `app.js:179-185`
`pos.time > 0`만 체크. 사용자가 localStorage에 NaN/Infinity 주입하면 `loadedmetadata` 전 가드 누락. `Number.isFinite && >=0` 검증 추가.

### M5. `/oauth/token` rate limiting 부재 (ADR-017 §"향후 고려")
공격자가 fake refresh_token 무한 POST → upstream Google 쿼터 소진/IP 차단 위험 → 정상 사용자 동기화 중단. nginx `limit_req_zone` 추가:
```nginx
limit_req_zone $binary_remote_addr zone=oauth:10m rate=10r/m;
limit_req zone=oauth burst=20 nodelay;
```

### M6. BFF body parameter pollution
`proxy_set_body "$request_body&client_secret=<SECRET>"` — 클라이언트가 body에 `client_secret=fake&` 또는 trailing `&`을 포함시키면 결과 body에 `client_secret`이 두 번 등장. Google 파서는 보통 마지막 값을 채택해 secret oracle은 안 되나 표준 미정의. 권장: nginx에서 `if ($request_body ~ "client_secret") { return 400; }` 가드, 또는 njs로 body 파싱·재조립.

### M7. deploy zip 누적 (~37 MB)
작업 트리에 7개 zip. `.gitignore:95 *.zip`으로 git 노출 없으나 디스크 누적·백업 사고 위험. `deploy.sh` 마지막에 `rm -f deploy-*.zip` (또는 7개 이하 유지) 권장.

### M8. `release.py`가 git commit/tag 자동화 없음
`version.json`·`sw.js` 둘 다 디스크에 쓰지만 git 작업 수동. 한쪽만 bump 후 수동 커밋 누락 시 SW가 기존 캐시 재사용 → stale shell. mitigation 없음. 권장: 스크립트 끝에 `git add` + 사용자 확인 후 commit, 또는 hook으로 검증.

### M9. (생략 — H4와 합쳐 처리됨)

## Low/Info 발견

- **L1 (Python)** `parser.py:128`·`tests/generate_fixtures.py:24` — `parse_md_file(file_path)`·`glob.glob`이 경로 traversal 검증 없음. 위협 모델상 입력 신뢰. 향후 외부 입력 받게 되면 `os.path.abspath` + prefix 체크.
- **L2 (Python)** `parser.py:108-109` 정규식 — catastrophic backtracking 없음. 안전.
- **L3 (Python)** `search_indexer.py:34-38` `clean_text` — `\r`, `\t`, U+2028/U+2029 그대로 통과. SPA가 textContent로 렌더하므로 XSS는 아니지만 레이아웃 깨짐 가능. `re.sub(r'\s+', ' ', text)` 권장.
- **L4 (Python)** 테스트가 ADR-004 Level 1-3 설계 따라 분업 — `test_completeness.py` 1328 하드코딩 + `test_ordering.py` 픽스처 의존 + `test_snapshots.py` 절대값. 거짓 통과 가능성 있으나 의도된 분업이라 설계상 OK.
- **L5 (Audio)** `lastAccess` 시계 조작 — 본인 디바이스 한정·손해도 본인이라 위협 모델 부합. 무해.
- **L6 (Audio)** 권한 격리 — 동일 origin, Drive 호스트 우회, path traversal 면역. 안전.
- **L7 (검색 이력)** 정규화가 trim + 공백 정규화만. 제어문자 통과하나 textContent 렌더라 무해.
- **L8 (visibility sync 프라이버시)** 비활성 사용자가 다른 탭에 머물다 돌아오면 Drive REST 호출. ADR-011 동의 사용자 한정이라 정책상 OK이나 디버그 로그 PII 마스킹 일관 유지 필요(이미 적용).
- **L9 (BFF) `proxy_ssl_verify` 누락** — 기본값 off라 upstream 인증서 미검증. `proxy_ssl_verify on; proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;` 권장. (Google CA 침해 시나리오 방어 — 가능성 매우 낮으나 standard hardening)
- **L10 (BFF) `proxy_hide_header` 미사용** — Google 응답 헤더가 그대로 전달. `Set-Cookie` 등 방어적 hide 권장.
- **L11 (헤더)** Permissions-Policy 누락 directive — `clipboard-read=()`, `display-capture=()`, `fullscreen=()`, `interest-cohort=()`, `browsing-topics=()` 명시 거부 권장. `clipboard-write`은 명시 안 하거나 `(self)` (앱이 사용).
- **L12 (의존성)** 외부 스크립트 SRI 누락 — `fonts.googleapis.com/css2`·`googletagmanager.com/gtag/js` 둘 다 dynamic CDN이라 SRI 적용 어려움. CSP sha256 핀이 부분적 방어.
- **L13 (deploy)** heredoc 변수 보간 (`<<REMOTE` unquoted) — 통제값만 확장되므로 안전. 의도와 일치.
- **L14 (정적 노출)** `manifest.webmanifest`·`robots.txt`·`sitemap.xml` 모두 공개 의도 콘텐츠만, admin/dev 노출 0건.
- **L15 (정적 노출)** CSP 견고 — `default-src 'self'`, `object-src 'none'`, script/style sha256 핀, GTM/fonts만 화이트리스트, `worker-src 'self'`·`base-uri 'self'` 포함.

## 1차 감사 대비 변화

| 항목 | 1차 (2026-05-02) | PKCE (2026-05-07) | 2차 (이번) |
|-----|-----------------|-------------------|-----------|
| Critical | 0 | 0 | 0 |
| Medium 처리 | 2건 수정 | 0건 | (백로그 8건 제기) |
| 인증 흐름 | Implicit + GIS | PKCE 단일 경로 | PKCE + BFF |
| 신규 표면 | — | refresh-store IDB | nginx BFF, dev/prod 분리, visibility sync |
| 회귀 | — | 없음 | 없음 |

**OAuth/PKCE/refresh token 영역은 회귀 없음.** BFF 도입으로 client_secret 격리는 강화됐고, Permissions-Policy/COOP 등 브라우저 헤더 추가됐으며, OAuth Client ID 호스트 격리(localhost 제거)로 PKCE 가로채기 표면 닫힘. 새로운 공격 벡터 도입 없음.

## 권장 즉시 처리 (이 감사 산출 PR)

| # | 작업 | 영역 | 예상 PR |
|---|-----|------|--------|
| H4 | 디스크 client_secret JSON 두 개 삭제 | 운영 위생 | 즉시 (PR 불필요, 로컬) |
| M5+M6 | nginx `/oauth/token`에 rate limit + body pollution 가드 + ssl_verify | nginx | 별도 PR (서버 측 변경) |
| H1 | `sw.js` Content-Length fallback (Blob size) | 코드 | 별도 PR |
| H2+H3 | 오디오 eviction race + IDB/Cache reconcile | 코드 | 별도 PR (구조 변경 큼) |

Medium 나머지·Low는 백로그 큐.

## 다음 정기 감사 트리거

- CSP 리포트 엔드포인트 도입 후 (백로그 #3, 1.4.6 prod 안정 1주 후 ≈ 2026-05-15)
- 또는 새로운 인증·외부 통신·서버 측 코드 도입 시
