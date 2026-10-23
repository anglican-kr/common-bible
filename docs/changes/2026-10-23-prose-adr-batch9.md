---
pr: 390
date: 2026-10-23
branch: docs/prose-adr-batch9
title: "docs: ADR 034 035의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 아홉째 PR이다. ADR 034와 035를 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37과 §40, 그리고 「용어」와 「학술 · 법률 문체 낱말」 목록이다.

| ADR | 본문에 반영한 것 | 「검토한 대안」으로 옮긴 것 |
| --- | --- | --- |
| 034 | bookmark.js 분할 여섯 라운드(2026-06-08, 06-11)를 「bookmark.js 분할」 절로 모음 | bookmark.js를 두 층(`bookmark-core.js` / `bookmark-ui.js`)으로만 나누는 처음 계획 |
| 035 | 폴더 행 진입점과 `/read` 라우트(2026-06-09), `play_lesson` 아이콘과 열 맞춤(2026-06-10), 드로어 버튼 순서(2026-06-11), 절 인스턴스 키(2026-07-27) | 헤더 `읽기` 버튼, `/bookmarks/read`, `menu_book`과 `auto_stories`, 드로어의 처음 버튼 순서 |

사용자가 이 PR을 만드는 중에 문서 작업은 묻지 않고 계속하고 머지까지 하도록 맡겼다(2026-10-23).

## 확정 · 근거

- **낡은 사실을 지금에 맞췄다.** 모두 저장소에서 확인했다.
  - ADR-034의 `docs/status.md`: 2026-10-23(#371)에 주제 문서의 「지금 동작」으로 나뉘어 들어가고 지워졌다.
  - ADR-034의 메모리 링크(`[[project_export_tsc_blindspot]]`)와 위키 링크(`[[docs/known-issues.md]]`): 비공개 메모를 가리키던 것이라, 저장소에 있는 기록인 pitfalls §39(`docs/topics/platform.md`)와 known-issues §2.1로 바꿨다.
  - ADR-035의 진입점과 라우트: 지금 읽기 버튼은 `js/app/bookmark-tree.js`의 `_buildFolderReadBtn`(`play_lesson`)이고, 라우트는 `read`와 `read/<folderId>`다(`js/app/routing.js`). 처음 「변경 내용」의 헤더 버튼과 `bookmarks/read`는 처음 구현임을 밝혔다.
  - ADR-035의 데스크톱 진입점: 「미결 사항」은 뒤의 일로 적었지만, 지금 드로어 폴더 행에도 읽기 버튼이 있다(`#bookmark-drawer-body .bm-folder-read-btn`, `css/style.css`). 상태 줄에서 뺐다.
  - ADR-035의 도우미 이름: `verse-spec.js`로 옮긴 `_specCoversVerse`·`_chapterMaxVerse`는 지금 `specCoversVerse`, `chapterMaxVerse`다.
- 영어 단어를 술어로 쓴 곳(import한다, grep하고 등)은 한국어 술어로 바꿨다(pitfalls §40).
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/03[45]-*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다. 개정 블록을 합치며 덜 적은 것(`bookmark-verse-select.js`, `_isDescendant`, `bookmark-ui.js`, `docs/known-issues.md`, 「2건」, 「1회」, `읽기`)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 두 ADR에 「꼴」이 없고, 본문에 물결표가 없다.

## 갱신한 문서

- `docs/decisions/034-views-routing-second-split.md`, `035-bookmark-reading-view.md`: 문장 정리와 개정 블록 반영.
