---
date: 2026-05-09
pr: 88
branch: feat/app-modular-phase1
title: "feat: app.js 모듈 분할 Phase 1 — helpers.js 추출 (ADR-018)"
---

# feat: app.js 모듈 분할 Phase 1 — helpers.js 추출 (ADR-018)

## Summary

ADR-012 2차 적용 **2라운드의 첫 단계**. \`js/app.js\`(6,082줄)를 도메인별 모듈로 분할해 각 모듈에 \`// @ts-check\`를 영구 활성화하고, 최종적으로 \`tsconfig.app.json\`을 삭제(Phase 8)하는 8단계 작업의 시작점.

## 신설 문서

- **ADR-018** [\`docs/decisions/018-app-modularization.md\`](https://github.com/anglican-kr/common-bible/blob/feat/app-modular-phase1/docs/decisions/018-app-modularization.md) — 분할 결정·맥락·검토한 대안·채택 방식. 미래 monorepo split 컨텍스트 포함 (앱 / 데이터-성서 / 데이터-오디오 / 서버-nginx; 데이터 둘은 앱의 git submodule)
- **살아있는 설계 문서** [\`docs/design/app-modularization.md\`](https://github.com/anglican-kr/common-bible/blob/feat/app-modular-phase1/docs/design/app-modularization.md) — 41 섹션 cross-reference 매트릭스, 모듈 상태 공유 분석, 8단계 PR 계획, 모듈 시스템 결정 (Multi-script + \`defer\`), 부수 효과(성능)·미래 저장소 분할 컨텍스트

## Phase 1 산출물

- \`js/app/helpers.js\` 신설 (5개 함수)
  - \`_$(id)\` — \`getElementById\` HTMLElement non-null cast
  - \`chUnit(bookId)\` — Psalms는 "편" 외엔 "장"
  - \`el<K>(tag, attrs?, ...children)\` — generic narrow (\`el(\"button\")\` → \`HTMLButtonElement\`)
  - \`clearNode(node)\` — 자식 노드 제거
  - \`trapFocus(container)\` — Tab cycling
  - **모듈 패턴**: IIFE + \`window.appHelpers\` (sync 레이어와 일관, ADR-018 §채택 방식)
  - \`// @ts-check\` 영구 활성화
- \`js/types.d.ts\`: \`AppHelpers\` 인터페이스 신규 + \`Window\` augmentation
- \`js/app.js\` 헤드: \`const { _$, chUnit, el, clearNode, trapFocus } = window.appHelpers;\` destructure. 추출된 함수 정의 제거 (6,082줄 → **6,053줄**, -29)
- \`index.html\`: \`<script defer src=\"/js/app/helpers.js\"></script>\` 추가 (app.js 앞)
- \`sw.js\`: SHELL_CACHE \`shell-51\` → \`shell-52\`, \`/js/app/helpers.js\` 셸 매니페스트 추가

\`announce(msg)\`는 \`$announce\` anchor에 의존해 app.js에 잔류 (Phase 8 owner — anchor도 모듈화될 시점에 함께 이동).

## Test plan

- [x] \`npx tsc -p tsconfig.app.json --noEmit\` — 잔여 3 (gtag-init.js 외부, ADR-012 미적용)
- [x] \`npx tsc -p tsconfig.json --noEmit\` — 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` — 0 error
- [x] \`node --test tests/unit/*.test.js\` — 111/111 pass
- [ ] 브라우저 동작 확인 — 머지 전 사용자 수동 (\`scripts/serve.py 8080\` → \`/\` 접속, 콘솔 0 오류)

## 다음 단계

Phase 2: \`storage.js\` (~250줄) — localStorage 헬퍼 묶음 (Reading position / Audio time / Search history / Font/Theme/Color/Book order / Bookmark storage / Install nudge). 의존도 가장 낮음 (순수 함수).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Mostly a refactor, but it changes script load order and service-worker shell caching; a missing/incorrect `defer` order or cache mismatch could cause runtime failures on load.
> 
> **Overview**
> Begins ADR-018 modularization by extracting common DOM utilities from `js/app.js` into a new `js/app/helpers.js` module (IIFE exported as `window.appHelpers`) with `// @ts-check` enabled.
> 
> Updates `js/app.js` to consume these helpers via destructuring, adds the new script to `index.html` ahead of `app.js`, and bumps `sw.js` shell cache + precache list so the helper module is available offline.
> 
> Adds `AppHelpers` types and `Window.appHelpers` augmentation in `js/types.d.ts`, and introduces ADR/design docs describing the phased modularization plan.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 03a82bdd195899746522281ac720375db0a051aa. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
