import { describe, it, expect } from "vitest";
import { createHmac, createHash } from "node:crypto";
import {
  canonicalBytes,
  computeBodyHash,
  computeHmac,
  verifyHmac,
  verifyAndAdvanceNonce,
  type SignedMsg,
} from "../src/hmac.js";
import type { PairedWatch } from "../src/config.js";

// 32-byte secret in hex (64 hex chars)
const SECRET = "a".repeat(64);

function makeWatch(lastNonce = 0): PairedWatch {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Test Watch",
    secret: SECRET,
    paired_at: new Date().toISOString(),
    last_seen: null,
    last_nonce: lastNonce,
  };
}

describe("computeBodyHash", () => {
  it("returns lowercase hex SHA-256 of body with keys sorted and hmac excluded", () => {
    const body = { type: "client_hello", watch_id: "abc", nonce: 1, hmac: "deadbeef" };
    // Sorted keys after removing hmac: nonce, type, watch_id
    const sorted = { nonce: 1, type: "client_hello", watch_id: "abc" };
    const expected = createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
    expect(computeBodyHash(body)).toBe(expected);
  });

  it("two objects with same content but different hmac field produce same hash", () => {
    const a = { type: "approval_response", request_id: "x", decision: "approve", nonce: 5, hmac: "aaa" };
    const b = { type: "approval_response", request_id: "x", decision: "approve", nonce: 5, hmac: "bbb" };
    expect(computeBodyHash(a)).toBe(computeBodyHash(b));
  });

  it("key order in input does not affect hash (deterministic)", () => {
    const a = { type: "t", nonce: 1, watch_id: "w" };
    const b = { watch_id: "w", type: "t", nonce: 1 };
    expect(computeBodyHash(a)).toBe(computeBodyHash(b));
  });
});

describe("canonicalBytes", () => {
  it("produces v1\\n<type>\\n<watch_id>\\n<nonce>\\n<body_hash> format", () => {
    const bodyHash = "c".repeat(64);
    const result = canonicalBytes("client_hello", "watch-123", 7, bodyHash);
    const expected = Buffer.from(`v1\nclient_hello\nwatch-123\n7\n${"c".repeat(64)}`);
    expect(result).toEqual(expected);
  });

  it("nonce 0 is valid", () => {
    const result = canonicalBytes("approval_response", "w", 0, "d".repeat(64));
    expect(result.toString()).toContain("\n0\n");
  });
});

describe("computeHmac", () => {
  it("returns lowercase 64-char hex HMAC-SHA256", () => {
    const bytes = canonicalBytes("client_hello", "w", 1, "e".repeat(64));
    const result = computeHmac(SECRET, bytes);
    expect(result).toMatch(/^[0-9a-f]{64}$/);

    const expected = createHmac("sha256", Buffer.from(SECRET, "hex"))
      .update(bytes)
      .digest("hex");
    expect(result).toBe(expected);
  });
});

describe("verifyHmac", () => {
  it("returns true when HMAC matches", () => {
    const bytes = canonicalBytes("client_hello", "w", 1, "f".repeat(64));
    const hmac = computeHmac(SECRET, bytes);
    expect(verifyHmac(SECRET, bytes, hmac)).toBe(true);
  });

  it("returns false when HMAC is wrong", () => {
    const bytes = canonicalBytes("client_hello", "w", 1, "f".repeat(64));
    expect(verifyHmac(SECRET, bytes, "0".repeat(64))).toBe(false);
  });

  it("returns false when secret is wrong", () => {
    const bytes = canonicalBytes("client_hello", "w", 1, "f".repeat(64));
    const hmac = computeHmac(SECRET, bytes);
    const wrongSecret = "b".repeat(64);
    expect(verifyHmac(wrongSecret, bytes, hmac)).toBe(false);
  });

  it("uses constant-time comparison — no string equality short-circuit", () => {
    const bytes = canonicalBytes("client_hello", "w", 1, "f".repeat(64));
    // Correct HMAC but wrong length → rejected before any comparison.
    expect(verifyHmac(SECRET, bytes, "a".repeat(63))).toBe(false);
    expect(verifyHmac(SECRET, bytes, "a".repeat(65))).toBe(false);
    expect(verifyHmac(SECRET, bytes, "")).toBe(false);
    // Non-hex chars → rejected.
    expect(verifyHmac(SECRET, bytes, "G".repeat(64))).toBe(false);
    // Valid wrong value doesn't throw.
    expect(verifyHmac(SECRET, bytes, "0".repeat(64))).toBe(false);
  });
});

describe("verifyAndAdvanceNonce", () => {
  it("returns true and mutates last_nonce when message is valid", () => {
    const watch = makeWatch(0);
    const msg: SignedMsg = buildMsg(watch, "client_hello", 1);
    expect(verifyAndAdvanceNonce(watch, msg)).toBe(true);
    expect(watch.last_nonce).toBe(1);
  });

  it("returns false for replayed nonce (nonce === last_nonce)", () => {
    const watch = makeWatch(5);
    const msg: SignedMsg = buildMsg(watch, "approval_response", 5);
    expect(verifyAndAdvanceNonce(watch, msg)).toBe(false);
    expect(watch.last_nonce).toBe(5); // unchanged
  });

  it("returns false for nonce < last_nonce", () => {
    const watch = makeWatch(10);
    const msg: SignedMsg = buildMsg(watch, "approval_response", 3);
    expect(verifyAndAdvanceNonce(watch, msg)).toBe(false);
    expect(watch.last_nonce).toBe(10);
  });

  it("returns false for HMAC mismatch, does not advance nonce", () => {
    const watch = makeWatch(0);
    const msg: SignedMsg = { type: "client_hello", watch_id: watch.id, nonce: 1, hmac: "0".repeat(64) };
    expect(verifyAndAdvanceNonce(watch, msg)).toBe(false);
    expect(watch.last_nonce).toBe(0);
  });
});

// Helper: build a correctly signed message for a given watch + type + nonce.
function buildMsg(watch: PairedWatch, type: string, nonce: number): SignedMsg {
  const partial = { type, watch_id: watch.id, nonce };
  const bodyHash = computeBodyHash(partial);
  const canonical = canonicalBytes(type, watch.id, nonce, bodyHash);
  const hmac = computeHmac(watch.secret, canonical);
  return { ...partial, hmac } as SignedMsg;
}
