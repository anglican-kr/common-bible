---
date: 2026-05-08
pr: 67
branch: fix/audio-cache-hardening
title: "fix: 오디오 캐시 hardening + 2차 보안 감사 보고서 (1.4.6 안정화)"
---

# fix: 오디오 캐시 hardening + 2차 보안 감사 보고서 (1.4.6 안정화)

## Summary

2차 통합 보안 감사 ([docs/audit/2026-05-08-second-comprehensive.md](docs/audit/2026-05-08-second-comprehensive.md))에서 발견한 High 4건 수정 + 보고서 commit. Critical 0, Medium 9, Low/Info 15는 백로그.

**이번 PR이 다루는 4건:**

| # | 이슈 | 위치 | 수정 |
|---|------|-----|-----|
| H1 | Content-Length 누락 시 byteSize=0 → quota 폭발 | [sw.js:139](sw.js#L139) | clone().blob().size 폴백 |
| H2 | 동시 fetch eviction race로 방금 put된 mp3 삭제 | [sw.js:133](sw.js#L133) | `_inflightAudioUrls` Set 가드 |
| H3 | IDB ↔ Cache API 양방향 drift | sw.js activate | `_reconcileAudioCache` 추가 |
| H4 | 작업 트리에 평문 client_secret JSON | 로컬 디스크 | 삭제 (git history clean) |

**Bugbot 추가 발견 (수정 완료):** `clients.claim()`이 `event.waitUntil` 밖 동기 실행 → activate 직후 claim된 클라이언트의 fetch가 reconcile 진행 중 도착 → step (b)의 orphan 삭제가 reconcile 시작 시점 snapshot 기반이라 그동안 동시 record된 IDB row가 잘못 삭제. claim을 waitUntil 안 reconcile 뒤로 이동해 race window 닫음.

**감사 영역**: Python 파이프라인 / 오디오 처리 / 검색 이력·visibility sync·BFF·헤더 / 의존성·빌드·노출면. 4개 영역 병렬 sweep. OAuth/PKCE/refresh token 영역은 회귀 없음 확인.

## 배포 영향

코드 변경은 sw.js 내부 동작(LRU 정확성·race 가드·reconcile)뿐, **사용자 가시 변화 없음**. SW 자체 갱신은 브라우저가 sw.js 콘텐츠 변경 감지해 자동 처리 → 다음 visit 시 새 SW activate + reconcile 1회 실행.

버전 bump 안 함 — 이번 변경은 사용자 가시 기능이나 콘텐츠 변경 없음. 다음 사이클에서 다른 백로그(Permissions-Policy 추가 directive·release.py 자동 commit 등)와 묶어 1.4.7로 가는 게 효율적이라 판단.

## 백로그 (Medium·Low/Info, 다음 사이클 후보)

- M1: requirements.txt 의존성 핀
- M2: split_bible.py:67 빈 텍스트 IndexError
- M3: 오디오 캐시 무결성 검증 부재
- M4: bible-audio-pos NaN/Infinity 검증
- M5: /oauth/token rate limiting 부재
- M6: BFF body parameter pollution 가드
- M7: deploy zip 누적 정리
- M8: release.py 자동 commit·tag
- L11: Permissions-Policy 추가 directive (clipboard-read, fullscreen 등)
- 기타 — 보고서 참조

## Test plan
- [x] `node --test tests/unit/*.test.js` — 98/98 통과 (audio-cache 14 + refresh-store 13 + search-history 19 + state-machine 29 + transport-pkce 23)
- [ ] dev 배포 후 오디오 재생·캐싱·LRU 동작 시운전 (대용량 mp3 여러 개 다운로드 → cap 도달 → eviction)
- [ ] dev 배포 후 SW activate 시 reconcile이 0 errors로 통과하는지 콘솔 확인
- [ ] (선택) DevTools에서 `caches.delete('audio-1')` 또는 IDB clear → 페이지 새로고침 → SW activate → reconcile이 양쪽 정합성 회복하는지
