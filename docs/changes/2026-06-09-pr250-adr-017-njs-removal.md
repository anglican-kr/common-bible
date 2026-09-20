---
date: 2026-06-09
pr: 250
branch: docs/adr-017-njs-removal
title: "docs: ADR-017 개정 — OAuth BFF njs 가드 제거 (njs 0.8.2 세그폴트)"
---

# docs: ADR-017 개정 — OAuth BFF njs 가드 제거 (njs 0.8.2 세그폴트)

프로덕션 Drive 동기화 장애(서버 njs BFF 세그폴트)에 대한 결정 기록을 ADR-017에 반영합니다. 서버 측 코드/설정 변경은 `common-bible-server` `2f4cbac`(main)에 이미 반영됐고, 이 PR은 **앱 저장소의 ADR 문서 개정**입니다.

## 변경
- **개정 블록(2026-06-09)** 추가: njs 가드(M6)가 njs 0.8.2에서 세그폴트 → `/oauth/token` POST 전부 `ERR_CONNECTION_RESET`(access·error 로그 무기록, journald `signal 11`로만) → prod·dev 동기화 전면 중단. 단일 location 직접 proxy로 환원, `limit_req`(M5) 유지.
- 보안 영향 없음 명시: 중복 `client_secret`은 Google이 RFC 6749 §3.2 위반으로 거부 → 가드는 방어적 부가장치였음.
- 헤더 **개정** 라인 추가, 구현 노트에 `limit_req` 반영, "향후 고려"의 rate limiting 항목을 구현됨(M5)으로 갱신.

## 범위 메모
- 문서 전용 변경 (`node --test` 생략).
- `docs/status.md`·`architecture.md`의 BFF 서술은 단일 location 패턴 그대로라 정확 → 미변경.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation-only ADR update; no application or nginx config changes in this repository.
> 
> **Overview**
> **ADR-017**에 **2026-06-09 개정**을 추가해, prod/dev에서 Drive 동기화가 멈췄던 nginx BFF njs 가드(M6) 장애와 대응을 기록합니다.
> 
> 개정 블록은 **M5**(`limit_req`)와 **M6**(njs `js_content` body 가드, 2단 location)이 ADR 채택 뒤 추가됐으나 본문에 없었음을 밝히고, **njs 0.8.2 세그폴트**로 `/oauth/token` POST가 전부 끊겨 silent refresh·로그인이 실패했음을 설명합니다. **조치**는 M6·`@oauth_token_upstream` 제거 후 단일 `location = /oauth/token` 직접 proxy로 되돌리고 M5는 유지하는 것이며, 서버 반영은 `common-bible-server` `2f4cbac`로 가리킵니다. **보안 영향 없음**(M6는 방어적 부가)도 명시합니다.
> 
> 헤더에 개정 라인을 추가하고, 구현 노트 nginx 예시에 **`limit_req zone=oauth_token`**을 넣으며, **향후 고려**의 rate limiting 항목을 M5 구현 완료·M6 철회로 갱신합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 62629d1aa67bb76a1c7e21fe8ba65f74b5aec32d. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
