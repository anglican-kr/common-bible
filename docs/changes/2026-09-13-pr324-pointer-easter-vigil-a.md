---
date: 2026-09-13
pr: 324
branch: data/pointer-easter-vigil-a
title: "data: 서브모듈 포인터 + facts 블록 + sitemap — 부활밤 가해 반영 (data #25)"
---

# data: 서브모듈 포인터 + facts 블록 + sitemap — 부활밤 가해 반영 (data #25)

서브모듈 포인터 `47734d3` → `c42c9bd` ([data #25](https://github.com/anglican-kr/common-bible-data/pull/25) — 부활밤 가해 독서 보충).

## 왜 자동 sync 가 아니라 손 PR 인가

`sync-data.yml` 은 포인터를 올리기 전에 **문서↔데이터 대조**를 돌리고 어긋나면 **PR 을 열기 전에 멈춘다** — 그 파일의 주석대로 「낡은 수치가 적힌 채로 포인터만 올라가는 것」을 막기 위해서다. 이번 데이터 변경은 설계서 `facts` 블록의 수치를 바꾸므로 자동 sync 로는 통과하지 못한다. **포인터와 facts 를 한 커밋에** 올려야 한다.

## facts 블록 (`docs-data-consistency.test.js` 가 기계 대조)

| 키 | 이전 | 새것 |
|---|---|---|
| `readings.total` | 922 | **923** |
| `readings.set_no.1` | 840 | **841** |
| `readings.slot.first` | 922 | **923** |
| `readings.slot.psalm` | 922 | **923** |
| `readings.slot.gospel` | 922 | **923** |
| `readings.weekday_null` | 392 | **393** |

`slot.second` 는 **383 그대로**다 — 부활밤은 `first`·`psalm`·`gospel` 셋이고 `second` 가 없는 것이 원래 모양이다(`first` 에 서간 로마 6:3-11 이 온다). 세 해가 `first`·`psalm` 공통, 복음만 갈린다(A 마태 28:1-10 · B 마르 16:1-8 · C 루가 24:1-12).

## 함께 닫은 것

- **§2 데이터 현실 표**의 「부활밤 독서에 가해(A)가 없다」 행 → 해소. **엔진이 할 일은 없었다** — §2 원칙(결손은 빈 결과 + 계속 진행)대로 견디는 구조가 이미 맞았고, 고칠 것은 데이터뿐이었다.
- **§9 미결21** → 해소. 부활밤이 **감사성찬례**라는 것도 확인됐다(복음 있음 — 미결4 가 12.31 전야를 성무일과로 판정한 그 판별법). 이것이 **미결20**(성 토요일 하루에 전례가 둘)의 전제다.

`sitemap.xml` 은 `lastmod` 한 줄만 바뀐다 — 독서 데이터만 바뀌어 URL 수는 1404 그대로다.

## 검증

유닛 **830 통과** · `docs-data-consistency` **통과**(이 PR 전에는 `922 ≠ 923` 로 실패했다 — 가드가 의도대로 잡았다).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01XsciooALgduKAB5axfcmWL
