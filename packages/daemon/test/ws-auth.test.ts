import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "../src/queue.js";
import { startServer, RunningServer } from "../src/server.js";
import { computeBodyHash, canonicalBytes, computeHmac } from "../src/hmac.js";
import type { PairedWatch } from "../src/config.js";
import type { Logger } from "../src/logger.js";

const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const WATCH_ID = "11111111-1111-1111-1111-111111111111";
const SECRET = "a".repeat(64);

function buildConfig(watches: PairedWatch[]) {
  return JSON.stringify({ watches });
}

function buildWatch(overrides: Partial<PairedWatch> = {}): PairedWatch {
  return {
    id: WATCH_ID,
    name: "Test Watch",
    secret: SECRET,
    paired_at: new Date().toISOString(),
    last_seen: null,
    last_nonce: 0,
    ...overrides,
  };
}

function signHello(watchId: string, secret: string, nonce: number): object {
  const partial = { type: "client_hello", watch_id: watchId, protocol_version: 1, nonce };
  const hash = computeBodyHash(partial as Record<string, unknown>);
  const canonical = canonicalBytes("client_hello", watchId, nonce, hash);
  const hmac = computeHmac(secret, canonical);
  return { ...partial, hmac };
}

function signResponse(watchId: string, secret: string, nonce: number, requestId: string): object {
  const partial = { type: "approval_response", watch_id: watchId, request_id: requestId, decision: "approve", nonce };
  const hash = computeBodyHash(partial as Record<string, unknown>);
  const canonical = canonicalBytes("approval_response", watchId, nonce, hash);
  const hmac = computeHmac(secret, canonical);
  return { ...partial, hmac };
}

let queue: Queue;
let running: RunningServer;
let wsUrl: string;
let tmpDir: string;
let configPath: string;

const openWs = (): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });

const waitForClose = (ws: WebSocket): Promise<{ code: number; reason: string }> =>
  new Promise((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });

const nextMessage = (ws: WebSocket, predicate: (m: any) => boolean, timeoutMs = 1500): Promise<any> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener("message", onMsg);
      reject(new Error("timeout waiting for ws message"));
    }, timeoutMs);
    const onMsg = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener("message", onMsg);
          resolve(msg);
        }
      } catch { /* ignore */ }
    };
    ws.on("message", onMsg);
  });

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "wc-ws-auth-"));
  configPath = join(tmpDir, "config.json");
  writeFileSync(configPath, buildConfig([buildWatch()]));
  queue = new Queue();
  running = await startServer({
    queue,
    logger: noopLogger,
    port: 0,
    heartbeatMs: 50,
    version: "test",
    configPath,
  });
  wsUrl = `ws://127.0.0.1:${running.port}/ws`;
});

afterEach(async () => {
  await running.close();
});

describe("WS client_hello authentication", () => {
  it("connection is closed 4001 if no client_hello arrives within 5s", async () => {
    const ws = await openWs();
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  }, 7000);

  it("valid client_hello keeps connection open and heartbeat flows", async () => {
    const ws = await openWs();
    ws.send(JSON.stringify(signHello(WATCH_ID, SECRET, 1)));
    const beat = await nextMessage(ws, (m) => m.type === "daemon_status");
    expect(beat.version).toBe("test");
    ws.close();
  });

  it("client_hello with unknown watch_id is rejected 4001", async () => {
    const ws = await openWs();
    ws.send(JSON.stringify(signHello("22222222-2222-2222-2222-222222222222", SECRET, 1)));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  }, 7000);

  it("client_hello with bad HMAC is rejected 4001", async () => {
    const ws = await openWs();
    const badHello = { type: "client_hello", watch_id: WATCH_ID, protocol_version: 1, nonce: 1, hmac: "0".repeat(64) };
    ws.send(JSON.stringify(badHello));
    const { code } = await waitForClose(ws);
    expect(code).toBe(4001);
  }, 7000);
});

describe("WS replay protection and HMAC mismatch after auth", () => {
  it("replayed nonce is dropped but connection stays open", async () => {
    const ws = await openWs();
    ws.send(JSON.stringify(signHello(WATCH_ID, SECRET, 1)));
    // wait for heartbeat to confirm auth passed
    await nextMessage(ws, (m) => m.type === "daemon_status");

    // send a valid response then replay it
    const enqRes = await fetch(`http://127.0.0.1:${running.port}/pending`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: "s1", transcript_path: "/tmp/t.jsonl", cwd: "/x", tool_name: "Bash", tool_input: { command: "ls" } }),
    });
    const { id } = await enqRes.json() as { id: string };

    ws.send(JSON.stringify(signResponse(WATCH_ID, SECRET, 2, id)));
    await nextMessage(ws, (m) => m.type === "approval_resolved");

    // replay nonce=2
    ws.send(JSON.stringify(signResponse(WATCH_ID, SECRET, 2, id)));

    // heartbeat should still flow — connection is alive
    await nextMessage(ws, (m) => m.type === "daemon_status");
    ws.close();
  }, 5000);

  it("HMAC mismatch is dropped but connection stays open", async () => {
    const ws = await openWs();
    ws.send(JSON.stringify(signHello(WATCH_ID, SECRET, 1)));
    await nextMessage(ws, (m) => m.type === "daemon_status");

    // Send bad HMAC
    ws.send(JSON.stringify({
      type: "approval_response",
      watch_id: WATCH_ID,
      request_id: "11111111-1111-1111-1111-111111111111",
      decision: "approve",
      nonce: 99,
      hmac: "0".repeat(64),
    }));

    // connection still alive
    await nextMessage(ws, (m) => m.type === "daemon_status");
    ws.close();
  }, 5000);
});
