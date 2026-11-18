# 서비스 워커, 캐시, 릴리스

소유 코드: `js/manifest-sync.js`, `js/offline-save.js`

서비스 워커(`sw.js`)의 셸 캐시, 콘텐츠 해시 매니페스트로 하는 캐시 무효화, 설정의 「오프라인 저장」, 버전과 릴리스 절차(`scripts/release.py`)를 다룬다. 배포는 `common-bible-server` 저장소가 맡는다.

## 지금 동작

- **PWA 버전과 캐시 무효화를 다시 설계했다** (2026-05-13, ADR-021).
  - SHELL_CACHE의 이름은 `version.json`에서 만든다. `sw.js`가 `sw-version.js`를 importScripts로 가져온다.
  - DATA_CACHE와 AUDIO_CACHE는 콘텐츠 해시 매니페스트(`bible-manifest.json`, `audio-manifest.json`)를 견줘, 바뀐 항목만 처음 쓸 때 무효화한다.
  - 데이터 저장소의 main에 변경이 머지되면, 그 저장소의 CI가 파이프라인과 매니페스트를 자동으로 빌드해 커밋한다. release.py는 git 커밋까지 자동으로 한다(M8 해소).
  - Phase 3(데이터 변경을 앱 저장소에 자동으로 반영하는 webhook, `sync-data.yml`)까지 끝났다. 남은 것은 Phase 4, 곧 dev 배포 뒤 DevTools로 캐시 동작을 확인하는 일이다(ADR-021 상태 줄).

### 오프라인 저장 (ADR-045)

- 설정 「시스템」 섹션의 「백업 & 동기화」 위에 스위치 한 줄이 있다(`settings-ui.js`의 `makeOfflineRows`). 켜면 `js/offline-save.js`(`window.offlineSave`)가 성서 본문, 성서 검색 자료, 교회력 자료를 DATA_CACHE에 받는다. 성무일과 독서표(`office-readings.json`)는 뺀다.
- 받을 파일과 크기는 데이터 저장소의 크기 목록 `/data/bible-sizes.json`에서 읽는다. 파일마다 저장 크기(`sizes`)와 gzip 크기(`gzip_sizes`)가 있다. 서비스 워커는 이 파일을 네트워크에서 먼저 받아 DATA_CACHE에 두고, 받지 못하면 그 사본을 낸다. 셸에 미리 받지 않으므로 이 기능을 쓰지 않는 기기는 받지 않는다.
- DATA_CACHE에 이미 있는 파일은 다시 받지 않는다. 한 번에 6개씩 받고, 요청에 머리글 `X-Offline-Save`를 붙인다. 서비스 워커는 이 머리글이 있으면 캐시를 보지도 저장하지도 않고 네트워크로만 보내고, 페이지가 `cache.put`을 기다려 저장한다. 그래야 공간 부족(`QuotaExceededError`)을 페이지가 안다.
- 받기 전에 `navigator.storage.estimate()`의 남은 공간이 받을 크기의 1.05배보다 작으면 받지 않는다. 공간 부족이면 스위치를 끄고 그때까지 받은 파일은 남긴다. 켤 때 `navigator.storage.persist()`를 요청한다.
- 상태는 꺼짐, 확인 중, 저장 중, 모두 저장됨, 인터넷 연결이 없음, 서버에서 받지 못함, 공간이 모자람이다(`OfflineSaveStatus`). 인터넷이 없으면 `online` 이벤트에 이어 받고, 서버 오류는 다음에 앱을 열 때 이어 받는다.
- 앱을 열면 `manifest-sync.js`가 바뀐 파일을 지운 뒤 `offlineSave.resume()`이 지운 파일과 새 파일을 받는다(`app.js`).
- 끄면 북마크 삭제와 같은 확인 창(`openConfirmModal`, `bookmark.js`의 파사드)을 띄우고, 「삭제」는 DATA_CACHE를 통째로 지운다. 「캐시 초기화」는 지우기 전에 `offlineSave.forget()`으로 스위치를 끈다.
- 스위치는 `localStorage`의 `bible-offline-save`(`1`이면 켬)에 저장하고 동기화하지 않는다.
- **크기**(2026-11-17, 데이터 `d63bcae`에서 잼). 1MB는 1,000,000바이트다. Apple은 iOS 10까지 저장 공간을 1,024 단위로 적었다고 밝힌다([Apple 지원 문서](https://support.apple.com/en-us/102119)).

  | 자료 | 파일 수 | 저장 크기 | gzip |
  | --- | --- | --- | --- |
  | 성서 본문 | 1,492 | 9,136,889바이트(9.1MB) | 약 3.0MB |
  | 성서 검색 자료 | 3 | 5,960,797바이트(6.0MB) | 약 1.7MB |
  | 교회력 자료(`office-readings.json` 뺌) | 11 | 2,143,935바이트(2.1MB) | 약 0.17MB |
  | 모두 | 1,506 | 17,241,621바이트(17.2MB) | 4,864,112바이트 |

  - 운영 서버는 이 파일들을 gzip 수준 6으로 압축해 보낸다(`common-bible-server`의 nginx 설정 예시). `gzip_sizes`는 같은 수준으로 잰 값이고, `bible/gen-1.json`은 서버가 실제로 보낸 크기(1,727바이트)와 같았다(2026-11-18). 설명의 「약 5MB」는 이 합을 반올림한 값이다.
- **브라우저의 저장 규칙**(2026-11-18 조사)
  - 아이폰 Safari는 Safari를 쓰는 7일 동안 이 사이트를 한 번도 열지 않으면, 서비스 워커의 캐시를 포함해 사이트가 저장한 자료를 지운다. 홈 화면 앱은 Safari와 따로 날을 세고, WebKit은 그 자료가 지워질 것으로 보지 않는다([WebKit 블로그 2020-03-24](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)). 그래서 설명에 Safari 탭에서만 안내 한 문장을 넣는다(`detectPlatform()`이 `ios-safari`일 때).
  - Safari 17부터 사이트 하나가 디스크의 약 60%까지 쓸 수 있고 홈 화면 앱도 같다. 자료를 지우는 때는 전체 한도를 넘을 때, 기기의 공간이 모자랄 때, 오래 쓰지 않았을 때다. 오래 보관 모드인 사이트는 지우는 대상에서 빠질 수 있고, 그 모드는 홈 화면 앱인지 같은 기준으로 허락한다. `navigator.storage.estimate()`는 Safari 17부터 있다([WebKit 블로그 2023-08-10](https://webkit.org/blog/14403/updates-to-storage-policy/)).
  - `navigator.storage.persist()`는 Safari 15.2부터 있다(MDN 호환성 자료). Chrome은 묻지 않고 설치 여부와 방문 빈도로 허락하고, Firefox는 허락을 묻는 창을 띄운다. 허락받은 자료는 공간이 모자라도 지우지 않는다. 한도를 넘으면 저장이 `QuotaExceededError`로 실패한다([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), [web.dev](https://web.dev/articles/persistent-storage)).
  - 연결 종류를 알려 주는 `navigator.connection`과 앱을 닫아도 받는 Background Fetch는 Safari와 Firefox에 없다(MDN 호환성 자료).
  - 확인하지 못한 것: Safari 탭에서 오래 보관을 허락받으면 7일 규칙에서도 빠지는지.
- **아이폰의 Safari 탭과 홈 화면 앱은 저장한 자료를 나눠 쓰지 않는다**(실기기 확인 2026-11-18). 같은 아이폰에서 두 곳의 설정이 다르게 보였다. [firt.dev](https://firt.dev/notes/pwa-ios/)의 「Storage shared with Browser ❌」와 같다. 그래서 스위치도 두 곳에서 따로 켠다.

## 결정

- ADR-021 「PWA 버전 식별자를 콘텐츠 해시 매니페스트로」
- ADR-001 「SPA 아키텍처 선택」(오프라인 우선)
- ADR-045 「오프라인 저장은 성서 본문과 교회력 자료를 한 스위치로 저장한다」
- 캐시 전략은 `architecture.md` §4.6, 빌드와 배포는 `architecture.md` §8에 있다. 릴리스 전 CSP 점검은 `tools/csp/README.md`.

## 함정

### pitfalls §7 — PWA 캐시 무효화는 셸 버전 올리기와 콘텐츠 매니페스트 두 가지다

앱은 오프라인에서도 열리도록 화면 코드와 본문을 기기에 저장해 둔다(캐시). 새 버전을 내면 사용자 기기에 저장된 옛 파일을 버리고 새 파일을 받게 해야 한다. 이것을 캐시 무효화라고 한다. ADR-021 이후 캐시 무효화는 두 길로 나뉜다.

- **셸**은 앱의 화면을 그리는 파일(JS, CSS, HTML, 아이콘)과 책 목록 같은 작은 데이터 파일이다. 버전을 올리면(셸 bump) 셸 캐시의 이름이 바뀌고, 셸 파일을 모두 새로 받는다.
- **본문, 검색 색인, 오디오**는 파일이 많고 크다. 그래서 파일마다 내용으로 만든 지문(해시)을 적은 목록(콘텐츠 해시 매니페스트)을 두고, 앱이 시작할 때 새 목록을 지난번 목록과 견줘, 지문이 바뀐 파일만 버린다. 버린 파일은 처음 쓸 때 다시 받는다.

| 변경 대상 | 무효화 방식 | 호출/자동화 |
|-----------|------------|-------------|
| 셸 (JS/CSS/HTML/icons + `books.json`·`search-meta.json`·매니페스트 2종) | `SHELL_CACHE` 이름 bump (= `"shell-" + APP_VERSION`) | `release.py patch`가 `version.json`과 `sw-version.js`를 한 줄씩 갱신 |
| 본문 (`/data/bible/*`) 또는 검색 인덱스 (`search-{ot,nt,dc,lit}.json`) | 항목마다 처음 쓸 때 무효화 (콘텐츠 해시 매니페스트 비교) | `common-bible-data` CI가 `bible-manifest.json`을 자동으로 갱신하고, 앱이 시작할 때 `js/manifest-sync.js`가 처리 |
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
  - 오프라인 저장이 서비스 워커를 거치는 길도 dev 배포 뒤 확인한다. 받는 요청은 머리글 `X-Offline-Save` 때문에 서비스 워커가 저장하지 않고, 크기 목록 `bible-sizes.json`은 네트워크에서 먼저 받아 DATA_CACHE에 둔다. 화면 없는 Chromium의 e2e는 서비스 워커를 막고 돌려 이 길을 지나지 않는다.
  - 2026-10-17부터는 캘린더와 전례독서 화면이 오프라인에서 **다시** 열리는지도 확인한다. 온라인에서 한 번 연 뒤 연결을 끊고 연다.
  - 그 화면의 모듈 묶음은 서비스 워커가 설치 때 미리 받아 둔다(`SHELL_FILES`, `tests/unit/sw.test.js`가 지킨다). 교회력 표(`/data/lectionary/*`)는 처음 쓸 때 캐시한다. 그래서 오프라인 저장을 켜지 않았으면, 온라인에서 한 번도 열지 않은 캘린더가 오프라인에서 「교회력 자료를 불러오지 못했습니다」가 되는 것은 정상이다. PR #355 리뷰에서 원장의 「오프라인에서도 그 화면이 처음 열리도록」이 틀렸다고 확인했다.
  - **Firefox로 확인**(2026-11-07, `a7106e3`, 2.0.0 릴리스 준비). dev에서 Firefox 150으로 서비스 워커 설치(셸 파일 55개)와 오프라인에서 다시 열기(성서 장, 캘린더 월간과 목록, 전례독서, 설정)를 확인했다. 실제 아이폰 확인은 2.0.0을 dev에 올린 뒤에 한다.
  - **설치가 멈추는 원인 추정**(2026-11-07, PR #520). 설치 코드는 셸 파일을 모두 받은 뒤에야 응답 본문을 읽어 저장한다. HTTP/1로 응답하는 서버(로컬 개발 서버)에서는 본문을 읽지 않은 응답들이 연결을 차지해, 나머지 요청을 보내지 못하는 것으로 보인다.
    - 같은 방식의 작은 서비스 워커로 재 보았다(헤드리스 Chromium 148, HTTP/1.0과 1.1 서버). 파일 3개는 설치가 끝나고 4개부터 멈췄다. 받을 때마다 저장하거나 `cache.addAll`을 쓰면 40개도 끝났다. 브라우저는 한 서버에 연결을 여섯 개까지 여는데 4개부터 멈추는 까닭은 이것으로 설명되지 않아, 원인은 확정하지 못했다.
    - 개발용 서버와 운영 서버는 HTTP/2로 응답한다. 같은 브라우저에서 개발용 서버(dev.anglican.kr)의 `sw.js`는 약 1.3초 만에 설치가 끝났다. HTTP/1.1로 연결되는 사용자에게 영향이 있는지는 확인하지 못했다.
    - 확인할 일: HTTP/1.1로 연결되는 경우(일부 프록시 뒤 등)가 실제로 있는지, 설치 방식을 바꿀지. 받을 때마다 본문을 읽어 두었다가 모두 받은 뒤에 저장하면, 하나라도 실패하면 아무것도 저장하지 않는 지금의 동작을 지킬 수 있다.
