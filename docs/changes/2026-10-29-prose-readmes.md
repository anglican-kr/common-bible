---
date: 2026-10-29
branch: docs/prose-readmes
title: "docs: 문장 교정(테스트 픽스처와 도구 설명서)"
---

## 먼저 보실 곳

뜻이 달라질 수 있는 고침이다. 숫자, 날짜, 인용, 코드 표기는 바꾸지 않았다(아래 「검증」의 사실 토큰 비교). 줄 번호는 지금 파일의 줄이다.

- `tests/fixtures/liturgical/README.md` 14행: 기준 결과 파일 머리줄의 「data sha」를 「데이터 해시(sha)」로 바꿨다. 데이터 서브모듈의 커밋 해시로 읽었다.
- `tests/fixtures/liturgical/README.md` 16행: 합성 표 케이스 목록의 「선택 봉헌이 비운 원래 날리」를 「원래 날」로 고쳤다. 「날리」를 오타로 보았다.
- `tests/fixtures/liturgical/README.md` 53행: `group` 칸의 「참조 대상이 아니다 — 대응표용」을 「참조 대상이 아니다. 대응표에 쓴다」로 바꿨다.
- `tests/fixtures/liturgical/README.md` 81행: 「→ R-6.4-ember-color」를 「R-6.4-ember-color를 본다」로 풀었다.
- `tests/fixtures/liturgical/README.md` 92행: 공개 CI가 검사하는 항목의 명사 나열을 「스키마가 맞는지, id가 유일하고 형식이 맞는지, …」처럼 「~는지」로 맞췄다. 항목은 줄이거나 늘리지 않았다. 「공개 CI의 skip만 믿지 않는다」는 「공개 CI에서 건너뛴 결과(skip)만 믿지 않는다」로, 「(픽스처 변경도 트리거)」는 「(픽스처가 바뀔 때도 실행된다)」로 바꿨다.
- `tests/fixtures/liturgical/README.md` 93행: 「「잠정」 표시로 돌리되」를 「「잠정」 표시를 붙여 실행하되」로, 첫째와 둘째 PR이 케이스를 「켰다」를 「실행 대상에 넣었다」로 바꿨다. 선택 봉헌을 「켜는」 뜻과 섞이지 않게 했다.
- `tools/booklet/README.md` 20행: 「`vm`에 올려」를 「`vm` 모듈에 불러와」로 바꿨다. 「from > to」는 「시작일이 끝일보다 늦거나」로 풀었다.
- `tools/booklet/README.md` 23행: 판정 목록의 「`partial` `≠` 실질 불일치」를 「`partial`과 `≠`는 실질 불일치다」로 썼다. 줄표가 맡던 이유는 「되기 때문이다」로 밝혔다.
- `tools/booklet/README.md` 25행: 「이름 · 이동 표기 · 색 표는 보조다」를 「이름, 옮김 표기, 색 표는 보조다」로 바꿨다. 책자가 축일을 다른 날로 옮긴 것을 적는 표기로 보고 「용어」 표의 「이동」 줄을 따랐다.
- `tools/csp/README.md` 3행: 「(서버 헤더 없음 — …)」를 「(서버 헤더로는 주지 않는다. …)」로, 기능 목록 끝의 「데스크톱과 휴대폰」을 「데스크톱과 휴대폰 두 화면에서」로 문장에 넣었다. 「브라우저로 돌고 … 떠나며」는 「차례로 열어 보고 … 떠난다」로 바꿨다.
- `tools/csp/README.md` 11행: 종료 코드 `2`의 「셀렉터가 바뀌었거나 데이터가 없다 — 점검 범위가 덜 찼다」를 「선택자가 바뀌었거나 데이터가 없어 점검 범위가 줄었다」로 바꿨다.

## 요약

문장 교정 진행 목록 2절(루트 문서와 `docs/`의 나머지)에 남은 파일 가운데 네 개를 고쳤다. `docs/writing.md`와 `tests/README.md`는 열린 PR #451이 바꾸고 있어 건너뛰었다.

| 파일 | 한글 줄 | 기계 검사(`particle`, `tilde`, `term`) 전 → 후 | 기계 검사 전체 전 → 후 |
| --- | --- | --- | --- |
| `tests/fixtures/liturgical/README.md` | 54 | 69 → 0 | 213 → 18 |
| `tools/booklet/README.md` | 12 | 13 → 0 | 61 → 0 |
| `tools/csp/README.md` | 5 | 0 → 0 | 23 → 1 |
| `tools/prose/README.md` | 36 | 0 → 0 | 0 → 0 |

- 기계 검사 밖에서 고친 곳은 약 30곳이다. 실행을 「돌다」, 「뜨다」, 「켜다」로 쓴 곳, 「여기로 간다」, 「잡히지 않는다」 같은 비유 동사, 술어가 빠진 명사 나열, 역따옴표 없이 쓴 코드 이름(`pypdf`, `vm`, `AssertionError`, `parseDate`)이 그렇다.
- `tools/prose/README.md`는 처음부터 끝까지 읽었으나 고칠 곳이 없었다.
- 남긴 판단 항목: `tests/fixtures/liturgical/README.md`의 `english?` 17건은 모두 「id」다. `docs/writing.md` 「용어」 표도 「전례일 id」로 쓴다, `dash?` 1건은 표의 빈 칸 표시(—)다. `tools/csp/README.md`의 `term?` 1건은 「페이지를 떠난다」라 「용어」 표의 옮김 계산 용어와 상관없다.
- 제목 줄 3개의 줄표를 쌍점으로 바꿨다(`docs/writing.md` §37). `tests/fixtures/liturgical/README.md`는 「tests/fixtures/liturgical: 교회력 엔진 기대값 픽스처」, `tools/csp/README.md`는 「tools/csp: CSP 위반 점검」, `tools/booklet/README.md`는 「tools/booklet: 「전례독서」 책자와 엔진 대조」다. 세 제목으로 오는 링크 앵커와 제목 인용은 저장소에 없었다. `tools/csp/csp_sweep.py`의 도움말 문자열과 `tools/booklet/compare.py`의 보고서 제목 문자열은 코드라 그대로 두었다.

## 검증

- `python3 tools/prose/prose.py same-code origin/main`: 주석과 문서 말고 바뀐 파일 0개.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`: 31개 가운데 통과 30, 실패 0, 건너뜀 1(데이터 서브모듈이 없어 `facts` 블록 검사).
- `python3 scripts/docs_facts_snapshot.py --diff origin/main WORKTREE --strict-counts`: 사라진 토큰 0, 줄어든 토큰 0.
- 같은 명령에 묶음 문서 네 개를 `--docs`로 주고 `--kinds general`: 사라진 토큰 0, 줄어든 토큰 0. 새 토큰 3개는 역따옴표로 새로 묶은 코드 이름이다.
- `python3 tools/prose/prose.py lint <묶음 파일 4개>`: `particle`, `tilde`, `term` 0.

## 갱신한 문서

- `tools/prose/progress.md`: 묶음 파일 네 개의 상태.
