import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function writePidFile(path: string, pid = process.pid): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(pid), { mode: 0o600 });
}

export function readPidFile(path: string): number | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function removePidFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
