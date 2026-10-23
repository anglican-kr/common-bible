# 작업 방식 — 기록, PR, 리뷰, 릴리스

매 세션 지킬 규칙(커밋 메시지, 브랜치와 PR 흐름, ADR 워크플로우, 지식 베이스 루프)은 CLAUDE.md에 있다. 여기에는 그 규칙의 사례와 세부, 자주 쓰지 않는 절차, 도구와 훅의 설명을 둔다.

## 커밋과 PR

- 커밋 제목에 휘발성 맥락(「Bugbot 지적 반영」, 「N차 수정」, 「리뷰 코멘트 반영」)을 넣지 않는다. 그 커밋이 무엇을 바꿨는지로 쓴다. 지적의 출처는 본문에 적는다.
- 진행 중인 작업이 GitHub 이슈와 이어져 있으면 커밋 제목 끝에 `(#NNN)`을 붙인다. 다른 저장소의 이슈는 `anglican-kr/common-bible#134`처럼 쓴다. 이슈를 닫는 `Closes #134`는 본문에 따로 적는다.
- GitHub 작업은 REST(`gh api repos/...`)로 한다. GraphQL을 쓰는 `gh pr edit`가 projectCards 오류를 냈다(2026-07-06 PR #301, 사용자 지시). PR 생성 명령은 원장 훅이 검사하는 표준 절차라 그대로 쓰고, 오류가 나면 REST로 바꾼다.
- 필수 검사가 「Expected」로 멈춰 머지가 막히면, CI를 다시 돌리기 전에 PR이 main과 충돌하는지 본다. 충돌이면 GitHub가 머지 ref(`refs/pull/<N>/merge`)를 만들지 못해 워크플로가 아예 돌지 않는다. `gh api repos/anglican-kr/common-bible/pulls/<N> --jq .mergeable_state`가 `dirty`이거나 head에 `github-actions` check-suite가 없으면 이 경우다. 해법은 충돌을 푸는 것이다. 예전에는 `git rebase origin/main` 뒤 force push로 풀었는데, force push는 CLAUDE.md가 금지하므로 실행 전에 사용자에게 묻는다. squash 머지라면 `git merge origin/main`으로 풀어도 결과는 같다.

## 리뷰

- 리뷰를 반영한 뒤 다시 볼 때는 범위를 고친 커밋으로 좁히고(예: `6af65c2..949b160`), 확실한 것만 보며, 재현이 있는 것만 지적으로 받는다. 고칠 것과 넘길 것의 기준, 그리고 3회차는 없다는 것을 결과를 보기 전에 정해 사용자에게 먼저 말한다. 사용자가 2026-10-18에 「수정한 결과에 버그가 또 있을 수 있겠지? … 이러다 계속 무한 루프를 돌 수도 있겠어」라고 물은 뒤 정했다.
- 리뷰는 읽기 전용 서브에이전트에게 갈래별로 맡긴다. Copilot은 크레딧이 없다(사용자 2026-10-21).
- 외부 리뷰(Copilot 등)를 요청했다면 머지 전에 제출을 기다려 결과를 확인한다. `gh api repos/anglican-kr/<저장소>/pulls/<N>/reviews`에서 `user.login == "copilot-pull-request-reviewer[bot]"`인 것만 센다. 저장소가 미해결 리뷰 코멘트가 있으면 머지를 막으므로, 고친 뒤 코멘트마다 답글을 달고 스레드를 모두 resolve한다(사용자 지시 2026-08-01).

## 릴리스

- 태그는 annotated로 만들고(`git tag -a 1.0.x -m "..."`), 이름에 `v`를 붙이지 않는다(1.0.5부터). 메시지에 그 버전의 주요 변경을 적고 `git push origin <태그>`로 올린다. 태그 1.6.4와 1.5.12는 lightweight로 만들어져 이 규칙과 어긋난다.
- 릴리스 PR(`chore: X.Y.Z 릴리스`)의 본문에는 둘을 함께 채운다. `python scripts/changelog.py <이전 태그> HEAD`의 출력을 그대로 옮긴 「변경 사항」(앱 PR과 본문 데이터 PR을 나눈 형식)과, 그것을 일상 언어로 다듬은 릴리스 노트 초안이다(`writing.md` 「릴리스 노트」). 초안은 머지 뒤 `gh release create <태그> --notes`에 그대로 쓸 수 있게 완성형으로 쓴다.
- 배포 순서는 CLAUDE.md 「데이터 수정과 릴리스」에 있다. 배포 시점은 사용자가 정한다.

## 도구와 훅

- `scripts/`
  - `release.py`: `version.json`과 `sw-version.js`를 올리고 커밋한다. `sw.js`가 `sw-version.js`를 `importScripts`로 가져와 셸 캐시 이름을 만든다(ADR-021).
  - `changelog.py`: 릴리스 노트용 변경 목록이다. 앱 git log와 data 서브모듈의 비교를 함께 보며, `--generate-notes`를 대신한다.
  - `serve.py`: History API 경로를 아는 로컬 서버다. e2e는 이 서버를 8080에 띄워 돌린다.
  - `generate_splash.py`: iOS 스플래시 이미지(ADR-007).
  - `lock_merged_ledgers.sh`: 머지된 원장을 로컬에서 읽기 전용으로 잠근다. `npm test` 앞과 PR 생성 뒤에 자동으로 돌고, 클론마다 다시 걸어야 한다.
  - `pr_body.sh`: 원장에서 frontmatter를 뺀 PR 본문을 만든다(pitfalls §30).
  - `docs_facts_snapshot.py`: 문서의 사실 토큰을 리비전 사이에서 견준다. 기본은 교회력 설계 문서 다섯과 보관 문서, 픽스처이고(`--diff main HEAD`), 다른 문서는 `--docs`와 `--kinds general`, 글자 그대로 옮긴 줄은 `--from`과 `--into`로 검증한다. 문서를 옮기거나 고쳐 쓴 PR의 「사실 변경 0」 증명에 쓴다.
- `tools/`: 개발자용 보조 도구다. 앱은 쓰지 않는다.
  - `booklet/`: 「전례독서」 책자 PDF와 엔진을 대조한다. pypdf 추출, 2027년 책자 형식의 파서, 엔진 덤프, 대조 보고서가 있다(README).
  - `csp/`: 릴리스 전에 주요 화면을 실제 브라우저로 돌며 콘솔의 CSP 위반을 모은다(README).
- CI(`.github/workflows/`)
  - `test.yml`: 필수 검사 「Unit tests」. Node 24로 `node --test tests/unit/*.test.js`와 `npm run typecheck`를 돌린다(ADR-012, 013). pull_request로 돈다.
  - `ledger.yml`: 필수 검사 「Change ledger」. PR에 새 원장이 있는지 보고, 머지된 원장의 변경을 막는다. `sync/` 자동 PR은 면제한다.
- Claude Code 훅(`.claude/hooks/`)
  - `typecheck-js.sh`: JS를 고친 뒤 tsc를 돌린다. 여러 파일을 고치는 도중의 오류 보고는 정상이니, 끝에서 `npm run typecheck`를 다시 본다.
  - `verify-on-stop.sh`: 턴을 끝낼 때 유닛 테스트를 돌린다. JS가 바뀌지 않았으면 돌지 않는다.
  - `e2e-reminder.sh`: 턴을 끝낼 때 e2e를 알린다.
  - `pre-pr-ledger.sh`, `post-pr-ledger.sh`: PR 생성 전 원장 게이트와, 생성 뒤 원장에 `pr: N` 기입.
  - `pre-commit-ledger.sh`: 머지된 원장을 고치는 커밋을 막는다.

## 작업 중 함정

- **원장 게이트 훅**은 Bash 명령 문자열 어디에든 PR 생성 명령 이름이 있으면 막는다. heredoc으로 쓰는 커밋 메시지 본문도 마찬가지다. 그 낱말이 든 글은 Write나 Edit로 쓴다. 같은 명령 안에서 원장을 커밋하고 PR을 만들면, 훅이 커밋 전에 검사하므로 막힌다. 둘을 나눠 실행한다. `gh api …/pulls` POST는 막지 않는다.
- **서버 끄기**: `pkill -f "python3 scripts/serve.py 8080"`은 자기 셸까지 끈다. `kill $(pgrep -f "^python3 scripts/serve.py 8080$")`를 쓴다. WSL에서 닫힌 포트에 `curl`을 보내면 멈추므로 `curl -m 3`을 쓴다.
- **e2e가 도는 동안 작업 트리에 쓰지 않는다.** 서버가 디스크의 파일을 그대로 내준다.
- **섞인 변경을 항목별로 커밋할 때**는 최종 파일에서 뒤 항목의 몫을 뺀 중간판을 써서 `git add`하고, 최종판으로 되돌린다.
- **유닛 하네스**: 뷰와 엔진 테스트는 마커 블록(`// ── BEGIN X ──`)을 vm 하나에 차례로 싣는다. 블록 최상위의 `const` 이름이 겹치면 재선언 오류로 로드가 깨진다.
- **문서 현행화**는 읽기 전용 에이전트에게 문서 구간별로 나눠 대조시키면 빠르다. 받은 주장은 다시 확인한 뒤 반영한다.
- **data 저장소** 작업은 별도 클론(`~/projects/common-bible-data`)에서 한다. 앱의 `data/` 서브모듈 안에서 커밋하지 않는다. 그 저장소에는 원장이 없고 main이 보호되지 않는다. 서브모듈 운영은 README 「git 서브모듈 운영」.
- **앱 `sync-data.yml`의 실패**는 대개 설계서의 사실 블록 대조 때문이다. 데이터가 문서의 실측치를 바꾸면 실패한다(2026-10-12 · 10-13 · 10-15).
- **배포 목록**: 새 데이터 디렉터리를 만들면 server 저장소의 `scripts/deploy-manifest.txt`에도 더한다. 목록에 없는 파일은 빌드가 조용히 빼고 성공한다(server#1).

## 함정

### pitfalls §17 — 기록의 원본을 저장소 밖에 두지 말 것 — 작업 방식 교정 (2026-09-20)

`docs/worklog.md` 는 main 직접 커밋 시절의 서사 기록이었는데, 2026-05-29 브랜치 보호(PR 필수) 이후 그 역할이 PR 본문으로 옮겨 가면서 4개월간 갱신되지 않았다. 그 사이 PR 본문 175건은 GitHub 에만 있어 로컬에서 흐름을 볼 수 없었고, rebase 머지는 본문을 git 에 남기지도 않는다.

**사례:**
- `docs/changes/2026-09-20-knowledge-base-loop.md` — 사용자 교정: "PR 에 기록하는 게 아니라 로컬에서 해결 가능하면 좋겠다". worklog 은퇴 + `docs/changes/` 변경 원장(변경 하나에 파일 하나) 도입, PR 본문은 `--body-file` 로 파생.

**규칙:**
- 서사·근거·검증의 원본은 저장소 안 파일이고, PR 본문·릴리스 노트는 거기서 파생한다. 반대 방향은 두지 않는다.
- 기록 습관이 무너지면 "더 열심히 쓰자" 가 아니라 역할이 어디로 옮겨 갔는지 먼저 본다. 같은 내용을 두 곳에 쓰게 하는 훅은 소음이 된다(`doc-reminder.sh` 제거 사유).
- 강제는 매 Stop 이 아니라 PR 생성 시점 1회(`pre-pr-ledger.sh`) + CI(`Change ledger`) 로 건다.

**뒤늦게 들여온 사본 삭제 (사용자 결정, 2026-10-22):** #331은 이 규칙을 세우면서 옛 PR 본문 308개와 worklog 블록 32개를 `docs/changes/`에 뒤늦게 옮겨 들였다. 2026-10-22에 사용자가 이 사본 340개를 지우기로 했다. 이 파일들에만 있는 정보는 없었고, 작업에서 읽히지 않았다. 2026-09-20 이전 PR 본문의 원본은 GitHub에만 있고, worklog는 git 이력에 있다(`git show 243bf83^:docs/worklog.md`). 위 규칙은 2026-09-20 이후의 원장에 그대로 적용한다.

### pitfalls §26 — 알려진 이슈의 절을 통째로 비울 때 — 그 자리에 노트를 남긴다 (작업 방식 교정, 2026-10-17)

`known-issues.md` 는 남은 것만 싣고 해결되면 지운다(`index.md`). 그런데 번호 붙은 절을 통째로 지우면 번호가 비고(§7 다음 §9), 머지된 원장 · 메모가 그 번호로 가리키던 곳이 아무 설명 없이 사라진다 — 머지된 원장은 고칠 수 없어 그 참조가 계속 남는다.

**사례:**
- `docs/changes/2026-10-17-known-issues-8.md` — §8(PR #348 리뷰 후속 셋)을 셋 다 고치고 절째 지웠더니, 사용자 교정: 「§8이 있던 위치에 노트를 남겨놔. 왜 지웠는지.」 → 제목에 「— 해소 (날짜)」, 본문 자리에 노트 한 단락. 해소된 절을 남겨 둔 §1 · §4와 같은 방식.

**규칙:**
- 절이 통째로 비면 제목과 번호를 두고, 본문 자리에 왜 지웠는지 · 고친 내용과 검증이 있는 원장 · 넘길 때의 기록을 적는다.
- 뒤 절의 번호를 당기지 않는다 — 머지된 원장 · 메모가 번호로 가리킨다.

### pitfalls §30 — PR 제목은 짧은 문구로 — 세부는 본문에, 본문에는 frontmatter와 제목을 넣지 않는다 (작업 방식 교정, 2026-10-17 · 10-22)

원장의 `title:`이 곧 PR 제목이다. 고친 것을 모두 담으려다 제목이 한 문단이 됐다 — 목록에서 무엇을 고친 PR 인지 한눈에 읽히지 않는다.

**사례:**
- `docs/changes/2026-10-17-sync-signout-inflight.md` — 첫 제목 「fix: 동기화 사이클 — 도중에 로그아웃하면 멈추고, 실패를 성공으로 치지 않고, 「파일도 삭제」 뒤 파일을 되살리지 않는다 (known-issues §11 · 머지 전 검토)」에 사용자 교정: 「PR 제목은 길지 않고 간결하게 작성해줘」 · 「세부 내용은 PR 본문에 채우면 되니까」. 고친 제목: 「fix: Drive 동기화 — 로그아웃 경합 · 실패 처리 · 「파일도 삭제」」. 앞선 PR(#353 등)도 제목이 길었다.
- `docs/changes/2026-10-22-cleanup-unused-records.md`(#368) — 제목 「docs: 쓰지 않는 기록을 정리한다」와, frontmatter와 `# 제목` 줄이 그대로 올라간 PR 본문을 사용자가 직접 고쳤다. 제목은 「docs: 사용하지 않는 기록 정리」. 사용자 교정: 「제목은 "문장"이 아닌 간결한 "문구"로, PR 본문에는 frontmatter 사용 금지, 제목을 다시 사용하지 않는게 좋아」. `gh pr create --body-file <원장>`이 원장 파일을 그대로 올린 탓이다.

**규칙:**
- 제목은 무엇을 고쳤는지 한 줄. 절 번호(known-issues §n) · 건수 · 「무엇이 어떻게」는 본문(「요약」 이하)에 쓴다. 커밋 제목도 같은 결로 짧게.
- 제목은 문장이 아니라 문구로 쓴다. 「…정리」 「…수정」처럼 끝내고 「…한다」로 끝내지 않는다. 커밋 제목도 같다(CLAUDE.md 「커밋 메시지 규칙」의 예).
- PR 본문에는 frontmatter와 제목 줄을 넣지 않는다. PR을 만든 직후 `scripts/pr_body.sh`의 출력으로 본문을 맞춘다. 원장에도 `# 제목` 줄을 두지 않는다. 제목은 frontmatter의 `title:` 하나다.
- 저장소 규칙은 `docs/changes/README.md` 「규칙」 첫 줄 — 원장을 쓸 때 거기서 다시 본다.
