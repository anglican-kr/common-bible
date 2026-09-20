---
date: 2026-04-25
pr: 7
branch: claude/spa-seo-optimization-InZ35
title: "feat: 해시 라우팅 → History API 전환 및 SEO 개선"
---

# feat: 해시 라우팅 → History API 전환 및 SEO 개선

- js/app.js: parseHash() → parsePath() (location.pathname 기반)
- js/app.js: navigate() 헬퍼 추가, hashchange → popstate 전환
- js/app.js: 모든 href="#/..." → href="/...", 내부 링크 클릭 인터셉트 핸들러
- js/app.js: updatePageMeta() 추가 — 라우트별 동적 title/description/canonical
- sw.js: navigation 요청 fallback → /index.html (오프라인 PWA 대응)
- manifest.webmanifest: start_url "/#/" → "/"
- sitemap.xml: 루트 1개 → 73권 × 전 장 1,403개 URL 전체 수록

https://claude.ai/code/session_01V8QYRCZB4Bvy6PfV3Z4W5f

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Routing is switched from hash URLs to History API paths across the app, which can break deep links/refreshes without correct server `index.html` fallback and may impact navigation edge cases (back/forward, search auto-navigation). SEO-related output changes (dynamic meta, expanded sitemap) also need verification in production crawlers.
> 
> **Overview**
> **Switches SPA routing from hash fragments to History API paths** (e.g. `#/gen/1` → `/gen/1`). `js/app.js` replaces `parseHash()` with `parsePath()`, adds `navigate()` (`pushState` + `route()`), swaps `hashchange` for `popstate`, and intercepts internal `<a href="/...">` clicks while preserving modifier-key/new-tab behavior; legacy `#/...` URLs are auto-converted via `replaceState` on load.
> 
> **Improves SEO for route-level pages** by adding `updatePageMeta()` to dynamically set `<title>`, description, Open Graph fields, and canonical URL per view (books/division/book/chapter/prologue/search), and updates analytics `page_path` tracking to use `pathname + search`.
> 
> **Updates PWA/SEO artifacts for path-based routing**: `sw.js` adds a navigation-mode fetch handler that serves cached `/index.html` (offline deep-link support) and bumps `CACHE_NAME`; `manifest.webmanifest` `start_url` becomes `/`; `sitemap.xml` expands from the root only to include all book/chapter/prologue URLs (~1,403). Documentation adds ADR-009 and updates ADR-001/worklog; `version.json` bumps to `1.0.30`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit d25b8da612e9d5b6bbe16618ed4e7da444a9f55e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
