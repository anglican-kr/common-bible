# docs/ 진입점 — 무엇을 먼저 읽을지

작업을 시작하면 이 파일을 읽고, 아래 표에서 맞는 주제 문서를 **코드보다 먼저** 연다. 주제 문서 하나에 그 주제의 지금 동작, 결정, 함정, 남은 일이 모여 있다. 결정을 바꿀 때만 주제 문서가 가리키는 ADR을 연다. 이 파일은 60줄 안에 유지한다(정리 루프는 CLAUDE.md 「지식 베이스 루프」).

## 주제 문서 목록

| 작업 | 주제 문서 | 함께 볼 것 |
| --- | --- | --- |
| 북마크, 절 선택, 모아 읽기 | `topics/bookmark.md` | |
| Drive 동기화, OAuth | `topics/sync.md` | `archive/audit/`(보안 감사) |
| 라우팅, 뷰, 탭 바, 오버레이 | `topics/routing.md` | |
| 서비스 워커, 캐시, 릴리스 | `topics/cache-release.md` | `scripts/release.py` 머리 주석, `tools/csp/README.md`(릴리스 전 CSP 점검) |
| 검색 | `topics/search.md` | |
| 오디오 | `topics/audio.md` | |
| 설정, 디자인 시스템, CSS | `topics/design-system.md` | `DESIGN.md`(루트, 디자인의 권위) |
| 본문 데이터, 마크업, 인용과 주석 | `topics/bible-text.md` | `common-bible-data` 저장소 README(서브모듈 `data/`) |
| 교회력, 전례독서, 캘린더 | `topics/liturgical.md` | `design/liturgical-engine.md`(§1.4 정본 지도부터), `reference/liturgical-calendar-rules.md`(기도서 원문, 알고리즘의 권위), `tests/fixtures/liturgical/README.md`(실제 연도 기대값) |
| 앱 뼈대, 모듈, 타입, 테스트 | `topics/platform.md` | `tests/README.md` |
| 설치, 런치 스크린, 접근성 | `topics/install-a11y.md` | |
| 작업 방식, 훅, CI | CLAUDE.md 「브랜치 보호」 「지식 베이스 루프」 | `changes/README.md`, `.claude/hooks/*.sh` 머리 주석, pitfalls §17 · §26 · §29 · §30 · §31 · §32 · §36 · §37 |

여러 주제에 걸치는 함정은 `coding-pitfalls.md`에 전문이 있다(pitfalls §1 · §3 · §4 · §5 · §9 · §10 · §11 · §35, 부록 A · B). 같은 곳을 건드린 이전 변경은 `git log --format='%h %s' -- <파일>`이나 `grep -ril <키워드> docs/changes/`로 찾는다.

## 페이지 한 줄 훅

- `topics/` — 주제 문서. 틀과 규칙은 `topics/README.md`. 구현 PR을 머지할 때 그 주제의 「지금 동작」을 갱신한다.
- `known-issues.md` — 이슈 번호 대장. 번호마다 어느 주제 문서로 옮겼는지, 해소됐는지 적는다. 열린 이슈의 본문은 주제 문서의 「남은 일」에 있다. 절을 비워도 번호는 당기지 않는다(pitfalls §26).
- `coding-pitfalls.md` — 여러 주제에 걸치는 함정과 작업 방식 교정의 전문, 그리고 주제 문서로 옮긴 함정의 번호 대장.
- `architecture.md` — 제약 4가지 · 빌드/런타임 모듈 지도 · 영속 데이터 · 보안 모델 · **부록 A ADR 인덱스** · 부록 B 파일 빠른 참조.
- `decisions/NNN-*.md` — ADR. 상태 필드 + 본문은 현재 결론 — 결정이 바뀌면 제자리를 고치고 버린 선택지는 「검토한 대안」에 날짜·이유·재검토 조건과 함께 남긴다(개정 블록은 001-035 에 남은 옛 형식). 새 결정은 다음 번호.
- `design/` — 진행 중인 구현 설계서(현재: 교회력 엔진 2종). 완료되면 `archive/design/` 으로.
- `reference/` — 기도서 등 외부 원문 전사. 해석하지 않고 옮긴 것이라 알고리즘 분쟁의 최종 심급.
- `changes/` — 변경 원장. 변경 하나에 파일 하나이고, 2026-09-20부터 있다. PR 본문의 원본이다. 형식은 `changes/README.md`.
- `archive/` — 완료·점-시점 기록(design 변천 · audit 보안 감사). 현행 정보 아님.
