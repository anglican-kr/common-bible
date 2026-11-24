"""Shared fixtures and helpers for e2e tests.

Prerequisites: a dev server must be running at BASE_URL.
    python3 scripts/serve.py 8080
"""

import os
import re

import pytest

BASE_URL = "http://localhost:8080"

IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
)
MOBILE_VIEWPORT = {"width": 390, "height": 844}

# Init script that wipes every app-owned localStorage key the SPA writes.
# Inject via `context.add_init_script(CLEAR_APP_STORAGE)` so each new page
# starts from a clean slate.
# Playwright는 초기화 스크립트 여럿의 실행 차례를 정하지 않는다. 비운 뒤 값을 넣는 시험은 한 스크립트로 잇는다
# (`ctx.add_init_script(CLEAR_APP_STORAGE + "localStorage.setItem(...)")`). 따로 넣으면 비우기가 나중에 실행될 수 있다.
CLEAR_APP_STORAGE = """
(() => {
  const keys = [
    'bible-bookmarks', 'bible-last-read', 'bible-audio-pos',
    'bible-font-size', 'bible-theme', 'bible-color-scheme',
    'bible-book-order', 'bible-startup',
    'bible-install-nudge', 'bible-install-nudge-state',
    'bible-drive-sync', 'bible-drive-sync-email', 'bible-drive-sync-updated',
    'bible-bookmarks-v2', 'bible-sync-meta',
    'bible-lectionary-track', 'bible-lectionary-cards-folded',
    'bible-start-page', 'bible-lectionary-alt-show', 'bible-baptismal-saint', 'bible-parish',
    'bible-offline-save',
  ];
  for (const k of keys) try { localStorage.removeItem(k); } catch(_) {}
  // Suppress the install-promo nudge so the #install-scrim overlay never covers
  // the tab bar / intercepts clicks during tests. The default ({visits:0,
  // nextShow:2}) already skips the first visit, but a test that boots the app
  // more than once would still trip it — so persist a neverShow state (the real
  // "다시 보지 않기" path) to make maybeShowInstallNudge return early regardless.
  try { localStorage.setItem('bible-install-nudge', JSON.stringify({ visits: 0, nextShow: 9999, neverShow: true })); } catch(_) {}
})();
"""


# 스크린 리더에 알리는 글을 차례대로 window.__said에 모은다 — `page.evaluate(RECORD_ANNOUNCEMENTS)`.
RECORD_ANNOUNCEMENTS = """() => {
  window.__said = [];
  const live = document.getElementById('a11y-announce');
  new MutationObserver(() => { if (live.textContent) window.__said.push(live.textContent); })
    .observe(live, { childList: true, characterData: true, subtree: true });
}"""


# 설정 「인용·주석 표시」를 끈 기기(기본값은 켬, ADR-022 §6). 칩과 ※는 감춰지고 어절 주석은 보통 글자다.
CITE_SHOW_OFF = "try { localStorage.setItem('bible-cite-show', '0'); } catch (_) {}"

# 주석 툴팁(#note-tooltip)이 열려 있는가 — 어절 주석, 변형 ※, 병행 본문 ※가 함께 쓰는 툴팁이다.
NOTE_TOOLTIP_OPEN = "() => { const t = document.getElementById('note-tooltip'); return !!t && !t.hidden; }"


# 설정 「대체 독서 표시」를 켠 기기 — 평일 줄을 눌러 보는 시험에 쓴다(기본값은 숨김, ADR-041 §4).
SHOW_ALT_READINGS = "try { localStorage.setItem('bible-lectionary-alt-show', '1'); } catch (_) {}"


# Init script for a device whose storage is full (known-issues §15.4): `Storage.prototype.setItem` throws
# `QuotaExceededError` on the chosen localStorage keys, every write or (growOnly) only one that makes the value longer —
# as a full storage does, so a delete still saves. The keys live in sessionStorage, so a reload or the OAuth redirect
# keeps them. Set them with `fill_storage(page, keys)`; nothing is refused until then.
FULL_STORAGE = """
(() => {
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    let full = {};
    try { full = JSON.parse(sessionStorage.getItem('__e2eFull') || '{}'); } catch (_) {}
    if (this === window.localStorage && Array.isArray(full.keys) && full.keys.includes(key)) {
      const before = this.getItem(key);
      const refused = typeof full.longerThan === 'number'
        ? String(value).length > full.longerThan
        : !full.growOnly || before === null || String(value).length > before.length;
      if (refused) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
    }
    return setItem.call(this, key, value);
  };
})();
"""


def fill_storage(page, keys, grow_only=False, longer_than=None) -> None:
    """From now on, refuse writes to these localStorage keys (FULL_STORAGE); an empty list makes room again.

    ``longer_than`` refuses only values longer than that many characters — room for a small write, not a large one.
    """
    page.evaluate(
        "([keys, growOnly, longerThan]) => sessionStorage.setItem('__e2eFull', JSON.stringify({ keys, growOnly, longerThan }))",
        [keys, grow_only, longer_than],
    )


# 콘텐츠 보안 정책(CSP)이 끼워 넣은 <style>을 막으므로, 스크립트로 만든 스타일시트(adoptedStyleSheets)로 규칙을 더한다.
# `page.evaluate(ADD_STYLE_RULE, "<규칙>")`. 규칙이라 나중에 그린 요소에도 그리는 순간부터 적용된다.
ADD_STYLE_RULE = """(rule) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(rule);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}"""


def pseudo_session(page):
    """`style_in_state`가 쓰는 개발자 도구 프로토콜(CDP) 세션. Chromium에서만 열린다."""
    cdp = page.context.new_cdp_session(page)
    cdp.send("DOM.enable")
    cdp.send("CSS.enable")
    return cdp


def style_in_state(cdp, expression, prop, state="hover"):
    """`expression`(자바스크립트 식)이 가리키는 요소에 `state`(:hover, :active 등)를 켜고, 그 요소의 계산된 스타일 `prop`을 읽는다.
    iOS는 마지막으로 누른 자리에 :hover를 남긴다(DESIGN.md 「포인터 분기」). 터치 환경의 Chromium은 탭 뒤에 :hover를 남기지 않고, 탭 직후에는
    포인터를 옮겨도 한동안 :hover를 주지 않는다. 그래서 그 상태를 CDP의 `CSS.forcePseudoState`로 만든다. 상태를 켠 요소에서 그대로 읽는다.
    전환(transition)이 있는 속성은 시험에서 전환을 꺼 두고 읽는다."""
    found = cdp.send("Runtime.evaluate", {"expression": expression})
    object_id = found["result"].get("objectId")
    assert object_id, f"요소를 찾지 못했다: {expression}"
    cdp.send("DOM.getDocument")   # requestNode는 문서를 먼저 받아야 노드 번호를 준다
    node = cdp.send("DOM.requestNode", {"objectId": object_id})["nodeId"]
    cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": [state]})
    try:
        return cdp.send("Runtime.callFunctionOn", {
            "objectId": object_id, "returnByValue": True,
            "functionDeclaration": f"function () {{ return getComputedStyle(this)[{prop!r}]; }}",
        })["result"]["value"]
    finally:
        cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": []})


# ── 구글 애널리틱스로 가는 요청을 막는다(known-issues §61) ─────────────────────────────────────────────
# e2e가 여는 화면은 `index.html`이 싣는 구글 태그(gtag.js)를 그대로 받아, `localhost`의 방문을 사용자가 보는 통계로 보냈다.
# 아래 두 장치가 e2e의 요청이 구글에 가지 않게 한다. 태그가 없어도 앱은 그대로 돈다. 방문 기록은 `gtag-init.js`의 대기열(`dataLayer`)에 쌓인다.
#  - Chromium: 태그와 그 요청이 가는 주소의 이름을 풀지 못하게 한다(`browser_type_launch_args`). 서비스 워커가 보내는 요청까지
#    막힌다. 이 앱의 워커는 넘겨받은 화면의 GET 요청을 모두 제가 받아 보내는데, Playwright의 `route`는 워커가 보낸 요청을 잡지
#    못한다. 기본 설정의 로컬 서버에서는 워커가 설치를 끝내지 못해 화면을 넘겨받지 않지만(known-issues §80), 서버를 `--cache`로
#    띄우면 넘겨받는다. 프록시를 거치는 요청은 프록시가 이름을 풀어 이 규칙이 적용되지 않는다. 그래서 환경 변수로 프록시를 정한
#    기기에서도 이 주소들은 프록시를 거치지 않게 한다(`no_proxy`).
#  - 다른 브라우저: 이름 풀이를 바꿀 수 없어, 컨텍스트마다 `guard_analytics`로 대신 대답한다(`browser`). 워커가 넘겨받은
#    화면에서 워커가 보내는 요청은 막지 못한다.
#  - 어느 브라우저든 묶음을 시작할 때 한 번, 막는 주소로 보낸 요청이 정말 브라우저를 떠나지 않는지 본다
#    (`analytics_guard_holds`). 떠나는 기기에서는 묶음을 멈춘다. 운영체제의 프록시 설정이나 자동 설정 파일처럼 위의 장치가
#    손대지 못하는 경로가 있다.
# 방문 기록을 세는 시험은 제 컨텍스트에 흉내 낸 태그를 `route`로 싣는다(`test_navigation.py`의 `FAKE_GTAG`). `route`는 이름
# 풀이보다 먼저 적용되고, 나중에 등록한 `route`가 먼저 등록한 것보다 먼저 적용된다.

# 태그와 그 요청에 `index.html`의 CSP가 허용한 주소를 모두 덮는 목록. Chromium의 호스트 규칙에 쓰는 표기다(`*`는 아무 글자열이고
# 점도 포함한다). CSP에 구글 주소를 더하면 여기에도 더한다(`test_analytics_guard.py`가 견준다).
ANALYTICS_HOSTS = (
    "*.googletagmanager.com",   # 태그 스크립트(gtag.js)
    "*.google-analytics.com",   # 수집(g/collect)
    "*.google.com",             # 구글 시그널을 켠 속성의 수집(analytics.google.com), 페이지를 떠날 때의 수집(www.google.com)
    "*.g.doubleclick.net",      # 구글 시그널(stats.g.doubleclick.net)
    "www.google.co.kr",         # 구글 시그널(ads/ga-audiences)
)
ANALYTICS_TAG_URL = re.compile(r"^https://www\.googletagmanager\.com/gtag/js")
ANALYTICS_URL = re.compile(
    "^https?://(" + "|".join(re.escape(h).replace(r"\*", "[^/:?#@]*") for h in ANALYTICS_HOSTS) + r")(:\d+)?(/|$)"
)
ANALYTICS_GUARD_HEADER = "x-e2e-analytics-guard"   # `guard_analytics`가 대신 한 대답에 붙는다
# 장치가 듣는지 볼 때 보내 보는 주소. 측정 ID도 방문 내용도 싣지 않아, 구글까지 가더라도 기록되지 않는다.
ANALYTICS_PROBE_URL = "https://www.google-analytics.com/e2e-guard-check"


def is_analytics_url(url) -> bool:
    """구글 태그나 그 요청이 가는 주소인가."""
    return bool(ANALYTICS_URL.match(url))


def guard_analytics(ctx) -> None:
    """이 컨텍스트가 구글 애널리틱스로 보내는 요청에 대신 대답한다. 태그 스크립트에는 빈 스크립트를, 그 밖의 주소에는 빈 성공 응답(204)을
    준다. 막으면 진짜 태그가 다시 보내므로 막지 않는다(pitfalls §43)."""
    def answer(route):
        if ANALYTICS_TAG_URL.match(route.request.url):
            route.fulfill(status=200, content_type="text/javascript", body="", headers={ANALYTICS_GUARD_HEADER: "1"})
        else:
            route.fulfill(status=204, headers={ANALYTICS_GUARD_HEADER: "1"})
    ctx.route(ANALYTICS_URL, answer)


def analytics_launch_args(launch_args, environ):
    """Chromium을 띄우는 인자에 구글 애널리틱스 주소의 이름을 풀지 못하게 하는 규칙을 더한다. 요청은 `net::ERR_NAME_NOT_RESOLVED`로
    바로 실패한다. 프록시를 거치는 요청은 프록시가 이름을 풀어 이 규칙이 적용되지 않으므로, 브라우저의 환경 변수 `no_proxy`에도 이
    주소들을 더해 프록시를 거치지 않게 한다. Chromium은 프록시를 환경 변수(`https_proxy` 등)에서 읽는다. 띄우는 인자로 프록시를
    정했으면(`proxy`) 환경 변수는 쓰이지 않으므로, 그 프록시가 건너뛰는 주소(`bypass`)에 더한다."""
    # 같은 인자를 두 번 주면 Chromium은 뒤의 것만 쓴다. 띄우는 인자에 이미 있던 규칙은 하나로 합쳐 남긴다.
    flag = "--host-resolver-rules="
    given = launch_args.get("args", [])
    rules = ", ".join([*(arg[len(flag):] for arg in given if arg.startswith(flag)),
                       *(f"MAP {host} ~NOTFOUND" for host in ANALYTICS_HOSTS)])
    env = {**environ, **launch_args.get("env", {})}   # 띄우는 인자의 환경 변수가 먼저다. 거기서 정한 `no_proxy`도 그대로 둔다
    kept = [v for v in (env.get("no_proxy"), env.get("NO_PROXY")) if v]
    no_proxy = ",".join(dict.fromkeys([*kept, *ANALYTICS_HOSTS]))
    guarded = {
        **launch_args,
        "args": [*(arg for arg in given if not arg.startswith(flag)), f"{flag}{rules}"],
        "env": {**env, "no_proxy": no_proxy, "NO_PROXY": no_proxy},
    }
    proxy = launch_args.get("proxy")
    if proxy:
        guarded["proxy"] = {**proxy, "bypass": ",".join(v for v in (proxy.get("bypass"), *ANALYTICS_HOSTS) if v)}
    return guarded


@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args, browser_name):
    """Chromium이 구글 애널리틱스 주소의 이름을 풀지 못하게 한다(`analytics_launch_args`)."""
    if browser_name != "chromium":
        return browser_type_launch_args
    return analytics_launch_args(browser_type_launch_args, os.environ)


def analytics_guard_outcome(browser) -> str:
    """막는 주소로 요청을 하나 보내 보고 어떻게 끝났는지 돌려준다. `"blocked"`는 요청이 브라우저를 떠나지 않았다는 뜻이다. 이름
    풀이에서 실패했거나 `guard_analytics`가 대신 대답했다. 그 밖의 값(`"answered"`나 실패한 까닭)은 요청이 프록시나 구글로
    갔다는 뜻이다."""
    ctx = browser.new_context()
    try:
        page = ctx.new_page()
        seen = []
        page.on("requestfailed", lambda req: seen.append(req.failure))
        page.on("response", lambda res: seen.append("guard" if res.headers.get(ANALYTICS_GUARD_HEADER) else "answered"))
        page.goto("about:blank")
        page.evaluate("(url) => fetch(url, { mode: 'no-cors' }).then(() => {}, () => {})", ANALYTICS_PROBE_URL)
        for _ in range(40):   # 알림은 `fetch`가 끝난 바로 뒤에 온다
            if seen:
                break
            page.wait_for_timeout(50)
    finally:
        ctx.close()
    if seen in (["net::ERR_NAME_NOT_RESOLVED"], ["guard"]):
        return "blocked"
    return seen[0] if seen else "no notice"


@pytest.fixture(scope="session", autouse=True)
def analytics_guard_holds(browser):
    """묶음을 시작할 때 한 번, 막는 주소로 보낸 요청이 브라우저를 떠나지 않는지 본다. 떠나는 기기에서는 묶음을 멈춘다. 그대로 돌리면
    `localhost`의 방문이 실제 통계에 섞인다. 운영체제의 프록시 설정이나 자동 설정 파일로 프록시를 정한 기기가 그럴 수 있다."""
    outcome = analytics_guard_outcome(browser)
    if outcome != "blocked":
        pytest.exit(
            f"e2e를 멈춘다. 이 기기에서는 구글 애널리틱스로 가는 요청이 막히지 않는다({ANALYTICS_PROBE_URL}: {outcome}). "
            "프록시 설정을 확인한다(tests/e2e/conftest.py의 「구글 애널리틱스로 가는 요청을 막는다」).",
            returncode=1,
        )


@pytest.fixture(scope="session")
def browser(browser, browser_name):
    """Chromium이 아니면 `browser.new_context`가 만드는 컨텍스트마다 `guard_analytics`를 실행한다. 시험은 컨텍스트를 이 메서드로
    직접 만들고(`desktop_context`와 `mobile_context`, pytest-playwright의 `context`도 이 메서드를 호출한다), 페이지를 바로 만드는 곳은 없다."""
    if browser_name != "chromium":
        new_context = browser.new_context

        def guarded_new_context(*args, **kwargs):
            ctx = new_context(*args, **kwargs)
            guard_analytics(ctx)
            return ctx

        browser.new_context = guarded_new_context
    return browser


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL


@pytest.fixture
def desktop_context(browser):
    """Default-viewport context with app storage cleared."""
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    yield ctx
    ctx.close()


@pytest.fixture
def mobile_context(browser):
    """Mobile (iPhone 12) viewport + UA, app storage cleared."""
    ctx = browser.new_context(viewport=MOBILE_VIEWPORT, user_agent=IPHONE_UA)
    ctx.add_init_script(CLEAR_APP_STORAGE)
    yield ctx
    ctx.close()


def wait_app_ready(page) -> None:
    """Block until the SPA shell has rendered at least one child element.

    Wait for ``#search-input`` *attached* (in DOM), not *visible*: on mobile the
    header ``#header-actions`` (which contains the search bar) is ``display:none``
    by design — search lives in the bottom tab dock instead — so the default
    ``visible`` state never resolves and every mobile test would time out.
    """
    page.wait_for_selector("#search-input", state="attached")
    page.wait_for_function(
        "() => !!document.getElementById('app') && "
        "document.getElementById('app').children.length > 0"
    )


def open_settings(page):
    """Click the settings trigger and return the popover locator (visible)."""
    page.locator("#settings-anchor .settings-btn").click()
    popover = page.locator(".settings-popover")
    popover.wait_for(state="visible")
    return popover


def press_center(page, selector) -> None:
    """좌표로 누른다. Playwright의 click은 누르기 전에 요소를 화면 안으로 스크롤하는데, 목록 화면의 위쪽 여백(scroll-padding-top) 때문에
    상단 바 안의 단추에서도 페이지를 스크롤한다. 사람이 누를 때는 그런 스크롤이 없다."""
    box = page.locator(selector).first.bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def assert_sheet_close_button(page, selector) -> None:
    """시트 머리의 닫기 단추는 모든 시트에서 같은 「닫기」 글자 단추다(DESIGN.md 「시트 vs 모달」, 사용자 결정 2026-11-17).
    보이는 글자가 이름이라 aria-label이 없고, 공용 클래스(.sheet-close)의 작은 글자(--font-sm)이며, 44px 이상이다."""
    state = page.evaluate("""sel => {
        const b = document.querySelector(sel);
        const r = b.getBoundingClientRect();
        const probe = document.createElement('span');
        probe.style.fontSize = 'var(--font-sm)';
        document.body.append(probe);
        const small = getComputedStyle(probe).fontSize;
        probe.remove();
        return { text: b.textContent.trim(), label: b.getAttribute('aria-label'), shared: b.classList.contains('sheet-close'),
                 small: getComputedStyle(b).fontSize === small, w: r.width >= 44, h: r.height >= 44 };
    }""", selector)
    assert state == {"text": "닫기", "label": None, "shared": True, "small": True, "w": True, "h": True}, (selector, state)


def close_popovers(page) -> None:
    """Dismiss any open popovers/modals by pressing Escape."""
    page.keyboard.press("Escape")


def emulate_status_bar(page, inset) -> None:
    """iOS가 홈 화면 앱을 상태 표시줄 밑까지 그리는 상태를 시뮬레이션한다. `env(safe-area-inset-top)`이 `inset`px이 된다.
    Chrome 개발자 도구 프로토콜(CDP)의 기능이라 Chromium에서만 된다. 쓰는 시험에 `@pytest.mark.only_browser("chromium")`을 붙인다."""
    cdp = page.context.new_cdp_session(page)
    cdp.send("Emulation.setSafeAreaInsetsOverride", {"insets": {"top": inset, "topMax": inset}})


def emulate_side_safe_areas(page, left, right, bottom=21) -> None:
    """가로로 든 iPhone의 좌우 안전 영역을 흉내 낸다. `env(safe-area-inset-left)`과 `env(safe-area-inset-right)`이 `left`px과
    `right`px이 되고, 아래는 홈 표시줄의 `bottom`px이다(가로로 든 iPhone 17은 좌우 62pt쯤, 아래 21pt). 실제 iPhone이 아니다.
    `emulate_status_bar`처럼 Chromium에서만 된다. 쓰는 시험에 `@pytest.mark.only_browser("chromium")`을 붙인다."""
    cdp = page.context.new_cdp_session(page)
    cdp.send("Emulation.setSafeAreaInsetsOverride",
             {"insets": {"left": left, "right": right, "top": 0, "bottom": bottom}})
