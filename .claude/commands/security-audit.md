현재 브랜치의 변경 사항(또는 지정된 파일/범위)에 대해 보안 감사를 수행한다.

## 분석 범위 파악

먼저 감사 대상을 확정한다:
- 인자가 없으면: `git diff main...HEAD --name-only`로 변경 파일 목록 확인
- 인자가 있으면: 지정된 파일/디렉터리를 대상으로 한다

대상 파일을 모두 읽은 뒤 아래 항목 전체를 점검한다.

---

## 점검 항목

### 1. 인젝션 취약점
- **XSS**: `innerHTML`, `outerHTML`, `insertAdjacentHTML` 에 사용자 입력이 직접 삽입되는지 확인
- **DOM Clobbering**: `id`/`name` 속성으로 전역 변수를 덮어쓸 수 있는 HTML 구조 확인
- **CSS 인젝션**: `element.style` 속성에 외부 데이터를 직접 대입하는 패턴 확인 (`${value}px` 등)
- **URL 인젝션**: `location.href`, `src`, `href` 에 외부 값이 삽입되는지 확인 (`javascript:` 프로토콜 포함)

### 2. Google OAuth / GIS 취약점
- **Client ID 노출**: 소스에 하드코딩된 Client ID 확인 → Google Cloud Console의 Authorized Origins 제한 여부 확인 권고
- **Access Token 저장 위치**: `localStorage`/`sessionStorage`/`cookie`에 토큰을 저장하는지 확인 (메모리 보관이 원칙)
- **Refresh Token 저장**: Refresh Token을 영속 스토리지에 저장하는 경우 플래그
- **Token 만료 처리**: 401 응답 시 자동 재인증 또는 사용자 알림 없이 실패하는지 확인
- **Scope 최소 원칙**: 요청 scope가 기능에 비해 과도하게 넓은지 확인 (`drive` 전체 대신 `drive.appdata` 등)
- **State 파라미터**: authorization code flow 사용 시 CSRF 방지 state 파라미터 존재 여부
- **Silent re-auth 루프**: 무한 재시도 또는 무한 재귀 호출 패턴 확인

### 3. 사용하지 않는 코드
- **미사용 변수/상수**: 선언 후 참조되지 않는 `let`/`const`/`var` 확인
- **미사용 함수/메서드**: 정의되었지만 호출되지 않는 함수 확인 (단, public API로 노출된 경우 예외)
- **Dead code**: 절대 도달할 수 없는 분기 (반환 이후 코드, 항상 false인 조건 등)
- **미사용 이벤트 리스너**: `addEventListener` 후 제거되지 않고 누수되는 패턴 확인

### 4. 레이스 컨디션
- **비동기 상태 경쟁**: 동일 상태를 여러 `async` 함수가 동시에 수정하는 패턴
- **타이머 중복**: `setTimeout`/`setInterval` 이 clearTimeout 없이 중복 등록되는 경우
- **토큰 갱신 경쟁**: 여러 요청이 동시에 토큰 만료를 감지해 각각 재인증을 시도하는 경우
- **스토리지 동시 쓰기**: `localStorage` 또는 외부 API에 대한 동시 write 패턴

### 5. Content Security Policy (CSP)
- 불필요하게 넓은 출처 (`*`, `unsafe-inline`, `unsafe-eval`) 확인
- 실제 코드에서 사용하지 않는 도메인이 CSP에 포함된 경우 확인
- `script-src` 에 인라인 스크립트 해시가 올바르게 설정되어 있는지 확인
- 새로운 외부 스크립트/API 추가 시 CSP 업데이트가 누락된 경우 확인

### 6. 데이터 검증 및 신뢰 경계
- **외부 데이터 무검증 적용**: 원격 API, localStorage, postMessage에서 받은 데이터를 타입/구조 검증 없이 DOM 또는 함수에 전달하는 경우
- **Prototype Pollution**: 객체 병합(`Object.assign`, spread) 시 `__proto__`, `constructor` 키 필터링 여부
- **JSON.parse 미보호**: try-catch 없이 `JSON.parse`를 호출하는 경우

### 7. 인증/권한
- **클라이언트 사이드 권한 체크만 존재**: UI에서만 권한을 제한하고 API 요청에는 권한 검증이 없는 패턴
- **토큰/세션 미해제**: 로그아웃 시 토큰 revoke 및 로컬 스토리지 정리가 누락된 경우
- **민감 정보 로깅**: `console.log`에 토큰, 이메일, 개인정보가 출력되는 경우

### 8. Service Worker 보안
- **캐시 범위 과도 설정**: 인증 응답이나 개인화 데이터가 SW 캐시에 저장되는 경우
- **외부 API 요청 캐시**: Google OAuth, Drive API 등 인증 엔드포인트가 캐시되는 경우
- **SHELL_FILES 경로 검증**: SW가 캐시하는 파일 목록에 민감한 파일이 포함된 경우

### 9. 의존성 및 외부 스크립트
- **외부 CDN 스크립트 무결성 미검증**: `<script src="https://...">` 에 `integrity` 속성(SRI)이 없는 경우
- **버전 고정 미흡**: `@latest` 등 부동 버전 사용으로 공급망 공격에 노출되는 경우

### 10. 정보 노출
- **소스 내 비밀값**: API key, client secret, password, token이 하드코딩된 경우 (Client ID는 공개 허용)
- **에러 메시지 과다 노출**: 스택 트레이스나 내부 경로가 사용자에게 노출되는 경우
- **주석 내 민감 정보**: TODO/FIXME 주석에 내부 구조나 취약점 힌트가 남아있는 경우

---

## 보고 형식

각 발견 사항을 다음 형식으로 보고한다:

```
### [심각도] 제목

**파일**: `경로/파일명:줄번호`
**문제**: 무엇이 왜 위험한지 한 문장으로
**코드**:
  (문제가 되는 코드 스니펫)
**권고**: 구체적인 수정 방법
```

심각도 기준:
- 🔴 **Critical** — 즉시 악용 가능, 릴리스 차단
- 🟠 **High** — 조건부 악용 가능, 릴리스 전 수정 강권
- 🟡 **Medium** — 위험도 낮음, 다음 이터레이션 내 수정 권장
- 🔵 **Info** — 모범 사례 위반, 선택적 개선

발견 사항이 없는 항목은 생략하고, 모든 항목이 이상 없으면 "✅ 발견된 취약점 없음"으로 마무리한다.

마지막에 **요약 테이블**을 작성한다:

| 심각도 | 건수 |
|--------|------|
| 🔴 Critical | N |
| 🟠 High | N |
| 🟡 Medium | N |
| 🔵 Info | N |

---

## 결과 저장

감사가 완료되면 결과 전체를 `docs/archive/audit/` 디렉터리에 저장한다.

1. `docs/archive/audit/` 디렉터리가 없으면 먼저 생성한다.
2. `date +"%Y-%m-%d-%H%M%S"` 명령으로 현재 타임스탬프를 구한다.
3. 파일명: `docs/archive/audit/YYYY-MM-DD-hhmmss.md`
4. 파일 앞에 아래 헤더를 붙인다:

```
# 보안 감사 — YYYY-MM-DD HH:MM:SS

- **감사 대상**: (브랜치명 또는 파일 목록)
- **감사 시각**: YYYY-MM-DD HH:MM:SS
```

5. 이어서 발견 사항 전체와 요약 테이블을 기록한다.
