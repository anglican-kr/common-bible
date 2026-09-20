---
date: 2026-06-20
pr: 291
branch: chore/add-security-audit-command
title: "chore: 보안 감사 슬래시 명령 추가"
---

# chore: 보안 감사 슬래시 명령 추가

## 변경 내용

- **`.claude/commands/security-audit.md`** — 프로젝트 전용 보안 감사 슬래시 명령(`/security-audit`)을 저장소로 가져옴. 현재 브랜치 변경분(또는 지정한 파일/범위)을 대상으로 XSS·OAuth·CSP·Service Worker·정보 노출 등 10개 항목을 점검하고, 결과를 `docs/audit/YYYY-MM-DD-hhmmss.md` 로 저장. 기존 `docs/archive/audit/` 보안 감사 관례와 맞물림.
- **`.gitignore`** — 공유 명령(`.claude/commands/`)은 추적하되, 개인·로컬 전용 `.claude/settings.local.json` 은 제외하는 한 줄 추가.

## 비고

- 비밀값 없음(일반 감사 체크리스트). Client ID 등은 공개 허용 대상.
- 그동안 개인 설정 홈(`claude-home/commands/`)에만 있던 명령을 저장소로 옮겨, clone 하는 누구나 동일 감사 명령을 쓸 수 있게 함.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation and developer-tooling only; no runtime, auth, or deployment behavior changes.
> 
> **Overview**
> Adds a **repository-shared Claude Code command** at `.claude/commands/security-audit.md` so anyone who clones the repo can run `/security-audit` against the current branch diff (or a given path) using a project-specific checklist (XSS, Google OAuth/GIS, CSP, Service Worker, secrets exposure, and related items), with a fixed report template and writes under **`docs/archive/audit/`**.
> 
> Updates **`.gitignore`** to keep tracking shared `.claude/commands/` while ignoring **`.claude/settings.local.json`** so local Claude settings are not committed.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit a2e4274e432609424f056650a14d5477fbfd8b16. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
