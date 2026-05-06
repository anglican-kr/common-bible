// ── refresh-store.js unit tests ─────────────────────────────────────────────
// Run with: node --test tests/unit/refresh-store.test.js
//
// Each test loads a fresh refresh-store via loadRefreshStore() so the in-memory
// fake IDB is isolated. Real Node Web Crypto is used for AES-GCM so the
// extractable: false guarantee and round-trip semantics are genuinely
// exercised, not stubbed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRefreshStore } from "./harness.js";

const DB_NAME = "bible-drive-sync";
const KEYS_STORE = "keys";
const TOKENS_STORE = "tokens";
const KEY_ID = "aes";
const TOKEN_ID = "refresh";

// ── 기본 round-trip ──────────────────────────────────────────────────────────

test("1. save → load round-trip이 원문을 복원한다", async () => {
  const { store } = loadRefreshStore();
  await store.saveRefreshToken("rt-abc-123");
  const loaded = await store.loadRefreshToken();
  assert.equal(loaded, "rt-abc-123");
});

test("2. 토큰 미저장 상태에서 load → null", async () => {
  const { store } = loadRefreshStore();
  const loaded = await store.loadRefreshToken();
  assert.equal(loaded, null);
});

test("3. clear 후 load → null", async () => {
  const { store } = loadRefreshStore();
  await store.saveRefreshToken("rt-abc-123");
  await store.clearRefreshToken();
  const loaded = await store.loadRefreshToken();
  assert.equal(loaded, null);
});

test("4. save를 두 번 하면 두 번째 값이 우선", async () => {
  const { store } = loadRefreshStore();
  await store.saveRefreshToken("rt-old");
  await store.saveRefreshToken("rt-new");
  assert.equal(await store.loadRefreshToken(), "rt-new");
});

// ── 키 비추출성 (extractable: false) ─────────────────────────────────────────

test("5. 저장된 AES-GCM 키는 extractable === false (XSS 방어 모델 핵심)", async () => {
  const { store, peek } = loadRefreshStore();
  await store.saveRefreshToken("rt-anything");
  const keyMap = peek(DB_NAME, KEYS_STORE);
  const storedKey = keyMap.get(KEY_ID);
  assert.ok(storedKey, "키가 저장돼 있어야 함");
  assert.equal(storedKey.extractable, false, "키가 export 가능하면 보안 모델 무너짐");
});

test("6. 비추출 키는 subtle.exportKey 호출 시 거부된다", async () => {
  const { store, peek } = loadRefreshStore();
  await store.saveRefreshToken("rt-x");
  const storedKey = peek(DB_NAME, KEYS_STORE).get(KEY_ID);
  await assert.rejects(
    () => globalThis.crypto.subtle.exportKey("raw", storedKey),
    "extractable: false 키는 export 시 InvalidAccessError를 던져야 함",
  );
});

// ── IV 유일성 (AES-GCM nonce 재사용 방지) ────────────────────────────────────

test("7. 같은 평문을 두 번 암호화해도 ciphertext와 IV가 매번 달라진다", async () => {
  const { store, peek } = loadRefreshStore();
  await store.saveRefreshToken("rt-same");
  const tokensMap = peek(DB_NAME, TOKENS_STORE);
  const r1 = tokensMap.get(TOKEN_ID);
  // Snapshot before second save
  const iv1 = new Uint8Array(r1.iv);
  const ct1 = new Uint8Array(r1.ciphertext);

  await store.saveRefreshToken("rt-same");
  const r2 = tokensMap.get(TOKEN_ID);
  const iv2 = new Uint8Array(r2.iv);
  const ct2 = new Uint8Array(r2.ciphertext);

  assert.notDeepEqual(Array.from(iv1), Array.from(iv2), "IV가 매번 새로 생성돼야 함");
  assert.notDeepEqual(Array.from(ct1), Array.from(ct2), "ciphertext도 IV와 함께 달라져야 함");
});

test("8. IV 길이는 12바이트 (AES-GCM 표준)", async () => {
  const { store, peek } = loadRefreshStore();
  await store.saveRefreshToken("rt-x");
  const record = peek(DB_NAME, TOKENS_STORE).get(TOKEN_ID);
  const iv = new Uint8Array(record.iv);
  assert.equal(iv.length, 12);
});

// ── 손상 복구 (decrypt 실패 시 null + 레코드 삭제) ──────────────────────────

test("9. ciphertext 손상 → load는 null, 손상 레코드 자동 삭제", async () => {
  const { store, peek } = loadRefreshStore();
  await store.saveRefreshToken("rt-original");

  // Tamper directly with the IDB-backing map — simulates partial wipe / key
  // regeneration / cross-version corruption that Phase 2i guards against.
  const tokensMap = peek(DB_NAME, TOKENS_STORE);
  const record = tokensMap.get(TOKEN_ID);
  const tampered = new Uint8Array(record.ciphertext);
  tampered[0] ^= 0xff;
  tokensMap.set(TOKEN_ID, { iv: record.iv, ciphertext: tampered.buffer });

  const loaded = await store.loadRefreshToken();
  assert.equal(loaded, null, "복호화 실패 시 null 반환");
  assert.equal(tokensMap.has(TOKEN_ID), false, "손상 레코드는 자동 삭제 (재시도 루프 방지)");
});

test("10. 손상 → 삭제 후 다시 save 가능 (자가 복구 흐름)", async () => {
  const { store, peek } = loadRefreshStore();
  await store.saveRefreshToken("rt-original");
  const tokensMap = peek(DB_NAME, TOKENS_STORE);
  const record = tokensMap.get(TOKEN_ID);
  const tampered = new Uint8Array(record.ciphertext);
  tampered[0] ^= 0xff;
  tokensMap.set(TOKEN_ID, { iv: record.iv, ciphertext: tampered.buffer });

  // First load triggers cleanup
  assert.equal(await store.loadRefreshToken(), null);

  // After re-auth in production the new refresh token can be saved cleanly
  await store.saveRefreshToken("rt-fresh");
  assert.equal(await store.loadRefreshToken(), "rt-fresh");
});

// ── 키 영속성 (다중 호출 간 같은 키 재사용) ─────────────────────────────────

test("11. 동일 인스턴스에서 save 여러 번 호출해도 키는 한 번만 생성", async () => {
  const { store, peek } = loadRefreshStore();
  await store.saveRefreshToken("a");
  const keyAfter1 = peek(DB_NAME, KEYS_STORE).get(KEY_ID);
  await store.saveRefreshToken("b");
  const keyAfter2 = peek(DB_NAME, KEYS_STORE).get(KEY_ID);
  assert.strictEqual(keyAfter1, keyAfter2, "같은 키 객체가 재사용돼야 함");
});

// ── 빈 문자열 / 큰 페이로드 경계 ─────────────────────────────────────────────

test("12. 빈 문자열도 round-trip 정상", async () => {
  const { store } = loadRefreshStore();
  await store.saveRefreshToken("");
  assert.equal(await store.loadRefreshToken(), "");
});

test("13. 긴 토큰(2KB)도 round-trip 정상", async () => {
  const { store } = loadRefreshStore();
  const big = "x".repeat(2048);
  await store.saveRefreshToken(big);
  assert.equal(await store.loadRefreshToken(), big);
});
