---
date: 2026-05-12
pr: 121
branch: feat/monorepo-split
title: "chore: 모노레포 4분할 마이그레이션 (ADR-020)"
---

# chore: 모노레포 4분할 마이그레이션 (ADR-020)

## Summary

- 단일 `common-bible` 저장소를 4개로 분리: 앱(본 저장소, 공개) + data·audio·server(모두 비공개)
- 앱이 `data/`에 `common-bible-data`를 직접 서브모듈로 마운트, 그 안 `audio/`에 `common-bible-audio`를 **nested 서브모듈**로 마운트 — 앱 URL `/data/...`가 그대로 보존되어 sw.js·index.html·audio-cache.js 무변경
- 모노레포에서 `src/`(파이프라인), `tests/test_*.py`(데이터 검증), `scripts/{deploy,build-deploy}.sh`(배포), 트래킹된 데이터 산출물 제거 — 각각 data·server 저장소로 이전
- 문서 갱신: CLAUDE/GEMINI/README/architecture.md §1-3 + ADR-001·004·011·017 개정 블록 + ADR-020 신규 + worklog 기록

## 관련 후속 작업 (다른 저장소)

`common-bible-server`에서 분할 + 배포 스크립트 일반화 완료 (`1e28b0d`):

- **APP_ROOT 일반화**: 환경변수 또는 `common-bible-server` sibling으로 클론된 `common-bible` 자동 감지 (`$SCRIPT_DIR/../../common-bible`)
- **manifest 기반 빌드**: `scripts/deploy-manifest.txt` 한 곳 수정으로 zip 포함 경로 관리. 누락 항목 있으면 빌드 abort (실수로 트래킹 파일 삭제·새 데이터 추가 누락 방지)
- **rollback 서브커맨드**: `deploy.sh rollback dev|prod` — 직전 빌드로 swap, 변위된 현재 빌드는 `-previous`로 이동해 rollback 자체가 reversible
- **자동 검증 4종** (매 swap·promote·rollback 직후): `/version.json` 버전 일치, `/sw.js` 200+Content-Type, `/index.html` 200+ETag, `/data/books.json` 200. 실패 시 manual rollback 안내 출력 (자동 rollback 안 함)
- **세대 정리**: 4개 보호 심볼릭(dev·bible·dev-previous·bible-previous) + `BUILD_RETENTION`(기본 3)개 유지. dev는 자동, prod·promote·rollback은 삭제 직전 confirm
- **dirty 추적**: working tree 더러우면 shortsha에 `-dirty` suffix → 디렉토리 목록에서 audit 가능

## Test plan

### 자동 검증 완료
- [x] JS 유닛 485 케이스 통과 (`node --test tests/unit/*.test.js`)
- [x] audio nested 서브모듈 정상 마운트 (mp3 1314개 LFS pull)
- [x] data 서브모듈 정상 마운트 (bible JSON 1329개 + search-*.json + books.json)

### 로컬 골든패스 (`scripts/serve.py 8080`)
- [x] 책 목록·장 내비게이션·본문·검색·북마크 로컬·오디오 재생·SW 캐시 — 분할이 코드 동작에 영향 없음 확인
- Drive sync OAuth는 `redirect_uri` + `/oauth/token` BFF가 production-only라 localhost 검증 불가 → dev 단계로

### dev 배포 통합 검증 (`common-bible-server/scripts/deploy.sh dev`)
- [x] `deploy.sh dev` 실행 → 자동 검증 4종 통과 → dev.anglican.kr 정상 swap
- [x] Drive sync 골든패스 (첫 연결·재실행·signOut)

### prod 승격 (`deploy.sh promote`)
- [ ] `/var/www/bible` ← `$(readlink /var/www/dev)` swap + 자동 검증 4종 통과
- [ ] bible.anglican.kr에서 동일 골든패스 재확인

## 향후 의제 (별도 PR)

- ADR-002·003·006 data 저장소로 이전 검토
- `docs/architecture.md` §4 이후 path 표기 정리
