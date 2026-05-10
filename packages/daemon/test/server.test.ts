import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Queue } from "../src/queue.js";
import { startServer, RunningServer } from "../src/server.js";
import type { Logger } from "../src/logger.js";

const noopLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

let queue: Queue;
let running: RunningServer;
let base: string;

beforeEach(async () => {
  queue = new Queue();
  running = await startServer({ queue, logger: noopLogger, port: 0 });
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

describe("daemon HTTP server", () => {
  it("POST /pending enqueues and returns id + permissionRules", async () => {
    const res = await post("/pending", {
      session_id: "s1",
      transcript_path: "/tmp/x.jsonl",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: string; permissionRules: string[] };
    expect(j.id).toBeTypeOf("string");
    expect(j.permissionRules).toEqual(["Bash(echo hi)"]);
    expect(queue.findByRequestId(j.id)).toBeDefined();
  });

  it("POST /pending rejects malformed body", async () => {
    const res = await post("/pending", { wrong: true });
    expect(res.status).toBe(400);
  });

  it("end-to-end: POST decision resolves long-poll", async () => {
    const enq = await post("/pending", {
      session_id: "s1",
      transcript_path: "/tmp/x",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enq.json()) as { id: string };

    const pollPromise = get(`/pending/${id}/decision?wait=2000`);
    // Inject decision shortly after
    setTimeout(() => {
      void post(`/pending/${id}/decision`, { decision: "always" });
    }, 50);
    const pollRes = await pollPromise;
    expect(pollRes.status).toBe(200);
    const body = (await pollRes.json()) as {
      kind: string;
      permissionRules: string[];
    };
    expect(body.kind).toBe("always");
    expect(body.permissionRules).toEqual(["Bash(ls)"]);
  });

  it("POST /pending/:id/local-resolved → long-poll returns 404", async () => {
    const enq = await post("/pending", {
      session_id: "s1",
      transcript_path: "/tmp/x",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enq.json()) as { id: string };
    const pollPromise = get(`/pending/${id}/decision?wait=2000`);
    setTimeout(() => {
      void post(`/pending/${id}/local-resolved`);
    }, 30);
    const res = await pollPromise;
    expect(res.status).toBe(404);
  });

  it("long-poll returns 204 on timeout", async () => {
    const enq = await post("/pending", {
      session_id: "s1",
      transcript_path: "/tmp/x",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enq.json()) as { id: string };
    const res = await get(`/pending/${id}/decision?wait=50`);
    expect(res.status).toBe(204);
  });

  it("GET /status returns daemon snapshot", async () => {
    const res = await get("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { daemon_pid: number; pending: unknown[] };
    expect(body.daemon_pid).toBe(process.pid);
    expect(Array.isArray(body.pending)).toBe(true);
  });

  it("unknown route returns 404", async () => {
    const res = await get("/nope");
    expect(res.status).toBe(404);
  });

  it("GET decision for unknown id returns 404 (not 204)", async () => {
    const res = await get(
      "/pending/00000000-0000-0000-0000-000000000000/decision?wait=50",
    );
    expect(res.status).toBe(404);
  });

  it("POST decision twice returns 204 then 409 (idempotent resolve)", async () => {
    const enq = await post("/pending", {
      session_id: "s1",
      transcript_path: "/tmp/x",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enq.json()) as { id: string };
    const r1 = await post(`/pending/${id}/decision`, { decision: "approve" });
    expect(r1.status).toBe(204);
    const r2 = await post(`/pending/${id}/decision`, { decision: "approve" });
    expect(r2.status).toBe(409);
  });

  it("POST decision for unknown id returns 404", async () => {
    const res = await post("/pending/00000000-0000-0000-0000-000000000000/decision", {
      decision: "approve",
    });
    expect(res.status).toBe(404);
  });
});
