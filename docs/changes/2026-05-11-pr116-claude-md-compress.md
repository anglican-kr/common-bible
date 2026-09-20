---
date: 2026-05-11
pr: 116
branch: docs/claude-md-compress
title: "docs: CLAUDE.md 압축 (337 → 162줄, -52%) + architecture.md 모듈 지도 현행화"
---

# docs: CLAUDE.md 압축 (337 → 162줄, -52%) + architecture.md 모듈 지도 현행화

## Summary

CLAUDE.md가 매 대화마다 토큰 비용을 지불하는 파일인데 '현재 상태' + 파일 트리 등이 누적되며 비대해짐. 같은 정보를 ADR / design / audit / architecture에 중복 보유하는 부분을 포인터로 일원화. 부수적으로 \`docs/architecture.md\`의 ADR-018 이전 모듈 지도(\`app.js ~5,300줄\` 같은 옛 정보) 정정.

## CLAUDE.md 압축 (2단계)

| 구간 | 변경 |
| --- | --- |
| **1차** (이전 커밋) | '현재 상태' 50+줄 → 12줄. OAuth Phase 2b~2i 세부, TS 1/2차, 모듈 분할 phase 세부, 유닛 PR 묶음 나열 → 권위 출처 포인터 |
| **2차** (이번 커밋) | 파일 트리(113줄) → 최상위 한 줄씩 요약 + architecture.md 포인터. 로드맵·유닛 테스트 설명·부분 책 교체 Python·split_bible 스키마도 포인터화 |

전체: **337 → 162줄 (-52%)**

## architecture.md 현행화

CLAUDE.md가 가리키는 문서니까 정확도가 필수.

- **§4 모듈 지도**: \"정확히 6개 파일 · app.js ~5,300줄\"(ADR-018 이전) → 17개 파일, app.js ~280줄, app/ 9개, sync/ 5개로 갱신. ESM(ADR-019) 명시
- **§4.1·§4.2·§4.3**: \`app.js\`가 했던 일들 → \`app/views-routing.js\` / \`app/search.js\` / \`app/settings-ui.js\`로 정정
- **§6 TypeScript**: \"다음 사이클 적용 예정\" stale 메모 → \"모든 클라이언트 JS 영구 활성화 완료(2026-05-10)\"
- **§7 테스트**: 유닛 책임을 sync 한정 → sync + app 473 케이스, DOM-heavy는 e2e 명시
- **부록 A**: ADR-018(모듈 분할) + ADR-019(ESM) 인덱스 추가
- **부록 B**: 빠른 참조 7개 항목 → 모듈 분할 후 위치로 정정·확장(라우팅·검색 UI·북마크·설정 등)

## 정보 손실 확인

- 모든 OAuth Phase 디테일: ADR-011, \`docs/design/pkce-migration.md\`, \`docs/audit/2026-05-07-pkce-refresh-token.md\`
- 모듈 분할 디테일: ADR-018, \`docs/design/app-modularization.md\`
- 유닛 테스트 PR 목록: ADR-013, \`docs/qa/2026-05-11-unit-*.md\`, 로컬 메모리
- 파일 역할/라인 수: \`docs/architecture.md\` §4 + 부록 B

## Test plan

- [x] 코드 변경 0
- [x] 문서 단독 변경
- [x] 모든 정보의 권위 출처 존재 확인
