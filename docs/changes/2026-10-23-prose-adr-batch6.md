---
pr: 387
date: 2026-10-23
branch: docs/prose-adr-batch6
title: "docs: ADR 028 031 032의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 여섯째 PR이다. ADR 028, 031, 032를 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37과 §40, 그리고 「용어」와 「학술 · 법률 문체 낱말」 목록이다. 옛 개정 블록은 본문의 해당 자리에 반영하고 지웠다. 바뀌기 전의 선택은 「검토한 대안」에 「채택 안 함 날짜 · 이유」로 남겼다.

| ADR | 본문에 반영한 것 | 「검토한 대안」으로 옮긴 것 |
| --- | --- | --- |
| 028 | 테마색 범위(2026-06-03, 06-05)와 그 뒤의 변경, 스케일 스냅(2026-06-03), 적응형 내비 구현(ADR-029) | 값이 같은 곳만 토큰으로 바꾸기 |
| 031 | pop-to-root에서 읽던 책 카드에 포커스(2026-06-10), 모든 await 뒤의 가드(2026-06-08) | 화면마다 포커스 기억(이미 있던 항목을 「채택 안 함」 형식으로) |
| 032 | 개정 블록 없음. 문장과 낱말만 고쳤다(「기각」, 「수렴」, 「정합」) | 없음 |

이 밖에 known-issues §28을 기록했다. ADR-028을 코드와 견주다 찾았다. `DESIGN.md` §2는 읽기 본문의 테마색을 절 번호와 단락 기호 두 곳으로 적고 오디오 플레이어를 뺐다고 적는데, 지금 코드는 오디오 재생 버튼과 이어 읽기 배너(1.6.0, #248에서 되돌림), 응송과 계응 표시, 전례독서 꺾쇠에도 `--theme`를 쓴다. 디자인 시스템 주제 문서의 「남은 일」에 적었다. `DESIGN.md`는 고치지 않았다. 사용자가 PR 검토 중에 `DESIGN.md`와 코드가 다르면 나중에 바뀐 쪽을 기준으로 보기로 정했다(2026-10-23). 커밋 날짜를 보면 `DESIGN.md` §2 문단은 2026-06-06(#200)이 마지막이고, 1.6.0(2026-06-09)은 CSS만 고쳤다. 그래서 코드가 기준이고, `DESIGN.md`는 디자인 시스템 아티팩트와 함께 따로 고친다. 이 원칙을 디자인 시스템 주제 문서의 「확정 사실」에 적었다.

또 known-issues §29를 기록했다(사용자 요청, 2026-10-23). #386에서 ADR-027을 코드와 견주다 찾은 것이다. 같은 절에서 시작하는 병행 표시 둘을 앱은 그리지만, data 저장소의 parser는 그런 마커를 오류로 막는다. 성서 본문 주제 문서의 「남은 일」에 적고, ADR-027에서 가리킨다.

## 확정 · 근거

- **낡은 사실을 지금에 맞췄다.** 모두 저장소에서 확인했다.
  - ADR-028의 테마색 범위: 2026-06-03(네 곳), 2026-06-05(오디오를 뺌, FAB는 이미 없음), 2026-06-09(1.6.0 커밋 `04bd224`에서 재생 버튼과 이어 읽기 배너를 되돌림), ADR-037·038의 전례 표시까지 차례로 적었다(`css/style.css`의 `var(--theme)` 쓰임).
  - ADR-028의 토큰: `--duration-fast`는 지금 0.15s다. 예약한 내비 토큰 가운데 CSS가 실제로 쓰는 것은 `--nav-z`뿐이다(`--tabbar-h`, `--tabbar-icon`, `--sidebar-w`는 쓰는 곳이 없다).
  - ADR-031의 탭: 캘린더 탭(ADR-038)이 더해져 `lastPathForTab`에 `calendar`가 있고, `tests/unit/tab-history.test.js`는 12개다(`js/app/tab-history.js`).
  - ADR-031의 `route()` 위치: 지금 `js/app/routing.js`다(ADR-034 PR5a).
  - ADR-032의 `closeOnEsc`: 지금도 기본은 꺼짐이고, 북마크, 설치, 검색의 일부 오버레이가 켠다(`js/app/overlay.js`, `bookmark.js`, `install.js`, `search.js`).
  - 줄 번호와 건수(ADR-032의 `trapFocus` 위치표, 유닛 644, ADR-031의 11 케이스)는 그때의 값임을 밝혔다.
- **일부러 뺀 것.**
  - ADR-028의 `1~2px`: 숫자 구간은 하이픈으로 쓴다(pitfalls §32). `1-2px`로 바꿨다.
  - ADR-031의 「body 일 때만」: 영어 뒤 조사는 붙여 쓴다(pitfalls §31). 「body일 때만」으로 바꿨다.
  - ADR-031의 「← 이전 · 다음 →」: 가운뎃점으로 이은 인용을 「← 이전」과 「다음 →」으로 나눴다(pitfalls §37).
  - ADR-031의 사실 토큰 하나(「로 막혀 있었고(읽기·북마크·설정·일반 목록은 미가드), auto-nav 의 inner」): 옛 글에서 줄바꿈을 사이에 둔 백틱 짝을 비교 도구가 코드로 읽은 것이다. 실제 이름(`parsePath().view !== "search"`, `route()`)은 남아 있다.
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/028-*.md' --docs 'docs/decisions/03[12]-*.md' --docs 'docs/topics/*.md' --kinds general --strict-counts`에서 줄어든 토큰은 0이고, 사라진 토큰은 위에 적은 넷뿐이다. 개정 블록을 합치며 덜 적은 것(「2행」, `recordPath(현재 /search URL)`, `_routeSeq`, `finally`, `onRouteEnd`)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 세 ADR에 「꼴」이 없다(「글꼴」은 낱말이다). 본문에 물결표가 없다. 영어 단어를 술어로 쓴 곳(`navigate`한다 등)은 한국어 술어로 바꿨다.

## 갱신한 문서

- `docs/decisions/028-design-system.md`, `031-tab-history-restore.md`, `032-component-view-layer.md`: 문장 정리와 개정 블록 반영.
- `docs/topics/design-system.md` 「남은 일」, `docs/known-issues.md`(§28): `DESIGN.md` §2의 테마색 범위.
- `docs/topics/design-system.md` 「확정 사실」: `DESIGN.md`와 코드가 다르면 나중에 바뀐 쪽이 기준이다.
- `docs/topics/bible-text.md` 「남은 일」, `docs/known-issues.md`(§29, 다음 번호 §30), `docs/decisions/027-source-dsl-and-parallel-passages.md`: 같은 절에서 시작하는 병행 표시.
