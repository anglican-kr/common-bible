// ── 설계 문서의 앵커 추출 — 번호 부여 규약(설계서 §1.4)의 유일한 JS 구현 ─────────
// docs-crossref.test.js · liturgical-fixtures.test.js 가 함께 쓴다. 규약이 바뀌면 여기만 고친다.
// (같은 문법의 Python 사본이 scripts/docs_facts_snapshot.py 에 있다 — 그쪽은 토큰 세기 전용이라
//  앵커 해석을 하지 않는다. 해석이 필요한 곳은 전부 이 파일을 쓴다.)

/** `## 4.10 제목` · `### 1.4 제목` 의 절 번호를 **나온 순서대로**. 중복도 그대로 낸다 —
 *  「번호 재부여 금지」를 검사하려면 집합이 아니라 목록이어야 한다. */
export function sectionList(text) {
  return [...text.matchAll(/^#{2,4} (\d+(?:\.\d+|-\d+)?)\.?\s/gm)].map((m) => m[1]);
}

/** 미결 원장(설계서 `## 9. ` · ADR `## 미결 사항`)의 항목 번호 집합. 없으면 null.
 *  §1.4 가 「절은 말미 추가만」을 규정하므로 뒤에 §10 · 부록이 붙는다 — **다음 `## ` 헤딩에서 끊는다**. */
export function issueNumbers(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return null;
  const body = text.slice(start + 1);
  const end = body.indexOf("\n## ", 1);
  const sec = end < 0 ? body : body.slice(0, end);
  return new Set([...sec.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])));
}

/** 검토 문서 §5 가 굵게 정의한 검증 항목 id(`C-6.5-4` · `C-P-1` · `X-10` · `I-7a`). */
export function checkIds(text) {
  return new Set([...text.matchAll(/\*\*((?:C-(?:P|\d+(?:\.\d+)?)|X|I)-\d+[a-z]?)\*\*/g)].map((m) => m[1]));
}

/** 설계서가 발급한 정본 마커 `**[R-6.4-ember-color]**` — 문서별 목록을 Map 으로. */
export function rMarkerDefs(byDoc) {
  const out = new Map();
  for (const [doc, t] of Object.entries(byDoc))
    for (const m of t.matchAll(/\*\*\[(R-\d+(?:\.\d+)?-[a-z0-9-]+)\]\*\*/g))
      out.set(m[1], [...(out.get(m[1]) ?? []), doc]);
  return out;
}

/** 설계서 §1.4 정본 지도의 줄 범위 `[시작, 끝)`(1-based, 끝 제외). 못 찾으면 null.
 *  이 절은 규약을 **예시로 인용**한다(``` ```facts ``` · ❌ `X-10 ②`) — 표기 금지 게이트가
 *  자기 정의를 잡지 않도록 빼낸다. 범위가 통째로 커지면 게이트가 조용히 죽으므로 호출자가 크기를 검사한다. */
export function canonMapRange(designText) {
  const lines = designText.split("\n");
  const start = lines.findIndex((l) => /^### 1\.4 /.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1).findIndex((l) => /^#{1,4} /.test(l));
  return [start + 1, rest < 0 ? lines.length + 1 : start + 1 + rest + 1];
}
