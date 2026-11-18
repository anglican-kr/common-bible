---
pr: 597
date: 2026-11-19
branch: docs/offline-save-docs
title: "docs: 오프라인 저장 문서를 지금 동작에 맞춤"
---

## 요약

오프라인 저장(ADR-045)의 문서 세 곳을 지금 동작과 dev 확인 결과에 맞춘다.

- ADR-045 §1이 받을 파일 목록을 `bible-manifest.json`에서 얻는다고 적었다. 앱은 크기 목록 `bible-sizes.json`을 읽으므로(§8, `js/offline-save.js`) 그렇게 고쳤다.
- 성시 검색(ADR-046, #595)이 검색 자료에 `search-lit.json`을 더해 크기가 바뀌었다. 주제 문서의 크기 표와 ADR-045 §2, §6의 크기 예를 데이터 `56017c8`로 다시 쟀다(모두 17.5MB, 검색 자료 6.3MB).
- 주제 문서 「지금 동작」에 성서 본문이 전례시편(`lps`)과 성무일과 송가(`cant`)의 장 파일을 포함한다고 적었다. 사용자가 두 책이 저장되는지 물어 확인한 것이다.
- known-issues §6.1의 「dev 배포 뒤 확인한다」를 2026-11-18 dev 확인 결과로 바꿨다.

## 확정 · 근거

- dev 확인(2026-11-18, `bible-2.1.0-caf6627`)은 화면 없는 Chromium에 아이폰 사용자 에이전트를 주고 했다. 그때는 `search-lit.json`이 없어 1,506개였다.
- ADR-045 「검토한 대안」의 「6.0MB를 덜 받지만」은 2026-11-17의 판단을 적은 것이라 그대로 두었다.
- e2e `tests/e2e/test_settings.py` 설명 글의 「1,506개」는 개수를 검사하지 않는 설명이라 이 문서 PR에서 고치지 않았다(검사는 `len(expected) > 1500`).

## 검증

- 앱 main의 데이터 포인터(`56017c8`)의 `bible-sizes.json`을 `offline-save.js`와 같은 규칙으로 묶어 셌다. 성서 본문 1,492개 9,136,889바이트(이 가운데 전례시편 150개, 송가 13개), 검색 자료 4개 6,258,308바이트, 교회력 자료 11개 2,143,935바이트, 모두 1,507개 17,539,132바이트, gzip 합 4,953,769바이트.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures*.test.js`: 33개 통과.

## 갱신한 문서

- `docs/decisions/045-offline-save.md`: §1 파일 목록의 출처, §2와 §6의 크기 예.
- `docs/topics/cache-release.md`: 「오프라인 저장」의 저장 범위와 크기 표, 「남은 일」 §6.1의 dev 확인 결과.
