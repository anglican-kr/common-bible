---
date: 2026-06-05
pr: 198
branch: claude/tabbar-active-theme-color-uItSg
title: "style: 활성 탭 인디케이터 제거 → 활성 아이콘 테마색"
---

# style: 활성 탭 인디케이터 제거 → 활성 아이콘 테마색

## 요약

활성 탭의 **배경 인디케이터(pill)를 제거**하고, 대신 **활성 탭 아이콘 색상을 테마색(`--theme`)으로** 표시하도록 단순화했습니다. 더 가벼운 내비게이션 언어입니다. + 관련 디자인 문서 전체를 동기화했습니다.

## 변경 (CSS)
- `.tab-item.active` / `[aria-current="page"]`: 배경 틴트(`--accent` 14%) 제거, `color: var(--theme)`.
- `#tab-search.active`(`/search` 라우트): 동일하게 배경 틴트 제거 + `color: var(--theme)`. 검색 버튼 idle 글래스 배경은 유지.
- 모핑 홈의 죽은 `background: none` 규칙 정리. 모핑 홈 `--theme` 강조는 유지.
- 슬롯(`.tab-item` 60px 정사각)·`.tab-icon-wrap` 구조는 그대로(탭 영역·간격·press scale 유지).

## 디자인 결정 / 문서 동기화
`--theme` 사용 범위 확장: ADR-028 은 테마색을 절 번호·단락 기호 + 모핑 홈(내비 시그니처)로 한정했는데, 여기에 **내비 활성 탭/검색 아이콘**을 추가합니다(스킴 추종 활성 표시). 관련 문서를 모두 갱신:
- **ADR-030** §1 후속³ 개정 노트 추가.
- **DESIGN.md** — `--theme` 토큰 설명·§색상 스킴·§7 내비 스펙·컴포넌트 토큰 요약(4곳): "활성 탭/검색 = `--accent` 틴트" → "배경 인디케이터 없이 아이콘만 `--theme`".
- **ADR-028** §6 — `--theme` 시그니처 범위 괄호주에 내비 활성 추가, ADR-029 교차참조 활성색 갱신.
- **ADR-029** §1 — 활성 탭 = `--accent` 캡슐 pill → 아이콘 `--theme`(인디케이터 제거).
- **CLAUDE.md** — 현재 상태(ADR-028·029 줄) 갱신.

> 참고: division 탭(구약/신약/외경 책목록 탭, ADR-024)·토글·버튼 등 chrome 전반은 그대로 `--accent`(중립) — 이번 변경 무관.

## 테스트
- `node --test tests/unit/tabbar.test.js` — 12/12 통과 (CSS-only).
- 시각 변경이라 로컬 dev 서버 확인 권장(라이트/다크 × 스킴별 × 탭별 활성).
