---
pr: 389
date: 2026-10-23
branch: docs/prose-adr-batch8
title: "docs: ADR 030의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 여덟째 PR이다. ADR-030(모핑 탭 바)을 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37과 §40, 그리고 「용어」와 「학술 · 법률 문체 낱말」 목록이다.

이 ADR에는 개정 블록이 열다섯 개 가까이 있었다. 같은 날(2026-06-05) 활성 인디케이터를 여러 번 바꾼 기록이 대부분이다. 지금의 결론은 본문에 모았다. 탭 슬롯과 간격, 미끄러지는 56px 원형 인디케이터, 절제된 리퀴드 글라스, dock 크기 토큰, 북마크 ⋯ 메뉴의 가로 모드 스크롤, scrim 없이 띄우기, 검색 예시 안내, 가로 모드 탭 바, 키보드를 바로 띄우는 동기 focus다. 버린 모양은 「검토한 대안」에 「채택 안 함 날짜 · 이유」로 옮겼다. 활성 표시의 앞선 모양들, 처음 글래스 값, `corner-shape: superellipse(2)`, 장식 scrim이다.

## 확정 · 근거

- **낡은 사실을 지금에 맞췄다.** 모두 저장소에서 확인했다.
  - 탭: 노트 탭은 1.6.0(2026-06-09, 커밋 `04bd224`)부터 숨겨 두었고, 지금 탭은 홈, 캘린더(ADR-038), 북마크, 설정이다(`index.html`).
  - 인디케이터를 움직이는 `positionTabIndicator()`는 지금 `js/app/tabbar.js`에 있다(처음에는 `views-routing.js`).
  - 지금 CSS에는 `corner-shape`, `#tabbar-scrim`, `--scrim-*`가 없고, `--dock-control`, `--dock-icon`, `--glass-sheen`, `--glass-inset`, `--tab-bar-w`가 있다(`css/style.css`). 글래스 값은 `--bg 50%`와 `blur(12px)`다.
  - 스크롤 축소의 조건과 기준값(64px, 4px)은 `js/app/tabbar.js`의 `SCROLL_COLLAPSE_AT`, `SCROLL_TOP_EPS`, 그리고 `loadAudioShow`와 chapter/prologue 확인으로 확인했다.
  - 건수(`tests/unit/tabbar.test.js` 12 케이스, 유닛 578)는 그때의 값임을 밝혔다.
- **일부러 뺀 것.**
  - 「60행」: ADR 안에서 자기 줄 번호를 가리키던 말이다. 가리키던 내용을 직접 적었다.
  - 사실 토큰 둘(「로 미니 오디오와 동일 자리(탭바 우측~검색 사이,」, 「재사용)에」): 옛 글에서 줄바꿈을 사이에 둔 백틱 짝을 비교 도구가 코드로 읽은 것이다. 실제 이름(`position: fixed`, `--tab-bar-w`)은 남아 있다.
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/030-*.md' --kinds general --strict-counts`에서 줄어든 토큰은 0이고, 사라진 토큰은 위에 적은 셋뿐이다. 개정 블록을 합치며 덜 적은 것(`corner-shape: superellipse`, `--scrim-fade-top`, `background:none`, `.tab-item{flex:1}`, 「0건」, 날짜 등)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 「꼴」이 없고, 본문에 물결표가 없다. 영어 단어를 술어로 쓴 곳(focus할 때 등)은 한국어 술어로 바꿨다.

## 갱신한 문서

- `docs/decisions/030-morphing-tab-bar.md`: 문장 정리와 개정 블록 반영.
