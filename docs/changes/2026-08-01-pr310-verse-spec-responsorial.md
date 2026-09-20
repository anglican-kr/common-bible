---
date: 2026-08-01
pr: 310
branch: feat/verse-spec-responsorial
title: "feat: 계응 조판 렌더 + 절 인스턴스 식별 수리 (ADR-038 A2)"
---

# feat: 계응 조판 렌더 + 절 인스턴스 식별 수리 (ADR-038 A2)

전례독서 뷰(A3)의 렌더 기반을 깐다. ADR-039 가 "표시는 앱 몫"으로 남긴 전례 표기를 구현하고, 그 과정에서 드러난 **절 유실 결함**을 함께 고친다.

## 1. 계응 조판 (ADR-039 → ADR-038 §3)

저장 형식에는 전례 글리프가 없다(자판 입력이 어려워서) — `appendVerses` 가 표시할 때 복원한다.

| 저장 | 표시 |
| --- | --- |
| segment `response: true` | 응답 반행 시각 구분 + 선창 끝 `◯` |
| verse `versicle: true` | 절 번호 대신 `¶`(번호를 물려받은 구절이라 자기 번호가 없다) |
| verse `section: N` | 인쇄본 그대로 `(N)` 가운데 소제목 |

`◯` 는 **응답이 실제로 따라오는 선창 줄에만** 붙는다(ADR-039 "마지막 아닌 홀수 줄"). 영광송 상수 부착은 A3 에서 — 편 낭송 끝 1회이므로 발췌 단위가 정해지는 자리가 그쪽이다.

## 2. 절 인스턴스 식별 수리 (예정에 없던 선행 과제)

절 부분집합 렌더의 중복 제거 키가 `number + part + lxx_only` 뿐이어서 **같은 번호를 가진 절이 첫 하나만 남고 조용히 버려졌다.**

- **77개 장에서 130절 유실** — 전례시편 69편의 무번호 `¶` 구절(앞 절 번호를 물려받는다), 그리스어 에스델 4장의 추가 본문 31절(전부 `number:17` 아래).
- 이 상태로 독서 뷰를 얹으면 시편의 `¶` 구절이 화면에서 사라진 채로 굳는다.

**번호는 절의 정체가 아니다.** `verse-spec.js` 에 인스턴스 키를 두어 번호·반절·`alt_ref`·`lxx_only`·`versicle`·`chapter_ref` 를 모두 담고, 중복 제거와 DOM id 가 같은 키를 쓴다. 키는 **장 전체 목록**에서 계산해 어느 발췌에서든 같은 절이 같은 키를 받는다.

원본에 중복 마커가 찍힌 5개 장(욥 32:9 · 1역대 6:33 · 집회 29:15 · 애가 1:10 · 토비 11:15)은 순번 폴백으로 처리 — 데이터 결함이 **절 유실이 아니라 이상한 id** 로 degrade 한다. 이 5건은 데이터 저장소 과제로 별도 보고한다.

**부수 수정:** 딥링크 스크롤이 정확한 id 를 못 찾으면 번호가 맞는 첫 span 으로 폴백한다 — `/job/27/24`·`/hos/14/14`·`/dan/3/24` 가 종전엔 조용히 아무 일도 하지 않았다(그 절들이 인스턴스 한정 id 로 렌더되기 때문).

## 3. 공유 함수 승격 (ADR-038 §3 명시)

`bookmark-read.js` 의 `_specCoversVerse`·`_chapterMaxVerse` → `verse-spec.js`. 전례독서 뷰가 같은 필터를 복제하지 않게 한다.

## 검증

- **유닛 12건 신설** `tests/unit/verse-spec.test.js` — spec 멤버십·장 최대 절·인스턴스 키 6종 구분·전례시편 23편 7절 전수·에스델 5절 전수·중복 마커 순번. (이관된 2건은 bookmark-read.test.js 에서 이동.)
- **e2e 8건 신설** `tests/e2e/test_liturgical_render.py` — 계응(◯ 7개·응답 7개)·`¶` 1개·`v4`↔`v4_v` id 분리·부 `(1)(2)`·송가·에스델 48 span id 유일·교차참조 딥링크 하이라이트·발췌 렌더 7절(종전 6절)·일반 장 무회귀.
- 유닛 **808** · e2e **223**(axe 모듈 미설치로 test_a11y_axe 제외) · `tsc --noEmit` 통과.

## 남은 것

`data-vref`(북마크 저장 문법)는 아직 번호 단위다. 에스델 하위 절 표기(`17_12-16`)는 ADR-010 verseSpec 문법 확장이 필요해 후속 — 북마크 데이터와 URL 문법을 함께 건드리는 변경이라 이 PR 에서 갈랐다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Core rendering and dedupe logic for all chapter and bookmark-read paths changed; regression risk is mitigated by broad unit/e2e coverage but duplicate-number edge cases are subtle.
> 
> **Overview**
> Implements **ADR-038 A2** render groundwork for lectionary psalms/canticles: `appendVerses` now restores liturgical glyphs that are not stored in JSON—response lines styled distinctly, cantor lines get `◯` only when a response follows, unnumbered follow-ups show `¶` instead of a verse number, and long psalms get centered `(N)` section headings. Matching **CSS** adds `.verse-response`, `.responsory-mark`, `.versicle-mark`, and `.psalm-section`.
> 
> Fixes a **silent data-loss bug** in subset rendering (bookmark read view and shared path): dedupe and DOM ids no longer key only on `number+part+lxx_only`. **`verse-spec.js`** gains `verseInstanceKey` / `verseInstanceKeys` (plus exported `specCoversVerse` and `chapterMaxVerse` moved from `bookmark-read.js`) so verses that share a number—liturgical `versicle` clauses, Greek Esther `alt_ref` blocks, LXX-only pairs—all render. **`findVerseAnchor`** in `views.js` falls back to the first span with a matching `data-vref` when instance-qualified ids block `getElementById`, fixing deep links like `/job/27/24`.
> 
> Types document new `response`, `versicle`, and `section` fields; ADRs and `docs/status.md` record completion. **Tests:** new `verse-spec.test.js` (12 cases) and `test_liturgical_render.py` (8 e2e). Bookmark `data-vref` grammar is explicitly out of scope.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit c8904efd02408efbf8cfc39b15ebf15de0419420. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
