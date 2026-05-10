import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { defaultPaths } from "../paths.js";
import { removeHookEntry } from "../settingsJson.js";

export interface StopOptions {
  homeDir?: string;
  keepHook?: boolean;
}

export async function stopCommand(opts: StopOptions = {}): Promise<{ stopped: boolean }> {
  const paths = defaultPaths(opts.homeDir);
  let stopped = false;

  if (existsSync(paths.pidFile)) {
    const pid = Number.parseInt(readFileSync(paths.pidFile, "utf8").trim(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
        stopped = true;
      } catch {
        // process already gone
      }
      // Wait up to ~2s for graceful exit; SIGKILL fallback so a wedged daemon
      // doesn't leave port 9876 held when the user retries `watchcode start`.
      await waitForExit(pid, 2000);
      if (isAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // ignore
        }
      }
    }
    try {
      unlinkSync(paths.pidFile);
    } catch {
      // ignore
    }
  }

  if (!opts.keepHook) {
    // We can't reconstruct the exact command without checking; remove any entry whose command contains "watchcode" hook path.
    // Implementation: read settings, scan for entries whose command points to @watchcode/hook.
    removeHookEntriesByMarker(paths.claudeSettings);
  }

  return { stopped };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function removeHookEntriesByMarker(settingsPath: string): void {
  if (!existsSync(settingsPath)) return;
  const raw = readFileSync(settingsPath, "utf8").trim();
  if (!raw) return;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const hooks = (obj as { hooks?: { PermissionRequest?: { hooks: { command: string }[] }[] } }).hooks;
  const list = hooks?.PermissionRequest;
  if (!list) return;
  for (const entry of list) {
    for (const h of entry.hooks) {
      if (typeof h.command === "string" && h.command.includes("@watchcode/hook")) {
        removeHookEntry(settingsPath, h.command);
      }
    }
  }
}
