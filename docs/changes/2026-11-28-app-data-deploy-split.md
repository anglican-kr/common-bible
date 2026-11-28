---
pr: 686
date: 2026-11-28
branch: claude/pensive-goodall-wxwd13
title: "feat: 앱과 데이터를 따로 배포하기 위한 준비"
---

## 요약

- ADR-061을 새로 썼다. 데이터를 앱 빌드와 따로 서버의 데이터 폴더에 올리고, 데이터의 형식 번호(`data-version.json`)와 앱이 읽을 수 있는 번호(`version.json`의 `data_formats`)를 견줘 둘이 맞을 때만 배포한다. 데이터는 CI가 dev.anglican.kr에 올리고 사람이 `deploy-data.sh promote`로 운영에 낸다. ADR-052 §5 「다음 단계」를 대체하고, ADR-051 §3과 ADR-021 §4에 대체한 곳을 적었다.
- 함께 가는 PR: 데이터 저장소 anglican-kr/common-bible-data#98(형식 번호, 사이트맵, 호환 검사와 dev 배포 CI), 서버 저장소 anglican-kr/common-bible-server#10(`deploy-data.sh`, 데이터 없는 앱 빌드, nginx 예시, 전환 순서). 서버 PR은 전환할 때 머지한다.
- 이 PR은 앱 쪽 준비(ADR-061 §6, §8의 1)만 담는다. 서버에 아무것도 바꾸지 않으므로, 이 PR을 운영에 내도 배포 순서와 사용자가 받는 파일은 지금과 같다.
  - `version.json`에 `data_formats: [1]`을 더했다. `release.py`는 버전만 바꾸고 다른 칸을 남긴다.
  - 서비스 워커가 운영에서 `books.json`과 `search-meta.json`을 캐시의 사본으로 먼저 내고 뒤에서 새로 받아 사본을 바꾼다. 데이터만 낸 배포 뒤에도 다음 실행부터 새 책 목록과 검색 별칭을 쓴다.
  - dev의 버전 줄이 데이터 커밋을 `/data/data-version.json`에서 읽고, 없으면 지금처럼 `version.json`의 값을 쓴다.

## 확정 · 근거

- 앱과 데이터의 배포를 나누기로 했다(사용자 결정 2026-11-28). 계획에서 권장한 세 가지를 그대로 받았다. 데이터를 운영에 내는 일은 사람이 promote로 하고, 앱 저장소의 자동 포인터 PR(`sync-data.yml`)은 계속 두고, 형식을 깨는 변경은 번호를 올려 두 단계로 낸다.
- 까닭: 지금은 본문 오탈자 하나도 앱 릴리스 순서를 밟고, dev에 운영에 낼 수 없는 앱 변경이 있으면 데이터 수정도 묶인다. 2026-08-01부터 11-28까지 앱 저장소의 데이터 포인터 변경 63번 가운데 15번은 앱 PR이 앱 코드(`js/`, `sw.js`, `css/`, `index.html`)와 함께 올린 것이라(`git log -- data`에서 자동 PR을 빼고 앱 코드를 바꾼 커밋을 센 수. 계획을 말할 때는 앱 코드를 보지 않고 17번으로 셌다), 형식 번호와 호환 검사를 함께 두었다.
- 두 파일을 네트워크에서 먼저 받지 않았다. 앱이 열릴 때 기다리는 파일이라(`pre-fetch.js`) 느린 연결에서 앱이 늦게 열린다. 매니페스트 2종은 앱이 열린 뒤 쉬는 때(`requestIdleCallback`)에 읽으므로 네트워크 우선이어도 된다.
- 앱이 실행 중에 형식 번호를 견주는 일은 이번에 넣지 않았다. 형식을 바꾸는 일이 드물어, ADR-061 §3의 순서(두 번호를 읽는 앱을 먼저 내고 시간을 둔다)로 충분하다고 보았다. 「검토한 대안」 3에 재검토 조건을 적었다.

## 검증

- `node --test tests/unit/*.test.js`: 2016 통과(데이터 서브모듈을 받은 상태, 실데이터와 문서 검사 포함). 새 테스트는 `sw.test.js` 5개(셸 데이터 갱신 블록을 vm으로 실행: 사본을 먼저 내고 바꾼다, 실패와 오류 응답이면 사본을 둔다, 사본이 없으면 네트워크, 대상과 라우팅, dev 호스트 제외), `views.test.js` 2개(`data-version.json`의 커밋이 앞선다, 없거나 JSON이 아니면 `version.json`의 값).
- `npm run typecheck`: 오류 0건.
- `python -m unittest scripts/test_release.py`: 14 통과(`write_version_json` 2개 추가).
- e2e: `test_settings.py -k version_line` 3 통과(새 테스트 `test_version_line_reads_the_data_commit_from_the_data_build` 포함), `test_update_toast.py`, `test_liturgical_lazy_load.py`, `test_analytics_guard.py` 32 통과. 화면 없는 Chromium의 e2e는 서비스 워커를 막고 돌아 셸 데이터 갱신의 길은 지나지 않는다. 운영에 낸 뒤 실제 기기에서 확인한다.

## 갱신한 문서

- `docs/decisions/061-separate-app-and-data-deploys.md`: 새 ADR
- `docs/decisions/052-build-ids-and-prereleases.md` §5, `051-dev-and-main-branches.md` §3, `021-pwa-versioning-content-hash.md` §4: ADR-061이 대체한 곳
- `docs/architecture.md`: 부록 A에 ADR-061, §4.6 셸 줄
- `docs/topics/cache-release.md`: 「앱과 데이터를 따로 배포하기」, 결정, 함정의 표, 남은 일(전환)
