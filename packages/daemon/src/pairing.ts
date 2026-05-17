import { randomBytes, randomInt } from "node:crypto";
import { randomUUID } from "node:crypto";
import { PAIRING_WINDOW_MS } from "@watchcode/shared";
import type { PairedWatch } from "./config.js";

export interface PairingSession {
  code: string;
  watch_id: string;
  secret: string;
  expiresAt: number;
  completed: boolean;
}

export type PairingStatus =
  | { active: true; code: string; secondsRemaining: number }
  | { active: false; completed: true };

export function formatPairingCode(n: number): string {
  const s = String(n).padStart(6, "0");
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export class PairingManager {
  private session: PairingSession | null = null;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  beginPairing(): PairingSession {
    // randomInt(1, 1_000_000) → [1, 999_999]: excludes 000-000 (all-zeros is
    // trivially guessable and should never be a valid pairing code).
    const code = formatPairingCode(randomInt(1, 1_000_000));
    const session: PairingSession = {
      code,
      watch_id: randomUUID(),
      secret: randomBytes(32).toString("hex"),
      expiresAt: this.now() + PAIRING_WINDOW_MS,
      completed: false,
    };
    this.session = session;
    return session;
  }

  completePairing(code: string, deviceName: string): PairedWatch | null {
    const s = this.session;
    if (!s || s.completed || this.now() > s.expiresAt) return null;
    if (s.code !== code) return null;

    s.completed = true;
    return {
      id: s.watch_id,
      name: deviceName,
      secret: s.secret,
      paired_at: new Date().toISOString(),
      last_seen: null,
      last_nonce: 0,
    };
  }

  getStatus(): PairingStatus | null {
    const s = this.session;
    if (!s) return null;
    // Return a distinguishable "completed" status so the CLI can tell success
    // from expiry — both cause the session to become inactive, but the CLI
    // needs to know which happened.
    if (s.completed) return { active: false, completed: true };
    const remaining = s.expiresAt - this.now();
    if (remaining <= 0) return null; // expired
    return { active: true, code: s.code, secondsRemaining: Math.ceil(remaining / 1000) };
  }
}
