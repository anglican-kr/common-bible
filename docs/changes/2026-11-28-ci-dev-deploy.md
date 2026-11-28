---
pr: 678
date: 2026-11-28
branch: feat/ci-dev-deploy
title: "feat: pre-release를 내면 CI가 dev.anglican.kr에 올린다"
---

## 요약

- **새 CI `deploy-dev.yml`**: pre-release를 내면(`release` 이벤트의 `prereleased`) 그 태그의 커밋을 받아 서버 저장소의 `deploy.sh dev-ci`로 dev.anglican.kr에 올린다. 정식 Release에는 실행되지 않는다. 운영은 지금처럼 사람이 `deploy.sh promote`로 낸다.
- **순서가 바뀌었다**: 전에는 `deploy.sh dev`로 먼저 올리고 출력된 빌드 식별자로 pre-release를 만들었다. 이제 서버 저장소의 `prerelease.sh`가 식별자를 먼저 계산해 태그와 pre-release를 만들고, CI가 올린다. CI는 식별자를 다시 계산해 태그 이름과 다르면 빌드하기 전에 멈춘다.
- **서버 키는 dev만 바꾼다**: seoul의 전용 계정 `deploy-ci`는 서버 저장소의 `bible-dev-receive` 하나만 실행할 수 있다. 그 스크립트는 `/var/www/dev`만 옮기고, 이미 있는 빌드 폴더(운영이 쓰는 것일 수 있다)는 다시 쓰지 않는다. 키는 태그에서만 쓰이는 GitHub 환경 `dev`에 둔다.
- pre-release가 없는 배포(정식 태그가 있는 버전의 시험 배포, 데이터만 바뀐 배포)는 지금처럼 `deploy.sh dev`로 손으로 올린다.
- **promote는 이름이 아니라 내용을 본다**(보안 검토 뒤 추가): 새어 나간 CI 키로 곧 낼 빌드의 이름을 먼저 차지하거나, promote 직전에 dev를 같은 커밋의 다른 이름(8자 해시)으로 바꿔치기하면 운영에 악성 서비스 워커가 나갈 수 있었다. 이제 `deploy.sh promote`는 origin/main을 로컬에서 빌드해 dev 빌드 폴더와 파일 목록과 해시를 견주고, 검증 기준값도 로컬 빌드에서 읽는다. 폴더 이름은 커밋 7자로 하나뿐이고, 같은 이름의 폴더가 있으면 CI와 `deploy.sh dev`·`prod` 모두 내용이 같을 때만 재사용하고 다르면 멈춘다.

## 확정 · 근거

- 사용자 요청(2026-11-28): pre-release가 생기면 CI가 dev 서버에 배포한다. ADR-052 §4의 순서와 반대라 사용자에게 물었고, 이름을 계산하는 스크립트와 CI의 이름 검사를 함께 두는 안, 그리고 CI 전용 서버 계정을 골랐다.
- 서버 쪽 변경은 common-bible-server의 같은 이름 브랜치에 있다(`lib/build-ids.sh`로 식별자 계산을 나눔, `prerelease.sh`, `deploy.sh dev-ci`, `remote/bible-dev-receive`, 설치 절차).

## 검증

- 식별자 계산을 나눈 뒤에도 `build-deploy.sh`의 식별자와 zip 목록이 전과 같다(원래 폴더로 비교, `75785d0`/`656cfa0`).
- `deploy.sh dev-ci`를 가짜 ssh와 임시 `/var/www`로 실행했다. 태그 이름이 틀리면 빌드 전에 멈추고, 맞으면 수신 스크립트가 빌드 폴더를 만들고 dev를 옮겼다. 실제 dev.anglican.kr과 견주는 검증은 가짜 서버라 예상대로 실패했다.
- 수신 스크립트: 잘못된 이름(`../etc`)을 거절하고, 운영 빌드 폴더 이름으로 보내면 다시 쓰지 않고 dev만 옮기며, `..`와 절대 경로가 든 zip은 대상 밖에 파일을 만들지 못했다.
- 보안 검토 뒤의 수정: 수신 스크립트가 8자 이름을 거절하고, 같은 빌드의 재실행은 재사용하며, 파일 하나를 고치거나 더한 폴더는 dev를 옮기지 않고 멈췄다. 해시 계산 스크립트가 없을 때도 멈췄다. 실제 서버의 dev 빌드 폴더(`bible-2.2.8-b728ebce`)를 같은 커밋으로 다시 빌드한 zip과 읽기만 해서 견주어 정확히 같았다. 그래서 정상적인 promote는 그대로 통과한다.
- 실제 CI 실행과 promote는 서버 계정과 환경 `dev`를 설정한 뒤 다음 pre-release에서 확인한다.

## 갱신한 문서

- `docs/decisions/052-build-ids-and-prereleases.md` §4, 요약, 검토한 대안 8과 9
- `docs/decisions/051-dev-and-main-branches.md` §3의 2
- `CLAUDE.md` 「데이터 수정과 릴리스」 4의 2
- `docs/workflow.md` 「릴리스」, CI 목록
- `docs/topics/cache-release.md` 「빌드 식별자와 pre-release」
- `docs/architecture.md` 배포 명령과 릴리스 순서
