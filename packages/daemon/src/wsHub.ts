import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { ApprovalResponseMsg, ClientHelloMsg, WS_HELLO_TIMEOUT_MS, WS_CLOSE_UNAUTHENTICATED } from "@watchcode/shared";
import type { Logger } from "./logger.js";
import { readConfig, updateWatchNonce, type PairedWatch } from "./config.js";
import { verifyAndAdvanceNonce } from "./hmac.js";

export interface WsHubDeps {
  httpServer: Server;
  logger: Logger;
  heartbeatMs: number;
  version: string;
  pendingCount: () => number;
  activeSessions: () => number;
  configPath?: string;
  onApprovalResponse: (
    msg: { request_id: string; decision: "approve" | "always" | "deny" },
  ) => void;
}

interface AuthenticatedSocket {
  /** In-memory watch record — last_nonce is advanced here AND persisted to disk. */
  watch: PairedWatch;
}

export class WsHub {
  private wss: WebSocketServer;
  private heartbeatTimer: NodeJS.Timeout;
  private authenticated = new WeakMap<WebSocket, AuthenticatedSocket>();

  constructor(private deps: WsHubDeps) {
    // 64 KiB ceiling on inbound frames — protocol messages are tiny; a
    // larger frame is either malformed or hostile. Default in `ws` is 100 MB.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

    deps.httpServer.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "/";
      if (url !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws) => {
      ws.on("error", (err) => deps.logger.warn("ws error", { err: String(err) }));

      // Require a signed client_hello within the hello timeout window.
      const helloTimer = setTimeout(() => {
        if (!this.authenticated.has(ws)) {
          deps.logger.warn("ws: hello timeout, closing");
          ws.close(WS_CLOSE_UNAUTHENTICATED);
        }
      }, WS_HELLO_TIMEOUT_MS);
      helloTimer.unref?.();

      ws.on("close", () => clearTimeout(helloTimer));
      ws.on("message", (data) => this.handleMessage(ws, data));

      // Send an immediate heartbeat so a fresh client knows the daemon is alive.
      this.sendTo(ws, this.heartbeat());
    });

    this.heartbeatTimer = setInterval(() => {
      const beat = JSON.stringify(this.heartbeat());
      for (const client of this.wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(beat);
      }
    }, deps.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  broadcast(msg: object): void {
    const json = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(json);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    for (const client of this.wss.clients) {
      try {
        client.close();
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private handleMessage(ws: WebSocket, data: WebSocket.RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.deps.logger.warn("ws: malformed json");
      return;
    }

    const auth = this.authenticated.get(ws);
    if (!auth) {
      this.handleHello(ws, parsed);
      return;
    }

    this.handleAuthenticatedMessage(ws, parsed, auth.watch);
  }

  private handleHello(ws: WebSocket, parsed: unknown): void {
    const result = ClientHelloMsg.safeParse(parsed);
    if (!result.success) {
      this.deps.logger.warn("ws: invalid client_hello", { issues: result.error.issues.length });
      ws.close(WS_CLOSE_UNAUTHENTICATED);
      return;
    }

    const hello = result.data;
    const found = this.lookupWatch(hello.watch_id);
    if (!found) {
      this.deps.logger.warn("ws: unknown watch_id in hello", { watch_id: hello.watch_id });
      ws.close(WS_CLOSE_UNAUTHENTICATED);
      return;
    }
    const { watch } = found;

    const valid = verifyAndAdvanceNonce(watch, {
      type: hello.type,
      watch_id: hello.watch_id,
      nonce: hello.nonce,
      hmac: hello.hmac,
      protocol_version: hello.protocol_version,
    });
    if (!valid) {
      this.deps.logger.warn("ws: client_hello auth failed", { watch_id: hello.watch_id });
      ws.close(WS_CLOSE_UNAUTHENTICATED);
      return;
    }

    // Persist the advanced nonce so replay protection survives a daemon restart.
    // updateWatchNonce re-reads the config from disk to avoid TOCTOU races.
    if (this.deps.configPath) {
      updateWatchNonce(this.deps.configPath, watch.id, watch.last_nonce);
    }
    this.authenticated.set(ws, { watch });
    this.deps.logger.info("ws: authenticated", { watch_id: watch.id, name: watch.name });
  }

  private handleAuthenticatedMessage(ws: WebSocket, parsed: unknown, watch: PairedWatch): void {
    const result = ApprovalResponseMsg.safeParse(parsed);
    if (!result.success) {
      this.deps.logger.warn("ws: invalid message", { issues: result.error.issues.length });
      return;
    }
    const msg = result.data;

    const valid = verifyAndAdvanceNonce(watch, {
      type: msg.type,
      watch_id: watch.id,
      nonce: msg.nonce,
      hmac: msg.hmac,
      request_id: msg.request_id,
      decision: msg.decision,
    });
    if (!valid) {
      this.deps.logger.warn("ws: replay or hmac mismatch, dropping", { watch_id: watch.id });
      return;
    }

    // Persist the advanced nonce to survive a daemon restart.
    if (this.deps.configPath) {
      updateWatchNonce(this.deps.configPath, watch.id, watch.last_nonce);
    }

    this.deps.onApprovalResponse({
      request_id: msg.request_id,
      decision: msg.decision,
    });
  }

  private lookupWatch(watchId: string): { watch: PairedWatch } | undefined {
    if (!this.deps.configPath) return undefined;
    const cfg = readConfig(this.deps.configPath);
    const watch = cfg.watches.find((w) => w.id === watchId);
    return watch ? { watch } : undefined;
  }

  private sendTo(ws: WebSocket, msg: object): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }

  private heartbeat(): object {
    return {
      type: "daemon_status",
      active_sessions: this.deps.activeSessions(),
      pending_count: this.deps.pendingCount(),
      version: this.deps.version,
    };
  }
}
