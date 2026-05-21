import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
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

  it("approval_request broadcast carries project_name when .watchcode.json is found upward", async () => {
    const projRoot = mkdtempSync(join(tmpdir(), "wc-proj-"));
    try {
      const deep = join(projRoot, "src", "api");
      mkdirSync(deep, { recursive: true });
      writeFileSync(
        join(projRoot, ".watchcode.json"),
        JSON.stringify({ name: "Customer API" }),
      );

      // Subscribe a raw WS client to observe broadcasts (no auth required to
      // receive broadcasts; sending approval_response is what requires auth).
      const ws = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
      const received: unknown[] = [];
      ws.on("message", (buf) => received.push(JSON.parse(buf.toString())));
      await new Promise<void>((res) => ws.once("open", () => res()));

      const enq = await post("/pending", {
        session_id: "s-proj",
        transcript_path: "/tmp/x",
        cwd: deep,
        tool_name: "Bash",
        tool_input: { command: "ls" },
      });
      expect(enq.status).toBe(200);

      // Wait briefly for the broadcast frame to land
      await new Promise((r) => setTimeout(r, 50));
      ws.close();

      const req = received.find(
        (m): m is { type: string; session: { project_name?: string | null } } =>
          typeof m === "object" && m !== null && (m as { type?: string }).type === "approval_request",
      );
      expect(req).toBeDefined();
      expect(req!.session.project_name).toBe("Customer API");
    } finally {
      rmSync(projRoot, { recursive: true, force: true });
    }
  });

  it("approval_request broadcast has project_name=null when no .watchcode.json upward", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
    const received: unknown[] = [];
    ws.on("message", (buf) => received.push(JSON.parse(buf.toString())));
    await new Promise<void>((res) => ws.once("open", () => res()));

    await post("/pending", {
      session_id: "s-nope",
      transcript_path: "/tmp/x",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    await new Promise((r) => setTimeout(r, 50));
    ws.close();

    const req = received.find(
      (m): m is { type: string; session: { project_name?: string | null } } =>
        typeof m === "object" && m !== null && (m as { type?: string }).type === "approval_request",
    );
    expect(req).toBeDefined();
    expect(req!.session.project_name).toBeNull();
  });

  it("3 concurrent /pending calls coexist as distinct queue entries", async () => {
    const enqs = await Promise.all(
      [1, 2, 3].map((n) =>
        post("/pending", {
          session_id: `s${n}`,
          transcript_path: `/tmp/t${n}`,
          cwd: `/tmp/proj${n}`,
          tool_name: "Bash",
          tool_input: { command: `echo ${n}` },
        }),
      ),
    );
    const ids = await Promise.all(enqs.map((r) => r.json() as Promise<{ id: string }>));
    const unique = new Set(ids.map((x) => x.id));
    expect(unique.size).toBe(3);
    expect(queue.list().length).toBe(3);

    // Resolving one does NOT affect the others.
    await post(`/pending/${ids[0]!.id}/decision`, { decision: "approve" });
    expect(queue.list().length).toBe(2);
    expect(queue.findByRequestId(ids[1]!.id)).toBeDefined();
    expect(queue.findByRequestId(ids[2]!.id)).toBeDefined();
  });

  it("race: two POST decisions on same id — first wins (204), second is 409", async () => {
    const enq = await post("/pending", {
      session_id: "s-race",
      transcript_path: "/tmp/x",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enq.json()) as { id: string };
    const [a, b] = await Promise.all([
      post(`/pending/${id}/decision`, { decision: "approve" }),
      post(`/pending/${id}/decision`, { decision: "deny" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([204, 409]);
  });

  it("multi-watch: broadcast reaches all connected ws clients and approval_resolved fans out", async () => {
    const ws1 = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
    const ws2 = new WebSocket(`ws://127.0.0.1:${running.port}/ws`);
    const got1: unknown[] = [];
    const got2: unknown[] = [];
    ws1.on("message", (b) => got1.push(JSON.parse(b.toString())));
    ws2.on("message", (b) => got2.push(JSON.parse(b.toString())));
    await Promise.all([
      new Promise<void>((r) => ws1.once("open", () => r())),
      new Promise<void>((r) => ws2.once("open", () => r())),
    ]);

    const enq = await post("/pending", {
      session_id: "s-multi",
      transcript_path: "/tmp/x",
      cwd: "/tmp",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    const { id } = (await enq.json()) as { id: string };
    await new Promise((r) => setTimeout(r, 50));

    const hasReq = (arr: unknown[]) =>
      arr.some((m) => (m as { type?: string }).type === "approval_request");
    expect(hasReq(got1)).toBe(true);
    expect(hasReq(got2)).toBe(true);

    await post(`/pending/${id}/decision`, { decision: "approve" });
    await new Promise((r) => setTimeout(r, 50));

    const hasResolved = (arr: unknown[]) =>
      arr.some(
        (m) =>
          (m as { type?: string; request_id?: string }).type === "approval_resolved" &&
          (m as { request_id?: string }).request_id === id,
      );
    expect(hasResolved(got1)).toBe(true);
    expect(hasResolved(got2)).toBe(true);

    ws1.close();
    ws2.close();
  });
});
