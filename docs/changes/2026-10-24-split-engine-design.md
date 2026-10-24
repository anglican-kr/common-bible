---
pr: 415
date: 2026-10-24
branch: docs/split-engine-design
title: "docs: 교회력 설계서를 장마다 파일로 나눔"
---

## 요약

교회력 설계서(`docs/design/liturgical-engine.md`)를 장마다 파일 하나로 나눴다. 장 파일 아홉 개는 `docs/design/liturgical-engine/` 아래에 있고, 옛 파일에는 머리(제목, 상태, 구현 파일, 관련 ADR)와 목차만 남겼다. 글자를 그대로 옮겼고 문장은 고치지 않았다. 절 번호, 규칙 마커, 미결 번호도 그대로다. known-issues §24에서 설계서 본문을 고쳐 쓴 뒤에 하기로 한 일이다(#414).

문서 검사 테스트 셋과 사실 토큰 도구는 목차와 장 파일을 차례로 이어 붙여 설계서 하나로 읽게 고쳤다. 검사가 실패하면 위치를 이어 붙인 글의 줄이 아니라 장 파일의 줄로 보여 준다.

## 확정 · 근거

- **옛 경로는 목차로 남겼다**(사용자 결정, 2026-10-24). 머지된 원장 36개가 이 경로를 가리키고, 머지된 원장은 고칠 수 없다. 파일을 지우면 그 링크가 열리지 않는다.
- **파일 이름은 장 번호와 내용 낱말로 지었다**(사용자 결정, 2026-10-24). `01-overview.md`부터 `09-open-items.md`까지다. 순번만으로 짓지 않는다는 원장 이름 규칙과 맞췄다.
- **큰 장은 더 나누지 않았다**(사용자 결정, 2026-10-24). §6과 §9가 크지만 이번에는 장 단위로만 나눴다.
- **바꾼 글자는 링크 세 줄이다.** §7의 픽스처 README 링크, §9 머리와 미결16의 보관 문서 링크다. 폴더가 한 단계 깊어져 경로 앞에 `../`를 하나 더 붙였다.
- **옛 경로로 가리키는 곳은 그대로 두었다.** 목차가 남아 계속 열리기 때문이다. `CLAUDE.md`의 §1.4 인용, ADR-037 머리의 링크, 검토 문서의 링크, 엔진 코드 머리의 §3.4 주석이다. 엔진 코드 주석은 설계서 §3.2의 파일 골격이 글자 그대로 인용하므로, 주석을 고치면 설계서의 글자도 바꿔야 한다. 「설계서 §N」처럼 이름으로 가리키는 곳은 문서 검사가 장 파일을 합쳐 찾으므로 고치지 않았다.

## 검증

- 줄 비교(`python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --from 'docs/design/liturgical-engine.md' --into 'docs/design/liturgical-engine.md' --into 'docs/design/liturgical-engine/*.md'`)에서 옛 줄 1,253개 가운데 1,250개가 그대로 있다. 빠진 셋은 위의 링크 세 줄이다. 장 파일을 이어 붙여 옛 파일과 `diff`로 견주어, 링크 경로 말고는 같음을 확인했다.
- 교회력 사실 토큰 비교(`--diff main WORKTREE --strict-counts`)에서 사라진 토큰, 줄어든 토큰, 새 토큰이 모두 0이다.
- 일반 토큰 비교(`--docs 'docs/*.md' --docs CLAUDE.md --kinds general --strict-counts`)에서 사라진 토큰과 줄어든 토큰이 0이다.
- 장 파일에 없는 절(§99)을 일부러 넣어, `docs-crossref.test.js`가 실패 위치를 `06-rank-transfer-color.md:10`으로 보이는 것을 확인하고 되돌렸다.
- 유닛 테스트(`node --test tests/unit/*.test.js`) 1,366개 가운데 1,365개가 통과했다. 1개는 원래 건너뛰는 미결13 픽스처다. `npm run typecheck`도 통과했다.
- e2e는 돌리지 않았다. 앱 코드를 바꾸지 않았다.

## 갱신한 문서

- `docs/index.md`: 교회력 행과 `design/` 안내에 목차와 장 파일.
- `docs/topics/liturgical.md`: 머리의 설계서 안내.
- `docs/topics/platform.md`: known-issues §24의 진행(2026-10-24).
- `tests/README.md`: 공용 앵커 모듈이 설계서를 읽는 함수도 맡는다.
