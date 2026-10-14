#!/usr/bin/env python3
"""2027 전례독서 책자(pypdf 텍스트, extract.py 산출) → 날짜별 감사성찬례 독서 JSON.
인자: <pdf 텍스트> <data/books.json> <출력 json> <data/lectionary/eucharist-readings.json>.

2027 책자(검토용)의 꼴에 맞춘 파서다 — 월별 표(감사성찬례 · 아침기도 · 저녁기도 세 칸)가 행 단위로 섞여 나오고,
날짜 줄은 「다음에 올 날짜 + 요일 글자」로 검증한다(요일 글자만 있는 줄도). 색은 글리프(֣ 녹 · ߔ 백 · ੗ 자 · ഘ 홍),
성탄 독서 셋은 12/26 행 뒤에 찍히며, 「또는」은 줄 끝에도 오고 「또\n는」 「요\n한」처럼 낱말이 쪼개지기도 한다.
쪼개진 낱말은 `rejoin_splits` 가 분류 전에 붙인다. 책 이름 뒤에 숫자가 와야 독서 줄이다(「사도 안드레아」 「성모 방문」은 이름). 다른 해의 책자는 꼴이 다르므로 이 파서를
그대로 쓰지 말고 START · 꼴 판정을 고쳐 쓴다(2024~2026 책자는 「[백]」 꼴 색 표지에 펼침면 순서가 섞인다)."""
import re, json, sys, datetime as dt
SRC, BOOKS_JSON, DST, READINGS_JSON = sys.argv[1:5]
GLYPH = {"֣": "green", "ߔ": "white", "੗": "violet", "ഘ": "red"}
GL = "".join(GLYPH)
SUP = str.maketrans("¹²³⁴⁵⁶⁷⁸⁹⁰⁻", "1234567890-")
books = json.load(open(BOOKS_JSON, encoding="utf8"))
BOOKS = {b["short_name_ko"] for b in books} | {"시편", "이사야", "창조송가", "성모송가", "성모", "즈가리야"}
for e in json.load(open(READINGS_JSON, encoding="utf8"))["entries"]:
    for sl in e["readings"]:
        m0 = re.match(r"^\d?[가-힣]+", sl["label"])
        if m0: BOOKS.add(m0.group(0))
WD = "월화수목금토일"

lines = [l.rstrip("\n") for l in open(SRC, encoding="utf8")]
def skip(l):
    return (not l) or l.startswith("===== PAGE") or re.fullmatch(r"\d{1,2}월( / \d{1,2}월)? 감사성찬례 아침기도 저녁기도", l)
def is_footer(l):
    return re.fullmatch(r"\d{1,2}월", l) is not None
def day_line(l):
    return re.fullmatch(r"(\d{1,2})\s*([<>" + GL + r"\s]*)", l)

START = dt.date(2026, 11, 29)   # 책자 첫 행(대림 1주일) — 해마다 바꾼다
expected = START
blocks = []
cur = None
redirect = None
n = len(lines)
for i, raw in enumerate(lines):
    l = raw.strip()
    if skip(l):
        continue
    if is_footer(l):
        if cur is not None: (redirect if redirect is not None else cur)["lines"].append("<<FOOTER>>")
        continue
    m = day_line(l)
    if m and int(m.group(1)) == expected.day:
        nxt = ""
        for j in range(i + 1, min(i + 6, n)):
            if not skip(lines[j].strip()) and not is_footer(lines[j].strip()):
                nxt = lines[j].strip(); break
        wd = expected.weekday()
        ok = (wd == 6 and not re.match(r"^[월화수목금토]( |$)", nxt)) or (wd < 6 and re.match("^" + WD[wd] + "( |$)", nxt) is not None)
        if ok:
            cur = {"date": expected.isoformat(), "weekday": WD[wd], "lines": [], "glyphs": [c for c in m.group(2) if c in GLYPH]}
            blocks.append(cur)
            redirect = None
            expected += dt.timedelta(days=1)
            continue
    if cur is not None:
        if l.startswith("[성탄밤]") and not cur["date"].endswith("-12-25"):
            target = next((x for x in blocks if x["date"] == cur["date"][:4] + "-12-25"), None)
            if target is not None:
                redirect = target
        (redirect if redirect is not None else cur)["lines"].append(l)

for b in blocks:
    if len(b["lines"]) > 70: print("LONG BLOCK", b["date"], len(b["lines"]), b["lines"][:3], file=sys.stderr)
print(f"blocks {len(blocks)}  first {blocks[0]['date']}  last {blocks[-1]['date']}  expected-next {expected}", file=sys.stderr)

GOSPEL = re.compile(r"^(마태|마르|루가|요한)\s*\d")
def first_token(l):
    return re.split(r"\s+", l, maxsplit=1)[0]
CANTICLE = re.compile(r"^(성모 ?마리아 ?송가|성모송가|즈가리야 ?송가|하느님찬미송가|창조송가|Te Deum|Magnificat|Benedictus)")
def is_book_line(l):
    if CANTICLE.match(l): return True
    t = first_token(l)
    return t in BOOKS and re.match(r"^\d?[가-힣]+\s+[\d(\[]", l) is not None
def rejoin_splits(lines):
    """pypdf 가 낱말 가운데서 줄을 바꾼 꼴을 분류 전에 붙인다 — 「루가 24:13-35 또는 요」+「한 20:19-23」, 「… 12-22 또」+「는 창세 22:1-14」,
    「요」+「한 1:1-18」. 앞줄 끝의 한글 조각과 다음 줄 첫 토큰을 이으면 책 이름(또는 「또는」)이 될 때만 공백 없이 잇는다."""
    out, i = [], 0
    while i < len(lines):
        cur = lines[i]
        if i + 1 < len(lines):
            m1 = re.search(r"([가-힣]{1,2})$", cur)
            m2 = re.match(r"^([가-힣]{1,2})(\s+\d|\s+[가-힣]+\s+\d)", lines[i + 1])
            if m1 and m2 and (m1.group(1) + m2.group(1) in BOOKS or m1.group(1) + m2.group(1) == "또는"):
                out.append(cur + lines[i + 1]); i += 2; continue
        out.append(cur); i += 1
    return out

def process(b):
    colors = set(GLYPH[c] for c in b["glyphs"])
    tokens = []      # (kind, text) — kind ∈ ref · name · note
    flags = []
    no_euch = False
    page_names = []
    after_footer = False
    for l in rejoin_splits(b["lines"]):
        if l == "<<FOOTER>>":
            after_footer = True; continue
        colors |= {GLYPH[c] for c in l if c in GLYPH}
        l = re.sub("[<>" + GL + "]", "", l)
        # 위첨자는 하위 절 번호다(에스델 그리스어 부분 「에스 4:17¹²⁻¹⁶, 17²³⁻²⁵」) — 엔진 라벨처럼 괄호에 보통 숫자로 적는다
        # (「4:17(12-16)」). 지우면 「에스 4:17, 17」 이 된다. 「ᦨ」 는 「사도 장(ᦨ) 야고보」 에 잘못 매핑된 글리프라 지운다
        l = re.sub(r"[¹²³⁴⁵⁶⁷⁸⁹⁰⁻]+", lambda m: "(" + m.group(0).translate(SUP) + ")", l)
        l = l.replace("ᦨ", "").replace(" ", " ").strip()
        if not l:
            continue
        if re.fullmatch(r"[월화수목금토]", l):
            continue
        if re.match(r"^[월화수목금토] ", l):
            l = l[2:].strip()
        if "감사성찬례 없음" in l:
            no_euch = True
            l = l.replace("감사성찬례 없음", "").strip()
            if not l: continue
        if l.startswith("["):
            tokens.append(("note", l)); continue
        if re.fullmatch(r"기도서 \d+p", l):
            tokens.append(("note", l)); continue
        # 주일 라벨이 독서 줄 끝에 붙은 꼴: 「마태 22:1-14연중 14주일」
        gm = re.match(r"^(.*?[\d)])([가-힣][^-:,]*)$", l)
        if gm and gm.group(2)[0] not in "상하" and is_book_line(l):
            l, label = gm.group(1).strip(), gm.group(2).strip()
        else:
            label = None
        if re.match(r"^[상하][-\d]", l) and tokens and tokens[-1][0] == "ref":
            tokens[-1] = ("ref", tokens[-1][1] + l); continue
        l = re.sub(r"\s*\((가|나|다)해\)\s*$", "", l)
        if re.match(r"^또\s*는(\s|$)", l):
            if tokens and tokens[-1][0] == "ref": tokens[-1] = ("ref", tokens[-1][1] + " " + l)
            else: flags.append("또는-without-ref: " + l)
        elif is_book_line(l) and tokens and tokens[-1][0] == "ref" and re.search(r"또\s*는?\s*$", tokens[-1][1]):
            tokens[-1] = ("ref", tokens[-1][1] + " " + l)      # 「… 또는」으로 끝난 줄의 이어짐
        elif is_book_line(l):
            tokens.append(("ref", l))
        elif "에서 이동" in l or (re.match(r"^[(가-힣]", l) and not re.search(r"\d+:\d+|\d+-\d+", l) and first_token(l) not in ("는", "한")):
            (page_names if after_footer else tokens).append(("name", l) if not after_footer else l)
        else:
            if tokens and tokens[-1][0] == "ref": tokens[-1] = ("ref", tokens[-1][1] + " " + l)
            else: flags.append("orphan: " + l)
        if label:
            tokens.append(("name", label))
    refs = [t for k, t in tokens if k == "ref"]
    names = [t for k, t in tokens if k == "name"]
    notes = [t for k, t in tokens if k == "note"]
    # 성탄 꼴 — [성탄밤] · [성탄 새벽] · [성탄 낮] 머리글로 감사성찬례 셋
    euch_sets = []
    if any(t in ("[성탄밤]", "[성탄 새벽]", "[성탄 낮]") for t in notes):
        cur_set = None
        for k, t in tokens:
            if k == "note" and t in ("[성탄밤]", "[성탄 새벽]", "[성탄 낮]"):
                cur_set = {"note": t.strip("[]"), "refs": []}; euch_sets.append(cur_set)
            elif k == "note" and t in ("[아침기도]", "[저녁기도]"):
                cur_set = None
            elif k == "ref" and cur_set is not None:
                cur_set["refs"].append(t)
        flags.append("christmas-sets")
    elif not no_euch:
        gi = next((i for i, r in enumerate(refs) if GOSPEL.match(r) and not (i == 1 and re.match(r"^루가 1:(4[5-9]|5\d|6[0-9]|7\d)", r))), None)
        if gi is None:
            flags.append("no-gospel-line")
        else:
            euch_sets.append({"note": None, "refs": refs[: gi + 1]})
    def slots_of(e):
        if len(e) < 3:
            return None
        first, gospel, mid = e[0], e[-1], e[1:-1]
        psalm = next((x for x in mid if x.startswith("시편")), mid[0] if mid else None)
        second = [x for x in mid if x is not psalm]
        return {"first": first, "psalm": psalm, "second": " | ".join(second) if second else None, "gospel": gospel}
    def alts(s):
        if not s: return []
        out = []
        for a in re.split(r"\s*또\s*는\s*", s):
            a = a.strip(" ,;")
            if not a: continue
            if out and re.match(r"^\d", a) and not re.match(r"^\d[가-힣]", a):   # 「시편 113, 114 또는 118」 — 책 이름 생략
                head = out[0]
                hm = re.match(r"^(\d?[가-힣]+)\s+(\d+):", head)
                a = (hm.group(1) + " " + hm.group(2) + ":" + a) if (hm and ":" not in a and "-" in a and head.count(":") == 1 and first_token(head) != "시편") else (first_token(head) + " " + a)
            out.append(a)
        return out
    sets = []
    for e in euch_sets:
        sl = slots_of(e["refs"])
        if sl is None:
            flags.append(f"short-eucharist({len(e['refs'])})")
            continue
        if len(e["refs"]) > 4: flags.append(f"long-eucharist({len(e['refs'])})")
        sets.append({"note": e["note"], "slots": {k: alts(v) for k, v in sl.items()}, "raw": e["refs"]})
    return {"date": b["date"], "weekday": b["weekday"], "colors": sorted(colors), "names": names, "page_names": page_names, "notes": notes,
            "no_eucharist": no_euch, "sets": sets, "flags": flags, "all_refs": refs}

out = [process(b) for b in blocks]
json.dump(out, open(DST, "w", encoding="utf8"), ensure_ascii=False, indent=0)
flagged = [(o["date"], o["flags"]) for o in out if o["flags"]]
print(f"flagged {len(flagged)}", file=sys.stderr)
for d, f in flagged: print("  ", d, f, file=sys.stderr)
