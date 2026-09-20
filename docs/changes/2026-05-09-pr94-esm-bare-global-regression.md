---
date: 2026-05-09
pr: 94
branch: fix/esm-bare-global-regression
title: "fix: ESM 전환 후 끊긴 cross-module bare global 호출 복구"
---

# fix: ESM 전환 후 끊긴 cross-module bare global 호출 복구

## Summary
- PR #92(ADR-019 ESM 일괄 전환) 머지 후 settings-ui.js의 \`announce\` · \`parsePath\` · \`route\` · \`openDriveDisconnectModal\` · \`clearAllCaches\` bare 호출이 ESM module scope 때문에 \`ReferenceError\`로 실패하는 잠재 회귀 수정
- classic script 시절엔 \`function X()\`가 자동으로 globalThis에 등록됐으나, \`<script type=\"module\">\` 환경에선 module-scoped라 다른 모듈에서 bare 호출 시 globalThis 조회로 떨어져 실패
- app.js 상단의 기존 \`window.applyXxx\` 노출 블록 옆에 5건 추가 (\`window.announce = announce\` 등). 함수 선언은 호이스팅되므로 정의 위치보다 먼저 배치 가능
- SHELL_CACHE shell-56 → shell-57로 SW 셸 캐시 무효화 — 기존 사용자도 다음 SW 업데이트 시 수정 본 적용

## 영향 범위
사용자 트리거 인터랙션 (설정 팝오버 내):
- 글자 크기 / 테마 / 색상 / 시작 화면 변경 시 \`announce\` 7곳
- 시작 화면 설정 변경 시 \`parsePath\` + \`route\`
- Drive 연결 해제 버튼 \`openDriveDisconnectModal\`
- 캐시 초기화 버튼 \`clearAllCaches\`

types.d.ts에 5건 모두 \`declare global\`로 이미 선언돼 있어 TS는 통과했지만 런타임은 깨진 상태.

## Test plan
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.app.json --noEmit\` 신규 0 error (잔여 5건은 기존 gtag/dataLayer ESM 외부)
- [x] \`node --test tests/unit/*.test.js\` 111/111
- [ ] 브라우저 회귀: SW 캐시 무효화 후 설정 팝오버 → 글자 크기/테마/색상/시작 화면 변경 → 콘솔 0 오류 + 안내 음성 + 시작 화면 설정 라우팅 즉시 반영
- [ ] Drive 연결 해제 버튼 클릭 → 모달 열림
- [ ] 캐시 초기화 버튼 클릭 → 정상 진행
- [ ] 후속: Phase 5+ 모듈에서도 동일 패턴 (\`window.X = X\`) 적용

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk: only re-exports existing functions onto `window` to restore runtime calls after ESM scoping changes and bumps the service worker shell cache to force clients to pick up the fix.
> 
> **Overview**
> Restores settings/bookmark-related *bare global* calls that broke after the ESM conversion by explicitly re-exporting `announce`, `parsePath`, `route`, `openDriveDisconnectModal`, and `clearAllCaches` onto `window` in `js/app.js`.
> 
> Bumps the service worker `SHELL_CACHE` version (`shell-56` → `shell-57`) to invalidate the cached app shell so existing installs receive the updated script.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ac71c2ad8fbb826bafc63c20c6215d843f29ee00. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
