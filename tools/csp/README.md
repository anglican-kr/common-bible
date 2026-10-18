# tools/csp — CSP 위반 점검

앱의 콘텐츠 보안 정책(CSP)은 `index.html`의 `<meta>`로만 준다(서버 헤더 없음 — `docs/architecture.md` 「보안 모델」). meta로 준 CSP는 위반을 서버로 보고하는 지시어(`report-uri` · `report-to`)를 쓸 수 없어, 사용자 브라우저에서 생긴 위반은 알 길이 없다. 그래서 **릴리스 전에** 이 도구로 한 번 돈다. 주요 화면 · 기능(성서 목록 · 장 · 오디오 · 인용 시트 · 검색 워커 · 캘린더 · 전례독서 · 북마크 · 모아 읽기 · 설정 · 실패 화면, 데스크톱과 휴대폰)을 실제 브라우저로 돌고 마지막에 페이지를 떠나며, 콘솔의 CSP 메시지를 지시어 · 막힌 주소별로 묶어 보고한다. 외부 요청(구글 폰트 · 구글 태그)은 막지 않는다 — 구글이 보내는 주소를 바꾸면 여기서 `connect-src` 위반으로 드러난다.

```bash
python3 scripts/serve.py 8080                      # 저장소 루트에서, 별도 터미널
python3 -I tools/csp/csp_sweep.py                  # Chromium · 서비스 워커 막음
python3 -I tools/csp/csp_sweep.py --sw             # 서비스 워커를 켜고(등록 · worker-src)
```

종료 코드는 `0` 위반 없음 · `1` 위반 있음 · `2` 위반은 없지만 돌지 못한 단계가 있음(셀렉터가 바뀌었거나 데이터가 없다 — 점검 범위가 덜 찼다)이다. 그 환경에 없는 컨트롤(mp3를 못 트는 브라우저의 오디오 바)은 「건너뛴 단계」로 따로 적는다.

WebKit으로도 돌릴 수 있다(`--browser webkit`). 이 클론의 호스트에는 Playwright WebKit이 쓰는 라이브러리가 없어 그대로는 뜨지 않는다 — 띄우는 법은 `docs/coding-pitfalls.md` §34.

**위반이 나오면** 먼저 그것이 앱이 하는 일인지(같은 출처의 스크립트 · 스타일 · 요청), 외부 서비스가 바꾼 것인지 가린다. 외부 서비스라면 그 서비스의 공식 CSP 안내(구글 태그는 [Google 태그 CSP 안내](https://developers.google.com/tag-platform/security/guides/csp))를 확인하되, 와일드카드를 그대로 받지 말고 실제로 나가는 주소만 적는다 — 예: 2026-10-18 애널리틱스가 페이지를 떠날 때 `https://www.google.com/g/collect`로 보내는 요청이 막혀 있었는데, 안내는 `https://*.google.com`을 권했지만 나가는 곳은 `www.google.com` 하나였다(원장 `docs/changes/2026-10-18-csp-google-collect.md`). 인라인 `<style>`을 고쳤으면 해시는 `scripts/csp_hashes.py --fix`가 맞추고 `tests/unit/csp.test.js`가 지킨다.
