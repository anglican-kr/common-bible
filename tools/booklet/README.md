# tools/booklet — 「전례독서」 책자 ↔ 엔진 대조

서울교구가 해마다 내는 「전례독서」 책자(PDF)의 감사성찬례 독서를 교회력 엔진이 낸 독서와 날짜마다 대조한다.
2027 책자(검토용)로 처음 돌렸다(2026-10-13 — 원장 `docs/changes/2026-10-13-liturgical-engine-booklet-2027.md`).
책자 PDF 와 산출물은 저장소에 넣지 않는다.

```bash
# 저장소 루트에서. OUT 은 산출물 작업 폴더(커밋하지 않는다) — 안 정했으면 임시 폴더를 만든다
OUT="${OUT:-$(mktemp -d)}"; mkdir -p "$OUT"
python3 -I tools/booklet/extract.py "<책자>.pdf" "$OUT/booklet.txt"
python3 -I tools/booklet/parse_booklet_2027.py "$OUT/booklet.txt" data/books.json "$OUT/booklet.json" data/lectionary/eucharist-readings.json
node tools/booklet/engine-dump.mjs 2026-11-29 2027-12-31 "$OUT/engine.json"
python3 -I tools/booklet/compare.py "$OUT/booklet.json" "$OUT/engine.json" "$OUT/report.md" "$OUT/detail.json"
```

| 파일 | 하는 일 |
|---|---|
| `extract.py` | pypdf 로 쪽마다 텍스트를 뽑는다(`===== PAGE n =====` 표식) |
| `parse_booklet_2027.py` | 2027 책자 꼴의 텍스트를 날짜별 JSON 으로 — 감사성찬례 칸만(아침 · 저녁기도는 앱 범위 밖). 날짜 줄은 「다음에 올 날짜 + 요일 글자」로 검증하고 성탄 세 세트 · 「또는」 줄바꿈 · 반절 줄바꿈 · 쪽 바닥 이름을 따로 다룬다. **해마다 꼴이 달라** 다른 해에는 머리 주석대로 고쳐 쓴다 |
| `engine-dump.mjs` | `liturgical-engine.js` + `lectionary.js` 모델 블록을 vm 에 올려(`tests/unit/lectionary.data.test.js` 와 같은 조합) 날짜별 후보 · 독서 세트 · 뷰 초기 선택을 덤프한다 |
| `compare.py` | 슬롯별로 책자의 「또는」 대안 집합과 엔진의 트랙 · 세트 집합을 비교해 보고서(`report.md`)와 날짜별 상세(`detail.json`)를 낸다 |

판정은 날짜별 최악 슬롯으로 — `=` 같음 · `⊂` `⊃` 대안 수 차이 · `≈` 표기만(상/하 · 송가 이름 — 괄호 선택 절 「(1-9)10-18」 · 「4, 5」=「4-5」 는 절 집합으로 판정하고 쉼표 같은 구분자는 지우지 않는다) · `other` 책자가 다른 후보(평일)의 독서 · `partial` `≠` 실질 불일치. 이름 · 이동 표기 · 색 표는 보조다 — 축성일 · 사계재 · 공휴일은 엔진이 싣지 않아 잡음이 섞인다.

검토용 초안의 독서 · 색 · 이름 차이로 데이터를 고치지 않는다(사용자 결정 2026-10-13, `docs/coding-pitfalls.md` §22) — 확정판으로 다시 본다.
