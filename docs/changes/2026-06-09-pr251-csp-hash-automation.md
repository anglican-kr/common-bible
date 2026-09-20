---
date: 2026-06-09
pr: 251
branch: chore/csp-hash-automation
title: "chore: CSP 인라인 해시 자동 검사 도구 + 죽은 script-src 해시 정리"
---

# chore: CSP 인라인 해시 자동 검사 도구 + 죽은 script-src 해시 정리

인라인 `<style>`/`<script>` 블록을 수정하고 CSP 해시 갱신을 **잊어서** 블록이 차단되는 문제(이번 `style-src` 해시 드리프트 사고)를 자동화로 막습니다.

## 추가
- **`tests/unit/csp.test.js`** (CI 안전망): index.html의 정적 인라인 `<style>`/`<script>` 블록 sha256이 CSP `style-src`/`script-src`에 모두 존재하는지 단언. 누락 시 빌드 실패 → 사람 기억 대신 CI가 잡음. (사고 당시였다면 실제로 실패했을 테스트)
- **`scripts/csp_hashes.py`**: `--check`(검사, 드리프트 시 exit 1) / `--fix`(블록에 맞게 자동 동기화). `'self'`·`'unsafe-hashes'`·도메인 등 비-sha256 토큰은 보존하고 sha256 토큰만 관리. HTML 주석 속 태그 글자는 무시.

## 정리 (도구가 찾아낸 것)
- `index.html` script-src에서 **죽은 해시 2개**(`H8ho…`·`MhtP…` — 과거 인라인 GA 스크립트용, 외부 파일 이전 후 잔재) + 더 이상 쓰이지 않는 `'unsafe-hashes'` 제거.
- `script-src 'self' 'sha256-H8ho…' 'unsafe-hashes' 'sha256-MhtP…' https://www.googletagmanager.com` → `script-src 'self' https://www.googletagmanager.com`
- 안전성: 현재 인라인 실행 `<script>`·이벤트 핸들러·`javascript:`·`setAttribute('on…')` 모두 0개(index.html + js/ 전수 확인) → 보안/기능 영향 없음, 오히려 CSP 축소.

## 범위/한계
- 정적 인라인 `<style>`/`<script>` 블록만. 인라인 이벤트 핸들러(`onclick=`)·`style=""` 속성은 다루지 않음(현재 미사용).

## 검증
- `node --test tests/unit/*.test.js` → **684/684** (신규 2 포함)
- `python3 scripts/csp_hashes.py --check` → 전부 OK, exit 0

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 현재 인라인 실행 스크립트가 없어 제거한 해시는 stale이며, CSP는 더 엄격해집니다. pre-paint 인라인 style 해시는 그대로 유지됩니다.
> 
> **Overview**
> 인라인 `<style>`/`<script>` 수정 후 CSP `sha256` 갱신을 빼먹어 브라우저가 블록을 막는 문제를 막기 위해 **자동 검사·동기화**와 **CI 단언**을 추가합니다.
> 
> **`scripts/csp_hashes.py`**는 `index.html`의 정적 인라인 블록 해시와 CSP `style-src`/`script-src`를 비교합니다(`--check`, 드리프트 시 exit 1). `--fix`로 sha256 토큰만 블록에 맞게 맞추고 `'self'`·도메인 등은 유지합니다. HTML 주석 안의 가짜 `<script>`/`style` 태그는 스캔에서 제외합니다.
> 
> **`tests/unit/csp.test.js`**는 동일 규칙으로 “필요한 해시가 CSP에 있는지”를 CI에서 검증합니다(잉여 해시만 있는 경우는 실패하지 않음).
> 
> **`index.html` CSP**에서는 더 이상 쓰이지 않는 `script-src` 인라인 GA용 **해시 2개**와 **`'unsafe-hashes'`**를 제거해 `script-src`를 `'self'`와 `googletagmanager.com`만 남기도록 **축소**합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 8c3327cf7acbebd1d8a7249e2ebca01ce6860b2e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
