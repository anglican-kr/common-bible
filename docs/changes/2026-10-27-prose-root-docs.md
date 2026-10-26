---
date: 2026-10-27
branch: docs/prose-root-docs
title: "docs: 문장 교정(루트 문서와 docs 대장)"
---

## 먼저 보실 곳

뜻이 달라질 수 있는 고침이다. 숫자, 날짜, 인용, 코드 표기는 바꾸지 않았다(아래 「검증」의 사실 토큰 비교). 줄 번호는 지금 파일의 줄이다.

- `CLAUDE.md` 3행: 「Phase 1 성경 읽기 → 2 기도서 → 3 교회력 → 4 성무일과」를 「Phase 1 성경 읽기, 2 기도서, 3 교회력, 4 성무일과의 차례로」로 바꿨다.
- `CLAUDE.md` 28행: 표의 「디자인의 권위」를 「디자인의 기준」으로 바꿨다. authority를 직역한 말로 보았다.
- `CLAUDE.md` 34, 35행: 굵은 머리 「**읽기 — 작업을 시작할 때.**」를 「**읽기(작업을 시작할 때).**」로 바꿨다. 「쓰기」도 같다.
- `CLAUDE.md` 86행: 필수 검사를 통과한 「head」를 「마지막 커밋」으로, 「(#354 · data#33에서 실측)」을 「(#354와 data#33에서 실제로 확인했다)」로 바꿨다.
- `CLAUDE.md` 123행: 릴리스 순서의 화살표를 「`release.py patch`를 실행하면 push, 태그, GitHub Release까지 이어진다. 그다음 `deploy.sh dev`와 `deploy.sh promote`를 차례로 실행한다」로 풀었다.
- `README.md` 132행: iOS ITP가 지우는 「storage」를 「저장 공간」으로 바꿨다. 「저장소」는 git 저장소와 섞여 쓰지 않았다.
- `README.md` 152행: BFF를 두는 까닭(「RFC 7636 일탈 + secret scanner 자동 무효화 위험을 회피하기 위함」)을 두 문장으로 풀었다.
- `README.md` 155, 156행: 「무한 리디렉션 cap」을 「무한 리디렉션 상한」으로, 「만성 401 cap」을 「반복되는 401의 상한」으로 바꿨다(「용어」 표).
- `README.md` 157행: 「state-based + flag-based + 매 async await 직후 재검사」를 「상태 기준 검사, 표지 기준 검사, 비동기 `await` 직후마다 다시 하는 검사」로 풀었다.
- `known-issues.md` 12행: 「옛 headless chromium 버전 아티팩트」를 「옛 헤드리스 chromium 버전 때문에 생긴 실패」로 바꿨다.
- `known-issues.md` 37행(`bookmark.js` 분할): 닫히지 않던 굵은 표시(`**`)를 없애고, 「캐스케이드 수학」을 「하위 항목까지 번지는 선택 계산」으로, 「트리렌더↔select 양방향은 import+주입으로 차단」을 「서로 호출하던 순환은 … import하고 … 주입해서 끊었다」로 풀었다. 「registry」는 「등록부(registry)」로 썼다.
- `known-issues.md` 46행: 「`readingContext`는 stale」을 「현재 장이 아닌 값이 남는다」로, 「다운스트림 리스크」를 「같은 코드가 영향을 받을 위험」으로 바꿨다.
- `known-issues.md` 120행: 「계산 범위 판정 하나로 · 날짜 이동 줄 하나로」를 「판정을 하나로 모으기, … 줄을 하나로 모으기」로, 「네 걸음」을 「네 단계」로 바꿨다.
- `docs/index.md` 28행: 「번호는 당기지 않는다」를 「번호를 다시 매기지 않는다」로 바꿨다.
- `docs/index.md` 37행: `archive/`의 「완료·점-시점 기록」을 「완료된 기록과 특정 시점의 기록」으로 바꿨다.
- `docs/changes/README.md` 52행: 「PR diff에 새 원장 파일이 있는지」를 「PR이 바꾼 파일에 새 원장 파일이 있는지」로 바꿨다.
- `workflow.md` 43, 47행: 「클론마다 다시 걸어야 한다」를 「다시 설정해야 한다」로, 「pypdf 추출, … 엔진 덤프」를 「pypdf로 본문을 추출하는 코드, … 엔진 결과를 파일로 내는 코드」로 풀었다.
- `security-audit.md` 24, 27행: 「플래그」를 「지적」으로, 「authorization code flow 사용 시 … state 파라미터 존재 여부」를 「인가 코드 방식(authorization code flow)을 쓸 때 CSRF를 막는 `state` 파라미터가 있는지 확인」으로 바꿨다.

## 결정 대기

정해야 할 낱말이라 고치지 않고 두었다. 권장안은 교정한 에이전트와 검토한 Claude의 의견이다.

- **「frontmatter」**(`docs/changes/README.md` 5, 9, 50, 52행 등): 후보는 「머리말」, 「메타데이터」, 그대로다. 권장은 「머리말」인데, `CLAUDE.md` 90행은 이번에 「맨 위의 메타데이터(frontmatter)」로 바꿨으니 함께 정한다.
- **「slug」**(`docs/changes/README.md` 11행의 굵은 머리): 권장은 코드 표기 `<slug>`는 두고 머리만 「파일 이름의 `<slug>`에는」으로 바꾸는 것이다.
- **「기준 브랜치(base)」**(`docs/changes/README.md` 56행): 이번에 임시로 정한 말이다. 후보는 「대상 브랜치」, 「`main`」이다.
- **「원장 게이트」, 「원장 게이트 훅」**(`workflow.md` 58, 66행): 권장은 「원장 검사」, 「원장 검사 훅」이다. 다른 문서도 쓰는 이름이라 함께 정한다.
- **「annotated」, 「lightweight」 태그**(`workflow.md` 32행): 권장은 「annotated 태그」, 「lightweight 태그」다.
- **심각도 이름 「Critical」, 「High」, 「Medium」, 「Info」**(`security-audit.md` 81-103행): 감사 보고서의 출력 문구라 그대로 두기를 권한다.
- **「이터레이션」**(`security-audit.md` 91행): 권장은 「개발 주기」다.
- **「클라이언트 사이드」**(`security-audit.md` 54행): 후보는 「클라이언트 쪽」이다.
- **「registerView dispatch 역전」**(`known-issues.md` 35행): 권장은 「`registerView` 호출 방식 역전」이다. ADR-034와 `topics/platform.md`의 표기를 함께 본다.
- **「facade」**(`known-issues.md` 여러 곳): 권장은 그대로다.
- **「공유 켬 표지」**(`README.md` 150행): 뜻이 흐리다. `js/sync/`에서 그 표지(`bible-drive-sync`)가 무엇인지 보고 정한다.
- **「squash」, 「rebase」, 「force push」, 「History API」, 「GitHub Release」**(`CLAUDE.md`): 권장은 그대로다. 명령과 기능의 이름이다.
- **제목 줄의 낱말**: `docs/index.md` 1행의 줄표와 25행 「페이지 한 줄 훅」, `README.md` 47, 135행의 가운뎃점과 63행 「이중 hop」, 87행 「브랜치 switch 시」, `known-issues.md` 10행 「전수 진단·해소」와 41행의 화살표, `workflow.md` 17, 26, 105행의 줄표, `security-audit.md`의 「Service Worker 보안」, 「Content Security Policy (CSP)」. 제목을 고치려면 그 제목을 가리키는 곳도 함께 바꿔야 한다.
- **「해소됨 (날짜) — 본문을 지웠다.」**(`known-issues.md` 81, 108, 114행 등): 항목 머리의 형식으로 보고 줄표를 두었다.

## 요약

문장 교정 반복 실행의 둘째 묶음이다. 진행 목록 「2. 루트 문서와 `docs/`의 나머지」에서 `.claude/commands/security-audit.md`, `CLAUDE.md`, `README.md`, `docs/changes/README.md`, `docs/index.md`, `docs/known-issues.md`, `docs/workflow.md` 일곱 개(한글 줄 444줄)를 골랐다. `DESIGN.md`(453줄)는 혼자 한 묶음이 되므로 다음으로 넘겼다. 파일마다 Sonnet 서브에이전트로 교정하고, 바뀐 내용을 Claude가 다시 읽어 고쳤다. 193줄이 바뀌었다.

- **기계 검사의 전후**(7개 파일): `particle` 47에서 1, `term` 4에서 0, `particle?` 9에서 1, `term?` 4에서 3, `verb?` 6에서 3, `english?` 125에서 100, `arrow?` 14에서 3, `dot?` 174에서 14, `dash?` 69에서 7. `tilde`는 처음부터 0이었다.
  - 남은 `particle` 하나는 `workflow.md` 85행의 사용자 말 인용(「"PR 에 기록하는 게…"」)이라 그대로 두었다.
  - 남은 `?` 항목은 바른 쓰임(코드와 제품 이름, 화면 문구, 제목, 북마크의 「이동」 동작)이거나 「결정 대기」에 적은 것이다.
- **검토하며 다시 고친 곳은 15곳이다.**
  - 코드 표기를 나눈 곳을 되돌렸다. `helpers.js headerIcon`, `helpers.js createFocusMemory`, `readingContext.bookId/chapter`를 원래 표기로 되돌렸다.
  - 「사용자 결정(2026-10-18, …)」의 표기, 「1회」, 「3회」, 「12건」 뒤의 표기를 사실 토큰 비교가 그대로 읽게 되돌렸다.
  - `README.md`에서 ITP가 지우는 「storage」를 「저장소」로 옮긴 세 곳은 「저장 공간」으로, 「이 둘을 막으려는 것이다」는 「이 두 문제를 피하려는 것이다」로 고쳤다.
  - `CLAUDE.md` 3행에서 「Phase」를 네 번 되풀이한 것, `docs/index.md`에서 굵은 표시가 「ADR 인덱스」에서 「부록 A」로 옮겨 간 것, `known-issues.md`에서 「따로」를 더한 것과 남은 가운뎃점을 고쳤다.

## 검증

- `python3 tools/prose/prose.py same-code origin/main`: 바뀐 파일 7개, 주석과 문서 말고 바뀐 파일 0개.
- 문서 검사(`node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`): 31개 가운데 30개 통과, 1개는 데이터 서브모듈이 없어 건너뛰었다.
- 교회력 사실 토큰 비교(`python3 scripts/docs_facts_snapshot.py --diff origin/main WORKTREE --strict-counts`): 사라진 토큰과 줄어든 토큰 0.
- 일반 토큰 비교(일곱 파일을 `--docs`로 주고 `--kinds general --strict-counts`): 사라진 토큰과 줄어든 토큰 0.
- `python3 tools/prose/prose.py lint <일곱 파일>`: `tilde`, `term` 0, `particle` 1(위 인용).
- JS 파일을 고치지 않아 타입 검사와 유닛 전체는 돌리지 않았다.

## 갱신한 문서

- 없음 — 문장만 고쳤다
