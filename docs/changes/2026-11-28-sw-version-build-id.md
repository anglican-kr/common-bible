---
pr: 683
date: 2026-11-28
branch: fix/sw-version-build-id
title: "fix: 같은 버전의 새 앱 빌드를 기기가 업데이트로 알아보게"
---

## 요약

- 배포 빌드의 `sw-version.js` 사본에서 `APP_VERSION`을 빌드 식별자(`X.Y.Z-<앱 커밋>`)로 바꾼다. 바꾸는 일은 서버 저장소의 `build-deploy.sh`가 한다(common-bible-server#8). 이 저장소는 ADR과 문서, 주석만 고친다.
- 같은 버전에 앱 수정을 더해 다시 낸 pre-release를 dev.anglican.kr의 기기가 업데이트로 알아본다. 업데이트 알림이 뜨고 셸 캐시가 `shell-X.Y.Z-<앱 커밋>`으로 바뀐다. 데이터만 낸 배포는 앱 커밋이 그대로라 업데이트로 보지 않는다.

## 확정 · 근거

- 사용자 결정(2026-11-28): 해시가 다르면 dev 서버의 빌드를 새 버전으로 알아보게 한다. 2.2.9를 `2.2.9-3b98832`에서 `2.2.9-df05b57`로 다시 올렸는데, `sw-version.js`의 버전 줄이 그대로라 서비스 워커가 바뀌지 않았다. dev는 셸을 서버에서 먼저 받아 바뀐 화면은 보였지만, 업데이트 알림과 셸 캐시 교체는 없었다. 그래서 업데이트 직후에만 생기는 문제(아이폰에서 업데이트 직후 상단 바가 본문과 함께 올라감)를 dev에서 확인할 수 없었다.
- ADR-052 §1은 2026-11-23에 `sw-version.js`에 해시를 넣지 않기로 했다. 데이터만 낸 운영 배포에도 업데이트 알림이 뜰까 봐서였다. 넣는 값은 데이터 업데이트를 건너뛰는 앱 커밋(ADR-052 §2)이라 그 걱정은 생기지 않는다. ADR-052 §1을 고치고 옛 결정을 「검토한 대안」 2에 남겼다.
- 데이터 커밋은 넣지 않는다. 데이터는 지금처럼 매니페스트로 항목마다 갱신된다(ADR-021).
- 업데이트 알림의 글은 `version.json`의 `version`이라 운영에서 보이는 버전은 그대로다. 해시는 지금처럼 dev의 설정 맨 아래 버전 줄에만 보인다(ADR-052 §3).
- 운영은 dev에서 확인한 빌드와 같은 파일을 올리므로(`deploy.sh promote`가 견준다), 운영의 셸 캐시 이름도 빌드 식별자가 된다. 운영은 버전을 올릴 때만 앱 커밋이 바뀌므로 사용자가 겪는 차이는 없다.
- 서버 저장소의 배포 뒤 검증은 `sw-version.js`의 `APP_VERSION`이 빌드 식별자인지 본다. 이 변경 전에 만든 빌드로 되돌릴 때는 버전만 있어도 받는다.

## 검증

- 서버 저장소의 `build-deploy.sh`로 이 브랜치(dev `fdaf262`)의 배포 묶음을 만들어, 묶음의 `sw-version.js`가 `self.APP_VERSION = "2.2.9-df05b57";`이고 `version.json`의 빌드 식별자와 같은 것을 보았다. 저장소의 `sw-version.js`는 `2.2.9` 그대로다.
- 배포 뒤 검증 함수를 지금 dev.anglican.kr(이 변경 전 빌드)에 돌려, 버전만 있는 `sw-version.js`를 옛 빌드로 받는 것과, 그 경우를 받지 않게 바꾸면 실패하는 것을 보았다.
- 유닛 2009건과 타입 검사 통과(문서 검사 포함).

## 갱신한 문서

- `docs/decisions/052-build-ids-and-prereleases.md` §1과 요약: `sw-version.js` 사본의 빌드 식별자. 「검토한 대안」 2
- `docs/decisions/021-pwa-versioning-content-hash.md` §3: 서비스 워커가 새로 설치되는 때
- `docs/topics/cache-release.md` 「결정」: 배포 빌드의 `sw-version.js`
- `docs/architecture.md`: 셸 캐시 이름의 예
- `docs/decisions/015-storage-strategy.md`: 캐시 표의 셸 캐시 이름
