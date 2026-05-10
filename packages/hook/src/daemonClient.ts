import {
  DAEMON_HOST,
  DAEMON_PORT,
  HOOK_LONGPOLL_TIMEOUT_MS,
  DaemonDecision,
} from "@watchcode/shared";

export interface EnqueueInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface DaemonClient {
  enqueue(input: EnqueueInput): Promise<{ id: string }>;
  pollDecision(id: string, timeoutMs: number): Promise<DaemonDecision | null | "local">;
  markLocal(id: string): Promise<void>;
}

const baseUrl = (host: string, port: number) => `http://${host}:${port}`;

export function createDaemonClient(
  host: string = DAEMON_HOST,
  port: number = DAEMON_PORT,
): DaemonClient {
  const base = baseUrl(host, port);
  return {
    async enqueue(input) {
      const r = await fetch(`${base}/pending`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) throw new Error(`enqueue failed: ${r.status}`);
      return (await r.json()) as { id: string };
    },
    async pollDecision(id, timeoutMs) {
      const wait = Math.min(timeoutMs, HOOK_LONGPOLL_TIMEOUT_MS);
      const r = await fetch(
        `${base}/pending/${encodeURIComponent(id)}/decision?wait=${wait}`,
        { method: "GET" },
      );
      if (r.status === 204) return null;
      if (r.status === 404) return "local";
      if (!r.ok) throw new Error(`poll failed: ${r.status}`);
      return (await r.json()) as DaemonDecision;
    },
    async markLocal(id) {
      await fetch(
        `${base}/pending/${encodeURIComponent(id)}/local-resolved`,
        { method: "POST" },
      ).catch(() => undefined);
    },
  };
}
