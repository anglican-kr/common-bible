---
pr: 680
date: 2026-11-28
branch: fix/deploy-dev-submodule
title: "fix: dev 배포 CI가 데이터 서브모듈을 받지 못하던 것"
---

## 요약

- `deploy-dev.yml`의 첫 실행(pre-release `2.2.9-3b98832`)이 데이터 서브모듈을 받는 단계에서 `Permission denied (publickey)`로 실패했다. 서버에는 아무것도 올라가지 않았다.
- 데이터 저장소 주소를 배포 키의 호스트 별칭으로 바꾸는 `insteadOf`를 상위 저장소의 로컬 설정(`git -C common-bible config`)에 넣었는데, 서브모듈은 따로 실행되는 `git clone`이 받아서 그 설정을 읽지 않는다. 그래서 별칭 없이 `github.com`으로 접속해 키를 찾지 못했다. `sync-data.yml`처럼 `git config --global`로 넣는다.

## 확정 · 근거

- 로컬에서 재현했다. 가짜 ssh로 접속 주소를 찍어 보니, 로컬 설정만 둔 클론은 `git@github.com`으로, 전역 설정을 둔 클론은 별칭으로 접속했다.

## 검증

- 위 재현. 실제 CI는 고친 워크플로가 담긴 커밋의 pre-release에서 다시 확인한다. release 이벤트는 태그가 가리키는 커밋의 워크플로를 실행하므로, `2.2.9-3b98832`를 다시 실행해서는 이 수정이 적용되지 않는다.

## 갱신한 문서

- 없음 — 워크플로의 주석에 까닭을 적었다.
