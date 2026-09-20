---
date: 2026-05-11
pr: 110
branch: test/install-unit
title: "test: install.js INSTALL_STATE + NUDGE 유닛 테스트"
---

# test: install.js INSTALL_STATE + NUDGE 유닛 테스트

## Summary

- app 레이어 유닛 테스트 확장 네 번째 단계
- `tests/unit/install.test.js` 신설: 366 → 406 (+40)
- `js/app/install.js`에 BEGIN/END 마커 신설:
  - **INSTALL_STATE** (28 케이스): \`install\` IIFE + 이벤트 리스너
  - **NUDGE** (12 케이스): \`maybeShowInstallNudge\` 자동 노출 로직

## INSTALL_STATE 검증

- \`isStandalone\` 3가지 신호 (standalone display-mode / fullscreen / navigator.standalone)
- \`detectPlatform\`: iPhone Safari / iPad iPadOS desktop UA + maxTouchPoints / iOS 5종 비-Safari (CriOS·FxiOS·EdgiOS·OPiOS·GSA) / 안드로이드 / 데스크톱 Chromium / Edg(새) vs Edge/(레거시) 구분 / Firefox·Safari 데스크톱 unsupported
- \`subscribe\` 즉시 fire + cleanup
- \`triggerPrompt\` single-shot + 사용 후 \`canPrompt: false\` 통지
- \`beforeinstallprompt\` / \`appinstalled\` / display-mode change → notify 분기

## NUDGE 검증

- ios-safari / android 트리거, 그 외 플랫폼 no-op
- 비-nudgeable 플랫폼은 visits 카운터도 증가 안 함
- \`neverShow=true\` 가드 (visits 미증가)
- \`setTimeout\` 1500ms 지연 후 \`openInstallModal\`
- 1500ms 사이 \`installed\` 전환 시 모달 미표시
- \`nextShow = visits + 3\` LIVE 재계산 (저장 상태 다시 로드, 빠른 새로고침 중복 표시 방지)

## 테스트 패턴

- \`window.matchMedia\` + \`navigator.userAgent\`/\`platform\`/\`maxTouchPoints\` 스텁
- \`setTimeout\` 큐 가로채서 결정적 발화
- \`const install = (...)\` IIFE 노출용 \`globalThis.install = install\` 한 줄 추가
- 모달 열기/닫기 + 슬라이더 + \`buildInstallBody\` platform별 렌더는 DOM-anchor 헤비 / UI 취약 영역으로 의도적 제외 (ADR-013 dual-track 기조)

## Test plan

- [x] \`node --test tests/unit/install.test.js\` — 40 통과 / 87ms
- [x] \`node --test tests/unit/*.test.js\` — 406 통과 (회귀 0)
- [x] CI green
