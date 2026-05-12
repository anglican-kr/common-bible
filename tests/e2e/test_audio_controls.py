"""E2E: 오디오 플레이어 컨트롤 — 재생/일시정지, 배속, seek, 위치 저장/복원.

기존 test_audio.py는 visibility·teardown·오류 처리를 커버한다.
이 파일은 실제 사용자 인터랙션(버튼·슬라이더)에 집중한다.

play/pause 테스트는 HTMLAudioElement.prototype.play/pause를 mock해
실제 오디오 파일 없이 'play'·'playing'·'pause' 이벤트를 발화한다.
timeupdate·ended 테스트는 JS evaluate로 이벤트를 직접 dispatch한다.
"""
from .conftest import CLEAR_APP_STORAGE

BASE = "http://localhost:8080"

# Mock HTMLAudioElement:
# 1. Intercept `new Audio()` so we can hold a reference via window.__testAudio
# 2. Override play/pause to dispatch events immediately without real audio data
_AUDIO_MOCK = """
(() => {
    const _playing = new WeakMap();
    const _OrigAudio = window.Audio;

    window.Audio = function(...args) {
        const inst = new _OrigAudio(...args);
        window.__testAudio = inst;
        return inst;
    };
    window.Audio.prototype = _OrigAudio.prototype;

    HTMLAudioElement.prototype.play = function() {
        _playing.set(this, true);
        const self = this;
        self.dispatchEvent(new Event('play'));
        setTimeout(() => self.dispatchEvent(new Event('playing')), 20);
        return Promise.resolve();
    };

    HTMLAudioElement.prototype.pause = function() {
        _playing.delete(this);
        this.dispatchEvent(new Event('pause'));
    };

    try {
        Object.defineProperty(HTMLAudioElement.prototype, 'paused', {
            get: function() { return !_playing.has(this); },
            configurable: true,
        });
    } catch (_) {}
})();
"""


_SUPPRESS_AUDIO_ERROR = """
(() => {
    // Block the 'error' listener that views-routing.js binds in showAudioPlayer:
    //   audio.addEventListener('error', () => { _teardownAudio(); showAudioUnavailable(); });
    // Without this, the empty / 404 audio body fires 'error' during page setup,
    // tears down the audio bar UI, and interaction tests (speed/play/seek/...)
    // hit timeouts waiting for the now-gone .audio-* controls.
    const origAdd = HTMLAudioElement.prototype.addEventListener;
    HTMLAudioElement.prototype.addEventListener = function(type, listener, opts) {
        if (type === 'error') return;
        return origAdd.call(this, type, listener, opts);
    };
})();
"""


def _open(browser):
    ctx = browser.new_context()
    ctx.add_init_script(CLEAR_APP_STORAGE)
    ctx.add_init_script(_AUDIO_MOCK)
    ctx.add_init_script(_SUPPRESS_AUDIO_ERROR)
    page = ctx.new_page()
    # Block audio file requests so the player initialises without network
    page.route("**/data/audio/**", lambda r: r.fulfill(status=200, body=b"", content_type="audio/mpeg"))
    page.goto(f"{BASE}/gen/1")
    page.wait_for_selector("article.chapter-text .verse")
    page.wait_for_timeout(200)
    return ctx, page


# ── 배속 ──────────────────────────────────────────────────────────────────────

def test_speed_btn_cycles_rates(browser):
    """배속 버튼 클릭 → 1× → 1.25× → 1.5× → 1× 순환, textContent·aria-label 업데이트."""
    ctx, page = _open(browser)
    try:
        btn = page.locator(".audio-speed-btn")
        assert btn.text_content().strip() == "1×"

        btn.click()
        page.wait_for_timeout(100)
        assert btn.text_content().strip() == "1.25×"
        assert "1.25" in (btn.get_attribute("aria-label") or "")

        btn.click()
        page.wait_for_timeout(100)
        assert btn.text_content().strip() == "1.5×"

        btn.click()
        page.wait_for_timeout(100)
        assert btn.text_content().strip() == "1×"
    finally:
        ctx.close()


# ── 재생 / 일시정지 ───────────────────────────────────────────────────────────

def test_play_btn_click_triggers_play(browser):
    """재생 버튼 첫 클릭 → 'playing' 이벤트 발화 → aria-label='일시정지', pause 아이콘."""
    ctx, page = _open(browser)
    try:
        play_btn = page.locator(".audio-play-btn")
        assert play_btn.get_attribute("aria-label") == "재생"

        play_btn.click()
        page.wait_for_selector(".audio-icon-pause", timeout=2_000)
        assert play_btn.get_attribute("aria-label") == "일시정지"
    finally:
        ctx.close()


def test_pause_btn_click_triggers_pause(browser):
    """재생 후 다시 클릭 → 'pause' 이벤트 → aria-label='재생', play 아이콘 복원."""
    ctx, page = _open(browser)
    try:
        play_btn = page.locator(".audio-play-btn")

        play_btn.click()
        page.wait_for_selector(".audio-icon-pause", timeout=2_000)

        play_btn.click()
        page.wait_for_selector(".audio-icon-play", timeout=2_000)
        assert play_btn.get_attribute("aria-label") == "재생"
    finally:
        ctx.close()


# ── seek ──────────────────────────────────────────────────────────────────────


def test_seek_via_progress_input(browser):
    """progress input 값 변경 → 'input' 이벤트 → audio.currentTime 업데이트."""
    ctx, page = _open(browser)
    try:
        page.evaluate("""() => {
            const audio = window.__testAudio;
            if (!audio) return;
            Object.defineProperty(audio, 'duration', { get: () => 300, configurable: true });
        }""")

        page.wait_for_selector(".audio-progress")
        page.evaluate("""() => {
            const progress = document.querySelector('.audio-progress');
            progress.max = '300';
            progress.value = '60';
            progress.dispatchEvent(new Event('input', { bubbles: true }));
        }""")
        page.wait_for_timeout(100)

        current = page.evaluate("""() => {
            const audio = window.__testAudio;
            return audio ? audio.currentTime : null;
        }""")
        assert current == 60, f"audio.currentTime should be 60, got {current}"
    finally:
        ctx.close()


# ── 위치 저장 (timeupdate) ────────────────────────────────────────────────────

def test_timeupdate_saves_audio_position(browser):
    """timeupdate 이벤트 발화 후 1초 → bible-audio-pos에 현재 위치 저장."""
    ctx, page = _open(browser)
    try:
        page.evaluate("""() => {
            const audio = window.__testAudio;
            if (!audio) return;
            Object.defineProperty(audio, 'currentTime', { value: 42, configurable: true });
            Object.defineProperty(audio, 'ended', { get: () => false, configurable: true });
            audio.dispatchEvent(new Event('timeupdate'));
        }""")
        page.wait_for_timeout(1_200)  # debounce 1s + buffer

        raw = page.evaluate("() => localStorage.getItem('bible-audio-pos')")
        import json
        assert raw, "bible-audio-pos should be saved after timeupdate"
        pos = json.loads(raw)
        assert pos["time"] == 42
        assert pos["bookId"] == "gen"
        assert pos["chapter"] == 1
    finally:
        ctx.close()


# ── 종료 시 위치 제거 (ended) ─────────────────────────────────────────────────

def test_ended_clears_audio_position(browser):
    """'ended' 이벤트 발화 → bible-audio-pos 제거."""
    ctx, page = _open(browser)
    try:
        page.evaluate("""() => {
            localStorage.setItem('bible-audio-pos',
                JSON.stringify({ bookId: 'gen', chapter: 1, time: 100 }));
        }""")

        page.evaluate("""() => {
            const audio = window.__testAudio;
            if (audio) audio.dispatchEvent(new Event('ended'));
        }""")
        page.wait_for_timeout(200)

        saved = page.evaluate("() => localStorage.getItem('bible-audio-pos')")
        assert saved is None, "bible-audio-pos should be removed after 'ended' event"
    finally:
        ctx.close()
