---
pr: 664
date: 2026-11-24
branch: docs/quote-iphone-check
title: "docs: 따옴표 묶음의 실제 아이폰 확인 기록"
---

## 요약

known-issues §79(아이폰의 Safari가 운문 행의 여는 따옴표 뒤에서 줄을 바꾼다)의 해소 기록에, 실제 아이폰에서 확인했다는 사실을 적었다. #661은 Chromium과 WebKit으로만 재고 "실제 아이폰의 Safari에서는 dev에 낸 뒤 확인한다"고 남겨 두었다.

## 확정 · 근거

- **사용자가 실제 아이폰에서 확인했다**(2026-11-24). dev 배포의 그날 전례독서에서 전례시편 96:10의 "“주님이"가 한 줄에 붙어 있었다. 전에는 여는 따옴표만 줄 끝에 남았다.
- **확인한 판은 #661이 들어간 dev다.** dev 서버의 `version.json`이 앱 커밋 `a0b30c7`(#661의 squash 커밋)을 내보낸다(2026-11-24에 다시 봤다).
- `docs/topics/design-system.md`의 "아래는 당시 기록이다" 뒤 「고치는 법」은 해소 전의 기록이라 그대로 두었다.

## 검증

- 문서 검사 유닛(`node --test tests/unit/docs-*.test.js`) 통과. 코드와 시험은 바뀌지 않아 e2e는 돌리지 않았다.

## 갱신한 문서

- `docs/topics/design-system.md`: known-issues §79 해소 기록의 실제 아이폰 확인.

## 리뷰 반영

1회차(`/code-review medium --fix`): 사소한 지적 하나를 고쳤다. 「확정 · 근거」의 주제 문서 경로를 저장소 루트 기준(`docs/topics/design-system.md`)으로 맞췄다. 중요한 지적이 없어 리뷰를 멈췄다.
