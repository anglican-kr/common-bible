#!/usr/bin/env python3
"""책자 PDF → 쪽 표식이 든 텍스트(pypdf). 인자: <pdf> <출력 txt>. 외부 파일이므로 `python3 -I` 로 돌린다."""
import sys
from pypdf import PdfReader
src, dst = sys.argv[1], sys.argv[2]
r = PdfReader(src)
out = []
for i, p in enumerate(r.pages):
    out.append(f"\n===== PAGE {i+1} =====\n")
    out.append(p.extract_text() or "")
open(dst, "w", encoding="utf8").write("".join(out))
print("pages", len(r.pages))
