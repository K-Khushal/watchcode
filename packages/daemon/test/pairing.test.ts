import { describe, it, expect, beforeEach } from "vitest";
import {
  PairingManager,
  formatPairingCode,
} from "../src/pairing.js";

describe("formatPairingCode", () => {
  it("formats a 6-digit number as XXX-XXX", () => {
    expect(formatPairingCode(482159)).toBe("482-159");
  });

  it("zero-pads to 6 digits", () => {
    expect(formatPairingCode(1)).toBe("000-001");
    expect(formatPairingCode(1000)).toBe("001-000");
    expect(formatPairingCode(0)).toBe("000-000");
  });

  it("max 6-digit value 999999", () => {
    expect(formatPairingCode(999999)).toBe("999-999");
  });
});

describe("PairingManager", () => {
  let now: { ms: number };
  let manager: PairingManager;

  beforeEach(() => {
    now = { ms: 1_000_000 };
    manager = new PairingManager(() => now.ms);
  });

  it("beginPairing returns a session with a code matching /^\\d{3}-\\d{3}$/", () => {
    const session = manager.beginPairing();
    expect(session.code).toMatch(/^\d{3}-\d{3}$/);
  });

  it("beginPairing session is active immediately", () => {
    const session = manager.beginPairing();
    expect(session.expiresAt).toBeGreaterThan(now.ms);
  });

  it("completePairing returns null when no active session", () => {
    expect(manager.completePairing("123-456", "Watch A")).toBeNull();
  });

  it("completePairing returns null for wrong code", () => {
    const session = manager.beginPairing();
    const wrongCode = session.code === "000-000" ? "000-001" : "000-000";
    expect(manager.completePairing(wrongCode, "Watch A")).toBeNull();
  });

  it("completePairing succeeds with correct code and returns watch entry", () => {
    const session = manager.beginPairing();
    const watch = manager.completePairing(session.code, "Galaxy Watch 6");
    expect(watch).not.toBeNull();
    expect(watch!.name).toBe("Galaxy Watch 6");
    expect(watch!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(watch!.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(watch!.last_nonce).toBe(0);
  });

  it("completePairing can only be used once (session consumed)", () => {
    const session = manager.beginPairing();
    const first = manager.completePairing(session.code, "Watch 1");
    const second = manager.completePairing(session.code, "Watch 2");
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("completePairing returns null after 60-second window expires", () => {
    const session = manager.beginPairing();
    now.ms += 60_001;
    expect(manager.completePairing(session.code, "Watch A")).toBeNull();
  });

  it("beginPairing replaces an existing unexpired session (idempotent restart)", () => {
    const s1 = manager.beginPairing();
    const s2 = manager.beginPairing();
    if (s1.code !== s2.code) {
      expect(manager.completePairing(s1.code, "W")).toBeNull();
    }
    expect(manager.completePairing(s2.code, "W")).not.toBeNull();
  });

  it("getStatus returns null when no active session", () => {
    expect(manager.getStatus()).toBeNull();
  });

  it("getStatus returns remaining seconds during active window", () => {
    manager.beginPairing();
    now.ms += 10_000;
    const status = manager.getStatus();
    expect(status).not.toBeNull();
    expect(status!.secondsRemaining).toBe(50);
  });

  it("getStatus returns null after window expires", () => {
    manager.beginPairing();
    now.ms += 60_001;
    expect(manager.getStatus()).toBeNull();
  });

  it("getStatus returns { active: false, completed: true } after successful pairing", () => {
    const session = manager.beginPairing();
    manager.completePairing(session.code, "Watch A");
    const status = manager.getStatus();
    expect(status).toEqual({ active: false, completed: true });
  });

  it("getStatus returns { active: true, code, secondsRemaining } during window", () => {
    manager.beginPairing();
    const status = manager.getStatus();
    expect(status).not.toBeNull();
    expect(status!.active).toBe(true);
    if (status?.active) {
      expect(status.code).toMatch(/^\d{3}-\d{3}$/);
      expect(status.secondsRemaining).toBe(60);
    }
  });
});
