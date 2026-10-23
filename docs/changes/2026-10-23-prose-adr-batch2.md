---
date: 2026-10-23
branch: docs/prose-adr-batch2
title: "docs: ADR 012-015의 문장 정리"
---

## 요약

ADR과 설계서 문체 정리(known-issues §24)의 둘째 PR이다. ADR 012, 013, 014, 015를 고쳐 썼다. 기준은 `docs/writing.md`의 pitfalls §37과 §40, 그리고 「용어」와 「학술 · 법률 문체 낱말」 목록이다. 옛 개정 블록은 본문의 해당 자리에 반영하고 지웠고, 바뀌기 전의 선택은 「검토한 대안」에 「채택하지 않음 날짜 · 이유」로 남겼다.

| ADR | 본문에 반영한 것 | 「검토한 대안」으로 옮긴 것 |
| --- | --- | --- |
| 012 | 개정 블록 없음. 문장과 낱말만 고쳤다(「기각」, 「창 객체」, 「표류」, 「first-class」) | 없음 |
| 013 | 테스트 파일 이름 규칙(2026-05-09), 유닛은 `node:vm`과 스텁만 쓰고 브라우저가 필요한 동작은 e2e가 맡는다(2026-05-11) | jsdom이나 happy-dom을 함께 쓰기(2026-05-11에 허용했다가 같은 날 보류) |
| 014 | 검색 기록에 날짜 저장과 `YYYY. M. D.` 표기(2026-06-07) | 날짜 없는 `string[]`, 상대 날짜 「n일 전」 |
| 015 | 캐시 넷의 지금 이름과 무효화 방식(ADR-021), 검색 기록 형식(ADR-014) | 캐시 이름에 rev를 붙여 따로 올리기(2026-05-13까지) |

## 확정 · 근거

- **낡은 사실을 지금에 맞췄다.** 모두 저장소에서 확인했다.
  - ADR-013 상태의 「473 케이스」: known-issues §12.1이 「ADR을 다른 이유로 손댈 때 함께 고친다」고 적어 둔 항목이다. 2026-05-11의 건수임을 밝히고 지금 건수는 `tests/README.md`를 가리키게 했다. 플랫폼 주제 문서의 §12.1에서 그 부분을 해소로 바꿨다(ADR-036 부분은 남았다).
  - ADR-013의 「저장소에 `package.json` 자체가 없음」: 지금은 있다. `devDependencies`에 타입 검사용 `typescript` 하나뿐이고, 유닛 테스트가 쓰는 패키지는 없다(`package.json`).
  - ADR-013의 CI 단계 `node --test tests/unit/state-machine.test.js`: 처음(PR #42)의 모습이다. 지금 `.github/workflows/test.yml`은 `tests/unit/*.test.js` 전체와 `npm run typecheck`를 돌린다.
  - ADR-013의 「다음 단계: store-v2, transport」: `tests/unit/store-v2.test.js`와 `transport.test.js`가 있어 「그 뒤 적용했다」로 적었다.
  - ADR-015의 캐시 이름: `sw.js`는 `"shell-" + self.APP_VERSION`, `"data"`, `"audio"`, `"fonts"`를 쓴다. 옛 표(`shell-49`, `data-1`, `audio-1`, `fonts-v1`)는 「검토한 대안」으로 옮겼다.
  - ADR-015의 `bible-search-history` 형식: ADR-014의 2026-06-07 변경에 맞춰 `{q, ts}[]`로 고치고, 그 전의 `string[]`을 함께 적었다.
- **확인되지 않은 것은 원문대로 두었다.** ADR-015의 「`docs/architecture.md` 「스토리지」 절에서 이 ADR을 가리킨다(다음 사이클)」는 지금 architecture.md에서 찾을 수 없었다. 부록 A의 ADR 인덱스에만 있다. 그래서 「그렇게 하기로 했다」와 「지금은 인덱스에 있다」를 나눠 적었다.
- 그 밖의 사실은 바꾸지 않았다.

## 검증

- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/decisions/*.md' --docs 'docs/topics/*.md' --kinds general --strict-counts`에서 사라진 토큰과 줄어든 토큰이 모두 0이다. 개정 블록을 합치며 한 번씩 덜 적은 이름(「5회」, 「1회」, `node:vm`, `dependencies`, 테스트 파일 이름)은 되살렸다.
- `node --test tests/unit/docs-*.test.js`는 23개가 모두 통과했다.
- 네 ADR에 「꼴」이 없다. 물결표는 ADR-014의 실측 표에서 칸마다 하나씩 쓴 근삿값 둘뿐이다(pitfalls §32가 허용하는 경우).

## 갱신한 문서

- `docs/decisions/012-typescript-incremental-adoption.md`, `013-client-js-unit-tests.md`, `014-search-history.md`, `015-storage-strategy.md`: 문장 정리와 개정 블록 반영.
- `docs/topics/platform.md`: known-issues §12.1에서 ADR-013 부분을 해소로.
