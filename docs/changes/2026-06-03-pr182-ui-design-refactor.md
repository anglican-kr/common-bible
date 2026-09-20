---
date: 2026-06-03
pr: 182
branch: style/ui-design-refactor
title: "style: DESIGN.md 기준 UI 토큰 전면 채택 (스케일 스냅) + 인용 시트 헤더 픽스"
---

# style: DESIGN.md 기준 UI 토큰 전면 채택 (스케일 스냅) + 인용 시트 헤더 픽스

## 배경
`css/style.css` 가 색상만 토큰화돼 있고 타이포·간격·반경·모션 등은 ad-hoc rem/px 값으로 난립(ADR-028 맥락). DESIGN.md 기준으로 **ad-hoc 값을 가장 가까운 토큰으로 전면 스냅**해 코드가 디자인 시스템을 실제로 따르게 정렬했다. (사용자 합의: "스케일 스냅" — 토큰과 정확히 안 맞던 값은 미세 조정 허용, 시각 회귀 최소.)

## 변경 (영역별 단계, dev 확인하며 진행)

| 영역 | 내용 |
|---|---|
| **타이포 §3** | font-size 108곳 → `--font-*` (rem 0→108), line-height → `--leading-*` |
| **간격 §4** | margin/padding/gap **193곳** → `--space-*` 8pt(px). calc/env/positioning·그리드 초과·기능적 예약(3rem·6rem)·읽기 칼럼 패딩은 보수적 제외 |
| **반경 §5** | 34곳 → `--radius-*`. 마이크로(2px 그래버·1px 진행바)는 유지 |
| **elevation §5** | 토큰 정확 일치분만 `--shadow-*` (나머지는 포커스 링·다층 커스텀이라 대상 아님) |
| **모션 §9** | 토큰을 실사용에 맞게 조정 후 스냅: `--duration-fast` 0.18→**0.15s**, 신규 `--duration-instant(0.1)`·`--ease-standard`. 듀레이션 64줄 스냅, ease 9곳 토큰화. CSS 기본 `ease`·스피너·1회성 곡선 유지 |

## 신규 토큰
- `--icon-btn-touch: 2.45rem` — rem 스케일 헤더 아이콘 박스(≈44px @18px, Dynamic Type 추종). `.title-back-btn`·`.title-bookmark-btn`·`#cite-sheet-back`·`#cite-sheet-close` 공유. 고정 px `--touch-target` 과 역할 구분
- `--duration-instant(0.1)` · `--ease-standard(cubic-bezier(0.4,0,0.2,1))`

## 버그 픽스 (동반)
- **인용 시트 헤더 높이 점프** — '더 보기' 진입 시 back 버튼(2.45rem)이 나타나며 닫기 버튼(2rem) 기준 높이에서 8px 점프하던 문제. 닫기 버튼을 `--icon-btn-touch` 로 통일해 헤더 높이 고정 + HIG 44px 터치타깃 충족(기존 36px 미달)

## 문서
- DESIGN.md §3·4·5·8·9 + 토큰 부록 갱신, ADR-028 §7 개정 블록, CLAUDE.md 현재 상태

## 검증
- 566 유닛 통과, tsc 0 error (**JS 무변경** — CSS/문서뿐), CSS 브레이스 균형 0
- dev 배포로 6단계 모두 라이트/다크 시각 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS·문서만 변경되고 JS/데이터/인증 로직은 건드리지 않아, 리스크는 전역 UI 미세 시각 차이와 회귀 가능성에 한정된다.
> 
> **Overview**
> **`css/style.css` 전반**에서 ADR-028/DESIGN.md 토큰으로 ad-hoc rem/px 값을 “가장 가까운 스케일”로 스냅했다. 타이포(`--font-*`, `--leading-*`), 간격(`--space-*`), 반경, elevation 일치분, 모션(`--duration-fast` 0.18→0.15s, 신규 `--duration-instant`, `--ease-standard`)이 대상이며, 일부 값은 토큰과 정확히 맞지 않아 미세 조정됐다. **JS 변경 없음.**
> 
> **신규 `--icon-btn-touch`(2.45rem)** 로 헤더·인용 시트의 뒤로/북마크/닫기 버튼 hit box를 통일했다. **인용 시트**에서 back 표시 시 닫기 버튼(2rem)과 높이가 달라 헤더가 점프하던 문제를 닫기도 `--icon-btn-touch`로 맞춰 고정했다.
> 
> **문서**: `DESIGN.md` §3·4·5·8·9·부록, `docs/decisions/028-design-system.md` §7(토큰 전면 채택), `CLAUDE.md` 현재 상태를 위 내용으로 갱신했다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6746777703e8c4e19ebb219f0eb43ae634ed0189. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
