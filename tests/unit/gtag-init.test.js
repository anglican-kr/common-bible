// ── js/gtag-init.js: 방문 기록은 앱이 화면을 그린 뒤 한 번 보낸다(known-issues §46) ──
// Run with: node --test tests/unit/gtag-init.test.js
//
// gtag-init.js only queues commands on window.dataLayer; Google's tag (gtag.js, loaded async) reads the queue later. So
// run it in a vm with an empty window and read the queue. Left to its default, the `config` command makes the tag send
// the first screen's page_view itself, on top of the one routing.js trackPageView sends once the screen is drawn: the
// first screen then counted twice (2026-11-23 measurement, docs/changes/2026-11-24-analytics-double-pageview.md).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { stripEsmMarker } from "./harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = stripEsmMarker(fs.readFileSync(path.resolve(__dirname, "../../js/gtag-init.js"), "utf8"));

/** Runs gtag-init.js on an empty page and returns the queued commands (as arrays) and the `window.gtag` it left. */
function run() {
  const ctx = vm.createContext({});
  ctx.window = ctx;
  vm.runInContext(SOURCE, ctx, { filename: "gtag-init.js" });
  // Array.from builds the arrays in this realm, so deepEqual compares them with ours.
  const queue = () => Array.from(ctx.dataLayer, (/** @type {ArrayLike<unknown>} */ args) => Array.from(args));
  return { queue, gtag: ctx.gtag };
}

test("gtag-init: 태그 설정은 첫 화면의 방문을 스스로 보내지 않는다(send_page_view: false)", () => {
  const configs = run().queue().filter((a) => a[0] === "config");
  assert.equal(configs.length, 1);
  assert.equal(configs[0][1], "G-2Q4SRGVNQN");
  // The params object comes from the vm's realm, so compare its fields rather than the object.
  const params = /** @type {Record<string, unknown>} */ (configs[0][2]);
  assert.deepEqual(Object.keys(params ?? {}), ["send_page_view"]);
  assert.equal(params.send_page_view, false);
});

test("gtag-init: index.html이 불러오는 태그와 config의 측정 ID가 같다", () => {
  // The ID is written in two places. When they differ, or both name another stream, nothing fails and the stream in the
  // Analytics admin simply receives no data (2026-05-05 to 2026-11-23, PR #648).
  const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
  const tagIds = Array.from(html.matchAll(/googletagmanager\.com\/gtag\/js\?id=([A-Z0-9-]+)/g), (m) => m[1]);
  const configIds = run().queue().filter((a) => a[0] === "config").map((a) => a[1]);
  assert.equal(tagIds.length, 1);
  assert.deepEqual(configIds, tagIds);
});

test("gtag-init: 스스로는 방문을 보내지 않고, 앱이 호출하는 gtag가 같은 대기열에 쌓는다", () => {
  const { queue, gtag } = run();
  assert.deepEqual(queue().map((a) => a[0]), ["js", "config"]);
  assert.equal(typeof gtag, "function");
  gtag("event", "page_view", { page_title: "창세기 1장 — 공동번역성서" });
  const last = queue().at(-1);
  assert.equal(last?.[0], "event");
  assert.equal(last?.[1], "page_view");
});
