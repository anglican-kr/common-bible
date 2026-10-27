---
date: 2026-10-27
branch: docs/term-chrome
title: "docs: chrome을 UI로 쓰는 용어 결정"
---

## 요약

문장 교정에서 쓸 용어 두 가지를 정해 `docs/writing.md`에 적었다.

- 「용어」 표에 한 줄을 더했다. 본문을 둘러싼 헤더, 버튼, 막대를 가리키던 「chrome」은 「UI」로 쓴다(「하단 UI」, 「UI 색」, 「시스템 UI」).
- 「용어」의 규칙에 한 줄을 더했다. CSS와 HIG의 용어는 그대로 쓴다.
- 문장 검사(`tools/prose/prose.py`)의 금지어 목록에 소문자 「chrome」을 더했다. 대문자로 쓰는 브라우저 이름 Chrome과 chromium은 걸리지 않는다(시험 하나를 더했다).

## 확정과 근거

- **chrome은 UI로 쓴다**(사용자 결정 2026-10-27). 대체어 후보로 「UI」, 「조작부」, 「화면 틀」을 냈고 사용자가 「UI」를 골랐다.
- **CSS와 HIG의 용어는 그대로 쓴다**(사용자 결정 2026-10-27). 사용자가 pill, dock, floating, picker, scrim, hairline을 바꾸면 CSS 작업 효율에 영향이 있는지 물었다. 문서와 주석의 말을 바꿔도 선택자와 토큰 이름(`#tab-dock`, `--radius-pill`)은 그대로라 CSS 작업에는 영향이 거의 없다고 답했다. 다만 문서의 말과 코드 이름이 달라지면 근거를 검색하기가 조금 어려워지므로, 그 요소를 가리킬 때는 코드 이름을 역따옴표로 함께 적는다. 이 가운데 picker는 HIG의 컴포넌트 이름이라 이 규칙에 든다.
- **아직 정하지 않은 말**: scrim(Material 디자인의 용어. 사용자는 한국어 대체어도 어색하다고 했다), dock, pill, floating, hairline. 정하면 같은 표에 더한다.
- 저장소에는 소문자 「chrome」이 45곳 남아 있다(`DESIGN.md` 18곳, `css/style.css` 7곳, ADR 028과 030 등). 진행 목록대로 각 파일의 문장 교정 묶음에서 고친다. 다음 묶음이 `DESIGN.md`다.

## 검증

- `python3 -m unittest tools/prose/test_prose.py`: 29개 통과.
- `node --test tests/unit/docs-*.test.js`: 22개 통과.

## 갱신한 문서

- `docs/writing.md` 「용어」: 표 한 줄과 규칙 한 줄
