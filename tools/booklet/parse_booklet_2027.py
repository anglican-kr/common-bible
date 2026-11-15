#!/usr/bin/env python3
"""2027 전례독서 책자(pypdf 텍스트, extract.py 산출) → 날짜별 감사성찬례 독서 JSON.
인자: <pdf 텍스트> <data/books.json> <출력 json> <data/lectionary/eucharist-readings.json>.

「2027 전례독서」 책자 최종본(64쪽, 2026-11-14 조판)의 형식에 맞춘 파서다. 감사성찬례, 아침기도, 저녁기도 세 칸이
날마다 차례로 나온다. 날짜 줄은 「30 월 [홍] 이름」이고, 주일은 숫자만 있는 줄 다음에 「대림 1주일 [자] 첫 독서」가 온다.
성주간 평일은 「22 성주간」 다음 줄이 「월요일 [홍]」이다. 날짜 줄은 「다음에 올 날짜 + 요일」로 검증한다(주일은 다음 줄이
독서가 아니어야 한다). 색은 글자 표기 [녹] [백] [자] [홍]이고 「[자/백]」처럼 둘이 오기도 한다. 성탄밤은 12.24 칸에
「[성탄밤 성찬례]」로 찍혀 12.25로 옮겨 읽는다. 성 토요일은 「[감사성찬례]」 다음 줄 「없음」이다. 「또는」은 줄 끝에도 오고
「또\n는」 「요\n한」처럼 낱말이 쪼개지기도 한다. 쪼개진 낱말은 `rejoin_splits`가 분류 전에 붙인다. 책 이름 뒤에 숫자가 와야
독서 줄이다(「사도 안드레아」 「성모 방문」은 이름). 2026-10-12의 검토본은 색을 글리프로 찍은 다른 형식이었다(이 파일의 git 이력).
다른 해의 책자는 형식이 다르므로 START와 날짜 줄 판정을 고쳐 쓴다."""
import re, json, sys, datetime as dt
SRC, BOOKS_JSON, DST, READINGS_JSON = sys.argv[1:5]
COLOR = {"녹": "green", "백": "white", "자": "violet", "홍": "red"}
COLOR_MARK = re.compile(r"\s*\[([녹백자홍](?:/[녹백자홍])*)\]\s*")
SUP = str.maketrans("¹²³⁴⁵⁶⁷⁸⁹⁰⁻", "1234567890-")
books = json.load(open(BOOKS_JSON, encoding="utf8"))
BOOKS = {b["short_name_ko"] for b in books} | {"시편", "이사야", "창조송가", "성모송가", "성모", "즈가리야"}
for e in json.load(open(READINGS_JSON, encoding="utf8"))["entries"]:
    for sl in e["readings"]:
        m0 = re.match(r"^\d?[가-힣]+", sl["label"])
        if m0: BOOKS.add(m0.group(0))
WD = "월화수목금토일"

GOSPEL = re.compile(r"^(마태|마르|루가|요한)\s*\d")
def first_token(l):
    return re.split(r"\s+", l, maxsplit=1)[0]
CANTICLE = re.compile(r"^(성모 ?마리아 ?송가|성모송가|즈가리야 ?송가|하느님찬미송가|창조송가|Te Deum|Magnificat|Benedictus)")
def is_book_line(l):
    if CANTICLE.match(l): return True
    t = first_token(l)
    return t in BOOKS and re.match(r"^\d?[가-힣]+\s+[\d(\[]", l) is not None
def rejoin_splits(lines):
    """pypdf가 낱말 가운데서 줄을 바꾼 경우를 분류 전에 붙인다 — 「루가 24:13-35 또는 요」+「한 20:19-23」, 「… 12-22 또」+「는 창세 22:1-14」,
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

lines = [l.rstrip("\n").strip() for l in open(SRC, encoding="utf8")]
def skip(l):
    """쪽 표식, 조판 파일 이름, 쪽 번호, 머리의 달 이름과 칸 제목."""
    return ((not l) or l.startswith("===== PAGE") or "indd" in l or re.fullmatch(r"(-\s*\d+\s*-\s*)+", l) is not None
            or re.fullmatch(r"\d{1,2}월", l) is not None or re.search(r"감사성찬례 아침기도 저녁기도$", l) is not None)
lines = [l for l in lines if not skip(l)]

def split_colors(l):
    """색 표기를 떼어 (색 집합, 줄들)로. 「대림 1주일 [자] 이사 63:19하-64:8」처럼 색 뒤에 첫 독서가 붙은 줄은 둘로 나눈다."""
    colors = {COLOR[c] for m in COLOR_MARK.finditer(l) for c in m.group(1).split("/")}
    if not colors:
        return set(), [l]
    head, *rest = COLOR_MARK.split(l, maxsplit=1)
    tail = rest[-1].strip() if rest else ""
    if tail and is_book_line(tail):
        return colors, [x for x in (head.strip(),) if x] + [tail]
    return colors, [COLOR_MARK.sub(" ", l).strip()]

START = dt.date(2026, 11, 29)   # 책자 첫 행(대림 1주일) — 해마다 바꾼다
expected = START
blocks, cur, redirect, held_xmas = [], None, None, []
n = len(lines)
i = 0
while i < n:
    l = lines[i]
    nxt = lines[i + 1] if i + 1 < n else ""
    if re.fullmatch(r"성인\s*공통", l) and expected.year > START.year + 1:
        break   # 12.31 뒤의 「성인 공통」 부록은 날짜 칸이 아니다
    m = re.fullmatch(r"(\d{1,2})(?:\s+(.*))?", l)
    head = None
    if m and int(m.group(1)) == expected.day:
        rest = (m.group(2) or "").strip()
        wd = expected.weekday()
        if rest == "":
            if wd == 6 and not is_book_line(nxt) and not re.match(r"^[(\d]", nxt):
                head = []
        elif rest.startswith("성주간"):
            if wd < 6 and nxt.startswith(WD[wd] + "요일"):
                head = [rest, nxt[3:].strip()]
                i += 1
        else:
            wm = re.match(r"^([월화수목금토])(?:\s+(.*))?$", rest)
            if wm and wd < 6 and wm.group(1) == WD[wd]:
                head = [wm.group(2).strip()] if wm.group(2) else []
    if head is not None:
        cur = {"date": expected.isoformat(), "weekday": WD[expected.weekday()], "lines": [], "colors": set()}
        blocks.append(cur)
        redirect = None
        expected += dt.timedelta(days=1)
        for h in head:
            cs, parts = split_colors(h)
            cur["colors"] |= cs
            cur["lines"].extend(parts)
        i += 1
        continue
    if cur is not None:
        if l == "[감사성찬례]" and nxt == "없음":
            cur["lines"].append("감사성찬례 없음")
            i += 2
            continue
        if l.startswith("[성탄밤 성찬례]"):
            # 성탄밤은 12.24 칸에 찍히지만 12.25의 감사성찬례다 — 12.25 블록이 생기면 그 앞에 넣는다
            redirect = held_xmas = []
            cur.setdefault("xmas_eve", held_xmas)
            l = "[성탄밤]"
        cs, parts = split_colors(l)
        target = redirect if redirect is not None else cur["lines"]
        if redirect is None:
            cur["colors"] |= cs
        target.extend(parts)
        if re.match(r"^루가\s+2:1-14", l) and redirect is not None:
            nxt2 = lines[i + 1] if i + 1 < n else ""
            if re.fullmatch(r"\(\d+-\d+\)", nxt2):   # 「루가 2:1-14」 다음 줄 「(15-20)」까지가 성탄밤이다
                redirect.append(nxt2)
                i += 1
            redirect = None
    i += 1
for b in blocks:
    eve = b.pop("xmas_eve", None)
    if eve:
        t = next((x for x in blocks if x["date"] == b["date"][:4] + "-12-25"), None)
        if t is not None:
            t["lines"] = eve + t["lines"]
for b in blocks:
    if len(b["lines"]) > 70: print("LONG BLOCK", b["date"], len(b["lines"]), b["lines"][:3], file=sys.stderr)
print(f"blocks {len(blocks)}  first {blocks[0]['date']}  last {blocks[-1]['date']}  expected-next {expected}", file=sys.stderr)

def process(b):
    colors = set(b["colors"])
    tokens = []      # (kind, text) — kind ∈ ref · name · note
    flags = []
    no_euch = False
    page_names = []
    after_footer = False
    for l in rejoin_splits(b["lines"]):
        if l == "<<FOOTER>>":
            after_footer = True; continue
        l = re.sub("[<>]", "", l)
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
        # 주일 라벨이 독서 줄 끝에 붙은 경우: 「마태 22:1-14연중 14주일」
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
    # 성탄 — [성탄밤] · [성탄 새벽] · [성탄 낮] 머리글로 감사성찬례 셋
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
