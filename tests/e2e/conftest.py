"""Shared fixtures and helpers for e2e tests.

Prerequisites: a dev server must be running at BASE_URL.
    python3 scripts/serve.py 8080
"""

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
