---
date: 2026-05-07
pr: 62
branch: claude/brainstorm-storage-optimization-nyIzM
title: "feat: 오디오 캐시 LRU 관리 (ADR-016)"
---

# feat: 오디오 캐시 LRU 관리 (ADR-016)

## 요약

`AUDIO_CACHE`(ADR-001)의 자체 정리 정책 부재 문제 해결. 300 MB hard cap + 마지막 재생 시점 기준 LRU.

> **번호 변경**: 같은 사이클에 main에 머지된 ADR-015(클라이언트 스토리지 전략)와 충돌해 ADR-016으로 옮김.

- **cap**: hard 360 MB / soft 300 MB (iOS Safari quota ~1 GB의 30% 수준)
- **LRU 기준**: `<audio>` `play` 이벤트의 `lastPlayedAt` (prefetch·preload 노이즈 회피)
- **메타 저장**: IndexedDB `bible-audio-cache` (Cache API는 access time 미제공)
- **정리 트리거**: SW는 hard cap만 검사(put 직후), 페이지는 visibilitychange→hidden에서 soft cap 정리
- **`navigator.storage.persist()`**: 첫 재생/북마크 추가 시점에 호출 (가치 인식 후)
- **fetch만 됐고 안 들은 파일**: `lastPlayedAt = null`로 가장 먼저 evict (prefetch 안전성)

## 파일

| 파일 | 변경 |
| --- | --- |
| `docs/decisions/016-audio-cache-lru.md` (신규) | ADR 본문 |
| `docs/decisions/001-spa-architecture.md` | 오디오 섹션에 ADR-016 cross-reference |
| `js/audio-cache.js` (신규) | IDB 메타 모듈 (recordEntry, touch, totalSize, pickEvictions, removeEntries). SW·페이지 공용 |
| `sw.js` | importScripts로 audio-cache 로드. AUDIO_CACHE put 후 hard cap 검사 → 초과 시 SOFT_CAP까지 정리 |
| `js/app.js` | `<audio>` play 시 `touch`, visibilitychange→hidden 시 soft cap 정리, 첫 재생/북마크 저장 시 `persist()` |
| `index.html` | drive-sync 다음에 audio-cache.js 스크립트태그 추가 |
| `js/types.d.ts` | `AudioCacheEntry`, `BibleAudioCache` + Window augmentation |
| `tests/unit/audio-cache.test.js` (신규) | 14 케이스 |

## 테스트

- `node --test tests/unit/*.test.js` — **98/98 통과** (기존 84 + 신규 14)
- `npx tsc -p tsconfig.json --noEmit` / `tsconfig.worker.json` — 0 error (기존 deprecation warning 외)

신규 케이스:
- recordEntry idempotency (addedAt/lastPlayedAt 보존)
- touch 갱신·미존재 url no-op
- totalSize 합산
- pickEvictions: 빈 결과(cap 미초과), null 우선, addedAt 타이브레이크, lastPlayedAt asc, 최소 셋만 반환
- removeEntries 부분 삭제·null 입력 안전
- 상수 잠금 (300/360 MB)
- end-to-end: 100장 × 4 MB → SW path 시뮬레이션, 재생된 장은 보존

## 아직 안 한 것

- 사용자 설정 페이지의 "오디오 캐시 X / 300 MB" 통계 UI (ADR-016 §D5에서 v2로 미룸)
- Drive 첫 로그인 시점의 `persist()` 호출 (state-machine 훅 필요해 별도 사이클로)
- 평균 4.89 MB라는 실측은 사용자 제공 정보. Cache API에 들어가는 실제 크기는 `Content-Length` 헤더에서 추출하므로 정확
