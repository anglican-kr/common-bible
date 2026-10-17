---
pr: 354
date: 2026-10-17
branch: fix/sync-signout-inflight
title: "fix: Drive 동기화 — 로그아웃 경합 · 실패 처리 · 「파일도 삭제」"
---

# fix: Drive 동기화 — 로그아웃 경합 · 실패 처리 · 「파일도 삭제」

## 요약

`known-issues.md` §11 — #353(타입 검사 묶음 ①)의 e2e 전체 실행에서 `test_drive_sync.py::test_sign_out_clears_sync` 가 한 번 실패했고, 원인은 그 PR 과 무관한 기존 경합이었다(①). 이 브랜치를 main 위로 올린 뒤 머지 전 `/code-review`(high)가 같은 동기화 사이클에서 7건을 더 짚었고, 6건을 같은 PR 에서 고쳤다(② · ③ · 테스트 — 아래 「리뷰 반영」). 하나(5번 — 진행 중 요청 취소 구조)는 하지 않기로 했다(「확정·근거」).

### ① 도중에 로그아웃하면 사이클을 멈춘다 (known-issues §11)

동기화 사이클 `_syncCycle()`(`js/sync/state-machine.js`)은 네트워크 대기(파일 찾기 · 내려받기 · 올리기) 뒤에 상태를 다시 보지 않았다. 그 대기 중에 `signOut()`(→ `disable()` → DISABLE — `_token = null`)이 오면 —

- **파일 찾기 대기였다면** — 대기 뒤에 만든 업로드가 로그아웃 뒤에 더한 북마크까지 담아 `Authorization: Bearer null` 로 나갔다. 실제 Drive 는 401 로 거절하고 DISABLED 상태는 SYNC_FAIL 을 무시하므로 자료가 올라가거나 다시 로그인되지는 않았다.
- **내려받기 대기였다면** — 원격 자료를 로컬에 합쳐 썼고(`_applyMergedDoc`), `disable()` 이 비운 캐시(fileId · etag · syncedMaxU)를 다시 채웠다.
- **올리기 대기였다면** — 업로드는 로그아웃 전에 만든 본문 · 그때의 토큰으로 이미 나갔고, 끝난 뒤 비운 캐시를 다시 채웠다.

고친 것: `_leftSyncing(at)` — 대기 여섯 곳마다, 그리고 대기가 예외로 끝났을 때의 `catch` 에서 상태가 아직 SYNCING 인지 보고, 아니면 로그(`SYNC_ABORTED`, 어느 자리였는지)만 남기고 멈춘다. 그 뒤로는 Drive 에도 로컬 자료에도 손대지 않고, SYNC_DONE · SYNC_FAIL 도 내지 않는다(coding-pitfalls §11 의 「모든 await 직후 재검사」 규칙이 빠져 있던 곳).

### ② 실패를 성공으로 치지 않는다 (검토 1 · 3번)

전송 함수가 실패를 정상 결과와 같은 값으로 돌려줘, 사이클이 실패를 성공으로 읽던 곳이 셋이었다(coding-pitfalls §28 신설).

- **파일 찾기** — `transport.js findSyncFileId` 는 어떤 실패든 `null`(「파일 없음」)이었다. 캐시에 fileId 가 없는 사이클(그 기기의 첫 동기화 · 캐시가 비워진 뒤)에서 목록 요청이 잠깐 실패하면 새 파일 올리기로 가, 이미 있는 sync.json 옆에 하나가 더 생길 수 있었다. 이제 `{ fileId, status }`(`types.d.ts DriveFindResult` — 2xx 의 null 만 「없음」, 0 = 네트워크 실패 · 읽을 수 없는 응답)를 돌려주고, 사이클은 401 이면 재인증, 그 밖의 실패면 SYNC_FAIL(`http_<status>`)로 간다.
- **내려받기** — 401 · 404 · 0 · 5xx 가 아닌 실패(403 할당량 · 429 · 400)는 `doc: null` 이라 「원격 없음」 → SYNC_DONE 이었다(재시도 없음 · redirect 시도 횟수 0 으로). 이제 304 가 아닌 모든 실패가 SYNC_FAIL — 기존 분류의 「그 밖의 실패」(백오프 최대 다섯 번 → OFFLINE)로 간다.
- **v1 문서를 v2 로 올리기** — 이 갈래만 `!ok` 검사가 없어 5xx · 네트워크 실패도 캐시를 「동기화됨」으로 쓰고 SYNC_DONE 이었다. 다른 업로드 갈래와 같이 SYNC_FAIL.

머리 주석의 SYNC_FAIL 이유 표도 「그 밖의 실패(network · 403 · 429 · 5xx …)」로 고쳤다.

### ③ 「파일도 삭제」 뒤 파일을 되살리지 않는다 (검토 4번)

연결 해제의 「파일도 삭제」(`bookmark.js`)는 `await deleteRemoteFile()` 뒤에 `signOut()` 을 불러, 지우는 동안 동기화가 그대로 돌았다 — 진행 중 사이클의 새 파일 올리기가 지우기 뒤에 도착하거나, 그 사이 시작한 사이클이 「파일 없음」을 받아 새로 올리면 방금 지운 파일이 되살아났다. 지우지 못해도(오프라인 · 목록 실패) 아무 말이 없었다.

- **상태 기계 `deleteRemoteFile()`** — 지우기 전에 동기화를 멈춘다: 토큰을 쥔 채 DISABLED 로(새 사이클은 시작하지 못하고 — `requestSync` 는 IDLE 에서만 — 진행 중 사이클은 다음 대기에서 멈춘다), 그 사이클이 이미 보낸 요청이 끝나기를 기다린 뒤(`_cycleDone` — 돌고 있는 사이클의 Promise) 찾아 지운다. 지워졌으면(없었거나 404 포함) `true`, 확인하지 못했으면(토큰 없음 · 찾기 · 지우기 실패) `false` 를 돌려준다. 토큰은 이어지는 `signOut()` 이 폐기하고, `disable()` 은 이제 어느 상태에서든 토큰을 지운다(DISABLED 에 토큰이 남는 길이 이 함수뿐이라).
- **`drive-sync.js deleteRemoteFile()`** — 예약된 올리기 타이머도 먼저 지우고 결과를 넘긴다.
- **`bookmark.js`** — 연결 해제는 그대로 진행하고, 파일이 남았으면 스낵바 「연결은 해제했지만 Drive의 동기화 파일은 삭제하지 못했습니다. 다시 연결한 뒤 「파일도 삭제」를 눌러 주세요.」 — 스낵바는 같은 글을 live region 에도 넣는다(아래 「리뷰 반영」 Copilot 1회차).
- **`disable()`** — 지우는 동안 토큰을 쥐고 있어 그사이 연 설정은 「해제」(연결됨)를 그린다. 이어지는 로그아웃은 이미 DISABLED 라 DISABLE 처리기가 없어 화면을 다시 그리지 않았다 — 이미 DISABLED 이면 `disable()` 이 직접 다시 그린다(Copilot 1회차).

### 테스트

- **유닛** `tests/unit/state-machine.test.js` — 44~50(멈추는 자리 여섯 — 파일 찾기 · 새 파일 올리기 · 내려받기 · 304 뒤 올리기 · v1 올리기 · 합친 뒤 올리기 — 과 예외: 그 대기를 손으로 쥔 Promise 로 세워 두고 `disable()`), 51~54(찾기 503 · 찾기 401 · 내려받기 403 · v1 올리기 503), 55~56(「파일도 삭제」가 진행 중 생성을 기다림 · 찾기 실패면 `false`), 57(그 뒤의 `disable()` 이 이미 DISABLED 여도 설정을 다시 그림). 하네스의 `findSyncFileId` · `deleteSyncFile` 스텁도 새 반환 꼴로.
- **e2e** `tests/e2e/test_drive_sync.py` — 가짜 Drive(`FakeDrive`)가 실제 API 처럼 토큰 없는 요청(`Bearer null`)에 401, 받은 요청 기록, 목록 · 새 파일 만들기 응답을 쥐었다 푸는 `hold_list` · `hold_create`, 목록을 실패시키는 `fail_list`. 새로 `test_sign_out_mid_cycle_sends_nothing_after`(로그아웃 직전부터 Drive 로 가는 요청을 센다) · `test_drive_disconnect_delete_waits_for_inflight_create` · `test_drive_disconnect_delete_failure_says_so`(스낵바와 live region 둘 다) · `test_drive_settings_reopened_during_delete_updates_after_sign_out`(지우는 동안 다시 연 설정이 로그아웃 뒤 「연결」로). 다 받아 주던 가짜가 ①을 「가끔 실패하는 테스트」로만 보이게 했다.

## 확정·근거

- **작업 지시 1(2026-10-17, 사용자)** — #353 보고 뒤 「알려진 이슈 11도 함께 해결하자」, 이어 「수정 규모가 크다면 PR 분리할게」. #353 은 동작을 바꾸지 않는 타입 PR 이라 따로 내기로 했다(사용자에게 알림). #353 머지 뒤 「리베이스하고 수정한 내용을 다시 검토바람」.
- **작업 지시 2(2026-10-17, 사용자)** — `/code-review` 8건을 건마다 판단 · 계획으로 보고(1 · 3 · 4번은 따로 넘기자고 권했다) → 「모두 진행 해줘. 5번은 하지 않는 거라했지? 다시 반복되지 않게 기록해두고」 → 이어 「1, 2, 3, 4, 6, 7, 8 모두 진행하자. 뒤로 미루지 말고. 나눠야 할 이유가 있을까?」 — 답: 강한 이유는 없다. 셋 다 같은 동기화 층 · 같은 테스트 하네스라 나누면 같은 함수를 PR 마다 다시 올려야 하고, 되돌릴 단위는 항목별 커밋으로 남는다. 그래서 한 PR 에 항목별 커밋으로.
- **결정 — 5번(진행 중 요청을 취소하는 구조)은 하지 않는다**(사용자 확인 2026-10-17). 대기마다 한 줄씩 다시 보는 지금의 꼴을 유지한다 — 같은 파일의 `_attemptSilentRefresh` 도 그렇게 하고, 사이클마다 `AbortController` 를 두려면 OAuth · Drive 전송 함수마다 신호를 넘겨야 하며, 로그아웃 전에 이미 나간 업로드는 로그아웃 전의 편집이라 끝나게 둔다. 빠뜨림은 테스트가 막는다(44~50 — 확인 한 줄을 빼면 그 자리의 테스트가 실패). 기록: coding-pitfalls §11 규칙(재검토 조건 — 전송 계층을 다른 이유로 고쳐 요청마다 신호를 받게 될 때 · 사이클의 대기가 크게 늘 때)과 `_leftSyncing` 머리 주석. 리뷰가 같은 제안을 다시 내면 그 줄을 근거로 넘긴다.
- **판단 — 실패 분류는 상태 코드로만 한다.** Drive 의 오류 처리 안내(https://developers.google.com/workspace/drive/api/guides/handle-errors, 2026-10-17 원문 확인)는 403 `userRateLimitExceeded` · `rateLimitExceeded`, 429, 5xx 를 지수 백오프로 다시 시도하라고 하고, 400 과 그 밖의 403(용량 초과 · 권한 등)은 사람이 손써야 한다고 적는다. 이 앱은 403 의 이유(응답 본문)를 읽어 가르지 않고 실패를 모두 기존 백오프(1 · 2 · 4 · 8 · 16초, 다섯 번) → OFFLINE 으로 보낸다 — 다시 해도 소용없는 실패도 다섯 번에서 멈추고, 업로드 갈래는 이미 이렇게 돌고 있었다.
- **보안 판단** — ① 은 자료 유출이 없었다(로그아웃 뒤의 업로드는 토큰 없이 나가 401, DISABLED 는 SYNC_FAIL 을 무시해 재인증으로 가지 않는다 — `case S.DISABLED` 는 ENABLE 만 받는다). 그래도 로그아웃 뒤 Drive 로 요청이 나가는 것 · 원격 자료가 로컬에 쓰이는 것 · 비운 캐시가 다시 차는 것은 「로그아웃하면 멈춘다」는 기대와 어긋나 고쳤다. ③ 은 사용자가 「Drive 의 자료도 지운다」고 고른 것이 지켜지지 않던 것이라, 토큰 폐기는 지우기 뒤로(지우기 요청이 폐기된 토큰으로 나가지 않게), 동기화 정지는 지우기 앞으로 두었다. 지우지 못하면 알린다.
- **판단 — 「파일도 삭제」가 실패해도 연결 해제는 진행한다.** 사용자는 연결 해제를 골랐다 — 남은 파일과 지우는 길만 알린다. 문구는 사용자 교정(2026-10-17 「여기 한국어 문장 어색하다?」 — 초안 「…다시 연결한 뒤 연결 해제에서 다시 삭제해 주세요.」)으로 고쳤다 → coding-pitfalls §29.
- **판단 — 올리기 대기 중의 로그아웃은 업로드를 되돌리지 않는다.** 그 요청은 로그아웃 전에 만든 본문과 유효한 토큰으로 이미 나갔다 — 막는 것은 그 뒤의 캐시 쓰기뿐이다.
- **판단 — 상태로 판정한다(사이클 세대 번호가 아니라).** 세대 번호로 멈추면 다시 SYNCING 이 된 상태를 마무리할 사이클이 없어 SYNCING 에 갇힐 수 있다(`_syncPending` 이 새 사이클을 막는다). 실제로 `disable()` 뒤 같은 페이지에서 다시 SYNCING 이 되는 길은 없지만(켬 표지 "0" 이 `enable()` 의 조용한 갱신을 물린다 — 다시 켜려면 전체 페이지 리디렉션), 판정이 그 경우에도 맞도록 상태를 본다.
- **ADR 은 손대지 않았다** — 결정이 바뀌지 않았다(「로그아웃하면 멈춘다」 · 「파일도 삭제는 Drive 의 파일을 지운다」는 기존 의도이고, 실패의 백오프는 ADR-011 「Exponential backoff + OFFLINE」의 범위를 HTTP 실패까지 그대로 쓴 것 — 업로드 갈래는 이미 그랬다). ADR-011 은 손대면 옛 개정 블록(머리의 「개정:」 14줄 · 본문 10개)을 본문에 녹여야 해(CLAUDE.md 「ADR 워크플로우」 §2 — #353 이 ADR-012 에서 그렇게 했다) 918줄을 다시 쓰는 일이 된다 — 한 줄 넣었다가 뺐다. 규칙은 coding-pitfalls §11 · §28 에 둔다.

## 검증

- **새 유닛이 옛 코드에서 실패한다** — 44~50 은 `state-machine.js` 만 main 판으로 돌리면 일곱 다 실패(46 통과 · 7 실패). 51~56 은 전송 함수의 반환 꼴이 바뀌어 옛 코드와 나란히 돌릴 수 없어, 새 코드에서 그 동작만 되돌리는 변이 검사로 확인했다.
- **변이 검사** — 확인 한 줄 · 새 동작 하나를 되돌리면 그것을 지키는 테스트만 실패한다: `_leftSyncing` 일곱(find_file → 44 · upload_new → 47 · download → 45 · upload_update → 46 · upload_upgrade → 48 · upload_merged → 49 · exception → 50), 찾기의 실패 분류 → 51 · 52, 내려받기의 실패 분류(옛 조건으로) → 53, v1 올리기의 `!ok` → 54, 「파일도 삭제」의 사이클 기다리기 → 55, 그 찾기 실패 처리 → 56, `disable()` 의 토큰 지우기 → 55, 지우기 전 DISABLED 전이 → 55 · 56.
- **Copilot 1회차의 새 검사가 고치기 전 코드에서 실패한다** — `state-machine.js` · `drive-sync.js` · `bookmark-verse-select.js` 를 1회차 앞(PR 의 첫 push)으로 돌리면 e2e 둘이 실패한다(지우기 실패 안내가 live region 에 없음 · 다시 연 설정이 「해제」로 남음). 유닛 57 은 `disable()` 의 다시 그리기 한 줄을 빼면 실패한다(변이 검사).
- **새 e2e 가 옛 코드에서 실패한다** — 이 PR 이 고친 JS 넷(`state-machine.js` · `transport.js` · `drive-sync.js` · `bookmark.js`)을 main 판으로 돌리면 셋 다 그 결함으로 실패한다: 로그아웃 뒤 `POST …/upload/drive/v3/files?uploadType=multipart`, 「파일도 삭제」 뒤 진행 중이던 생성이 파일을 되살림, 지우기 실패에 스낵바 없음(5초 기다림 초과). 이 변경에서는 모두 통과.
- **동기화 e2e** — `test_drive_sync.py` 17 · `test_drive_sync_ios.py` 8 — 25건 모두 통과(가짜 Drive 의 401 · 쥐었다 푸는 응답이 다른 테스트를 깨지 않는다). 스낵바를 바꿔 절 복사가 쓰는 `test_copy.py` · `test_bookmark.py` · `test_a11y_keyboard.py` · `test_features.py` 도 다시 돌려 통과.
- **유닛** `node --test tests/unit/*.test.js` — 1266건, 1265 통과 · 1 skip(미결13 대기 픽스처). **실데이터** `node --test tests/unit/*.data.test.js` — 166건, 165 통과 · 1 skip. `npm run typecheck` — 0.
- **e2e** 전체 `pytest tests/e2e/` — 첫 push 때 **327건 모두 통과**(29파일, 한 번에 8분 20초 — `python3 scripts/serve.py 8080` 위에서; 가끔 실패하던 `test_sign_out_clears_sync` 도 통과). Copilot 1회차 반영 뒤 **328건 모두 통과**(한 번에 8분 21초).

## 갱신한 문서

- `docs/known-issues.md` §11 — 첫 항목(로그아웃 직후의 업로드)을 지우고 절 머리에 무엇을 고쳐 지웠는지 · 이 원장(§10 과 같은 꼴 — 절에는 #353 이 남긴 「옮겨 실린 절 목록」 항목이 남아 절째 비지 않는다).
- `docs/coding-pitfalls.md` — §5 사례 · 규칙(눈에만 보이던 스낵바 — 상태 메시지는 알림 함수 한 곳에서 live region 에도, Copilot 1회차), §11 사례 둘(`_syncCycle` 에 빠져 있던 재검사 · 「파일도 삭제」의 경합)과 규칙 넷(e2e 에서 응답을 쥐고 푸는 회귀 방어 · 가짜 서버도 토큰 검사를 실제처럼 · 사이클의 확인은 대기마다 한 줄 — 요청 취소 구조로 바꾸지 않는다는 결정과 재검토 조건 · 되돌릴 수 없는 작업 앞에서는 흐름을 멈추고 보낸 요청을 기다린다), §28 신설(실패를 「없음」 · 「성공」과 같은 값으로 돌려주지 않는다), §29 신설(알림 문구는 결과부터 — 사용자 교정).
- `docs/index.md` — Drive 동기화 행에 pitfalls §28, 「반복된 실수 패턴 29절」.
- `DESIGN.md` §10 「라이브 리전」 — 스낵바는 같은 글을 라이브 리전에도 넣는다(부르는 쪽은 따로 안내하지 않는다).
- `tests/README.md` — 유닛 1266 · e2e 328, `state-machine.test.js` 60 · `test_drive_sync.py` 17 행. `CLAUDE.md` — 유닛 1266.
- `docs/changes/README.md` 「규칙」 — 제목(곧 PR 제목)은 짧고 간결하게, 세부는 본문에(사용자 교정 2026-10-17 — 이 원장의 첫 제목이 길었다).
- ADR · status.md — 손대지 않았다(위 「확정·근거」 — 결정과 「지금 동작하는 것」의 목록이 바뀌지 않았다).

## 리뷰 반영 (2026-10-17, 머지 전 `/code-review` high — PR 을 열기 전)

#353 머지 뒤 main 위로 올린 이 브랜치를 사용자 지시로 다시 검토했다. 8건 — 결정은 위 「확정·근거」의 작업 지시 2.

1. **v1 문서를 v2 로 올리는 업로드에 `!ok` 검사가 없다** — 사실(main 부터). 고쳤다(요약 ②) · 유닛 54.
2. **원장의 검증 칸이 비어 있다** — PR 을 열기 전에 채우려던 자리. 채웠다.
3. **내려받기의 다른 4xx(403 · 429 · 400)를 성공으로 친다** — 사실(main 부터). 확인하다 곁가지를 하나 더 찾았다: 파일 찾기가 실패를 「파일 없음」으로 돌려줘 sync.json 이 둘이 될 수 있었다. 둘 다 고쳤다(요약 ②) · 유닛 51 · 52 · 53.
4. **「파일도 삭제」가 지우는 동안 사이클이 멈추지 않아 지운 파일을 다시 만들 수 있다** — 사실(main 부터). 고쳤다(요약 ③) — 지우지 못했을 때 알리는 것도 함께. 유닛 55 · 56, e2e 둘.
5. **대기마다 손으로 넣은 확인은 빠뜨리기 쉽다 — 사이클마다 `AbortController` 로 진행 중 요청을 취소하라** — 하지 않는다(사용자 확인). 이유 · 재검토 조건은 coding-pitfalls §11, 코드에는 `_leftSyncing` 머리 주석. 빠뜨림은 6번의 테스트가 막는다.
6. **멈추는 자리 여섯 가운데 셋만 테스트가 있다** — 사실. 47 · 48 · 49 를 더해 여섯 다 덮었다(변이 검사로 자리마다 하나씩 잡히는 것을 확인).
7. **e2e 가 「로그아웃 뒤 요청」을 로그아웃 · 북마크 추가 뒤부터 센다** — 사실. 로그아웃 직전부터 센다.
8. **`catch` 가 이미 멈춘 사이클인지 보지 않는다** — 반쯤 사실: 지금의 `transport.js` 는 예외를 던지지 않고 status 0 을 돌려줘 그 길은 드물다. 그래도 `catch` 첫 줄에 같은 확인을 두고(로그는 `SYNC_ABORTED` — `SYNC_EXCEPTION` · SYNC_FAIL 없음) 유닛 50 을 더했다.

## 리뷰 반영 (2026-10-17, Copilot 1회차)

리뷰 https://github.com/anglican-kr/common-bible/pull/354#pullrequestreview-5556950417 — 「Changes recommended」, 지적 둘.

1. **「파일도 삭제」 실패 안내가 화면 낭독기에 들리지 않는다**(`bookmark.js` — 스레드 r4301994116) — 사실. `_showSyncSnackbar` 는 live region 도 `role` 도 없는 `div` 다. 같은 함수를 쓰는 동기화 안내 아홉 곳(state-machine 7 · drive-sync 2)이 모두 같은 처지였고, 절 복사만 `announce()` 를 따로 불렀다 — 지적된 한 곳이 아니라 **스낵바 함수가 같은 글을 live region(`#a11y-announce`)에도 넣게** 고쳤고, 절 복사의 따로 부르던 `announce()` 두 줄은 지웠다(두 번 읽지 않게). e2e `test_drive_disconnect_delete_failure_says_so` 가 스낵바와 live region 을 따로 본다 — 고치기 전 코드에서 live region 쪽이 실패.
2. **지우는 동안 다시 연 설정이 로그아웃 뒤에도 「해제」로 남는다**(`state-machine.js` — 스레드 r4301994141) — 사실. 설정은 `isAuthenticated()`(토큰)로 「해제」 · 「연결」을 고르는데, 「파일도 삭제」는 지우는 동안 토큰을 쥐고 DISABLED 에 있고, 이어지는 `signOut()` 의 `disable()` 은 DISABLED 에 처리기가 없어 다시 그리지 않았다. 이미 DISABLED 이면 `disable()` 이 직접 `_refreshUI()` — 유닛 57(변이 검사로 그 한 줄을 빼면 실패), e2e `test_drive_settings_reopened_during_delete_updates_after_sign_out`(지우기의 목록 요청을 쥔 채 설정을 열고 풀면 「연결」로 — 고치기 전 코드에서 실패).

