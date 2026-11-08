---
pr: 531
date: 2026-11-08
branch: chore/typescript-7
title: "chore: TypeScript 7로 올리기"
---

## 요약

타입 검사에 쓰는 TypeScript를 5.9.3에서 최신 안정판 7.0.2로 올렸다(ADR-012). 7.0은 컴파일러를 Go로 다시 만든 판이다. 6.0에서 사용 중단을 예고한 설정이 7.0에서 없어져 설정 하나를 바꾸고, JSDoc을 더 엄격하게 읽어 생긴 오류 두 건을 고쳤다. 브라우저가 실행하는 동작은 바뀌지 않는다.

## 확정 · 근거

- **6.0이 아니라 7.0으로 올렸다.** 사용자는 최신 판을 원했고, TypeScript에는 장기 지원판이 없어 고침판이 지금의 안정판에만 나온다(공식 출시 방침). 7.0에는 다른 도구가 TypeScript를 불러 쓰는 API가 없지만, 이 저장소는 `tsc` 명령만 쓰므로 해당하지 않는다.
- **`moduleResolution`을 `node`에서 `bundler`로 바꿨다.** 7.0이 `node`(node10)를 없앴다(TS5108). `bundler`는 옛 값처럼 확장자 없는 상대 경로를 막지 않아 검사의 엄격함이 그대로다. 두 설정의 검사 대상 파일(40개와 1개)도 5.9와 같다. 공식 안내서가 브라우저 코드에 권하는 `nodenext`와 `js/package.json`의 조합은 오류 207건이 나와 미뤘다. 이유와 재검토 조건은 ADR-012 「검토한 대안」에 적었다.
- **`gtag-init.js`**: 7.0은 `arguments`를 보고 매개변수를 짐작하지 않아, 인자 둘을 넘기는 호출이 오류였다(TS2554). 쓰지 않는 나머지 매개변수 `..._args`로 인자를 받는다고만 선언하고, 본문은 구글 안내 코드처럼 `arguments` 객체를 그대로 넘긴다.
- **`liturgical-engine.js`의 `int`**: 변수에 `@type {(v: unknown) => v is number}`를 달았더니 7.0이 TypeScript 파일과 같이 대입 검사를 해 오류였다(TS2322). 같은 뜻을 `@param`과 `@returns {v is number}`로 함수에 달았다. 주석만 바뀌었다.
- **일부러 바꾸지 않은 것**: `lib`의 `DOM.Iterable`과 `esModuleInterop: true`는 6.0부터 군더더기다(앞은 빈 파일, 뒤는 늘 켜진 값). 해가 없어 그대로 두었다.

## 검증

- `npm run typecheck`: 7.0.2에서 오류 0건. 5.9.3은 4.4초, 7.0.2는 0.5초.
- 설정을 바꾼 뒤 손대지 않은 파일에 타입 오류를 일부러 넣어 보았다. 앱 설정은 `views.js`의 세 건(잘못된 인자 타입, 빈 값일 수 있는 요소, 숫자 매개변수에 문자열)을, 워커 설정은 `search-worker.js`의 한 건을 잡았다. 넣은 줄은 되돌렸다.
- `npm ci --ignore-scripts`(CI와 같은 설치)로 7.0.2의 실행 파일이 깔리고 실행되는 것을 확인했다.
- `gtag`: 고치기 전과 뒤의 파일을 Node의 vm에서 실행해 `dataLayer`에 들어간 값을 비교했다. 둘 다 `arguments` 객체 둘(`js`, `config`)로 같았다.
- 유닛: `node --test tests/unit/*.test.js` 1663건 통과(데이터 서브모듈을 받은 상태).
- e2e: 8091 포트에서 43건 통과. `gtag-init.js`는 모든 화면에서 실행되어 `test_navigation.py`를, `liturgical-engine.js`는 교회력 계산을 그리는 `test_liturgical_render.py`를, 방문 통계는 `test_calendar_view.py::test_list_saves_the_address_after_stopping_without_reporting_a_page_view`를 골랐다.

## 갱신한 문서

- `docs/decisions/012-typescript-incremental-adoption.md`: 컴파일러 옵션에 `moduleResolution`, 「TypeScript 7」 절, 검토한 대안 둘(6.0에 머무르기, `nodenext`)
- `docs/topics/platform.md`: 지금 동작에 TypeScript 7과 JSDoc 규칙 둘
