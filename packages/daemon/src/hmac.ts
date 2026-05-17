import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export interface SignedMsg {
  type: string;
  watch_id: string;
  nonce: number;
  hmac: string;
  [key: string]: unknown;
}

export function computeBodyHash(msg: Record<string, unknown>): string {
  const { hmac: _hmac, ...rest } = msg;
  const sorted = Object.fromEntries(Object.keys(rest).sort().map((k) => [k, rest[k]]));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

export function canonicalBytes(
  type: string,
  watchId: string,
  nonce: number,
  bodyHash: string,
): Buffer {
  return Buffer.from(`v1\n${type}\n${watchId}\n${nonce}\n${bodyHash}`);
}

export function computeHmac(secretHex: string, bytes: Buffer): string {
  return createHmac("sha256", Buffer.from(secretHex, "hex"))
    .update(bytes)
    .digest("hex");
}

export function verifyHmac(secretHex: string, bytes: Buffer, hmac: string): boolean {
  // Strict length check before any comparison — reject non-canonical inputs
  // immediately so there is no attacker-controlled padding path.
  if (!/^[0-9a-f]{64}$/.test(hmac)) return false;
  const expected = computeHmac(secretHex, bytes);
  // Both buffers are exactly 32 bytes; timingSafeEqual does a constant-time
  // comparison with no short-circuit. No string equality check here — that
  // would reintroduce a timing oracle.
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hmac, "hex"));
}

export function verifyAndAdvanceNonce(
  watch: { last_nonce: number; secret: string; id: string },
  msg: SignedMsg,
): boolean {
  if (msg.nonce <= watch.last_nonce) return false;

  const bodyHash = computeBodyHash(msg as Record<string, unknown>);
  const canonical = canonicalBytes(msg.type, watch.id, msg.nonce, bodyHash);
  if (!verifyHmac(watch.secret, canonical, msg.hmac)) return false;

  watch.last_nonce = msg.nonce;
  return true;
}
