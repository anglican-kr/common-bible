---
date: 2026-05-06
pr: 52
branch: feat/pkce-step1-refresh-store
title: "feat: refresh-store 모듈 추가 (Phase 2i 단계 1)"
---

# feat: refresh-store 모듈 추가 (Phase 2i 단계 1)

## Summary

PKCE 마이그레이션(Phase 2i) 단계 1 — OAuth refresh token용 AES-GCM 암호화 IndexedDB 저장소 신설.

- `js/sync/refresh-store.js` 신규 모듈: `saveRefreshToken` / `loadRefreshToken` / `clearRefreshToken`
- AES-GCM 256-bit 키를 `extractable: false`로 생성해 IDB에 영속 저장 — 같은 origin JS는 encrypt/decrypt API로만 키를 사용 가능, raw 바이트는 추출 불가
- 토큰마다 새 12-byte IV 생성 (AES-GCM nonce 재사용 방지)
- 복호화 실패 시 손상된 레코드 자동 삭제 (재시도 루프 방지)
- IDB 열기 실패 시(Safari private mode 등) 조용히 null 반환 → 호출자가 NEEDS_CONSENT로 폴백

## 보안 모델

XSS 방어 1차는 이미 적용된 strict CSP (index.html line 5). IDB 암호화는 추가 방어층으로 **storage-level 도용**(악성 브라우저 확장, 디바이스 덤프)을 방어. XSS 자체에 대해선 동일 origin JS가 우리 decrypt 함수를 그대로 호출할 수 있으므로 동일하게 취약 — 이는 SPA의 본질적 한계.

## 단계 1의 안전성

이 PR은 어떤 흐름과도 결합되지 않은 신규 모듈만 추가:
- `js/types.d.ts`: `RefreshTokenStore` 인터페이스 + `Window.refreshStore` augmentation
- `index.html`: `<script defer>` 한 줄
- 어디에서도 `window.refreshStore`를 호출하지 않음 → **사용자 영향 0**

다음 PR(단계 2)에서 transport.js의 PKCE 유틸과 함께 사용 시작 예정.

## Test plan

- [x] `node --test tests/unit/refresh-store.test.js` — 13/13 통과
  - round-trip 정상
  - 토큰 미저장 → null
  - clear 후 → null
  - 두 번 save 시 두 번째 값 우선
  - **`extractable === false` 보장** (보안 모델 핵심)
  - **`subtle.exportKey`가 비추출 키 거부 확인**
  - 같은 평문이라도 IV/ciphertext가 매번 달라짐 (nonce 재사용 방지)
  - IV 길이 12바이트
  - ciphertext 손상 → null + 레코드 자동 삭제
  - 손상 후 재저장으로 자가 복구
  - 키 영속성 (다중 호출에 한 번만 생성)
  - 빈 문자열 / 2KB 토큰 경계
- [x] `node --test tests/unit/state-machine.test.js` — 20/20 회귀 없음
- [x] `tsc -p tsconfig.json --noEmit` — 0 error
- [x] CI workflow가 `tests/unit/` 디렉터리 전체를 실행하도록 갱신 (이후 단계 테스트 자동 포함)

## 다음 단계

[계획 파일](https://github.com/anglican-kr/common-bible/blob/main/docs/decisions/011-bookmark-sync.md)의 Phase 2i 단계 2: transport.js에 PKCE verifier/challenge 생성 + token 교환 endpoint 호출 함수 추가.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> <sup>[Cursor Bugbot](https://cursor.com/bugbot) is generating a summary for commit c55d69fe7c8b6bd13acda01763aa21c8e148e56b. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
