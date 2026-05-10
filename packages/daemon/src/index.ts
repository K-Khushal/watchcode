import { homedir } from "node:os";
import { join } from "node:path";
import { Queue } from "./queue.js";
import { createFileLogger } from "./logger.js";
import { startServer, RunningServer } from "./server.js";
import { writePidFile, removePidFile } from "./pidfile.js";

export interface StartDaemonOptions {
  port?: number;
  host?: string;
  homeDir?: string;
}

export async function startDaemon(opts: StartDaemonOptions = {}): Promise<RunningServer> {
  const home = opts.homeDir ?? join(homedir(), ".watchcode");
  const logger = createFileLogger(join(home, "logs", "daemon.log"));
  const queue = new Queue();
  const pidPath = join(home, "daemon.pid");

  // Bind the port BEFORE writing the pid file so a failed bind never leaves a
  // stale pid pointing at a non-listening process.
  const running = await startServer({ queue, logger, port: opts.port, host: opts.host });
  writePidFile(pidPath);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown", { signal });
    // Hard-deadline: if close() hangs, force-exit so the daemon is never
    // unkillable except by SIGKILL.
    const force = setTimeout(() => process.exit(1), 5_000);
    force.unref?.();
    running.close().finally(() => {
      removePidFile(pidPath);
      clearTimeout(force);
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return running;
}

// When invoked directly (spawned by CLI), start the daemon.
const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  startDaemon().catch((err) => {
    console.error("daemon failed to start:", err);
    process.exit(1);
  });
}

export { Queue } from "./queue.js";
export * from "./logger.js";
export * from "./pidfile.js";
export * from "./server.js";
export * from "./rules.js";
