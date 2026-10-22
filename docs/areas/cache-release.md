# 서비스 워커, 캐시, 릴리스

소유 코드: `js/manifest-sync.js`

서비스 워커(`sw.js`)의 셸 캐시, 콘텐츠 해시 매니페스트로 하는 캐시 무효화, 버전과 릴리스 절차(`scripts/release.py`)를 다룬다. 배포는 `common-bible-server` 저장소가 맡는다.

## 지금 동작

- **PWA 버전·캐시 무효화 재설계** — ADR-021, 2026-05-13. SHELL_CACHE 는 `version.json`에서 파생 (`sw-version.js` importScripts), DATA/AUDIO_CACHE 는 콘텐츠 해시 매니페스트(`bible-manifest.json`·`audio-manifest.json`) diff 로 항목 단위 lazy 무효화. 데이터 저장소 CI 가 main 머지 시 파이프라인 + 매니페스트 자동 빌드 + 자동 커밋백. release.py 가 git 자동 commit (M8 해소). Phase 3 webhook 자동화 후속

## 결정

- ADR-021 「PWA 버전 식별자를 콘텐츠 해시 매니페스트로」
- ADR-001 「SPA 아키텍처 선택」(오프라인 우선)
- 캐시 전략은 `architecture.md` §4.6, 빌드와 배포는 §8에 있다. 릴리스 전 CSP 점검은 `tools/csp/README.md`.

## 함정

### pitfalls §7 — PWA 캐시 무효화 — 셸 bump vs 콘텐츠 매니페스트

ADR-021 이후 캐시 무효화는 두 경로로 갈린다:

| 변경 대상 | 무효화 방식 | 호출/자동화 |
|-----------|------------|-------------|
| 셸 (JS/CSS/HTML/icons + `books.json`·`search-meta.json`·매니페스트 2종) | `SHELL_CACHE` 이름 bump (= `"shell-" + APP_VERSION`) | `release.py patch` — `version.json` + `sw-version.js` 한 줄 갱신 |
| 본문 (`/data/bible/*`) 또는 검색 인덱스 (`search-{ot,nt,dc}.json`) | 항목별 lazy 무효화 (콘텐츠 해시 매니페스트 diff) | `common-bible-data` CI 가 `bible-manifest.json` 자동 갱신, 앱은 `js/manifest-sync.js` 가 부팅 시 처리 |
| 오디오 mp3 | 항목별 lazy 무효화 | 같음 (`audio-manifest.json`) |

DATA_CACHE/AUDIO_CACHE 이름 자체는 더 이상 bump하지 않음 (`"data"`, `"audio"` 로 고정). `--bump-data`·`--bump-audio` 플래그는 제거됨.

**사례:**
- 옛 worklog의 2026-04-30 항목(`git show 243bf83^:docs/worklog.md`) — `privacy.html` 추가 시 `SHELL_FILES` 등록 + navigation 예외 처리 + 셸 bump가 한 묶음으로 진행되어야 했음 (셸 영역은 매니페스트 적용 후에도 같음).

**SW 변경 체크리스트:**

```
□ 새 파일을 SHELL_FILES 에 추가했는가
□ navigation 요청 처리에서 예외가 필요한 페이지인가 (standalonePages 등)
□ 어느 캐시(shell/data/audio)에 속하는지 sw.js cacheNameFor 라우팅이 맞는가
□ 셸 영역 변경이면 release.py 로 version.json + sw-version.js bump 했는가
□ 본문/오디오 콘텐츠 변경이면 데이터 저장소 CI가 매니페스트를 자동 갱신했는가 (manual gen_manifests.py 실행으로 미리 확인 가능)
```

스크립트 `scripts/release.py`는 셸만 다룬다. 콘텐츠 매니페스트는 데이터 저장소의 `scripts/gen_manifests.py` 책임.

## 남은 일

- **known-issues §6.1** **서비스 워커 설치와 오프라인 동작은 확인하지 못했다** — 헤드리스 Chromium에서는 동시에 10개 넘게 받는 설치가 멈춰(main의 `sw.js`도 같다) 브라우저로 볼 수 없었다. `SHELL_FILES` 54개가 모두 200으로 응답하는 것만 curl로 확인했다. 배포 전 실기기에서 한 번 확인한다. 2026-10-17부터는 캘린더 · 전례독서 화면이 오프라인에서 **다시** 열리는지도 여기에 든다 — 온라인에서 한 번 연 뒤 연결을 끊고 연다. 그 화면의 모듈 셋은 서비스 워커가 설치 때 미리 받아 두지만(`SHELL_FILES` — `tests/unit/sw.test.js`가 지킨다), 교회력 표(`/data/lectionary/*`)는 처음 쓸 때 캐시하므로 온라인에서 한 번도 열지 않은 캘린더가 오프라인에서 「교회력 자료를 불러오지 못했습니다」가 되는 것은 정상이다(PR #355 리뷰 — 원장의 「오프라인에서도 그 화면이 처음 열리도록」은 틀렸다).
