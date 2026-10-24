---
pr: 410
date: 2026-10-24
branch: chore/term-workflows
title: "chore: CI 단계 이름의 관측일을 전례일로 바꿈"
---

## 요약

#409에서 「관측일」을 「전례일」로 바꾸며 남겨 둔 곳을 마저 고쳤다.

- CI 설정의 단계 이름과 주석 세 곳(`.github/workflows/engine-data.yml` 둘, `sync-data.yml` 하나)의 「픽스처 관측일 id」를 「픽스처 전례일 id」로 바꿨다. 테스트 파일(`liturgical-fixtures.data.test.js`)과 `tests/README.md`는 #409에서 이미 「픽스처 전례일 id」로 바뀌어, 단계 이름이 그것과 맞게 됐다.
- ADR-036의 「기간형 전례일 표 신설 필요」를 「기간 표 신설 필요」로 고쳤다. #409가 「관측일」을 기계로 바꾸며 생긴 어색한 말이다. 일치 기도 주간처럼 여러 날짜에 걸친 기간은 #409에서 「기간」으로 부르기로 했다.

## 확정 · 근거

- #409는 워크플로 파일을 push할 때 권한이 따로 필요할 수 있어 이 셋을 남겼다. 원격이 SSH이고 토큰에 `workflow` 권한도 있는 것을 확인했다.
- 데이터 저장소에 남은 「관측일」, 「승자」는 같은 날 데이터 PR(anglican-kr/common-bible-data#38)에서 고쳤다. 기간 표 제목을 「기간 (Periods)」로, 그 표가 가리키던 ADR-036 절 이름 인용을 「기간 표 신설」로 바꿔 이 PR과 맞췄다.
- 단계 이름은 필수 검사의 이름(`Unit tests`, `Change ledger`)이 아니라서 브랜치 보호에 영향이 없다.

## 검증

- `node --test tests/unit/*.test.js` 1365개 통과, 1개 건너뜀(CI와 같은 명령).
- 앱 저장소에서 머지된 원장과 보관 문서, 데이터 서브모듈을 빼면 「관측일」이 남은 곳은 셋이다. 사용자 결정의 낱말을 그대로 적은 두 곳(「화면 글에 「관측일」을 쓰지 않는다」)과, `docs/writing.md` 「용어」 표에서 피할 말로 적은 한 곳이다.

## 갱신한 문서

- `docs/decisions/036-liturgical-calendar-data-model.md`: 절 이름 하나.
- `.github/workflows/engine-data.yml`, `.github/workflows/sync-data.yml`: 단계 이름과 주석(동작은 바뀌지 않는다).
