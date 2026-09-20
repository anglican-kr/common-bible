---
date: 2026-05-09
pr: 91
branch: docs/adr-019-esm-conversion
title: "docs: ADR-019 신설 — ESM 모듈 시스템 채택 + ADR-001/018 정합"
---

# docs: ADR-019 신설 — ESM 모듈 시스템 채택 + ADR-001/018 정합

## Summary

**코드 변경 0의 docs PR**. 모듈 시스템 결정을 multi-script + 글로벌 namespace에서 **ESM 일괄 채택**으로 갱신.

ADR-018(2026-05-09)을 시작할 때 ADR-001 SPA 단순성을 절대 가치로 두고 multi-script를 채택했으나:

- Phase 2(\`storage.js\`)에서 함수 이름 글로벌 충돌로 ESM 부분 옵트인 → ADR-018 §\"module-vs-script 예외\" 추가
- 사용자 review에서 *SPA 단순성을 그리 무게 두지 않는다* 명시 → 단순성 절대화 폐기
- 후속 모듈(install/search/bookmark/views-routing/state)도 비슷한 충돌 가능성 → 점진 옵트인보다 일괄 전환이 일관

**결정**: Phase 4부터 ESM 일괄 채택, 빌드 단계 0은 유지.

## 변경 파일

- **`docs/decisions/019-esm-module-system.md`** (신설) — ESM 채택 결정·맥락·검토한 대안·채택 방식·후속 의제
- **`docs/decisions/001-spa-architecture.md`** — 개정(2026-05-09) 블록 추가. 빌드 단계 0(유지)과 namespace 패턴(폐기)을 분리해 단순성의 범위 재정의
- **`docs/decisions/018-app-modularization.md`** — 검토한 대안 표 갱신, §\"module-vs-script 예외\" → ESM 일괄 전환 갱신, 관련 ADR에 019 추가
- **`docs/design/app-modularization.md`** — §4.2 채택 = ESM 일괄(Phase 4부터), 진행 일지에 Phase 3 머지(#90) + 모듈 시스템 결정 변경 행 추가

## 결정 표 (요약)

| 축 | 결정 |
|---|---|
| **빌드 단계 0** (브라우저가 원본 \`.js\` 그대로 로드) | **유지** |
| **모듈 namespace 패턴** (multi-script + 글로벌 \`window.X\`) | **폐기** → ESM. \`window.X\` facade는 sync 회귀 방지 위해 유지 |
| **번들러 도입** (esbuild/vite) | 보류 — lazy load/tree-shaking 절실해질 때 별도 ADR |
| **\`.ts\` 파일** | 보류 — 빌드 단계와 함께 |

## 다음 단계

이 docs PR 머지 후:

1. **ESM 일괄 전환 PR** (코드만): sync 5개 + helpers + settings-ui + app.js + pre-fetch + audio-cache + gtag-init + index.html + types.d.ts 일괄 변환
2. **Phase 4** (\`install.js\`): ESM 패턴으로 시작

## Test plan

- [x] 코드 변경 없음
- [ ] markdown 렌더링 + ADR cross-reference 확인 (사용자)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation-only changes that update architectural decisions; no runtime code is modified. Risk is limited to potential confusion if downstream implementation PRs don’t follow the updated ADR guidance.
> 
> **Overview**
> Introduces **ADR-019** to formalize a shift from the previously planned *multi-script + `defer` + `window.X` namespace* approach to an **ESM-first module system** (`<script type="module">`) while explicitly keeping the **"build step 0"** constraint.
> 
> Updates ADR-001 and ADR-018 (and the modularization design doc) to align with this decision: *reframes “simplicity”* as keeping buildless static deployment, but **drops the global namespace pattern** going forward and documents the planned scope/strategy for an upcoming bulk conversion PR.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ee36e290dc843945a2b7045d79a196bc424887bc. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
