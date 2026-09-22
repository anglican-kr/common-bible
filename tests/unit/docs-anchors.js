// ── 설계 문서의 앵커 추출 — 번호 부여 규약(설계서 §1.4)의 유일한 JS 구현 ─────────
// docs-crossref.test.js · liturgical-fixtures.test.js · liturgical-fixtures.data.test.js 가 함께 쓴다.
// 규약이 바뀌면 여기만 고친다. 테스트 파일이 아니라 `*.test.js` 글롭 밖이다 — 같은 자리의 `harness.js`
// (state-machine 계열 테스트의 공용 하네스)와 같은 관례.
// (같은 문법의 Python 사본이 scripts/docs_facts_snapshot.py 에 있다 — 그쪽은 토큰 세기 전용이라
//  앵커 해석을 하지 않는다. 해석이 필요한 곳은 전부 이 파일을 쓴다.)

/** `## 4.10 제목` · `### 1.4 제목` 의 절 번호를 **나온 순서대로**. 중복도 그대로 낸다 —
 *  「번호 재부여 금지」를 검사하려면 집합이 아니라 목록이어야 한다. */
export function sectionList(text) {
  return [...text.matchAll(/^#{2,4} (\d+(?:\.\d+|-\d+)?)\.?\s/gm)].map((m) => m[1]);
}

/** 미결 원장(설계서 `## 9. ` · ADR `## 미결 사항`)의 항목 번호를 **나온 순서대로**(중복 포함 —
 *  집합이면 재사용된 번호가 사라진다, `sectionList` 와 같은 이유). 절이 없으면 null.
 *  §1.4 가 「절은 말미 추가만」을 규정하므로 뒤에 §10 · 부록이 붙는다 — **다음 `## ` 헤딩에서 끊는다**. */
export function issueNumbers(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) return null;
  const body = text.slice(start + 1);
  const end = body.indexOf("\n## ", 1);
  const sec = end < 0 ? body : body.slice(0, end);
  return [...sec.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
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

/** 한 줄에서 마크다운 인라인 코드(같은 길이의 역따옴표 묶음으로 닫힌 것)를 지운다.
 *  표기 금지 게이트(센티널 · 동그라미 참조 · Qn · ADR 미결 참조)는 **산문**의 표기만 본다 —
 *  설계서 §1.4 가 규약을 정의하면서 금지 표기를 코드로 인용하고(``` ```facts ``` · ❌ `X-10 ②`),
 *  §6.5 의 정렬 키 `(유효 precedence, §6.2 ④ …)` 처럼 코드 표현 안의 것은 참조가 아니다.
 *  닫히지 않은 묶음(코드 펜스 `` ```facts `` 여는 줄)은 그대로 둔다 — 펜스 자체가 센티널이다. */
export function stripInlineCode(line) {
  return line.replace(/(`+)(?:(?!\1)[\s\S])+?\1(?!`)/g, "");
}
