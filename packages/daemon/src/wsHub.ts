import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import { ApprovalResponseMsg } from "@watchcode/shared";
import type { Logger } from "./logger.js";

export interface WsHubDeps {
  httpServer: Server;
  logger: Logger;
  heartbeatMs: number;
  version: string;
  pendingCount: () => number;
  activeSessions: () => number;
  onApprovalResponse: (
    msg: { request_id: string; decision: "approve" | "always" | "deny" },
  ) => void;
}

export class WsHub {
  private wss: WebSocketServer;
  private heartbeatTimer: NodeJS.Timeout;

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
      // Mirror the loopback gate the http handler enforces. Slice 4 will
      // add HMAC-based client_hello on top to authenticate paired watches.
      const addr = req.socket.remoteAddress ?? "";
      const isLoopback =
        addr === "127.0.0.1" ||
        addr === "::1" ||
        addr === "::ffff:127.0.0.1";
      if (!isLoopback) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws) => {
      ws.on("message", (data) => this.handleMessage(ws, data));
      ws.on("error", (err) => deps.logger.warn("ws error", { err: String(err) }));
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
    const result = ApprovalResponseMsg.safeParse(parsed);
    if (!result.success) {
      this.deps.logger.warn("ws: invalid message", {
        issues: result.error.issues.length,
      });
      return;
    }
    this.deps.onApprovalResponse({
      request_id: result.data.request_id,
      decision: result.data.decision,
    });
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
