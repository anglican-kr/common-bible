---
pr: 333
date: 2026-09-20
branch: docs/engine-canon-1-fixtures
title: "docs: 교회력 엔진 정본 지도 ① — §1.4 번호 규약 · R- 정본 마커 · §7 실제 연도 기대값을 픽스처로 · 스냅샷·crossref 테스트"
---

# docs: 교회력 엔진 정본 지도 ① — §1.4 번호 규약 · R- 정본 마커 · §7 실제 연도 기대값을 픽스처로 · 스냅샷·crossref 테스트

**리팩터 전용 · 사실 변경 0(스냅샷 첨부).** 리뷰는 **논리적 모순만** 반영한다(사용자 결정 2026-09-20 — 문서 PR 의 Copilot 지적은 모순만, 나머지는 구현하면서 고친다). 리뷰 2회 상한.

## 요약

교회력 설계 문서 리팩토링 「한 사실은 한 곳에」(2026-09-20 승인, PR ⓪~④)의 **①**. 같은 사실이 최대 20곳에 재진술돼 결정이 바뀔 때마다 나머지가 어긋나던 것을, 사실 종류마다 정본을 한 곳에 두고 나머지는 번호로 가리키는 구조로 바꾸는 첫 단계다. **내용(사실)은 바꾸지 않는다 — 구조만.** § 번호 · 미결 번호 · C-/X-/I-/Q id 는 하나도 바꾸지 않았다.

- **설계서 §1.4 「정본 지도」 신설** — 사실 종류 → 정본 위치 표, `R-<§>-<slug>` 정본 마커 규약, 번호 부여 규약 표(§ · 미결 · C/C-P · I · X · Q(폐지 예정) · R · 픽스처 id · 동그라미 · PR/#), 적용 단계 안내. 다른 절 번호는 그대로(말미 추가).
- **정본 마커 12개 발급** — 설계서 §4.5 · §6.1 · §6.2 · §6.4 · §6.5 의 정본 문장 앞에 `**[R-…]**` 를 한 번씩: `R-4.5-baptism-ordinary-1` · `R-6.1-ladder` · `R-6.1-ineligible` · `R-6.1-prec7-omit` · `R-6.1-prec7-tie-pairs`(§6.1 표 아래 한 문단 신설 — 5쌍 목록의 정본 자리, 잠정 미결6) · `R-6.2-destinations` · `R-6.2-nearby-sunday` · `R-6.2-chain-model` · `R-6.2-tie-ladder` · `R-6.4-color-order` · `R-6.4-ember-color`(잠정 미결26 표시) · `R-6.5-year-pass`. 참조 교체는 §7 안에서만(최소).
- **§7 실제 연도 기대값 → 픽스처** — `tests/fixtures/liturgical/{transfers,optionals,winners}.cases.json` **82 케이스**(31 · 24 · 27; confirmed 70 · provisional 10 · skip 2) + `README.md`(스키마 · id 규칙 · 소비 방법 — 검토 문서 부록 B 채택·확장). §7 의 이동 패스 행 ①~⑤·⑦·⑩ · B1 행 · 사계재 행 ④ · 주의 세례 행은 케이스 id 포인터로 바꾸고, 합성 표 케이스(⑥ 연도 경계 · ⑦ 좌석 경합 · 떠난 패자 제외 · 켜진 출발 · ⑨ 상한)와 ⑧ 불변식, 사계재 ①②③(계산·조인)은 **원문 그대로** 남겼다. 표 앞에 픽스처 파일 ↔ 케이스 id 표를 두었다. §8 PR 3 행에 「§7 픽스처 소비」를 더했다.
- **테스트 둘** — `tests/unit/liturgical-fixtures.test.js`(7: JSON · id 유일·규칙 · 날짜 실재 · `displacedBy` 생략부호 금지 · status/kind 도메인 · `canon`·`checks`·`issue` 앵커 실재 · 관측일 id 실데이터 실재(`data/` 없으면 그 1건 skip)) · `tests/unit/docs-crossref.test.js`(10: 5문서 + status/architecture 의 `§`·`미결`·`C/X/I/Q`·`R-`·픽스처 참조 해석, 설계서 § 헤딩 집합·§9 항목 1..33·ADR 미결 수 불변, R- 1회 정의; 센티널 · 동그라미 · Qn · ADR 미결 참조 · 편집 원칙 5건은 PR ②~④ 게이트로 skip). 한정어 없는 참조는 경고(334건)로만 낸다 — ②~④ 에서 보강.
- **`scripts/docs_facts_snapshot.py`**(stdlib) — 5문서 + 픽스처(JSON 문자열 값)에서 날짜 · 월일 · 건수 · 관측일 id · prec · transfer_to · 색 · 미결 · § · C/X/I/Q/R · 픽스처 id · PR 번호를 뽑아 리비전 간 합집합을 비교한다. 「사라진 토큰 0」이 매 PR 의 통과 조건. 월.일 → ISO 날짜 형태 변환과 픽스처 전용 새 토큰(전사)은 따로 센다.
- `tests/README.md`(파일·케이스 수, 두 테스트 행) · `CLAUDE.md`(895 케이스) · `docs/index.md`(교회력 행에 픽스처 README).

## 확정·근거

- 없음 — 리팩터. 적용한 사용자 결정(2026-09-20): 설계서는 한 파일 유지 · 번호 불변 · §7 기대값은 JSON 픽스처 · 번호 규약 문서화.
- **픽스처 대응표(종전 §7 묶음 → 케이스)** — 사람이 한 번 대조할 것(계획 「검증 5」). 원문은 `git show main:docs/design/liturgical-engine.md` §7.

| 종전 §7 | 케이스 |
|---|---|
| 이동 패스 ① 안드레아 · 바울로 회심(+ 본문 조회 단언) | T-2025-12-01-andrew · T-2026-01-26-paul-conversion |
| ①b 니콜라 12.7(암브로스 `omitted` · 색 백 · 기원 독서 · 공통 pastor) | T-2026-12-07-nicholas |
| ② 성탄 3축일 연쇄(2025 · 2026 · 2027 + 반대 모델 회귀 + 12.26 주일 해) | T-2025-12-29-holy-innocents · T-2026-12-28-john-chain · T-2027-12-27-christmas-triad(`alsoYears` 2032·2038·2049) |
| ③ 마티아 · 성모 방문 · 안나와 요아킴 · 마르코 2025 · 수태고지 2027 · 마르코 2038 + 필립보·야고보 · 요셉 2035(2046) 선착순 · 수태고지 2029(2040) 최장 · 설립 기념일 무이동(2050 추석) | T-2026-05-15-matthias · T-2026-06-01-visitation · T-2026-07-27-anna-joachim · T-2025-04-28-mark · T-2027-04-05-annunciation-maundy-thursday · T-2038-05-03-mark-easter-day · T-2035-04-02-joseph-first-come · T-2029-04-09-annunciation-palm-sunday · T-2050-09-29-founding-day-co-observed |
| (검토 문서 C-6.5-8 · C-6.5-14 만 있던 것) 2043 수태고지 · 2027 성모안식·한국 순교자 무이동 | T-2043-04-06-annunciation · W-2027-08-15-assumption-on-sunday · W-2027-09-26-korean-martyrs-on-sunday |
| ④ 추석 2040 마태오 · 설 2049 봉헌 · 재의 수요일 2032(skip 미결13) | T-2040-09-22-matthew-chuseok · T-2049-02-03-presentation-seollal · T-2032-02-12-ash-wednesday-seollal |
| ⑤ 동률(잠정) 성체 ∧ 방문 2029·2040 · 성체 ∧ 세례 요한 2038 | T-2029-06-01-visitation-vs-corpus-christi · T-2038-06-25-john-baptist-vs-corpus-christi |
| ⑦ 승천 optional · 공현 2030 없음 · 변모 nearby(2026·2024·2025 · 주일 해 없음) · 봉헌 2028·2034 경계 · 활성화(2028 · 2049 · 2030 설 · 승천 2026) | O-2026-05-17-ascension · O-2030-01-06-epiphany-on-sunday · O-2026-08-09-transfiguration · O-2024-08-04-transfiguration · O-2025-08-03-transfiguration · O-2028-08-06-transfiguration-on-sunday · O-2028-01-30-presentation · O-2034-02-05-presentation · A-2028-01-30-presentation-activated · A-2049-01-31-presentation-activated · A-2030-02-03-presentation-vs-seollal · A-2026-05-17-ascension-activated |
| (검토 문서 C-6.2-2·3·10 만 있던 것) 모든 성인 2026 없음 · 봉헌 2031 없음 · 변모 활성화 | O-2026-11-01-all-saints-on-sunday · O-2031-02-02-presentation-on-sunday · A-2026-08-09-transfiguration-activated |
| ⑩ 2024·2025 책자 — 도착 넷 · 승자 셋 · 선택 다섯 · 미결28·31 도착 넷 + 변모 2024 · 주일 밖 2033 | T-2025-06-30-peter-paul · T-2025-08-25-bartholomew · T-2025-09-15-holy-cross · T-2025-09-22-matthew · W-2025-02-02-presentation-over-sunday · W-2024-09-29-michael-over-sunday · W-2025-03-25-annunciation-lent-tuesday · O-2024-01-07-epiphany · O-2024-02-04-presentation · O-2024-05-12-ascension · O-2024-11-03-all-saints · O-2025-11-02-all-saints · T-2024-09-09-nativity-of-mary · T-2024-12-09-immaculate-conception · T-2025-11-03-all-souls · T-2033-09-09-nativity-of-mary-chuseok |
| 「미결32·33 이 정해지면 더한다」 | T-2024-04-08-annunciation-holy-monday(skip 미결32) — 2023-12-13 동계재는 계산 케이스라 §7 사계재 ④ 문장으로 남김 |
| B1 이천환 서품일 ∧ 하계재 · 김희준 ∧ 동계재 · 세계평화 기도일 | W-2026-05-27-ember-ordination · W-2024-12-21-ember-ordination-kim · W-2026-01-01-peace-day-commemoration |
| 사계재 ④ 2026-05-27 색 녹(잠정) · 2025-12-17 · 2026-09-16 니니안 · 2024-12-20 두 세트 | W-2026-05-27-ember-color · W-2025-12-17-ember-color · W-2026-09-16-ninian-ember · W-2024-12-20-ember-friday-two-sets |
| (검토 문서 C-6.4-3 · §9 미결16·25·26·29·30 만 있던 것) 추계재 9.18 · 춘계재 2.25 · 데오도르 9.19 · 루시아 12.13 · 크리소스톰 9.13 · 토마스 모어 7.6 · 성 십자가 발견 5.3 · 사베리오 2023-12-03 · 설날 2025 · 추석 2025 · 추석 2026 미준수 · 마티아·어린이들·보니파스 색 | W-2026-09-18-ember-color · W-2026-02-25-ember-color · W-2026-09-19-theodore-ember · W-2026-12-13-lucia-on-sunday · W-2026-09-13-chrysostom-on-sunday · W-2025-07-06-thomas-more-on-sunday · W-2026-05-03-finding-of-cross-on-sunday · W-2023-12-03-xavier-on-advent-1 · W-2025-01-29-seollal · W-2025-10-06-chuseok · W-2026-09-25-chuseok-not-in-booklet · W-2026-05-15-matthias-color · W-2025-12-29-holy-innocents-color · W-2026-06-05-boniface-color |
| 주의 세례 = 연중 1주일 행의 `official` 단언 | W-2026-01-11-baptism-of-the-lord(행은 남기고 포인터만 더함) |

- **문서에 없어 비워 둔 값**(PR 3 에서 엔진 계산값을 검증한 뒤 채운다): 루가 2026-10-19 의 `displacedBy`(연중 주일 주간 번호가 문서에 없다) · 2038 마르코·필립보·야고보 · 2043 수태고지 · 2035 수태고지의 `displacedBy`.
- **문서 서술에서 직접 도출해 적은 값**(리뷰에서 확인 대상): 2025-12-28 · 2026-12-27 · 2027-12-26 의 격자 id `grid:christmas-1-sunday`(검토 문서 부록 B 예시와 같은 규칙) · 격자 평일 id `grid:advent-2-weekday-mon` · `grid:ordinary-31-weekday-mon` · `grid:ordinary-25-weekday-fri`(설계서 §5.5 형식) · `grid:easter-5-sunday`(2026-05-03 「부활 5주일」) · 마티아 `displacedBy: t-승천대축일` · 성모 방문 `t-성삼위일체대축일` · 성체일 케이스 `t-그리스도의-성체일` · 명절 케이스 `lunar11-설날`·`lunar815-추석-명절` · 사베리오 2023-12-03 `displacedBy: t-대림1주일`(안드레아와 같은 사다리) · 피데스 2025-10-06 · 키프리안 2025-09-15 의 `omitted`+`displacedBy` · 2026-06-02(관측일 없는 평일) 색 녹.

## 검증

- `node --test tests/unit/*.test.js` — **895 케이스(890 통과 · 5 skip = ②~④ 게이트 · 0 실패)**, 기준선 878. `docs-data-consistency` 의 facts 대조 포함(로컬 `data/` 있음).
- **사실 변경 0 증명** — `python3 scripts/docs_facts_snapshot.py --diff main HEAD --allow-new '^2026-09-20$' --allow-new '^§1\.4$' --allow-new '^#329$' --allow-new '^data#26$' --allow-new '^§5\.11$'`:
  - 사라진 토큰 **0**.
  - 형태 변환 11(§7 의 「→ 04.28」류 월.일이 픽스처 ISO 날짜로): 02.03 → 2030-02-03·2049-02-03 · 02.12 → 2032-02-12 · 04.02 → 2035-04-02 · 04.03 → 2035-04-03 · 04.05 → 2026-04-05·2027-04-05 · 04.09 → 2029-04-09 · 04.28 → 2025-04-28 · 05.04 → 2038-05-04 · 05.14 → 2026-05-14 · 05.15 → 2026-05-15 · 06.01 → 2025-06-01·2026-06-01·2029-06-01.
  - 문서에 생긴 새 토큰: R- 마커 12종 · 픽스처 id 82종 · `2026-09-20`(§1.4 날짜) · `§1.4`(새 절) · `#329` `data#26` `§5.11`(§1.4 번호 규약 표의 **참조 형식 예시** — 사실 아님).
  - 픽스처에만 생긴 새 토큰(전사) 105: ISO 날짜 47 · 관측일 id 53 · 월일 1 · § 4 — 관측일 id 53종은 `liturgical-fixtures.test.js` 가 실데이터 실재를 확인.
- §5.2 ```facts 블록 바이트 동일(`diff` 0) · `### ` 헤딩 30 → 31(§1.4 만) · §9 항목 33 불변 · 검토 문서·ADR 3종 무변경(`git diff --stat`).
- 체크리스트: [x] 스냅샷 diff(사라진 토큰 0) [x] 새 토큰 설명 [x] 번호 변경 0 [x] facts 블록 diff 0 [x] 발견한 모순 목록(아래, 수정 안 함) [x] 「논리적 모순만 반영」 리뷰 규칙 명시.
- 200줄 규칙(CLAUDE.md 「지식 베이스 루프」 3)과 단일 파일 결정의 충돌 — **의도된 예외**(사용자 결정 ①: 설계서는 한 파일, §참조 772건·C-ID 가 엔진 §번호를 품는다).

## 발견한 모순 (수정 안 함 — 후속 PR ②~④ 로)

- 설계서 §9 미결27 본문에 「facts 블록 `sanctoral.minor_feast = 96` 을 95 로 고친다」 경위가 남아 있다 — 실제 블록은 #330 에서 95 가 됐다(닫힘 항목 압축 때 정리, ②).
- 설계서 §9 미결27 의 「(§5.16 게이트)」는 검토 문서 §5.16 인데 한정어가 없다(crossref 가 경고로 잡음, ②).
- ADR-037 §1 개정 ④ 의 「§10 "잠정 순번 id 금지"」는 ADR-036 §10 인데 한정어가 없다(④).
- 검토 문서 부록 A·B 는 「(제안)」 · 위치 `tests/unit/fixtures/…` 로 남아 있다 — 채택 위치는 `tests/fixtures/liturgical/`(③ 에서 포인터로).
- 검토 문서 §6 Q11 은 「닫힘 2026-09-18」인데 표에 남아 있다(③ 에서 Q 폐지 · §9 사제 뷰로).
- 한정어 없는 §/미결 참조 334건(검토 문서가 자기 §3·§4 와 설계서 §3·§4 를 같은 번호로 부른다) — 오해석 위험, ②~④ 에서 문서명 한정어 보강.
- `CLAUDE.md` 「프로젝트 구조」 `scripts/` 행에 `docs_facts_snapshot.py` 를 더해야 하나 PR ⓪ 이 같은 줄을 고치므로 ② 로 미룬다.

## 갱신한 문서

- `docs/index.md` — 교회력 행에 픽스처 README 와 「§1.4 정본 지도부터」.
- `tests/README.md` — 유닛 파일·케이스 수(28 · 895), `docs-crossref.test.js` · `liturgical-fixtures.test.js` 행, 픽스처 안내 한 문장.
- `CLAUDE.md` — 유닛 케이스 수 895(2026-09-20).
- `docs/status.md` — 없음 — 구현 현황 불변(문서 구조 변경 안내는 ④ 에서 한 줄).

## 리뷰 반영 (2026-09-21, 1회차)

자체 리뷰(Copilot 리뷰 전). 지적은 전사된 데이터가 아니라 **①이 만든 장치**에 몰렸다 — 82 케이스의 요일 · `nearby_sunday` 경계 · 부활 상대일 · RCL 주기 · 미결30 확정/잠정 구분을 리팩터링 전 §7 본문과 대조했을 때 어긋난 곳은 없었고, 설계서의 픽스처 id 참조 82개도 케이스와 1:1 이었다. 고친 것은 그 데이터를 지키기로 한 게이트·도구 쪽이다(`f16bc5d`).

**차단 — PR ② 가 게이트를 켤 수 없었다.** §1.4 정본 지도는 규약을 **예시로 인용**한다: 사실→정본 위치 표가 `` ```facts `` 를 적고(설계서 출현 1 → 2), 번호 규약 표가 「❌ `X-10 ②`」 · 「`§6.2 ④` · `§7 ⑩`」을 반례로 적는다. `GATES.sentinels`(`` ```facts `` `once: true`) 와 `GATES.circledRefs` 는 이 줄들을 그대로 문다 — ②가 지울 수 있는 문장이 아니라 규약을 정의하는 행이므로 켜는 순간 영구 실패였다. **해결: 표기 금지 게이트 넷(sentinels · circledRefs · qRefs · adrIssueRefs)이 §1.4 줄 범위를 건너뛴다.** 예외가 조용히 커지면 게이트가 죽으므로, 범위가 실재하고 `### 1.4 ` 에서 시작하며 60줄을 넘지 않는지 보는 테스트를 **항상 켜 둔 채로** 더했다(crossref 11번째). 게이트를 임시로 켜 확인: `` ```facts `` 지적이 사라지고 동그라미 지적의 첫 줄이 69행 → 92행으로 밀렸다(남은 실패는 ②가 지울 실제 중복).

**`scripts/docs_facts_snapshot.py` — 「사라진 토큰 0」이 못 보던 것 넷.**

- `lunar\d+-` 미수집. `lunar11-설날` · `lunar815-추석-명절` 이 8 케이스에 있는데 스냅샷 출력은 0건이었다 — ②~④ 가 설날·추석 기대값을 지워도 게이트가 통과했다. `OBS_ID_RE` 에는 `lunar` 가 있었으니 누락이 맞다.
- 「월.일 → ISO 형태 변환」 예외가 **합집합**(문서 포함)을 봤다. 아무 문서에나 같은 월·일로 끝나는 ISO 날짜가 하나 있으면 사라진 월.일을 용서하고 「픽스처에 살아 있음」이라고 **검증하지 않은 문장**을 찍었다 → 픽스처 날짜로 한정.
- 굵게 표시 미제거. `grid:christmas-**1**-sunday` 가 `grid:christmas-` 로 잘렸고 `**96**건` 류 건수도 통째로 놓쳤다 → 토큰화 전에 `**` 를 지운다.
- `pr` 토큰 미정규화. 「PR #333」 · 「#333」 · 「data PR #26」 · 「data#26」이 서로 다른 토큰이라 표기만 바꿔도 게이트가 죽었고, `\d{2,4}\b` 라 5자리는 아예 안 잡혔다 → `#NNN` · `data#NNN` 으로 정규화.
- 죽은 `git()` 헬퍼와 `section` 의 no-op `rstrip(".")` 제거.

**테스트 — 정본을 지키지 못하던 곳.**

- 생략부호 가드 `/[…\.]{2,}|\*/` 가 2자 이상을 요구해 **홑 `…` 를 통과**시켰다(`t-…` → false). 공개 CI 엔 `data/` 가 없어 id 실재 검사도 skip 되므로 자리표시자가 「정본」에 그대로 들어갔다. → `…` 단독도 잡고, `displacedBy` 뿐 아니라 `id` · `official` · `neverDeparts` 까지 확대(픽스처 README 는 처음부터 `id` 에 「생략부호 금지」라고 적고 있었다).
- §9 미결 목록 슬라이스에 **끝 경계가 없었다**. §1.4 가 「절은 말미 추가만」을 규정했으니 §10 이 붙는 순간 그 안의 번호 목록이 미결 번호로 잡힌다. crossref 쪽 같은 추출기에는 경계가 있어 두 사본이 이미 어긋나 있었다.
- § 헤딩 불변 검사가 `Set` 을 비교해 **번호 중복을 못 잡았다**(테스트 제목은 「번호 재부여 금지」) → 목록 비교.
- `ifIssueFlips.expect` 는 객체인지만 봤다. 미결이 반대로 닫혀 `expect` 로 승격되는 순간 — 아무도 다시 읽지 않는 시점 — 에 터진다 → 단언의 `expect` 와 **같은** 검사를 받는다. 실데이터 id 검사도 함께 걷는다.
- 한정어 파싱 두 구멍: `*.md` 를 전부 external 로 넘겨 추적 대상 5문서 참조도 검사하지 않았고, 닫는 괄호(`…engine.md) §4`)는 한정어 인식에 실패해 교차 문서 참조를 자기 문서로 오해했다 → 파일명을 문서로 되돌리고 닫는 괄호를 허용(한정어 없는 참조 경고 334 → **329**).
- 위 두 결함의 원인인 **추출기 3중 사본**(JS 2 · Python 1)을 `tests/unit/helpers/docs-anchors.js` 한 벌로 모았다(Python 쪽은 앵커 해석을 하지 않는 토큰 세기 전용이라 그대로).

**픽스처 계약.** `winners.cases.json` 3곳이 `expect.readings.note` · `expect.collects.note` 에 산문을 넣었다. README 는 `expect` 전 키를 **부분집합 비교**한다고 못박았으니 PR 3 에서 소비자를 쓰는 순간 절대 일치하지 않는다 → 단언 수준 `note`(비교 대상 아님)로 옮기고, README 의 `readings` · `collects` 키 목록에서 `note` 를 빼고 단언 `note` 를 명시했다. 스냅샷으로 사실 손실 0 확인.

**문서 모순.** `CLAUDE.md` 「한 모듈 = 한 테스트 파일 — 예외는 **실데이터 의존 케이스**」가 `tests/README.md` 「예외 둘」과 어긋났다 — 이 PR 이 더한 두 테스트는 소스 모듈도 `data/` 의존도 없다. CLAUDE.md 를 「예외 둘」(실데이터 의존 · 소스 모듈 없는 테스트)로 맞추고 `tests/unit/helpers/` 안내를 더했다.

**반영하지 않은 것.**

- **스냅샷 게이트의 CI 자동화** — 매 PR `--allow-new` 를 손으로 열거하는 구조라(위 「검증」) 원장에 명령을 적어 두는 현 방식이 의도다.
- **`CLAUDE.md` `scripts/` 행에 `docs_facts_snapshot.py` 추가** — 「#332 가 머지됐으니 미룰 이유가 없다」는 지적이 왔으나, 이 브랜치는 #332 **이전**(`243bf83`) 기반이고 main 은 그 줄에 `lock_merged_ledgers.sh` 를 이미 넣었다. 여기서 고치면 충돌만 만든다 — 위 「발견한 모순」의 ② 로 미룸이 그대로 옳다.

**변이 검사 7건 — 전부 「옛 코드 통과 · 새 코드 실패」.**

| 변이 | 옛 | 새 |
|---|---|---|
| `displacedBy` 를 `t-…` 로(단언 검사만 = 공개 CI 조건) | 통과 | 실패 |
| `ifIssueFlips.expect` 에 없는 색 `violett` | 통과 | 실패 |
| `expect.readings` 에 산문 `note` 재삽입 | 통과 | 실패 |
| 설계서에 `### 6.2` 헤딩 중복 추가 | 통과 | 실패 |
| 말미에 `## 10.` 절 + 그 목록의 34번을 `미결34` 로 참조 | 통과 | 실패 |
| `lunar11-설날` id 를 산문으로 뭉갬 | 「사라진 토큰 0」 · 종료코드 0 | 토큰 지목 · 종료코드 1 |
| 검토 문서에서 「추수감사 11.15」의 날짜를 잃음 | 「11.15 → 2026-11-15 픽스처에 살아 있음」(거짓) · 0 | 「사라진 토큰 1」 · 1 |

**검증(1회차 뒤).** `node --test tests/unit/*.test.js` — **896 케이스(891 통과 · 5 게이트 skip · 0 실패)**, 위 「검증」의 895 를 대체(crossref 10 → 11). `npm run typecheck` 통과. `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE`(같은 `--allow-new` 다섯) — **사라진 토큰 0 · 허용 밖 0**, 사실 변경 0 유지. 「형태 변환」 목록은 11 그대로이되 `04.05` 의 짝이 `2026-04-05·2027-04-05` → `2027-04-05` 로 줄었다 — `2026-04-05` 는 픽스처가 아니라 문서에만 있던 날짜였다(예외를 픽스처로 한정한 결과이고, 위 「검증」의 목록을 그만큼 대체한다). `tests/README.md`(28파일 · 896케이스, crossref 11) · `CLAUDE.md`(896) 갱신.
