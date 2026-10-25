#!/usr/bin/env python3
"""책자(parse_booklet_*.py 산출) ↔ 엔진 덤프(engine-dump.mjs 산출) 대조 → 보고서. 인자: <booklet.json> <engine.json> <report.md> <detail.json>

슬롯(제1독서 · 시편 · 제2독서 · 복음)별로 책자의 「또는」 대안과 엔진 대안(초기 선택 전례일의 트랙 · 세트에 걸친 라벨 하나하나)을
하나씩 짝짓는다 — 라벨의 변형을 한데 모은 합집합과 비교하면 송가 이름이 붙은 라벨 하나도 대안 여럿처럼 보여 ⊂ 가 된다.
판정: = 같음 · ⊂/⊃ 대안 수 차이 · ≈ 표기만(절 집합 동치 포함) · other 책자가 다른 후보(평일 등)의 독서 · partial/≠ 실질 불일치.
이름(별칭 포함) · 책자의 「…에서 이동」 표기 · 색은 보조 표로 낸다(축성일 · 사계재 · 공휴일은 엔진 범위 밖이라 잡음이 섞인다)."""
import json, re, sys, collections, datetime
BK, EN, OUT, DET = sys.argv[1:5]
booklet = {x["date"]: x for x in json.load(open(BK, encoding="utf8"))}
engine = {x["date"]: x for x in json.load(open(EN, encoding="utf8"))}
SLOTS = ["first", "psalm", "second", "gospel"]

def norm(s):
    """대시를 하나로, 공백을 지운다 — 다만 숫자 사이의 공백은 한 칸 남긴다(「1 3」 을 「13」 으로 붙이지 않는다 — 모르는 표기는
    같다고 하지 않는다)."""
    s = re.sub(r"[–—‐‑−]", "-", s); s = re.sub(r"(?<=\d)\s+(?=\d)", " ", s); s = re.sub(r"(?<!\d)\s+|\s+(?!\d)", "", s); return s.strip(",;")
def loose(s):
    """표기 차이만 지운다(상/하 · 마침표 · 대소문자) — 구분자는 지우지 않는다: 쉼표는 남기고 괄호 · 대괄호는 쉼표로 읽어
    겹친 쉼표만 줄인다(「1:(1-9)10-18」 = 「1:1-9,10-18」). 지우면 이웃 숫자가 붙어 「1:1,3」 · 「1:1(3)」 이 「1:13」 과 같아진다."""
    s = norm(s); s = re.sub(r"(?<=\d)[상하]", "", s); s = re.sub(r"[\[\]()]", ",", s); s = s.replace(".", "")
    s = re.sub(r",{2,}", ",", s).replace(":,", ":").strip(",")
    return s.rstrip("/").lower()
ONE_CHAPTER = {"유다", "필레", "2요한", "3요한", "오바"}
def sub_verse(s):
    """숫자에 붙은 괄호 · 대괄호가 앞 절을 바로 잇지 않는가 — 하위 절 번호 「에스 4:17(12-16)」(선택 절 「1-4(5-10)」 은 잇는다)."""
    return any(int(y) != int(x) + 1 for x, y in re.findall(r"(\d+)[(\[](\d+)", s))
def verse_set(s):
    """「책 장:절-절, 절, 장:절」 → {(장, 절)} — 같은 장 안의 범위는 절마다 전개하고, 장을 넘는 범위 「18:21-19:2」 는
    시작 · 끝 장과 절을 함께 담은 키 ("span", 18, 21, 19, 2) 하나로 둔다(장 길이를 모르니 전개하지 않는다 — 「18:21-35, 19:1-2」
    와는 다르게 나온다: 같다고 잘못 말하지 않는 쪽). 괄호 · 대괄호(선택 절 「1:(1-9)10-18」 · 「4:6-8, [9-16]」)는 구분자로
    읽어 쉼표 표기와 같은 집합이 된다 — 다만 숫자에 붙은 괄호가 앞 절을 바로 잇지 않으면(하위 절 번호 「에스 4:17(12-16)」)
    모르는 표기다: 구분자로 읽으면 없는 절 「4:12-16」 이 생긴다. 모르는 표기면 None — 동치 판정에 쓰지 않는다."""
    s = norm(s); s = re.sub(r"(?<=\d)[상하]", "", s)
    if sub_verse(s): return None
    s = re.sub(r"[\[\]()]", ",", s); s = re.sub(r"[A-Za-z.]", "", s)
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
        elif m := re.fullmatch(r"(\d+)-(\d+):(\d+)", tok):   # 장을 넘는 범위 — 시작 장(ch)을 키에 넣는다
            x, ech, ev = map(int, m.groups())
            if ech < ch or (ech == ch and ev < x): return None
            if ech == ch: out.update((ch, v) for v in range(x, ev + 1))
            else: out.add(("span", ch, x, ech, ev))
            ch = ech
        else: return None
    return (book, frozenset(out))
def variants(label):
    """엔진 라벨 하나의 표기 변형 — 같은 독서를 책자가 달리 적는 방식: 「출처(송가 이름)」 의 출처만 · 「송가 이름(출처)」 의
    이름만과 출처만 · 한글 / 라틴 반쪽 · 「/」 앞뒤. 괄호 안을 따로 세우는 것은 온전한 출처(책 이름 + 장:절)가 든 괄호뿐이고
    괄호 앞 토막을 세우는 것은 그 토막에 숫자가 없을 때(송가 이름)뿐이다 — 「에스 4:17(12-16), 17(23-25)」 의 「12-16」 ·
    「에스 4:17」 처럼 괄호 안 숫자(하위 절)나 숫자가 든 앞 토막은 없는 독서다."""
    out = {label}
    for x in re.findall(r"\(([^()]*)\)", label):
        if re.search(r"\d?[가-힣]+\s*\d+:\d", x): out.add(x)
    if m := re.match(r"([^\d(]+)\(", label): out.add(m.group(1))
    if " / " in label: out.add(label.split(" / ")[0])
    if re.search(r"[A-Za-z]", label):
        ko = re.sub(r"[A-Za-z.]+", " ", label).strip(" /()")
        la = " ".join(re.findall(r"[A-Za-z.]+", label))
        if ko: out.add(ko)
        if la: out.add(la)
    out.add(re.sub(r"\([^()\d]*\)", "", label))
    out.add(re.sub(r"^[^/]*/\s*", "", label))
    return {v.strip() for v in out if v.strip()}
def alt_of(label):
    """엔진 대안 하나(라벨 하나) — 원래 표기 · 표기 변형(norm · loose) · 절 집합."""
    vs = variants(label)
    return {"exact": norm(label), "n": {norm(v) for v in vs}, "l": {loose(v) for v in vs}, "v": {verse_set(v) for v in vs} - {None}}
def level(a, E):
    """책자 대안 a가 엔진 대안 E와 맞는 수준 — 0 그대로 같음 · 1 표기만(변형 · 느슨한 표기) · 2 절 집합 동치 · None 다른 독서."""
    if norm(a) == E["exact"]: return 0
    if norm(a) in E["n"] or loose(a) in E["l"]: return 1
    v = verse_set(a)
    return 2 if v is not None and v in E["v"] else None
def without_optional(a):
    """책자 대안에서 선택 절(숫자로 여는 괄호 · 대괄호)을 뺀 표기 — 「요한 1:(1-9)10-18」 → 「요한1:,10-18」. 없거나 하위 절 표기면 None."""
    s = norm(a)
    if not re.search(r"[(\[]\d", s) or sub_verse(s): return None
    return re.sub(r"[(\[]\d[^()\[\]]*[)\]]", ",", s)
def match(B, alts):
    """책자 대안마다 · 엔진 대안마다 가장 가까운 짝의 수준(짝이 없으면 None) — (책자 쪽 목록, 엔진 쪽 목록).
    책자의 선택 절 한 줄 「요한 1:(1-9)10-18」 은 엔진의 두 세트(넣은 것 · 뺀 것)를 함께 적은 것이라, 넣은 쪽이 짝을 찾았을 때만
    뺀 쪽과 맞는 엔진 대안도 짝(표기만)으로 센다 — 엔진에 뺀 쪽만 있으면 넣은 쪽이 짝이 없어 그대로 차이로 남는다."""
    m = [[level(a, E) for E in alts] for a in B]
    best = lambda xs: min((x for x in xs if x is not None), default=None)
    bl, el = [best(r) for r in m], [best([r[j] for r in m]) for j in range(len(alts))]
    for a, x in zip(B, bl):
        if x is not None and (s := without_optional(a)):
            el = [1 if y is None and level(s, E) is not None else y for y, E in zip(el, alts)]
    return bl, el
def slot_match(bvals, label):
    """책자 대안이 모두 엔진 라벨 하나에 드는가(수준 0~2) — 성탄 세트 대조."""
    return None not in match(bvals, [alt_of(label)])[0]
def short(name):
    return re.sub(r"\s+", "", re.sub(r"\(.*?\)", "", name or "").replace("성 ", "").replace("사도 ", "").replace("복음사가 ", ""))

def engine_alts(e):
    """후보 id → 슬롯 → 엔진 대안 목록(트랙 · 세트에 걸친 라벨마다 하나 — 같은 라벨은 한 번). 저녁 전례(12.24의 성탄 밤)는
    그날 낮 본문의 대안이 아니다 — 책자는 그 본문을 12.25 블록에 싣는다(앱 설계서 R-6.1-evening)"""
    evening = {c["id"] for c in e.get("candidates", []) if c.get("evening")}
    out = {}
    for cid, groups in e["groups"].items():
        if cid in evening: continue
        per = {k: {} for k in SLOTS}
        for g in groups:
            for k in SLOTS:
                lab = g["slots"].get(k)
                if lab: per[k].setdefault(norm(lab), alt_of(lab))
        out[cid] = {k: list(v.values()) for k, v in per.items()}
    return out
def labs(alts):
    return "|".join(sorted({E["exact"] for E in alts}))

def classify(B, alts, sel, slot):
    """책자 대안 B 를 선택 후보 sel 의 엔진 대안과 하나씩 짝짓는다(수준 0~2). 다른 후보(other) · 부분 일치(partial)도 같은 짝짓기로
    본다 — 선택 후보에서만 절 집합을 보면 같은 독서가 다른 후보에 있을 때 ≠ 로 떨어진다."""
    Es = alts.get(sel, {}).get(slot, [])
    if not B and not Es: return ("=", "")
    if not B: return ("책자 생략", "엔진 " + labs(Es))
    bl, el = match(B, Es)
    if None not in bl:
        how = "절 집합 동치" if 2 in bl + el else "표기만"
        if None not in el: return ("=", "") if max(bl + el) == 0 else ("≈", how + " — 엔진 " + labs(Es))
        miss = labs([E for E, x in zip(Es, el) if x is None])
        # 책자 대안이 모두 엔진에 있다 — 그대로 같으면 대안 수만 다르고(⊂), 표기도 다르면 ≈ 에 대안 수 차이를 덧붙인다
        return ("⊂", "책자 일부만 — 엔진만 " + miss) if max(bl) == 0 else ("≈", how + " · 책자 대안이 적다 — 엔진만 " + miss)
    others = [c for c in alts if c != sel and alts[c][slot] and None not in match(B, alts[c][slot])[0]]
    if others: return ("other", ",".join(others))
    if Es and None not in el: return ("⊃", "책자가 더 — " + "|".join(norm(a) for a, x in zip(B, bl) if x is None))
    allE = [E for c in alts for E in alts[c][slot]]
    hit = match(B, allE)[0]
    if any(x is not None for x in hit): return ("partial", "책자만 " + "|".join(norm(a) for a, x in zip(B, hit) if x is None) + " / 엔진 " + labs(Es))
    rest = labs([E for E in allE if E["exact"] not in {x["exact"] for x in Es}])
    return ("≠", "엔진(초기) " + (labs(Es) or "없음") + (" / 다른 후보 " + rest if rest else ""))

for B, cands, sel, want in [   # 판정기 자기 점검 — 돌 때마다 확인한다
        (["루가 1:68-79"], {"s": ["루가 1:68-79(즈가리야 송가)"]}, "s", "≈"),          # 송가 이름만 다르다 — 라벨 하나는 대안 하나
        (["시편 150", "Te Deum"], {"s": ["시편 150", "하느님찬미송가 Te Deum"]}, "s", "≈"),
        (["시편 150"], {"s": ["시편 150", "하느님찬미송가 Te Deum"]}, "s", "⊂"),
        (["에스 4:17"], {"s": ["에스 4:17(12-16), 17(23-25)"]}, "s", "≠"),            # 괄호 앞 토막 · 하위 절은 없는 독서
        (["에스 4:12-17, 23-25"], {"s": ["에스 4:17(12-16), 17(23-25)"]}, "s", "≠"),
        (["마르 8:34, 35-38"], {"s": ["요한 1:1-14"], "o": ["마르 8:34-38"]}, "s", "other"),   # 다른 후보도 절 집합으로 본다
        (["마르 8:34, 35-38"], {"s": ["요한 1:1-14"], "o": ["마르 8:34-38"]}, "o", "≈"),
        (["요한 1:(1-9)10-18"], {"s": ["요한 1:1-9, 10-18", "요한 1:10-18"]}, "s", "≈"),   # 선택 절 한 줄 = 엔진 두 세트
        (["요한 1:(1-9)10-18"], {"s": ["요한 1:10-18"]}, "s", "≠")]:
    got = classify(B, engine_alts({"groups": {c: [{"slots": {"gospel": l}} for l in ls] for c, ls in cands.items()}}), sel, "gospel")[0]
    assert got == want, ("자기 점검", B, cands, sel, got, want)

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
    alts = engine_alts(e)
    sel = e["view"]["initial"] if e.get("view") else (e["official"]["id"] if e["official"] else None)   # 뷰가 없으면 지정 전례일로(README)
    engine_colors[e["color"]] += 1
    rec = {"date": d, "weekday": b["weekday"], "names": b["names"], "sel": sel, "official": e["official"]["id"] if e["official"] else None,
           "candidates": [(c["id"], c["status"], c.get("from"), c.get("to")) for c in e["candidates"]], "slots": {}, "flags": b["flags"]}
    if b["no_eucharist"]:
        counts["감사성찬례 없음(책자)"] += 1; rec["status"] = "no-eucharist"; detail.append(rec); continue
    if not b["sets"]:
        counts["파싱 실패"] += 1; rec["status"] = "parse-fail"; detail.append(rec); continue
    if len(b["sets"]) > 1:   # 성탄
        # 성탄 밤은 엔진에서 12.24 저녁 전례다(앱 설계서 R-6.1-evening) — 책자는 12.25 블록에 싣는다. 전날의 저녁 후보 본문도 함께 본다
        pool = dict(e["groups"])
        prev = engine.get(str(datetime.date.fromisoformat(d) - datetime.timedelta(days=1)))
        if prev and not prev.get("error"):
            for c in prev["candidates"]:
                if c.get("evening"): pool[c["id"]] = prev["groups"].get(c["id"], [])
        for s in b["sets"]:
            best = None
            for cid, groups in pool.items():
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
        st, why = classify(s["slots"].get(k) or [], alts, sel, k)
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
    # 이름 · 「…에서 이동」 표기
    moved = {}
    prev = None
    for n in b["names"]:
        m = re.search(r"\((\d{1,2})/(\d{1,2})에서 이동\)", n)
        if m:
            key = re.sub(r"\(.*?\)", "", n).strip() or prev
            moved[key] = f"{d[:4]}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        prev = re.sub(r"\(.*?\)", "", n).strip() or prev
    ecands = [c for c in e["candidates"] if not c["id"].startswith("grid:") and not re.match(r"^t-(동|춘|하|추)계재$", c["id"])]
    # 전례일의 이름은 name + aliases 다(엔진 namesOfRow) — 책자의 「고난주일」 · 「승천일」 은 성지주일 · 승천대축일의 별칭으로 맞는다
    enames = {c["id"]: [x for x in map(short, [c["name"], *(c.get("aliases") or [])]) if x] for c in e["candidates"]}
    unmatched_b = []
    for n in b["names"]:
        nn = short(n)
        if not nn or "축성" in n or "축복" in n or "에서 이동" in n or n.startswith("("): continue
        if not any(nn in en or en in nn for ens in enames.values() for en in ens): unmatched_b.append(n)
    # 저녁 전례(12.24 의 성탄 밤 — 책자는 12.25 블록에 싣는다)는 그날 낮의 이름 대조에서 뺀다(앱 설계서 R-6.1-evening)
    unmatched_e = [c["id"] for c in ecands if c["status"] in ("proper", "transferred_in") and not c.get("evening") and not any((en in short(n) or short(n) in en) for en in enames[c["id"]] for n in b["names"] if short(n))]
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
no_view = sum(1 for d in booklet if engine.get(d) and not engine[d].get("error") and not engine[d].get("view"))
if no_view:   # engine-dump.mjs 가 js/app/lectionary.js 없이 돌았다 — 집계가 뷰 대조와 크게 다르다(README)
    L.append(f"> **뷰 없음 {no_view}일** — 엔진 덤프에 전례독서 뷰 모델이 없어(`js/app/lectionary.js` 없음) 그날은 지정 전례일(`official`)로 비교했다. 뷰의 초기 선택 대조가 아니다.\n")
L.append("## 집계 (감사성찬례 독서, 날짜별 최악 슬롯)\n")
for k, v in sorted(counts.items(), key=lambda x: -x[1]): L.append(f"- {k}: {v}")
L.append("\n## 독서 불일치 (≠ · partial)\n")
L.append("| 날짜 | 요일 | 책자 전례일 | 엔진 초기 선택 | 슬롯 | 책자 | 비고 |\n|---|---|---|---|---|---|---|")
for r in rows:
    if r["status"] not in ("≠", "partial"): continue
    for k in SLOTS:
        st, why, bv = r["slots"][k]
        if st in ("≠", "partial"): L.append(f"| {r['date']} | {r['weekday']} | {' · '.join(r['names'][:3])} | {r['sel']} | {k} | {' 또는 '.join(bv)} | {st} {why} |")
L.append("\n## 책자가 다른 후보의 독서를 실은 날 (other)\n")
L.append("| 날짜 | 요일 | 책자 전례일 | 엔진 초기 선택 | 슬롯 | 일치한 후보 |\n|---|---|---|---|---|---|")
for r in rows:
    if r["status"] != "other": continue
    ks = [k for k in SLOTS if r["slots"][k][0] == "other"]
    oc = r['slots'][ks[0]][1].split(",")[0]
    prec = next((c["precedence"] for c in engine[r["date"]]["candidates"] if c["id"] == r["sel"]), None)
    L.append(f"| {r['date']} | {r['weekday']} | {' · '.join(r['names'][:3])} | {r['sel']} (prec {prec}) | {','.join(ks)} | {oc} |")
L.append("\n## 표기 차이 · 대안 수 차이 (≈ · ⊃ · ⊂ · 책자 생략)\n")
L.append("| 날짜 | 요일 | 책자 전례일 | 슬롯 | 책자 | 비고 |\n|---|---|---|---|---|---|")
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
L.append("| 날짜 | 요일 | 책자 색 | 엔진 대표색 | 엔진 색 집합 | 책자 전례일 |\n|---|---|---|---|---|---|")
for d, wd, bc, ec, ecs, nm in color_rows: L.append(f"| {d} | {wd} | {','.join(bc)} | {ec} | {','.join(ecs)} | {' · '.join(nm)} |")
L.append("\n## 전례일 이름 (책자에만 / 엔진에만)\n")
for d, wd, ub, ue, cands in name_rows: L.append(f"- {d} {wd}: 책자만 {ub} · 엔진만 {ue}")
open(OUT, "w", encoding="utf8").write("\n".join(L) + "\n")
print("\n".join(L[:12]))
print(f"rows: 불일치 {sum(1 for r in rows if r['status'] in ('≠','partial'))} · other {sum(1 for r in rows if r['status']=='other')} · 표기 {sum(1 for r in rows if r['status'] in ('≈','⊃','⊂','책자 생략'))} · 색 {len(color_rows)} · 이름 {len(name_rows)} · 이동 {len(transfer_rows)}")
