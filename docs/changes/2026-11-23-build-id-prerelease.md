---
pr: 637
date: 2026-11-23
branch: feat/build-id-prerelease
title: "feat: dev 설정에 빌드 식별자 보이기와 pre-release 절차"
---

## 요약

배포한 빌드에 앱 커밋과 데이터 커밋을 적고, dev.anglican.kr의 설정 맨 아래에 "공동번역성서 2.2.4-9985216 · 데이터 1de377e"로 보인다. 운영에 내기 전에 그 식별자로 GitHub pre-release를 만드는 절차를 더한다(ADR-052).

- 식별자를 적는 일은 서버 저장소가 한다(common-bible-server#6). `build-deploy.sh`가 zip에 넣는 `version.json` 사본에 `app_commit`과 `data_commit`을 더하고, `deploy.sh`가 배포 뒤 검증에서 두 값을 비교한다.
- 이 PR은 앱이 그 값을 읽어 보이는 일과, 결정(ADR-052)과 릴리스 절차의 문서를 맡는다.
- 설정 화면을 버전보다 먼저 그리면 버전 줄이 비어 있던 문제도 고쳤다(아래 "확정 · 근거").

## 확정 · 근거

- 사용자가 버전 뒤에 짧은 커밋 해시를 달고, 운영에 내기 전에 pre-release로 미리 올리기로 했다(2026-11-23). 같은 버전을 dev에 여러 번 올리면 구분이 안 되기 때문이다. 커밋은 자기 해시를 담을 수 없으므로, 해시는 배포할 때 zip의 사본에만 적는다.
- 사용자가 데이터 변경도 따로 적기로 했다(2026-11-23). 앱과 데이터를 따로 배포하는 일은 나중에 검토한다. ADR-052 §5에 이미 나뉜 것과 아직 묶인 것을 적었다.
- 사용자가 네 가지를 권장안대로 골랐다(2026-11-23).
  - 앱 커밋은 HEAD가 아니라 배포하는 앱 파일을 마지막으로 바꾼 커밋이다.
  - 해시는 dev에만 보인다.
  - pre-release 태그 이름은 `X.Y.Z-<앱 커밋>`이다.
  - 화면 문구에는 권장을 표시하지 않았다. 태그 이름과 모양이 같은 "공동번역성서 2.2.4-9985216 · 데이터 1de377e"를 골랐다. 다른 문구를 원하면 리뷰에서 정한다.
- 사용자가 ADR-052 초안의 "견준다"를 "비교한다"로 고쳤다(2026-11-23). 이 PR에서 새로 쓴 글은 "비교한다"를 쓴다. 기존 문서의 "견준다"는 바꾸지 않았다.
- **설정 화면의 버전 줄이 비던 문제.** 앱을 설정 화면에서 열거나 새로 고치면 `loadVersion()`이 끝나기 전에 설정이 그려진다. 그러면 버전 줄이 "공동번역성서"만 남고 다시 그려지지 않았다. 새 e2e가 이 문제를 찾아냈다. dev 배포 뒤 설정 화면에서 새로 고쳐 빌드를 확인하는 일이 이 기능의 쓰임이라 같은 PR에서 고쳤다. 이제 버전이 도착하면 그 줄을 채운다.
- 일부러 바꾸지 않은 것:
  - 업데이트 알림의 버전과 링크: 운영에서만 의미가 있고, 운영은 정식 태그다.
  - `sw-version.js`와 `release.py`: 해시를 넣으면 데이터만 낸 운영 배포에도 업데이트 알림이 뜬다(ADR-021 §4).
  - 서버의 빌드 디렉터리 이름과 promote의 확인: promote는 dev에서 확인한 HEAD가 main인지 보아야 하므로 HEAD를 그대로 쓴다.
- `tests/README.md`의 머리 총계(유닛 39파일 1676건, e2e 33파일 619건)는 이 PR 전에 이미 실제와 달랐다. 이번에 손댄 행과 함께 실제 값으로 고쳤다. 다른 행의 건수는 고치지 않았다.

## 검증

- 유닛: `node --test tests/unit/*.test.js` 1,980건 모두 통과(1회차 반영 뒤, 건너뜀 0, 데이터 서브모듈을 받은 작업 폴더). 타입 검사(`tsc`, 설정 2종) 통과.
- 변이 검사 2건:
  - `versionFooter`의 호스트 확인을 빼면 "운영은 버전만" 시험이 실패한다.
  - `loadVersion()`이 `app_commit`을 옮기지 않으면 `window.appBuild` 시험이 실패한다.
- e2e: `test_settings.py`와 `test_update_toast.py` 61건 통과. 버전 줄을 그리는 설정 화면과 버전 링크를 쓰는 업데이트 알림이라 골랐다.
  - 새 e2e 2건은 버전 줄을 늦게 채우는 코드를 넣기 전에는 둘 다 실패했다.
  - 320px 화면에서 버전 줄이 가로로 넘치지 않는다.
- 사실 토큰 비교(`docs_facts_snapshot.py --diff origin/dev WORKTREE --kinds general`, 고친 문서 7개): 사라진 토큰 0.
- 서버 쪽 검증은 common-bible-server#6 본문에 있다. 그 브랜치의 스크립트로 `origin/dev`(`9985216`)를 dev에 다시 배포했다. 배포 뒤 검증 11종이 통과했고, `https://dev.anglican.kr/version.json`이 두 값을 돌려준다.
- 화면에 해시가 보이는 것은 이 PR을 dev에 머지하고 배포한 뒤 실제 기기에서 확인한다.

## 갱신한 문서

- `docs/decisions/052-build-ids-and-prereleases.md`: 새 ADR
- `docs/decisions/051-dev-and-main-branches.md`: §3의 2(pre-release)와 5(정식 태그), 관련 ADR
- `docs/decisions/021-pwa-versioning-content-hash.md`: §3에 배포 사본의 식별자
- `docs/topics/cache-release.md`: "빌드 식별자와 pre-release" 절, 결정 목록
- `docs/workflow.md`: "릴리스"의 pre-release 절차
- `docs/architecture.md`: §8 배포의 식별자, 검증 11종, 릴리스 순서, 부록 A의 ADR 인덱스
- `CLAUDE.md`: "데이터 수정과 릴리스" 4의 2와 5
- `tests/README.md`: 총계와 `helpers.test.js`, `views.test.js`, `test_settings.py` 행

## 리뷰 반영 (2026-11-23, 1회차)

`/code-review medium --fix`의 지적 4건(모두 가벼운 지적)을 반영했다.

- **버전 파일을 두 번 받던 것**(`6535b99`). 설정 화면을 버전보다 먼저 그리면 `loadVersion()`이 부팅 때의 호출과 겹쳐 `version.json`을 두 번 받고, 늦게 실패한 쪽이 먼저 받은 버전과 빌드 식별자를 지울 수 있었다. 진행 중인 요청을 함께 쓰게 했다. 겹친 두 호출이 요청 하나로 끝나는지와, 실패한 뒤 다시 부르면 새로 받는지를 유닛 2건으로 더했다. 앞의 시험은 고치기 전 코드에서 실패한다.
- **"견준다" 두 곳**(`6535b99`, `b85d440`). 이 PR에서 새로 쓴 `helpers.js` 주석과 ADR-052 배경 1을 "비교한다"로 고쳤다.
- **ADR-052 §3 표의 "로컬"**(`b85d440`). 로컬 서버의 `version.json`에는 해시가 없어 버전만 보이므로, 표의 행을 dev.anglican.kr로 줄였다.
- **pre-release 규칙이 겹치던 것**(`b85d440`). 릴리스 PR 뒤에 버전을 올리지 않은 앱 수정 PR이 더해진 dev를 올리면, "앱 커밋이 바뀌면 새로 만든다"와 "버전을 올리지 않은 시험 배포에는 만들지 않는다"가 함께 해당했다. 사용자가 앞의 규칙을 기준으로 정했다(2026-11-23). 정식 태그가 아직 없는 버전이면 앱 커밋이 바뀔 때마다 만들고, 정식 태그가 이미 있는 버전의 시험 배포에만 만들지 않는다. ADR-052 §4에 경우별 표와 버린 대안 7을 더하고, ADR-051 §3의 2, `docs/workflow.md` "릴리스", `docs/architecture.md` 인덱스를 같은 말로 고쳤다.
- 서버 저장소의 같은 리뷰는 common-bible-server#6에서 반영했다(`c45fcf3`: 해시 길이를 7자리 이상으로 고정, zip을 `zipfile`로 읽기, Build id 줄은 dev 배포에서만). 그 리뷰의 `sitemap.xml` 지적은 결정을 기다린다.
- 검증: 유닛 1,980건과 타입 검사가 통과했다. e2e `test_settings.py`와 `test_update_toast.py` 61건이 통과했다.
