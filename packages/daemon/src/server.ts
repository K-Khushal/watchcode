import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Queue, PendingApproval } from "./queue.js";
import { buildPermissionRules, buildTitle } from "./rules.js";
import { Logger } from "./logger.js";
import {
  DAEMON_HOST,
  DAEMON_PORT,
  HOOK_LONGPOLL_TIMEOUT_MS,
  DaemonDecision,
} from "@watchcode/shared";

export interface ServerDeps {
  queue: Queue;
  logger: Logger;
  port?: number;
  host?: string;
  version?: string;
}

export interface RunningServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1"
  );
}

interface PendingPostBody {
  session_id: string;
  transcript_path: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

function isPendingBody(x: unknown): x is PendingPostBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.session_id === "string" &&
    typeof o.transcript_path === "string" &&
    typeof o.cwd === "string" &&
    typeof o.tool_name === "string" &&
    typeof o.tool_input === "object" &&
    o.tool_input !== null
  );
}

interface DecisionPostBody {
  decision: "approve" | "always" | "deny";
  permissionRules?: string[];
}

function isDecisionBody(x: unknown): x is DecisionPostBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.decision === "approve" || o.decision === "always" || o.decision === "deny";
}

export function startServer(deps: ServerDeps): Promise<RunningServer> {
  const { queue, logger } = deps;
  const port = deps.port ?? DAEMON_PORT;
  const host = deps.host ?? DAEMON_HOST;
  const version = deps.version ?? "0.0.0";

  const server = createServer(async (req, res) => {
    try {
      if (!isLoopback(req)) {
        send(res, 403, { error: "loopback only" });
        return;
      }
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      // POST /pending
      if (req.method === "POST" && url.pathname === "/pending") {
        const body = await readJsonBody(req);
        if (!isPendingBody(body)) {
          send(res, 400, { error: "invalid body" });
          return;
        }
        const id = randomUUID();
        const pending: PendingApproval = {
          id,
          session_id: body.session_id,
          tool_name: body.tool_name,
          tool_input: body.tool_input,
          title: buildTitle(body.tool_name, body.tool_input),
          body: JSON.stringify(body.tool_input).slice(0, 300),
          permissionRules: buildPermissionRules(body.tool_name, body.tool_input),
          createdAt: Date.now(),
        };
        queue.enqueue(pending);
        logger.info("enqueue", {
          id,
          session_id: body.session_id,
          tool_name: body.tool_name,
        });
        send(res, 200, { id, permissionRules: pending.permissionRules });
        return;
      }

      // GET /pending/:id/decision
      const decisionMatch = url.pathname.match(/^\/pending\/([^/]+)\/decision$/);
      if (req.method === "GET" && decisionMatch) {
        const id = decisionMatch[1]!;
        const wait = Math.min(
          Number.parseInt(url.searchParams.get("wait") ?? "", 10) ||
            HOOK_LONGPOLL_TIMEOUT_MS,
          HOOK_LONGPOLL_TIMEOUT_MS,
        );
        const initial = queue.state(id);
        if (initial === "unknown") {
          // Hook should treat this as "stop polling" — same semantics as local-resolved.
          send(res, 404, { error: "unknown id" });
          return;
        }
        const result = await queue.waitForDecision(id, wait);
        if (result === null) {
          send(res, 204);
          return;
        }
        if (result === "local") {
          send(res, 404, { resolved_by: "local" });
          return;
        }
        send(res, 200, {
          kind: result.kind,
          permissionRules: result.permissionRules,
        });
        return;
      }

      // POST /pending/:id/decision (used by curl/watch to inject)
      if (req.method === "POST" && decisionMatch) {
        const id = decisionMatch[1]!;
        const body = await readJsonBody(req);
        if (!isDecisionBody(body)) {
          send(res, 400, { error: "invalid decision body" });
          return;
        }
        const pending = queue.findByRequestId(id);
        if (!pending) {
          // 404 = never enqueued; 409 = already resolved
          if (queue.state(id) === "resolved") {
            send(res, 409, { error: "already resolved" });
          } else {
            send(res, 404, { error: "unknown id" });
          }
          return;
        }
        const decision: DaemonDecision =
          body.decision === "always"
            ? {
                kind: "always",
                permissionRules:
                  body.permissionRules ?? pending.permissionRules,
              }
            : { kind: body.decision };
        const ok = queue.resolve(id, decision);
        logger.info("resolve", { id, decision: body.decision, accepted: ok });
        // Idempotent: a second resolve for an already-resolved id returns 409,
        // not 404, so callers can distinguish "never enqueued" from "raced".
        send(res, ok ? 204 : 409);
        return;
      }

      // POST /pending/:id/local-resolved
      const localMatch = url.pathname.match(
        /^\/pending\/([^/]+)\/local-resolved$/,
      );
      if (req.method === "POST" && localMatch) {
        const id = localMatch[1]!;
        const ok = queue.resolveLocal(id);
        logger.info("resolve_local", { id, accepted: ok });
        send(res, 204);
        return;
      }

      // GET /status
      if (req.method === "GET" && url.pathname === "/status") {
        const list = queue.list();
        send(res, 200, {
          daemon_pid: process.pid,
          version,
          pending: list.map((p) => ({
            id: p.id,
            session_id: p.session_id,
            tool_name: p.tool_name,
            title: p.title,
            createdAt: p.createdAt,
          })),
        });
        return;
      }

      send(res, 404, { error: "not found" });
    } catch (err) {
      logger.error("request failed", { err: String(err) });
      try {
        send(res, 500, { error: "internal" });
      } catch {
        // ignore
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      logger.info("daemon listening", { host, port: actualPort });
      resolve({
        server,
        port: actualPort,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}
