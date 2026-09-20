---
date: 2026-07-13
pr: 305
branch: docs/adr037-ordinal-weeks
title: "docs: ADR-037 §4 개정 — 연중 구간표 윤년 기준점 + D3 완료"
---

# docs: ADR-037 §4 개정 — 연중 구간표 윤년 기준점 + D3 완료

데이터 저장소에서 연중 주간 구간표(D3) 구현이 끝나(anglican-kr/common-bible-data#11), ADR-037 을 실제 구현에 맞춘다. 문서 전용.

## 무엇이 바뀌나

- **§4 개정 블록** — 윤년 기준점 규칙. JSON 스키마가 `{week, windows:[{from, to, anchor}]}` 로 넓어졌다(`anchor: "doy" | "date"`).
- **§6 계산 계층** — 연중 주차 조회가 구간의 `anchor` 를 따른다는 한 줄 보강.
- **미결 사항 2번(구간표 입력)** — 해소 표시.
- **상태** — `구현 대기` → `구현 중` (D1 전례시편 · D3 구간표 완료, D2 독서 데이터 · A1 엔진 남음).
- **status.md** — D3 한 줄 추가.

## 왜 윤년 기준점이 필요한가

표의 구간은 1/7 부터 7일씩 끊은 블록이라 **2월이 28일일 때만 맞아떨어진다.** 윤년에는 2/29 가 3월 날짜를 하루 밀어 8주 구간(2/25–3/3)이 8일이 되고, **2052년(부활절 4/21)에는 2/25 와 3/3 이 둘 다 그 구간에 들어간다.** 3/3 은 세례주일부터 세면 아홉 번째 주일이므로 9주가 맞고, 9주 구간(3/4–3/7)은 그해 빈 채로 남는다.

| 구간 | `anchor` | 조회 방식 | 같은 뜻 |
| --- | --- | --- | --- |
| 공현 후 (1~9주) | `doy` | 연중 일수로 맞춘다 | 세례주일(1주)부터 앞으로 센다 |
| 성령강림 후 (6~34주) | `date` | 월/일 그대로 맞춘다 | 대림 직전 주일(34주)부터 뒤로 센다 |

앞 구간은 연초(1/7)에, 뒤 구간은 연말(대림 1주일 = 12/25 직전 네 번째 주일)에 매달려 있고 그 사이에 2/29 가 끼기 때문이다. 데이터에 `anchor` 를 실어 엔진(A1)이 규칙을 잘못 고를 여지를 없앴다.

## 검증

데이터 저장소 PR 에서 1900~2100년 전 연도의 연중 주일을 computus 로 생성해 표와 대조 — `pytest tests/` 1,419 통과. 표의 두 상한(사순 직전 3/7, 대림 직전 11/20–11/26)이 computus 상한과 일치함도 확인.

문서 전용이라 앱 코드 변경 없음.

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Markdown-only updates to ADR and status; no application or data pipeline code in this PR.
> 
> **Overview**
> **Documentation-only** sync after the data-repo D3 ordinal-weeks work: **ADR-037** and **`docs/status.md`** now describe what shipped, with **no app or runtime changes**.
> 
> **ADR-037 §4** adds a **2026-07-13 revision** for leap years: `ordinal-weeks.json` windows now include **`anchor: "doy" | "date"`** (schema `{week, windows:[{from, to, anchor}]}`). **Epiphany-after weeks (1–9)** use day-of-year lookup; **Pentecost-after (6–34)** use calendar month/day. The doc explains the **2052** case (3/3 → week 9, not week 8) and points to **`tests/test_ordinal_weeks.py`** (1900–2100 computus cross-check).
> 
> **§6** states the liturgical engine’s ordinary-week lookup must honor each window’s **`anchor`**. **Open item #2** (manual ordinal-weeks input) is marked **resolved**. ADR **status** moves from “awaiting implementation” to **in progress** (D1 psalter + D3 table done; **D2 readings data** and **A1 engine** remain).
> 
> **`status.md`** gains a **D3 complete** line: 34 weeks / 38 windows, dual anchors, validation summary, and that the table is **not yet consumed in the app** until A1.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 61261f0732f0581e027f39d609f3c13706fb1937. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
