---
pr: 532
date: 2026-11-08
branch: chore/typescript-nodenext
title: "chore: 모듈 경로 규칙을 nodenext로 변경"
---

## 요약

타입 검사의 모듈 경로 규칙(`moduleResolution`)을 `bundler`에서 `nodenext`로 바꾸고 `js/package.json`(`"type": "module"`)을 더했다(ADR-012). 이제 상대 경로에서 확장자가 빠지면 타입 검사가 오류로 잡는다. 브라우저는 확장자가 빠진 경로의 파일을 찾지 못해 그 모듈을 불러오지 못하는데, 이전 설정은 이 실수를 통과시켰다. 타입 주석의 경로 147곳에 `.js`를 붙였다. 브라우저가 실행하는 코드는 바뀌지 않는다.

## 확정 · 근거

- **#531이 미룬 전환을 지금 했다(사용자 결정 2026-11-08).** 이 원장이 `2026-11-08-typescript-7.md`의 「`nodenext`는 오류 207건이 나와 미뤘다」를 바꾼다. 지금의 결정은 ADR-012에 있다.
- **암시적 `any` 오류 60건은 경로 오류에 딸린 것이었다.** 타입 파일을 찾지 못하면 그 타입이 `any`가 되고, 그 값을 받는 콜백의 매개변수가 암시적 `any` 오류가 된다. 경로 147곳에 `.js`만 붙이자 207건이 모두 사라졌다. 손으로 타입을 정한 곳은 없다.
- **`module`도 `nodenext`로 바꿨다.** `moduleResolution`이 `nodenext`이면 `module`도 같아야 한다(TS5110).
- **`"type": "module"`은 `js/package.json`에 둔다.** 저장소 맨 위 `package.json`에 두면 `require`를 쓰는 유닛 테스트 둘이 실행되지 않는다. 이유는 ADR-012 「검토한 대안」에 적었다.
- **일반 스크립트 넷도 모듈로 검사하게 되었다.** 브라우저에서 일반 스크립트끼리 맨 바깥 이름이 겹치는 것을 검사가 잡지 못하게 되지만, 지금 넷은 맨 바깥에 이름을 두지 않는다. ADR-012 「검증」의 사각지대에 적었다.
- **일부러 바꾸지 않은 것**: `js/package.json`도 서버에 올라간다. server 저장소의 배포 목록(`deploy-manifest.txt`)이 `js/`를 통째로 묶기 때문이다. 개발에만 쓰는 `js/types.d.ts`도 이미 그렇게 올라가고, 새 파일은 설명 한 줄과 `"type"`뿐이라 배포 목록을 고치지 않았다.

## 검증

- `npm run typecheck`: 오류 0건.
- 검사하는 파일 목록(`tsc --listFilesOnly`)이 `bundler` 설정과 같다. 앱 설정 40개, 워커 설정 1개다.
- 실수를 하나씩 넣고 새 설정과 옛 설정(`bundler`)으로 검사했다. 넣은 줄은 백업 복사본으로 되돌리고 같은지 비교했다.

  | 넣은 실수 | `nodenext` | `bundler` |
  | --- | --- | --- |
  | `lectionary.js`의 실제 `import`에서 `.js` 빠뜨리기 | TS2835 | 통과 |
  | `views.js`의 타입 주석 경로에서 `.js` 빠뜨리기 | TS2834 | 통과 |
  | `views.js`에 보통 타입 오류(숫자 자리에 문자열) | TS2352, TS2345 | TS2352, TS2345 |
  | `search-worker.js`에 같은 오류(워커 설정) | TS2345 | TS2345 |

- `js/`에서 바뀐 148줄(`.js` 파일 147줄과 `types.d.ts` 주석의 예시 한 줄)을 비교 스크립트로 확인했다. 모두 주석 안의 `import("../types")`가 `import("../types.js")`로 바뀐 것뿐이다.
- 유닛: `node --test tests/unit/*.test.js` 1663건 통과, 건너뜀 0건(데이터 서브모듈을 받은 상태). 유닛 테스트는 `js/` 파일을 Node 모듈로 불러오지 않고 내용을 읽어 `vm`으로 실행하므로, `js/package.json`이 테스트에 영향을 주지 않는다.
- e2e는 돌리지 않았다. 브라우저가 실행하는 코드는 바뀌지 않았고(위 비교), 브라우저는 `js/package.json`을 요청하지 않는다(`index.html`의 `<script>` 태그와 `sw.js`의 미리 받기 목록에 없다).

## 갱신한 문서

- `docs/decisions/012-typescript-incremental-adoption.md`: 컴파일러 옵션(`nodenext`, `js/package.json`), 타입 가져오기 경로, 검토한 대안 셋(`bundler`, `"type"` 없는 `nodenext`, 맨 위 `package.json`), 검증의 사각지대(일반 스크립트)
- `docs/decisions/019-esm-module-system.md`: 「TypeScript 인식」의 타입 가져오기 경로
- `docs/architecture.md`: §4 `js/` 파일 표와 그 아래 설명에 `js/package.json`, §6의 타입 가져오기 경로
- `docs/topics/platform.md`: 지금 동작에 확장자 규칙
- `docs/design/liturgical-engine/03-placement-layers.md`: 예시 코드의 타입 가져오기 경로
