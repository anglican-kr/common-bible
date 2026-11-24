"""E2E: the e2e suite itself does not talk to Google Analytics (known-issues §61).

`conftest.py` cuts every browser the suite launches off from the Google tag and the addresses the tag reports to
(「구글 애널리틱스로 가는 요청을 막는다」). These tests keep that guard in place:
  - the guarded addresses cover every Google address the CSP in index.html allows for the tag, wildcards included
  - Chromium cannot resolve those addresses, so a request fails before it leaves the browser
  - the same holds on a machine whose environment sets a proxy: those addresses bypass the proxy
  - the app's own screens never get an answer from them (first screen, reload, in-app navigation), and the app
      keeps queueing its page views without the tag
  - `guard_analytics` (the stand-in other browsers use) answers in place of Google, and a route a test adds
      later wins over it
"""

import fnmatch
import re
import socketserver
import sys
import threading
import urllib.request

import pytest

from .conftest import (
    ANALYTICS_GUARD_HEADER,
    ANALYTICS_HOSTS,
    ANALYTICS_TAG_URL,
    BASE_URL,
    CLEAR_APP_STORAGE,
    analytics_launch_args,
    guard_analytics,
    is_analytics_url,
    wait_app_ready,
)

# CSP가 허용한 바깥 주소 가운데 애널리틱스가 아닌 것. 드라이브 동기화와 로그인(OAuth), 그리고 글꼴이 쓴다.
NOT_ANALYTICS = {
    "oauth2.googleapis.com", "www.googleapis.com", "content.googleapis.com",
    "fonts.googleapis.com", "fonts.gstatic.com",
}

# 구글 태그가 요청을 보내는 것이 확인된 주소(원장 `docs/changes/2026-11-24-csp-google-signals.md`)와 태그 스크립트의 주소.
# 측정 ID도 방문 내용도 싣지 않아, 장치가 없어져 구글까지 가더라도 기록되지 않는다.
PROBES = [f"https://{host}/e2e-guard-check" for host in (
    "www.googletagmanager.com", "www.google-analytics.com", "region1.google-analytics.com", "analytics.google.com",
    "stats.g.doubleclick.net", "www.google.com", "www.google.co.kr",
)]

FETCH = "(url) => fetch(url, { mode: 'no-cors' }).then(() => 'answered', () => 'failed')"
PAGE_VIEWS = "() => (window.dataLayer || []).filter((a) => a[0] === 'event' && a[1] === 'page_view').length"


def _csp_hosts():
    """`index.html`의 CSP가 허용한 바깥 주소(호스트 표기). 지시문을 가리지 않고 모두 읽는다. 태그가 쓰는 주소는 어느 지시문에나
    더해질 수 있다(구글 시그널의 `frame-src` 등). 경로와 포트는 떼고 호스트만 남긴다. 스킴 없이 적은 주소(`www.google.com`)도
    읽는다. 따옴표로 묶은 낱말(`'self'`)과 스킴만 적은 것(`data:`)은 주소가 아니다. 환경 변수의 프록시는 쓰지 않는다.
    로컬 서버는 프록시 너머에 없다."""
    direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with direct.open(f"{BASE_URL}/index.html") as res:
        html = res.read().decode("utf-8")
    policy = re.search(r'http-equiv="Content-Security-Policy"\s+content="([^"]+)"', html).group(1)
    hosts = set()
    for directive in policy.split(";"):
        if not directive.strip():
            continue
        _name, *sources = directive.split()
        for source in sources:
            if source.startswith("'") or source.endswith(":"):
                continue
            _scheme, sep, rest = source.partition("://")
            hosts.add((rest if sep else source).split("/", 1)[0].split(":", 1)[0])
    return hosts


def test_guard_covers_every_analytics_address_the_csp_allows():
    """CSP가 구글 태그와 그 요청에 허용한 주소는 모두 막는 목록(`ANALYTICS_HOSTS`)이 덮는다. CSP에 주소를 더하고 목록에 더하지 않으면
    그 주소로 가는 요청이 구글에 간다(2026-11-24에 구글 시그널의 주소 셋이 CSP에 더해졌다). CSP의 와일드카드(`*.google.com`)는
    아무 하위 도메인이나 허용하므로, 목록도 `www`만이 아니라 아무 하위 도메인이나 덮어야 한다."""
    hosts = _csp_hosts()
    assert NOT_ANALYTICS <= hosts, hosts   # CSP를 제대로 읽었는가
    analytics = hosts - NOT_ANALYTICS
    assert len(analytics) >= 7, analytics
    for host in sorted(analytics):
        samples = [host.replace("*.", f"{label}.", 1) for label in ("www", "e2e-any-subdomain")] if host.startswith("*.") else [host]
        for sample in samples:
            assert any(fnmatch.fnmatchcase(sample, pattern) for pattern in ANALYTICS_HOSTS), f"막는 목록이 덮지 않는다: {host}({sample})"
            assert is_analytics_url(f"https://{sample}/g/collect"), sample
    for host in NOT_ANALYTICS:
        assert not is_analytics_url(f"https://{host}/"), f"애널리틱스가 아닌 주소를 막는다: {host}"


@pytest.mark.only_browser("chromium")
@pytest.mark.parametrize("url", PROBES)
def test_request_to_an_analytics_address_fails_before_leaving_the_browser(browser, url):
    """Chromium은 막는 주소의 이름을 풀지 못한다. 아무 `route`도 없는 컨텍스트에서 보낸 요청이 대답 없이 바로 실패한다.
    서비스 워커가 보내는 요청도 같은 이름 풀이를 거친다. 워커가 화면을 넘겨받은 경우는 여기서 보지 못한다. 기본 설정의 로컬 서버에서는
    워커가 설치를 끝내지 못한다(known-issues §80)."""
    ctx = browser.new_context()
    page = ctx.new_page()
    try:
        failures, answers = [], []
        page.on("requestfailed", lambda req: failures.append((req.url, req.failure)))
        page.on("response", lambda res: answers.append(res.url))
        page.goto("about:blank")
        assert page.evaluate(FETCH, url) == "failed"
        assert failures == [(url, "net::ERR_NAME_NOT_RESOLVED")]
        assert answers == []
    finally:
        ctx.close()


class _RefusingProxy(socketserver.ThreadingTCPServer):
    """받은 요청의 첫 줄만 적고 거절하는 프록시. 아무것도 바깥으로 보내지 않는다."""
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self):
        self.asked = []
        proxy = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                line = self.rfile.readline().decode("latin-1").strip()
                if line:
                    proxy.asked.append(line)
                self.wfile.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")

        super().__init__(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.serve_forever, daemon=True).start()


@pytest.mark.only_browser("chromium")
def test_analytics_addresses_bypass_a_proxy_set_in_the_environment(browser_type, browser_type_launch_args):
    """환경 변수로 프록시를 정한 기기에서도 막는 주소로 가는 요청은 프록시에 가지 않고 이름 풀이에서 실패한다. 프록시를 거치면 프록시가
    이름을 풀어 규칙이 적용되지 않으므로, 이 주소들은 프록시를 거치지 않게 해 두었다(`analytics_launch_args`의 `no_proxy`).
    이 묶음을 띄우는 인자 그대로, 환경 변수에 프록시만 더해 브라우저를 하나 더 띄워 본다. 띄우는 인자로 프록시를 정한 경우(`proxy`)도
    같은지 한 번 더 띄워 본다. Chromium이 환경 변수의 프록시를 읽는 것은 리눅스에서뿐이라, 환경 변수의 경우는 리눅스에서만 본다."""
    def launch_args_with(address, how):
        if how == "env":
            names = ("http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY")
            return {**browser_type_launch_args, "env": {**browser_type_launch_args["env"], **{name: address for name in names}}}
        return analytics_launch_args({**browser_type_launch_args, "proxy": {"server": address}}, browser_type_launch_args["env"])

    for how in (*(["env"] if sys.platform.startswith("linux") else []), "launch-option"):
        proxy = _RefusingProxy()
        proxied = None
        try:
            proxied = browser_type.launch(**launch_args_with(f"http://127.0.0.1:{proxy.server_address[1]}", how))
            page = proxied.new_context().new_page()
            failures = []
            page.on("requestfailed", lambda req: failures.append((req.url, req.failure)))
            page.goto("about:blank")
            control = "https://e2e-proxy-control.invalid/"   # 막는 주소가 아닌 곳은 프록시로 간다. 프록시가 실제로 쓰이는지 본다
            for url in [*PROBES, control]:
                assert page.evaluate(FETCH, url) == "failed", (how, url)
            assert failures == [*((url, "net::ERR_NAME_NOT_RESOLVED") for url in PROBES), (control, "net::ERR_TUNNEL_CONNECTION_FAILED")], how
            # 브라우저가 스스로 보내는 요청이 프록시에 섞여 올 수 있어, 목록 전체를 견주지 않는다.
            assert "CONNECT e2e-proxy-control.invalid:443 HTTP/1.1" in proxy.asked, (how, proxy.asked)
            through_proxy = [line for line in proxy.asked
                             if len(line.split()) > 1 and is_analytics_url("https://" + line.split()[1].split("://")[-1])]
            assert through_proxy == [], (how, through_proxy)
        finally:
            if proxied:
                proxied.close()
            proxy.shutdown()
            proxy.server_close()


@pytest.mark.only_browser("chromium")
def test_app_screens_get_no_answer_from_analytics_and_keep_queueing_page_views(browser):
    """앱 화면은 구글 태그를 받지 못하고, 태그의 주소에서는 아무 대답도 오지 않는다. 처음 연 화면, 새로 고친 화면, 앱 안에서 옮긴 화면이
    모두 그렇다. 태그가 없어도 앱은 방문 기록을 대기열(`dataLayer`)에 쌓는다. 서비스 워커는 막는다. 워커가 화면을 넘겨받으면 앱이
    스스로 화면을 새로 고쳐 요청의 수가 달라진다(서버를 `--cache`로 띄웠을 때)."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    page = ctx.new_page()
    try:
        answers, failed_tags = [], []
        ctx.on("response", lambda res: answers.append(res.url) if is_analytics_url(res.url) else None)
        ctx.on("requestfailed", lambda req: failed_tags.append(req.failure) if ANALYTICS_TAG_URL.match(req.url) else None)

        def wait_failed_tags(count):   # 실패 알림은 화면이 준비된 뒤에 올 수도 있다
            for _ in range(50):
                if len(failed_tags) >= count:
                    break
                page.wait_for_timeout(100)

        page.goto(f"{BASE_URL}/")
        wait_app_ready(page)
        page.wait_for_function(f"() => ({PAGE_VIEWS})() >= 1")
        wait_failed_tags(1)
        assert failed_tags == ["net::ERR_NAME_NOT_RESOLVED"]   # 화면이 태그를 청했고, 이름 풀이에서 실패했다

        page.reload()
        wait_app_ready(page)
        page.wait_for_function(f"() => ({PAGE_VIEWS})() >= 1")
        wait_failed_tags(2)
        assert failed_tags == ["net::ERR_NAME_NOT_RESOLVED"] * 2

        page.evaluate("() => window.navigate('/john/3')")
        page.wait_for_selector("article.chapter-text .verse")
        page.wait_for_function(f"() => ({PAGE_VIEWS})() >= 2")
        assert answers == []
    finally:
        ctx.close()


def test_guard_answers_in_place_of_analytics_and_yields_to_a_later_route(browser):
    """`guard_analytics`는 태그 스크립트에 빈 스크립트를, 태그가 요청을 보내는 주소에 빈 성공 응답(204)을 대신 준다. Chromium이 아닌
    브라우저는 컨텍스트마다 이것으로 요청이 구글에 가지 않게 한다(`conftest.py`의 `browser`). 시험이 나중에 등록한 `route`는 이것보다
    먼저 적용된다. 방문 기록을 세는 시험이 흉내 낸 태그를 그렇게 싣는다. 서비스 워커는 막아 요청이 `route`에 잡히게 한다."""
    ctx = browser.new_context(service_workers="block")
    ctx.add_init_script(CLEAR_APP_STORAGE)
    guard_analytics(ctx)
    page = ctx.new_page()
    try:
        answers = {}
        ctx.on("response", lambda res: answers.update({res.url: res}) if is_analytics_url(res.url) else None)

        page.goto(f"{BASE_URL}/")
        wait_app_ready(page)
        page.wait_for_function(f"() => ({PAGE_VIEWS})() >= 1")
        (tag_url,) = answers   # 화면이 보낸 것은 태그 요청 하나다. 빈 스크립트라 그 뒤의 수집 요청이 없다
        assert ANALYTICS_TAG_URL.match(tag_url)
        assert (answers[tag_url].status, answers[tag_url].headers.get(ANALYTICS_GUARD_HEADER), answers[tag_url].text()) == (200, "1", "")

        # 진짜 태그가 쓰는 세 가지 방법(fetch, sendBeacon, 이미지)으로 보낸다. 주소는 CSP가 그 방법에 허용한 것이다.
        collect = "https://www.google-analytics.com/g/collect?e2e-guard-check"
        beacon = "https://analytics.google.com/g/collect?e2e-guard-check"
        image = "https://www.google.co.kr/ads/ga-audiences?e2e-guard-check"
        assert page.evaluate("(url) => fetch(url, { method: 'POST', mode: 'no-cors', body: 'x' }).then(() => 'answered', () => 'failed')",
                             collect) == "answered"
        assert page.evaluate("(url) => navigator.sendBeacon(url, 'x')", beacon) is True
        page.evaluate("(url) => new Promise((done) => { const i = new Image(); i.onload = i.onerror = done; i.src = url; })", image)
        for url in (collect, beacon, image):
            for _ in range(50):   # sendBeacon의 대답은 뒤늦게 온다
                if url in answers:
                    break
                page.wait_for_timeout(100)
            assert url in answers, f"대답이 없다: {url}"
            assert (answers[url].status, answers[url].headers.get(ANALYTICS_GUARD_HEADER)) == (204, "1"), url

        ctx.route(ANALYTICS_TAG_URL, lambda route: route.fulfill(
            status=200, content_type="text/javascript", body="window.__ownTag = true;"))
        page.reload()
        wait_app_ready(page)
        page.wait_for_function("() => window.__ownTag === true")
    finally:
        ctx.close()
