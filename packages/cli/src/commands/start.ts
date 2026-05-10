import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { mergeHookEntry } from "../settingsJson.js";
import { defaultPaths } from "../paths.js";

const require = createRequire(import.meta.url);

function resolveDaemonEntry(): string {
  return require.resolve("@watchcode/daemon");
}

function resolveHookEntry(): string {
  return require.resolve("@watchcode/hook/dist/cli.js");
}

export interface StartOptions {
  homeDir?: string;
  detached?: boolean;
}

export async function startCommand(opts: StartOptions = {}): Promise<{ pid: number }> {
  const paths = defaultPaths(opts.homeDir);

  // 1. Register hook in ~/.claude/settings.json (idempotent).
  // Claude Code runs the command via the user's shell, so quote the path
  // to survive spaces (e.g. /Users/Jane Doe/...).
  const hookCmd = `node '${resolveHookEntry().replace(/'/g, "'\\''")}'`;
  mergeHookEntry(paths.claudeSettings, hookCmd);

  // 2. Spawn daemon detached
  mkdirSync(dirname(paths.logFile), { recursive: true });
  const out = openSync(paths.logFile, "a");
  const err = openSync(paths.logFile, "a");
  const child = spawn(process.execPath, [resolveDaemonEntry()], {
    detached: opts.detached !== false,
    stdio: ["ignore", out, err],
    env: { ...process.env, WATCHCODE_HOME: paths.home },
  });
  if (opts.detached !== false) child.unref();

  return { pid: child.pid! };
}
