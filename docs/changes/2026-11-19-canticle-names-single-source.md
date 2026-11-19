---
pr: 600
date: 2026-11-19
branch: refactor/canticle-names-single-source
title: "refactor: 송가 이름을 books.json 한 곳에서 읽기"
---

## 요약

앱이 송가 이름을 세 파일에서 따로 읽던 것을 `books.json` 한 곳으로 모은다(ADR-047 §5). 장 화면과 북마크는 이미 `books.json`을 읽었다. 이 PR로 전례독서 화면(송가 장 파일의 제목)과 검색(검색 메타 파일)도 `books.json`의 이름을 읽는다. 장 제목에서 라틴어 이름을 떼던 앱의 규칙(`canticleTitleOf`)은 지워, 그 규칙이 데이터 저장소의 전례시편 파서 한 곳에만 남는다. 화면에 보이는 이름은 바뀌지 않는다.

#598(송가를 이름으로 보이기) 위에 쌓은 PR이다.

## 확정 · 근거

- #598의 코드 리뷰가 송가 이름을 읽는 파일이 셋이라고 짚었다. 처음에는 데이터 시험이 셋을 견주므로 그대로 두자고 답했으나, 사용자가 기준을 하나로 두기를 원해 모으기로 했다(2026-11-19). `books.json`에는 라틴어 이름을 뗀 이름이 들어 있어 상단 바에 그대로 보인다는 것도 확인했다.
- 검색 워커는 앱이 책 목록을 받기 전에 시작한다. 그래서 앱이 이름을 넘기지 않고, 워커가 검색 메타 파일과 함께 `books.json`을 받는다(`init`의 `booksUrl`). 앱 껍데기와 함께 저장해 두는 파일이라 오프라인에서도 있다. 받지 못해도 검색은 하고 송가 결과에 이름만 없다.
- 전례독서 화면은 송가 슬롯이 있는 날 장 파일과 함께 책 목록을 받는다(`loadSlotChapters`). 장 파일을 받지 못해도 송가 이름은 보인다.
- 검색 메타 파일의 송가 이름은 데이터 PR에서 지운다. 이 PR을 먼저 머지해야 한다. 데이터가 먼저 바뀌면 그사이 main의 검색 결과에 송가 이름이 빠진다.

## 머지 순서

#598, 이 PR, 데이터 PR(검색 메타 파일에서 송가 이름 지우기)의 차례다. #598이 머지되면 이 PR의 기준 브랜치가 main으로 바뀐다.

## 검증

- 유닛 `node --test tests/unit/*.test.js`: 1,947개 통과. 워커가 `books.json`에서 이름을 읽어 결과와 구절 표기에 싣는 시험, `books.json`을 받지 못해도 검색하는 시험을 더했다(`search-worker.test.js`). 검색 메타 파일의 이름을 쓰던 시험은 `books.json`의 이름을 쓰게 바꿨다. `canticleTitleOf` 시험은 지웠다.
- `npm run typecheck` 통과.
- e2e(작업 폴더 서버 8092, 데이터 `fbbb3d8`): `test_search.py`, `test_lectionary_view.py`, `test_liturgical_render.py`, `test_copy.py` 254개 통과. 검색 결과 「즈가리야 송가 1」, 카드 「즈가리야 송가 1-3절」과 「모세송가」, 전례독서 화면의 복사 출처 「즈가리야 송가」, 「성모송가」가 들어 있다.

## 갱신한 문서

- `docs/decisions/047-canticle-names.md` §5: 앱은 송가 이름을 `books.json`에서만 읽는다. 「검토한 대안」에 「화면마다 가까운 파일에서 이름을 읽는다」.
- `docs/decisions/046-psalter-search.md` §4: 송가 이름을 읽는 곳을 `books.json`으로.
- `docs/topics/search.md`: 워커가 `books.json`을 받아 송가 이름을 싣는다.
- `docs/topics/liturgical.md`: 전례독서 화면의 송가 이름, 이름을 읽는 곳이 하나라는 줄.
