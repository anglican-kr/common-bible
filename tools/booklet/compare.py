#!/usr/bin/env python3
"""책자(parse_booklet_*.py 산출) ↔ 엔진 덤프(engine-dump.mjs 산출) 대조 → 보고서. 인자: <booklet.json> <engine.json> <report.md> <detail.json>

슬롯(제1독서 · 시편 · 제2독서 · 복음)별로 책자의 「또는」 대안 집합과 엔진이 초기 선택 관측일에 내는 트랙 · 세트 전체 집합을 비교한다.
판정: = 같음 · ⊂/⊃ 대안 수 차이 · ≈ 표기만(절 집합 동치 포함) · other 책자가 다른 후보(평일 등)의 독서 · partial/≠ 실질 불일치.
이름 · 이동 표기 · 색은 보조 표로 낸다(축성일 · 사계재 · 공휴일은 엔진 범위 밖이라 잡음이 섞인다)."""
import json, re, sys, collections
BK, EN, OUT, DET = sys.argv[1:5]
booklet = {x["date"]: x for x in json.load(open(BK, encoding="utf8"))}
engine = {x["date"]: x for x in json.load(open(EN, encoding="utf8"))}
SLOTS = ["first", "psalm", "second", "gospel"]

def norm(s):
    s = re.sub(r"[–—‐‑−]", "-", s); s = re.sub(r"\s+", "", s); return s.strip(",;")
def loose(s):
    """표기 차이만 지운다 — 쉼표 등 구분자는 남긴다(「1:1,3」≠「1:13」). 괄호 선택 절 「(1-9)10-18」 = 「1-9, 10-18」 은 verse_set 이 구조로 판정한다."""
    s = norm(s); s = re.sub(r"(?<=\d)[상하]", "", s); s = re.sub(r"[\[\]()]", "", s); s = s.replace(".", ""); return s.rstrip("/").lower()
ONE_CHAPTER = {"유다", "필레", "2요한", "3요한", "오바"}
def verse_set(s):
    """「책 장:절-절, 절; 장:절」 → {(장, 절)} — 같은 장 안의 범위만 전개한다(장을 넘는 범위는 글자 그대로).
    괄호(선택 절 「1:(1-9)10-18」 · 「1:1-4(5-10)11-14」)는 구분자로 읽어 쉼표 표기 「1:1-9, 10-18」 과 같은 집합이 된다."""
    s = norm(s); s = re.sub(r"(?<=\d)[상하]", "", s); s = re.sub(r"[\[\]()]", ",", s); s = re.sub(r"[A-Za-z.]", "", s)
    m = re.match(r"^(\d?[가-힣]+)(.*)$", s)
    if not m: return None
    book, rest = m.group(1), m.group(2)
    if not rest: return (book, frozenset())
    if ":" not in rest:
        if book in ONE_CHAPTER: rest = "1:" + rest
        elif re.fullmatch(r"\d+", rest): return (book, frozenset({("ch", int(rest))}))
        else: return None
    out = set(); ch = None
    for tok in rest.split(","):
        if not tok: continue
        if ":" in tok:
            a, b = tok.split(":", 1)
            if "-" in a or not a.isdigit(): return None
            ch = int(a); tok = b
            if not tok: continue   # 「2:(1-7)8-20」 → 「2:,1-7,8-20」 의 빈 첫 토큰
        if ch is None: return None
        if re.fullmatch(r"\d+", tok): out.add((ch, int(tok)))
        elif re.fullmatch(r"\d+-\d+", tok):
            x, y = map(int, tok.split("-"))
            if y < x: return None
            out.update((ch, v) for v in range(x, y + 1))
        elif re.fullmatch(r"\d+-\d+:\d+", tok):
            out.add(("span", tok)); ch = int(tok.split("-")[1].split(":")[0])
        else: return None
    return (book, frozenset(out))
def slot_match(bvals, label):
    """책자 대안 집합이 엔진 라벨(변형 포함)에 드는가 — 느슨 표기로, 아니면 절 집합으로."""
    ev = variants(label)
    if {loose(a) for a in bvals} <= {loose(v) for v in ev}: return True
    bv = {verse_set(a) for a in bvals}
    return None not in bv and bv <= {verse_set(v) for v in ev}
def variants(label):
    out = {label}
    for x in re.findall(r"\(([^()]*\d+[^()]*)\)", label):
        if re.search(r"\d+:\d+|^\d", x): out.add(x)
    if " / " in label: out.add(label.split(" / ")[0])
    if re.search(r"[A-Za-z]", label):
        ko = re.sub(r"[A-Za-z.]+", " ", label).strip(" /()")
        la = " ".join(re.findall(r"[A-Za-z.]+", label))
        if ko: out.add(ko)
        if la: out.add(la)
    out.add(re.sub(r"\(.*$", "", label))
    out.add(re.sub(r"\([^()\d]*\)", "", label))
    out.add(re.sub(r"^[^/]*/\s*", "", label))
    return {v.strip() for v in out if v.strip()}
def short(name):
    return re.sub(r"\s+", "", re.sub(r"\(.*?\)", "", name or "").replace("성 ", "").replace("사도 ", "").replace("복음사가 ", ""))

def engine_sets(e):
    """후보 id → 슬롯 → (정규 집합, 느슨 집합)"""
    out = {}
    for cid, groups in e["groups"].items():
        per = {k: (set(), set()) for k in SLOTS}
        for g in groups:
            for k in SLOTS:
                lab = g["slots"].get(k)
                if not lab: continue
                for v in variants(lab):
                    per[k][0].add(norm(v)); per[k][1].add(loose(v))
        out[cid] = per
    return out

def classify(B, sets, sel, slot):
    Bn = {norm(a) for a in B}; Bl = {loose(a) for a in B}
    Es, Esl = sets.get(sel, {}).get(slot, (set(), set()))
    if not Bn and not Es: return ("=", "")
    if not Bn: return ("책자 생략", "엔진 " + "|".join(sorted(Es)))
    if Bn == Es: return ("=", "")
    if Bn <= Es: return ("⊂", "책자 일부만 — 엔진 " + "|".join(sorted(Es)))
    if Bl and (Bl == Esl or Bl <= Esl): return ("≈", "표기만 — 엔진 " + "|".join(sorted(Es)))
    Bv = {verse_set(a) for a in B}; Ev = {verse_set(v) for v in Es}
    if Bv and None not in Bv and Bv <= Ev: return ("≈", "절 집합 동치 — 엔진 " + "|".join(sorted(Es)))
    others = [c for c in sets if c != sel and sets[c][slot][0] and (Bn <= sets[c][slot][0] or Bl <= sets[c][slot][1])]
    if others: return ("other", ",".join(others))
    if Es and Es <= Bn: return ("⊃", "책자가 더 — " + "|".join(sorted(Bn - Es)))
    allL = set().union(*[sets[c][slot][1] for c in sets]) if sets else set()
    allN = set().union(*[sets[c][slot][0] for c in sets]) if sets else set()
    if Bl & allL: return ("partial", "책자만 " + "|".join(sorted(Bl - allL)) + " / 엔진 " + "|".join(sorted(Es)))
    return ("≠", "엔진(초기) " + ("|".join(sorted(Es)) or "없음") + ((" / 다른 후보 " + "|".join(sorted(allN - Es))) if (allN - Es) else ""))

RANK = {"=": 0, "책자 생략": 1, "⊂": 1, "≈": 2, "⊃": 3, "other": 4, "partial": 5, "≠": 6}
rows = []; detail = []
counts = collections.Counter()
color_rows = []; name_rows = []; transfer_rows = []; xmas_rows = []
engine_colors = collections.Counter()
for d in sorted(booklet):
    b = booklet[d]; e = engine.get(d)
    if not e or e.get("error"):   # 덤프 범위 밖이거나 엔진이 못 푼 날짜 — 집계 · 상세에만 적고 비교는 건너뛴다
        counts["엔진 없음 · 미해결"] += 1
        detail.append({"date": d, "weekday": b["weekday"], "names": b["names"], "status": "engine-missing", "error": (e or {}).get("error", "missing"), "flags": b["flags"]})
        continue
    sets = engine_sets(e)
    sel = e["view"]["initial"] if e["view"] else (e["official"]["id"] if e["official"] else None)
    engine_colors[e["color"]] += 1
    rec = {"date": d, "weekday": b["weekday"], "names": b["names"], "sel": sel, "official": e["official"]["id"] if e["official"] else None,
           "candidates": [(c["id"], c["status"], c.get("from"), c.get("to")) for c in e["candidates"]], "slots": {}, "flags": b["flags"]}
    if b["no_eucharist"]:
        counts["감사성찬례 없음(책자)"] += 1; rec["status"] = "no-eucharist"; detail.append(rec); continue
    if not b["sets"]:
        counts["파싱 실패"] += 1; rec["status"] = "parse-fail"; detail.append(rec); continue
    if len(b["sets"]) > 1:   # 성탄
        for s in b["sets"]:
            best = None
            for cid, groups in e["groups"].items():
                for g in groups:
                    ok = all((not s["slots"].get(k) and not g["slots"].get(k)) or
                             (s["slots"].get(k) and g["slots"].get(k) and slot_match(s["slots"][k], g["slots"][k]))
                             for k in SLOTS)
                    if ok: best = (cid, g.get("note"), g.get("set"), g.get("id"))
            xmas_rows.append((d, s["note"], best, s["slots"]))
        rec["status"] = "christmas"; detail.append(rec); continue
    s = b["sets"][0]
    worst = "="; info = {}
    for k in SLOTS:
        st, why = classify(s["slots"].get(k) or [], sets, sel, k)
        info[k] = (st, why, s["slots"].get(k) or [])
        if RANK[st] > RANK[worst]: worst = st
    rec["slots"] = info; rec["status"] = worst
    counts[worst] += 1
    detail.append(rec)
    if worst != "=":
        rows.append(rec)
    # 색
    bc = set(b["colors"])
    ec = {e["color"]} | set(e.get("colors") or []) | {c["color"] for c in e["candidates"] if c.get("color")}
    if e.get("colorAlt"):
        alt = e["colorAlt"]; ec |= set(alt if isinstance(alt, list) else [alt])
    if bc and (not bc <= ec or e["color"] not in bc):
        color_rows.append((d, b["weekday"], sorted(bc), e["color"], sorted(ec - {None}), b["names"][:3]))
    # 이름 · 이동
    moved = {}
    prev = None
    for n in b["names"]:
        m = re.search(r"\((\d{1,2})/(\d{1,2})에서 이동\)", n)
        if m:
            key = re.sub(r"\(.*?\)", "", n).strip() or prev
            moved[key] = f"{d[:4]}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        prev = re.sub(r"\(.*?\)", "", n).strip() or prev
    ecands = [c for c in e["candidates"] if not c["id"].startswith("grid:") and not re.match(r"^t-(동|춘|하|추)계재$", c["id"])]
    enames = {c["id"]: short(c["name"]) for c in e["candidates"]}
    unmatched_b = []
    for n in b["names"]:
        nn = short(n)
        if not nn or "축성" in n or "축복" in n or "에서 이동" in n or n.startswith("("): continue
        if not any(nn in en or en in nn for en in enames.values() if en): unmatched_b.append(n)
    unmatched_e = [c["id"] for c in ecands if c["status"] in ("proper", "transferred_in") and not any((enames[c["id"]] in short(n) or short(n) in enames[c["id"]]) for n in b["names"] if short(n))]
    if unmatched_b or unmatched_e:
        name_rows.append((d, b["weekday"], unmatched_b, unmatched_e, [c["id"] for c in e["candidates"]]))
    ein = {c["id"]: c["from"] for c in e["candidates"] if c["status"] == "transferred_in"}
    for key, frm in moved.items():
        hit = [cid for cid, f in ein.items() if f == frm]
        if not hit: transfer_rows.append((d, f"책자: {key} ({frm}에서) — 엔진에 그 날짜에서 온 후보 없음", [f"{cid}←{f}" for cid, f in ein.items()]))
    for cid, frm in ein.items():
        if frm not in moved.values(): transfer_rows.append((d, f"엔진: {cid} ← {frm} — 책자에 이동 표기 없음", b["names"][:4]))

json.dump(detail, open(DET, "w", encoding="utf8"), ensure_ascii=False, indent=0)
L = []
L.append(f"# 2027 전례독서 책자(검토용) ↔ 엔진 대조\n")
L.append(f"범위 {min(booklet)} ~ {max(booklet)} — {len(booklet)}일. 엔진 색 어휘: {dict(engine_colors)}\n")
L.append("## 집계 (감사성찬례 독서, 날짜별 최악 슬롯)\n")
for k, v in sorted(counts.items(), key=lambda x: -x[1]): L.append(f"- {k}: {v}")
L.append("\n## 독서 불일치 (≠ · partial)\n")
L.append("| 날짜 | 요일 | 책자 관측일 | 엔진 초기 선택 | 슬롯 | 책자 | 비고 |\n|---|---|---|---|---|---|---|")
for r in rows:
    if r["status"] not in ("≠", "partial"): continue
    for k in SLOTS:
        st, why, bv = r["slots"][k]
        if st in ("≠", "partial"): L.append(f"| {r['date']} | {r['weekday']} | {' · '.join(r['names'][:3])} | {r['sel']} | {k} | {' 또는 '.join(bv)} | {st} {why} |")
L.append("\n## 책자가 다른 후보의 독서를 실은 날 (other)\n")
L.append("| 날짜 | 요일 | 책자 관측일 | 엔진 초기 선택 | 슬롯 | 일치한 후보 |\n|---|---|---|---|---|---|")
for r in rows:
    if r["status"] != "other": continue
    ks = [k for k in SLOTS if r["slots"][k][0] == "other"]
    oc = r['slots'][ks[0]][1].split(",")[0]
    prec = next((c["precedence"] for c in engine[r["date"]]["candidates"] if c["id"] == r["sel"]), None)
    L.append(f"| {r['date']} | {r['weekday']} | {' · '.join(r['names'][:3])} | {r['sel']} (prec {prec}) | {','.join(ks)} | {oc} |")
L.append("\n## 표기 차이 · 대안 수 차이 (≈ · ⊃ · ⊂ · 책자 생략)\n")
L.append("| 날짜 | 요일 | 책자 관측일 | 슬롯 | 책자 | 비고 |\n|---|---|---|---|---|---|")
for r in rows:
    if r["status"] not in ("≈", "⊃", "⊂", "책자 생략"): continue
    for k in SLOTS:
        st, why, bv = r["slots"][k]
        if st != "=": L.append(f"| {r['date']} | {r['weekday']} | {' · '.join(r['names'][:3])} | {k} | {' 또는 '.join(bv)} | {st} {why} |")
L.append("\n## 쪽 바닥에 따로 찍힌 이름 (날짜에 못 묶음)\n")
for d in sorted(booklet):
    if booklet[d].get("page_names"): L.append(f"- {d} 쪽 끝: {booklet[d]['page_names']}")
L.append("\n## 성탄 (책자 세트 ↔ 엔진 세트)\n")
for d, note, best, sl in xmas_rows: L.append(f"- {d} {note}: {'일치 — ' + str(best) if best else '불일치 — ' + json.dumps(sl, ensure_ascii=False)}")
L.append("\n## 이동 표기\n")
for d, msg, extra in transfer_rows: L.append(f"- {d}: {msg} {extra}")
L.append("\n## 색\n")
L.append("| 날짜 | 요일 | 책자 색 | 엔진 대표색 | 엔진 색 집합 | 책자 관측일 |\n|---|---|---|---|---|---|")
for d, wd, bc, ec, ecs, nm in color_rows: L.append(f"| {d} | {wd} | {','.join(bc)} | {ec} | {','.join(ecs)} | {' · '.join(nm)} |")
L.append("\n## 관측일 이름 (책자에만 / 엔진에만)\n")
for d, wd, ub, ue, cands in name_rows: L.append(f"- {d} {wd}: 책자만 {ub} · 엔진만 {ue}")
open(OUT, "w", encoding="utf8").write("\n".join(L) + "\n")
print("\n".join(L[:12]))
print(f"rows: 불일치 {sum(1 for r in rows if r['status'] in ('≠','partial'))} · other {sum(1 for r in rows if r['status']=='other')} · 표기 {sum(1 for r in rows if r['status'] in ('≈','⊃','⊂','책자 생략'))} · 색 {len(color_rows)} · 이름 {len(name_rows)} · 이동 {len(transfer_rows)}")
