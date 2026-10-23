---
date: 2026-10-23
branch: docs/prose-adr-batch11
title: "docs: ADR 010의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 열한째 PR이다. ADR-010(북마크 기능)을 고쳐 썼다. 이 ADR은 2026-10-21부터 10-22까지의 수정(#362-#368)에서 개정 블록을 이미 본문에 반영해 두어, 이번에는 낱말과 이음표만 고쳤다.

- 「기각」 43곳을 「채택 안 함」으로 바꿨다(`docs/writing.md` 「용어」).
- 「옛 판」을 「옛 버전」으로, 화면 종류를 가리키던 「판」(「탭 바가 있는 판」)을 「화면」으로 바꿨다.
- 「걷은 뒤」를 「뗀 뒤」로, 「벤치마크해」를 「기준으로 삼아」로 바꿨다.
- 영어 단어를 술어로 쓴 곳(pre-select한다, announce한다, retarget되어, coerce되어)을 한국어 술어로 바꾸고 영어는 괄호에 넣었다(pitfalls §40).
- 굵은 글씨 제목 뒤의 줄표(「**…** — 」)를 쌍점으로, 낱말 사이의 가운뎃점을 쉼표로 바꿨다(pitfalls §37). 코드 이름과 「」 인용 안, 표, 「채택 안 함 날짜 · 이유 · 재검토」 형식은 그대로 두었다.

## 확정 · 근거

- **낡은 사실 하나를 고쳤다.** 절 선택 모드가 숨기는 하단 chrome 목록에 「tabbar scrim」이 있었다. scrim은 2026-06-06에 없앴다(ADR-030, `css/style.css`에 `#tabbar-scrim`이 없다). 그래서 그때 함께 숨겼고 지금은 없다고 적었다.
- z-index 표의 값(35, 70-75)은 `css/style.css`와 같음을 확인했다.
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/010-*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.

## 갱신한 문서

- `docs/decisions/010-bookmark-feature.md`: 낱말과 이음표 정리, scrim 사실 하나.
