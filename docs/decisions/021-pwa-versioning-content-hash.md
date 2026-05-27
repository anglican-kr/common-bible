# ADR-021: PWA 버전 식별자를 콘텐츠 해시 매니페스트로 전환

- 일시: 2026-05-13
- 상태: 승인됨 — Phase 1·2 구현 완료, Phase 3(webhook) 후속, Phase 4(실배포 검증) 대기
- 관련 ADR: ADR-001(SPA·서비스 워커 골격), ADR-015(저장 전략·캐시 분리), ADR-016(오디오 캐시 LRU), ADR-020(모노레포 4분할 — §22 release.py 위치 결정, §73-74 "수동 두 단계" 운영 흐름 개정 대상)

## 맥락

ADR-020에서 저장소를 네 개(앱·데이터·오디오·서버)로 분할한 뒤에도 PWA 캐시 식별자는 모두 앱 저장소 `sw.js`에 박혀 있었다:

```js
const SHELL_CACHE = "shell-68";   // 셸 — 앱 저장소 소유 (적절)
const DATA_CACHE  = "data-3";     // 본문/검색 JSON — 데이터 저장소가 소유해야 함
const AUDIO_CACHE = "audio-1";    // mp3 — 오디오 저장소가 소유해야 함
```

세 문제:

1. **소유권 경계 위반.** 데이터 저장소에서 JSON 포맷을 바꿔도 그 저장소 안에는 "포맷 rev이 몇이냐"를 표시할 자리가 없었다. 앱 dev가 서브모듈 포인터 bump 후 `release.py --bump-data`를 수동으로 떠올려 실행해야 했다 (ADR-020 §73-74의 "수동 두 단계").
2. **무효화 단위가 너무 굵음.** `DATA_CACHE = "data-3" → "data-4"` 한 번이면 1328개 장 전체(~6 MB)를, `AUDIO_CACHE` bump 한 번이면 ~6.3 GB mp3 전체를 재다운로드. 한 장 수정이나 한 mp3 재인코딩 같은 흔한 변경에 비해 비용이 과함.
3. **release.py에 git 자동화 없음** (감사 보고서 M8, `docs/audit/2026-05-08-second-comprehensive.md:87-88`). 한쪽만 bump 후 commit 누락 시 SW가 stale 셸 캐시 재사용.

## 결정

세 변경을 한 묶음으로 적용한다.

### 1. 데이터 저장소 CI 자동 파이프라인

`common-bible-data/.github/workflows/build.yml`:
- main 브랜치에 `source/**` 또는 audio submodule pointer 변경이 들어오면 자동 실행.
- 기존 파이프라인(parser → split_bible → search_indexer) 후 신설 `scripts/gen_manifests.py`가 두 매니페스트를 생성.
- 변경분(`bible/`, `books.json`, `search-*.json`, `bible-manifest.json`, `audio-manifest.json`)을 `github-actions[bot]`이 main에 `[skip ci]` 커밋·푸시.
- 무한 루프 방지: `paths:` 필터가 산출물 경로(bible/, search-*.json 등)를 포함하지 않으므로 자가-푸시 커밋은 워크플로우를 다시 트리거하지 않음.
- 기존 `pipeline.yml`은 PR drift 체크 용도로 좁힘.

### 2. 콘텐츠 해시 매니페스트 + lazy 무효화

데이터 저장소 안에 두 매니페스트 추가:

```json
{
  "format": 1,
  "generated_at": "2026-05-13T00:00:00Z",
  "entries": {
    "bible/gen-1.json": "sha256:...",
    "audio/1chr-1.mp3": "sha256:..."
  }
}
```

`bible-manifest.json`은 1329 장 JSON + 3 검색 인덱스(~133 KB), `audio-manifest.json`은 1314 mp3(~130 KB). 오디오 해시는 git LFS pointer 파일의 `oid sha256:...`를 그대로 사용(LFS 본 바이너리 다운로드 불필요 — CI에서 `GIT_LFS_SKIP_SMUDGE=1`).

앱 측 신설 `js/manifest-sync.js`:
- 부팅 직후 1회 `syncManifests()` 호출.
- 두 매니페스트를 fetch (sw.js가 네트워크-우선으로 라우팅, 실패 시 SHELL_CACHE 의 precached 사본 fallback).
- IDB store `bible-manifest-sync/snapshots`에 저장된 직전 스냅샷과 비교 → 해시가 바뀌었거나 사라진 키를 stale 집합으로 추출.
- `data` / `audio` 캐시에서 해당 URL만 `cache.delete` (다운로드는 안 함).
- 사용자가 그 장 navigate / 오디오 play 시점에 SW fetch handler가 cache miss → 네트워크 → 새 콘텐츠 캐시.

첫 부팅(이전 스냅샷 없음)은 의도적으로 무효화 안 함 — 매니페스트 도입 전의 기존 캐시 항목은 캐시 이름 자체가 바뀌면서(`data-3 → data`, `audio-1 → audio`) SW activate에서 한 번에 청소된다.

DATA_CACHE / AUDIO_CACHE는 이제 rev 없는 고정 이름 (`"data"`, `"audio"`).

### 3. SHELL_CACHE rev을 version.json 에 통합 + git 자동화

앱 저장소의 버전 관리는 `version.json` 한 파일로 좁힘:
- 신설 `sw-version.js` (한 줄짜리 `self.APP_VERSION = "X.Y.Z";`)
- `sw.js`가 `importScripts('/sw-version.js')`로 받아 `SHELL_CACHE = "shell-" + self.APP_VERSION` 파생
- importScripts 대상도 SW 업데이트 byte-diff 검사 대상 (Chrome 78+/FF/Safari 14+) — APP_VERSION 한 줄 바꾸면 SW 자동 업데이트 트리거.

`scripts/release.py` 재작성:
- 인자는 `patch | minor | major | X.Y.Z` 하나만.
- `version.json` + `sw-version.js` 같이 갱신.
- 끝에 `git add version.json sw-version.js data`(서브모듈 포인터 포함) → 자동 commit (`chore: X.Y.Z 릴리스`). 프롬프트 없음.
- `--bump-data`, `--bump-audio` 플래그 제거 (rev 개념 자체가 없어짐).
- push는 사람이 직접 (실수 방지).

## 검토한 대안

| 대안 | 보류 이유 |
|---|---|
| 데이터/오디오 저장소에 각자 `version.json` (포맷 rev) 두고 release.py가 동기화 | rev bump 자체가 여전히 전체 무효화 단위. 콘텐츠 해시 방식이 더 세밀. |
| 서브모듈 SHA를 자동으로 캐시 이름에 박음 (`data-<short-sha>`) | 서브모듈 포인터 한 줄만 바꿔도 사용자 ~6 GB 재다운로드. 콘텐츠 미변경 시에도 캐시 무효화. |
| 매니페스트를 SHELL_CACHE 에 미리 박아두고 SW 업데이트 시점에만 비교 | 데이터 변경 → 앱 SW 업데이트 없으면 사용자가 stale 콘텐츠 그대로 사용. 매니페스트는 freshness가 중요해 네트워크-우선이 자연. |
| 캐시된 mp3 본 바이너리를 매번 SHA-256 재계산해 매니페스트와 비교 | 1314 mp3 × ~3 MB = ~4 GB hashing/boot. CPU 비용 큼. 직전 스냅샷 diff 방식이 비용 0. |
| `peter-evans/repository-dispatch` 액션으로 webhook 발신 | StepSecurity 6/10, 취약점 6건, 개인 메인테이너. 1st-party `gh api` 한 줄로 대체 (Phase 3). |
| `repository_dispatch` 이벤트 발신 | Fine-grained PAT 의 Contents:Write 필요. common-bible 이 공개 저장소라 PAT 누출 시 공개 push 위험. `workflow_dispatch` 채택 (Actions:Write 만 필요, 트리거 대상이 sync-data.yml 하나로 한정). |

## 영향

### ADR-016 (오디오 캐시 LRU)
- LRU sidecar 자체는 변경 없음 (`{url, byteSize, addedAt, lastPlayedAt}`).
- 단 manifest-sync가 stale 항목을 cache에서 제거할 때 sidecar의 해당 row 도 같이 정리 (`ac.removeEntries`) — 그러지 않으면 totalSize 누계가 어긋남.
- AUDIO_CACHE 이름이 `"audio-1"` → `"audio"` 로 고정. 더 이상 bump 없음.

### ADR-020 (모노레포 4분할)
- §22 "release.py는 앱 저장소에 남김" 결정 유효 (앱 셸 버전 생애주기 관리 책임).
- §73-74 "수동 두 단계" 개정 대상: 데이터/오디오 변경 시 앱 dev가 수동으로 bump하던 흐름 제거. 데이터 저장소 CI 자동 파이프라인 + manifest-sync 가 lazy 무효화 담당.

### 마이그레이션 비용 (1회성)
모든 캐시 이름이 동시 변경(`shell-68 → shell-1.4.13`, `data-3 → data`, `audio-1 → audio`, `fonts-v1 → fonts`)되므로 첫 릴리스 시 사용자 cache 4종 모두 청소됨. 본문은 다음 navigate 시 재다운로드(~6 MB), 오디오는 사용자가 재생할 때만, 폰트는 다음 페이지 로드 시(~200 KB). 이후로는 콘텐츠 단위 invalidation만 일어남.

### 보안
- 매니페스트 해시 출처는 데이터 저장소 CI가 유일. main 브랜치 protection으로 직접 push 차단 시 더 안전.
- webhook PAT(Phase 3)은 Actions write 권한만, 90일 만료.

## Phase

- **Phase 1** (데이터 저장소): `scripts/gen_manifests.py` + `.github/workflows/build.yml` + 초기 매니페스트 baseline + `pipeline.yml` PR-only 좁힘.
- **Phase 2** (앱 저장소): `sw-version.js` + `sw.js` 리팩터 + `js/manifest-sync.js` + `js/audio-cache.js` 캐시 이름 고정 + `js/app.js` 부팅 시퀀스 + `release.py` 재작성 + 단위 테스트 + 본 ADR + 관련 docs 갱신.
- **Phase 3** (webhook 자동화): 데이터 build.yml 끝에 `gh api ... /dispatches`, 앱 `.github/workflows/sync-data.yml` 신설. 데이터 main 변경 → 앱 서브모듈 포인터 자동 bump → release.py 자동 commit·push.
- **Phase 4** (실배포 검증): dev 배포 후 DevTools로 매니페스트 동기화·해시 무효화 동작 확인 → promote. `docs/qa/`에 비기술 독자용 보고서.

## 검증

- 단위 (`tests/unit/manifest-sync.test.js`, 14 케이스): `_staleKeys` 5종, `_urlToManifestKey` 4종, `syncManifests` 5종 (first-boot no-op, hash 변경 시 해당 항목 단독 evict, 네트워크 실패 시 캐시 보존, malformed JSON 무시, 매니페스트 entry 삭제 → 캐시 evict).
- 단위 (`scripts/test_release.py`, 10 케이스): semver bump, sw-version.js 텍스트 치환.
- 회귀: `node --test tests/unit/*.test.js` 505 케이스 통과. `npx tsc -p tsconfig.json --noEmit` 0 error.
- E2E (Phase 4): dev 배포 후 DevTools Application → Cache Storage 항목 변화 확인, Service Workers → Update → 새 SHELL_CACHE 활성화 확인.

> **개정 (2026-05-23):** 릴리스 발행권을 사람에게 분리, sitemap을 release 흐름에서 분리
>
> Phase 3 webhook 자동화의 "data push → 자동 release.py patch → 자동 version bump"
> 흐름은 데이터가 자주 갱신될수록 사용자에게 의미 없는 SW update 토스트를
> 누적시켰다. sitemap.xml 빌드 로직만 손볼 때도 release.py 가 stage 했기에
> 같은 이유로 version 이 bump 되는 부작용이 있었다.
>
> 두 가지를 분리한다:
>
> 1. **릴리스 발행권은 사람에게.** `.github/workflows/sync-data.yml` 은
>    `release.py patch` 호출을 제거하고, 서브모듈 포인터 갱신 + sitemap.xml
>    재생성 + 단일 commit + push 만 수행한다. version 은 건드리지 않는다.
>    사용자가 적절한 시점에 직접 `python scripts/release.py` 를 호출해
>    버전을 bump 한다 (어떤 patch / minor / major 인지 사람 판단).
>
> 2. **sitemap 은 release 와 분리.** `release.py` 의 paths 에서 sitemap.xml
>    을 제거. sitemap 은 SHELL_CACHE 에 들어가지 않아 사용자 클라이언트가
>    fetch 하지 않으며, 변경이 SW update 를 정당화하지 않는다. webhook 이
>    매 데이터 동기화 시 build_sitemap.py 를 호출해 자동 갱신·commit·push.
>
> 결과: 데이터 변경마다 main 에는 commit 이 쌓이지만 (사용자 SW 무관),
> 사용자가 release 를 cut 할 때까지 prod 의 사용자 향 동작은 그대로다.
> Google 봇은 변경 직후 갱신된 sitemap 을 즉시 볼 수 있다 (release 와 무관).

> **개정 (2026-05-23, data#1):** build 자가 commit 에서 `[skip ci]` 제거
>
> §1 의 build.yml 자가 commit 메시지에 박혀 있던 `[skip ci]` 토큰이
> validate.yml 도 함께 차단해, source-only push 로 절 구조가 바뀐 경우
> validate 가 옛 artifacts 에 대해 fail 하고 build 후엔 재실행이 안 되는
> race condition 이 있었다 (fe254de `fix: 아모스서 절 번호 수정` 시 노출).
>
> build commit 의 `[skip ci]` 를 제거한다. build.yml 자체는 paths 필터가
> 산출물 경로를 제외해 자가 재트리거되지 않으므로 무한 루프는 발생하지 않고,
> validate.yml (paths 필터 없음) 만 자가 commit 에서 재발화해 빌드된
> artifacts 에 대해 정합성을 다시 검증한다. 결과적으로 main 의 마지막
> validate 가 항상 실제 산출물 상태를 반영하게 된다.

> **개정 (2026-05-27, 1.5.5):** SW 셸 프리캐시 캐시버스터 + nginx 응답 헤더 정책
>
> 1.5.4 릴리스 후 일부 사용자에게서 SHELL_CACHE 이름은 `shell-1.5.4` 인데
> 그 안의 `js/app/settings-ui.js` 본문이 1.5.3 코드인 stale 사고가 발생.
> 같은 SHELL_CACHE 의 다른 파일(`version.json` 같이 매 릴리스 바이트가
> 변하는 파일) 만 fresh 였다 — 안정 URL 의 JS/CSS 가 CDN/엣지/origin
> 어딘가에서 옛 etag·옛 max-age 로 cache hit 응답을 돌려준 패턴으로
> 해석됨. §3 의 SHELL_CACHE 파생 자체는 정상 동작했고 (이름은 올바르게
> bump 됨), 채워 넣은 콘텐츠가 stale 이었던 것.
>
> 두 층으로 닫는다:
>
> 1. **앱 측 (1.5.5, PR #147 머지):** `sw.js` install 핸들러가 각 셸
>    URL 을 `?v=<APP_VERSION>` 으로 fetch 해 중간 캐시 키를 강제로 새로
>    만들고, `cache.put` 은 쿼리 없는 원본 Request 로 저장 (페이지 런타임
>    요청 매칭 보존). 원자성 유지를 위해 모든 fetch 를 먼저 await 한 뒤
>    한꺼번에 put — `cache.addAll` 의 all-or-nothing 시맨틱 보존. 중간
>    fetch 실패 시 SHELL_CACHE 는 이전 상태 그대로.
>
> 2. **서버 측 (`common-bible-server/nginx/cache-policy.example.conf`):**
>    셸 단일 파일(`sw.js`, `sw-version.js`, `version.json`,
>    `manifest.webmanifest`, `bible-manifest.json`, `audio-manifest.json`,
>    `index.html`, `privacy.html`)·JS/CSS 디렉토리·데이터 JSON 전부
>    `Cache-Control: no-cache, must-revalidate`. ETag 일치 시 304 라
>    대역폭 부담 무시 가능, SW 가 캐시 hit 으로 서빙해 사용자 latency
>    영향도 없음. 오디오 mp3 는 매니페스트 hash 가 evict 트리거이므로
>    `public, max-age=3600`, 아이콘·스플래시는 `max-age=86400`.
>
> 회복 경로: 1.5.4 stale 에 갇힌 사용자는 1.5.5 SW install·activate
> 시점에 자동 회복. 즉시 회복은 설정 → "캐시 초기화".
