# 서비스 워커, 캐시, 릴리스

소유 코드: `js/manifest-sync.js`

서비스 워커(`sw.js`)의 셸 캐시, 콘텐츠 해시 매니페스트로 하는 캐시 무효화, 버전과 릴리스 절차(`scripts/release.py`)를 다룬다. 배포는 `common-bible-server` 저장소가 맡는다.

## 지금 동작

- **PWA 버전과 캐시 무효화를 다시 설계했다** (2026-05-13, ADR-021).
  - SHELL_CACHE의 이름은 `version.json`에서 만든다. `sw.js`가 `sw-version.js`를 importScripts로 가져온다.
  - DATA_CACHE와 AUDIO_CACHE는 콘텐츠 해시 매니페스트(`bible-manifest.json`, `audio-manifest.json`)를 견줘, 바뀐 항목만 처음 쓸 때 무효화한다.
  - 데이터 저장소의 main에 변경이 머지되면, 그 저장소의 CI가 파이프라인과 매니페스트를 자동으로 빌드해 커밋한다. release.py는 git 커밋까지 자동으로 한다(M8 해소).
  - Phase 3(데이터 변경을 앱 저장소에 자동으로 반영하는 webhook, `sync-data.yml`)까지 끝났다. 남은 것은 Phase 4, 곧 dev 배포 뒤 DevTools로 캐시 동작을 확인하는 일이다(ADR-021 상태 줄).

## 결정

- ADR-021 「PWA 버전 식별자를 콘텐츠 해시 매니페스트로」
- ADR-001 「SPA 아키텍처 선택」(오프라인 우선)
- 캐시 전략은 `architecture.md` §4.6, 빌드와 배포는 `architecture.md` §8에 있다. 릴리스 전 CSP 점검은 `tools/csp/README.md`.

## 함정

### pitfalls §7 — PWA 캐시 무효화는 셸 버전 올리기와 콘텐츠 매니페스트 두 가지다

앱은 오프라인에서도 열리도록 화면 코드와 본문을 기기에 저장해 둔다(캐시). 새 버전을 내면 사용자 기기에 저장된 옛 파일을 버리고 새 파일을 받게 해야 한다. 이것을 캐시 무효화라고 한다. ADR-021 이후 캐시 무효화는 두 길로 나뉜다.

- **셸**은 앱의 화면을 그리는 파일(JS, CSS, HTML, 아이콘)과 책 목록 같은 작은 데이터 파일이다. 버전을 올리면(셸 bump) 셸 캐시의 이름이 바뀌고, 셸 파일을 모두 새로 받는다.
- **본문, 검색 색인, 오디오**는 파일이 많고 크다. 그래서 파일마다 내용으로 만든 지문(해시)을 적은 목록(콘텐츠 해시 매니페스트)을 두고, 앱이 시작할 때 새 목록을 지난번 목록과 견줘, 지문이 바뀐 파일만 버린다. 버린 파일은 처음 쓸 때 다시 받는다.

| 변경 대상 | 무효화 방식 | 호출/자동화 |
|-----------|------------|-------------|
| 셸 (JS/CSS/HTML/icons + `books.json`·`search-meta.json`·매니페스트 2종) | `SHELL_CACHE` 이름 bump (= `"shell-" + APP_VERSION`) | `release.py patch`가 `version.json`과 `sw-version.js`를 한 줄씩 갱신 |
| 본문 (`/data/bible/*`) 또는 검색 인덱스 (`search-{ot,nt,dc}.json`) | 항목마다 처음 쓸 때 무효화 (콘텐츠 해시 매니페스트 비교) | `common-bible-data` CI가 `bible-manifest.json`을 자동으로 갱신하고, 앱이 시작할 때 `js/manifest-sync.js`가 처리 |
| 오디오 mp3 | 항목마다 처음 쓸 때 무효화 | 위와 같다 (`audio-manifest.json`) |

DATA_CACHE와 AUDIO_CACHE의 이름은 더 이상 올리지 않는다(`"data"`, `"audio"`로 고정). `--bump-data`와 `--bump-audio` 플래그는 없앴다.

**사례:**
- 옛 작업 기록(worklog)의 2026-04-30 항목(`git show 243bf83^:docs/worklog.md`): 개인정보 처리방침 페이지(`privacy.html`)를 더할 때 세 가지를 한 번에 해야 했다. 설치 때 미리 받을 파일 목록(`SHELL_FILES`)에 넣었다. 이 앱은 모든 페이지 주소에 앱 화면(`index.html`)을 내주는데, 이 페이지는 따로 열리도록 예외를 두었다(navigation 예외 처리). 그리고 버전을 올렸다(셸 bump). 셸 쪽은 매니페스트를 도입한 뒤에도 같다.

**SW 변경 체크리스트:** 서비스 워커(`sw.js`)를 고칠 때 빠뜨리기 쉬운 것들이다.

```
□ 새 파일을 SHELL_FILES 에 추가했는가
□ navigation 요청 처리에서 예외가 필요한 페이지인가 (standalonePages 등)
□ 어느 캐시(shell/data/audio)에 속하는지 sw.js cacheNameFor 라우팅이 맞는가
□ 셸 영역 변경이면 release.py 로 version.json + sw-version.js bump 했는가
□ 본문/오디오 콘텐츠 변경이면 데이터 저장소 CI가 매니페스트를 자동 갱신했는가 (manual gen_manifests.py 실행으로 미리 확인 가능)
```

`scripts/release.py`는 셸만 다룬다. 콘텐츠 매니페스트는 데이터 저장소의 `scripts/gen_manifests.py`가 맡는다.

## 남은 일

- **known-issues §6.1** **서비스 워커 설치와 오프라인 동작은 확인하지 못했다.** 화면 없이 돌리는 테스트용 브라우저(헤드리스 Chromium)에서는 파일을 동시에 10개 넘게 받는 설치 단계가 멈춰서(main의 `sw.js`도 같다) 브라우저로 볼 수 없었다. 설치 때 받을 파일(`SHELL_FILES`) 54개가 모두 정상(200)으로 응답하는 것만 curl로 확인했다. 배포 전에 실기기에서 한 번 확인한다.
  - 2026-10-17부터는 캘린더와 전례독서 화면이 오프라인에서 **다시** 열리는지도 확인한다. 온라인에서 한 번 연 뒤 연결을 끊고 연다.
  - 그 화면의 모듈 묶음은 서비스 워커가 설치 때 미리 받아 둔다(`SHELL_FILES`, `tests/unit/sw.test.js`가 지킨다). 교회력 표(`/data/lectionary/*`)는 처음 쓸 때 캐시한다. 그래서 온라인에서 한 번도 열지 않은 캘린더가 오프라인에서 「교회력 자료를 불러오지 못했습니다」가 되는 것은 정상이다. PR #355 리뷰에서 원장의 「오프라인에서도 그 화면이 처음 열리도록」이 틀렸다고 확인했다.
