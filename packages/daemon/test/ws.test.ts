import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "../src/queue.js";
import { startServer, RunningServer } from "../src/server.js";
import { computeBodyHash, canonicalBytes, computeHmac } from "../src/hmac.js";
import type { Logger } from "../src/logger.js";

const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const WATCH_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SECRET = "b".repeat(64);

function buildConfigJson() {
  return JSON.stringify({
    watches: [{
      id: WATCH_ID,
      name: "Test Watch",
      secret: SECRET,
      paired_at: new Date().toISOString(),
      last_seen: null,
      last_nonce: 0,
    }],
  });
}

function signHello(nonce: number): object {
  const partial = { type: "client_hello", watch_id: WATCH_ID, protocol_version: 1, nonce };
  const hash = computeBodyHash(partial as Record<string, unknown>);
  const canonical = canonicalBytes("client_hello", WATCH_ID, nonce, hash);
  const hmac = computeHmac(SECRET, canonical);
  return { ...partial, hmac };
}

let nonceCounter = 1;

let queue: Queue;
let running: RunningServer;
let base: string;
let wsUrl: string;
let tmpDir: string;
let configPath: string;

beforeEach(async () => {
  nonceCounter = 1;
  tmpDir = mkdtempSync(join(tmpdir(), "wc-ws-"));
  configPath = join(tmpDir, "config.json");
  writeFileSync(configPath, buildConfigJson());
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
  wsUrl = `ws://127.0.0.1:${running.port}/ws`;
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

const openWs = (): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.once("open", () => {
      ws.send(JSON.stringify(signHello(nonceCounter++)));
      resolve(ws);
    });
    ws.once("error", reject);
  });

const nextMessage = (ws: WebSocket, predicate: (m: any) => boolean): Promise<any> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener("message", onMessage);
      reject(new Error("timeout waiting for ws message"));
    }, 2000);
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener("message", onMessage);
          resolve(msg);
        }
      } catch {
        // ignore
      }
    };
    ws.on("message", onMessage);
  });

const transcriptWith = (slug: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), "wc-ws-"));
  const path = join(dir, "t.jsonl");
  const lines = slug ? [{ slug }] : [{ type: "queue-operation" }];
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
};

describe("daemon WebSocket fan-out", () => {
  it("emits daemon_status heartbeat to connected clients", async () => {
    const ws = await openWs();
    const heartbeat = await nextMessage(ws, (m) => m.type === "daemon_status");
    expect(heartbeat.version).toBe("test");
    expect(typeof heartbeat.active_sessions).toBe("number");
    expect(typeof heartbeat.pending_count).toBe("number");
    ws.close();
  });

  it("broadcasts approval_request to all watches when /pending arrives", async () => {
    const w1 = await openWs();
    const w2 = await openWs();

    const tpath = transcriptWith("inherited-napping-eagle");
    const enq = post("/pending", {
      session_id: "s1",
      transcript_path: tpath,
      cwd: "/home/me/cool-project",
      tool_name: "Bash",
      tool_input: { command: "echo hi", description: "Print hi" },
    });

    const m1 = await nextMessage(w1, (m) => m.type === "approval_request");
    const m2 = await nextMessage(w2, (m) => m.type === "approval_request");
    await enq;

    expect(m1.id).toBe(m2.id);
    expect(m1.session.slug).toBe("inherited-napping-eagle");
    expect(m1.session.cwd_basename).toBe("cool-project");
    expect(m1.tool.name).toBe("Bash");
    expect(m1.tool.title).toContain("Print hi");
    expect(typeof m1.tool.body).toBe("string");
    expect(m1.timestamp).toMatch(/T/);

    w1.close();
    w2.close();
  });

  it("falls back to cwd_basename when transcript has no slug", async () => {
    const ws = await openWs();
    const tpath = transcriptWith(null);
    void post("/pending", {
      session_id: "s2",
      transcript_path: tpath,
      cwd: "/projects/widgets",
      tool_name: "Edit",
      tool_input: { file_path: "/projects/widgets/index.ts" },
    });
    const m = await nextMessage(ws, (mm) => mm.type === "approval_request");
    expect(m.session.slug).toBeNull();
    expect(m.session.cwd_basename).toBe("widgets");
    ws.close();
  });

  it("truncates long body with ellipsis at ~300 chars", async () => {
    const ws = await openWs();
    const longCmd = "x".repeat(2_000);
    void post("/pending", {
      session_id: "s3",
      transcript_path: transcriptWith(null),
      cwd: "/x/y",
      tool_name: "Bash",
      tool_input: { command: longCmd },
    });
    const m = await nextMessage(ws, (mm) => mm.type === "approval_request");
    expect(m.tool.body.length).toBeLessThanOrEqual(301);
    expect(m.tool.body.endsWith("…")).toBe(true);
    ws.close();
  });

  it("watch responds via WS approval_response → daemon resolves and broadcasts approval_resolved", async () => {
    const ws = await openWs();
    const tpath = transcriptWith("aaa-bbb-ccc");

    const enqRes = await post("/pending", {
      session_id: "s4",
      transcript_path: tpath,
      cwd: "/x",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enqRes.json()) as { id: string };

    // Hook is long-polling
    const longPoll = fetch(`${base}/pending/${id}/decision?wait=2000`);

    // Approval responses require HMAC signing in Slice 4.
    const nonce = nonceCounter++;
    const partial = { type: "approval_response", watch_id: WATCH_ID, request_id: id, decision: "always", nonce };
    const hash = computeBodyHash(partial as Record<string, unknown>);
    const canonical = canonicalBytes("approval_response", WATCH_ID, nonce, hash);
    const hmac = computeHmac(SECRET, canonical);
    ws.send(JSON.stringify({ ...partial, hmac }));

    const resolved = await nextMessage(ws, (m) => m.type === "approval_resolved");
    expect(resolved.request_id).toBe(id);
    expect(resolved.resolved_by).toBe("watch");
    expect(resolved.decision).toBe("always");

    const pollRes = await longPoll;
    expect(pollRes.status).toBe(200);
    const pollBody = (await pollRes.json()) as { kind: string; permissionRules: string[] };
    expect(pollBody.kind).toBe("always");
    expect(pollBody.permissionRules).toEqual(["Bash(ls)"]);

    ws.close();
  });

  it("local response (HTTP /local-resolved) broadcasts approval_resolved to watches", async () => {
    const ws = await openWs();
    const tpath = transcriptWith(null);

    const enqRes = await post("/pending", {
      session_id: "s5",
      transcript_path: tpath,
      cwd: "/x",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enqRes.json()) as { id: string };

    void post(`/pending/${id}/local-resolved`);
    const resolved = await nextMessage(ws, (m) => m.type === "approval_resolved");
    expect(resolved.request_id).toBe(id);
    expect(resolved.resolved_by).toBe("local");
    ws.close();
  });

  it("malformed approval_response is ignored (does not crash, no resolve)", async () => {
    const ws = await openWs();
    const tpath = transcriptWith(null);
    const enqRes = await post("/pending", {
      session_id: "s6",
      transcript_path: tpath,
      cwd: "/x",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enqRes.json()) as { id: string };

    ws.send("not json at all");
    ws.send(JSON.stringify({ type: "garbage" }));
    ws.send(JSON.stringify({ type: "approval_response", request_id: id })); // missing decision

    // Heartbeats keep flowing → connection stays alive
    await nextMessage(ws, (m) => m.type === "daemon_status");
    expect(queue.state(id)).toBe("pending");
    ws.close();
  });
});
