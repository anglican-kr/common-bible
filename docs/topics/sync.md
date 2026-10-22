# Drive 동기화, OAuth

소유 코드: `js/drive-sync.js`, `js/sync/*.js`

북마크와 설정을 사용자의 Google Drive(appdata)에 동기화하는 일과, 로그인(OAuth PKCE)과 토큰 교환(nginx BFF)을 다룬다. 동기화 저장소의 형식과 병합 규칙은 이 주제가, 북마크 자체는 북마크 주제(`topics/bookmark.md`)가 맡는다.

## 지금 동작

- **북마크 + Google Drive 동기화 완료** — ADR-011, PKCE 단일 경로(2026-05-08). 상세는 `docs/archive/design/pkce-migration.md`, ADR-017(nginx BFF), `docs/archive/audit/2026-05-07-pkce-refresh-token.md`. Google OAuth 앱 검수 통과(2026-05-19) — refresh token TTL 영구, 코드 변경 0

## 결정

- ADR-011 「북마크 디바이스 간 동기화」
- ADR-017 「OAuth `/token` 요청을 nginx BFF 프록시로 격리」
- ADR-015 「클라이언트 스토리지 전략」
- 구조 그림은 `architecture.md` §4.3, PKCE 이행 경위는 `archive/design/pkce-migration.md`에 있다.

## 함정

### pitfalls §12 — 콜백 URL 데이터 leak — flow별 transport 격차

OAuth callback이 query string(`?code=...`)으로 오느냐 fragment(`#access_token=...`)으로 오느냐는 flow마다 다르다. URL을 strip하는 코드가 한 flow의 가정 위에 작성됐다면, flow 전환 시점에 새 flow의 callback이 URL bar / 브라우저 히스토리 / 로그에 leak될 수 있다.

**사례 (Phase 2h PKCE 마이그레이션 — Bugbot PR #54-2):**

- `3a7c8ab` — Implicit Flow 시절 IIFE는 `bad_state` / `no_state` / `state_mismatch` fallback에서 `history.replaceState(null, "", location.pathname + location.search)`로 search를 보존했음. Implicit callback은 fragment에 오므로 search는 안전했음. PKCE 도입 후 callback은 query string(`?code=...&state=...`)으로 오므로 같은 fallback이 auth code를 URL bar에 leak.

**규칙:**

- 새 flow로 전환할 때, 기존의 URL strip 로직이 새 flow의 callback shape을 반영하는지 명시적으로 검증한다.
- 기본 원칙: 본인 앱이 query 또는 fragment 기반 라우팅을 안 쓴다면, OAuth fallback에서 `location.pathname`만 남기고 search/hash를 둘 다 폐기하는 게 가장 안전.
- 회귀 방어: callback URL의 `?code=`, `#access_token=` 등이 IIFE 종료 후 `location.search`/`location.hash`에 잔존하지 않는지 e2e 테스트로 직접 검증.

### pitfalls §13 — 마이그레이션 시점의 sessionStorage / localStorage 키 격리

기존 흐름과 새 흐름이 같은 storage 키를 공유하면, 마이그레이션 PR 머지 시점에 진행 중이던 callback이 잘못된 흐름으로 라우팅되거나 완전히 떨어진다. flow별로 별도 키를 사용해 절대 교차 처리되지 않게 격리해야 한다.

**사례 (Phase 2h PKCE 마이그레이션):**

- 단계 2~4 — Implicit Flow는 `bible-drive-redirect-state`, PKCE는 `bible-drive-redirect-state-pkce`로 분리. 단계 4 머지 시점에 진행 중이던 PKCE callback은 새 코드도 같은 `-pkce` 키로 매칭되어 정상 처리됐고, 진행 중이던 Implicit callback은 신코드가 안 봐서 자연 만료(sessionStorage 휘발).
- 단계 4의 함수 rename(`beginRedirectAuthPKCE` → `beginRedirectAuth`)에서 **변수명만 canonical로 인계하고 storage 키 값은 의도적으로 `-pkce` 접미사 유지** — 변수명과 키 값을 동시에 바꾸면 in-flight callback이 떨어짐.

**규칙:**

- 서로 다른 인증 / 라우팅 flow에는 처음부터 다른 storage 키를 부여한다.
- 키 이름을 바꾸는 마이그레이션은 두 단계로: (1) 새 키 사용 시작, 옛 키는 read-only로 유지 → (2) 옛 키 cleanup. 한 PR에 같이 넣지 말 것.
- localStorage 폐기 키는 단계 5처럼 별도 정리 단계에서 `localStorage.removeItem(...)`을 IIFE에 추가해 기존 사용자 디바이스에서 청소한다 (몇 릴리스 후 cleanup 코드 자체도 제거).

### pitfalls §28 — 실패를 「없음」 · 「성공」과 같은 값으로 돌려주지 않는다 — 동기화가 오류를 성공으로 쳤다 (2026-10-17)

전송 함수가 실패를 정상 결과와 같은 값(`null` · `doc: null`)으로 돌려주면, 호출부는 그 값의 정상 갈래(「파일 없음」 · 「원격 없음」)로 간다 — 실패가 성공이 되어 재시도도 알림도 없다. 같은 함수 안에서 한 갈래만 실패 검사를 빠뜨려도 같은 일이 난다.

**사례** (원장 `docs/changes/2026-10-17-sync-signout-inflight.md` — 머지 전 검토 1 · 3번, 사용자 `/code-review` 3 · 4 · 5 · 6번):
- `findSyncFileId`(`js/sync/transport.js`)는 어떤 실패든 `null`(「파일 없음」)이었다 — 캐시에 fileId가 없는 사이클에서 목록 요청이 잠깐 실패하면 새 파일을 만들어, 이미 있는 sync.json 옆에 하나가 더 생길 수 있었다. 이제 `{ fileId, fileIds, status }`를 돌려주고 사이클은 실패를 먼저 가른다.
- 내려받기의 403 · 429 · 400은 `doc: null`이라 「원격 없음」으로 읽혀 SYNC_DONE — 재시도가 없고 redirect 시도 횟수까지 0으로 돌렸다.
- v1 문서를 v2로 올리는 업로드만 `!ok` 검사가 없어 5xx도 「동기화됨」(캐시 기록 · SYNC_DONE)이었다 — 다른 업로드 갈래는 모두 있었다.
- 본문을 읽지 못한 2xx 내려받기(받는 도중 연결이 끊겨 `res.json()`이 reject)는 `{ doc: null, status: 200 }`이라 「원격 없음」 성공으로 끝났다 — 찾기에서 고친 결함이 내려받기에 남아 있었다(main부터). 하네스의 기본 스텁이 바로 그 응답을 정상으로 써서 유닛이 보지 못했다. 이제 status 0(실패).
- 실패를 백오프 다섯 번 뒤 OFFLINE으로 보냈는데, OFFLINE은 브라우저 `online` 이벤트로만 빠져나온다 — 연결된 기기에서 HTTP 실패(429 · 5xx)가 이어지면 그 이벤트는 오지 않아 그 세션 내내 동기화가 멈췄다.
- 「파일도 삭제」의 결과가 `true` · `false` 둘뿐이라, 연결돼 있지 않아 아무것도 하지 않은 경우도 `false` — 「삭제하지 못했습니다」라는 거짓 안내가 떴다. `true`는 목록의 첫 파일만 지운 경우에도 나와, 겹친 sync.json이 남아도 「지웠다」였다.

**규칙:**
- 「없음」과 「실패」는 다른 값으로 돌려준다 — 상태 코드를 함께. 호출부는 실패를 먼저 가른 뒤에 「없음」을 읽는다. 본문을 읽지 못한 2xx도 실패다.
- 한 함수의 갈래들이 같은 실패 분류를 쓰는지 나란히 놓고 본다 — 한 갈래만 빠뜨리기 쉽다. 테스트 하네스의 기본 스텁이 「실패 같은 성공」(`doc: null` · 200)이면 그 응답이 정상으로 굳는다.
- 되돌릴 수 없는 작업의 결과는 됨 · 확인 못 함 · 할 일 없음으로 가른다(`true` · `false` · `null`) — 사용자에게는 「확인 못 함」만 알린다. 「됨」은 확인한 만큼만 말한다(목록의 모든 항목 · 캐시된 id · 이 페이지가 만든 id — 목록이 방금 만든 파일을 늦게 보일 수 있다).
- 재시도 분류는 서비스의 안내를 따른다 — Drive는 403 rate limit · 429 · 5xx를 지수 백오프로 다시 시도하라고 한다([오류 처리 안내](https://developers.google.com/workspace/drive/api/guides/handle-errors), 2026-10-17 확인). 이 앱은 상태 코드로만 갈라 실패를 모두 백오프(최대 다섯 번)하고, 그래도 실패하면 네트워크 실패만 OFFLINE, HTTP 실패는 IDLE로 돌아가 다음 요청이 다시 시도한다 — 다시 해도 소용없는 400 · 다른 403은 다섯 번에서 멈춘다(403의 이유를 읽어 가르지는 않는다).
- 실패로 들어가는 상태마다 빠져나오는 길을 적고, 그 길이 오지 않는 경우가 없는지 본다(온라인인 채로 `online` 이벤트를 기다리는 OFFLINE).

## 남은 일

- **known-issues §15.2** **동기화 저장소는 기본 속성 이름의 id 하나에 앱 전체가 멈춘다**(main부터). `store-v2.js bookmarkTreeFromFlat`은 부모 id별 목록을 일반 객체(`byParent`)에 모은다. 그래서 `toString` id가 저장소에 있으면 목록 읽기가 예외를 내고, 새로 고친 뒤 장 화면부터 그려지지 않는다(2026-10-19 실측). 이 PR의 가져오기 검사가 그 id를 막지만, 검사가 없는 판(1.6.4 이하)에서 가져온 기록은 동기화로 들어올 수 있다. **고치는 법**: 저장소의 맵을 `Object.create(null)`이나 `Map`으로 바꿔 저장소가 스스로 견디게 한다.
- **known-issues §15.5** **모르는 필드만 바뀐 항목은 동기화되지 않는다**(main부터). 가져오기는 모르는 필드를 그대로 두지만(다음 판 앱이 더한 필드가 살아남도록), 동기화 저장소의 내용 키(`store-v2.js _contentKey`)는 아는 필드만 비교한다. 그래서 그 필드만 바뀐 항목은 `_u`가 오르지 않아 다른 기기로 가지 않는다. 다음 판 앱이 필드를 더할 때 함께 본다.
