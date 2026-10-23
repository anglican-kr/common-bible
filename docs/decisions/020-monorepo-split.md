# ADR-020: 모노레포 4분할 (app / data / audio / server)

- 일시: 2026-05-11
- 상태: 승인됨 — 완료 (4분할과 서브모듈 마운트로 운영 중, 2026-05-11)
- 관련 ADR: ADR-001(SPA), ADR-004(데이터 파이프라인 테스트), ADR-011(Drive 동기화), ADR-016(오디오 캐시 LRU), ADR-017(BFF 프록시), ADR-018(app 모듈 분할. §"맥락"에서 이 분할을 뒤에 할 일로 예고했다), ADR-021(콘텐츠 해시 매니페스트)

## 결정

하나였던 `common-bible` 저장소를 다음 넷으로 나눈다. 모두 GitHub에 두고, data, audio, server는 비공개로 한다. data와 audio는 앱 저장소에 git 서브모듈로 붙인다.

| 저장소 | 공개 여부 | 역할 | 호스팅 |
|---|---|---|---|
| `anglican-kr/common-bible` (기존) | 공개 | PWA 프론트엔드, sw.js, manifest, JS 유닛/e2e, 릴리스 스크립트 | github |
| `anglican-kr/common-bible-data` | 비공개 | 마크다운 원본 + Python 파이프라인 + 빌드 출력 JSON + 데이터 검증 테스트 | github (기존 `common-bible-text`의 이름을 바꿈) |
| `anglican-kr/common-bible-audio` | 비공개 | 오디오 mp3 ~6.3 GB | github + LFS data pack |
| `anglican-kr/common-bible-server` | 비공개 | nginx 설정(BFF와 보안 헤더) + 배포 스크립트 | github |

세부 결정은 다음과 같다.

1. **data 저장소의 디렉터리 구조**: 마크다운 73개를 `git mv` 한 번으로 `source/` 아래로 옮긴다. 그 밖의 `src/`, `tests/`, `book_mappings.json`, `common-bible-kr.txt`, `bible/`, `search-*.json`, `books.json`은 루트에 둔다. Python의 `path` 상수에서는 `data/` 접두사를 **뺀다**. 작업 디렉터리가 data 저장소의 루트로 바뀌기 때문이다(`data/source/`는 `source/`로, `data/bible/`은 `bible/`로 바뀌는 식이다). 앱 쪽 URL(`/data/...`)은 그대로 둔다. 앱 저장소가 data 저장소를 `data/` 자리에 서브모듈로 붙여 docroot 경로가 그대로 남기 때문이다. 그래서 코드 변경은 Python의 path 상수뿐이고, 프론트엔드 URL과 sw.js 라우팅은 바뀌지 않는다.
2. **audio 호스팅**: GitHub LFS를 쓴다(data pack 요금은 `anglican-kr` 조직이 낸다). 외부 오브젝트 스토리지(S3/R2 등)는 비용이 같고 URL을 따로 관리해야 해서 채택하지 않는다.
3. **배포 스크립트의 위치**: `deploy.sh`와 `build-deploy.sh`는 server 저장소로 옮긴다. 다만 `release.py`는 **앱 저장소에 남긴다**. 앱의 버전과 캐시 이름의 수명을 다루기 때문이다. 지금 `release.py`는 `version.json`과 `sw-version.js`를 함께 올리고, 셸 캐시 이름은 `sw-version.js`의 앱 버전에서 나온다(ADR-021). 처음에는 `version.json`과 SHELL_CACHE를 올렸다.
4. **서브모듈 토폴로지**: 앱 저장소는 data를 `data/` 자리에 바로 서브모듈로 붙이고, audio는 data 저장소 안의 `audio/`에 **nested 서브모듈**로 둔다. 앱 쪽 URL `/data/audio/...`을 지키기 위해서다. 그래서 앱 저장소의 `.gitmodules`에는 data 한 줄, data 저장소의 `.gitmodules`에는 audio 한 줄이 있다. 저장소를 내려받을 때(clone) `git submodule update --init --recursive`나 `git clone --recurse-submodules`로 둘 다 붙인다. server 저장소는 nginx 설정을 검토할 때 쓰므로 앱에 붙이지 않고 따로 내려받는다. 실서버도 이 저장소를 스스로 받아 쓴다(checkout).
5. **Git 이력**:
   - data 저장소는 기존 `common-bible-text`의 마크다운 이력을 그대로 지킨다(이름 바꾸기와 `git mv` 커밋 하나).
   - audio와 server는 빈 첫 커밋에서 새로 시작한다.
   - 기존 `common-bible` 저장소는 보관 처리(archive)하지 않고 그대로 계속 쓴다(Phase B-C 동안 차츰 비운다).

## 맥락

ADR-018(2026-05-09)은 처음에 「본 의제는 미래 monorepo split의 기반이기도 하다(일정 미정)」고 적어 이 분할을 예고했다. ADR-018의 8단계로 `js/app.js`가 9개 도메인 모듈로 나뉘어, 저장소를 나눌 때 어느 코드가 어디에 속하는지 경계가 분명해졌다. 이것이 이번 결정의 직접 전제다.

나누는 이유는 세 가지가 겹친다.

1. **저작권과 접근권을 나눈다**: 공동번역성서 본문의 저작권은 대한성서공회에 있다. 그래서 마크다운 원본은 ADR-001을 채택할 때부터 비공개 서브모듈로 관리해 왔다. 앱 코드는 공개여야 외부 기여와 코드 리뷰를 받을 수 있는데, 한 저장소에 묶여 있으면 데이터 때문에 공개하기 어렵다.
2. **자산 크기를 나눈다**: `data/audio/`는 약 6.3 GB라 일반 git으로 추적하기에 맞지 않는다. 그때는 .gitignore로 빼고 서버의 `/var/www/audio` 심볼릭 링크로 우회하고 있었다. LFS 비공개 저장소로 나눠야 정상적인 git 흐름(서브모듈 포인터로 오디오 버전을 잠금)에 들어온다.
3. **운영 secret을 나눈다**: ADR-017 BFF는 nginx가 `client_secret`을 서버 쪽에서 넣는 구조라, 운영 설정 파일에 secret이 들어간다. 지금까지는 `.example.conf`로 우회해 왔지만, server 설정 자체를 비공개 저장소로 옮기는 것이 바른 해결이다.

Phase 2-4 로드맵(기도서, 교회력, 성무일과)이 더해지면 데이터와 인프라가 더 늘어난다. 그래서 지금 나누는 경계를 정해 두는 것이 앞으로의 비용을 가장 낮춘다.

## 검토한 대안

**대안 A: 모노레포를 유지하고 audio만 외부 스토리지로**
오디오만 S3/R2로 빼고 나머지는 한 저장소에 둔다. 혼자 유지보수하는 단순함은 지킬 수 있다. 하지만 (1) 저작권 분리 문제가 풀리지 않는다. 본문 마크다운은 비공개 서브모듈로 우회할 뿐이다. (2) 운영 secret이 드러날 위험도 남는다. (3) Phase 2-4 로드맵에서 도메인이 더 늘면 같은 결정을 더 늦게 내리게 된다. 채택하지 않음.

**대안 B: 데이터를 저장소 하나로 (text + audio 통합)**
마크다운과 오디오를 비공개 저장소 하나에 둔다. 데이터 도메인이 한데 모인다. 그러나 LFS 6.3 GB가 모든 데이터 PR과 내려받기(clone)에 묶여, 마크다운 한 줄을 고칠 때도 저장소를 새로 내려받는 데 몇 분이 걸린다. 마크다운 작업과 오디오 인코딩 작업은 빈도, 도구, 담당자가 다르다. 채택하지 않음.

**대안 C: server 저장소를 나누지 않는다**
nginx 설정을 앱 저장소 안에 그대로 두고 `.example.conf` 방식을 유지한다. server 저장소를 운영하는 부담은 줄지만, secret 관리 책임이 분명해지지 않는다. ADR-017이 채택한 BFF 방식의 보안 가치는 secret이 코드 저장소와 떨어져 있을 때 가장 크다. 채택하지 않음.

**대안 D: git filter-repo로 이력을 나눈다**
새 저장소마다 관련 경로의 기존 이력을 지킨다. blame과 과거 커밋을 따라갈 수 있지만, LFS 마이그레이션과 겹치면 작업이 매우 복잡해진다. 혼자 유지보수하는 환경에서는 드는 품에 비해 얻는 것이 적다. 기존 `common-bible` 저장소를 그대로 두고 새 저장소는 빈 상태로 시작해도 충분하다(data만 예외다. 기존 common-bible-text의 이름을 바꾸므로 마크다운 이력은 저절로 남는다). 채택하지 않음.

**수동 두 단계 배포 흐름 (2026-05-13까지)**
처음에는 데이터를 바꾸면 사람이 두 번 손을 대야 했다. 마크다운을 고쳐 data 저장소에 올리면(push) CI가 빌드하고 검증했고, 사람이 앱 저장소의 서브모듈 포인터를 올리고, server 저장소의 `deploy.sh dev`로 배포했다. 오디오를 바꿀 때도 인코딩(ADR-016), audio 저장소 push, 앱 서브모듈 포인터 올리기와 `scripts/release.py --bump-audio`, 배포를 거쳤다. 빈도가 낮은 작업이라 자동화는 뒤로 미뤘다.
채택하지 않음 2026-05-13 · 이유: ADR-021이 이 흐름을 자동으로 바꿨다(아래 「배포와 운영」). 캐시 식별자에 rev를 붙이는 개념이 사라지고 콘텐츠 해시 매니페스트가 그 자리를 맡으면서 `--bump-audio` 플래그도 없어졌다.

## 영향

### 코드
- 앱: `src/`(Python 파이프라인), `tests/test_*.py`, Python 데이터 픽스처를 지운다. `scripts/build-deploy.sh`와 `scripts/deploy.sh`도 지운다(server로 옮김). `scripts/generate_splash.py`는 의존성이 적어 앱에 남긴다(`scripts/`로 옮김).
- data: 기존 `common-bible-text`의 이름을 바꾸고 마크다운을 `source/` 아래로 옮긴다. Python 파이프라인, 테스트, 픽스처, `book_mappings.json`, `common-bible-kr.txt`, `src/convert_txt_to_md.py`를 옮겨 온다. CI는 push 때 파이프라인을 돌리고, Level 1-3 검증을 하고, 출력 artifact를 올린다.
- audio: 빈 저장소에 `.gitattributes`(`*.mp3 filter=lfs ...`)를 두고 6.3 GB를 올린다(push).
- server: `nginx/`, `scripts/deploy.sh`, `scripts/build-deploy.sh`를 옮겨 온다. `deploy.sh`는 앱 저장소 경로를 인자로 받도록 일반화한다.

### 문서
- ADR-001: 「저장소 토폴로지」 절을 더했다. 처음에는 개정 블록이었고, 지금은 본문 절이다.
- ADR-004: Python 테스트가 data 저장소에 있다고 적었다. 처음에는 개정 블록이었고, 지금은 본문에 있다.
- ADR-011과 ADR-017: server 저장소 분리를 반영했다(처음에는 개정 블록). ADR-017은 본문에 반영했다.
- ADR-002, 003, 006: data 저장소로 옮겼다(앱의 ADR 인덱스에는 옮긴 곳을 알리는 짧은 문서만 남긴다).
- `docs/architecture.md`: 빌드와 배포 그림, §4 구조 지도, §11 로드맵을 다시 쓴다.
- `CLAUDE.md`, `GEMINI.md`, `README.md`: 4분할 토폴로지를 반영한다. `GEMINI.md`는 2026-10-22에 지웠다(#368).
- `docs/archive/audit/2026-05-07-pkce-refresh-token.md`와 `2026-05-08-second-comprehensive.md`: nginx 설정 위치의 참조를 고친다.

### 배포와 운영

ADR-021(2026-05-13)로 아래 흐름이 자동으로 돈다.

- **데이터 변경**: `common-bible-data/.github/workflows/build.yml`이 main의 `source/**` 변경을 보고 파이프라인을 돌리고 매니페스트를 만들어 자동으로 커밋해 올린다. 사람은 .md만 고쳐 PR을 열면 된다.
- **오디오 변경**: audio 저장소에 올리고 data 저장소의 audio 서브모듈 포인터를 올리면, data CI가 `audio-manifest.json`을 자동으로 고친다.
- **앱 서브모듈 포인터 올리기**: data 저장소의 `build.yml`이 산출물을 올린 뒤 `gh api`로 앱 저장소의 `sync-data.yml`을 부른다(workflow_dispatch). ADR-021은 repository_dispatch 대신 이 방식을 골랐다. `sync-data.yml`은 포인터와 `sitemap.xml`을 올리는 PR을 만들고, 유닛 테스트가 통과하면 자동으로 머지한다.
- **release.py**: `--bump-data`와 `--bump-audio`를 없애고, `version.json`과 `sw-version.js`를 함께 올리는 일로 좁혔다. 커밋도 스스로 한다.
- **nginx와 secret 변경**: server 저장소에만 올리고, 서버가 스스로 받아 둔다(checkout).

## 후속

마이그레이션 실행 계획(Phase A-D)은 `/home/joshua/.claude/plans/giggly-wibbling-lampson.md`에 단계별로 정리해 두었다(로컬 파일이고 지금은 없다). 처음에는 분할을 마치면 이 ADR에 「개정」 블록으로 결과를 요약하기로 했다. 분할은 2026-05-11에 마쳤고, 결과는 위 「결정」과 상태 줄에 있다.
