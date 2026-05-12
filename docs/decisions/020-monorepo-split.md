# ADR-020: 모노레포 4분할 (app / data / audio / server)

- 일시: 2026-05-11
- 상태: 승인됨 — 진행 중 (Phase A 착수)
- 관련 ADR: ADR-001(SPA), ADR-004(데이터 파이프라인 테스트), ADR-011(Drive 동기화), ADR-016(오디오 캐시 LRU), ADR-017(BFF 프록시), ADR-018(app 모듈 분할 — §"맥락"에서 본 분할을 후속 의제로 예고)

## 결정

기존 `common-bible` 단일 저장소를 다음 네 개로 분할한다. 모두 GitHub 호스팅, 데이터/오디오/서버는 비공개. 데이터·오디오는 앱 저장소에 git 서브모듈로 마운트한다.

| 저장소 | 가시성 | 역할 | 호스팅 |
|---|---|---|---|
| `anglican-kr/common-bible` (기존) | 공개 | PWA 프론트엔드, sw.js, manifest, JS 유닛/e2e, 릴리스 스크립트 | github |
| `anglican-kr/common-bible-data` | 비공개 | 마크다운 원본 + Python 파이프라인 + 빌드 출력 JSON + 데이터 검증 테스트 | github (기존 `common-bible-text` 이름 변경) |
| `anglican-kr/common-bible-audio` | 비공개 | 오디오 mp3 ~6.3 GB | github + LFS data pack |
| `anglican-kr/common-bible-server` | 비공개 | nginx 설정(BFF·보안 헤더) + 배포 스크립트 | github |

세부 결정:

1. **data 저장소 디렉토리 구조**: 마크다운 73개를 `source/` 하위로 `git mv` 한 번. 그 외 `src/`·`tests/`·`book_mappings.json`·`common-bible-kr.txt`·`bible/`·`search-*.json`·`books.json`은 루트에 배치. Python `path` 상수는 `data/` prefix를 **제거**한다 (작업 디렉토리가 data 저장소 루트로 바뀌므로 `data/source/` → `source/`, `data/bible/` → `bible/` 등). 앱 측 URL(`/data/...`)은 그대로 유지하며, 앱 저장소가 본 저장소를 `data/` 위치에 서브모듈로 마운트해 docroot 경로를 보존한다 — 즉, 코드 변경은 Python path 상수에 한정되고 프론트엔드 URL·sw.js 라우팅은 무변경.
2. **audio 호스팅**: GitHub LFS (data pack은 `anglican-kr` 조직 청구). 외부 오브젝트 스토리지(S3/R2 등)는 같은 비용·중복 URL 관리 필요로 채택하지 않음.
3. **배포 스크립트 위치**: `deploy.sh`·`build-deploy.sh`는 server 저장소로 이전. 단 `release.py`(version.json·SHELL_CACHE bump)는 **앱 저장소에 남김** — 앱 자체의 버전·캐시 ID 생애주기 관리이므로.
4. **서브모듈 토폴로지**: 앱 저장소는 data를 `data/` 위치에 직접 서브모듈로 마운트하고, audio는 data 저장소 안의 `audio/`에 **nested 서브모듈**로 둔다 — 앱 측 URL `/data/audio/...`을 보존하기 위함. 즉 앱 저장소의 `.gitmodules`는 data 한 줄, data 저장소의 `.gitmodules`는 audio 한 줄. clone 시 `git submodule update --init --recursive` 또는 `git clone --recurse-submodules`로 둘 다 마운트. server 저장소는 nginx 설정 검토용으로 앱에 마운트하지 않고 별도 clone (실서버는 자체 checkout).
5. **Git history**:
   - data 저장소는 기존 `common-bible-text`의 마크다운 history를 그대로 보존 (이름 변경 + 단일 `git mv` 커밋)
   - audio·server는 빈 초기 커밋부터 새로 시작
   - 기존 `common-bible` 모노레포는 archive하지 않고 그대로 계속 사용 (Phase B-C 동안 점진 비움)

## 맥락

ADR-018(2026-05-09 §"맥락")에서 이미 「본 의제는 미래 monorepo split의 기반이기도 하다(일정 미정)」고 예고했다. ADR-018 8단계로 `js/app.js`가 9개 도메인 모듈로 분할되어 분할 시 ownership 경계가 분명해진 게 이번 결정의 직접 전제다.

분할 동기는 세 가지가 겹친다:

1. **저작권·접근권 분리**: 공동번역성서 본문 저작권은 대한성서공회 소유로, 마크다운 원본은 ADR-001 채택 시점부터 비공개 서브모듈로 관리해 왔다. 앱 코드 자체는 공개여야 외부 기여·코드 리뷰가 가능한데, 한 저장소에 묶여 있으면 공개 가능성이 데이터에 발목 잡힌다.
2. **자산 크기 분리**: `data/audio/`가 ~6.3 GB로 일반 git 트래킹은 부적합 (현재 .gitignore 처리 + 서버 `/var/www/audio` 심링크로 우회 중). LFS 비공개 저장소로 분리해야 정상 git 워크플로우(서브모듈 포인터 = 오디오 버전 잠금)에 합류한다.
3. **운영 secret 분리**: ADR-017 BFF는 nginx에서 `client_secret`을 server-side 주입하는 구조라 운영 설정 파일에 secret이 들어간다. `.example.conf`로 우회해 왔지만 server 설정 자체를 비공개 저장소로 옮기는 게 정공법이다.

Phase 2~4 로드맵(기도서·교회력·성무일과)이 추가되면 데이터·인프라가 더 늘어나므로, 분리 경계를 지금 정립해 두는 게 향후 비용이 가장 낮다.

## 검토한 대안

**대안 A: 모노레포 유지 + audio만 외부 스토리지**
오디오만 S3/R2로 빼고 나머지는 한 저장소. 1인 유지보수 단순성 유지. 하지만 (1) 저작권 분리 문제 미해결 — 본문 마크다운이 비공개 서브모듈로 우회만 됨, (2) 운영 secret 노출 위험 미해결, (3) Phase 2~4 로드맵에서 도메인이 더 늘면 같은 결정을 늦게 내리게 됨. 채택하지 않음.

**대안 B: 데이터 단일 저장소 (text + audio 통합)**
마크다운과 오디오를 한 비공개 저장소에. 데이터 도메인 응집. 단 LFS 6.3 GB가 모든 데이터 PR·clone에 묶여 마크다운 한 줄 수정에도 fresh clone이 분 단위로 걸림. 마크다운 작업과 오디오 인코딩 작업은 빈도·도구·관리자가 다르다. 채택하지 않음.

**대안 C: server 저장소 미분리**
nginx 설정을 앱 저장소 안에 그대로 두고 `.example.conf` 패턴을 유지. server 저장소 운영 부담은 줄지만 secret 관리 책임이 분명해지지 않는다. ADR-017이 채택한 BFF 패턴의 보안 가치는 secret이 코드 저장소와 분리될 때 가장 크다. 채택하지 않음.

**대안 D: git filter-repo로 history 분리**
각 새 저장소가 관련 경로의 기존 history를 보존. blame·과거 커밋 추적 보존되지만, LFS 마이그레이션이 결합되면 작업이 매우 복잡해진다. 1인 유지보수 환경에서 ROI 낮음. 기존 `common-bible` 저장소를 그대로 두고 새 저장소는 빈 시작으로 충분 (data만 예외 — 기존 common-bible-text 이름 변경으로 마크다운 history는 자연스럽게 보존). 채택하지 않음.

## 영향

### 코드
- 앱: `src/`(Python 파이프라인)·`tests/test_*.py`·Python 데이터 픽스처 삭제. `scripts/build-deploy.sh`·`scripts/deploy.sh` 삭제 (server로 이전). `scripts/generate_splash.py`는 의존성 적어 앱에 보존(`scripts/`로 이동).
- data: 기존 `common-bible-text` rename + 마크다운 `source/` 하위 이동 + Python 파이프라인·테스트·픽스처·`book_mappings.json`·`common-bible-kr.txt`·`src/convert_txt_to_md.py` 이전. CI는 push 시 파이프라인 실행 → Level 1-3 검증 → 출력 artifact 게시.
- audio: 빈 저장소에 `.gitattributes`(`*.mp3 filter=lfs ...`) + 6.3 GB push.
- server: `nginx/`·`scripts/deploy.sh`·`scripts/build-deploy.sh` 이전. `deploy.sh`는 앱 저장소 경로를 인자로 받도록 일반화.

### 문서
- ADR-001: 「저장소 토폴로지」 절 추가 (개정 블록)
- ADR-004: Python 테스트가 data 저장소에 사는 것으로 명시 (개정 블록)
- ADR-011·017: server 저장소 분리 반영 (개정 블록)
- ADR-002·003·006: data 저장소로 이전 (앱 ADR 인덱스에 stub만 남김)
- `docs/architecture.md`: 빌드/배포 도식 + §4 구조 지도 + §11 로드맵 재작성
- `CLAUDE.md`·`GEMINI.md`·`README.md`: 4분할 토폴로지 반영
- `docs/audit/2026-05-07-pkce-refresh-token.md`·`2026-05-08-second-comprehensive.md`: nginx 설정 위치 참조 갱신

### 배포·운영
- 일상 배포 흐름: 마크다운 수정 → data 저장소 push → CI 빌드·검증 → 앱 저장소 서브모듈 포인터 bump → server 저장소 `deploy.sh dev`. 한 사이클은 사람 손이 두 번 들어간다(데이터 push·앱 서브모듈 bump). 빈도 낮은 작업이므로 자동화는 후순위.
- 오디오 변경: 인코딩(ADR-016) → audio 저장소 push → 앱 서브모듈 포인터 bump + `scripts/release.py --bump-audio` → 배포. 마찬가지 수동 두 단계.
- nginx·secret 변경: server 저장소만 push → 서버에서 자체 checkout.

> **개정 (2026-05-13, ADR-021):** 위 "수동 두 단계" 흐름이 자동화된다.
>
> - **데이터 변경**: `common-bible-data/.github/workflows/build.yml`이 main 의 `source/**` 변경을 감지해 파이프라인 + 매니페스트 생성 + `[skip ci]` 자동 commit·push. 사람은 .md만 편집해 PR을 열면 됨.
> - **오디오 변경**: audio 저장소 push → data 저장소 audio 서브모듈 포인터 bump → data CI 가 `audio-manifest.json` 자동 갱신. `--bump-audio` 플래그는 제거됨 — 캐시 식별자 rev 개념 자체가 사라지고 콘텐츠 해시 매니페스트로 대체.
> - **앱 서브모듈 포인터 bump**: Phase 3 webhook (`gh api` repository_dispatch) 도입 후 data 저장소 push 시 앱 저장소 CI 가 자동 처리.
> - **release.py**: `--bump-data`·`--bump-audio` 제거, `version.json` + `sw-version.js` 한 묶음으로 좁힘. 자동 commit 포함.

## 후속

마이그레이션 실행 계획(Phase A-D)은 `/home/joshua/.claude/plans/giggly-wibbling-lampson.md`에 단계별로 정리되어 있다. 분할 완료 시점에 본 ADR에 「개정」 블록으로 결과 요약을 추가한다.
