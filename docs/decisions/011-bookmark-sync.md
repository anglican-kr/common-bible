# ADR-011: 북마크 디바이스 간 동기화

- 일시: 2026-04-26
- 상태: 승인됨 (Phase 2a-2j 완료, PKCE 단일 경로로 운영 중. Google OAuth 검수 통과 2026-05-19. 기준 목록 1단계 구현 완료 2026-10-31, 2단계는 계획)

## 결정

- **Phase 2a**: 내보내기와 가져오기(JSON 파일, 서버가 필요 없다). 바로 시작했다.
- **Phase 2b**: Google Drive `appdata` 폴더를 이용한 자동 동기화.
  - 인증: Authorization Code Flow + PKCE. refresh token을 받아 IndexedDB에 암호화해 둔다(Phase 2h, 2026-05-08). `/token` 요청은 nginx BFF가 `client_secret`을 붙여 넘긴다(ADR-017).
  - 처음 정한 플랫폼별 로그인 UX(Android(GIS 무음), iOS 17+(FedCM), iOS 16↓(One Tap))는 Phase 2b-2g에서 구현했다가, Phase 2h에서 PKCE 리디렉션 하나로 모았다(아래 「검토한 대안」).
  - 동기화: 사용자가 켤 때만(Opt-in) 하고, 바뀌면 바로 올린다. 병합은 항목 단위다(Phase 2c).

## 진행

- 2026-04-28: Google Drive 동기화 기술 결정 확정.
- 2026-04-30: Phase 2a 구현 완료.
- 2026-05-02: Phase 2b 구현 완료, 보안 감사 완료.
- 2026-05-04: Phase 2c 구현 완료.
- 2026-05-05: Phase 2d(iOS FedCM/One Tap 적용).
- 2026-05-05: Phase 2e(FedCM-mandatory deprecation 마이그레이션).
- 2026-05-05: Phase 2f(iOS OAuth 풀페이지 리디렉션).
- 2026-05-06: Phase 2f 머지(Cursor Bugbot 6차 리뷰 정제와 GIS 토큰 빈 응답에서 멈추는 문제 수정).
- 2026-05-06: Phase 2g(iOS 앱을 다시 열 때 silent prompt=none 자동 리디렉션).
- 2026-05-08: Phase 2h 완료(PKCE와 refresh token으로 옮기고, desktop·Android·iOS를 한 경로로 모았다), Phase 2i 완료(sync 사이클 캐시로 라운드트립을 줄였다).
- 2026-05-11: Phase 2j(visibilitychange 폴 throttle과 ETag 관측성 보강).
- 2026-05-11: ADR-020 분할에 따라 BFF nginx 설정은 `common-bible-server/nginx/oauth-proxy.example.conf`로 옮겼다. 클라이언트 쪽 동기화 흐름과 refresh token 보관 위치는 바뀌지 않았다.
- 2026-05-19: Google OAuth 앱 검수 통과. `In production`으로 바꿔 refresh token TTL이 영구가 되었다. 코드 변경은 없다.
- 2026-08-01: 설정 병합 전방 호환(PR #309, 아래).
- 2026-10-22: 옛 버전의 북마크 절 범위를 병합 결과를 저장하기 전에 옮긴다(아래).
- 2026-10-26: 가져오기 병합이 같은 id의 폴더 안으로 들어간다(Phase 2a). 동기화 저장소는 `toString` 같은 기본 속성 이름의 id에도 멈추지 않는다(known-issues §15.2, `topics/sync.md`). 저장할 때 앞뒤 순서가 그대로인 항목은 순서 값을 바꾸지 않는다(Phase 2c, 아래 「검토한 대안 — 순서 값」).
- 2026-10-31: 새 수정 시각은 그 기록의 이전 수정 시각보다 늦은 시각으로 기록한다(Phase 2c 「수정 시각」, 아래 「검토한 대안 — 수정 시각」, known-issues §39). 드라이브가 그대로일 때 올릴 변경은 문서 지문으로 판단한다(Phase 2i, known-issues §38). Phase 2j의 추적 항목에 답했다. 구글은 앱이 읽을 수 있는 ETag를 주지 않는다. 수정 시각이 같으면 드라이브의 사본을 남긴다(Phase 2c 「같은 수정 시각」).
- 2026-10-31: 북마크 삭제 기록을 기기에서 지우지 않는다(Phase 2c 「삭제 기록 보존」). 기준 목록을 저장만 하고 병합 판단에는 쓰지 않는다(Phase 2c 「기준 목록」 1단계). 구글 시각 보정은 하지 않고, 드라이브 파일의 쓰기 보호는 한계로 둔다(아래 「검토한 대안 — 삭제 기록과 기준 목록」, known-issues §39, §42).

## 맥락

ADR-010에서 Phase 1 북마크는 `localStorage` 기반 클라이언트 전용으로 구현했다.
이후 iOS Safari의 **7일 비활성 자동 삭제 정책(ITP)** 이 확인되어 데이터 유실 위험이 존재한다.
홈 화면 PWA로 설치하면 ITP 적용이 제외되어 안전하지만, 미설치 사용자는 여전히 취약하다.

ADR-001 제약 조건: 백엔드 없는 SPA 아키텍처 유지 필수 — 서버 인프라 추가 불가.

Phase 2의 목표:

1. 디바이스 간 동기화 (같은 계정, 다른 기기)
2. 브라우저 저장소 삭제로 인한 데이터 유실 방지

## 검토한 대안

### 동기화 방식

| 방식                                  | 특징                                         | 결정        |
| ------------------------------------- | -------------------------------------------- | ----------- |
| 자체 서버 API (계정 시스템)           | 서버 인프라, 인증·가입·관리, 운영 비용 필요  | ❌          |
| 서드파티 BaaS (Firebase, Supabase 등) | 외부 서비스 의존성, 데이터 주권, 비용 가변   | ❌          |
| 내보내기/가져오기 (JSON 파일)         | 서버 불필요, 즉시 구현 가능, 수동 조작 필요  | ✅ Phase 2a |
| Google Drive appdata 동기화           | 서버 불필요, 자동 동기화, OAuth 앱 등록 필요 | ✅ Phase 2b |

### OAuth Flow (Phase 2b)

| 방식                      | 특징                                     | 결정    |
| ------------------------- | ---------------------------------------- | ------- |
| Authorization Code + PKCE | Client Secret 불필요, SPA 표준(RFC 7636) | ✅ 채택 |
| Implicit Flow             | Deprecated(RFC 9700)                     | ❌      |
| Client Secret 포함        | 프론트엔드 코드에 비밀 노출              | ❌      |

Phase 2b-2g의 실제 구현은 GIS Token Client 기반 Implicit Flow였다. 2026-05-08 Phase 2h에서 이 표대로 PKCE로 되돌렸다. Google 「웹 애플리케이션」 클라이언트는 PKCE를 써도 `client_secret`을 요구해, 비밀 값은 nginx BFF가 서버 쪽에서 붙인다(ADR-017, 아래 Phase 2h).

### Drive Scope (Phase 2b)

| Scope           | 접근 범위                         | 결정    |
| --------------- | --------------------------------- | ------- |
| `drive.appdata` | 앱 전용 숨김 폴더만               | ✅ 채택 |
| `drive.file`    | 앱 생성 파일, 사용자 Drive에 노출 | ❌      |
| `drive`         | Drive 전체 읽기·쓰기              | ❌      |

### 플랫폼별 인증 UX (Phase 2b)

| 방식                    | 플랫폼           | 결정       |
| ----------------------- | ---------------- | ---------- |
| GIS 기기 계정 무음 획득 | Android          | ✅ 채택    |
| FedCM                   | iOS 17+          | ✅ 채택    |
| Google One Tap          | iOS 16 이하 폴백 | ✅ 채택    |
| 매번 팝업               | 전체             | ❌ UX 불량 |

Android는 OS 수준에서 Google 계정이 연결되어 있어 Chrome 세션이 거의 항상 유효.
iOS는 Safari WebKit 세션 기반이지만 FedCM이 브라우저 신원 저장소를 사용해 세션 만료 빈도를 줄임.

채택 안 함 2026-05-08 · 이유: 플랫폼마다 다른 경로가 iOS 팝업 차단과 데스크톱 cold start 팝업을 되풀이해 낳았다(Phase 2d-2g). Phase 2h에서 PKCE 리디렉션과 refresh token 하나로 모았다 · 재검토: 없음.

### 토큰 저장 (Phase 2b)

| 방식           | XSS 위험       | 재시작 후 재로그인       | 결정    |
| -------------- | -------------- | ------------------------ | ------- |
| 메모리(변수)   | 없음           | GIS 무음 갱신으로 불필요 | ✅ 채택 |
| localStorage   | 토큰 탈취 위험 | 불필요                   | ❌      |
| sessionStorage | 토큰 탈취 위험 | 필요                     | ❌      |

Access Token 수명은 1시간. 만료 시 GIS가 브라우저 세션을 이용해 무음 재발급.
localStorage 저장 시 XSS 공격으로 Google 계정 접근권 탈취 가능 — 북마크 유출보다 피해 범위가 크므로 채택 불가.

Phase 2h(2026-05-08)부터는 access token은 그대로 메모리에 두고, refresh token을 IndexedDB에 비추출 AES-GCM 키로 암호화해 둔다(아래 「Refresh Token 저장 전략」). 메모리만 쓰던 처음 방식은 refresh token이 없어 데스크톱에서 앱을 열 때마다 팝업이 떴다.

### 동기화 트리거 (Phase 2b)

| 방식                   | 설명                            | 결정                                 |
| ---------------------- | ------------------------------- | ------------------------------------ |
| 변경 즉시              | 북마크·설정 변경 시 바로 업로드 | ✅ 채택                              |
| 앱 포커스 진입/이탈 시 | 호출 횟수 최소화                | ❌ 같은 기기 탭 여러 개 시 충돌 가능 |
| 주기적(30초~1분)       | 구현 복잡도 중간                | ❌ 변경 후 최대 1분 지연             |

북마크·설정 데이터는 수 KB 수준이므로 즉시 업로드 네트워크 부담 미미.

### 충돌 해결 (Phase 2b)

| 방식               | 설명                            | 결정    |
| ------------------ | ------------------------------- | ------- |
| Last-write-wins    | 단순, 동시 편집 시 데이터 손실  | ❌      |
| Merge-by-timestamp | `updatedAt` 기준 최신 버전 채택 | ✅ 채택 |
| 사용자 선택 UI     | 충돌마다 팝업, 인지 부하 과다   | ❌      |

### 순서 값 (Phase 2c, 2026-10-26)

채택한 것은 앞뒤 순서가 그대로인 항목의 값을 두는 방식이다(Phase 2c 「순서 값」). 아래는 채택 안 한 것이다(사용자 결정 2026-10-26).

- **빈 번호만 그대로 두기**: 지울 때와 병합 뒤 저장할 때는 해결된다. 하지만 하나를 앞으로 옮기면 뒤의 항목들이 여전히 새 시각을 받는다.
- **폴더가 안의 순서를 id 목록으로 들기, 항목마다 바로 앞 항목의 id를 들기**: 하나를 지울 때 바뀌는 기록이 하나뿐이다. 하지만 저장 형식이 바뀌고, 두 기기가 같은 폴더를 동시에 고치면 목록이나 앞 항목을 두고 다투는 경우를 따로 풀어야 한다.
- **수정 시각을 내용용과 자리용으로 나누기**: 자리만 바뀐 항목이 다른 기기의 내용 수정을 덮어쓰는 일을 뿌리에서 막는다. 채택한 방식으로도 남는 경우(한 기기가 옮긴 항목을 다른 기기가 동시에 고침, 북마크를 한 칸 아래로 옮길 때 바로 아래에 있던 북마크가 새 시각을 받음)까지 막는다. 하지만 동기화 문서 형식이 바뀌어 옛 버전과 섞일 때를 설계해야 한다. 재검토 조건: 동시에 고친 내용이 사라졌다는 사용자 보고가 있거나, 동기화 문서 형식을 바꿀 다른 까닭이 생길 때.

### 수정 시각 (Phase 2c, 2026-10-31)

채택한 것은 새 수정 시각을 기기 시각과 「그 기록의 이전 수정 시각보다 1밀리초 늦은 시각」 가운데 늦은 쪽으로 기록하는 방식이다(Phase 2c 「수정 시각」). 아래는 채택하지 않은 것이다. 조사 보고서와 노트는 `docs/archive/research/2026-10-device-clock-sync/`, 근거와 확인한 사실은 원장 `docs/changes/2026-10-31-sync-clock.md`에 있다.

- **문서 전체에서 본 가장 늦은 시각보다 늦게 기록하기(하이브리드 논리 시계)**: 304 경로의 판단까지 함께 고쳐진다. 하지만 시각이 빠른 기기 하나가 다른 기기가 새로 기록하는 시각을 모두 그 시각보다 늦게 만들고, 서로 모르고 고친 두 편집의 결과를 상관없는 기록이 정한다(사용자 결정 2026-10-30). 재검토 조건: 기록마다 늦은 시각으로 기록하는 방식으로 막지 못한 덮어쓰기가 보고될 때.
- **기준 사본으로 하는 세 방향 병합**: 한쪽에서만 바뀐 기록은 시계 없이 정한다. 하지만 기기에 기록마다 지문이나 문서 한 벌을 더 저장해야 한다. 드라이브가 쓰기를 보호하지 않으므로 기준은 「마지막으로 내려받은 파일」이어야 하고, 드라이브에 없는 기록을 지운 것으로 읽으면 안 된다. 재검토 조건: 옛 버전 기기의 느린 시계가 계속 문제가 되거나, 필드마다 합쳐야 할 때.
- **파일 안의 쓰기 차례 번호(Evernote의 USN 방식)**: 드라이브가 쓰기를 하나씩 받아 줘야 쓸 수 있다. 그런데 구글이 ETag를 보내지 않아 앱이 `If-Match` 조건을 보낼 수 없다. 옛 버전은 문서 맨 위의 새 필드를 병합에서 버린다(2026-10-30 실행해 확인). 재검토 조건: 브라우저에서 비교 후 교체(내가 읽은 버전일 때만 쓰기)가 가능해질 때.
- **기록마다 버전 벡터(기기별 카운터 묶음)**: 서로 모르고 고친 편집을 정확히 알아낸다. 하지만 기기가 넷이면 기록마다 Safari에서 약 200바이트가 늘고, 옛 버전은 카운터를 올리지 않으며, 알아낸 뒤 무엇을 남길지 보여 줄 화면이 없다. 재검토 조건: 충돌을 보여 줄 화면을 만들 때.
- **기록마다 파일 나누기**: 드라이브가 파일마다 매기는 `version`으로 한쪽의 변경을 시계 없이 판단하고, 삭제를 파일 삭제로 기록한다. 하지만 첫 동기화에 북마크 수만큼 요청이 든다(1,000개면 요청량 20만 단위 이상, 지금 동기화 한 번은 약 350단위). 여러 기록을 바꾸는 일이 중간에 멈출 수 있고, 옛 버전과 함께 쓸 수 없으며, 동기화 엔진을 새로 만들어야 한다. 재검토 조건: 동기화 엔진을 다른 까닭으로 다시 만들 때.
- **변경분만 담은 파일을 새로 올리기**: 어떤 기기도 남의 파일을 덮어쓰지 않는다. 하지만 오래된 변경분 파일을 지울 때 삭제 기록 정리와 같은 문제가 생기고, 요청 수가 늘며, 옛 버전과 함께 쓸 수 없다. 재검토 조건: 북마크가 수천 개로 늘거나 큰 자료를 동기화에 넣을 때(known-issues §33).

### 같은 수정 시각 (Phase 2c, 2026-10-31)

채택한 것은 두 사본의 수정 시각이 같으면 드라이브의 사본을 남기고, 폴더의 펼침 상태만 이 기기의 값을 두는 방식이다(Phase 2c 「같은 수정 시각」). 아래는 채택하지 않은 것이다(사용자 결정 2026-10-31).

- **기기 id 순서에 따라 남기기**(2026-10-31까지 쓰던 방식): 비교 상대가 그 편집을 한 기기가 아니라 마지막으로 올린 기기라, 한 기기는 자기 사본을 남기고 시각이 같아 올리지도 않았다. 드라이브와 그 기기가 다른 사본을 보였다. 재검토 조건: 없음.
- **내용으로 정한 순서에 따라 남기고, 드라이브와 다르면 올리기**: 어느 기기에서 병합해도 같은 사본이 남고 드라이브도 그 사본으로 맞춰진다. 하지만 올릴지 정하는 조건(지금은 수정 시각만 비교한다)까지 바꿔야 한다. 재검토 조건: 드라이브의 사본을 남겨도 기기마다 다른 사본이 남는 경우가 보고될 때.
- **폴더의 펼침 상태도 드라이브의 값을 남기기**: 펼침 상태는 내용이 아니라서(`_contentKey`) 폴더를 열고 닫아도 수정 시각이 그대로다. 드라이브의 값을 남기면 방금 연 폴더가 동기화 뒤에 닫혔다(PR #456 리뷰에서 실행해 확인). 재검토 조건: 없음.
- **펼침 상태를 바뀐 내용으로 세기**: 폴더를 열고 닫을 때마다 수정 시각이 올라, 다른 기기에서도 같은 폴더가 열리고 닫힌다. 재검토 조건: 펼침 상태를 기기끼리 맞추고 싶다는 의견이 있을 때.
- **펼침 상태를 동기화 문서 밖, 이 기기에만 저장하기**: 저장 구조가 바뀌어 옛 버전과 섞일 때를 설계해야 한다. 재검토 조건: 동기화 문서 형식을 바꿀 다른 까닭이 생길 때.

### 304일 때 올릴 변경의 판단 (Phase 2i, 2026-10-31)

채택한 것은 마지막으로 맞춘 문서의 지문과 지금 문서의 지문을 비교하는 방식이다(Phase 2i 「결정」). 아래는 채택하지 않은 것이다(사용자 결정 2026-10-31).

- **가장 늦은 수정 시각 비교**(2026-05-08부터 쓰던 방식): 마지막으로 맞춘 문서의 가장 늦은 시각보다 이른 시각을 받은 변경을 놓친다. 시계가 느린 기기에서 새로 만든 북마크와 옛 목록에서 옮긴 시각 0의 항목이 그렇다(known-issues §38). 재검토 조건: 없음.
- **304 경로 지우기**: 운영에서 실행되지 않는 코드가 줄어든다. 하지만 Phase 2i와 2j의 결정과 그 테스트들을 고쳐야 하고, 구글이 ETag를 주기 시작하면 다시 만들어야 한다. 재검토 조건: 304 경로를 대신할 빠른 경로(변경 목록 API 등)를 만들 때.
- **「올릴 것 있음」 표시**: 저장할 때마다 켜고 올린 뒤 끄는 표시라 지문을 계산하지 않아도 된다. 하지만 저장하는 곳마다 표시를 켜야 하고, 올리는 도중의 편집을 잃지 않으려면 올리기를 시작할 때의 값을 따로 기억해야 한다(Firefox의 변경 카운터 방식). 재검토 조건: 지문 계산이 사용자가 느낄 만큼 느려질 때.

### 삭제 기록과 기준 목록 (Phase 2c, 2026-10-31)

채택한 것은 북마크 삭제 기록을 지우지 않고, 기준 목록을 저장만 하는 1단계다(Phase 2c 「삭제 기록 보존」, 「기준 목록」). 2단계에서 규칙 다와 「드라이브에 처음 보인 때부터 30일」 정리를 더할 계획이다. 아래는 채택하지 않은 것이다(사용자 결정 2026-10-31). 흉내 장치는 실제 `store-v2.js`와 `state-machine.js`를 기기마다 따로 실행하고, 운영처럼 ETag 없이 올리기를 조건 없이 받는 가짜 드라이브를 함께 쓰게 한 것이다. 결과는 원장 `docs/changes/2026-10-31-sync-base-ids.md`에 있다.

- **목록이 하루 지난 뒤에만 판단하기(하루 조건)**: 덮어쓴 직후에는 판단하지 않는다. 하지만 덮어쓴 뒤 아무도 동기화하지 않은 채 하루가 지나면, 덮어써진 북마크를 다른 기기에서 지운 것으로 보고 지웠다. 처음 동기화를 켠 기기가 겹친 동기화 안에서 올린 북마크도 이틀 뒤에 지웠다(흉내 장치). 재검토 조건: 없음.
- **수정 시각이 30일 지난 북마크만 지우기(규칙 가)**: 수정 시각이 오래된 북마크를 겹친 동기화 안에서 처음 올리면 지웠다. 오래전에 만든 북마크를 가진 기기가 처음 동기화를 켜거나 다시 켤 때와, 옛 목록에서 옮긴 시각 0의 항목이 그렇다(흉내 장치). 수정 시각은 다른 기기의 시계로 기록했을 수도 있다. 재검토 조건: 없음.
- **올린 문서로 목록 만들기**: 이 기기만 올린 북마크가 목록에 들어간다. 드라이브가 쓰기를 보호하지 않아, 그 파일을 덮어쓴 기기와 겹치면 그 북마크를 다른 기기에서 지운 것으로 읽었다(목록을 바로 판단에 쓰게 한 흉내 장치, known-issues §42). 판단을 30일 늦춰도, 덮어써진 뒤 30일 넘게 동기화하지 않은 기기는 같은 일을 겪는다(코드로 판단). 재검토 조건: 드라이브 파일의 쓰기를 보호할 수 있을 때.
- **반대 방향 판단(드라이브에만 있고 이 기기에는 항목도 삭제 기록도 없는 북마크가 목록에 있으면 이 기기가 지운 것으로 보기)**: 이 기기에 없는 까닭이 지운 것만은 아니다. 이 기기에서 저장이 거절되거나 기기의 자료가 지워져 빠진 북마크도 같은 모양이라, 지운 것으로 보면 이 기기에서만 생긴 잃음이 삭제로 바뀌어 모든 기기로 퍼진다(설계 흉내 실험의 판단, 2026-10-31). 또 이 기기가 지운 북마크는 1단계부터 이 기기에 삭제 기록으로 남아(기기의 북마크 삭제 기록을 지우지 않는다) 목록으로 판단할 일이 없다. 재검토 조건: 기기의 북마크 삭제 기록을 다시 지우게 될 때.
- **동기화를 끌 때 목록 지우기**: 다시 켜면 목록이 없어 첫 병합에서 판단하지 못한다. 2단계를 흉내 내 보니, 오래 꺼 둔 기기가 돌아오면 그사이 다른 기기에서 지운 북마크가 되살아났다(흉내 장치). 다른 계정이나 다시 만든 파일의 목록은 파일 id가 달라 이미 읽지 않는다. 재검토 조건: 없음.
- **1단계에서 판단 켜기**: 운영에서 드라이브 파일의 삭제 기록은 지금 지워지지 않으므로, 규칙 다가 지울 북마크는 겹친 동기화나 손상된 파일 같은 예외에서만 생긴다. 판단을 켜도 얻는 것이 없고, 예상하지 못한 경우에 북마크를 잃을 수 있다. 먼저 병합 기록으로 그런 북마크가 운영에서 생기는지 본다. 재검토 조건: 2단계를 시작할 때.
- **구글 시각 보정**: 드라이브 서버의 시각(`Date` 헤더)과 이 기기 시각의 차이로 기기 시각을 보정한다. 서로의 편집을 받기 전에 같은 기록을 고친 경우에도 실제로 나중에 고친 사본이 남는다(흉내 장치). 하지만 그런 경우는 드물다고 보았고(known-issues §39), 2단계의 기간은 한 기기가 자기 시계로 재므로 보정이 없어도 맞는다. 구글 문서는 `Date` 헤더를 앱에 주는 것을 약속하지 않는다. 재검토 조건: 시계가 틀린 기기에서 나중에 고친 편집이 사라졌다는 보고가 있을 때.
- **쓰기 보호: 올리기 직전에 `version` 확인**: 올리기 직전에 파일의 `version`(구글이 쓰기마다 올리는 번호)을 다시 묻고, 달라졌으면 다시 내려받는다. 하지만 확인한 뒤 올리기가 끝나기 전에 다른 기기가 올리면 그대로 겹친다. 겹칠 수 있는 시간이 내려받는 시간만큼(Phase 2i 실측으로 약 1.1초)만 줄고, 요청이 동기화마다 하나, 올릴 때는 둘 는다(흉내 장치). 빠진 편집은 지금도 다음 동기화가 다시 올린다. 재검토 조건: 겹친 동기화로 편집이 사라졌다는 보고가 있을 때.
- **쓰기 보호: Drive v2의 `etag`와 `If-Match`**: 동작하면 내가 읽은 버전일 때만 덮어써 겹침이 없어진다. 하지만 브라우저에서 동작하는지 확인하지 않았고, 앱이 쓰는 v3와 다른 API 버전의 호출을 더해야 한다. 재검토 조건: 겹친 동기화로 편집이 사라졌다는 보고가 있을 때.

그래서 드라이브 파일의 쓰기 보호는 한계로 둔다(known-issues §42).

---

## Phase 2a — 내보내기/가져오기 (서버 불필요)

구현 범위 (완료 2026-04-30):

- 북마크 드로어 툴바에 내보내기(`download`) / 가져오기(`upload`) 버튼 추가
- 내보내기: `bible-bookmarks-{날짜}.json` 파일 다운로드 (`_version`, `exportedAt`, `bookmarks` 필드)
- 가져오기: JSON 파일 선택 → `_validateImportData()` 검증 → 병합 또는 덮어쓰기 선택. 항목마다 검사해 어긋난 항목은 뺀다(ADR-040). 2026-06-06 전 버전이 저장한 절 범위의 줄 글자는 들이면서 지금 표기로 옮긴다(ADR-010 「옛 저장값」)
- 병합: `id` 기준 중복 제거 — 동일 ID 항목은 기존 유지, 새 항목만 추가 (폴더 `children` 재귀 처리). 같은 id의 폴더는 그 안으로 들어가 파일의 새 항목을 더하고, 폴더의 자리와 이름은 지금 목록을 따른다. 2026-10-26 전의 구현은 같은 id의 폴더를 안의 것까지 건너뛰어, 그 폴더에 든 새 항목이 들어오지 않았다(known-issues §15.1)
- 스키마 버전 필드(`_version: 1`) 추가로 향후 마이그레이션 대비

---

## Phase 2b — Google Drive 자동 동기화 (구현 완료 2026-05-02)

(2026-05-02) Phase 2b 구현 완료. 주요 구현 사항:

- **`js/drive-sync.js` 신규**: GIS Implicit Token Flow 기반 인증, 업로드/다운로드/머지 구현
- **토큰 전략**: `_accessToken` 메모리 전용, GIS `prompt:""` 백그라운드 재발급
- **레이스 컨디션 방지**: `_isRefreshing` 플래그로 동시 401 응답 시 중복 `_silentSignIn()` 차단
- **파싱 방어**: `res.json()` try-catch로 HTML 유지보수 페이지 등 예상치 못한 응답 처리
- **충돌 해결 스낵바**: "다른 기기에서 변경된 데이터를 불러왔습니다." 알림 구현
- **보안 감사**: `docs/archive/audit/2026-05-02-171111.md` — Critical·High 0건, Medium 2건 수정, Info 2건 수용

### 앱 사용자 관점 흐름

#### 첫 기기 — 초기 설정

1. 설정 → "Google Drive 동기화" 토글 ON
2. Google 로그인 팝업 (최초 1회)
3. 권한 동의 — Drive 앱 폴더 접근
4. 현재 로컬 데이터 → Drive 업로드

#### 두 번째 기기 — 첫 접속

1. 앱 열기 → GIS 백그라운드 로그인 (재로그인 불필요)
2. Drive에서 `sync.json` 자동 pull
3. 북마크·설정·읽기 위치 자동 적용

#### 일상 사용

- 북마크 저장·삭제, 설정 변경 → 즉시 Drive 업로드
- 앱 열기 → Drive 최신 데이터 자동 pull → 로컬과 merge

#### 연결 해제

1. 설정 → "연결 해제"
2. Drive 파일 삭제 여부 선택
3. 로컬 데이터 유지, 이후 localStorage 전용으로 복귀

### 데이터 구조

```
localStorage (1차, 오프라인 우선)
    ↕ 동기화
Google Drive appdata/sync.json (2차, Google 계정 연동 시)
```

동기화는 Opt-in이며 기본값은 기존 localStorage 전용 동작 유지.

### 동기화 데이터 스키마 (`sync.json`)

```js
{
  version: 1,
  updatedAt: number,         // Unix ms — 충돌 해결 기준
  bookmarks: BookmarkStore,  // ADR-010 스키마 그대로
  settings: {
    fontSize: number,
    colorScheme: string,
    theme: string,
    bookOrder: string,
    startupBehavior: string,
  },
  lastRead: { bookId: string, chapter: number, verse: number },
}
```

### 충돌 해결 로직

Drive `sync.json`의 `updatedAt`과 로컬 `updatedAt` 비교:

- Drive가 더 최신 → Drive 데이터로 로컬 덮어쓰기
- 로컬이 더 최신 → Drive에 업로드
- 동일 → 무작동

### 기술 구현

- Google Identity Services (GIS) — 최신 OAuth 2.0 라이브러리
- Google Drive REST API v3 — `appDataFolder` 스코프
- Vanilla JS (기존 아키텍처 일관성 유지)

#### 인증 초기화 (`js/app.js`)

```js
// 앱 시작 시 무음 로그인 시도 (FedCM / 기기 계정)
google.accounts.id.initialize({
  client_id: CLIENT_ID,
  use_fedcm_for_prompt: true,
  callback: handleIdToken,
});
google.accounts.id.prompt(); // 실패 시 토큰 없이 진행, 로그인 버튼 표시

// 수동 로그인 버튼 클릭 시 (최초 또는 세션 만료)
const tokenClient = google.accounts.oauth2.initCodeClient({
  client_id: CLIENT_ID,
  scope: "https://www.googleapis.com/auth/drive.appdata",
  ux_mode: "popup",
  callback: handleAuthCode,
});
```

#### 서비스 워커 캐시 제외 (`sw.js`)

```js
// OAuth/Drive API 요청은 캐시 우회
if (
  url.hostname.endsWith("googleapis.com") ||
  url.hostname.endsWith("accounts.google.com")
) {
  return;
}
```

#### CSP 추가 (`index.html`)

```
script-src: 현재 + https://accounts.google.com
connect-src: 현재 + https://oauth2.googleapis.com
                   https://www.googleapis.com
                   https://content.googleapis.com
```

### Google 앱 등록 사전 조건

사용자가 자신의 Google 계정을 사용하더라도, **앱 자체**를 Google에 등록해야 한다.

1. Google Cloud Console에서 프로젝트 생성 (무료)
2. Google Drive API 활성화
3. OAuth 2.0 Client ID 발급 (Web application 타입, Client Secret 미사용)
4. 승인된 JavaScript 원본: 운영 도메인 + `http://localhost:8080`
5. 동의 화면(consent screen) 구성 + **Google 앱 심사(verification) 통과**

#### 앱 심사 요건

- 개인정보처리방침 URL 필요
- 앱 설명, 로고 등록
- 요청 scope 정당성 입증

심사 전: 테스트 사용자 100명으로 제한.
심사 후: 모든 Google 계정 사용자에게 개방.

`drive.appdata`는 제한된 스코프이나 민감 스코프에 해당하지 않아 심사 난이도 낮음.

---

## 채택 이유 요약

- **Phase 2a 즉시 착수**: 서버 없이 백업·이전 수단 제공, 사용자 데이터 주권 완전 보장
- **PKCE**: Client Secret 없이 SPA 표준 OAuth 구현, 프론트엔드 코드에 비밀 없음
- **`drive.appdata`**: 사용자 Drive 비노출, 최소 권한 원칙 준수
- **토큰 메모리 저장 + GIS 무음 갱신**: XSS 안전성과 "재로그인 없음" UX 동시 확보
- **FedCM/기기 계정**: 플랫폼 네이티브 수준 UX, 코드 분기는 GIS 라이브러리가 내부 처리
- **변경 즉시 동기화**: 데이터 크기 대비 지연 없는 동기화 체감

## 결과

- Phase 2a: 수동 백업/복원으로 데이터 유실 위험 즉시 해소
- Phase 2b: 디바이스 간 북마크·설정·읽기 위치 자동 동기화
- 재로그인 불필요 (Android: 항상, iOS 17+: FedCM, iOS 16↓: 세션 만료 시 One Tap 1회)
- XSS 시 토큰 탈취 불가 (메모리 전용)
- 기존 localStorage 동작 유지 (동기화 비활성 사용자 영향 없음)

## Phase 2c — 동기화 엔진 재설계 (구현 완료 2026-05-04)

(2026-05-04) Phase 2b 이후 버그봇 연속 발견(PR #20 18건, PR #26 6건)의 근본 원인을 해소하기 위해 동기화 엔진을 전면 재설계.

- **데이터 모델 v2** (`js/sync/store-v2.js`): 문서 단위 LWW → 항목 단위 per-record mtime(`_u`) + tombstone. flat-map 북마크 + `mergeDocs()`.
- **인증 FSM** (`js/sync/state-machine.js`): 6개 클로저 변수 → `_ctx = { netFails, conflictFails, reAuthFails, backoffTimer }` 명시적 컨텍스트. `_transition(nextState, ctxPatch)` 단일 진입점으로 "리셋 누락" 구조적 차단.
- **ETag 낙관적 동시성** (`js/sync/transport.js`): `If-Match` 헤더로 동시 업로드 충돌 감지. 412 수신 시 최대 3회 재머지 재시도. 구글이 앱에 ETag를 주지 않아 운영에서는 이 조건을 보내지 못하고 412도 오지 않는다(2026-10-30 확인, known-issues §42). 다른 방법으로 쓰기를 보호하지 않고 한계로 둔다(사용자 결정 2026-10-31, 아래 「검토한 대안 — 삭제 기록과 기준 목록」).
- **Exponential backoff + OFFLINE**: 네트워크 오류 1s/2s/4s/8s/16s 재시도, 5회 초과 시 OFFLINE 상태. `online` 이벤트로 자동 복구.
- **디버그 로그** (`js/sync/debug-log.js`): 메모리 ring buffer(recent 200, errors 20), 마스킹, `localhost` 전용 `console.debug`. 설정 팝오버에 "진단 정보 복사" 버튼.
- **e2e 테스트** (`tests/e2e/test_drive_sync.py`): FakeDrive + GIS 스텁으로 5가지 시나리오 자동 검증.
- **삭제 기록 보존**(2026-10-31): 북마크 삭제 기록(tombstone)은 지우지 않는다(사용자 결정 2026-10-31). 앱을 시작할 때의 정리(`sweepRetiredSettings`)는 30일 지난 은퇴 설정만 지운다(아래 「설정 병합 전방 호환」). 그전에는 30일 지난 북마크 삭제 기록도 기기에서 지웠다(`sweepTombstones`). 동기화를 켠 동안은 다음 병합이 드라이브 파일의 기록을 다시 넣어 줄어드는 것이 없었고(2026-10-30 실행해 확인), 동기화를 30일 넘게 끈 동안 지운 북마크는 다시 켜면 드라이브에서 되살아났다(known-issues §39). 삭제 기록의 정리는 기준 목록 2단계에서 정한다.
- **기준 목록**(`bible-drive-base-ids`, 2026-10-31, 1단계): 마지막으로 내려받아 병합한 드라이브 파일에 살아 있던 북마크 id(폴더 포함)를, 이 기기가 그 파일에서 처음 본 날별로 묶어 이 기기에만 둔다. 형식은 `{"fileId": <파일 id>, "at": <마지막으로 쓴 기기 시각>, "days": {"<날 번호>": [id, …]}}`이고, 날 번호는 이 기기 시각으로 1970-01-01(협정 세계시)부터 센 날이다(`js/types.d.ts DriveBaseIds`). 병합 결과를 저장한 뒤 올리기 전에, 내려받은 파일로 쓴다(`store-v2.js saveBaseIds`). 같은 파일의 목록에 있던 id는 처음 본 날을 그대로 두고, 새 id는 오늘로 적고, 파일에서 사라진 id는 뺀다. 파일 id가 다르면 새로 시작한다. 「파일도 삭제」가 확인되면 지우고, 동기화를 끌 때는 남긴다. 저장 공간이 부족하면 동기화 저장소의 저장을 위해 먼저 지운다(ADR-015 D7).
  - 1단계는 저장만 하고 병합 판단에는 쓰지 않는다(사용자 결정 2026-10-31). 병합 기록(`MERGE`)에 2단계 규칙이 지웠을 북마크 수만 남긴다(`baseWouldDrop`, `store-v2.js goneFromDrive`).
  - 2단계(계획): 이 기기에는 살아 있는데 드라이브에는 항목도 삭제 기록도 없는 북마크가, 같은 파일의 목록에 있고 처음 본 지 30일이 넘었으면 다른 기기에서 지운 것으로 보고 지운다(규칙 다). 그다음 삭제 기록은 드라이브에 처음 보인 때부터 30일이 지나면 지운다. 두 기간 모두 한 기기가 자기 시계로 잰다. 형식은 1단계와 같다.
- **수정 시각**(`_u`, 2026-10-31): 북마크, 설정, 읽던 위치의 새 수정 시각은 기기 시각과 그 기록의 이전 수정 시각보다 1밀리초 늦은 시각 가운데 늦은 쪽이다(`store-v2.js _after`). 북마크를 지울 때 남기는 삭제 기록의 시각은 기기 시각과 그 북마크의 수정 시각보다 1밀리초 늦은 시각 가운데 늦은 쪽이다(이미 더 늦은 삭제 기록이 있으면 그대로 둔다). 새로 넣는 북마크와 저장된 삭제 기록에 가려진 북마크는 같은 id의 삭제 기록보다 늦은 시각으로 기록한다. 숫자가 아닌 시각은 0으로 본다. 그래서 다른 기기의 편집을 받은 뒤 고친 것은 이 기기의 시계가 느려도 병합하면 남는다. 그전에는 기기 시각을 그대로 기록해, 시계가 느린 기기가 받은 뒤 고친 편집이 먼저 고친 사본에 덮어써지고, 방금 받은 북마크를 지우면 다음 동기화에서 다시 나타났다(known-issues §39). 옛 절 범위 옮기기와 옛 목록에서 읽은 항목은 지금처럼 시각을 바꾸지 않는다.
- **같은 수정 시각**(2026-10-31): 두 사본의 수정 시각이 같으면 드라이브의 사본을 남긴다(설정과 읽던 위치와 같다). 그래서 새 버전을 쓰는 모든 기기가 드라이브의 사본으로 맞춰진다(2026-10-31 전의 버전은 지금도 기기 id 순서에 따라 남긴다). 폴더의 펼침 상태만 이 기기의 값을 두고, 이 기기에 펼침 값이 없으면 드라이브의 값도 받지 않는다(`store-v2.js _withLocalExpand`). 펼침 상태는 내용이 아니라서 폴더를 열어도 수정 시각이 그대로이고, 드라이브의 값을 남기면 방금 연 폴더가 동기화 뒤에 닫혔다(PR #456 리뷰, 사용자 결정 2026-10-31). 올릴지는 수정 시각만 비교해 정하므로, 펼침 상태가 달라도 두 기기가 번갈아 올리지 않는다. 그전에는 기기 id 순서에 따라 한쪽이 남았는데, 비교 상대가 그 편집을 한 기기가 아니라 마지막으로 올린 기기라, 한 기기는 자기 사본을 남기고 시각이 같아 올리지도 않았다. 시각이 빠른 기기가 고친 기록을 시계가 느린 두 기기가 서로 모르고 고치면, 둘 다 같은 시각을 받아 이 일이 생겼다(PR 전 리뷰에서 실행해 확인, 사용자 결정 2026-10-31).
- **순서 값**(`_order`, 2026-10-26): 저장할 때 같은 폴더 안에서 앞뒤 순서가 그대로인 항목은 저장된 값을 그대로 둔다. 옮기거나 새로 넣은 항목만 앞뒤 항목 사이의 값을 받는다. 바로 앞 항목의 값에 1씩 더한 값이 바로 뒤 항목의 값보다 작으면 그 값을 쓰고, 아니면 사이를 고르게 나눈 소수를 쓴다. 끝에 넣으면 대개 다음 정수다. 값이 같은 항목은 id 순서로 놓는다. 소수로도 나눌 수 없게 되면 그 폴더만 0부터 다시 매긴다. 그래서 값은 이어지지 않거나 음수, 소수일 수 있다. 앱은 값의 크기 순서만 본다. 그 전에는 저장할 때마다 0부터 다시 매겨, 지우거나 옮긴 항목 뒤의 손대지 않은 항목까지 수정 시각(`_u`)이 올랐다. 그 항목이 동기화에서 다른 기기에서 고친 내용을 덮어썼다(PR #438 리뷰, 사용자 결정).

## Phase 2d — iOS FedCM/One Tap 적용 (구현 완료 2026-05-05)

(2026-05-05) iOS Safari에서 앱을 열 때마다 "이 사이트에서 팝업 윈도우를 열려고 시도 중입니다." 차단 안내가 뜨는 문제 해결. Phase 2b는 GIS Token Client 단일 경로로, 페이지 로드 시 자동 `requestAccessToken({prompt:""})` 호출이 사용자 제스처 밖에서 `window.open()`을 트리거해 iOS가 팝업으로 인식했다. ADR-011 원안의 "iOS 17+ FedCM, iOS 16↓ One Tap" 인증 분기를 실제로 구현해 정합화.

- **Identity Client 추가** (`js/sync/transport.js`): `initIdentityClient`/`promptIdentity`/`parseIdToken` 함수 신규. `google.accounts.id.initialize({use_fedcm_for_prompt: true, auto_select: true, itp_support: true})` + `prompt()` 사용. iOS 17+은 FedCM (브라우저 mediated UI), iOS 16↓은 One Tap (인라인 UI)으로 자동 폴백 — 둘 다 `window.open()` 미사용이라 iOS 팝업 차단 안내가 발생하지 않음.
- **상태 머신 분리** (`js/sync/state-machine.js`): `AUTHENTICATING` 단일 상태를 `IDENTIFYING` → `AUTHENTICATING` 두 단계로 나눔. 페이지 로드 자동 흐름은 ID Client만 사용하므로 popup-blocker 다이얼로그가 발생하지 않음. `NEEDS_CONSENT` 상태 신설 — silent identity 실패 시 ERROR 대신 부드러운 상태에 머물고, 사용자가 "연결" 버튼을 클릭하면 그 사용자 제스처 안에서 `requestAccessToken({prompt:"consent"})`을 호출해 iOS가 팝업을 정상 허용.
- **이벤트 추가**: `IDENTITY_OK { email, credential }` / `IDENTITY_FAIL { reason }` / `USER_CONSENT_REQUEST`. 401 재인증도 IDENTIFYING 단계를 거쳐 silent FedCM 갱신을 먼저 시도.
- **email hint 자동 시드**: ID 토큰에서 추출한 email을 즉시 `bible-drive-sync-email`에 저장 → 후속 `requestAccessToken({prompt:"", hint:email})` 성공률 향상.
- **테스트 스텁 확장** (`tests/e2e/test_drive_sync.py`): GIS 스텁이 `accounts.id.initialize`/`prompt`도 시뮬레이션하도록 확장. `__gisForceIdentityFail` 토글로 FedCM 미지원 환경 회귀 시나리오 시뮬레이션 가능.

### Phase 2d 동작 매트릭스

| 환경 | 페이지 로드 시 동작 | iOS 팝업 차단 안내 |
| --- | --- | --- |
| Android Chrome | FedCM/세션 쿠키로 silent identity → silent token | 발생 안 함 |
| iOS 17+ Safari | FedCM mediated UI로 silent identity → silent token | 발생 안 함 |
| iOS 16↓ Safari (사전 동의 있음) | One Tap UI로 identity → silent token | 발생 안 함 |
| iOS 16↓ Safari (사전 동의 없음) | identity 실패 → NEEDS_CONSENT, 사용자 "연결" 클릭 대기 | 발생 안 함 (사용자 제스처 안에서만 popup) |

## Phase 2e — FedCM-mandatory deprecation 마이그레이션 (구현 완료 2026-05-05)

(2026-05-05) 클린 환경에서 콘솔에 반복 출력되던 GSI deprecation 경고 (`Your client application uses one of the Google One Tap prompt UI status methods that may stop functioning when FedCM becomes mandatory`)와 `[GSI_LOGGER]: FedCM get() rejects with AbortError` 로그 제거. Phase 2d는 `prompt()` 콜백에서 `isNotDisplayed`/`isSkippedMoment`/`isDismissedMoment` 트리오로 prompt 결과를 분기했는데, FedCM 마이그레이션 가이드는 앞 두 메서드를 deprecated로 표시한다. 추가로 검증해보니 **`prompt()`에 콜백을 등록한다는 사실 자체**가 deprecation 경고의 트리거였다 (`isDismissedMoment`만 호출해도 경고 유지).

핵심 변경:
- **`prompt()` 콜백 제거** (`js/sync/transport.js`): `promptIdentity()`가 `google.accounts.id.prompt()`를 인자 없이 호출. 성공은 `initIdentityClient`의 credential 콜백에서 수신하고, 실패(dismiss/suppression)는 사용자가 명시적으로 "연결" 버튼을 다시 누를 때까지 대기.
- **wall-clock timeout 폴백 도입 후 폐기**: 처음엔 `IDENTITY_TIMEOUT_MS = 10000` 안전망을 추가했으나, 다계정 사용자가 FedCM 다이얼로그에서 결정하는 동안(>10s) `cancelIdentityPrompt()`가 발화돼 다이얼로그가 강제 종료되는 회귀가 발생. Google FedCM 가이드는 *앱이 FedCM UI 수명을 통제하지 말 것*을 권고하므로 timeout 자체를 제거하고 사용자 escape hatch(설정의 항시 노출되는 "연결" 버튼)에 의존하도록 변경.
- **deprecated notification 메서드 호출 0건**: `isNotDisplayed`/`isSkippedMoment`/`isDismissedMoment`/`getNotDisplayedReason`/`getSkippedReason`/`getDismissedReason`/`getMomentType` 모두 코드에서 제거.
- **테스트 스텁 정리** (`tests/e2e/test_drive_sync.py`): GIS_STUB의 `prompt`가 새 무인자 시그니처에 맞춰지고, dead-code였던 `__gisForceIdentityFail` 경로(deprecated 메서드를 시뮬레이션)를 삭제. 8개 e2e 시나리오 모두 정상 통과.

### Phase 2e 후 동작 매트릭스

| 시나리오 | 동작 |
|---------|------|
| FedCM 다이얼로그 표시 → 사용자 즉시 선택 | credential 콜백 → IDENTITY_OK → 정상 동기화 |
| FedCM 다이얼로그 표시 → 사용자 천천히 선택 (>10s) | 다이얼로그 유지, credential 콜백 → 정상 동기화 (Phase 2d 회귀 해결) |
| FedCM 다이얼로그 → 사용자 X로 닫음 | 무반응. 사용자가 설정 → "연결" 재클릭 시 OAuth consent 팝업으로 진행 |
| FedCM 미표시 (ITP/세션 없음) | 무반응. 위와 동일 escape hatch |
| auto re-authn 10분 rate limit (Google 정책) | 두 번째 새로고침에서 다이얼로그 표시. 첫 번째는 자동 |

### 알려진 무해한 부산물

- `https://accounts.google.com/gsi/status` 엔드포인트의 **403 Forbidden**: GIS 라이브러리 내부의 FedCM 사전 탐지 폴링. localhost가 OAuth 클라이언트의 정식 등록 origin이 아닌 환경에서 일관되게 발생. 인증 실제 동작과 무관하며 GIS가 graceful fallback 처리하므로 코드 변경 불요.

## Phase 2f — iOS OAuth 풀페이지 리디렉션 (구현 완료 2026-05-05)

(2026-05-05) Phase 2d/2e 적용 후에도 iPhone(iOS 26.X)에서 "팝업 윈도우를 열려고 시도" 안내가 재발 보고됨. 추가 조사 결과 Phase 2d 전제가 두 가지 점에서 잘못됐음이 확인됨.

1. **Safari는 FedCM을 영구 미지원**. Apple은 passkey에 집중하기로 결정했고 WebKit standards-positions에서 FedCM을 부정적으로 평가. `use_fedcm_for_prompt: true`는 iOS Safari에서 no-op이며, ID Client는 Phase 2d에서 가정한 "iOS 17+은 FedCM"으로 결코 동작하지 않음.
2. **GIS Token Client `requestAccessToken`은 popup-only**. Google 공식 token 모델 가이드: "Due to security concerns, only the popup UX is supported." 사용자 제스처 안에서 호출해도 iOS PWA standalone 모드에서는 popup 자체가 차단됨. iOS 26부터 홈 화면 추가 사이트가 기본 PWA 모드로 열리면서 영향 사용자 급증.

결론: GIS Token Client 경로로는 iOS 팝업 차단을 우회할 수 없음. iOS 한정으로 OAuth 2.0 Implicit Flow의 풀페이지 리디렉션을 수동 구현해야 함.

### 핵심 변경

- **iOS 감지 + 리디렉션 헬퍼** (`js/sync/transport.js`):
  - `isIOS()` — UA 기반 (`iPhone|iPod|iPad` + iPadOS 13+ 데스크톱 모드 위장 처리: `MacIntel + maxTouchPoints>1`)
  - `beginRedirectAuth(clientId, scope, {prompt})` — 32바이트 nonce + returnTo + ts를 `sessionStorage`에 저장 후 `location.href = "https://accounts.google.com/o/oauth2/v2/auth?..."`. `response_type=token`, `include_granted_scopes=true`, `login_hint`(저장된 email) 포함. `location.replace`는 사용 금지(뒤로가기로 앱 복귀 보존).
  - `consumeRedirectCallback()` — 부팅 시 동기적으로 호출. hash 파싱 → sessionStorage state nonce 일치 검증 → 10분 만료 검사 → 토큰/expiresIn/returnTo 반환. CSRF 방어 핵심.

- **상태 머신 분기** (`js/sync/state-machine.js`):
  - `acceptRedirectToken(access_token)` 신규 — 부팅 단계에서 직접 IDLE로 진입 (GIS 의존 없음).
  - 4개 진입점에 iOS 분기: `S.IDENTIFYING + USER_CONSENT_REQUEST`, `S.NEEDS_CONSENT + USER_CONSENT_REQUEST`, `S.ERROR + (ENABLE|USER_CONSENT_REQUEST)`, `_handleSyncFail` 401 분기.
  - **하이브리드 401 처리**: `_isUserActivelyReading()` (visibility=visible + hasFocus=true + 5초 이내 인터랙션) 휴리스틱으로 사용자가 활발히 읽는 중이면 snackbar+`NEEDS_CONSENT` 보류, 유휴 상태면 자동 풀페이지 리디렉션.
  - **무한 리디렉션 차단**: `_ctx.reAuthFails`는 페이지 전환 시 휘발되므로 `localStorage["bible-drive-redirect-attempts"]` 별도 카운터(상한 3회) 도입.

- **부팅 흐름** (`js/drive-sync.js`):
  - **top-level IIFE**가 라우팅보다 먼저 `consumeRedirectCallback()` 호출 → `history.replaceState`로 hash 즉시 정리(토큰 노출 시간 < 100ms) → `window.__pendingRedirectToken`에 stash.
  - `initDriveSync()`가 pending 토큰을 흡수해 `_machine.acceptRedirectToken()` 호출.
  - 글로벌 인터랙션 리스너(`pointerdown`/`keydown`/`scroll`/`touchstart`)로 `_lastInteractionTs` 갱신, `window.__driveSyncInteractionTs` 노출.
  - `signIn()`이 iOS 환경에서 GIS 폴링 없이 즉시 `T.beginRedirectAuth(prompt:"consent")`. 안내 토스트 "Google 인증 페이지로 이동합니다. 인증 후 자동으로 돌아옵니다."

### Phase 2f 후 동작 매트릭스

| 환경 | 페이지 로드 동작 | "연결" 클릭 동작 | iOS 팝업 안내 |
|------|----------------|-----------------|--------------|
| Android Chrome | FedCM/세션 → silent token | popup consent | 해당 없음 |
| 데스크톱 Chrome/Firefox | FedCM(지원 시) → silent token | popup consent | 해당 없음 |
| iOS 17+ Safari (탭) | 풀페이지 리디렉션 | 풀페이지 리디렉션 | **발생 안 함** |
| iOS PWA standalone | 풀페이지 리디렉션 | 풀페이지 리디렉션 | **발생 안 함** |
| iOS 16↓ Safari | 풀페이지 리디렉션 | 풀페이지 리디렉션 | **발생 안 함** |

Phase 2d/2e의 FedCM/One Tap 코드는 비-iOS 환경에서 그대로 활성화되며, iOS 분기는 `window.google.accounts.*` 호출을 모두 건너뜀.

### OAuth Flow 재평가

Phase 2b의 결정 표는 비-iOS 환경에 한해 유효함을 명시. iOS는 별도 경로:

| 환경 | OAuth Flow | 이유 |
|------|----------|-----|
| Android, 데스크톱 (FedCM 가능) | Authorization Code via GIS (Phase 2b/2d) | popup 없는 무중단 인증 |
| iOS Safari (모든 모드/버전) | **Implicit Flow + 풀페이지 리디렉션** (Phase 2f) | popup-only GIS Token Client 우회 |

Implicit Flow 일반 단점에 대한 우리 환경 평가:
- *Refresh token 부재* → `drive.appdata + email` scope 한정이라 무관 (1시간 만료 후 hybrid 자동 재인증)
- *access_token이 hash 노출* → IIFE가 `replaceState`로 즉시 정리, 외부 노출 시간 < 100ms
- *OAuth 2.1 deprecated* → Google이 2026-04 시점 명시적 지원 유지, scope 단위 검수에 영향 없음

### 외부 의존 변경

Google Cloud Console OAuth 2.0 Client(dev/prod 양쪽)의 **Authorized redirect URIs**에 다음 추가 필요:
- dev: `http://localhost:8080/`
- prod: `https://bible.anglican.kr/`
- trailing slash 정확히 일치해야 함 (`https://bible.anglican.kr`는 다른 URI로 취급)

Authorized JavaScript origins / scope 설정 변경 없음 → OAuth 검수 재제출 불요.

### 알려진 트레이드오프

- **첫 연결 UX**: iOS 사용자에게 앱이 닫혔다 다시 열린 듯한 깜박임 발생. 안내 토스트로 완화.
- **state nonce 만료**: 10분 — 사용자가 OAuth 페이지에 30분 머물면 callback 검증 실패. snackbar로 안내.
- **외부 핸드오프 엣지 케이스**: Universal Link 설정에 따라 OAuth가 외부 Safari로 핸드오프 가능. PWA sessionStorage 격리 → nonce 검증 실패 → "브라우저에서 다시 시도해 주세요" 안내.
- **자동 리디렉션 cap**: localStorage 카운터 3회 초과 시 ERROR 강제 전이로 무한 루프 차단.

## Phase 2f 후속 정제 (2026-05-06)

(2026-05-06) PR #37 머지 직전·직후 Cursor Bugbot 6차 리뷰와 PR #40 추가 리뷰가 누적되며 Phase 2f의 보안·견고성 면을 후속 정제했다. 새로운 결정 사항은 없으나 동작 계약(contract. 코드가 그것을 쓰는 쪽에 지키기로 한 동작의 약속)을 명시화한다.

### 보안 강화 (CSRF·재시도 통제)

- **state nonce CSRF 검증 강화**: `consumeRedirectCallback()`에 untrusted 에러(`error_uri` 도메인 불일치 등) 분기 추가. nonce 검증 실패 시 사용자가 상상 불가능한 외부 페이지로 부터의 redirect를 흡수하는 일이 없도록 returnTo를 `/`로 강제 이탈시키지 않고 ERROR 상태에서 사용자 안내로 전환.
- **redirect counter 무한 루프 방어**: localStorage `bible-drive-redirect-attempts` 카운터의 키가 두 곳에 하드코딩돼 있어 한 곳 갱신 누락 시 카운트가 무력화되는 결함 발견. 단일 상수로 통일.
- **cap 초과 시 단일 종착 상태**: `MAX_REDIRECT_ATTEMPTS` 초과 시 `NEEDS_CONSENT → ERROR` 이중 전환 + `_refreshUI` 이중 호출이 발생하던 경로 차단. `_transition` 한 번으로 ERROR 진입.
- **iOS 401 분기**: `_handleSyncFail` 401 핸들러가 GIS-only 흐름을 가정해 reAuthFails 카운터를 증가시키지 않던 누락 수정. iOS는 401 수신 즉시 `NEEDS_CONSENT`로 전환 후 `_isUserActivelyReading()` 휴리스틱이 false면 자동 리디렉션, true면 snackbar 안내.

### GIS Token Client 빈 응답 stuck 방지 (PR #40)

- **증상**: 비-iOS 환경에서 GIS Token Client 콜백이 `error: undefined` + `access_token: undefined` 빈 응답을 던지는 케이스(쿠키 정책·세션 만료·third-party iframe 차단 등) 관찰됨. 기존 코드는 `response.error`만 분기 처리해 빈 응답에서 `AUTHENTICATING` 상태로 무한 대기.
- **해결** (`js/sync/transport.js` + `js/sync/state-machine.js`): 콜백이 호출됐는데 `access_token`도 `error`도 없는 경우 `IDENTITY_FAIL { reason: "empty_response" }` 발화. 상태 머신은 이를 NEEDS_CONSENT로 흡수해 사용자 escape hatch(설정의 "연결" 버튼)에 의존.

### iOS 유휴 감지 정교화

- **OFFLINE → NET_RECOVERED**: 네트워크 복구 핸들러가 비-iOS만 가정하고 GIS `requestAccessToken({prompt:""})`을 시도 — iOS에서는 popup 차단 회귀. iOS 분기를 추가해 NET_RECOVERED 시 즉시 자동 리디렉션 대신 IDLE 상태에서 다음 사용자 액션을 기다리도록 변경.
- **OAuth scope 중복**: `transport.js`가 scope 문자열을 `"drive.appdata email"` + `parseIdToken` email 추출용 별도 scope로 두 번 적용해 Google에서 중복 scope 경고 발생. 단일 scope 상수로 통일.
- **iOS GIS 폴링 폐기**: iOS 분기에서는 GIS 라이브러리가 로드되더라도 `_pollGoogleId` 인터벌이 무의미하므로 즉시 단락(short-circuit).
- **expiresIn dead data 제거**: `acceptRedirectToken`이 expiresIn을 받았으나 어디에도 활용되지 않아 dead-code. 시그니처에서 제거.

### 접근성

- 설정의 Drive 정보 버튼 `aria-label`을 "Google Drive 동기화 정보"로 명시화 (이전: 빈 값).

### 회귀 방어 — 유닛 테스트

ADR-013 (클라이언트 JS 유닛 테스트 전략) 참고. 위 6차 리뷰 정제 항목 중 다음을 재현 가능한 시나리오로 고정:

- iOS ENABLE + email 없음 시 NEEDS_CONSENT 정착 (첫 연결 흐름)
- 401 재인증 시 reAuthFails 카운터 단조 증가
- redirect attempts cap 초과 시 단일 ERROR 전이
- 빈 GIS 토큰 응답 → IDENTITY_FAIL 흡수

> Phase 2g(아래)에서 `iOS ENABLE + 저장된 email` 케이스의 동작이 자동 silent 리디렉션으로 변경됨. 회귀 방어 항목도 함께 갱신됨 — 자세한 시나리오는 Phase 2g § 회귀 테스트 참고.

## Phase 2g — iOS 앱 재실행 시 silent prompt=none 자동 리디렉션 (구현 완료 2026-05-06)

(2026-05-06) Phase 2f 배포 후 사용자 보고 — iOS PWA에서 한 번 연결한 뒤 앱을 종료하고 다시 열면 동기화가 해제된 것처럼 보인다(설정 화면에 "연결" 버튼 다시 노출). Phase 2f 구현은 부팅 시 hash callback이 없으면 `DISABLED → ENABLE` 분기에서 무조건 `NEEDS_CONSENT`로 파킹해, 매 앱 오픈마다 사용자가 "연결" 버튼을 다시 눌러야 했음. ADR-011 Phase 2f 동작 매트릭스의 "iOS PWA standalone | 페이지 로드 동작: 풀페이지 리디렉션" 항목과 실제 구현이 어긋나 있었음.

### 핵심 변경

- **silent 자동 리디렉션 진입** (`js/sync/state-machine.js`):
  - `DISABLED + ENABLE` iOS 분기에서 `bible-drive-sync-email`이 저장돼 있으면 `_beginRedirect("none")`을 호출. Implicit Flow는 refresh token이 없어 in-memory 토큰이 앱 종료와 함께 사라지지만, Google 측 세션이 유효하면 `prompt=none`이 즉시 토큰을 재발급한다. 페이지 깜박임 ≤ 1초.
  - 진입 검사 두 단계: (1) 저장된 email이 없으면 NEEDS_CONSENT (첫 연결 흐름), (2) `bible-drive-silent-blocked` 플래그가 1이면 NEEDS_CONSENT (이전 silent 시도 실패).

- **silent-blocked 플래그** (`localStorage["bible-drive-silent-blocked"]`):
  - silent 리디렉션이 `interaction_required` / `consent_required` / `login_required`로 실패하면 IIFE가 1로 설정. 다음 앱 오픈에 의미 없는 깜박임 반복을 차단.
  - 다음 시점에 제거: (1) `signIn()` (사용자 제스처로 명시적 재연결), (2) `signOut()`, (3) `SYNC_DONE` (defense in depth — silent 경로가 다시 작동한다는 증거), (4) silent 재인증 callback 성공.

- **redirect callback의 silent 분기** (`js/sync/transport.js` + `js/drive-sync.js`):
  - `beginRedirectAuth`가 sessionStorage state에 `silent: prompt === "none"` 저장.
  - `consumeRedirectCallback`이 모든 반환 경로(success/error/expired/state_mismatch)에 `silent` 필드 포함.
  - IIFE가 silent 실패는 user-facing 토스트 없이 silent-blocked 플래그만 설정 (자동 background 시도의 정상적 실패 경로).

- **types.d.ts**: `RedirectCallbackResult`에 `silent: boolean` 필수 필드 추가, `Window._syncSilentBlockedKey?: string` 추가.

### Phase 2g 후 iOS 앱 오픈 매트릭스

| 상태 | localStorage | 페이지 로드 동작 |
|------|--------------|-----------------|
| 첫 방문 / signOut 직후 | `bible-drive-sync=0` | `initDriveSync()` early return — 동기화 비활성 |
| 한 번 연결, 정상 흐름 | `bible-drive-sync=1`, email 저장, silent-blocked 없음 | **silent prompt=none 자동 리디렉션** (브리프 깜박임 → IDLE → 자동 sync) |
| silent 직전 실패 후 재오픈 | silent-blocked=1 | NEEDS_CONSENT (사용자 "연결" 클릭 대기) |
| 자동 시도 cap 도달 | redirect-attempts ≥ 3 | ERROR + snackbar (사용자 "연결" 클릭으로 cap + silent-blocked 모두 리셋) |

### 회귀 테스트

`tests/unit/state-machine.test.js`:
- `3.` (갱신): iOS ENABLE + email 없음 → NEEDS_CONSENT
- `3a.` (신규): iOS ENABLE + email → `prompt=none` 리디렉션 + 카운터 1 증가
- `3b.` (신규): iOS ENABLE + email + silent-blocked=1 → NEEDS_CONSENT, beginRedirectAuth 미호출
- `3c.` (신규): iOS ENABLE + email + cap 도달 → ERROR
- `3d.` (신규): iOS ENABLE + email = `""` (빈 문자열) → NEEDS_CONSENT
- `3e.` (신규): SYNC_DONE 시 silent-blocked 제거

### 알려진 트레이드오프

- **앱 오픈 깜박임**: 매 cold start마다 accounts.google.com으로의 짧은 round-trip 발생. 빠른 망에서 < 1초, 느린 모바일 망에서 1-3초. `prompt=none`은 UI를 표시하지 않으므로 도메인 플래시만 보임.
- **Google 자체 세션 만료**: Google OAuth 세션은 서버 측에서 일정 기간(약 2주) 비활성 시 만료된다. 이 경우 silent 시도는 `login_required`를 반환 → silent-blocked=1로 떨어져 사용자가 "연결"을 다시 눌러야 한다. 첫 실패는 묵묵히 NEEDS_CONSENT, 이후 자동 시도 없음. (※ iOS Safari 탭 7일 ITP storage cap은 **홈 화면 PWA에는 적용되지 않으므로** 설치 사용자에겐 무관 — ADR-011 §맥락 참고.)
- **외부 revoke 감지**: 사용자가 Google 계정 설정에서 권한을 끊으면 silent 시도는 `consent_required`를 반환 → silent-blocked=1. 이는 의도된 동작 — 다음 사용자 제스처 시점에 명시적 consent로 복구.

### Bugbot 1차 리뷰 정제 (PR #43)

- **Consent 거부 후 자동 silent 재시도 차단**: `signIn()`은 명시적 재연결 진입에서 silent-blocked 플래그를 비우는데, Google에서 사용자가 consent를 거부하고 돌아오면 (`__pendingRedirectError`) `initDriveSync()`이 토스트만 띄우고 `_machine.enable()`을 호출 → DISABLED+ENABLE iOS 분기가 (email 있음 + silent-blocked 없음) prompt=none을 즉시 발사 → 토스트 파괴 + 무용한 round-trip. iOS 분기에서 `__pendingRedirectError` 처리 시 silent-blocked=1을 설정해 `enable()`이 NEEDS_CONSENT에 정착하도록 정정.
- **silent-blocked 키 단일화**: `signIn()`은 `window._syncSilentBlockedKey` 상수를 사용했지만 IIFE 2곳과 `signOut()`은 리터럴 `"bible-drive-silent-blocked"`을 하드코딩 → Phase 2f에서 `REDIRECT_ATTEMPTS_KEY`로 잡았던 것과 동일한 패턴. 모두 상수 참조로 통일.

## Phase 2h — PKCE + Refresh Token 마이그레이션 (완료 2026-05-06부터 05-08까지)

(2026-05-07) 이 ADR 「검토한 대안」의 "OAuth Flow" 결정표에서 **Authorization Code + PKCE를 채택, Implicit Flow는 deprecated로 거부**라고 명시했음에도, Phase 2b 실제 구현은 GIS Token Client 기반 Implicit Flow로 진행되어 ADR-구현 정합성이 깨졌다. 이후 Phase 2c-2g가 그 어긋난 토대 위에서 iOS·desktop UX를 누적 보정해 왔으나, 데스크탑 cold start마다 GIS OAuth 팝업창이 뜨는 사용자 보고(2026-05-06)가 들어오면서 근본 원인이 Implicit Flow의 refresh token 부재임이 드러남. 본 Phase 2h는 ADR이 처음부터 지시했던 PKCE 흐름으로 회귀하면서 desktop·iOS 모두 단일 경로로 통일한다.

### 동기

- **데스크탑 사용자 보고 (2026-05-06)**: 매 앱 cold start마다 `requestAccessToken()`이 별도 OAuth 팝업창을 열어 UX 저해. Implicit Flow의 in-memory access token이 앱 종료와 함께 사라지는 구조적 한계.
- **iOS 잔존 깜박임**: Phase 2g의 `prompt=none` 자동 리디렉션이 < 1초 페이지 깜박임을 발생시킴.
- **공통 해결책**: Authorization Code + PKCE + refresh token 도입 → 모든 플랫폼에서 백그라운드 fetch 한 번으로 access token 갱신, 팝업·리디렉션·깜박임 없음.

### 핵심 변경 (계획)

1. **Refresh token 영속 저장**: AES-GCM 암호화 IndexedDB. 키는 `extractable: false`로 생성해 `subtle.exportKey()`로도 raw 바이트 추출 불가.
2. **PKCE Authorization Code Flow**: GIS Token Client 사용 중단, 모든 플랫폼이 redirect-기반 단일 경로.
3. **Refresh token rotation**: Google이 새 refresh_token을 돌려주면(surface) 즉시 IDB 갱신. Sentinel detection 자동 작동.
4. **GIS 의존 제거**: `<script src="accounts.google.com/gsi/client">` 제거, CSP `script-src`/`frame-src`에서 `accounts.google.com` 정리.

### 보안 모델

- **XSS 1차 방어**: 이미 적용된 strict CSP (index.html line 5). 같은 origin JS는 어차피 우리 decrypt API를 호출 가능 → IDB 암호화는 XSS 자체를 막지 못함.
- **IDB 암호화의 역할**: 악성 브라우저 확장이나 기기 덤프 같은 **storage-level 도용** 방어. CSP가 1차, 암호화는 깊이 방어.
- **scope 제한**: `drive.appdata`만 사용 → 도난 시에도 사용자 일반 Drive 파일에 접근 불가.
- **revoke 경로**: `signOut`/`disable` 시 IDB clear + Google `/revoke` 엔드포인트 호출.

### 단계별 진행

| 단계 | 작업 | 상태 | PR |
|---|---|---|---|
| 1 | `js/sync/refresh-store.js` AES-GCM 암호화 IndexedDB 모듈 | ✅ 머지 (2026-05-06) | #52 |
| 2 | `transport.js`에 PKCE 유틸 + `/token` 교환 함수 추가 (구 implicit과 공존) | ✅ 머지 (2026-05-07) | #53 |
| 3 | `state-machine.js`에 silent refresh + redirect-PKCE 결합 | ✅ 머지 (2026-05-07) | #54 |
| 4 | GIS 제거 + 모든 흐름 PKCE로 일원화 (사용자 가시 변경) | ✅ 머지 (2026-05-07) | #57 |
| 5 | 정리 (silent-blocked 키 cleanup, pitfalls 문서, 보안 감사) | 🟡 PR open (2026-05-07) | #__ |

단계 1-3은 신규 코드를 옆에 깔기만 하므로 사용자 영향 0. 단계 4 머지 시점에 모든 기존 사용자가 cold start 1회 NEEDS_CONSENT 통과 후 신규 흐름 진입 (sync 데이터 손실 없음 — 별도 store).

### 단계 1 결과 (PR #52, 머지)

- `js/sync/refresh-store.js` 신규: `saveRefreshToken` / `loadRefreshToken` / `clearRefreshToken`
- AES-GCM 256-bit 키 `extractable: false` 보장. `crypto.subtle.exportKey` 거부 단위 테스트로 회귀 방어.
- 12-byte IV 매 저장마다 새로 생성 (AES-GCM nonce 재사용 방지)
- 복호화 실패 시 손상 레코드 자동 삭제 (재시도 루프 방지) + 자가 복구 가능
- IndexedDB 미가용 환경 (Safari private 등)에서 조용히 `null` 반환 → 호출자가 NEEDS_CONSENT로 폴백
- 단위 테스트 13건, RFC 7636 표준 준수 + 보안 모델 핵심(키 비추출성) 회귀 방어

### 단계 2 결과 (PR #53)

- `transport.js`에 PKCE 함수 5종 추가 (기존 implicit 함수는 그대로 유지):
  - `generatePKCEPair()`: 32-byte 랜덤 → verifier(43자 base64url) + SHA-256 challenge
  - `beginRedirectAuthPKCE()`: `response_type=code` + S256 challenge. 별도 sessionStorage 키 `bible-drive-redirect-state-pkce`로 구 implicit과 격리
  - `consumeRedirectCallbackPKCE()`: query string 파싱, `flow="pkce-v1"` 검증. 다른 flow의 state면 `null` 반환 (callback 오라우팅 방어)
  - `exchangeCodeForToken()`: POST `/token`, `grant_type=authorization_code`. 절대 throw 안 함
  - `refreshAccessToken()`: POST `/token`, `grant_type=refresh_token`. **rotation** 시 새 token surface, 없으면 `null`로 반환 → 호출자가 기존 값 보존
- 단위 테스트 23건. **RFC 7636 §4.2 부록 B 테스트 벡터 정합성 검증** 포함 (`dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`).

### 단계 3 결과 (PR #54)

`state-machine.js`와 `drive-sync.js`에 PKCE silent refresh 흐름 결합. 기존 GIS / Implicit 흐름은 그대로 살아있어 사용자 영향 0 — IDB에 refresh token이 없으면 기존 경로로 폴백.

**state-machine.js**:
- 신규 `_attemptSilentRefresh(ctxPatch?)`: IDB의 refresh token으로 access token 갱신. 4가지 결말 — 토큰 없음(false 반환, 폴백) / 성공(IDLE) / invalid_grant(IDB clear + NEEDS_CONSENT, 스낵바 없음) / 5xx·네트워크(OFFLINE)
- 신규 `acceptRedirectCode(code, verifier)`: PKCE 콜백에서 받은 code를 access+refresh token 쌍으로 교환 → IDB 저장 → IDLE
- `enable()`: 동기 dispatch 유지 + silent refresh fire-and-forget. 경쟁 상태 검사(IDLE/ERROR이면 결과 폐기)로 legacy 경로와 충돌 방지
- `_handleSyncFail("401")`: MAX_REAUTH cap 체크를 silent refresh 진입 전에 수행 (만성 401 무한 루프 방지). 401 reauth는 `reAuthFails` 카운터를 IDLE 전이 시 carry forward — successful sync로 SYNC_DONE 전까지 누적

**drive-sync.js**:
- IIFE에 PKCE 콜백 흡수 우선 분기 추가 — `bible-drive-redirect-state-pkce` 키 사용해 구 implicit과 절대 교차 처리되지 않음
- `initDriveSync`에 `__pendingRedirectCode` 분기 추가, `_machine.acceptRedirectCode` 호출

**테스트**:
- `state-machine.test.js` Group 7/8/9 신규 13건 (silent refresh 7건, 401 → refresh 4건, acceptRedirectCode 3건)
- 만성 401 루프 방지 회귀 (`23a`): refresh가 매번 성공해도 reAuthFails MAX_REAUTH로 ERROR
- harness `loadMachine`이 `refreshStore` stub과 `T.refreshAccessToken`/`exchangeCodeForToken`/`consumeRedirectCallbackPKCE` 등 PKCE 함수 stub 노출
- 합계 70/70 통과 (state-machine 33 + refresh-store 13 + transport-pkce 23 + 기타 1)

### Bugbot 리뷰 정제 (PR #54)

**1차 — 사용자 disconnect 감지**: `_attemptSilentRefresh`의 경쟁 상태 검사가 `_state === IDLE/ERROR`만 체크 → 사용자가 silent refresh 진행 중 `signOut()`/`disable()`을 호출하면 결과가 무시되지 않고 DISABLED 상태를 IDLE로 끌어올림 (사용자 의도 무시). 동일 race 표면이 `acceptRedirectCode`에도 존재 — `state=DISABLED`에서 진입하므로 state로는 user-action을 구분 불가.

수정: `localStorage["bible-drive-sync"] === "0"` 검사 추가. 이 플래그는 `_transition`이 DISABLED/ERROR 진입 시 `enabled = next !== DISABLED && next !== ERROR`로 설정하므로 "사용자/시스템이 sync를 명시적으로 중단했는가"를 가장 신뢰성 있게 신호함. 회귀 방어 tests `29.`, `30.`.

**2차 — PKCE callback URL leak**: `bad_state` / `no_state` / `state_mismatch` fallback에서 `history.replaceState(null, "", location.pathname + location.search)`을 사용. PKCE callback은 query string에 `?code=…&state=…`로 도착하므로 search를 보존하면 auth code가 URL bar / 히스토리 / 로그에 남음. 구 implicit flow는 callback이 hash로 와서 search가 안전했는데 PKCE는 정반대.

수정: fallback에서 `location.pathname`만 사용 (search 폐기). 우리 앱은 query 기반 라우팅을 안 쓰므로 이 경로에서 search는 100% OAuth 산출물.

**2차 — SYNCING 경쟁 상태 검사 (조건부 적용)**: Bugbot이 `_state === SYNCING`을 무조건 폐기 리스트에 추가하라고 제안했으나, 그대로 적용하면 401 reauth 경로가 깨짐 (`_kickoff401Reauth`가 SYNCING 상태에서 호출돼 SYNCING을 빠져나오는 게 책임인데 검사가 막으면 영원히 갇힘).

분기 처리: `_attemptSilentRefresh(ctxPatch, fromReauth)` 두 번째 인자 `fromReauth: boolean` 도입. cold-start 경로(`enable()`)는 기본 `false` → SYNCING 폐기 (legacy GIS가 이미 settled). 401 reauth 경로(`_kickoff401Reauth`)는 `true` 명시 → SYNCING 우회 허용.

회귀 방어 tests `31.` (cold-start race lost — legacy SYNCING 보존), `32.` (401 reauth — SYNCING override 허용 + 회복).

### 단계 3 단계의 안전성

이 PR은 어떤 사용자 시나리오에서도 동작 변화를 만들지 않음:
- **기존 사용자** (IDB에 refresh token 없음): silent refresh가 즉시 false 반환 → 기존 GIS/Implicit 흐름 그대로 → INITIALIZING / IDENTIFYING / iOS redirect 흐름 진행
- **신규 사용자** (단계 4 머지 전): signIn() 시 GIS Token Client 또는 iOS implicit으로 인증 → access token만 받음 → IDB는 빈 채 유지 → 다음 cold start도 기존 흐름

단계 4 머지 시점에 `signIn()`이 PKCE redirect로 전환되면서 IDB가 채워지기 시작.

### 단계 4 결과 (PR #57, 머지 2026-05-07)

GIS Token Client / Implicit Flow 의존을 모두 제거하고 데스크탑·Android·iOS를
PKCE Authorization Code + refresh token 단일 경로로 통일. ADR이 처음부터
지시했던 흐름으로 회귀하는 마지막 가시 변경 단계.

**전제**: 단계 4 머지 시점에 모든 기존 사용자가 cold start 1회 NEEDS_CONSENT
통과 후 신규 흐름 진입. sync 데이터(북마크/설정/읽기 위치)는 별도 store에
있으므로 손실 없음. Cloud Console redirect URI(`http://localhost:8080/`,
`https://bible.anglican.kr/`)가 이미 등록돼 있어야 함 (단계 4 배포 전 필수).

**state-machine.js**:
- 상태 집합 축소: `INITIALIZING` / `IDENTIFYING` / `AUTHENTICATING` 제거 →
  `DISABLED | IDLE | SYNCING | OFFLINE | NEEDS_CONSENT | ERROR`
- 이벤트 집합 축소: `GIS_READY` / `IDENTITY_OK` / `IDENTITY_FAIL` /
  `TOKEN_OK` / `TOKEN_FAIL` / `REDIRECT_TOKEN` 제거. 새 tag 이벤트
  `SILENT_REFRESH_OK` / `SILENT_REFRESH_INVALID` / `SILENT_REFRESH_NET_FAIL` /
  `REDIRECT_CODE_RECEIVED` / `REDIRECT_CODE_ACCEPTED` / `CODE_EXCHANGE_FAIL` /
  `ENABLE_NO_REFRESH_TOKEN` / `NET_RECOVERED_NO_TOKEN` 추가 (전이 로깅용)
- `enable()` 단순화: silent refresh fire-and-forget. IDB에 토큰 없으면
  비동기 NEEDS_CONSENT 폴백. GIS 폴링·INITIALIZING 진입 분기 제거
- `OFFLINE + NET_RECOVERED`: silent refresh 재시도. 토큰 없으면 NEEDS_CONSENT
- `_handleSyncFail("401")` → `_kickoff401Reauth`: silent refresh가 false 반환
  (IDB 토큰 없음)이면 NEEDS_CONSENT 직행 (legacy GIS/iOS 분기 제거)
- `_isUserActivelyReading`/`ACTIVE_READING_IDLE_MS` 제거 — refresh token 기반
  silent 갱신은 UI 방해 없음, 사용자 능동 reading 분기 자체가 무용해짐
- `acceptRedirectToken` (Implicit Flow 진입점) 제거. `acceptRedirectCode`만 유지
- `disable()`이 `localStorage["bible-drive-sync"] = "0"`을 _transition 외부에서도
  defensively 설정 → 사용자가 silent refresh / code 교환 race window에서
  disconnect 클릭한 경우에도 경쟁 상태 검사 동작 보장

**transport.js**:
- GIS wrapper 7종 (`initTokenClient` / `requestSilentToken` /
  `requestConsentToken` / `initIdentityClient` / `promptIdentity` /
  `cancelIdentityPrompt` / `parseIdToken`) 제거
- Implicit Flow의 `beginRedirectAuth` / `consumeRedirectCallback` 제거
- PKCE 함수 canonical 이름 인계: `beginRedirectAuthPKCE` →
  `beginRedirectAuth`, `consumeRedirectCallbackPKCE` → `consumeRedirectCallback`,
  `RedirectCallbackResultPKCE` → `RedirectCallbackResult`. `silent` 필드는
  prompt=none 사용처가 사라져 함께 제거
- sessionStorage 키 값은 의도적으로 `"bible-drive-redirect-state-pkce"` 유지 —
  단계 4 배포 시점에 진행 중이던 PKCE callback이 떨어지지 않도록 격리. 구
  Implicit 키 `"bible-drive-redirect-state"`는 더 이상 누구도 읽지 않음
  (다음 cold start 시 자연 만료)
- `revokeToken`을 GIS API 호출에서 `oauth2.googleapis.com/revoke` 직접 fetch로
  재구현. signOut에서 access token revoke 경로 유지
- `DRIVE_HOSTNAMES`에서 `accounts.google.com` 제거 (auth는 navigation,
  fetch 대상 아님)

**drive-sync.js**:
- IIFE `_consumeRedirectIfPresent`: PKCE 단일 분기. Implicit fallback 제거
- `_pollGis` / `_startPollingGis` / `_gisRetryCount` 제거
- `__pendingRedirectToken` 처리 제거 (`__pendingRedirectCode`만 유지)
- `signIn()` 일원화: iOS/non-iOS 분기 제거. 모든 플랫폼이
  `T.beginRedirectAuth(_CLIENT_ID, scope, { prompt: "consent" })`로 직접 진입.
  머신 dispatch 거치지 않는 이유: DISABLED에서 silent refresh fire 직후 race
  window에 USER_CONSENT_REQUEST 디스패치가 무시될 수 있음
- `signOut()`이 `window.refreshStore.clearRefreshToken()`도 호출 → 다음 cold
  start에서 silently 재인증되지 않도록 보장
- 사용자 활동 timestamp 추적(`__driveSyncInteractionTs`) 제거 (active reading
  defer 로직과 함께 무용화)
- iOS-only 에러 분기 제거 — `__pendingRedirectError` 처리는 모든 플랫폼 공통

**index.html**:
- `<script async src="https://accounts.google.com/gsi/client"></script>` 제거
- CSP에서 `accounts.google.com`을 `script-src` / `style-src` / `frame-src` /
  `connect-src`에서 모두 제거. `frame-src` 디렉티브 자체 삭제 (다른 frame
  소스 없음)
- 결과: GIS 공급망 의존 제로 — Google CDN 변조 위협 표면 제거

**types.d.ts**:
- 죽은 타입 제거: `GsiTokenResponse` / `GsiTokenClient` / `GsiCredentialResponse` /
  `GsiIdInitializeConfig` / `GsiOauth2InitTokenClientConfig` /
  `GoogleIdentityServices`
- `RedirectCallbackResultPKCE` → `RedirectCallbackResult`로 인계
  (`silent` 필드 제거)
- `SyncState` / `SyncEvent` / `SyncMachine` / `SyncTransport` 모두 신규 코드
  반영. `SyncMachine.acceptRedirectToken` / `onGisReady` 제거
- `Window` 보강에서 `google` / `__pendingRedirectToken` 제거

**테스트**:
- `state-machine.test.js`: 33건 → 26건. INITIALIZING/IDENTIFYING/AUTHENTICATING
  분기 테스트 모두 제거, GIS 시나리오를 PKCE redirect로 갱신.
- `transport.test.js`(당시 `transport-pkce.test.js`): 함수명 rename 반영, `silent` 필드 검증 제거 (5번
  테스트는 prompt 옵션 미지정 시 URL 파라미터 미포함을 검증하도록 갱신)
- `harness.js`: GIS stub (`google` ctx, `hasGoogleId` 옵션, `initTokenClient`
  등 노출) 모두 제거. PKCE stub 이름 canonical로 정렬
- e2e: `test_drive_sync.py`의 `GIS_STUB`를 PKCE `FakeOAuth` (302 + /token POST)로
  교체. `test_drive_sync_ios.py`의 active-reading defer / cap loop redirect /
  silent-blocked / FedCM 시나리오 제거 (흐름 자체 사라짐). iOS-UA-감지·redirect
  round-trip·콜백 보안 회귀(state_mismatch / error / returnTo)만 유지
- 합계 62 unit pass + tsc 두 config 모두 0 error

**Bugbot 단계 4 검토 결과**: 1차 — `_attemptSilentRefresh` IDB rotation save 갭과 `acceptRedirectCode` IDB save 갭에서 `SYNC_ENABLED_KEY` 재확인 누락. 사용자가 IDB write 중 `disable()` 호출 시 후속 `_transition`이 flag를 "1"로 덮어써 의도 무시. 같은 갭이 4xx 분기 `clearRefreshToken` await 후에도 존재. PR #57 추가 commit `f090c83`에서 매 IDB await 직후 경쟁 상태 검사 재검사 추가 + 회귀 방어 단위 테스트 3건 (26a/b/c). 단계 4 후 `enable()`이 동기적으로 DISABLED를 빠져나가지 않으므로 상태 기반 검사만으로 cold-start 경로 보호 불가능 — 플래그 기반 검사가 필수임을 정정.

**롤백 전략**: 단계 4 PR은 원자 머지. 단계 4-only revert는 GIS 제거와 state
machine GIS 가정이 동시에 사라졌으므로 부분 revert 불가. IDB에 저장된 refresh
token은 무해 (구 코드는 IDB 안 봄). 회귀 발견 시 PR 전체 revert만 가능.

### 단계 5 결과 (PR #58, 2026-05-07)

마이그레이션을 마무리하는 정리 단계. 코드 기능 변경 없음.

- **`bible-drive-silent-blocked` localStorage one-shot cleanup**: `js/drive-sync.js` 모듈 로드 시 `localStorage.removeItem("bible-drive-silent-blocked")`. 단계 4에서 키를 read/쓰는(write) 코드는 모두 사라졌으나 기존 사용자 디바이스에 stale value가 남아있을 수 있어 정리. removeItem이 missing key에 대해 no-op이므로 안전. 몇 릴리스 후 cleanup 호출 자체도 제거 가능.
- **`docs/coding-pitfalls.md` 신규 섹션 3개** (Phase 2h에서 학습한 패턴):
  - §11 비동기 경쟁 상태 검사: 단일 체크포인트의 함정 (Bugbot PR #54·#57 사례)
  - §12 로그인 방식을 바꾸면, 주소에서 인증 정보를 지우는 코드가 새 자리를 놓친다 (Bugbot PR #54-2 사례)
  - §13 로그인 방식을 옮길 때는 방식마다 저장소 키를 따로 쓴다 (단계 2-4 sessionStorage 키 분리·인계 패턴)
- **`docs/archive/audit/2026-05-07-pkce-refresh-token.md` 신규**: PKCE 마이그레이션 시점의 보안 감사. Critical/High/Medium 0건. 위협 모델 매트릭스 + 모니터링 권고 4건 (e2e 정기 실행, Cloud Console URI 검증, OAuth 검수 모니터링, silent-blocked cleanup 코드 제거 시점).
- **README.md**: Phase 2g 시점의 GIS/Implicit/silent-blocked 표·설명 갱신, Phase 2h 단일 PKCE 경로 표로 교체.
- **ADR-011 / pkce-migration.md / CLAUDE.md**: 단계 4·5 완료 마크.

### Refresh Token 저장 전략 — 비추출 키 + AES-GCM

검토한 대안:

| 방식 | XSS 방어 | 외부 도용 방어 | 영구 보관 | 결정 |
|---|---|---|---|---|
| `localStorage` 평문 | ✗ | ✗ | ✓ | ❌ |
| `sessionStorage` 평문 | ✗ | ✗ | ✗ | ❌ (cold start 무용) |
| IndexedDB 평문 | ✗ | ✗ | ✓ | ❌ |
| **IndexedDB + 비추출 키 AES-GCM** | ✗ | ✓ | ✓ | ✅ 채택 |
| HttpOnly 쿠키 + BFF 서버 | ✓ | ✓ | ✓ | ❌ (ADR-001 제약: 백엔드 없는 SPA) |

XSS는 strict CSP가 1차 방어이고, IDB 암호화는 깊이 방어층. BFF 도입은 ADR-001 (백엔드 없는 SPA) 제약을 깨므로 후순위.

### 알려진 트레이드오프

- **OAuth 검수 진행 중 → refresh token 7일 만료**: 앱이 "Testing" 상태인 동안엔 일주일에 한 번 사용자가 재연결해야 함. 검수 통과 후 `In production`으로 전환되면 무제한, 코드 변경 0.
- **Safari private mode**: IndexedDB 사용이 제한되거나 거부 → 매번 redirect 폴백. 일반 사용 모드 영향 없음.
- **마이그레이션 호환성**: 기존 사용자(`bible-drive-sync-email` 있음, IDB refresh token 없음)는 단계 4 머지 후 cold start 1회 NEEDS_CONSENT 통과 → 데이터 손실 없음 (sync 데이터는 별도 store).
- **Token rotation 처리 강제**: Google 응답 spec이 가변적(rotation 있음/없음 모두 정상)이라 코드는 두 케이스 모두 처리. 단위 테스트가 양쪽 검증.
- **CSP `connect-src`**: `oauth2.googleapis.com` 이미 포함 → 변경 없음.

### 회귀 방어 — 유닛 테스트 (단계 1·2 시점)

- `tests/unit/refresh-store.test.js` 13건: round-trip, 키 비추출성, IV 유일성·길이, decrypt 실패 자가 정리, 키 영속성, 경계 케이스
- `tests/unit/transport.test.js`(당시 `transport-pkce.test.js`) 23건: PKCE primitives, RFC 7636 부록 B 벡터, redirect 시작/콜백 흐름, `/token` 성공·실패·네트워크·rotation 매트릭스
- 단계 3·4 머지 시 state-machine 테스트도 갱신 예정

### 외부 의존 변경 (단계 4 배포 전 확인 필수)

Google Cloud Console dev/prod OAuth 클라이언트의 Authorized redirect URIs에 등록 (Phase 2f에서 이미 등록됐을 가능성):
- dev: `http://localhost:8080/`
- prod: `https://bible.anglican.kr/`

`response_type=code` + PKCE는 client secret 불요 → 신규 검수 재제출 불필요. Implicit Flow에서 PKCE로 전환되더라도 OAuth 검수 결과(`drive.appdata` scope 승인)는 그대로 유효.

(2026-05-08) "client secret 불요"는 RFC 7636 기준으로는 맞지만 **Google "웹 애플리케이션" OAuth 클라이언트는 PKCE를 써도 `/token` 요청에 `client_secret`을 강제**한다(known RFC 일탈, 다수 라이브러리 issue tracker에서 확인). Phase 2h 시운전 중 `{"error":"invalid_request","error_description":"client_secret is missing."}` 400 응답으로 발견.

SPA에 secret을 임베드하면 (1) git 이력 영구 잔존, (2) GitHub 자동 secret 스캔이 `GOCSPX-` 패턴 감지 시 Google이 secret을 자동 무효화 → 운영 동기화 즉시 중단, (3) OAuth 2.1 / RFC 8252의 public client 정신 위배. 이 위험을 모두 회피하려고 **same-origin nginx 프록시 BFF 패턴**으로 전환:
- 브라우저 → `https://{host}/oauth/token` (POST, body: `grant_type, code, code_verifier, client_id, redirect_uri`)
- nginx (`location = /oauth/token`) → `proxy_set_body "$request_body&client_secret=..."` → `https://oauth2.googleapis.com/token`
- secret은 nginx 설정 파일에만 존재 (브라우저·git·CDN 어디에도 없음)
- 예시 설정: `nginx/oauth-proxy.example.conf`

검수 영향: 클라이언트 ID 자체는 변경 없음 → `drive.appdata` 검수 결과 그대로 유효.

## Phase 2i — Sync 사이클 캐시로 라운드트립 단축 (구현 완료 2026-05-08)

### 동기

운영 환경 디버그 로그에서 단일 sync가 약 3.4초 걸리는 것이 관측됨 (한국 → Google 서버 RTT 약 250ms × 직렬 호출 3회 + 페이로드 전송). 분해:

| 단계 | API | 소요 |
|---|---|---|
| `findSyncFileId` | `files.list?q=name='sync.json'` | ~537ms |
| `downloadSyncFile` | `files/{id}?alt=media` | ~1109ms |
| `uploadSyncFile` | PATCH multipart | ~1771ms |

핵심 관찰:
- `appDataFolder/sync.json`의 fileId는 영구 — 매 사이클 `files.list` 호출은 낭비.
- 원격이 변하지 않은 사이클(예: visibilitychange 자동 동기화)에서 본문 다운로드는 무의미.
- 로컬·원격 둘 다 변하지 않았다면 사이클 자체가 no-op이어야 함.

### 결정

`localStorage`에 sync 사이클 캐시를 도입한다:
- `bible-drive-cache-file-id` — 첫 발견 시점에 저장. 이후 사이클은 `findSyncFileId` 생략.
- `bible-drive-cache-etag` — 마지막 다운로드의 ETag. 다음 다운로드에 `If-None-Match` 헤더로 전송.
- `bible-drive-cache-synced-hash` — 마지막으로 맞춘 문서의 지문(북마크, 설정, 읽던 위치를 키 순서대로 적은 글의 해시, `store-v2.js fingerprint`). 304를 받으면 지금 문서의 지문과 비교해 로컬 변경 여부를 판정한다(2026-10-31, known-issues §38). 지문을 계산하지 못하면 이 키를 지워, 다음 304에서도 바뀐 것으로 본다. 그전의 `bible-drive-cache-synced-u`(마지막 sync 시점 `maxU`)는 시계가 느린 기기에서 새로 만든 북마크를 변경으로 보지 못했다. 옛 키는 지문을 쓰거나 캐시를 지울 때 지운다.

구글은 앱이 읽을 수 있는 ETag(파일의 버전을 가리키는 값)를 주지 않는다. 내려받기 응답에는 ETag 헤더가 없었고, 올리기 응답에서도 앱 코드가 ETag를 읽지 못했다(2026-10-30 개발 서버 시험, 아래 Phase 2j 「추적 항목」). 그래서 운영에서는 ETag가 캐시되지 않고, 아래의 304 분기와 412 처리는 실행되지 않는다. 매 사이클이 파일 전체를 내려받아 병합한다.

### 분기 매트릭스

| 로컬 | 원격 | 라운드트립 | 예상 소요 | 절감 |
|---|---|---|---|---|
| 미변경 | 미변경 (304) | 1 (download 304) | ~0.2s | **94%** |
| 변경 | 미변경 (304) | 2 (download 304 + upload) | ~2.0s | 41% |
| 미변경 | 변경 (200) | 1 (download 200) | ~1.3s | 62% |
| 변경 | 변경 (200) | 2 (download 200 + upload) | ~2.9s | 15% |

모든 분기에서 `findSyncFileId` 1회가 사라진다. 304이면 본문을 받지 않고 병합도 하지 않는다. 304이고 로컬이 바뀐 분기도 병합하지 않아도 된다. 캐시된 지문은 마지막으로 맞춘 문서의 것이고 그 뒤로 드라이브가 바뀌지 않았으므로, 로컬 문서가 곧 병합 결과다(`local === merge(local, remote)`).

### 캐시 무효화

- **404 다운로드** (다른 기기에서 파일 삭제): 캐시 클리어 + `SYNC_FAIL http_404` → 다음 사이클은 `findSyncFileId`로 재생성 폴백.
- **412 업로드** (cached etag 기준 race lost): 캐시 클리어 → 다음 사이클은 full download + merge로 충돌 해결.
- **`disable()`** (사용자 disconnect): 캐시 클리어. 다른 Google 계정으로 로그인 시 stale fileId 재사용 방지.
- **`deleteRemoteFile()`**: 캐시 클리어.
- **세션 종료 시 (defense-in-depth)**: silent refresh가 `invalid_grant`로 실패하거나 401 후 IDB에 refresh token이 없어 NEEDS_CONSENT로 폴백할 때 캐시도 함께 클리어. Drive `appDataFolder` 격리가 데이터 누출은 막아주지만, 다른 계정 재로그인 시 stale fileId로 인한 404 round trip 1회를 절약.

### PWA 스토리지 제약조건 회복력

캐시는 부수 최적화이므로 **모든 localStorage 작업 실패는 silent하게 무시**한다. 전파되면 sync 자체가 멀쩡한 상황에서도 사용자가 ERROR 상태로 떨어지기 때문.

| 시나리오 | 트리거 | 동작 |
|---|---|---|
| Quota 초과 | `setItem` → `QuotaExceededError` | `_saveCache`가 catch + `CACHE_SAVE_FAIL` 로깅 후 진행. 다음 사이클 slow path |
| Storage 비활성 | `getItem` → `SecurityError` (쿠키 차단 등) | `_loadCache`가 catch → 빈 캐시 반환 → slow path |
| Storage 비활성 | `removeItem` throw | `_clearCache` catch → `disable()` 진행. stale 캐시는 다음 404/412에서 재시도 |
| ITP 7일 eviction | 캐시 키만 사라짐 | `_loadCache` null 반환 → slow path → 자동 재생성 |
| 부분 손상 | 외부 코드가 지문 값을 바꿈 | 지문이 달라 보여 한 번 더 올린다 |
| 두 탭이 함께 동기화 | 두 탭의 동기화가 겹침 | 운영에서는 ETag가 없어 412 없이 나중에 올린 탭이 먼저 올린 탭의 편집을 파일에서 빼고, 다음 동기화가 같은 기기 저장소에서 그 편집을 다시 올린다(2026-10-31 흉내 장치로 확인, known-issues §42) |
| 사용자 site data clear | 모든 캐시 키 사라짐 | cache miss → slow path. refresh token IDB도 같이 사라지면 NEEDS_CONSENT (Phase 2h 처리) |

### 회귀 방어

`tests/unit/state-machine.test.js`에 11 케이스 추가:

**Group 10 (캐시 핵심 동작, 8건)**
1. 첫 sync 후 fileId·etag·지문 캐시됨
2. 캐시 hit + 304 + 로컬 미변경 → upload·findSyncFileId 모두 생략
3. 캐시 hit + 304 + 로컬 변경 → merge 생략하고 upload-only
4. 캐시 hit + 다운로드 404 → 캐시 무효화 + SYNC_FAIL
5. 캐시 hit + 304 + upload 412 → 캐시 무효화
6. `disable()` → 캐시 클리어
7. 캐시 hit + 200 → 일반 merge 경로 + 새 etag 캐시
8. 캐시 미스 → If-None-Match 헤더 미전송

**Group 11 (스토리지 제약조건 회복, 3건)**
1. `_saveCache`의 setItem 실패해도 sync IDLE 정착 + `CACHE_SAVE_FAIL` 로그
2. `_loadCache`의 getItem 실패 → slow path graceful fallback
3. `_clearCache`의 removeItem 실패해도 `disable()` 정상 진행

**Group 12 (세션 종료 시 캐시 클리어, 2건)**
1. silent refresh `invalid_grant` → IDB refresh token + 캐시 동시 클리어
2. 401 + IDB 비어있음 → NEEDS_CONSENT 폴백 시 캐시 클리어

전체 unit 65 → 78 케이스, 0 fail.

### 트레이드오프

- **첫 sync는 그대로**: 캐시가 비었을 때만 옛 경로. 사용자가 앱을 처음 켰을 때 한 번만 약 3s, 이후 약 0.2-2s.
- **localStorage 의존**: Safari 사생활 보호 모드처럼 저장소가 제한된 환경에서는 캐시를 쓰지 못해 매번 느린 경로(파일 찾기와 전체 내려받기)로 간다. 결과는 같다. Phase 2h IDB 패턴과 다르게 평문 저장이지만 fileId, ETag, 지문은 민감 정보가 아니다.
- **로깅**: Quota 실패만 `CACHE_SAVE_FAIL`로 ring buffer에 남긴다 (만성화 패턴 추적용). load/clear 실패는 silent — too noisy on Safari private mode.

## Phase 2j — Poll throttle + ETag 관측성 (구현 완료 2026-05-11)

### 동기

Phase 2i 도입 후 실측 디버그 로그에서 확인한 것(로그 원문을 담기로 한 `2026-05-11-sync-perf.md`는 저장소에 들어온 적이 없다, 2026-10-22 확인):

```
[+103.460s] SYNC_REQUEST state:IDLE   ← LOCAL_CHANGE 없음
[+103.461s] FIND_FILE_CACHED
[+104.549s] DOWNLOAD http:200         ← 매번 200, 304 안 보임
[+104.550s] MERGE
[+104.551s] SYNC_DONE
[+105.748s] SYNC_REQUEST              ← +2.3s, 다시 1.1s 라운드트립
[+108.213s] SYNC_REQUEST              ← +2.5s, 또 1.1s
[+110.490s] SYNC_REQUEST              ← +2.3s, 또 1.1s
```

두 가지 사실:

1. **`If-None-Match` 304 fast path가 실제로 발화하지 않는다.** Drive `?alt=media` GET의 ETag 헤더가 캐시에 잡히지 않거나(가설 A: CORS `Access-Control-Expose-Headers`에 ETag 누락), 업로드 응답의 ETag와 미디어 GET의 ETag가 다른 네임스페이스라(가설 B) 매번 mismatch — 둘 다 실측 없이는 단정 불가.
2. **visibilitychange 트리거 폴이 짧은 시간에 다발한다.** 탭 전환 4회에 4회 사이클, 각 약 1.1s. Phase 2i 의 304 가정이 깨진 상태에서 비싼 round-trip이 그대로 누적.

### 결정

**(a) Public `requestSync(opts?: { throttleMs })` throttle.**
`_lastSyncEndAt` (마지막 `_syncCycle` finally 시각)을 추적하고, `throttleMs` 지정 시 window 안의 호출은 `SYNC_THROTTLED` 로그를 남기고 drop. 사용자 액션 경로(`scheduleUpload` 후 300ms 디바운스, pull-to-refresh)는 `throttleMs` 미전달 → 항상 진행. visibilitychange만 `pollSync()` 래퍼로 `throttleMs: 15_000`을 건다.

내부 dispatch (silent refresh, conflict timer, backoff timer)는 `requestSync()` 우회해 직접 `dispatch({type:"SYNC_REQUEST"})` 호출 — throttle 영향 없음.

**(b) Debug log에 ETag 노출.**
`_format()`이 기존엔 `http:200`만 찍고 `etag` 필드는 dump에 안 보였다. 다음 실측 로그에서 `etag:` 가 비어 있으면 → 가설 A 확정(헤더 미노출 또는 null 캐싱), 값이 있는데도 304 안 오면 → 가설 B(다른 네임스페이스 또는 weak/strong 차이) 확정. 진단 결과에 따라 후속 결정.

`elapsedMs` / `throttleMs` 필드도 함께 dump 포맷에 추가 — `SYNC_THROTTLED` 로그가 사람 읽을 수 있는 형태로 보이도록.

### 기대 절감

위 4건 폴 사이클(+103/+105/+108/+110s) 중 1건만 통과, 3건 drop → **3.3초 절감 / 10초 윈도우**. 사용자가 다른 기기에서 만든 변경의 반영 지연 상한은 15초(throttle window). 두 기기 동시 편집 시나리오에서도 모바일 → 데스크탑 전환 사이 15s 미만일 때만 한 사이클 늦어진다.

### 회귀 방어

`tests/unit/state-machine.test.js`에 4 케이스 추가 (40–43):

- 첫 호출은 `_lastSyncEndAt=0`이라 throttle 미적용
- window 안의 후속 폴 3건 모두 drop + `SYNC_THROTTLED` 로그
- `throttleMs` 미지정 사용자 액션은 영향 없음
- SYNCING 중 폴은 IDLE 검사에서 끊겨 throttle 분기 진입 안 함

전체 unit 78 → 479 케이스 중 sync 관련 46 케이스 0 fail (다른 모듈 테스트 포함 전체 통과).

### 추적 항목

- [x] 304 미동작 원인(2026-10-30, 개발 서버에 로그인해 Chrome 개발자 도구로 확인): 내려받기 응답에는 ETag 헤더가 없었다. 가설 A(노출 누락)도 B(다른 네임스페이스)도 아니었다. 올리기 응답에서도 앱 코드가 ETag를 읽지 못했다. 그래서 운영에서는 304와 412가 일어나지 않는다. 304 경로는 남겨 두고 문서 지문으로 판단하게 고쳤다(known-issues §38). 파일 단위 쓰기 보호가 없는 문제는 known-issues §42.

## 설정 병합 전방 호환 (PR #309, 2026-08-01)

(2026-08-01) 교회력 기능(ADR-036/038)이 설정 키 4종을 추가하기에 앞서, 구 빌드가 새 빌드의 설정 키를 동기화 중 조용히 떨어뜨리는 문제를 수리하고 설정 키의 수명 주기 규약을 정립했다.

- **모르는 키 보존** (`mergeDocs`): 설정 병합이 `_emptyDoc()`의 아는 키만 돌던 것을 로컬·원격 키의 **합집합** 순회로 변경. 이 빌드가 모르는 키도 같은 LWW(`_u` 큰 쪽) 규칙으로 병합 결과에 실린다. `applyToLegacyKeys`는 그대로 아는 키만 localStorage에 반영 — 모르는 키는 문서에 보존만 되면 된다. `SyncSettings`에 문자열 인덱스 시그니처를 더해 타입으로도 성립.
- **`__proto__` 검사** (`mergeDocs`): JSON.parse 산출 문서는 `"__proto__"`를 own key로 가질 수 있고, 그대로 대입하면 병합 결과 객체의 프로토타입이 바뀐다(키 탈락 + 오염). 북마크 id·설정 키 두 순회 모두에서 이 키를 무시한다.
- **설정 키 은퇴 규약 + GC** (`sweepRetiredSettings`, 2026-10-31 전에는 `sweepTombstones`): 키를 없앨 때는 `{ v: null, _u: now }`를 쓴다. 앱 시작 시 sweep이 30일 지난 null 항목을 걷어내, 이름을 바꾸거나 폐기한 키가 동기화 문서에 영원히 남지 않는다. `_u === 0` 기본값 항목은 매 병합이 재생성하므로 sweep 대상에서 제외. 북마크 삭제 기록은 2026-10-31부터 지우지 않는다(Phase 2c 「삭제 기록 보존」).
- **회귀 방어**: `tests/unit/store-v2.test.js` 신설(17 케이스) — store-v2 첫 직접 유닛 커버리지. 모르는 키 보존 왕복·LWW·`__proto__` 검사·설정 GC·저장/업로드 페이로드 통과를 잠근다.

## 옛 버전의 북마크 절 범위 — 병합 결과를 저장하기 전에 옮긴다 (2026-10-22)

2026-06-06(#205) 전의 앱이 저장한 북마크 절 범위의 줄 글자(「16aa」, 「20a,20c」)는 지금 표기로 옮긴다(ADR-010 「옛 저장값」, coding-pitfalls §38). 옮길 때 항목의 수정 시각(`_u`)은 올리지 않는다(사용자 결정 2026-10-22). 앱을 시작할 때의 옮기기는 동기화가 드라이브를 받기 전에 돈다. 그래서 시각을 올리면, 다른 기기에서 그 북마크를 고친 내용이 이 기기의 옮긴 사본에 밀려 사라질 수 있다.

시각이 같은 두 사본은 병합하면(`mergeDocs`) 드라이브의 사본이 남는다(2026-10-31부터, Phase 2c 「같은 수정 시각」. 그전에는 기기 id 순서). 드라이브에 옛 표기가 남아 있으면 병합이 옛 표기를 되돌려 놓으므로, `state-machine.js _applyMergedDoc`이 병합 결과를 저장하기 전에 `window.migrateLegacyBookmarkDoc`(`js/app/bookmark-core.js`, 창 객체는 `bookmark.js`가 건다)으로 옮긴다. 옮긴 뒤에도 시각은 그대로라 올릴 것이 생기지 않는다. 성서 목록은 대개 이때 받아져 있다(`search.js`가 시작할 때 미리 받는다). 그러나 성서 목록이 필요 없는 화면(캘린더 등)으로 시작하면 병합이 먼저 올 수 있다. 그때는 받은 대로 저장하고, 목록을 받은 뒤 저장된 목록을 옮긴다(시작할 때와 같은 `migrateStoredBookmarks`). 드라이브의 사본은 다른 까닭으로 올릴 때 옮긴 값으로 바뀐다. 동기화 계층에는 앱 쪽 함수가 없을 수 있으므로(유닛 하네스) 함수가 있을 때만 호출한다. 동기화 계층이 그 함수를 호출하는 자리는 `tests/unit/state-machine.test.js` 70, 71번이 보고, 옮기는 함수는 `tests/unit/bookmark.test.js`가 본다.

## 미결 사항

- [x] Google Cloud Console 프로젝트 생성 및 Client ID 발급
- [x] 개인정보처리방침 작성
- [x] Drive API 호출 실패 재시도 전략 — exponential backoff (PR #26, Phase 2c)
- [x] 동기화 충돌 결과 사용자 알림 UX
- [x] Google OAuth 앱 검수 통과 (2026-05-19) — refresh token TTL 영구, 코드 변경 0
- [x] **Google Cloud Console redirect URI 등록** (Phase 2h 단계 6, 2026-05-08): dev `https://dev.anglican.kr/`, prod `https://bible.anglican.kr/`. `http://localhost:8080`은 의도적으로 제거 (사용자 PC 악성 프록시 공격 표면 차단)
- [x] **OAuth `/token` BFF 도입** (Phase 2h 단계 6, 2026-05-08): nginx `location = /oauth/token`이 `client_secret` server-side 주입. SPA 임베드 회피 — ADR-017 참조
- [x] iOS Safari 팝업 차단 안내 제거 (Phase 2d, 2026-05-05) — FedCM/One Tap + 사용자 제스처 격리
- [x] iOS Safari 팝업 차단 안내 완전 제거 (Phase 2f, 2026-05-05) — Implicit Flow 풀페이지 리디렉션 (Phase 2d 가정 오류 정정)
- [x] FedCM-mandatory deprecation 경고 제거 (Phase 2e, 2026-05-05) — `prompt()` 콜백 + timeout 폴백 폐기
- [x] 항목 단위 병합 — per-record LWW + tombstone (Phase 2c, `js/sync/store-v2.js`)
- [x] 내보내기/가져오기 JSON 스키마 `_version: 1` 추가
- [ ] 북마크 삭제 기록 정리: 2026-10-31부터 지우지 않는다. 기준 목록 2단계(규칙 다와 「드라이브에 처음 보인 때부터 30일」)에서 정한다(Phase 2c 「기준 목록」, known-issues §39)
