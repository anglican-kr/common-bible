---
pr: 388
date: 2026-10-23
branch: docs/prose-adr-batch7
title: "docs: ADR 029 033의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 일곱째 PR이다. ADR 029와 033을 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37과 §40, 그리고 「용어」와 「학술 · 법률 문체 낱말」 목록이다. 옛 개정 블록은 본문의 해당 자리에 반영하고 지웠다. 바뀌기 전의 선택은 「검토한 대안」에 「채택 안 함 날짜 · 이유」로 남겼다.

| ADR | 본문에 반영한 것 | 「검토한 대안」으로 옮긴 것 |
| --- | --- | --- |
| 029 | 검색의 분리(ADR-030), 폭과 포인터로 나누기(2026-06-09), 북마크 화면의 ⋯ 메뉴, 정렬, 끌기와 스와이프, 🛈 안내, 선택 모드, 이동 모달(2026-06-05부터 06-07까지) | 검색을 탭으로, 폭 하나로 나누기, 「+」 버튼, 뒤쪽 글리프, 자동 정렬에서 핸들 끊기, 메뉴의 「삭제」와 일괄 삭제 모달, 스크롤 축소 미채택(ADR-030이 채택) |
| 033 | 검색 필드 안 토큰(2026-06-08), 깔때기 늘 보이기(2026-06-09, 06-11), 책 선택 시트의 데스크톱 사이드 패널(2026-06-11) | 별도 옵션 바, 결과 내 검색(AND, 2026-06-09에 없앰), 빈 검색의 돋보기, 데스크톱 가운데 모달 |

ADR-033의 「결과 내 검색」은 사용자가 뒤에 다시 들일 때의 출발점으로 설계 기록(D1, D2, D3, 항목 2, 대안 B)을 남기기로 했으므로, 지운 것으로 표시하되 내용은 남겼다.

## 확정 · 근거

- **낡은 사실을 지금에 맞췄다.** 모두 저장소에서 확인했다.
  - ADR-029의 탭: 지금 탭은 홈, 캘린더(ADR-038), 북마크, 설정이고, 노트는 숨겨 두었다. 검색은 따로 떨어진 원형 버튼이다(`index.html`, ADR-030).
  - ADR-029의 ⋯ 메뉴: 지금 순서는 관리 묶음(새 폴더, 내보내기, 가져오기, 선택), 정렬 기준, 정렬 방향(2026-06-10, ADR-010)이다. 「삭제」 항목은 선택 모드의 dock으로 옮겨 가 메뉴에 없다(`js/app/bookmark-menu.js`).
  - ADR-029의 스크롤 축소: ADR-029는 채택하지 않았지만 ADR-030이 채택해 구현했다(P3, #200). 본문의 「스크롤 축소를 하지 않는 이유」 절을 「검토한 대안」으로 옮겼다.
  - ADR-029의 frosted glass: ADR-030이 `::before` 층 대신 요소에 직접 적용하게 바꿨다.
  - ADR-033의 옛 필터 바 CSS(`.search-filters` 등): 「뒤에 정리」라고 적었던 규칙은 지금 `css/style.css`에 없다.
  - ADR-033의 시트 닫기: `window.closeBookFilterSheet`는 없고, `route()`가 `window.appOverlay.closeAllOverlays()`로 등록된 오버레이를 모두 닫는다(`js/app/routing.js`, `js/app/overlay.js`).
  - 건수(유닛 566, 678, 683)는 그때의 값임을 밝혔다.
- **일부러 뺀 것.**
  - ADR-029의 「26행」: ADR 안에서 자기 줄 번호를 가리키던 말이다(「26행 결정대로」). 본문을 다시 써서 줄 번호가 뜻이 없어졌으므로, 가리키던 내용(「추가는 읽기 화면에서만」)을 직접 적었다.
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/029-*.md' --docs 'docs/decisions/033-*.md' --kinds general --strict-counts`에서 줄어든 토큰은 0이고, 사라진 토큰은 위에 적은 「26행」 하나뿐이다. 개정 블록을 합치며 덜 적은 것(`--text-secondary`, `_descendantIds`, `refreshDeleteEnabled`, `test_bookmark_bulk_delete.py`, `::before`, `.token-refine-add` 등)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 두 ADR에 「꼴」이 없고, 본문에 물결표가 없다. 영어 단어를 술어로 쓴 곳(`navigate()`된다 등)은 한국어 술어로 바꿨다.

## 갱신한 문서

- `docs/decisions/029-mobile-tab-bar.md`, `033-search-options.md`: 문장 정리와 개정 블록 반영.
