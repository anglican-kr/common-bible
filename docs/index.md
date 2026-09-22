# docs/ 진입점 — 무엇을 먼저 읽을지

작업을 시작하면 이 파일을 읽고, 아래 표에서 맞는 행의 문서를 **코드보다 먼저** 연다. 이 파일은 60줄 안에 유지한다 — 페이지가 늘면 한 줄 훅만 보태고, 낡은 행은 지운다(정리 루프는 CLAUDE.md「지식 베이스 루프」).

## 작업 유형 → 먼저 읽을 것

| 작업                              | 먼저 읽을 것                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 어떤 작업이든                     | `status.md`(지금 동작하는 것) · `known-issues.md`(남은 것) · `coding-pitfalls.md` 의 관련 절 · `grep -ril <키워드> docs/changes/`(같은 곳을 건드린 이전 변경)                  |
| 라우팅 · 뷰 · 탭 바 · 오버레이    | ADR-009 · 029 · 030 · 031 · 032 · 034 · `architecture.md` §4.1 · pitfalls §2 · §16                                                                                                |
| Service Worker · 캐시 · 릴리스    | ADR-021 · `architecture.md` §4.6 · §8 · pitfalls §7 · §15 · `scripts/release.py` 헤더                                                                                            |
| 검색                              | ADR-005 · 014 · 033 · `architecture.md` §4.2 · `js/search-worker.js` 헤더 주석                                                                                                  |
| 북마크 · 절 선택 · 모아 읽기      | ADR-010 · 035 · `js/app/verse-spec.js` · pitfalls §6                                                                                                                             |
| Drive 동기화 · OAuth              | ADR-011 · 017 · `architecture.md` §4.3 · §9 · pitfalls §11 · §12 · `archive/audit/`                                                                                             |
| 설정 · 디자인 시스템 · CSS        | `DESIGN.md`(루트) · ADR-028 · 023 · 025 · pitfalls §8 · §14                                                                                                                      |
| 오디오                            | ADR-016 · `js/app/audio-player.js` · pitfalls §15                                                                                                                                |
| 교회력 · 전례독서 · 캘린더        | `reference/liturgical-calendar-rules.md`(기도서 원문 — 알고리즘의 권위) · `design/liturgical-engine.md`(설계 + 미결 목록 — §1.4 정본 지도부터) · ADR-036 · 037 · 038 · `design/liturgical-engine-review.md` · `tests/fixtures/liturgical/README.md`(실제 연도 기대값 정본) |
| 본문 데이터 · 마크업 · 인용·주석  | ADR-022 · 027 · `common-bible-data` 저장소 README (서브모듈 `data/`)                                                                                                            |
| 유닛 테스트 · 타입 · 모듈 구조    | ADR-013 · 012 · 018 · 019 · `architecture.md` §4 · §6 · §7                                                                                                                       |
| 설치 · 스플래시 · 접근성          | ADR-007 · 008 · pitfalls §5 · §10                                                                                                                                                |
| 문서만                            | 해당 ADR + `archive/README.md`(무엇을 언제 archive 로 옮기나)                                                                                                                   |
| 작업 방식 · 훅 · CI               | CLAUDE.md「브랜치 보호」「지식 베이스 루프」 · `changes/README.md` · `.claude/hooks/*.sh` 헤더 주석                                                                              |

## 페이지 한 줄 훅

- `status.md` — 기능 단위 "지금 무엇이 동작하는가". 구현 PR 머지 시 갱신. 권위 출처.
- `known-issues.md` — 미해결 이슈·후속 백로그. 해결되면 지우고 원장에 남긴다.
- `coding-pitfalls.md` — 반복된 실수 패턴 16종 + 부록. 코드 실수뿐 아니라 사용자 교정·도메인 확정도 여기에 쌓는다.
- `architecture.md` — 제약 4가지 · 빌드/런타임 모듈 지도 · 영속 데이터 · 보안 모델 · **부록 A ADR 인덱스** · 부록 B 파일 빠른 참조.
- `decisions/NNN-*.md` — ADR. 상태 필드 + `> **개정 (날짜):**` 블록으로 진화. 새 결정은 다음 번호.
- `design/` — 진행 중인 구현 설계서(현재: 교회력 엔진 2종). 완료되면 `archive/design/` 으로.
- `reference/` — 기도서 등 외부 원문 전사. 해석하지 않고 옮긴 것이라 알고리즘 분쟁의 최종 심급.
- `changes/` — 변경 원장, 변경 하나에 파일 하나(2025-08 이후 전부). PR 본문의 원본. 형식은 `changes/README.md`.
- `archive/` — 완료·점-시점 기록(design 변천 · audit 보안 감사 · qa 회귀 보고서). 현행 정보 아님.
- `prd.md` — 제품 요구사항. 로드맵 Phase 1~4 의 출처.
