---
date: 2026-10-23
branch: docs/writing-workflow
title: "docs: CLAUDE.md 줄이기와 작업 방식 문서"
---

## 요약

docs 재구성 시리즈의 다섯째 PR이다. 매 세션 불러오는 CLAUDE.md를 규칙만 남기고 줄였고, 글쓰기와 작업 방식의 교정과 세부를 두 문서로 모았다. Claude의 비공개 메모에만 있던 규칙과 결정도 저장소로 옮겼다.

- **`docs/writing.md`(새 문서).** pitfalls §29, §31, §32, §36, §37을 「함정」으로 글자 그대로 옮겼다. 메모에만 있던 용어 목록(살아있는 문서, 발화, 저본 등)과 릴리스 노트의 문체를 더했다.
- **`docs/workflow.md`(새 문서).** pitfalls §17, §26, §30을 「함정」으로 글자 그대로 옮겼다. 메모에만 있던 커밋, PR, 리뷰, 릴리스의 규칙을 더했다. CLAUDE.md의 「프로젝트 구조」에 있던 스크립트, 도구, CI, 훅 설명과 지난 지시문의 「겪은 함정」도 옮겼다.
- **주제 문서.** 메모에만 있던 결정 넷을 「확정 사실」에 두었다. 라우팅에는 절 번호를 화면 낭독기가 읽지 않는다는 결정을, 본문 데이터에는 바탕 본문과 인용 따옴표 위치를, 검색에는 히브리 본문 절 번호 기준을 넣었다. 모듈을 옮길 때의 tsc 사각지대는 새 번호 pitfalls §39로 플랫폼의 「함정」에 넣었다.
- **CLAUDE.md.** 19,080바이트에서 13,519바이트로 줄였다(약 29%). 프로젝트 구조는 README와 architecture.md 부록 B로, 테스트 규약은 tests/README.md로 넘겼다. 데이터 파이프라인 그림은 README에 있고, 테스트 건수처럼 자주 바뀌는 숫자는 뺐다. 그 위치는 「문서」 표가 가리킨다. 목표로 했던 절반에는 못 미쳤다. 남은 분량은 대부분 매 세션 필요한 규칙(작업 흐름 명령, 브랜치 보호, 문체 요약)이라 더 줄이지 않았다.
- **원장 게이트의 일회성 예외 삭제.** #368에서 둔 예외가 하는 일이 없어졌다. `ledger.yml`과 `pre-commit-ledger.sh`는 예외를 두기 전과 글자까지 같다.

## 확정 · 근거

- 사용자 결정(2026-10-23): 「꾸러미」를 「네임스페이스 객체」로 바꾼다. 사용자가 「여기서 꾸러미는 무슨 뜻?」이라고 물었다. 한 모듈의 함수를 이름 하나 아래 모은 객체(`window.appBookmark = { … }`)를 가리키는 말인데, 지난 세션이 ADR-012와 pitfalls §27에 들여온 낯선 말이었다. 코드 주석이 쓰는 namespace와 맞췄다. `window`를 옮긴 「창 객체」도 함께 고쳤다. `writing.md` 「용어」에 올렸다.
- **CLAUDE.md 대조.** 읽기 전용 서브에이전트가 옛 판의 항목을 하나씩 KEPT, MOVED, LOST, CHANGED로 나눴다. 고친 것은 다섯이다.
  - 실데이터 테스트를 `.data.test.js`로 나누고 `haveData` 가드를 다는 규칙이 tests/README.md §1에 없었다. 그 절로 옮겼고, 테스트 파일 안의 `// ── <영역> ──` 구역 규칙도 함께 옮겼다.
  - 「결정을 바꿀 때만 ADR을 연다」가 「구현 전에 관련 ADR을 확인한다」와 부딪쳤다. 「구현하거나 결정을 바꾸기 전에는 주제 문서의 「결정」이 가리키는 ADR을 확인한다」로 바로잡았다. index.md와 topics/README.md도 고쳤다.
  - 지식 베이스 루프의 「정리 층 가운데 갱신할 것을 판단한다」가 주제 문서만으로 좁아져 있었다. 정리 층 전체로 되돌렸다.
  - 옛 판부터 틀렸던 사실이 있었다. build.yml의 자동 커밋은 validate.yml을 다시 돌리지 않는다. build.yml이 같은 실행 안에서 산출물을 검증(pytest, ADR-004)한 뒤 커밋한다(data 저장소 `build.yml` 「Level 1-3 산출물 검증」 단계로 확인).
  - 없어진 CLAUDE.md 절을 가리키던 곳 여덟을 고쳤다. 「E2E 테스트」, 「데이터 파이프라인」, 「테스트」 예외 ①을 가리키던 architecture.md 두 곳, 교회력 주제 문서, e2e 셋, 유닛 둘의 주석이다.
- **일부러 뺀 것**(대조에서 LOST로 나왔다).
  - 유닛의 통과와 건너뜀 건수(「1364 통과 · 실데이터 1 skip(미결13)」). 자주 바뀌는 숫자다. 전체 건수는 tests/README.md에 있다.
  - 지운 메모를 가리키던 `[[project_merge_policy]]` 링크.
  - 데이터 수정 흐름의 「2026-05-23 개정」 꼬리표.
- **메모에서 CLAUDE.md로 올린 규칙.** 메모 정리(2026-10-22) 때 「CLAUDE.md와 중복」으로 지웠지만, CLAUDE.md에는 코드 주석으로만 있던 것이다.
  - 머지는 CI가 통과해도 사용자에게 묻는다.
  - 기능을 구현한 뒤에는 유닛과 e2e를 모두 돌려 보고한다.
- **새로 적은 규칙**: 본 저장소는 공개라 비밀값과 서버의 약점은 server 저장소에만 적는다. 이번 시리즈의 사용자 결정(2026-10-22, 보안 항목은 server 저장소에만)을 일반 규칙으로 적었다.
- 서브모듈 운영 함정 메모의 일곱 항목은 대부분 README 「git 서브모듈 운영」에 이미 있거나 자동화로 사라졌다. 아직 유효한 둘만 `workflow.md` 「작업 중 함정」으로 옮겼다. 앱의 `data/` 안에서 커밋하지 않는다는 것과, 배포 목록을 갱신한다는 것이다.
- 태그 1.6.4와 1.5.12가 lightweight로 만들어져 annotated 규칙과 어긋난다는 것을 확인해 `workflow.md`에 적었다(`git cat-file -t`).

## 검증

- 옮긴 pitfalls 여덟 절: `docs_facts_snapshot.py --diff main WORKTREE --kinds general --from docs/coding-pitfalls.md --into …`로 옛 줄 268줄 가운데 266줄이 그대로 옮겨졌다. 빠진 두 줄은 일부러 고친 coding-pitfalls 머리말이다. 사라진 토큰은 0이다.
- 「꾸러미」는 `writing.md` 「용어」 한 줄에만 남았다. 없어진 CLAUDE.md 절을 가리키는 곳도 머지된 원장 밖에는 없다(grep).
- diff에 비밀값 형식(`GOCSPX`, `ghp_`, `github_pat_`, 개인 키)이 없다.
- `npm test` 1365개(통과 1364, 실데이터 1 skip), `npm run typecheck` 통과. 교회력 사실 토큰 비교(기본)는 변화 0이다.

## 갱신한 문서

- 새 문서: `docs/writing.md`, `docs/workflow.md`.
- `CLAUDE.md`: 규칙만 남기고 줄였다.
- `docs/coding-pitfalls.md`: 옮긴 여덟 절의 대장 줄, §39 대장 줄, 머리말.
- `docs/topics/routing.md`, `bible-text.md`, `search.md`: 「확정 사실」. `docs/topics/platform.md`: pitfalls §39, 「네임스페이스 객체」.
- `docs/index.md`, `docs/topics/README.md`: 두 새 문서, ADR을 확인하는 때.
- `tests/README.md` §1: 실데이터 테스트 규칙, 테스트 파일의 구역 규칙.
- `docs/architecture.md`, `docs/topics/liturgical.md`, ADR-012: 없어진 CLAUDE.md 절의 참조, 「네임스페이스 객체」.
- `docs/changes/README.md`: 일회성 예외 안내 삭제.
- `tests/unit/docs-wiki.test.js`: 두 새 문서의 함정 절과 대장 줄을 알아본다.
