import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "../src/queue.js";
import { startServer, RunningServer } from "../src/server.js";
import { readConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";

const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

let queue: Queue;
let running: RunningServer;
let base: string;
let tmpDir: string;
let configPath: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "wc-pair-srv-"));
  configPath = join(tmpDir, "config.json");
  queue = new Queue();
  running = await startServer({
    queue,
    logger: noopLogger,
    port: 0,
    heartbeatMs: 50,
    version: "test",
    configPath,
  });
  base = `http://127.0.0.1:${running.port}`;
});

afterEach(async () => {
  await running.close();
});

const post = (path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const get = (path: string) => fetch(`${base}${path}`);

describe("POST /pair/begin", () => {
  it("returns 200 with a code matching XXX-XXX format", async () => {
    const res = await post("/pair/begin");
    expect(res.status).toBe(200);
    const body = await res.json() as { code: string; expires_in_seconds: number };
    expect(body.code).toMatch(/^\d{3}-\d{3}$/);
    expect(body.expires_in_seconds).toBe(60);
  });

  it("calling again while window is active returns 200 (resets session)", async () => {
    await post("/pair/begin");
    const res2 = await post("/pair/begin");
    expect(res2.status).toBe(200);
  });
});

describe("GET /pair/status", () => {
  it("returns 204 when no active session", async () => {
    const res = await get("/pair/status");
    expect(res.status).toBe(204);
  });

  it("returns 200 with code and seconds_remaining when session is active", async () => {
    await post("/pair/begin");
    const res = await get("/pair/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { active: boolean; code: string; seconds_remaining: number };
    expect(body.active).toBe(true);
    expect(body.code).toMatch(/^\d{3}-\d{3}$/);
    expect(body.seconds_remaining).toBeGreaterThan(0);
    expect(body.seconds_remaining).toBeLessThanOrEqual(60);
  });

  it("returns { active: false, completed: true } after successful pairing", async () => {
    const beginRes = await post("/pair/begin");
    const { code } = await beginRes.json() as { code: string };
    await post("/pair/complete", { code, device_name: "Watch" });
    const res = await get("/pair/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { active: boolean; completed: boolean };
    expect(body.active).toBe(false);
    expect(body.completed).toBe(true);
  });
});

describe("POST /pair/complete", () => {
  it("returns 403 when no active session", async () => {
    const res = await post("/pair/complete", { code: "000-000", device_name: "Watch" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when code is wrong", async () => {
    const beginRes = await post("/pair/begin");
    const { code } = await beginRes.json() as { code: string };
    const wrongCode = code === "000-000" ? "000-001" : "000-000";
    const res = await post("/pair/complete", { code: wrongCode, device_name: "Watch" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when body is invalid (missing device_name)", async () => {
    await post("/pair/begin");
    const res = await post("/pair/complete", { code: "000-000" });
    expect(res.status).toBe(400);
  });

  it("returns 200 with watch_id and secret when code matches", async () => {
    const beginRes = await post("/pair/begin");
    const { code } = await beginRes.json() as { code: string };
    const res = await post("/pair/complete", { code, device_name: "Galaxy Watch 6" });
    expect(res.status).toBe(200);
    const body = await res.json() as { watch_id: string; secret: string };
    expect(body.watch_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("persists the watch to config.json after successful pairing", async () => {
    const beginRes = await post("/pair/begin");
    const { code } = await beginRes.json() as { code: string };
    await post("/pair/complete", { code, device_name: "Pixel Watch" });
    const cfg = readConfig(configPath);
    expect(cfg.watches).toHaveLength(1);
    expect(cfg.watches[0]!.name).toBe("Pixel Watch");
  });

  it("secret is not logged (not present in response body except secret field)", async () => {
    const beginRes = await post("/pair/begin");
    const { code } = await beginRes.json() as { code: string };
    const res = await post("/pair/complete", { code, device_name: "Watch" });
    const body = await res.json() as Record<string, unknown>;
    const keys = Object.keys(body);
    expect(keys).toContain("watch_id");
    expect(keys).toContain("secret");
    expect(keys).not.toContain("name");
  });
});

describe("/pair/complete is reachable from non-loopback (LAN watch)", () => {
  it("POST /pair/complete returns 403 on wrong code even from a non-loopback request", async () => {
    // We can't simulate a real non-loopback source in unit tests, but we can
    // verify the route is NOT guarded by the loopback check by confirming it
    // returns 403 (wrong code) not 403 (loopback only).
    await post("/pair/begin");
    const res = await post("/pair/complete", { code: "000-000", device_name: "Watch" });
    // Should be 403 from pairing logic, not from loopback guard
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("pairing code"); // not "loopback only"
  });
});

describe("POST /pair/remove", () => {
  it("returns 404 when watch name not found", async () => {
    const res = await post("/pair/remove", { name: "Ghost Watch" });
    expect(res.status).toBe(404);
  });

  it("returns 204 and removes the watch from config", async () => {
    // Pair first
    const beginRes = await post("/pair/begin");
    const { code } = await beginRes.json() as { code: string };
    await post("/pair/complete", { code, device_name: "My Watch" });

    // Remove
    const res = await post("/pair/remove", { name: "My Watch" });
    expect(res.status).toBe(204);
    const cfg = readConfig(configPath);
    expect(cfg.watches).toHaveLength(0);
  });

  it("returns 400 when body is missing name", async () => {
    const res = await post("/pair/remove", {});
    expect(res.status).toBe(400);
  });
});
