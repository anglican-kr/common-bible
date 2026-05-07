# ADR-001: SPA 아키텍처 선택

- 일시: 2026-03-25
- 상태: 승인됨

## 결정

프론트엔드 중심 SPA(Single Page Application) 방식을 채택한다.
단일 `index.html`에서 JavaScript가 JSON 데이터를 읽어 화면을 렌더링한다.
Python은 데이터 전처리(파싱, JSON 분리)에만 사용하고, 런타임에는 관여하지 않는다.

## 맥락

기존에는 Python html_generator.py가 1,382개 HTML 파일을 생성하는 정적 빌드 방식을 설계했으나,
프로젝트의 장기 비전이 확정되면서 재검토가 필요했다.

장기 비전:
1. 공동번역성서 읽기
2. 성공회 기도서 콘텐츠
3. 성공회 교회력 자동 계산
4. 성무일과 본문 자동 생성

## 검토한 대안

### A. 기존 html_generator.py 수정
- 장점: 기존 코드 활용
- 단점: 962줄 미완성 코드의 복잡도, 교회력/성무일과의 동적 요구에 부적합

### B. HTML 생성기 새로 작성
- 장점: 깔끔한 재시작, 빠른 성능, SEO 유리
- 단점: 교회력/성무일과는 매일 바뀌므로 정적 생성 비현실적, UI 변경 시 전체 재빌드 필요

### C. 프론트엔드 중심 SPA (채택)
- 장점: 동적 콘텐츠 조합에 최적, UI 변경 시 재빌드 불필요, 여러 콘텐츠가 데이터를 공유 가능
- 단점: JS 필수, SEO 불리 → ADR-009에서 History API 전환 + 동적 메타태그로 해소

## 채택 이유

- 성무일과 = f(오늘 날짜, 교회력, 성경 본문, 기도문)으로, 본질적으로 동적 조합임
- 교회력은 매년 부활절 날짜에 따라 전체가 변동하므로 사전 생성이 비현실적
- 성경, 기도서, 교회력, 성무일과가 같은 데이터를 공유하므로 SPA에서 자연스럽게 조합 가능
- 초기에는 SEO보다 오프라인 사용성을 우선했으나, ADR-009에서 History API 전환으로 SEO 불이익을 해소

## 결과

- Python 빌드 파이프라인 대신 브라우저 런타임에서 JSON → DOM 렌더링
- parsed_bible.json을 장별 JSON으로 분리하여 필요 시 fetch
- 기존 html_generator.py, wordpress_api.py, pwa_builder.py는 더 이상 사용하지 않음
- 기존 parser.py, parsed_bible.json은 그대로 활용 (config.py는 이후 불필요해져 제거됨)

## 서비스 워커 캐시 전략

SPA 오프라인 지원은 `sw.js`의 서비스 워커가 담당한다. 리소스 유형에 따라 네 가지 캐시를 구분한다.

### 앱 셸 (Shell) — `SHELL_CACHE`

설치 시 `SHELL_FILES` 목록 전체를 `SHELL_CACHE`(예: `shell-49`)에 선점재 캐싱한다.
`{ cache: "reload" }` 옵션으로 브라우저 HTTP 캐시를 우회하여, 이전 릴리스의 장기 캐시 헤더가 새 SW 캐시를 오염시키는 것을 방지한다.

`books.json`과 `search-meta.json`도 코드와 강결합되어 있어 셸과 동기 갱신해야 하므로 `SHELL_CACHE`에 포함된다.

History API SPA 라우팅상 모든 navigation 요청(`/bible/gen/1` 등)은 캐시된 `/index.html`로 응답한다.

### 성경·검색 데이터 — `DATA_CACHE`

`/data/bible/*.json`과 `/data/search-{ot,nt,dc}.json`은 별도 `DATA_CACHE`(예: `data-1`)에 누적된다. **Cache-first** 전략으로 캐시에 있으면 즉시 반환하고, 없으면 네트워크에서 받아 저장한다.

초기에는 stale-while-revalidate를 적용했으나 다음 문제가 확인되어 cache-first로 전환했다:
- 백그라운드 재검증 요청이 대량 발생하여 불필요한 네트워크 트래픽을 유발
- 성경 데이터는 릴리스 단위로만 바뀌므로 매 방문마다 재검증할 이유가 없음

데이터 갱신은 재검증 대신 **`DATA_CACHE` rev bump**로 처리하되, 셸 변경과 독립적으로 운영한다. 셸만 갱신된 릴리스에서는 사용자가 이미 받은 본문 캐시가 보존되므로 1.3 GB 규모의 재다운로드가 발생하지 않는다.

### 오디오 — `AUDIO_CACHE`

`/data/audio/*.mp3`는 다시 별도 `AUDIO_CACHE`(예: `audio-1`)에 보관한다. 오디오는 사용자가 재생을 요청할 때만 다운로드되며, 텍스트 데이터와 다른 라이프사이클을 가지므로 분리해 인코딩 변경 시에만 독립적으로 bump한다.

### Google Fonts — `FONT_CACHE`

`fonts.gstatic.com` 파일은 콘텐츠 주소 기반의 불변 URL이므로 별도 `FONT_CACHE`에 저장한다.
다른 캐시 bump 시에도 삭제되지 않아 릴리스 간 폰트 재다운로드를 방지한다.

### 캐시 식별자 운영

`scripts/release.py`는 기본적으로 `version.json`과 `SHELL_CACHE` rev를 함께 올린다. `DATA_CACHE`/`AUDIO_CACHE`는 포맷이나 인코딩이 실제로 바뀐 릴리스에서만 `--bump-data`/`--bump-audio` 플래그로 명시적으로 올린다. activate 단계에서 활성 집합(`SHELL_CACHE`/`DATA_CACHE`/`AUDIO_CACHE`/`FONT_CACHE`)에 없는 캐시는 모두 삭제된다.

### 업데이트 흐름

새 SW가 설치되어도 기존 탭이 열려 있으면 자동으로 활성화되지 않는다.
앱이 사용자에게 업데이트 알림을 표시하고, 사용자가 확인하면 `SKIP_WAITING` 메시지를 SW로 전송하여 전환한다.

> **개정 (2026-05-07):** 단일 `CACHE_NAME`이 셸·본문·오디오를 한 묶음으로 관리하던 방식을 `SHELL_CACHE`/`DATA_CACHE`/`AUDIO_CACHE` 3개로 분리. 셸 릴리스마다 사용자의 누적된 본문·오디오 캐시가 통째로 비워지던 문제를 해소했다.
