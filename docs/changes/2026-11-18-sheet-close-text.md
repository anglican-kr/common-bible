---
pr: 587
date: 2026-11-18
branch: style/sheet-close-text
title: "style: 시트의 닫기 단추를 「닫기」 글자로"
---

## 요약

인용 시트, 북마크 패널, 책 고르기 시트의 닫기 단추를 × 글리프에서 날짜 고르기 시트와 같은 「닫기」 글자 단추로 바꿨다. 네 시트가 공용 클래스(`.sheet-close`) 하나를 써서 글자 크기, 색, 단추 크기가 같다. 자리는 전과 같은 머리의 오른쪽 끝이고, 데스크톱의 오른쪽 패널에서도 같다. 모달의 ×는 그대로 둔다.

## 확정 · 근거

- 시트의 ×를 날짜 고르기 시트의 「닫기」에 맞춰 바꾸고, 모달의 ×는 그대로 둔다(사용자 결정 2026-11-17). 시안은 캔버스의 「바텀 시트의 닫기 단추」 줄이고, 사용자가 확인했다(2026-11-17).
- 네 시트의 「닫기」가 같은 크기인지 사용자가 물어(2026-11-18) 재어 확인했다. 휴대폰과 데스크톱에서 모두 글자 15.3px(`--font-sm`), 굵기 400, 단추 44×44px다.
- 구현하며 정한 것:
  - 날짜 고르기 시트의 `.cal-picker-close` 규칙을 공용 `.sheet-close`로 옮기고, 세 시트의 옛 규칙(× 글리프의 크기, 32px 상자, 각자의 포커스 표시)을 지웠다. 각 단추의 id와 클래스(`#cite-sheet-close`, `#bookmark-drawer-close`, `.book-filter-close`, `.cal-picker-close`)는 스크립트와 시험이 찾는 이름이라 남긴다.
  - 보이는 글자가 이름이므로 `aria-label`을 지웠다.
  - 인용 시트의 「닫기」는 뒤로 단추와 머리 높이를 맞추려고 높이를 `--icon-btn-touch`(2.45rem)로 둔다. 기본 글자에서는 44px로 다른 시트와 같고, 큰 글자 설정에서는 상자 높이만 조금 커진다. 글자 크기는 같다.
  - 전에는 북마크와 책 고르기의 단추가 32px라 최소 탭 크기(44px)보다 작았다.
  - 포커스 테두리는 앱 전체의 `:focus-visible` 규칙(2px 강조색 테두리)을 따른다. 시트를 열면 「닫기」로 포커스가 가는데, 키보드로 열었을 때만 테두리를 그리고 클릭이나 탭으로 열면 그리지 않는다(Chromium에서 북마크 패널과 인용 시트로 확인). 전에는 인용 시트와 책 고르기 시트의 단추가 테두리를 지우고 바탕색이나 그림자로 대신했는데, 이제 다른 단추처럼 테두리를 그린다.
- 디자인 시스템 아티팩트 36판: 네 컴포넌트(`CiteSheet`, `BookmarkDrawer`, `BookFilterSheet`, `CalendarDatePicker`)의 설명과 미리보기, `bundle.css`를 맞추고, `Button` 설명에 시트의 「닫기」를 더했다.

## 검증

- 유닛 전체 `node --test tests/unit/*.test.js` 1,910개 통과, 타입 검사 `npm run typecheck` 통과.
- e2e(작업 폴더 서버 8093): `test_cite_sheet.py`, `test_bookmark.py`, `test_search.py`, `test_calendar_view.py` 204개와 `test_a11y_axe.py`, `test_a11y_keyboard.py`, `test_bookmark_export_import.py` 73개 통과.
- 새 시험: 공용 확인 함수(`tests/e2e/conftest.py`의 `assert_sheet_close_button`)가 글자 「닫기」, `aria-label` 없음, 공용 클래스, 작은 글자(`--font-sm`), 44px 이상을 본다. 네 시트를 닫는 시험에서 부른다. 책 고르기 시트를 여닫는 e2e는 없어서 휴대폰과 데스크톱에서 하나씩 더했다(`test_book_filter_sheet_closes_with_its_close_button`, 닫은 뒤 포커스가 깔때기 단추로 돌아오는지도 본다).
- 화면으로 확인: 휴대폰의 네 시트 머리(인용, 북마크, 책 고르기, 날짜 고르기).

## 갱신한 문서

- `DESIGN.md`: 「시트 vs 모달」(시트의 닫기 단추, 모달은 ×), §6 컴포넌트 표의 「바텀 시트 / 사이드 패널」과 「캘린더 날짜 고르기」, 「HIG 44pt 최소 탭 영역」의 `--icon-btn-touch` 목록
- `docs/decisions/028-design-system.md`: `--icon-btn-touch`를 쓰는 단추 목록
