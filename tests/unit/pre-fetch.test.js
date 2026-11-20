// Unit tests for js/pre-fetch.js, a classic script run in a vm with stubbed browser globals.
// The launch screen's cross moves up by half the status bar in the iOS home screen app, so it lines up with the
// startup image that covers the whole screen (ADR-007 §8).
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "..", "js", "pre-fetch.js"), "utf8");

/**
 * Run pre-fetch.js against a stubbed page and return what it left behind.
 * @param {{ standalone?: boolean, innerWidth?: number, innerHeight?: number, screenHeight?: number }} page
 */
function run(page) {
  /** @type {Record<string, string>} */
  const props = {};
  const ctx = {
    navigator: page.standalone === undefined ? {} : { standalone: page.standalone },
    document: { documentElement: { style: { setProperty: (k, v) => { props[k] = v; } } } },
    fetch: () => new Promise(() => {}),
  };
  ctx.window = { innerWidth: page.innerWidth ?? 402, innerHeight: page.innerHeight ?? 812, screen: { height: page.screenHeight ?? 874 } };
  Object.assign(ctx.window, { navigator: ctx.navigator, document: ctx.document, fetch: ctx.fetch });
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: "pre-fetch.js" });
  return { props, launchShift: ctx.launchShift, booksPromise: ctx.window.booksPromise };
}

test("pre-fetch: books.json을 곧바로 받기 시작한다", () => {
  assert.ok(run({}).booksPromise instanceof Object);
});

test("launchShift: 홈 화면 앱의 세로 화면은 상태 표시줄의 절반만큼 올린다", () => {
  const { launchShift } = run({});
  // 402×874 화면에서 상태 표시줄 62px 아래부터 그린다
  assert.strictEqual(launchShift(true, 402, 812, 874), 31);
  assert.strictEqual(launchShift(true, 390, 797, 844), 23.5);
});

test("launchShift: 상태 표시줄 밑까지 그리거나, 브라우저이거나, 가로 화면이면 올리지 않는다", () => {
  const { launchShift } = run({});
  assert.strictEqual(launchShift(true, 402, 874, 874), 0);
  assert.strictEqual(launchShift(false, 402, 700, 874), 0);
  assert.strictEqual(launchShift(true, 874, 402, 874), 0);
  // 상태 표시줄로 볼 수 없는 차이(화면 크기를 아직 정하는 중)
  assert.strictEqual(launchShift(true, 402, 600, 874), 0);
});

test("pre-fetch: 홈 화면 앱이면 --launch-shift를 적고, 아니면 적지 않는다", () => {
  assert.deepStrictEqual({ ...run({ standalone: true }).props }, { "--launch-shift": "31px" });
  assert.deepStrictEqual({ ...run({ standalone: false, innerHeight: 700 }).props }, {});
  assert.deepStrictEqual({ ...run({ innerHeight: 700 }).props }, {});
});
