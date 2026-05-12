# 유닛 테스트 보고서: 본문·오디오 콘텐츠 매니페스트 동기화

**날짜:** 2026-05-13
**범위:** ADR-021 — PWA 캐시 버전 식별자를 콘텐츠 해시 매니페스트로 전환. 본문(1329개 장)과 오디오(1314개 mp3) 캐시 무효화를 "전체 통째로 다시 받기"에서 "바뀐 항목만 다시 받기"로 바꾸는 작업의 자동 검증.

## 한 줄 요약

지금까지는 본문 한 절을 수정하거나 mp3 한 곡을 새로 인코딩하면 사용자가 받은 6 GB 가까운 오디오·본문 캐시 전체가 무효화되어 다시 다운로드해야 했다. 이번 변경으로 — 데이터 저장소에 "지금 어떤 파일이 어떤 내용인지" 적힌 매니페스트를 두고, 앱이 부팅 때마다 비교해 **바뀐 파일만** 골라 다시 받게 했다. 모든 판단 로직을 자동 점검 14건으로 보호.

## 이 변경으로 무엇이 더 안전해졌는가

자동 검증 케이스 수가 **491건 → 505건**으로 늘었다 (+14).

이번에 자동으로 점검하게 된 판단 규칙:

### 1. 매니페스트 비교 (어느 파일이 바뀌었나)

- **이전 매니페스트가 없을 때**: 처음 부팅이거나 매니페스트 도입 직전 캐시 — 아무 것도 무효화하지 않음. 안전한 시작점.
- **해시가 그대로일 때**: 무효화 안 함.
- **해시가 바뀌었을 때**: 그 항목 하나만 무효화 대상.
- **매니페스트에서 사라진 항목**: 파일이 삭제됐다는 뜻 → 무효화.
- **매니페스트에 새로 추가된 항목**: 이전 기록이 없어 비교 불가 → 무효화 안 함 (다음 부팅부터 새 baseline 로 비교).

### 2. 캐시 키 ↔ 매니페스트 경로 매핑

- `https://app/data/bible/gen-1.json` → `bible/gen-1.json` 으로 정상 변환
- `https://app/data/audio/1chr-1.mp3` → `audio/1chr-1.mp3` 동일
- `data/`로 시작하지 않는 경로 (예: 앱 JS 파일) → null 반환 (캐시 무효화 대상 아님)
- 잘못된 URL → null 반환 (예외 안 던짐)

### 3. 동기화 전체 흐름 (네트워크·캐시·IDB 같이 점검)

- **첫 부팅** (이전 스냅샷 없음): 매니페스트만 받아 저장. 캐시는 그대로 유지.
- **두 번째 부팅, 한 파일 해시가 바뀜**: 그 한 파일만 캐시에서 삭제. 나머지는 유지.
- **네트워크 실패** (오프라인): 매니페스트 못 받음 → 캐시 손대지 않음. 사용자는 기존 캐시로 계속 사용.
- **매니페스트가 깨진 JSON일 때**: 무효한 값으로 잘못된 무효화 일으키지 않음. 캐시 유지.
- **매니페스트에서 항목이 삭제됐을 때**: 두 번째 부팅에 그 항목 캐시에서 자동 제거.

## 발견된 이슈

없음. 위 14건 모두 의도한 대로 동작함을 확인.

추가로 영향 받는 기존 테스트도 정상 통과:
- `audio-cache.test.js`: AUDIO_CACHE 이름이 `"audio-1"` → `"audio"`로 고정된 변경을 반영해 1건 갱신, LRU·hard cap·soft cap·removeEntries 등 나머지 30여 건은 그대로 통과.
- 전체 회귀 505건 모두 통과.

## 다음 의제

- **첫 번째 실배포 검증 (Phase 4)**: dev 서버 배포 후 DevTools 의 Application 탭에서 다음을 직접 확인 — Cache Storage 이름이 `shell-X.Y.Z` / `data` / `audio` / `fonts` 4종으로 정리되었는지, 한 본문 파일을 강제로 변경했을 때 manifest-sync 가 다음 부팅에 그 항목만 무효화하는지, 매니페스트 fetch 가 네트워크 우선으로 동작하는지.
- **데이터 저장소 CI 자동 빌드 검증 (Phase 1-5)**: 작은 .md 수정 PR 을 머지해 `build.yml` 이 실제로 파이프라인 + 매니페스트 자동 갱신 + `[skip ci]` 커밋백 + 무한 루프 차단까지 동작하는지 종단간 확인.
- **webhook 종단간 검증 (Phase 3)**: data 저장소가 푸시한 후 앱 저장소의 `sync-data.yml` 이 자동으로 서브모듈 포인터를 bump 하고 release.py 가 자동 commit + push 하는지 확인.
- **운영 가시화**: 매니페스트 동기화 동작을 사용자 측 디버그 패널에 노출할지 검토 — 캐시가 일부만 갱신되는 새 동작이 사용자에게 보이지 않으면 의문이 생길 수 있음.

---

## 부록: 개발자용 세부

| 항목 | 값 |
|------|----|
| 신규 테스트 파일 | `tests/unit/manifest-sync.test.js` (14건) |
| 갱신 테스트 파일 | `tests/unit/audio-cache.test.js` (1건, AUDIO_CACHE_NAME 상수 검증 갱신) |
| 신규 Python 테스트 | `scripts/test_release.py` (10건, semver bump + sw-version.js 텍스트 치환) |
| 신규 소스 파일 | `js/manifest-sync.js` (123줄), `sw-version.js` (5줄), `data/scripts/gen_manifests.py` (130줄), `data/bible-manifest.json` (1332 entries), `data/audio-manifest.json` (1314 entries) |
| 신규 CI | `data/.github/workflows/build.yml`, `app/.github/workflows/sync-data.yml` |
| 갱신 소스 파일 | `sw.js` (cache 식별자 파생, 매니페스트 라우팅), `js/audio-cache.js` (AUDIO_CACHE_NAME 고정), `js/app.js` (부팅 시퀀스), `js/types.d.ts` (ManifestSync 인터페이스), `scripts/release.py` (재작성), `index.html` (manifest-sync.js script 등록) |
| 정적 검증 | `npx tsc -p tsconfig.json --noEmit` 및 `tsconfig.worker.json` 모두 0 error |
| 전체 회귀 | `node --test tests/unit/*.test.js` 505/505 통과 (이전 491 + 신규 14) |
| 관련 ADR | ADR-021 (본 변경), ADR-016 (LRU sidecar 연동), ADR-020 (모노레포 분할 §73-74 개정) |
| M8 (감사) | `release.py`에 git 자동 commit 추가로 해소 |
