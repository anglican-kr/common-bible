# 공동번역성서 PWA

대한성공회를 위한 공동번역성서 PWA다. 장기적으로 성공회 교회력, 성무일과, 기도서까지 담는 전례 앱으로 넓힌다(Phase 1 성경 읽기 → 2 기도서 → 3 교회력 → 4 성무일과, `docs/architecture.md` §11). 프레임워크 없이 Vanilla JS로 만든 SPA이고, 브라우저가 장별 JSON을 직접 읽어 그리며, 서비스 워커로 오프라인에서도 돈다(ADR-001).

## 저장소 (ADR-020)

| 저장소                                 | 가시성 | 역할                                                               |
| -------------------------------------- | ------ | ------------------------------------------------------------------ |
| `anglican-kr/common-bible` (본 저장소) | 공개   | PWA 프론트엔드 · sw.js · JS 유닛/e2e · 릴리스 스크립트             |
| `anglican-kr/common-bible-data`        | 비공개 | 마크다운 원본 + Python 파이프라인 + 빌드 출력 + 데이터 검증 테스트 |
| `anglican-kr/common-bible-audio`       | 비공개 | 장별 mp3 (Git LFS)                                                 |
| `anglican-kr/common-bible-server`      | 비공개 | nginx 설정(BFF·보안 헤더) + 배포 스크립트                          |

- 본 저장소의 `data/`에 data 저장소가, 그 안의 `audio/`에 audio 저장소가 서브모듈로 붙는다. clone은 `git clone --recurse-submodules`, 이미 받았으면 `git submodule update --init --recursive`. 서브모듈 운영은 README 「git 서브모듈 운영」.
- 본 저장소는 공개다. 비밀값과 서버의 약점은 server 저장소에만 적는다.

## 문서

작업을 시작하면 [`docs/index.md`](docs/index.md)를 읽고, 맞는 주제 문서(`docs/topics/`)를 코드보다 먼저 연다. 주제 문서에 그 주제의 지금 동작, 결정, 함정, 남은 일이 모여 있다.

| 무엇 | 어디 |
| --- | --- |
| 모듈 지도, 영속 데이터, 보안 모델, ADR 인덱스, 파일 빠른 참조 | `docs/architecture.md`(§4 · §5 · §9, 부록 A · B) |
| 디렉터리 구조, 데이터 파이프라인 그림 | `README.md` |
| 테스트 규약(명명, 실데이터 · 문서 검사의 예외, e2e 준비) | `tests/README.md` |
| 문체와 용어, 릴리스 노트의 문체 | `docs/writing.md` |
| 커밋 · PR · 리뷰 · 릴리스의 세부, 스크립트 · 도구 · 훅 · CI | `docs/workflow.md` |
| 디자인의 권위 | `DESIGN.md` |

## 지식 베이스 루프

`docs/`는 작업을 거듭할수록 쌓이는 지식 베이스다. 원자료(`docs/changes/` 변경 원장)와 정리 층(주제 문서, ADR, `known-issues.md`와 `coding-pitfalls.md`의 번호 대장, `writing.md`, `workflow.md`, `index.md`)으로 나뉜다.

1. **읽기 — 작업을 시작할 때.** index.md에서 주제 문서로 간다. 구현하거나 결정을 바꾸기 전에는 주제 문서의 「결정」이 가리키는 ADR을 확인한다(아래 「ADR 워크플로우」 1). 같은 곳을 건드린 이전 변경은 `git log --format='%h %s' -- <파일>`이나 `grep -ril <키워드> docs/changes/`로 찾는다. 사용자가 이미 확정한 사실을 다시 묻거나 뒤집지 않으려는 단계다.
2. **쓰기 — PR을 열기 직전.** 원장 하나를 쓰고(요약, 확정 · 근거, 검증, 갱신한 문서; 형식은 `docs/changes/README.md`), 그 파일을 쓰면서 정리 층(주제 문서의 지금 동작, 확정 사실, 함정, 남은 일과 ADR, 번호 대장, `writing.md`, `workflow.md`, index.md) 가운데 갱신할 것이 있는지 판단해 같은 PR에 넣는다. 사용자 교정과 도메인 확정은 PR을 기다리지 말고 **그 자리에서** 적는다. 정리 층에는 규칙과 날짜만 짧게 쓴다. 원장에는 무엇을 왜 바꿨는지 적되, 사용자의 말은 그대로 옮기지 않고 뜻을 요약한다. 다른 문서나 git에서 볼 수 있는 것은 다시 적지 않는다(2026-10-24). 한 주제면 그 주제 문서, 여럿이면 `coding-pitfalls.md`, 글쓰기는 `writing.md`, 작업 방식은 `workflow.md`다(`docs/topics/README.md`). `pre-pr-ledger.sh`와 CI `Change ledger`가 원장 없는 PR을 막고, 머지된 원장의 수정은 `pre-commit-ledger.sh`와 같은 CI가 막는다.
3. **검사와 정리.** `tests/unit/docs-*.test.js`가 번호 대장, 경로, 링크, 주제 문서의 틀, 코드 파일의 소유를 CI에서 본다. 릴리스마다 마지막 정리 이후의 원장을 훑어, index.md가 실제 파일과 맞는지, 완료된 `design/` 문서를 `archive/`로 옮겼는지, 정리 층끼리 모순이 없는지, 200줄을 넘긴 문서를 나눌지 본다. 쌓이기만 하는 문서는 읽히지 않는다.

## ADR 워크플로우

1. **구현 전**: 관련 ADR(`docs/decisions/`, 주제 문서의 「결정」이 가리킨다)을 먼저 확인한다. 기존 결정(채택 이유, 검토한 대안, 데이터 스키마, UI 컴포넌트)과 충돌하지 않게 맥락을 파악한다.
2. **구현 후**: 구현이 ADR과 달라졌으면 ADR을 갱신한다.
   - 새로운 결정이면 새 ADR 파일을 만든다(`NNN-이름.md`, 다음 번호).
   - 기존 결정이 바뀌면 본문을 현재 결론으로 제자리 갱신하고, 버린 선택지는 「검토한 대안」에 날짜 · 이유 · 재검토 조건과 함께 남긴다. 개정 블록 · 취소선 · 「해소/재개/정정」 꼬리표는 쓰지 않는다. 시점 이력은 git과 원장이 맡는다(2026-10-10, 설계서 `docs/design/liturgical-engine.md` §1.4). ADR-001-035의 옛 개정 블록에는 이 규칙을 거슬러 적용하지 않고, 그 파일을 손댈 때 따른다.
3. **구현 PR을 머지할 때**: ADR 상단 `상태` 필드와 주제 문서의 「지금 동작」을 함께 갱신한다. ADR 상태는 `승인됨 — 구현 대기` → `승인됨 — 구현 완료`다(날짜를 함께 적기를 권한다). 새 ADR을 채택했으면 `docs/architecture.md` 부록 A의 ADR 인덱스에 한 줄을 더한다.

데이터 도메인 ADR(002 · 003 · 006)은 `common-bible-data` 저장소로 옮겨 갔다(2026-05-12). 앱 저장소의 `docs/decisions/`에는 옮긴 곳을 알리는 짧은 문서만 남아 있다.

## 컨벤션

자세한 사례와 용어 목록은 `docs/writing.md`에 있다.

- 문서는 한국어로 쓴다. 한국어 문장은 완결된 형태로, 간결하게, 그 분야의 용어로 쓴다. 명사를 가운뎃점(·)과 줄표(—)로 이어 붙이지 않고, 용어를 긴 설명으로 풀지도 않는다. 사용자 교정 2026-10-21, pitfalls §37
- 영어 · 한국어가 섞인 문장: 영어 단어 뒤의 조사 · 용언은 붙여 쓴다(「`sync.json`을」, 「push되면」). 뒤가 명사면 띄운다(「HTTP 실패」). 사용자 교정 2026-10-17, pitfalls §31
- 숫자 구간은 물결표(~) 대신 하이픈으로 쓴다(「44-50」, 「ADR 001-038」). GitHub 마크다운이 물결표 쌍을 취소선으로 읽는다. 날짜 구간은 「2026-05-10부터 10-17까지」. 사용자 교정 2026-10-17, pitfalls §32
- 「꼴」을 쓰지 않는다. 한 낱말이 표기 · 형식 · 구조 · 경우를 함께 맡아 읽기 어렵다. 그 자리의 뜻을 쓴다(문자열을 적는 방식은 「표기」, 값의 모양은 「형식」, 저장소의 모양은 「저장 구조」, 예는 「경우」). 사용자 교정 2026-10-20, pitfalls §36
- 문서는 Claude와 사용자가 함께 읽는다. 사용자는 개발을 전문으로 하지 않는다. 코드 이름과 줄 번호 앞에 그 코드가 무엇을 하는지 먼저 쓰고, 결과는 사용자가 겪는 일로 쓴다. 영어 단어나 기술 용어를 술어처럼 쓰지 않는다. 술어는 한국어로 쓰고 영어 이름은 괄호에 넣는다. 사용자 교정 2026-10-23, pitfalls §40
- 직역과 낯선 번역어를 쓰지 않는다(「살아있는 문서」, 「발화」, 「저본」 등). 목록은 `docs/writing.md` 「용어」.
- 코드 주석은 영어 · 한국어 모두 허용한다. 언어는 규칙이 아니라 내용이 정한다.
  - 코드가 왜 그렇게 도는지(경계 · 자료구조 · 성능)는 **영어**가 자연스럽다. 주변 식별자와 같은 어휘를 쓴다.
  - 도메인의 **근거와 결정 이력**은 **한국어**로 적는다. 전례 용어가 한국어고, 기도서 · 사용자 확인 날짜를 남기는 자리라 문서 언어를 따라야 읽힌다.
  - 규칙에 맞추려고 번역하지 않는다. 번역하면 근거가 흐려진다.
- 접근성은 WCAG 2.1 AA를 지킨다.

## 커밋 메시지 규칙

타입은 영어, 내용은 한국어의 짧은 문구로 쓴다. 예: `feat: 장 내비게이션 드롭다운 구현`. 무엇을 바꿨는지로 쓰고 휘발성 맥락(「리뷰 반영」)은 넣지 않는다(`docs/workflow.md` 「커밋과 PR」).

| 타입       | 언제                               |
| ---------- | ---------------------------------- |
| `feat`     | 새 기능 추가                       |
| `fix`      | 버그 수정                          |
| `docs`     | 문서만 변경 (원장, ADR 등)         |
| `chore`    | 빌드, 설정, 파일 정리 등           |
| `data`     | 데이터 서브모듈 포인터 bump        |
| `style`    | CSS, UI 스타일만 변경              |
| `refactor` | 기능 변경 없이 코드 구조 개선      |

본문 데이터 변경 자체는 `common-bible-data` 저장소에서 `data:` 커밋. 앱 저장소에서는 서브모듈 포인터 bump를 `data:` 또는 `chore:`로 기록.

## 브랜치 보호 / 작업 흐름

`main`은 보호 브랜치다(2026-05-29 적용). 모든 변경은 토픽 브랜치 → PR → 머지 흐름을 따른다.

- **직접 push 금지.** 관리자(저장소 소유자)를 포함해 누구도 검사를 거치지 않은 커밋을 `main`에 push할 수 없다(`enforce_admins: true`). PR에서 필수 검사를 통과한 head를 그대로 FF push하는 것은 받아들여지지만(#354 · data#33에서 실측) 사용자가 따로 말할 때만 쓴다. `main`에 직접 커밋해 push하면 `protected branch hook declined`로 거부된다. 핫픽스도 짧은 브랜치와 PR로 한다.
- **PR 필수.** 필수 검사 `Unit tests`(유닛 `node --test tests/unit/*.test.js` + 타입 검사 `npm run typecheck`)와 `Change ledger`(원장)를 통과해야 머지된다. 승인자 수는 0이라 본인 PR을 머지할 수 있다. **머지는 CI가 통과해도 사용자에게 묻고 한다.**
- **머지 방법은 squash다**(사용자 결정 2026-10-17 — 「이제부터는 브랜치를 따서 작업한 건 스쿼시 머지를 하기로 하자」). 저장소 설정이 squash 커밋의 제목을 PR 제목으로(커밋이 하나면 그 커밋 제목), 본문을 커밋 메시지 목록으로 만들고 머지된 브랜치를 지운다. 머지 커밋은 저장소 설정이 막는다. rebase 머지는 쓰지 않는다. GitHub가 SHA를 새로 쓰고 서명을 벗긴다.
- **force push와 브랜치 삭제는 금지다.** PR 리뷰 코멘트가 미해결이면 머지가 막힌다.
- PR 제목은 짧은 문구로 쓰고, PR 본문에는 frontmatter와 제목을 넣지 않는다(pitfalls §30).

작업 표준 흐름:

```bash
git checkout -b <topic-branch>
# 작업 + 커밋
# 원장 작성: docs/changes/<YYYY-MM-DD>-<slug>.md (형식은 docs/changes/README.md) + 커밋
git push -u origin <topic-branch>
gh pr create --title "..." --body-file docs/changes/<YYYY-MM-DD>-<slug>.md   # 제목은 짧은 문구(pitfalls §30)
# 훅이 원장에 pr: N 을 적어 준다 → 커밋·push
bash scripts/pr_body.sh docs/changes/<YYYY-MM-DD>-<slug>.md | gh api -X PATCH repos/anglican-kr/common-bible/pulls/<N> -F body=@-   # 본문에서 frontmatter를 뺀다
# CI(Unit tests + Change ledger) 통과 · 사용자 확인 후 squash — 제목은 PR 제목 + 번호(REST)
gh api -X PUT repos/anglican-kr/common-bible/pulls/<N>/merge -f merge_method=squash -f commit_title="<PR 제목> (#<N>)" \
  -f commit_message="$(git log --reverse --format='* %s%n%n%b' main..<topic-branch> | cat -s)"   # 커밋 목록만 넘긴다 — GitHub 기본 메시지는 맨 끝에 Co-authored-by 줄을 한 번 더 붙인다
git switch main && git pull --ff-only
git diff <topic-branch> main --stat -- $(git diff --name-only main...<topic-branch>)   # PR이 바꾼 파일만 — 비었으면 squash가 다 담았다(그사이 main에 들어온 데이터 자동 PR은 보지 않는다)
git branch -D <topic-branch>   # squash 커밋은 브랜치 커밋과 이어지지 않는다 — -d는 원격 브랜치가 정리됐으면 거절하고, 남아 있으면 경고만 낸다
```

## 테스트

- **유닛**(ADR-013, CI 자동): `node --test tests/unit/*.test.js`(CI와 같다), 한 파일은 `node --test tests/unit/<소스 basename>.test.js`. 한 모듈에 테스트 파일 하나이고, 실데이터 의존 케이스와 문서 검사의 예외는 `tests/README.md` §1. 타입 검사는 `npm run typecheck`.
- **e2e**(Playwright, 로컬 전용): `python3 scripts/serve.py 8080`을 띄우고 `pytest tests/e2e/ -v`. `python -m http.server`는 `/gen/1` 같은 History API 경로를 404로 돌려주고 강제 새로고침도 깨지므로 쓰지 않는다. 처음 한 번 `pip install pytest-playwright`, `playwright install chromium`. 기능을 구현한 뒤에는 유닛과 e2e를 모두 돌려 보고한다.
- **데이터 파이프라인**(Level 1-3, ADR-004): data 저장소의 `validate.yml`이 push 때 돌린다. 로컬은 `cd data && pytest tests/`.

## 데이터 수정과 릴리스

마크다운 원본, Python 파이프라인, 데이터 검증 테스트는 `common-bible-data` 저장소에 있고, 본 저장소는 서브모듈 포인터로 잠근 빌드 산출물을 그대로 쓴다. 배포와 nginx 설정은 `common-bible-server` 저장소에 있다.

1. data 저장소에서 `source/*.md`를 고치고 PR로 main에 머지한다.
2. main의 `build.yml`이 파이프라인과 매니페스트를 다시 만들고, 같은 실행 안에서 산출물을 검증(ADR-004)한 뒤 자동으로 커밋한다.
3. 앱 저장소의 `sync-data.yml`이 서브모듈 포인터와 `sitemap.xml`을 자동으로 올린다(버전 bump 없음).
4. 사용자가 정한 때 `python scripts/release.py patch` → push + tag + GitHub Release → `deploy.sh dev` → `deploy.sh promote`(태그와 릴리스 노트의 규칙은 `docs/workflow.md` 「릴리스」).
