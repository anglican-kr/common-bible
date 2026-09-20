---
date: 2026-05-31
pr: 170
branch: feat/cite-per-parallel-tradition
title: "feat: <parallel> 단락 병행 본문 마커 + 인용 per-parallel tradition (ADR-027, ADR-022 §2 개정)"
---

# feat: <parallel> 단락 병행 본문 마커 + 인용 per-parallel tradition (ADR-027, ADR-022 §2 개정)

## Summary

ADR-022 §2 개정 (인용 parallels 의 per-entry tradition 표기) + ADR-027 신설 (단락 단위 `<parallel>` 마커 + source DSL 위치 잡기) 의 앱 측 구현. 본문 색상 중립화는 1.5.12 트랙의 사전 정리.

- **본문 색상 중립화 (1.5.12 prep)** — `--text`/`--text-secondary` 를 navy → 따뜻한 차콜로 옮겨 빨강·초록·보라 테마 accent 와 색조 충돌 해소
- **인용 per-parallel tradition (ADR-022 §2 개정 2026-05-31)** — `CiteParallelRef` 타입 도입, chipText·buildCiteChip·dedup 키 모두 per-entry tradition 반영. data attr 직렬화는 source markdown 의 `[전통]` 인라인 표기와 round-trip
- **ADR-027 신설** — source markdown 을 markdown + 자체 도메인 DSL (USFM/OSIS 류) 의 혼합으로 명문화. 단락 단위 병행 본문 마커 `<parallel>` 도입
- **<parallel> 렌더** — range 시작 절 직전에 ※ anchor 삽입 (변형 주석과 같은 글리프). 클릭 → footnote-style tooltip (`5:1-10 — 1역대 11:1-9 참조`). 본문 안 source link 클릭 → 기존 cite-sheet 로 병행 본문 표시. 토글은 `body.cites-shown` 으로 인용 칩·주석과 통합. 초기 배너 안은 dev 검증 후 footnote 패턴으로 전환 (§2 UI 렌더 개정 2026-05-31)
- **range 중첩 허용 (§2 검증 규칙 개정 2026-05-31)** — 큰 단락 + sub-단락 별개 출처 케이스 처리를 위해 overlap 금지 규칙 제거. 같은 start verse 에 marker 가 둘 이상 가능하도록 plural API (`findParallelsStartingAt`) 로 전환
- **데이터 서브모듈 포인터** — anglican-kr/common-bible-data#3 의 머지·CI 재빌드 후 webhook 으로 자동 갱신될 예정. 본 PR 의 포인터는 임시 (data feat HEAD)

## Commits (8)

| SHA | 설명 |
|---|---|
| `02071dd` | style: 본문 텍스트를 navy → 따뜻한 차콜로 중립화 |
| `1aeebbf` | feat: 인용 parallels per-entry tradition 표기 (#135) |
| `00f120b` | docs: ADR-027 — source DSL 위치 잡기 + <parallel> element 도입 |
| `9384df7` | feat: <parallel> 단락 배너 렌더 (ADR-027 Phase 2) ← b157acf 로 superseded |
| `cfd2ebb` | data: 서브모듈 포인터 → feat/cite-per-parallel-tradition HEAD |
| `b157acf` | feat: <parallel> 렌더 재설계 — 배너 → footnote anchor + tooltip |
| `2f65198` | docs: ADR-027 상태 → 구현 완료, CLAUDE.md 현재 상태 갱신 |
| `2315d74` | feat: <parallel> range 중첩 허용 + plural anchor API (ADR-027 §2 개정) |

## 테스트

- 기존 540 → 562 통과 (+22 신규)
- TypeScript: 0 error (앱·worker tsconfig 둘 다)

## 머지 순서 (중요)

1. **anglican-kr/common-bible-data#3 먼저 머지** — 데이터 main CI 자동 빌드 + sync-data webhook 이 앱 main 의 서브모듈 포인터 자동 갱신
2. **본 PR 머지** — release/1.5.12 로 squash
3. **release 1.5.12** — `scripts/release.py patch` → push + tag → `deploy.sh dev` (검증) → `deploy.sh promote` (prod)

## Test plan

- [x] node unit tests 562 통과, tsc 0 error
- [x] dev 배포 (1.5.11-2315d74) — 사무엘하 5장 3개 ※ anchor + tooltip + cite-sheet 흐름 시각 확인 통과
- [ ] 머지 후 dev 재배포 + 회귀 확인
- [ ] 1.5.12 릴리스 → prod promote

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches core reading UI (verse render, citations tooltips/sheets) and shared toggle behavior; behavior is well-tested but depends on data submodule alignment before release.
> 
> **Overview**
> **ADR-027** adds chapter-level `<parallel>` markers: `chapter.parallels` drives ※ anchors before each range start (footnote-style, not banners), tooltips with clickable refs, and cite-sheet for parallel text—all under the existing **인용 본문·주석** toggle (`body.cites-shown`). New `js/app/parallels.js`, wiring in `views-routing.js` / `app.js`, and CSS for `.parallel-anchor` / `.parallel-tooltip-ref`.
> 
> **ADR-022 §2** extends cite `parallels` from plain strings to `CiteParallelRef` (`ref` + optional `tradition`), with `[전통]` round-trip on chip data attrs, per-ref labels in chips and cite-sheet, and dedup keyed on full `(ref, tradition)` tuples.
> 
> Docs: ADR-027, ADR-022/024 updates, `architecture.md` index, `CLAUDE.md` status. Types in `js/types.d.ts`; `openNoteTooltip` accepts string or mixed DOM body. **+22** unit tests (`parallels.test.js`, expanded `citations.test.js`). Data pipeline/parser changes are referenced in ADR but live in the data submodule (pointer bump per PR description).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 2d7cbd37f1aef77d7c9a99ca68f8ea4ed0e83372. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
