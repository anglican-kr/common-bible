// ── Unit tests for js/app/audio-player.js ────────────────────────────────────
// Run with: node --test tests/unit/audio-player.test.js
//
// audio-player.js builds the player DOM at module top level (window.appHelpers, #audio-bar), so the player UI is e2e's
// job (tests/e2e/test_audio.py). What IS unit-testable is the AUDIO_ERROR_NOTICE block: which notice the audio bar
// shows when a chapter's mp3 fails to load (ADR-016 D4, known-issues §26). The block is sliced out (BEGIN/END markers,
// as in tab-history.test.js) and run in a vm whose Cache Storage, fetch, navigator and timers are stubs, so each case
// states what the device has saved and how the network answers, and checks which requests were sent.
//
// Coverage:
//   - 안내 문구 둘(사용자 결정 2026-11-07)과 오디오 목록의 키(머리말은 0장)
//   - 오프라인 안내는 세 조건이 모두 맞을 때만 보인다: 목록에 있는 장, 이 기기에 없는 mp3, 서버에 연결할 수 없음
//   - 오프라인 판단: navigator.onLine이 거짓이면 서버에 묻지 않는다. 참이면 HEAD 요청이 실패하거나
//     기다리는 시간을 넘길 때 오프라인이다. 서버가 응답하면 404여도 연결된 것이다
//   - 목록에 없는 장과 저장된 장은 네트워크에 묻지 않는다
//   - 목록은 Cache Storage의 사본을 먼저 읽고, 사본이 없을 때만 받는다. 읽지 못하면 「준비 중」이다
//   - 장을 떠나면(플레이어의 신호 중단) 기다리던 요청을 멈춘다

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_PATH = path.resolve(__dirname, "../../js/app/audio-player.js");
const SOURCE = fs.readFileSync(SRC_PATH, "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = SOURCE.indexOf(begin);
  const endIdx = SOURCE.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in js/app/audio-player.js`);
  }
  return SOURCE.slice(startIdx, endIdx + end.length);
}

const BLOCK = extractBlock("AUDIO_ERROR_NOTICE");

const MANIFEST_URL = "/data/audio-manifest.json";
const GEN_1 = "/data/audio/gen-1.mp3";
const TOB_1 = "/data/audio/tob-1.mp3";
const MANIFEST = { format: 1, entries: { "audio/gen-1.mp3": "sha256:a", "audio/sir-0.mp3": "sha256:b" } };

/** A Response-like answer: status and a JSON body. */
const response = (status, body = MANIFEST) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// ── Network stubs: (url, init) => Promise<Response-like> ──

/** Every request fails as fetch does with no connection. */
const offline = async () => { throw new TypeError("Failed to fetch"); };
/** The manifest downloads; every other request (the HEAD probe) fails. */
const manifestOnly = async (url) => {
  if (url === MANIFEST_URL) return response(200);
  throw new TypeError("Failed to fetch");
};
/** The server answers every request with this status. */
const answers = (status) => async () => response(status);
/** No answer until the request is aborted (a Wi-Fi with no internet). */
const hangs = (url, init) => new Promise((_, reject) => {
  init.signal.addEventListener("abort", () => reject(new Error("AbortError")));
});

/**
 * Run the block in a fresh vm.
 * @param {{ saved?: Map<string, object> | null, onLine?: boolean, network?: Function }} device
 *   saved: what Cache Storage holds, by URL (the manifest copy sw.js keeps, saved mp3s); null = no Cache Storage at all
 */
function load({ saved = new Map([[MANIFEST_URL, response(200)]]), onLine = true, network = offline } = {}) {
  /** @type {{ url: string, method: string, init: any }[]} */
  const requests = [];
  /** @type {{ fn: Function, ms: number, cleared?: boolean }[]} */
  const timers = [];
  const ctx = {
    navigator: { onLine },
    AbortController,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    fetch: (url, init = {}) => {
      requests.push({ url, method: init.method || "GET", init });
      return network(url, init);
    },
    module: { exports: {} },
  };
  if (saved) ctx.caches = { match: async (url) => saved.get(url) };
  vm.createContext(ctx);
  vm.runInContext(`${BLOCK}\nmodule.exports = { AUDIO_NOTICE_TEXT, audioManifestKey, audioErrorNotice };`, ctx);
  return { ...ctx.module.exports, requests, timers };
}

/** The notice for a chapter whose mp3 failed to load, with the player's signal not aborted. */
function noticeFor(device, src, key) {
  const { audioErrorNotice } = device;
  return audioErrorNotice(src, key, new AbortController().signal);
}

/** Let pending promise callbacks run (the stubs answer in microtasks). */
const settle = () => new Promise((resolve) => setImmediate(resolve));

// ── 문구와 키 ──

test("안내 문구: 오프라인 안내와 준비 중 안내(사용자 결정 2026-11-07)", () => {
  const { AUDIO_NOTICE_TEXT } = load();
  assert.equal(AUDIO_NOTICE_TEXT.offline, "인터넷에 연결하면 들을 수 있습니다.");
  assert.equal(AUDIO_NOTICE_TEXT.unavailable, "오디오 파일을 준비 중입니다.");
});

test("오디오 목록의 키: audio/<책>-<장>.mp3, 머리말은 0장", () => {
  const { audioManifestKey } = load();
  assert.equal(audioManifestKey("gen", 1), "audio/gen-1.mp3");
  assert.equal(audioManifestKey("sir", 0), "audio/sir-0.mp3");
});

// ── 오프라인(navigator.onLine이 거짓) ──

test("오프라인에서 목록에 있고 저장되지 않은 장은 오프라인 안내, 서버에 묻지 않는다", async () => {
  const device = load({ onLine: false });
  assert.equal(await noticeFor(device, GEN_1, "audio/gen-1.mp3"), "offline");
  assert.deepStrictEqual(device.requests, [], "목록은 Cache Storage의 사본을 읽고, 오프라인 판단에 요청을 보내지 않는다");
});

test("목록에 없는 장(토비트 1장)은 오프라인이어도 준비 중 안내, 네트워크에 묻지 않는다", async () => {
  const device = load({ onLine: false, network: answers(200) });
  assert.equal(await noticeFor(device, TOB_1, "audio/tob-1.mp3"), "unavailable");
  assert.deepStrictEqual(device.requests, []);
});

test("이 기기에 저장된 mp3가 재생되지 않으면 오프라인이어도 준비 중 안내", async () => {
  const saved = new Map([[MANIFEST_URL, response(200)], [GEN_1, response(200)]]);
  const device = load({ saved, onLine: false });
  assert.equal(await noticeFor(device, GEN_1, "audio/gen-1.mp3"), "unavailable");
  assert.deepStrictEqual(device.requests, []);
});

// ── 온라인으로 보이는 기기(navigator.onLine이 참): 서버에 묻는다 ──

test("인터넷이 없는 와이파이: onLine이 참이어도 HEAD 요청이 실패하면 오프라인 안내", async () => {
  const device = load({ onLine: true, network: offline });
  assert.equal(await noticeFor(device, GEN_1, "audio/gen-1.mp3"), "offline");
  assert.equal(device.requests.length, 1);
  assert.equal(device.requests[0].url, GEN_1);
  assert.equal(device.requests[0].method, "HEAD", "HEAD는 서비스 워커를 거치지 않는다(sw.js는 GET만 처리한다)");
  assert.equal(device.requests[0].init.cache, "no-store", "브라우저 HTTP 캐시가 대신 응답하지 않게 한다");
});

test("서버가 응답하면 404여도 연결된 것이라 준비 중 안내", async () => {
  for (const status of [404, 200, 503]) {
    const device = load({ onLine: true, network: answers(status) });
    assert.equal(await noticeFor(device, GEN_1, "audio/gen-1.mp3"), "unavailable", `HEAD ${status}`);
  }
});

test("서버가 기다리는 시간(5초) 안에 응답하지 않으면 오프라인 안내", async () => {
  const device = load({ onLine: true, network: hangs });
  let notice = null;
  noticeFor(device, GEN_1, "audio/gen-1.mp3").then((n) => { notice = n; });
  await settle();
  assert.equal(device.requests.length, 1, "HEAD 요청을 보내고 기다린다");
  assert.equal(notice, null, "응답이 없는 동안은 정하지 않는다");
  const timer = device.timers.find((t) => !t.cleared);
  assert.equal(timer.ms, 5000);
  timer.fn();
  await settle();
  assert.equal(notice, "offline");
});

// ── 목록 읽기 ──

test("Cache Storage에 목록 사본이 없으면 네트워크에서 받아 판단한다", async () => {
  const device = load({ saved: new Map(), onLine: true, network: manifestOnly });
  assert.equal(await noticeFor(device, GEN_1, "audio/gen-1.mp3"), "offline");
  assert.deepStrictEqual(device.requests.map((r) => `${r.method} ${r.url}`), [`GET ${MANIFEST_URL}`, `HEAD ${GEN_1}`]);
});

test("Cache Storage가 없는 환경에서도 목록을 받아 판단한다", async () => {
  const device = load({ saved: null, onLine: true, network: manifestOnly });
  assert.equal(await noticeFor(device, GEN_1, "audio/gen-1.mp3"), "offline");
});

test("목록을 읽지 못하면 준비 중 안내, 서버에 HEAD 요청을 보내지 않는다", async () => {
  const device = load({ saved: new Map(), onLine: true, network: offline });
  assert.equal(await noticeFor(device, GEN_1, "audio/gen-1.mp3"), "unavailable");
  assert.deepStrictEqual(device.requests.map((r) => r.method), ["GET"]);
});

test("목록 형식이 잘못되면(entries 없음, JSON이 아님) 준비 중 안내", async () => {
  const broken = [
    response(200, { format: 1 }),
    response(200, null),
    { ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } },
  ];
  for (const copy of broken) {
    const device = load({ saved: new Map([[MANIFEST_URL, copy]]), onLine: false });
    assert.equal(await noticeFor(device, GEN_1, "audio/gen-1.mp3"), "unavailable");
  }
});

// ── 장을 떠날 때 ──

test("장을 떠나면(플레이어의 신호 중단) 기다리던 HEAD 요청을 멈추고 확인을 끝낸다", async () => {
  const device = load({ onLine: true, network: hangs });
  const player = new AbortController();
  let settled = false;
  device.audioErrorNotice(GEN_1, "audio/gen-1.mp3", player.signal).then(() => { settled = true; });
  await settle();
  assert.equal(device.requests.length, 1);
  player.abort();
  await settle();
  assert.equal(device.requests[0].init.signal.aborted, true, "요청이 취소된다");
  assert.equal(settled, true, "확인이 끝나서 화면 코드가 신호를 보고 안내를 버린다");
  assert.ok(device.timers.every((t) => t.cleared), "기다리는 시간의 타이머도 지운다");
});
