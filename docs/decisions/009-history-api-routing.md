# ADR-009: History API 라우팅 전환 및 SEO 개선

- 일시: 2026-04-24
- 상태: 승인됨

## 결정

해시 기반 라우팅(`#/gen/1`)을 History API 기반 경로 라우팅(`/gen/1`)으로 전환한다.
아울러 라우트별 동적 메타태그, 전 장 sitemap, 서비스 워커 navigation fallback을 함께 적용한다.

## 맥락

ADR-001에서 SPA를 채택할 때 "SEO 불리 — PWA이므로 수용 가능"으로 결론 내렸다.
그러나 Phase 1(성경 읽기 PWA) 완성 후 검색엔진 유입이 실질적 관심사가 됐고,
세 가지 한계가 명확해졌다.

1. **해시 fragment는 서버에 전달되지 않는다.** Googlebot이 JavaScript를 실행하여
   `#/gen/1`을 크롤하긴 하지만 동작이 불안정하고 크롤 예산 소모가 크다.
2. **sitemap이 루트 1개뿐이다.** 1,328개 장 URL이 색인되지 않는다.
3. **`<title>`·`<meta description>`이 고정이다.** 모든 페이지가 동일한 타이틀로
   색인되어 검색 스니펫이 의미 없다.

## 검토한 대안

### A. 해시 라우팅 유지 + sitemap에 해시 URL 추가
- 장점: 서버 변경 없음
- 단점: Googlebot의 해시 URL 처리가 불안정. 근본 해결이 아님

### B. 서버 사이드 프리렌더링(SSR/SSG)
- 장점: SEO 최상, 첫 로드 HTML에 본문 포함
- 단점: Vanilla JS SPA 구조를 전면 재설계해야 함. 1,328개 장 × 빌드 비용. ADR-001 결정과 충돌

### C. History API 라우팅 전환 (채택)
- 장점: 서버 설정 한 줄(`try_files $uri /index.html`)로 해결. SEO·PWA 오프라인 모두 충족.
  기존 SPA 구조 유지
- 단점: 서버 설정 필수. 기존 해시 북마크 URL 호환 처리 필요

## 채택 이유

- 서버 제어권이 있고 nginx 설정 변경이 가능하므로 C안의 유일한 전제조건이 충족됨
- 구조 변경 없이 `parseHash()` → `parsePath()`, `hashchange` → `popstate`,
  `location.hash` → `history.pushState`의 국소적 수정으로 전환 완료
- 기존 해시 URL(`#/gen/1`) 북마크는 `DOMContentLoaded` 시점에 `replaceState`로
  자동 리다이렉트하여 하위 호환성 확보

## 변경 내용

### js/app.js
- `parseHash()` → `parsePath()`: `location.pathname + location.search` 기반으로 재작성
- `navigate(path)` 헬퍼: `history.pushState` + `route()` 조합
- `hashchange` → `popstate` 이벤트 리스너 전환
- 전역 클릭 인터셉터: 내부 링크 `<a href="/...">` 클릭을 `navigate()`로 처리
  (modifier key — Cmd/Ctrl/Shift — 및 비기본 마우스 버튼은 브라우저 기본 동작 유지)
- `updatePageMeta()`: 라우트별 `<title>`, `<meta name="description">`,
  `og:title`, `og:description`, `og:url`, `<link rel="canonical">` 동적 갱신
- 레거시 해시 URL 호환: `DOMContentLoaded`에서 `#/path` → `/path` `replaceState`

### sw.js
- navigation 요청(`event.request.mode === "navigate"`) 전용 핸들러 추가:
  캐시에서 `/index.html`을 즉시 반환하여 오프라인 상태에서도 임의 경로 접근 가능
- 캐시 미스 시 `fetch("/index.html")`로 명시 (원래 요청 URL 대신)

### manifest.webmanifest
- `start_url`: `"/#/"` → `"/"`

### sitemap.xml
- 루트 1개 → 73권 × 전 장 + 머리말 = 1,403개 URL

## 배포 시 요구사항

nginx(또는 동등 웹 서버)에 SPA fallback 설정 필수:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

이 설정 없이 앱을 배포하면 직접 URL 접근(`/gen/1`) 및 새로고침이 404를 반환한다.
**nginx 설정 변경을 앱 배포보다 먼저 적용해야 한다.**

## 결과

- 각 장·책·구분(구약/신약/외경) URL이 독립 페이지로 검색엔진에 색인됨
- 검색 결과 스니펫에 "창세기 1장 — 공동번역성서" 등 구체적 타이틀 노출
- PWA 오프라인 동작 유지 (서비스 워커 navigation fallback)
- 기존 해시 URL 공유 링크·북마크 자동 호환

> **개정 (2026-05-23):** sitemap 신호 보강 + 빌드 스크립트화
>
> Google Search Console 점검 결과, 사이트맵은 "성공"으로 파싱되지만 1,404개 URL 중
> 한 개도 색인 큐에 들어가지 않은 상태였다. 옛 URL 형식(`/genesis-N.html`, 4개)만
> 옛 크롤 기록으로 남아 "크롤링됨 - 색인 안 됨"으로 분류돼 있었다.
>
> 원인은 sitemap 각 `<url>` 항목에 `<lastmod>`가 없어 Google이 재크롤 우선순위를
> 매기지 못한 것. 수동 작성된 sitemap.xml을 스크립트로 대체했다.
>
> - `scripts/build_sitemap.py` 신설 — `data/books.json` + 데이터 서브모듈의
>   마지막 커밋 시각을 출처로 sitemap.xml 생성. 모든 URL에 동일한 `<lastmod>`
>   부여(데이터 서브모듈 commit time). 데이터가 갱신될 때마다 sitemap 전체가
>   새 신호를 받게 됨
> - `scripts/release.py` 통합 — 매 릴리스마다 build_sitemap 호출 +
>   stage_and_commit 대상에 `sitemap.xml` 포함
> - URL 카운트 정정: ADR 본문 "1,403개 URL" → 실제 1,404개
>   (root + privacy.html + 73 book-index + 1,328 chapter + 집회서 prologue)
>
> 후속: GSC URL 검사로 핵심 URL 5~10개 수동 시드, 재크롤 추이 관찰.
> SPA shell 본문 렌더링 문제(`/gen/1` 등 모든 라우트가 동일 HTML 반환)는
> prerender/SSG 도입 여부와 함께 별도 결정 사항으로 남김.
