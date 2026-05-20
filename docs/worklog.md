# 작업 일지

## 2026-05-20

### 칠십인역 단독 절 표기 `[_N]` 추가

새 절 표기법 `[_N]`을 도입했다. 칠십인역(70인역)에만 있고 히브리어 본문에는 없는 절을 가리킨다. 다니엘 3장의 아자리야의 기도·세 젊은이의 노래(24~90절)가 대표 사례로, 이 부분은 그리스어 부가문이라 히브리어 절 번호가 없다. 기존 사본 이중 번호 `[N_M]`(ADR-003 패턴 4)이 한 절을 두 사본 번호로 병기하는 것과 달리, `[_N]`은 앞 번호 자리를 비워 "대응하는 히브리어 절이 없음"을 나타낸다.

**데이터 저장소(`common-bible-data`)**

- `parser.py` — `_MD_VERSE` 정규식에서 앞 번호 그룹을 선택적(`(\d+)?`)으로 바꾸고, 선두 lookahead `(?=\d|_\d)`로 `[a]`·`[]` 같은 비-절 대괄호 텍스트가 절 마커로 잘못 잡히지 않게 막았다. `Verse.lxx_only` 필드 추가. `[_N]`은 밑줄 번호를 `number`로 삼고 `lxx_only=True`로 표시한다.
- `split_bible.py` — `lxx_only` 절 필드와 `has_lxx_only` 장 플래그를 장별 JSON에 기록.
- ADR-003 개정 — 패턴 5 추가(v2.2). 더불어 패턴 4 `alt_ref` 설명을 정정했다(v2.3): v2 본문이 `alt_ref`를 "히브리어 사본 번호"라 적었으나 실제 구현·앱 표기는 `alt_ref` = 칠십인역(LXX) 번호다. 에스델 1장 부가문 데이터(`number=1` 공유, `alt_ref` 1~17 순차)로 확인.

**앱 저장소(`common-bible`)**

- `views-routing.js` — `lxx_only` 절은 절 번호를 괄호로 감싸 표시한다(`[_24]` → `(24)`). 사본 이중 번호의 괄호 표기와 같은 규칙. `has_lxx_only` 장은 본문 상단에 안내 문구를 띄운다. 다니엘 3장처럼 한 장에 같은 번호의 히브리어 절과 칠십인역 단독 절이 함께 있을 수 있어, DOM id 충돌을 막으려 `lxx_only` 절 id에 `_lxx` 접미사를 붙였다.
- `types.d.ts` — `lxx_only`·`has_lxx_only` 타입 추가.

**알려진 제약**: 절 선택·북마크·검색은 절 번호 기준이라, 같은 번호의 히브리어 절과 칠십인역 단독 절을 구분하지 못한다. 이는 사본 이중 번호 `[N_M]`이 이미 가진 제약과 같은 성격이다.

검증: 데이터 파이프라인 테스트 1361개·JS 유닛 505개 통과, `tsc` 0 error. 합성 입력과 실제 `dan.md` 로 파서 동작 확인.

## 2026-05-19

### Google OAuth 앱 검수 통과

Google Cloud Console에서 PWA의 OAuth 앱이 `In production` 상태로 전환됨. 이에 따라 refresh token TTL이 7일(테스트 모드 제한)에서 영구로 변경된다. 코드 변경은 없음 — ADR-011 설계 시점부터 검수 통과 후 동작 변경이 불필요하도록 구현된 상태.

영향:
- 기존 사용자의 refresh token이 7일 이후에도 만료되지 않아, 매주 재연결 과정이 사라짐
- `invalid_grant` 빈도가 정상 케이스(사용자 직접 연결 해제, Google 계정 세션 만료 등)로만 발생하게 됨
- 테스트 모드 관련 미결 사항 전부 해소 (ADR-011 §미결 사항 완료 처리)

## 2026-05-11

### 모노레포 4분할 마이그레이션 (ADR-020)

기존 단일 `common-bible` 저장소를 4개로 분리:

| 저장소 | 역할 | 비고 |
|---|---|---|
| `anglican-kr/common-bible` (본 저장소) | PWA 프론트엔드 | 공개 유지 |
| `anglican-kr/common-bible-data` | 마크다운 원본·Python 파이프라인·빌드 출력·데이터 검증 테스트 | 비공개, 기존 `common-bible-text` 이름 변경 |
| `anglican-kr/common-bible-audio` | 장별 mp3 ~6.7 GB | 비공개, GitHub LFS (anglican-kr 조직 Team 요금제로 250 GB/월 한도 확보) |
| `anglican-kr/common-bible-server` | nginx 설정 + 배포 스크립트 | 비공개 |

서브모듈 토폴로지: 앱이 `data/`에 `common-bible-data` 직접 마운트, `common-bible-data` 안의 `audio/`에 `common-bible-audio` **nested** 마운트. clone 시 `--recurse-submodules`. 앱 측 URL `/data/...`는 마운트 위치로 그대로 보존되어 sw.js·audio-cache.js·index.html 어디도 변경 없음. Python 파이프라인의 `path` 상수만 `data/` prefix 제거(작업 디렉토리가 data 저장소 루트로 바뀜).

분리 동기 세 가지가 겹쳤다: ① 본문 저작권(원본 마크다운은 비공개여야 하는데 앱은 공개), ② 자산 크기(6.7 GB 오디오를 일반 git에 둘 수 없음), ③ 운영 secret(ADR-017 BFF의 `client_secret`을 서버 설정 저장소에 격리). Phase 2~4 로드맵(기도서·교회력·성무일과) 추가 전에 경계를 정립.

마이그레이션 단계:

1. **server** — 새 저장소에 `nginx/`·`scripts/deploy.sh`·`build-deploy.sh` 이전. 빈 초기 커밋. `deploy.sh`의 `APP_ROOT` 일반화는 후속.
2. **audio** — 새 저장소에 LFS 초기화 + `.gitattributes` + mp3 1314개 push. 25 MB/s, 6.7 GB push 4분.
3. **data** — 기존 `common-bible-text`를 `common-bible-data`로 GitHub UI에서 rename, redirect 자동. 73개 마크다운을 `source/` 하위로 단일 `git mv` (history 보존). 모노레포에서 `src/`·`tests/`·`book_mappings.json`·빌드 산출물(`bible/`·`books.json`·`search-*.json`) 이전. Python `path` 상수 갱신. `data` 저장소에 audio nested 서브모듈 추가. `convert_txt_to_md.py`·`common-bible-kr.txt`는 더 이상 필요 없어 제거.
4. **앱 정리** — 기존 `data/source` 서브모듈 deinit + `data/` 트래킹 파일 7개(`books.json`·`book_mappings.json`·`search-*.json` 4개·`source` 포인터) 제거. `data` 디렉토리 비우고 `common-bible-data`를 서브모듈로 마운트. `git submodule update --init --recursive`로 audio nested까지. `src/`(generate_splash.py만 `scripts/`로 mv)·`tests/test_*.py`·`tests/fixtures/`·`scripts/deploy.sh`·`build-deploy.sh` 제거.
5. **문서** — `CLAUDE.md`·`GEMINI.md`·`README.md`·`docs/architecture.md` §1-3 갱신(4분할 토폴로지·서브모듈 도식). ADR-001·004·011·017에 「개정 2026-05-11」 블록. ADR-020 신규.

CI 워크플로우는 두 곳: 앱 저장소(`test.yml`)는 JS 유닛 자동 실행 그대로, `common-bible-data`(`validate.yml`)는 push 시 Level 1-3 데이터 검증 자동 실행. e2e와 빌드는 로컬 또는 수동.

### OAuth 콜백 후 뒤로 가기로 동기화 직전 페이지에 착지

증상: Google 계정 연결 직후 브라우저 뒤로 가기를 누르면 `accounts.google.com`의 로그인 화면으로 이동. 콜백 핸들러가 `?code=...` URL만 `history.replaceState`로 지웠을 뿐, 그 직전에 쌓인 Google 측 히스토리 항목들은 그대로 남아 한 번의 뒤로 가기로 노출되던 상태. 크로스 오리진 히스토리 항목은 JS로 가로채거나 제거할 수 없다는 게 핵심 제약.

**1차 시도(history.go-only)**: 토큰 교환 직후 `history.go(-delta)`로 Google 항목을 통째로 건너뛰는 방식. 실제 dev 배포(1.4.9)에서 검증 시 여전히 Google 화면으로 복귀하는 케이스가 관측됨 — Safari의 `history.length` 캡, 클릭 시 forward stack 잔존, 콜백 처리와 사용자의 뒤로 가기 클릭 간 타이밍 등 변수가 많아 신뢰 부족. 1.4.9 릴리스는 되돌리고 `fix/oauth-back-nav` 브랜치에서 재설계.

**채택안 (2단 방어)**:

1. **back-nav guard** — 토큰 교환 성공 직후 state-machine이 현재 URL과 같은 URL의 guard 항목을 `pushState`로 한 장 올려둔다. 시각적 변화는 없고, 첫 뒤로 가기를 가로채기 위한 동일-오리진 hook이 생긴다. 60초 후 자동 해제(잊혀진 guard가 영구적으로 뒤로 가기를 가로채는 일 방지).
2. **첫 popstate 시 점프** — 사용자가 뒤로 가기를 누르면 guard에서 빠지면서 `popstate` 발생. 핸들러는 `beginRedirectAuth`가 별도 키(`bible-drive-back-nav-context`)에 저장해 둔 클릭 시점 `history.length`를 읽고 `현재 - snapshot = delta`(Google이 추가한 항목 수)를 계산해 `history.go(-delta)`로 한 번에 점프. 결과적으로 Google 항목들과 연결 버튼이 있던 페이지 자체를 모두 건너뛰어 **클릭 직전 사용자가 보고 있던 페이지**에 착지.
3. **안전 폴백** — snapshot이 1(첫 화면에서 클릭)이거나 delta가 2~10 범위를 벗어나면(Safari `history.length` 캡, 클릭 시 forward stack 잔존 등), 같은 자리에 guard를 다시 `pushState`. 결과: 뒤로 가기가 "흡수"만 되어 사용자가 같은 페이지에 머무름. Google 화면으로 절대 떨어지지 않음.

본 변경이 영향 주는 곳:

- `js/sync/transport.js` — `beginRedirectAuth`가 `bible-drive-back-nav-context` 키에 클릭 시점 snapshot 저장. 콜백 결과 시그니처는 원복(historyDelta 제거).
- `js/sync/state-machine.js` — `acceptRedirectCode` 성공 경로 끝에서 `_installOAuthBackGuard` 호출. guard 설치 + popstate 핸들러 + 60초 타임아웃 + snapshot-기반 점프 로직.
- `js/drive-sync.js`, `js/types.d.ts` — `acceptRedirectCode` 시그니처 (code, verifier) 원복.
- `docs/design/pkce-migration.md` §3.4.2 — sessionStorage 스키마에 `bible-drive-back-nav-context` 키 추가 + 인라인 설명 갱신.

**테스트**: 유닛 +2 케이스(transport.test.js 14b/14c — back-nav 키 저장 + 콜백 소비 후에도 별도 키 유지). 전체 473 → 475, 모두 통과. 기존 4번 테스트는 redirect-state 스키마(snapshot 제거) + back-nav 별도 키 단언으로 갱신.

**한계**: 폴백 케이스(snapshot=1, 또는 forward stack 잔존)에서는 뒤로 가기가 "흡수"만 되어 직전 페이지 점프가 불가능. 완전 무결한 점프는 클릭 시점에 페이지 URL을 명시적으로 별도 저장하는 방식이 필요하나, 현재의 SPA 라우팅 상태와 직접 결합되어야 해서 다음 의제로 미룸.

### 1.4.8 릴리스 — 예레미야 본문 수정 반영 (131df04)

`data/source/` 서브모듈에서 예레미야 본문 정정안이 머지됨에 따라 파이프라인을 다시 돌려 `data/bible/jer-*.json` + 검색 인덱스 재생성, version + SW CACHE_NAME bump.

### 유닛 테스트 대량 확장 (78 → 473 케이스) + QA 폴더 컨벤션 정착

ADR-018 모듈 분할이 끝난 직후 app 레이어로 유닛 테스트를 확장하는 후속 의제를 진행. sync 레이어 한정이었던 커버리지를 다음 영역으로 넓혔다:

- `storage.js` 비-search-history 영역
- `helpers.js`
- `install.js` (INSTALL_STATE + NUDGE)
- `views-routing.js` (POPOVER + COMPACT_HEADER)
- `bookmark.js` (HREF / ACTIVE / IMPORT_EXPORT, 추가 70건)
- `search.js` (HISTORY_CONTROLLER, 36건 기존 + 추가)

각 작업마다 `docs/qa/YYYY-MM-DD-unit-{topic}.md` 비기술 독자용 보고서를 함께 작성하는 컨벤션을 정착(`docs/qa/README.md`에 톤·구조 명시). CI 워크플로우에서 같은 테스트가 두 번 실행되던 문제도 정리.

ADR-013 한차례 jsdom dual-track 허용으로 개정했다가, 실효 비용 검토 후 도입 보류 + 미커버 영역은 e2e가 책임으로 재정정. CLAUDE.md '현재 상태' 섹션 유닛 테스트 케이스 수 두 차례 갱신(78 → 309 → 473).

### 문서 대정비

- **CLAUDE.md 2차 압축** — '현재 상태' 섹션 50+줄을 12줄로 축약, 모듈별 라인 수 같은 빠르게 stale 되는 디테일은 architecture.md로 위임.
- **architecture.md 현행화** — §4 모듈 지도 + 부록 B를 ADR-018·019 완료 상태 기준으로 다시 작성. 로드 방식·파일 수·운문 포맷 설명 정확도 수정, 비기술 독자 가독성 다듬기.
- **ADR 8개 + 살아있는 설계 문서 4개 status 라인 현행화** — Phase 진행 표현(예: "단계 4 진행 중" → "단계 4 완료")을 실제 상태와 정렬.

## 2026-05-10

### app.js 모듈 분할 완주 — Phase 6~8 (ADR-018, PR #97·#100·#101·#103)

전날 시작된 Phase 1~5(helpers/storage/settings-ui/install/search 추출)에 이어 나머지를 마무리:

- **Phase 6a** — `reading-context.js` 신설 + `bookmark.js` 추출 시작
- **Phase 6b** — 북마크 UI 전체(드로어·시트·모달 4종) 추출
- **Phase 7a** — `views-routing.js` 신설 + 유닛 28건
- **Phase 7b** — Views + Routing + Audio Player 합쳐 추출
- **Phase 8** — 마지막 잔재 facade(`window._xxx`) 정리 + `// @ts-check` 영구 활성화

최종: `js/app.js` 6,082 → 283줄, 9개 도메인 모듈, ESM. Bugbot 리뷰 4라운드에서 데드 변수·미사용 destructure·stale facade·stale anchor·미사용 import 등 약 10여 건 정리.

`bookmark.js` 유닛 테스트도 70건 추가. CLAUDE.md '현재 상태'에 ADR-018 완료 줄 추가, `docs/design/app-modularization.md` 상태 갱신.

## 2026-05-09

### app.js JSDoc 도입 + ESM 전환 + 모듈 분할 Phase 1~5 (ADR-012 2차·ADR-018·ADR-019)

큰 줄기로 묶이는 하루치 작업:

1. **JSDoc 7-PR 시리즈**(PR-1 ~ PR-7) — app.js 6,000+줄 전반에 `@param`/`@returns` 타입 주석 점진 추가. 처음에는 `// @ts-check` 영구 활성화도 함께 시도했지만 분할 의제가 더 시급하다고 판단해 1라운드 종료 후 분할 의제로 이관.
2. **ESM 일괄 전환(ADR-019 신설)** — 모든 클라이언트 JS를 `<script type="module">`로 통일. 전환 직후 cross-module bare global 호출이 끊기는 회귀가 발견되어 즉시 폴백 fix.
3. **app.js 모듈 분할 Phase 1~5(ADR-018)** — `helpers.js` → `storage.js` → `settings-ui.js` → `install.js` → `search.js` 순으로 추출. 각 Phase에서 추출된 함수의 호출자가 더 이상 `window.xxx`로 도달하지 않도록 import 경로 정리.
4. **search.js 유닛 테스트 36건 추가** + CI job 이름 `Unit tests (sync layer)` → `Unit tests`. ADR-013에 "한 모듈 = 한 테스트 파일" 명명 컨벤션 도입.

### nginx BFF 보강 + Bugbot fix (PR #77)

`nginx/oauth-proxy.example.conf`에 다음 추가:

- Permissions-Policy 추가 directive (보안 헤더 백로그 #6 일부 처리)
- `/oauth/token` 경로 rate limiting (`limit_req_zone`)
- njs `bff_inject_client_secret`이 body 안에 `client_secret`이 이미 있으면 거절(SPA가 우회 시도하지 못하게)

Bugbot이 percent-encoded 키(`client%5Fsecret`)로 검증을 우회할 수 있다고 지적 → percent-decoded 형태도 함께 차단.

### 1.4.7 릴리스 + 모바일 UX 다듬기

- **핀치 줌 비활성화** — `viewport` meta에 `user-scalable=no`. 한 손 읽기 중 의도치 않은 줌으로 행 폭이 깨지던 문제 해소(접근성 trade-off 검토: 시스템 폰트 사이즈 조절은 그대로 동작하므로 시각 보조 사용자에게 영향 없음 확인).
- **pull-to-refresh 스피너 디자인** — 기존 일반 원형 스피너를 iOS 3/4 호 스타일로 교체, 동기화 진행 중에는 화면 스크림(어두운 오버레이)으로 입력 차단.
- **'실험' 라벨 제거** — 백업 & 동기화 설정에서 베타 표시 제거(Phase 2h·2i 안정화 단계 도달).
- version.json + sw.js CACHE_NAME bump.

### 이사야 본문 갱신 → OT 검색 인덱스 재생성 + DATA_CACHE bump

`data/source/` 서브모듈에서 이사야 정정안 머지 → `python src/parser.py` + `search_indexer.py` 재실행해 `data/bible/isa-*.json` + `data/search-ot.json` 갱신. SW의 `DATA_CACHE` v1 → v2로 bump해 기존 캐시 무효화.

## 2026-05-08

### 2차 통합 보안 감사 + 오디오 캐시 hardening (PR #67)

`project_security_headers_backlog.md` #4 (2차 보안 감사)를 진행. 1차 감사들이 명시적으로 다루지 않았던 영역(Python 데이터 파이프라인, 오디오 처리, 최근 JS 추가분, 의존성·빌드 파이프라인·정적 호스팅 노출면) 중심으로 sweep. Critical 0건, High 4건, Medium 9건, Low/Info 15건 발견.

**감사 보고서**: `docs/audit/2026-05-08-second-comprehensive.md`.

**즉시 처리 (이 PR):**

- **H1** — `sw.js:139` `byteSize = cl ? Number(cl) : 0`. Content-Length 누락(chunked transfer / gzip / Range) 시 0 기록 → totalSize 합산에서 빠짐 → HARD_CAP 도달 신호 못 받음 → Cache API 무한 누적 → origin-단위 quota 초과 시 DATA_CACHE까지 evict. **수정**: `cache.put` 전에 `response.clone().blob().size` 폴백 (clone은 body 소비 전에 해야 함).
- **H2** — `_putAudioAndEnforceCap`이 두 fetch에서 동시 진행되면 `pickEvictions` 결과가 방금 put된 url을 evict 대상에 포함시켜 재생 중 mp3 삭제. **수정**: 모듈 레벨 `_inflightAudioUrls` Set + 진입/finally cleanup + eviction 시 filter out.
- **H3** — `cache.put` 성공 후 `recordEntry` 실패 또는 DevTools에서 한쪽만 비움 → IDB·Cache 영구 어긋남. **수정**: 새 `_reconcileAudioCache` 함수 + `activate` 핸들러에서 호출. (a) Cache에 있고 IDB에 없는 항목 → recordEntry로 채움 (byteSize는 blob.size로). (b) IDB에 있고 Cache에 없는 항목 → orphan removeEntries. 비용은 mismatch 수에 비례, healthy 상태에선 microsecond.
- **H4** — 작업 트리에 평문 client_secret JSON 두 개 (dev·prod). git history는 clean (`git log --all -p -S 'GOCSPX'` 0 hits) + `.gitignore`로 잡힘 + 배포 zip 미포함. 디스크 삭제 처리. secret 자체는 nginx 설정과 Cloud Console에 살아있어 유실 없음.

**테스트**: 기존 유닛 테스트 98 케이스 모두 통과 (audio-cache 14 + refresh-store 13 + search-history 19 + state-machine 29 + transport-pkce 23). sw.js 자체에 대한 유닛 테스트는 미작성 (vm 컨텍스트 + ServiceWorkerGlobalScope 스텁 부담) — 향후 별도 의제.

**배포 영향**: 코드 변경은 sw.js 내부 동작(LRU 정확성·race 가드·reconcile)뿐, 사용자 가시 변화 없음. SW 자체 갱신은 브라우저가 `sw.js` 콘텐츠 변경을 감지해 자동 처리 → 다음 visit 시 새 SW activate + reconcile 1회 실행.

**Medium·Low/Info는 백로그**: requirements.txt 의존성 핀 (M1), split_bible.py 엣지 케이스 (M2), `/oauth/token` rate limiting (M5), BFF body parameter pollution 가드 (M6), deploy zip 정리 (M7), release.py 자동 commit (M8), Permissions-Policy 추가 directive (L11) 등.

**OAuth/PKCE/refresh token 회귀 없음.** BFF + 호스트 격리 + 보안 헤더 통합으로 보안 자세 강화 확인.

**문서**: `docs/coding-pitfalls.md` §15 신규 — Cache API ↔ IDB sidecar 불일치 + Content-Length 의존 함정.

### README 재구성 — Drive 동기화를 top-level로 분리

기존 `## 플랫폼별 동작 차이` 섹션 안에 Google Drive 동기화가 같이 묶여 있었는데, Phase 2h 단계 4에서 GIS / Implicit Flow / FedCM이 제거되며 동기화가 데스크탑·Android·iOS 동일 코드 경로로 통일됐다 — 더 이상 "플랫폼별 차이"의 사례가 아님. 섹션 분리:

- `## 플랫폼별 동작 차이` (좁아짐): 앱 설치(여전히 플랫폼별로 다름) + iOS 고유 제약(7일 ITP, WebKit 래퍼)만
- `## Google Drive 동기화` (top-level 신규): 시나리오 표 + BFF + 운영 가드 + sync-specific 알려진 한계 (OAuth 검수, 외부 권한 회수)

ITP는 동기화에만 영향이 아니라 모든 로컬 상태(북마크·설정 포함)에 영향이므로 의도적으로 iOS 고유 제약 쪽에 둠. Drive 동기화 절은 그쪽으로 cross-link만 둠.

코드 변경 0, 문서만.

### nginx 보안 헤더 통합 + 새 헤더 도입 (보안 헤더 백로그 #2)

`project_security_headers_backlog.md`의 백로그 4건 중 #1(SRI)이 Phase 2h 단계 4의 GIS 제거로 자동 해소된 후, #2(Permissions-Policy + COOP)를 진행. 작업 도중 latent 버그 1건도 같이 발견·수정.

**Latent 버그 발견:**

두 vhost 모두 `location ~* \.(jpg|...)$`·`location ~* \.html$` regex가 **두 번씩 선언**돼 있었다. 위쪽엔 Cache-Control만, 아래쪽엔 "# 보안 헤더" 주석과 함께 X-Frame-Options 등이 있었지만, nginx는 regex location을 first-match로 잡으므로 아래쪽 블록은 **dead code**. 결과적으로 prod·dev 모든 응답에 보안 헤더 0개로 서빙되고 있었음 — `curl -sSI`로 확인. 의도와 실제가 한참 어긋남.

**수정:**

- `/etc/nginx/snippets/security-headers.conf` 신규 — 단일 출처로 6개 헤더 정의 (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy)
- 두 vhost 모두 server { } 레벨에 `include snippets/security-headers.conf`
- 추가로 add_header가 있는 location 블록(jpg/png/...html에서 Cache-Control 설정)에도 같은 snippet 재 include — nginx의 add_header inheritance 함정(location-level add_header가 하나라도 있으면 server-level inherit가 통째로 끊김) 우회
- dead code였던 두 번째 regex 블록 삭제

**Cursor Bugbot 후속 정정 (2026-05-08, PR #65 inline review):**

- `X-XSS-Protection`: `1; mode=block` → `0`. OWASP/MDN 권장. 옛 브라우저 auditor 자체가 cross-site leak·신규 XSS를 유발하는 사례 보고됨, Chrome 78에서 이미 제거. 이미 inline CSP(script-src 'self' + sha256)가 modern equivalent. `0` 명시 이유는 (a) 보안 스캐너 헤더 부재 fail 회피 + (b) Google upstream이 보내는 `0`과 일치 → 아래 `/oauth/token` 응답 중복 충돌 자연 해소.
- `Referrer-Policy`: `no-referrer-when-downgrade` → `strict-origin-when-cross-origin`. 이전 값은 모던 브라우저 기본보다 약함 — cross-origin HTTPS에 full URL(reading path 포함)을 보내는 privacy regression이었음. 새 값은 모던 브라우저 기본을 명시(same-origin: full, cross-origin: origin만, http downgrade: 미전송).

**검증 (curl -I):**

| 경로 | 변경 전 | 변경 후 |
|-----|--------|--------|
| `bible.anglican.kr/` | 0 보안 헤더 | 6개 모두 |
| `bible.anglican.kr/gen/1` (HTML5 fallback) | 0 | 6개 |
| `bible.anglican.kr/css/style.css` | 0 | 6개 |
| `bible.anglican.kr/index.html` | 0 | 6개 |
| `dev.anglican.kr/` | 0 | 6개 |
| `dev.anglican.kr/oauth/token` (POST 응답) | Google upstream의 일부 | upstream + 우리 6개 |

**OAuth /token 응답에서 X-XSS-Protection 중복 (Google `0` + 우리 `1`)**: 초기 발견 시점 메모. 후속 Bugbot 정정으로 우리 헤더도 `0`으로 통일되어 충돌 자연 해소.

**적용 절차 (이전 BFF 적용과 동일 패턴):**

1. 로컬에서 snippet + 두 vhost 새 본문 생성
2. scp로 seoul:/tmp 업로드
3. ssh + 백업(`.bak-{timestamp}`) + tee + `nginx -t` + `systemctl reload` (실패 시 자동 롤백)

**저장소 변경:**

- `nginx/security-headers.example.conf` 신규 — 서버의 snippet 미러 + 배포·검증 절차 + add_header inheritance 함정 메모
- `docs/architecture.md` §9 보안 모델에 "브라우저 측면" 절 신규 — 6개 헤더 + inheritance 함정 우회 패턴 명시
- `docs/worklog.md` 본 항목

**프로젝트 영향:**

- SPA 코드 변경 0 → 버전 bump 없음, 배포 사이클 무관 (nginx config 변경만)
- `project_security_headers_backlog.md` #2 ✅ 처리 완료. #3(CSP 리포트)은 1.4.6 prod 안정 1주 후 트리거.

### Phase 2h 단계 6 — dev 환경 분리 + nginx BFF + visibility sync (PR #64)

전날 단계 4·5(Implicit·GIS 제거 + 청소) 머지 후 dev 환경에서 시운전을 시작하면서 발견한 일들을 한 PR로 묶어 처리. 결과적으로 인프라(dev 도메인 + 배포 스크립트), 인증 모델(BFF), 상호작용(visibility sync), 부수 회귀(SW + 검색 UI)까지 한 사이클의 마무리 라운드.

**1. dev.anglican.kr 환경 도입**

서버에 두 vhost(`bible.anglican.kr` 운영, `dev.anglican.kr` 개발)를 분리. docroot는 각각 `/var/www/{bible,dev}` 심볼릭 링크가 가리키는 버전 디렉터리.

코드: `js/drive-sync.js`·`js/sync/debug-log.js`의 호스트 체크 inversion. 기존 `localhost === hostname` → `hostname === "bible.anglican.kr"` (prod 호스트만 명시, 그 외 모두 dev로 fallback). 소스에서 `localhost` 문자열 자체가 사라짐.

Cloud Console: dev OAuth 클라이언트의 Authorized JavaScript origins / redirect URIs에서 `http://localhost:8080`·`/`을 의도적으로 제거. 사용자 PC에 악성 프록시가 같은 포트로 바인딩해 PKCE 흐름을 가로챌 표면 차단.

**2. `scripts/deploy.sh` dev/prod/promote 서브커맨드**

기존 prod 단일 타겟을 분기. `bible-{version}-{shortsha}` 명명으로 같은 버전 반복 배포 시 덮어쓰기 방지. promote는 `ln -sfn $(readlink /var/www/dev) /var/www/bible` — dev에서 검증한 정확한 디렉터리를 prod 심볼릭 링크가 가리키게 됨 (재빌드 X). dirty working tree는 `-dirty` suffix.

스크립트 자체는 SSH 호스트 별칭(`seoul`)만 갖고 실제 호스트·키는 `~/.ssh/seoul` + 1Password에 분리되어 있어 공개돼도 무해 → `.gitignore`에서 제거하고 저장소에 포함.

**3. nginx BFF로 `client_secret` server-side 주입 (ADR-017)**

dev 시운전 중 `/token` 요청이 `400 invalid_request: "client_secret is missing."`로 실패. 원인: Google "Web application" 클라이언트는 PKCE를 써도 `client_secret`을 강제 (RFC 7636 일탈, 다수 라이브러리 issue tracker 확인).

대안:
- A. SPA 임베드 — GitHub secret scanner 자동 무효화 위험 + git 이력 영구 잔존 + OAuth 2.1 위배. **거부**
- B. Desktop app 클라이언트 타입 — redirect URI가 `http://127.0.0.1:port`만 허용, HTTPS 도메인 불가. **거부**
- C. nginx BFF — same-origin `/oauth/token`에 nginx가 `proxy_set_body`로 secret 주입 후 forward. **채택**

구현:
- `js/sync/transport.js`: `_OAUTH_TOKEN_URL = "/oauth/token"` (was `https://oauth2.googleapis.com/token`). 요청 body에서 `client_secret` 제거
- `nginx/oauth-proxy.example.conf` 신규 (저장소 포함, placeholder)
- 두 vhost 모두 `location = /oauth/token` 블록 적용 + `nginx -t` + reload
- 검증: `curl -X POST` 가짜 refresh token → `400 invalid_grant` (secret 주입 정상)
- 회귀 방어: `transport-pkce.test.js`에서 URL 단언 `/oauth/token`, body에 `client_secret` 부재 명시 (`assert.doesNotMatch`)

**4. 탭 활성화 시 자동 sync**

기존 sync trigger 5종(cold start / 로컬 변경 / NET_RECOVERED / backoff / 412 충돌)에 visibility-trigger 추가. `app.js`의 기존 `visibilitychange` 리스너에 visible 분기 → `window.driveSync.requestSync()`. requestSync는 IDLE 상태일 때만 dispatch라 빠른 탭 토글 안전. ETag 304로 변경 없을 때 비용 거의 0.

`js/drive-sync.js`의 `window.driveSync` 공개 API에 `requestSync` 추가, `js/types.d.ts` `DriveSyncFacade`에 시그니처.

**5. 부수 회귀 수정**

- `sw.js`: BFF `/oauth/token` POST 도입 후 SW가 cache-first 로직으로 처리하면서 `cache.put(POST)` TypeError. fetch 핸들러 최상단에 `method !== "GET"` 가드 추가 — Cache API 정의상 GET만 지원하므로 본질적 수정.
- 검색 액션 버튼(`#search-clear`, `#search-history-toggle`) `[hidden]` 무력화: ID 셀렉터의 `display: flex`가 user-agent의 `[hidden] { display: none }`보다 specificity 높아 `el.hidden = true`가 시각적 효과 없이 덮어써짐. `dataset.clearHidden="true"` 트리거 규칙이 history toggle을 clear의 위치로 옮기면서 두 버튼이 정확히 같은 좌표에 스택, X만 보이고 ▾는 뒤에 가려져 "버튼 모양 이상" 외양. 명시적 `[hidden] { display: none }` 규칙 추가로 specificity 동률 이상으로 끌어올림. coding-pitfalls §14에 패턴 등록.
- 모바일 검색 sheet의 ✕ 클릭이 모달 닫히는 회귀: `$searchSheetClear` 핸들러의 `input.focus()`가 `expanded → compact` 전환 리스너를 트리거 → 결과 영역 사라지고 작은 입력 바만 남아 사용자가 "닫혔다"고 인식. `_suppressFocusCompactTransition` flag로 programmatic focus는 전환 차단, 사용자 직접 탭만 전환.

**6. 메모리·문서 동기화**

- `feedback_security_first.md` 신규 — 보안 trade-off는 사용자가 묻기 전에 먼저 명시. 자기 안심성 표현·합리화 금지 (BFF 결정 도중 사용자 지적)
- `feedback_translation_living_docs.md` 신규 — "살아있는 문서"(living document) 직역 회피. "현행 문서"·"지속적으로 갱신하는 문서" 등 사용
- `project_deployment_topology.md` 신규 — bible·dev 동일 서버, 심볼릭 링크 전환 모델
- `project_pkce_deferred.md` 삭제 (PKCE 마이그레이션 완료)

**ADR / 설계 문서**

- ADR-017 신규: nginx BFF로 `client_secret` 격리 — 위협 모델, 대안 평가, 운영 노트
- ADR-011 §미결 사항 갱신: redirect URI 등록 ✅ + BFF 도입 ✅
- `docs/design/pkce-migration.md` §10 최종 상태 (2026-05-08) 신규 — 5단계 + 단계 6 완료, BFF detour 회고
- `docs/coding-pitfalls.md` §14 신규 — `display: flex`가 `[hidden]` 무력화 패턴

**1.4.6 릴리스**

`scripts/release.py patch`로 version.json + sw.js SHELL_CACHE 동시 bump. dev에서 시운전 후 (PR 머지 → 태그 → GitHub Release → `deploy.sh promote`) 사이클로 prod 승격 예정.

### 수정 파일 요약

| 파일 | 변경 |
|---|---|
| `js/drive-sync.js` | host 체크 inversion (prod만 명시) + `requestSync` 노출 + secret 임베드 시도 흔적 제거 |
| `js/sync/debug-log.js` | host 체크 inversion |
| `js/sync/transport.js` | `_OAUTH_TOKEN_URL = "/oauth/token"`, body에서 `client_secret` 제거 |
| `js/sync/state-machine.js` | 호출부 인자 정리 |
| `js/types.d.ts` | `DriveSyncFacade.requestSync` 추가 |
| `js/app.js` | visibilitychange visible 분기 → `requestSync()`, sheet clear의 focus compact 전환 차단 flag |
| `sw.js` | fetch 핸들러 최상단에 `method !== "GET"` 가드 |
| `css/style.css` | 검색 버튼 위치 4px gap, `[hidden]` 명시 규칙 (data·sheet 양쪽) |
| `tests/unit/transport-pkce.test.js` | URL 단언 + `client_secret` 부재 명시 |
| `scripts/deploy.sh` | dev/prod/promote 서브커맨드 (저장소 신규) |
| `nginx/oauth-proxy.example.conf` | 신규 — BFF location 블록 예시 |
| `.gitignore` | `scripts/deploy.sh` 제거, `*_client_secret_*.json` 추가 |
| `docs/decisions/017-oauth-bff-proxy.md` | 신규 ADR |
| `docs/decisions/011-bookmark-sync.md` | BFF 개정 블록 + 미결 사항 갱신 |
| `docs/design/pkce-migration.md` | §10 최종 상태 신규 |
| `docs/coding-pitfalls.md` | §14 신규 |
| `docs/architecture.md` | §1·§4.3·§9 다이어그램 + 보안 모델 + 배포 절차 갱신 |
| `README.md` | Drive 동기화 표 + 프로젝트 구조 + ADR 인덱스 갱신 |
| `CLAUDE.md` | 현재 상태 Phase 2h 완료 + 단계 6 + nginx/ 디렉터리 |
| `version.json`, `sw.js` | 1.4.6 |

### 동기화 사이클 캐시 (Phase 2i, PR #73)

같은 세션 안에서 반복되는 Drive `files.list`(파일 ID 조회) + `files/{id}` 메타(etag) 다운로드를 매 동기화마다 하지 않도록, 상태 머신에 fileId·etag·lastSyncedAt 메모리 캐시를 도입. localStorage `bible-drive-sync-{cache,etag,updated}` 3-key로 분리 저장 — 한쪽 파편 손상돼도 다른 키가 그래스풀하게 폴백. signOut / NEEDS_CONSENT 진입 시 `_clearCache()`로 비워 다음 계정으로의 잔재 방지.

순수 round-trip 단축 최적화로 사용자 가시 변화 없음 — sync 트리거 후 인식 가능한 지연이 줄어드는 정도. 회귀 가드는 state-machine 유닛 테스트가 cache 일관성 단언을 포함.

### 북마크 UX 회귀 fix 모음 (#70 / #71 / #72)

- **#70**: 북마크 시트 행 높이가 일부 항목에서 어긋나고 모바일 드래그-재정렬이 끊기던 문제. 행 컴포넌트의 패딩/높이 일관화 + 터치 이벤트 핸들러 정리.
- **#71**: 북마크 드로어가 닫혔다가 다시 열릴 때 stale 좌표를 들고 있어, 같은 폴더에 드롭한 게 머지 권유로 잘못 인식되던 문제. 드로어 열기 시점에 좌표 재측정.
- **#72**: 롱프레스 드래그 진입 직후 고스트 요소의 top이 0으로 튀던 문제. 진입 시점의 pointer Y를 초기값으로 고정.

### 오디오 플레이어 총 재생시간 미리 표시

기존에는 사용자가 재생 버튼을 누른 뒤에야 메타데이터가 로드되어 길이가 채워졌다. 트랙이 보이는 순간(시트 마운트) preload 메타데이터를 살짝 끌어와 길이를 미리 표시 — 사용자가 듣기 전에도 분량을 가늠할 수 있게.

### 선택된 마지막 절 hover 라운드 회귀 fix

여러 절을 드래그 선택한 뒤 마지막 절에 hover하면 라운드 처리가 빠지던 회귀. CSS `:hover` 셀렉터 우선순위가 선택 상태 클래스에 가려져 발생. 명시도 정렬로 해소.

---

## 2026-05-07

### Phase 2h 단계 4·5 — GIS / Implicit Flow / FedCM 의존 제거 (PR #57·#61)

단계 3에서 PKCE를 GIS와 공존시킨 뒤, 이번 라운드에서 GIS·Implicit·FedCM 흔적을 모두 제거. 데스크탑·Android·iOS 동일 PKCE 단일 경로.

**단계 4 — 코드 제거 (PR #57)**

- `transport.js`: GIS wrapper 7종(`requestSilentAccessToken`, `prompt`, `revoke`, `disableAutoSelect`, `cancel`, `notifyParentClose`, `getProfile`), `beginRedirectAuth` (Implicit), `consumeRedirectCallback` (Implicit) 제거. PKCE 함수가 canonical 이름 인계 (`beginRedirectAuthPKCE` → `beginRedirectAuth`)
- `state-machine.js`: 상태 6개로 축소 (`INITIALIZING`, `IDENTIFYING`, `AUTHENTICATING` 제거). `_promptIdentity`, `_reqSilentToken`, `_tokenClient`, GIS_READY/IDENTITY_OK/IDENTITY_FAIL 이벤트 제거. `enable()`은 silent refresh → IDLE / NEEDS_CONSENT (이전엔 GIS dispatch로 폴백)
- `drive-sync.js`: `_pollGis`, `_startPollingGis`, `__pendingRedirectToken` 처리 제거. `signIn()`은 머신 dispatch 없이 `transport.beginRedirectAuth` 직접 호출
- `index.html`: `<script src="https://accounts.google.com/gsi/client">` 제거, CSP의 `accounts.google.com` 제거
- `types.d.ts`: GsiTokenClient, GsiTokenResponse 등 GIS 타입 제거
- 테스트: `state-machine.test.js`에서 iOS-only 분기 / FedCM / silent-blocked 시나리오를 단일 경로로 통합. 케이스 수 30+ → 26 (PKCE 단일 경로의 race·콜백·refresh 회복 모두 회귀 방어 유지)

**Bugbot PR #57 — IDB await 갭 race 가드 (commit `f090c83`)**

`_attemptSilentRefresh`가 `await refreshAccessToken(...)` 직후 race 가드를 통과해도, 이후 `await refreshStore.saveRefreshToken(...)` (rotation) 또는 `await refreshStore.clearRefreshToken()` (invalid_grant) IDB await 동안 사용자가 `disable()`을 호출하면 후속 `_transition(IDLE/NEEDS_CONSENT)`이 다시 `SYNC_ENABLED_KEY = "1"`로 덮어씀. 단계 4 후 `enable()`이 동기적으로 DISABLED를 빠져나가지 않으므로 state-based 가드만으로 cold-start 경로 보호 불가. 매 await 직후 flag-based 가드 추가. `coding-pitfalls.md` §11 갱신.

**단계 5 — 정리 (PR #61)**

- `bible-drive-silent-blocked` localStorage one-shot cleanup IIFE (`drive-sync.js` 부팅 시 `removeItem` — 미사용 키 제거. 몇 릴리스 후 cleanup 코드 자체도 제거)
- `coding-pitfalls.md` §11~13 신규: race 가드 단일 체크포인트 함정, OAuth callback URL 데이터 leak, sessionStorage 키 격리
- `docs/audit/2026-05-07-pkce-refresh-token.md` 보안 감사: Critical/High/Medium 0건
- README.md PKCE 단일 경로로 갱신 (Drive 동기화 표)

### 단계 3 후속 — Bugbot PR #54 race·legacy reauth 가드 (3차)

단계 3 머지 직후 Bugbot이 발견한 잔여 결함을 3회에 걸쳐 정정.

- 1차 (`b3fd034`): 사용자 disconnect 감지 — `_attemptSilentRefresh`가 `_state` 가드만 가짐. `disable()` 후엔 `_state`가 정상 진행 중인 값이지만 `localStorage["bible-drive-sync"]`는 `"0"` → state 가드만 통과시켜 IDLE/NEEDS_CONSENT로 전이하면 사용자가 끊은 sync를 다시 살림. `localStorage.getItem(SYNC_ENABLED_KEY) === "0"` 검사 추가
- 2차 (`605465d`): PKCE callback URL leak — Implicit Flow 시절 IIFE는 `bad_state`/`no_state`/`state_mismatch` fallback에서 `location.pathname + location.search`로 search 보존. PKCE callback은 query string (`?code=...`)이라 같은 fallback이 auth code를 URL bar에 leak. `location.pathname`만 남기고 search/hash 둘 다 폐기. SYNCING race 가드 조건부 — `fromReauth=true` (401 reauth 경로)일 때만 SYNCING에서도 override 허용
- 3차 (`ae83cbd`): legacy reauth path가 `_machine.isAuthenticated()`만 체크하고 DISABLED race는 안 잡음 — 대칭적으로 가드 추가

`coding-pitfalls.md` §11·§12·§13에 패턴 정착.

---

## 2026-05-06

### Phase 2f 머지 + Cursor Bugbot 6차 리뷰 정제 (ADR-011)

전날(2026-05-05) 작성한 Phase 2f(iOS OAuth 풀페이지 리디렉션) 코드를 PR #37로 올린 뒤 Cursor Bugbot이 단계적으로 6차에 걸쳐 보안/안정성 결함을 지적해 모두 흡수한 후 머지. 새로운 결정 사항은 없으며 동작 계약을 명시화.

**1차 — redirect counter 무한 루프 + state nonce CSRF**

- localStorage `bible-drive-redirect-attempts` 카운터 키가 두 곳(`state-machine.js` `_handleSyncFail`, `drive-sync.js` `signIn`)에 하드코딩 → 한쪽 갱신 누락 시 카운트 무력화. 단일 상수로 통일.
- `consumeRedirectCallback()` state nonce 검증을 강화. nonce 미일치 시 returnTo를 무시하고 ERROR 진입.

**2차 — 에러 콜백 미처리 + returnTo 손실**

- GIS Token Client 콜백이 `error`만 있고 `access_token`이 없는 응답에서 `_handleAuthFail` 미호출. 명시 분기 추가.
- 풀페이지 리디렉션 시 `returnTo` sessionStorage 키가 callback 흡수 후에만 정리돼야 하는데 부팅 IIFE가 일찍 정리해 두 번째 새로고침에서 returnTo `/` 회귀.

**3차 — untrusted 에러 returnTo "/" 이탈 + `_beginRedirect` 조건부 return**

- OAuth callback의 `error_uri`가 `accounts.google.com` 도메인이 아닌 경우(피싱·중간자 의심) returnTo를 `/`로 강제 이탈시키지 않고 ERROR + 사용자 안내.
- `_beginRedirect`이 cap 초과 시 ERROR 전이 후에도 후속 코드를 실행해 `_refreshUI` 이중 호출. `_transition` 직후 early return 추가.

**4차 — `expiresIn` dead data + iOS 401 NEEDS_CONSENT 전환**

- `acceptRedirectToken(token, expiresIn)` 시그니처에서 `expiresIn` 미사용 — 시그니처에서 제거.
- iOS 환경 401 분기가 GIS-only 흐름을 가정해 `_isUserActivelyReading()` 휴리스틱 적용 전에 자동 리디렉션을 시도. NEEDS_CONSENT로 먼저 전환 후 사용자 활동 여부 평가.

**5차 — cap 초과 시 NEEDS_CONSENT→ERROR 이중 전환 방지**

- cap 초과 후 코드 흐름이 NEEDS_CONSENT 진입 후 다시 ERROR로 두 번 전이하며 `_refreshUI`가 두 번 호출되던 결함. `_transition` 단일 호출로 ERROR 직진.

**6차 — `_refreshUI` 이중 호출 + transport 미사용 필드**

- `_handleSyncFail` 401 핸들러가 `_transition(NEEDS_CONSENT)` 후 명시적으로 `_refreshUI()`를 또 호출 — `_transition`이 이미 트리거하므로 제거.
- `transport.js` 모듈에 `_lastIdentityClient` 같은 미사용 캐시 필드 정리.

**7차 — redirect attempts 키 중복 하드코딩 (별도 push)**

- 1차에서 통일한 키가 한 곳에 다시 등장. 상수 export로 강제 단일화.

**부수 변경**

- 설정의 Drive 정보 버튼 `aria-label` 명시화 (5585f68).

### SW 업데이트 토스트 버전 표시 fix (PR #38)

증상: 새 버전이 배포돼 서비스 워커가 업데이트되면 토스트가 "버전 X.Y.Z로 업데이트하시겠습니까?"를 띄우는데, 표시되는 버전이 **현재 버전**이었음. 원인: `controllerchange` 이벤트 시점에 `version.json`을 새로 fetch하지 않고 캐시된 값을 사용. `js/app.js`의 토스트 핸들러가 `?bust=Date.now()` 쿼리로 `version.json`을 재요청하도록 수정.

### TypeScript 점진 도입 (ADR-012)

빌드 단계 추가 없이 `// @ts-check` + JSDoc + `tsconfig.json --noEmit` 조합으로 정적 검사 도입.

**파운데이션** (`ebc069c`):
- `tsconfig.json` (DOM lib) + `tsconfig.worker.json` (WebWorker lib) 분리
- `js/types.d.ts` — 도메인 타입 단일 출처 (MTimed, BookmarkFlatRow, SyncDocV2, SyncEvent, GIS 응답 타입, window 싱글톤 augment)

**파일별 적용**:
- `js/sync/debug-log.js` (7def860)
- `js/sync/transport.js` (73d0765)
- `js/sync/store-v2.js` (babcb86)
- `js/sync/state-machine.js` (7c0ab00)
- `js/drive-sync.js` (72bca31)
- `js/search-worker.js` (655b62b, 워커 전용 tsconfig)

`js/app.js`는 다음 사이클로 보류.

검증: `npx tsc -p tsconfig.json --noEmit` + `npx tsc -p tsconfig.worker.json --noEmit` 모두 0 error. 브라우저 동작 무변화.

### GIS 토큰 콜백 빈 응답 stuck 방지 (PR #40, ADR-011)

비-iOS 환경에서 GIS Token Client 콜백이 `error` 없이 `access_token`도 없는 빈 응답을 던지는 케이스 발견(쿠키 정책·세션 만료·third-party iframe 차단). 기존 코드는 `response.error`만 분기 처리해 `AUTHENTICATING` 상태에서 무한 대기.

수정 (`js/sync/transport.js` + `js/sync/state-machine.js`): 콜백이 호출됐는데 두 필드 모두 없으면 `IDENTITY_FAIL { reason: "empty_response" }` 발화. 상태 머신은 NEEDS_CONSENT로 흡수해 사용자 escape hatch(설정의 "연결" 버튼)에 의존.

### state-machine 유닛 테스트 + CI 워크플로우 (PR #42, ADR-013)

`tests/unit/state-machine.test.js` + `tests/unit/harness.js` 신규. **Node 자체 테스트 러너 (`node --test`)** 위에서 `node:vm`으로 격리 컨텍스트를 만들고 브라우저 글로벌(`window`, `localStorage`, `navigator`, `document`, `setTimeout`)을 스텁. 테스트 의존성 0, Node 24 내장만 사용.

검증 시나리오 30+:
- ENABLE 분기: iOS → NEEDS_CONSENT (Phase 2f 회귀 방어)
- Identity/Token 흐름, NEEDS_CONSENT escape hatch
- SYNC_FAIL reasons: 401 / 412 / no_token / exception / 기타 (backoff)
- NET_RECOVERED 분기, redirect attempts cap, GIS 빈 응답 흡수
- `_transition` 기본 리셋 계약

`.github/workflows/test.yml`에 `unit` job 추가 (`node --test tests/unit/state-machine.test.js`).

### 1.4.3 릴리스 (ef93298)

`scripts/release.py`로 `version.json` + `sw.js` `CACHE_NAME` 동시 bump.

### Phase 2g — iOS 앱 재실행 시 silent 자동 리디렉션 (ADR-011, 3cb40ec)

**증상**: iOS PWA에서 한 번 "연결" 성공한 뒤 앱을 종료하고 다시 열면 동기화가 해제된 것처럼 보임 (설정 화면에 "연결" 버튼 다시 노출). ADR-011 Phase 2f 동작 매트릭스의 "iOS PWA standalone | 페이지 로드 동작: 풀페이지 리디렉션" 항목과 실제 구현이 어긋나 있었음 — Phase 2f 코드는 hash callback이 없으면 무조건 NEEDS_CONSENT로 파킹.

**원인**: Implicit Flow는 refresh token을 발급하지 않고, in-memory `_token`은 앱 종료와 함께 사라짐. Phase 2f는 401 발생 시점에만 hybrid 자동 재인증을 수행했고, 토큰 자체가 없는 cold start 경로는 사용자 제스처 대기로 떨어졌음.

**수정**:
- `state-machine.js` `DISABLED + ENABLE` iOS 분기에서 저장된 email이 있고 silent-blocked 플래그가 없으면 `_beginRedirect("none")` 자동 호출.
- `transport.js` `beginRedirectAuth`가 sessionStorage state에 `silent` 필드 저장, `consumeRedirectCallback`이 모든 반환에 silent 포함.
- `drive-sync.js` IIFE: silent 실패는 사용자-facing 토스트 없이 `bible-drive-silent-blocked=1`만 설정 (자동 background 시도의 정상적 실패 경로). `signIn`/`signOut`에서 플래그 정리, `SYNC_DONE` 시 defense-in-depth로 추가 정리.
- `types.d.ts`: `RedirectCallbackResult.silent: boolean` 필수 필드, `Window._syncSilentBlockedKey?: string` 추가.

**회귀 테스트** (`tests/unit/state-machine.test.js`): 케이스 3 갱신 + 3a~3e 신규 (총 20개 통과). cap 도달 / silent-blocked / 빈 email 경계 케이스 + SYNC_DONE 플래그 정리.

**알려진 한계**: 매 cold start에 accounts.google.com round-trip 1회 (느린 망에서 ≤ 3초 깜박임), iOS Safari 7일 ITP 후 storage 정리 시 첫 연결 흐름으로 회귀, 외부 revoke 감지 시 silent-blocked=1로 자동 진정.

### README 플랫폼별 동작 차이 섹션 (ade9f10)

설치(`beforeinstallprompt` vs iOS Add to Home Screen)와 Drive 동기화(GIS+FedCM vs OAuth Implicit Flow + 풀페이지 리디렉션)의 플랫폼 분기를 표로 정리. iOS Safari ITP·refresh token 부재로 인한 cold start 깜박임 등 알려진 한계도 명시.

### 수정 파일 요약

| 파일 | 변경 |
|---|---|
| `docs/decisions/011-bookmark-sync.md` | Phase 2f 후속 정제 절 추가 (Bugbot 6차 + GIS 빈 응답) + Phase 2g 절 추가 |
| `docs/decisions/012-typescript-incremental-adoption.md` | 신규 ADR |
| `docs/decisions/013-client-js-unit-tests.md` | 신규 ADR |
| `tsconfig.json`, `tsconfig.worker.json` | 신규 |
| `js/types.d.ts` | 신규 도메인 타입 단일 출처 + Phase 2g `silent` 필드 |
| `js/sync/*.js`, `js/drive-sync.js`, `js/search-worker.js` | `// @ts-check` + JSDoc 적용 |
| `js/sync/state-machine.js`, `js/sync/transport.js`, `js/drive-sync.js` | Phase 2f 6차 정제 + 빈 응답 흡수 + Phase 2g silent 자동 리디렉션 |
| `tests/unit/harness.js`, `tests/unit/state-machine.test.js` | 신규 + Phase 2g 회귀 케이스 5건 |
| `.github/workflows/test.yml` | unit job 추가 |
| `version.json`, `sw.js` | 1.4.3 |
| `README.md` | 플랫폼별 동작 차이 섹션 추가 |
| `CLAUDE.md` | 프로젝트 구조 + 현재 상태 갱신 (TS·유닛 테스트·Phase 2f/2g) |

---

## 2026-05-05

### 검색 UI 재설계: 컴팩트 모달 → 결과 시트 + `in:` 연산자

기존에는 검색 FAB를 누르는 즉시 55vh 바텀 시트가 열리고 입력 중에 라이브 검색이 실행돼 결과가 키보드 위 비좁은 공간에 떠올랐다. 키보드와 결과가 시각적으로 겹쳐 답답하다는 피드백을 반영해 진입을 두 단계로 분리하고, 책 범위 한정 연산자 `in:`을 도입했다.

**상태 모델 (`#search-sheet[data-state]`)**

- `compact`: 입력바 + 칩 행만 키보드 위에 떠 있음 (height 6.4rem 고정, 좌·우·아래 0.75rem 마진, 사방 그림자 카드 형태). 결과·핸들 숨김.
- `expanded`: 55vh 시트 + 결과 표시. 키보드는 닫힌 상태. 좌·우·아래 0.75rem 마진을 가진 카드 형태로 통일 (전 사이드 둥근 모서리).
- 트리거: FAB/헤더 검색바 → `compact`, Enter → `expanded`, `/search?q=...` 진입 시 곧장 `expanded`(focus 생략).
- 추가 트리거: 결과를 보여주는 expanded 상태에서 입력창에 다시 포커스 → `compact` 복귀 (결과·notice 정리, 키보드 위로 떠오름). 키보드 추정 오프셋(280px)을 단일 단계 트랜지션 시작점으로 사용 후 260ms 후 실측값으로 부드럽게 보정.

**Enter 전이 + 라이브 검색 제거**

`$searchSheetInput.blur()` → `_suspendKeyboardAdjust = true` → `requestAnimationFrame`에서 인라인 스타일 클리어 후 `data-state="expanded"` + `runSheetSearch()`. visualViewport.resize가 transition을 끊지 못하도록 260ms 동안 `adjustSheetForKeyboard`를 일시 정지. CSS `transition: height 220ms, bottom 220ms`로 부드럽게 자라남. 라이브 검색(400ms debounce)은 모바일·데스크톱 모두 폐기 — `사랑 in:요한` 같은 다중 토큰 입력에서 중간 키 입력마다 의미 없는 부분 문자열 검색이 발화하는 문제. 기존 `sheetDebounceTimer`/`sheetAutoNavTimer`/`searchDebounceTimer`/`searchAutoNavTimer` 죽은 코드도 함께 제거.

**`in:` 연산자**

- `js/search-worker.js` `parseQuery(raw)`가 `IN_RE = /(?:^|\s)in:(\S+)/g`로 토큰 추출, `meta.aliases`로 책 ID 해석.
- `gatherResults`에 `restrictBooks: Set<bookId>` 인자 추가. 비어있지 않으면 해당 책만 통과 (다중 = OR).
- 매칭 실패한 별칭은 `unmatchedScopes` 페이로드로 메인 스레드에 전달 → `#search-sheet-notice`에 inline 안내. unmatched가 있으면 검색 자체를 차단해 사용자 의도와 어긋난 결과를 막음.

**칩 UI**

- `#search-sheet-chips` 툴바에 `+ in:` 칩 1개. 탭하면 입력창 끝에 ` in:` 삽입 + 커서를 `:` 뒤에 위치.
- `pointerdown.preventDefault`로 input 포커스를 유지 — IME가 닫혔다 다시 뜨는 깜박임 방지.
- `data-chip` 속성으로 향후 칩 추가 시 마크업만 늘리고 JS는 switch 분기.

**모바일 헤더 검색바 위임**

- `$searchInput`에 `pointerdown.preventDefault` + 폴백 focus 핸들러 추가 → `isMobile()` 분기에서 `openSearchSheet("")`로 위임.
- 데스크톱(>768px)은 기존 `/search` 라우트 흐름 + 라이브 검색 그대로.

**스크림 + 스크롤 잠금 강화**

- `#search-scrim` 불투명도 0.35 → 0.45 + `backdrop-filter: blur(8px)`로 모달 분위기 강화.
- `touch-action: none` 추가 → iOS rubber-band가 본문을 끌어당기지 못하도록 차단.
- `#search-sheet-results`에 `overscroll-behavior: contain` → 결과 리스트 끝에서 body로 스크롤 체이닝 차단.
- 기존 `body.position = fixed` + `_searchSheetAppliedScrollLock` 가드는 그대로 유지.

**기타 정리**

- iOS sliver `#search-sheet::after` 제거 — 시트가 사방 마진을 둔 카드로 떠 있게 되면서 form-accessory bar 영역을 따로 가릴 필요가 없어짐 (스크림이 직접 채움).

**ADR-005 개정**

`docs/decisions/005-search-indexing-strategy.md`에 "검색 연산자 `in:` 도입" 섹션 추가. 문법, 매칭 정책(OR/unmatched=block), 구현 위치(`parseQuery`/`gatherResults`/`unmatchedScopes`) 명시.

**파일 변경**

| 파일 | 변경 |
|---|---|
| `index.html` | `#search-sheet-chips`, `#search-sheet-notice` 행 신규 |
| `css/style.css` | `#search-sheet[data-state]` 분기, `.search-chip` 스타일, transition 220ms |
| `js/app.js` | `data-state` 토글, Enter 전이, `_suspendKeyboardAdjust`, 칩 핸들러, 헤더 위임 |
| `js/search-worker.js` | `IN_RE`, `parseQuery`, `restrictBooks`, `unmatchedScopes` |
| `docs/decisions/005-search-indexing-strategy.md` | `in:` 연산자 섹션 추가 |

### Phase 2e: FedCM-mandatory deprecation 마이그레이션 (ADR-011)

콘솔에 반복 출력되던 GSI deprecation 경고와 `[GSI_LOGGER]: FedCM get() rejects with AbortError` 로그를 제거했다. Phase 2d 코드가 `google.accounts.id.prompt()`에 콜백을 등록하고 `isNotDisplayed`/`isSkippedMoment`/`isDismissedMoment` 트리오로 prompt 결과를 분기했는데, FedCM 마이그레이션 가이드가 앞 두 메서드를 deprecated 처리한다. 검증 결과 **콜백 등록 자체**가 경고 트리거였다 — `isDismissedMoment`만 사용해도 경고가 사라지지 않음.

**transport.js**
- `promptIdentity()` 시그니처를 무인자로 변경 — `google.accounts.id.prompt()`만 호출.
- 성공은 `initIdentityClient`에 등록한 credential 콜백에서 수신.
- deprecated notification 메서드 호출 모두 제거.

**state-machine.js (반복 시행)**
1. 1차 시도: deprecated 메서드 호출만 제거하고 `IDENTITY_TIMEOUT_MS = 10000` wall-clock timer 도입 → 콘솔 경고 일부만 사라짐.
2. 2차 시도: `prompt()` 콜백 자체 제거 → 경고 완전히 사라짐.
3. 회귀 발견: 다계정 사용자가 FedCM 다이얼로그에서 10초 이상 결정하는 동안 timer가 발화해 `cancelIdentityPrompt()`로 다이얼로그 강제 종료. 사용자 escape hatch가 OAuth 팝업으로 강제 fallback되는 UX 회귀.
4. 3차 시도: timeout 폴백 자체 제거 — Google FedCM 가이드가 *앱이 FedCM UI 수명을 통제하지 말 것*을 권고. 사용자가 명시적으로 "연결" 버튼을 누를 때까지 대기. 설정의 항시 노출되는 "연결" 버튼이 escape hatch 역할.

**테스트**
- `tests/e2e/test_drive_sync.py`의 `GIS_STUB` 정리: `prompt()`를 새 무인자 시그니처에 맞춤. dead-code였던 `__gisForceIdentityFail` 경로(deprecated 메서드 시뮬레이션) 삭제.
- 8개 시나리오 모두 정상 통과 (업로드/다운로드, 동시 추가, 412 재시도, sign-out, v0 마이그레이션, 연결 해제 modal, 진단 정보 복사).

**검증 결과**
- 클린 환경 콘솔: GSI deprecation warning 0건, AbortError 0건, FedCM 관련 에러 0건 (auth flow 정상 14초 완주).
- 다계정 환경: 사용자가 천천히 결정해도 FedCM 다이얼로그 강제 종료 없음.
- Auto re-authn rate limit(10분에 1회)은 Google 측 보안 정책으로 코드 통제 불가능 — 두 번째 새로고침에서 다이얼로그가 다시 뜨는 라운드로빈 동작은 정상.

**알려진 무해한 부산물**
- `accounts.google.com/gsi/status` 엔드포인트의 **403 Forbidden**: GIS 라이브러리 내부 FedCM 사전 탐지 폴링. localhost가 OAuth 클라이언트의 정식 등록 origin이 아니라서 일관되게 발생. 인증 실제 동작과 무관.

### 수정 파일 요약

| 파일 | 변경 |
|------|------|
| `js/sync/transport.js` | `promptIdentity()` 무인자화, 콜백 인자 및 deprecated 노티피케이션 처리 제거 |
| `js/sync/state-machine.js` | `IDENTITY_TIMEOUT_MS`/`_makeIdentityTimer`/`_ctx.identityTimer` 도입 후 폐기, `_promptIdentity` 단순화 |
| `tests/e2e/test_drive_sync.py` | `GIS_STUB`의 `prompt`를 새 시그니처에 맞춤, `__gisForceIdentityFail` dead-code 제거 |
| `docs/decisions/011-bookmark-sync.md` | Phase 2e 추가 |

---

## 2026-05-02

### Phase 2b: Google Drive 자동 동기화 구현 (ADR-011)

북마크·설정·마지막 읽기 위치를 Google Drive `appDataFolder`에 저장해 기기 간 자동 동기화를 구현했다.

**drive-sync.js (신규)**
- GIS Implicit Token Flow 기반 OAuth 인증 (Client Secret 불필요, SPA 표준)
- `_accessToken` 메모리 전용 저장 — localStorage 미사용 (XSS 토큰 탈취 방지)
- `_silentSignIn()`: 기존 동의 사용자는 팝업 없이 자동 재인증 (`prompt: ""`)
- `_downloadAndMerge()`: 앱 시작 시 Drive ↔ 로컬 `updatedAt` 비교, 최신 기준 merge
- `scheduleUpload()`: 북마크·설정 변경 시 300ms debounce 후 즉시 업로드
- `_isRefreshing` 플래그: 동시 401 응답 시 중복 재인증 방지 (보안 수정 포함)
- `res.json()` try-catch: 예상치 못한 응답(HTML 유지보수 페이지 등) 파싱 오류 방어 (보안 수정 포함)
- scope: `drive.appdata email` (전체 Drive 미요청, 앱 전용 폴더 한정)
- `initDriveSync` 최대 20회 재시도 — GIS 스크립트 로딩 지연 대비

**앱 연동 (app.js)**
- 설정 팝오버에 Drive 동기화 섹션 추가: 연결/해제 버튼, 연결된 계정 이메일 표시
- 북마크·설정 변경 훅에 `driveSync.scheduleUpload()` 연결

**인프라 (index.html, sw.js)**
- CSP에 `accounts.google.com`, `googleapis.com` 출처 추가
- GIS 클라이언트 스크립트 비동기 로드 (`<script async>`)
- SW에서 Google API 요청 캐시 바이패스 (Network-only)
- `CACHE_CLEAR_ON_UPDATE` 시 폰트 캐시 보존

**보안 감사 및 수정**
- 감사 범위: `feat/drive-sync` 브랜치 전체 변경 파일
- Medium 2건 수정: `_isRefreshing` 플래그(동시 401 레이스 컨디션), `res.json()` try-catch(파싱 미보호)
- Info 2건 수용: GIS SRI 미적용(CSP 도메인 제한으로 완화), 개발용 Client ID(공개 정보, 비밀 아님)
- 감사 보고서: `docs/audit/2026-05-02-171111.md`

### 수정 파일 요약

| 파일 | 변경 유형 |
|------|-----------|
| `js/drive-sync.js` | 신규 — GIS OAuth + Drive API 동기화 모듈 (288줄) |
| `js/app.js` | 수정 — 설정 팝오버 Drive 섹션, scheduleUpload 훅 |
| `css/style.css` | 수정 — Drive 동기화 설정 UI 스타일 |
| `index.html` | 수정 — CSP 출처 추가, GIS 스크립트 로드 |
| `sw.js` | 수정 — googleapis.com 캐시 바이패스, 폰트 캐시 보존 |
| `docs/audit/2026-05-02-171111.md` | 신규 — 보안 감사 보고서 |

---

## 2026-04-30

### Phase 2a: 북마크 내보내기/가져오기 (ADR-011)

서버 없이 북마크를 JSON 파일로 백업·복원하는 기능을 구현했다.

- **내보내기**: 드로어 툴바에서 `bible-bookmarks-YYYY-MM-DD.json` 다운로드. 파일 형식: `{ _version: 1, exportedAt, bookmarks }` (향후 마이그레이션 대비 버전 필드 포함)
- **가져오기**: JSON 파일 선택 → 유효성 검증 → 병합/덮어쓰기/취소 확인 모달. 병합 시 `id` 기준 중복 제거, 폴더 `children` 재귀 처리
- **오버플로 패널**: 자주 쓰지 않는 내보내기/가져오기 버튼을 `#bm-overflow-btn`(⋯) 뒤에 숨기고, 클릭 시 오른쪽으로 확장
- **모바일 배치**: 툴바를 CSS `order`로 북마크 목록 아래로 이동
- **SPA 라우터 버그 수정**: `blob:` URL을 앵커 클릭 핸들러에서 예외 처리해 내보내기 파일 저장 시 SPA 라우팅 충돌 방지

### 설치 넛지 자동 노출

앱 미설치 사용자(iOS Safari, Android)에게 설치를 유도하는 알림을 자동으로 표시하도록 구현했다.

- **노출 조건**: 플랫폼 `ios-safari`·`android` 한정, 첫 방문에 노출, 이후 3회마다 재노출
- **다시 열지 않음**: 모달 하단 체크박스 체크 후 닫으면 `neverShow: true`를 localStorage에 저장, 이후 방문에서 완전 차단
- **상태 저장**: `bible-install-nudge` localStorage 키 (`visits`, `nextShow`, `neverShow`)
- **노출 지연**: 콘텐츠 렌더링 후 1.5초 지연으로 UX 간섭 최소화

### 개인정보처리방침 링크 및 privacy.html 개선

- **설정 팝오버**: "서비스 © 대한성공회" 아래에 개인정보처리방침 링크 추가 (`/privacy.html`, `target="_blank"`)
- **테마 동기화**: `privacy.html`에 인라인 스크립트 추가 — 페이지 로드 직전 `bible-theme`·`bible-color-scheme`을 읽어 `data-theme`·`data-color-scheme` 속성 적용, 시스템 테마 변경도 실시간 반영
- **CSS 변수**: 메인 앱과 동일한 속성 선택자 구조(navy/버건디/초록/보라)로 교체

### SW 개선

- `/privacy.html` SHELL_FILES 추가 (오프라인 지원)
- navigation 요청 처리: `standalonePages` 목록 기반 예외 처리로 `/privacy.html`을 SW SPA 라우팅 우회에서 제외
- `CACHE_NAME` → `"rev-38"` 범프

### 수정 파일 요약

| 파일 | 변경 유형 |
|------|-----------|
| `index.html` | 수정 — 오버플로 패널, 내보내기/가져오기 버튼, import 모달, `#bm-import-input` |
| `js/app.js` | 수정 — export/import 함수군, 오버플로 토글, 설치 넛지, never-show 체크박스, privacy 링크, blob URL SPA 버그 수정 |
| `css/style.css` | 수정 — `#bm-import-modal`, `#bm-overflow-panel`, `.install-never-show-row` 스타일 |
| `privacy.html` | 수정 — 테마 동기화 인라인 스크립트 및 CSS 변수 구조 교체 |
| `sw.js` | 수정 — `privacy.html` 캐싱, navigation 예외, `rev-38` |
| `docs/decisions/011-bookmark-sync.md` | 수정 — Phase 2a 완료 기록 |
| `tests/e2e/test_bookmark_export_import.py` | 신규 — Phase 2a E2E 테스트 21개 |
| `tests/e2e/test_install_guide.py` | 수정 — 넛지 + never-show 테스트 13개 추가 |
| `tests/e2e/test_bookmark.py` | 수정 — 텍스트 픽스처 문자열 수정 |

---

## 2026-04-26

### iOS ITP 경고 문구 추가 + ADR-011 Phase 2 계획 착수

iOS Safari의 7일 비활성 자동 삭제(ITP) 위험을 사용자에게 알리고, 서버 동기화 계획을 ADR로 기록했다.

- `js/app.js`: iOS Safari 설치 안내 모달(`ios-safari`, `ios-other`) 하단에 북마크 유지 경고 문구 추가
  ("홈 화면에 추가하면 북마크가 영구 보존됩니다. Safari에서만 열면 7일 이상 방문하지 않을 경우 북마크가 삭제될 수 있습니다.")
- `css/style.css`: `.install-bookmark-notice` 스타일 추가 (라이트/다크 모드)
- `docs/decisions/011-bookmark-sync-phase2.md`: 신규 ADR 작성
  - Phase 2a: 내보내기/가져오기 (즉시 착수 가능)
  - Phase 2b: 서버 동기화 (검토 중)

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — 설치 안내 경고 문구 |
| `css/style.css` | 수정 — `.install-bookmark-notice` 스타일 |
| `docs/decisions/011-bookmark-sync-phase2.md` | 신규 — Phase 2 동기화 계획 ADR |

---

### 버그 수정 3건 (미커밋)

#### 1. 드래그 포인터 이벤트 리스너를 document 레벨로 이동

`pointermove`/`pointerup`/`pointercancel`을 `row`에 붙이던 방식에서 `document`로 이동.
드래그 중 포인터가 row 영역 밖으로 이탈하면 이벤트를 놓쳐 ghost가 남거나 드롭이 취소되지 않던 문제 수정.
`pointerId` 필터링으로 멀티터치 오작동 방지. `cleanupPointerHandlers()` 헬퍼로 해제 로직 통합.

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — `_setupDragHandle()` 이벤트 리스너 위치 및 정리 로직 |

#### 2. 드로어 열기/닫기 race condition 수정

빠르게 open→close→open 반복 시 닫힘 애니메이션의 `finalize` 콜백이 뒤늦게 실행되어
새로 열린 드로어를 숨겨버리던 문제.
`_bookmarkDrawerCloseSeq` 시퀀스 번호로 stale finalize를 차단하고,
`_bookmarkDrawerCloseTimer`를 open 시점에 취소하여 타이머 충돌 방지.

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — `openBookmarkDrawer()`, `closeBookmarkDrawer()` |

#### 3. 병합 다이얼로그 컨텍스트 유실 수정

롱프레스로 드로어 없이 저장할 때 `_bookmarkDrawerBook`/`_bookmarkDrawerChapter`가 `null`이어서
병합 다이얼로그에서 "따로 저장" 선택 시 저장 모달이 빈 컨텍스트로 열리던 문제.
`openMergeDialog()`에 `fallbackContext` 파라미터 추가, `openSaveModal()`에서 `{ bookId, chapter }` 전달.

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — `openMergeDialog()`, `openSaveModal()` |

---

### `refreshBookmarkHeaderBtn` 및 `has-bookmark` dead code 제거 (9d6c4b4)

PR #8 버그봇 리포트(`refreshBookmarkHeaderBtn` 빈 함수) 검토 결과,
ADR-010의 의도적 결정(헤더 북마크 여부 표시 제거)과 일치하므로 기능 복원이 아닌 dead code 정리로 처리.

- `js/app.js`: `refreshBookmarkHeaderBtn()` 함수 정의 및 3곳 호출 모두 삭제
- `tests/e2e/test_bookmark.py`: `has-bookmark` assertion 제거, 테스트명 단순화
- `tests/e2e/test_features.py`: `has-bookmark` 체크 제거 → localStorage 저장 여부로 대체

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — dead code 제거 |
| `tests/e2e/test_bookmark.py` | 수정 — 구버전 assertion 제거 |
| `tests/e2e/test_features.py` | 수정 — 구버전 assertion 제거 |

---

### 북마크(북마크) 기능 전체 구현 — `feat/bookmark` 브랜치 (ADR-010)

오늘 하루 동안 북마크 기능의 핵심 UX를 완성했다. 커밋 6개 기준으로 작업을 정리한다.

---

#### 1. long-press 저장 후 헤더 아이콘 갱신 버그 수정 (8762b3c)

롱프레스(300ms)로 절 선택 없이 직접 저장한 경우 헤더의 `bookmarks` 아이콘이 갱신되지 않던 문제.  
`openSaveModal()` 내 `refreshBookmarkHeaderBtn()` 호출 위치를 저장 완료 시점으로 이동했다.  
e2e 테스트(`tests/e2e/test_features.py`)에 롱프레스 저장 케이스 추가.

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — 헤더 갱신 호출 위치 교정 |
| `tests/e2e/test_features.py` | 수정 — 롱프레스 저장 e2e 케이스 추가 |

---

#### 2. 북마크 저장 모달 — 폴더 선택 커스텀 콤보박스 (8707c53)

기본 `<select>`를 제거하고 SVG 폴더 아이콘이 포함된 커스텀 콤보박스(`_buildFolderCombobox()`)로 교체.  
트리 뷰와 동일한 Material Icons 폴더 아이콘을 저장 위치 선택에서도 사용.  
`overflow: visible`로 모달 밖으로 드롭다운 열림.  
`scripts/serve.py` 신규 추가 (History API SPA를 위한 로컬 개발 서버).  
`tests/e2e/test_bookmark.py` 신규 작성 (저장·수정·삭제·폴더 기본 플로우).

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — `_buildFolderCombobox()` 구현, 저장 모달 교체 |
| `css/style.css` | 수정 — 콤보박스 스타일 |
| `scripts/serve.py` | 신규 — SPA 로컬 서버 |
| `tests/e2e/test_bookmark.py` | 신규 — 북마크 e2e 테스트 |
| `CLAUDE.md` | 수정 — serve.py 사용법 안내 추가 |

---

#### 3. e2e 북마크 테스트 URL 경로 수정 (ae10f6b)

`test_features.py`에서 북마크 관련 assertion의 URL을 hash 방식 → History API path 방식으로 정정.

| 파일 | 변경 유형 |
|------|-----------|
| `tests/e2e/test_features.py` | 수정 — URL 경로 기반으로 정정 |

---

#### 4. 폴더 드롭 순환 참조 판정 방향 수정 (16b70ae)

`_isDescendant(potentialAncestor, potentialDescendant)` 인자 순서가 뒤바뀌어  
폴더를 자신의 자식 폴더 안으로 드롭할 때 순환 참조를 막지 못하던 버그 수정.

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — `_isDescendant()` 호출 인자 순서 교정 |

---

#### 5. 북마크 드로어 UX 전면 개선 (cb56689)

| 항목 | 내용 |
|------|------|
| 반응형 레이아웃 | 모바일 ≤768px: 바텀시트, 데스크탑 ≥769px: 우측 슬라이드인 패널 |
| 애니메이션 | `@keyframes` 입장·퇴장 (검색 시트와 속도 통일) |
| 패널 너비 조절 | 데스크탑 좌측 엣지 드래그 핸들 (`#bookmark-drawer-resize`) |
| 폴더 생성 UI | `window.prompt` 제거 → 인라인 입력 폼 (placeholder: "예: 대림1주일") |
| 절 선택 바 | "N개 줄" → "3-5절 선택됨" 형식, 드래그로 연속 범위 선택 지원 |
| 합치기 다이얼로그 | 같은 장 북마크 복수 시 대상 선택 UI, 합치기 후 제목 자동 갱신 |
| 북마크 제목 | 책 full name → `short_name_ko` (약자) 사용 |
| 폴더 들여쓰기 | 자식 항목 `padding-left: 3rem` (폴더 아이콘 기준 정렬) |
| 드래그 ghost | `font-family` serif 깨짐 수정 |

`data/book_mappings.json`에 `short_name_ko` 필드 추가 (73권).  
`data/books.json` 재생성 (`short_name_ko` 포함).  
`src/split_bible.py`에 `short_name_ko` 출력 추가.

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — 반응형·애니메이션·폴더 생성·절 선택·합치기 로직 |
| `css/style.css` | 수정 — 바텀시트/패널 레이아웃, 애니메이션, 핸들 스타일 |
| `index.html` | 수정 — 드로어 핸들 요소 추가 |
| `data/book_mappings.json` | 수정 — `short_name_ko` 73권 추가 |
| `data/books.json` | 수정 — `short_name_ko` 포함 재생성 |
| `src/split_bible.py` | 수정 — `short_name_ko` 출력 |

---

#### 6. 북마크 드로어 UI 전면 개선 (3ea28de)

| 항목 | 내용 |
|------|------|
| 폴더 아이콘 | 열림/닫힘 상태에 따라 `folder_open` / `folder` Material Icons SVG로 전환 |
| 드래그 핸들 | 전용 6-dot 핸들 제거 → row 전체 드래그 (5px `Math.hypot` 임계값으로 클릭·드래그 구분) |
| 북마크 타입 아이콘 | 비활성: outlined `bookmark` / 활성: filled `bookmark` SVG |
| 활성 북마크 강조 | `.bm-active` 클래스: 배경색 + 아이콘·레이블 accent 색상 |
| 활성 폴더 자동 펼침 | `_hasActiveDescendant()` true인 폴더만 드로어 열 때 펼침, 나머지 접힘 |
| 헤더 북마크 버튼 | `bookmarks` SVG 아이콘으로 교체, 장 북마크 여부 표시(`.has-bookmark`) 제거 |
| 툴바 | 텍스트 버튼 → 아이콘 전용 버튼 (create_new_folder / bookmark_add / text_select_move_forward_character), 우측 정렬 |
| 검색 드로어 | 닫기 버튼(`#search-sheet-close`) 추가 (WCAG 일관성) |
| 세부 스타일 | 폴더 이름 bold 제거, 드로어 헤더 간소화, 구분선 그라데이션, 절 선택 border-radius 5px, 오디오 투명도 |

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — 아이콘 빌더, 드래그 핸들, 활성 강조, 헤더 버튼, 툴바 |
| `css/style.css` | 수정 — 아이콘 스타일, 활성 강조, 툴바, 검색 드로어 닫기 버튼 |
| `index.html` | 수정 — 검색 드로어 닫기 버튼 요소, 툴바 구조 변경 |

---

#### 7. 북마크 드로어 키보드 트리 탐색 구현 (미커밋, ADR-010 미결 사항)

WAI-ARIA Tree Pattern 키보드 스펙에 따라 북마크 드로어 트리 전체 키보드 탐색 구현.

| 키 | 동작 |
|----|------|
| `↑` / `↓` | 이전/다음 보이는 treeitem으로 포커스 이동 |
| `→` | 폴더 접힘: 열기 / 폴더 열림: 첫 자식으로 이동 / 북마크: 무시 |
| `←` | 폴더 열림: 닫기 / 접힘 또는 북마크: 부모 treeitem으로 이동 |
| `Enter` / `Space` | 폴더: 토글 / 북마크: 링크 활성화 (navigate) |
| `Home` / `End` | 첫 번째/마지막 아이템으로 이동 |

`.bm-item-actions`·`.bm-bookmark-link` 내부에서는 트리 키 무시 (버튼·링크 자체 동작 보존).  
`renderBookmarkTree()` 렌더링 후 roving tabindex 초기화 (첫 아이템 `tabIndex="0"`).

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — `_getVisibleTreeItems()`, `_focusTreeItem()`, `_toggleFolder()`, keydown 핸들러 |
| `docs/decisions/010-bookmark-feature.md` | 수정 — 미결→해소 이동 |

## 2026-04-25

### 하위 URL 리소스 경로 버그 수정 (버전 1.1.0~1.1.2)

SEO 전환(ADR-009) 이후 서브 경로(`/bible/gen/1` 등)에서 진입 시 상대 경로 fetch가 실패하는 문제를 연속 수정했다.

#### 버전 1.1.0

- `js/app.js`: `books.json`, 장별 JSON, 오디오 파일 fetch 경로를 모두 절대 경로로 통일
- `js/pre-fetch.js`: `books.json` fetch 경로 절대 경로로 수정

#### 버전 1.1.1

- `js/search-worker.js`: `DATA_DIR` 상수를 `'data/'` → `'/data/'`로 변경 (워커 스크립트 기준 상대 경로 오류 재발 수정)
- `sw.js`: `CACHE_NAME` rev-35 범프

#### 버전 1.1.2 — SW 캐시 전략 전환 (perf)

- `sw.js`: fetch 핸들러의 stale-while-revalidate → **cache-first**로 전환
  - 이유: 성경/검색 데이터는 릴리스 단위로만 변경되므로 매 방문마다 백그라운드 재검증이 불필요, 불필요한 네트워크 트래픽 유발
  - 캐시 무효화는 기존과 동일하게 `CACHE_NAME` 범프(activate 단계 전체 삭제)로 처리
- `sw.js`: `CACHE_NAME` rev-36 범프

### SEO 후속 조치

- Google Search Console에서 신규 History API URL에 대한 수동 크롤링 요청 제출
- 네이버 서치어드바이저 사이트 소유 확인 태그 추가 (`index.html` `<head>`)

### 문서 보완

- `docs/decisions/001-spa-architecture.md`: **서비스 워커 캐시 전략** 섹션 추가
  - 앱 셸, 성경·검색 데이터(SWR → cache-first 전환 이유), Google Fonts, 업데이트 흐름 기술

#### 수정 파일 요약

| 파일 | 변경 유형 |
|------|-----------|
| `js/app.js` | 수정 — fetch 경로 절대 경로화 |
| `js/pre-fetch.js` | 수정 — books.json fetch 절대 경로 |
| `js/search-worker.js` | 수정 — DATA_DIR 절대 경로 |
| `sw.js` | 수정 — cache-first 전환, CACHE_NAME rev-36 |
| `version.json` | 수정 — 1.1.2 |
| `docs/decisions/001-spa-architecture.md` | 수정 — SW 캐시 전략 섹션 추가 |
| `index.html` | 수정 — 네이버 서치어드바이저 소유 확인 태그 추가 |

## 2026-04-24

### SEO 개선 — History API 라우팅 전환 (v1.0.30, ADR-009)

해시 기반 라우팅(`#/gen/1`)을 History API 경로 라우팅(`/gen/1`)으로 전환하고
SEO 관련 개선 사항을 일괄 적용했다.

#### 라우팅 전환 (js/app.js)

- `parseHash()` → `parsePath()`: `location.pathname + location.search` 기반으로 재작성
- `navigate(path)` 헬퍼 추가: `history.pushState` + `route()` 조합
- `hashchange` → `popstate` 이벤트 리스너 전환
- 전역 클릭 인터셉터: 내부 링크를 `navigate()`로 처리, Cmd/Ctrl/Shift 클릭은 브라우저 기본 동작 유지
- 레거시 해시 URL 호환: `DOMContentLoaded`에서 `#/path` → `/path` 자동 `replaceState`

#### SEO 개선

- `updatePageMeta()` 신규: 라우트별 `<title>`, `<meta description>`, `og:title`, `og:url`, `canonical` 동적 갱신
  - 장 뷰: "창세기 1장 — 공동번역성서"
  - 책 뷰: "창세기 — 공동번역성서"
  - 구분 뷰: "구약 — 공동번역성서"
  - 머리말 뷰: "집회서 머리말 — 공동번역성서"
- `sitemap.xml`: 루트 1개 → 73권 × 전 장 + 머리말 = 1,403개 URL

#### PWA 대응

- `sw.js`: navigation 요청 전용 핸들러 추가 — 캐시에서 `/index.html` 즉시 반환 (오프라인 임의 경로 접근 지원)
- `manifest.webmanifest`: `start_url "/#/"` → `"/"`
- `sw.js`: `CACHE_NAME` rev-33 → rev-34 (기존 PWA 사용자 SW 강제 갱신)
- `version.json`: 1.0.29 → 1.0.30

#### 배포 요구사항

nginx에 SPA fallback 설정 선적용 필수:
```nginx
location / { try_files $uri $uri/ /index.html; }
```

#### 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `js/app.js` | 수정 — History API 라우팅, updatePageMeta, 클릭 인터셉터, 레거시 해시 호환 |
| `sw.js` | 수정 — navigation fallback, CACHE_NAME rev-34 |
| `manifest.webmanifest` | 수정 — start_url "/" |
| `sitemap.xml` | 수정 — 1,403개 URL |
| `version.json` | 수정 — 1.0.30 |
| `docs/decisions/009-history-api-routing.md` | 신규 — ADR-009 |
| `docs/decisions/001-spa-architecture.md` | 수정 — SEO 불이익 해소 반영 |

## 2026-04-18

### 초기 로딩 최적화 및 PWA 정리 (버전 1.0.21)

- `js/pre-fetch.js` 신규: HTML 파싱 중 즉시 `books.json` fetch 시작 (app.js 로딩 대기 제거)
- GA `page_view`, `loadVersion`, `initCompactHeader`를 `requestIdleCallback`으로 지연
- 런치 스크린 fade-out을 `requestAnimationFrame`으로 분리, 애니메이션 `2s`로 완화
- critical CSS에 디자인 토큰 변수 인라인, CSP `style-src` 해시 갱신
- `manifest.webmanifest`: `purpose: "any"` 명시, `short_name`/`start_url` 정리, `og:image` 경로 수정
- `apple-touch-icon`을 maskable 아이콘으로 교체, `skh-cross.svg` viewBox 타이트닝

### URL 라우팅 — 절 단위 확장 (`/#/{book}/{chapter}/{verse}[-{verse}]`)

- 해시 경로에 절(범위) 세그먼트 추가 — 검색 결과·딥링크에서 특정 절 강조 표시
- 기존 레거시 쿼리 폼(`?v=&ve=`) 제거, `?hl=` 텍스트 하이라이트는 유지
- 범위 오버플로 clamp, 역순 정규화, 동일값 처리 후 `replaceState`로 URL 재작성
- 향후 본문 공유(카드 이미지 생성) 기반

### 본문 복사 개선

- 단락 기호(¶) 제거, 산문 단락 경계를 빈 줄로 구분
- 절의 일부만 선택해도 절 전체 경계로 자동 확장해 복사

### iOS 시스템 한글 글꼴 스택 적용

- Noto Sans KR 대신 `-apple-system` → `Apple SD Gothic Neo` 우선 적용
- iOS 네이티브 폰트 일관성·소형 화면 가독성 확보, macOS Chromium 커버를 위해 `BlinkMacSystemFont` 함께 명시

### PWA 설치 가이드 추가 (ADR-008)

플랫폼별 안내 내용이 다른 설치 가이드 모달을 설정 팝오버에 추가했다.

- **iOS Safari**: 공유 버튼 → '홈 화면에 추가' 수동 가이드 (SVG 일러스트 포함)
- **iOS 타 브라우저**: Safari로 열기 유도 + 주소 복사 버튼
- **Android/데스크탑 Chromium**: `beforeinstallprompt` 기반 CTA 버튼
- **standalone 모드**: 이미 설치된 상태에서는 진입점 숨김
- `assets/install-guide/ios-*.svg` 플레이스홀더 추가 (실기기 스크린샷으로 차후 교체)
- `docs/decisions/008-pwa-install-guide.md` ADR 작성
- 접근성 보완: 모달 열림 시 배경에 `inert` + `aria-hidden`, `aria-disabled` 포커스 트랩, min 44×44px 터치 타깃, 다크 모드 대비비 수정

### 설정 팝오버 구조 개선 및 검색 UX 개선 (버전 1.0.22)

- 설정 항목을 **외경 배치 / 타이포그래피 / 앱 관리** 세 섹션으로 범주화, 글자 크기 확대
- 구절 참조('요한 3:16') 검색 시 자동 이동 대신 '구절 바로가기' 카드 상단 표시 (3초 자동 이동 타이머 제거)
- 검색 시트에서도 구절 카드 표시, 클릭 시 시트 닫기
- 검색 워커 오류 시 `searchId` 없어도 pending 콜백 정리 (UI 멈춤 방지)

### 테스트 체계 구축 (ADR-004 완성 + e2e)

#### 배경

미커밋 상태로 남아 있던 `verify_*.py` 11개 파일(Playwright ad-hoc 스크립트)을 정리하면서
ADR-004에서 설계만 하고 구현하지 않았던 Level 2·3 테스트와
체계적인 e2e 테스트 디렉터리를 함께 구축했다.

#### 데이터 파이프라인 테스트 (Level 2·3)

**Level 2 — 절 순서 검증** (`tests/test_ordering.py`)
- `tests/generate_fixtures.py`: `data/bible/` 전체를 읽어 각 장의 절 번호 시퀀스를
  `tests/fixtures/verse_sequence.json`으로 저장 (로컬 전용, 원본 텍스트 필요)
- `verse_sequence.json`: 1328장 × 절 번호 배열. cross-chapter 절은 `{"n": num, "chapter_ref": ch}` 형태
- `test_ordering.py`: 1328개 파라미터화 테스트 — 현재 `data/bible/` 파일이 픽스처와 정확히 일치하는지 검증
- `parser.py` 또는 `split_bible.py` 변경 후 `generate_fixtures.py` 재실행 → 픽스처 커밋

**Level 3 — 특수 케이스 스냅샷** (`tests/test_snapshots.py`)
- Cross-chapter 삽입 6곳 고정값 검증
  - 이사야 40장: 41:6·7절 삽입 확인 + 41장에서 6·7절 누락 확인
  - 잠언 5장: 6:22절 삽입
  - 호세아 14장: 13:14절이 5절 직후에 위치
  - 호세아 13장: 14절 부재
  - 욥기 27장: 24:18-24절 삽입
- 같은 장 내 재배치 3개 검증 (아모스 5·6장, 이사야 40장 순서)

#### e2e 테스트 (`tests/e2e/`)

기존 `verify_*.py` 중 품질 좋은 것들을 pytest-playwright 형식으로 변환.
진단/일회성 스크립트(`verify_loading*.py`, `verify_timeline.py`,
`verify_keyword_search.py`, `verify_verse_search.py`)는 중복이므로 삭제.

| 파일 | 커버 범위 |
|------|-----------|
| `test_search.py` | 키워드 검색, 절 참조 자동 이동, Worker 오류 UI 노출, 검색 URL 새로고침 회귀 |
| `test_navigation.py` | URL 라우팅 8케이스 (단일 절, 범위, over-range 클램프, 역순 정규화, legacy form, hl 파라미터, 유효하지 않은 절) |
| `test_copy.py` | 부분 선택 시 절 전체로 확장, 절 경계 걸친 선택 처리 |
| `test_install_guide.py` | iOS Safari/Chrome, Android, Desktop UA별 모달 내용, standalone 모드 진입점 숨김 |
| `test_features.py` | 이어읽기 배너, 모바일 검색 FAB → 바텀시트 |

e2e는 서버가 `http://localhost:8080`에서 실행 중이어야 하므로 CI 대상 아님.

#### CI

`.github/workflows/test.yml`: push/PR 시 Level 1-3 자동 실행 (e2e 제외).

#### 수정 파일 요약

| 파일 | 변경 유형 |
|------|-----------|
| `tests/test_ordering.py` | 신규 — Level 2 |
| `tests/test_snapshots.py` | 신규 — Level 3 |
| `tests/fixtures/verse_sequence.json` | 신규 — 1328장 픽스처 |
| `tests/generate_fixtures.py` | 신규 — 픽스처 생성 스크립트 |
| `tests/e2e/conftest.py` | 신규 — BASE_URL, wait_app_ready |
| `tests/e2e/test_search.py` | 신규 |
| `tests/e2e/test_navigation.py` | 신규 |
| `tests/e2e/test_copy.py` | 신규 |
| `tests/e2e/test_install_guide.py` | 신규 |
| `tests/e2e/test_features.py` | 신규 |
| `.github/workflows/test.yml` | 신규 — CI |
| `requirements.txt` | 수정 — pytest-playwright 추가 |
| `CLAUDE.md` | 수정 — 테스트 섹션, 프로젝트 구조, 현재 상태 갱신 |
| `tests/verify_*.py` (11개) | 삭제 |

## 2026-04-14

### iOS PWA 스플래시 화면 추가

- iOS는 `apple-touch-startup-image` 부재 시 앱 실행 때마다 흰 화면 노출 — `background_color` manifest 값은 iOS가 무시함
- `src/generate_splash.py` 신규: cairosvg + Pillow로 `assets/icons/skh-cross.svg`를 렌더링, 디바이스별 PNG 생성 스크립트
- `assets/splash/dark-{device}.png` 13장 생성 (iPhone SE 2세대 ~ iPhone 15 Pro Max, iPad mini ~ iPad Pro 12.9")
  - 배경 `#1a1a2e`(icon-512.png와 동일), 십자가 `#faf8f5`
  - `prefers-color-scheme` 구분 없이 단일 다크 테마로 통일
- `index.html`: `<link rel="apple-touch-startup-image">` 13개 추가 (디바이스별 portrait 미디어 쿼리)
- `sw.js`: CACHE_NAME rev-18 → rev-19 (SHELL_FILES 경로 변경 반영)

### iOS 런치 스크린 — apple-touch-startup-image와 일관성 맞추기

- **페이드인 애니메이션 제거**: `css/style.css`의 `launch-cross-in` keyframe 및 SVG animation 삭제
- **배경색 고정**: `var(--accent)` 대신 `#1a1a2e` 고정 (테마색 무관) — `css/pre-paint.css`·`css/style.css` 모두 적용, 테마별 분기 제거
- **십자가 크기 통일**: `width: 25vmin; aspect-ratio: 494 / 671` — 스플래시 생성 공식 `min(px_w, px_h) × 0.25`와 DPR 무관하게 동일한 물리적 크기
- **십자가 색상 통일**: `fill="white"` → `fill="#faf8f5"` (스플래시 이미지와 동일)
- `index.html`: SVG 인라인 `width="140" height="190"` 속성 제거 (CSS로 제어)

### Android 스플래시 대응 + iOS 잠금 화면 아이콘 이중 라운딩 수정

- **원인**: `icon-192.png`·`icon-512.png`에 rounded corner가 구워져 있어 iOS 잠금 화면 미디어 위젯이 자체 클리핑을 한 번 더 적용 → 이중 라운딩
- **`assets/icons/icon-512-maskable.png`** 신규: 512×512 정사각형, 라운딩 없음, 십자가가 safe zone(중앙 80%) 내 65% 높이로 배치
- `manifest.webmanifest`:
  - `background_color` `#faf8f5` → `#1a1a2e` (Android 스플래시 배경 통일)
  - maskable 아이콘 항목 추가 (`purpose: "maskable"`)
- `js/app.js`: Media Session artwork 소스를 `icon-192.png` → `icon-512-maskable.png` (잠금 화면 이중 라운딩 해소)
- `sw.js`: SHELL_FILES에 `icon-512-maskable.png` 추가, CACHE_NAME rev-19 → rev-20
- `src/generate_splash.py`: `make_maskable_icon()` 함수 추가

### 프로젝트 파일 구조 정리 (chore)

루트 디렉터리 과밀 해소 — 성격별로 서브디렉터리로 이동

| 이동 전 (루트) | 이동 후 |
|---|---|
| `app.js`, `gtag-init.js`, `search-worker.js` | `js/` |
| `pre-paint.css`, `style.css` | `css/` |
| `icon-192.png`, `icon-512.png`, `skh-cross.svg` | `assets/icons/` |

루트 유지 파일: `index.html`, `sw.js`(스코프 필수), `manifest.webmanifest`, `favicon.ico`, `robots.txt`, `sitemap.xml`, `version.json`

참조 업데이트: `index.html`, `js/app.js`, `manifest.webmanifest`, `sw.js` SHELL_FILES, `src/generate_splash.py`, `scripts/build-deploy.sh`

### 런치 스크린 흰 플래시 제거 — pre-paint.css (버전 1.0.14)

- 증상: PWA 앱 실행 시 메인 스타일시트가 로드되기 전 순간적으로 흰 배경이 노출
- 원인: 브라우저가 `style.css` 파싱 완료 전에 첫 페인트를 실행, 배경색과 런치 스크린 레이아웃이 적용되지 않은 상태가 노출
- `pre-paint.css` 신규: 메인 스타일시트 로드 전 테마색 배경과 런치 스크린 레이아웃만 담은 critical CSS
- `index.html`: `theme-color` 메타를 라이트/다크 `media` 쿼리로 분리, `pre-paint.css` 링크 추가
- `app.js`: `updateThemeMetaColor`가 복수 `theme-color` 메타를 모두 갱신; `dismissLaunchScreen` 핸들러를 `launch-screen-out` 애니메이션에만 반응하도록 필터링
- `style.css`: `launch-cross-in` keyframe 추가, fade-out `3s` → `5s`
- `sw.js`: `SHELL_FILES`에 `pre-paint.css` 추가, `CACHE_NAME` rev-15 → rev-17
- `scripts/build-deploy.sh`: 배포 zip에 `pre-paint.css` 포함
- `version.json`: 1.0.13 → 1.0.14

### 브레드크럼 구분 링크화 및 클립보드 복사 개선

- **브레드크럼 구분 링크화**: 브레드크럼의 구약/외경/신약 구분 항목을 드롭다운 피커에서 직접 링크로 변경 — 클릭 시 즉시 해당 구분의 첫 책으로 이동
- **브레드크럼 책이름 제거**: 장 보기 및 머리말 보기 브레드크럼에서 중복 노출이던 책이름 항목 제거
- **클립보드 복사 개선**: 절 복사 시 연(stanza) 나누기를 빈 줄로, 절 번호를 숫자만 사용 (마침표·공백 제외)
- `app.js`: 브레드크럼 렌더링 로직 단순화, 클립보드 핸들러 수정
- `style.css`: 미사용 CSS 제거 — `.bc-division-picker`, `.bc-division-btn`

### 소스 파일 업데이트

- `data/source` 서브모듈 최신 커밋으로 갱신

### 데이터 업데이트 및 초기 로딩 최적화 (버전 1.0.16–1.0.18)

**데이터 업데이트:**
- 검색 인덱스 재생성 (`search-dc.json` — 외경 데이터 변경 반영)
- 구약 데이터 업데이트 → 버전 1.0.16

**pre-paint.css 인라인 전환 (버전 1.0.17):**
- `css/pre-paint.css`를 `index.html` `<style>` 블록으로 인라인화 — 별도 네트워크 요청 제거
- SW 캐시 여부와 무관하게 첫 페인트 즉시 배경색 적용됨
- `css/pre-paint.css` 삭제, `sw.js` SHELL_FILES에서 제거

**초기 로딩 경량화:**
- `index.html`: `books.json` preload 추가 — JS 파싱과 병렬로 fetch 시작
- `app.js`: 목록·장목차 뷰는 렌더 직후, 장 뷰는 `renderLoading()` 직후 `dismissLaunchScreen()` 호출 (장 데이터 로드 전에 런치 스크린 먼저 해제)
- `initCompactHeader()`를 `requestIdleCallback`으로 지연 등록

**캐시 초기화 기능 추가 (버전 1.0.18):**
- 설정 팝오버에 '캐시 · 초기화' 버튼 추가 (`caches` API 지원 환경에서만 노출)
- `clearAllCaches()`: SW 캐시 전체 삭제 + SW 등록 해제 후 새로고침 (오프라인 상태에서는 차단, 실행 전 confirm)
- `.cache-clear-btn` 스타일 추가 (라이트/다크)

## 2026-04-15

### 검색 워커 데이터 경로 버그 수정 (버전 1.0.19)

- **원인**: `js/` 디렉터리로 파일 이동 후 `search-worker.js` 내 `fetch()`가 상대경로를 워커 스크립트 기준(`/js/`)으로 해석 → 404로 검색 전체 불능
- **수정**: `DATA_DIR` 경로에 `/` 접두사 추가 (`data/...` → `/data/...`) — 절대 경로 강제
- `manifest.webmanifest`: `short_name`을 '공동번역성서'로 변경

## 2026-04-17

### 초기 로딩 성능 집중 개선 (버전 1.0.20)

**렌더링 차단 해소:**
- Google Fonts stylesheet를 `media=print onload` 패턴으로 비차단화
- `app.js`, `gtag-init.js`에 `defer` 속성 추가
- `launch-screen` 마크업을 `<body>` 첫 자식으로 이동 — 헤더·메인보다 먼저 파싱
- `dismissLaunchScreen`에서 `.launch-done` 클래스로 라이트 모드 본문 색 전환

**런치 스크린 품질:**
- fade-out 애니메이션 `5s` → `0.8s` 단축, `prefers-reduced-motion` 대응
- `body::before` 다크 오버레이로 launch-screen 파싱 전 흰 화면 완전 차단
- `.loading`, `#sw-update-toast`에 시스템 폰트 fallback 명시 (폰트 swap 중 안정성)

**인라인 SVG 최적화:**
- svgo `--multipass --precision=2`로 path 좌표 정밀도 축소
- `index.html` 37KB → 15KB (인라인 SVG 28KB → 6KB), 시각적 회귀 없음

**서비스 워커 캐싱 전략 단순화 (버전 1.0.20):**
- chapter/search JSON의 network-first 분기 제거, shell과 동일한 stale-while-revalidate 패턴으로 일원화
- 이미 본 chapter는 캐시에서 즉시 반환, 백그라운드 revalidate
- 본문 수정은 release 시 `CACHE_NAME` bump → activate에서 옛 캐시 자동 삭제

**브랜드 표기 정리:**
- 문서·메타데이터의 '대한성공회 서울교구' → '대한성공회' 통일 (8곳)
- CSP: 인라인 `<style>`, JSON-LD `<script>`, `onload` 이벤트 핸들러용 SHA-256 해시 추가

## 2026-04-13

### 절 범위 검색 clamp (미릴리즈)

- 현재 `search-worker.js`의 `REF_RE`가 이미 `창세 3:1-17` 같은 범위 입력을 파싱하고, `app.js`의 하이라이트 조건 `vn >= hlVerse && vn <= (hlVerseEnd || hlVerse)`가 범위 표시를 자연스럽게 처리하고 있었음 — 사실상 이미 동작
- 개선: `renderChapter`에서 장의 실제 마지막 절 번호로 `hlVerseEnd`를 clamp. `창세 3:1-100`을 입력해도 24절에 멈추고, URL 해시도 `history.replaceState`로 `ve=24`로 교정돼 공유 링크가 정확한 범위를 반영
- `v.range_end`(절 범위를 가진 절)도 고려해 max verse 계산

### 절 참조 검색에 책 id 별칭 추가 (미릴리즈)

- 목적: 기존에는 `창세 3:1`, `창 3:1`처럼 `korean_name`·`aliases_ko`로만 절 참조 검색 가능. 내부 id(`gen`, `rev`, `sir` 등)로도 동일 검색이 되도록 확장
- `src/search_indexer.py`: `aliases` 생성 블록에 `aliases[bid] = bid` 한 줄 추가 — 책 id 자체를 별칭 키로 등록
- `data/search-meta.json` 재생성: 별칭 수 301 → 374 (+73권 id), 파일 크기 약 10.3 KB
- `search-worker.js`: `tryVerseRef` 별칭 조회를 `meta.aliases[bookQuery] || meta.aliases[bookQuery.toLowerCase()]`로 변경 — `Gen 3:1`·`GEN 3:1`처럼 대소문자 혼용 id 입력도 매칭. `toLowerCase()`는 한글에 무영향이라 기존 한국어 별칭에는 영향 없음
- `python -m pytest tests/test_completeness.py` 22건 통과

### 운문 행 hanging punctuation — 작은따옴표 offset 보정 (미릴리즈)

- 증상: 운문 단락 첫 글자가 `"`일 때 왼쪽으로 내어쓰기(hanging)되도록 했으나, `'`로 시작하는 단락도 동일 offset(`-0.4em`)으로 내어쓰기가 되면서 정렬이 어긋남
- 원인: `app.js`의 조건문이 `"`와 `'`을 동일하게 처리하고, CSS `.hanging-quote`는 큰따옴표 폭 기준으로만 조정돼 있었음
- `app.js` (`renderChapterView` 내부): `'` 시작 행에는 `hanging-quote hanging-quote--single` 수식자 클래스 부여
- `style.css`: `.verse.verse-poetry .hanging-quote--single { margin-left: -0.2em; }` 추가 — 큰따옴표 offset의 50%

### PWA 업데이트 후 stale 셸 수정 (버전 1.0.12)

- 증상: Linux 데스크탑 PWA에서 1.0.10 사용 중 업데이트 토스트 확인 → 새로고침 → 여전히 1.0.10 노출
- 원인: 서버가 셸 파일에 `Cache-Control: max-age=2592000, public, immutable` 헤더를 내려주어, SW install 단계의 `cache.addAll()` 네트워크 요청이 브라우저 HTTP 캐시에서 이전 버전 바이트를 재사용. 새 `CACHE_NAME`에 stale 셸이 저장됨
- `sw.js`
  - `install`: `cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: "reload" })))` — HTTP 캐시 우회
  - `fetch` 셸 분기: 백그라운드 재검증도 `new Request(event.request, { cache: "reload" })`로 강제 재요청, 실패 시 캐시 fallback
  - `CACHE_NAME` rev-11 → rev-12
- `app.js`: About 링크 버전 표기 1.0.11 → 1.0.12
- 참고: 서버 측 헤더에서 셸 파일의 `immutable` 제거 및 짧은 `max-age`로 변경하는 것이 근본 해결책이나, 본 패치는 SW 레벨에서 선제적으로 우회

### 신약 전권 마크다운 리포맷 (data/source)

- **신약 성서** (`acts.md`, `john.md`, `luke.md`, `mark.md`, `matt.md`, `rom.md`, `1cor.md`, `2cor.md`, `gal.md`, `eph.md`, `phil.md`, `col.md`, `1tim.md`, `2tim.md`, `heb.md`, `1pet.md`, `1john.md`, `rev.md`)
  - 시 구절 verse-line 적용, 단락 구분 정리
  - 신약 27권 전체 마크다운 형식 정리 완료

### 버전 1.0.11 및 SW 캐시 갱신

- `app.js`: About 링크 버전 표기 1.0.10 → 1.0.11
- `sw.js`: `CACHE_NAME` rev-10 → rev-11

## 2026-04-12

### 스크린리더 접근성 개선

- `index.html`
  - `#audio-bar`에 `role="region" aria-label="오디오 플레이어"` 추가 — 랜드마크 탐색 지원
  - `#search-scrim`에 `aria-hidden="true"` 추가 — 시각적 오버레이를 AT에서 숨김
  - `#search-sheet`에 `role="dialog" aria-label="검색"` 추가 — 모달 다이얼로그로 명시
  - `#search-sheet-handle`에 `aria-hidden="true"` 추가 — 포인터 전용 드래그 핸들 숨김
- `app.js`
  - `trapFocus(container)` 헬퍼 추가 — Tab 키를 열린 팝오버 안에서 순환시키고 클린업 함수 반환
  - 설정 팝오버, 타이틀 구분 선택, 장/편 선택, 브레드크럼 구분 선택 등 4개 팝오버에 포커스 트랩 적용
    - 팝오버 열릴 때 첫 항목으로 포커스 이동, 닫힐 때(버튼·외부클릭·ESC) 트랩 해제
  - `<mark class="search-highlight">`에 `role="presentation"` 추가 — 검색 하이라이트 의미 중복 읽힘 방지
  - SW 업데이트 토스트 접근성 강화
    - 토스트 표시 시 업데이트 버튼으로 `focus()` 이동 — 키보드/스크린리더로 즉시 대응 가능
    - 버튼 `aria-label="새 버전으로 업데이트"` 추가
    - 토스트 `aria-label="앱 업데이트 알림"` 추가
    - 텍스트 스팬에 `aria-hidden="true"` — `role="alert"` + 버튼 레이블 중복 읽힘 방지
- 절 번호(`<sup class="verse-num" aria-hidden="true">`)는 독서 몰입을 위한 의도적 설계로 유지

### PWA 업데이트 토스트 구현

- `sw.js`: `install` 이벤트에서 `self.skipWaiting()` 제거, `SKIP_WAITING` 메시지 수신 시에만 발동
  - 사용자가 토스트에서 "업데이트" 버튼을 눌러야만 새 SW가 활성화됨
- `style.css`: `#sw-update-toast`, `#sw-update-btn`, `@keyframes toast-in` 추가
- `app.js`: `showUpdateToast(waitingSW)` 함수 — waiting SW 감지 시 하단 토스트 표시, 클릭 시 `SKIP_WAITING` 전송

### iOS Safari PWA 업데이트 미감지 수정

- `app.js`: `navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })` — HTTP 캐시 우회로 iOS Safari에서 SW 파일 변경 감지 보장
- `sw.js`: `CACHE_NAME` rev-9 → rev-10 bump

### 책 배열 설정 레이블 명확화 및 버전 표기

- `app.js`: 설정 팝오버 책 배열 버튼 레이블 변경
  - `"성공회"` → `"외경 분리"` (canonical 모드)
  - `"불가타"` → `"구약에 외경 포함"` (vulgate 모드)
  - About 링크 버전 표기 1.0.9 → 1.0.10

### SW 업데이트 토스트 자동 포커스 제거

- `app.js`: `showUpdateToast()` 내 `btn.focus()` 제거 — 토스트 표시 시 포커스 강제 이동하지 않음

### 런치 스크린 추가

- 앱 실행 시 테마 색상(`--accent`) 배경에 흰색 십자가(skh-cross.svg)를 표시하는 런치 스크린 구현
- 십자가가 scale-up되며 3초간 페이드아웃, 이후 DOM에서 제거
- `index.html`: `#launch-screen` div에 SVG 인라인 삽입 (fill white)
- `style.css`: 런치 스크린 오버레이 스타일 + `launch-screen-out`, `launch-cross-out` 키프레임 애니메이션
- `app.js`: `dismissLaunchScreen()` 함수, `route()` 첫 렌더 완료 시 1회 호출 (플래그 기반 중복 방지)
- `scripts/build-deploy.sh`: `skh-cross.svg` 배포 패키지에 추가

## 2026-04-11

### 불필요 파일 정리

- `static/sw.js` 삭제 — 구 아키텍처 서비스 워커, 아무데서도 참조 안 됨
- `static/pwa.js` 삭제 — 삭제된 static/sw.js 등록용
- `static/search-worker.js` 삭제 — 루트 search-worker.js의 구버전
- `static/verse-navigator.js` 삭제 — 구 독립 컴포넌트, app.js로 통합됨
- `static/verse-style.css` 삭제 — 구 CSS, style.css로 통합됨
- `static/manifest.webmanifest` 삭제 — 구버전 (경로 오류, 루트 manifest가 현재 버전)
- `deploy-20260410-232707.zip` 삭제 — 빌드 아티팩트, 저장소 불필요

### PWA 업데이트 감지 및 자동 새로고침 구현

- `app.js` SW 등록 로직 강화:
  - `hadController` 플래그로 첫 방문 vs. 업데이트 구분
  - `controllerchange` 이벤트 → `window.location.reload()` (업데이트 시에만)
- `sw.js` CACHE_NAME 변경 시점 주석 추가
- 운용 방침: 성경 장 JSON은 network-first로 자동 처리, books.json·셸 파일 변경 시에만 CACHE_NAME 버전업

### 문서 현행화

- `CLAUDE.md`: 프로젝트 구조(search-worker.js 추가, config.py 제거, static/ 정리), 현재 상태 갱신
- `docs/prd.md`: 데이터 파이프라인 입력 소스(.txt → .md), 프로젝트 구조 갱신, 인덱싱 단계 추가
- `tests/test_parser.py` 삭제 — 구 아키텍처(src.config, src.models) 기반, 실행 불가
- `tests/test_completeness.py` 신규 — ADR-004 Level 1 완전성 검증 (8개 테스트, 원본 텍스트 불필요)
  - 73권 존재, 1328개 장 파일, books.json 정합성, has_prologue 플래그, sir-prologue.json 구조, segments 스키마

### 구약 소분류 UI 추가

- `/#/` (홈) 및 `/#/old_testament` 페이지의 구약 목록을 4개 소분류로 세분화
  - **오경**: 창세기–신명기 (5권)
  - **역사서**: 여호수아–느헤미야·에스델 (12권, 불가타 모드에서 토비트·유딧·마카베오상하 포함)
  - **시서와 지혜서**: 욥기·시편·잠언·전도서·아가 (5권, 불가타 모드에서 지혜서·집회서 포함)
  - **예언서**: 이사야–말라기 (17권, 불가타 모드에서 바룩 포함)
- `OT_SUBCATEGORY` 맵으로 책 ID → 소분류 매핑, 불가타 모드(제2경전 혼합)에도 대응
- `style.css` `.ot-subcategory-title` 소제목 스타일 추가

### 수정 파일 요약

| 파일 | 변경 유형 |
|------|-----------|
| `static/sw.js`, `static/pwa.js`, `static/search-worker.js`, `static/verse-navigator.js`, `static/verse-style.css`, `static/manifest.webmanifest` | 삭제 |
| `deploy-20260410-232707.zip` | 삭제 |
| `app.js` | 수정 — SW controllerchange 자동 새로고침, 구약 소분류 UI, 버전 1.0.7 |
| `sw.js` | 수정 — CACHE_NAME 변경 시점 주석, 아이콘 파일 SHELL_FILES 추가 |
| `style.css` | 수정 — `.ot-subcategory-title` 소제목 스타일 |
| `index.html` | 수정 — 아이콘·OG 이미지 경로 루트로 수정 |
| `manifest.webmanifest` | 수정 — 아이콘 경로 루트로 수정 |
| `favicon.ico`, `icon-192.png`, `icon-512.png` | 신규 — 루트로 이동 |
| `CLAUDE.md` | 수정 — 구조·현재 상태 현행화 |
| `docs/prd.md` | 수정 — 파이프라인·구조 현행화 |
| `tests/test_parser.py` | 삭제 — 구 아키텍처 잔재 |
| `tests/test_completeness.py` | 신규 — ADR-004 Level 1 완전성 검증 |

### 검색 인덱스 분할 로딩 (ADR-005 개정)

- `search-index.json`(6.6MB 단일) → 4개 파일 분리:
  - `search-meta.json` (~9KB) — aliases + books 메타데이터
  - `search-nt.json` (~1.3MB) — 신약 7,940절
  - `search-dc.json` (~700KB) — 제2경전 4,114절
  - `search-ot.json` (~3.8MB) — 구약 23,430절
- 컬럼형 포맷 + RLE 인코딩: 키 이름 반복 제거, Worker에서 `Uint16Array`로 메모리 절감
- Progressive search: NT 로드 즉시 partial-results 전송, 전체 로드 후 최종 결과로 교체
- `search-worker.js` 전면 재작성, `app.js` 검색 관련 코드 리팩터링
- `sw.js` CACHE_NAME rev-7, `search-meta.json` SHELL_FILES 추가
- ADR-005 개정 섹션 추가

### compact 헤더 진동 수정

- 이어읽기 배너 `position: sticky` 제거 (불필요한 stacking context 원인)
- compact 헤더 hysteresis 적용: 접기 60px / 펴기 10px 임계값 분리로 피드백 루프 방지
- `#app-header` z-index 10→20으로 조정 (드롭다운이 배너에 가려지는 문제 해결)

### 보안 강화 및 Google Analytics 연동

- **Content Security Policy(CSP)** 메타태그 추가 — `'unsafe-inline'` 없이 최소 권한 정책 적용
  - `script-src 'self' googletagmanager.com`
  - `style-src 'self' fonts.googleapis.com`
  - `font-src fonts.gstatic.com`
  - `connect-src 'self' google-analytics.com analytics.google.com`
  - `object-src 'none'` / `base-uri 'self'`
- **Google Analytics (GA4)** 연동 (`G-2Q4SRGVNQN`)
  - 인라인 스크립트 대신 `gtag-init.js` 분리 (CSP 호환)
  - `sw.js` SHELL_FILES에 `gtag-init.js` 추가
- `<noscript>` 인라인 스타일 → `.noscript-fallback` CSS 클래스 분리 (CSP 대응)
- `rel="noopener"` → `rel="noopener noreferrer"` 수정 (Referrer 노출 방지)

## 2026-04-07

### 첫 페이지 SEO 기본 정보 노출

- **Open Graph / Twitter Card 메타 태그 추가**: SNS 공유 시 제목·설명·이미지 미리보기 지원
- **canonical URL**: `https://bible.anglican.kr/` 지정
- **JSON-LD 구조화 데이터**: `WebApplication` 스키마 (Schema.org) — 검색 엔진 리치 결과 지원
- **`<noscript>` 폴백**: JS 미실행 크롤러 및 스크린리더를 위한 서비스 설명 텍스트
- **`robots.txt`**: 크롤링 허용 + sitemap 경로 명시
- **`sitemap.xml`**: 첫 페이지 URL 포함 (SPA 단일 페이지)

### 서브모듈 업데이트

- **`data/source` (song.md)**: 아가 전문을 산문체에서 시(詩) 행 구분 형식으로 재구성, 화자 지시(신부, 신랑, 합창단)를 별도 행으로 분리

### 버전 범프

- `app.js`: 1.0.4 → 1.0.5

### 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `index.html` | 수정 — OG/Twitter/JSON-LD 메타 태그, noscript 추가 |
| `robots.txt` | 신규 — 크롤링 허용 + sitemap 경로 |
| `sitemap.xml` | 신규 — 첫 페이지 URL |
| `app.js` | 수정 — 버전 1.0.5 |
| `data/source` | 서브모듈 업데이트 — 아가 시행 구분 재구성 |

## 2026-04-06

### 마크다운 소스 파서 구현 및 데이터 파이프라인 전환

- **소스 포맷 전환**: `.txt` → `.md` 형식으로 전면 전환
  - `src/convert_txt_to_md.py` 신규 — 71개 `.txt` 파일을 `.md`로 일괄 변환
  - 장 헤더 `# N장`, 절 마커 `[N]`, 특수 토큰(`[N-M]`, `[Na]`, `[N_M]`) 정확 변환
  - 기존 `gen.md`, `ps.md` 보존 (총 73개 `.md` 소스 파일)

- **파서 리팩터링**: `.txt` 파서 제거, `.md` 파서(`parse_md_file`)만 유지
  - `parse_file()`, `_parse_verse_line()`, `_extract_verse_from_chapter_line()` 등 삭제
  - `parse_file_with_cache()`, `chapter_pattern` 등 `.txt` 전용 코드 제거
  - `load_from_json()`의 old `text` 호환 코드 제거
  - `main()` CLI를 `.md` 파일/디렉터리 입력으로 교체

- **전체 파이프라인 재실행**: 73권 1328장 35,482절 파싱 및 분리 완료
  - `data/source/*.md` → `output/parsed_bible.json` → `data/bible/*.json`

### 렌더러 개선 — segments 기반 산문/운문 처리

- **절 간 break 로직 개선**: `prevVerseEndType` 추적
  - `hemistich-break`: 이전 절·현재 절 모두 운문일 때만 (스탠자 내 반행 연결)
  - `paragraph-break`: 산문→운문 전환, 또는 `¶` 마커
  - 기존 `inPoetryStanza` 휴리스틱 완전 제거

- **절 내 세그먼트 전환 여백**: 산문→운문, 운문→산문 전환 시 `paragraph-break` 삽입
  - `prevSegType`으로 세그먼트 타입 변경 감지

- **운문 hanging punctuation**: `"`, `'`로 시작하는 운문 행의 따옴표를 왼쪽으로 내어쓰기
  - `.hanging-quote { margin-left: -0.4em }` — 따옴표 뒤 첫 글자가 들여쓰기 기준선에 정렬

- **운문 절 번호 왼쪽 정렬**: `text-align: right` → `text-align: left`
  - 절 번호가 산문 시작 위치에 맞춰 정렬

### 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `src/convert_txt_to_md.py` | 신규 — `.txt` → `.md` 일괄 변환 스크립트 |
| `src/parser.py` | 수정 — `.txt` 파서 제거, `.md` 파서만 유지, CLI 교체 |
| `src/split_bible.py` | 수정 — segments 출력 (기존 호환 유지) |
| `src/search_indexer.py` | 수정 — segments에서 텍스트 추출 (기존 호환 유지) |
| `app.js` | 수정 — segments 기반 렌더링, 절 간/세그먼트 간 break 로직, hanging punctuation |
| `style.css` | 수정 — 절 번호 왼쪽 정렬, hanging-quote 스타일 |
| `data/source/*.md` | 신규 — 71개 마크다운 소스 파일 |

## 2026-03-25

### 프로젝트 방향 전환 논의

- 기존 Python 빌드 방식(html_generator → 정적 HTML)에서 SPA 방식으로 전환 결정
- 장기 비전 확정: 성경 → 기도서 → 교회력 → 성무일과
- 세 가지 대안(A: 기존 코드 수정, B: HTML 생성기 재작성, C: SPA) 비교 후 C 선택
- ADR-001 작성

### 프로젝트 관리 체계 수립

- CLAUDE.md: 매 대화 자동 로드되는 프로젝트 컨텍스트
- docs/decisions/: 아키텍처 결정 기록 (ADR)
- docs/worklog.md: 작업 일지 (이 파일)
- 자동 메모리: 대화 간 맥락 유지

### 불필요한 파일 정리

- SPA 전환에 따라 불필요해진 파일 삭제:
  - Python: html_generator.py, wordpress_api.py, pwa_builder.py, **init**.py, run.py, setup.py
  - 설정: pyrightconfig.json, requirements.txt, env.example, .python-version
  - 빌드 결과물: output/html/, output/pwa/
  - 프론트엔드: templates/, static/ (전부 새로 작성 예정)
  - 테스트: tests/ (이전 코드 대상)
  - 문서: CHANGELOG.md, CONTRIBUTING.md
- 기존 문서 8개를 docs/archive/로 이동 (design-system, wireframes, prd, technical-design 등)
- 유지된 파일: parser.py, config.py, parsed_bible.json, 원본 텍스트, 매핑, 오디오

### 다음 작업

- [ ] parsed_bible.json → 장별 JSON 분리 스크립트 작성

- [ ] SPA 뼈대 구현 (index.html + app.js + router)

- [ ] 기본 성경 읽기 기능 구현

## 2026-03-26

### PRD 재작성

- 기존 PRD(archive/prd.md) 검토 후 SPA 아키텍처 기준으로 전면 재작성
- 변경 사항:
  - 기술 스택: Python 빌드 도구 → Vanilla JS SPA, Python은 전처리만
  - 데이터 흐름: parser→builder→HTML → parser→JSON 분리→브라우저 fetch/렌더링
  - 내비게이션: 브레드크럼 → 간결한 책/장 선택 드롭다운
  - Lighthouse 90+ 성능 목표 제거
  - 장기 로드맵(Phase 1\~4) 추가
- 기존 archive/prd.md 삭제

### PRD 요구사항 추가

- **이어읽기**: 앱 재진입 시 마지막 읽던 장/절로 자동 이동 (localStorage 사용, 쿠키 불필요)
- **HTTP 보안 헤더**: 배포 URL(https://bible.anglican.kr) 공개 서비스 고려
  - HSTS, X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy
  - 호스팅 레벨 설정으로 분리하여 명세
- 배포 URL 명시: https://bible.anglican.kr

### book_mappings.json 별칭 정리

- 별칭 추가: 탈출기, 사무엘기 상/하권, 열왕기 상/하권, 역대기 상/하권, 에즈라기, 느헤미야기
- 오타 수정: 호세야서 → 호세아서
- 중복/부정확 별칭 제거: 시편(abbr와 동일), 잠언(abbr와 동일), 바룩, 요나, 미가, 나훔, 하깨

### 다음 작업

- [x] parsed_bible.json → 장별 JSON 분리 스크립트 작성

- [ ] SPA 뼈대 구현 (index.html + app.js + router)

- [ ] 기본 성경 읽기 기능 구현

## 2026-03-26 (오후)

### book_id OSIS 소문자 표준화

- book_mappings.json의 id 필드를 OSIS 소문자 기준으로 전면 교체
- Paratext/USX 대신 OSIS를 선택한 이유: 성공회 전례 자료(RCL 등)와의 호환성, 웹 URL 친화성, 오픈소스 생태계
- 변경 45개, 유지 28개
- 주요 수정:
  - 빌립보서 `php` → `phil`, 빌레몬서 `phm` → `phlm` (기존 데이터 오류 수정 포함)
  - 시편 `psa` → `ps`, 마태 `mat` → `matt`, 마르코 `mrk` → `mark` 등
- parser.py 재실행으로 parsed_bible.json 재생성

### 집회서 머리말 처리 방식 결정 (ADR-002)

- 머리말은 절 번호 없는 산문으로 기존 parser.py가 누락하고 있었음
- B안(별도 파일) 채택: `data/bible/sir-prologue.json`
- books.json에 `has_prologue: true` 플래그 추가
- 검색 범위에서 제외

### split_bible.py 작성 완료

- `output/parsed_bible.json` → `data/bible/{book_id}-{chapter}.json` (1328개)
- `data/bible/sir-prologue.json` 생성 (집회서 머리말, 2단락)
- `data/books.json` 생성 (73권 메타데이터)
- CLAUDE.md 및 데이터 파이프라인 문서 업데이트

### parser.py 버그 수정 — 물리적 장(physical chapter) 처리

- **발견**: 원문에 `아모 6:9`, `이사 41:6`처럼 같은 장 또는 다른 장의 절이 중간에 표기되는 경우가 있음
- **원인**: 공동번역성서는 성서학자들의 사본 연구를 반영해 절의 위치를 재배치한 번역. parser.py가 `책이름 장:절` 패턴을 모두 새 장 시작으로 인식해 48개 장 중복, 4개 장 교차(cross-chapter) 누락이 발생하고 있었음
- **결정**: 원문의 물리적 읽기 순서를 존중(A안). 학자들의 배열이 성서 읽기의 취지에 부합
- **수정 내용**:
  - 새 장 시작 조건: `(book_abbr, chapter_num)` 미개방 + 절 번호 == 1인 경우에만
  - 같은 장 재등장(`아모 6:9`): 동일 장의 절로 처리
  - 다른 장 삽입(`이사 41:6` in isa-40): `chapter_ref` 필드로 표기
- **결과**: 중복 48개 해소, cross-chapter 삽입 6곳 `chapter_ref` 표기
  - 이사야 40장 ← 41:6절, 잠언 5장 ← 6:22절, 호세아 14장 ← 13:14절 등
- **데이터 모델 변경**: `Verse`에 `chapter_ref: Optional[int]` 필드 추가

### 데이터 파이프라인 테스트 전략 수립 (ADR-004)

- 원본 텍스트 저작권 제약으로 CI에서 직접 사용 불가
- 픽스처 기반 접근 채택: 절 번호 시퀀스만 추출해 저장소에 커밋 (본문 미포함)
- 3단계 테스트 기준 정의:
  - Level 1 완전성: 73권, 1328개 장 파일, books.json 정합성
  - Level 2 순서 보존: 픽스처와 JSON 출력물 비교 (CI 가능)
  - Level 3 스냅샷: cross-chapter 6곳, 재배치 구간 고정값 검증
- 픽스처 생성 스크립트(`generate_fixtures.py`)와 테스트 코드 작성은 다음 세션으로 미룸

### ¶ 연속 줄 이어붙이기 처리 (parser.py)

- **발견**: 원문에서 하나의 절이 두 줄에 걸쳐 표기되고 둘째 줄이 `¶`로 시작하는 패턴 59곳 발견

  ```
  20 예루살렘과 유다는 야훼의 진노를 사 마침내 그 앞에서 쫓겨나고 말았다.
  ¶ 시드키야가 바빌론 왕에게 반기를 들었다.
  ```

- **원인**: `_parse_verse_line`이 `parts[0].isdigit()` 조건으로 파싱하므로 `¶`로 시작하는 줄을 `None` 반환 → 텍스트 유실

- **결정**: A안(이어붙이기) — `¶`를 단락 구분자로 유지하며 이전 절 텍스트에 `\n¶ ...`로 연결

- **수정**: `parse_file`의 continuation 처리 로직 추가

  ```python
  elif current_verses and line.strip().startswith('¶'):
      current_verses[-1].text += '\n' + line.strip()
      current_verses[-1].has_paragraph = True
  ```

- **결과**: 열왕기하 24:20 등 59곳 텍스트 완전 복구, `has_paragraph: true` 올바르게 설정

- parser.py → parsed_bible.json → data/bible/ 파이프라인 재실행 완료

### 다음 작업

- [ ] SPA 뼈대 구현 (index.html + app.js + router)

- [ ] 기본 성경 읽기 기능 구현

- [ ] 테스트 코드 작성 (generate_fixtures.py, test_completeness.py, test_ordering.py, test_snapshots.py)

## 2026-03-27

### README.md 재작성

- 워드프레스 중심 내용 삭제, SPA/PWA 아키텍처 기준으로 전면 재작성

### 절 표기 패턴 전수 조사 및 파서 확장 (ADR-003 v2)

- 원본 텍스트를 전수 조사하여 파서가 누락하던 패턴 4종 발견 및 처리 결정:

**1. 단락 연속 (¶ 또는 빈 줄)**

- ¶ 연속 59곳은 이전 세션에서 처리 완료
- 빈 줄 + 마커 없는 연속 줄 8곳 추가 발견 (출애굽기 2, 이사야 4, 오바댜 1, 요한복음 1)
- 모두 앞 절의 b단락 (새 단락 시작) → 앞 절 text에 `\n` 이어붙임, `has_paragraph=true`
- ¶와 빈 줄 연속을 동일 조건으로 통합 (`not line.strip()[0].isdigit()`)

**2. 절 범위 (**`17-18`**, 16곳)**

- `range_end: Optional[int]` 필드 추가
- 검색: 범위 내 모든 절 번호에 인덱싱

**3. 부분절 (**`2a/3b`**, 24곳)**

- 성서학자들의 절 분할·재배치. 판관기, 사무엘기, 욥기, 시편, 이사야서 등
- `part: Optional[str]` 필드 추가 (`"a"`, `"b"`)
- 검색: `"2a"` 형태로 인덱싱

**4. 사본 이중 번호 (**`1_1`**, 116곳)**

- 에스더서(106)·다니엘서(10) 그리스어 부가문. LXX vs 히브리어 사본 번호 병기

- `alt_ref: Optional[int]` 필드 추가 (밑줄 뒤 번호)

- 렌더링: 뒷 번호 위첨자 표시. 해당 장 JSON에 `has_dual_numbering: true` 플래그

- 검색: 앞 번호(LXX) 기준

- ADR-003 v2로 개정 (개정 이력 포함)

- 데이터 파이프라인 재실행 완료

### SPA 뼈대 구현 완료

- 5개 파일 생성:
  - `index.html`: SPA 진입점 (단일 HTML, 시맨틱 구조)
  - `app.js`: 해시 기반 라우팅 + DOM 렌더링 (Vanilla JS)
  - `style.css`: 모바일 우선 반응형 스타일 (세리프 한글 서체, WCAG 2.1 AA)
  - `sw.js`: 서비스 워커 (앱 셸 캐시 우선, 성경 데이터 네트워크 우선)
  - `manifest.webmanifest`: PWA 매니페스트
- 해시 라우팅 구조:
  - `#/` — 73권 목록 (구약 / 외경 / 신약 구분)
  - `#/{book_id}` — 장 선택 그리드
  - `#/{book_id}/{chapter}` — 본문 읽기 (절 번호, 단락 구분, 이전/다음 장 내비게이션)
  - `#/{book_id}/prologue` — 머리말 (집회서)
- 보안: `innerHTML` 미사용, 모든 DOM을 `createElement`/`textContent`로 생성
- 접근성: `aria-label`, `aria-live`, breadcrumb 내비게이션, `focus-visible`

### 기본 성경 읽기 기능 구현

- **이어읽기**: localStorage에 마지막 읽은 위치(`bookId`, `chapter`) 저장, 목록 화면 상단에 "이어읽기: ○○ N장" 배너 표시
- **사본 이중 번호 렌더링**: 에스델·다니엘 등 `alt_ref` 필드 → `1(2)` 형태 위첨자 표시, `has_dual_numbering` 장 상단에 안내 문구
- **절 범위 표시**: `range_end` 필드 → `14-15` 형태 절 번호 렌더링
- **부분절 표시**: `part` 필드 → `6a` 형태 절 번호 렌더링, DOM ID도 `v6a`로 구분
- **교차 참조 표시**: `chapter_ref` 필드 → `14(13장)` 형태로 원래 장 번호를 절 번호 옆에 괄호 표기 + 연한 배경색으로 시각적 구분

## 2026-03-28

### UX 기능 구현

- **장 선택 팝오버**: 본문 읽기 뷰 toolbar에 `N장` pill 버튼 추가, 탭 시 장 번호 그리드 팝오버 표시 (바깥 클릭 시 닫힘)
- **글자 크기 조절**: toolbar에 A-/A+ 버튼 (16\~24px 5단계), localStorage 저장
- **다크모드**: `prefers-color-scheme` 감지 + 수동 토글 (☾/☀), CSS 변수 기반 테마 전환
- **브레드크럼 구분 추가**: `목록 › 구약/외경/신약 › 책이름` 형태로 상위 구분 표시
- **헤더 레이아웃 개편**: 제목 가운데 정렬, toolbar(장 선택 + 글자 크기 + 테마)을 우측에 배치
- **용어 변경**: "제2경전" → "외경"

### ¶ 렌더링 수정

- **¶ 기호 표시**: 기존에 `replace(/^¶\s*/, "")`로 제거하던 것을 `<span class="pilcrow">¶</span>`으로 렌더링, 색상은 `--paragraph-mark` CSS 변수
- **절 중간 단락 나눔**: 절 텍스트에 `\n¶`가 포함된 경우 (parser.py가 이어붙인 연속 줄), `paragraph-break`로 시각적 단락 분리. 절 번호는 첫 파트에만 표시

### 복사 시 출처 메타데이터 자동 추가

- 본문 선택 후 복사 시 클립보드에 출처 정보 자동 첨부: `— 창세기 1:1-3 (공동번역성서)`
- 단락 나뉨이 있는 절은 a/b로 구분: `data-vref` 속성으로 각 파트 식별
  - 단락 없는 절: `data-vref="2"` → `2`
  - 단락 있는 절: 첫 파트 `data-vref="5a"`, 둘째 `data-vref="5b"`
  - 예: 역대기상 22:2\~5절 첫 단락 선택 → `— 역대기상 22:2-5a (공동번역성서)`

### 네비게이션 및 헤더 개편

- **브레드크럼 division 팝오버**: 브레드크럼의 구약/외경/신약 항목을 클릭하면 3개 division 세로 목록 팝오버 표시, 선택 시 `/#/{division}` 페이지로 이동
- **division 페이지 (`/#/{division}`)**: 구약/외경/신약 별도 라우트 페이지 추가, 이어읽기 배너 포함
- **제목 division 피커**: division 페이지 제목을 클릭 가능한 버튼으로 변경, 장 선택 피커와 동일한 스타일 (CSS 셰브론 포함)
- **설정 팝오버**: 기존 toolbar(A-/A+, 다크모드 토글)를 제거하고 브레드크럼 행 우측에 ⚙ 설정 버튼으로 대체. 클릭 시 글자 크기·테마 설정 팝오버 표시. 모든 페이지에서 항상 접근 가능
- **헤더 구조 변경**: `#header-row` + `#toolbar` → `#breadcrumb-row`(브레드크럼 + 설정 버튼) + `#page-title` 구조로 단순화

### 접근성(A11y) 구현

- **스킵 내비게이션**: Tab 키 시 "본문 바로가기" 링크 표시, `#app`으로 점프
- **SPA 라우트 변경 알림**: `aria-live="polite"` 영역을 통해 페이지 전환 시 스크린리더에 페이지 제목 알림
- **Escape 키 팝오버 닫기**: 모든 팝오버(장 선택, division, 설정) Escape로 닫기 + 트리거 버튼에 포커스 복귀
- **랜드마크 라벨**: `<main aria-label="성경 본문">`, `<footer aria-label="사이트 정보">`
- **설정 변경 알림**: 글자 크기 변경 시 "글자 크기 20px", 테마 전환 시 "다크 모드"/"라이트 모드" 스크린리더 알림
- **팝오버 ARIA**: 모든 팝오버에 `role="listbox"` + `aria-label`, 트리거 버튼에 `aria-expanded` 상태 관리
- **절 번호 스크린리더 처리**: 연속 읽기 시 절 번호 숨김(`aria-hidden`), 절 텍스트 클릭/탭 시 "N절" 온디맨드 알림(`announce()`)
- **`.sr-only` 유틸리티**: 시각적으로 숨기되 스크린리더에는 보이는 CSS 클래스

### 오디오 플레이어 구현

- **푸터 → 설정 팝오버 이동**: `<footer>` 제거, 저작권 표기·GitHub 링크를 설정(⚙) 팝오버 하단으로 이동. 하단 영역을 오디오 플레이어 전용으로 확보
- **Sticky bottom bar 오디오 플레이어**: 장(chapter) 뷰·머리말(prologue) 뷰 진입 시 하단에 오디오 플레이어 표시
  - 재생/일시정지 버튼 (CSS 아이콘), 프로그레스 바 (재생 구간 accent 색 채움), 시간 표시
  - 반투명 배경 + `backdrop-filter: blur` 처리
  - 장 이동 시 이전 오디오 정지 후 새 오디오 로드
  - 오디오 파일 없는 경우 (토비트): static 위치에 "🎧 오디오 파일을 준비 중입니다." 메시지 (스크롤하면 사라짐)
- **키보드 단축키**: Space 키로 재생/정지 토글 (입력 필드 외)
- **접근성**: `aria-label`(재생/일시정지/재생 위치), `announce()` 상태 알림, 프로그레스 바 `role="slider"`
- **집회서 머리말 오디오**: `sir-0.mp3` 재생 지원 (`showAudioPlayer(book.id, 0)`)
- **이어읽기 머리말 지원**: `saveReadingPosition(bookId, "prologue")` 저장, 이어읽기 배너에 "머리말" 표시

### 책 목록 그리드 UI 개선

- **버튼 높이 통일**: `display: flex; align-items: center; height: 100%`로 같은 행 내 동일 높이
- **텍스트 가운데 정렬**: `justify-content: center; text-align: center`
- **단어 단위 줄바꿈**: `word-break: keep-all`로 한국어 단어가 잘리지 않게 처리

### 다음 작업

- [ ] 테스트 코드 작성

- [ ] PWA 아이콘 생성 (static/icon-192.png, static/icon-512.png)

## 2026-03-29

### 전역 검색 기능 구현 (3단계 핵심)

- **검색 인덱스 생성**: `src/search_indexer.py` 작성. `data/bible/*.json` → `data/search-index.json` (35,482절, 301개 별칭, 6.51MB)
  - `meta.aliases`: `book_mappings.json`의 `korean_name` + `aliases_ko` → book `id` 매핑
  - `meta.books`: 정렬 인덱스(`bo`) + 한국어 이름
  - 텍스트 클리닝: `¶` 제거, `\n` → 공백. 프롤로그 제외
  - `.gitignore`에 `data/search-index.json` 추가

- **Web Worker 검색 엔진**: `search-worker.js` (프로젝트 루트) 신규 생성
  - 메시지 프로토콜: `init` → `ready`, `search` → `results`/`error`
  - 절 참조 감지: 정규식으로 "창세 1:3" 패턴 인식 → `meta.aliases`로 bookId 변환
  - 전문 검색: 선형 스캔 + `String.includes` (대소문자 무시), 페이지네이션 슬라이스

- **반응형 검색 UI**:
  - **데스크탑 (≥769px)**: 브레드크럼 행 우측 인라인 검색바 (pill 형태, 포커스 시 확장). 400ms 디바운스 → `#/search?q=...` 해시 라우트. 결과는 메인 영역에 렌더링
  - **모바일 (≤768px)**: FAB 버튼 → 바텀시트(Bottom Sheet) 패턴. 드래그 핸들로 높이 조절 (30%~90vh), 아래로 많이 내리면 자동 닫힘. 결과는 시트 내부 렌더링
  - 브라우저 네이티브 검색 × 버튼 숨김 (커스텀 클리어 버튼 사용)

- **동적 페이지네이션**: 데스크탑·모바일 모두 뷰포트/시트 높이 기반으로 pageSize 자동 계산 (고정 50건 → 화면 맞춤)

- **검색 결과 → 본문 하이라이트**:
  - 검색 결과 클릭 시 `#/{bookId}/{chapter}?hl=검색어&v=절` 해시로 이동
  - `renderChapter`에서 `<mark class="search-highlight">` 래핑 + 해당 절 `.verse-highlight` 클래스 + 자동 스크롤

- **서비스 워커 업데이트**: `CACHE_NAME` → `"bible-v2"`, `SHELL_FILES`에 `search-worker.js` 추가, `data/search-index.json` 네트워크 우선 캐싱

- **헤더 여백 조정**: `#page-title`에 상하 마진 추가 (상 0.3rem, 하 0.2rem)

### ADR-005: 검색 인덱싱 전략

- 플랫 JSON 배열 + 선형 스캔 방식 채택 (C안)
- 검토한 대안: A안(외부 라이브러리 lunr.js 등), B안(역색인)
- 채택 근거: 35,482절은 선형 스캔으로 수십 ms 이내 처리 가능, 한국어 교착어 특성상 부분 문자열 매칭이 역색인보다 자연스러움, 외부 의존성 제로
- 향후 코퍼스 10만 건 이상 확장 시 역색인 또는 `Intl.Segmenter` 기반 토크나이저 재검토

### 수정 파일 요약

| 파일 | 변경 유형 |
|---|---|
| `src/search_indexer.py` | 신규 — 검색 인덱스 생성 스크립트 |
| `search-worker.js` | 신규 — Web Worker 검색 엔진 |
| `index.html` | 수정 — 인라인 검색바, FAB, 바텀시트 마크업 |
| `app.js` | 수정 — 해시 라우팅 확장, Worker 통합, 검색 UI, 하이라이트 |
| `style.css` | 수정 — 검색바, FAB, 바텀시트, 하이라이트, 페이지네이션 스타일 |
| `sw.js` | 수정 — 캐싱 전략 추가, 버전 범프 |
| `.gitignore` | 수정 — `data/search-index.json` 추가 |
| `docs/prd.md` | 수정 — 3단계 체크리스트 갱신, 검색 UI 상세 추가 |

### 다음 작업

- [ ] 테스트 코드 작성
- [ ] PWA 아이콘 생성 (static/icon-192.png, static/icon-512.png)
- [ ] 정적 파일 배포 설정 및 보안 검토
- [ ] 성능 최적화 및 오류 로깅 체계 구축