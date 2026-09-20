---
date: 2026-06-06
pr: 207
branch: design/token-adoption-sweep
title: "style: DESIGN.md 정합 스윕 — danger 표면색 · 그림자 사다리 · 탭 scrim"
---

# style: DESIGN.md 정합 스윕 — danger 표면색 · 그림자 사다리 · 탭 scrim

## 요약

`#206` 의 `--danger` 도입에서 출발해, **DESIGN.md(디자인 단일 권위 출처)를 기준으로 코드를 엄격 정합**한 디자인 스윕. 가이드를 어긴 곳은 코드를 토큰으로 고치고, 5단 사다리가 비현실적인 곳은 가이드를 먼저 조정해 일괄 적용했다. 세 갈래(커밋별):

### 1) 파괴색 — 표면 변형 토큰 (`572872e`)

`--danger`(채움)는 흰 글자용이라 고정이면 됐지만, 빨강을 **글자/테두리**로 쓰는 곳(에러 메시지·캐시 버튼 resting)은 짙은 빨강이 어두운 배경에서 대비가 모자라 별도 다크 변형이 필요했다.

- `--danger-text`(라이트 `#c0392b` / 다크 `#ee8888`)·`--danger-border`(`#e6a9a4` / `#884444`) 추가 — 다크 적응
- `.cache-clear-btn`·`.error` 토큰 통일, 흩어진 빨강 리터럴(`#e88`·`#844`·`#a33`) 제거
- phantom 토큰(`--surface-alt`·`--text-muted`) 사용처를 실제 토큰으로 정리
- 의도적 이탈 유지: division-tab 무채색(`#222`/`#e6e6e6`)·accent-텍스트(`#1a1a2e`)·그림자 rgba 관용구

### 2) DESIGN.md PWA 실행 컨텍스트·상태 문서화 (`e8ea65e`)

코드엔 구현돼 있으나 권위 문서에 빠졌던 영역을 명문화(신규 결정 아님):

- §2 theme-color 동기화(`--bg` 추종, 스킴 무관), §6 상태 컴포넌트(로딩·에러·빈 상태·업데이트 토스트)
- 신규 §12 PWA 실행 컨텍스트(실행 모드·오프라인·SW 업데이트·의도적 미도입 칸), §11 HIG 표 2행, ADR-028 §8

### 3) 그림자 사다리 전면 스냅 + 탭 dock scrim 제거 (`4bdebf2`)

- bespoke `box-shadow` 17곳을 가장 가까운 `--shadow-*` 단으로 **스냅**(시각 변화 감수)
- 데스크탑 사이드 패널 수평 그림자 `--shadow-drawer` 신설(사다리에 없는 축), 구분 탭 다크 override 제거
- 사다리 밖 축(헤어라인 반경·본문 인라인 `em`·연속 애니메이션 주기)을 DESIGN.md 에 **sanctioned 이탈로 명문화**
- `.cite-sheet-error` → `--danger-text`(에러=실패 신호, §6)
- `#tabbar-scrim`(페이드 그래디언트 + blur) DOM·CSS·`--scrim-*` 토큰 전량 제거 → **절 선택 액션 바와 동일한 "scrim 없이 글래스 캡슐만 뜨는" 패턴**으로 통일

## 테스트

유닛 618 케이스 통과, tsc 영향 없음(CSS·문서·주석만, JS 동작 변경 0). dev 배포 후 시각 확인(그림자·scrim, 라이트/다크 × 오디오 유무).

## 문서

DESIGN.md §2·§3·§5·§6·§9·§12·부록, ADR-028 §8·§9, ADR-030 개정, CLAUDE.md 현재 상태.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS·HTML·문서 위주이며 JS 동작 변경은 거의 없어 회귀 위험은 낮다. 다만 그림자·탭 바 뒤 본문 노출·다크 에러/캐시 버튼 색은 시각 회귀 확인이 필요하다.
> 
> **Overview**
> 디자인 시스템 후속 sweep으로 **파괴색·그림자·phantom 토큰**을 정리하고, 모바일 탭 dock **scrim을 제거**하며 `DESIGN.md`/ADR을 갱신한다.
> 
> **파괴색** — 표면용 `--danger-text`·`--danger-border`(다크 적응)를 추가하고 `.cache-clear-btn`·`.error`·`.cite-sheet-error`에 적용한다. 채움용 `--danger`는 고정, 다크 전용 `#e88`/`#844`/`#a33` 오버라이드는 제거한다.
> 
> **토큰 정리** — 정의되지 않았던 `--text-muted`/`--surface-alt`를 `.install-bookmark-notice`·`.settings-drive-info-desc`에서 실제 토큰(`--text-secondary`, `color-mix` 패널 등)으로 교체한다.
> 
> **Elevation** — bespoke `box-shadow` 17곳을 `--shadow-1`~`--shadow-sheet`로 스냅하고, 데스크탑 사이드 패널용 `--shadow-drawer`를 신설한다. 구분 탭 인디케이터의 다크 그림자 override를 없앤다.
> 
> **탭 바 UI** — `#tabbar-scrim` DOM·CSS·`--scrim-*`를 전부 제거해 절 선택 바와 같이 **글래스 캡슐만 본문 위에 뜨는** 패턴으로 통일한다(ADR-030 개정). `tabbar.js`는 `--kb-overlap` 주석만 정리한다.
> 
> **문서** — `DESIGN.md`에 danger 채움/표면 구분, `theme-color`↔`--bg`, 상태 컴포넌트, elevation 규약, PWA §12 등을 반영하고 ADR-028 §8–9·`CLAUDE.md` 현재 상태를 맞춘다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 4bdebf2c3731858a637583a6fce5dd49928d4231. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
