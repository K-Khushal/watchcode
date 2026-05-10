import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { HOOK_TIMEOUT_SECONDS } from "@watchcode/shared";

export const HOOK_COMMAND_MARKER = "watchcode";

interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}

interface Settings {
  hooks?: { PermissionRequest?: HookEntry[]; [k: string]: HookEntry[] | undefined };
  [k: string]: unknown;
}

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Settings;
}

function writeSettings(path: string, obj: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
}

function isWatchcodeEntry(entry: HookEntry, command: string): boolean {
  return entry.hooks.some((h) => h.type === "command" && h.command === command);
}

export function mergeHookEntry(path: string, command: string): void {
  const settings = readSettings(path);
  const hooks = settings.hooks ?? {};
  const list = hooks.PermissionRequest ?? [];

  if (list.some((e) => isWatchcodeEntry(e, command))) {
    return;
  }

  const next: HookEntry = {
    matcher: "",
    hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }],
  };
  const newList = [...list, next];
  settings.hooks = { ...hooks, PermissionRequest: newList };
  writeSettings(path, settings);
}

export function removeHookEntry(path: string, command: string): void {
  if (!existsSync(path)) return;
  const settings = readSettings(path);
  const list = settings.hooks?.PermissionRequest;
  if (!list) return;
  const filtered = list.filter((e) => !isWatchcodeEntry(e, command));
  if (filtered.length === list.length) return;
  if (filtered.length === 0) {
    delete settings.hooks!.PermissionRequest;
  } else {
    settings.hooks!.PermissionRequest = filtered;
  }
  writeSettings(path, settings);
}
