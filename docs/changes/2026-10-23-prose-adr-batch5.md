---
date: 2026-10-23
branch: docs/prose-adr-batch5
title: "docs: ADR 022 027의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 다섯째 PR이다. ADR 022와 027을 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37과 §40, 그리고 「용어」와 「학술 · 법률 문체 낱말」 목록이다. 옛 개정 블록과 「현재 상태」 블록은 본문의 해당 자리에 반영하고 지웠다. 바뀌기 전의 선택은 「검토한 대안」에 「채택 안 함 날짜 · 이유」로 남겼다.

| ADR | 본문에 반영한 것 | 「검토한 대안」으로 옮긴 것 |
| --- | --- | --- |
| 022 | 「지금 상태」(2026-05-27 기록을 코드와 맞춤), 주석 툴팁(2026-05-24), 칩을 span으로(2026-05-29), per-parallel tradition과 복사 때 칩 빼기(2026-05-31), 데스크톱 사이드 패널(2026-06-21 확인) | tradition 없이 시작, 기본값 OFF(둘 다 2026-05-23), 장 끝 주석 단락, `<button>` 칩, 사본 전통은 첫 출처에만 |
| 027 | ※ 앵커 화면과 range 중첩 허용(2026-05-31), 「현재 상태」 블록 | 단락 머리 배너, 같은 장 안 range 겹침 금지 |

## 확정 · 근거

- **낡은 사실을 지금에 맞췄다.** 모두 저장소에서 확인했다.
  - ADR-022 「현재 상태」의 설정: 칩과 주석을 따로 켜고 끄는 키(`bible-note-show`)는 코드에 없다. 토글은 `bible-cite-show` 하나다(`js/app/storage.js`). 인쇄용 하단 footnote도 없다(`css/style.css`에 `@media print`가 없다). known-issues §12.1의 ADR-022 부분을 해소로 바꿨다(`docs/topics/platform.md`).
  - ADR-022의 진행 이슈: #134와 #135는 닫혔고, #136(Phase 3)은 열려 있다(GitHub에서 확인).
  - ADR-022의 인용 시트: 시트 제목은 「인용된 구절」이고, ref마다 머리에 「› 더 보기」 버튼이 있다. 처음 적은 「이 장 전체 보기」와 「`이사 53:5` + `· 칠십인역`」 머리는 코드에 없다. 뒤의 본문은 `inert`로 두지 않고, 스크림 없이 포커스만 가둔다(`js/app/citations.js`, ADR-032).
  - ADR-022의 칩 표기: 사본 전통은 ref 뒤가 아니라 앞에 붙는다(`chipText`).
  - ADR-022의 절 앵커: 칩은 페이지를 옮기지 않고 시트를 연다. 라우터에는 `#v5` 같은 절 앵커가 없고, 절 구간은 경로로 적는다(`js/app/routing.js`). §2의 「첫 절로 이동」, §6의 앵커 이동, ADR-009 개정 계획, Phase 2 검증 계획을 「처음 계획」으로 적었다.
  - ADR-022 §5: 주석이 툴팁으로 바뀌어 「주석 단락」이 없다.
  - ADR-022의 직렬화 함수: `serializeVerseRange`는 지금 `js/app/verse-spec.js`에 있다.
  - ADR-022의 코치마크 문구: 「회색 인용 출처 버튼을 누르면 인용 본문이 시트로 열려요.」(`js/app/citations.js`).
  - ADR-022의 옮겨 실린 절 목록: 데이터와 다르다는 known-issues §11.1을 목록 끝에서 가리키게 했다. 목록 자체는 인쇄본 대조 전이라 그대로 두었다. `docs/topics/bible-text.md`의 §11.1에서 「ADR-022에 옛 개정 블록이 있다」는 말을 고쳤다.
  - ADR-027의 「현재 상태」: 구현을 뒤의 일로 적고 배너를 그린다고 했지만, 같은 날 구현을 마쳤고 화면은 ※ 앵커다(`js/app/parallels.js`). 지금 `source/2sam.md` 5장에 마커 셋이 있다(data 저장소).
  - ADR-027의 주석 앵커: `<note>X</note>[^id]`는 `<button>`이 아니라 `<span class="note-anchor" role="button">`으로 그린다.
  - ADR-027의 같은 절에서 시작하는 마커 둘: 앱은 나란히 그리지만(`tests/unit/parallels.test.js`), data 저장소의 parser가 절 없이 이어지는 마커 둘을 오류로 막으므로 지금 데이터에서는 생기지 않는다(`src/parser.py`).
  - ADR-027 §4의 「겹침 없음」 검증과 §5의 배너 테스트 계획: range 중첩 허용과 ※ 앵커로 바뀐 것을 함께 적었다.
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/02[27]-*.md' --docs 'docs/topics/*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다. 개정 블록을 합치며 덜 적은 것(`#cite-sheet`, 칩과 parallels 예시, 「1회」, 2026-06-11, `이 장 전체 보기`)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 두 ADR에 「꼴」이 없고, 본문에 물결표가 없다. 영어 단어를 술어로 쓴 곳도 없다.

## 갱신한 문서

- `docs/decisions/022-citations-and-annotations.md`, `027-source-dsl-and-parallel-passages.md`: 문장 정리와 개정 블록 반영.
- `docs/topics/platform.md` known-issues §12.1: ADR-022 부분을 해소로.
- `docs/topics/bible-text.md` known-issues §11.1: ADR-022의 개정 블록 언급을 지금에 맞춤.
