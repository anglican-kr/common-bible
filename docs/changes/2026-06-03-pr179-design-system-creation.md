---
date: 2026-06-03
pr: 179
branch: claude/design-system-creation-S4R5E
title: "디자인 시스템 — 토큰 사다리 + Apple HIG 정렬 (ADR-028)"
---

# 디자인 시스템 — 토큰 사다리 + Apple HIG 정렬 (ADR-028)

## 요약

색상만 토큰화돼 있던 `css/style.css`에 **간격·타이포·반경·elevation·컨트롤·모션·내비 토큰 사다리**를 도입하고, 디자인 단일 권위 출처 **`DESIGN.md`** 를 신설했다. chrome UI 는 Apple HIG 에 정렬하되 성경 **본문은 Serif·넉넉한 행간을 의도적으로 유지**한다. 결정 근거는 **ADR-028**.

UX 관점의 핵심 문제였던 "타이포/간격/elevation/터치타깃이 매번 즉흥적으로 정해져 일관성이 작성자 기억에 의존하던" 상태를 단일 토큰 사다리로 수렴시킨다.

## 변경 내용

**`css/style.css` (`style:`)**
- `:root`(+`[data-theme="dark"]`)에 토큰 추가 — 기존 토큰명 하위호환 유지, **순수 추가·값 무변경**
  - 반경 `--radius-xs…pill`, elevation `--shadow-1..4·--shadow-sheet`(다크 alpha 자동 보강), 간격 8pt px `--space-*`, 타이포 rem `--font-*`/`--leading-*`, 컨트롤 `--touch-target(44)` 등, 모션, 내비 예약 토큰
- 점진 치환(값 동일 → 회귀 0): 헤더 스크롤 그림자→`--shadow-3`, 모달→`--radius-modal`·`--shadow-4`, 바텀 시트→`--radius-xl`·`--shadow-sheet`, 팝오버→`--radius-lg`
- HIG **44pt 터치타깃**: 헤더 뒤로/북마크 버튼 `2.2rem→2.45rem`, 오디오 재생 버튼 `min-width/height: var(--touch-target)`

**문서 (`docs:`)**
- **`DESIGN.md`**(루트) — 디자인 권위 문서: 원칙·색상·타이포·간격·반경/elevation·컴포넌트 카탈로그·적응형 내비 스펙·터치타깃·모션·접근성·HIG 적용/이탈 표·토큰 빠른 참조
- **`docs/decisions/028-design-system.md`** — ADR
- `docs/architecture.md` 부록 A · `CLAUDE.md` 현재 상태 갱신

## frosted glass — 하단/오버레이는 적용, 헤더만 솔리드

frosted glass(`backdrop-filter: blur`)는 **하단/오버레이 표면**(오디오 바·절 선택 바·검색 스크림)에 적용돼 있고, **헤더만** 솔리드로 두어 스크롤 elevation(`--shadow-3`)으로 깊이를 표현한다 — iOS toolbar tinting / PWA status bar 비동기 회피(ADR-025). iOS HIG 의 상단(정체성)/하단(오버레이) 의도적 차등 처리와 일치. (초기 커밋에서 ADR-025 를 "frosted glass 전역 미적용"으로 과해석했던 것을 정정함 — `42adfa5`.)

## 적응형 내비게이션 — 결정됨, 구현 대기 (후속 PR)

향후 내비를 HIG 적응형 패턴으로 재편: **모바일(≤768px) 하단 탭 바**(홈·검색·북마크·**노트**·설정 5탭) + **데스크탑(≥769px) 사이드바**. `노트`는 미구현 신규 기능 슬롯. **이번 PR 은 레이아웃 토큰 예약 + `DESIGN.md` §7 스펙 문서화까지만** 하고, 실제 탭바/사이드바 렌더·라우팅 재편·노트 기능은 별도 PR. 그래서 곧 대체될 상단 헤더는 44pt·토큰화 같은 무난한 정리만 적용했다.

## 검증

- ✅ 유닛 테스트 **566/566 통과** (`node --test tests/unit/*.test.js`)
- ✅ tsc 회귀 없음 (CSS 무관)
- ✅ CSS 중괄호 밸런스·신규 토큰 존재 확인
- ⚠️ **시각 회귀 QA 는 로컬에서**: `python3 scripts/serve.py 8080` 후 라이트/다크 × accent 4종 × 모바일/데스크탑에서 홈·읽기·검색·설정·북마크·인용 시트 육안 확인 권장 (헤더 그림자·모달/시트 반경·헤더 버튼 탭 영역). 본 환경엔 헤드리스 브라우저가 없어 자동 캡처는 미수행

🤖 https://claude.ai/code/session_01VaiYfib4vyozPwsyjkfkoG

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS·문서 중심이며 DOM/JS/인증 로직은 무변경; 다크 모달·시트 그림자가 elevation 일반화로 약간 짙어질 수 있어 시각 QA만 권장.
> 
> **Overview**
> 색상만 토큰화돼 있던 `css/style.css`에 **반경·elevation·8pt 간격·rem 타이포·컨트롤·모션·적응형 내비 예약** 토큰 사다리를 추가하고, 루트 **`DESIGN.md`** 와 **ADR-028**로 디자인 단일 권위를 잡는다. chrome UI는 Apple HIG(44pt 터치, elevation 사다리)에 맞추되 **성경 본문 Serif·넉넉한 행간**은 의도적 유지로 문서화한다.
> 
> **CSS**는 기존 변수명을 유지한 채 `:root`/`[data-theme="dark"]`에 토큰만 확장하고, 값이 동일한 구간부터 점진 치환한다 — 스크롤 헤더 `var(--shadow-3)`(다크 전용 규칙 제거), 모달·북마크/드라이브 다이얼로그 `var(--radius-modal)`·`var(--shadow-4)`, 인용·검색 시트 `var(--radius-xl)`·`var(--shadow-sheet)`, 팝오버 `var(--radius-lg)`. 헤더·시트 뒤로/북마크 버튼은 **2.45rem(≈44px)**, 오디오 재생은 `min-*: var(--touch-target)`.
> 
> **적응형 내비**(모바일 5탭 / 데스크탑 사이드바·노트 슬롯)는 **토큰·`DESIGN.md` §7 스펙만** — 실제 탭바/라우팅·노트는 후속 PR. `CLAUDE.md`·`docs/architecture.md` 인덱스도 갱신.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit f64e432625c26e2ec617b5276256522709786577. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
