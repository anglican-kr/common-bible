---
pr: 532
date: 2026-11-08
branch: chore/typescript-nodenext
title: "chore: 모듈 경로 규칙을 nodenext로 변경"
---

## 요약

타입 검사의 모듈 경로 규칙(`moduleResolution`)을 `bundler`에서 `nodenext`로 바꾸고 `js/package.json`(`"type": "module"`)을 더했다(ADR-012). 이제 상대 경로에서 확장자가 빠지면 타입 검사가 오류로 잡는다. 브라우저는 확장자가 빠진 경로의 파일을 찾지 못해 그 모듈을 불러오지 못하는데, 이전 설정은 이 실수를 통과시켰다. 타입 주석의 경로 147곳에 `.js`를 붙였다. 어느 파일이 모듈인지는 예전처럼 `import`나 `export`가 있는지로 정해서(`moduleDetection: "legacy"`), 일반 스크립트끼리 맨 바깥 이름이 겹치는 실수도 예전처럼 잡는다. 브라우저가 실행하는 코드는 바뀌지 않는다.

## 확정 · 근거

- **#531이 미룬 전환을 지금 했다(사용자 결정 2026-11-08).** 이 원장이 `2026-11-08-typescript-7.md`의 「`nodenext`는 오류 207건이 나와 미뤘다」를 바꾼다. 지금의 결정은 ADR-012에 있다.
- **암시적 `any` 오류 60건은 경로 오류에 딸린 것이었다.** 타입 파일을 찾지 못하면 그 타입이 `any`가 되고, 그 값을 받는 콜백의 매개변수가 암시적 `any` 오류가 된다. 경로 147곳에 `.js`만 붙이자 207건이 모두 사라졌다. 손으로 타입을 정한 곳은 없다.
- **`module`도 `nodenext`로 바꿨다.** `moduleResolution`이 `nodenext`이면 `module`도 같아야 한다(TS5110).
- **`"type": "module"`은 `js/package.json`에 둔다.** 저장소 맨 위 `package.json`에 두면 `require`를 쓰는 유닛 테스트 둘이 실행되지 않는다. 이유는 ADR-012 「검토한 대안」에 적었다.
- **`moduleDetection`을 `legacy`로 두었다(사용자 요청 2026-11-08).** 첫 판은 기본값(`auto`)이었다. 기본값은 `"type": "module"` 아래의 파일을 모두 모듈로 보아서, 일반 스크립트 넷(`pre-fetch.js`, `audio-cache.js`, `manifest-sync.js`, 검색 워커)끼리 맨 바깥 이름이 겹쳐도 잡지 못했다. 이 빈틈을 보고했더니 사용자가 고치라고 했다. `legacy`는 `import`나 `export`가 있는 파일만 모듈로 보는데, ADR-019가 모듈 파일마다 `export {};` 표시를 두게 해서 이 판정이 브라우저와 맞는다. TypeScript 7도 이 값을 받는다.
- **모듈 판정이 브라우저와 맞는지 보는 유닛 테스트를 더했다(사용자 요청 2026-11-08).** `legacy` 판정은 모듈 파일마다 `import`나 `export`가 있어야 맞는데, 이것을 지키는지 보는 검사가 없었다(main의 설정도 같은 판정이라 이번에 줄어든 검사는 아니다). `tests/unit/tsconfig.test.js`가 브라우저가 각 파일을 부르는 방식(`index.html`의 태그, `new Worker`, `importScripts`, 정적과 동적 `import`)을 모아 파일 안의 표시와 대조한다.
- **`import`를 따라가는 코드는 `sw.test.js`에서 공용 모듈 `tests/unit/module-graph.js`로 옮겼다.** 새 테스트에도 같은 코드(주석과 문자열을 걸러 내는 `codeView`, `import`를 끝까지 따라가는 `importClosure`)가 필요했다. 사본을 두지 않는 테스트 규약(`tests/README.md` §1)을 따랐다. 옮긴 코드는 앞에 붙인 `export` 말고는 원래와 같다.
- **일부러 바꾸지 않은 것**: `js/package.json`도 서버에 올라간다. server 저장소의 배포 목록(`deploy-manifest.txt`)이 `js/`를 통째로 묶기 때문이다. 개발에만 쓰는 `js/types.d.ts`도 이미 그렇게 올라가고, 새 파일은 설명 한 줄과 `"type"`뿐이라 배포 목록을 고치지 않았다.

## 검증

- `npm run typecheck`: 오류 0건.
- 검사하는 파일 목록(`tsc --listFilesOnly`)이 `bundler` 설정과 같다. 앱 설정 40개, 워커 설정 1개다.
- 실수를 하나씩 넣고 세 설정으로 검사했다. 이 PR의 설정(`nodenext`와 `legacy`), 첫 판의 설정(`nodenext`와 `auto`), 옛 설정(`bundler`)이다. 넣은 줄은 백업 복사본으로 되돌리고 같은지 비교했다.

  | 넣은 실수 | 이 PR | 첫 판 | `bundler` |
  | --- | --- | --- | --- |
  | `pre-fetch.js`와 `audio-cache.js`에 같은 맨 바깥 이름 | TS2451 | 통과 | TS2451 |
  | `views.js`의 맨 바깥 이름을 `helpers.js`가 `import` 없이 쓰기 | TS2304 | TS2304 | TS2304 |
  | `lectionary.js`의 실제 `import`에서 `.js` 빠뜨리기 | TS2835 | TS2835 | 통과 |
  | `views.js`의 타입 주석 경로에서 `.js` 빠뜨리기 | TS2834 | TS2834 | 통과 |
  | `views.js`에 보통 타입 오류(숫자 자리에 문자열) | TS2345 | TS2345 | TS2345 |
  | `search-worker.js`에 같은 오류(워커 설정) | TS2345 | TS2345 | TS2345 |

- `js/`에서 바뀐 148줄(`.js` 파일 147줄과 `types.d.ts` 주석의 예시 한 줄)을 비교 스크립트로 확인했다. 모두 주석 안의 `import("../types")`가 `import("../types.js")`로 바뀐 것뿐이다. 그중 두 줄(`calendar.js`, `lectionary.js`의 `parsePath` 주석)은 고치는 줄의 띄어 쓴 조사도 붙였다(pitfalls §31, 문장 검사가 찾았다).
- 새 테스트 `tsconfig.test.js`(6건)가 잡는지, 하나씩 망가뜨리고 실행했다. 망가뜨린 파일은 백업 복사본으로 되돌렸다.

  | 망가뜨린 것 | 실패한 시험 |
  | --- | --- |
  | `gtag-init.js`에서 `export {};` 지우기 | 모듈로 부르는 파일에는 `import`나 `export`가 있다 |
  | `pre-fetch.js`에 `export {};` 넣기 | 일반 스크립트로 부르는 파일에는 없다 |
  | 어디서도 부르지 않는 새 모듈 파일 | 모든 파일이 꼭 한쪽으로 불린다 |
  | `index.html`에서 `pre-fetch.js`를 `type="module"`로 부르기 | 모듈로 부르는 파일에는 있다, 닻 |
  | 검색 워커를 `{ type: "module" }` 워커로 만들기 | 모듈로 부르는 파일에는 있다, 닻 |
  | 검색 워커 주소를 계산식으로 바꾸기 | 모든 파일이 꼭 한쪽으로 불린다, 닻 |
  | `tsconfig.json`의 `moduleDetection`을 `auto`로 | 두 tsconfig는 `legacy`다 |

- `sw.test.js`: 코드를 옮긴 뒤에도 옮기기 전과 같은 12건 통과. 옮긴 코드를 원래 줄과 비교해 `export` 말고는 같음을 확인했다.
- 유닛: `node --test tests/unit/*.test.js` 1669건 통과, 건너뜀 0건(데이터 서브모듈을 받은 상태). 첫 판의 1663건에 새 테스트 6건이 더해졌다. 유닛 테스트는 `js/` 파일을 Node 모듈로 불러오지 않고 내용을 읽어 `vm`으로 실행하므로, `js/package.json`이 테스트에 영향을 주지 않는다.
- e2e는 돌리지 않았다. 브라우저가 실행하는 코드는 바뀌지 않았고(위 비교), 브라우저는 `js/package.json`을 요청하지 않는다(`index.html`의 `<script>` 태그와 `sw.js`의 미리 받기 목록에 없다).

## 갱신한 문서

- `docs/decisions/012-typescript-incremental-adoption.md`: 컴파일러 옵션(`nodenext`, `moduleDetection`, `js/package.json`), 타입 가져오기 경로, 검토한 대안 넷(`bundler`, `"type"` 없는 `nodenext`, 맨 위 `package.json`, `moduleDetection` 기본값), 검증의 모듈 판정 테스트
- `tests/README.md`: 유닛 건수(39파일, 1669건), `tsconfig.test.js` 행, 공용 모듈 `module-graph.js`
- `docs/decisions/019-esm-module-system.md`: 「TypeScript 인식」의 타입 가져오기 경로
- `docs/architecture.md`: §4 `js/` 파일 표와 그 아래 설명에 `js/package.json`, §6의 타입 가져오기 경로
- `docs/topics/platform.md`: 지금 동작에 확장자 규칙과 모듈 판정, 그 판정을 보는 테스트
- `docs/design/liturgical-engine/03-placement-layers.md`: 예시 코드의 타입 가져오기 경로
