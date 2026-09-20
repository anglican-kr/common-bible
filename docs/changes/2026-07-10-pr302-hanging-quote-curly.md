---
date: 2026-07-10
pr: 302
branch: fix/hanging-quote-curly
title: "fix: 운문 내어쓰기가 곱슬 따옴표를 인식하도록 확장 (ADR-039 대비)"
---

# fix: 운문 내어쓰기가 곱슬 따옴표를 인식하도록 확장 (ADR-039 대비)

## 배경

전례시편 마크다운(`common-bible-data/liturgical/psalter/`)의 본문 인용부호를 곱슬 따옴표로 전환했다. 그런데 앱은 운문 행의 내어쓰기(ADR-006 hanging punctuation)를 `line[0] === '"'` 로 판정한다. `“` 나 `‘` 로 시작하는 행은 내어쓰기가 적용되지 않는다.

지금 당장 깨지지는 않는다 — 전례시편을 렌더하는 코드가 아직 없기 때문이다. 하지만 ADR-039 시편 렌더링이 붙는 순간 바로 드러나고, 나중에 성서 본문(`source/`)까지 전환하면 운문 첫 행 내어쓰기가 **전부** 사라진다. 미리 막아 둔다.

## 변경

- `helpers.js` 에 순수 함수 `hangingQuoteClass()` 신설. `views.js` 와 `citations.js` 에 복제돼 있던 판정을 한곳으로 모았다.
- 곧은·곱슬, 여는·닫는 6종을 모두 인식한다. 기존 코드가 `"` 의 방향을 가리지 않고 내어쓰던 동작을 그대로 보존하려고 `”`·`’` 도 받는다.
- 곱슬 겹따옴표는 곧은 것보다 넓다(Noto Serif KR 기준 0.444em 대 0.389em). `.hanging-quote--curly` 를 두어 전용 오프셋을 준다. 홑따옴표는 곧은·곱슬 모두 0.222em 이라 기존 `--single` 을 그대로 쓴다.

## 검증

- 유닛 **798 통과** (792 → 798, `hangingQuoteClass` 6 케이스 추가)
- `tsc --noEmit` 통과
- e2e **215 통과** (`test_a11y_axe.py` 는 선택적 의존성 미설치로 제외)

tsc 는 ESM 런타임 파손을 못 잡으므로 실제 브라우저로도 확인했다. `/1chr/16` 의 JSON 응답을 곱슬 따옴표로 바꿔치기해 렌더한 결과:

| | 수정 전 | 수정 후 |
|---|---|---|
| `.hanging-quote` 개수 | 0 | 3 |
| 첫 글자와 운문 기준선 차이 | — | +0.02px |
| 콘솔·페이지 오류 | — | 없음 |

`--curly` 오프셋이 없었다면 +0.79px 어긋난다. 곧은 따옴표는 -0.19px 로 변함없다.

## 후속

- `docs/known-issues.md` §3.2 가 이 문제를 미해결로 적어 두었다. 다만 §3 은 `docs/adr-036-liturgical-calendar` 브랜치에 있고 아직 main 에 없다. 그 브랜치가 머지된 뒤 §3.2 를 해소됨으로 갱신한다.
- ADR-006 은 데이터 저장소에서 v2.4 로 갱신했다 (`common-bible-data@ac66e78`).
- `source/` 성서 본문 전환은 별건으로 남아 있다 (§3.3).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Localized poetry typography and shared render helper; no auth, data, or API changes. Regression risk is limited to verse/citation poetry line layout.
> 
> **Overview**
> Poetry **hanging punctuation** (ADR-006) no longer keys only on straight `"` / `'`. The PR centralizes quote detection in **`hangingQuoteClass()`** in `helpers.js` and uses it from **`views.js`** and **`citations.js`** instead of duplicated inline checks.
> 
> **Behavior:** Six quote forms are recognized (straight and curly, open and close). Curly double quotes get a new **`.hanging-quote--curly`** offset (`-0.444em` in Noto Serif KR) because they are wider than straight doubles; singles keep **`.hanging-quote--single`**.
> 
> **Tests:** Unit coverage for `hangingQuoteClass` in `helpers.test.js`; `citations.test.js` loads the real helper to avoid drift.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 293e007861327ee90a5481379518225f4b807fc9. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
