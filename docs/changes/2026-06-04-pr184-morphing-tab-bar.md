---
date: 2026-06-04
pr: 184
branch: claude/morphing-tab-bar-2Wh7I
title: "feat: 모바일 하단 내비 재배열 + 검색 모핑 (ADR-030)"
---

# feat: 모바일 하단 내비 재배열 + 검색 모핑 (ADR-030)

## 개요

모바일 하단 내비(ADR-029 탭 바)를 Apple Music 식으로 재배열하고, 검색 버튼 → 입력창 모핑을 추가한다 (ADR-030).

기존 `feat/morphing-tab-bar` 의 커밋을 기반으로 리뷰·마무리 + Apple Music 검색 idiom(닫기 버튼·롤백·빈 상태)을 더했다.

## 변경 내역

**P1 — 하단 내비 재배열**
- 라벨 제거, 아이콘 전용 탭 (홈·북마크·노트(준비 중)·설정)
- 검색을 탭에서 분리해 우측 하단 플로팅 원형 버튼으로

**P2 — 검색 모핑**
- 검색 원형 버튼 → 입력 pill 로 모핑, 비-홈 탭은 접히고 홈만 원형으로 잔류
- 하단 입력에서 직접 검색 커밋(`commitTopSearch` 재사용), `visualViewport` 로 키보드 위에 dock 띄움
- `/search` 전체뷰 상단 입력은 `body.tabbar-searching` 으로 숨김(하단 단일 필드)

**P2 마무리**
- `prefers-reduced-transparency` / `backdrop-filter` 미지원 시 모핑 입력 pill 폴백
- 모핑 시 입력 pill ↔ 홈 원형 간격(gap), Esc 닫기 시 포커스 복귀

**P3 — Apple Music 검색 idiom** (스크린샷 반영)
- **검색 닫기(X) 버튼** — 검색 진입 시 입력 pill 오른쪽에 원형으로 모핑 인, 검색 세션 동안 유지(결과 화면 포함). 탭하면 검색 모드 전체 롤백 → 기본 탭 바
- **검색 실행(Enter) 롤백** — 입력 blur → 키보드 내려 dock 접지 상태로 복귀(세션·X 유지)
- **검색어 지우기(⊗)** — 입력 pill 안, 텍스트 있을 때만
- **빈 상태 메시지** — 검색 결과 0건 + 빈 검색어 뷰에 중앙 정렬 돋보기 + 제목 + 부제 (Apple Music "최근 검색 없음" 스타일)
- dock 레이아웃 `margin-left:auto` 기반 — 닫기 X 가 collapsed 로 끼어도 idle 우측 정렬 유지
- a11y: 닫기 X idle 시 `aria-hidden`+`tabindex=-1` 로 트리 제외, 폴백 미디어쿼리에 모핑 표면 추가

## 검증

- ✅ 유닛 테스트 566개 전부 통과 (`node --test tests/unit/*.test.js`)
- ✅ TypeScript 0 error (`tsc -p tsconfig.json --noEmit`; tsconfig `node10` deprecation 경고만, 무관)
- ⚠️ 모핑·키보드·라우팅 동작은 e2e/로컬 수동 검증 책임 (ADR-013/029) — 이 환경엔 브라우저 미설치라 시각 확인은 로컬 권장

## 남은 작업 (후속)

- ⚠️ **ADR-030 문서 미작성** — 여러 커밋이 ADR-030 을 참조하나 `docs/decisions/030-*.md` 가 아직 없다. 머지 전 작성 필요 (CLAUDE.md ADR 워크플로우).

https://claude.ai/code/session_01BDbN8jxPRUTVV1UrsbH8px

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 모바일 검색·내비·Escape·라우팅 경로가 크게 바뀌었고 E2E가 정리되어 회귀는 수동/후속 e2e 검증에 의존한다.
> 
> **Overview**
> **모바일 검색 UX를 ADR-030 기준으로 전면 교체**합니다. `#search-sheet` / FAB 기반 바텀 시트와 관련 CSS·`openSearchSheet`·드래그·키보드 보정 로직을 제거하고, **`#tab-dock`** 안에서 탭 pill(아이콘 전용, 검색 탭 제외) + 우측 **검색 원형 버튼**이 **입력 pill로 모핑**되며 `/search` 전체 화면과 `commitTopSearch` 파이프라인을 재사용합니다.
> 
> **`tabbar.js`**가 모핑 진입·`visualViewport`로 dock 상승·Enter/⊗/닫기(X)·`closeTabSearch`/`exitTabSearch`를 담당하고, **`views-routing`**·**`app.js` Escape**가 라우트·오버레이 우선순위와 연동합니다. **검색 UI**는 Apple Music식 **중앙 빈 상태**·0건 메시지로 정리되고, **DESIGN.md**·타입·E2E에서 시트/FAB 테스트를 삭제·스킵 정리합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 5235ce3b181a6ac826a2469ec2f2cdeb5049f1b4. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
