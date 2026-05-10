import {
  HookInput,
  HookOutput,
  HOOK_POLL_INTERVAL_MS,
  HOOK_TIMEOUT_SECONDS,
  HOOK_LONGPOLL_TIMEOUT_MS,
} from "@watchcode/shared";
import { baselineSize, transcriptGrew } from "./transcriptWatcher.js";
import { toHookOutput } from "./decision.js";
import { createDaemonClient, DaemonClient } from "./daemonClient.js";

export interface RunDeps {
  client?: DaemonClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function run(stdin: string, deps: RunDeps = {}): Promise<HookOutput | null> {
  const parsed = HookInput.safeParse(safeJsonParse(stdin));
  if (!parsed.success) return null;
  const ev = parsed.data;

  const client = deps.client ?? createDaemonClient();
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;

  const baseline = baselineSize(ev.transcript_path);

  let id: string;
  try {
    const r = await client.enqueue({
      session_id: ev.session_id,
      transcript_path: ev.transcript_path,
      cwd: ev.cwd,
      tool_name: ev.tool_name,
      tool_input: ev.tool_input,
    });
    id = r.id;
  } catch {
    return null;
  }

  const deadline = now() + HOOK_TIMEOUT_SECONDS * 1000;
  while (now() < deadline) {
    if (transcriptGrew(ev.transcript_path, baseline)) {
      // Await with a short cap: we want the daemon to record the local
      // resolution before the hook process exits, but not block CC if the
      // daemon is slow.
      await Promise.race([
        client.markLocal(id),
        sleep(500),
      ]);
      return null;
    }
    let decision;
    try {
      decision = await client.pollDecision(id, HOOK_LONGPOLL_TIMEOUT_MS);
    } catch {
      return null;
    }
    if (decision === "local") {
      return null;
    }
    if (decision) {
      // TOCTOU re-check: local response may have arrived during long-poll.
      if (transcriptGrew(ev.transcript_path, baseline)) {
        // Await with a short cap: we want the daemon to record the local
      // resolution before the hook process exits, but not block CC if the
      // daemon is slow.
      await Promise.race([
        client.markLocal(id),
        sleep(500),
      ]);
        return null;
      }
      return toHookOutput(decision);
    }
    await sleep(HOOK_POLL_INTERVAL_MS);
  }
  return null;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
