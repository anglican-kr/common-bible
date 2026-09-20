---
date: 2026-09-13
pr: 321
branch: docs/engine-transfer-index
title: "docs: 교회력 엔진 설계 — 옮겨온 축일의 목적지 조회 경로 신설 (미결9 해소)"
---

# docs: 교회력 엔진 설계 — 옮겨온 축일의 목적지 조회 경로 신설 (미결9 해소)

설계서 `docs/design/liturgical-engine.md` §9 미결9(🔴) 해소. 문서만 변경.

## 무엇을 정했나
- **§6.5 이동 패스 신설** — 연도 단위로 한 번, 날짜 오름차순 단일 루프. 결정적이고, 연도 경계는 Y−1 spill 을 seed 로(깊이 1 은 1900~2100 에 단언하는 검증 불변식), 이동 상한 `MAX_SHIFT` 30일은 초과 시 throw 가 아니라 옮기지 않고 `defects` 기록(실측 최장 15일 — 수태고지 2029·2040). 보호 기간 `guard`(성지주일~부활2주일)를 기원·목적지 양쪽에 적용. 도착은 선착순으로 자리를 지켜 **재이동 없음**. 고정일끼리는 충돌이 아니다(9.29 동시 봉헌).
- **§4.9** 캐시를 둘로 — `anchorCache`(computus) · `transferCache`(arrivals·departures·optionals·defects, 완전한 패스만).
- **§5.5** 후보 출처 ⑤ 도착 이동. 후보는 `Candidate` 래퍼(`status` 6종 — `proper | transferred_in | transferred_out | optional | commemorated | omitted`, `from`(기원)·`to`·`displacedBy`). 승자는 엔진이 `official` 로 낸다. ADR-037 §6 계약 함께 개정(§1.3 ⑤).
- **§6.2** `transfer_to` 를 충돌 이동 vs 선택 봉헌으로 갈랐다. 동률 tie-break 4단(도착 우선 연쇄 → 도착끼리 선착순 → 규칙일 유지·고정일 이동 → id). 미국 성공회 달력 2008·2011·2013·2014·2016·2018·2019·2025~2027 과 대조.
- **§6.3 ②** 정정 — B 축일은 성주간·부활주간에 실제로 겹친다. 보호 기간 = 성지주일~부활2주일(기도서 「부활주간 8일」). **ADR-036 §6 표의 B 행도 같이 정정.**
- **§7** 이동 패스 케이스 9묶음(합성은 연도 경계·상한 둘뿐), **§8** PR 2/3 분담.

## 근거
- 기도서 전사 `docs/reference/liturgical-calendar-rules.md` 주요축일 가-3·나-1·나-2·다-1.
- 미국 성공회 달력(lectionarypage.net) — 성탄 3축일 연쇄, 안드레아 → 12.1, 마르코 → 4.28, 성모 방문 → 6.1, 수태고지 → 4.5 전부 §7 기대값과 일치.
  - [2027년 12월](https://www.lectionarypage.net/CalndrsIndexes/Calendar2027.html#december) — 12.26 이 주일인 해. 스테파노 12.27 · 요한 12.28 · 어린이들 12.29 가 각각 "(transferred)" 로 표기돼 **연쇄 모델의 직접 근거**다. 같은 해 [4월](https://www.lectionarypage.net/CalndrsIndexes/Calendar2027.html#april)의 수태고지 → 4.5(부활2주 월).
  - [2026년](https://www.lectionarypage.net/CalndrsIndexes/Calendar2026.html) — 12.27 주일: 스테파노 제자리, 요한 → 12.28, 어린이들 → 12.29. 성모 방문 → 6.1.
  - [2025년](https://www.lectionarypage.net/CalndrsIndexes/Calendar2025.html) — 어린이들 → 12.29, 안드레아 → 12.1, 마르코 → 4.28.
- 데이터 실측(2025~2050): 설=재의 수요일 2032, prec 3 동률 2029·2038·2040, 설=주의 봉헌 2049, 수태고지=부활 2035·2046.

## 새 미결
13 재의 수요일 `transferable: false`(데이터) · 14 prec 3 동률 사제 확인 · 15 선택 봉헌 설정(ADR-038) · 16 2026 이동 교구 달력 대조 · 17 연쇄 vs 건너뜀 사제 확인 · 18 같은 고정 날짜 두 관측일의 `official`(9.29).
