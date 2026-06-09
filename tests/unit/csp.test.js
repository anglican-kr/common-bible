// ── index.html CSP 인라인 해시 일관성 검증 ──────────────────────────────────
// Run with: node --test tests/unit/csp.test.js
//
// 인라인 <style>/<script> 블록을 수정하면 CSP의 sha256 해시도 갱신해야 한다.
// 잊으면 브라우저가 그 블록을 차단한다(스타일은 pre-paint CSS 미적용→FOUC,
// 스크립트는 미실행). 이 테스트는 index.html의 정적 인라인 블록 해시가 CSP
// style-src/script-src에 모두 존재하는지 단언해 갱신 누락을 CI에서 잡는다.
// (2026-06-09 인라인 <style> 해시 드리프트 사고 재발 방지 — scripts/csp_hashes.py
//  --fix로 자동 수정 가능.)
//
// 범위: 정적 인라인 블록만. src 있는 <script>·application/ld+json 등 비실행
// 스크립트는 제외. 인라인 이벤트 핸들러(onclick=)·style="" 속성은 다루지 않는다
// (현재 index.html엔 인라인 실행 스크립트·핸들러가 없음). CSP에 블록과 매칭 안
// 되는 잉여(stale) 해시가 있어도 실패시키지 않는다 — 기능/보안 문제는 "있어야 할
// 해시가 없는" 경우뿐이고, 잉여 해시 정리는 csp_hashes.py --check가 보고한다.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");

const sha = (s) => "sha256-" + crypto.createHash("sha256").update(s, "utf8").digest("base64");

// Comment-stripped copy for block scanning — a <script>/<style> mentioned inside
// an HTML comment (e.g. ADR-019 주석) is not a real tag and must not be hashed.
const SCAN = HTML.replace(/<!--[\s\S]*?-->/g, "");

// Return the set of `sha256-…` tokens in a CSP directive (style-src / script-src).
function cspHashes(directive) {
  const meta = HTML.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/);
  assert.ok(meta, "CSP meta tag not found in index.html");
  const d = meta[1].match(new RegExp(directive + "([^;]*)"));
  assert.ok(d, `CSP directive ${directive} not found`);
  return new Set(d[1].match(/sha256-[A-Za-z0-9+/=]+/g) || []);
}

function inlineStyleHashes() {
  return [...SCAN.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => sha(m[1]));
}

// Inline executable <script> blocks only: skip `src=` (external) and
// non-executable types (application/ld+json 등).
function inlineScriptHashes() {
  const EXEC = new Set(["", "text/javascript", "module", "application/javascript"]);
  const out = [];
  for (const m of SCAN.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    const t = m[1].match(/type\s*=\s*["']([^"']*)["']/);
    if (t && !EXEC.has(t[1].trim().toLowerCase())) continue;
    out.push(sha(m[2]));
  }
  return out;
}

// ── style-src ────────────────────────────────────────────────────────────────

test("모든 인라인 <style> 블록 해시가 CSP style-src에 있다", () => {
  const csp = cspHashes("style-src");
  const blocks = inlineStyleHashes();
  assert.ok(blocks.length > 0, "expected ≥1 inline <style> block in index.html");
  const missing = blocks.filter((h) => !csp.has(h));
  assert.deepEqual(missing, [], `style-src에 빠진 인라인 <style> 해시: ${missing}`);
});

// ── script-src ───────────────────────────────────────────────────────────────

test("모든 인라인 <script> 블록 해시가 CSP script-src에 있다", () => {
  const csp = cspHashes("script-src");
  const missing = inlineScriptHashes().filter((h) => !csp.has(h));
  assert.deepEqual(missing, [], `script-src에 빠진 인라인 <script> 해시: ${missing}`);
});
