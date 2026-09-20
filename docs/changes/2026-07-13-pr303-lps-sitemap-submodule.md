---
date: 2026-07-13
pr: 303
branch: chore/lps-sitemap-submodule
title: "chore: data 서브모듈 포인터 갱신 + sitemap 이 전례시편 제외 (ADR-039 D1)"
---

# chore: data 서브모듈 포인터 갱신 + sitemap 이 전례시편 제외 (ADR-039 D1)

## 개요

data 저장소가 전례시편을 파이프라인에 편입했다(data#9). 앱 쪽에서 그 데이터를 받아들이는 마무리 — 서브모듈 포인터 갱신 + sitemap 필터. ADR-039 D1 의 마지막 조각이다.

`books.json` 이 73권 → **74권**이 되었다(`lps`, division `liturgical`, 150편). 읽기 UI 는 division 3개(구약·외경·신약)만 알기 때문에 책 목록·검색에서 자동으로 숨는다(ADR-037 §3). 하지만 **sitemap 은 `books.json` 전체를 돌기 때문에** 그대로 두면 `/lps/1`~`/lps/150` 150개 URL 을 색인하라고 광고한다 — 목록에도 없고 전례 표기(◯·¶·"(N)")도 아직 렌더하지 않는 경로다. browsable division 만 싣도록 필터를 넣었다.

## 브라우저 스모크 (로컬, chromium)

74번째 책이 읽기 UI 를 깨지 않는지 실제로 확인했다.

- **책 목록** — 탭은 구약·외경·신약 3개 그대로, 구약 39권 정상, `전례시편` 은 어디에도 없음.
- **검색** — "사랑" 결과 15건 정상 렌더, 결과에 `전례시편` 없음. `전례시편 131:1` 로 찾으면 결과 없음 안내(검색 인덱서가 `lps` 를 메타에서 제외 — data#9).
- **JS 런타임 에러 0건.** (콘솔의 CSP 차단 애널리틱스 경고는 로컬 환경의 기존 현상.)
- `/lps/131` 을 직접 열면 본문은 렌더된다 — 장 JSON 이 기존 스키마와 동형이라 기본 라우트가 소화한다. 계응·부 표기는 아직 없다(ADR-038 A2~A4). 목록·검색·sitemap 어디에도 링크가 없으므로 지금은 도달 경로가 없다.

`node --test tests/unit/*.test.js` **798개 통과**.

## sitemap lastmod 125건이 함께 갱신되는 이유

이 PR 의 diff 에서 `sitemap.xml` 의 lastmod 125건이 바뀌는데, **`lps` 와 무관한 밀린 갱신**이다.

6월 8일 data 커밋(`fix: 산문 연속 줄 앞 빈 줄을 단락 구분으로 보존`)이 성경 JSON 125개를 건드렸다. 그런데 그 PR 이 산출물을 직접 커밋해서 머지 후 `build.yml` 이 no-op 이 되었고 → `sync-data.yml` 디스패치가 발동하지 않았고 → 앱의 sitemap 재생성도 걸리지 않았다. 그래서 커밋된 `sitemap.xml` 은 5월 31일 값에 머물러 있었다. 옛 포인터에서 스크립트를 돌려도 같은 125건이 나오는 것으로 확인했다.

URL 총수는 1,404개로 그대로다(`lps` 0건).

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> SEO/build-script change only; no app runtime, auth, or user-facing routing logic modified in this diff.
> 
> **Overview**
> **`build_sitemap.py`** now limits sitemap entries to books in **`BROWSABLE_DIVISIONS`** (구약·외경·신약 only), so the new **`liturgical`** division book **`lps`** (전례시편, 150 chapters) is not emitted as `/lps/N` URLs. The reading UI already hides that division; without the filter, the sitemap would advertise ~150 routes that are not linked from browse/search and are not meant for general indexing yet (ADR-039).
> 
> Regenerated **`sitemap.xml`** reflects the updated data submodule git history: many **`lastmod`** values move forward (notably around 2026-06-08), catching up sitemap timestamps that had stalled after a prior data change did not trigger an automated rebuild. **URL count stays at 1,404** — no `lps` entries added or removed in this pass.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 7270030067abdaaa7d3ff9d3dd8b0b1ca8bcf1ea. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
