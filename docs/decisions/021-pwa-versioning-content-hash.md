# ADR-021: PWA 버전 식별자를 콘텐츠 해시 매니페스트로 전환

- 일시: 2026-05-13
- 상태: 승인됨 — Phase 1, 2, 3 구현 완료(Phase 3 webhook `sync-data.yml` 가동 중). Phase 4(실배포 검증과 DevTools 캐시 동작 확인)는 대기
- 관련 ADR: ADR-001(SPA와 서비스 워커 골격), ADR-015(저장 전략과 캐시 분리), ADR-016(오디오 캐시 LRU), ADR-020(모노레포 4분할. 세부 결정 3의 release.py 위치와 「수동 두 단계」 배포 흐름이 이 ADR로 바뀌었다)

## 맥락

ADR-020에서 저장소를 넷(앱, 데이터, 오디오, 서버)으로 나눈 뒤에도 PWA 캐시 식별자는 모두 앱 저장소의 `sw.js`에 적혀 있었다.

```js
const SHELL_CACHE = "shell-68";   // 셸 — 앱 저장소 소유 (적절)
const DATA_CACHE  = "data-3";     // 본문/검색 JSON — 데이터 저장소가 소유해야 함
const AUDIO_CACHE = "audio-1";    // mp3 — 오디오 저장소가 소유해야 함
```

문제는 셋이었다.

1. **맡는 저장소의 경계가 어긋난다.** 데이터 저장소에서 JSON 형식을 바꿔도, 그 저장소 안에는 「형식 rev이 몇인지」를 적을 자리가 없었다. 앱 개발자가 서브모듈 포인터를 올린 뒤 `release.py --bump-data`를 기억해 내 손으로 실행해야 했다(ADR-020의 「수동 두 단계」).
2. **무효화 단위가 너무 크다.** `DATA_CACHE = "data-3" → "data-4"`를 한 번 하면 1328개 장 전체(약 6 MB)를, `AUDIO_CACHE`를 한 번 올리면 약 6.3 GB의 mp3 전체를 다시 받는다. 장 하나를 고치거나 mp3 하나를 다시 인코딩하는 흔한 변경에 비해 비용이 지나치다.
3. **release.py에 git 자동화가 없다** (감사 보고서 M8, `docs/archive/audit/2026-05-08-second-comprehensive.md:87-88`). 한쪽만 올리고 커밋을 빠뜨리면 서비스 워커가 낡은 셸 캐시를 다시 쓴다.

## 결정

아래 변경을 한 묶음으로 적용한다.

### 1. 데이터 저장소 CI 자동 파이프라인

`common-bible-data/.github/workflows/build.yml`:
- main 브랜치에 `source/**`나 audio submodule pointer 변경이 들어오면 자동으로 돈다. 지금은 교회력 데이터를 포함한 파이프라인 입력 전체를 본다.
- 기존 파이프라인(parser, split_bible, search_indexer)을 돌린 뒤, 새로 만든 `scripts/gen_manifests.py`가 두 매니페스트를 만든다.
- 바뀐 산출물(`bible/`, `books.json`, `search-*.json`, `bible-manifest.json`, `audio-manifest.json`)을 `github-actions[bot]`이 main에 커밋하고 올린다(push). 커밋 메시지에 `[skip ci]`를 붙이지 않는다(2026-05-23, data#1). 그래야 validate.yml이 이 커밋에서 다시 돌아, 빌드된 산출물을 검증한다. 그래서 main의 마지막 validate가 늘 실제 산출물 상태를 반영한다.
- 무한 루프는 생기지 않는다. `paths:` 필터에 산출물 경로(bible/, search-*.json 등)가 없으므로, 자기가 올린 커밋이 build.yml을 다시 실행시키지 않는다.
- 기존 `pipeline.yml`은 PR에서 산출물이 어긋났는지(drift) 확인하는 용도로 좁힌다.

### 2. 콘텐츠 해시 매니페스트와 처음 쓸 때 무효화(lazy)

데이터 저장소 안에 매니페스트 둘을 더한다.

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

`bible-manifest.json`은 1329 장 JSON과 3 검색 인덱스(약 133 KB), `audio-manifest.json`은 1314 mp3(약 130 KB)를 담는다(도입 때 수). 오디오 해시는 git LFS pointer 파일의 `oid sha256:...`를 그대로 쓴다. 그래서 CI가 LFS의 실제 바이너리를 받지 않아도 된다(`GIT_LFS_SKIP_SMUDGE=1`).

앱 쪽에 새로 만든 `js/manifest-sync.js`가 하는 일은 다음과 같다.
- 부팅 직후 `syncManifests()`를 1회 호출한다.
- 두 매니페스트를 받는다. sw.js는 이 요청을 네트워크 우선으로 보내고, 실패하면 SHELL_CACHE에 미리 넣어 둔 사본을 쓴다.
- IDB store `bible-manifest-sync/snapshots`에 저장한 직전 스냅샷과 견준다. 해시가 바뀌었거나 사라진 키를 낡은 항목(stale)으로 모은다.
- `data`와 `audio` 캐시에서 그 URL만 `cache.delete`로 지운다. 새로 받지는 않는다.
- 사용자가 그 장으로 가거나 그 오디오를 재생할 때, 서비스 워커의 fetch handler가 캐시에서 찾지 못해 네트워크로 받고, 새 콘텐츠를 캐시에 넣는다.

첫 부팅(직전 스냅샷 없음)에는 일부러 아무것도 무효화하지 않는다. 매니페스트를 들이기 전의 캐시 항목은 캐시 이름이 바뀌면서(`data-3 → data`, `audio-1 → audio`) 서비스 워커가 작동을 시작할 때(activate) 한꺼번에 정리된다.

DATA_CACHE와 AUDIO_CACHE는 이제 rev 없는 고정 이름(`"data"`, `"audio"`)이다.

### 3. SHELL_CACHE rev를 version.json에 합치고 git 자동화를 더한다

앱 저장소의 버전 관리는 `version.json` 한 파일로 좁힌다.
- 새로 만든 `sw-version.js`(한 줄짜리 `self.APP_VERSION = "X.Y.Z";`)
- `sw.js`가 `importScripts('/sw-version.js')`로 받아 `SHELL_CACHE = "shell-" + self.APP_VERSION`을 만든다.
- importScripts로 불러온 파일도 서비스 워커 업데이트의 byte-diff 검사 대상이다(Chrome 78+/FF/Safari 14+). 그래서 APP_VERSION 한 줄을 바꾸면 서비스 워커가 저절로 업데이트된다.

`scripts/release.py`를 다시 쓴다.
- 인자는 `patch | minor | major | X.Y.Z` 하나뿐이다.
- `version.json`과 `sw-version.js`를 함께 고친다.
- 마지막에 두 파일을 커밋한다(`chore: X.Y.Z 릴리스`). 묻는 창은 없다. 처음에는 `git add version.json sw-version.js data`로 서브모듈 포인터와 sitemap.xml도 함께 담았지만, 2026-05-23부터 두 파일만 담는다(아래 4).
- `--bump-data`, `--bump-audio` 플래그는 없앤다(rev라는 개념 자체가 없어졌다).
- push는 사람이 직접 한다(실수를 막기 위해서다).

### 4. 데이터 동기화와 릴리스를 나눈다 (2026-05-23)

데이터 저장소의 build.yml이 산출물을 올린 뒤 `gh api ... /dispatches`로 앱 저장소의 `.github/workflows/sync-data.yml`을 실행한다(Phase 3). `sync-data.yml`은 서브모듈 포인터를 갱신하고, sitemap.xml을 다시 만들어 커밋 하나로 올린다. version은 건드리지 않는다(`release.py patch`를 실행하지 않는다).

- **릴리스를 낼지는 사람이 정한다.** 사용자가 알맞은 때에 직접 `python scripts/release.py`를 실행해 버전을 올린다(patch / minor / major 가운데 무엇인지도 사람이 판단한다). 데이터가 자주 바뀔수록, 자동으로 버전을 올리면 사용자에게 의미 없는 서비스 워커 업데이트 알림(토스트)이 쌓였기 때문이다.
- **sitemap은 릴리스와 나눈다.** `release.py`가 담는 파일(paths)에서 sitemap.xml을 뺐다. sitemap은 SHELL_CACHE에 들어가지 않아 사용자 클라이언트가 받지 않으므로, 바뀌어도 서비스 워커를 업데이트할 이유가 없다. webhook이 데이터를 동기화할 때마다 build_sitemap.py를 실행해 갱신하고, 커밋해 올린다.
- 결과: 데이터가 바뀔 때마다 main에 커밋이 쌓이지만 사용자의 서비스 워커와는 상관없다. 사용자가 릴리스를 낼 때까지 운영(prod)에서 사용자가 보는 동작은 그대로다. Google 봇은 바뀐 직후의 sitemap을 바로 볼 수 있다(릴리스와 무관하다).

`sync-data.yml`은 main에 직접 올리지 않고 PR로 올린다(2026-05-30). 2026-05-29에 main 브랜치 보호를 적용한 뒤, 직접 올리기가 `Required status check "Unit tests" is expected`로 거부되어 webhook 자동화가 깨졌다(5월 30일 두 차례 동기화 실패로 드러났다). 브랜치 보호는 유지하고 자동화를 PR 흐름에 맞췄다.

1. **sync/data-<run_id> 토픽 브랜치 + PR + auto-merge.** `sync-data.yml`이 토픽 브랜치로 올린 뒤 `gh pr create`로 PR을 만들고, `gh pr merge --auto --squash --delete-branch`로 자동 머지를 켠다. Unit tests가 통과하면 저절로 squash 머지하고 브랜치를 지운다. 여전히 사람 손이 들어가지 않는다.
2. **PAT를 나눈다.** 토픽 브랜치 push와 PR 생성에는 common-bible의 Contents:Write와 Pull requests:Write만 가진 `SYNC_DATA_PR_PAT`를 쓴다. `GITHUB_TOKEN`으로 만든 PR은 pull_request 이벤트를 일으키지 않아 Unit tests가 돌지 않으므로 PAT가 꼭 필요하다. 서브모듈은 저장소마다 둔 **읽기 전용 배포 키**(`DATA_DEPLOY_KEY`·`AUDIO_DEPLOY_KEY`)로 받는다(2026-08-29). 만료가 없고 GitHub이 읽기 전용을 강제한다. data 저장소의 `build.yml`은 앱 워크플로를 실행하는 데 `Actions:Write`가 필요해 PAT를 계속 쓴다.
3. **저장소 설정 `allow_auto_merge: true`.** `gh pr merge --auto`가 동작하는 조건이다.
4. **워크플로 이름을 맞춘다.** `Sync data submodule and release`를 `Sync data submodule`로 바꿨다. 2026-05-23의 변경으로 release.py 호출이 이미 없어져, 「and release」가 실제와 어긋나 있었다.

### 5. 셸 미리 넣기의 캐시 우회와 서버 응답 헤더 (2026-05-27, 1.5.5)

1.5.4 릴리스 뒤 일부 사용자에게서, SHELL_CACHE 이름은 `shell-1.5.4`인데 그 안의 `js/app/settings-ui.js` 본문이 1.5.3 코드인 사고가 났다. 같은 SHELL_CACHE에서 `version.json`처럼 릴리스마다 바이트가 바뀌는 파일만 새것이었다. 주소가 그대로인 JS/CSS를 CDN, 엣지, origin 가운데 어딘가가 옛 etag와 옛 max-age로 캐시해 두었다가 돌려준 것으로 보았다. 위 3의 SHELL_CACHE 이름 만들기는 정상이었고(이름은 제대로 올라갔다), 그 안에 채워 넣은 내용이 낡았던 것이다.

두 층에서 막는다.

1. **앱 쪽 (1.5.5, PR #147 머지):** `sw.js`의 install 핸들러가 셸 URL마다 `?v=<APP_VERSION>`을 붙여 받는다. 그러면 중간 캐시가 새 키로 다시 받을 수밖에 없다. `cache.put`은 쿼리 없는 원래 Request로 저장해, 페이지가 실행 중에 보내는 요청과 맞게 한다. 모든 fetch가 끝나기를 먼저 기다린 뒤 한꺼번에 넣어, `cache.addAll`처럼 전부 되거나 전부 안 되게 한다. 중간에 fetch가 실패하면 SHELL_CACHE는 이전 상태 그대로다.
2. **서버 쪽 (`common-bible-server/nginx/cache-policy.example.conf`):** 셸의 단일 파일(`sw.js`, `sw-version.js`, `version.json`, `manifest.webmanifest`, `bible-manifest.json`, `audio-manifest.json`, `index.html`, `privacy.html`)과 JS/CSS 디렉터리, 데이터 JSON 전부에 `Cache-Control: no-cache, must-revalidate`를 보낸다. ETag가 같으면 304라 대역폭 부담은 무시할 만하고, 서비스 워커가 캐시에서 내주므로 사용자가 느끼는 지연도 없다. 오디오 mp3는 매니페스트 해시가 지우는 시점을 정하므로 `public, max-age=3600`, 아이콘과 스플래시는 `max-age=86400`이다.

회복: 1.5.4의 낡은 셸에 갇힌 사용자는 1.5.5 서비스 워커가 설치되고 작동을 시작할 때(install, activate) 저절로 회복한다. 바로 회복하려면 설정의 「캐시 초기화」를 누른다.

## 검토한 대안

| 대안 | 채택하지 않은 이유 |
|---|---|
| 데이터/오디오 저장소에 각자 `version.json`(형식 rev)을 두고 release.py가 맞추기 | rev를 올리는 일 자체가 여전히 전체 무효화 단위다. 콘텐츠 해시 방식이 더 세밀하다. |
| 서브모듈 SHA를 캐시 이름에 자동으로 넣기(`data-<short-sha>`) | 서브모듈 포인터 한 줄만 바꿔도 사용자가 ~6 GB를 다시 받는다. 내용이 그대로여도 캐시가 무효화된다. |
| 매니페스트를 SHELL_CACHE에 미리 넣어 두고 서비스 워커 업데이트 때만 견주기 | 데이터가 바뀌어도 앱 서비스 워커가 업데이트되지 않으면 사용자는 낡은 콘텐츠를 그대로 쓴다. 매니페스트는 최신이어야 하므로 네트워크 우선이 자연스럽다. |
| 캐시된 mp3의 실제 바이너리를 매번 SHA-256으로 다시 계산해 매니페스트와 견주기 | 1314 mp3 × ~3 MB, 곧 부팅마다 약 4 GB를 해싱한다. CPU 비용이 크다. 직전 스냅샷과 견주는 방식은 비용이 0이다. |
| `peter-evans/repository-dispatch` 액션으로 webhook 보내기 | StepSecurity 6/10, 취약점 6건, 개인 메인테이너다. 1st-party `gh api` 한 줄로 대신한다(Phase 3). |
| `repository_dispatch` 이벤트 보내기 | Fine-grained PAT의 Contents:Write가 필요하다. common-bible이 공개 저장소라 PAT가 새면 공개 push 위험이 있다. `workflow_dispatch`를 채택한다(Actions:Write만 필요하고, 실행할 수 있는 대상이 sync-data.yml 하나로 한정된다). |

### 데이터가 올라오면 자동으로 release.py patch 실행 (2026-05-23까지)

- Phase 3 webhook은 처음에 「data push, 자동 release.py patch, 자동 version 올리기」로 이어졌다. release.py는 sitemap.xml과 서브모듈 포인터도 함께 담았다.
- 채택 안 함 2026-05-23 · 이유: 데이터가 자주 바뀔수록 사용자에게 의미 없는 서비스 워커 업데이트 알림이 쌓였다. sitemap.xml 빌드 로직만 고칠 때도 release.py가 그 파일을 담아 version이 올라가는 부작용이 있었다. 지금은 위 4대로 나눈다.

### build 자동 커밋에 `[skip ci]` 붙이기 (2026-05-23까지)

- 처음에는 위 1의 자동 커밋 메시지에 `[skip ci]`를 넣어 `[skip ci]` 커밋으로 올렸다.
- 채택 안 함 2026-05-23 (data#1) · 이유: 이 표시가 validate.yml까지 막았다. 마크다운만 올린 push로 절 구조가 바뀌면, validate가 옛 artifacts로 실패하고 build 뒤에는 다시 돌지 않는 경쟁 상태가 있었다(fe254de `fix: 아모스서 절 번호 수정` 때 드러났다). build.yml은 paths 필터가 산출물 경로를 빼므로 `[skip ci]` 없이도 자기를 다시 실행시키지 않는다.

### sync-data.yml이 main에 바로 올리기 (2026-05-30까지)

- 처음에는 `sync-data.yml`이 main에 바로 올렸다.
- 채택 안 함 2026-05-30 · 이유: 2026-05-29에 적용한 main 브랜치 보호가 필수 검사를 거치지 않은 push를 거부했다. 지금은 위 4대로 PR과 auto-merge로 올린다.

### 서브모듈을 `SUBMODULE_AND_DISPATCH_PAT`로 받기 (2026-08-29까지)

- 2026-05-30에 PAT를 나눌 때, 기존 `SUBMODULE_AND_DISPATCH_PAT`는 권한을 줄이려는 뜻대로 그대로 두고 서브모듈 클론에 계속 썼다.
- 채택 안 함 2026-08-29 · 이유: 그 PAT가 2026-08에 만료되어 `sync-data.yml`이 아무 알림 없이 멈췄다. 같은 이름의 시크릿이 data 저장소에도 따로 있어, 한쪽만 바꿨다가 반쪽만 복구되는 일도 있었다. 지금은 위 4의 읽기 전용 배포 키를 쓴다. `SYNC_DATA_PR_PAT`는 그대로다.

## 영향

### ADR-016 (오디오 캐시 LRU)
- LRU sidecar 자체는 바뀌지 않는다(`{url, byteSize, addedAt, lastPlayedAt}`).
- 다만 manifest-sync가 낡은 항목을 캐시에서 지울 때 sidecar의 해당 행도 함께 지운다(`ac.removeEntries`). 그러지 않으면 totalSize 합계가 어긋난다.
- AUDIO_CACHE 이름이 `"audio-1"`에서 `"audio"`로 고정된다. 더는 올리지 않는다.

### ADR-020 (모노레포 4분할)
- 「release.py는 앱 저장소에 남긴다」는 세부 결정 3은 그대로 유효하다(앱 셸 버전의 수명을 다룬다).
- 「수동 두 단계」 흐름은 바뀌었다. 데이터나 오디오가 바뀌면 앱 개발자가 손으로 올리던 흐름이 없어졌다. 데이터 저장소 CI 자동 파이프라인과 manifest-sync가 처음 쓸 때 무효화를 맡는다. ADR-020은 옛 흐름을 「검토한 대안」에, 지금 흐름을 「배포와 운영」에 적었다.

### 옮기는 비용 (한 번)
모든 캐시 이름이 한꺼번에 바뀌므로(`shell-68 → shell-1.4.13`, `data-3 → data`, `audio-1 → audio`, `fonts-v1 → fonts`) 첫 릴리스 때 사용자 캐시 4종이 모두 정리된다. 본문은 다음에 그 장으로 갈 때 다시 받고(약 6 MB), 오디오는 사용자가 재생할 때만, 폰트는 다음 페이지 로드 때(약 200 KB) 받는다. 그 뒤로는 콘텐츠 단위의 무효화만 일어난다.

### 보안
- 매니페스트 해시를 만드는 곳은 데이터 저장소 CI 하나뿐이다. main 브랜치 보호로 직접 push를 막으면 더 안전하다.
- webhook PAT(Phase 3)는 Actions write 권한만 갖고, 90일 뒤 만료된다.

## Phase

- **Phase 1** (데이터 저장소): `scripts/gen_manifests.py` + `.github/workflows/build.yml` + 초기 매니페스트 baseline + `pipeline.yml`을 PR 전용으로 좁히기.
- **Phase 2** (앱 저장소): `sw-version.js` + `sw.js` 리팩터 + `js/manifest-sync.js` + `js/audio-cache.js` 캐시 이름 고정 + `js/app.js` 부팅 순서 + `release.py` 재작성 + 단위 테스트 + 이 ADR + 관련 문서 갱신.
- **Phase 3** (webhook 자동화): 데이터 build.yml 끝에 `gh api ... /dispatches`를 두고, 앱에 `.github/workflows/sync-data.yml`을 새로 만든다. 데이터 main이 바뀌면 앱 서브모듈 포인터를 자동으로 올린다. 처음에는 release.py 자동 commit·push까지 했지만, 2026-05-23부터 버전은 사람이 올린다(위 4).
- **Phase 4** (실배포 검증): dev에 배포한 뒤 DevTools로 매니페스트 동기화와 해시 무효화가 제대로 도는지 확인하고 운영에 올린다(promote).

## 검증

- 단위 (`tests/unit/manifest-sync.test.js`, 14 케이스): `_staleKeys` 5종, `_urlToManifestKey` 4종, `syncManifests` 5종(첫 부팅에는 아무것도 하지 않음, 해시가 바뀌면 그 항목만 지움, 네트워크가 실패하면 캐시를 그대로 둠, 깨진 JSON은 무시, 매니페스트에서 entry가 사라지면 캐시에서 지움).
- 단위 (`scripts/test_release.py`, 10 케이스): semver 올리기, sw-version.js 텍스트 바꾸기.
- 회귀: `node --test tests/unit/*.test.js` 505 케이스 통과(그때 수). `npx tsc -p tsconfig.json --noEmit` 0 error.
- E2E (Phase 4): dev 배포 뒤 DevTools Application의 Cache Storage 항목 변화를 보고, Service Workers의 Update로 새 SHELL_CACHE가 활성화되는지 본다.
