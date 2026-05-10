import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export function createFileLogger(path: string): Logger {
  mkdirSync(dirname(path), { recursive: true });
  const write = (level: string, msg: string, meta?: Record<string, unknown>) => {
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        msg,
        ...(meta ?? {}),
      }) + "\n";
    try {
      appendFileSync(path, line);
    } catch {
      // Logging must never throw.
    }
  };
  return {
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
  };
}
