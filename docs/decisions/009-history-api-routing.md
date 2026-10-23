# ADR-009: History API 라우팅 전환 및 SEO 개선

- 일시: 2026-04-24
- 상태: 승인됨

## 결정

해시 기반 라우팅(`#/gen/1`)을 History API 기반 경로 라우팅(`/gen/1`)으로 바꾼다. 아울러 라우트별 동적 메타태그, 모든 장을 담은 sitemap, 서비스 워커의 navigation fallback을 함께 적용한다.

sitemap은 스크립트가 만들고, 장마다 실제로 바뀐 때를 `<lastmod>`로 적는다(2026-05-23, 아래 「sitemap」).

## 맥락

ADR-001에서 SPA를 채택할 때 "SEO 불리 — PWA이므로 수용 가능"이라고 결론 내렸다. 그러나 Phase 1(성경 읽기 PWA)을 완성한 뒤 검색엔진으로 들어오는 사용자가 실제 관심사가 됐고, 세 한계가 분명해졌다.

1. **해시 fragment는 서버로 가지 않는다.** Googlebot이 JavaScript를 실행해 `#/gen/1`을 크롤하기는 하지만, 동작이 불안정하고 크롤 예산을 많이 쓴다.
2. **sitemap에 루트 1개뿐이다.** 1,328개 장 URL이 색인되지 않는다.
3. **`<title>`과 `<meta description>`이 고정이다.** 모든 페이지가 같은 타이틀로 색인되어 검색 스니펫이 쓸모가 없다.

## 검토한 대안

### A. 해시 라우팅 유지 + sitemap에 해시 URL 추가
- 장점: 서버를 바꾸지 않는다.
- 단점: Googlebot의 해시 URL 처리가 불안정하다. 근본 해결이 아니다.

### B. 서버 사이드 프리렌더링(SSR/SSG)
- 장점: SEO가 가장 좋고, 첫 HTML에 본문이 들어 있다.
- 단점: Vanilla JS SPA 구조를 처음부터 다시 설계해야 한다. 1,328개 장 × 빌드 비용이 든다. ADR-001의 결정과 부딪친다.

### C. History API 라우팅 전환 (채택)
- 장점: 서버 설정 한 줄(`try_files $uri /index.html`)로 해결된다. SEO와 PWA 오프라인을 모두 만족한다. 기존 SPA 구조를 그대로 둔다.
- 단점: 서버 설정이 꼭 필요하다. 기존 해시 북마크 URL과의 호환을 처리해야 한다.

### sitemap의 모든 URL에 같은 `<lastmod>` (2026-05-23 1차)
- 데이터 서브모듈의 마지막 커밋 시각을 모든 URL의 `<lastmod>`로 달았다.
- 채택 안 함 2026-05-23(2차) · 이유: 본문 한 장만 고쳐도 1,404개가 모두 바뀐 것처럼 신호가 나간다. Google은 신호가 일관된지를 보고 신뢰도를 배운다고 보고, 실제로 내용이 바뀐 페이지만 `<lastmod>`가 바뀌게 했다.

## 채택 이유

- 서버를 직접 관리하고 nginx 설정을 바꿀 수 있으므로, C안의 유일한 전제 조건을 만족한다.
- 구조를 바꾸지 않고 `parseHash()` → `parsePath()`, `hashchange` → `popstate`, `location.hash` → `history.pushState`의 국소적 수정으로 전환을 마쳤다.
- 기존 해시 URL(`#/gen/1`) 북마크는 `DOMContentLoaded` 시점에 `replaceState`로 저절로 옮겨, 하위 호환성을 지킨다.

## 변경 내용

### js/app.js
- `parseHash()` → `parsePath()`: `location.pathname + location.search`를 바탕으로 다시 썼다.
- `navigate(path)` 도우미: `history.pushState`와 `route()`를 함께 부른다.
- `hashchange` → `popstate` 이벤트 리스너로 바꿨다.
- 전역 클릭 가로채기: 내부 링크 `<a href="/...">`를 누르면 `navigate()`로 처리한다(modifier key — Cmd/Ctrl/Shift — 와 기본이 아닌 마우스 버튼은 브라우저 기본 동작을 둔다).
- `updatePageMeta()`: 라우트마다 `<title>`, `<meta name="description">`, `og:title`, `og:description`, `og:url`, `<link rel="canonical">`을 동적으로 갱신한다.
- 옛 해시 URL 호환: `DOMContentLoaded`에서 `#/path`를 `/path`로 `replaceState`한다.

### sw.js
- navigation 요청(`event.request.mode === "navigate"`)만 다루는 핸들러를 더했다. 캐시에서 `/index.html`을 바로 돌려줘, 오프라인에서도 아무 경로나 열 수 있다.
- 캐시에 없으면 원래 요청 URL 대신 `fetch("/index.html")`로 받는다.

### manifest.webmanifest
- `start_url`: `"/#/"` → `"/"`

### sitemap.xml

처음에는 루트 1개에서 73권 × 모든 장 + 머리말 = 1,403개 URL로 늘렸다. 실제는 1,404개다(root + privacy.html + 73 book-index + 1,328 chapter + 집회서 prologue). 2026-05-23에 숫자를 바로잡았다.

2026-05-23에 손으로 쓰던 sitemap.xml을 스크립트로 바꿨다. Google Search Console을 점검하니, 사이트맵은 「성공」으로 파싱되는데 1,404개 URL 가운데 하나도 색인 대기열에 들어가지 않았다. 옛 URL 형식(`/genesis-N.html`, 4개)만 옛 크롤 기록으로 남아 「크롤링됨 - 색인 안 됨」으로 분류돼 있었다. 원인은 sitemap의 `<url>` 항목마다 `<lastmod>`가 없어, Google이 다시 크롤할 우선순위를 매기지 못한 것이다.

- `scripts/build_sitemap.py`를 새로 만들었다. `data/books.json`과 데이터 서브모듈의 커밋 기록을 출처로 sitemap.xml을 만든다.
- `scripts/release.py`에 넣었다. 릴리스마다 build_sitemap을 부르고, stage_and_commit 대상에 `sitemap.xml`을 넣는다.
- `<lastmod>`는 장 단위로 정한다(2026-05-23 2차). 출처는 다음과 같다.
  - `/{book}/{chapter}` → `data/bible/{book}-{chapter}.json`의 git 마지막 커밋
  - `/{book}/prologue` → `data/bible/{book}-prologue.json`의 git 마지막 커밋
  - `/{book}` → 그 책에 딸린 장들의 lastmod 가운데 가장 늦은 것
  - `/privacy.html` → 앱 저장소의 `privacy.html` 마지막 커밋
  - `/` → 전체 sitemap에서 가장 늦은 lastmod
- 전제: 데이터 빌드 파이프라인은 같은 원본이면 같은 출력을 내야 한다(deterministic). `common-bible-data`의 최근 빌드 커밋을 확인해 보니, 원본이 바뀐 만큼의 `bible/*.json`만 실제 커밋으로 남는다. 가정이 맞는다.
- 효율: 데이터 서브모듈에서 `git log --name-only --diff-filter=ACMR -- bible/`를 한 번 불러 전체 기록을 읽고, 파일마다 마지막 커밋 시각을 정한다. 1,328개 파일 × 1 subprocess가 아니라 1 subprocess로 끝난다.
- 효과: 1,404개 URL이 저절로 몇 개의 lastmod 무리로 나뉜다. 바뀌지 않은 페이지의 lastmod는 그대로 유지되어, Google의 크롤 예산이 실제로 바뀐 페이지에 모인다.
- 후속: GSC URL 검사로 핵심 URL 5-10개를 손으로 시드하고 다시 크롤되는 추이를 보려 했다. 이 후속은 하지 않기로 했다(사용자 결정 2026-10-22). SPA 셸의 본문 렌더링 문제(`/gen/1` 등 모든 라우트가 같은 HTML을 돌려준다)는 prerender나 SSG 도입 여부와 함께 따로 정할 일로 남긴다.

## 배포할 때 필요한 것

nginx(또는 같은 일을 하는 웹 서버)에 SPA fallback 설정이 꼭 있어야 한다.

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

이 설정 없이 앱을 배포하면, URL로 바로 들어오거나(`/gen/1`) 새로 고칠 때 404가 난다. **nginx 설정을 앱 배포보다 먼저 적용해야 한다.**

## 결과

- 장, 책, 구분(구약, 신약, 외경)의 URL이 각각 독립 페이지로 검색엔진에 색인된다.
- 검색 결과 스니펫에 "창세기 1장 — 공동번역성서" 같은 구체적인 타이틀이 보인다.
- PWA 오프라인 동작을 그대로 지킨다(서비스 워커 navigation fallback).
- 기존 해시 URL로 된 공유 링크와 북마크가 저절로 호환된다.
