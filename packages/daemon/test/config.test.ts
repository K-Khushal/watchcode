import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readConfig,
  writeConfig,
  findWatch,
  addWatch,
  removeWatch,
  type WatchcodeConfig,
  type PairedWatch,
} from "../src/config.js";

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "wc-config-"));
  configPath = join(tmpDir, "config.json");
});

const makeWatch = (overrides: Partial<PairedWatch> = {}): PairedWatch => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Galaxy Watch 6",
  secret: "a".repeat(64), // 32 bytes hex-encoded
  paired_at: new Date().toISOString(),
  last_seen: null,
  last_nonce: 0,
  ...overrides,
});

describe("readConfig", () => {
  it("returns empty watches array when file does not exist", () => {
    const cfg = readConfig(join(tmpDir, "nonexistent.json"));
    expect(cfg.watches).toEqual([]);
  });

  it("returns empty watches array for empty file", () => {
    writeFileSync(configPath, "");
    const cfg = readConfig(configPath);
    expect(cfg.watches).toEqual([]);
  });

  it("round-trips all watch fields correctly", () => {
    const watch = makeWatch();
    const cfg: WatchcodeConfig = { watches: [watch] };
    writeConfig(configPath, cfg);
    const loaded = readConfig(configPath);
    expect(loaded.watches).toHaveLength(1);
    expect(loaded.watches[0]).toEqual(watch);
  });

  it("throws on invalid config (missing required field)", () => {
    writeFileSync(configPath, JSON.stringify({ watches: [{ id: "bad" }] }));
    expect(() => readConfig(configPath)).toThrow();
  });
});

describe("writeConfig", () => {
  it("writes valid JSON that can be parsed back", () => {
    const watch = makeWatch();
    writeConfig(configPath, { watches: [watch] });
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.watches[0].id).toBe(watch.id);
  });

  it("never writes the secret into a log-safe snapshot (secret is present in file)", () => {
    // The secret IS persisted to config.json — that is correct.
    // The test ensures the value is the full secret, not redacted.
    const watch = makeWatch({ secret: "b".repeat(64) });
    writeConfig(configPath, { watches: [watch] });
    const raw = readFileSync(configPath, "utf8");
    expect(raw).toContain("b".repeat(64));
  });
});

describe("findWatch", () => {
  it("finds by id", () => {
    const watch = makeWatch();
    const cfg: WatchcodeConfig = { watches: [watch] };
    expect(findWatch(cfg, watch.id)).toBe(watch);
  });

  it("returns undefined for unknown id", () => {
    expect(findWatch({ watches: [] }, "unknown")).toBeUndefined();
  });
});

describe("addWatch / removeWatch", () => {
  it("addWatch appends and persists", () => {
    const watch = makeWatch();
    const cfg = readConfig(configPath);
    addWatch(configPath, cfg, watch);
    const reloaded = readConfig(configPath);
    expect(reloaded.watches).toHaveLength(1);
    expect(reloaded.watches[0]!.id).toBe(watch.id);
  });

  it("removeWatch removes by name (case-sensitive) and persists", () => {
    const w1 = makeWatch({ id: "11111111-1111-1111-1111-111111111111", name: "Watch A" });
    const w2 = makeWatch({ id: "22222222-2222-2222-2222-222222222222", name: "Watch B" });
    writeConfig(configPath, { watches: [w1, w2] });
    const cfg = readConfig(configPath);
    const removed = removeWatch(configPath, cfg, "Watch A");
    expect(removed).toBe(true);
    const reloaded = readConfig(configPath);
    expect(reloaded.watches).toHaveLength(1);
    expect(reloaded.watches[0]!.name).toBe("Watch B");
  });

  it("removeWatch returns false when name not found", () => {
    const cfg = readConfig(configPath);
    expect(removeWatch(configPath, cfg, "Ghost Watch")).toBe(false);
  });
});
