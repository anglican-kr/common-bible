---
date: 2026-11-08
branch: docs/adr-017-live-config
title: "docs: ADR-017을 운영 서버의 지금 설정에 맞춤"
---

## 요약

ADR-017(OAuth `/token` BFF 프록시)을 운영 서버(seoul)의 지금 설정에 맞췄다. 2026-07-28에 서버 설정이 두 가지 바뀌었는데, 그 변경이 앱 저장소와 서버 저장소 어디에도 기록되지 않았다.

- 비밀값(`client_secret`)을 사이트 설정 파일에서 root만 읽을 수 있는 별도 파일로 옮겼다. 「결정」, 「채택 근거 1」, 「구현 노트」를 고쳤다.
- Google 주소를 `proxy_pass`에 그대로 적던 방식을 변수와 DNS 서버 지정(`resolver`)으로 바꿨다. 버린 방식은 「검토한 대안 E」에 이유와 다시 검토할 조건을 적었다. 「받아들인 트레이드오프」에 외부 DNS 서버에 의존한다는 점을 더했다.

## 확정 · 근거

- 서버 저장소 README에 「ADR-017 갱신 필요」 메모가 남아 있어 확인을 시작했다. 그 메모가 가리킨 njs 검사 제거는 ADR에 이미 반영되어 있었다(2026-06-09). 사용자가 실제 서버에서 확인한 뒤 고치라고 했다(2026-11-08).
- 7월 변경의 이유는 서버 사이트 설정 파일의 주석에서 옮겼다. `systemd-resolved`가 다시 시작되는 사이에 `nginx -t`가 Google 주소를 찾지 못해 nginx 전체가 시작되지 않았다는 내용이다.
- 7월에 비밀값도 교체했는지는 서버에서 알 수 없어 ADR에 적지 않았다. 확인 방법은 서버 저장소 README에 적는다.

## 검증

- seoul 서버에서 bible과 dev 사이트 설정 파일, 비밀값 파일의 권한(0600, root:root), `nginx -t` 결과를 확인했다. 비밀값이 든 파일은 두 비밀값 파일뿐이었다(`/etc`, `/root`, `/home` 검색).
- 두 사이트의 `/oauth/token`에 가짜 요청(POST)을 보내 Google의 JSON 응답(401 `invalid_client`)이 오는 것을, GET은 405로 막히는 것을 확인했다.
- `python3 tools/prose/prose.py lint --changed origin/main`, `node --test tests/unit/docs-*.test.js`

## 갱신한 문서

- `docs/decisions/017-oauth-bff-proxy.md`
