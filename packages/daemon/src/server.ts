import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Queue, PendingApproval } from "./queue.js";
import { buildPermissionRules, buildTitle } from "./rules.js";
import { SlugExtractor } from "./slug.js";
import { WsHub } from "./wsHub.js";
import { Logger } from "./logger.js";
import { readConfig, writeConfig, addWatch, removeWatch } from "./config.js";
import { PairingManager } from "./pairing.js";
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
  heartbeatMs?: number;
  configPath?: string;
}

export interface RunningServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 256 * 1024;
const BODY_TRUNCATE_CHARS = 300;
const DEFAULT_HEARTBEAT_MS = 5_000;

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

interface PairCompleteBody {
  code: string;
  device_name: string;
}

function isPairCompleteBody(x: unknown): x is PairCompleteBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.code === "string" && typeof o.device_name === "string";
}

interface PairRemoveBody {
  name: string;
}

function isPairRemoveBody(x: unknown): x is PairRemoveBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.name === "string" && o.name !== "";
}

function isDecisionBody(x: unknown): x is DecisionPostBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.decision === "approve" || o.decision === "always" || o.decision === "deny";
}

function buildBody(toolInput: Record<string, unknown>): string {
  const json = JSON.stringify(toolInput);
  if (json.length <= BODY_TRUNCATE_CHARS) return json;
  return json.slice(0, BODY_TRUNCATE_CHARS - 1) + "…";
}

export function startServer(deps: ServerDeps): Promise<RunningServer> {
  const { queue, logger } = deps;
  const port = deps.port ?? DAEMON_PORT;
  const host = deps.host ?? DAEMON_HOST;
  const version = deps.version ?? "0.0.0";
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const configPath = deps.configPath;
  const slugExtractor = new SlugExtractor();
  const pairing = new PairingManager();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      // POST /pair/complete is the one route the Galaxy Watch calls over LAN —
      // the 6-digit pairing code is its authentication credential.
      // All other routes are loopback-only (hook, CLI, status).
      const isLanRoute =
        req.method === "POST" && url.pathname === "/pair/complete";
      if (!isLanRoute && !isLoopback(req)) {
        send(res, 403, { error: "loopback only" });
        return;
      }

      // POST /pending
      if (req.method === "POST" && url.pathname === "/pending") {
        const body = await readJsonBody(req);
        if (!isPendingBody(body)) {
          send(res, 400, { error: "invalid body" });
          return;
        }
        const id = randomUUID();
        const slug = slugExtractor.extract(body.session_id, body.transcript_path);
        const cwd_basename = basename(body.cwd) || body.cwd;
        const title = buildTitle(body.tool_name, body.tool_input);
        const pending: PendingApproval = {
          id,
          session_id: body.session_id,
          tool_name: body.tool_name,
          tool_input: body.tool_input,
          title,
          body: buildBody(body.tool_input),
          permissionRules: buildPermissionRules(body.tool_name, body.tool_input),
          createdAt: Date.now(),
        };
        queue.enqueue(pending);
        logger.info("enqueue", {
          id,
          session_id: body.session_id,
          tool_name: body.tool_name,
        });

        // Fan-out to all connected watches.
        hub.broadcast({
          type: "approval_request",
          id,
          session: { id: body.session_id, slug, cwd_basename },
          tool: {
            name: body.tool_name,
            title,
            body: pending.body,
            raw_input: body.tool_input,
          },
          timestamp: new Date(pending.createdAt).toISOString(),
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

      // POST /pending/:id/decision (used by curl/watch over HTTP, during spike)
      if (req.method === "POST" && decisionMatch) {
        const id = decisionMatch[1]!;
        const body = await readJsonBody(req);
        if (!isDecisionBody(body)) {
          send(res, 400, { error: "invalid decision body" });
          return;
        }
        const ok = applyWatchDecision(id, body);
        if (!ok) {
          if (queue.state(id) === "resolved") {
            send(res, 409, { error: "already resolved" });
          } else {
            send(res, 404, { error: "unknown id" });
          }
          return;
        }
        send(res, 204);
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
        if (ok) {
          hub.broadcast({
            type: "approval_resolved",
            request_id: id,
            resolved_by: "local",
            decision: "",
          });
        }
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

      // POST /pair/begin
      if (req.method === "POST" && url.pathname === "/pair/begin") {
        const session = pairing.beginPairing();
        logger.info("pair_begin", { code: "[REDACTED]" });
        send(res, 200, {
          code: session.code,
          expires_in_seconds: 60,
        });
        return;
      }

      // GET /pair/status
      if (req.method === "GET" && url.pathname === "/pair/status") {
        const status = pairing.getStatus();
        if (!status) {
          // No session or window expired
          send(res, 204);
          return;
        }
        if (!status.active) {
          // Session was completed successfully
          send(res, 200, { active: false, completed: true });
          return;
        }
        send(res, 200, {
          active: true,
          code: status.code,
          seconds_remaining: status.secondsRemaining,
        });
        return;
      }

      // POST /pair/complete
      if (req.method === "POST" && url.pathname === "/pair/complete") {
        const body = await readJsonBody(req);
        if (!isPairCompleteBody(body)) {
          send(res, 400, { error: "invalid body: code and device_name required" });
          return;
        }
        const watch = pairing.completePairing(body.code, body.device_name);
        if (!watch) {
          send(res, 403, { error: "invalid or expired pairing code" });
          return;
        }
        if (configPath) {
          const cfg = readConfig(configPath);
          addWatch(configPath, cfg, watch);
        }
        logger.info("pair_complete", { watch_id: watch.id, name: watch.name });
        send(res, 200, { watch_id: watch.id, secret: watch.secret });
        return;
      }

      // POST /pair/remove
      if (req.method === "POST" && url.pathname === "/pair/remove") {
        const body = await readJsonBody(req);
        if (!isPairRemoveBody(body)) {
          send(res, 400, { error: "invalid body: name required" });
          return;
        }
        if (!configPath) {
          send(res, 404, { error: "watch not found" });
          return;
        }
        const cfg = readConfig(configPath);
        const removed = removeWatch(configPath, cfg, body.name);
        if (!removed) {
          send(res, 404, { error: "watch not found" });
          return;
        }
        logger.info("pair_remove", { name: body.name });
        send(res, 204);
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

  function applyWatchDecision(
    id: string,
    body: { decision: "approve" | "always" | "deny"; permissionRules?: string[] },
  ): boolean {
    const pending = queue.findByRequestId(id);
    if (!pending) return false;
    const decision: DaemonDecision =
      body.decision === "always"
        ? {
            kind: "always",
            permissionRules: body.permissionRules ?? pending.permissionRules,
          }
        : { kind: body.decision };
    const ok = queue.resolve(id, decision);
    logger.info("resolve", { id, decision: body.decision, accepted: ok });
    if (ok) {
      hub.broadcast({
        type: "approval_resolved",
        request_id: id,
        resolved_by: "watch",
        decision: body.decision,
      });
    }
    return ok;
  }

  // hub is constructed below; declare for closure visibility above.
  // eslint-disable-next-line prefer-const, @typescript-eslint/no-use-before-define
  let hub!: WsHub;
  hub = new WsHub({
    httpServer: server,
    logger,
    heartbeatMs,
    version,
    configPath,
    pendingCount: () => queue.list().length,
    activeSessions: () =>
      new Set(queue.list().map((p) => p.session_id)).size,
    onApprovalResponse: (msg) => {
      applyWatchDecision(msg.request_id, { decision: msg.decision });
    },
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
        close: async () => {
          await hub.close();
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
