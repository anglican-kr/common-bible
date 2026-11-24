---
date: 2026-11-24
branch: chore/drop-python-version
title: "chore: .python-version 삭제 및 무시 목록 등록"
---

## 요약

저장소에서 `.python-version`을 지우고 `.gitignore`에 넣었다(known-issues §57 해소). 이 파일은 pyenv가 이 폴더에서 쓸 Python 버전을 고르는 파일인데, 이 기기에 없는 가상 환경(`common-bible-env`)을 가리켜 `pyenv exec python -m pytest`가 실행되지 않았다.

## 확정 · 근거

- **지우기로 사용자가 정했다**(2026-11-24). §57이 적어 둔 두 길(기기에 그 환경을 만들기, 파일을 설치된 버전으로 바꾸기) 대신, 저장소에 두지 않고 기기마다 정하게 했다.
- **이 파일은 쓰임이 끝났다.** 2025-07-27(`5873fa2`)에 저장소가 Python 파이프라인(`src/`, `setup.py`)을 품고 있을 때 넣었다. 파이프라인은 데이터 저장소로 옮겨 갔고, 앱 저장소의 Python은 e2e(pytest와 Playwright)와 개발 서버(`scripts/serve.py`)뿐이다.
- **CI는 이 파일을 읽지 않는다.** 앱 저장소의 워크플로 가운데 Python을 쓰는 `sync-data.yml`은 `actions/setup-python`에 버전(3.12)을 직접 적는다.
- **지운 뒤에는 pyenv가 기기의 기본 버전을 쓴다.** 이 기기의 기본 버전(`~/.pyenv/version`)은 3.14.6이고, pytest와 Playwright가 있다. 기기마다 다른 버전을 쓰려면 `pyenv local`로 만들면 되고, 그 파일은 이제 git이 무시한다.

## 검증

- `git check-ignore -v .python-version`이 `.gitignore`의 새 줄을 가리킨다.
- 작업 폴더에서 `pyenv version`이 3.14.6(`~/.pyenv/version`에서 정함)이고, `pyenv exec python`이 pytest와 Playwright를 불러온다.
- 유닛: `node --test tests/unit/*.test.js` 1,999건 가운데 1,759건 통과, 실데이터 240건은 이 작업 폴더에 데이터 서브모듈을 받지 않아 건너뛰었다(CI와 같은 조건). 타입 검사(`npm run typecheck`) 통과. 앱 코드와 시험은 바뀌지 않아 e2e는 돌리지 않았다.

## 갱신한 문서

- `docs/known-issues.md` §57: 해소 기록.
- `docs/topics/platform.md` 「남은 일」: §57 항목을 지웠다.
