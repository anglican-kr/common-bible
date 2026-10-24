---
date: 2026-10-24
branch: docs/design-engine-s5a
title: "docs: 교회력 설계서 §5.1-§5.3 고쳐 쓰기와 내용 검증"
---

## 요약

교회력 설계서 `docs/design/liturgical-engine.md`를 절마다 고쳐 쓰며 내용을 검증하는 작업(known-issues §24)의 셋째 PR이다. §5.1(좌표), §5.2(실측 스키마), §5.3(폴백 매칭)을 다뤘다. 데이터 파일의 형식, 날짜 표기, 필드 형태와, 본기도와 독서를 좌표로 찾을 때의 구체성 점수가 여기 있다. 절 번호, 미결 번호, §5.2의 facts 블록은 그대로 두었다.

- 사실을 하나씩 뽑아 데이터(`data/lectionary/*.json`)를 다시 세고, 엔진 코드(`matchScore`, `codeScore`, `topLayer`, `compareIds`, `normMonthDay`)와 대조했다. 낡은 수치와 설명은 고쳤다(아래 「확정 · 근거」).
- 문장을 `docs/writing.md`에 맞게 고쳐 썼다. 가운뎃점으로 잇던 명사를 쉼표와 문장으로 풀었고, 「스칼라」, 「3형」, 화살표 표기를 한국어로 바꿨다. 폴백 순서(①-④)는 번호 목록으로 나눴다.
- facts 블록 위의 안내 주석에서 「정합성」, 「정답」을 쉬운 말로 바꿨다(블록의 값은 그대로다).

## 확정 · 근거

어긋난 것은 모두 문서가 구현이나 데이터를 설명하다 낡은 경우였다. 사용자 결정이나 기도서 규칙과 코드가 어긋난 곳은 없었다.

- **같은 날짜에 성인이 여럿인 날은 12개다.** 문서는 13개라 했다. 2026-10-24 data#37에서 도미닉이 08.08로 가며 08.05가 빠졌다.
- **원소가 하나인 배열은 지금 없다.** 문서는 「`["mon"]`도 실제로 존재한다」고 했다. 지금 배열은 collects의 `weekday` 2건(부활 6주 넷과 둘), `year` 1건(사순 3주의 `["A","C"]`), `color_alt` 3건이다. 모델이 허용하므로 세 갈래 판정이 필요하다는 결론은 그대로 두고, 근거를 실제 배열로 바꿨다.
- **독서의 `weekday: null` 393건의 내역.** 문서는 「그 `null`들은 폴백이 아니라 고유명 날짜다」라고 했다. 나눠 보니 252건은 주일 레코드이고(주일에는 요일 코드가 없다), 141건이 이름이나 날짜가 있는 레코드다. 이름도 날짜도 없는 평일 독서에는 `null`이 없다. 「주일이거나 고유명 날짜」로 고쳤다.
- **파일 형식 표에 둘이 빠져 있었다.** 반절 표 `half-verses.json`(`{_meta, entries}`, #365)과 전례독서 검색 색인 `search-lectionary.json`(`_meta` 없는 `{names, cov, books}`)을 더했다. 「모든 파일이 객체 래퍼」는 그대로 맞다.
- **바뀐 수치.** 본기도 `id`는 1부터 323까지다(문서 1-327). 트랙 없는 독서는 753건이다(문서 745건). 대체 본기도는 facts `collects.collect_total_gt1`(지금 31, 문서 「실측 34 엔트리」)이다. `ending`의 A 건수(문서 317, 지금 313)는 facts `collects.ending.*`를 가리키게 했다. 본문에 수를 다시 적지 않는다는 §1.4의 규칙을 따른 것이다.
- **엔진이 실제로 하는 일**을 덧붙였다. 고정 날짜는 `normMonthDay`로 `MM.DD`에 맞추고, 음력 키는 바꾸지 않는다. `compareIds`는 숫자끼리는 수치로, 섞이면 숫자를 앞에 둔다. 폴백 점수는 `matchScore`와 축마다 `codeScore`, 최고점 층은 `topLayer`가 낸다.

확인했고 맞았던 것:

- §5.1의 축과 값. `type`은 네 값이고, 요일 코드는 `mon`부터 `sat`까지, 주기 코드는 A, B, C, I, II다.
- §5.2의 날짜 표기 세 가지와 쓰는 곳, `penitential`이 temporal 사계재 4건에만 있다는 것, `_review` 0건과 `_note` 1건(부활 6주 금요일과 토요일의 승천 본기도), readings `id`는 문자열이고 collects `id`는 정수라는 것.
- §5.3의 점수(코드 하나 2, 배열 1, `null` 0, 그 밖은 탈락), 연중 평일 본기도 34주가 모두 `weekday: null` 한 건이라는 것, `year` 배열이 1건뿐이라는 것, 예시 레코드 셋의 id와 필드, `성탄주간`이 11개 날짜에 있다는 것.

## 검증

- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --strict-counts`에서 사라진 토큰은 0이다. 줄어든 둘(「163건」, 「2026-09-01」)은 본문에 다시 적던 수치를 facts 블록의 키로 가리키게 바꾼 것이다.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/design/liturgical-engine.md' --kinds general --strict-counts`에서 사라진 토큰 둘(`["mon"]`, `null | 스칼라 | 배열`)은 위에서 고친 낡은 설명과 한국어로 바꾼 표기다. 줄어든 셋(`set_total > 1`, 「163건」, 「2026-09-01」)은 위와 같은 facts 참조다.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js` 31개가 모두 통과했다(facts 블록 대조 포함).

## 갱신한 문서

- `docs/design/liturgical-engine.md`: §5.1-§5.3을 고쳐 쓰고 낡은 내용을 고쳤다.
